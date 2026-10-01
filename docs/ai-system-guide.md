# PrismPM AI System Guide

This guide explains how PrismPM's Assistant, MCP endpoint, memory, proposal extraction, decision answers, and impact detection fit together.
It describes the code that exists in this repository today and calls out what is deterministic, what uses a language model, and what is only planned.

For the complete application diagram, UI-to-database flow, authentication, storage, messaging, analytics, and deployment boundaries, start with the [architecture guide](architecture.md).

## The short version

PrismPM does not contain a group of independent agents.
It has one tool-using Assistant exposed through two entry points:

1. The Assistant dock in the web application sends chat turns to `/api/assistant/chat`.
2. External MCP clients call `/api/mcp` and receive most of the same tools.

Both entry points eventually call the same service layer.
That is the most important architectural rule: the model never writes directly to PostgreSQL.
Assistant writes therefore use the same ownership checks, validation, transactions, Activity Events, and domain events as changes made through the normal UI.

Three additional intelligence features surround the Assistant:

- Proposal extraction reads new Evidence and Comments and suggests Decisions for human approval.
- Reflection updates a versioned User Profile and Project Working Memory after eligible chat turns.
- Impact detection watches Project events and deterministically breaks contradicted Assumptions, then walks the decision graph to show downstream effects.

The first two can call the configured OpenAI model.
Impact detection and decision search are deterministic application logic, not model inference.

Primary sources: [ADR 0007](adr/0007-assistant-acts-through-services-with-via-actor.md), [ADR 0008](adr/0008-decision-memory-graph.md), [chat route](../src/app/api/assistant/chat/route.ts), [tool registry](../src/server/modules/assistant/tools.ts).

## System map

```text
                                  OpenAI model
                                      ^
                                      |
Browser Assistant dock -> /api/assistant/chat -> AI SDK tool loop
                                      |
                                      v
                              shared tool registry
                                      ^
                                      |
External MCP client -----> /api/mcp adapter
                                      |
                                      v
                         feature service.ts modules
                                      |
                    ownership + validation + mutate(...)
                                      |
                  PostgreSQL + Activity Events + eventBus
                                      |
                                      v
                    deterministic impact subscriber

After a chat turn: Reflection may rewrite Profile and Working Memory.
After Evidence or Comment changes: a proposal pass may extract Decision, Task and Milestone Proposals.
```

Sources: [chat route](../src/app/api/assistant/chat/route.ts), [MCP route](../src/app/api/mcp/route.ts), [AI tool adapter](../src/server/modules/assistant/ai-tools.ts), [mutation core](../src/server/core/mutation.ts), [proposal scheduler](../src/server/modules/proposals/schedule.ts), [event subscribers](../src/server/events/subscribers.ts).

## 1. What “agent” means in this project

The in-app Assistant is an agent in the practical sense that a model can choose tools, inspect their results, and take several steps before replying.
It is not a separate User account, a long-running background process, or a multi-agent system.
It acts on behalf of the signed-in User by using a `Ctx` with `via: "assistant"`.

The model loop is created by `streamText` in the chat route.
The loop may continue until `ASSISTANT_MAX_STEPS`, which defaults to 8.
The model can emit text, call a tool, read the result, call another tool, and then provide its final response.

There are three model-driven roles, but they are ordinary functions using the same configured model rather than independent agent identities:

- Assistant: converses with the User and invokes Project tools.
- Proposal extractor: returns structured candidate Decisions from source material.
- Reflection: rewrites Profile and Working Memory documents.

There is also a `via: "system"` actor for deterministic impact detection.
That actor does not use a language model.

Sources: [model configuration](../src/server/modules/assistant/model.ts), [chat route](../src/app/api/assistant/chat/route.ts), [Reflection service](../src/server/modules/reflection/service.ts), [proposal extractor](../src/server/modules/proposals/extract.ts), [context type](../src/server/core/context.ts), [impact subscriber](../src/server/modules/impact/subscriber.ts).

## 2. The in-app Assistant turn, step by step

### 2.1 The dock loads the correct Conversation

The dashboard has one Conversation per User with no Project id.
Each Project has one Conversation per User and Project.
Opening a dashboard or Project loads the stored Messages and passes them to `AssistantDock`.

