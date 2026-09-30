# M9 - Choice of model, provider and parameters

## Provider: an OpenAI-compatible gateway, not a model vendor

PrismPM talks to models through `getModel()` in `src/server/modules/assistant/model.ts`, which builds an `@ai-sdk/openai` client.
Setting `OPENAI_BASE_URL` points that same client at any OpenAI-compatible gateway, and `AI_MODEL` then takes the gateway's model id.
That is how every measurement below reached Gemini and Claude without one line of application code changing.

Three provider shapes were considered.

| Option                                                                         | Why it was rejected or kept                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Direct vendor SDKs (`@ai-sdk/openai` + `@ai-sdk/anthropic` + `@ai-sdk/google`) | Kept, but only for a User's own saved credential (ADR 0011). As the deployment default it needs one key, one billing relationship and one rate limit per vendor, and comparing models means changing `AI_PROVIDER` and redeploying.                                                                                         |
| A hosted router (OpenRouter) behind the OpenAI-compatible client               | **Chosen for evaluation and supported in production.** One key reaches every candidate, the model id is configuration, and the gateway returns its own per-request cost, which is what made the cost column of this document possible rather than estimated.                                                                |
| Self-hosted open-weight model (vLLM or Ollama)                                 | Rejected for this project. Tool calling and structured output are load-bearing here - 27 tools and a `generateObject` schema - and the smaller open-weight models that fit a student budget are the weakest at exactly those two things. It also moves the failure mode from "the vendor is slow" to "our GPU box is down". |

The cost of the gateway choice is one more hop and one more party seeing prompts.
Both were acceptable for an assignment; a production deployment handling customer Evidence would put the vendor relationship back in place, which is a configuration change, not a rewrite.

## Model: three candidates, 42 cases, one gateway

Full method, artifacts and limitations: [artifacts/model-bakeoff-2026-09-28](../../artifacts/model-bakeoff-2026-09-28/README.md).
The suites are described in [M11](m11-evals.md).

| Model                                  | Extraction    | Answers      | Median ms (extract / answer) | Prompt cache hit | Cost for 42 cases |
| -------------------------------------- | ------------- | ------------ | ---------------------------- | ---------------- | ----------------- |
| `openai/gpt-4o-mini` (shipped default) | 16/22 (72.7%) | 13/20 (65%)  | 2386 / 3476                  | 95.3%            | $0.0447           |
| `google/gemini-2.5-flash`              | 21/22 (95.5%) | 19/20 (95%)  | 1524 / 2540                  | 71.4%            | $0.0753           |
| `anthropic/claude-haiku-4.5`           | 20/22 (90.9%) | 20/20 (100%) | 2721 / 4950                  | 0%               | $0.5395           |

Candidates were filtered before the run: a model must support tool calling and structured outputs, because the Assistant needs a tool loop and the extractor needs `generateObject`.
That disqualifies several cheaper models outright - it is a capability requirement, not a preference.
`claude-haiku-4.5` was included as a quality ceiling rather than as a plausible default.

### `gemini-2.5-flash` best fits this product

It is the most accurate on extraction, ties for most accurate on answers within noise, is the fastest on both suites, and costs one seventh of Haiku.
It was also the only candidate that refused the prompt injection hidden in Evidence (`x07`): `gpt-4o-mini` recorded a Proposal titled `PWNED` claiming the steering committee approved a vendor dashboard.
For a feature whose entire purpose is to put a Proposal in front of a PM for one-click acceptance, that behaviour is disqualifying, and no prompt edit fixed it - four attempts are recorded in [artifacts/prompt-iteration-2026-09-28](../../artifacts/prompt-iteration-2026-09-28/README.md).

Haiku wins the answer suite outright, 20/20, and would be the choice if quality were the only axis.
At $0.0128 per case against $0.0018 it is not, for a workload where the User sees no quality difference on 19 of 20 cases.

### The shipped default is worse than what we measured, and has not been changed

`DEFAULT_MODEL` in `model.ts` is still `gpt-4o-mini`, because the default provider is OpenAI's own API, where `google/gemini-2.5-flash` is not a valid model id.
Switching the default therefore means either changing the default provider - a deployment decision, with a key and billing behind it - or shipping a default that only works behind a gateway.
The honest statement is: the measurement says to run `google/gemini-2.5-flash` through `OPENAI_BASE_URL`, `.env.example` documents how, and the code default is a fallback that this evidence shows should not be trusted with Evidence containing untrusted text.

## Parameters

Measured, not guessed: [artifacts/param-sweep-2026-09-28](../../artifacts/param-sweep-2026-09-28/README.md).
Two repeats of the same suite at each setting, everything else fixed.

| Parameter                         | Value                                               | Why                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `temperature` for extraction      | `0` (`EXTRACT_TEMPERATURE`, `proposals/extract.ts`) | Extraction is reading, not writing: one right answer per source. At 0 both models reproduced their own output exactly (`gemini-2.5-flash` produced 4,202 completion tokens in both repeats); at the provider default 4 of 22 cases flipped for `gpt-4o-mini`, and one repeat burned 19,743 completion tokens against a ~3,100 norm, costing 3.5x for a worse score.                                    |
| `temperature` for the answer loop | provider default                                    | At 0, 19 of 20 answers were byte-identical across repeats versus 3 of 20 at the default - but two failures became reproducible, including one where the model mis-copies a single digit of an Evidence id every time. Locking in a copy error for every User is worse than a failure that appears in one sample out of two. The harness passes `--temperature 0` when a comparison needs to be stable. |
| `temperature` for reflection      | provider default                                    | Reflection rewrites prose Profile and Working Memory documents; determinism has no value there and was not measured.                                                                                                                                                                                                                                                                                   |
| `ASSISTANT_MAX_STEPS`             | `8`                                                 | No answer case used more than 3 steps on any model, so the cap is a bound on pathological loops, not a cost control. Lowering it to 4 would change nothing measurable on this workload, so no run was spent on it.                                                                                                                                                                                     |
| `maxOutputTokens`                 | unset, except `16` in the credential health check   | Answers are short by instruction, and a hard cap would truncate a legitimately long answer mid-citation. The 19,743-token outlier above is a sampling problem that temperature 0 addressed at the source.                                                                                                                                                                                              |
| `ASSISTANT_DAILY_TURN_CAP`        | `50` per UTC day                                    | A spend bound, not a quality parameter. At the measured $0.0018 per answer turn it caps one User at roughly $0.09 a day on `gemini-2.5-flash`; on the deployed `gpt-4o-mini`, re-measured on 30 September at $0.0025 a turn, about $0.13.                                                                                                                                                              |
| Embedding model                   | `text-embedding-3-small`, 1536 dims                 | Chosen for dimension parity with the Gemini embedder (MRL truncation), so the FAISS index shape does not change with provider. Each chunk stores its `provider:model` identity, so switching embedder marks vectors stale instead of silently mixing spaces.                                                                                                                                           |

## Structured output, not JSON-in-a-string

The extractor uses `generateObject` with a Zod schema (`rawProposalSchema`), so the provider constrains generation rather than the app parsing a hopeful string.
One gateway failure in these runs surfaced as `AI_APICallError: Invalid JSON response` and was counted as a failed case rather than retried away.
Schema conformance is not correctness: every candidate still passes the traceability filter in `proposals/trace.ts`, and `x07` shows a schema-valid, verbatim-cited Proposal that should never have been proposed.
