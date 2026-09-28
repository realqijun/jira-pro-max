# Verification execution record

Date: 28 September 2026.
Local source commit: `116e5a0d754a73099ac24c1e889ceb7c3c8de6d4`.
The workspace already contained an untracked `src/server/auth/session.test.ts` and unrelated artifacts before this task began.
Those existing files were preserved.
This task changes submission documentation and adds evidence; it does not repair application behavior or modify the live dashboard configuration.

## Results

| Check                                       | Result                                | Meaning                                                                                                                                                     |
| ------------------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Analytics, Proposal, and Decision tests     | **120 passed, 10 files**              | Covers browser identity/reset/transport, redaction, server isolation, LLM callbacks, committed Proposal outcomes, duplicate transitions, and edit detection |
| Full Vitest suite                           | **574 passed, 2 failed, 58 files**    | Both failures are in `src/server/auth/session.test.ts`, which is not committed; see below                                                                   |
| Analytics real-SDK browser suite            | **6 passed, 1 failed**                | The failing scenario reaches a Project layout error after capture; it is not an all-green browser result                                                    |
| Focused identity scenario, repeated 3 times | **3 passed**                          | Confirms successful browser/server identity linkage can work; server logs still contain Conversation errors, so the initial failure is not dismissed        |
| Analytics completely unconfigured           | **1 passed, 6 intentionally skipped** | Signup, Project creation, and sign-out work without an analytics key                                                                                        |
| Typecheck                                   | **Passed**                            | `next typegen && tsc --noEmit`                                                                                                                              |
| ESLint                                      | **Passed, zero warnings**             | `eslint --max-warnings=0`                                                                                                                                   |
| Submission formatting and patch whitespace  | **Passed**                            | Prettier checks on the changed submission files and `git diff --check`                                                                                      |
| Deployed browser to PostHog                 | **Passed for one anonymous pageview** | Browser HTTP 200 plus received event matched by exact identity                                                                                              |
| Fresh authenticated production funnel       | **Not exercised**                     | Historical PostHog rows and the local SDK funnel are retained as separate evidence                                                                          |
| Live AI success/failure execution           | **Not exercised**                     | Callback tests and historical generation rows were checked; no paid provider request was made                                                               |

## Re-check: 29 September 2026

A second set of dashboard screenshots was supplied at 00:12 Singapore time, about 40 minutes after the preserved set.
Their source files were no longer on disk, so they are not added; the preserved screenshots show the same data.
Every total read from the new screenshots matches this audit: 54 Assistant questions (42 Project, 12 workspace), 9 accepted and 10 rejected Proposals, 7 exceptions, and a funnel of 14 to 7 persons with a 22-second median.
No change is visible between the two captures.
The source findings were re-read and still hold at commit `116e5a0`: Evidence, transcript, and Render events omit `project_id`; the browser SDK sets no explicit `capture_exceptions`; and the chat route starts its generation recorder with the environment `modelInfo()`.
The analytics, Proposal, and Decision tests were re-run: 120 passed in 10 files.
The live PostHog queries and the browser suites were not repeated, because the dashboard data was unchanged.

## Browser and event reconciliation

The dedicated suite uses the installed real `posthog-js` and `posthog-node` packages.
Only ingestion is replaced by a collector on port 3101; the app runs on port 3001 with a fake project key.
It creates synthetic local Users and Projects, exercises UI actions, and observes the SDK payloads.
Live model/embedding/compression keys were disabled and `PROPOSALS_EXTRACTOR=heuristic` was set for repeatability.
The tests leave their synthetic records in the local development database, as the existing harness normally does.

The successful [local Proposal event export](local-funnel-events.json) reconciles four generated Proposals, three acceptances, one rejection, and exactly one edited acceptance with the UI's persisted `3 of 4` result.
It checks automatic generation after Evidence creation, an unchanged review form, one-click acceptance, an edited acceptance, rejection, browser session correlation, and absence of business content in the emitted payloads.
The [local identity export](local-identity-events.json) comes from the final successful repeated identity run.
It checks identify/signup ordering, one signup per new User, restored auth, sign-out reset, returning login, a second User, and a common browser session on the corresponding server Project event.
Other successful scenarios cover idle session rotation, restoring auth without an analytics cookie, expiring auth, credential-route suppression, and unavailable analytics.

The generated [signup](local-browser/signup.png) and [Project](local-browser/project.png) screenshots are from that final repeated run.
The Project screenshot was visually inspected and its navigation, overview panels, and synthetic account display render correctly at 1440 by 900.
These local screenshots are distinct from the four supplied PostHog screenshots.
The harness's older checked-in evidence files were restored byte-for-byte after archiving this run's outputs here.