The dock uses the Vercel AI SDK React `useChat` hook and posts to `/api/assistant/chat`.
Responses are streamed, so text and tool status appear while work is happening.
If `create_project` succeeds from the dashboard, the dock navigates into the new Project.

Sources: [dashboard page](<../src/app/(app)/dashboard/page.tsx>), [Project layout](<../src/app/(app)/projects/[projectId]/layout.tsx>), [Assistant dock](../src/widgets/assistant/assistant-dock.tsx), [Assistant schema](../src/server/modules/assistant/schema.ts).

### 2.2 The server authenticates and validates the turn

The route checks that an OpenAI model is configured.
It validates the request body and then validates the complete UI Message history against the available tools with `safeValidateUIMessages`.
It creates the current User context and marks the call as `via: "assistant"`.
It also enforces `ASSISTANT_DAILY_TURN_CAP`, which defaults to 50 User Messages per UTC day across all Conversations.

Sources: [chat route](../src/app/api/assistant/chat/route.ts), [Assistant service](../src/server/modules/assistant/service.ts), [environment example](../.env.example).

### 2.3 The route binds the scope

The dashboard Assistant receives only `list_projects` and `create_project`.
The Project Assistant receives the Project tool set.

For in-app Project chat, `projectId` is removed from every model-facing tool schema and inserted by the server.
This prevents the model from pointing a Project-scoped dock at a different Project id.
The normal service ownership check remains in place as a second boundary.

Sources: [AI tool adapter](../src/server/modules/assistant/ai-tools.ts), [tool registry](../src/server/modules/assistant/tools.ts), [projects service](../src/server/modules/projects/service.ts).

### 2.4 The route builds the system prompt

For a Project turn, the route loads:

- The current Project summary, including ids for Statuses, People, Teams, Labels, Milestones, Tasks, Risks, and Evidence metadata.
- The User's global Profile, if one exists.
- The User's Working Memory for the current Project, if one exists.
- Rules for planning, duplicate avoidance, tool use, confirmation, Evidence prompt-injection resistance, and “Why did we?” answers.

For a dashboard turn, it loads the Project list and the global Profile.
The dashboard prompt tells the model not to guess about the contents of a Project that is not open.

Sources: [prompt builder](../src/server/modules/assistant/prompt.ts), [chat route](../src/app/api/assistant/chat/route.ts), [tool registry](../src/server/modules/assistant/tools.ts).

### 2.5 The model runs the tool loop

`streamText` receives the model, system prompt, validated Message history, tool set, approval policy, and step limit.
Tool results are converted to plain JSON before being returned to the model.
Expected domain errors are returned as `{ error: message }`, which gives the model a chance to recover or explain the failure.

Sources: [chat route](../src/app/api/assistant/chat/route.ts), [AI tool adapter](../src/server/modules/assistant/ai-tools.ts).

### 2.6 Sensitive operations pause for approval

Three in-app tools currently require a confirmation card:

- `delete_task`
- `delete_milestone`
- `update_project`

The server creates a human-readable reason that names the concrete target or change.
The AI SDK signs approval requests using `BETTER_AUTH_SECRET`, so a client cannot forge an approved response.
The dock prevents a new Message while an approval card is unanswered and sends the User's approve or deny response back into the same turn.

Sources: [tool registry](../src/server/modules/assistant/tools.ts), [AI tool adapter](../src/server/modules/assistant/ai-tools.ts), [chat route](../src/app/api/assistant/chat/route.ts), [Assistant dock](../src/widgets/assistant/assistant-dock.tsx).

### 2.7 The full thread is saved, then Reflection may run

At the end of the stream, the complete UI Message list is upserted into PostgreSQL.
Message `parts` preserve text, tool calls, tool outputs, and approval state.
Once saving succeeds, Next.js `after()` invokes Reflection outside the response path.
A Reflection failure is logged and never replaces the already delivered Assistant answer.

Sources: [chat route](../src/app/api/assistant/chat/route.ts), [Assistant repository](../src/server/modules/assistant/repository.ts), [Assistant schema](../src/server/modules/assistant/schema.ts), [Reflection service](../src/server/modules/reflection/service.ts).

## 3. The shared tool registry

The registry is an array of `ToolDef` values.
Each definition contains a name, description, Zod input schema, handler, and optional confirmation metadata.
Handlers call feature services and do not import repositories or write to the database directly.

