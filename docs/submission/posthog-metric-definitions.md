# PostHog metric interpretation

Research date: 2026-09-28.
This note defines how to interpret the supplied dashboard screenshots.
It was written before the [audit](posthog-2026-09-28/README.md), which has since exported the saved queries, counts and filters; where this note says the screenshots cannot establish something, the audit settles it.
The implementation inventory is in [M19](m19-analytics.md).

## Questions, users, and incomplete periods

PostHog's Total count counts event occurrences, while Unique users deduplicates users within each displayed period. [PostHog aggregation definitions](https://posthog.com/docs/product-analytics/trends/aggregations)
For daily AI activity, use `assistant_question_sent` with Unique users and a daily interval.
By definition, adding daily unique counts gives active user-days, not the number of distinct users over the entire date range, because the same User can appear on several days.
Recompute uniques over the whole range when reporting total AI users.

A dotted Trends segment means the period is still collecting data; it does not itself mean a forecast or a projected final total. [PostHog Trends](https://posthog.com/docs/product-analytics/trends/overview)
Consequently, the final dotted segment in the supplied AI charts should be labeled an incomplete period and should not be compared as a completed day.
The screenshots alone do not establish the dashboard timezone, exact time boundaries, filters, or whether internal testing was excluded.

## Funnels and the meaning of “persons”

PostHog's person funnel counts unique users completing a sequence, not the number of times each event fired, and its documented default conversion window is 14 days. [PostHog paths versus funnels](https://posthog.com/docs/product-analytics/paths#why-dont-my-path-numbers-match-my-funnel-numbers)
The screenshot's 14 persons at `project_created` and 7 persons at `evidence_created` therefore mean 7 of the 14 counted identities reached the second step under that query's settings.
They do not establish that 14 Projects were created or that half of all Evidence items succeeded.
“Persons” here is PostHog identity terminology, not PrismPM's Person domain entity.

Funnel steps default to sequential order, and PostHog advises avoiding optional steps that can skew conversion. [PostHog funnel definitions](https://posthog.com/docs/product-analytics/funnels)
Inference for PrismPM: requiring `render_requested` before Proposal acceptance measures a particular render workflow, not general activation, because requesting a render is not required to accept a Proposal.
Use the Evidence to Proposal to Decision path separately from the render path, with the conversion window explicitly recorded.

Inference for PrismPM: matching only the User permits one Project's creation to be followed by another Project's Evidence or Proposal event.
A same-Project claim requires `project_id` on every relevant event and a query that enforces equality across steps, or explicit Project group instrumentation and aggregation.
A breakdown label alone should not be treated as proof of that equality.
PostHog supports aggregating funnels by instrumented groups such as Projects. [PostHog group analytics](https://posthog.com/docs/product-analytics/group-analytics)

## Proposal acceptance

PostHog formulas combine series at each time point. [PostHog formulas](https://posthog.com/docs/product-analytics/trends/formulas)
For event series A = `proposal_accepted` and B = `proposal_rejected`, define the decided-Proposal acceptance fraction as `A / (A + B)` and display it as a percentage.
Across the full period, calculate `sum(A) / (sum(A) + sum(B))`, not the unweighted average of daily percentages.
Days with no decisions have an undefined rate and should be reported as no observations, not evidence of 0% acceptance.
The visible outcome bars suggest 9 accepted and 10 rejected, giving approximately 47.4%, conditional on the screenshot containing all relevant bars and both series counting individual decisions.
The audit confirms 9 and 10 from exported query results.
The denominator excludes pending Proposals and does not measure correctness, satisfaction, or the fraction of all generated Proposals accepted.

## AI cost, latency, and reliability

PostHog defines `$ai_generation` as one model call, `$ai_latency` in seconds, `$ai_is_error` as the error flag, and `$ai_trace_id` as the grouping identifier for related AI events. [PostHog manual capture reference](https://github.com/PostHog/skills/blob/main/skills/posthog/all/skills/llm-analytics-setup/references/manual-capture.md)
That reference also explains automatic cost calculation from model and token counts, with explicit costs or custom prices available when needed.
The local [AI telemetry helper](../../src/shared/analytics/ai.ts) converts milliseconds to seconds and sends model, tokens, error class, and trace metadata without prompt or answer text.
The audit found all 47 generations arrived with trace ids, but only 20 have token counts and cost, and the recorded model name is unreliable (see M19).

Recommended analysis: inspect generation volume, token totals, cost coverage, median and p95 latency, and generation error fraction by model and span.
Compare those with `assistant_turn_completed` for user-facing turn duration, since one question can involve multiple model calls.
Keep application exceptions separate from model-call errors and distinguish requests from successful completions.
The four supplied screenshots contain no AI token, cost, or latency view, so they cannot substantiate those performance claims.

## Usefulness of the current evidence

The screenshots are useful evidence of recorded activity, workflow mix, and Proposal decisions, and should be preserved even when results are small or unfavorable.
Inference: the small visible daily AI audience and concentrated activity support exploratory product observations, not strong claims about adoption, retention, accuracy, or improvements caused by a release.
Before stronger claims, export the saved query settings and underlying counts, identify the production environment and internal-user exclusions, and reconcile representative events against completed user actions.
