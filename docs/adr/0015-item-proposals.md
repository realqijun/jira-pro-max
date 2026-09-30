---
status: accepted
---

# Tasks and Milestones are proposed by a second extractor call into their own table

The Proposal pass (ADR 0008) extracts Decisions from Evidence and Comments and holds them for the PM to confirm.
The same material also records the work a team committed to - action items, assignments, dated checkpoints - and the Decision prompt explicitly throws that away.
Issue #114 proposes it as Tasks and Milestones.
Four decisions in that were not obvious.

## A second call, not a wider prompt

One call returning `{ decisions, tasks, milestones }` would be cheaper per pass.
It would also change the prompt behind the 22 measured extraction cases in `evals/cases/`, and the prompt history in `artifacts/prompt-iteration-2026-09-28/` shows that edits which improve one case usually break another.
The item extractor (`src/server/modules/proposals/extract-items.ts`) is therefore its own `generateObject` call with its own prompt, span `item_extraction`.
It shares the fenced-source prompt builder and the greedy-with-retry call with the Decision extractor, and a snapshot test pins the Decision prompt so the refactor cannot drift it.

The cost is a second call whenever a pass reads new Sources, re-sending the same source text.
The item prompt leaves out the recent Conversation, which action items rarely need, so it is somewhat smaller than the Decision prompt.
#116 measures the item prompt on its own eval cases.

## Each extractor keeps its own bookkeeping

`proposal_pass_sources` records which Source text a pass has read, so an unchanged Source is never billed twice.
With two calls, one shared row would force a choice: mark a Source read when either call fails, and the failed side never retries; or mark it read only when both succeed, and a flaky item call makes the Decision call run again on every save.
The row now carries `pass` (`decision | item`) in its primary key, and each side of `runPass` writes its own rows in its own transaction.
Each side catches every error it can raise and reports `{ skipped: "failed" }`, so one side failing never blocks, rolls back or re-runs the other.
Existing rows migrated as `decision`, so the first pass after deploy reads every existing Source once for items.

## One table for both kinds, with a jsonb payload

`item_proposals` holds Tasks and Milestones with `kind: task | milestone` and a `fields` jsonb payload shaped by kind.
`decision_proposals` has flat columns because it has one shape; a table per item kind would duplicate the status, fingerprint, Source and extractor columns and the review queries for two small shapes.
The payload is not trusted when it is accepted: #115 re-validates it through `createTaskSchema` and `createMilestoneSchema` and writes through `tasksService` / `milestonesService` under `via: "assistant"`, like any other Assistant write (ADR 0007).
`decision_proposals` is untouched.

Each name in the payload (`assigneeName`, `milestoneName`, `ownerName`) is kept as the extractor wrote it, beside the id it resolved to at pass time, or null.
A Task can name a Milestone that is itself still a pending Proposal; #115 resolves the name again when the Task is accepted.

`itemId` records what an accepted Proposal became and is deliberately not a foreign key: the Task may be deleted later, and the Proposal is history.
Every reader must tolerate an `itemId` that points at nothing.

## What is kept

An item Proposal survives only when every excerpt it cites is verbatim in a Source of the Project, the same traceability rule as Decisions.
It has a title; a Milestone has a real calendar date in ISO form, because a Milestone is a dated checkpoint; other dates (including "2026-02-30") are dropped, and a start date after the due date is dropped.
It is not a duplicate of an existing Task or Milestone, of any item Proposal of the same kind already raised (pending, accepted or rejected), or of one kept earlier in the same pass.
The existing items and Proposals are those the pass loaded before its extractor call; one created while the call runs is not compared, and accept re-validates what remains.
Duplicate means equal words once accents and punctuation are gone, or one title inside the other when the shorter covers at least 80% of the longer.
Plain containment is too loose: "Set up CI pipeline for the mobile app" is new work beside "Set up CI pipeline", and "Do not review design doc" is not "Review design doc".
The fingerprint is the item kind, the primary Source, its excerpt and the title.
The title is in it because one sentence often commits to two pieces of work ("Alice will draft the spec and Bob will review it"), which a Decision-style excerpt key would collapse into one; the duplicate rule, not the fingerprint, stops a restated title being raised again.

A deterministic heuristic extractor mirrors the model so e2e runs without a key, and it is also the production path for a User with no model configured: `Action item:` / `TODO:` lines, `<known Person> will ... [by YYYY-MM-DD].`, and `Milestone: <name> on YYYY-MM-DD`.
It only reads a "will" clause whose subject is a known Person, which keeps "Results will improve" and "We will revisit" out, splits a sentence where a second known Person commits ("and Marcus will", "and then Marcus will"), and skips "will not", "will be" and empty action items.
A decision verb skips only the line or sentence it is in, so a commitment beside a Decision on the same line is still read.
Lines and sentences longer than 500 characters are not matched, which bounds the cost of its lazy patterns on pasted text; a long transcript turn is still split into sentences and each is read on its own.

## Accepting (#115)

Accepting creates the Task or Milestone through `tasksService.create` / `milestonesService.create` under `via: "assistant"`, and three things must commit or roll back with it: one `evidence_links` row per cited Evidence, their Activity Events, and the Proposal turning `accepted`.
`mutate` opens its own transaction and publishes after it commits, so a second `mutate` for the links would be a second transaction.
Both creates therefore take an `afterCreate(tx, rec, row)` hook that runs inside their own `mutate`, under the same `Recorder`.
`decisionsService.create` instead takes a `proposalId` and marks the Proposal itself; doing the same here would make the Task and Milestone modules import the proposals repository and learn Evidence linking, while the hook keeps them unaware of Proposals.
The hook marks the Proposal accepted only while it is still `pending` and throws otherwise, so a repeated click or a racing accept or reject rolls its item back.

What one click creates is computed when the Overview lists the Proposal and again at accept (`acceptInputOf` in `src/server/modules/proposals/accept.ts`).
An id resolved at pass time is kept only if it still exists in the Project, and a missing one is resolved again by its name, which is how a Task links to a Milestone Proposal accepted before it.
The result is parsed by the create schema; a payload it refuses can still be edited and accepted, or rejected.
Only Evidence Sources become links, and only those whose Evidence still exists; Comment Sources stay on the Proposal.
Whether the PM edited before accepting is measured against that computed input, not against which path posted it, as for Decisions.

## Consequences

- `ITEM_PROPOSAL_KINDS` and `PROPOSAL_PASSES` are fixed vocabularies with Drizzle enums (migration `0025_item_proposals`).
- `runPass` keeps its Decision outcome at the top level and reports the item side under `items`; `proposalId` points at Decision Proposals only, because item Proposals are reviewed on the Overview.
- Analytics: `item_proposal_generated` (counts per kind, silent when nothing was created), `item_proposal_accepted` (with `kind` and `edited_before_accept`) and `item_proposal_rejected`, never titles, excerpts or text.
- The Assistant has no tools over item Proposals; review stays a human click, as for Decisions (ADR 0008).
- Nothing is written to `tasks` or `milestones` until the PM accepts.
