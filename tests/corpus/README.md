# Blueprint corpus

Real blueprint strings used for round-trip and migration tests.

- One string per file, no trailing newline. `.gitattributes` marks these files `-text -diff`, so Git never rewrites line endings and does not try to diff them.
- Vanilla 2.x strings sit at the top level. Strings from 1.1 go in [`legacy-1.1/`](legacy-1.1/). Strings that need mods go in [`modded/`](modded/).
- Commit only strings you made yourself or may share. Record the source of every file below.
- "Exercises" lists the format features each file covers, so gaps are easy to spot.

## 2.x strings

All exported from Factorio **2.1.25** (`version` 562954250027018 = 2.1.25.10). All use the base game plus Space Age, Quality and Elevated Rails. Added by the repo owner. All are publicly shared designs. Credits found in descriptions are noted per file.

| File | Root | Contents | Exercises |
| --- | --- | --- | --- |
| [roboport.txt](roboport.txt) | blueprint | One roboport with 8 big electric poles around it. 9 entities. | Copper wires (connector 5), `snap-to-grid` + `absolute-snapping` + `position-relative-to-grid`, roboport `control_behavior` and `request_filters`. Only whole-number positions. Smallest file: a good first test. |
| [4_4_tu_balancer.txt](4_4_tu_balancer.txt) | blueprint | Throughput-unlimited 4→4 balancer with fast belts. 32 entities. | Splitters, undergrounds (`type: input/output`), the 4 cardinal directions, multi-line `description`. |
| [train_signals_1in_lt3out.txt](train_signals_1in_lt3out.txt) | blueprint | Rail-signal layout for a junction with 1 entry and fewer than 3 exits. 47 entities. | Ground rails (`straight-rail`, `curved-rail-a/b`), rail chain signals, **8-way diagonal directions** (2, 6, 10, 14), red, green and copper wires on poles. |
| [rail_single_ramp.txt](rail_single_ramp.txt) | blueprint | Elevated rail on a single ramp down to ground level. 134 entities. | Elevated rails, `rail-support`, `rail_layer`, **16-way odd directions** (3, 5, 11, 13), mixed ground and elevated curved rails. |
| [elevated_rail_intersection.txt](elevated_rail_intersection.txt) | blueprint | Elevated rail intersection. 221 entities. | All 16 directions, including 1, 7, 9 and 15. `elevated-curved-rail-a/b`, 36 chain signals, `rail_layer`. |
| [provider_station.txt](provider_station.txt) | blueprint | Train provider station: 24 passive provider chests, 48 stack inserters, a circuit network for stack counting, display panel, speakers. 112 entities. | **Parametrised blueprint** (`parameters`), dense red and green circuit wires including combinator outputs (connectors 1–4), train stop (`station`, `player_description`, `show_in_chart`), inserter `filters` / `use_filters`, `programmable-speaker` alert parameters. |
| [requester_station.txt](requester_station.txt) | blueprint | Train requester station: 24 storage chests, 48 stack inserters, combinators, display panel. 101 entities. | Rich text in `label` (`[item=requester-chest]`). Similar wiring to the provider, plus a wire on train stop connector 2 (green). Pairs with the provider for diff tests. |
| [2.4GW_nuclear.txt](2.4GW_nuclear.txt) | blueprint | Tileable 2.4 GW nuclear plant: reactors, 240 heat exchangers, 412 turbines, heat pipes, pipes, lamps and combinator control. **3,796 entities and 13,973 tiles. 1.0 MB JSON.** | Performance test for the canvas and analysis. Many tiles. Lamp `color`. Storage-tank and requester-chest circuit wires. `override_stack_size`. Rich text and colour in `label` (`[color=…]`, emoji). Third-party design: the description credits **Ferront**. |
| [balancer_book.txt](balancer_book.txt) | blueprint_book | A large belt-balancer book: 1→X up to 20→15 balancers, lane balancers, 32/64/128-lane monsters, and a "Bonus" book of 26 upgrade planners. **134 blueprints, 26 upgrade planners, 2.2 MB JSON.** | Nested books (2 levels). **Sparse indexes** (for example a sub-book with slots 0, 1, 6, 7, 12…, and top-level indexes jumping from 12 to 16). `active_index`. Upgrade planners with rich-text labels. Splitter `input_priority` / `output_priority` / `filter`. The `128_128_balancer` (8,512 entities) is a stress test. Community-collected book. Some descriptions credit their designers (for example "Ytterby"). |
| [station_provider_with_quality.txt](station_provider_with_quality.txt) | blueprint | The provider station again, with 24 **legendary** passive provider chests and bulk inserters instead of stack inserters. 112 entities. | **Entity `quality`** (`"legendary"`). **No `label`** (the key is absent). Same wiring as `provider_station.txt`, so the pair is a ready-made diff test (entity swap plus quality change). |
| [quality_assembler.txt](quality_assembler.txt) | blueprint | A parametrised "any quality item" assembler cell: 3 assembling machine 3s with quality modules, inserters that filter by quality, express belts, requester and provider chests. 28 entities. | **2.x insert plans** (`items: [{ id: { name }, items: { in_inventory: [{ inventory, stack }] } }]`), `recipe_quality`, **quality filters** (`{ index, quality, comparator }` with `filter_mode: "blacklist"`), parameters with `quality-condition` and `ingredient-of`, wires on connector 2 only. |
| [mirrored_oil_refineries.txt](mirrored_oil_refineries.txt) | blueprint | 6 oil refineries (advanced oil processing) with their piping. 3 of them are mirrored. 123 entities. | **`mirror: true`**, with no `direction` on the mirrored refineries (so north is implied), `recipe` + `recipe_quality`, many pipes and pipe-to-ground (fluid connection rendering), copper wires only. |
| [space_science_platform.txt](space_science_platform.txt) | blueprint | Space platform that makes space science: hub, 3 asteroid collectors, crushers, furnaces, assemblers, solar, express belts. 200 entities, 529 tiles. | **Space platform**: `space-platform-hub` (`request_missing_construction_materials`, `providing_to_other_platforms`), asteroid collector `result-inventory`, `space-platform-foundation` tiles, splitter priorities, inserter filters. No wires. |
| [transport_space_platform.txt](transport_space_platform.txt) | blueprint | Space transport platform with thrusters, fuel and oxidizer production (chemical plants, storage tanks), cargo bays, gun turrets, asteroid collectors and crushers. 635 entities, 2,135 tiles. | **2.x `schedules`** on a platform: `locomotives: [hub entity_number]`, records with `wait_conditions` (circuit, `all_requests_satisfied`, inactivity, item count with fluid and item signals). Asteroid collector **`chunk-filter`**, `"result-inventory": null` (**JSON `null` must round-trip**), `thruster`, `cargo-bay`, `crusher`, insert plans for modules, circuit wires on the hub, crushers, chemical plants and tanks. |
| [destruction_planner.txt](destruction_planner.txt) | deconstruction_planner | Unlabelled deconstruction planner with an entity filter list (bulk inserters, fast belts and splitters, combinators, …). | **Deconstruction planner root**, `entity_filters` with `index`, no `label`. |
| [destruction_planner_finished_miners.txt](destruction_planner_finished_miners.txt) | deconstruction_planner | "Finished Miners": removes depleted mining drills. | Filter on the special `depleted-mining-drill-proxy`, filter `quality` + `comparator`, `tile_selection_mode`. |
| [destruction_planner_items_on_ground.txt](destruction_planner_items_on_ground.txt) | deconstruction_planner | "Items on Ground": picks up items lying on the ground. | Filter on the special `item-on-ground` entity, `tile_selection_mode`. |
| [destruction_book.txt](destruction_book.txt) | blueprint_book | Unlabelled book of 23 deconstruction planners: trains, elevated and low rails, rail signals, walls, trees/rocks, finished miners, tiles, items on ground, and more. | **Deconstruction planners inside a book**, sparse indexes (5, 17 and 23 empty), `active_index` 18, book with no `label`. Planner settings: `tile_filters`, `tile_filter_mode`, `tile_selection_mode`, `trees_and_rocks_only`, `entity_filter_mode`, planner `icons`. Tree filters include Space Age planet trees. |
| [upgrade_planner.txt](upgrade_planner.txt) | upgrade_planner | Unlabelled planner that downgrades fast and bulk inserters to basic inserters. | **Standalone upgrade planner root**. `mappers` with sparse `index` (0 and 4), `from` with `quality` + `comparator`, `to` without quality. |
| [upgrade_book.txt](upgrade_book.txt) | blueprint_book | "Upgrade planners": 14 planners for poles, assemblers, chests, every belt tier and inserters. | Book of upgrade planners only, sparse indexes, rich-text labels (`[item=…]`), planner `icons`. |
| [train_with_schedule.txt](train_with_schedule.txt) | blueprint | "Solid Train": a locomotive and 2 cargo wagons with a schedule. 3 entities. | **Rolling stock**: `orientation` (a float, not `direction`), off-grid positions (`45.5625`), locomotive `color` with float32 noise (`0.949999988079071`, which must round-trip exactly), fuel insert plan (`nuclear-fuel` in inventory 1), `"inventory": null`. **`stock_connections`** (`stock` / `front` / `back`). Train **`schedules`** with `group` and **`interrupts`** (fuel conditions). |
| [empty_book.txt](empty_book.txt) | blueprint_book | An empty blueprint book. | `blueprints: []` with `active_index` 0 and no label. The smallest valid envelope. The book tree, analysis and export must handle it. (An empty *blueprint* cannot be exported from the game.) |

