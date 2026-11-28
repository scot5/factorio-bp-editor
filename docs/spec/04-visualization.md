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

## Side panel

The right sidebar has **Inspector** and **Analysis** tabs (the agent tab joins them in M6).

**Collapsible sections** (Analysis tab; `src/renderer/panels/Section.tsx`, `store/sections.ts`):

- The tab is built from sections at two levels: **reports** (Validation, Inventory, Production, Logistics, Power, Circuits, Compare) and the **lists** inside them (Bill of materials, Entities, Machines, Outputs, Consumers, …). Each header is a button with a chevron and `aria-expanded`; Enter and Space toggle it. Short key-value summaries and pickers (surface, rate unit, research levels) sit at the top of their report's body and are not collapsible.
- **Header summaries** stay visible when a section is collapsed: lists show their row count, reports a key figure (Validation "11 errors · 3 warnings", Inventory "4,531 entities", Production "126 machines", Logistics "2,561 belts · 569 inserters · 7 limited", Power "96.6 MW peak", Circuits "5 red · 3 green", Compare "+6 · −3 · ~6" or "not comparing"). A report or list that holds warnings (unpowered entities, under-supplied flows, failed surface conditions) shows its header in the danger colour, and the report summary names them ("12 under-supplied", "3 unpowered"), so warnings are not hidden by collapsing. Machines limited by their inserters (06 § 3) are not shown as warnings: a mall's machines run far below full speed by design, so the list is long and mostly expected there. When space is short the summary is truncated, never the title.
- **Header actions** (for example the bill of materials "Copy") sit beside the toggle, not inside it.
- **Defaults:** everything is open except the long **Entities** and **Tiles** lists the validation **Notes** (info-level findings such as belt ends, which every balancer has) and the logistics **Fluid segments**. Warning lists are open by default like the rest.
- **Validation first:** the Validation report (06 § 6) opens the tab, so problems show before the long inventory lists. Its lists (Errors, Warnings, Notes) let long labels wrap instead of truncating, since each row is a sentence, and keep the icon's space when a prototype has no icon (unknown names).
- **Collapse all / Expand all** at the top of the tab apply to every section shown this session, nested lists included (a list inside a collapsed report still counts).
- **Persistence:** the open/closed choice is saved per section id (`inventory`, `inventory.entities`, `production.under`, `power.consumers`, …) in `settings.json` (01 § Persistence), one set for the whole app, not per blueprint. Sections never toggled follow their default, so new sections pick up their default after an update. Renaming a section id resets that section to its default.
- The Inspector keeps plain headers: its sections are short and change with the selection.

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
8. Wires (copper, then red, then green), above every sprite pass and under icons and arrows of entities without sprites. Each wire is a cubic Bézier between its two end points (03 § Wire connection points) that sags downwards by up to 0.94 tiles, less for shorter and steeper wires, straight when vertical (the Factorio Blueprint Editor's curve). Colours `#cf7c00`, `#c83718`, `#588c38`. The width is fixed on screen, 1.5 px, growing to at most 4 px when zoomed in (0.04 tiles). The curve is drawn as straight pieces about 10 px long, since Pixi's own Bézier tessellation is too coarse in tile units. Wire shadows are not drawn. Implemented in `scene.ts` (`drawWires`); `wireSegments` in `src/core/sprites/wires.ts` computes the end points once per layout and game data
9. Overlays (see below), including the diff overlay
10. Selection, then the highlighted circuit network's wires (drawn over the selection tint so they stay visible), hover, ghost previews

### Level of detail

The renderer must stay smooth (≥ 50 fps pan/zoom) for blueprints with **20,000 entities** on mid-range hardware. The e2e test "stays responsive with a 16,937-entity blueprint" checks a median frame below 20 ms locally, and below 50 ms on CI: the GPU-less Windows runner renders in software and measured up to 31 ms.

- Below about 1/4 zoom: skip shadows and wires, and draw entity bodies as coloured footprints from a per-type palette.
- Wires are drawn from 1/4 zoom up in both sprite and footprint mode, with or without game data: those whose curve box meets the view (a spatial index of the boxes, so a wire crossing the view with both ends outside still shows), at most 20,000 per frame. The drawn count is on the canvas element as `data-wires`, for tests.
- A highlighted circuit network (see § Overlays) is drawn at every zoom, since a network is worth seeing zoomed out: its wires in their colour at 1.5 × the normal width over a white halo 3 px wider, at most 20,000 wires. The count is on the canvas as `data-wire-highlight`.
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
| Circuit networks | Red/green networks highlighted, with network ids. **Done so far:** clicking a network in Analysis → Circuits selects its entities and highlights its wires (`selectNetwork` in `store/documents.ts`, `Scene.setWireHighlight`); any other selection change clears the highlight. Not done: a toggle that shows every network with its id on the canvas |
| Power | Pole supply areas, unpowered entities in red |
| Logistics | Roboport construction and logistic areas |
| Beacons | Beacon effect areas and how many beacons reach each machine |
| Warnings | Markers from validation (06) |
| Heatmap | Any per-entity numeric metric from analysis (for example utilisation) |
| Diff | While comparing (Analysis → Compare, 06 § 7): added entities tinted green (`#7bd389`), changed ones yellow (`#f5d33d`), removed ones as red outlines (`#ff6b5b`) where they were, shifted by the alignment offset. Drawn at every zoom above the entity layers and below the selection; on by default, with a checkbox in the Compare section. The counts are on the canvas as `data-diff` (`added,changed,removed`, empty when off) |

## Interaction (view mode)

- Hover shows a tooltip: entity name, quality, recipe, position, direction.
- Click selects. The inspector shows every property, including raw JSON (read-only in view mode).
- Shift-click or drag-box selects several entities. The inspector shows a summary.
- Clicking a row in the analysis panel (for example "12× electric-mining-drill") highlights those entities on the canvas. A circuit network row also highlights the network's wires.

## Rich text

Labels, descriptions, train stop names and the like use Factorio rich text. Support `[item=…]`, `[entity=…]`, `[recipe=…]`, `[fluid=…]`, `[virtual-signal=…]`, `[img=…]`, `[color=…]…[/color]`, `[font=…]…[/font]`. Unknown tags show as plain text.

## Theming

Dark theme by default, styled like the game UI but without copying its graphics. Light theme optional.
