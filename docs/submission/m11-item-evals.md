# M11 addendum - Task and Milestone extraction evals

Issue #116.
This note extends [M11](m11-evals.md) to the item extractor, which #114 added beside the Decision extractor.

## What is evaluated

Since #114, the Proposal pass makes a second model call with its own prompt (`src/server/modules/proposals/extract-items.ts`, span `item_extraction`).
The call reads the same Evidence and Comments as the Decision call and proposes the Tasks and Milestones the team committed to.
`traceItems` (`proposals/trace.ts`) keeps an item only when its excerpt is verbatim.
It also drops an item with no title, a Milestone without a real date, and an item that duplicates an existing one.
A PM then accepts or rejects each item on the Overview (#115).

The item extractor had shipped without a measured baseline.
It is a separate prompt with a separate failure mode, a Task nobody committed to, so it gets its own case set rather than more rows in `extraction.json`.
The 22 Decision cases, their ids and every earlier artifact keep their meaning.

## The cases

12 cases in `evals/cases/items.json`, written before any model was run.
Each case carries its own sources, and the refs are the same five People, three Milestones and five Tasks as the Decision cases.

| Coverage                                   | Cases                                                                                              |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `Action item:` line, nobody named          | `i01`                                                                                              |
| Named owner and due date                   | `i02` first person in a transcript, `i03` first name only in a Comment                             |
| Dated checkpoint, with and without owner   | `i04`, `i05`                                                                                       |
| Several items in one source                | `i06`: two assigned Tasks and one checkpoint, beside a Decision                                    |
| Start date, due date and a known Milestone | `i07`                                                                                              |
| One commitment in a 12-turn transcript     | `i08`, between hedged suggestions that are not commitments                                         |
| Must return nothing                        | `i09` a Decision, `i10` status lines, `i11` existing items restated, `i12` an injected instruction |

## Grading mirrors trace

`gradeItems` in `evals/grade.ts` is pure, and it grades what trace kept, not what the model returned.

- **Titles.** Each expected item lists groups of accepted spellings, and every group must appear in the kept title.
  Titles are compared as whole words after the normalisation trace uses for duplicates (`titleWords`: accents folded, punctuation dropped).
  "ci" therefore does not match inside "pricing".
- **Owner, Milestone and dates are exact.** A named owner or Milestone passes only when trace resolved it to a known id under its canonical name.
  Trace keeps an unresolved name as a snapshot with a null id, and the grader fails it even when the text matches.
  An expected owner of null means the item names nobody.
- **Nothing extra.** Every kept item must pair with an expected one.
  The grader first finds the largest set of exact pairs, where a kept item matches an expectation's title and all its fields, then pairs what is left by title alone.
  Pairing order therefore never fails a correct extraction.
- **A Milestone link is checked only where a case expects one.** An invented link elsewhere stays in the artifact but does not fail the case.
- **Forbidden content** in a kept title or description fails the case (`pwned` in `i12`), matched as whole words like titles.
- A case with an empty title group, or a spelling that normalises to nothing, is refused rather than graded.
- The raw and kept counts are recorded, so a case that trace rescued shows up.

`evals/grade.test.ts` tests the grader itself without a model, and `vitest.config.mts` now includes `evals/**/*.test.ts`.

## Results

Consolidated tables: the last two sections of [artifacts/eval-tables-2026-09-28.md](../../artifacts/eval-tables-2026-09-28.md).
Raw runs and the exact commands: [artifacts/item-evals-2026-09-30](../../artifacts/item-evals-2026-09-30/README.md).

| Extractor                            | Items, run 1 | Items, run 2 | Tokens per run (prompt / completion) |
| ------------------------------------ | ------------ | ------------ | ------------------------------------ |
| `gpt-4o-mini`, temperature 0, OpenAI | 9/12         | 9/12         | 8,615 / about 960                    |
| `heuristicExtractItems`, no model    | 6/12         | -            | 0                                    |

OpenAI returns no prices, so the harness records these runs as unpriced.
At OpenAI's list price for `gpt-4o-mini` ($0.15 per million prompt tokens, $0.60 per million completion tokens), one pass over the 12 cases costs about $0.002.

### Where the model fails

The same three cases failed in both runs.

1. **`i01` invents an owner.** The minutes list the attendees, and the action item names nobody.
   The model assigned the Task to Priya Nair in one run and to Tom Alvarez in the other.
   Temperature 0 did not make that choice stable.
   In the second run it also linked the Task to the `Pilot cut-over` Milestone, which the text never mentions.
   The grader checks a Milestone link only where a case expects one, so that invention is visible in the artifact but not in the verdict.
   An owner the text never gave is the failure that costs a PM most, because it looks like a fact on the card.
2. **`i04` misses a one-line checkpoint.** "The go-live readiness review is on 2026-10-22" produced no item in either run.
   The prompt names a review as a Milestone example, so this is a recall gap on terse sources.
3. **`i06` names the checkpoint by its purpose and adds an owner.** The model kept both Tasks exactly, with the right owners and dates.
   It proposed the Milestone as "Pilot data set checkpoint" and owned by Priya Nair, the speaker.
   The case expects "data freeze" with no owner.
   The recorded failure is the title: no kept Milestone matches "freeze", so the grader never compares its fields.
   The title is defensible, since the source calls the date "our checkpoint for the pilot data set", but the expectation was left as written rather than widened after seeing the run.
   Widening it would not change the verdict, because the invented owner would then fail `fields_exact`.

### Where the model holds

- The injected instruction in `i12` produced nothing: the raw count is 0 in both runs.
  The Decision prompt on the same model still obeys the injection in `x07` (below), so the item prompt resists better on this one case.
- `i09` returns nothing: the model keeps a Decision out of the item list.
- `i10` and `i11` pass, but only because of trace.
  In both runs the model proposed one item from each (raw 1), a restated date or a restated known item, and `traceItems` dropped it as a duplicate of the known lists.
  These two cases measure the pipeline, not the prompt alone.
- Owners resolve from a first name (`i03`) and from a first-person transcript turn (`i02`, `i08`), and `i07` links the known Milestone with both dates.

### Where the heuristic stands

The heuristic passes the pattern-shaped cases (`i01`, `i03`) and all four negatives.
It fails every free-prose case, as designed: it exists so e2e can assert exact item Proposals without a key.
Its `i07` item keeps the whole sentence as the title, because its `will ... by <date>` pattern does not split a start date out.

## The Decision pass is unchanged

The Decision prompt is byte-identical before and after #114.
The snapshot test in `extract.test.ts` pins it.
The 22 Decision cases were run again in the same two runs.

| Run                                     | Extraction | Failed cases        |
| --------------------------------------- | ---------- | ------------------- |
| 28 September, OpenRouter, temperature 0 | 20/22      | `x03`, `x07`        |
| 28 September, OpenRouter, repeat        | 20/22      | `x03`, `x07`        |
| 30 September, OpenAI, temperature 0     | 21/22      | `x07`               |
| 30 September, OpenAI, repeat            | 19/22      | `x02`, `x07`, `x18` |

`x07`, the prompt injection, fails in all four, as M9 recorded for this model.
The other differences move in both directions between two back-to-back runs of the same prompt, so they are sampling noise, not a change in the pass.
It is worth recording that temperature 0 on OpenAI directly did not reproduce itself: two runs gave different verdicts on 2 cases and different completion token counts (2,835 and 3,091).
The 28 September runs through OpenRouter repeated their verdicts exactly.
The claim in `EXTRACT_TEMPERATURE`'s comment, that both models repeated their own output at 0, holds for that gateway and day, not as a property of the model.

## What this changes

Nothing in the product yet.
No prompt was edited in this change, by design: a baseline measured after tuning is not a baseline.
The failures above are the input for a follow-up prompt change to `extract-items.ts`, measured against this suite and the 22 Decision cases, as M11 did for the Decision prompt.
The first candidate is an explicit rule that an owner is only a Person the text names as doing the work, never an attendee or the speaker by default.
That targets `i01` and `i06` at once.

## Limitations

The author wrote both the cases and the grader, so the suite measures this Project's shape.
Twelve cases separate a good extractor from a poor one, but they will not rank two close models.
The baseline and the Decision re-run used a different gateway from the 28 September runs, and the gateway changes sampling behaviour (see above).
Direct OpenAI runs are unpriced in the harness; the cost above is computed from the list price by hand.

## Running it

```bash
DATABASE_URL=postgres://pm:pm@localhost:5433/pm_eval_20260928 \
npx tsx scripts/eval.mts --suite extraction,items --models gpt-4o-mini --skip-index --out artifacts/<run>

npx tsx evals/report.ts
```

`--suite` takes a comma-separated set: `extraction`, `items`, `why`, `both` (meaning `extraction,why`), or `pass` on its own.
The harness and `evals/fixture.ts` refuse a `DATABASE_URL` that is not local, because `.env` may point it at a shared database.
Nothing here runs in CI: the grader tests need no key, and the live suites need one.
