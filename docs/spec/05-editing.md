# 05 — Editing

## Principles

- Every change goes through a **command**: a pure function `(doc, args) → doc` in `src/core/edit`. The UI, keyboard shortcuts and the agent all use the same commands.
- Commands run inside Immer `produce` with patches enabled. The inverse patches go on the undo stack. The forward patches tell the canvas which entities to redraw.
- Commands that would make the blueprint invalid (overlapping collision boxes, an unknown prototype) still apply, but raise **warnings** (06). The editor never silently blocks the user. The one exception: an edit that would make the export unreadable to the game (for example a duplicate `entity_number`) MUST be rejected.

## Document model

```ts
interface Document {
  id: string;
  envelope: BlueprintEnvelope;   // the decoded root (blueprint or book …)
  activePath: number[];          // index path to the blueprint being edited within a book
  history: History;              // undo/redo steps; "dirty" is derived from it (§ Undo history)
  source: { importedAt: string; originalString?: string };
}
```

Several documents can be open (tabs). Each has its own undo history.

The tab title follows the root label (plain text), falling back to the file name and then the item kind, so renaming the root renames the tab.

## Undo history

Implemented in `src/core/edit` (`command.ts`, `history.ts`, `invariants.ts`). Everything is immutable: `execute`, `undo` and `redo` take an envelope and a `History` and return new ones.

- **Commands** are `{ name, label(args), mergeKey?(args), run(draft, args) }`. `run` changes a draft of the *whole envelope* (so book commands and entity commands share one shape) and may return `{ warnings }`. Commands address their target by book path in their arguments. A command throws `CommandRejected` to refuse an edit; any other error is a bug and propagates.
- **Rejection:** after a command runs, the blueprints its patches touch are checked for invalid or duplicate `entity_number` values (the whole envelope when a patch lies above any blueprint, e.g. a book slot is added or removed). Only problems the edit *adds* reject it, so a blueprint imported with a duplicate can still be edited. A rejected edit changes nothing and adds no step; the store returns `{ ok: false, message }` for the UI to show.
- **Steps:** each step stores forward and inverse patches, its label ("Set label"), and the `activePath` at the time. Undo and redo switch back to that blueprint (and clear the selection) when it still exists. A command that changes nothing adds no step. A new edit clears the redo stack. At most **200** steps are kept per document; older ones are dropped.
- **Merging:** consecutive edits with the same `mergeKey` less than **1 s** apart merge into one step (typing into a field, and later dragging). A step is never merged into the saved step, so the dirty state stays right.
- **Key order:** Immer's inverse of removing an object key is an `add`, which appends the key. Undoing "clear the label" would move `label` to the end of the blueprint and break the round-trip guarantee (02). Each step records the key order of every object whose keys it adds or removes, before and after, and undo and redo restore that order when the key set matches. A corpus-wide test edits and undoes every corpus string and requires the exact original encoding.
- **Dirty:** `isDirty(history)` compares the top undo step with the step recorded at the last save (`cleanId`; 0 means as imported). Exporting the *whole* document (copy or save) marks it saved; exporting only the active item does not. Undoing back to the saved state makes the document clean again. The tab shows a dot while dirty.
- **Freeze strategy:** envelopes stay deep-frozen (Immer auto-freeze, as the store already did on import). Measured on the 16,937-entity Step 7 of the rocket book: deep-freezing the decoded book once costs ~77 ms (at import); moving one entity costs 1.2 ms with auto-freeze vs 0.1 ms without, and undoing it 1.1 ms; moving all 16,937 entities 74 ms vs 61 ms (patch generation dominates). Freezing is kept for its safety, since edits only copy the changed path. Revisit for drags if per-frame edits turn out too slow.
- **After each edit** the store re-runs `validateEnvelope` (~18 ms on the whole rocket book), recomputes the title, and falls back to the default path if the active item no longer exists. The analysis worker and the canvas react to the new blueprint object as they do on import; using the forward patches for partial canvas redraws comes with the entity commands (move, delete), where it pays off.
- **Shortcuts:** `Ctrl+Z` undo; `Ctrl+Y` and `Ctrl+Shift+Z` redo. They are ignored while focus is in a text field, which keeps its own undo. Toolbar Undo / Redo buttons name the step in their tooltip.

