# CLAUDE.md

Guidance for working in this repository. Read this first, then the spec section for the area you are touching.

## Project

An Electron + React (Vite) desktop app to analyse, visualise and edit Factorio blueprint strings, with an optional Claude agent connected over ACP. The spec in [docs/spec/](docs/spec/README.md) is the source of truth for behaviour and architecture.

Status: Phase 0, M1, M2, M3 steps 1–6 and steps 7a–7b are done (read-only viewer with game data, icons, and sprites for single-sprite entities, belts, pipes, heat pipes and walls). **Start with `docs/plan/remaining-work.md`** if it exists: a local handoff plan with the current state, environment facts, lessons learned, and the remaining work as PR-sized steps (history is in `docs/plan/implementation-plan.md`). Update both as work lands. **`docs/plan/` is local only and gitignored: never commit it.** Only specs (`docs/spec/`) are committed. Work **one PR per step**: push, open the PR, and wait for the user to merge before starting the next step.

## Read the spec before you change code

| Working on | Read |
| --- | --- |
| Anything structural, IPC, new modules, dependencies | [01-architecture.md](docs/spec/01-architecture.md) |
| Decoding, encoding, model types, migrations | [02-blueprint-format.md](docs/spec/02-blueprint-format.md) |
| Factorio install detection, data dump, sprites, icons | [03-game-assets.md](docs/spec/03-game-assets.md) |
| Canvas, rendering, overlays, UI layout | [04-visualization.md](docs/spec/04-visualization.md) |
| Edit commands, undo/redo, inspector, export | [05-editing.md](docs/spec/05-editing.md) |
| Rates, power, validation, diff | [06-analysis.md](docs/spec/06-analysis.md) |
| ACP client, MCP blueprint tools, agent UI | [07-agent-acp.md](docs/spec/07-agent-acp.md) |

**Keep the spec in sync.** If an implementation needs to differ from the spec, update the spec in the same change and say why in the commit message. Never leave code and spec disagreeing. If a spec point is ambiguous, ask instead of guessing. Record the answer in the spec.

## Commands

**Use pnpm, not npm or yarn.** Commit only `pnpm-lock.yaml`. Never commit `package-lock.json` or `yarn.lock`. Add dependencies with `pnpm add` (`-D` for dev), and run one-off tools with `pnpm dlx`, not `npx`. pnpm only runs dependency install scripts that are approved in `pnpm-workspace.yaml` (`allowBuilds`). When a new dependency is flagged, decide with `pnpm approve-builds <pkg>` or `'!<pkg>'`, and say why in the commit.

```sh
pnpm install            # also downloads the Electron binary (postinstall)
pnpm dev                # Electron with hot reload
pnpm test               # Vitest unit tests (src/**/*.test.ts)
pnpm test:e2e           # builds, then runs Playwright Electron tests (tests/e2e)
pnpm lint               # ESLint (includes the src/core import restrictions)
pnpm typecheck          # tsc for core (no DOM/Node types), node (main/preload/tests) and web (renderer)
pnpm format             # Prettier (Markdown is excluded)
pnpm build              # typecheck + electron-vite build
pnpm build:win          # + electron-builder NSIS installer
pnpm gen:sizes --dump   # regenerate src/core/generated/entity-sizes.ts (Factorio closed; set FACTORIO_PATH)
FBE_E2E_GAME=1 pnpm test:e2e   # also run the e2e test that loads real game data (Factorio installed and closed)
```

Before you call a task done, run `typecheck`, `lint` and `test`. Also run `test:e2e` when you touch main, preload or the renderer.

### Layout notes

- `src/core`: pure TS, imported through `@core/*`. `tsconfig.core.json` type-checks it with ES libs only.
- `src/main/security.ts`: the only place window `webPreferences` are built.
- `src/core/ipc.ts`: IPC channel names and the `BridgeApi` type. To add an IPC call, add it to `ipc.ts`, then a handler in `src/main`, then the preload mapping.
- `src/renderer`: React app (`@renderer/*`). Entry is `index.html` → `main.tsx`.
- `src/main/assets`: game install detection, the dump runner, the cache and the `factorio-asset://` protocol. Never start the game except from the user's "Load game data" action.
- E2E tests launch the app with `tests/e2e/launch.ts`, which uses a fresh `FBE_USER_DATA` folder, so tests never touch the real settings or cache.

