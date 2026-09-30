# Milestone 23 (optional) - MCP

PrismPM is an **MCP server**.
Its Assistant tools are served at `/api/mcp` over Streamable HTTP, so Claude Desktop, Cursor or any MCP client can read and change a User's Projects.

## Why MCP is worth having here

The strongest reason is where our users already are.
A developer on a project team spends the day in Cursor or Claude, not in a PM tool; asking "what did we decide about the payment provider?" or "log a Risk that the vendor sandbox is down" from there, without switching tabs, is the difference between the Decision Memory being used and being forgotten.
It also strengthens the moat (M3): PrismPM becomes the system of record that other AI clients read from, rather than one more chat window competing with them.

We did not add MCP as a client, because no external MCP service would improve the core loop yet; importers (M5) would use it later.

## Architecture

```text
Claude Desktop / Cursor
        | Streamable HTTP, Authorization: Bearer prismpm_...
        v
/api/mcp  (mcp-handler, withMcpAuth required)
        | token -> sha256 -> api_tokens -> userId
        v
MCP_TOOLS = ASSISTANT_TOOLS minus requiresConfirmation   (27 tools)
        | same handler, Ctx { userId, via: "assistant" }
        v
<feature>/service.ts -> assertOwnsProject -> mutate() -> Activity Event + domain event
```

- **One registry, no second implementation.** The route loops over `MCP_TOOLS` and registers each with its name, description and Zod input. Adding a tool to the Assistant adds it to MCP with no code in the route.
- **Same rules as the UI.** Each call runs under the token's User with `via: "assistant"`, so it goes through the same ownership check, validation, transaction and History as a click, and shows in Recent changes as "via Assistant".
- **Authentication.** Personal API tokens are generated in Settings, shown once, stored only as a SHA-256 hash, and revocable. An unauthenticated request gets HTTP 401 (checked against the live deployment).
- **What is excluded, and why.** `delete_task`, `delete_milestone` and `update_project` need a confirmation card that names the target (M13). The MCP adapter has no way to show our card, so those three are not exposed. Ordinary writes rely on the client's own tool-approval prompt, which Claude Desktop and Cursor show by default.

## Setup

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

## Value added

| Without MCP                                                      | With MCP                                                                      |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Decisions are only reachable inside PrismPM                      | "Why did we..." works from the editor, with the same cited `search_decisions` |
| A second integration per AI client                               | One endpoint for every MCP client                                             |
| Risk of an external agent bypassing rules through a separate API | External agents are one more caller of the same services                      |
