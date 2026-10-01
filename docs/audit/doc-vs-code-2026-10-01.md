# Documentation versus code audit, 1 October 2026

Every checkable claim in `docs/submission/*.md` was checked, one document at a time, against the code on `main` (HEAD `6c079ed` plus the working-tree changes under "Fixed"), the raw artifact files the claim cites, or both.
Claims that are opinion, plans, or facts about other companies are listed as not checkable rather than passed.
The pitch (`group-05-pitch.pdf`) is not in the repository, so its items are listed here for whoever edits it.
An independent read-only agent re-verified the first version of this list; its corrections are folded in and its additions are marked "found in verification".

## Fixed in the same change

| #   | Problem                                                                                                                                                                                                                                                  | Fix                                                                                                                                                                                                                                                                                                                                                                                          |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | M13 and M17 said the dock refuses citations that do not point at a real item; it only checked the route shape.                                                                                                                                           | The dock links an href only if the server handed it to the model: a tool result's `cite` or `href`, or the Project summary (`citableHrefs`, `CITABLE_PART`). M11, M13 and M17 updated.                                                                                                                                                                                                       |
| F2  | M6, M9, M12 and M13 presented a sampled worst turn as a monthly ceiling, and a mixed per-case cost as per-turn.                                                                                                                                          | Reworded as an estimate; Gemini answer cost corrected from US$0.0018 (mixed 42-case average) to US$0.0031 per answer case.                                                                                                                                                                                                                                                                   |
| F3  | M1 made unsourced absolute claims about Jira + Rovo and Notion AI, two of which were wrong.                                                                                                                                                              | M1 rewritten with vendor sources dated 30 September 2026; M20's prepared reply adjusted.                                                                                                                                                                                                                                                                                                     |
| F4  | Why the deployment runs `gpt-4o-mini` was not stated.                                                                                                                                                                                                    | M9 and M13 say the team only holds an OpenAI key, so `gpt-4o-mini` is the default for Users without their own key.                                                                                                                                                                                                                                                                           |
| F5  | M15 and `architecture.md` said PDF and Word are read in-process by `unpdf` and `mammoth`; since the RAG commit `d442ec5` (25 September) neither was used, and without the `markitdown` CLI (absent on Vercel) Word and Excel uploads got no text at all. | `evidence/extract.ts` restores in-process conversion (`unpdf`, `mammoth`, new `read-excel-file` for XLSX) after `markitdown` and before the model. Verified with fixtures in `extract.test.ts`, and by uploading DOCX, XLSX and PDF through the UI on a production build with no `markitdown`; the DOCX produced a Decision Proposal. M5, M15, `architecture.md` and `.env.example` updated. |

**F1 follow-up (found in verification).**
The first version of the fix broke every follow-up message: the route validates the resent thread against its data-part schemas, and the new part had none, so the second question and every approval resume returned HTTP 400.
Fixed by registering `citableDataSchemas` in the route; `citation.test.ts` runs the same validation, and a three-turn conversation with an approval resume was checked in the browser.
The dock takes only `cite` and `href` fields from tool results, so a route-shaped link typed into Evidence text is not whitelisted, and it compares links without their `#` fragment, so a model that drops a `cite`'s scroll anchor still gets a working link.
Known limit: threads saved before this change have no summary part, so a citation copied from the Project summary in those old threads shows as plain text.

## Open: the pitch

P1. **Renders are shown as a Gantt timeline.**
Page 1 ("it drafts a Render, like a Gantt timeline", and the chart in panel 3) and page 2 ("such as a Gantt-style timeline").
The Render drafter writes a description for one concept image of the physical deliverable and is told to ignore schedules (`renders/draft.ts:42-45`, `provider.ts:17-21`); the Gantt chart is the Timeline view.

P2. **Photos and charts cannot be uploaded as Evidence.**
The headline ("Turn meeting notes, photos and charts into a plan"), panel 1 (`whiteboard.jpg`, `burndown.png`) and "Try it" step 2 ("upload a photo or chart").
Uploads accept PDF, DOCX, XLSX, CSV, TXT and Markdown only (`ACCEPTED_MIME` in `evidence/service.ts`, `accept` in `evidence-view.tsx:329`).

