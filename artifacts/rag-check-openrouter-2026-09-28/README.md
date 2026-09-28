# RAG evaluation, OpenRouter re-run - 28 September 2026

This repeats the evaluation in `artifacts/rag-check-2026-09-28` on branch `RAG` at commit `cc5bb0e`, using a user-supplied temporary OpenRouter key.
The key was passed through the environment only.
It is not in this report, the logs, `.env`, or any application file.

**Outcome: all 9 generation cases completed, including the 4 that Gemini could not finish, and every answer matched the source facts.**
Retrieval works but ranks poorly and still has no relevance threshold.
The new finding is a citation defect: every citation failed when the model had to supply the path itself, and a control case isolates the cause to `search_evidence` and `read_evidence` returning no `href`.

Start with [answers and assessment](assessment.json), then [readable retrieval results](retrieval-summary.md), then the [improvement plan](improvement-plan.md).

## What changed from the Gemini run

The previous run was blocked by provider overload and a five-request-per-minute free-tier limit, leaving 4 of 6 cases unverified.
OpenRouter served every request with no rate-limit or overload error, so the blocked cases now have answers.

Embeddings moved from `gemini:gemini-embedding-001` to `openai:openai/text-embedding-3-small`, both at 1536 dimensions.
OpenRouter does serve an OpenAI-compatible `/v1/embeddings` endpoint, which was verified before the run.

No application source was changed.
`OPENAI_BASE_URL` is already honoured by `@ai-sdk/openai`, and `getModel()` already builds an OpenAI-compatible client, so pointing both at the OpenRouter gateway required configuration only.
This also means the production chat path works against OpenRouter today, which the Gemini run could not achieve: `getModel()` returns `null` for any `AI_PROVIDER` other than `openai`.

The chat model is `openai/gpt-4o-mini`, which is the repository's own `DEFAULT_MODEL`, so this run is closer to the shipped default than the Gemini run was.

## What was exercised

Real embeddings, native FAISS, the production `search_evidence` and `read_evidence` handlers, the production tool adapter with Project scope binding, the production Project system prompt, and production `getModel()`.
The harness is `scripts/rag-check.mts`; it is a service and model integration check, not a browser or HTTP chat-route test.

The corpus is the same 4 synthetic Evidence items in the preserved database `pm_rag_check_20260928`, with the same Label and linked-Task fixtures.
Re-embedding was left to the production path: a changed embedder identity marks every vector stale, and `index.json` records all 4 items moving from the Gemini identity to the OpenAI one, each one chunk of 1536 dimensions.
That stale-detection behaviour is confirmed working.

The 6 original prompts were replayed verbatim from the previous run's `prompts.json` for comparability.
Three control prompts were then added in [prompts-control.json](prompts-control.json), because the original prompts hand the model the citation URL template and so hide how citations behave in production, where the User writes no such thing.

## Findings

### 1. Generation is no longer the bottleneck

All 9 cases completed in 3.4-6.7 s over 2-3 steps each.
Every answer was checked against the source text and none contradicted it.
The conflicting-dates case, unverified before, is handled well: both forecast dates, both source dates, the disagreement named, and no silent choice of a winner.
The absent-topic case correctly refuses to invent a budget.

### 2. Citations frequently do not reach the source

Of 16 citations across the 9 answers, 10 work, 4 are dead, and 2 navigate somewhere that does not exist.

The raw 10-of-16 understates the problem, because it counts answers to prompts that did the model's work for it.
Five of the six original prompts hand over the citation path with the real Project id already in it, which no real User writes.
Splitting on where the path came from removes the ambiguity entirely:

| Where the path came from              | Citations | Working |
| ------------------------------------- | --------- | ------- |
| User prompt supplied the URL template | 7         | 7       |
| Tool supplied an `href` (control c2)  | 3         | 3       |
| Neither                               | 6         | 0       |

Every citation failed when the model had to supply the path itself, and none failed when something gave it one.

`internalHref` in `src/widgets/assistant/linked-text.tsx` already strips an invented host when the path is a Project route, which rescues the `https://www.example.com/projects/<real id>/...` citations in cases 03, 05 and 06.
Two failure classes get past it:

- Case 04 emitted `[Status update - week 37](href)`, the literal placeholder from the fourth WHY rule. `internalHref` returns null and the citation renders as plain unlinked text.
- Control c1 emitted bare `https://example.com` three times, with no path at all. All three render as unlinked text, so the User cannot reach any source.
- Control c3 emitted `/projects/.../evidence?item=<real uuid>`, copying the illustrative placeholder in the second WHY rule. This starts with `/projects/`, so the guard accepts it and the link navigates to a Project literally named `...`. Sanitisation cannot catch this class, because the string is a structurally valid Project route.

### 3. The cause is a missing `href`, not a weak model

