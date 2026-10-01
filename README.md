# PrismPM - CS3216 Assignment 3 (Group 5)

**PrismPM** is project management with a memory.
It keeps Tasks, Milestones, People, Risks and Dependencies together with the Evidence, Decisions and Assumptions behind them, so a team can always answer "why did we do this?".
An Assistant reads and updates that shared context, while consequential changes still need human approval.

**Live application:** https://jira-pro-max.vercel.app

## Group members

| Matriculation no. | Name          | Contributions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A0276109B         | Ang Qi Jun    | Lead developer. Built the base application (Projects, Tasks, Milestones, Dependencies, Risks, Evidence, per-Project Statuses, Comments and full change History), authentication including Google sign-in, the Assistant (tool registry, confirm cards, persisted Conversations, Profile and Working Memory, reflection), Decision Memory (Decisions, Assumptions, impact alerts, "Why did we..." answers with citations, graph view), transcripts and semantic Evidence search, Task and Milestone Proposals, concept renders, messaging Rooms for Participants, the MCP server, PostHog analytics, the landing page and onboarding tour, CI, the eval suite and most milestone write-ups. |
| AXXXXXXXX         | Sahej Agarwal | Assistant chat experience: Markdown rendering of conversations, multiple chats with chat history and deletion, the first tool calls with human-in-the-loop permission management, support for multiple LLM providers, early RAG work, and CI lint/format/typecheck fixes.                                                                                                                                                                                                                                                                                                                                                                                                                  |
| AXXXXXXXX         | Brandon Lim   | Conducted field surveys and interviews with over 40 users to validate the problem and shape the product. Set up and owns the repository. Measured the Evidence to Proposal to Decision funnel (event contract, attribution fixes and verification).                                                                                                                                                                                                                                                                                                                                                                                                                                        |

## Features at a glance

- Projects with Tasks, Milestones, Dependencies, Risks, People, Labels and per-Project Statuses, shown as lists, boards, a timeline and a calendar.
- Evidence (files, notes and meeting transcripts) with extracted text, semantic search and passage-level citations.
- Decisions and typed Assumptions, with an impact alert when an Assumption breaks.
- An Assistant that answers "Why did we..." with citations, proposes Decisions, Tasks and Milestones from Evidence for review, and asks for confirmation before destructive changes.
- Full per-item and per-Project History, including changes made by the Assistant.
- Messaging Rooms where invited Participants can chat with the PM.
- The Assistant's tools over MCP for Claude Desktop, Cursor and other clients.

See `CS3216 Assignment 3.pdf` for the product journeys, `docs/submission/` for the milestone write-ups, `CONTEXT.md` for the domain glossary, and `docs/adr/` for decisions.
The [architecture guide](docs/architecture.md) maps the UI, services, repositories, PostgreSQL, AI, authentication, storage, messaging, and analytics.
For the Assistant and MCP internals, see the [AI system guide](docs/ai-system-guide.md).

## Set-up for local testing

Prerequisites: Node.js 20+, npm and Docker.
The [developer onboarding guide](docs/developer-onboarding.md) has the full details.

```bash
cp .env.example .env          # then set BETTER_AUTH_SECRET to something random
npm install
npm run db:up                 # Postgres (dev on :5433, test on :5434) via Docker
npm run db:migrate
npm run db:seed               # demo@example.com / demo-password-123 with the PDF scenario
npm run dev                   # landing page on http://localhost:3000, workspace on /dashboard
```

The Assistant, Proposals and semantic search need a model key: set `OPENAI_API_KEY` in `.env` (the default model is `gpt-4o-mini`).
Everything else works without one.
You can also skip the `.env` key and add your own AI key once the app is running: sign in, open **Settings** in the sidebar, and choose a provider (OpenAI, Anthropic, Google Gemini or any OpenAI-compatible endpoint), model and key.
A personal key takes precedence over the `.env` default and is stored encrypted, so set `AI_CREDENTIALS_ENCRYPTION_KEY` in `.env` first (`openssl rand -base64 32`).
The same Settings page works on the live application.

### Verify

