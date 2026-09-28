/**
 * Evaluation harness for the Assistant's two model-backed behaviours: Proposal extraction and
 * "why did we" answering. Not part of the app.
 *
 * It drives the production extractor prompt (`modelExtract`), the production traceability filter
 * (`traceProposals`), the production tool registry with Project scope binding, the production
 * Project system prompt and the production `getModelForUser`, against the isolated database seeded
 * by `evals/fixture.ts`. Grading is deterministic (`evals/grade.ts`); citations are judged by the
 * same `internalHref` the dock renders with.
 *
 * Credentials come from the environment only; nothing secret is written to the artifacts.
 *
 * Usage:
 *   DATABASE_URL=... OPENAI_API_KEY=... OPENAI_BASE_URL=https://openrouter.ai/api/v1 \
 *   npx tsx scripts/eval.mts --out artifacts/<dir> --models openai/gpt-4o-mini,google/gemini-2.5-flash
 *
 * Flags: --suite extraction|why|both  --models a,b  --out dir  --max-steps n  --temperature n|default
 *        --skip-index  --label text  --results-name prefix
 * Without --temperature, extraction samples at production's EXTRACT_TEMPERATURE and the answer
 * loop at the provider default, as they ship; `--temperature default` leaves both unset.
 */
import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { generateText, stepCountIs } from "ai";
import type { Ctx } from "@/server/core/context";
import { db } from "@/server/db/client";
import { toAiTools } from "@/server/modules/assistant/ai-tools";
import { assistantConfig, getModel } from "@/server/modules/assistant/model";
import { projectSystemPrompt } from "@/server/modules/assistant/prompt";
import { PROJECT_TOOLS, findTool } from "@/server/modules/assistant/tools";
import { decisionsService } from "@/server/modules/decisions/service";
import { commentsRepo } from "@/server/modules/comments/repository";
import { evidenceRepo } from "@/server/modules/evidence/repository";
import { evidenceText } from "@/server/modules/evidence/service";
import { proposalsService } from "@/server/modules/proposals/service";
import { milestonesRepo } from "@/server/modules/milestones/repository";
import {
  EXTRACT_TEMPERATURE,
  heuristicExtract,
  modelExtract,
  type ExtractSource,
} from "@/server/modules/proposals/extract";
import { risksRepo } from "@/server/modules/risks/repository";
import { embeddingModelId } from "@/server/modules/search/embed";
import { searchService } from "@/server/modules/search/service";
import { tasksRepo } from "@/server/modules/tasks/repository";
import { traceProposals, type TracedProposal } from "@/server/modules/proposals/trace";
import {
  citations,
  gradeExtraction,
  gradeWhy,
  passed,
  type Check,
  type EntityIds,
  type ExtractionExpectation,
  type WhyExpectation,
} from "../evals/grade";
import { installUsageProbe, loadPricing, totals, type Call } from "../evals/usage";

const arg = (name: string, fallback?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? (process.argv[i + 1] ?? fallback) : fallback;
};
const flag = (name: string) => process.argv.includes(`--${name}`);

const OUT = arg("out", "artifacts/eval-local")!;
const SUITE = arg("suite", "both")!;
const MODELS = arg("models", "openai/gpt-4o-mini")!
  .split(",")
  .map((m) => m.trim());
const MAX_STEPS = Number(arg("max-steps", String(assistantConfig().maxSteps)));
/** undefined: as production ships; null: provider default for both suites; a number: that, for both. */
const TEMPERATURE: number | null | undefined =
  arg("temperature") === undefined ? undefined : arg("temperature") === "default" ? null : Number(arg("temperature"));
/** Per-suite, per-model progress file; `--results-name` only prefixes it, so no run overwrites another. */
const resultsFile = (suite: string, model: string) =>
  `${arg("results-name") ? `${arg("results-name")}-` : ""}${suite}-${slug(model)}.json`;
const TOOL_NAMES = ["get_project_summary", "list_evidence", "search_evidence", "read_evidence", "search_decisions"];
/** Comma-separated case ids, for debugging the harness without paying for the whole suite. */
const ONLY = arg("only")
  ?.split(",")
  .map((s) => s.trim());
const selected = <T extends { id: string }>(cases: T[]) => (ONLY ? cases.filter((c) => ONLY.includes(c.id)) : cases);

