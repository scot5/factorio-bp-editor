# Implementation plan: getting started

> **Continuing the work?** Start with [remaining-work.md](remaining-work.md), the handoff plan with the current state, lessons learned, and the remaining work split into PRs. This file keeps the history and per-task detail for Phase 0 to M3.

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

**Status: done.** [tests/corpus](../../tests/corpus/README.md) has 30 strings (27 described below, plus the game's 2.1 upgrade of the three 1.1 strings):

- 22 from 2.1.25: blueprints, books, deconstruction and upgrade planners (standalone and in books), an empty book, space platforms, a train with a schedule, quality and mirror.
- 3 from 1.1.
- 2 modded from 2.0.77.

Every root type is covered. The remaining gaps (Space Age planet buildings, power switch wiring) are listed in the corpus README.

### 1.2 Confirm format facts from the corpus

**Status: mostly done.** The results are recorded in [spec 02](../spec/02-blueprint-format.md):

- Wire connector ids 1–5 confirmed. The power switch ids are still open (no string uses them yet).
- `version` fits in a JS number (2.1.25.10 = 562954250027018 < 2^53). **No big-number JSON handling is needed**, which simplifies task 1.3.
- 2.x fields seen: `wires`, `parameters`, `rail_layer`, `snap-to-grid` / `absolute-snapping` / `position-relative-to-grid`, train stop fields, `override_stack_size`. Also seen in the second batch: `mirror`, entity `quality`, `recipe_quality`, insert-plan `items`, quality filters, platform `schedules`, and literal `null` values. Not seen yet: `stock_connections`.

### 1.3 Codec

**Status: done.** Implemented in `src/core/codec`, with no Node or DOM APIs: its own base64, fflate streaming inflate with a 64 MB cap checked every 16 KB of input. 177 unit tests pass. For every corpus string, `tests/unit/codec-corpus.test.ts` checks the result against Node zlib as an independent reference decoder, checks decode → encode → decode, and checks that the JSON is byte-identical apart from shortened floats. The in-game check passed with the re-encoded `train_with_schedule.txt`.

| Task | Done when |
| --- | --- |
| `decode(str)`: trim, check the version byte, base64, `fflate` inflate with a size cap, `JSON.parse`, then assert that `version` is a safe integer | Each `DecodeError.reason` has a test |
| Version helpers: pack and unpack `major.minor.patch.build` with multiplication, not bitwise operators | 562954250027018 ⇄ 2.1.25.10 |
| `encode(env)`: stringify, deflate (level 9), base64, prefix `0` | |
| Round-trip test over the whole corpus (`decode → encode → decode`, deep-equal) | Passes for every corpus file |
| Manual check: paste 3 re-encoded strings back into the game | Identical in game. Note the result in the PR. |

### 1.4 Model and schemas

**Status: done.**

- `src/core/model/schema.ts`: Zod 4 `looseObject` schemas for the envelope, books (recursive), blueprint, entity, tile, wire, icons, insert plans, stock connections and both planners. Types are inferred from the schemas. The schemas only **validate**. The decoded JSON is never replaced by Zod's output, which could reorder keys.
- `src/core/model/validate.ts`: `validateEnvelope` returns issues with JSON paths and never throws or blocks. Beyond the schema, it checks:
  - duplicate `entity_number` and duplicate slot index (errors);
  - slots holding no item or several;
  - references to missing entities from wires, `stock_connections` and schedules;
  - wires joining different colours (warning).

  All 27 corpus strings validate with no issues.
- `src/core/model/wires.ts`: connector ids → colour, adjacency graph, and red/green/copper networks (combinator input and output kept separate). The corpus test confirms that every 2.x wire joins matching colours.
- `src/core/model/book.ts`: paths are slot `index` values, so sparse books work. Provides `getNode`, `walk`, `findAll`, and `defaultPath` (follows `active_index`, else the first item).
- `src/core/geometry`:
  - 16-way directions: rotate, mirror, vectors, and conversion from 1.1 8-way directions and rolling-stock `orientation`;
  - position rotate and mirror, and boxes;
  - footprint, `snapCenter` and `isOnGrid` (checked against 400+ corpus entities).
- **Changed from the original plan:** no `scripts/gen-defines.ts`. `runtime-api.json` gives defines names and a display `order`, but not the numeric values used in blueprints (for wire connectors the order is even wrong). The few defines needed (direction, wire connector ids) are hand-written in `geometry/direction.ts` and `model/wires.ts` and tested against the corpus. Prototype types will still be generated from `prototype-api.json`, in M3.

### 1.5 1.1 migration

- `migrate1to2(env)`: directions ×2, per-entity `connections` → top-level `wires`, `items` map → insert plans, and the rename table.
- **Done when** each 1.1 corpus string migrates, re-encodes and imports into 2.1 without errors (checked by hand once, then by snapshot).

**Status: done.** `src/core/migrate`. The rename table is copied from the game's migration files. The game's own upgrade of the three legacy strings is in `tests/corpus/legacy-1.1/upgraded/`, and `tests/unit/migrate-oracle.test.ts` checks our migration against it. That confirmed:
- power switch connectors 5 / 6;
- legacy rail names;
- `use_filters`;
- module inventories for assemblers, chemical plants, rocket silos, labs and beacons, and locomotive fuel.

Spec 02 § Version handling lists the import behaviour of the game that we deliberately do not copy.

### 1.6 Follow-up: migrate 1.1 entity settings (not blocking M2)

Convert the 1.1 formats the game upgrades but we keep verbatim, using the oracle test to check each:
- decider and arithmetic combinator conditions;
- constant combinator filters → `sections`;
- requester and buffer chest `request_filters` → `sections`;
- `circuit_enabled` on inserters, pumps, lamps and train stops;
- the roboport and storage tank read modes.

Needed before circuit analysis (M4) works on 1.1 blueprints.

**M1 exit:** `src/core/codec` and `src/core/model` have high test coverage, CI is green, and spec 02 is updated with the confirmed facts.

## M2: Viewer ([spec 04](../spec/04-visualization.md))

Goal: paste a string and see it laid out as footprint boxes with names, inside a usable shell. No game assets yet.

**Status: done.** The size table (2.5) is generated from the Factorio 2.1.25 dump: 170 blueprintable entity types, with corpses, decoratives, enemies and other non-blueprintable types filtered out. `tests/unit/sizes-corpus.test.ts` checks that every vanilla corpus entity, including migrated 1.1 ones, is known, and that only modded names are unknown.
- **Renderer:** `src/renderer` (Zustand + Immer store, Radix dialogs, Tailwind 4) and a PixiJS 8 scene that renders on demand.
- **Core:** `src/core/richtext` (rich text parser), `src/core/geometry/spatial.ts` (uniform grid index), `src/core/model/layout.ts` (footprints), `src/core/prototypes` (size lookup and category colours).
- **Main:** IPC for the open and save dialogs and the clipboard.
- **E2E** (`tests/e2e/viewer.spec.ts`):
  - import via the dialog and via paste anywhere;
  - book navigation;
  - click selection and the hover tooltip;
  - error messages;
  - export of the whole envelope and of the selected item, checked by decoding;
  - a 16,937-entity blueprint at a median frame time of 16.7 ms.

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

**Status: steps 1–6 done** (branch `m3-game-assets`). Step 7, sprites, is next.
- **Detection and DB:** Steam library detection and write-data resolution from `config-path.cfg` and `config.ini`. The dump runner sets `SteamAppId` (see spec 03). The PrototypeDb contains entities with sizes and boxes, items, recipes, fluids, signals, qualities, tiles and icon lists. The cache is keyed by version, mods and format.
- **Protocol:** the `factorio-asset://` protocol has path-traversal and symlink tests.
- **UI:** a status bar control with Locate, "Load game data", progress and errors. Game icons appear in rich text, the book tree (blueprint icons), the inspector, the tooltip and on canvas footprints. Direction arrows moved to the footprint edge so they stay visible on top of icons.
- **Changed from the original plan:**
  - No separate icon atlas. Icons load lazily per URL, and each distinct icon becomes one texture. A typical blueprint has only a few dozen distinct icons, so batching is fine. Revisit if profiling says otherwise.
  - Types are not yet generated from `prototype-api.json`. The DB is hand-typed and small, so generation will come with the sprite definitions in step 7.
- **Tests:** unit tests for the parsers, the DB builder, URLs and path resolution, plus `tests/e2e/game-data.spec.ts`. That e2e test is opt-in (`FBE_E2E_GAME=1`), because it runs the real game.

## M4–M7: Outline

- **M4 Analysis** ([06](../spec/06-analysis.md)): set up the Web Worker. Build the reports in this order: inventory and bill of materials → power → production rates → validation → logistics → circuits → diff. Pick a few corpus blueprints with known ratios (for example a textbook green-circuit build) as golden tests.
- **M5 Editor** ([05](../spec/05-editing.md)): the command framework with patches and undo first, then select/move/rotate/delete, palette placement, the inspector forms, wires, copy/paste and renumber-on-export.
- **M6 Agent** ([07](../spec/07-agent-acp.md)): before starting, confirm the current Claude Code ACP adapter package and the ACP TypeScript SDK names and versions. Build the fake scripted ACP agent first, then the MCP tool server (read tools), the chat UI, the proposal flow and the permissions.
- **M7 Polish**: remaining sprite types, the planner editors, the diff view, packaging and auto-update.

## Risks and how to handle them

| Risk | Mitigation |
| --- | --- |
| `version` precision | Not a risk for now: confirmed below 2^53 (task 1.2). The codec asserts `Number.isSafeInteger`. |
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
