# Current-main cost measurement - 30 September 2026

Commit: `main` at `dc88f23` (the deployed code, `34be9db`, plus documentation only).
Model: `gpt-4o-mini` through OpenAI directly, the deployment's configured default (`AI_MODEL=gpt-4o-mini`).
Embeddings: `text-embedding-3-small`.
Fixture: `evals/fixture.ts` (Harbour Ledger Migration, 6 Evidence items and 3 Comments, 9 sources), re-seeded before each run into the local eval database, so the first pass reads every source.

OpenAI does not return a price, so every cost below is computed from the token counts in each response at OpenAI's list price for `gpt-4o-mini`: US$0.15 per million uncached prompt tokens, US$0.075 per million cached prompt tokens, US$0.60 per million completion tokens; `text-embedding-3-small` US$0.02 per million tokens.
Token counts are measured; prices are the published list.

## Proposal pass: both calls, one representative batch of 9 sources

Since #114 a pass makes two independent calls in parallel.
Each call was attributed by the system prompt it carried (a one-off probe that logged the first words of each request), in three runs: the harness run in [pass-experiment-gpt-4o-mini.json](pass-experiment-gpt-4o-mini.json) and two probe runs.

| Call                          | Prompt tokens | Completion tokens | Cost, each run               | Mean cost    |
| ----------------------------- | ------------- | ----------------- | ---------------------------- | ------------ |
| Decision extraction           | 2,428 - 2,438 | 348 - 364         | $0.00058, $0.00058, $0.00057 | **$0.00058** |
| Task and Milestone extraction | 2,405 - 2,415 | 193 - 220         | $0.00049, $0.00049, $0.00048 | **$0.00049** |
| **Both, one pass**            | 4,813 - 4,853 | 541 - 584         | $0.00107, $0.00107, $0.00105 | **$0.00106** |

- Wall clock for the whole pass: 5,302, 4,649 and 3,957 ms. The two calls overlap, so the pass takes about as long as the slower call, not the sum.
- Outcome, identical in all three runs: 2 Decision Proposals, 1 Task Proposal, 1 item discarded by `traceItems`.
- The item call adds **84% to the cost** of the Decision call alone on this batch, not 100%: its prompt is slightly smaller (no Conversation) and it writes fewer tokens.

## Unchanged sources repeated

| Run                         | Model calls | Wall clock       | Cost |
| --------------------------- | ----------- | ---------------- | ---- |
| Second pass, nothing edited | 0           | 10, 22 and 17 ms | $0   |

Both sides report `skipped: "nothing_new"`; each keeps its own content-hash rows (ADR 0015).

## One source at a time (Decision call only)

The harness also bills the same 9 sources one call each through the Decision extractor: 9 calls, 7,388 prompt and 986 completion tokens, 23,634 ms, **$0.0017**, about **$0.00019 per single-source Decision call**.
A typical save adds one source, so a single-save pass (both calls) is about **$0.0004** by the same 84% ratio. That per-save figure is derived, not measured directly.

## Assistant turn

The 20-case answer suite ([../cost-2026-09-30-answers](../cost-2026-09-30-answers/why-gpt-4o-mini.json)), through the production tool loop and Project system prompt (19,146 characters).

| Measure                     | Value                                              |
| --------------------------- | -------------------------------------------------- |
| Mean cost per turn          | **$0.00254**                                       |
| Median cost per turn        | $0.00241                                           |
| Most expensive turn         | $0.00465                                           |
| Mean prompt tokens per turn | 18,878                                             |
| Mean completion tokens      | 207                                                |
| Model calls per turn        | 2.25 (tool steps)                                  |
| Prompt tokens from cache    | 29.4%                                              |
| Median whole-turn latency   | 4,595 ms                                           |
| Cases passed                | 13/20 (unchanged from 28 September for this model) |

The cache rate is the notable difference from 28 September, when the same model through OpenRouter served 95.3% of prompt tokens from cache.
OpenAI caches a prompt prefix only between requests that arrive close together on the same backend; the suite's cases are separate Conversations run back to back, so mostly the second step of a turn hits.
In the app, consecutive turns of one Conversation re-send the same prefix and would likely cache better, but that was not measured here, so the table uses the measured rate.

## Embeddings

Indexing the fixture's 6 Evidence items took 6 calls and 1,555 tokens in total, **$0.00003**, about $0.000005 per item.
Query embeddings during the answer suite were 1 or 2 tokens each and cost nothing measurable.
Vectors are stored with their embedder identity, so a text is embedded once.

## Commands

```bash
export DATABASE_URL=postgres://pm:pm@localhost:5433/pm_eval_20260928 PROPOSALS_EXTRACTOR=model
npm run db:migrate                     # the eval database was behind current migrations
npx tsx evals/fixture.ts
npx tsx scripts/eval.mts --suite pass --models gpt-4o-mini --temperature 0 --out artifacts/cost-2026-09-30
npx tsx evals/fixture.ts
EVAL_DEBUG_USAGE=1 npx tsx scripts/eval.mts --suite why --models gpt-4o-mini --out artifacts/cost-2026-09-30-answers
```

`PROPOSALS_EXTRACTOR=model` overrides a local `.env` that forces the heuristic extractor; without it the pass costs nothing because it runs no model.
The harness now keeps each model call of a pass (`calls`), not only the totals, so the two calls can be priced apart.

## Limits

- One fixture Project; a real Project's sources are longer or shorter, and cost scales with source tokens.
- `gemini-2.5-flash`, the model M9 recommends, was not re-measured: no OpenRouter key was available. Its Decision-only pass cost $0.00432 on 28 September; the item call has not been priced on it.
- Costs are list-price computations from measured tokens, not a billing statement.
