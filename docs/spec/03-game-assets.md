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
- **Not yet handled:** `mirror` (flipped sprites and fluid boxes), loaders, pipe covers on machines, and the remaining types (M3 7d). Rails, signals, train stops and rolling stock: see § Rails, signals and rolling stock.

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
- **Rail signals and chain signals:** `ground_picture_set` or `elevated_picture_set`, chosen by the blueprint's `rail_layer`. Each draws the `rail_piece` (and `upper_rail_piece`), then the `structure`, in the passes their render layers name. The lookup tables `structure_align_to_animation_index` and `rail_piece.align_to_frame_index` have 12 entries per 16-way direction (one per rail shape beside the signal). The renderer uses the most common entry per direction (`indexByDirection`): the plain straight-rail case. The ground structure index is the direction; the elevated one has 25 frames. The structure's animation frame is the colour, and frame 0 is drawn (green for rail signals, none/red for chain signals). Elevated signals are drawn 3 tiles up. Lights and circuit connectors are left out.
- **Train stops:** `rail_overlay_animations` on the ground, `animations` as the body, `top_animations` in `higher-object`. The top's runtime-tint mask uses the blueprint `color`, else the prototype's `color`.
- **Rolling stock:** drawn from the blueprint `orientation` (0–1, clockwise from north), not the snapped direction. Parts in order: two `wheels.rotated` bogies at ±`joint_distance` / 2 along the orientation, `pictures.rotated`, then (artillery wagon) `cannon_base_pictures.rotated` and `cannon_barrel_pictures.rotated` in the parked position. `sloped` sheets (ramps) are not used. Masks are tinted like train stops (locomotive default red, wagons brown).
- **Rotated sheet index from an orientation** (`apply_projection`, the default): the frames are evenly spaced around the 3D model, which the 45° view squashes vertically, so a screen orientation o is drawn with the model angle `atan2(sin 2πo, cos 2πo × √2)`. Confirmed by locomotives lying along diagonal rails (orientation 0.125 is frame 25 of 256, not 32). `back_equals_front` sheets cover half a turn (`index = round(θ × 2 × direction_count) mod direction_count`). `dice` only splits sprites for atlas packing and does not change frame rectangles.
- **Not yet handled:** signal colours from circuit state, the cargo wagon's door animation, rail endings, and the artillery cannon's `cannon_base_shift_*` and `cannon_base_height` (the parked cannon is drawn at its sprite shifts, which look plausible at low zoom but are not confirmed).

Coverage is incremental, by prototype type:

| Priority | Types |
| --- | --- |
| P0 | `assembling-machine`, `furnace`, `container`, `logistic-container`, `inserter`, `transport-belt`, `underground-belt`, `splitter`, `pipe`, `pipe-to-ground`, `electric-pole`, `mining-drill`, `lab`, `beacon`, `boiler`, `generator`, `solar-panel`, `accumulator` |
| P1 | `straight-rail`/`curved-rail-a/b`/`half-diagonal-rail`, rail signals, `train-stop`, `roboport`, combinators, `lamp`, `pump`, `storage-tank`, `offshore-pump`, `wall`, `gate`, `turret`s |
| P2 | Space Age (`asteroid-collector`, `thruster`, `cargo-bay`, `space-platform-hub`, `fusion-reactor`, `agricultural-tower`, `foundry`, `electromagnetic-plant`, `cryogenic-plant`, `biochamber`, …), elevated rails, and remaining types |
| Fallback | Footprint box + dumped icon, for any type without a resolver |

Belts, pipes and walls need **connection-aware** sprites: a belt's curve depends on its neighbours, and a pipe's shape depends on its connected fluid boxes. These resolvers take a neighbour query, not only the entity (see § Connection-aware sprites).

### Texture loading

- Load sprite sheets lazily, only those visible entities need. Keep an LRU of GPU textures with a memory budget. Implemented in `src/renderer/canvas/textures.ts`: 512 MB of decoded RGBA, evicting sheets not used in the current frame down to 80 %. A frame rectangle outside its image is treated as a failed layer (fallback), never drawn.
- Large sheets (for example 2048×2560 belts) are fine as single textures. Cut frames as sub-textures.
- Static frame by default (frame 0, or the idle frame). Optional "animate" toggle (M7).
- Icons: pack dumped icons into one atlas at cache-build time for fast UI and minimap use.

## Licensing note

Assets are read from the user's installation at runtime and only cached locally (the icon atlas and processed DB in `userData`). The app MUST NOT upload game assets anywhere, including to the agent. Tool results sent to the agent contain names and numbers, not images. The one optional exception is a rendered **screenshot** of the user's own blueprint, sent only when the user enables it (see [07](07-agent-acp.md)).