## Legacy 1.1 strings ([`legacy-1.1/`](legacy-1.1/))

These come from [factorioprints.com](https://factorioprints.com), fetched on 2026-11-27 from its public API. They are publicly shared there. The authors are identified only by their factorioprints user id. They are vanilla 1.1 designs used to test the 1.1 → 2.x migration (spec 02 § Version handling). None of them use the top-level `wires` array. All wiring is in per-entity `connections` / `neighbours`.

**[`legacy-1.1/upgraded/`](legacy-1.1/upgraded/)** holds the same three strings after the repo owner imported them into Factorio 2.1.25 and exported them again (same file names). They are the reference for the migration (`tests/unit/migrate-oracle.test.ts`) and also count as 2.x test data.
- Importing the outpost book showed an error (no details given): the game deleted the entities that reference 0.14-era item names (`uranium-rifle-magazine`, `armor-piercing-rifle-magazine`).
- In the rocket book, the game deleted the 80 assemblers using the removed `rocket-control-unit` recipe and the 80 combinators comparing against it.
- In both books, it dropped copper wires that are longer than the poles' reach.

| File | Root | Source | Contents | Exercises |
| --- | --- | --- | --- | --- |
| [mall_starter_factory.txt](legacy-1.1/mall_starter_factory.txt) | blueprint | [The Mall (Starter Factory)](https://factorioprints.com/view/-MAxCCwr8H65ISgExaHZ) | Early-to-mid game mall. **4,531 entities, 1,592 tiles.** Exported from 1.1.34. | 8-way directions, `filter-inserter`, `logistic-chest-*` names, per-entity circuit `connections`, `power-switch`, tiles (concrete, stone brick). |
| [outpost_station_book.txt](legacy-1.1/outpost_station_book.txt) | blueprint_book | [Outpost Station v1.9](https://factorioprints.com/view/-MGH-tukFY2V1ew-XmiN) | Defended train outpost stations (left- and right-hand), a logistic station and wall/turret defences. 7 blueprints. Exported from 1.1.104. | **Train `schedules`** with locomotives and wagons, old `items` map format (`"items":{…}`), `stack-filter-inserter`, `effectivity-module`, old rail names (`straight-rail` / `curved-rail` 1.1 geometry), `programmable-speaker`, artillery. Tagged "mods/other" on the site, but uses only vanilla entities. |
| [self_building_rocket_book.txt](legacy-1.1/self_building_rocket_book.txt) | blueprint_book | [Self-Building Rocket](https://factorioprints.com/view/-MGvN8qrxpCMbXJJn3Gh) | 7-step self-expanding base, from burner mining to a rocket silo, plus helpers. 16 blueprints and 2 upgrade planners. **The Step 7 blueprint has 16,937 entities.** Exported from 1.1.107. | 1.1 upgrade planners, sparse book index (16 missing), `rocket-control-unit` (removed in 2.0), beacons with modules (old `items` map), `snap-to-grid`. Large-file performance. |

## Modded strings ([`modded/`](modded/))

These come from [factorioprints.com](https://factorioprints.com), fetched on 2026-11-27, and are publicly shared there. They contain entities that are **not** in the vanilla PrototypeDb. Use them to test unknown-prototype handling (fallback rendering, the `unknown-prototype` warning, and lossless round-trip of unknown entities).

| File | Root | Source | Contents | Exercises |
| --- | --- | --- | --- | --- |
| [pyanodons_sand.txt](modded/pyanodons_sand.txt) | blueprint | [sand 30/s (Py)](https://factorioprints.com/view/-OxwYnaFpCT2JsMiCkvx), made by cameron274 | Pyanodons sand production: 45 soil extractors, 12 washers, belts, pipes. 542 entities. Exported from 2.0.77. | **Mostly modded**: `soil-extractor-mk01`, `washer`, `nexelit-power-pole`, `py-overflow-valve`, `py-sinkhole`. Circuit and copper wires on modded poles. A 2.0 version stamp (older than the 2.1 corpus). |
| [krastorio2_vulcanus_rocket_fuel.txt](modded/krastorio2_vulcanus_rocket_fuel.txt) | blueprint | [Vulcanus Rocket Fuel](https://factorioprints.com/view/-P49e7jwZAdXAlM6NzGu) | Krastorio 2 + Space Age rocket fuel on Vulcanus, 5/s. 841 entities. Exported from 2.0.77. | **Mixed vanilla and modded**: Space Age turbo belts and vanilla refineries next to `kr-fuel-refinery`, `kr-electrolysis-plant` and `kr-steel-pipe` (442 modded pipes, so the renderer fallback must stay fast). Display panels. |

## Coverage gaps

- [x] Deconstruction planners: standalone, in a book, and with tile and tree filters
- [x] Upgrade planners: standalone and in books
- [x] Entities with `quality` other than normal, and `recipe_quality`
- [x] `mirror: true`
- [x] Space platform blueprint (hub, asteroid collectors, crushers, thrusters, cargo bays)
- [x] 2.x insert plans for modules and fuel. Still missing: ammo.
- [x] 2.x `schedules` (platform and train, including interrupts) and `stock_connections`
- [x] An empty book. An empty blueprint cannot be exported from the game.
- [x] Modded blueprints (Pyanodons, Krastorio 2)
- [ ] Space Age planet production (foundry, electromagnetic plant, cryogenic plant, biochamber, agricultural tower). Only a `recycler` is present so far (in `quality_assembler.txt`).
- [x] Power switch wiring in 2.x: connectors 5 (left) and 6 (right), confirmed through `legacy-1.1/upgraded/mall_starter_factory.txt`
