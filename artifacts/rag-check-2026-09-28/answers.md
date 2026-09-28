# Gemini RAG answers and assessment

This is a small synthetic-fixture integration evaluation, not a production quality benchmark.
Source and response punctuation is normalized to plain hyphens here; `results.json` preserves exact text.
The model was required to search Evidence and read original text before answering.

| Case                 | Model            | Generation | Manual assessment                 |
| -------------------- | ---------------- | ---------- | --------------------------------- |
| 01-access-blocker    | gemini-3.8-flash | completed  | Pass on fixture                   |
| 02-reviewer-capacity | gemini-3.5-flash | failed     | Generation blocked; ranking weak  |
| 03-conflicting-dates | gemini-3.8-flash | failed     | Generation blocked                |
| 04-no-evidence       | gemini-3.8-flash | completed  | Pass on fixture; retrieval caveat |
| 05-all-labels        | gemini-3.8-flash | failed     | Filter passed; generation blocked |
| 06-linked-task       | gemini-3.8-flash | failed     | Filter passed; generation blocked |

## 01-access-blocker

**Prompt**

Search Evidence for the external partner being held up by identity access approval. Call search_evidence, then read_evidence for the relevant sources. What is blocking delivery and what escalation is requested? Answer only from the Evidence you read, with clickable source links using /projects/ca805f30-0938-40ce-9d05-e19a7bf00a4d/evidence?item=<evidenceId>. Do not change anything.

**Expected from the sources**

Find IAM/customer credentials blocker, cite supporting Evidence, do not invent resolution.

**Actual response**

> Delivery of Deliverable A (the settlement service) is blocked by customer credentials, as reported in the [Acme progress report](/projects/ca805f30-0938-40ce-9d05-e19a7bf00a4d/evidence?item=32cb617a-1055-4c05-81d9-530f1f4af9b3). According to the [Weekly sync minutes](/projects/ca805f30-0938-40ce-9d05-e19a7bf00a4d/evidence?item=0c9e7a09-ce2b-4473-98f3-56105ccad4fc), Marcus from Acme noted they are waiting on the IAM credentials request after not hearing back from the identity team. The escalation requested is sponsor support in escalating the IAM credentials with Acme, as documented in the [Status update - week 37](/projects/ca805f30-0938-40ce-9d05-e19a7bf00a4d/evidence?item=ab9875cd-3611-4063-9081-99d969699420).

Model: `gemini-3.8-flash`.
Elapsed: 106.0 seconds, including pacing and any provider retries.
Tool sequence: `search_evidence` -> `read_evidence` -> `read_evidence` -> `read_evidence`.

**Assessment: Pass on fixture**

The answer identifies customer/IAM credentials as the blocker and sponsor support as the escalation. All three cited Evidence IDs occur in read_evidence outputs and their texts support the claims. No invented resolution is asserted.

## 02-reviewer-capacity

**Prompt**

Search Evidence for a staffing shortage before the security assessment, then read the relevant Evidence. Who has limited time, how much time do they have, and what help did they ask for? Cite the Evidence using /projects/ca805f30-0938-40ce-9d05-e19a7bf00a4d/evidence?item=<evidenceId>. Do not change anything.

**Expected from the sources**

Weekly sync minutes: Ben has roughly 4 hours and asks for a second reviewer.

**Actual response**

No final answer was produced.

```text
Failed after 2 attempts. Last error: AI_APICallError: This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.
```

Model: `gemini-3.5-flash`.
Elapsed: 163.7 seconds, including pacing and any provider retries.
Tool sequence: `search_evidence`.

**Assessment: Generation blocked; ranking weak**

The direct paraphrase query returned Weekly sync minutes in third place, with score 0.590, behind less relevant Evidence. That source says Ben has roughly four hours and asked for a second reviewer. The full answer could not be evaluated because Gemini returned provider errors.

## 03-conflicting-dates

**Prompt**

Use search_evidence to find settlement service completion forecasts, then read all relevant sources with read_evidence. Compare the weekly minutes with the vendor progress report. Give their exact forecast dates and source dates. Are they consistent? Do not silently choose one as confirmed. Cite both Evidence sources using /projects/ca805f30-0938-40ce-9d05-e19a7bf00a4d/evidence?item=<evidenceId>. Do not change anything.

**Expected from the sources**

Compare settlement date in weekly minutes with Acme forecast, identify disagreement and source dates, avoid asserting one verified date.

**Actual response**

No final answer was produced.