## Command catalogue

### Entity commands

| Command | Notes |
| --- | --- |
| `place(name, position, direction, props?)` | Snap to the grid using the prototype size. Assign the next free `entity_number`. |
| `delete(ids)` | Also removes wires that touch these entities. |
| `move(ids, dx, dy)` | Whole tiles only (2-tile steps when rails are in the selection). |
| `rotate(ids, cw \| ccw)` | Around the selection centre. Updates each entity's `direction`. Non-rotatable entities only move. |
| `mirror(ids, horizontal \| vertical)` | Sets `mirror` where the entity supports it, and mirrors fluid boxes, positions and directions. |
| `setProperty(id, path, value)` | Generic setter used by the inspector (recipe, quality, filters, control_behavior, …). |
| `setRecipe(ids, recipe, quality?)` | Validates against the machine's crafting categories. |
| `setModules(ids, insertPlan)` | Respects module slots and allowed effects. |
| `replace(ids, newName)` | Keeps compatible properties (for example belt → fast belt). Warns about dropped ones. |
| `upgrade(selection, mapping)` | Bulk replace using an upgrade-planner-style mapping. |
| `copy` / `cut` / `paste(at)` | Clipboard holds a sub-blueprint. Paste shows a ghost preview until the user confirms. |

`moveEntities`, `rotateEntities`, `mirrorEntities` and `deleteEntities` are implemented (`src/core/edit/entities.ts`). They take `{ path, indexes, lookup }`: the blueprint's book path, indexes into its `entities` (the canvas selection uses indexes), and the prototype lookup for sizes and types (the PrototypeDb, or the fallback size table). An index that no longer exists rejects the edit.

- **Move** rejects fractional offsets, and odd offsets when a rail-grid entity (rails, ramps, supports, train stops) is selected.
- **Delete** also removes the wires that touch the deleted entities, drops them from `schedules[].locomotives` (a schedule with no locomotive left is removed), and removes their `stock_connections` entries and the `front` / `back` references to them. A list that ends up empty (including `entities`) is removed, as the game omits empty lists. `entity_number`s are not renumbered; that happens on export (§ Export).
- After an edit that changes the number of entities (a delete, or undoing one), the store clears the selection, since it holds indexes. Moves, turns and mirrors keep it.

### Rotate and mirror

Implemented in `src/core/edit/entities.ts` and `src/core/prototypes/transform.ts`.

