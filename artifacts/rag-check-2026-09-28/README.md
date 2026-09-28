# RAG evaluation - 28 September 2026

This report evaluates branch `RAG` at commit `cc5bb0eeb4dbc4257207031fb73fa1dd0eca09e8` using the supplied temporary Gemini key.
The key is excluded from the report and logs.

**Outcome: Gemini semantic retrieval and both filters worked on the demo corpus; 2 of 6 generated answers completed and matched the source facts.**
The other 4 cases were attempted but could not complete because of provider overload and quota errors.
Retrieval also showed weak ordering for one paraphrase and no cutoff for unrelated questions.
Start with [answers and assessment](answers.md), then inspect the [readable retrieval results](retrieval-summary.md).

## What was exercised

The evaluation uses real Gemini embeddings, native FAISS, the existing `search_evidence` and `read_evidence` tool handlers, the production tool adapter with Project scope binding, and the production Project system prompt.
Gemini generates the answers through the installed Google AI SDK adapter in a standalone local script.
This is a service and model integration check, not a browser or HTTP chat-route test.
The app's chat factory currently only supports OpenAI, so configuring Gemini embeddings alone does not make the Assistant dock use Gemini for answers.
No application source was changed.

The corpus consists of four synthetic Evidence items from `scripts/seed.ts` in the newly created local database `pm_rag_check_20260928`.
Existing databases were preserved because their migration history belongs to a different branch.
The test database remains available for inspection.
The seed uses the run date, so its dates differ from previously seeded Projects.

For filter tests, the script assigned the existing `vendor` and `security` Labels to Weekly sync minutes, assigned only `vendor` to Acme progress report, and linked Weekly sync minutes to the Task "Provision IAM service account for auth testing".
These fixture changes went through the existing Evidence service in the isolated database.
No Label or link fixtures were added to existing databases.
See [fixture provenance](fixture-provenance.json) and the [source snapshot](sources.json).

## How the feature works

1. Evidence ingestion takes pasted text or extracts text from an uploaded file using markitdown, plain text decoding, or model transcription where available.
2. Optional LitePruner compression creates `prunedText`; without it, search uses the full text.
3. Evidence domain events trigger chunk synchronization.
   Text is split into windows of up to 1,600 characters with 200-character overlap and a preference for newline boundaries.
4. Gemini embeds document chunks using `RETRIEVAL_DOCUMENT` with 1,536 output dimensions.
   Text, vectors, and the provider/model identity are stored in PostgreSQL `evidence_chunks`.
5. Search checks Project ownership and backfills missing chunks or chunks from a different embedding model, up to 100 Evidence items per call.
6. `search_evidence` embeds the query using `RETRIEVAL_QUERY` and searches a lazily built, per-Project FAISS `IndexFlatIP` index over normalized vectors.
   Scores are cosine similarities, rounded to three decimals, not probabilities or confidence estimates.
7. Labels are an AND filter; `linkedTo` restricts results to Evidence linked to a Task, Risk, or Milestone.
   Filters can be combined with a query or used alone for a listing.
8. Search returns up to eight chunk matches by default, with a maximum of twenty, and at most 500 characters per snippet.
   The Assistant can call `read_evidence` for the original text, capped at 20,000 characters, then write its answer.
9. If embeddings are unavailable, search returns literal text matches with the explicit note `Embeddings unavailable; returned literal text matches instead.`

The implementation is in `src/server/modules/search/{service,embed,index,subscriber}.ts`, `src/server/modules/evidence/service.ts`, and `src/server/modules/assistant/{tools,ai-tools,prompt,model}.ts`.
The file [configuration.json](configuration.json) records the exact system prompt, tool set, models, and scope used in this run.
The test disabled OpenAI and LitePruner requests.
File conversion, scanned-document transcription, compression, a large corpus, and browser interactions were not evaluated.

## Configuration and prompts

For Gemini semantic retrieval, set these server-side variables with a valid key:

```dotenv
AI_EMBEDDING_PROVIDER=gemini
AI_EMBEDDING_MODEL=gemini-embedding-001
GEMINI_API_KEY=<your-key>
```

Set the embedding model explicitly: `.env.example` contains `AI_EMBEDDING_MODEL=text-embedding-3-small`, which overrides the Gemini-specific default if copied unchanged.
Do not set `AI_PROVIDER=gemini` expecting the current dock to work: `getModel()` in `assistant/model.ts` returns `null` for every provider other than `openai`.
This evaluation supplied Gemini directly to the script's `generateText` call.
The first pass used `gemini-3.8-flash`, after a probe of `gemini-2.5-flash` returned an availability error recommending that replacement.
After overload and quota errors, retries began with the available `gemini-3.5-flash` model.
The reviewer-capacity retry also failed under provider load; further retries were stopped, with their partial traces retained.
Each final result records its model, and the earlier 3.8 retry is preserved separately.
The API responses are in [provider-probe.json](provider-probe.json).