const write = (name: string, value: unknown) =>
  writeFile(join(OUT, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");
const slug = (model: string) => model.replace(/[^a-z0-9]+/gi, "-");
const readJson = async <T,>(path: string) => JSON.parse(await readFile(path, "utf8")) as T;

interface Fixture {
  userId: string;
  projectId: string;
  evidence: Record<string, string>;
  decisions: Record<string, { id: string; number: number }>;
}

interface ExtractionCase {
  id: string;
  tags: string[];
  sources: Array<Omit<ExtractSource, "text"> & { text: string }>;
  refs?: { people: string[]; milestones: string[]; tasks: string[] };
  expect: ExtractionExpectation;
}

interface WhyCase {
  id: string;
  tags: string[];
  prompt: string;
  expect: WhyExpectation;
}

/** Synthetic ids for the names a case declares, so `traceAssumption` can resolve a target by name. */
const refsOf = (names: { people: string[]; milestones: string[]; tasks: string[] }) => ({
  people: names.people.map((name, i) => ({ id: `person-${i}`, name })),
  milestones: names.milestones.map((name, i) => ({ id: `milestone-${i}`, name })),
  tasks: names.tasks.map((title, i) => ({ id: `task-${i}`, title })),
});

async function entityIds(ctx: Ctx, fixture: Fixture): Promise<EntityIds> {
  const [evidence, tasks, milestones, risks, decisions] = await Promise.all([
    evidenceRepo.listByProject(ctx.db, fixture.projectId),
    tasksRepo.listByProject(ctx.db, fixture.projectId),
    milestonesRepo.listByProject(ctx.db, fixture.projectId),
    risksRepo.listByProject(ctx.db, fixture.projectId),
    decisionsService.list(ctx, fixture.projectId),
  ]);
  const all = new Set<string>([
    ...evidence.map((e) => e.id),
    ...tasks.map((t) => t.task.id),
    ...milestones.map((m) => m.milestone.id),
    ...risks.map((r) => r.risk.id),
    ...decisions.map((d) => d.decision.id),
    ...decisions.flatMap((d) => d.assumptions.map((a) => a.id)),
  ]);
  return {
    all,
    decisions: new Map(Object.entries(fixture.decisions)),
    evidence: new Map(Object.entries(fixture.evidence)),
  };
}

async function runExtraction(ctx: Ctx, model: string, take: () => Call[]) {
  const file = await readJson<{ refs: ExtractionCase["refs"]; cases: ExtractionCase[] }>("evals/cases/extraction.json");
  const results = [];
  for (const c of selected(file.cases)) {
    const refs = refsOf(c.refs ?? file.refs!);
    const sources: ExtractSource[] = c.sources;
    const started = Date.now();
    take();
    try {
      const extract =
        arg("extractor") === "heuristic" ? heuristicExtract : modelExtract(ctx, { temperature: TEMPERATURE });
      const raw = await extract({
        sources,
        context: {
          people: refs.people.map((p) => p.name),
          milestones: refs.milestones.map((m) => m.name),
          tasks: refs.tasks.map((t) => t.title),
          conversation: "",
        },
      });
      const { kept, discarded } = traceProposals(raw.proposals, sources, refs);
      const graded = gradeExtraction(c.expect, kept as TracedProposal[], raw.proposals.length);
      const calls = take();
      results.push({
        model,
        id: c.id,
        tags: c.tags,
        ms: Date.now() - started,
        usage: totals(calls),
        pass: passed(graded.checks),
        checks: graded.checks,
        matched: graded.matched,
        missed: graded.missed,
        rawCount: raw.proposals.length,
        discarded,
        kept: kept.map((k) => ({
          title: k.title,
          chosen: k.chosen,
          context: k.context,
          alternatives: k.alternatives,
          revisitWhen: k.revisitWhen,
          decidedOn: k.decidedOn,
          sources: k.sources,
          assumptions: k.assumptions,
        })),
      });
    } catch (e) {
      results.push({
        model,
        id: c.id,
        tags: c.tags,
        ms: Date.now() - started,
        usage: totals(take()),
        pass: false,
        checks: [{ name: "call_succeeded", pass: false, detail: String(e) } satisfies Check],
      });
    }
    const last = results[results.length - 1]!;
    console.log(`[extract:${model}] ${c.id} ${last.pass ? "pass" : "FAIL"} ${last.ms}ms`);
    await write(resultsFile("extraction", model), results);
  }
  return results;
}

async function runWhy(ctx: Ctx, fixture: Fixture, model: string, ids: EntityIds, take: () => Call[]) {
  const file = await readJson<{ cases: WhyCase[] }>("evals/cases/why.json");
  const summary = await findTool("get_project_summary").handler(ctx, { projectId: fixture.projectId });
  const system = projectSystemPrompt(summary);
  const tools = toAiTools(
    ctx,
    PROJECT_TOOLS.filter((t) => TOOL_NAMES.includes(t.name)),
    { projectId: fixture.projectId },
  );
  const results = [];
  for (const c of selected(file.cases)) {
    const started = Date.now();
    take();
    try {
      const res = await generateText({
        model: getModel()!,
        system,
        tools,
        temperature: TEMPERATURE ?? undefined,
        stopWhen: stepCountIs(MAX_STEPS),
        messages: [{ role: "user", content: c.prompt }],
      });
      const toolsCalled = res.steps.flatMap((s) => s.toolCalls.map((t) => t.toolName));
      const cited = citations(res.text, ids);
      const graded = gradeWhy(c.expect, res.text, toolsCalled, cited, ids);
      results.push({
        model,
        id: c.id,
        tags: c.tags,
        prompt: c.prompt,
        ms: Date.now() - started,
        usage: totals(take()),
        steps: res.steps.length,
        toolsCalled,
        pass: passed(graded.checks),
        checks: graded.checks,
        abstainStrict: graded.abstainStrict,
        abstainSoft: graded.abstainSoft,
        citations: cited,
        answer: res.text,
        finishReason: res.finishReason,
      });
    } catch (e) {
      results.push({
        model,
        id: c.id,
        tags: c.tags,
        prompt: c.prompt,
        ms: Date.now() - started,
        usage: totals(take()),
        pass: false,
        checks: [{ name: "call_succeeded", pass: false, detail: String(e) } satisfies Check],
      });
    }
    const last = results[results.length - 1]!;
    console.log(`[why:${model}] ${c.id} ${last.pass ? "pass" : "FAIL"} ${last.ms}ms`);
    await write(resultsFile("why", model), results);
  }
  return results;
}

/**
 * Batching and idempotency measurement for M12. The production pass sends every unread Evidence
 * and Comment of a Project in one model call; this records that call, then repeats it to show the
 * `proposal_pass_sources` hash bookkeeping making the second pass free, then bills the same
 * material one source at a time for the comparison.
 */
async function runPassExperiment(ctx: Ctx, fixture: Fixture, model: string, take: () => Call[]) {
  const timed = async <T,>(run: () => Promise<T>) => {
    take();
    const started = Date.now();
    const value = await run();
    return { value, ms: Date.now() - started, usage: totals(take()) };
  };

  const first = await timed(() => proposalsService.runPass(ctx, fixture.projectId, { trigger: "manual" }));
  const second = await timed(() => proposalsService.runPass(ctx, fixture.projectId, { trigger: "manual" }));

  const [evidence, comments] = await Promise.all([
    evidenceRepo.listByProject(ctx.db, fixture.projectId),
    commentsRepo.listByProject(ctx.db, fixture.projectId),
  ]);
  const sources: ExtractSource[] = [
    ...evidence.map((e) => ({
      kind: "evidence" as const,
      entityId: e.id,
      title: e.title,
      evidenceKind: e.kind,
      text: evidenceText(e),
    })),
    ...comments.map((c) => ({ kind: "comment" as const, entityId: c.id, title: "Comment", text: c.body })),
  ].filter((s) => s.text.trim().length > 0);
  const context = { people: [], milestones: [], tasks: [], conversation: "" };
  const extract = modelExtract(ctx, { temperature: TEMPERATURE });
  const perSource = [];
  for (const source of sources) {
    const run = await timed(() => extract({ sources: [source], context }));
    perSource.push({ title: source.title, ms: run.ms, usage: run.usage, proposals: run.value.proposals.length });
  }

  const result = {
    model,
    sources: sources.length,
    batched: { ms: first.ms, usage: first.usage, outcome: first.value },
    batchedRepeat: { ms: second.ms, usage: second.usage, outcome: second.value },
    perSource,
    perSourceTotals: {
      ms: perSource.reduce((a, r) => a + r.ms, 0),
      promptTokens: perSource.reduce((a, r) => a + r.usage.promptTokens, 0),
      completionTokens: perSource.reduce((a, r) => a + r.usage.completionTokens, 0),
      costUsd: perSource.reduce((a, r) => a + r.usage.costUsd, 0),
    },
  };
  console.log(
    `[pass:${model}] batched ${first.ms}ms $${first.usage.costUsd.toFixed(5)} vs per-source ${result.perSourceTotals.ms}ms $${result.perSourceTotals.costUsd.toFixed(5)}`,
  );
  await write(`pass-experiment-${slug(model)}.json`, result);
  return result;
}

const rate = (rows: Array<{ pass: boolean }>) => (rows.length ? rows.filter((r) => r.pass).length / rows.length : 0);

async function main() {
  await mkdir(OUT, { recursive: true });
  const fixture = await readJson<Fixture>("evals/fixture.local.json");
  const ctx: Ctx = { db, userId: fixture.userId, via: "assistant" };
  const baseUrl = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
  const pricing = await loadPricing(baseUrl);
  const probe = installUsageProbe(pricing);

  if (!flag("skip-index")) {
    const rows = await evidenceRepo.listByProject(db, fixture.projectId);
    for (const row of rows) await searchService.syncEvidence(row);
    console.log(`[index] embedded ${rows.length} Evidence items with ${embeddingModelId()}`);
    probe.take();
  }

  const ids = await entityIds(ctx, fixture);
  const summary: Record<string, unknown> = {};
  const runs: Record<string, unknown> = {};

  for (const model of MODELS) {
    process.env.AI_MODEL = model;
    if (SUITE === "pass") {
      runs[model] = { pass: await runPassExperiment(ctx, fixture, model, probe.take) };
      continue;
    }
    const extraction = SUITE === "why" ? [] : await runExtraction(ctx, model, probe.take);
    const why = SUITE === "extraction" ? [] : await runWhy(ctx, fixture, model, ids, probe.take);
    runs[model] = { extraction, why };
    const all = [...extraction, ...why];
    summary[model] = {
      extraction: {
        cases: extraction.length,
        passRate: rate(extraction),
        medianMs: median(extraction.map((r) => r.ms)),
        usd: extraction.reduce((a, r) => a + (r.usage?.costUsd ?? 0), 0),
      },
      why: {
        cases: why.length,
        passRate: rate(why),
        medianMs: median(why.map((r) => r.ms)),
        usd: why.reduce((a, r) => a + (r.usage?.costUsd ?? 0), 0),
      },
      overallPassRate: rate(all),
      totalUsd: all.reduce((a, r) => a + (r.usage?.costUsd ?? 0), 0),
    };
    console.log(`\n== ${model}: ${JSON.stringify(summary[model])}\n`);
  }

  await write("configuration.json", {
    timestamp: new Date().toISOString(),
    label: arg("label", "") || undefined,
    database: process.env.DATABASE_URL?.replace(/\/\/[^@]*@/, "//***@"),
    gateway: baseUrl,
    models: MODELS,
    temperature: {
      extraction: TEMPERATURE === undefined ? EXTRACT_TEMPERATURE : (TEMPERATURE ?? "provider default"),
      answers: TEMPERATURE ?? "provider default",
    },
    maxSteps: MAX_STEPS,
    embeddingModel: embeddingModelId(),
    toolNames: TOOL_NAMES,
    suite: SUITE,
    projectId: fixture.projectId,
    systemPromptChars: projectSystemPrompt(
      await findTool("get_project_summary").handler(ctx, { projectId: fixture.projectId }),
    ).length,
    scope:
      "Production extractor prompt, traceability filter, tool registry with Project scope binding and Project system prompt, driven directly; not the HTTP chat route or the browser.",
  });
  await write("results.json", runs);
  await write("summary.json", summary);
  probe.restore();
  console.log(`Wrote ${OUT}`);
  await db.$client.end();
}

function median(values: number[]) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
}

await main();
