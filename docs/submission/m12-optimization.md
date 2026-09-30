# M12 - Production optimization

Every number here is measured, not estimated: token counts, latency and cost are read off each gateway response by `evals/usage.ts`, and the runs are in [artifacts/optimization-2026-09-28](../../artifacts/optimization-2026-09-28/README.md).
The workload is the 42-case suite from [M11](m11-evals.md) and the 9-source Proposal pass of the fixture Project.

## 1. Batch the whole Proposal pass into one model call

The pass sends every unread Evidence item and Comment of a Project in a single `generateObject` call, rather than one call per source.

| Shape                              | Model calls | Prompt tokens | Wall clock | Cost     |
| ---------------------------------- | ----------- | ------------- | ---------- | -------- |
| Production: one call for 9 sources | 1           | 2,485         | 5,981 ms   | $0.00432 |
| One call per source                | 9           | 5,726         | 14,024 ms  | $0.00605 |

**57% fewer prompt tokens, 57% less wall clock, 29% less cost.**
The saving is the system prompt plus the People, Milestone and Task context, which the per-source shape pays for nine times.

The trade is real and was measured too: the batched call returned 5 Proposals where the nine separate calls returned 6, so one Decision was lost in the longer context.
At this Project size the latency win matters more, because the pass runs inside `after()` on someone's save.

Since #114 the pass makes a second call for Tasks and Milestones.
That is a deliberate cost increase, traded for keeping the measured Decision prompt untouched (ADR 0015).
It was kept small: the item prompt leaves out the recent Conversation, and over the 12 item cases it used about 8,600 prompt and 960 completion tokens in total, roughly US$0.002 at `gpt-4o-mini` list price ([M11 addendum](m11-item-evals.md)).
Each side keeps its own content-hash bookkeeping, so the second call also costs nothing on a repeat pass.

## 2. Idempotency by content hash: the second pass is free

Every Evidence save and Comment create schedules a pass.
`proposal_pass_sources` stores a SHA-1 of each source's text, so a pass only reads what changed.

| Pass                    | Model calls | Wall clock | Cost     |
| ----------------------- | ----------- | ---------- | -------- |
| First                   | 1           | 5,981 ms   | $0.00432 |
| Second, nothing changed | 0           | 11 ms      | $0.00000 |

Without this, cost would scale with saves instead of with new text: a PM editing one Evidence item five times would pay five full passes over the whole Project.
Proposal fingerprints (source kind, source id, normalised excerpt) do the same job one level down, so the same passage is never proposed twice.

## 3. Prompt caching, and the trim we did not do

The Project system prompt is ~19,000 characters and is re-sent on every step of every turn, so the obvious optimization is to shrink it.
Measuring first showed that would be close to pointless for two of three models, and the wrong fix for the third.

| Model                        | Prompt tokens over 20 answers | Served from cache | Cost    |
| ---------------------------- | ----------------------------- | ----------------- | ------- |
| `openai/gpt-4o-mini`         | 367,972                       | 95.3%             | $0.0311 |
| `google/gemini-2.5-flash`    | 471,152                       | 71.4%             | $0.0620 |
| `anthropic/claude-haiku-4.5` | 462,950                       | 0%                | $0.4916 |

95% of the prompt is already billed at the cache rate for `gpt-4o-mini`; trimming it would save a discounted fraction of a cent while costing the model context it uses to reference items by id.
Haiku's bill is 8x Gemini's for the same work, and the reason is the 0% cache hit rather than its list price.

What makes caching work is prompt order: `projectSystemPrompt` puts the stable rules first and the volatile Project summary JSON last, so a prefix cache can hit across turns.
That ordering was already in place; this run is what verified it is doing something.

**Decision: no prompt trim, and model choice is the cache decision.** The largest single-line cost lever measured in this project is which model the deployment points at.

## 4. Streaming, so latency is perceived rather than waited out

The chat route uses `streamText` and the dock uses `useChat`, so text and tool status appear while the loop is still running.
Median answer latency in the harness is 2,540 ms for `gemini-2.5-flash` and 4,950 ms for `claude-haiku-4.5`.
Those are whole-turn numbers: the harness calls `generateText`, so it waits for the full loop, and it therefore does not measure time to first token.
What the app changes is when the User sees something - text and tool status stream as the loop runs - and that improvement is not quantified here, because the harness does not drive the HTTP route.
Reflection is moved off the response path entirely with `after()`, and a Reflection failure never delays or replaces an answer that was already delivered.