```bash
npm run typecheck && npm run lint
npm test                      # Vitest against the test database
npm run test:e2e              # Playwright smoke (uses the running dev server)
```

## Drive it from an MCP client

The Assistant's tools are also served over MCP at `/api/mcp` (Streamable HTTP), authenticated with a personal token.

1. Sign in, open **Settings** in the sidebar, and under **API tokens** generate one. Copy it; it is shown once.
2. Point your client at the endpoint with the token as a bearer header. Claude Desktop (`claude_desktop_config.json`) and Cursor accept:

   ```json
   {
     "mcpServers": {
       "prismpm": {
         "url": "https://jira-pro-max.vercel.app/api/mcp",
         "headers": { "Authorization": "Bearer prismpm_..." }
       }
     }
   }
   ```

   Clients that only speak stdio can use `npx -y mcp-remote https://jira-pro-max.vercel.app/api/mcp --header "Authorization: Bearer prismpm_..."`.

3. Call `list_projects` to discover ids, then any Project-scoped tool with its `projectId`. Every change lands in History via Assistant. Tools that need a confirm card (`delete_task`, `delete_milestone`, `update_project`) are not offered over MCP.
4. Revoke the token from the same page when you are done.

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind v4 · PostgreSQL + Drizzle · Better Auth · Vercel AI SDK · FAISS · PostHog · Vitest · Playwright.
Deployed on Vercel with Neon Postgres and Vercel Blob for Evidence files.
The reasoning behind each choice is in [M15](docs/submission/m15-stack.md).

## Resources used

- **Design reference:** [Linear](https://linear.app)'s visual language, analysed in `DESIGN.md` and implemented as the tokens in `src/app/globals.css`.
- **Frameworks and documentation:** [Next.js](https://nextjs.org/docs), [Drizzle ORM](https://orm.drizzle.team/docs/overview), [Better Auth](https://www.better-auth.com/docs), [Vercel AI SDK](https://ai-sdk.dev/docs), [Tailwind CSS](https://tailwindcss.com/docs), [Model Context Protocol](https://modelcontextprotocol.io) and [mcp-handler](https://github.com/vercel/mcp-handler).
- **UI libraries:** [cmdk](https://cmdk.paco.me) (command palette), [Lucide](https://lucide.dev) (icons), [Motion](https://motion.dev) and [anime.js](https://animejs.com) (landing animations), [react-markdown](https://github.com/remarkjs/react-markdown).
- **AI and retrieval:** OpenAI models through the OpenAI API and [OpenRouter](https://openrouter.ai), [faiss-node](https://github.com/ewfian/faiss-node) for per-Project vector search, [Microsoft MarkItDown](https://github.com/microsoft/markitdown), [unpdf](https://github.com/unjs/unpdf), [mammoth](https://github.com/mwilliamson/mammoth.js) and [read-excel-file](https://gitlab.com/catamphetamine/read-excel-file) for Evidence text, and [Pollinations](https://pollinations.ai) for concept renders.
- **Analytics:** [PostHog](https://posthog.com/docs) product and LLM analytics.
- **AI coding assistants:** Claude Code, GitHub Copilot and Devin were used during development, with agent skills from [mattpocock/skills](https://github.com/mattpocock/skills) (listed in `skills-lock.json`).

## Brand and compatibility

The product name is **PrismPM**; package names, MCP server identity, and other technical identifiers use `prismpm`.
The repository remains `BrandonLYS/CS3216-Assignment-3`, so existing clone URLs and checkout paths still apply.

Personal API tokens start with `prismpm_`.
The Assistant dock migrates `vantage.assistant-open` to `prismpm.assistant-open` on first use, preserving an existing new-key preference and removing the legacy key after a successful migration.
The Participant session cookie retains its legacy `vantage_participant` name to preserve signed-in sessions.

The prism logo uses the existing design tokens; regenerate its browser icon with `npm run brand:icons` after changing the shared logo or palette.
This command requires Playwright Chromium (`npx playwright install chromium`).
Archived screenshots and historical command output retain the branding and paths from when they were captured.