The registry currently contains 30 tools (27 Project, 3 workspace); MCP serves the 27 that need no confirmation card.

### Workspace tools

| Tool             | Purpose                                                 |
| ---------------- | ------------------------------------------------------- |
| `list_projects`  | List owned Projects and Task counts by Status category. |
| `create_project` | Create a Project.                                       |

### Project tools

| Area                      | Tools                                                                                    |
| ------------------------- | ---------------------------------------------------------------------------------------- |
| Project context           | `get_project_summary`, `update_project`                                                  |
| Tasks                     | `list_tasks`, `get_task`, `create_task`, `update_task`, `delete_task`, `set_task_labels` |
| Milestones                | `create_milestone`, `update_milestone`, `delete_milestone`                               |
| Risks                     | `create_risk`, `update_risk`                                                             |
| Comments and dependencies | `add_comment`, `add_dependency`, `remove_dependency`                                     |
| People and Teams          | `list_people`, `create_person`, `list_teams`                                             |
| Labels                    | `list_labels`, `create_label`                                                            |
| Evidence                  | `list_evidence`, `read_evidence`, `link_evidence`                                        |
| Decision answers          | `search_decisions`                                                                       |

`read_evidence` limits model-visible source text to 20,000 characters per call and explicitly labels it as source material rather than instructions.

Source: [tool registry](../src/server/modules/assistant/tools.ts).

## 4. Why Assistant writes are safe and auditable

The Assistant is a caller of the existing service layer, not an alternative write path.
The intended write path is:

```text
tool handler
  -> feature service
  -> assertOwnsProject
  -> mutate(ctx, transaction)
  -> repository SQL
  -> Activity Event stored in the same transaction
  -> domain event published after commit
```

The `Recorder` stamps `via: "assistant"` on Activity Events produced by Assistant changes.
The History UI can therefore distinguish a normal User action from a change performed through the Assistant.

Conversations, Messages, Profile versions, Working Memory versions, API tokens, and pending Proposals are Assistant-owned documents rather than Project items.
They intentionally do not use `mutate` and do not create Project Activity Events.
When a Proposal is accepted, the resulting confirmed Decision does go through `decisionsService` and is attributed via the Assistant.

Sources: [ADR 0005](adr/0005-service-layer-emits-domain-events.md), [ADR 0007](adr/0007-assistant-acts-through-services-with-via-actor.md), [mutation core](../src/server/core/mutation.ts), [proposal service](../src/server/modules/proposals/service.ts).

## 5. How MCP works

### 5.1 What MCP is doing here

MCP is not a second agent and the in-app Assistant is not an MCP client.
MCP is an external adapter over the shared `ToolDef` registry.
This avoids sending internal app calls through HTTP and keeps one canonical implementation of each tool.

The endpoint is `/api/mcp` and uses Streamable HTTP through `mcp-handler`.
Both `GET` and `POST` are exported for the protocol handler.
The server identifies itself as `prismpm` version `1.0.0`.

