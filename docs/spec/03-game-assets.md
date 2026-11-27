# 03 — Game assets

The app uses the player's own Factorio installation for prototype data (sizes, recipes, speeds, power) and graphics (sprites, icons). Nothing from the game is bundled or redistributed.

## Locating the install

Search order:

1. The path saved in settings.
2. Steam: read `libraryfolders.vdf` (Windows: `C:\Program Files (x86)\Steam\steamapps\libraryfolders.vdf`, plus the registry key `HKCU\Software\Valve\Steam\SteamPath`). Check each library for `steamapps/common/Factorio`.
3. Common standalone paths (`C:\Program Files\Factorio`, `~/.factorio`, `/Applications/factorio.app/Contents`).
4. Ask the user (folder picker).

A folder is a valid install when it contains `data/base/info.json` and `bin/x64/factorio(.exe)`. Read the version from `data/base/info.json`.

Reference install used during development:

```
D:\SteamLibrary\steamapps\common\Factorio     (2.1.25)
  bin/x64/factorio.exe
  data/core, base, space-age, quality, elevated-rails
  doc-html/prototype-api.json, runtime-api.json
```

## Prototype data

Factorio defines prototypes in Lua. The app must not try to run that Lua itself. It uses the game's own export instead:

```
factorio.exe --dump-data          → <write-data>/script-output/data-raw-dump.json
factorio.exe --dump-icon-sprites  → <write-data>/script-output/{item,entity,recipe,…}/*.png
```

- `--dump-data` writes the complete final `data.raw` after all mods load, including sprite definitions, collision boxes, recipes, crafting speeds, energy usage and so on. This is the single source of truth.
- `--dump-icon-sprites` renders every icon with its layers, tints and mipmaps already combined. Use these PNGs for icons instead of combining icon layers by hand.
- The write-data directory depends on `config-path.cfg` (`use-system-read-write-data-directories`). Steam installs use `%APPDATA%\Factorio`. Read `config-path.cfg` and `config/config.ini` to find it.
- Both commands exit when done (`--dump-data` takes about 9 s and `--dump-icon-sprites` about 15 s on the 2.1.25 reference install). They **fail if the game is already running**: the output contains "Couldn't create lock file … Is another instance already running?". Detect that case and show "close Factorio and retry".
- **Steam builds:** `--dump-icon-sprites` needs graphics and starts the Steam API. Started outside Steam, the game prints "Steam requires game restart, restarting…", exits immediately, and Steam starts a detached copy about 30 s later. That copy does run the dump, but it holds the lock and cannot be waited on. Set `SteamAppId=427520` (and `SteamGameId`) in the **child process's** environment to prevent this. Never create `steam_appid.txt` in the user's install. `--dump-data` is headless and is not affected.
- `--dump-icon-sprites` writes one 64×64 RGBA PNG per prototype to `script-output/<category>/<name>.png`. The categories are `item`, `entity`, `recipe`, `fluid`, `virtual-signal`, `tile`, `quality`, `technology`, `space-location`, `item-group`, `equipment`, `asteroid-chunk`, `achievement`, `decorative`, and others. That is about 2,700 files and 30 MB in total.
- The app starts the game **only when the user clicks "Load game data"**. At startup it only reads files: it detects the install and looks for a matching cache.

Implementation: `src/main/assets/` (`locate.ts`, `factorio.ts`, `service.ts`, `protocol.ts`). Pure parsing lives in `src/core/assets/`, and the DB builder in `src/core/prototypes/db.ts`. The cache key is `<game version>-<sha1 of enabled mods and versions>-f<DB_FORMAT_VERSION>`, so changing mods or the DB format makes the app offer to reload. The "vanilla + expansions only" option is not built yet.
- Mods: by default the dump uses the user's current `mod-list.json`. Offer "vanilla + expansions only" as an option, implemented by passing a temporary `--mod-directory` with a generated `mod-list.json`.

