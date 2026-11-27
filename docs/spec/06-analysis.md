# 06 — Analysis

All analysis lives in `src/core/analysis` as pure functions of `(blueprint, PrototypeDb, AnalysisSettings) → result`. It runs in a Web Worker so the UI stays responsive, and recomputes after each edit (debounced, incremental where cheap).

```ts
interface AnalysisSettings {
  planet?: string;                 // affects surface conditions and some recipes
  researchBonuses?: { miningProductivity: number; beltStackSize: number; inserterCapacity: number; … };
  assumeFullBeacons?: boolean;
  timeUnit: 'second' | 'minute' | 'hour';
}
```

## Reports

### 1. Inventory

- Count entities by name and quality.
- Count tiles by name.
- **Bill of materials**: the items needed to build the blueprint (entity → placing item, plus modules and fuel from insert plans, plus tiles). Optionally expanded to raw resources through the recipe tree. Copyable as text and as a "request" blueprint for constant combinators.
- Footprint: bounding box size and the number of tiles occupied.

**Implemented in M4 PR 1** (`src/core/analysis/inventory.ts`):

- Entity rows are per name and quality (`normal` counts as no quality), with the entity indexes, so a row can select its entities.
- **Placing item:** the prototype's `placeable_by` (with its count), else an item whose `place_result` is the entity; when several items place one entity, the item with the same name wins, then the first by name. Entities the DB knows but no item places are listed separately ("No placing item"). An entity's quality carries over to its item.
- **Insert plans:** each plan adds `id.name` (with `id.quality`): the sum of its `in_inventory` slot counts (`count` defaults to 1) plus `grid_count`. 1.1 strings are migrated to insert plans on import, so the 1.1 item map is not read here.
- **Tiles** use `tileItems` (see 03 § Analysis fields and display names), so `hazard-concrete-left` and `-right` both count as `hazard-concrete`.
- **Without game data,** or for a prototype the DB does not know (mods), the entity or tile name stands in for its item. Those rows are marked `guessed` and shown dimmed with a note.
- **Footprint:** width and height of the bounds rounded out to whole tiles, and the number of distinct tiles covered by entity footprints or tiles.
- **Copy** writes `count × display name (quality)` lines. The constant combinator "request" blueprint and the raw-resource expansion are not built yet.
- **Worker:** `src/renderer/analysis/analysis.worker.ts` runs `analyse()`; the DB is sent once per change, then one message per analysis. `store/analysis.ts` keeps only the latest result and runs whenever the active blueprint or the game data changes. Without edits (before M5) there is no debounce. The slowest corpus blueprint takes about 12 ms.
- **UI:** the right sidebar has Inspector and Analysis tabs. The Analysis tab shows the summary, the bill of materials, entities and tiles, with game icons and display names. Clicking a row selects its entities (04 § Interaction).

### 2. Production

- For each crafting machine: recipe, effective crafting speed (base × quality × modules × beacons), productivity, and cycles/sec.
- Totals: items and fluids **produced** and **consumed** per time unit, and the **net** balance. A negative net means the blueprint needs inputs. A positive net is the output.
- Mining drills: output rate from resource category and mining speed. Shows "depends on resource patch" when it cannot tell.
- Space Age specifics: recipes with surface conditions, spoilage (show a warning only), and the extra productivity of foundry, EM plant and biochamber.
- **Ratio check**: for each internal item flow, compare producers against consumers and flag machines that are over- or under-supplied.

This is steady-state rate math. It does **not** trace which belt carries what. Belt-level flow tracing is a stretch goal (overlay "belt flow" in [04](04-visualization.md)).

### 3. Logistics

- Belt throughput per belt tier, taking belt stacking into account (Space Age stack inserters, research `beltStackSize`).
- Inserter throughput estimates (by type, quality and stack bonus), compared against the machines they feed. Flags inserters that limit a machine.
- Undergrounds: max distance check. Splitters: priority and filter summary.
- Fluid: pipe segment lengths and pump counts. A simple flow-limit estimate per segment.

### 4. Power

- Total power draw (peak, plus drain) by entity type, using modules and quality.
- Generation inside the blueprint (solar, steam, nuclear, fusion), with average solar based on the planet.
- Pole coverage: entities outside any pole's supply area. Pole networks that are not connected to each other.

### 5. Circuit networks

- Network graph: each connected red or green network as a list of members.
- For each combinator: its conditions in readable form ("if [iron-plate] > 1000 then output [signal-A] = 1").
- Lists of signals each network may carry (static analysis of constant combinators and readers).
- Shown as a list plus the canvas overlay. A full circuit simulator is a non-goal.

### 6. Validation (warnings)

| Code | Condition |
| --- | --- |
| `unknown-prototype` | Entity, tile, item or recipe not in the PrototypeDb (missing mod?) |
| `overlap` | Collision boxes overlap on the same layer |
| `invalid-recipe` | Recipe not allowed in this machine (category mismatch or surface conditions) |
| `invalid-module` | Module effect not allowed by the recipe or machine |
| `unpowered` | Entity needs electricity and no pole covers it |
| `wire-out-of-reach` | Wire longer than the pole's or entity's reach |
| `underground-unpaired` / `underground-too-far` | |
| `dangling-belt` | Belt ends pointing into nothing (info level) |
| `quality-unavailable` | Quality level not unlocked by the loaded mods |

Each warning has a severity (error, warning or info), the entity ids involved and a short fix hint. The warnings list is clickable and highlights the entities on the canvas.

### 7. Diff

Compare two blueprints (two documents, or the current state against the imported original):

- Entities added, removed and changed (matched by position, then by name).
- Production and power deltas.
- Visual diff overlay: green added, red removed, yellow changed.

The agent uses the diff to present proposed changes (see [07](07-agent-acp.md)).

## Data used

Everything comes from the PrototypeDb (03). If no DB is loaded, only Inventory and the structural checks (overlap via the built-in size table, unpaired undergrounds) run. Rate-based reports show "requires game data".
