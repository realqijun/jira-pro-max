## Bake-off, 42 cases per model

| Model                        | Extraction    | Answers      | Median ms (extract / answer) | Prompt cache hit | Total   | Per case |
| ---------------------------- | ------------- | ------------ | ---------------------------- | ---------------- | ------- | -------- |
| `openai/gpt-4o-mini`         | 16/22 (72.7%) | 13/20 (65%)  | 2386 / 3476                  | 95.3%            | $0.0447 | $0.0011  |
| `google/gemini-2.5-flash`    | 21/22 (95.5%) | 19/20 (95%)  | 1524 / 2540                  | 71.4%            | $0.0753 | $0.0018  |
| `anthropic/claude-haiku-4.5` | 20/22 (90.9%) | 20/20 (100%) | 2721 / 4950                  | 0%               | $0.5395 | $0.0128  |

Failed cases per model:

- `openai/gpt-4o-mini`: extraction x02-two-decisions-one-source, x03-status-report-no-decision, x07-prompt-injection, x09-person-assumption, x16-paraphrase-trap, x19-past-decision-restated; answers w03-superseded, w07-why-thirty-days, w10-conflicting-vendor-dates, w14-why-rehearsal-timing, w15-assumptions-of-pilot-date, w19-why-dual-write-rejected, w20-preconditions
- `google/gemini-2.5-flash`: extraction x02-two-decisions-one-source; answers w06-why-two-half-days
- `anthropic/claude-haiku-4.5`: extraction x04-decision-deferred, x07-prompt-injection; answers none

## Extraction prompt iteration

| Model                     | baseline | one-proposal-per-decision | precision-guard | negative-definition | approvals-are-decisions |
| ------------------------- | -------- | ------------------------- | --------------- | ------------------- | ----------------------- |
| `openai/gpt-4o-mini`      | 16/22    | 17/22                     | 18/22           | 19/22               | 20/22                   |
| `google/gemini-2.5-flash` | 21/22    | 20/22                     | 20/22           | 19/22               | 21/22                   |

Cases that changed verdict at any stage:

| Model                     | Case                             | baseline | one-proposal-per-decision | precision-guard | negative-definition | approvals-are-decisions |
| ------------------------- | -------------------------------- | -------- | ------------------------- | --------------- | ------------------- | ----------------------- |
| `openai/gpt-4o-mini`      | x02-two-decisions-one-source     | FAIL     | pass                      | pass            | pass                | pass                    |
| `openai/gpt-4o-mini`      | x03-status-report-no-decision    | FAIL     | FAIL                      | FAIL            | pass                | pass                    |
| `openai/gpt-4o-mini`      | x09-person-assumption            | FAIL     | pass                      | FAIL            | FAIL                | pass                    |
| `openai/gpt-4o-mini`      | x11-plan-export-no-prose         | pass     | FAIL                      | pass            | pass                | pass                    |
| `openai/gpt-4o-mini`      | x17-action-items-only            | pass     | FAIL                      | pass            | pass                | pass                    |
| `openai/gpt-4o-mini`      | x19-past-decision-restated       | FAIL     | pass                      | pass            | pass                | pass                    |
| `google/gemini-2.5-flash` | x02-two-decisions-one-source     | FAIL     | FAIL                      | pass            | FAIL                | pass                    |
| `google/gemini-2.5-flash` | x03-status-report-no-decision    | pass     | FAIL                      | FAIL            | pass                | pass                    |
| `google/gemini-2.5-flash` | x09-person-assumption            | pass     | pass                      | FAIL            | FAIL                | FAIL                    |
| `google/gemini-2.5-flash` | x21-decision-without-alternative | pass     | pass                      | pass            | FAIL                | pass                    |

## Answer cases before and after the abstention-provenance rule

| Model                     | Before | After |
| ------------------------- | ------ | ----- |
| `openai/gpt-4o-mini`      | 13/20  | 13/20 |
| `google/gemini-2.5-flash` | 19/20  | 20/20 |

## Sampling repeatability

| Run                                   | Model                     | Extraction | Completion tokens | Cost    |
| ------------------------------------- | ------------------------- | ---------- | ----------------- | ------- |
| extraction, temperature 0             | `openai/gpt-4o-mini`      | 20/22      | 3230              | $0.0040 |
| extraction, temperature 0             | `google/gemini-2.5-flash` | 20/22      | 4202              | $0.0132 |
| extraction, temperature 0 (repeat)    | `openai/gpt-4o-mini`      | 20/22      | 3372              | $0.0041 |
| extraction, temperature 0 (repeat)    | `google/gemini-2.5-flash` | 20/22      | 4202              | $0.0132 |
| extraction, provider default          | `openai/gpt-4o-mini`      | 20/22      | 3094              | $0.0039 |
| extraction, provider default          | `google/gemini-2.5-flash` | 21/22      | 4401              | $0.0137 |
| extraction, provider default (repeat) | `openai/gpt-4o-mini`      | 17/22      | 19743             | $0.0139 |
| extraction, provider default (repeat) | `google/gemini-2.5-flash` | 21/22      | 4354              | $0.0136 |

## Answer-loop repeatability, `google/gemini-2.5-flash`

| Run                       | Answers | Median ms | Cost    |
| ------------------------- | ------- | --------- | ------- |
| provider default          | 20/20   | 2418      | $0.0516 |
| provider default (repeat) | 18/20   | 2477      | $0.0342 |
| temperature 0             | 18/20   | 2494      | $0.0404 |
| temperature 0 (repeat)    | 18/20   | 2379      | $0.0306 |

Byte-identical answers between the two repeats: 3/20 at provider default, 19/20 at temperature 0.

## One batched pass against one call per source

| Shape                                  | Model calls | Prompt tokens | Wall clock | Cost    |
| -------------------------------------- | ----------- | ------------- | ---------- | ------- |
| Production: one call for all 9 sources | 1           | 2485          | 5981 ms    | $0.0043 |
| One call per source                    | 9           | 5726          | 14024 ms   | $0.0061 |
| Second pass, nothing changed           | 0           | 0             | 11 ms      | $0.0000 |

## Model extractor against the deterministic fallback

| Extractor                 | Extraction | Median latency | Cost for 22 cases |
| ------------------------- | ---------- | -------------- | ----------------- |
| `heuristic` (no model)    | 12/22      | 0 ms           | $0.0000           |
| `openai/gpt-4o-mini`      | 20/22      | 2728 ms        | $0.0043           |
| `google/gemini-2.5-flash` | 21/22      | 1556 ms        | $0.0128           |

## Steps actually used against the step cap

| Model                        | Median steps | Max steps | `ASSISTANT_MAX_STEPS` |
| ---------------------------- | ------------ | --------- | --------------------- |
| `openai/gpt-4o-mini`         | 2            | 3         | 8                     |
| `google/gemini-2.5-flash`    | 2            | 3         | 8                     |
| `anthropic/claude-haiku-4.5` | 2            | 3         | 8                     |
