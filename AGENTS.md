<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# PrismPM - project management base for a future AI intelligence layer

Vocabulary lives in `CONTEXT.md`; use its terms (Task, not issue; Person, not assignee; Evidence, not document). Decisions with trade-offs are in `docs/adr/`. Visual language is `DESIGN.md`; tokens are already in `src/app/globals.css` (`bg-surface-1`, `text-ink-subtle`, `text-tag-red`, `panel`, …) — reach for those, never raw hex.

This project is created to solve a common paint point across project managers, having sparse context with no way of unifying them. Another thing we do is to have constantly improving agents that update a memory.md per user.

## Setup and verification

`cp .env.example .env`, `npm run db:up`, `npm run db:migrate`, `npm run db:seed` (demo account only, see `.env.example`), `npm run dev`. Scripts are in `package.json`; `typecheck`, `lint`, `test` (Vitest, needs the `db_test` container), `test:e2e` (Playwright, needs a running dev server or lets the config start one). Pre-commit runs lint-staged + typecheck. CI (`.github/workflows/ci.yml`, runs on Bun) checks `format:check`, `eslint --max-warnings=0` and `typecheck` on every PR. A Devin `PostToolUse` hook (`.devin/hooks.v1.json`) runs Prettier + `eslint --fix` on each file the agent edits.

## Model behaviour is measured, not asserted

Before changing a prompt in `src/server/modules/proposals/extract.ts` or `src/server/modules/assistant/prompt.ts`, run the eval suite and compare: 22 extraction plus 20 answer cases in `evals/cases/`, graded deterministically by `evals/grade.ts`, driven by `scripts/eval.mts`. Seed the fixture once with `DATABASE_URL=postgres://pm:pm@localhost:5433/pm_eval_20260928 npx tsx evals/fixture.ts`, then run the harness with a key in the environment (`OPENAI_BASE_URL=https://openrouter.ai/api/v1` reaches any model) and `npx tsx evals/report.ts` to rebuild the tables. It needs a live key, so it runs on demand, never in CI. Results and the reasoning they produced: `docs/submission/m8-prompts.md`, `m9-model-bakeoff.md`, `m11-evals.md`, `m12-optimization.md`, with raw runs under `artifacts/`. A prompt edit that improves one case usually breaks another - the 4-stage history in `artifacts/prompt-iteration-2026-09-28/` is what that looks like.

## Architecture rules (ADR 0005)

- **Every write goes through `src/server/modules/<feature>/service.ts`** wrapped in `mutate(ctx, (tx, rec) => …)` from `src/server/core/mutation.ts`, or, for the one audience that is not a User, `mutateAsParticipant(pctx, …)` (ADR 0009/0010). Call `rec.created/updated/deleted` so the Activity Event and domain event are emitted. Two exceptions use `rec.signal` (publish-only): `project.deleted`, because the Project's Activity Events cascade away with the row, and `chat_message.created`, because `room_messages` is already the immutable log an Activity Event would copy (ADR 0010). A Participant's mutation records `actorId: null` and may only `rec.signal` - a Person has no `user.id` to be an actor, and `Recorder` throws if one tries to record. The Assistant's own documents (Conversations, Messages, Profile and Working Memory versions, Proposals) are not Project items and are written without `mutate` (ADR 0007, ADR 0008). Diff with `diffFields(before, compactPatch(patch))` so only real changes are recorded.
- **First line of any project-scoped service is `assertOwnsProject`** (`src/server/modules/projects/service.ts`). It is the only authorization seam for the User. Messaging adds exactly one more for the other audience: a service a Participant can reach starts with `assertParticipates` (`src/server/modules/messaging/service.ts`, ADR 0009), and a Participant never reaches `assertOwnsProject`, which takes a `user.id`.
- **Server actions** (`actions.ts`, `"use server"`) are thin: `runAction(schema, input, fn)` then `revalidateProject(id)`. Two siblings exist for the messaging audience only: `runOpenAction` (no session: the Participant login, accepting an Invite, signing out) and `runParticipantAction` (a `ParticipantCtx` from the signed cookie). Never `redirect()` inside an action called from a client component — the promise never resolves; return the result and navigate with `router.push` in `onSuccess`.
- **Layers**: `app` (routes, fetch via services) → `widgets` (shell, timeline, calendar) → `features` (dialogs/views that call actions) → `entities` (display atoms) → `shared` (ui, lib, domain). UI never imports a `repository.ts`.
- **Status semantics come from `status.category`, never `status.name`** (ADR 0003). Fixed vocabularies live in `src/shared/domain/index.ts`; adding a value there needs a Drizzle enum migration (`npm run db:generate`).
- **Forms**: `ActionForm` + `TextField/SelectField/TextareaField`. `className` styles the label wrapper; use `inputClassName` for the control.

## Engineering standards

- Use `-`, never an em dash (`—`).
- Never auto-add an agent name as a commit co-author.
- Do not manually modify `CHANGELOG.md` or files marked auto-generated.
- In new or substantially edited long Markdown files, put each complete sentence on its own physical line. Preserve normal Markdown structure.
- Prefer quality, simplicity, robustness, scalability, and long-term maintainability over development speed.
- For bug fixes, first reproduce bug in an end-to-end setting that closely matches user behavior.
- During end-to-end testing, fix visible UI defects relevant to the changed flow, even when not directly caused by current work.
- Apply same standard to lint errors, test failures, and test flakiness: fix them when encountered.

## Where the AI layer plugs in

Subscribe with `eventBus.subscribe("*" | "task.updated" | …)` in `src/server/events/bus.ts`; read through the module repositories; store extracted text in `evidence.extractedText` (nullable, reserved). `src/server/modules/search/` is the reference subscriber: it turns `evidence.*` events into chunked embeddings (OpenAI, optional LitePruner compression of `evidence.prunedText`, per-Project FAISS - ADR 0014). `src/server/modules/workspace/queries.ts` is the deterministic read model the Health Briefing should enrich rather than replace.
