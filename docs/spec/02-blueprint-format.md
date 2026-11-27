# 02 — Blueprint string format

## Encoding

A blueprint string is:

```
<version-byte><base64( zlib_deflate( utf8( JSON ) ) )>
```

- `version-byte` is the character `0` for every format so far. Decoding MUST reject other version bytes with a clear error ("unsupported string version").
- The base64 is standard (`+` and `/`, with padding). Decoding SHOULD tolerate surrounding whitespace and line breaks (users paste from forums).
- The payload is a **zlib** stream (with header), not raw deflate or gzip.
- Encoding SHOULD use compression level 9, as the game does. Byte-identical output to the game is **not** required. Semantic round-trip is (see below).

```ts
// src/core/codec
decode(str: string): BlueprintEnvelope          // throws DecodeError with a specific reason
encode(env: BlueprintEnvelope, opts?: { level?: 0..9 }): string
```

## Top-level envelope

The JSON object has exactly one of these root keys:

| Key | Meaning |
| --- | --- |
| `blueprint` | A single blueprint |
| `blueprint_book` | A book with `blueprints: [{ index, blueprint \| blueprint_book \| deconstruction_planner \| upgrade_planner }]`, `active_index`, `label`, `icons`, `description` |
| `deconstruction_planner` | `settings` with entity/tile filters, filter modes, trees and rocks options |
| `upgrade_planner` | `settings.mappers: [{ index, from, to }]` |

Books nest without a depth limit. The book tree UI MUST handle sparse `index` values (empty slots).

## Blueprint object (2.x)

The key fields are listed below. The full schema lives in `src/core/model` as Zod schemas, generated where possible from `doc-html/prototype-api.json` and `runtime-api.json` in the game install, plus hand-written parts for the blueprint JSON (which those files do not fully describe).

```ts
interface Blueprint {
  item: 'blueprint';
  label?: string;
  label_color?: Color;
  description?: string;
  icons?: { index: number; signal: SignalID }[];
  entities?: BlueprintEntity[];
  tiles?: { name: string; position: { x: number; y: number } }[];
  wires?: [number, WireConnectorId, number, WireConnectorId][];  // 2.0+
  schedules?: Schedule[];
  stock_connections?: unknown[];
  parameters?: Parameter[];          // parametrised blueprints (2.0+)
  'snap-to-grid'?: Position;
  'absolute-snapping'?: boolean;
  'position-relative-to-grid'?: Position;
  version: number;
  [unknown: string]: unknown;        // preserved verbatim
}

interface BlueprintEntity {
  entity_number: number;             // 1-based, unique within the blueprint
  name: string;
  position: { x: number; y: number };  // entity centre, in tiles
  direction?: number;                // 2.0: 16-way, 0=N 4=E 8=S 12=W (1.1 used 8-way, 0/2/4/6)
  mirror?: boolean;
  quality?: string;                  // 'normal' when absent
  recipe?: string;
  recipe_quality?: string;
  items?: InsertPlan[];              // modules and fuel (2.0 format)
  control_behavior?: unknown;        // entity-type specific
  filters?: unknown[];
  [unknown: string]: unknown;
}
```

### Positions

- Positions are entity **centres**. An entity with an odd size (1×1, 3×3) sits on half-tile centres (`x.5`). An even size (2×2, 4×4) sits on whole numbers. Use the prototype's collision box to work out the footprint.
- Rails, elevated rails and some other entities have special grid rules (2×2 rail grid). These live in `core/geometry`.

### Direction handling

- 2.0+ uses `defines.direction` with **16 values**. Most entities use only the 4 cardinal values (0, 4, 8, 12). Rails use 8 or 16.
- `direction` absent means north (0).

### Wires (2.0+)

`wires` is a top-level list of `[entity_a, connector_a, entity_b, connector_b]`. The model MUST convert this into an adjacency structure for analysis and editing, and convert it back unchanged on export.

Connector ids, as **confirmed from the 2.1.25 corpus** (see `tests/corpus/README.md`):

| Id | Meaning | Seen on |
| --- | --- | --- |
| 1 | Circuit red. For combinators: **input** red | poles, chests, inserters, lamps, tanks, train stops, signals, combinators |
| 2 | Circuit green. For combinators: **input** green | same |
| 3 | Combinator **output** red | arithmetic and decider combinators |
| 4 | Combinator **output** green | arithmetic and decider combinators |
| 5 | Copper (pole) | electric poles, substations |
| ? | Power switch left and right copper | not yet in the corpus. Confirm before implementing power switch wiring. |

The names come from `defines.wire_connector_id` in `runtime-api.json`. That file's `order` field is display order, not the numeric value, so never derive the ids from it.

### Other confirmed 2.x shapes

Taken from the corpus:

```ts
// Insert plans (modules, fuel, ammo): entity.items
type InsertPlan = {
  id: { name: string; quality?: string }
  items: { in_inventory?: { inventory: number; stack: number; count?: number }[]; grid_count?: number }
}
// e.g. 4× quality-module-3 into the module inventory (4) of an assembler:
// [{ id: { name: 'quality-module-3' }, items: { in_inventory: [{ inventory: 4, stack: 0 }, …, { inventory: 4, stack: 3 }] } }]

// Quality filters (inserters, deconstruction planners)
type ItemFilter = { index: number; name?: string; quality?: string; comparator?: '=' | '!=' | '<' | '>' | '<=' | '>=' }
```

