import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateId,
  getToolName,
  isToolUIPart,
  stepCountIs,
  streamText,
  toUIMessageStream,
  safeValidateUIMessages,
  type LanguageModel,
  type ToolSet,
  type UIMessage,
} from "ai";
import { after } from "next/server";
import { z } from "zod";
import { ctxForCurrentUser } from "@/server/core/action";
import type { Ctx } from "@/server/core/context";
import { DomainError } from "@/server/core/errors";
import { toAiTools, toolApprovalFor, type ToolScope } from "@/server/modules/assistant/ai-tools";
import { assistantConfig, getModelForUser, modelInfo } from "@/server/modules/assistant/model";
import { projectSystemPrompt, workspaceSystemPrompt } from "@/server/modules/assistant/prompt";
import { repairInterruptedToolCalls } from "@/server/modules/assistant/repair";
import { assistantService } from "@/server/modules/assistant/service";
import { ASSISTANT_TOOLS, PROJECT_TOOLS, findTool } from "@/server/modules/assistant/tools";
import { memoryService } from "@/server/modules/memory/service";
import { reflect } from "@/server/modules/reflection/service";
import { generationRecorder } from "@/shared/analytics/ai";
import { capture } from "@/shared/analytics/server";
import {
  keepTurnErrors,
  turnErrorDataSchemas,
  turnErrorMessage,
  turnErrorMessageOf,
} from "@/server/modules/assistant/turn-error";
import { ASSISTANT_ERROR_TEXT, ASSISTANT_LIMIT_REACHED, ASSISTANT_NOT_CONFIGURED } from "@/shared/lib/assistant-errors";
import { CITABLE_PART, citableDataSchemas, citableStrings } from "@/shared/lib/citation";

export const maxDuration = 60;

type ValidateTools = Parameters<typeof safeValidateUIMessages>[0]["tools"];

// `messages` gets its real check from safeValidateUIMessages against the bound tools below.
// The Conversation carries the scope: projectId on its row, null = dashboard.
const bodySchema = z.object({
  conversationId: z.string().min(1),
  aiConfigId: z.string().nullish(),
  messages: z.array(z.unknown()),
});

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return new Response("Bad request", { status: 400 });
  const { conversationId, aiConfigId: requestedConfigId } = parsed.data;

  const ctx = { ...(await ctxForCurrentUser()), via: "assistant" as const };
  const { maxSteps, dailyTurnCap } = assistantConfig();
  try {
    const conversation = await assistantService.getConversation(ctx, conversationId);
    const aiConfigId = requestedConfigId ?? conversation.aiConfigId;
    const model = await getModelForUser(ctx, aiConfigId);
    if (!model) return new Response(ASSISTANT_NOT_CONFIGURED, { status: 503 });
    if (requestedConfigId !== undefined && requestedConfigId !== conversation.aiConfigId)
      await assistantService.selectModel(ctx, conversation.id, requestedConfigId ?? null);
    const projectId = conversation.projectId;
    const scope = { projectId: projectId ?? undefined, conversationId };
    const tools = toAiTools(ctx, projectId ? PROJECT_TOOLS : ASSISTANT_TOOLS, scope);
    const valid = await safeValidateUIMessages<UIMessage>({
      messages: parsed.data.messages,
      tools: tools as ValidateTools,
      dataSchemas: { ...turnErrorDataSchemas, ...citableDataSchemas },
    });
    if (!valid.success) {
      console.warn("Assistant turn rejected: invalid messages", { conversationId, error: valid.error.message });
      return new Response("Bad request", { status: 400 });
    }
    // A turn that died mid-flight leaves tool calls with no result, which the model API rejects.
    // Mark them interrupted instead so the thread stays usable and the model can redo them.
    const messages = repairInterruptedToolCalls(valid.data);
    // From here the User's message is valid, so a failure is saved into the thread, not dropped.
    const failTurn = async (message: string, status: number, body = message) => {
      await assistantService.saveMessages(ctx, conversation.id, [
        ...messages,
        turnErrorMessageOf(generateId(), message),
      ]);
      return new Response(body, { status });
    };
    const workflow = projectId ? "project" : "workspace";
    if ((await assistantService.turnsToday(ctx)) >= dailyTurnCap) {
      await capture(ctx.userId, "assistant_limit_reached", { workflow, daily_turn_cap: dailyTurnCap });
      return failTurn(ASSISTANT_ERROR_TEXT[ASSISTANT_LIMIT_REACHED]!, 429, ASSISTANT_LIMIT_REACHED);
    }
    try {
      return await streamTurn({ ctx, model, conversationId, projectId, scope, tools, messages, workflow, maxSteps });
    } catch (e) {
      console.error("Assistant turn failed before streaming", { conversationId }, e);
      if (e instanceof DomainError) return failTurn(e.message, e.code === "forbidden" ? 403 : 400);
      return failTurn(turnErrorMessage(e), 500);
    }
  } catch (e) {
    if (e instanceof DomainError) {
      console.warn("Assistant turn rejected", { conversationId, code: e.code, message: e.message });
      return new Response(e.message, { status: e.code === "forbidden" ? 403 : 400 });
    }
    throw e;
  }
}

