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
- Both commands run headless and exit. They need no running game, but they **fail if the game is already running**. Detect that case and show "close Factorio and retry".
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

## Graphics

### Asset protocol

The main process registers `factorio-asset://` and maps:

```
factorio-asset://data/__base__/graphics/entity/…png   → <install>/data/base/graphics/entity/…png
factorio-asset://cache/icons/item/iron-plate.png       → <cache>/icons/item/iron-plate.png
```

Sprite paths in the dump look like `__base__/graphics/…`. The `__mod__` prefix maps to `data/<mod>` for built-in content and to the mod zip or folder for third-party mods. (Serving files from inside mod zips needs a zip reader in the main process: M7.)

### Sprite definitions

The dump gives each sprite as `filename`, `width`, `height`, `x`, `y`, `scale`, `shift`, `frame_count`, `line_length`, `direction_count`, and either `layers` or `stripes`. Since 2.0, every graphic is high resolution with `scale = 0.5` (64 px per tile at scale 1). In 2.1, many sheets also have a `.lua` sidecar next to the `.png` (for example `assembling-machine-1-base.lua` → `{ width, height, shift, line_length }`). The dump already includes those values, so the sidecars need no parsing.

The renderer's `SpriteResolver` maps `(entity prototype, direction, variant)` to a list of layers `{ texture, frame rect, offset, scale, tint, blendMode, isShadow }`. Coverage is incremental, by prototype type:

| Priority | Types |
| --- | --- |
| P0 | `assembling-machine`, `furnace`, `container`, `logistic-container`, `inserter`, `transport-belt`, `underground-belt`, `splitter`, `pipe`, `pipe-to-ground`, `electric-pole`, `mining-drill`, `lab`, `beacon`, `boiler`, `generator`, `solar-panel`, `accumulator` |
| P1 | `straight-rail`/`curved-rail-a/b`/`half-diagonal-rail`, rail signals, `train-stop`, `roboport`, combinators, `lamp`, `pump`, `storage-tank`, `offshore-pump`, `wall`, `gate`, `turret`s |
| P2 | Space Age (`asteroid-collector`, `thruster`, `cargo-bay`, `space-platform-hub`, `fusion-reactor`, `agricultural-tower`, `foundry`, `electromagnetic-plant`, `cryogenic-plant`, `biochamber`, …), elevated rails, and remaining types |
| Fallback | Footprint box + dumped icon, for any type without a resolver |

Belts and pipes need **connection-aware** sprites: a belt's curve depends on its neighbours, and a pipe's shape depends on its connected fluid boxes. These resolvers take a neighbour query, not only the entity.

### Texture loading

- Load sprite sheets lazily, only those visible entities need. Keep an LRU of GPU textures with a memory budget.
- Large sheets (for example 2048×2560 belts) are fine as single textures. Cut frames as sub-textures.
- Static frame by default (frame 0, or the idle frame). Optional "animate" toggle (M7).
- Icons: pack dumped icons into one atlas at cache-build time for fast UI and minimap use.

## Licensing note

Assets are read from the user's installation at runtime and only cached locally (the icon atlas and processed DB in `userData`). The app MUST NOT upload game assets anywhere, including to the agent. Tool results sent to the agent contain names and numbers, not images. The one optional exception is a rendered **screenshot** of the user's own blueprint, sent only when the user enables it (see [07](07-agent-acp.md)).
