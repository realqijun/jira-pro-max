import { NoObjectGeneratedError, type LanguageModelCallEndEvent, type LanguageModelUsage } from "ai";
import { capture } from "./server";

/**
 * LLM observability in PostHog's `$ai_generation` shape, so its LLM Analytics view computes cost,
 * latency and token totals per model without extra setup. Same data-safety rule as every other
 * event: counts, timings and ids only - `$ai_input` and `$ai_output_choices` are never sent, so no
 * prompt, Evidence text, transcript or answer leaves the server.
 */

/** Which of the three model call sites produced the generation. */
export type AiSpan = "assistant_turn" | "proposal_extraction" | "reflection";

/**
 * Who a model call is attributed to, handed to a model-backed function by its service. Optional
 * so tests and scripts can call the function without analytics.
 */
export interface AiTelemetry {
  userId: string;
  /** Bounded, content-free metadata such as `project_id`. */
  properties?: Record<string, unknown>;
  /** Joins the trace of the work that caused this call, such as the Assistant turn a reflection follows. */
  traceId?: string;
}

export interface Generation {
  span: AiSpan;
  /** Groups the calls of one Assistant turn, proposal pass or reflection. */
  traceId: string;
  provider: string;
  model: string;
  latencyMs: number;
  usage?: LanguageModelUsage;
  finishReason?: string;
  error?: unknown;
  properties?: Record<string, unknown>;
}

const errorName = (error: unknown) => (error instanceof Error ? error.name : "UnknownError");

/**
 * The provider family only: the OpenAI SDK names its chat model `openai.responses` or `openai.chat`,
 * and PostHog's cost lookup and any breakdown by provider should see one `openai`.
 */
const providerFamily = (provider: string) => provider.split(".")[0];

/** Never throws: telemetry cannot fail a model call or the write around it. */
export async function captureGeneration(userId: string, g: Generation) {
  try {
    await capture(userId, "$ai_generation", {
      ...g.properties,
      $ai_trace_id: g.traceId,
      $ai_span_name: g.span,
      $ai_provider: providerFamily(g.provider),
      $ai_model: g.model,
      $ai_latency: g.latencyMs / 1000,
      $ai_input_tokens: g.usage?.inputTokens,
      $ai_output_tokens: g.usage?.outputTokens,
      $ai_cache_read_input_tokens: g.usage?.inputTokenDetails?.cacheReadTokens,
      $ai_reasoning_tokens: g.usage?.outputTokenDetails?.reasoningTokens,
      finish_reason: g.finishReason,
      $ai_is_error: g.error !== undefined,
      // The class name only: provider messages can echo parts of the prompt.
      ...(g.error !== undefined ? { $ai_error: errorName(g.error) } : {}),
    });
  } catch {
    // `capture` isolates delivery; this covers building the payload.
  }
}

/**
 * Times one `generateObject` call and records it, success or failure; without `telemetry` it only
 * runs it. The result is returned or the error rethrown unchanged. Latency spans the whole call,
 * including any retries the SDK makes after a provider error.
 */
export async function traceGeneration<T extends { usage: LanguageModelUsage }>(
  telemetry: AiTelemetry | undefined,
  g: { span: AiSpan; provider: string; model: string },
  run: () => Promise<T>,
): Promise<T> {
  if (!telemetry) return run();
  const started = performance.now();
  const record = (rest: Pick<Generation, "usage" | "error">) =>
    captureGeneration(telemetry.userId, {
      ...g,
      ...rest,
      traceId: telemetry.traceId ?? crypto.randomUUID(),
      latencyMs: performance.now() - started,
      properties: telemetry.properties,
    });
  try {
    const result = await run();
    await record({ usage: result.usage });
    return result;
  } catch (error) {
    // A schema mismatch still spent tokens; keep them in the cost totals.
    await record({ error, usage: NoObjectGeneratedError.isInstance(error) ? error.usage : undefined });
    throw error;
  }
}

/**
 * `streamText` callbacks that record one `$ai_generation` per model call. Whichever callback reports
 * a call first records it: a stream that fails midway reaches `onError` and then
 * `onLanguageModelCallEnd` with finish reason `error`, and must not count twice. An error outside
 * a model call (a tool, an approval) is not a generation and is not recorded.
 */
export function generationRecorder(
  userId: string,
  g: { traceId: string; provider: string; model: string; properties?: Record<string, unknown> },
) {
  let step = 0;
  let started = 0;
  let call: "idle" | "open" | "recorded" = "idle";
  const record = (rest: Pick<Generation, "provider" | "model" | "usage" | "finishReason" | "error">) => {
    call = "recorded";
    return captureGeneration(userId, {
      ...g,
      ...rest,
      span: "assistant_turn",
      latencyMs: performance.now() - started,
      properties: { ...g.properties, step },
    });
  };
  return {
    /** Fires before every attempt, including one that fails before a stream exists. */
    onLanguageModelCallStart: () => {
      started = performance.now();
      call = "open";
    },
    onLanguageModelCallEnd: async (end: LanguageModelCallEndEvent) => {
      if (call === "open")
        await record({
          provider: end.provider,
          model: end.modelId,
          usage: end.usage,
          finishReason: end.finishReason,
          error: end.finishReason === "error" ? new Error("Stream finished with an error") : undefined,
        });
      call = "idle";
      step++;
    },
    onError: async (error: unknown) => {
      if (call === "open") await record({ provider: g.provider, model: g.model, error });
    },
  };
}
