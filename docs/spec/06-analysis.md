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
- **UI:** the right sidebar has Inspector and Analysis tabs. The Analysis tab shows the Inventory report (summary, bill of materials, entities and tiles), then Production and Power, with game icons and display names, in collapsible sections (04 § Side panel; Entities and Tiles start collapsed). Clicking a row selects its entities (04 § Interaction).

### 2. Production

- For each crafting machine: recipe, effective crafting speed (base × quality × modules × beacons), productivity, and cycles/sec.
- Totals: items and fluids **produced** and **consumed** per time unit, and the **net** balance. A negative net means the blueprint needs inputs. A positive net is the output.
- Mining drills: output rate from resource category and mining speed. Shows "depends on resource patch" when it cannot tell.
- Space Age specifics: recipes with surface conditions, spoilage (show a warning only), and the extra productivity of foundry, EM plant and biochamber.
- **Ratio check**: for each internal item flow, compare producers against consumers and flag machines that are over- or under-supplied.

This is steady-state rate math. It does **not** trace which belt carries what. Belt-level flow tracing is a stretch goal (overlay "belt flow" in [04](04-visualization.md)).

**Implemented in M4 plan step 3** (`src/core/analysis/production.ts`; fields in 03 § Production fields):

- **Needs game data.** Without a DB, `AnalysisResult.production` is `null` and the panel says "Requires game data". Rates are per second in the report; the panel shows them per second, minute (default) or hour (`AnalysisSettings.timeUnit`, a picker in the section).
- **Crafting machines** (assembling machines, furnaces, rocket silo): the recipe is the prototype's `fixed_recipe`, else the blueprint's `recipe`. Speed = `crafting_speed` × quality `crafting_machine_speed` × max(0.2, 1 + speed effect); crafts per second = speed / recipe `energy_required`. Productivity = the productivity effect clamped to 0 … `maximum_productivity`, and 0 when the recipe does not `allow_productivity` (this also drops the foundry's, EM plant's and biochamber's base +50 %). Effects come from `entityEffects` (modules, beacons, base effect; see § 4).
- **Products per craft:** `probability × (amount + extra + (max(0, amount − ignored_by_productivity) + extra) × productivity)`, extra = `extra_count_fraction`. Ingredients are used at their amount.
- **Furnaces** have no recipe in blueprints, and a **mining drill's** resource depends on the patch under it. They are listed under "No rate" until the user picks what to assume per entity name (`AnalysisSettings.assume`): a furnace offers the visible recipes of its categories (recyclers: only scrap recycling, since the other recycling recipes are hidden), a drill the finite resources of its categories that yield items. A drill whose only resources are fluids or infinite (pumpjack) shows "output depends on the patch". Assumed rows are marked "(assumed)" and shown dimmed. Assembling machines with no recipe, `parameter-N` placeholder recipes and recipes the DB does not know are listed there too, without a choice.
- **Drills:** speed = `mining_speed` × max(0.2, 1 + speed) (quality does not change it, see 03); cycles per second = speed / `mining_time`; products × (1 + productivity, not capped). A required fluid is used at `fluid_amount / 10` per cycle (uranium: 1 sulfuric acid per ore, as the wiki states; unverified in game).
- **Quality:** a machine's `recipe_quality` is the quality of its item ingredients and products (quality rolls from quality modules are not modelled). Flows are kept per item or fluid and quality; fluids have none.
- **Catalysts:** an item a machine both uses and makes counts by its net amount for that machine, as the game's statistics do with `ignored_by_stats`: a crusher only uses 0.7 chunks per craft, kovarex makes 1 U-235.
- **Flows** are shown as **Outputs** (net > 0), **Inputs** (net < 0) and **Balanced** (made and used at the same rate, within 10⁻⁶). Each row selects its producers (outputs, balanced) or consumers (inputs). Items that spoil are marked "(spoils)".
- **Ratio check:** for each flow both made and used inside the blueprint, supply = made / used. Below 99 % it is listed under **Under-supplied** (selects the consumers), above 101 % under **Surplus** (selects the producers).
- **Surface conditions:** recipes whose `surface_conditions` the surface fails are listed under "Surface conditions not met", with the surface's value. The surface is the one the Power section's picker sets (Auto: the Nauvis orbit for a detected space platform, else Nauvis); its properties are the `surface-property` defaults overlaid with the planet's or the platform's own.
- **Machine rows** are per machine name, quality, recipe (or resource) and recipe quality, with the summed crafts per second and the mean speed and productivity. A recipe run by more than one machine type names the machine in its label.
- **Measured:** the production report takes about 3 ms on the 16,937-entity Step 7 of the rocket book (furnace and drill options are computed once per entity name per run).
- **Not done:** labs and research, boilers, offshore pumps and other fluid producers outside recipes, agricultural towers, asteroid collectors, quality output distributions, research productivity bonuses, burner fuel consumption, and spoilage beyond the marker.

### 3. Logistics

- Belt throughput per belt tier, taking belt stacking into account (Space Age stack inserters, research `beltStackSize`).
- Inserter throughput estimates (by type, quality and stack bonus), compared against the machines they feed. Flags inserters that limit a machine.
- Undergrounds: max distance check. Splitters: priority and filter summary.
- Fluid: pipe segment lengths and pump counts. A simple flow-limit estimate per segment.

### 4. Power

- Total power draw (peak, plus drain) by entity type, using modules and quality.
- Generation inside the blueprint (solar, steam, nuclear, fusion), with average solar based on the planet.
- Pole coverage: entities outside any pole's supply area. Pole networks that are not connected to each other.

**Implemented in M4 plan step 2** (`src/core/analysis/power.ts`, `effects.ts`; fields in 03 § Power fields):

- **Needs game data.** Without a DB, `AnalysisResult.power` is `null` and the panel says "Requires game data".
- **Electric consumers** are entities with an `electric` energy source that do not produce or store power (solar panels, generators, accumulators, lightning attractors and energy interfaces are left out, poles too). Rows are per name and quality, sorted by peak draw. Peak = working power + drain:
  - **Drain:** the energy source's `drain`; crafting machines (assembling machines, furnaces, rocket silo) without one drain `energy_usage / 30`, so an assembling machine 3 peaks at 388 kW, as the game's tooltip shows.
  - **Default:** `energy_usage × max(0.2, 1 + consumption) × quality + activeEnergyUsage`. The quality factor is `crafting_machine_energy_usage` only for machines with `quality_affects_energy_usage`. The rocket silo's launch power and the agricultural tower's crane count in the peak.
  - **Inserters:** `(energy_per_movement × extension_speed + energy_per_rotation × rotation_speed) × 60 × inserter speed quality` (taken as energy per tile of extension and per turn; this gives 1.1's 13.2 kW for the 1.1 inserter speeds).
  - **Beacons:** `energy_usage × beacon_power_usage` quality multiplier (legendary 1/6).
  - **Roboports:** peak at the energy source's `input_flow_limit` (5 MW, recharging robots and the buffer). **Electric turrets:** only the drain; shots draw from the buffer and are not counted.
  - Lamps and combinators are counted as always on.
- **Module effects** (`effects.ts`, reused by Production): modules in the entity's module inventory (insert plan `in_inventory` id: crafting machines and the silo 4, labs 3 and beacons 1 from the corpus, mining drills 2 from `defines.inventory`). Quality scales only a module's beneficial effects (`module_<effect>` multipliers); penalties such as a speed module's consumption stay. A beacon affects receivers (crafting machines, drills, labs) whose box overlaps the beacon box grown by `supply_area_distance`. Its modules' effects are multiplied by `distribution_effectivity` + `distribution_effectivity_bonus_per_quality_level × level` and by `profile[n − 1]`, n = beacons with modules affecting the receiver (only same-named ones for `beacon_counter: same_type`). Effects are filtered by the receiver's and the beacon's `allowed_effects`. The receiver's `base_effect` is included.
- **Generation:** solar panels, generators, burner generators, fusion generators and energy interfaces, × the `default` quality multiplier (unverified in game). **Solar** peak = `production × solar-power %` of the surface; average = 70 % of that on a planet (day-night cycle), the same as peak in orbit (`solar_power_in_space`, no night). The surface is a setting: a planet, a planet's orbit, or **Auto**, which picks the orbit of Nauvis for a blueprint that looks like a space platform (platform foundation tiles, a hub, asteroid collectors or thrusters) and Nauvis otherwise.
- **Heat:** reactors output `consumption × (1 + neighbour_bonus × neighbours) × default quality`; neighbours are same-named reactors whose boxes share a whole edge (a 2 × 2 block gives 3× each). Reactors and other burner, heat or fluid powered entities are also listed as "Fuel, heat or fluid powered".
- **Accumulators:** count, storage `buffer_capacity × accumulator_capacity` quality (1 + level) and output flow limit.
- **Pole coverage:** a pole's supply area is its centre ± `supply_area_distance` (unlike beacons). An electric entity (consumers, generators and accumulators alike) is powered when its tile box overlaps a supply area by more than an edge. Unpowered entities are listed and selectable. Quality does not grow supply areas here (unverified). **Space platforms need no poles**, so the coverage check is skipped when the surface is an orbit.
- **Pole networks:** poles joined by copper wires (connector 5). A power switch's two sides (connectors 5 and 6) join their networks only when `switch_state` is true; switches controlled by a circuit condition are taken at their saved state. Each powered entity belongs to the network of the first pole that reaches it; networks show pole count, members, peak draw and generation. The list appears when there is more than one network.
- **Not done:** the power switch's circuit state, solar on other space locations, burner fuel consumption rates, lightning rods, heat pipe and heat exchanger capacity, and electric network priorities (accumulator charge and discharge).

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
