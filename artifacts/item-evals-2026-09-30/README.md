# Item extraction baseline - 30 September 2026

The first measurement of the Task and Milestone extractor (`src/server/modules/proposals/extract-items.ts`, #114), on the 12 cases in `evals/cases/items.json` (#116).
In the same runs, the 22 Decision cases were graded again, to check the Decision pass after #114.
The key was supplied through the environment only and is in no file here.

**Outcome: `gpt-4o-mini` keeps 9 of 12 item cases in both runs, with the same three failures.**
**It invents an owner for an unassigned action item, it misses a dated review stated in one line, and it names a checkpoint by its purpose rather than as a data freeze.**
**The deterministic heuristic keeps 6 of 12.**
**The Decision cases score 21/22 and 19/22 against 20/22 and 20/22 on 28 September, and the prompt is byte-identical, so the spread is sampling noise, not a regression.**

The suites and graders are described in [../../docs/submission/m11-item-evals.md](../../docs/submission/m11-item-evals.md).
Consolidated tables are appended to [../eval-tables-2026-09-28.md](../eval-tables-2026-09-28.md).

## What was run

| Directory    | Suites             | Extractor                                   | Label in `configuration.json`                   |
| ------------ | ------------------ | ------------------------------------------- | ----------------------------------------------- |
| `.`          | `extraction,items` | `gpt-4o-mini`, OpenAI direct, temperature 0 | `item baseline; Decision re-run`                |
| `repeat/`    | `extraction,items` | the same, run again straight after          | `item baseline; Decision re-run (repeat)`       |
| `heuristic/` | `items`            | `heuristicExtractItems`, no model           | `item cases, deterministic heuristic extractor` |

Commands, each with `DATABASE_URL=postgres://pm:pm@localhost:5433/pm_eval_20260928` in front and the rest of the environment from `.env` (`AI_PROVIDER=openai`, `AI_MODEL=gpt-4o-mini`, `OPENAI_API_KEY`):

```bash
npx tsx scripts/eval.mts --suite extraction,items --models gpt-4o-mini --skip-index \
  --out artifacts/item-evals-2026-09-30 --label "item baseline; Decision re-run"
npx tsx scripts/eval.mts --suite extraction,items --models gpt-4o-mini --skip-index \
  --out artifacts/item-evals-2026-09-30/repeat --label "item baseline; Decision re-run (repeat)"
npx tsx scripts/eval.mts --suite items --extractor heuristic --models heuristic \
  --out artifacts/item-evals-2026-09-30/heuristic --label "item cases, deterministic heuristic extractor"
npx tsx evals/report.ts
```

## Read before comparing

- The per-check results inside the item files are as the harness wrote them, before the grader fixes in the PR's review commits.
  Those fixes changed the `no_extra_items` check and how expectations pair with items: i04 and i06 in the model runs, and i02, i04, i05, i06 and i08 in the heuristic run, would record a different `no_extra_items` result today.
  Re-grading every stored `kept` array with the current `gradeItems` gives the same pass or fail for all 12 cases in all three runs.
- The 28 September Decision baseline (`../param-sweep-2026-09-28/t0-a`, `t0-b`) ran `openai/gpt-4o-mini` through OpenRouter.
  These runs call the same model through OpenAI directly, which is the only key available on the day.
- OpenAI returns no prices, so `costUsd` is 0 in every file here, and the tables print "unpriced".
  The token counts are real.
- `.env` sets `PROPOSALS_EXTRACTOR=heuristic`.
  It has no effect on these suites, which pick their extractor from `--extractor`, but it would make `--suite pass` run heuristic.
- The eval database was not migrated past `0024` for these runs.
  The extraction and item suites read no table `0025` adds, but `--suite pass` needs the pending migrations first.
