# Direct retrieval results - OpenRouter re-run

These calls use the branch's search service, OpenRouter-served `text-embedding-3-small` embeddings, and native FAISS.
The linked-Task call has no query, so it is a filtered listing with no similarity score.
Exact inputs, snippets and scores are in `retrieval.json`.

The `gemini` column is the same probe from `artifacts/rag-check-2026-09-28` under `gemini:gemini-embedding-001`.
It is shown only to make one point: the scores are not comparable across embedders.
Correct sources for each probe are marked.

## paraphrase

Query `external partner blocked by identity access approval`, limit 4, 710 ms.

| Rank | Evidence                 | Score | Gemini score | Note                 |
| ---- | ------------------------ | ----- | ------------ | -------------------- |
| 1    | Status update - week 37  | 0.306 | 0.572        |                      |
| 2    | Weekly sync minutes      | 0.306 | 0.586        | states the blocker   |
| 3    | Acme progress report     | 0.296 | 0.600        | the external partner |
| 4    | Project plan v4 (export) | 0.276 | 0.543        |                      |

The two best sources rank second and third, tied with and just below an unrelated status update.
Gemini put Acme first here; OpenAI puts it third.
Neither ordering is trustworthy at a 0.01 margin.

## reviewer-capacity

Query `staffing shortage before the security assessment`, limit 4, 600 ms.

| Rank | Evidence                 | Score | Gemini score | Note            |
| ---- | ------------------------ | ----- | ------------ | --------------- |
| 1    | Status update - week 37  | 0.352 | 0.605        |                 |
| 2    | Weekly sync minutes      | 0.348 | 0.590        | the only answer |
| 3    | Project plan v4 (export) | 0.339 | 0.548        |                 |
| 4    | Acme progress report     | 0.275 | 0.600        |                 |

The only source that answers the question ranks second, 0.004 behind an irrelevant one.
It ranked third under Gemini.
All four scores sit inside a 0.077 band, so the ranking is close to arbitrary.

## all-labels

Query `identity access` with labels `["vendor", "security"]`, limit 4, 514 ms.

| Rank | Evidence            | Score | Gemini score |
| ---- | ------------------- | ----- | ------------ |
| 1    | Weekly sync minutes | 0.234 | 0.562        |

The AND filter is correct: Acme progress report carries `vendor` only and is excluded.

## linked-task

`linkedTo` task `Provision IAM service account for auth testing`, limit 4, 30 ms.

| Rank | Evidence            | Score          |
| ---- | ------------------- | -------------- |
| 1    | Weekly sync minutes | not applicable |

Resolves the Task by name and returns only linked Evidence, with no embedding call.

## absent-topic

Query `approved 2027 quantum satellite procurement budget in SGD`, limit 4, 657 ms.

| Rank | Evidence                 | Score | Gemini score |
| ---- | ------------------------ | ----- | ------------ |
| 1    | Status update - week 37  | 0.331 | 0.555        |
| 2    | Acme progress report     | 0.304 | 0.575        |
| 3    | Weekly sync minutes      | 0.247 | 0.567        |
| 4    | Project plan v4 (export) | 0.239 | 0.547        |

No source mentions satellites, yet four Evidence items come back with positive scores.

This probe carries the strongest conclusion in the run.
The top hit for a question the corpus cannot answer scores 0.331.
The single correct hit for the legitimate `all-labels` query scores 0.234.
An unrelated question therefore outscores a relevant one, so no single global cutoff constant can separate them.
A fixed threshold tuned on Gemini's 0.55-0.60 band would also have rejected every OpenAI result.