P3. **A chat message cannot become Evidence.**
The Messaging card says "a decision in chat can become evidence"; the Proposal pass reads Evidence, Comments and the Assistant Conversation only, and nothing in `messaging/` creates Evidence or a Proposal.

P4. **The deployed model's scores are hidden.**
The deployed column says "Reported in M11"; the headline 21/22 and 20/20 are `gemini-2.5-flash`, which the deployment does not run.
`gpt-4o-mini`: 16/22 extraction and 13/20 answers at baseline (M9, M11), 20/22 extraction after the prompt work, 14/20 answers on 30 September through OpenAI directly (`artifacts/cost-2026-09-30-answers/why-gpt-4o-mini.json`).

P5. **"684 passing Vitest tests"** is now 696 in 65 files.

P8. **Deployed-model cost figures.** "US$0.0025 mean cost per Assistant turn" and "about US$0.59 a month ... 5% of a US$12 seat" become US$0.0030 and about US$0.70 a month, 6% of a seat, at full uncached prices (D16).

P6. **Impact alerts are not triggered by new Evidence (found in verification).**
Page 2 says "Flags when new evidence touches an existing Decision"; the impact subscriber listens to `task.updated`, `milestone.updated` and `person.deleted` only (`impact/subscriber.ts:134-136`).

P7. **"Every write the Assistant attempts shows Deny, Allow once or Always allow first" is overstated (found in verification).**
An always-allowed tool runs without a card, and over MCP the writing tools run with only the client's own prompt (M23 says so).

## Milestones and developer docs

Every item in this section was corrected in the same change (the milestone text now states the figure the artifact supports), except D12, which is labelled as proposed pricing and left as is, and D13, an untracked work-in-progress test outside this change.

D3. **M16 "exercised end to end in CI by Playwright".**
`citations.proof.spec.ts` skips without a chat model (CI has none), `renders-draft.spec.ts` skips unless `RENDERS_E2E` is set (CI runs only `npm run test:e2e`), and the "Approval cards" row is unit tests plus a recording.
Three of M16's five coverage rows are not Playwright-in-CI.

D4. **What CI runs.**
M11 (near the end) says PR CI runs "`format:check`, `eslint` and `typecheck` only", and `AGENTS.md` lists the same three.
`ci.yml` also runs Vitest and Playwright; M15 is correct.

D5. **Prompt cache hit rate for the deployed model.**
M8 (section 2), M10 (pattern 8) and M12 (section 3 and the summary table) quote 95.3% cached for `gpt-4o-mini`, measured through OpenRouter.
The 30 September direct-OpenAI run reports 29.4% (D16 on whether that figure is reproducible); M12's "no prompt trim" decision rests on the 95% figure.

D6. **Eval case count.** M20's maker comment says "42 evaluation cases"; the suite has 54.

D7. **Outcomes.** M3 point 3 lists "outcomes" in the history a Project builds; nothing records outcomes, and M5 lists outcome feedback as future work.

D8. **Tool count.**
`architecture.md:327`, `ai-system-guide.md:167` and M9 (self-hosted row, "27 tools") say 27; the registry has 30 (27 Project, 3 workspace), and 27 is the MCP subset.

D9. **Model providers.** `architecture.md:373` says "only the OpenAI provider is implemented"; four are built in `assistant/model.ts`.

D10. **Which tools need approval.** `architecture.md:370` names three tools as needing approval cards; every writing tool does, and those three also need a confirmation that names the target.

D12. **Preview tier limit (minor).** M6's proposed Preview tier lists "3 Projects"; no Project limit exists, and M6 opens by saying the current release is a free research preview.

D13. **Failing tests.**
The untracked `src/server/auth/session.test.ts` fails 2 of its 3 tests: `auth.ts` enables a 5-minute session cookie cache, so a deleted User or revoked session stays signed in until it expires.

D14. **Test count in M13.** `m13-safety.md` says "684 tests in 64 files"; it is now 696 in 65.

D15. **"4 of 22 cases flipped".**
M9 (temperature row) and M11 (decision 4) say two provider-default repeats of `gpt-4o-mini` disagreed on 4 of 22 extraction cases.
The per-case files in `artifacts/param-sweep-2026-09-28/default-a` and `default-b` show 3 verdict flips (20/22 and 17/22); the kept Proposals differ in 17 of 22 cases.
Neither reading gives 4.

