# Plan - #115 Review and accept Task and Milestone Proposals

Branch `feat/115-review-item-proposals`, stacked on `feat/114-item-proposals` (PR #118), because #115 is blocked by #114.
Rebase onto `main` once #118 merges.
Builds on ADR 0007 (the Assistant acts through services with `via`), ADR 0008 (nothing enters the Project until a human accepts) and ADR 0015 (item Proposals, `item_proposals`, `itemId` not a foreign key).

## 1. Summary

The PM sees pending Task and Milestone Proposals on the Project Overview, in the same queue as Decision Proposals, and accepts, edits-and-accepts or rejects each one.
Accepting creates the Task or Milestone through `tasksService.create` / `milestonesService.create` under `via: "assistant"`, links every cited Evidence to it, and marks the Proposal accepted, all in one transaction.
The Decisions page keeps showing Decision Proposals only.

Verified facts that shape the plan:

- `mutate(ctx, fn)` (`src/server/core/mutation.ts`) opens its own transaction and its own `Recorder`, and publishes after commit.
  Calling `tasksService.create` and then `evidenceService.link` would be two transactions, and a nested `mutate` would publish before the outer commit.
  One transaction therefore needs the extra writes to run inside the create's own `mutate`.
- The Decision precedent: `decisionsService.create` takes a `proposalId` and calls `proposalsRepo.markAccepted` inside its transaction, conditional on `status = pending`, and throws `ConflictError` when no row changed (`src/server/modules/decisions/service.ts`).
- `evidenceService.link` records `rec.updated(<item>, field "evidence")` plus `rec.signal("evidence.linked")`, and is idempotent; its body is the logic an accept needs per cited Evidence.
- `TaskDialog` and `MilestoneDialog` in create mode use only `refs`; `tasks` and `dependencies` are read in edit mode only.
  The Overview page does not load `ProjectRefs` today.
- `createTaskSchema` has `projectId`, `title`, `description`, `statusId`, `priority`, `assigneeId`, `teamId`, `milestoneId`, `startDate`, `dueDate`, `estimateHours`, `labelIds`.
  `createMilestoneSchema` has `projectId`, `name`, `description`, `dueDate` (required), `statusId`, `ownerId`.
  An omitted `statusId` gets the Project default through `statusesService.resolveForNewItem`.
- `tasksService.create` throws `ValidationError` for a Person, Milestone or Team not in the Project and for `startDate > dueDate`.
  A proposed id resolved at pass time may point at a Person or Milestone deleted since.
- Existing e2e flows count `data-testid="proposal-card"`; item cards need their own test id so those counts hold.
- `item_proposal_rejected` already carries `kind` (#114).

## 2. Domain and design decisions

- **Accept input** (`acceptInputOf(item, refs)`, pure, in `src/server/modules/proposals/accept.ts`): the exact `CreateTaskInput` / `CreateMilestoneInput` a one-click accept submits.
  - Title or name, description and dates are copied from `fields`.
  - Each id is re-checked against the Project's current People and Milestones: a stale id is dropped, and a missing id is resolved again by its `*Name` with the same `byName` rule the pass uses (exported from `trace.ts`).
  - This is what makes the deferred Milestone link work: a Task whose `milestoneName` named a Milestone Proposal accepted since now links to it; otherwise `milestoneId` stays null.
  - `startDate` is dropped when it is after `dueDate` (already enforced in trace, re-checked because the PM never sees the stale case).
  - The result is parsed with `createTaskSchema` / `createMilestoneSchema`, so a malformed payload fails as a `ValidationError` rather than reaching the database.
- **Service** (`proposalsService` in `src/server/modules/proposals/service.ts`):
  - `listPendingItems(ctx, projectId)` returns each pending row with its `acceptInput`, so cards show the resolved names and the dialog prefills exactly what one click would create.
  - `acceptItem(ctx, { id, input? })`: `assertOwnsProject` through the row, `ConflictError` unless pending, `input` defaults to `acceptInputOf`.
    `input.projectId` must equal the Proposal row's `projectId`, else `NotFoundError("Proposal")`; this check is required, because `tasksService.create` only re-checks that the User owns `input.projectId`, so a second owned Project would otherwise pass.
    Writes through `tasksService.create` / `milestonesService.create` with `{ ...ctx, via: "assistant" }` and an `afterCreate` hook that, inside the same transaction, links each distinct cited Evidence that still exists and calls `itemProposalsRepo.markAccepted(tx, id, itemId)` conditional on `pending`, throwing `ConflictError` when no row changed so the item and its links roll back.
    Comment Sources stay on the Proposal only.
    The hook filters `sources` to `kind === "evidence"`, deduplicates the ids, and keeps only rows `evidenceRepo.findByIds(tx, ids)` returns whose `projectId` is the Proposal's (`findByIds` is not project-scoped) before calling `linkEvidenceIn`, because `linkEvidenceIn` (like `link`) throws `ValidationError` for missing Evidence and would abort the accept.
    After commit it records `item_proposal_accepted`.
  - `rejectItem` exists from #114 and is unchanged.
- **`afterCreate` hook** on `tasksService.create(ctx, input, afterCreate?)` and `milestonesService.create(ctx, input, afterCreate?)`: `(tx, rec, row) => Promise<void>`, awaited inside the `mutate` after `rec.created`.
  This keeps the tasks and milestones modules free of any proposals import (unlike `decisionsService.create`, which knows about Proposals), and keeps one `Recorder`, so every Activity Event carries `via: "assistant"` and publishes after the single commit.
  The alternative that mirrors the Decision precedent, a `proposalId` parameter on each create, would make two more modules import `proposals/repository.ts` and teach them Evidence linking; ADR 0015 records why the hook was preferred.
- **Evidence link inside a transaction**: extract the body of `evidenceService.link` into an exported `linkEvidenceIn(tx, rec, input)`; `link` becomes `mutate(ctx, (tx, rec) => { assertOwnsProject; return linkEvidenceIn(...) })`.
  Behaviour of `link` is unchanged.
- **Repository**: `itemProposalsRepo.markAccepted(db, id, itemId)`, same guard as `markRejected`, sets `itemId` and `resolvedAt`.
- **Edited before accept** (`itemEditedBeforeAccept(base, accepted, defaultStatusId)` in `analytics.ts`): true when the submitted input differs from `acceptInputOf` on any field after trimming and treating empty as null, or supplies a field the Proposal never had (`priority` other than `none`, `teamId`, `estimateHours`, labels, a `statusId` other than the Project default).
  The dialog always posts `statusId`, so it is compared against the default Status id the create resolved (`row.statusId` of the created item when `acceptInputOf` had none), never against `undefined`, or every untouched dialog save would count as an edit.
  Measured against what was proposed, not against which path posted it, the same rule as `editedBeforeAccept` for Decisions: a dialog saved untouched is not an edit.
- **Analytics**: `item_proposal_accepted` with `project_id`, `proposal_id`, `kind`, `extractor`, `edited_before_accept`; never titles, excerpts or text.
  `item_proposal_rejected` already carries `kind` (#114) and stays as it is: the acceptance criterion reads as both events carrying `kind` and the acceptance carrying the edited flag, since a rejected Proposal was never accepted, edited or not.
  The same split holds for Decisions (`proposal_accepted` has `edited_before_accept`, `proposal_rejected` does not).
- **Actions** (`src/server/modules/proposals/actions.ts`, thin):
  - `acceptItemProposalAction({ id })` for one click and `rejectItemProposalAction({ id })`, JSON input.
  - `acceptTaskProposalAction(fd)` and `acceptMilestoneProposalAction(fd)` for the dialogs: `createTaskSchema.extend({ proposalId })` / `createMilestoneSchema.extend({ proposalId })`, then `acceptItem(ctx, { id: proposalId, input })`.
    Two actions rather than one union, because the dialogs post `FormData` and each already has one schema.
  - Each calls `revalidateProject(projectId)` on success.
- **UI**:
  - `src/widgets/attention/item-proposal-cards.tsx`: one card per pending item Proposal, `data-testid="item-proposal-card"`, labelled "Proposed task" or "Proposed milestone", showing title or name, the resolved Owner, Milestone and dates (unresolved names shown as written, marked "not in project"), and the Sources block reused from the Decision card.
    The shared Sources list is extracted from `proposal-cards.tsx` into `proposal-sources.tsx` so both cards render it identically.
  - `item-proposal-actions.tsx` (client): Accept, Edit and accept, Reject; Edit and accept opens `TaskDialog` / `MilestoneDialog` in place on the Overview.
  - `TaskDialog` and `MilestoneDialog` make `tasks` and `dependencies` optional (default `[]`, read only in edit mode) so the Overview need not load them, and gain an optional `proposal: { id; defaults }` prop: the action becomes the matching accept action with `proposalId` hidden, fields prefill from `defaults`, the title reads "Confirm proposed task" / "Confirm proposed milestone" and the submit label "Accept and create task" / "Accept and create milestone".
  - Overview (`src/app/(app)/projects/[projectId]/page.tsx`) loads `listPendingItems` beside `listPending`, and `loadProjectRefs` only when item Proposals exist; `sourceLabels` loads when either kind exists.
    `ProposalCards` renders the Decision cards and then the item cards inside its one `proposal-cards` section, so it stays one queue.
    Its props gain `items` (pending rows with `acceptInput`) and `refs` (nullable, present when items exist), and its `null` guard becomes "neither kind pending", so a Project with only item Proposals still renders the section.
  - `ProposeButton` (Decisions page) appends the item count to its note ("…, 2 tasks or milestones on the Overview") so a pass that raised only items does not read as "no suggested decisions".
- The Assistant still gets no tools over item Proposals (ADR 0008, ADR 0015).

## 3. Commit points

### Commit 1 - `Plan item Proposal review (#115)`

This file.

### Commit 2 - `Accept item Proposals through the Task and Milestone services`

Test first (`/tdd`), at the service seam, in `src/server/modules/proposals/accept.test.ts` (pure) and `service.test.ts` (database):

- `acceptInputOf`: copies fields; drops a stale Person or Milestone id; resolves an unresolved `milestoneName` to a Milestone created since; leaves it null when nothing matches; drops a `startDate` after `dueDate`.
- Accept a Task Proposal: one Task with the Project default Status, one `evidence_links` row per distinct cited Evidence (none for a Comment Source), the Proposal `accepted` with `itemId`, and Activity Events for the Task created and each link, all with `via = "assistant"`.
- Accept a Milestone Proposal: same, for a Milestone.
- Deferred re-resolution: accept the Milestone Proposal, then the Task Proposal that named it; the Task's `milestoneId` is the new Milestone.
- One transaction: when `markAccepted` finds the row no longer pending (simulated by rejecting it between the pre-check and the hook, or by accepting twice in parallel), no Task and no `evidence_links` row remains.
- A second accept or a reject after accept is a `ConflictError`; a stranger is refused on `acceptItem`.
- Edit and accept with a changed title and an added assignee creates the edited Task; `input.projectId` of another Project is refused.
- Evidence deleted since the pass is skipped, not an error; the other cited Evidence is still linked.
- Reject through `rejectItem`, then edit the Evidence so a later pass reads it again: the row is kept as `rejected` and nothing new is raised (#114 has the pass-side test; this one pins the review path end to end at the service).
- `itemEditedBeforeAccept`: an untouched dialog input (with the default `statusId` posted) is not an edit; a changed title, an added assignee, a non-default priority each are.
- `funnel.test.ts`: `item_proposal_accepted` payload with `kind` and `edited_before_accept` true and false, and no content fields.

Code:

- `tasks/service.ts`, `milestones/service.ts`: `afterCreate` parameter.
- `evidence/service.ts`: `linkEvidenceIn`.
- `proposals/accept.ts`, `repository.ts` (`markAccepted`), `service.ts` (`listPendingItems` with `acceptInput`, `acceptItem`), `analytics.ts` (`itemProposalAccepted`, `itemEditedBeforeAccept`), `trace.ts` (export `byName`).
- `src/shared/analytics/ai.ts` if the event name list lives there.

### Commit 3 - `Review item Proposals on the Overview`

- Before editing, capture `artifacts/before-item-proposal-review.png` of the Overview with pending item Proposals (they exist after #114 but have no surface, so the before shot shows their absence).
- Actions, `proposal-sources.tsx`, `item-proposal-cards.tsx`, `item-proposal-actions.tsx`, dialog `proposal` prop, Overview wiring, `ProposeButton` note.

### Commit 4 - `Cover item Proposal review end to end`

- `e2e/item-proposals.spec.ts` under `PROPOSALS_EXTRACTOR=heuristic`: sign up, create a Project, add one Evidence item with
  `Action item: Book the usability lab by 2026-10-10` and `Milestone: Pilot readout on 2026-10-20`.
  On the Overview, wait (retrying `toPass`, as `propose-review.spec.ts` does for the automatic pass) for exactly two item cards: "Proposed task" "Book the usability lab" and "Proposed milestone" "Pilot readout".
  Accept the Milestone with one click; Edit and accept the Task, assert the dialog is prefilled (title, due date 2026-10-10), change the title, save.
  Assert both cards are gone, the Task appears on the Tasks page with the edited title, the Milestone on the Overview Milestones list, and the Evidence page lists both as linked items.
- `ui-proof` captures: `artifacts/after-item-proposal-cards.png`, `artifacts/after-item-proposal-task-dialog.png`, `artifacts/after-item-proposal-milestone-dialog.png` (the milestone dialog opened through Edit and accept in a separate state, before the one-click accept).
- Existing flows in `e2e/flows.spec.ts` and `e2e/propose-review.spec.ts` stay green; their Evidence text does not match the heuristic item patterns, which the run confirms.

### Commit 5 - `Record item Proposal review in the domain docs`

- ADR 0015: an "Accepting" section on the `afterCreate` hook, one transaction, deferred re-resolution, stale ids dropped, Evidence links only for Evidence Sources.
- `docs/submission/m19-analytics.md`: `item_proposal_accepted` row.
- `docs/ai-system-guide.md` / `docs/architecture.md` where they say review arrives with #115.
- `docs/artifacts/115-item-proposal-review/implementation-notes.md`: deviations and verification.

## 4. How to test and verify

1. `npx vitest run src/server/modules/proposals src/server/modules/tasks src/server/modules/milestones src/server/modules/evidence` after each backend step; `npm run typecheck` regularly.
2. End to end as the user would: dev server with `PROPOSALS_EXTRACTOR=heuristic`, add the Evidence above through the UI, review on the Overview, accept one, edit-and-accept the other, and check the Task, Milestone, Evidence links and the Overview activity feed ("via Assistant").
3. `npx playwright test e2e/item-proposals.spec.ts e2e/propose-review.spec.ts e2e/flows.spec.ts` with a heuristic dev server.
4. Before pushing: `npm run format:check`, `npx eslint . --max-warnings=0`, `npm run typecheck`, `npm test`, `npm run test:e2e`.
5. `/code-review` against `feat/114-item-proposals`.
6. Acceptance checklist from #115:
   - full flow reproduced end to end (step 2, Commit 4);
   - item, `evidence_links` and Activity Event via the Assistant in one transaction (Commit 2);
   - reject keeps the row and the fingerprint is not raised again (Commit 2);
   - deferred Milestone re-resolution service test (Commit 2);
   - Playwright spec with exact item Proposals and both accept paths (Commit 4);
   - acceptance and rejection analytics with `kind` and edited flag (Commit 2);
   - `ui-proof` captures of the cards and both prefilled dialogs (Commits 3 and 4);
   - `typecheck`, `lint`, `test`, `test:e2e` green (step 4).

## 5. Out of scope

- Assistant or MCP tools over item Proposals.
- Stepping through item Proposals one at a time in a dialog, as the Decisions page does.
- Item extraction evals (#116).
- Showing item Proposals on the Tasks or Timeline pages.
