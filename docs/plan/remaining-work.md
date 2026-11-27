# Remaining work: handoff plan

This document is for the next agent or developer. It has everything needed to continue: what exists, how to work here, what was learned the hard way, and the remaining work split into PR-sized steps with acceptance criteria.

Read in this order: [CLAUDE.md](../../CLAUDE.md) → this file → the [spec](../spec/README.md) section for your step → the [implementation plan](implementation-plan.md) for history and detail.

Snapshot date: 2026-11-27. `main` at `13fbfae` (PR #2 merged).

---

## 1. How to work in this repo

- **One PR per step.** Branch from `main`, finish the step, run every check, push, `gh pr create --base main`, watch CI, and report the link. Wait for the user to merge before starting the next step. The user reviews and merges every PR themselves. Never merge yourself.
- **Spec first.** Read the matching `docs/spec/0x-*.md`. If the code has to differ from the spec, update the spec in the same PR and say why. Record confirmed facts (formats, numbers, game behaviour) in the spec.
- **Checks before a PR:** `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm test:e2e` when main, preload or the renderer changed. CI runs typecheck, lint and unit tests on Windows and Ubuntu, plus e2e on Windows.
- **Look at the UI when you change it.** Tests don't catch visual regressions; they missed two in M3. Take screenshots with a temporary Playwright spec (pattern in §4) and read the PNGs before calling a UI step done.
- **Package manager:** pnpm only (pnpm 12, Node 24). See CLAUDE.md for the `allowBuilds` rule.
- **Commits** end with the `Co-Authored-By` line the harness gives you. PR bodies end with the Claude Code line.

## 2. Where things stand

| Milestone | State | PR |
| --- | --- | --- |
| Phase 0: scaffold | done | #1 |
| M1: codec, model, 1.1 migration | done, except task 1.6 (1.1 settings formats) | #1 |
| M2: read-only viewer | done | #1 |
| M3: game assets | steps 1–6 done. **Step 7 (sprites) is next** | #2 |
| M4: analysis | not started | |
| M5: editor | not started | |
| M6: agent (ACP) | not started | |
| M7: polish | not started | |

### Code map (what exists)

```
src/core/                       pure TS (no DOM/Node/Electron; tsconfig.core.json has lib ES2023 only)
  codec/        decode/encode, base64, version pack/unpack, DecodeError
  model/        Zod schemas (validate only), validateEnvelope, wires, book navigation, layoutBlueprint
  migrate/      1.1 → 2.x migration (renames copied from data/base/migrations)
  geometry/     16-way directions, rotate/mirror, footprints, SpatialIndex
  richtext/     rich text parser (never produces HTML)
  prototypes/   PrototypeDb builder (db.ts), size lookups, categories, blueprintable filter
  assets/       Steam VDF / config-path.cfg / config.ini parsers, factorio-asset:// URL build and parse
  generated/    entity-sizes.ts (from the dump; names/types/sizes only)
  ipc.ts        BridgeApi + channel names (the only renderer ⇄ main contract)
src/main/       Electron main: ipc.ts, settings.ts, security.ts, assets/{locate,factorio,service,protocol}.ts
src/preload/    contextBridge mapping of BridgeApi
src/renderer/   React 19 + Zustand/Immer + Tailwind 4 + Radix dialog + PixiJS 8
  canvas/       scene.ts (imperative Pixi), BlueprintCanvas.tsx (input), camera.ts, colors.ts
  panels/       BookTree, Inspector
  components/   Import/Export dialogs, RichText, Icon, KindBadge, GameDataStatus
  store/        documents.ts (open docs, selection), assets.ts (game data status, DB, icon lookup)
scripts/gen-entity-sizes.ts     Node 24 runs it directly (type stripping); imports core with a .ts extension
tests/corpus/                   30 blueprint strings + README (read it; it lists what each one covers)
tests/unit/                     corpus-wide tests (codec, model, migration oracle, size table)
tests/e2e/                      Playwright Electron; launch.ts gives each run an isolated FBE_USER_DATA
```

Tests: 542 unit tests, 8 e2e tests, and 1 opt-in e2e test (`FBE_E2E_GAME=1`, loads real game data).

### What the app does today

- Import by paste, the dialog, drag-and-drop or "Open file", including 1.1 strings (migrated on import). Book tree, footprint canvas with icons and direction arrows, inspector with raw JSON, and export of the whole book or the selected item, by copy or save.
- Game data: detects the install. On "Load game data" it runs the dumps and caches the PrototypeDb and icons per game version, mods and format. Status-bar actions handle no-install, not-loaded, loading, ready and error.
- **Read-only.** Nothing edits blueprints yet.

## 3. Environment facts (developer machine)

- **Factorio 2.1.25 (Steam)** at `D:\SteamLibrary\steamapps\common\Factorio`. Never hard-code this path in source; tests use fixtures. The user's enabled mods are `base`, `elevated-rails`, `quality`, `recycler` and `space-age`.
- **Write-data:** `%APPDATA%\Factorio` (`config-path.cfg` has `use-system-read-write-data-directories=true`). Dumps land in `%APPDATA%\Factorio\script-output\`: `data-raw-dump.json` (~30 MB) and the icon folders.
- **Running the game:** the user often has Factorio open. Before any dump, check with PowerShell `Get-Process factorio`. If it's running, ask the user to close it; `AskUserQuestion` worked well for this. Never kill their game.
- **Steam relaunch trap:** started directly, `--dump-icon-sprites` makes Steam relaunch the game as a *detached* copy about 30 s later, which then holds the lock. Always set `SteamAppId=427520` and `SteamGameId=427520` in the child environment; `runFactorio` in `src/main/assets/factorio.ts` does this. `--dump-data` doesn't need it but it does no harm.
- **Dump timings:** `--dump-data` ~9 s, `--dump-icon-sprites` ~15 s.
- **Electron 44 quirks:**
  - `clipboard.readText()` and `writeText()` return Promises.
  - `webContents.getLastWebPreferences()` no longer exists; security prefs are unit-tested via `src/main/security.ts`.
- **WebGL and custom protocols:** images from `factorio-asset://` must be loaded with `crossOrigin = 'anonymous'`, and the protocol must send `Access-Control-Allow-Origin` (it does). Otherwise `texImage2D` throws and the whole Pixi frame stops rendering. `Scene` now catches icon failures; do the same for sprites.
- **CSP** (`src/renderer/index.html`): `img-src 'self' data: factorio-asset:`. Pixi is imported with `pixi.js/unsafe-eval`, so no `unsafe-eval` is needed. `fetch()` to `factorio-asset:` is blocked by `connect-src`; load images with `Image` instead, or extend the CSP deliberately.
- **`src/core` typing:** only ES2023 lib. `URL`, `structuredClone`, `atob`, `Buffer` and `window` are not available; the type check fails if you use them. The import ESLint rule blocks Node, Electron and renderer imports.
- **Lint (React Hooks v7 / React Compiler rules):** no writing refs during render (use `useLayoutEffect`). Memoized callbacks that read store actions through `getState()` trigger "existing memoization could not be preserved". Files that export components must not export other values (react-refresh).
- **Prettier** skips `*.md`.
- **Shell pitfalls seen this session:**
  - Multi-line `sed` and heredoc JS replacements broke on escaping several times. Prefer the Edit tool for code edits.
  - Never write temp files to `/` or root paths. Use the session scratchpad (the harness gives its path).

## 4. Useful techniques

- **Screenshots of the real app:** write a throwaway `tests/e2e/_shot.spec.ts` that calls `launchApp(<scratchpad>/ud)`, imports a corpus string through the dialog, and calls `page.screenshot({ path: <scratchpad>/x.png })`. Run `pnpm exec electron-vite build` first, then `pnpm exec playwright test tests/e2e/_shot.spec.ts`, read the PNG, and **delete the spec** before committing. Reusing the same scratch user-data folder keeps loaded game data between runs, so you load once and screenshot many times.
- **Console errors from the renderer:** in the same kind of spec, use `page.on('pageerror')` and `page.on('console')`. This is how the CORS bug was found.
- **Game as an oracle:** for format questions, ask the user to import or export something in the game. `tests/corpus/legacy-1.1/upgraded/` holds the game's own upgrade of the 1.1 strings, and `tests/unit/migrate-oracle.test.ts` compares against it. Use the same approach for task 1.6.
- **Inspecting the dump:** `node -e "const d=require(process.argv[1]); …" "$APPDATA/Factorio/script-output/data-raw-dump.json"`, with types at `d[type][name]`.

## 5. Remaining work, PR by PR

Each step below is one PR unless noted. The order matters where marked.

### PR 3: M3 step 7a, sprite renderer for single-sprite entities

**Goal:** real game graphics instead of coloured boxes, for entities whose look depends only on their own direction, not their neighbours (spec 03 § Sprite definitions, spec 04 § Layer order).

1. **Sprite definitions in the DB.** Bump `DB_FORMAT_VERSION` to 2, so caches rebuild and the status bar offers "Load game data" again. Store a `graphics` object per entity: the raw graphics keys for the types in scope, such as `graphics_set`, `animation`, `picture`, `pictures`, `structure`, `platform_picture`, `hand_*_picture` and `sprites`. Keep the DB small by whitelisting keys per type.
   - Consider generating TypeScript types for these from `doc-html/prototype-api.json` (plan task 1.4 deferred this). A small hand-written union is acceptable if documented.
2. **Sprite shapes the dump uses**, all confirmed in the 2.1.25 dump:
   - `{ filename, width, height, x?, y?, shift?, scale (0.5 for HR), line_length?, frame_count?, repeat_count?, direction_count?, variation_count?, draw_as_shadow?, tint?, blend_mode? }`;
   - `{ layers: [...] }`;
   - `{ sheet: {...} }` (direction-indexed sheet, e.g. inserter `platform_picture`);
   - per-direction objects `{ north, east, south, west }` (e.g. splitter `structure`, mining drill `graphics_set.animation`);
   - `filenames: [...]` with `lines_per_file`, for big animations such as the foundry;
   - `stripes` (rare).
   - Paths look like `__base__/graphics/...`. Use `dataUrl()` from `@core/assets` to get `factorio-asset://data/base/...`. `__core__/graphics/empty.png` means nothing to draw.
3. **`SpriteResolver`** (pure, in `src/core/sprites/` or similar): `(entityProto, direction, frame=0) → SpriteLayer[]`, where each layer is `{ url, rect: {x,y,w,h} in the source image, offset (tiles), scale, tint?, isShadow }`. Frame and direction pick the sub-rect: `index = direction_index * frame_count + frame`, then `col = index % line_length`, `row = floor(index / line_length)`. Write unit tests with excerpts copied from the dump.
4. **Types in scope:** `assembling-machine` (including `furnace` and `rocket-silo` via `graphics_set.animation`), `container` and `logistic-container`, `inserter` (platform only; the hand can come later), `electric-pole` (`pictures`, `direction_count: 4` is variation, not facing), `lab`, `beacon`, `mining-drill`, `boiler`, `generator`, `solar-panel`, `accumulator`, `radar`, `roboport`, `lamp`, combinators, `storage-tank`, `pump`, `offshore-pump`, `turret`s and `wall` (wall has neighbour variants; a single variant is fine here).
5. **Renderer:**
   - load textures lazily with `crossOrigin = 'anonymous'`, plus an LRU with a memory budget;
   - sprite sub-textures via `new Texture({ source, frame })`;
   - shadows in a layer under the bodies;
   - bodies sorted by y within the layer;
   - keep the footprint and icon fallback for anything the resolver doesn't handle and for unknown (modded) entities;
   - level of detail: below about 16 px/tile, keep footprints and icons instead of sprites;
   - catch sprite failures so a frame never stops (see the CORS story in §3).
6. **Keep performance:** the 16,937-entity e2e test must stay at about 60 fps. Use a pool of sprites for visible entities only, like the icon pool in `scene.ts`.

**Done when:** the provider station, science platform, nuclear plant and mall render with real sprites; screenshots are checked; unit tests cover the resolver for each sprite shape above; e2e is green.

### PR 4: M3 step 7b, neighbour-aware belts, undergrounds, splitters, pipes and heat pipes

- **Belts:** `belt_animation_set.animation_set` is one sheet with `direction_count: 20`. Each index is a belt shape (straight, curve and end variants per direction), and the index order is defined by the game (see `TransportBeltAnimationSet` in `prototype-api.json`). Curves depend on which neighbouring belts feed this one: a belt curves when exactly one side belt feeds it and nothing feeds it from behind.
- **Undergrounds:** `structure.direction_in` / `direction_out` and the `belt_animation_set`; `type: "input" | "output"` is in the blueprint.
- **Splitters:** `structure` plus `structure_patch` per direction, drawn over two belt tiles.
- **Pipes:** `pictures` keys such as `straight_vertical`, `corner_up_right`, `t_down`, `cross` and `ending_*`. Pick them from the 4 neighbour connections. A full solution needs fluid box connection points from the prototypes (`fluid_boxes[].pipe_connections`); a first version can connect pipe to pipe plus anything with a fluid box on the touching side.
- **Heat pipes:** same idea, with `connection_sprites`.
- Add a neighbour query (spatial index by tile) to the resolver input.

### PR 5: M3 step 7c, rails, signals and rolling stock

- **2.x rail pieces:** `straight-rail`, `half-diagonal-rail`, `curved-rail-a/b`, plus elevated variants, `rail-ramp` and `rail-support`. Each uses `pictures.{direction}.{metals, backplates, ties, stone_path…}` with `variation_count`. All 16 directions appear in the corpus (`elevated_rail_intersection.txt`, `rail_single_ramp.txt`, `train_signals_1in_lt3out.txt`).
- **Legacy rails:** `legacy-straight-rail` and `legacy-curved-rail`, from migrated 1.1 strings.
- **Rail signals and chain signals:** placed beside the rail by direction. Train stops.
- **Rolling stock:** drawn by `orientation` (a float) from rotated sprite sheets with `direction_count` frames.
- **Footprint boxes:** curved rails currently use rough bounding boxes. Consider using `selection_box` for hit testing.

### PR 6: M3 step 7d, Space Age and remaining types, plus polish

- Foundry, electromagnetic plant, cryogenic plant, biochamber, agricultural tower, recycler, crusher, asteroid collector, thruster, cargo bay, space platform hub, fusion reactor and generator, lightning rods.
- `mirror: true` (horizontal flip of the sprite plus mirrored fluid boxes) appears in `mirrored_oil_refineries.txt`.
- An optional "animate" toggle (spec 04), and tile sprites (concrete, foundations) instead of flat colour.

### PR 7: M1 task 1.6, migrate 1.1 entity settings (independent; can go any time before M4's circuit work)

Convert what the game upgrades and we currently keep verbatim:
- decider and arithmetic conditions → `conditions` / `outputs` / `else_outputs`;
- constant combinator `filters` → `sections`;
- requester and buffer `request_filters` → `sections`;
- `circuit_enabled` on inserters, pumps, lamps, train stops and power switches;
- roboport `read_logistics` → `read_items_mode`;
- the storage tank `temperature_signal` default;
- signal `type: "item"` omitted;
- `quality` / `comparator` on filters.

Extend `tests/unit/migrate-oracle.test.ts` to compare `control_behavior` and `request_filters` with the game's upgrade, which is already in `tests/corpus/legacy-1.1/upgraded/`. The exact target shapes are visible there.

### M4: analysis (spec 06), one PR per bullet

The DB needs more fields first. Add them in the first M4 PR and bump `DB_FORMAT_VERSION`:
- crafting speed, module slots, allowed effects, `energy_usage` and `energy_source`;
- belt `speed`, inserter `rotation_speed` and `extension_speed`, and stack bonuses;
- electric pole `supply_area_distance` and `maximum_wire_distance` (the oracle test currently hard-codes pole reaches);
- mining speed and resource categories, beacon `distribution_effectivity` and supply area, and quality multipliers;
- locale display names from `data/<mod>/locale/en/*.cfg` (INI-like; `parseIni` in `src/core/assets` can be reused).

The PRs:
1. **Analysis Web Worker setup.** Inventory and bill of materials: placing item per entity via `items[*].placeResult`, plus modules and fuel from insert plans, plus tiles. Analysis panel UI with clickable rows that highlight entities.
2. **Power:** draw, drain, generation, pole coverage, unpowered entities.
3. **Production rates and ratios:** recipes × crafting speed × modules × beacons × quality, with net balance per time unit.
4. **Validation warnings** (spec 06 § 6), including `unknown-prototype`, which should name *removed* prototypes such as `rocket-control-unit` and 0.14 item names (see the corpus README), `wire-out-of-reach`, `overlap` and `invalid-recipe`.
5. **Logistics:** belt and inserter throughput, underground distance, splitters.
6. **Circuit networks:** readable conditions, using the existing `wireNetworks()`. Needs PR 7 for 1.1 blueprints.
7. **Diff between two blueprints,** plus a canvas overlay. The corpus pair `provider_station.txt` / `station_provider_with_quality.txt` is a ready-made test.

### M5: editor (spec 05), one PR per bullet

1. **Command framework:** Immer patches and an undo/redo stack per document. **Freeze strategy:** the store currently auto-freezes whole envelopes. Measure on the 16,937-entity book before building patches on it.
2. Select, move, rotate, mirror and delete, with the geometry helpers that already exist.
3. Palette placement, with a ghost preview and a searchable palette grouped like the game.
4. Inspector forms per type (recipe, quality, modules, filters, conditions, train stop, …).
5. Wires tool. Wire reach comes from the DB.
6. Copy, cut and paste; extract a selection to a new blueprint.
7. Export rules: dense renumbering of `entity_number` (remap `wires`, `schedules[].locomotives` and `stock_connections`), and stamping the version.
8. Book and planner editing: labels, icons, reordering slots, and the planner form editors.

### M6: agent integration (spec 07)

Before starting, **check the current package names and versions** of the ACP TypeScript SDK and the Claude Code ACP adapter on npm (spec 07 deliberately doesn't pin them). The adapter must ship as a dependency and run with Electron's Node (`ELECTRON_RUN_AS_NODE=1`). The user must not need npm or pnpm.

1. `AgentService` (ACP client over stdio) plus a **fake scripted ACP agent** for tests, written first.
2. MCP `BlueprintToolServer` with read tools (`get_document_info`, `query_entities`, `get_analysis`, `get_ascii_map`, …), forwarded to the renderer store.
3. Chat panel UI with streaming, tool-call cards and the permission prompt.
4. Proposals: `propose_edits` builds on M5 commands, with a diff overlay and Accept / Reject / Accept selected.
5. Settings: a toggle for sending screenshots to the agent, a privacy notice, and handling of authentication errors.

### M7: polish

- Planner editors, if M5 didn't finish them.
- Diff view UI, if M4 only built the engine.
- Assets from third-party **mod zips** (the protocol currently serves only built-in mods' folders).
- The **"vanilla + expansions only"** dump option (a temporary `--mod-directory` with a generated `mod-list.json`).
- A settings dialog (game path, theme, agent).
- A local blueprint library (spec 00 open question).
- Packaging: electron-builder NSIS on Windows first, then auto-update, then macOS and Linux. `electron-builder.yml` still has template defaults to review: no `publish` section, a Linux `maintainer`, and placeholder icons in `build/` and `resources/`.

## 6. Known gaps and tech debt

- **`src/core/generated/entity-sizes.ts`** was generated on the developer machine (Factorio 2.1.25 plus expansions). Regenerate it with `pnpm gen:sizes --dump` after a game update. It is only the fallback when no game data is loaded.
- **Icons** load one texture per distinct icon URL, with no atlas. This is fine so far; revisit if profiling says so.
- **The icon URL cache header is `immutable`.** If a user switches between game versions in one session, stale icons could show. Consider putting the cache key in the URL.
- **Export doesn't renumber** `entity_number` yet; that's M5 PR 7.
- **Migrated 1.1 blueprints:**
  - The inventory ids for mining drills, burner entities and turrets are unverified. They are reported as migration notes.
  - Fuel isn't split into stacks by stack size; the game does split it.
- **CI never runs the game-data e2e test,** and Ubuntu CI doesn't run any e2e.
- **`tests/unit/codec-corpus.test.ts` asserts 30 corpus strings.** Update the number when you add strings, and describe new strings in `tests/corpus/README.md`.
- **Hand-written defines:** the direction and wire connector ids are written by hand and tested against the corpus. `runtime-api.json`'s `order` field is *not* the numeric value.
- **Not yet in the corpus:** power switch wiring exported from 2.x (connectors 5 and 6 are confirmed only through the game's upgrade of 1.1 strings), Space Age planet buildings, and ammo insert plans.

## 7. Open questions for the user

- **Blueprint library:** should the app keep imported blueprints between sessions (spec 00)?
- **Agent authentication:** only the user's Claude Code login, or also an API-key field (spec 07)?
- **Mod-aware rendering:** use the user's active mods (today's behaviour) or offer vanilla-only (spec 00)?
- **Packaging targets and signing:** which platforms matter, and is there a code-signing certificate?
