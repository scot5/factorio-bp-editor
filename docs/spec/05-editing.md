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

## Inspector editing

The inspector shows forms for the selected entity's known properties, by prototype type: recipe picker, quality, module slots, inserter filters and stack size, chest bar and filters, combinator conditions, train stop name and limit, splitter priorities, and so on. A "Raw JSON" tab allows editing with schema validation and preserves unknown keys.

With no entity selected, the inspector shows the active item (blueprint, book or planner). Its label and description are edited in place: click the rich-text value to get the raw text, then Enter commits (Ctrl+Enter for the description), Escape cancels, and leaving the field commits.

## Export

- `Export` encodes the whole envelope (the full book, not only the active blueprint) and copies it to the clipboard. `Export active blueprint only` is also available.
- Before export, renumber `entity_number` values to be dense (1..n) in a stable order (by y, then x) and remap `wires` to match.
- Keep the original `version` unless the blueprint was migrated or the user chooses "stamp current game version".
