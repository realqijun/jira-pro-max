# Implementation notes - #115 Review and accept Task and Milestone Proposals

What was built follows `plan.md`; this file records where it deviated and what was verified.

## Deviations from the plan

- `listPendingItems` returns `acceptInput: null` for a payload the create schema refuses, instead of failing the Overview.
  Such a card has Accept disabled, says it cannot be accepted as it stands, and still offers Edit and accept and Reject.
- An edited input of the other kind (a Task form posted for a Milestone Proposal) is a `ConflictError`, not a silent create of the wrong item.
- The Overview no longer shows "Nothing needs attention" under pending alerts or Proposals, which it contradicted.
  This was already visible with Decision Proposals; it is fixed here because the new cards made it prominent.
- `e2e/item-proposals.proof.spec.ts` captures the UI proof separately from `e2e/item-proposals.spec.ts`, following the existing `*.proof.spec.ts` pattern; `PROOF_PHASE=before` produced the baseline before the UI existed.

## Verification

- `npx vitest run src/server/modules/proposals` covers `acceptInputOf` (pure), the accept service against the test database (default Status, Evidence links, Activity Events via the Assistant, deferred Milestone re-resolution, parallel accepts, a reject racing the accept rolling the Task back, edited input, a foreign Project refused, deleted Evidence skipped, Comment Sources not linked, a rejected item not raised again, a stranger refused) and the `item_proposal_accepted` payload and edit rule.
- `e2e/item-proposals.spec.ts` under `PROPOSALS_EXTRACTOR=heuristic`: exactly one Task and one Milestone Proposal from one Evidence item, one-click accept of the Milestone, edit and accept of the Task with a new title, both items on their pages, attributed "via Assistant", and linked to the Evidence; green in four consecutive runs.
- UI proof: `artifacts/before-item-proposal-review.png` (pending item Proposals had no surface), `artifacts/after-item-proposal-cards.png`, `artifacts/after-item-proposal-task-dialog.png`, `artifacts/after-item-proposal-milestone-dialog.png`.

## Code review

A two-axis review (standards and spec) found no hard violations; these were fixed:

- Edit and accept on a payload the create schema refuses always failed, because the accept computed the one-click input first; it now accepts the edited input and records it as edited.
- The default Status for the edited check was resolved after commit with a swallowed failure, which could report an untouched dialog save as edited; it is now resolved before the create.
- The one-click accept and reject state was duplicated between the Decision and item cards; both use `useProposalTransition`.
- `ProposalCards` took `items` and `refs` separately, so items without refs rendered nothing; they are now one prop.

Kept as designed: `item_proposal_rejected` carries `kind` and no edited flag, as `proposal_rejected` does for Decisions (see the plan).

## Adversarial review of PR #119

A fresh-context adversarial reviewer found no blockers:

- `src/server/auth/session.test.ts`, an untracked local file unrelated to #115, had been committed by accident and failed `npm test`; it is removed from the branch and kept locally.
- For a payload the create schema refuses, the dialog prefilled only the title, description and dates and dropped the resolved Owner, Milestone and start date; `listPendingItems` now also returns the unvalidated `draftInput` the dialog prefills from.

Accepted as a known limit: `edited_before_accept` compares against the one-click input computed at accept time, so if a named Milestone is accepted in another tab between opening and saving an untouched Task dialog, the save counts as edited.
