# M10 - AI interaction patterns

PrismPM's AI layer has three jobs, and every pattern below exists to serve one of them.

1. **Answer "why did we..." from the record**, with a citation the PM can click, and say so when nothing is recorded.
2. **Capture Decisions the team already made** from meeting notes, plans and Comments, without the PM typing them in.
3. **Act on the Project from chat** - create Tasks, move dates, log Risks - without the chat becoming a way around the rules the UI enforces.

The patterns are ordered from the most load-bearing to the least.

## 1. Tool calling over one registry

- **Where:** `src/server/modules/assistant/tools.ts` (`PROJECT_TOOLS`, `WORKSPACE_TOOLS`), adapted per turn by `toAiTools` in `ai-tools.ts`
- **Size:** 27 Project tools and 3 workspace tools, each a name, a Zod input and a handler

Every handler calls a `service.ts` function and nothing else.
That is the whole reason for the pattern: a Task created by the Assistant goes through the same `assertOwnsProject`, the same validation and the same Activity Event as a Task created by a button (ADR 0007).
The model cannot reach a repository, so it cannot do anything the User could not do by hand.

Scope is bound on the server, not trusted from the model.
`bindScope` removes `projectId` and `conversationId` from the schema the model sees and injects them from the Conversation row, so a Project dock cannot be talked into reading another Project.

The same registry is the MCP server (`src/app/api/mcp/route.ts`): an external client such as Claude Desktop gets every tool that needs no confirmation card, with no second implementation to drift.

## 2. A bounded agent loop

- **Where:** `src/app/api/assistant/chat/route.ts`
- **Call:** `streamText({ model, system, messages, tools, toolApproval, stopWhen: stepCountIs(maxSteps) })`

One User turn is a loop: the model may call tools, read their results and call more before it answers.
A question like "why is the security review two half-days?" needs `search_decisions`, possibly `read_evidence` on a cited Source, then an answer - three steps the model plans itself.

The loop is capped at `ASSISTANT_MAX_STEPS = 8`.
Measured on the 20 answer cases, no model used more than 3 steps (median 2) - [M12](m12-optimization.md) - so the cap never cuts off a real answer and exists only to stop a runaway loop.
A turn that hits it is recorded as `hit_step_cap` in analytics.

## 3. Human approval inside the loop

- **Where:** `toolApprovalFor` in `ai-tools.ts`, ADR 0011

Every tool marked `mutates` stops the loop at an approval card; read tools run immediately.
Destructive and Project-level tools (`delete_task`, `delete_milestone`, `update_project`) also carry `requiresConfirmation` and a `describe` that names the concrete target, for example `Delete Task PM-12 "Write test plan"?`.
The User may "always allow" a write tool per scope, which turns the card off for that tool only.

Approval responses are signed with `experimental_toolApprovalSecret`, so a client cannot forge an "approved" message.
Tools with `requiresConfirmation` are excluded from MCP, because MCP has no UI to show the card.

This pattern is what makes pattern 1 safe to offer at all: the model proposes an action, the PM decides.
The threat model is in [M13](m13-safety.md).

## 4. Retrieval-augmented answers, over two indexes

The Assistant never answers from the model's own knowledge.
It retrieves through three tools and cites what they return.

| Tool               | What it retrieves                                                                                                         | How                                                                                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `search_evidence`  | Chunks of Evidence text, ranked by semantic similarity, optionally restricted by Label or by a linked Task/Risk/Milestone | Chunked embeddings (`text-embedding-3-small`, 1536 dims) in a per-Project FAISS index, fed by an `evidence.*` event subscriber (`src/server/modules/search/`, ADR 0014) |
| `read_evidence`    | The full text of one Evidence item, up to 20,000 characters                                                               | Direct read, by id or by title                                                                                                                                          |
| `search_decisions` | Confirmed Decisions with context, rejected alternatives, supersession, Assumptions and Sources                            | Structured search over the Decision graph (ADR 0008); pending Proposals are never returned                                                                              |

The split is deliberate.
Semantic search is right for "what did the vendor say about dates?", where the answer is somewhere in prose.
It is wrong for "why did we choose fourteen merchants?", because a similar-sounding paragraph is not a Decision, and a PM must not be told a reason nobody agreed to.
`WHY_RULES` in `prompt.ts` therefore routes every "why" question to `search_decisions` and forbids answering one from anything else.

**Citation as copying, not construction.**
Every tool result that names an item carries a ready-made `cite` field built by `citation()` in `src/shared/lib/citation.ts`.
The model is told to paste it verbatim and never to write a link.
Before this, 0 of 6 citations the model had to construct itself worked; after, 16 of 16 resolved ([M8](m8-prompts.md)).