The main process then processes the dump into a compact **PrototypeDb**, cached in `prototype-cache/<version>-<modsHash>/`:

```ts
interface PrototypeDb {
  gameVersion: string;
  mods: { name: string; version: string }[];
  entities: Record<string, EntityProto>;   // type, size, collision_box, selection_box,
                                           // crafting_speed, energy_usage, module_slots,
                                           // belt speed, fluid boxes, sprite refs …
  items: Record<string, ItemProto>;
  recipes: Record<string, RecipeProto>;
  fluids: Record<string, FluidProto>;
  tiles: Record<string, TileProto>;
  signals: Record<string, SignalProto>;   // virtual signals
  qualities: Record<string, QualityProto>;
  planets: Record<string, PlanetProto>;   // surface conditions
  locale: Record<string, string>;         // en (and the user's locale) display names
}
```

Rebuild the cache when the game version or mod set changes, or when the user asks.

**Fallback.** If the dump cannot run (no install, game running, error), the app still works. It uses a small built-in table of base-game entity sizes (generated from a dump at build time; sizes only, no assets) and draws boxes with labels.

### Typed schemas

`doc-html/prototype-api.json` describes every prototype type and property in machine-readable form. Use it at build time to generate TypeScript types for the parts of the dump the app reads. Do not hand-write them.

Exception, decided in M3 step 7a: the DB builder reads the dump as `unknown` and **normalises** what it keeps into the app's own compact types (`EntityProto`, `SpriteNode` in `src/core/sprites/types.ts`). Those are our cache format, not the game's prototype types, so they are written by hand. Generated prototype types would not remove the runtime validation that untrusted JSON needs, so generation is deferred until a feature reads many more prototype properties (M4 analysis is the likely point).

## Graphics

### Asset protocol

Implemented in `src/main/assets/protocol.ts`, with URL building and parsing in `src/core/assets/asset-url.ts`.
- **URL forms:** `factorio-asset://icons/<category>/<name>.png` for the icon cache, and `factorio-asset://data/<mod>/<path>` for the install's `data/<mod>` folder. Mod zips are not supported yet.
- **CORS:** the scheme is registered as standard, secure and CORS-enabled, and responses carry `Access-Control-Allow-Origin: *`. This is required because the page has a different origin, and WebGL refuses to upload images without CORS ("The image element contains cross-origin data"). Images used as textures must set `crossOrigin = 'anonymous'`.
- **Path safety:** the URL parser rejects `..`, `.`, empty segments, encoded `/` and `\`, `:`, NUL and query strings. The handler then resolves the path and checks it stays inside the root, both before and after `realpath`, so symlinks and junctions cannot escape. Both checks are tested.

The main process registers `factorio-asset://` and maps:

```
factorio-asset://data/__base__/graphics/entity/…png   → <install>/data/base/graphics/entity/…png
factorio-asset://cache/icons/item/iron-plate.png       → <cache>/icons/item/iron-plate.png
```

Sprite paths in the dump look like `__base__/graphics/…`. The `__mod__` prefix maps to `data/<mod>` for built-in content and to the mod zip or folder for third-party mods. (Serving files from inside mod zips needs a zip reader in the main process: M7.)

### Sprite definitions

The dump gives each sprite as `filename`, `width`, `height`, `x`, `y`, `scale`, `shift`, `frame_count`, `line_length`, `direction_count`, and either `layers` or `stripes`. Since 2.0, every graphic is high resolution with `scale = 0.5` (64 px per tile at scale 1). In 2.1, many sheets also have a `.lua` sidecar next to the `.png` (for example `assembling-machine-1-base.lua` → `{ width, height, shift, line_length }`). The dump already includes those values, so the sidecars need no parsing.

The renderer's `SpriteResolver` maps `(entity prototype, direction, variant)` to a list of layers `{ texture, frame rect, offset, scale, tint, blendMode, isShadow }`.

