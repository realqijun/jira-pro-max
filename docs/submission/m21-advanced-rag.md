# Milestone 21 (optional) - Advanced RAG

## Technique: agentic, routed retrieval over a knowledge graph and a filtered vector index

Basic RAG embeds the question, pulls the top-k chunks, and pastes them into the prompt.
PrismPM does three things differently.

1. **Agentic retrieval.** Retrieval is a set of tools the model chooses between inside the bounded loop (M10), not a fixed pre-step. It can search, read a full document, and search again.
2. **Graph retrieval for "why".** `search_decisions` does not search text at all. It returns confirmed Decisions from the Decision graph (ADR 0008) with their context, rejected alternatives, Assumptions, the Decision that superseded them, and a ready-made citation for every Source. The prompt routes every "why" question there first.
3. **Hybrid, filtered vector search for facts.** `search_evidence` ranks Evidence chunks by embedding similarity (per-Project FAISS, 1,600-character chunks with 200-character overlap) and can combine that with metadata filters: Labels (AND) and "linked to this Task, Risk or Milestone". With no embedding key it falls back to literal matching and says so. Text is compressed once at ingest (LitePruner) before embedding.

| Tool               | Index                          | Used for                                                     |
| ------------------ | ------------------------------ | ------------------------------------------------------------ |
| `search_decisions` | Decision graph in Postgres     | Why and how something was decided; supersession; Assumptions |
| `search_evidence`  | FAISS + Label and link filters | Where something is said in the documents                     |
| `read_evidence`    | Postgres, full text            | Exact facts a 500-character snippet would cut off            |

## Why this over basic RAG

The core question - "why did we do X?" - is exactly where basic RAG fails dangerously.
A similar-sounding paragraph is not a Decision: a transcript can contain a reason someone suggested and the team rejected, and chunk retrieval will return it with high similarity.
Three of our answer cases were written to expose that.

| Case         | What basic chunk RAG would do                                                                              | What the routed design does                                                     | Result, `gemini-2.5-flash` |
| ------------ | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------- |
| `w03`        | Retrieves both the old (11 merchants) and new (14 merchants) text with no way to know which replaced which | The graph returns D-2 with `supersededBy` D-5; the answer names the replacement | Pass                       |
| `w14`        | A plausible reason exists in Evidence, so similarity finds it and the model repeats it as fact             | No Decision exists, so the answer abstains and links the nearest Evidence       | Pass                       |
| `w17`, `w18` | Top-k over the whole Project, mixing vendors and workstreams                                               | Label and linked-item filters narrow the search to what the PM filed            | Pass                       |

With the final prompt, `gemini-2.5-flash` passes all 20 answer cases ([M11](m11-evals.md)).
The design still depends on the model following the route: `gpt-4o-mini` fails `w03` and `w14`, which is one reason M9 recommends against it.

## Measured impact of the retrieval changes

- **Citations:** giving every retrieval result a ready-made `cite` took citations the model had to build itself from **0 of 6 working to 16 of 16** ([rag-check-citation-fix](../../artifacts/rag-check-citation-fix-2026-09-28/README.md)).
- **Abstention:** four cases must abstain (`w04`, `w05`, `w12`, `w14`); all pass with the routed design on the recommended model.
  Before the prompt required calling `search_decisions` before abstaining, `w06` abstained without retrieving at all; that one rule took the model from 19/20 to 20/20.
- **Stale vectors:** each chunk records the `provider:model` that embedded it, so switching embedder re-embeds instead of mixing vector spaces; verified by switching and watching all 6 vectors re-compute.

## Limits, stated plainly

We did not run a controlled ablation of "the same model with plain top-k chunk RAG" against this design, so the table above shows what each case requires rather than a measured basic-RAG score.
Retrieval ranking itself is weak on paraphrases and has no relevance threshold ([rag-check-openrouter](../../artifacts/rag-check-openrouter-2026-09-28/README.md)); the graph route is what keeps that weakness away from "why" answers.