- A space platform's `schedules[].locomotives` holds the **hub's** `entity_number`.
- Rolling stock (locomotives, wagons) has a float **`orientation`** (0–1, where 0.25 is east) instead of `direction`, and off-grid positions (for example `x: 45.5625`). Couplings are in the top-level `stock_connections: [{ stock, front?, back? }]` (entity numbers). Train schedules can have `group` and `interrupts`.
- The game writes some floats as their **full exact decimal expansion** (colour `0.949999988079071044921875`, 1.1 speaker volume `0.460000000000000053290705182007513940334320068359375`). `JSON.stringify` writes the shortest equivalent (`0.949999988079071`). The **value** is identical, so the round-trip guarantee below (deep-equal on parsed values) holds, but the JSON is not byte-identical. 25 of the 27 corpus strings are byte-identical after `JSON.parse` → `JSON.stringify`. These two cases are the exceptions. **Confirmed in game (2.1.25):** `train_with_schedule.txt`, re-encoded with the shortened colour value, imports correctly (locomotive colour, fuel, wagons and schedule all intact). Plain `JSON.parse` / `JSON.stringify` is therefore enough. No custom number handling is needed.
- Mirrored entities have `mirror: true`, and often no `direction` (north).
- Literal JSON `null` values occur (for example `"result-inventory": null` on asteroid collectors). They MUST be preserved, not dropped or turned into `undefined`.
- The `in_inventory[].count` and `grid_count` fields above come from the API docs and are not in the corpus yet.

The 2.1 directions also appear as observed: 4-way entities use 0/4/8/12, ground rails and signals add the diagonals 2/6/10/14, and elevated and curved rails use all 16 values.

## Version handling

`version` is an integer packing `major.minor.patch.build`, 16 bits each:

```
version = major * 2^48 + minor * 2^32 + patch * 2^16 + build
```

Use multiplication or BigInt to unpack it, not JS bitwise operators (those truncate to 32 bits).

For 2.1.25.10 the value is `562954250027018`, which is **below** `Number.MAX_SAFE_INTEGER` (2^53 − 1). Any version with major < 32 fits exactly in a JS number, so plain `JSON.parse` / `JSON.stringify` round-trip it without loss. No special big-number parsing is needed. The codec MUST still check `Number.isSafeInteger(version)` and fail with a clear error if a future version breaks that assumption.

JSON parsing notes for round-trip:

- Floats in positions (`x.5`) and other numbers round-trip exactly through `JSON.parse` / `JSON.stringify`.
- JS objects put **integer-like keys first, in ascending order**, whatever their order in the source. 1.1 per-entity `connections` (`{"1": …, "2": …}`) uses such keys. The round-trip test (deep-equal) is unaffected. If byte-level key order ever matters, those objects need special handling.

**1.1 blueprints** (major < 2) MUST import through a migration step:

- 8-way `direction` → 16-way (×2).
- Per-entity `connections` / `neighbours` → top-level `wires`. 1.1 connection point `"1"` maps to connectors 1 (red) and 2 (green), and point `"2"` (combinator output) to 3 and 4. A missing `circuit_id` means 1. Copper `neighbours` map to 5. Each wire is listed on both of its entities in 1.1, so it is written once.
- `items` as `{ name: count }` → 2.0 insert plans.
- Prototype renames, taken from the game's own `data/base/migrations` files and applied in `migrations.txt` order. For example `filter-inserter` → `fast-inserter`, `stack-filter-inserter` → `bulk-inserter`, and 1.1's `stack-inserter` → `bulk-inserter` (the "1.2.0 stack inserter rename" swap). Former filter inserters get `use_filters: true`.
- Train schedules: the 1.1 list of records becomes `{ records: […] }`.

Implementation: `src/core/migrate` (`migrate1to2` returns the migrated copy, a list of renames and notes for the UI).

**Not verified yet:**
- inventory ids for converted `items` (modules, fuel, ammo);
- power switch copper connectors (`Cu0` / `Cu1` → 5 / 6);
- how 1.1 `straight-rail` / `curved-rail` map onto 2.0 rail pieces. They are kept as-is for now.

These are reported as migration notes. Verify them against the same strings imported into the game and re-exported. **Not migrated:** `control_behavior` and other settings whose format changed in 2.0 (for example combinator conditions). They are kept verbatim, so nothing is lost, but analysis may not understand them.

After migration, the blueprint is stamped with the current game version. The UI SHOULD show a "migrated from 1.1" notice.

## Round-trip guarantee

For any string `s` from the game:

```
deepEqual( parseJSON(decode(s)), parseJSON(decode(encode(decode(s)))) )
```

Rules:

- Fields the model does not know about MUST be preserved in place (on the entity, blueprint, book and envelope).
- Key order SHOULD be preserved (it keeps diffs readable).
- Numbers MUST round-trip exactly (`version`, floats in positions).
- An import followed by an export with no edits MUST give a string that the game imports with no visible changes.

`tests/corpus/` holds real strings across categories (small and huge, books, nested books, planners, Space Age platforms, parametrised blueprints, 1.1 legacy, modded). Every string has a round-trip test.

## Errors

`DecodeError.reason` is one of: `empty`, `bad-version-byte`, `bad-base64`, `bad-zlib`, `too-large`, `bad-json`, `unknown-root`, `unsafe-version` (`version` is not a safe JS integer). The UI shows a human message for each (`DecodeError.userMessage`). Implementation: `src/core/codec`.