D16. **Deployed-model turn cost is not reproducible from the saved artifact.**
M6 (and M9, M12, M13 via M6) give US$0.0025 mean and US$0.0047 costliest turn for `gpt-4o-mini`, using a 29.4% cache rate.
`artifacts/cost-2026-09-30-answers/why-gpt-4o-mini.json` records `cachedTokens: 0` for every case, so the saved data prices out at about US$0.0030 mean and US$0.0058 costliest; the 29.4% came from a debug log that was not saved.
Tokens (18,878 prompt, 207 completion) and 2.25 calls per turn do match.
The same artifact's README says 13/20 passed; the per-case file shows 14/20.

D17. **`maxOutputTokens`.** M9 says it is unset "except `16` in the credential health check"; Render drafting also sets 400 (`renders/draft.ts:67`).

D18. **M13's verification table is not all CI tests.**
It opens "Each row is an automated test that runs in CI", but the rate-limit row cites route code (only the turn counter is unit-tested), the MCP 401 row is a manual check against the live site, and the Render data-leak row's e2e spec does not run in CI (D3).
M13's "Injection is tested by two cases" is three (`x07`, `w11`, `i12`), which its own table lists.

D19. **"All 6 vectors re-compute".**
M12 (section 7) and M21 say the stale-embedding check re-computed all 6 vectors; `artifacts/rag-check-openrouter-2026-09-28/README.md:33` records 4 items.

## Claim ledger by document

"OK" means checked against the cited code or artifact and it holds.

**M0.** Problem statement; not checkable.

**M1.** Competitor features: sourced and dated (F3); not re-checkable from the repo. PrismPM's four capabilities (confirmed-only "why" answers, Assumptions, supersession, change-triggered review): OK (`WHY_RULES`, `ASSUMPTION_SUBTYPES`, `superseded_by` edges, impact subscriber).

**M2.** User stories match shipped features: board, list, Timeline, Calendar; sample Project and tour; Evidence upload and paste (now including Word); Proposals with verbatim excerpts; semantic and Label search; impact alerts; approval cards with Always allow; concept Renders; MCP; Participant invite links. OK.

**M3.** Structured decision graph, pending-until-accepted Proposals, same services for AI and UI, MCP: OK. "outcomes": D7. Strategy statements: not checkable.

**M4.** Plans and targets; the funnel events named exist in code. Otherwise not checkable.

**M5.** Every MVP row checked: 30 tools, approval on every write, Proposal pass on Evidence save and Comment, Render limits (3 Evidence), four BYOK providers encrypted at rest, MCP at `/api/mcp`, email and Google sign-in, sample Project seeded on signup, tour, `workspace/queries.ts`. OK after F5. Live URL: not checked.

**M6.** Cost table: tokens, calls and embedding cost OK against `artifacts/cost-2026-09-30`; turn cost D16. Proposal pass US$0.00058 + US$0.00049 = US$0.00106, 84%, US$0.0004 per save (derived, and labelled so): OK. Gemini and Haiku per answer case after F2: OK. "8x cost lever": OK (US$0.4916 / US$0.0620). Preview limit: D12. Pricing and positioning: not checkable.

**M7.** Every table row maps to the file it names; file transcription now runs only for files no converter reads (F5). OK.

**M8.** All three full prompts compared line by line with the source: every line matches. `CITATION_RULES` and `WHY_RULES`: match. 12 recent Conversation turns, `<<<`/`>>>` stripping, 0 of 6 then 16 of 16 citations, `w06` 19/20 to 20/20, prompt-iteration stage table: OK against artifacts. 95.3% cache: D5.

**M9.** Bake-off table: OK against `model-bakeoff-2026-09-28/summary.json`. `getModel()` in `model.ts`: OK. Temperature 0 for extraction, provider default for the answer loop and Reflection: OK. 19,743 and 4,202 completion tokens, 3/20 versus 19/20 byte-identical answers: OK. "4 of 22 flipped": D15. `maxOutputTokens`: D17. "27 tools": D8. 1536-dimension embeddings with Gemini MRL truncation and `provider:model` stamping: OK. Cap row: D16.

