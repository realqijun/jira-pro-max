# Improvement plan

Ordered by evidence strength and inverse risk.
Steps 1 to 3 are small, well-understood changes that remove every citation failure this run produced.
Steps 5 and 6 are retrieval-quality work that should not be attempted until step 4 exists, because there is currently nothing to measure against.

Each step names the evidence that motivates it, so a reviewer can disagree with the fix without re-running the evaluation.

## 1. Return the citation from the Evidence tools

**Evidence.** Control c2 and the six original cases differ in exactly one way.
`search_decisions` returns an `href` and a ready-made `cite` per source, and the model reproduced all three citations perfectly.
`search_evidence` and `read_evidence` return no `href`, and the model invented `https://example.com`, `www.example.com` and the literal string `href`.
The asymmetry, not the model, is the cause.

**Sharper statement of the problem.**
It is not that the model builds the URL wrongly; it cannot build it correctly.
No Evidence tool result contains a `projectId` or any Project-route string, so the path shape is never available to copy.
The only places a real `/projects/<uuid>` string appears are the Project summary JSON embedded in the system prompt and `search_decisions` output.
Tool output should be the only sanctioned channel for an href.

**Change.**
The single highest-value edit is `evidenceMeta` in `src/server/modules/assistant/tools.ts`, because `get_project_summary`, `list_evidence` and `read_evidence` all return through it, and `EvidenceRow` already carries `projectId`.
Add `href` and `cite` there.

Three further sites need the same treatment and are easy to miss:

- `get_project_summary` matters most and is the least obvious. Its Evidence list is injected verbatim into the system prompt on every Project turn (`src/app/api/assistant/chat/route.ts`, `projectSystemPrompt(await findTool("get_project_summary").handler(...))`). It is the first and most-seen Evidence surface, and it is where the model in control c3 obtained the ids it then cited with a placeholder path. Fixing the search tools while leaving this list as bare ids would leave the main surface uncited. It is covered for free by editing `evidenceMeta`.
- `meta()` in `src/server/modules/search/service.ts` builds `search_evidence` results separately and does not go through `evidenceMeta`. Note it emits `evidenceId` where `evidenceMeta` emits `id`; keep that key as it is to avoid breaking the model's existing `read_evidence` calls, and add `href` and `cite` alongside. The rows come from `evidenceRepo`, so `projectId` is available.
- The `read_evidence` disambiguation branch returns a hand-rolled `matches: [{ id, title }]` when a title is ambiguous. It bypasses `evidenceMeta`, so it needs `cite` added explicitly.

`evidenceHref(projectId, id)` in `src/shared/lib/hrefs.ts` already produces the right path, anchor included, and is what the Evidence chips use.
`citation(label, href)` already exists in `src/server/modules/decisions/answers.ts` and already neutralises brackets and newlines that would break the dock's link parser.

Scope binding is not an obstacle: `SCOPE_KEYS` in `ai-tools.ts` strips `projectId` from the model-facing schema and injects it server-side, so every handler still has it.

Move `citation` to `src/shared/lib/citation.ts` and re-export it from `decisions/answers.ts` so the Decisions module keeps its current surface.
It is presentation-shaped string building with no domain dependency, so `shared/lib` is the right home once a second module needs it.

**Why this shape.**
The model should never build a URL.
Handing it a verbatim string to paste is the pattern the Decisions work already established and validated, and this step only extends it to Evidence.

**Tests.**
Extend `src/server/modules/assistant/tools.test.ts`: every Evidence item returned by the three tools has a `cite` whose href starts with `/projects/` and contains the Evidence id.
Add a `shared/lib/citation` unit test for a title containing `[`, `]` and a newline.

## 2. Make the citation rule general, and remove the pasteable placeholders

**Evidence.**
The rule "never rewrite an href, never make it absolute, never cite anything the tool did not return" is real, but it lives inside `WHY_RULES` and is framed entirely around Decisions, so it does not clearly bind an Evidence-only answer.
Worse, both illustrative placeholders in that block were pasted into answers verbatim: `[Status update - week 37](href)` in case 04, from `[D-n title](href)`, and `/projects/.../evidence?item=<uuid>` in control c3, from `[Kickoff minutes](/projects/.../evidence?item=...)`.
A placeholder in a prompt is a string the model may copy.

The rule is also broken in a way the first draft of this plan missed.
It instructs the model to cite from `sourceCitations`, a field that only exists in `search_decisions` output.
An Evidence-only answer has no `sourceCitations` to copy, so the rule is not merely Decision-framed: for Evidence it names a field that does not exist.
That is the gap Step 1 fills.

