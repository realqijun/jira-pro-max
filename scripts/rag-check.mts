/**
 * Standalone RAG evaluation harness. Not part of the app: it drives the production search
 * service, tool registry, scope binding, system prompt and `getModel()` against an isolated
 * database, so a run exercises the same code paths as the Assistant dock without the HTTP route.
 *
 * Credentials come from the environment only; nothing secret is written to the artifacts.
 *
 * Usage:
 *   DATABASE_URL=... OPENAI_API_KEY=... OPENAI_BASE_URL=... tsx scripts/rag-check.mts <outDir>
 */
import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { generateText, stepCountIs } from "ai";
import type { Ctx } from "@/server/core/context";
import { db } from "@/server/db/client";
import { toAiTools } from "@/server/modules/assistant/ai-tools";
import { assistantConfig, getModel, modelInfo } from "@/server/modules/assistant/model";
import { projectSystemPrompt } from "@/server/modules/assistant/prompt";
import { PROJECT_TOOLS, findTool } from "@/server/modules/assistant/tools";
import { evidenceRepo } from "@/server/modules/evidence/repository";
import { embeddingModelId } from "@/server/modules/search/embed";
import { chunksRepo } from "@/server/modules/search/repository";
import { searchService } from "@/server/modules/search/service";

const OUT = process.argv[2] ?? "artifacts/rag-check-openrouter";
const PROJECT_ID = "ca805f30-0938-40ce-9d05-e19a7bf00a4d";
const USER_ID = "kHrQjWSEzZXJjuTJR9Wpp2gwEG83gBkU";
/** The five tools the previous evaluation exposed, so results stay comparable. */
const TOOL_NAMES = ["search_evidence", "read_evidence", "search_decisions", "list_evidence", "get_project_summary"];

const ctx: Ctx = { db, userId: USER_ID, via: "assistant" };
const write = (name: string, value: unknown) =>
  writeFile(join(OUT, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");

const RETRIEVAL_CASES = [
  { id: "paraphrase", input: { query: "external partner blocked by identity access approval", limit: 4 } },
  { id: "reviewer-capacity", input: { query: "staffing shortage before the security assessment", limit: 4 } },
  { id: "all-labels", input: { query: "identity access", labels: ["vendor", "security"], limit: 4 } },
  {
    id: "linked-task",
    input: {
      linkedTo: { entityType: "task" as const, entity: "Provision IAM service account for auth testing" },
      limit: 4,
    },
  },
  { id: "absent-topic", input: { query: "approved 2027 quantum satellite procurement budget in SGD", limit: 4 } },
];

const PROMPTS = JSON.parse(
  await (
    await import("node:fs/promises")
  ).readFile(process.env.PROMPTS_FILE ?? "artifacts/rag-check-2026-09-28/prompts.json", "utf8"),
) as { id: string; prompt: string; expected: string }[];
/** Re-embedding and the direct probes are skippable so a follow-up prompt set can reuse the index. */
const SKIP_INDEX = process.env.SKIP_INDEX === "1";
const RESULTS_NAME = process.env.RESULTS_NAME ?? "results.json";

async function indexState() {
  const rows = await evidenceRepo.listByProject(db, PROJECT_ID);
  const state = await chunksRepo.indexState(db, PROJECT_ID);
  return rows.map((r) => ({
    title: r.title,
    chunked: state.get(r.id)?.chunked ?? false,
    model: state.get(r.id)?.model ?? null,
  }));
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const model = getModel();
  if (!model) throw new Error("getModel() returned null: set AI_PROVIDER=openai and OPENAI_API_KEY");

  if (!SKIP_INDEX) {
    const before = await indexState();
    // Re-embed through the production path: a new embedder identity marks every vector stale.
    const rows = await evidenceRepo.listByProject(db, PROJECT_ID);
    for (const row of rows) await searchService.syncEvidence(row);
    const after = await indexState();
    const chunks = await chunksRepo.listForProject(db, PROJECT_ID);
    await write("index.json", {
      embeddingModelId: embeddingModelId(),
      before,
      after,
      chunks: chunks.map((c) => ({
        ordinal: c.ordinal,
        chars: c.text.length,
        dims: c.embedding?.length ?? null,
        model: c.model,
      })),
    });
  }

  const retrieval: unknown[] = [];
  for (const c of SKIP_INDEX ? [] : RETRIEVAL_CASES) {
    const started = Date.now();
    try {
      const res = await searchService.search(ctx, { projectId: PROJECT_ID, ...c.input });
      retrieval.push({ id: c.id, input: c.input, ms: Date.now() - started, result: res });
      console.log(`[retrieval] ${c.id} ok ${Date.now() - started}ms`);
    } catch (e) {
      retrieval.push({ id: c.id, input: c.input, ms: Date.now() - started, error: String(e) });
      console.log(`[retrieval] ${c.id} FAILED ${String(e)}`);
    }
  }
  if (retrieval.length) await write("retrieval.json", retrieval);

  const summary = await findTool("get_project_summary").handler(ctx, { projectId: PROJECT_ID });
  const system = projectSystemPrompt(summary);
  const tools = toAiTools(
    ctx,
    PROJECT_TOOLS.filter((t) => TOOL_NAMES.includes(t.name)),
    { projectId: PROJECT_ID },
  );
  await write("configuration.json", {
    timestamp: new Date().toISOString(),
    database: process.env.DATABASE_URL?.replace(/\/\/[^@]*@/, "//***@"),
    gateway: process.env.OPENAI_BASE_URL,
    ...modelInfo(),
    embeddingModel: embeddingModelId(),
    maxSteps: assistantConfig().maxSteps,
    toolNames: TOOL_NAMES,
    systemPrompt: system,
    scope:
      "Direct tool-calling evaluation through the production registry, services and Project system prompt; not the HTTP chat route or browser UI.",
  });

  const results: unknown[] = [];
  for (const p of PROMPTS) {
    const started = Date.now();
    try {
      const res = await generateText({
        model,
        system,
        tools,
        stopWhen: stepCountIs(assistantConfig().maxSteps),
        messages: [{ role: "user", content: p.prompt }],
      });
      results.push({
        ...p,
        ms: Date.now() - started,
        answer: res.text,
        finishReason: res.finishReason,
        usage: res.usage,
        steps: res.steps.map((s) => ({
          text: s.text,
          calls: s.toolCalls.map((c) => ({ tool: c.toolName, input: c.input })),
          results: s.toolResults.map((r) => ({ tool: r.toolName, output: r.output })),
        })),
      });
      console.log(`[gen] ${p.id} ok ${Date.now() - started}ms steps=${res.steps.length}`);
    } catch (e) {
      results.push({ ...p, ms: Date.now() - started, error: String(e) });
      console.log(`[gen] ${p.id} FAILED ${String(e)}`);
    }
    await write(RESULTS_NAME, results);
  }
  console.log(`\nWrote ${OUT}`);
  await db.$client.end();
}

await main();