Open the relevant Project and use prompts that explicitly ask for search, a full-source read, and citations.
The following prompts are suitable for the seeded Payments Project; the last two require the filter fixtures described above.

1. "Search Evidence for the external partner being held up by identity access approval, then read the relevant sources. What is blocking delivery, and what escalation is requested? Cite your sources and do not change anything."
2. "Search Evidence for a staffing shortage before the security assessment, then read the relevant Evidence. Who has limited time, how much time, and what help did they ask for? Cite your sources."
3. "Search Evidence for settlement service completion forecasts. Read the weekly minutes and vendor report. Compare their exact forecast dates and source dates, flag disagreements, and cite both sources."
4. "Search and read Evidence: what is our approved 2027 quantum satellite procurement budget in SGD? Only give a number if a source explicitly supports it; otherwise say the answer is unavailable."
5. "Call search_evidence with labels [\"vendor\", \"security\"] and query \"identity access\". Read the results and summarize the access blocker in Evidence carrying BOTH Labels."
6. "Use search_evidence with linkedTo entityType \"task\" and entity \"Provision IAM service account for auth testing\". Read the returned Evidence and report the identity credentials blocker."

[Prompts and expected outcomes](prompts.json) contains the exact prompts sent, including the test Project's citation path.
The citation paths returned by the model refer to the isolated database's Project IDs; they will not resolve against an app still connected to the original database.
Use [sources.json](sources.json) to inspect each cited source without switching databases.

Questions starting with "why did we decide" follow a separate rule in the production system prompt: the Assistant must call `search_decisions` first and answer from confirmed Decisions.
Use factual Evidence questions like the examples above when specifically checking semantic Evidence retrieval.
The Settings hint "manual RAG call" refers to red/amber/green Project health, a separate meaning of RAG.

## Files to inspect

- [Answers and assessment](answers.md): readable prompts, full answers, and a manual comparison with the source text.
- [Complete results](results.json): prompts, expected outcomes, final answers, tool arguments/results, timing, and token usage for each evaluated case.
- [Direct retrieval](retrieval.json): query inputs, rankings, scores, snippets, and filter results before generation.
- [Index evidence](index.json): chunk text, embedding model identity, and vector dimensions, omitting the long numeric vectors.
- [Source snapshot](sources.json): exact synthetic source texts and fixture details.
- [Initial failed attempts](initial-attempts.json) and [3.8 retry](retry-3.8.json): include provider overload and quota failures, not just successful responses.
- [Partial 3.5 retry](retry-3.5-partial.json) and [run status](run-status.json): document where retries stopped.
- [Step log](steps.jsonl): append-only tool-call trace across the original attempt and retry.

## Interpretation and limitations

The four demo Evidence items each produced one 1,536-dimensional vector under `gemini:gemini-embedding-001`.
Semantic query results contained scores and snippets rather than the fallback note.
Label intersection and linked-Task filtering returned Weekly sync minutes as expected.

Retrieval quality is imperfect: the source that answers the reviewer-capacity question ranked third for the paraphrased direct query, behind a status update and vendor report.
The correct source remained within the requested four matches, but this small corpus does not demonstrate good ranking at scale.

There is no minimum similarity threshold: an unrelated question about a quantum satellite budget still returns ordinary Project Evidence.
An answer must therefore be checked against source content, not merely against the existence of search hits or a positive score.
The recorded no-Evidence answer declined to invent a budget.

A snippet is only the first 500 characters of the matching chunk.
For Weekly sync minutes, that cuts off part of the reviewer-capacity detail, making `read_evidence` essential.
Matches are chunks, so a longer document can appear more than once.
Filtered semantic search overfetches a bounded number of global hits before filtering; this evaluation's small corpus does not validate recall with selective filters at larger scale.

Provider errors are preserved in the logs.
The first run encountered temporary high-demand responses and a free-tier limit of five generation requests per minute.
The retry paced model steps and enabled bounded SDK retries.
A completed factual answer is evidence for that particular fixture and prompt, not a claim of production readiness.

The temporary key file was removed after the evaluation.
No credentials were added to `.env`, application code, or artifacts.
