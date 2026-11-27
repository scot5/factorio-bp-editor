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
- **Not yet handled:** `mirror` (flipped sprites and fluid boxes), neighbour-dependent shapes (belts, pipes, walls beyond the single piece, rails), rolling stock and the remaining types. These are the next steps (see `docs/plan/remaining-work.md`).

Coverage is incremental, by prototype type:

| Priority | Types |
| --- | --- |
| P0 | `assembling-machine`, `furnace`, `container`, `logistic-container`, `inserter`, `transport-belt`, `underground-belt`, `splitter`, `pipe`, `pipe-to-ground`, `electric-pole`, `mining-drill`, `lab`, `beacon`, `boiler`, `generator`, `solar-panel`, `accumulator` |
| P1 | `straight-rail`/`curved-rail-a/b`/`half-diagonal-rail`, rail signals, `train-stop`, `roboport`, combinators, `lamp`, `pump`, `storage-tank`, `offshore-pump`, `wall`, `gate`, `turret`s |
| P2 | Space Age (`asteroid-collector`, `thruster`, `cargo-bay`, `space-platform-hub`, `fusion-reactor`, `agricultural-tower`, `foundry`, `electromagnetic-plant`, `cryogenic-plant`, `biochamber`, …), elevated rails, and remaining types |
| Fallback | Footprint box + dumped icon, for any type without a resolver |

Belts and pipes need **connection-aware** sprites: a belt's curve depends on its neighbours, and a pipe's shape depends on its connected fluid boxes. These resolvers take a neighbour query, not only the entity.

### Texture loading

- Load sprite sheets lazily, only those visible entities need. Keep an LRU of GPU textures with a memory budget. Implemented in `src/renderer/canvas/textures.ts`: 512 MB of decoded RGBA, evicting sheets not used in the current frame down to 80 %. A frame rectangle outside its image is treated as a failed layer (fallback), never drawn.
- Large sheets (for example 2048×2560 belts) are fine as single textures. Cut frames as sub-textures.
- Static frame by default (frame 0, or the idle frame). Optional "animate" toggle (M7).
- Icons: pack dumped icons into one atlas at cache-build time for fast UI and minimap use.

## Licensing note

Assets are read from the user's installation at runtime and only cached locally (the icon atlas and processed DB in `userData`). The app MUST NOT upload game assets anywhere, including to the agent. Tool results sent to the agent contain names and numbers, not images. The one optional exception is a rendered **screenshot** of the user's own blueprint, sent only when the user enables it (see [07](07-agent-acp.md)).
