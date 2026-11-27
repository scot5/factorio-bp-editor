# 01 — Architecture

## Process model

```
┌──────────────────────────── Electron main process (Node) ────────────────────────────┐
│                                                                                       │
│  AssetService ─── reads Factorio install, runs data dump, serves factorio-asset://    │
│  AgentService ─── spawns ACP agent (Claude Code ACP adapter) over stdio               │
│  BlueprintToolServer ─── MCP server exposing blueprint tools to the agent             │
│  SettingsStore / LibraryStore ─── JSON in app.getPath('userData')                     │
│                                                                                       │
└──────────────▲──────────────────────────────────────────────────────▲────────────────┘
               │ typed IPC (contextBridge, preload)                    │ stdio JSON-RPC
┌──────────────┴────────────── Renderer (React) ───────────┐   ┌──────┴──────────────┐
│  Document store (Zustand + Immer)                        │   │  ACP agent process  │
│  Canvas (PixiJS)  ·  Inspector  ·  Analysis  ·  Agent UI │   │  (Claude)           │
└──────────────────────────────────────────────────────────┘   └─────────────────────┘
```

- The **renderer** owns the open documents and the undo history. It is the source of truth for blueprint state.
- The **main process** owns everything that touches the file system, child processes or the network.
- The **agent** never touches renderer state directly. It calls tools on the `BlueprintToolServer`. The server forwards each call to the renderer over IPC and returns the result (see [07](07-agent-acp.md)).

## Source layout

```
src/
  core/          Pure TypeScript, no Electron/DOM imports. Shared by main and renderer.
    codec/       String ⇄ JSON (02)
    model/       Typed blueprint model, normalisation, unknown-field preservation
    geometry/    Positions, directions, bounding boxes, rotation/mirroring
    analysis/    Counts, rates, power, throughput, validation (06)
    edit/        Edit commands as pure functions over the model (05)
    prototypes/  Prototype database built from the data dump (03)
  main/          Electron main process: services, IPC handlers, MCP server, ACP client
  preload/       contextBridge API, typed
  renderer/      React app
    canvas/      PixiJS scene, layers, sprite resolution (04)
    panels/      Book tree, inspector, analysis, agent chat
    store/       Zustand stores
tests/
  corpus/        Real blueprint strings used for round-trip tests
  e2e/           Playwright Electron tests
```

`core` MUST stay free of Electron, Node-only and DOM APIs, so it can be unit tested quickly and reused (for example in a CLI later). For compression, use `pako` or `fflate` rather than Node's `zlib`.

## Tech choices

| Concern | Choice | Notes |
| --- | --- | --- |
| Build | `electron-vite` | One config for main, preload and renderer. HMR in the renderer. |
| UI | React 19 + TypeScript (strict) | |
| Components | Radix UI primitives + Tailwind CSS | Accessible, unstyled base. |
| Canvas | PixiJS v8 | WebGL batching handles thousands of sprites. `pixi-viewport` or a custom camera for pan/zoom. |
| State | Zustand + Immer | Immer patches drive undo/redo and tell the canvas what changed. |
| Validation | Zod | Runtime schema for imported JSON. Lenient: unknown keys pass through. |
| Compression | fflate | Fast, works in both renderer and Node. |
| ACP | `@agentclientprotocol/sdk` (TypeScript ACP library) | The client side of the protocol. Confirm the package name when implementation starts. |
| MCP | `@modelcontextprotocol/sdk` | Blueprint tool server. |
| Tests | Vitest, Playwright (`_electron`) | |
| Packaging | electron-builder | NSIS on Windows first. |

### Why React + Vite instead of Next.js

Next.js can run inside Electron only as a static export (`output: 'export'`), for example through Nextron. In that mode its main strengths (server rendering, server components, API routes, image optimisation) do nothing: there is no server, and the Electron main process already does the backend work. What remains is file-based routing, which a single-window editor barely needs, plus extra build complexity and slower dev reloads. React with Vite is the simpler, standard setup for Electron. Revisit only if the project later needs a web version that shares pages.

## IPC contract

All renderer ⇄ main calls go through one typed API exposed by the preload script:

```ts
interface BridgeApi {
  assets: {
    getStatus(): Promise<AssetStatus>;             // install found? dump fresh? versions
    setGamePath(path: string): Promise<AssetStatus>;
    rebuildPrototypes(): Promise<void>;            // re-run data dump
    getPrototypeDb(): Promise<PrototypeDbSnapshot>;
  };
  files: {
    openBlueprintFile(): Promise<string | null>;   // returns raw string
    saveBlueprintFile(contents: string): Promise<boolean>;
  };
  agent: {
    start(opts: AgentStartOptions): Promise<void>;
    prompt(text: string, context: AgentContext): Promise<void>;
    cancel(): Promise<void>;
    respondPermission(requestId: string, decision: PermissionDecision): Promise<void>;
    onEvent(cb: (e: AgentEvent) => void): Unsubscribe;
  };
  ui: {
    getSections(): Promise<SectionState>;         // collapsible panel sections (04 § Side panel)
    setSections(state: SectionState): Promise<void>;
  };
  toolBridge: {
    // main → renderer: the agent called a blueprint tool
    onToolCall(cb: (call: ToolCall) => Promise<ToolResult>): Unsubscribe;
  };
}
```

Channel names and payloads live in `src/core/ipc.ts` so both sides share the types.

## Security

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false` in every window.
- A strict Content Security Policy. No remote scripts.
- The custom protocol `factorio-asset://` serves files **only** from inside the configured Factorio `data/` folder and the app's dump cache. It MUST reject path traversal (`..`), absolute paths and symlinks that point outside the root.
- Imported strings are untrusted input. Enforce size limits on decode (for example, reject inflated JSON over 64 MB) to guard against zip bombs.
- Labels and descriptions in blueprints may contain Factorio rich text (`[item=iron-plate]`, `[color=red]…[/color]`). Render it with a dedicated parser, never as HTML.
- The agent subprocess runs with the user's permissions. Permission requests from the agent (file writes, terminal commands) go to the user (see [07](07-agent-acp.md#permissions)).

## Persistence

- `settings.json`: game path, mod-dump options, theme, agent settings, and the open/closed state of panel sections (`sections`: section id → open; main keeps only string ids up to 64 characters with boolean values, at most 200).
- `prototype-cache/<factorio-version>-<mods-hash>/`: the processed prototype DB and the extracted icon atlas.
- `library.json` (later): saved blueprints and history.
