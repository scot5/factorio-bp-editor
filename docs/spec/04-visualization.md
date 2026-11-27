# 04 — Visualisation

## Layout

```
┌───────────────────────────────────────────────────────────────────────────┐
│ Toolbar: Import · Export · Undo/Redo · Tools · Overlays · Zoom · Agent ⧉  │
├────────────┬──────────────────────────────────────────────┬───────────────┤
│ Book tree  │                                              │ Inspector     │
│            │                 Canvas                       │ (selection)   │
│ Palette    │                                              ├───────────────┤
│ (edit mode)│                                              │ Analysis      │
│            │                                     minimap  │               │
├────────────┴──────────────────────────────────────────────┴───────────────┤
│ Status: cursor tile · selection count · warnings · game/assets status     │
└───────────────────────────────────────────────────────────────────────────┘
```

The agent panel docks on the right as a tab next to Analysis, or opens as a separate window.

## Canvas

- World unit = 1 tile. Render at 64 px per tile × zoom, to match high-resolution sprites.
- Zoom range from 1/32 (overview of huge blueprints) to 4×. Zoom to the cursor with the mouse wheel. Pan with middle-drag, space-drag or the arrow keys.
- "Fit to blueprint" on load and with `F`.
- Background: tile grid with chunk lines every 32 tiles. Show the blueprint's `snap-to-grid` box when it is set.
- Draw tiles (concrete, landfill, foundations) beneath entities, using their tile sprites from 1/4 zoom up (at most 20,000 visible tiles; see 03 § Remaining types) or flat colours (zoomed out, no game data, or while sheets load).

### Layer order

1. Tiles (flat colours, then tile sprites), then footprints of entities without sprites
2. Rail passes, each over all rails: stone path background, stone path, ties, signal rail pieces, backplates, metals (the game's `rail-stone-path-lower` … `rail-metal` render layers)
3. Ground patches (integration patches, belts, train stop rail overlays, ground-level signal structures)
4. `lower-object` (loader structures)
5. Entity shadows (including the shadows of elevated rails)
6. Entity bodies by render layer, each pass in y order: `lower-object-above-shadow` (also `lower-object-overlay`), `object-under`, `object` (most bodies), `cargo-hatch`, `higher-object-under` (inserter hands), `higher-object` (train stop tops), `above-inserters`. The pass comes from the sprite's own `render_layer` where the dump gives one, else from the type (see 03 § Sprite definitions)
7. Elevated rails and elevated signals, in the same passes as ground rails plus a fence pass, then other elevated objects
8. Wires (copper, red, green)
9. Overlays (see below)
10. Selection, hover, ghost previews

### Level of detail

The renderer must stay smooth (≥ 50 fps pan/zoom) for blueprints with **20,000 entities** on mid-range hardware.

- Below about 1/4 zoom: skip shadows and wires, and draw entity bodies as coloured footprints from a per-type palette.
- From 1/4 zoom (16 px per tile) up, entities with game graphics are drawn as sprites, at most 6,000 visible entities (otherwise footprints). Entities without graphics, and those whose sheets are still loading, keep a footprint and icon (and their direction arrow). Inserters show their facing through the arm, so they have no arrow in sprite mode. Implemented in `src/renderer/canvas/scene.ts`, using pooled sprites for visible entities only: one pool per pass above, in that order (`DrawLayer` in `src/core/sprites/types.ts`).
- Shadows are drawn as one group at 50 % opacity (an `AlphaFilter` on the shadow layer), so overlapping shadows do not get darker, as in the game.
- Below about 1/16 zoom: a single pre-rendered bitmap of the whole blueprint, updated in the background after edits.
- Cull entities outside the viewport using a spatial index (uniform grid of 32×32 chunks).

## Overlays (toggle each)

| Overlay | Shows |
| --- | --- |
| Recipe icons | Recipe icon on each crafting machine (like alt-mode) |
| Alt-mode info | Inserter filters, chest filters, train stop names, module icons |
| Belt flow | Arrows on belts. Optional item colouring from analysis |
| Circuit networks | Red/green networks highlighted, with network ids |
| Power | Pole supply areas, unpowered entities in red |
| Logistics | Roboport construction and logistic areas |
| Beacons | Beacon effect areas and how many beacons reach each machine |
| Warnings | Markers from validation (06) |
| Heatmap | Any per-entity numeric metric from analysis (for example utilisation) |

## Interaction (view mode)

- Hover shows a tooltip: entity name, quality, recipe, position, direction.
- Click selects. The inspector shows every property, including raw JSON (read-only in view mode).
- Shift-click or drag-box selects several entities. The inspector shows a summary.
- Clicking a row in the analysis panel (for example "12× electric-mining-drill") highlights those entities on the canvas.

## Rich text

Labels, descriptions, train stop names and the like use Factorio rich text. Support `[item=…]`, `[entity=…]`, `[recipe=…]`, `[fluid=…]`, `[virtual-signal=…]`, `[img=…]`, `[color=…]…[/color]`, `[font=…]…[/font]`. Unknown tags show as plain text.

## Theming

Dark theme by default, styled like the game UI but without copying its graphics. Light theme optional.