## Failures retained rather than hidden

### Project layout intermittently reports a missing Conversation

The initial local browser run failed in `e2e/analytics.spec.ts:131`, waiting for the `Analytics Project` heading.
The browser/server output reported `ForbiddenError: Conversation not found` from `assistantService.getConversation`, through `thread`, `dock`, and `ProjectLayout`.
The identity/session event assertions before that UI assertion had succeeded.

Repeating the identity scenario three times produced three passing test results, but additional instances of the same server error remained in the logs.
This is evidence of intermittent application behavior, not proof that the error disappeared.
A plausible cause is the read-time empty-Conversation pruning in `dock` and `library` racing with overlapping page renders, but this audit did not isolate that causal mechanism or apply a speculative fix.
Use the recorded browser scenario as the reproduction starting point before changing Conversation lifecycle behavior.

### Cached session remains valid after deletion or revocation

The full suite failed these two existing tests in `src/server/auth/session.test.ts`:

- `redirects a cached login after its User is removed`
- `redirects a cached login after its session is revoked`

Both expected `getSession()` to return `null`, but it returned the cached session.
The active-session case passed.
This also matters to analytics identity: a stale server authentication result can outlive the database record it represents.
The failing test file was already untracked on entry to this task; it was not created or changed by this verification.
The raw failure diff contains synthetic authentication tokens, so it is not committed here.

### First browser attempt used the wrong database environment

The first invocation inherited the workspace's hosted database URL and failed on a database connection timeout during signup.
It was stopped and replaced with the explicit localhost configuration below.
The relevant check is the subsequent local run, not the aborted environment-mismatch attempt.
No successful hosted mutation was observed in that attempt.

## Reproduction commands

Run these from the repository root with the local Docker databases available.
The explicit database and blank provider keys prevent inheriting a hosted database or making live model calls.
The existing analytics harness writes evidence under `docs/artifacts/73-analytics-identity` and `docs/artifacts/74-proposal-funnel`; preserve those historical outputs before rerunning it.

```sh
npm test -- src/shared/analytics src/server/modules/proposals src/server/modules/decisions
npm test

DATABASE_URL=postgres://pm:pm@localhost:5433/pm \
ANALYTICS_E2E=1 PROPOSALS_EXTRACTOR=heuristic \
OPENAI_API_KEY= GEMINI_API_KEY= GOOGLE_GENERATIVE_AI_API_KEY= \
LITEPRUNER_API_KEY= POLLINATIONS_API_KEY= \
npx playwright test --config playwright.analytics.config.ts

DATABASE_URL=postgres://pm:pm@localhost:5433/pm \
ANALYTICS_E2E=1 PROPOSALS_EXTRACTOR=heuristic \
OPENAI_API_KEY= GEMINI_API_KEY= GOOGLE_GENERATIVE_AI_API_KEY= \
LITEPRUNER_API_KEY= POLLINATIONS_API_KEY= \
npx playwright test --config playwright.analytics.config.ts --grep 'landing, signup' --repeat-each=3

DATABASE_URL=postgres://pm:pm@localhost:5433/pm \
ANALYTICS_E2E=1 ANALYTICS_DISABLED=1 PROPOSALS_EXTRACTOR=heuristic \
OPENAI_API_KEY= GEMINI_API_KEY= GOOGLE_GENERATIVE_AI_API_KEY= \
LITEPRUNER_API_KEY= POLLINATIONS_API_KEY= \
npx playwright test --config playwright.analytics.config.ts

npm run typecheck
npm run lint -- --max-warnings=0
npx prettier --check docs/submission/m19-analytics.md \
  docs/submission/posthog-metric-definitions.md \
  docs/submission/posthog-2026-09-28

git diff --check
```

Read-only PostHog aggregate queries and their exact UTC cutoff are in [aggregate-queries.json](aggregate-queries.json).
The internal/test cohort was empty when queried, so those all-project queries reconcile with the saved insights despite the insights having test-account filtering enabled.
Use `JSONExtractString` presence checks for promoted LLM properties.
An initial `properties.$ai_trace_id IS NOT NULL` aggregate returned zero, but so did the matching `IS NULL` check, while every raw event carried a trace.
Cross-checking `JSONExtractString(properties, '$ai_trace_id')` established 47/47 trace coverage, and the canonical exported coverage query uses that form.
Do not interpret that first query artifact as missing telemetry.
