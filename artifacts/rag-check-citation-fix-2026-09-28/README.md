# RAG re-run after the Evidence citation fix - 28 September 2026

Same harness, fixture database, embedder and chat model as [the previous run](../rag-check-openrouter-2026-09-28/README.md), re-run after steps 1 to 3 of that run's improvement plan were implemented.
The key was supplied by the User through the environment only and is in no file here.

**Outcome: 16 of 16 citations across the 9 answers resolve to a real Evidence item of the Project, 14 of them because the model copied a tool's `cite` verbatim and 2 because the render boundary repaired a link the model wrote itself. The previous run scored 10 of 16, and 0 of 6 when neither the prompt nor the tool supplied a path.**

The copied-versus-repaired split matters, and the headline number alone hides it.
Both repaired citations come from cases 05 and 06, whose prompts instruct the model to build the URL from a template - the one thing the new rules tell it not to do.
In both it wrote `https://projects/<id>/evidence?item=<id>`, and the boundary put the eaten path segment back.
No answer whose prompt left the citation to the model needed repairing.

## What changed in the code

- The Evidence tools return `href` and `cite`, so `get_project_summary`, `list_evidence`, `search_evidence` and `read_evidence` hand the model a link to paste instead of a bare id.
- The system prompt states the citation rule for every tool result and no longer contains a copyable placeholder path.
- `internalHref` validates both route segments, so a structurally valid path with a placeholder Project id no longer renders as a link.

## Citation results

Every Markdown link in `results.json` and `results-control.json` was passed through the production `internalHref` and its `item` id checked against the Project's Evidence.
A citation counts as copied only when the exact `[label](href)` string was in a tool result of that turn or in the Project summary the system prompt carries.

| Case                    | Citations | Copied | Repaired | Dead | Was before the fix                              |
| ----------------------- | --------- | ------ | -------- | ---- | ----------------------------------------------- |
| 01-access-blocker       | 2         | 2      | 0        | 0    | 2 of 2 (prompt supplied the template)           |
| 02-reviewer-capacity    | 1         | 1      | 0        | 0    | 1 of 1 (prompt supplied the template)           |
| 03-conflicting-dates    | 2         | 2      | 0        | 0    | 2 of 2 (host stripped from an absolutised path) |
| 04-no-evidence          | 1         | 1      | 0        | 0    | 0 of 1 (`](href)` placeholder pasted)           |
| 05-all-labels           | 1         | 0      | 1        | 0    | 1 of 1                                          |
| 06-linked-task          | 1         | 0      | 1        | 0    | 1 of 1                                          |
| c1-citation-no-template | 3         | 3      | 0        | 0    | 0 of 3 (bare `https://example.com`)             |
| c2-why-no-decisions     | 3         | 3      | 0        | 0    | 3 of 3 (`search_decisions` already had `cite`)  |
| c3-plain-text           | 2         | 2      | 0        | 0    | 0 of 2 (`/projects/.../evidence?item=<uuid>`)   |

The two cases the plan named as the decisive ones, `c1-citation-no-template` and `c3-plain-text`, now cite correctly.
Both had to supply the path themselves, which is what a real User's question leaves the model to do.

The repaired pair needed one further change to the render boundary.
Prefixing a scheme to a relative path turns its first segment into the host, so `https://projects/<id>/evidence` parses with host `projects` and the in-app path is lost.
`internalHref` now puts that segment back when the host is literally `projects`, which is the same repair as the host-stripping it already did, and the recovered path is validated like any other.

## Defects this run still shows

These are not citation defects and this work does not address them, but they are in the answers and should not be read as clean:

- Three answers (`03-conflicting-dates`, `c1`, `c3`) use numbered lists and bold, which `projectSystemPrompt` forbids and `MarkdownText` renders happily. Step 7 of the previous plan proposes resolving the contradiction rather than repeating the instruction.
- `05-all-labels` and `c1-citation-no-template` answered from `search_evidence` snippets without calling `read_evidence`. Snippets are capped at 500 characters, so this is the same loss-of-fact risk as finding 7 of the previous run.
- Cases 05 and 06 followed their prompt's instruction to build the URL, in preference to the system prompt's instruction never to write a link. Prompt precedence, not a broken tool.

Two defects of the previous run are gone.
`04-no-evidence` no longer borrows the "There is no recorded decision" phrasing without calling `search_decisions`: it now says no source states the figure and cites the Evidence it read.
No answer contains a placeholder path or an invented host.

## Files

- [results.json](results.json): the 6 original prompts.
- [results-control.json](results-control.json): the 3 control prompts, which do not hand the model a URL template.
- [retrieval.json](retrieval.json), [index.json](index.json), [configuration.json](configuration.json): as in the previous run.

Retrieval is unchanged and was not the subject of this work: ranking is still weak and there is still no relevance signal.
Steps 4 to 7 of the improvement plan remain open.

## Reproducing

```bash
DATABASE_URL=postgres://pm:pm@localhost:5433/pm_rag_check_20260928 \
OPENAI_API_KEY=<openrouter-key> \
OPENAI_BASE_URL=https://openrouter.ai/api/v1 \
AI_EMBEDDING_PROVIDER=openai AI_EMBEDDING_MODEL=openai/text-embedding-3-small \
AI_PROVIDER=openai AI_MODEL=openai/gpt-4o-mini \
npx tsx scripts/rag-check.mts artifacts/rag-check-citation-fix-2026-09-28
```

Add `SKIP_INDEX=1 PROMPTS_FILE=../rag-check-openrouter-2026-09-28/prompts-control.json RESULTS_NAME=results-control.json` for the control set.
