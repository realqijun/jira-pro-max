# Direct retrieval results

These calls use the branch's search service, Gemini embeddings, and native FAISS.
The linked-Task call has no query, so it is a filtered listing with no similarity score.
The original source text and exact returned snippets are preserved in `retrieval.json`.

## paraphrase

Input:

```json
{
  "query": "external partner blocked by identity access approval",
  "limit": 4
}
```

| Rank | Evidence                 | Score |
| ---- | ------------------------ | ----- |
| 1    | Acme progress report     | 0.6   |
| 2    | Weekly sync minutes      | 0.586 |
| 3    | Status update - week 37  | 0.572 |
| 4    | Project plan v4 (export) | 0.543 |

Latency: 497 ms.

## reviewer-capacity

Input:

```json
{
  "query": "staffing shortage before the security assessment",
  "limit": 4
}
```

| Rank | Evidence                 | Score |
| ---- | ------------------------ | ----- |
| 1    | Status update - week 37  | 0.605 |
| 2    | Acme progress report     | 0.6   |
| 3    | Weekly sync minutes      | 0.59  |
| 4    | Project plan v4 (export) | 0.548 |

Latency: 374 ms.

## all-labels

Input:

```json
{
  "query": "identity access",
  "labels": ["vendor", "security"],
  "limit": 4
}
```

| Rank | Evidence            | Score |
| ---- | ------------------- | ----- |
| 1    | Weekly sync minutes | 0.562 |

Latency: 437 ms.

## linked-task

Input:

```json
{
  "linkedTo": {
    "entityType": "task",
    "entity": "Provision IAM service account for auth testing"
  },
  "limit": 4
}
```

| Rank | Evidence            | Score          |
| ---- | ------------------- | -------------- |
| 1    | Weekly sync minutes | not applicable |

Latency: 20 ms.

## absent-topic

Input:

```json
{
  "query": "approved 2027 quantum satellite procurement budget in SGD",
  "limit": 4
}
```

| Rank | Evidence                 | Score |
| ---- | ------------------------ | ----- |
| 1    | Acme progress report     | 0.575 |
| 2    | Weekly sync minutes      | 0.567 |
| 3    | Status update - week 37  | 0.555 |
| 4    | Project plan v4 (export) | 0.547 |

Latency: 432 ms.