## 5. The step cap is a safety bound, not a cost lever

| Model                        | Median steps | Max steps | `ASSISTANT_MAX_STEPS` |
| ---------------------------- | ------------ | --------- | --------------------- |
| `openai/gpt-4o-mini`         | 2            | 3         | 8                     |
| `google/gemini-2.5-flash`    | 2            | 3         | 8                     |
| `anthropic/claude-haiku-4.5` | 2            | 3         | 8                     |

No case used more than 3 of the 8 permitted steps, so lowering the cap saves nothing on this workload.
It stays as protection against a loop, and no budget was spent tuning a number that is not binding.
The `ASSISTANT_DAILY_TURN_CAP` of 50 turns is the actual spend bound: at the measured $0.0018 per answer turn, one User costs at most about $0.09 a day.

## 6. A zero-cost fallback that is honestly half as good

`PROPOSALS_EXTRACTOR=heuristic` selects a deterministic sentence matcher.

| Extractor                 | Extraction cases passed | Median latency | Cost for 22 cases |
| ------------------------- | ----------------------- | -------------- | ----------------- |
| `heuristic` (no model)    | 12/22                   | 0 ms           | $0.0000           |
| `openai/gpt-4o-mini`      | 20/22                   | 2,728 ms       | $0.0043           |
| `google/gemini-2.5-flash` | 21/22                   | 1,556 ms       | $0.0128           |

This is why the feature is optional rather than required: the app boots and the pass still runs without a key, and the e2e suite stays deterministic.
It finds roughly half the Decisions and has no notion of alternatives or Assumptions, so it is a fallback, not a substitute.

## 7. Embed once per text, per embedder

Each chunk row stores the `provider:model` identity that produced its vector, so a text is embedded once and re-embedded only when the text or the embedder changes.
The bake-off embedded the fixture's 6 Evidence items once; the six later runs passed `--skip-index` and paid nothing for retrieval setup.
LitePruner compression of `prunedText` at ingest shrinks what is embedded and stored in the first place, and the ingest path embeds the pruned text rather than the original.
A previous run ([artifacts/rag-check-openrouter-2026-09-28](../../artifacts/rag-check-openrouter-2026-09-28/README.md)) verified the stale-detection path by switching embedder and watching all 6 vectors re-compute.

One known cost in this area is not yet optimized: `ensureIndexed` re-embeds up to 100 Evidence items inline on the first search after an embedder change, which is a latency spike on a real Project's first search.
Moving it to the event subscriber is open work, recorded in that run's improvement plan.

## 8. Sampling at temperature 0 removed a 3.5x cost outlier

Extraction now runs at `temperature: 0`.
Beyond reproducibility ([M9](m9-model-bakeoff.md)), one provider-default repeat spent 19,743 completion tokens against a ~3,100-token norm and cost $0.0139 instead of $0.0040 - a structured-output retry loop that greedy sampling did not reproduce in either of its repeats.

## Summary of impact

| Technique                        | Where                                          | Measured effect                                                                                                                        |
| -------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Batched pass                     | `proposals/service.ts`                         | -57% tokens, -57% latency, -29% cost per pass                                                                                          |
| Content-hash idempotency         | `proposal_pass_sources`, Proposal fingerprints | Repeat pass: 5,981 ms and $0.0043 becomes 11 ms and $0                                                                                 |
| Stable-prefix prompt order       | `assistant/prompt.ts`                          | 95.3% of prompt tokens served from cache (`gpt-4o-mini`)                                                                               |
| Model choice as cache choice     | deployment config                              | 8x cost difference between two models of similar quality                                                                               |
| Streaming plus `after()`         | chat route, Reflection                         | Whole-turn latency of 2.5-5.0 s is streamed rather than waited out; Reflection off the response path. Time to first token not measured |
| Greedy extraction sampling       | `proposals/extract.ts`                         | Removed a 6x token, 3.5x cost outlier; output reproducible                                                                             |
| Embed once per text and embedder | `search/`                                      | Six later runs paid $0 for retrieval setup                                                                                             |
| Zero-cost fallback               | `PROPOSALS_EXTRACTOR=heuristic`                | Feature works with no key at 12/22 instead of 21/22                                                                                    |