**Change.**
In `src/server/modules/assistant/prompt.ts`, lift the href constraint out of `WHY_RULES` into a `CITATION_RULES` block that applies to every tool result, and state it as an instruction to copy the `cite` field rather than to format a link.
Delete the `(href)` and `/projects/.../` placeholders.
Where an example is still wanted, describe the field to copy instead of showing a fake path.
Keep `WHY_RULES` for what is genuinely Decision-specific: call `search_decisions` first, answer only from it, and the wording for an empty result.

Add one rule while here, for a defect case 04 exposed.
That answer opened with "There is no recorded decision or evidence that specifies..." without ever calling `search_decisions`; its tool calls were `search_evidence` and four `read_evidence` calls.
The question was "what is our budget", so the why-trigger did not fire, yet the model borrowed the rule's phrasing anyway.
State that the sentence "There is no recorded decision about that" may only be written after `search_decisions` has actually returned an empty list.

**Tests.**
In `src/server/modules/assistant/prompt.test.ts`, assert the prompt contains no substring matching `](href)` or `/projects/...`.
That is a cheap regression guard against reintroducing a copyable placeholder.

## 3. Harden the render boundary against structurally valid nonsense

**Evidence.**
`internalHref` in `src/widgets/assistant/linked-text.tsx` already strips invented hosts, which is why cases 03, 05 and 06 still work, and it correctly kills `https://example.com` and the bare `href`.
It cannot catch control c3: `/projects/.../evidence?item=<uuid>` starts with `/projects/`, so it is accepted, and the link navigates to a Project named `...`.

**Change.**
Validate the two segments differently, because they are different kinds of thing.

For the Project id segment, require an identifier shape such as `[A-Za-z0-9_-]{8,}`.
That rejects `...` without assuming a UUID, which matters because the column is `text`.

For the section segment, use the existing whitelist, not a length rule.
`CITATION_KINDS` in `src/widgets/assistant/markdown-text.tsx` already derives the valid set from `PROJECT_SECTIONS`, and the empty slug for the Project overview is part of it.

A length rule on the section segment would be a serious regression, and an earlier draft of this plan proposed exactly that.
`tasks`, `risks`, `people` and `renders` are all shorter than eight characters, and the overview citation `/projects/<id>` has no section segment at all.
An `[A-Za-z0-9_-]{8,}` rule would therefore reject `taskHref`, `riskHref`, `graphHref` and every Comment or Activity source citation `search_decisions` emits for a Task or Risk parent - that is, it would break the working Decision citations that control c2 proved correct, in the name of fixing Evidence ones.

**Why defence in depth.**
Step 1 removes the model's need to invent a path and step 2 removes the template it copied, but the dock renders arbitrary model output, so the boundary should not trust it.
This is the same reasoning that already justifies the host-stripping behaviour.

**Tests.**
Add cases to `src/widgets/assistant/linked-text.test.ts`: `/projects/.../evidence?item=<uuid>` returns null, and a real path keeps its query and hash intact.

The negative test alone is not sufficient, and a compliant-looking implementation can pass it while still shipping the regression above.
Assert one surviving example per href producer in `src/shared/lib/hrefs.ts` and per `ITEM_PATH` entry in `decisions/answers.ts`, including `/projects/<id>/tasks?task=<id>&tab=history`, a `#passage-<id>` anchor, and the bare `/projects/<id>` overview.

## 4. Turn the harness into a citation and grounding regression gate

**Evidence.**
The two evaluations of this feature were both one-off scripts, and the first left 4 of 6 cases unverified with no way to tell later whether the gap was the feature or the provider.
The most valuable defect in this run, broken citations, is checkable without a human: every Markdown link in an answer must survive `internalHref` and resolve to an Evidence id that exists in the Project.

**Change.**
Keep `scripts/rag-check.mts` as the entry point and add an assertion pass over `results.json`.
The prompts are already fixtures loaded through `PROMPTS_FILE`; move them from the artifact directories to a stable path beside the script so a result set and its inputs cannot drift apart.

Fail the run when a link's href is not accepted by `internalHref`, or when the cited Evidence id does not exist in the Project.

Two tempting assertions should be avoided, because both would fail correct behaviour:

- "the cited id must appear in this turn's tool results" is wrong, because the Project summary in the system prompt legitimately supplies every Evidence id before any tool runs. Assert instead that the id was available to the model, from the summary or a tool result.
- "the model must have read an id before citing it" encodes a policy the prompt does not currently state. Decide the read-before-cite rule in the prompt first, then gate on it. A gate stricter than the spec it enforces produces failures nobody can act on.

Run it on demand and before touching the search or prompt modules, not in PR CI: it needs a live key and a seeded database, and CI runs `format:check`, `eslint` and `typecheck` only.

