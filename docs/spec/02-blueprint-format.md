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

`wires` is a top-level list of `[entity_a, connector_a, entity_b, connector_b]`. The connector ids follow `defines.wire_connector_id`: circuit red/green inputs and outputs for combinators, copper wire connectors for poles and power switches. The model MUST convert this into an adjacency structure for analysis and editing, and convert it back unchanged on export.

## Version handling

`version` is a 64-bit integer packing `major.minor.patch.build`, 16 bits each:

```
version = (major << 48) | (minor << 32) | (patch << 16) | build
```

It exceeds `Number.MAX_SAFE_INTEGER`. JSON parsing MUST keep it exact: either a custom parse step that captures the raw number text, or `BigInt` conversion before `JSON.parse` loses precision. Export MUST write it back with the same digits.

**1.1 blueprints** (major < 2) MUST import through a migration step:

- 8-way `direction` → 16-way (×2).
- Per-entity `connections` / `neighbours` → top-level `wires`.
- `items` as `{ name: count }` → 2.0 insert plans.
- Entities and items renamed in 2.0 (for example `filter-inserter` → `fast-inserter` with filters, `stack-filter-inserter` → `bulk-inserter`) through a rename table.

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

`DecodeError.reason` is one of: `empty`, `bad-version-byte`, `bad-base64`, `bad-zlib`, `too-large`, `bad-json`, `unknown-root`. The UI shows a human message for each.
