/**
 * Turns the raw run directories under `artifacts/` into the tables quoted in
 * `docs/submission/m9-model-bakeoff.md`, `m11-evals.md` and `m12-optimization.md`.
 * Pure aggregation over files already written by `scripts/eval.mts`; makes no model calls.
 *
 * Usage: npx tsx evals/report.ts
 */
import { readFile, writeFile } from "node:fs/promises";

interface CaseResult {
  id: string;
  pass: boolean;
  ms: number;
  steps?: number;
  toolsCalled?: string[];
  usage: { calls: number; promptTokens: number; completionTokens: number; cachedTokens: number; costUsd: number };
  checks: Array<{ name: string; pass: boolean; detail?: string }>;
}
type Results = Record<string, { extraction: CaseResult[]; why: CaseResult[] }>;

const read = async <T>(path: string) => JSON.parse(await readFile(path, "utf8")) as T;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
};
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0);
const usd = (n: number) => `$${n.toFixed(4)}`;

function suiteStats(rows: CaseResult[]) {
  const prompt = sum(rows.map((r) => r.usage.promptTokens));
  return {
    cases: rows.length,
    passed: rows.filter((r) => r.pass).length,
    passPct: pct(rows.filter((r) => r.pass).length, rows.length),
    medianMs: median(rows.map((r) => r.ms)),
    promptTokens: prompt,
    completionTokens: sum(rows.map((r) => r.usage.completionTokens)),
    cachedPct: pct(sum(rows.map((r) => r.usage.cachedTokens)), prompt),
    costUsd: sum(rows.map((r) => r.usage.costUsd)),
    medianSteps: median(rows.map((r) => r.steps ?? 0)),
    maxSteps: Math.max(0, ...rows.map((r) => r.steps ?? 0)),
    failures: rows.filter((r) => !r.pass).map((r) => r.id),
  };
}

const table = (header: string[], rows: string[][]) =>
  [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...rows.map((r) => `| ${r.join(" | ")} |`),
  ].join("\n");