## Architecture rules

These come from [01-architecture.md](docs/spec/01-architecture.md). Breaking them is a bug.

- **`src/core` is pure TypeScript.** No imports from `electron`, Node built-ins (`fs`, `zlib`, `path`, …) or DOM APIs. Use `fflate` for compression. Core must run in the renderer, the main process, a Web Worker and Vitest alike.
- **Edits go through commands only.** Every change to a document is a command in `src/core/edit`, run with Immer patches ([05](docs/spec/05-editing.md#principles)). UI handlers, shortcuts and agent tools never change state directly.
- **Renderer ⇄ main goes only through the typed preload bridge.** Channel names and payload types live in `src/core/ipc.ts`. No `nodeIntegration`, no `remote`, keep `contextIsolation` and `sandbox` on.
- **The renderer owns document state.** The main process and the agent reach it through IPC and tool calls.
- **Analysis runs in a Web Worker** and is a pure function of `(blueprint, PrototypeDb, settings)`.

## Blueprint data rules

From [02-blueprint-format.md](docs/spec/02-blueprint-format.md):

- **Lossless round-trip is required.** Keep unknown fields and key order. Never strip a field because the model does not know about it.
- `version` packs four 16-bit parts. It fits in a JS number (2.1.25.10 = 562954250027018 < 2^53), so plain JSON is fine. Unpack it with multiplication or BigInt, never bitwise operators.
- Wire connector ids are listed in [02 § Wires](docs/spec/02-blueprint-format.md#wires-20). Never derive them from `runtime-api.json`'s `order` field.
- Positions are entity **centres** in tiles. Directions are **16-way** (0/4/8/12 for N/E/S/W). Wires are the top-level 2.x `wires` array.
- Treat imported strings as untrusted. Enforce the inflate size limit, and render rich text with the parser, never as HTML.
- Add every new real-world string you test with to `tests/corpus/`, with a round-trip test. Never commit strings you do not have the right to share.

## Factorio assets

From [03-game-assets.md](docs/spec/03-game-assets.md):

- **Never commit or bundle Factorio files** (sprites, icons, `data-raw-dump.json`, locale files, the API JSON). They are read from the user's install at runtime and cached in `userData`.
- Dev reference install: `D:\SteamLibrary\steamapps\common\Factorio` (2.1.25, with Space Age, Quality and Elevated Rails). Never hard-code this path in source. Use it only for local testing and as a detection test case.
- Get prototype facts from the data dump (`--dump-data`). Never hard-code entity sizes, speeds or recipes, except in the generated fallback size table.
- Generate types from `doc-html/prototype-api.json` with a script. Do not hand-write them.
- Every feature must degrade gracefully when no install or dump is available.

## Agent integration

From [07-agent-acp.md](docs/spec/07-agent-acp.md):

- The agent is optional. Nothing in the app may depend on it.
- Agent write tools only **create proposals**. Only an explicit user Accept changes the document.
- Never send game assets to the agent. Snapshots of the user's blueprint are sent only when the user setting allows it.
- The app never reads, stores or logs Claude credentials.
- Use the fake scripted ACP agent in tests. Never call the real agent in CI.

## Code style

- TypeScript `strict`. No `any` in `src/core`. Use `unknown` plus Zod for external data.
- React: function components and hooks. Zustand for state. Keep heavy logic out of components and in `core` or the stores.
- PixiJS code stays in `src/renderer/canvas`. React components do not hold Pixi objects in state.
- Put unit tests next to the code (`*.test.ts`). Every `core` module needs tests, and the codec and edit commands need thorough ones.
- Prefer small, focused modules. Name things after Factorio terms (entity, prototype, recipe, insert plan, wire connector) as the game and API docs use them.

## Git

- Branch from `main`. Keep commits focused, and include spec updates in the same commit as the code they describe.
- Never commit `.env` files, Claude settings that hold secrets, or anything from the Factorio install.