**Implementation (M3 step 7a, `src/core/sprites/`):**

- **What is stored.** `graphics.ts` lists, per prototype type, the graphics properties that make up the entity's *static* look, in draw order (for example `graphics_set.animation` plus `always_draw` working visualisations for crafting machines, `platform_picture` for inserters, `robot_door.animation` for logistic chests, `folded_animation` over the base for turrets). Only those are copied into the PrototypeDb (`EntityProto.graphics`, DB format 2). Sounds, working lights, recipe-tinted fluids and working-only animations are left out. The vanilla + expansions dump adds about 125 KB.
- **Normalisation.** `normalize.ts` turns each value into one of four node kinds: a sprite leaf, `layers`, `directions` (`north` / `north_east` / … keys) or `sheet` (`SpriteNWaySheet`, `frames` default 4). Defaults are omitted. `draw_as_light` layers and `__core__/graphics/empty.png` are dropped. An array (variations) uses its first element. A part may be marked `ground` (integration patches) or `fixedRotation` (electric pole `pictures` and the radar dish, whose `direction_count` is not the facing).
- **Resolution** (`resolve.ts`), confirmed against the 2.1.25 dump and the PNG sizes:
  - Per-direction objects: the exact 8-way key, then the cardinal, then the opposite direction (the steam engine only has `north` and `east`), then `north`.
  - Sheets: the frame is the 4-way index (`frames` 2: N/S share frame 0, E/W frame 1; `frames` 8: 8-way index), laid out horizontally.
  - Rotated sheets: `dir_index = round(direction / 16 × direction_count)`, `index = dir_index × frame_count + frame`, `col = index mod line_length`, `row = ⌊index / line_length⌋`. A missing or 0 `line_length` means one row per direction (`frame_count` wide), or all directions/variations in one row when there is one frame (medium pole: 4 variations in a row; gun turret raising: 5 frames × 4 directions).
  - `filenames` continue the index across files, `lines_per_file × line_length` frames each (artillery cannon: 8 files × 32 orientations). `stripes` continue it across stripes, `width_in_frames × height_in_frames` each (gun turret shooting: 4 stripes of 16 orientations).
  - Frame 0 by default. `repeat_count` holds each frame for that many ticks.
  - `apply_runtime_tint` masks (turrets) are tinted with the game's default player colour.
  - Output layer: `{ url, rect, shift (tiles), scale, tint?, additive?, shadow, ground }`. On screen a layer is `rect × scale / 32` tiles, centred at the entity centre plus `shift`.
  - A per-direction object marked `exact` draws only the matching key, with no fallback (the splitter's `structure_patch` is empty for north and south).
- **Render layers.** A `render_layer` on a sprite, or on any object around it (LayeredSprite, the `…WithRenderLayer` lists, working visualisations, beacon `animation_list` entries), is kept on the leaf and decides its draw pass (`drawLayerFor` in `layers.ts`; it wins over the part's pass). Prototypes almost never set an entity-wide `render_layer`; the game picks it per type, so the extractors set it where it matters (inserter hands). See 04 § Layer order.
- **Not yet handled:** pipe covers on machines, and the items in § Remaining types below. Rails, signals, train stops and rolling stock: see § Rails, signals and rolling stock.

### Connection-aware sprites

Implemented in M3 step 7b (`src/core/sprites/shapes.ts`, `src/core/prototypes/connections.ts`). DB format 3 adds two fields to `EntityProto`:

- `shapes`: named pictures picked per entity. `belt` is the `belt_animation_set.animation_set` sheet (transport belts, undergrounds, splitters, lane splitters). Undergrounds add the four `structure.direction_*` sheets. Pipes add the 16 `pictures` pieces (no windows, visualisations or frozen variants), heat pipes the 16 `connection_sprites`, and walls the 8 `pictures` pieces plus `filling`.
- `connections`: fluid and heat connection points `{ position, direction, positions?, production?, categories? }` for the north-facing entity. They come from every property holding a FluidBox (or a list of them), `energy_source.fluid_box`, `heat_buffer.connections`, and `energy_source.connections` when the energy source is `heat`. Underground and linked pipe connections are left out. `positions` (one per facing) is kept for the pumpjack. Vanilla plus expansions has 32 such prototypes.

The renderer builds a tile index of the blueprint (belt-like entities, walls, gates, and anything with connections) on the first sprite request, and calls `pickShape(db, entity, tileQuery)` per entity. The result is a small `Shape` value (`belts`, `picture`, `pictureDirection`, `fill`), which is also the cache key with the prototype name and direction. `resolveShape` draws belts (on the ground), then the static graphics, then the picture. The rules below were checked against the 2.1.25 sheets and in screenshots of the corpus:

- **Belt sheet rows** (TransportBeltAnimationSet, 1-based): 1–4 straight E/W/N/S, 5–12 curves, 13–20 `starting_` / `ending_` caps for S, W, N, E. A curve is named `<side>_to_<facing>`: `east_to_north` (5) faces north and is fed from the east (rows 5 and 6 both join the top and right edges). By facing N/E/S/W and feeding side: N from E 5, from W 7; E from N 6, from S 9; S from E 10, from W 12; W from N 8, from S 11.
- **Belts:** a neighbour *feeds* a tile when it is a transport belt, an output underground, or a splitter whose front is that tile. A belt curves when exactly one side feeds it and nothing feeds it from behind. It gets a start cap when nothing feeds it from behind and it is not curved, and an end cap when the tile ahead does not take its items (a belt not facing back, an underground not entered through its hood, or a splitter facing the same way).
- **Underground belts:** the blueprint `direction` is the flow direction for both `type: "input"` and `"output"`. The structure sheet frames are ordered by the side the opening faces: input uses its own direction, output the opposite. Input uses `direction_in_side_loading` when fed only from a side; output uses `direction_out_side_loading` when the belt ahead is perpendicular. Both draw a straight belt under the hood, plus a start cap (input with no feeder) or end cap (output with nothing ahead).
- **Splitters:** two straight belts half a tile either side of the centre (one for the 1-wide lane splitter), then `structure` and `structure_patch`.
- **Pipes and heat pipes:** a side is connected when the entity has a connection pointing that way and the neighbour has a connection on the touching tile pointing back. Connections rotate clockwise with the facing (4-way). Connections must share a `connection_category` (default `"default"`). With `fluid_boxes_off_when_no_fluid_recipe`, input boxes count only when the recipe has a fluid ingredient and output boxes only when it has a fluid result. Pieces are named after the connected sides: `ending_up` connects only up, `t_up` connects left, right and up, and `corner_up_right` up and right (heat pipes: `corner_right_up`). No connection is `straight_vertical_single` (heat pipe: `single`).
- **Walls:** a wall only looks right, left and down (the wall above draws the joint). It joins walls, and gates in line: a gate facing north or south stands in a vertical wall line (checked in the 1.1 outpost book). Pieces: R `ending_right`, L `ending_left`, L+R `straight_horizontal`, D `straight_vertical`, R+D `corner_right_down`, L+D `corner_left_down`, L+R+D `t_up`, none `single`. In a 2×2 block, the top-right wall also draws `filling` half a tile to its left (the rule the Factorio Blueprint Editor uses; it closes the gap in thick walls).
- **Gates and pipe-to-ground** have static graphics: gate `vertical_animation` for north/south and `horizontal_animation` for east/west, pipe-to-ground per-direction `pictures`.
- Every variant takes its first frame and variation. Turbo belts' `alternate` frames do not matter for a static view.

### Rails, signals and rolling stock

Implemented in M3 step 7c (`src/core/sprites/graphics.ts`, `resolve.ts`, `variant.ts`). DB format 4 adds `EntityProto.color` (the default runtime-tint colour of train stops and rolling stock). Checked against the 2.1.25 dump (every rectangle of every rail-family prototype inside its PNG, in 16 directions, both rail layers and 64 orientations) and in screenshots of the rail corpus strings, the migrated 1.1 outpost book and a synthetic blueprint.

- **Draw passes.** Parts and resolved layers may carry a `layer` (`DrawLayer`) named after the game's render layer, so the renderer draws each pass over all entities: `rail-stone-path-lower`, `rail-stone-path`, `rail-tie`, `rail-chain-signal-metal`, `rail-screw`, `rail-metal`, then the usual ground, shadow and body passes, `higher-object` (train stop tops), the same five passes for elevated rails plus `elevated-rail-above-metal` (fences), and `elevated-object`. Shadows always go to the shadow pass. Other render layer names map to the nearest pass (`drawLayerFor`). See 04 § Layer order.
- **Rails** (`straight-rail`, `half-diagonal-rail`, `curved-rail-a/b`, `legacy-*`, the `elevated-*` variants and `rail-ramp`): `pictures` has one RailPieceLayers per key `north`, `northeast`, … `northwest` (no underscore; the normaliser accepts both spellings). The 16-way rail direction picks the key exactly (direction / 2): straight and half-diagonal rails use 0/2/4/6 and only fill north … southeast; curved rails use all eight. Confirmed by continuous curves in the corpus. Pieces in order: `stone_path_background`, `stone_path`, `ties`, `backplates`, `metals`, each in the pass its `render_layers` entry names (the ramp puts its walls, `ties`, in `object`). Elevated rails have their 3-tile height in the sprite shift. Their `fence_pictures.side_A/B.fence` are drawn above the metals. Left out: `segment_visualisation_*`, water reflections, underwater structures, shadow masks, `rail_endings` (neighbour-dependent end caps), fence `ends`, and ramp slicing (the ramp is drawn whole, as one body).
- **Rail supports:** `graphics_set.structure`, a RotatedSprite with `back_equals_front`: 8 frames cover half a turn.
- **Rail signals and chain signals:** `ground_picture_set` or `elevated_picture_set`, chosen by the blueprint's `rail_layer`. Each draws the `rail_piece` (and `upper_rail_piece`), then the `structure`, in the passes their render layers name. The lookup tables `structure_align_to_animation_index` and `rail_piece.align_to_frame_index` have 12 entries per 16-way direction (one per rail shape beside the signal). The renderer uses the most common entry per direction (`indexByDirection`): the plain straight-rail case. The ground structure index is the direction; the elevated one has 25 frames. The structure's animation frame is the colour, and frame 0 is drawn (green for rail signals, none/red for chain signals). Elevated signals are drawn 3 tiles up. Lights are left out; circuit connectors are drawn only on wired signals (see § Wire connection points).
- **Train stops:** `rail_overlay_animations` on the ground, `animations` as the body, `top_animations` in `higher-object`. The top's runtime-tint mask uses the blueprint `color`, else the prototype's `color`.
- **Rolling stock:** drawn from the blueprint `orientation` (0–1, clockwise from north), not the snapped direction. Parts in order: two `wheels.rotated` bogies at ±`joint_distance` / 2 along the orientation, `pictures.rotated`, then (artillery wagon) `cannon_base_pictures.rotated` and `cannon_barrel_pictures.rotated` in the parked position. `sloped` sheets (ramps) are not used. Masks are tinted like train stops (locomotive default red, wagons brown).
- **Rotated sheet index from an orientation** (`apply_projection`, the default): the frames are evenly spaced around the 3D model, which the 45° view squashes vertically, so a screen orientation o is drawn with the model angle `atan2(sin 2πo, cos 2πo × √2)`. Confirmed by locomotives lying along diagonal rails (orientation 0.125 is frame 25 of 256, not 32). `back_equals_front` sheets cover half a turn (`index = round(θ × 2 × direction_count) mod direction_count`). `dice` only splits sprites for atlas packing and does not change frame rectangles.
- **Not yet handled:** signal colours from circuit state, the cargo wagon's door animation, rail endings, and the artillery cannon's `cannon_base_shift_*` and `cannon_base_height` (the parked cannon is drawn at its sprite shifts, which look plausible at low zoom but are not confirmed).

### Remaining types, mirroring, inserter hands and tiles

Implemented in M3 step 7d. DB format 5 adds `EntityProto.graphicsFlipped` and `PrototypeDb.tileGraphics`. Checked against the 2.1.25 dump (all 57,572 resolved layers of every covered prototype in 8 directions, flipped sets, shape pictures and all 153 tile sprites inside their PNGs) and in screenshots of the platform corpus strings, the mirrored refineries and a synthetic blueprint with every new type.

- **Space Age and remaining types.** `agricultural-tower` (graphics set; the crane is not drawn), `asteroid-collector` (`below_ground_pictures`, `below_arm_pictures`, then the per-direction `animation`; the arm is not drawn), `thruster` (`integration_patch` on the ground, then `animation`), `cargo-bay`, `space-platform-hub` and `cargo-landing-pad` (each `graphics_set.picture` entry in its own render layer, then the first `animation` frame), `fusion-reactor` (`structure`), `fusion-generator` (`<dir>_graphics_set.animation`), `lightning-attractor` (`chargable_graphics.picture`), `infinity-container`, `linked-container`, `proxy-container`, `electric-energy-interface`, `valve`, `land-mine` (`picture_set`), `market`, `simple-entity-with-force` and `car` (`animation` and `turret_animation` from the blueprint `orientation`, like rolling stock). The foundry, electromagnetic plant, cryogenic plant, biochamber, recycler and crusher already went through the crafting-machine extractor.
- **Loaders and linked belts** are belt ends like underground belts: `direction` is the flow direction for `type: "input"` and `"output"`, the structure is `structure.direction_in`, or `direction_out` resolved with the opposite facing. The straight belt lies on the belt side (the tail tile of an input loader, the head tile of an output loader; the whole tile for `loader-1x1` and `linked-belt`), with a start cap when nothing feeds an input and an end cap when nothing takes from an output. They feed belts and take from them in the belt rules (an input loader only from behind). The vanilla loaders are hidden editor entities, and their structure sprites are the game's own arrow placeholders.
- **Infinity pipes** use the pipe pieces and pipe rules.
- **`mirror: true`.** The game does not flip sprites. A prototype with `graphics_set_flipped` (in 2.1.25: `recycler`, `burner-mining-drill`, `pumpjack`) draws that set when mirrored. Every other mirrored entity (oil refinery, chemical plant, …) looks the same. Fluid boxes are flipped left to right in the north-facing entity before it is rotated: position `x → −x`, direction `d → −d`. That is the same as flipping the rotated connection across the entity's front-to-back axis, which also works for the pumpjack's per-facing `positions`. `FluidBox.mirrored_pipe_picture` belongs to pipe covers, which are not drawn yet.
- **Inserter hands.** An inserter's `direction` is the side it picks up from (confirmed in the 1.1 mall: requester chests are on the `direction` side, provider chests on the other side), so the pickup is `pickup_position` rotated by the direction. The resting pose has the hand over the pickup. The game draws the arm in 3D, so the screen poses are taken from the Factorio Blueprint Editor, per pickup side, with long-handed poses when the pickup is 1.5 tiles or more away (`inserter.ts`). `hand_base_picture` and then `hand_open_picture` are drawn from their bottom centre (anchor 0.5, 1), squashed vertically and rotated, in the `higher-object-under` pass, so hands draw over belts and machines. Hand shadows are not drawn.
- **Tiles** (`tiles.ts`, `PrototypeDb.tileGraphics`). A tile with `variants.material_background` (concrete, refined and hazard concrete, landfill, foundation, ice platform, Fulgora's ground) draws its square of one block: the texture holds `count` blocks of `material_texture_width_in_tiles` × `material_texture_height_in_tiles` tiles (default 8 × 8), `line_length` blocks per row (default all in one row). The block is chosen per 8 × 8 area of the blueprint. Otherwise the 1 × 1 entry of `variants.main` is used (stone path, space platform foundation), one of its `count` variations per tile, `line_length` per row. The game picks variations at random; the app uses a hash of the position, so the picture is stable. `*-dummy.png` mains are skipped. Transitions and edges between tiles are not drawn.
- **Not yet handled:** the agricultural tower crane, the asteroid collector arm, connections between cargo bays and hubs, cargo bay hatches, fusion reactor and generator connection graphics, thruster pipe connection overlays, spidertrons, tile transitions, and an "animate" toggle (M7).

### Wire connection points

Implemented in M3 step 7e (`src/core/prototypes/wires.ts` for the dump, `src/core/sprites/wires.ts` for the geometry). DB format 6 adds `EntityProto.wirePoints`. Checked against the 2.1.25 dump: every prototype that can be wired (it has `circuit_wire_max_distance`, `maximum_wire_distance` or `wire_max_distance`) has points, and every point of every prototype, in 16 directions, mirrored, elevated and per pole variation, lies within 3.5 tiles of the entity's edge (the highest is the big pole's copper, 3.8 tiles up). Screenshots of the nuclear plant, the provider station, the 1.1 mall, the elevated intersection and a synthetic blueprint showed the wire ends on the pole insulators, the combinator terminals, the power switch insulators and the circuit connector pins.

- **Fields.** Each `WireConnectionPoint` is `{ wire: { red?, green?, copper? }, shadow: { … } }`, offsets in tiles from the entity centre. Only `wire` is kept (wire shadows are not drawn).
  - `electric-pole`: `connection_points`, one per picture variation (4 in vanilla).
  - `arithmetic-`, `decider-` and `selector-combinator`: `input_connection_points` (connectors 1/2) and `output_connection_points` (3/4), 4 each.
  - `constant-combinator`: `circuit_wire_connection_points`, 4.
  - `power-switch`: `circuit_wire_connection_point` (1/2), `left_wire_connection_point` (copper, connector 5) and `right_wire_connection_point` (copper, 6).
  - `rail-signal` and `rail-chain-signal`: `ground_picture_set.circuit_connector` and `elevated_picture_set.circuit_connector`, one per structure frame (16 ground, 25 elevated). They are reordered to one per 16-way direction through the set's `structure_align_to_animation_index` (the most common entry per direction, as for the structure sprite; identity for the ground set). Elevated points are raised 3 tiles, like the structure.
  - Everything else: `circuit_connector`, one `CircuitConnectorDefinition` (`{ sprites, points }`) or a list, plus `circuit_connector_flipped` (used when the entity is mirrored) on furnaces, assemblers, mining drills and inserters that have one.
- **Which entry.** Lists of 1 use entry 0; of 4, `direction / 4` (N, E, S, W, as in the API's tuples); of 8, `direction / 2`; of 16, the 16-way direction. Exceptions (`WireIndexing`):
  - **Poles:** the picture variation (below).
  - **Transport belts:** 7 entries in the order X, H, V, SE, SW, NE, NW (`TransportBeltPrototype.circuit_connector`). Straight, start and end pieces take H (east/west) or V; curves take the corner they join (`east_to_north` joins the top and right edges: NE).
  - **Pipes, infinity pipes and heat pipes:** 16 entries in the order of the `ConnectableEntityGraphics` pictures (single, ending_up, ending_right, corner_right_up, …, cross), which is the bitmask of connected sides with up 1, right 2, down 4, left 8. The sides come from the pipe shape rules.
  - **Loaders:** 8 entries, the 4 directions for `direction_out` then the 4 for `direction_in`. An `input` loader takes the second half (unconfirmed: no wired loader in the corpus).
  - An index past the end of the list falls back to entry 0.
- **Pole variation.** The game picks a pole's picture from the directions of its wires. The rule is the Factorio Blueprint Editor's (`getPowerPoleRotation`), not confirmed in game: each wire partner's angle from the pole falls in one of four sectors, 45° wide and starting 67.5° clockwise from east counted clockwise (N–S 0, NE–SW 1, E–W 2, NW–SE 3), and the variation is the rounded-down mean of the sectors over all wires (each wire counts, whatever its colour). No wires: 0. Poles draw that variation (`GraphicsOptions.variation` picks the frame of `fixedRotation` parts), and their wires attach to the same entry, so wire ends meet the insulators.
- **Circuit connectors.** An entity with a red or green wire on connector 1 or 2 also draws the `sprites` of the same `CircuitConnectorDefinition`: `connector_shadow`, `wire_pins_shadow`, `connector_main` and `wire_pins`, in the definition's `render_layer` (inserters: `floor`). The LEDs are not drawn. Belts have only LEDs there (their frame belongs to the belt animation set, not drawn), so a wired belt's wires end in the air above it.
- **Without points** (no game data, or a prototype without the colour): a fixed offset from the centre per connector, turned with the 4-way facing. North-facing: red input (1) `[-0.2, 0.1]`, green input (2) `[0.2, 0.1]`, outputs (3/4) the same at `y = -0.3`, copper (5) `[0, -0.15]`, power switch right copper (6) `[0.3, -0.15]`. Red, green and copper never share a point, and combinator outputs are at the front.

Coverage is incremental, by prototype type:

| Priority | Types |
| --- | --- |
| P0 | `assembling-machine`, `furnace`, `container`, `logistic-container`, `inserter`, `transport-belt`, `underground-belt`, `splitter`, `pipe`, `pipe-to-ground`, `electric-pole`, `mining-drill`, `lab`, `beacon`, `boiler`, `generator`, `solar-panel`, `accumulator` |
| P1 | `straight-rail`/`curved-rail-a/b`/`half-diagonal-rail`, rail signals, `train-stop`, `roboport`, combinators, `lamp`, `pump`, `storage-tank`, `offshore-pump`, `wall`, `gate`, `turret`s |
| P2 | Space Age (`asteroid-collector`, `thruster`, `cargo-bay`, `space-platform-hub`, `fusion-reactor`, `agricultural-tower`, `foundry`, `electromagnetic-plant`, `cryogenic-plant`, `biochamber`, …), elevated rails, and remaining types. All drawn since M3 7d except `spider-vehicle` |
| Fallback | Footprint box + dumped icon, for any type without a resolver |

Belts, pipes and walls need **connection-aware** sprites: a belt's curve depends on its neighbours, and a pipe's shape depends on its connected fluid boxes. These resolvers take a neighbour query, not only the entity (see § Connection-aware sprites).

### Texture loading

- Load sprite sheets lazily, only those visible entities need. Keep an LRU of GPU textures with a memory budget. Implemented in `src/renderer/canvas/textures.ts`: 512 MB of decoded RGBA, evicting sheets not used in the current frame down to 80 %. A frame rectangle outside its image is treated as a failed layer (fallback), never drawn.
- Large sheets (for example 2048×2560 belts) are fine as single textures. Cut frames as sub-textures.
- Static frame by default (frame 0, or the idle frame). Optional "animate" toggle (M7).
- Icons: pack dumped icons into one atlas at cache-build time for fast UI and minimap use.

## Licensing note

Assets are read from the user's installation at runtime and only cached locally (the icon atlas and processed DB in `userData`). The app MUST NOT upload game assets anywhere, including to the agent. Tool results sent to the agent contain names and numbers, not images. The one optional exception is a rendered **screenshot** of the user's own blueprint, sent only when the user enables it (see [07](07-agent-acp.md)).