async function main() {
  const out: string[] = [];
  const metrics: Record<string, unknown> = {};

  /* ---------------------------------------------------------------- bake-off */
  const bakeoff = await read<Results>("artifacts/model-bakeoff-2026-09-28/results.json");
  const bakeoffRows: string[][] = [];
  const bakeoffMetrics: Record<string, unknown> = {};
  for (const [model, suites] of Object.entries(bakeoff)) {
    const e = suiteStats(suites.extraction);
    const w = suiteStats(suites.why);
    bakeoffMetrics[model] = { extraction: e, why: w };
    bakeoffRows.push([
      `\`${model}\``,
      `${e.passed}/${e.cases} (${e.passPct}%)`,
      `${w.passed}/${w.cases} (${w.passPct}%)`,
      `${e.medianMs} / ${w.medianMs}`,
      `${w.cachedPct}%`,
      usd(e.costUsd + w.costUsd),
      usd((e.costUsd + w.costUsd) / (e.cases + w.cases)),
    ]);
  }
  metrics.bakeoff = bakeoffMetrics;
  out.push("## Bake-off, 42 cases per model\n");
  out.push(
    table(
      ["Model", "Extraction", "Answers", "Median ms (extract / answer)", "Prompt cache hit", "Total", "Per case"],
      bakeoffRows,
    ),
  );
  out.push("\nFailed cases per model:\n");
  for (const [model, suites] of Object.entries(bakeoff)) {
    out.push(
      `- \`${model}\`: extraction ${suiteStats(suites.extraction).failures.join(", ") || "none"}; answers ${
        suiteStats(suites.why).failures.join(", ") || "none"
      }`,
    );
  }

  /* -------------------------------------------------------- prompt iteration */
  const stages: Array<[string, string]> = [
    ["baseline", "artifacts/model-bakeoff-2026-09-28/results.json"],
    ["one-proposal-per-decision", "artifacts/prompt-iteration-2026-09-28/results.json"],
    ["precision-guard", "artifacts/prompt-iteration-2026-09-28/precision-guard/results.json"],
    ["negative-definition", "artifacts/prompt-iteration-2026-09-28/negative-definition/results.json"],
    ["approvals-are-decisions", "artifacts/prompt-iteration-2026-09-28/approvals-are-decisions/results.json"],
  ];
  const loaded: Array<[string, Results]> = [];
  for (const [name, path] of stages) loaded.push([name, await read<Results>(path)]);
  const models = ["openai/gpt-4o-mini", "google/gemini-2.5-flash"];
  const iterationRows = models.map((m) => [
    `\`${m}\``,
    ...loaded.map(([, r]) => {
      const s = suiteStats(r[m]!.extraction);
      return `${s.passed}/${s.cases}`;
    }),
  ]);
  metrics.promptIteration = Object.fromEntries(
    models.map((m) => [m, Object.fromEntries(loaded.map(([name, r]) => [name, suiteStats(r[m]!.extraction)]))]),
  );
  out.push("\n## Extraction prompt iteration\n");
  out.push(table(["Model", ...loaded.map(([n]) => n)], iterationRows));

  const perCase: string[][] = [];
  const ids = loaded[0]![1]["openai/gpt-4o-mini"]!.extraction.map((c) => c.id);
  for (const m of models) {
    for (const id of ids) {
      const row = loaded.map(([, r]) => (r[m]!.extraction.find((c) => c.id === id)!.pass ? "pass" : "FAIL"));
      if (new Set(row).size > 1) perCase.push([`\`${m}\``, id, ...row]);
    }
  }
  out.push("\nCases that changed verdict at any stage:\n");
  out.push(table(["Model", "Case", ...loaded.map(([n]) => n)], perCase));

  const answersBefore = await read<Results>("artifacts/model-bakeoff-2026-09-28/results.json");
  const answersAfter = await read<Results>("artifacts/prompt-iteration-2026-09-28/answers-after/results.json");
  out.push("\n## Answer cases before and after the abstention-provenance rule\n");
  out.push(
    table(
      ["Model", "Before", "After"],
      models.map((m) => {
        const b = suiteStats(answersBefore[m]!.why);
        const a = suiteStats(answersAfter[m]!.why);
        return [`\`${m}\``, `${b.passed}/${b.cases}`, `${a.passed}/${a.cases}`];
      }),
    ),
  );
  metrics.answersBeforeAfter = Object.fromEntries(
    models.map((m) => [m, { before: suiteStats(answersBefore[m]!.why), after: suiteStats(answersAfter[m]!.why) }]),
  );

  /* ------------------------------------------------------------ repeatability */
  const sweeps: Array<[string, string, "extraction" | "why", string[]]> = [
    ["extraction, temperature 0", "artifacts/param-sweep-2026-09-28/t0-a", "extraction", models],
    ["extraction, temperature 0 (repeat)", "artifacts/param-sweep-2026-09-28/t0-b", "extraction", models],
    ["extraction, provider default", "artifacts/param-sweep-2026-09-28/default-a", "extraction", models],
    ["extraction, provider default (repeat)", "artifacts/param-sweep-2026-09-28/default-b", "extraction", models],
  ];
  const sweepRows: string[][] = [];
  for (const [label, dir, suite, ms] of sweeps) {
    const r = await read<Results>(`${dir}/results.json`);
    for (const m of ms) {
      const s = suiteStats(r[m]![suite]);
      sweepRows.push([label, `\`${m}\``, `${s.passed}/${s.cases}`, String(s.completionTokens), usd(s.costUsd)]);
    }
  }
  out.push("\n## Sampling repeatability\n");
  out.push(table(["Run", "Model", "Extraction", "Completion tokens", "Cost"], sweepRows));

  const answerRuns: Array<[string, string]> = [
    ["provider default", "artifacts/prompt-iteration-2026-09-28/answers-after"],
    ["provider default (repeat)", "artifacts/param-sweep-2026-09-28/answers-default-b"],
    ["temperature 0", "artifacts/param-sweep-2026-09-28/answers-t0-a"],
    ["temperature 0 (repeat)", "artifacts/param-sweep-2026-09-28/answers-t0-b"],
  ];
  const answerSets: Array<[string, CaseResult[]]> = [];
  for (const [label, dir] of answerRuns) {
    const r = await read<Results>(`${dir}/results.json`);
    answerSets.push([label, r["google/gemini-2.5-flash"]!.why]);
  }
  const answersOf = async (dir: string) =>
    (await read<Record<string, { why: Array<{ id: string; answer?: string }> }>>(`${dir}/results.json`))[
      "google/gemini-2.5-flash"
    ]!.why;
  const identical = async (a: string, b: string) => {
    const [x, y] = [await answersOf(a), await answersOf(b)];
    return x.filter((r, i) => r.answer === y[i]?.answer).length;
  };
  const defaultIdentical = await identical(answerRuns[0]![1], answerRuns[1]![1]);
  const zeroIdentical = await identical(answerRuns[2]![1], answerRuns[3]![1]);
  out.push("\n## Answer-loop repeatability, `google/gemini-2.5-flash`\n");
  out.push(
    table(
      ["Run", "Answers", "Median ms", "Cost"],
      answerSets.map(([label, rows]) => {
        const s = suiteStats(rows);
        return [label, `${s.passed}/${s.cases}`, String(s.medianMs), usd(s.costUsd)];
      }),
    ),
  );
  out.push(
    `\nByte-identical answers between the two repeats: ${defaultIdentical}/20 at provider default, ${zeroIdentical}/20 at temperature 0.`,
  );
  metrics.answerRepeatability = {
    identicalDefault: defaultIdentical,
    identicalTemperature0: zeroIdentical,
    runs: Object.fromEntries(answerSets.map(([label, rows]) => [label, suiteStats(rows)])),
  };

  /* ----------------------------------------------------------- optimization */
  const pass = await read<{
    sources: number;
    batched: { ms: number; usage: CaseResult["usage"]; outcome: unknown };
    batchedRepeat: { ms: number; usage: CaseResult["usage"]; outcome: unknown };
    perSourceTotals: { ms: number; promptTokens: number; completionTokens: number; costUsd: number };
  }>("artifacts/optimization-2026-09-28/pass-experiment-google-gemini-2-5-flash.json");
  out.push("\n## One batched pass against one call per source\n");
  out.push(
    table(
      ["Shape", "Model calls", "Prompt tokens", "Wall clock", "Cost"],
      [
        [
          "Production: one call for all 9 sources",
          "1",
          String(pass.batched.usage.promptTokens),
          `${pass.batched.ms} ms`,
          usd(pass.batched.usage.costUsd),
        ],
        [
          "One call per source",
          String(pass.sources),
          String(pass.perSourceTotals.promptTokens),
          `${pass.perSourceTotals.ms} ms`,
          usd(pass.perSourceTotals.costUsd),
        ],
        [
          "Second pass, nothing changed",
          "0",
          "0",
          `${pass.batchedRepeat.ms} ms`,
          usd(pass.batchedRepeat.usage.costUsd),
        ],
      ],
    ),
  );

  const heuristic = await read<Results>("artifacts/optimization-2026-09-28/heuristic/results.json");
  const best = await read<Results>("artifacts/prompt-iteration-2026-09-28/approvals-are-decisions/results.json");
  out.push("\n## Model extractor against the deterministic fallback\n");
  const h = suiteStats(heuristic["heuristic"]!.extraction);
  const rows = [
    ["`heuristic` (no model)", `${h.passed}/${h.cases}`, "0 ms", "$0.0000"],
    ...models.map((m) => {
      const s = suiteStats(best[m]!.extraction);
      return [`\`${m}\``, `${s.passed}/${s.cases}`, `${s.medianMs} ms`, usd(s.costUsd)];
    }),
  ];
  out.push(table(["Extractor", "Extraction", "Median latency", "Cost for 22 cases"], rows));
  metrics.optimization = {
    pass,
    heuristic: h,
    best: Object.fromEntries(models.map((m) => [m, suiteStats(best[m]!.extraction)])),
  };

  /* ------------------------------------------------------------- step budget */
  const stepRows = Object.entries(bakeoff).map(([model, suites]) => {
    const s = suiteStats(suites.why);
    return [`\`${model}\``, String(s.medianSteps), String(s.maxSteps), "8"];
  });
  out.push("\n## Steps actually used against the step cap\n");
  out.push(table(["Model", "Median steps", "Max steps", "`ASSISTANT_MAX_STEPS`"], stepRows));

  await writeFile("artifacts/eval-tables-2026-09-28.md", `${out.join("\n")}\n`, "utf8");
  await writeFile("artifacts/eval-metrics-2026-09-28.json", `${JSON.stringify(metrics, null, 2)}\n`, "utf8");
  console.log("Wrote artifacts/eval-tables-2026-09-28.md and artifacts/eval-metrics-2026-09-28.json");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