**Why before steps 5 and 6.**
Ranking cannot be improved without a way to detect regressions, and four documents with one chunk each cannot show whether a change helped.
This step is also what makes steps 1 to 3 verifiable rather than merely plausible.

## 5. Signal weak retrieval; do not add a global threshold constant

**Evidence.**
This run rules out the obvious fix.
The best hit for the unanswerable satellite question scores 0.331, while the only correct hit for the legitimate `all-labels` query scores 0.234, so no constant separates relevant from irrelevant even within one embedder.
Across embedders the bands do not overlap at all: 0.23 to 0.35 for `text-embedding-3-small` against 0.55 to 0.60 for `gemini-embedding-001`.
A constant tuned on either one is wrong for the other, and `embeddingModelId()` already exists precisely because vectors are not comparable across models.

**Change.**
Do not hardcode a cutoff.
Make the shape of the result set legible to the model instead: return the score spread alongside the matches, and mark the set as weakly discriminating when the top score barely exceeds the rest.
Pair that with a prompt rule that permits saying the Evidence does not answer the question when the set is weak.

Do not make reading conditional on weakness, which an earlier draft of this plan did.
Control c1 answered from snippets alone on a perfectly ordinary-looking result set, so a weak-set trigger would not have fired there.
Read-before-asserting should apply to factual claims generally; weak-set signalling should modulate how freely the model may hedge or refuse, not whether it must read.

If a numeric cutoff is wanted later, key it to the embedder identity and default it to off, so switching provider cannot silently start filtering everything out.
Set it from a labelled set produced in step 4, not by intuition.

**Note on what already works.**
Grounding is currently carrying this weakness: both no-evidence cases refused to invent an answer despite retrieval returning confident-looking hits.
That is worth preserving deliberately rather than by luck, which is what the prompt rule above is for.

## 6. Improve ranking with hybrid retrieval and reranking

**Evidence.**
The correct source ranked second by 0.004 on one query and third under the other embedder.
All four scores for the reviewer-capacity query fall inside a 0.077 band.
Pure dense similarity over short documents is not discriminating here.

**Change.**
Add a lexical arm, Postgres full-text or trigram over the same chunk text, and fuse it with the vector arm by reciprocal rank fusion.
The literal-match fallback in `searchService.search` already shows the query terms are available.
Consider a cross-encoder rerank of the fused top-k afterwards, which is the standard remedy for exactly this failure and is a good fit now that a gateway makes model choice cheap.

**Sequencing.**
Do this only after step 4, and measure on a corpus with multi-chunk documents.
The current fixture cannot distinguish a real improvement from noise.

**Record it.**
Hybrid retrieval and reranking is a trade-off decision of exactly the kind this repo keeps in `docs/adr/`, alongside ADR 0014 for the current per-Project FAISS design.
Write the ADR as part of the change, not afterwards.

## 7. Smaller items

**The prompt forbids formatting the renderer supports.**
`projectSystemPrompt` bans headers, bold and lists; `MarkdownText` styles all of them; three of nine answers used them anyway.
Resolve the contradiction rather than repeating the instruction.
Allowing lists is the honest option, since the renderer already handles them and comparison answers are genuinely clearer as lists.

**Document the gateway.**
`OPENAI_BASE_URL` is honoured by `@ai-sdk/openai` and is the only reason this run could use the production chat path.
Add it to `.env.example` with the OpenRouter value as a comment.
This is also the cheapest answer to the previous run's complaint that `getModel()` supports OpenAI only: an OpenAI-compatible gateway reaches Gemini, Claude and others without touching `model.ts`.

**Set the embedding model explicitly.**
`.env.example` ships `AI_EMBEDDING_MODEL=text-embedding-3-small`, which silently overrides the Gemini default when `AI_EMBEDDING_PROVIDER=gemini` is set.
Make the coupling explicit in the comment, or leave the variable unset so `DEFAULT_MODELS` applies.

**Re-embedding runs inside a user request.**
`ensureIndexed` re-embeds up to 100 Evidence items inline on the first search after an embedder change.
It worked here, and 4 items is nothing, but on a real Project this is a large latency spike on someone's first search.
Move it to the event subscriber or a background job, keeping the lazy path as the fallback.
While in that function: `backfilledProjects` is a `Set` parked on `globalThis` that gains an entry per Project and is never evicted.
Harmless at this size, worth bounding if the code is touched anyway.

**Snippets can silently drop the answer.**
`SNIPPET_CHARS` is 500, and in control c1 the Weekly sync minutes snippet was cut mid-sentence at "Ben: has roughly 4 hours available before ".
The answer omitted the reviewer-capacity point entirely.
Marking a match as truncated in the tool result would let the model know it is looking at a fragment, which is a smaller change than any retrieval work and addresses a demonstrated loss of fact.
