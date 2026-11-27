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
  dirty: boolean;
  source: { importedAt: string; originalString?: string };
}
```

Several documents can be open (tabs). Each has its own undo history.

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

### Wire commands

| Command | Notes |
| --- | --- |
| `connectWire(a, connA, b, connB, color)` | Checks wire reach from prototype data. Warns when out of reach. |
| `disconnectWire(...)` | |
| `autoConnectPoles(ids)` | Copper wires between poles in range, like the game's auto-connect. |

### Blueprint and book commands

`setLabel`, `setDescription`, `setIcons`, `setSnapping`, `addTile` / `removeTile` / `fillTiles(rect, tile)`, `setParameters`; book: `addBlueprint`, `removeBlueprint`, `reorder`, `moveToBook`, `setActiveIndex`; `newBlueprint`, `newBook`, `extractSelectionToBlueprint`.

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
| `Ctrl+Z` / `Ctrl+Y` | Undo / redo |
| `Ctrl+C/X/V` | Copy / cut / paste |
| `Q` | Pipette (pick the hovered entity's type into the place tool) |

Shortcuts SHOULD follow the game's defaults wherever there is an equivalent.

## Inspector editing

The inspector shows forms for the selected entity's known properties, by prototype type: recipe picker, quality, module slots, inserter filters and stack size, chest bar and filters, combinator conditions, train stop name and limit, splitter priorities, and so on. A "Raw JSON" tab allows editing with schema validation and preserves unknown keys.

## Export

- `Export` encodes the whole envelope (the full book, not only the active blueprint) and copies it to the clipboard. `Export active blueprint only` is also available.
- Before export, renumber `entity_number` values to be dense (1..n) in a stable order (by y, then x) and remap `wires` to match.
- Keep the original `version` unless the blueprint was migrated or the user chooses "stamp current game version".
