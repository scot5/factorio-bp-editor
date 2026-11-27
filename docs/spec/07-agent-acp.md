# 07 — Agent integration (ACP)

The agent is **optional**. The app is fully usable without it, and no agent process starts until the user opens the agent panel.

## Protocol overview

The [Agent Client Protocol](https://agentclientprotocol.com) (ACP) is JSON-RPC 2.0 over stdio between a **client** (an editor, here our app) and an **agent** (here Claude). The app is the ACP client:

```
Renderer (chat UI) ⇄ IPC ⇄ Main: AgentService (ACP client) ⇄ stdio ⇄ Claude Code ACP adapter ⇄ Claude
                                     │
                                     └── also starts BlueprintToolServer (MCP) and passes it to the agent in session/new
```

- The agent is the **Claude Code ACP adapter** (published by Zed / the ACP project as an npm package; confirm the current name and version when implementation starts). It is added as a regular dependency (`pnpm add`), shipped with the app, and run as a child process using Electron's bundled Node (`ELECTRON_RUN_AS_NODE=1`). End users do not need Node or a package manager installed.
- The agent path and arguments can be set in settings, so any ACP-compatible agent can be used. Claude is the default and the one that is tested.

### Lifecycle

1. `initialize`: the client advertises its capabilities. **fs**: read and write text files limited to a per-session scratch dir only (see Permissions). **terminal**: not advertised.
2. `session/new` with `cwd` = a per-session scratch directory and `mcpServers` = `[BlueprintToolServer]`.
3. `session/prompt` with the user message plus a **context block** (see below).
4. Stream `session/update` notifications into the chat UI: agent message chunks, thoughts (collapsible), tool calls with their status, and plans.
5. `session/request_permission` → a modal or inline prompt in the chat → the user's answer goes back.
6. `session/cancel` when the user presses Stop.

Sessions are per document. Switching document tabs switches the active session. Sessions do not persist across restarts in v1.

## Authentication

The Claude Code ACP adapter uses the user's existing Claude Code login (subscription or API key in its own config). The app does **not** handle or store Claude credentials. If the adapter reports that it is not logged in, the panel shows instructions and a "Retry" button. (Open question: also offer an API-key field that is passed to the adapter through an environment variable.)

## Blueprint tools (MCP)

The agent works on blueprints **only through tools**. It never receives the raw string unless it asks for it. The `BlueprintToolServer` is an MCP server run by the main process (stdio sub-server or local streamable HTTP on `127.0.0.1` with a random token). Each call is forwarded to the renderer, which runs it against the live document store.

### Read tools (no approval needed)

| Tool | Returns |
| --- | --- |
| `get_document_info` | Kind (blueprint/book/planner), label, description, book tree, active path, game version, mods |
| `get_blueprint_summary(path?)` | Bounding box, entity counts, tiles, wire counts, warnings count |
| `query_entities(filter)` | Entities matching name, type, area, recipe or has-warning. Paged. Compact JSON. |
| `get_entity(entity_number)` | Full entity JSON plus resolved prototype facts (size, speed, …) |
| `get_analysis(report)` | Any report from [06](06-analysis.md): `inventory`, `production`, `logistics`, `power`, `circuits`, `validation` |
| `get_ascii_map(area?, legend?)` | A text grid of the area (one char per tile, with legend), so the model can reason about layout cheaply |
| `lookup_prototype(name)` | Prototype facts from the PrototypeDb (recipes, speeds, sizes) |
| `get_selection` | Entity numbers the user has selected right now |
| `render_snapshot(area?)` | PNG of the canvas. **Only if the user enabled "Allow screenshots to the agent".** |
| `export_string` | The encoded string of the current document |

### Write tools (create proposals)

Write tools **never change the document directly**. They append to a **proposal**, a list of edit commands from [05](05-editing.md) applied to a draft copy:

| Tool | Effect |
| --- | --- |
| `propose_edits(commands[], summary)` | Validate and apply the commands to the draft. Returns the resulting diff summary and any new warnings. |
| `propose_import(string, summary)` | Replace the draft with a new blueprint string (for whole redesigns) |
| `discard_proposal` | |

The command schema is the same JSON used internally (`{ op: 'place', name, position, direction, … }`), described in the tool's input schema so the model can produce it directly.

### Proposal review

When a proposal exists, the UI shows:

- A diff overlay on the canvas (added, removed, changed) and a diff list, with production and power deltas from [06](06-analysis.md#7-diff).
- The agent's summary.
- **Accept** (applies all commands as one undoable step), **Reject**, or **Accept selected** (pick individual commands).

The agent learns the outcome from the next tool result or prompt context ("user accepted 5/7 edits").

## Context sent with each prompt

A small, automatically built block placed before the user's text:

```
Document: "Green circuits 1.2/s" (blueprint, 342 entities, game 2.1.25, mods: space-age, quality, elevated-rails)
Selection: 12 entities (assembling-machine-2 ×12)
Warnings: 3 (2 unpowered, 1 invalid-module)
Use the factorio-blueprint tools to inspect and edit. Do not guess entity data.
```

A short system-style instruction (sent through the first prompt) describes Factorio basics that matter for tool use: tile coordinates, entity centres, 16-way directions, and that edits are proposals.

## Permissions

- MCP read tools: allowed automatically.
- MCP write tools: allowed automatically. They only create proposals, and applying a proposal always needs the user.
- ACP `fs/read_text_file` and `fs/write_text_file`: allowed only inside the session scratch directory. Anything else is denied without prompting.
- Any other agent tool that the adapter routes through `session/request_permission` (for example web fetch or shell): shown to the user with **Allow once / Always for this session / Deny**. Defaults to deny when the panel is closed.
- Global setting "Agent may use web search" (off by default).

## Privacy

- Data sent to Claude: the context block, tool results (names, numbers, small JSON), and the user's messages. No game assets, except optional snapshots of the user's own blueprint when enabled (see [03](03-game-assets.md#licensing-note)).
- The panel shows a one-time notice explaining this before the first session starts.

## UI

- Chat transcript with streamed markdown, collapsible tool-call cards (name, args, result preview) and a thinking indicator.
- Input box with quick actions: "Explain this blueprint", "Find bottlenecks", "Suggest improvements", "Explain selection".
- Status line: agent connected / starting / error, model name if reported, and Stop button.

## Failure handling

- The agent process exits → the panel shows the error and stderr tail, and a "Restart agent" button. The document is unaffected.
- A tool call refers to a stale `entity_number` (the user edited the document meanwhile) → the tool returns a structured error and the agent re-queries.
- Timeouts: 30 s per tool call. Analysis tools on huge blueprints return partial results with a `truncated` flag.

## Testing

- A fake ACP agent (scripted JSON-RPC over stdio) for deterministic end-to-end tests of the chat, permission and proposal flows.
- Contract tests for every MCP tool's input and output schema.
