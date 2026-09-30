# Implementation notes - #117 Draft Render prompts from Evidence

Plan: `plan.md` beside this file, revised once after a plan review (converged on the second pass).

## Deviations from the plan

- Draft failures from the model are caught in `rendersService.draft` and turned into a `ConflictError` with a mapped message (`turnErrorMessage` for key, rate-limit and outage failures, otherwise a generic one).
  Without this, a provider error would escape `runAction` as an unhandled 500, and the provider's own message could echo the prompt.
- The migration is `drizzle/0026_busy_flatman.sql`, the name drizzle-kit generated.
- `docs/architecture.md` does not describe the Renders module, so it was left unchanged.
- The stub image service returns a committed sample image (`public/samples/renders/community-centre-exterior.jpg`) rather than a 1x1 PNG, so the proof screenshot shows a real card.

## Found and fixed along the way

- `assistantService.dock` failed with `ForbiddenError: Conversation not found` when another request's `library` prune deleted the empty Conversation the dock had just read.
  It happens after creating a Project: the dashboard revalidates next to the new Project layout.
  The second renders e2e test hit it on its first run.
  The dock now opens a fresh Conversation; a unit test reproduces the interleaving with a spy on `conversationsRepo.latest`.

## Environment notes

- The local `.env` points `DATABASE_URL` at a remote Neon database.
  `e2e/renders-server.mjs` therefore sets `DATABASE_URL` to the local Docker database unless `RENDERS_E2E_DATABASE_URL` is given.
- Next's env loader keeps pre-set empty variables (`@next/env` only fills keys that are `undefined`), so blanking keys in the server script is enough to switch services off.
- The before screenshot shows broken image placeholders on the seeded cards behind the dialog.
  They are a timing artifact: the image route returned 200, and the screenshot was taken before the images painted.

## Verification

- `npx vitest run src/server/modules/renders src/server/modules/assistant`: green.
- `npm run test:e2e:renders`: 2 passed; `RENDERS_E2E_NO_MODEL=1 npm run test:e2e:renders`: 1 passed.
- UI proof: `artifacts/before-renders-new-dialog.png`; `artifacts/after-renders-evidence-picker.png`, `after-renders-drafted-prompt.png`, `after-renders-drafted-from.png`, `after-renders-draft-disabled.png`.
- Full-suite results are in the PR description.