```text
Failed after 3 attempts. Last error: AI_APICallError: You exceeded your current quota, please check your plan and billing details. For more information on this error, head to: https://ai.google.dev/gemini-api/docs/rate-limits. To monitor your current usage, head to: https://ai.dev/rate-limit.
* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 20, model: gemini-3.8-flash
Please retry in 34.018399978s.
```

Model: `gemini-3.8-flash`.
Elapsed: 16.1 seconds, including pacing and any provider retries.
Tool sequence: none.

**Assessment: Generation blocked**

The source snapshot contains a clear test oracle: Weekly sync minutes dated 2026-09-25 forecast 2026-09-30, while Acme progress report dated 2026-09-24 forecasts 2026-10-05. No completed model answer was obtained; conflict handling remains unverified. A further 3.5 retry was stopped after repeated provider failures.

## 04-no-evidence

**Prompt**

Use search_evidence and read_evidence to check: what is our approved 2027 quantum satellite procurement budget in SGD? Only state a number if the Evidence explicitly supports it. If no source supports an answer, say so. Do not change anything.

**Expected from the sources**

No approved quantum satellite procurement budget exists in sources; say unavailable without inventing a number.

**Actual response**

> No source in the project evidence mentions or supports an approved 2027 quantum satellite procurement budget.

Model: `gemini-3.8-flash`.
Elapsed: 19.0 seconds, including pacing and any provider retries.
Tool sequence: `search_evidence` -> `read_evidence` -> `read_evidence` -> `read_evidence`.

**Assessment: Pass on fixture; retrieval caveat**

The answer correctly declines to invent a satellite procurement budget. Search still returned ordinary Evidence with positive scores because there is no relevance threshold. The model read three returned sources before answering. This is an answer-grounding success, not evidence that unrelated searches return empty results.

## 05-all-labels

**Prompt**

Call search_evidence with labels ["vendor", "security"] and query "identity access". Read matching Evidence and summarize only the access blocker in Evidence carrying BOTH Labels. Cite the source using /projects/ca805f30-0938-40ce-9d05-e19a7bf00a4d/evidence?item=<evidenceId>. Do not change anything.

**Expected from the sources**

Only Weekly sync minutes carries both vendor and security; search must include both labels.

**Actual response**

No final answer was produced.

```text
Failed after 3 attempts. Last error: AI_APICallError: You exceeded your current quota, please check your plan and billing details. For more information on this error, head to: https://ai.google.dev/gemini-api/docs/rate-limits. To monitor your current usage, head to: https://ai.dev/rate-limit.
* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 20, model: gemini-3.8-flash
Please retry in 17.886962509s.
```

Model: `gemini-3.8-flash`.
Elapsed: 16.1 seconds, including pacing and any provider retries.
Tool sequence: none.

**Assessment: Filter passed; generation blocked**

The direct query with BOTH vendor and security returned only Weekly sync minutes. Acme progress report has only vendor and was excluded. The final generated summary remains unverified because of provider errors.

## 06-linked-task

**Prompt**

Use search_evidence with linkedTo entityType "task" and entity "Provision IAM service account for auth testing". Read the returned Evidence and report what it says about the identity credentials blocker. Cite the source using /projects/ca805f30-0938-40ce-9d05-e19a7bf00a4d/evidence?item=<evidenceId>. Do not change anything.

**Expected from the sources**

linkedTo task filter resolves named Task and returns only linked Weekly sync minutes.

**Actual response**

No final answer was produced.

```text
Failed after 3 attempts. Last error: AI_APICallError: You exceeded your current quota, please check your plan and billing details. For more information on this error, head to: https://ai.google.dev/gemini-api/docs/rate-limits. To monitor your current usage, head to: https://ai.dev/rate-limit.
* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 20, model: gemini-3.8-flash
Please retry in 1.979733453s.
```

Model: `gemini-3.8-flash`.
Elapsed: 15.9 seconds, including pacing and any provider retries.
Tool sequence: none.

**Assessment: Filter passed; generation blocked**

The direct linkedTo call resolved the named Task and returned only Weekly sync minutes. The initial model attempt also called search_evidence with the linkedTo filter and read that source, but generation failed before a final answer.

## How to review a case

In `results.json`, find the case ID and compare `answer` against each `steps[].toolResults[].output`.
A `search_evidence` result should have numerical `score` and `snippet` fields for a semantic query, and no embeddings-unavailable note.
A `read_evidence` result should contain the original source text that supports the answer.
Check citation IDs against `sources.json` and inspect contradictory dates or unsupported numerical claims.
Filtered listings without a query are expected to lack similarity scores.
Provider errors are execution failures; they are not evidence that the retrieval facts were incorrect.
