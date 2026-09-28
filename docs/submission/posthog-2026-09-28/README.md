# M19 verification: PostHog logging and usefulness

Verified on 28 September 2026 against local commit `116e5a0d754a73099ac24c1e889ceb7c3c8de6d4`, authenticated PostHog project `618308`, and [the deployed application](https://jira-pro-max.vercel.app/).
The deployed release SHA was not available and is not assumed to equal the local commit.

**Verdict: logging is working and the results are useful submission evidence, with material limitations.**
They show exercised workflows, Proposal decisions, and actionable AI failures.
They do not establish clean production adoption, retention, model accuracy, or complete application reliability.
The PostHog project contains both deployed and localhost traffic, and its internal/test exclusion cohort is empty.
The verification also recorded failures (one browser scenario, and two tests in an uncommitted local test file), so this is not an all-green certification.

## Evidence and method

- Preserved all four supplied screenshots byte-for-byte, with [provenance and SHA-256 checksums](screenshots.json).
- Read the actual saved queries and cached results for [AI usage & health](https://us.posthog.com/project/618308/dashboard/2128445) and [Core product activity](https://us.posthog.com/project/618308/dashboard/2133285); see [dashboard snapshot](dashboard-snapshot.json).
- Independently queried event totals, distinct identities, environments, property completeness, Proposal outcomes, and LLM health; see [reproducible SQL and aggregate results](aggregate-queries.json).
- Visited the deployed landing page, observed its browser SDK send a `$pageview` with HTTP 200, then matched that exact browser identity to the event received by PostHog; see [production delivery check](production-delivery-check.json).
- Ran the real browser/server SDK suite against a local collector with a fake ingestion key and live model keys disabled, plus unit/integration tests, typecheck, and lint; see [verification results](verification-results.md).
- Compared the current event call sites with the meaning of each dashboard; official metric definitions are recorded in [the accompanying research note](../posthog-metric-definitions.md).

The aggregate audit window is `2026-08-29T00:00:00Z` to, exclusively, `2026-09-28T15:40:00Z`.
The project timezone is UTC, although the screenshot filenames use the operator's Singapore time.
Saved dashboard queries use the last 30 days with the incomplete current day included, covering 31 daily buckets.
The production delivery probe occurred after the aggregate cutoff and added one anonymous pageview; it created no production account, Project, or Evidence.
The saved dashboard cache and the aggregate queries agree on the reported workflow totals.
Only selected settings, aggregate results, and synthetic local event payloads are retained here, without account cookies, API keys, production person IDs, or raw business content.

## What the results say

| Measurement                            | Verified result                  | Supported interpretation                                                                 |
| -------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------- |
| Assistant questions                    | 54                               | Recorded eligible question requests, not necessarily successful answers                  |
| Unique AI identities across the window | 6                                | PostHog identities, not verified external people                                         |
| Peak daily active AI identities        | 3                                | Small exploratory audience                                                               |
| Sum of daily active AI identities      | 9 user-days                      | Not 9 distinct users; some identities recur                                              |
| Project / workspace questions          | 42 / 12                          | 77.8% / 22.2% of recorded questions                                                      |
| Project creations                      | 18 events from 14 identities     | Events and persons are different denominators                                            |
| Evidence creations                     | 35                               | Includes the 2 transcript creations; those are a subset, not 2 additional Evidence items |
| Render requests                        | 8                                | Requests, not completed or successful renders                                            |
| Proposal generation                    | 29 nonempty passes, 46 Proposals | Sum `proposal_count` to count Proposals; event count measures passes                     |
| Proposal decisions                     | 9 accepted, 10 rejected          | 19 decided Proposals, each outcome carrying a distinct Proposal ID within its series     |
| Acceptance among decided Proposals     | **47.4%**                        | `9 / (9 + 10)`, confirmed by the saved formula                                           |
| Application exceptions                 | 7                                | All recorded by the web SDK, all marked unhandled                                        |
| Model calls                            | 47, including 27 errors          | Mixed-environment telemetry; an actionable failure signal, not a production error rate   |

Question events first appear on 20 September, and activity is concentrated in a handful of days.
The project workflow dominates this sample, which supports prioritizing Project-context Assistant usability for further testing.
It does not prove market preference or sustained engagement.
The question event fires only after authentication, model configuration, message validation, and the daily-cap check; unsupported, invalid, or capped submissions do not all count as questions.

The 47.4% Proposal figure is worth submitting even though it is not a flattering headline.
It shows that users exercised both acceptance and rejection, and motivates inspecting rejected Proposals and the edits needed before acceptance.
Six of the nine historical acceptances carry `edited_before_accept: true`, but earlier instrumentation and the small mixed sample make this a recorded flag, not a trustworthy estimate of AI correctness or editing burden.
Pending Proposals are excluded from the denominator.
Do not divide 9 acceptances by the 46 generated Proposals to claim cohort conversion: acceptance logging predates generation logging, and the events are not a matched creation cohort.
Of the 46 generated Proposals, 38 came from heuristic extraction and 8 from model extraction, so overall acceptance must not be described as an LLM accuracy score.

## Why the current funnel is misleading

The saved funnel is ordered, person-based, and has a 14-day conversion window:

| Required step       | Persons reaching this step | Percentage of entrants |
| ------------------- | -------------------------: | ---------------------: |
| `project_created`   |                         14 |                   100% |
| `evidence_created`  |                          7 |                    50% |
| `render_requested`  |                          0 |                     0% |
| `proposal_accepted` |                          0 |                     0% |

The supplied crop hides the final two steps; the saved query exposes them.
The displayed 22-second transition is the median time to Evidence, while the mean is about 265 seconds.
Neither is a task-completion benchmark for external users.
“Persons” here is PostHog terminology, not PrismPM's Person domain entity.

A Render is not required to accept a Proposal, so zero at the last step does not mean nobody received value: nine acceptance events exist outside this prescribed sequence.
There is also no same-Project constraint, and Evidence, transcript, and Render events currently omit `project_id`.
A person's Project creation can therefore be followed by activity in a different Project.
The 50% figure is valid for this saved query, but not evidence that half of Projects activated or half of Evidence items succeeded.

Replace the general activation interpretation with separate paths: signup to first meaningful action; Evidence to generated Proposal to Decision; and Render requested to Render completed.
Define the denominator and conversion window for each path, keep Project identity consistent, and treat no-observation days as missing observations rather than a 0% acceptance judgment.

## Data quality and instrumentation findings

| Finding                                                            | Evidence                                                                                                                                                      | Consequence and next action                                                                                                                        |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local and deployed activity share one PostHog project              | 313 pageviews on `jira-pro-max.vercel.app`, 273 on `localhost:3000`, 8 on `localhost:3002`                                                                    | 281/594 pageviews, or 47.3%, are localhost traffic; isolate production or add consistent environment metadata on browser and server events         |
| Test-account filtering currently excludes nobody                   | Every inspected insight enables `filterTestAccounts`; its `Internal / Test users` cohort has count 0                                                          | Populate and verify the cohort; a checked filter is not evidence of a clean audience                                                               |
| Server events lack environment metadata                            | No inspected custom server event has `environment`                                                                                                            | A browser-host filter cannot reliably classify historical server events; do not relabel these totals as production-only                            |
| Historical session linkage is partial                              | Questions 32/54; Project creation 8/18; Evidence 23/35; acceptances 2/9; rejections 5/10                                                                      | Avoid session-funnel claims across the full historical period; current local SDK transport checks and historical events answer different questions |
| Project linkage is incomplete                                      | Project creation 18/18 and generation 29/29 have `project_id`; Evidence 0/35, Render 0/8, transcript 0/2                                                      | Add Project identity consistently before making a same-Project funnel                                                                              |
| Some paths bypass action-level capture                             | Project/Evidence/Render events live in actions, while Assistant/MCP callers can use services directly                                                         | Current counts are instrumented-path counts, not an exhaustive ledger of domain writes                                                             |
| Sample onboarding writes bypass these captures                     | The signup hook seeds its sample Project directly                                                                                                             | Signup and Project-create totals are not expected to reconcile one-to-one                                                                          |
| Outcome coverage changed over time                                 | Historical acceptances have Project ID in 5/9 rows and rejections in 6/10; their IDs and edit flags are otherwise present                                     | Segment by instrumentation era before comparing old and new behavior                                                                               |
| AI question and completion instrumentation cover different periods | First question: 20 September; first completion event: 25 September; 54 questions versus 10 completions                                                        | `10/54` is not an answer-success rate; approvals and multi-call turns also have different semantics                                                |
| Some defined events have no observed rows                          | No `assistant_tool_approval` or `assistant_citation_opened` in the audit window                                                                               | Code existence is not delivery evidence; trigger and reconcile those flows in a controlled follow-up                                               |
| Exception dashboard description overstates its query               | It says split by handled versus unhandled, but the saved query is one total `$exception` series                                                               | Rename the description or add the actual breakdown; all 7 recorded events happen to be unhandled                                                   |
| Exception/friction coverage is not guaranteed by current config    | Browser initialization disables automatic capture and remote flag/config fetching; no explicit `capture_exceptions` option or server exception handler exists | Historical exceptions, 56 dead clicks, and 1 rage click do not certify current or server-wide monitoring                                           |
| No release identifier in the reviewed capture helpers              | Local source can be identified, historical events cannot be tied to its commit from these fields                                                              | Add release metadata before interpreting before/after changes                                                                                      |

Source references: [browser transport and SDK configuration](../../../src/shared/analytics/browser.ts), [server capture](../../../src/shared/analytics/server.ts), [Project actions](../../../src/server/modules/projects/actions.ts), [Evidence actions](../../../src/server/modules/evidence/actions.ts), [Render actions](../../../src/server/modules/renders/actions.ts), [Proposal analytics](../../../src/server/modules/proposals/analytics.ts), [signup hook](../../../src/server/auth/auth.ts), and [chat route](../../../src/app/api/assistant/chat/route.ts).
The existing [identity](../../artifacts/73-analytics-identity/README.md) and [Proposal funnel](../../artifacts/74-proposal-funnel/README.md) artifacts document earlier fixes and an initial-load session-transport timing limitation.
A fresh production landing capture verified delivery, but authenticated production mutations were not replayed during this audit.

PostHog's [remote-config loader](https://github.com/PostHog/posthog-js/blob/main/packages/browser/src/remote-config.ts) and [exception observer](https://github.com/PostHog/posthog-js/blob/main/packages/browser/src/extensions/exception-autocapture/index.ts) explain why disabling remote configuration while leaving exception capture unspecified cannot guarantee fresh-browser exception collection.
The same behavior was checked in the installed `posthog-js` 1.434.2 source.

## LLM observability results

All 47 generation events contain a nonempty raw `$ai_trace_id`, and 46 carry a browser session.
The retained property inventory and aggregate check show no `$ai_input` or `$ai_output_choices` content in these generation events.
Twenty calls have input/output token counts and computed costs, totaling 171,850 input tokens, 4,458 output tokens, and **US$0.02439195** of PostHog-recorded cost.
That is an estimate over priced recorded calls, not the application's total provider bill or a verified billing reconciliation.
The 27 errors have no token/cost coverage in this sample.

| Span and model                                 | Calls | Errors | Median generation latency |
| ---------------------------------------------- | ----: | -----: | ------------------------: |
| Assistant, `gpt-4o-mini`                       |    15 |     15 |                   0.427 s |
| Reflection, `gpt-4o-mini`                      |    13 |     12 |                   0.231 s |
| Assistant, `openai/gpt-4o-mini`                |     9 |      0 |                   3.849 s |
| Assistant, `gpt-4o-mini-2024-07-18`            |     8 |      0 |                   2.279 s |
| Reflection, `openai/gpt-4o-mini`               |     1 |      0 |                   4.391 s |
| Proposal extraction, `google/gemini-2.5-flash` |     1 |      0 |                   5.943 s |

All 27 errors are recorded as `AI_APICallError`: 15 Assistant calls and 12 Reflection calls.
Investigate provider/configuration failures first, but the error class alone does not identify the root cause.
Do not present the fast failed calls as good answer latency or claim the model-name groups are controlled model comparisons.
A User-facing turn may contain several model calls plus tools, and Reflection is background work.

Model attribution is unreliable at the source.
Reflection (`reflection/service.ts`) and Proposal extraction (`proposals/extract.ts`) resolve the User's model with `getModelForUser` but always record the environment `modelInfo()`, on success and failure.
The chat route records the actual model on success, but a failed call keeps the environment model and provider.
The data fits this: all 15 failed Assistant calls are labelled `gpt-4o-mini`, the environment default, while successful ones carry resolved ids.
A controlled failing personal-provider request would confirm it end to end.
No prompt was changed and no paid model call was made for this verification.

## Submission conclusion and priorities

The strongest honest conclusion is: **PrismPM has working analytics delivery and observed use of its main workflows; the present sample is small, mixes development with deployment, and reveals both useful Proposal review behavior and AI operational failures.**
Use the 54 questions, 42/12 workflow mix, and 9/19 acceptance figure with their denominators and the mixed-environment label.
Do not use the general funnel as activation evidence, infer retention from a few active days, treat missing events as proof of no failures, or call acceptance model accuracy.

1. Separate production and test traffic, populate the exclusion cohort, and include environment and release metadata on server events.
2. Put Project identity and capture coverage at the appropriate successful service transitions, then rebuild the value and Render funnels separately.
3. Verify explicit exception capture, rejected requests, personal-model failure attribution, tool approvals, and citation clicks with controlled end-to-end checks.
4. Resolve the session-revocation failures (in an uncommitted local test file) and the intermittent Conversation error recorded in [verification results](verification-results.md).
5. Repeat the audit over a defined external-user cohort and completed observation period before making product-performance claims.

## Supplied dashboard screenshots

### AI volume and active users

![AI question volume and daily active AI users](screenshots/01-ai-volume-and-users.png)

### Workflows and exceptions

![AI workflow mix and application exceptions](screenshots/02-workflows-and-exceptions.png)

### Product activity and funnel

![Core product activity and cropped funnel](screenshots/03-product-activity-and-funnel.png)

### Proposal outcomes

![Proposal acceptance rate and outcomes](screenshots/04-proposal-outcomes.png)