Control c2 is the decisive comparison.
Asked a "why did we" question, the model called `search_decisions`, which returns every `nearestEvidence` item with an `href` and a ready-made `cite` string built by `citation()` in `src/server/modules/decisions/answers.ts`.
It reproduced all three citations exactly, including the `#evidence-<id>` anchor.

Same model, same system prompt, same turn: citations are correct when the tool supplies them and invented when it does not.
`search_evidence` and `read_evidence` return `evidenceId`, `title`, `kind`, `sourceDate` and `fileName`, and no `href`.
`evidenceHref` already exists in `src/shared/lib/hrefs.ts` and is used elsewhere for exactly this path.

Put precisely, the model does not build the URL wrongly; it cannot build it correctly.
No Evidence tool result carries a `projectId` or any Project route, so the path shape is never available to copy.
The only two places a real `/projects/<uuid>` string reaches the model are the Project summary embedded in the system prompt and `search_decisions` output.
That also makes `get_project_summary` part of the fix: its Evidence list is in the system prompt on every turn and is where the c3 model got the ids it then cited with a placeholder path.

The prompt makes it worse rather than better.
The rule that forbids absolute and rewritten hrefs sits inside `WHY_RULES`, framed entirely around Decisions, so it does not obviously bind an Evidence-only answer.
Both of its illustrative placeholders, `[Kickoff minutes](/projects/.../evidence?item=...)` and `[D-n title](href)`, were pasted literally into answers.

### 4. Ranking is weak and the score scale is not portable

Details are in [retrieval-summary.md](retrieval-summary.md).
The source that answers the reviewer-capacity question ranks second, 0.004 behind an irrelevant one.
All four scores for that query sit within a 0.077 band.

There is still no relevance threshold, and this run shows a naive one would not work.
The top hit for the unanswerable satellite question scores 0.331, while the only correct hit for the legitimate `all-labels` query scores 0.234.
An unrelated question outscores a relevant one, and the whole OpenAI band sits far below Gemini's 0.55-0.60, so any constant tuned on one embedder is wrong for the other.

### 5. The plain-text rule is ignored

The system prompt says to avoid Markdown headers, bold and lists.
Cases 03, c1 and c3 used numbered lists, bullets and bold.
`MarkdownText` renders all of them, so this is cosmetic rather than broken, but the instruction is not doing its job.

### 6. "No recorded decision" asserted without calling search_decisions

Case 04 opened with "There is no recorded decision or evidence that specifies..." having called only `search_evidence` and `read_evidence`.
The question was about a budget, so the why-trigger in `WHY_RULES` never fired, but the model borrowed the rule's wording anyway.
The refusal happened to be correct here, since the Project has no Decisions at all, so this is a reasoning-provenance defect rather than a wrong answer.

### 7. Snippet-only answering

Control c1 answered from `search_evidence` snippets without ever calling `read_evidence`.
Snippets are capped at 500 characters, and that snippet was cut mid-sentence at "Ben: has roughly 4 hours available before ".
The answer omitted the reviewer-capacity point entirely, so this is a demonstrated loss of fact, not a hypothetical one.

## Limitations

Four documents, one chunk each, is too small to say anything about ranking or recall at scale.
No browser or HTTP chat-route test, no file conversion, no LitePruner compression, no multi-chunk document.
One chat model only; the citation behaviour of other models is untested, though the c2 control shows the fix does not depend on the model.
Nine completed answers on one fixture are not a claim of production readiness.

## Files

- [assessment.json](assessment.json): per-case verdict and the manual comparison against source text.
- [retrieval-summary.md](retrieval-summary.md): readable rankings, with the Gemini scores alongside.
- [improvement-plan.md](improvement-plan.md): proposed fixes, ordered, with the evidence for each.
- [results.json](results.json) and [results-control.json](results-control.json): full answers, tool calls, tool results, timing, token usage.
- [retrieval.json](retrieval.json): raw query inputs, rankings, scores and snippets.
- [index.json](index.json): the stale-and-re-embed transition, chunk sizes and vector dimensions.
- [configuration.json](configuration.json): exact system prompt, tools, models and gateway, with credentials masked.
- [prompts-control.json](prompts-control.json): the three added control prompts and what each one tests.

Source texts are unchanged from the previous run and remain in `../rag-check-2026-09-28/sources.json`.

## Reproducing

```bash
DATABASE_URL=postgres://pm:pm@localhost:5433/pm_rag_check_20260928 \
OPENAI_API_KEY=<openrouter-key> \
OPENAI_BASE_URL=https://openrouter.ai/api/v1 \
AI_EMBEDDING_PROVIDER=openai AI_EMBEDDING_MODEL=openai/text-embedding-3-small \
AI_PROVIDER=openai AI_MODEL=openai/gpt-4o-mini \
npx tsx scripts/rag-check.mts artifacts/rag-check-openrouter-2026-09-28
```

Add `SKIP_INDEX=1 PROMPTS_FILE=... RESULTS_NAME=...` to reuse the index for another prompt set.
