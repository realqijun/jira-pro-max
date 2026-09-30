# Implementation notes - #114 Task and Milestone Proposals

What was built follows `plan.md`; this file records where it deviated and what was verified.

## Deviations from the plan

- Duplicate check covers every item Proposal already raised, not only pending ones.
  A title the PM rejected, restated in a later Evidence item, is not raised again; an accepted one became a Task or Milestone and is caught by the existing-item check.
- Titles repeated inside one pass are deduplicated as well as fingerprints, so two excerpts naming the same work yield one Proposal.
- `pickExtractor` stayed in `extract.ts` unchanged; `pickExtractors` in `extract-items.ts` wraps it, which avoids a circular import and keeps the model-or-heuristic choice in one place.
- `AiSpan` gained `item_extraction`, and `docs/submission/m19-analytics.md` lists the fourth span.
- The generated migration re-created the primary key before adding the `pass` column it references; the two statements were reordered by hand and the migration was run against a copy of the local dev database with 32 existing rows, which all became `pass = decision`.

## Adversarial review of PR #118

An adversarial reviewer found no blockers and six should-fix issues, four proven with throwaway scripts; all six are fixed on the branch.

- Two pieces of work cited by one sentence collapsed into one Proposal: the item fingerprint now includes the title, and an in-pass repeat is counted as discarded.
- The duplicate rule dropped longer and negated titles ("Set up CI pipeline for the mobile app", "Do not review design doc"): it now needs 80% word coverage and folds accents.
- "2026-02-30" passed as a date: dates must round-trip through the calendar.
- The Conversation load could fail the item side, the item-Proposal load could fail the Decision side, and a failed read after commit rejected a pass whose writes had landed: each side now loads its own inputs inside its own `try`, and the post-commit review pointer degrades to none.
- A 100k-character pasted line blocked the heuristic for seconds: lines over 500 characters are skipped and the date suffix pattern is linear.
- The heuristic turned "will not attend", "will be on leave" and "Action: none" into Tasks, and two People's commitments in one sentence into one: it now skips those and splits on "and <known Person> will".

A second adversarial review found three heuristic gaps and two stale comments, all fixed:

- A decision verb anywhere on a line hid the commitments beside it ("We decided to ship Friday. Priya will book the venue."): the check now applies per sentence.
- A transcript turn over 500 characters was skipped whole: long lines are now split into sentences and each sentence is capped on its own.
- "and then Marcus will" did not split into a second Task.
- The `item_proposals.fingerprint` comment omitted the title, and the injected-extractor attribution is now commented.

Accepted as known limits: two concurrent model passes can each raise the same work under different excerpts (as for Decisions); the first item pass after deploy sends all existing Sources in one call; the M12 batched-versus-per-source comparison in `scripts/eval.mts` now includes the item call on the batched side only, as its comment says; the duplicate check compares against the items and Proposals loaded before the extractor call, so one created during the call is not compared.

## Verification

- `npx vitest run src/server/modules/proposals`: 77 tests, including a snapshot that pins the Decision prompt byte for byte across the refactor.
- End to end through the UI on a dev server with `PROPOSALS_EXTRACTOR=heuristic` and the local database: adding Evidence with an action item, a `Milestone:` line and a decision sentence produced one Task Proposal, one Milestone Proposal and one Decision Proposal from the automatic pass, one `proposal_pass_sources` row per pass, and no rows in `tasks`.
- `e2e/flows.spec.ts` (21 flows) and `e2e/propose-review.spec.ts`: green four runs out of five.
  One run on a cold dev server failed a `toBeHidden` in the proposals flow and did not reproduce in three further runs with two workers.
- Two pre-existing e2e failures on `main` were fixed on the way: the auth flow never dismissed the product tour that signup starts, and the command-palette flow pressed ⌘K before the shell's listener had hydrated.
- No UI changed, so there is no UI proof for this ticket; the review surface is #115.