type TurnInput = {
  ctx: Ctx & { via: "assistant" };
  model: LanguageModel;
  conversationId: string;
  projectId: string | null;
  scope: ToolScope;
  tools: ToolSet;
  messages: UIMessage[];
  workflow: "project" | "workspace";
  maxSteps: number;
};

/** Build the prompt and stream one turn; errors inside the stream are written into the reply. */
async function streamTurn({
  ctx,
  model,
  conversationId,
  projectId,
  scope,
  tools,
  messages,
  workflow,
  maxSteps,
}: TurnInput) {
  const last = messages.at(-1);
  // A resubmit after an approval card ends on the Assistant's message: that is a decision, not a question.
  if (last?.role === "user") await capture(ctx.userId, "assistant_question_sent", { workflow });
  // The User's answers to approval cards, recorded once the turn completes. An approval is signed,
  // so a forged or stale one errors the stream and never reaches `onEnd`; a denial is not signed.
  // This is the answer, not the outcome: the server can still deny an approved call it re-checks.
  const approvals = (last?.role === "assistant" ? last.parts : []).flatMap((part) =>
    isToolUIPart(part) && part.state === "approval-responded" && !part.approval.isAutomatic
      ? [{ tool: getToolName(part), approved: part.approval.approved }]
      : [],
  );
  const [profile, workingMemory] = await Promise.all([
    memoryService.current(ctx, null),
    projectId ? memoryService.current(ctx, projectId) : null,
  ]);
  const memory = { profile: profile?.body, workingMemory: workingMemory?.body };
  const summary = projectId
    ? await findTool("get_project_summary").handler(ctx, { projectId })
    : await findTool("list_projects").handler(ctx, {});
  const system = projectId ? projectSystemPrompt(summary, memory) : workspaceSystemPrompt(summary, memory);

  // One trace per request: each model call is an `$ai_generation`, the turn is `assistant_turn_completed`.
  const traceId = crypto.randomUUID();
  const started = performance.now();
  const properties = { workflow, conversation_id: conversationId };
  const generations = generationRecorder(ctx.userId, { traceId, ...modelInfo(), properties });
  const result = streamText({
    model,
    system,
    messages: await convertToModelMessages(messages),
    tools,
    toolApproval: await toolApprovalFor(ctx, projectId ? PROJECT_TOOLS : ASSISTANT_TOOLS, scope),
    // Signs approval requests so a client cannot forge an "approved" response.
    experimental_toolApprovalSecret: process.env.BETTER_AUTH_SECRET,
    stopWhen: stepCountIs(maxSteps),
    onLanguageModelCallStart: generations.onLanguageModelCallStart,
    onLanguageModelCallEnd: generations.onLanguageModelCallEnd,
    onError: async ({ error }) => {
      console.error(error);
      await generations.onError(error);
    },
    onEnd: async ({ steps, totalUsage, finishReason }) => {
      const toolNames = steps.flatMap((s) => s.toolCalls.map((c) => c.toolName));
      await Promise.all([
        ...approvals.map((a) => capture(ctx.userId, "assistant_tool_approval", { workflow, ...a })),
        capture(ctx.userId, "assistant_turn_completed", {
          ...properties,
          $ai_trace_id: traceId,
          step_count: steps.length,
          tool_call_count: toolNames.length,
          tool_names: [...new Set(toolNames)],
          finish_reason: finishReason,
          // Cut off: the last allowed step still asked for tools. A model answering on that step was not.
          hit_step_cap: steps.length >= maxSteps && finishReason === "tool-calls",
          latency_ms: Math.round(performance.now() - started),
          input_tokens: totalUsage.inputTokens,
          output_tokens: totalUsage.outputTokens,
        }),
      ]);
    },
  });
  // Reflection runs once the response is out and the thread is saved; its failures never reach the User (ADR 0007).
  const { promise: saved, resolve: markSaved } = Promise.withResolvers<boolean>();
  after(async () => {
    if (await saved)
      await reflect({ ...ctx, via: "reflection" }, conversationId, { traceId }).catch((e) => console.error(e));
  });
  return createUIMessageStreamResponse({
    stream: createUIMessageStream<UIMessage>({
      originalMessages: messages,
      // Gives the response message a stable id so a turn paused for approval continues the same
      // row on resubmit instead of saving an id-less message plus a duplicate (ADR 0011).
      generateId,
      onError: turnErrorMessage,
      // The error is also written into the reply, so the saved thread keeps it after a reload.
      execute: ({ writer }) => {
        // Saved with the reply, so the dock can link citations copied from the summary after a reload too.
        writer.write({ type: CITABLE_PART, data: citableStrings(summary) });
        writer.merge(keepTurnErrors(toUIMessageStream({ stream: result.stream, onError: turnErrorMessage })));
      },
      onEnd: async ({ messages: all }) => {
        await assistantService.saveMessages(ctx, conversationId, all).then(
          () => markSaved(true),
          (e) => {
            markSaved(false);
            throw e;
          },
        );
      },
    }),
  });
}
