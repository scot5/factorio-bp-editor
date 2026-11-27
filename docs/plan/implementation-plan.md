# Implementation plan: getting started

This plan turns the [spec](../spec/README.md) into ordered, checkable work for the first milestones. It covers **Phase 0 (scaffold)**, **M1 (codec)** and **M2 (viewer)** in detail, and the later milestones in outline. Revise the later phases when M2 is done.

Each task lists what it produces and how to tell it is done. Tasks are sized to be one focused commit or PR each.

## Order at a glance

```
Phase 0  Scaffold ──► M1 Codec ──► M2 Viewer ──► M3 Assets ──► M4 Analysis ──► M5 Editor ──► M6 Agent ──► M7 Polish
                         │                          ▲
                         └── corpus + types ────────┘   (M3 dump work can start in parallel with M2 UI)
```

## Phase 0: Scaffold

Goal: an empty but correctly structured app that builds, lints, tests and opens a window.

**Status: done** (branch `phase-0-scaffold`). Typecheck, lint, unit and e2e tests pass locally. 0.6 is waiting for the first CI run on GitHub.

| # | Task | Done when |
| --- | --- | --- |
| 0.1 | Initialise with `electron-vite` (React + TS template) using **pnpm** (`pnpm create @quick-start/electron`). Node 24 and pnpm 12 are available locally. Pin pnpm with the `packageManager` field in `package.json`. pnpm blocks dependency install scripts by default. The Electron binary is fetched by the project's own `postinstall` (`install-electron`), so the only flagged package was `electron-winstaller` (Squirrel only), which is denied in `pnpm-workspace.yaml`. Add `.gitignore` (node_modules, out, dist, `*.log`, local test dumps). | `pnpm install` from a clean clone works without prompts, and `pnpm dev` opens a window showing "Hello" |
| 0.2 | Restructure into the layout from [01 § Source layout](../spec/01-architecture.md#source-layout): `src/core`, `src/main`, `src/preload`, `src/renderer`, `tests/`. Path aliases `@core/*`, `@renderer/*`. | Aliases resolve in all three build targets and in Vitest |
| 0.3 | TypeScript strict, ESLint (typescript-eslint, react-hooks), Prettier. Add an ESLint `no-restricted-imports` rule that blocks `electron`, `node:*` and Node built-ins in `src/core`. Block DOM and Node globals with a separate `tsconfig.core.json` (ES libs only, `types: []`). | `pnpm lint` passes. Importing `fs` in core fails lint. |
| 0.4 | Vitest set up for `src/**/*.test.ts`. Playwright with `_electron` and one smoke test that launches the app. | `pnpm test` and `pnpm test:e2e` pass |
| 0.5 | Security defaults: `contextIsolation`, `sandbox`, no `nodeIntegration`, CSP meta tag. Empty typed `BridgeApi` in preload with `src/core/ipc.ts` for the shared types. | Smoke test checks that `window.require` is undefined |
| 0.6 | CI (GitHub Actions, Windows plus Ubuntu) with `pnpm/action-setup` and the pnpm store cached: `pnpm install --frozen-lockfile`, typecheck, lint, unit tests. E2E on Windows only. | Green CI on a PR |
| 0.7 | Update the Commands section of [CLAUDE.md](../../CLAUDE.md) with the real scripts. | |

## M1: Codec ([spec 02](../spec/02-blueprint-format.md))

Goal: `decode` / `encode` in `src/core/codec` with lossless round-trip over a real corpus. No UI.

### 1.1 Corpus first

- Export strings from your own game into `tests/corpus/<category>/<name>.txt`: a single entity, belts and undergrounds, a smelting column, a combinator circuit (red and green wires, input and output), power poles with copper wires, a power switch, rails and signals, elevated rails, tiles only, a parametrised blueprint, a Space Age platform, quality items and modules, a nested book with empty slots, a deconstruction planner, an upgrade planner.
- Add 2–3 **1.1-era** strings (from your own old saves, or ones you have the right to share) for migration.
- Add a `tests/corpus/README.md` listing where each string came from. Commit only strings you made yourself or may share.
- **Done when** there are at least 20 strings covering every root type.

### 1.2 Confirm format facts from the corpus

Settle these from real strings before writing the schemas, and record the results in spec 02:

- **Numeric values of the wire connector ids.** `runtime-api.json` lists the names (`circuit_red`, `combinator_output_green`, `pole_copper`, `power_switch_left_copper`, …), but its `order` field is display order, not the value. Read the values from exported strings that use each kind of connection.
- Which 2.x fields actually appear (`mirror`, `quality`, `items` insert-plan shape, `wires`, `parameters`, `stock_connections`).
- How large the `version` integers are, and that they exceed 2^53.

### 1.3 Codec

| Task | Done when |
| --- | --- |
| `decode(str)`: trim, check the version byte, base64, `fflate` inflate with a size cap, then precision-safe JSON parse | Each `DecodeError.reason` has a test |
| Precision-safe JSON: a small parser or wrapper that keeps big integers as a `BigIntString` wrapper and keeps key order | `version` survives parse → stringify unchanged |
| `encode(env)`: stringify, deflate (level 9), base64, prefix `0` | |
| Round-trip test over the whole corpus (`decode → encode → decode`, deep-equal) | Passes for every corpus file |
| Manual check: paste 3 re-encoded strings back into the game | Identical in game. Note the result in the PR. |

### 1.4 Model and schemas

- Zod schemas for the envelope, book, blueprint, entity, tile, wire, icons, planners. Lenient with `.passthrough()`, so unknown keys are kept.
- A script, `scripts/gen-defines.ts`, that reads `doc-html/prototype-api.json` and `runtime-api.json` from the install path (`FACTORIO_PATH` env var) and generates `src/core/generated/defines.ts` (direction, wire connector names, and so on). Commit the generated file, not the source JSON.
- Helpers in `src/core/geometry`: direction enums, rotate and mirror a position, and centre ⇄ footprint given a size.
- Book helpers: walk the tree, get by path, handle sparse indexes.

### 1.5 1.1 migration

- `migrate1to2(env)`: directions ×2, per-entity `connections` → top-level `wires`, `items` map → insert plans, and the rename table.
- **Done when** each 1.1 corpus string migrates, re-encodes and imports into 2.1 without errors (checked by hand once, then by snapshot).

**M1 exit:** `src/core/codec` and `src/core/model` have high test coverage, CI is green, and spec 02 is updated with the confirmed facts.

## M2: Viewer ([spec 04](../spec/04-visualization.md))

Goal: paste a string and see it laid out as footprint boxes with names, inside a usable shell. No game assets yet.

| # | Task | Done when |
| --- | --- | --- |
| 2.1 | App shell layout: toolbar, left panel (book tree), canvas area, right panel (inspector), status bar. Radix + Tailwind, dark theme. | Layout matches the spec 04 sketch |
| 2.2 | Import: paste (Ctrl+V anywhere), an "Import" dialog with a textarea, drag-and-drop `.txt`, open file through the main process. Errors shown per `DecodeError.reason`. | Every corpus string imports through each route |
| 2.3 | Document store (Zustand + Immer): open documents as tabs, active book path. | |
| 2.4 | Book tree panel with nested books, empty slots and planner items | The nested-book corpus string shows correctly |
| 2.5 | Fallback size table: generated at build time from a local data dump by `scripts/gen-size-table.ts` (sizes only, no assets) | Covers every base, Space Age, Quality and Elevated Rails entity |
| 2.6 | PixiJS canvas: camera (pan, zoom to cursor, fit), grid with chunk lines, footprint boxes coloured by type, direction arrows, labels at high zoom. Spatial index for culling. | 20k-entity synthetic blueprint pans at ≥ 50 fps |
| 2.7 | Hover tooltip, click and box select, inspector showing read-only properties and raw JSON | |
| 2.8 | Export: whole envelope or active blueprint, copied to clipboard | Round-trips with no edits |
| 2.9 | Rich-text parser for labels and descriptions (text and colours. Icons arrive in M3) | No HTML injection possible (test) |
| 2.10 | E2E test: paste string → canvas shows N entities → export → same JSON | |

**M2 exit:** a useful read-only viewer with no Factorio install needed.

## M3: Assets, in outline ([spec 03](../spec/03-game-assets.md))

1. Install detection (settings → Steam `libraryfolders.vdf` → common paths → picker). Unit-test the parsing against your `D:\SteamLibrary` layout using fixtures, not hard-coded paths.
2. Find the write-data directory through `config-path.cfg`. On your machine that is `%APPDATA%\Factorio`, which holds `mods/mod-list.json`.
3. Dump runner: run `--dump-data` and `--dump-icon-sprites`, detect "game already running", show progress, store the cache under `<version>-<modsHash>`.
4. Build the PrototypeDb from `data-raw-dump.json`. Generate types from `prototype-api.json`.
5. `factorio-asset://` protocol with path-traversal tests.
6. Icon atlas, then icons on footprints (the "icon-on-footprint" fallback from M2 becomes real icons).
7. `SpriteResolver` for the P0 types, then P1. Belts and pipes need neighbour-aware sprites.

M3 steps 1–4 have no UI dependency and can start alongside M2.

## M4–M7: Outline

- **M4 Analysis** ([06](../spec/06-analysis.md)): set up the Web Worker. Build the reports in this order: inventory and bill of materials → power → production rates → validation → logistics → circuits → diff. Pick a few corpus blueprints with known ratios (for example a textbook green-circuit build) as golden tests.
- **M5 Editor** ([05](../spec/05-editing.md)): the command framework with patches and undo first, then select/move/rotate/delete, palette placement, the inspector forms, wires, copy/paste and renumber-on-export.
- **M6 Agent** ([07](../spec/07-agent-acp.md)): before starting, confirm the current Claude Code ACP adapter package and the ACP TypeScript SDK names and versions. Build the fake scripted ACP agent first, then the MCP tool server (read tools), the chat UI, the proposal flow and the permissions.
- **M7 Polish**: remaining sprite types, the planner editors, the diff view, packaging and auto-update.

## Risks and how to handle them

| Risk | Mitigation |
| --- | --- |
| 64-bit `version` precision lost by JSON parsing | Dedicated parser in task 1.3, with tests |
| Undocumented blueprint JSON details | The corpus is the source of truth. Confirm facts from it (task 1.2) and record them in spec 02. |
| Sprite rendering for every entity type takes long | The footprint-plus-icon fallback ships first. Add sprites type by type. |
| Data dump fails (game running, mods broken) | Clear error with retry, and the "vanilla + expansions" option. The app works without a dump. |
| ACP and adapter APIs change | Isolate them behind `AgentService`. Test against the fake agent. Pin versions. |
| Performance on huge blueprints | Spatial index and level-of-detail from the start (task 2.6). A 20k-entity benchmark in CI. |

## First week, concretely

1. Phase 0 tasks 0.1–0.5 (one PR).
2. Export 20+ corpus strings from the game (task 1.1).
3. Codec plus round-trip tests (task 1.3), then confirm the format facts (task 1.2) and update spec 02.
4. Start the schemas and the `gen-defines` script (task 1.4).
