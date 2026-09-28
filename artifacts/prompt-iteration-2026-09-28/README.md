# Prompt iteration driven by the eval suite - 28 September 2026

Four successive edits to the extractor prompt and one to the Project system prompt, each measured on the same cases as the [bake-off](../model-bakeoff-2026-09-28/README.md).

**Outcome: extraction went from 16/22 to 20/22 for `gpt-4o-mini` and stayed at 21/22 for `gemini-2.5-flash`. Answers went from 19/20 to 20/20 for `gemini-2.5-flash` and stayed at 13/20 for `gpt-4o-mini`. Two of the four edits made things worse before the next one fixed them, which is the point of keeping every stage here.**

## The failures that started it

| Case                           | What the bake-off showed                                                                                                                            |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `x02-two-decisions-one-source` | All three models returned one Proposal from a transcript that records two Decisions. Systematic recall gap, not a model quirk.                      |
| `w06-why-two-half-days`        | `gemini-2.5-flash` wrote "There is no recorded decision about that" without calling `search_decisions`, although Decision D-4 answers the question. |

## The stages

| Stage                       | Edit                                                                                                                                           | `gpt-4o-mini` | `gemini-2.5-flash` |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------------------ |
| baseline                    | -                                                                                                                                              | 16/22         | 21/22              |
| `one-proposal-per-decision` | "Return one proposal per Decision. A single source often records several ... read it to the end"                                               | 17/22         | 20/22              |
| `precision-guard`           | added "Reading a source to the end never lowers that bar"                                                                                      | 18/22         | 20/22              |
| `negative-definition`       | moved the negative list ("a status line, a date restated from a plan, an action item ... are not Decisions") up beside the definition sentence | 19/22         | 19/22              |
| `approvals-are-decisions`   | added "An approval, an authorisation and a sign-off are Decisions"                                                                             | 20/22         | 21/22              |

The per-case verdicts for every stage are in [../eval-tables-2026-09-28.md](../eval-tables-2026-09-28.md).

What each stage actually did:

- The recall rule fixed `x02` and `x19` for `gpt-4o-mini`, and broke `x11` (a CSV plan export) and `x17` (an action-item list): it proposed 4 and 3 Decisions from sources that record none. Recall bought at the cost of precision, visible immediately because the suite has abstention cases.
- The precision guard restored both, but did not stop either model treating "Pilot cut-over holds at 2026-10-06" in a status update as a Decision.
- Moving the negative definition next to the definition sentence fixed that status-update case for both models, and then suppressed `x21`, where a sponsor approves a go-live date with no alternatives discussed. `gemini-2.5-flash` dropped it entirely.
- Naming approvals explicitly recovered `x21` without losing the negative definition.

## The one change to the answer prompt

`WHY_RULES` already said the abstention sentence may only follow an empty `search_decisions` result. It now also says what to do instead: call the tool, and never answer a "why" question from the Project summary alone. `w06` passes after the change, and `gemini-2.5-flash` answers all twenty cases.

`gpt-4o-mini` stayed at 13/20. Its failures are not the abstention rule: it answers retrieval questions from the system prompt without calling tools at all, which a prompt sentence did not fix.

## One case was rewritten, not just the prompt

`x09` originally asserted that a Decision to keep one named security reviewer should also yield a `person` Assumption. No model produced one, and on review the expectation was wrong: under [ADR 0008](../../docs/adr/0008-decision-memory-graph.md) an Assumption is a condition the Decision rests on, and "Nadia remains the reviewer" was the Decision itself, not a condition under it. The case now records a different choice (in-house review versus an external auditor) which genuinely rests on that person. The `x09` column of the stage table therefore compares two slightly different cases, and the final stage is the one to read.

`gemini-2.5-flash` shows `x09` failing at the final stage for an unrelated reason: `AI_APICallError: Invalid JSON response` from the gateway. That is a transport failure, counted as a failure rather than retried away.

## What did not get fixed

`gpt-4o-mini` still extracts the injected "dashboard was approved" sentence in `x07`, and still splits one Decision into two in `x16`. The traceability filter cannot help with either: both excerpts are verbatim. The conclusion recorded in [m9](../../docs/submission/m9-model-bakeoff.md) is that this is a model choice, not a prompt problem.

## Files

- [results.json](results.json): stage `one-proposal-per-decision`, both suites.
- [precision-guard/](precision-guard), [negative-definition/](negative-definition), [approvals-are-decisions/](approvals-are-decisions): extraction suite per later stage.
- [answers-after/](answers-after): the 20 answer cases after the `WHY_RULES` edit.

## Reproducing

Stages are prompt edits in `src/server/modules/proposals/extract.ts` and `src/server/modules/assistant/prompt.ts`; only the final state is in the working tree. To re-measure the current prompt:

```bash
DATABASE_URL=postgres://pm:pm@localhost:5433/pm_eval_20260928 \
OPENAI_API_KEY=<openrouter-key> OPENAI_BASE_URL=https://openrouter.ai/api/v1 AI_PROVIDER=openai \
npx tsx scripts/eval.mts --out <dir> --suite both --skip-index \
  --models openai/gpt-4o-mini,google/gemini-2.5-flash
```