Sources: [MCP route](../src/app/api/mcp/route.ts), [ADR 0007](adr/0007-assistant-acts-through-services-with-via-actor.md), [README MCP setup](../README.md#drive-it-from-an-mcp-client).

### 5.2 Authentication

The User creates a personal token in Settings.
Tokens start with `prismpm_`, and the raw token is shown only once.
Authentication rejects any token without that prefix before looking up the hash of the complete token.
Only a SHA-256 hash and a short identifying prefix are stored.
A revoked token is rejected, and successful resolution updates `lastUsedAt`.

The client sends the token as `Authorization: Bearer prismpm_...`.
The MCP auth wrapper resolves that token to a PrismPM User id and stores it in MCP auth metadata.
Each tool invocation then creates `{ db, userId, via: "assistant" }` and calls the same registry handler used by chat.

Sources: [API token service](../src/server/modules/api-tokens/service.ts), [API token schema](../src/server/modules/api-tokens/schema.ts), [MCP route](../src/app/api/mcp/route.ts), [README MCP setup](../README.md#drive-it-from-an-mcp-client).

### 5.3 Tool registration and results

At startup, the route loops over `MCP_TOOLS` and registers every definition's name, description, and Zod input schema.
Unlike Project chat, MCP does not have a page scope, so callers must supply `projectId` for Project-scoped tools.
The service layer still verifies that the token owner owns that Project.

Successful results are serialized as JSON inside an MCP text content block.
Expected `DomainError` failures become MCP error results with a safe message.
Unexpected errors are rethrown for server error handling.

Source: [MCP route](../src/app/api/mcp/route.ts).

### 5.4 Why MCP exposes fewer tools

`MCP_TOOLS` filters out every tool marked `requiresConfirmation`.
The current MCP endpoint therefore does not expose `delete_task`, `delete_milestone`, or `update_project` because this adapter has no PrismPM approval-card UI.
All other registry tools are exposed, including read and write tools.

MCP itself does not call the OpenAI model.
The external MCP host, such as Claude Desktop or Cursor, owns its own model loop and decides when to invoke PrismPM tools.
PrismPM authenticates, validates, performs the requested service operation, and returns JSON.

Sources: [tool registry](../src/server/modules/assistant/tools.ts), [MCP route](../src/app/api/mcp/route.ts), [README MCP setup](../README.md#drive-it-from-an-mcp-client).

### 5.5 Typical MCP call flow

```text
1. MCP client connects to https://host/api/mcp with a bearer token.
2. PrismPM hashes and resolves the token to a User id.
3. The client discovers tools and their Zod-derived input schemas.
4. The client calls list_projects.
5. The client selects an owned projectId.
6. The client calls a Project tool with that projectId.
7. The tool calls the normal service layer.
8. A write is recorded in Project History with via = assistant.
9. PrismPM returns the service result as JSON text.
```

Sources: [MCP route](../src/app/api/mcp/route.ts), [API token service](../src/server/modules/api-tokens/service.ts), [mutation core](../src/server/core/mutation.ts).

## 6. Proposal extraction

Proposal extraction looks for Decisions already recorded in Evidence or Comments.
It does not allow a model-generated candidate to enter the confirmed decision graph automatically.

### Triggering

Creating or updating Evidence and creating a Comment schedules a proposal pass with Next.js `after()`.
There is also a server action for explicitly running the pass.
The asynchronous pass logs failures instead of failing the User's original save.

Sources: [Evidence actions](../src/server/modules/evidence/actions.ts), [Comment actions](../src/server/modules/comments/actions.ts), [proposal actions](../src/server/modules/proposals/actions.ts), [proposal scheduler](../src/server/modules/proposals/schedule.ts).

### Choosing an extractor

The pass supports two extractors:

- `model`: an OpenAI structured-output call using `generateObject` and a Zod schema.
- `heuristic`: a deterministic sentence matcher that looks for decision verbs and cites the matching sentence.

If `PROPOSALS_EXTRACTOR=heuristic`, the heuristic is forced.
If a model is configured and no extractor is forced, the model extractor is used.
If no model is configured, the heuristic is the default fallback.
If `PROPOSALS_EXTRACTOR=model` is forced without a configured model, the pass is disabled.

Sources: [proposal extractor](../src/server/modules/proposals/extract.ts), [environment example](../.env.example).

### Inputs and idempotency

The pass reads Evidence and Comments whose current text hash has not already been processed.
Transcript Evidence is ordered first because it is more likely to contain stated reasoning.
Known People, Milestones, Tasks, and up to 12 recent Conversation Messages are supplied as context.
Conversation text is context only and cannot be cited as a Proposal source.

Processed-source hashes are stored in `proposal_pass_sources`.
Proposal fingerprints are derived from the primary source kind, source id, and normalized excerpt, which prevents the same cited passage from being proposed repeatedly.

Sources: [proposal service](../src/server/modules/proposals/service.ts), [proposal schema](../src/server/modules/proposals/schema.ts), [proposal trace logic](../src/server/modules/proposals/trace.ts).

### Verification after the model call

The model is not trusted merely because its output matches the schema.
Every candidate must have a non-empty title and chosen value.
Every cited source must exist among the sources given to the extractor.
Every excerpt must be a normalized verbatim substring of that source.
Invalid candidate Decisions are discarded entirely.
Invalid Assumptions are dropped individually if their named target cannot be resolved or their fields are invalid.

For transcript Evidence, a valid excerpt is attached to the matching Passage when possible.
This enables a citation to open at a more precise location.

Source: [proposal trace logic](../src/server/modules/proposals/trace.ts).

### Human confirmation

Surviving candidates are stored in `decision_proposals` with `pending` status.
They remain separate from confirmed `decisions`, so decision search and graph walks cannot accidentally treat them as facts.
The PM can accept, edit and accept, or reject a Proposal.
Acceptance calls `decisionsService.create` with `via: "assistant"`, creates the confirmed Decision and its sources, and marks the Proposal accepted in the normal transaction path.

Sources: [proposal schema](../src/server/modules/proposals/schema.ts), [proposal service](../src/server/modules/proposals/service.ts), [ADR 0008](adr/0008-decision-memory-graph.md).

### Task and Milestone Proposals

The same pass makes a second, separate extractor call that proposes Tasks and Milestones the team committed to (action items, assignments, dated checkpoints).
It has its own prompt, so the Decision prompt and its eval cases are unchanged, and it leaves the recent Conversation out.
Each extractor keeps its own rows in `proposal_pass_sources` (column `pass`), and each side of the pass catches its own failures, so one failing never blocks or re-runs the other.
The heuristic fallback reads `Action item:` / `TODO:` lines, `<known Person> will ... [by YYYY-MM-DD].` sentences and `Milestone: <name> on YYYY-MM-DD` lines.

Candidates pass the same verbatim-excerpt check as Decisions.
Names of People and Milestones are resolved to ids where they match, and kept as written where they do not.
A Milestone without an ISO date is discarded, and so is any item that duplicates an existing Task or Milestone or an item Proposal already raised.
Survivors are stored in `item_proposals` with `pending` status; nothing is written to `tasks` or `milestones` until the PM accepts .
The PM reviews them on the Project Overview beside Decision Proposals (#115): Accept creates the Task or Milestone through its service under `via: "assistant"` and links each cited Evidence in the same transaction; Edit and accept opens the Task or Milestone dialog prefilled; Reject keeps the row so the item is not raised again.

Sources: [item extractor](../src/server/modules/proposals/extract-items.ts), [proposal trace logic](../src/server/modules/proposals/trace.ts), [ADR 0015](adr/0015-item-proposals.md).

## 7. “Why did we?” answers

This feature combines deterministic retrieval with model-written presentation.
It is not vector search and does not use embeddings.

When the User asks why or how something was decided, the system prompt requires the Assistant to call `search_decisions` first.
The tool searches only confirmed Decisions.
Pending Proposals are stored separately and are never included.

Search terms are lowercased, de-punctuated, de-duplicated, and stripped of stop words.
Decision title matches receive weight 3, chosen-text matches weight 2, and context, alternatives, revisit conditions, and Assumptions weight 1.
Only positive-scoring Decisions are returned, with ties resolved by the newest `decidedOn` date.

The service returns server-generated links for the Decision and each cited Source.
The model is instructed to copy those citations verbatim and not invent or rewrite links.
If no Decision matches, the service performs a similar lexical Evidence search and the prompt requires the exact abstention: “There is no recorded decision about that.”

The dock renders only normalized internal `/projects/...` links as clickable citations.
Other Markdown-like links remain plain text, which limits model-generated navigation.

Sources: [prompt rules](../src/server/modules/assistant/prompt.ts), [decision search service](../src/server/modules/decisions/service.ts), [decision ranking and citations](../src/server/modules/decisions/answers.ts), [citation renderer](../src/widgets/assistant/linked-text.tsx).

## 8. Profile, Working Memory, and Reflection

### The two memory documents

The Profile is global to one User and stores slow-changing working preferences such as tone, cadence, and defaults.
Working Memory is scoped to one User and one Project and stores current priorities, recurring People, and recent Decisions.

Both are stored as append-only versions in PostgreSQL.
The newest row is the current document.
Versions record whether the author was the User or Reflection.
The User can edit these documents in Settings, and model-created versions keep a trace to the Conversation and last Message they read.

Sources: [domain vocabulary](../CONTEXT.md), [memory service](../src/server/modules/memory/service.ts), [memory schema](../src/server/modules/memory/schema.ts), [memory editor](../src/features/memory/memory-editor.tsx).

### When Reflection runs

Reflection is scheduled after a successful Assistant turn has been saved.
It runs only when both thresholds are satisfied:

- At least `REFLECTION_MIN_MINUTES` since the last Reflection for that Conversation, default 5 minutes.
- At least `REFLECTION_MIN_MESSAGES` fresh Messages, default 3.

It uses at most the latest 12 Messages to build its transcript.
Tool calls are represented by tool names rather than their full input and output payloads.

Sources: [chat route](../src/app/api/assistant/chat/route.ts), [Reflection service](../src/server/modules/reflection/service.ts), [environment example](../.env.example).

### The Reflection model call and safeguards

Reflection uses `generateObject` to request a complete rewritten Profile and Working Memory.
It tells the model to preserve every line from the latest User-authored version exactly.
The server independently checks that those lines still exist before saving the rewrite.
A rewrite that drops a User-written line is rejected.

Memory size is limited by `MEMORY_MAX_TOKENS`, estimated as four characters per token.
Unchanged output creates no new version.
Empty or oversized documents are rejected by the memory service.
Reflection failures and rejected output are logged and do not affect chat.

Sources: [Reflection service](../src/server/modules/reflection/service.ts), [memory service](../src/server/modules/memory/service.ts), [environment example](../.env.example).

## 9. Evidence and transcript context

Evidence ingestion supplies source material to the AI features, but ingestion itself is mostly deterministic.
PrismPM extracts text from supported uploaded files and stores it in `evidence.extractedText`, bounded by `EVIDENCE_EXTRACT_MAX_CHARS`.
It does not perform speech-to-text or audio diarization.

Evidence marked as a transcript is split into ordered Passages with optional speaker and timestamp information.
Proposal extraction prefers transcript Evidence and can attach a citation to the exact Passage containing the quoted excerpt.
If passages are later replaced or deleted, Decision citations can degrade to the containing Evidence item rather than becoming unusable.

The Assistant's `read_evidence` tool exposes at most 20,000 characters in one result and reports whether the text was truncated.
This is separate from the larger ingestion cap and limits how much untrusted source material enters one model tool result.

A Render description can be drafted from up to three pieces of Evidence (ADR 0016).
The User's own Assistant model reads each text (pruned, else extracted, else pasted, cut to 6,000 characters) fenced as data, and returns one visual description of at most 1,000 characters.
The PM edits it, and only that approved description reaches the image provider; the Render keeps a title snapshot of the Evidence as provenance.
The call is traced under the `render_draft` span and has no eval suite, because its output is subjective and always reviewed.

Sources: [Evidence extraction](../src/server/modules/evidence/extract.ts), [Evidence passages](../src/server/modules/evidence/passages.ts), [Evidence service](../src/server/modules/evidence/service.ts), [tool registry](../src/server/modules/assistant/tools.ts), [proposal service](../src/server/modules/proposals/service.ts), [Render drafter](../src/server/modules/renders/draft.ts).

## 10. Impact detection and the decision graph

Impact detection is part of the intelligence layer, but it is deliberately deterministic.
No OpenAI call occurs in this flow.

Every Project write through `mutate` stores Activity Events inside the transaction and publishes domain events after commit.
The impact subscriber listens for `task.updated`, `milestone.updated`, and `person.deleted`.

It checks holding Assumptions for three contradiction types:

- Date: a watched Task or Milestone date moves past the assumed date.
- Person: a watched Person is removed from the Project.
- Dependency: a watched Dependency becomes blocking because its predecessor is blocked or finishes too late.

When a contradiction is found, the subscriber calls `decisionsService.breakAssumption` using the Project owner's context with `via: "system"`.
That change is itself recorded through the normal mutation path.

The alert read model then walks from the broken Assumption to supported Decisions, through `leads_to` edges, and downstream through Task and Milestone Dependencies.
It combines the deterministic reason, triggering Activity Event, cited Decisions, and affected items for the attention UI.

The event bus is in-process and is not a durable queue.
The Project transaction has already committed before subscribers run, and subscriber failures are logged rather than rolling back that transaction.

Sources: [mutation core](../src/server/core/mutation.ts), [event bus](../src/server/events/bus.ts), [event subscribers](../src/server/events/subscribers.ts), [impact subscriber](../src/server/modules/impact/subscriber.ts), [contradiction rules](../src/server/modules/impact/detector.ts), [impact read model](../src/server/modules/impact/service.ts), [ADR 0008](adr/0008-decision-memory-graph.md).

## 11. Model and configuration

PrismPM currently supports only the OpenAI provider in `getModel()`.
The model defaults to `gpt-4o-mini` and can be changed through `AI_MODEL`.
If `AI_PROVIDER` is not `openai` or `OPENAI_API_KEY` is absent, `getModel()` returns `null`.
The application still boots, and the dock displays an “Assistant not configured” message.

| Variable                   | Default       | Effect                                                         |
| -------------------------- | ------------- | -------------------------------------------------------------- |
| `AI_PROVIDER`              | `openai`      | Only `openai` is currently accepted.                           |
| `AI_MODEL`                 | `gpt-4o-mini` | Model used by chat, model proposal extraction, and Reflection. |
| `OPENAI_API_KEY`           | none          | Enables model-backed features.                                 |
| `ASSISTANT_MAX_STEPS`      | `8`           | Maximum model/tool steps in one chat turn.                     |
| `ASSISTANT_DAILY_TURN_CAP` | `50`          | Maximum User chat Messages per UTC day.                        |
| `MEMORY_MAX_TOKENS`        | `2000`        | Approximate maximum size of each memory document.              |
| `REFLECTION_MIN_MINUTES`   | `5`           | Minimum time between Reflections for a Conversation.           |
| `REFLECTION_MIN_MESSAGES`  | `3`           | Minimum fresh Message count before Reflection.                 |
| `PROPOSALS_EXTRACTOR`      | automatic     | `model`, `heuristic`, or automatic selection.                  |

Sources: [model configuration](../src/server/modules/assistant/model.ts), [environment example](../.env.example), [Reflection service](../src/server/modules/reflection/service.ts), [proposal extractor](../src/server/modules/proposals/extract.ts).

## 12. Data stored by the AI layer

| Data                               | Storage                 | Activity Event? | Notes                                                        |
| ---------------------------------- | ----------------------- | --------------- | ------------------------------------------------------------ |
| Conversation                       | `conversations`         | No              | One per User and Project, plus one dashboard Conversation.   |
| Message                            | `messages`              | No              | Stores AI SDK `parts`, including tool states.                |
| Profile or Working Memory version  | `memory_versions`       | No              | Append-only, authored by User or Reflection.                 |
| Pending Decision Proposal          | `decision_proposals`    | No              | Isolated from confirmed Decisions until acceptance.          |
| Pending Task or Milestone Proposal | `item_proposals`        | No              | Nothing enters `tasks` or `milestones` until acceptance.     |
| Proposal source checkpoint         | `proposal_pass_sources` | No              | Records the hash each extractor last processed per source.   |
| MCP API token                      | `api_tokens`            | No              | Stores only token hash and identifying prefix.               |
| Assistant-created Project item     | Feature tables          | Yes             | Written through feature service and marked `via: assistant`. |
| System-broken Assumption           | `assumptions`           | Yes             | Written through decision service and marked `via: system`.   |

Sources: [Assistant schema](../src/server/modules/assistant/schema.ts), [memory schema](../src/server/modules/memory/schema.ts), [proposal schema](../src/server/modules/proposals/schema.ts), [API token schema](../src/server/modules/api-tokens/schema.ts), [mutation core](../src/server/core/mutation.ts).

## 13. Security and trust boundaries

The main boundaries are layered rather than delegated to the model:

- Authentication: Better Auth identifies the web User, while hashed personal tokens identify MCP callers.
- Authorization: Project services use `assertOwnsProject`; tool access alone is not authorization.
- Chat scope: Project ids are bound server-side for in-app Project tools.
- Input validation: Zod validates HTTP bodies, UI Messages, tool arguments, and structured model outputs.
- Write integrity: tools call services; services own validation, transactions, Activity Events, and domain events.
- Human control: destructive and Project-level chat tools pause for approval; those tools are absent from MCP.
- Prompt-injection resistance: prompts label Evidence, Project lists, and transcripts as untrusted data rather than instructions.
- Citation integrity: proposal excerpts are checked against source text, and decision-answer links are generated on the server.
- Navigation safety: the dock only turns internal Project routes into clickable citations.
- Cost bounds: daily User turns, per-turn steps, Evidence text size, Reflection thresholds, and memory size are bounded.

These controls reduce risk but do not prove model correctness.
The repository's security evidence document still contains several `TODO` entries for recording actual adversarial test results.

Sources: [security evidence](submission/m13-safety.md), [chat route](../src/app/api/assistant/chat/route.ts), [AI tool adapter](../src/server/modules/assistant/ai-tools.ts), [proposal trace logic](../src/server/modules/proposals/trace.ts), [citation renderer](../src/widgets/assistant/linked-text.tsx).

## 14. What is not implemented

The current code does not contain:

- A multi-agent coordinator or specialist-agent handoffs.
- A vector database, embeddings, or semantic retrieval.
- A general background job queue for Reflection or proposal extraction.
- An MCP client inside the PrismPM Assistant.
- Autonomous acceptance of Decision Proposals.
- A separate AI User account.
- Model-based impact detection.
- Support for AI providers other than OpenAI.

Human Room messaging is implemented separately from Assistant Conversations.
Chat Messages can publish `chat_message.created` signals for future subscribers, but there is currently no AI messaging subscriber or live AI response flow attached to Rooms.
The generic event bus and deterministic workspace read model are the intended seams for a future Health Briefing or broader intelligence layer, not proof that those features exist today.

The model bake-off and evaluation documents describe intended evaluation work, but their Results sections are still `TODO`.
The security evidence table also has `TODO` results.
Those documents should not be read as proof that the listed evaluations have already been completed.

Sources: [ADR 0007](adr/0007-assistant-acts-through-services-with-via-actor.md), [ADR 0010](adr/0010-chat-messages-publish-without-an-activity-event.md), [messaging service](../src/server/modules/messaging/service.ts), [workspace read model](../src/server/modules/workspace/queries.ts), [model bake-off](submission/m9-model-bakeoff.md), [evaluation evidence](submission/m11-evals.md), [security evidence](submission/m13-safety.md).

## 15. Where to change each behavior

| Goal                                            | Main file                                                                                                                               |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Add or change an Assistant or MCP tool          | [`src/server/modules/assistant/tools.ts`](../src/server/modules/assistant/tools.ts)                                                     |
| Change model provider, model, or turn limits    | [`src/server/modules/assistant/model.ts`](../src/server/modules/assistant/model.ts)                                                     |
| Change Project or workspace prompting           | [`src/server/modules/assistant/prompt.ts`](../src/server/modules/assistant/prompt.ts)                                                   |
| Change the chat request and streaming lifecycle | [`src/app/api/assistant/chat/route.ts`](../src/app/api/assistant/chat/route.ts)                                                         |
| Change tool adaptation or approval behavior     | [`src/server/modules/assistant/ai-tools.ts`](../src/server/modules/assistant/ai-tools.ts)                                               |
| Change the Assistant dock                       | [`src/widgets/assistant/assistant-dock.tsx`](../src/widgets/assistant/assistant-dock.tsx)                                               |
| Change MCP authentication or transport          | [`src/app/api/mcp/route.ts`](../src/app/api/mcp/route.ts)                                                                               |
| Change proposal prompts or extraction mode      | [`src/server/modules/proposals/extract.ts`](../src/server/modules/proposals/extract.ts)                                                 |
| Change proposal orchestration                   | [`src/server/modules/proposals/service.ts`](../src/server/modules/proposals/service.ts)                                                 |
| Change model-output traceability checks         | [`src/server/modules/proposals/trace.ts`](../src/server/modules/proposals/trace.ts)                                                     |
| Change “Why did we?” ranking or citations       | [`src/server/modules/decisions/answers.ts`](../src/server/modules/decisions/answers.ts)                                                 |
| Change Reflection                               | [`src/server/modules/reflection/service.ts`](../src/server/modules/reflection/service.ts)                                               |
| Change memory limits or version writes          | [`src/server/modules/memory/service.ts`](../src/server/modules/memory/service.ts)                                                       |
| Change deterministic impact rules               | [`src/server/modules/impact/detector.ts`](../src/server/modules/impact/detector.ts)                                                     |
| Add an event-driven intelligence subscriber     | [`src/server/events/subscribers.ts`](../src/server/events/subscribers.ts) and [`src/server/events/bus.ts`](../src/server/events/bus.ts) |

## 16. A useful mental model

Think of PrismPM as a trusted Project system with an AI operator sitting on top of it.
The operator can request actions, but application code defines its available controls, validates every input, checks ownership, records Project changes, and sometimes requires a human confirmation.
MCP makes those same controls available to an external AI host.
Proposal extraction and Reflection are specialized model passes with narrow schemas and post-processing checks.
Decision retrieval and impact detection keep critical truth-finding logic deterministic and traceable.