**M10.** `bindScope`, `toolApprovalFor`, signed approvals, `stepCountIs`, `hit_step_cap`, 27 Project and 3 workspace tools, `read_evidence` 20,000 characters, SHA-1 source hashes, `traceProposals`, two extraction calls, heuristic fallback when no model is configured, Reflection in `after()`, Render draft `maxOutputTokens: 400`, `createUIMessageStreamResponse`, four `@ai-sdk` vendors: OK. 95.3% cache: D5.

**M11.** Fixture (6 Evidence, 3 Comments, 6 Decisions with D-2 superseded by D-5, 4 Assumptions of the stated subtypes): OK. Case counts 22 and 20 and the five read tools: OK. Results table: OK. "4 of 22": D15. CI sentence: D4.

**M11 addendum.** 9/12 in both `gpt-4o-mini` runs failing `i01`, `i04`, `i06`; heuristic 6/12 passing `i01`, `i03` and all four negatives; 8,615 prompt and about 960 completion tokens; raw count 1 then dropped by trace for `i10` and `i11`; `i12` raw 0: OK against `artifacts/item-evals-2026-09-30`.

**M12.** Batching table and its 57%, 57% and 29%; 11 ms repeat pass; heuristic 12/22 versus 20/22 and 21/22 with latencies and costs; 6x token and 3.5x cost outlier; `ensureIndexed` limit of 100 (`BACKFILL_MAX`); 8x Haiku-to-Gemini cost: OK. 95.3%: D5. "all 6 vectors": D19.

**M13.** Fencing, `traceProposals`, pending-only Proposals, `search_decisions` excluding them, signed approvals, `MCP_TOOLS`, `assertOwnsProject`, `bindScope`, `normalizePublicHttpsUrl` and `guardedFetch`, AES-256-GCM with a 12-byte nonce and `userId` as additional data, 32-byte key, cap and step values, 60 s `maxDuration`, Render cap under the Project row lock, 6,000 characters per Evidence, `safe=privacy,secrets`, message validation, `repair.ts`, every named test: OK. Test count: D14. "Each row ... runs in CI" and "two cases": D18.

**M14.** Rename from Vantage on 21 September (#71), shared `Logo` component used by `opengraph-image.tsx`: OK. Naming rationale: not checkable.

**M15.** Package versions at `34be9db`: OK. CI jobs: OK. File-text row: fixed (F5). Hosting fork and Neon: not checkable from the repo.

**M16.** Workflow steps and UI strings, accept running under `via: "assistant"`, the pass in `after()`: OK. CI coverage table: D3.

**M17.** Every quoted UI string exists in `src/`; 6 of 9 acceptances edited (PostHog export): OK. Citation section: F1.

**M18.** Hero copy, CTAs, `robots.ts` disallow list, `sitemap.ts`, `opengraph-image.tsx`, Lighthouse 100 SEO, accessibility and best practices with performance 88 mobile and 100 desktop (`docs/artifacts/72-landing/lighthouse`): OK. Live-site checks: not re-run.

**M19.** Every count checked against `posthog-2026-09-28/aggregate-queries.json` (54 questions from 6 identities, 9 accepted and 10 rejected, 46 Proposals in 29 passes split 38 and 8, 47 calls with 27 errors, US$0.024 over 20 priced calls, 7 unhandled exceptions, 281 of 594 pageviews from localhost, 361 autocapture, 56 dead clicks, 1 rage click): OK. Code gaps it reports (no `project_id` on Evidence events, autocapture off): OK.

**M20.** Gallery sources and recordings exist; description and replies match shipped behaviour. "42 evaluation cases": D6.

**M21.** Chunking 1,600 and 200, literal fallback with a note, Label and link filters, 16 of 16 citations, abstention cases: OK. Missing basic-RAG ablation: stated by the document itself. "all 6 vectors": D19.

**M23.** `withMcpAuth` with `required: true`, SHA-256 token hashes shown once, 27 tools, `via: "assistant"`, the three excluded tools: OK. HTTP 401 on the live site: not re-run.

**posthog-metric-definitions.** PostHog semantics: external. The telemetry helper sends no prompt or answer text: OK (0 of 47 generations carry either).

**Links.** Every relative link in `docs/submission/*.md` resolves.