- **Positions** turn or mirror around the selection's footprint box (`entityFootprint`, shared with the canvas layout). A quarter turn keeps tiles on the grid only when the pivot's coordinates are both whole or both half. When the box centre mixes the two, the pivot moves half a tile: clockwise along x (+½ when x is whole, −½ when x is half), anticlockwise along y (−½ when x is whole, +½ when x is half). With that rule, a clockwise turn followed by an anticlockwise one, and four turns the same way, return every entity to where it started. A mirror line through the box centre always keeps the grid.
- **Rail grid:** with rails, ramps, supports or train stops selected, the pivot is a whole point with an even coordinate sum (rails lie on a 2×2 grid, and such a turn maps it onto itself), chosen so that anticlockwise undoes clockwise. A mirror line is whole; a half one moves to the even neighbour, so mirroring twice returns to the start.
- **Directions** turn by 4 per quarter turn and mirror as `−d` (horizontal) or `8 − d` (vertical). Then the game's form is written: straight and half-diagonal rails (ground and elevated) and rail supports use 0–7, since a half turn is the same piece; 1.1 `legacy-straight-rail` folds N/S and E/W the same way but keeps its four diagonals. North is written by leaving `direction` out. Entities that cannot rotate (DB `rotatable: false`, or a `NON_ROTATABLE_TYPES` type without game data) keep their direction and only move.
- **Mirror offsets,** confirmed against `elevated_rail_intersection.txt`, which is 4-fold symmetric. Turning it a quarter maps every rail, support and signal onto one of the same kind, and mirroring maps its rails and supports onto themselves (`tests/unit/edit-corpus.test.ts`). Curved rails (`a` and `b`, ground and elevated) and half-diagonal rails change hand, so their mirrored direction gets `+2`. Rail and chain signals move to the other side of the track and therefore guard the other way: `+8`. The same is assumed for train stops (they stand on the right of the track) and for `legacy-curved-rail` (`+2`, like 1.1's curves). These two are derived, not yet checked against the game.
- **`mirror` flag:** toggled (written as `true` or left out) on entities whose prototype mirrors (DB `mirroring`, 03 § Rotate and mirror fields). A mirrored entity is flipped across its own facing axis, so a horizontal mirror also turns `d → −d`, and a vertical one is a horizontal one plus a half turn (`8 − d`), as for any other entity.
- **Splitters** (and lane splitters) swap `input_priority` / `output_priority` between `left` and `right`.
- **Rolling stock** (anything with an `orientation`) turns by `±0.25` and mirrors as `1 − o` (horizontal) or `0.5 − o` (vertical), mod 1. It gets no `direction`.
- **Not handled yet:** blueprints the game refuses to flip (`allows_flipping`, runtime-only), and the power switch's left / right copper connectors on a mirror.
- **Measured** on the 16,937-entity Step 7 of the rocket book: moving one entity 5 ms, moving all 107 ms, rotating all 160 ms, mirroring all 134 ms, deleting one 10 ms (undo 43 ms). A drag commits one move on release, so this is fine.

### Wire commands

| Command | Notes |
| --- | --- |
| `connectWire(a, connA, b, connB, color)` | Checks wire reach from prototype data. Warns when out of reach. |
| `disconnectWire(...)` | |
| `autoConnectPoles(ids)` | Copper wires between poles in range, like the game's auto-connect. |

### Blueprint and book commands

`setLabel`, `setDescription`, `setIcons`, `setSnapping`, `addTile` / `removeTile` / `fillTiles(rect, tile)`, `setParameters`; book: `addBlueprint`, `removeBlueprint`, `reorder`, `moveToBook`, `setActiveIndex`; `newBlueprint`, `newBook`, `extractSelectionToBlueprint`.

`setLabel({ path, text })` and `setDescription({ path, text })` are implemented (`src/core/edit/blueprint.ts`). They work on any item (blueprint, book or planner) by book path. Empty text removes the key, as the game omits an empty label; an existing key keeps its position. Each merges per item, so typing is one undo step.

### Planners

The deconstruction and upgrade planners get form-based editors: filter lists and from/to mappings with icon pickers. No canvas.

## Tools (editor modes)

| Key | Tool |
| --- | --- |
| `V` | Select / move |
| `B` | Place from palette (palette searchable by name, grouped like the game's crafting menu) |
| `X` | Delete brush |
| `W` | Wire tool (copper / red / green) |
| `T` | Tile brush |
| `R` / `Shift+R` | Rotate |
| `F` / `G` | Mirror horizontal / vertical (when something is selected) |
| `Ctrl+Z` / `Ctrl+Y` (or `Ctrl+Shift+Z`) | Undo / redo |
| `Ctrl+C/X/V` | Copy / cut / paste |
| `Q` | Pipette (pick the hovered entity's type into the place tool) |

Shortcuts SHOULD follow the game's defaults wherever there is an equivalent.

**Implemented so far (M5 plan step 2):** select (click, Shift / Ctrl, box; 04 § Interaction), drag to move, and `R` / `Shift+R`, `F` / `G` and `Delete` (also `Backspace`) on the selection, plus toolbar buttons for rotate, both mirrors and delete. `F` fits the view when nothing is selected. The selection shortcuts are ignored in text fields and dialogs.

## Inspector editing

The inspector shows forms for the selected entity's known properties, by prototype type: recipe picker, quality, module slots, inserter filters and stack size, chest bar and filters, combinator conditions, train stop name and limit, splitter priorities, and so on. A "Raw JSON" tab allows editing with schema validation and preserves unknown keys.

With no entity selected, the inspector shows the active item (blueprint, book or planner). Its label and description are edited in place: click the rich-text value to get the raw text, then Enter commits (Ctrl+Enter for the description), Escape cancels, and leaving the field commits.

## Export

- `Export` encodes the whole envelope (the full book, not only the active blueprint) and copies it to the clipboard. `Export active blueprint only` is also available.
- Before export, renumber `entity_number` values to be dense (1..n) in a stable order (by y, then x) and remap `wires` to match.
- Keep the original `version` unless the blueprint was migrated or the user chooses "stamp current game version".
