# Production optimization measurements - 28 September 2026

Each number below comes from a run in this directory or from the usage captured during the [bake-off](../model-bakeoff-2026-09-28/README.md).
Token, latency and cost figures are the gateway's own, read off each HTTP response by `evals/usage.ts`.

## 1. One batched pass instead of one call per source

The Proposal pass sends every unread Evidence item and Comment of a Project in a single `generateObject` call. The alternative shape - one call per source - was run over the same 9 sources for comparison.

| Shape                                  | Model calls | Prompt tokens | Wall clock | Cost     |
| -------------------------------------- | ----------- | ------------- | ---------- | -------- |
| Production: one call for all 9 sources | 1           | 2,485         | 5,981 ms   | $0.00432 |
| One call per source                    | 9           | 5,726         | 14,024 ms  | $0.00605 |
| Second pass, nothing changed           | 0           | 0             | 11 ms      | $0.00000 |

Batching removes **57% of the prompt tokens**, **57% of the wall clock** and **29% of the cost**. The saving is the system prompt and the People, Milestone and Task context, which the per-source shape pays for nine times.

It is not free: the batched call returned 5 Proposals where the per-source calls returned 6 in total, so one Decision was lost to the longer context. That trade is recorded rather than hidden.

## 2. The second pass costs nothing

`proposal_pass_sources` stores a SHA-1 of each source's text after a pass. Running the pass again with nothing changed returns `skipped: "nothing_new"` in **11 ms with no model call**, against 5,981 ms and $0.00432 for the first. Every Evidence save and Comment create schedules a pass through `after()`, so without this the cost of the feature would scale with saves rather than with new text.

## 3. Prompt caching is what decides the bill

The Project system prompt is ~19,000 characters and is re-sent on every step of every turn. Measured over the 20 answer cases of the bake-off:

| Model                        | Prompt tokens | Served from cache | Cost for 20 answers |
| ---------------------------- | ------------- | ----------------- | ------------------- |
| `openai/gpt-4o-mini`         | 367,972       | 95.3%             | $0.0311             |
| `google/gemini-2.5-flash`    | 471,152       | 71.4%             | $0.0620             |
| `anthropic/claude-haiku-4.5` | 462,950       | 0%                | $0.4916             |

Two consequences. First, trimming the system prompt is the wrong optimization to reach for: 95% of it is already being served from cache at a discount for the OpenAI models. Second, a model whose cache the SDK does not engage costs an order of magnitude more for the same work - Haiku's bill is not explained by its price list alone.

The prompt is built so that the stable part (rules) precedes the volatile part (the Project summary JSON), which is what lets a prefix cache hit at all. That was already true; it is now measured.

## 4. The step cap is not the binding constraint

| Model                        | Median steps | Max steps | `ASSISTANT_MAX_STEPS` |
| ---------------------------- | ------------ | --------- | --------------------- |
| `openai/gpt-4o-mini`         | 2            | 3         | 8                     |
| `google/gemini-2.5-flash`    | 2            | 3         | 8                     |
| `anthropic/claude-haiku-4.5` | 2            | 3         | 8                     |

No answer case used more than 3 of the 8 permitted steps, so lowering the cap would not reduce cost on this workload. The cap remains as a bound on pathological loops, not as a cost control, and no run was spent tuning it.

## 5. The free extractor is half as good

`PROPOSALS_EXTRACTOR=heuristic` selects a deterministic sentence matcher that costs nothing and runs in microseconds. On the same 22 extraction cases:

| Extractor                 | Extraction | Median latency | Cost for 22 cases |
| ------------------------- | ---------- | -------------- | ----------------- |
| `heuristic` (no model)    | 12/22      | 0 ms           | $0.0000           |
| `openai/gpt-4o-mini`      | 20/22      | 2,728 ms       | $0.0043           |
| `google/gemini-2.5-flash` | 21/22      | 1,556 ms       | $0.0128           |

The heuristic keeps the feature alive without a key and keeps the e2e suite deterministic, and it is the reason the model extractor is optional rather than required. It is not a substitute: it finds roughly half the Decisions, has no notion of alternatives or Assumptions, and cites whole sentences.

## 6. Embeddings are computed once per text, per embedder

Each chunk row stores the `provider:model` identity that produced it, so a text is embedded once and re-embedded only when the text or the embedder changes. The bake-off embedded 6 Evidence items once, and the six later runs used `--skip-index` and paid nothing for retrieval setup. A previous run ([../rag-check-openrouter-2026-09-28](../rag-check-openrouter-2026-09-28/README.md)) verified the stale-detection path by switching embedder and watching all vectors re-compute.

## Files

- [pass-experiment-google-gemini-2-5-flash.json](pass-experiment-google-gemini-2-5-flash.json): the batched call, the repeat, and the nine per-source calls with usage each.
- [heuristic/](heuristic): the heuristic extractor over all 22 cases.
- [configuration.json](configuration.json): models, gateway, prompt size, with credentials masked.

## Reproducing

```bash
# Batching and idempotency. Clear the pass bookkeeping first, or the pass reports nothing_new.
docker exec cs3216-assignment-3-db-1 psql -U pm -d pm_eval_20260928 \
  -c "DELETE FROM proposal_pass_sources; DELETE FROM decision_proposals;"

PROPOSALS_EXTRACTOR=model DATABASE_URL=postgres://pm:pm@localhost:5433/pm_eval_20260928 \
OPENAI_API_KEY=<openrouter-key> OPENAI_BASE_URL=https://openrouter.ai/api/v1 AI_PROVIDER=openai \
npx tsx scripts/eval.mts --out artifacts/optimization-2026-09-28 --suite pass --skip-index \
  --models google/gemini-2.5-flash

# The free arm needs no key.
DATABASE_URL=postgres://pm:pm@localhost:5433/pm_eval_20260928 \
npx tsx scripts/eval.mts --out artifacts/optimization-2026-09-28/heuristic --suite extraction \
  --skip-index --extractor heuristic --models heuristic
```