## 5. Structured output, then a deterministic filter

- **Where:** `src/server/modules/proposals/extract.ts` (`modelExtract`), `trace.ts`
- **Call:** `generateObject` with `z.object({ proposals: z.array(rawProposalSchema) })`, `temperature: 0`

Extraction feeds a database write, so it uses a schema rather than free text: the provider constrains generation to the shape, and the app never parses a hopeful string.

Schema-valid is not the same as true.
`traceProposals` keeps a Proposal only if every Source it cites exists in the Project and its excerpt is a verbatim substring of that Source.
Assumptions whose target Person, Milestone or Task cannot be resolved by name are dropped one by one.
A fingerprint of the cited passage stops the same sentence being proposed twice.

## 6. A multi-step background workflow with a human at the end

The Proposal pass (`proposalsService.runPass`, ADR 0008) is a pipeline, not a chat.

1. Saving Evidence or creating a Comment schedules a pass in `after()`, off the User's response path.
2. The pass skips every source whose SHA-1 text hash it has already read.
3. It sends all remaining sources in one `generateObject` call, transcripts first.
4. `trace.ts` filters the result; survivors are stored as **pending** Proposals.
5. The PM accepts, edits or rejects each one; only an accept writes a Decision, through `decisionsService`.

Batching and hashing are the cost story in [M12](m12-optimization.md): 57% fewer tokens than one call per source, and a repeat pass costs $0.
Step 5 is the safety story in [M13](m13-safety.md): the model never writes to the Decision graph on its own.

When no key is configured, `PROPOSALS_EXTRACTOR=heuristic` runs a deterministic sentence matcher in the same slot, so the pipeline still works at 12/22 instead of 21/22.

## 7. Memory by reflection

After a turn is saved, `reflect()` runs in `after()` and may rewrite two short prose documents: the User's Profile and the Project's Working Memory (ADR 0007).
Both are injected into the next turn's system prompt.
A Reflection failure is logged and never reaches the User, because the answer was already delivered.

## 8. Context injection ordered for the cache

The Project system prompt carries the rules first and `JSON.stringify(summary)` of the Project last.
The model can therefore reference Statuses, People and Milestones by id without a tool call, and the stable prefix is cached by the provider: 95.3% of prompt tokens were served from cache for `gpt-4o-mini` ([M12](m12-optimization.md)).

## 9. Streaming

The route returns `createUIMessageStreamResponse` and the dock uses `useChat`, so text, tool status and approval cards appear while the loop runs rather than after 2.5 to 5 seconds of silence.

## Framework and SDK selection

| Need                                               | Chosen                                                                               | Why                                                                                                                                                                                                                    |
| -------------------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tool loop, structured output, streaming, approvals | Vercel AI SDK (`ai`)                                                                 | One library gives `streamText` with a step cap, `generateObject`, signed tool approvals and `useChat`, all native to the Next.js App Router the app already runs on. No glue layer between the loop and the UI stream. |
| Several model vendors behind one interface         | `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google`, `@ai-sdk/openai-compatible` | `buildModel` in `model.ts` switches vendor by configuration. This is what let the [M9](m9-model-bakeoff.md) bake-off run three vendors with no code change, and lets a User bring their own key (ADR 0011).            |
| External agents                                    | `mcp-handler`                                                                        | A thin adapter over the existing registry; adding a registry entry adds an MCP tool.                                                                                                                                   |
| Vector search                                      | FAISS, one index per Project                                                         | Evidence never leaves its Project's index, which matches the ownership model, and no hosted vector database is needed (ADR 0014).                                                                                      |

The provider decision was measured ([M9](m9-model-bakeoff.md)).
The framework decision was not benchmarked against an alternative: the AI SDK was chosen because each requirement in the table maps to one of its primitives, and a heavier orchestration framework would have added a second abstraction over tools and prompts that `tools.ts` and `prompt.ts` already own.

## How the patterns map to the objectives

| Objective                       | Patterns                                                                     |
| ------------------------------- | ---------------------------------------------------------------------------- |
| Answer "why" from the record    | Retrieval (4), bounded loop (2), citation copying (4), context injection (8) |
| Capture Decisions automatically | Structured output and filter (5), background workflow (6)                    |
| Act on the Project from chat    | Tool registry (1), approval in the loop (3), streaming (9)                   |
| Get better with use             | Memory by reflection (7)                                                     |
