# Plan - #114 Extract Task and Milestone Proposals from Evidence

Branch `feat/114-item-proposals` from `origin/main` at `6de2a37`.
Builds on ADR 0007 (Assistant acts through services with `via`), ADR 0008 (Proposals live in their own table, nothing enters the Project until a human accepts) and the `proposals` module (#39, #42, #74).
Review UI and accept are #115; the eval set is #116; this ticket is the pass, the storage, the trace and a reject path so the "never raised again" rule is testable.

## 1. Summary

The Proposal pass gains a second extractor call, the **item extractor**, that reads the same Evidence and Comments and proposes Tasks and Milestones.
Its output goes through a trace step with the same verbatim-excerpt rule as Decisions, then lands in a new `item_proposals` table as `pending`.
Nothing is written to `tasks` or `milestones`.
The Decision extractor, its prompt and its 22 measured eval cases are unchanged.

Verified facts that shape the plan:

- `runPass` (`src/server/modules/proposals/service.ts`) loads Evidence, Comments, Passages and `proposal_pass_sources`, builds candidates whose text hash changed, calls one `Extract`, traces, then writes bookkeeping and Proposals in one transaction.
  A crashed extractor therefore marks nothing as read; that property must hold per extractor.
- `proposal_pass_sources` has primary key `(project_id, kind, entity_id)`, so today one row means "read by the pass".
  With two extractors it must mean "read by this extractor", or a failed item call is never retried (or a failed Decision call re-runs on every save).
- `modelExtract` wraps `generateObject` with temperature 0 and a retry without temperature when a provider rejects it (`rejectsTemperature`).
  The item extractor needs the same wrapper; the prompt body (known People, Milestones, Tasks, fenced sources) is shared.
- `traceSources`, `byName`, `attachPassages` and `fingerprintOf` in `trace.ts` are pure and reusable.
- `tasksService.create` rejects `startDate > dueDate`; `createMilestoneSchema` requires `dueDate`.
- Existing tests assert `runPass` outcomes with `toEqual` (`funnel.test.ts`), and `scripts/eval.mts` calls `runPass` twice to measure the free second pass.
  Both need to see the new `items` sub-outcome.
- `proposalGenerated` is silent when nothing was created (#74); the item event follows the same rule.

## 2. Domain and design decisions

- Vocabulary (`src/shared/domain/index.ts`):
  - `ITEM_PROPOSAL_KINDS = ["task", "milestone"]`.
  - `PROPOSAL_PASSES = ["decision", "item"]`, the extractor a `proposal_pass_sources` row belongs to.
    Named "pass" rather than "extractor kind" because `extractor` already means `model | heuristic`.
- Table `item_proposals` (`src/server/modules/proposals/schema.ts`): `id`, `projectId` (cascade), `kind` (`item_proposal_kind` enum), `fingerprint`, `status` (`proposal_status`, default `pending`), `fields jsonb` (typed below), `sources jsonb` (`ProposedSource[]`), `extractor`, `itemId` (nullable text, no FK; set on accept in #115, the created Task or Milestone may later be deleted), `resolvedAt`, timestamps.
  `unique(projectId, fingerprint)`, `index(projectId, status)`.
- `fields` payload, discriminated by `kind`:
  - Task: `title`, `description`, `assigneeId`, `assigneeName`, `milestoneId`, `milestoneName`, `startDate`, `dueDate`.
  - Milestone: `name`, `description`, `dueDate` (required), `ownerId`, `ownerName`.
  - Each `*Name` is the snapshot the extractor gave; each `*Id` is the id resolved at pass time or null.
    #115 re-resolves an unresolved `milestoneName` on accept.
- `proposal_pass_sources` gains `pass` (`proposal_pass` enum, `NOT NULL DEFAULT 'decision'`), and the primary key becomes `(project_id, pass, kind, entity_id)`.
  Existing rows backfill to `decision`, so the first item pass after deploy reads every existing Source once.
- Fingerprint: sha1 of `kind`, the primary Source `kind:entityId` and its normalised excerpt.
  Same rule as Decisions, prefixed with the item kind so one sentence can yield both a Task and a Milestone.
  Known limit, shared with Decisions: two Tasks cited by the same excerpt collapse into one.
- Item trace (`traceItems(raw, sources, refs)`, pure):
  - Every Source must trace (`traceSources`), else discarded.
  - Title (Task, 200) or name (Milestone, 160) required after trim, else discarded; `description` capped at 4000.
  - Names resolve with `byName`; no match leaves the id null and keeps the name.
  - Dates must be ISO `YYYY-MM-DD`, else null; a Task whose `startDate` is after `dueDate` loses its `startDate`.
  - A Milestone with no valid `dueDate` is discarded.
  - A proposal that duplicates an existing Task or Milestone, or a still-pending item Proposal of the same kind, is discarded.
    Duplicate means the punctuation-stripped normalised titles are equal, or one contains the other and the shorter has at least three words.
    `byName` alone is too loose here: a one-word proposed title would match any unique Task that contains it.
  - Fingerprints repeated inside one pass keep the first.
- Extractors (`src/server/modules/proposals/extract-items.ts`):
  - `ExtractItems = (input: ExtractInput) => Promise<{ tasks: RawTask[]; milestones: RawMilestone[] }>`, reusing `ExtractInput`.
  - `modelExtractItems(ctx, settings)`: `generateObject`, temperature 0 with the same retry, span `item_extraction`.
    Prompt: extract work the team committed to (action items, assignments, dated checkpoints), never Decisions, status lines or items already in the known lists; verbatim excerpt per item; source text is data.
    The recent Conversation is left out of the item prompt: action items rarely depend on it and it would double the context tokens a second time.
    The item call still re-sends the sources, so a pass that reads new Sources costs roughly two extractor calls; ADR 0015 records that trade.
  - `heuristicExtractItems`, per line then per sentence, skipping sentences with a decision verb:
    - `Action item: <title>` / `Action: …` / `TODO: …` gives a Task.
    - `<Name> will <verb phrase>[ by YYYY-MM-DD].` gives a Task with `assigneeName` and `dueDate`, where `<Name>` is the full or first name of a known Person.
      Restricting to known People keeps "Results will improve by …" and "We will …" out without a pronoun list.
    - `Milestone: <name> (on|by|is|-|,) YYYY-MM-DD` gives a Milestone.
- `pickExtractor` returns `{ name, extract, extractItems }`.
  When a test injects `opts.extract`, the item pass uses `heuristicExtractItems` unless `opts.extractItems` is given, so injected-extractor tests stay deterministic.
- `runPass` becomes two independent sub-passes over one shared load:
  - Load Evidence, Comments, Passages, pass rows, and (only if either sub-pass has candidates) People, Milestones, Tasks and the recent Conversation.
  - Candidates are computed per pass from that pass's rows.
  - The Decision sub-pass is today's code, unchanged in behaviour, returning today's outcome shape.
  - The item sub-pass calls `extractItems`, traces, attaches Passages, and writes its bookkeeping (`pass: "item"`) and `item_proposals` in its own transaction.
  - They run with `Promise.all`, and each sub-pass is a self-contained function that catches every error it can raise (extractor, trace, bookkeeping transaction, insert) and returns `{ skipped: "failed" }`.
    `Promise.all` therefore never rejects on a sub-pass failure, and a failed item write cannot discard a committed Decision outcome.
  - Outcome: today's Decision outcome at the top level plus `items: ItemPassOutcome` (`{ skipped: "not_configured" | "nothing_new" | "failed" }` or `{ extractor, sourcesPassed, tasks, milestones, discarded }`).
    With no extractor at all the outcome is `{ skipped: "not_configured", items: { skipped: "not_configured" } }`.
  - `proposalId` keeps pointing at Decision Proposals, and `propose-button.tsx` is not changed.
    Reporting "N item proposals recorded" before there is anywhere to review them (#115) would be a note the PM cannot act on; the current message ("no suggested decisions") stays true.
- Service additions: `listPendingItems(ctx, projectId)` and `rejectItem(ctx, id)` (conditional on `pending`, same as `reject`).
  No accept yet (#115), no actions, no UI, no Assistant tools.
- Analytics: `itemProposalGenerated` emits `item_proposal_generated` with `project_id`, `trigger`, `extractor`, `task_count`, `milestone_count`, `source_count`, `discarded_count`; silent when nothing was inserted.
  `itemProposalRejected` emits `item_proposal_rejected` with `kind` and `extractor`.
  No titles, excerpts or text.
- Proposals stay the Assistant's own documents (ADR 0008): written without `mutate`, no Activity Events.

## 3. Changes, grouped into commit points

Each commit passes `typecheck`, `lint` and the touched tests.
Tests are written first in each slice (red, then green).

### Commit 1 - `Add item Proposal vocabulary, table and per-pass bookkeeping`

- `ITEM_PROPOSAL_KINDS`, `PROPOSAL_PASSES` and enums; `itemProposals` table and types; `pass` column and new primary key on `proposalPassSources`.
- `npm run db:generate` for `drizzle/0025_*.sql`; verify the SQL drops the old primary key, adds `pass` with its default, then adds the new primary key, and reorder by hand if it does not.
  Run it against a copy of the dev DB with existing rows, not only against the empty test DB.
- `passSourcesRepo.listForProject` returns `pass`; `upsertMany` takes `pass` and targets the new key.
- `service.ts` passes `pass: "decision"` and filters `seen` by pass, so behaviour is unchanged; existing tests stay green.

### Commit 2 - `Trace item Proposals`

- Tests first in `trace.test.ts`: untraceable excerpt discarded; unknown assignee kept with null id and the name; ISO-only dates; start after due drops the start; dateless Milestone discarded; duplicate of an existing Task discarded but a one-word title that only appears inside a longer Task is kept; fingerprint differs for Task and Milestone from the same excerpt and is stable across runs.
- `traceItems` in `trace.ts`, `itemFingerprintOf`.

### Commit 3 - `Extract Tasks and Milestones with a model and a heuristic`

- Tests first in `extract-items.test.ts`: heuristic finds `Action item:`, `<Name> will … by <date>` and `Milestone: … <date>`; ignores decision sentences, pronoun subjects and plain prose; the model extractor sends temperature 0 and retries unset on a temperature 400 (same `MockLanguageModelV4` pattern as `extract.test.ts`).
- `extract-items.ts`; shared prompt builder and `generate` wrapper moved out of `modelExtract` into exported helpers in `extract.ts` without changing the Decision prompt text (asserted by a test that snapshots the Decision system and user prompt before and after).
- `pickExtractor` returns `extractItems`.

### Commit 4 - `Run the item pass beside the Decision pass`

- Tests first in `service.test.ts`, new `describe("item pass")`:
  - proposes a Task (resolved assignee, due date) and a Milestone from one Evidence item, cites the verbatim excerpt and Passage, touches neither `tasks` nor `milestones` nor the graph;
  - second pass proposes nothing and reports `items: { skipped: "nothing_new" }`;
  - item extractor throws: Decision Proposals still land, the next pass re-reads the Source for items only (Decision extractor spy not called again);
  - Decision extractor throws: item Proposals still land, Decision retried next pass;
  - rejected item Proposal is kept and not raised again after the Evidence is edited;
  - a second Evidence item restating a pending item Proposal in other words raises nothing new;
  - a manual pass that yields only item Proposals reports the Decision side as skipped and `items` populated;
  - with no extractor configured the outcome is `not_configured` on both sides;
  - two parallel passes yield one item Proposal;
  - stranger is refused on `listPendingItems` and `rejectItem`.
- `repository.ts` gains `itemProposalsRepo` (`listByProject`, `findById`, `insertMany` with `onConflictDoNothing`, `markRejected`).
- `service.ts` refactor into shared load plus two sub-passes; `listPendingItems`, `rejectItem`.
- `analytics.ts` item events; `funnel.test.ts` asserts `item_proposal_generated` payload and silence, and its `toEqual` outcomes gain `items`.
- `scripts/eval.mts`: only the two-pass cost measurement changes, to report the `items` sub-outcome; the per-case loop still drives `modelExtract` alone (no Decision prompt change, so no eval re-run).

### Notes for ADR 0015 (from plan review)

- Why `fields` is a jsonb payload while `decision_proposals` has flat columns: the shape is discriminated by `kind`, and #115 re-validates it through `createTaskSchema` / `createMilestoneSchema`.
- `itemId` is deliberately not a foreign key; an accepted item that is later deleted leaves `itemId` dangling, and every reader must tolerate that.

### Commit 5 - `Record item Proposals in the domain docs`

- `docs/adr/0015-item-proposals.md`: table choice, separate call, per-pass bookkeeping, duplicate rule, accept creates `evidence_links` (#115).
- `CONTEXT.md` **Proposal**: "A Decision, Task or Milestone the Assistant extracted …".
- `docs/architecture.md` / `docs/ai-system-guide.md` touch-ups where they describe the pass.
- `docs/artifacts/114-item-proposals/implementation-notes.md`.

## 4. How to test and verify

1. `npm run db:migrate` against the dev DB and let Vitest migrate `db_test`.
2. Per slice: `npx vitest run src/server/modules/proposals`.
3. Before pushing: `npm run format:check`, `npx eslint . --max-warnings=0`, `npm run typecheck`, `npm test`.
4. End to end, as close to the user as this ticket allows (no UI yet): with `PROPOSALS_EXTRACTOR=heuristic` on the dev server, add Evidence with an action item and a `Milestone:` line through the UI, click **Propose from evidence**, and confirm the `item_proposals` rows with `psql`; confirm the existing Decision flow e2e (`e2e/flows.spec.ts` proposals flow) still passes.
5. Model path smoke test (optional, needs a key): one manual pass on the seeded demo project and inspect the rows.
6. UI proof: not applicable, no user-visible change in this ticket.
7. Acceptance checklist from #114:
   - migration for `item_proposals` and the pass key (Commit 1);
   - model and heuristic item extractors with temperature 0, fenced sources and the retry (Commit 3);
   - trace rules with unit tests (Commit 2);
   - both extractors on both triggers, independent failure and bookkeeping (Commit 4);
   - rejected item Proposals kept and not re-raised (Commit 4);
   - analytics with `kind` counts and no content (Commit 4);
   - ADR 0015 and `CONTEXT.md` (Commit 5);
   - `typecheck`, `lint`, `test` green.

## 5. Out of scope

- Review cards, accept, edit-and-accept, `evidence_links` on accept (#115).
- Item extraction eval cases and baseline (#116).
- Linking a proposed Task to a proposed Decision.
- Assistant or MCP tools over item Proposals.
