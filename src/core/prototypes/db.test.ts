import { describe, expect, it } from 'vitest'
import {
  buildPrototypeDb,
  dbPrototypeLookup,
  DB_FORMAT_VERSION,
  displayName,
  iconCategoryFor
} from './db'

// A tiny excerpt in the shape of data-raw-dump.json.
const raw = {
  'assembling-machine': {
    'assembling-machine-2': {
      type: 'assembling-machine',
      name: 'assembling-machine-2',
      collision_box: [
        [-1.2, -1.2],
        [1.2, 1.2]
      ],
      selection_box: [
        [-1.5, -1.5],
        [1.5, 1.5]
      ]
    }
  },
  splitter: {
    splitter: {
      type: 'splitter',
      name: 'splitter',
      collision_box: [
        { x: -0.9, y: -0.4 },
        { x: 0.9, y: 0.4 }
      ]
    }
  },
  container: {
    'wooden-chest': {
      type: 'container',
      name: 'wooden-chest',
      collision_box: [
        [-0.35, -0.35],
        [0.35, 0.35]
      ],
      picture: {
        layers: [
          {
            filename: '__base__/graphics/entity/wooden-chest/wooden-chest.png',
            priority: 'extra-high',
            width: 62,
            height: 72,
            shift: [0.015625, -0.0625],
            scale: 0.5
          }
        ]
      },
      open_sound: { filename: '__base__/sound/open.ogg' }
    }
  },
  corpse: {
    'assembling-machine-2-remnants': {
      name: 'assembling-machine-2-remnants',
      collision_box: [
        [-1, -1],
        [1, 1]
      ]
    }
  },
  item: {
    'iron-plate': { name: 'iron-plate', stack_size: 100, subgroup: 'raw-material', order: 'a' },
    'assembling-machine-2': {
      name: 'assembling-machine-2',
      stack_size: 50,
      place_result: 'assembling-machine-2'
    }
  },
  module: { 'speed-module': { name: 'speed-module', stack_size: 50 } },
  recipe: {
    'iron-gear-wheel': {
      name: 'iron-gear-wheel',
      ingredients: [{ type: 'item', name: 'iron-plate', amount: 2 }],
      results: [{ type: 'item', name: 'iron-gear-wheel', amount: 1 }]
    },
    'basic-oil-processing': {
      name: 'basic-oil-processing',
      category: 'oil-processing',
      energy_required: 5,
      ingredients: [{ type: 'fluid', name: 'crude-oil', amount: 100 }],
      results: [{ type: 'fluid', name: 'petroleum-gas', amount: 45 }]
    },
    legacy: { name: 'legacy', ingredients: [['iron-plate', 3]], results: [] }
  },
  fluid: { water: { name: 'water' }, 'crude-oil': { name: 'crude-oil' } },
  'virtual-signal': { 'signal-A': { name: 'signal-A' } },
  quality: {
    normal: { name: 'normal', level: 0, color: { r: 0.7, g: 0.7, b: 0.7 } },
    rare: { name: 'rare', level: 2, color: [17, 115, 242] }
  },
  tile: { concrete: { name: 'concrete' } },
  'train-stop': {
    'train-stop': {
      name: 'train-stop',
      collision_box: [
        [-0.5, -0.5],
        [0.5, 0.5]
      ],
      tile_width: 2,
      tile_height: 2,
      color: [0.95, 0, 0, 1]
    }
  }
}

describe('buildPrototypeDb', () => {
  const db = buildPrototypeDb(raw as never, {
    gameVersion: '2.1.25',
    mods: [{ name: 'base', version: '2.1.25' }]
  })

  it('reads planets with their solar power', () => {
    const withPlanets = buildPrototypeDb(
      {
        'surface-property': { 'solar-power': { name: 'solar-power', default_value: 100 } },
        planet: {
          nauvis: {
            name: 'nauvis',
            surface_properties: { 'day-night-cycle': 25200 },
            solar_power_in_space: 300
          },
          aquilo: {
            name: 'aquilo',
            surface_properties: { 'solar-power': 1 },
            solar_power_in_space: 60
          },
          edge: { name: 'edge' }
        }
      } as never,
      { gameVersion: '2.1.25', mods: [] }
    )
    expect(withPlanets.planets).toEqual({
      nauvis: {
        solarPower: 100,
        solarPowerInSpace: 300,
        properties: { 'day-night-cycle': 25200 }
      },
      aquilo: { solarPower: 1, solarPowerInSpace: 60, properties: { 'solar-power': 1 } },
      edge: { solarPower: 100 }
    })
  })

  it('reads surface property defaults and the space platform surface', () => {
    const withSurfaces = buildPrototypeDb(
      {
        'surface-property': {
          pressure: { name: 'pressure', default_value: 1000 },
          gravity: { name: 'gravity', default_value: 10 }
        },
        surface: {
          'space-platform': {
            name: 'space-platform',
            surface_properties: { gravity: 0, pressure: 0, label: 'not a number' }
          }
        }
      } as never,
      { gameVersion: '2.1.25', mods: [] }
    )
    expect(withSurfaces.surfaces).toEqual({
      defaults: { pressure: 1000, gravity: 10 },
      platform: { gravity: 0, pressure: 0 }
    })
    expect(db.surfaces).toEqual({ defaults: {}, platform: {} })
  })

  it('reads resources with their mining products', () => {
    const withResources = buildPrototypeDb(
      {
        resource: {
          'iron-ore': {
            name: 'iron-ore',
            collision_box: [
              [-0.1, -0.1],
              [0.1, 0.1]
            ],
            minable: { mining_time: 1, result: 'iron-ore' }
          },
          'uranium-ore': {
            name: 'uranium-ore',
            minable: {
              mining_time: 2,
              result: 'uranium-ore',
              count: 2,
              fluid_amount: 10,
              required_fluid: 'sulfuric-acid'
            }
          },
          'crude-oil': {
            name: 'crude-oil',
            category: 'basic-fluid',
            infinite: true,
            minable: { mining_time: 1, results: [{ type: 'fluid', name: 'crude-oil', amount: 10 }] }
          },
          rock: { name: 'rock' }
        }
      } as never,
      { gameVersion: '2.1.25', mods: [] }
    )
    expect(withResources.resources).toEqual({
      'iron-ore': {
        category: 'basic-solid',
        miningTime: 1,
        results: [{ type: 'item', name: 'iron-ore', amount: 1 }]
      },
      'uranium-ore': {
        category: 'basic-solid',
        miningTime: 2,
        results: [{ type: 'item', name: 'uranium-ore', amount: 2 }],
        requiredFluid: 'sulfuric-acid',
        fluidAmount: 10
      },
      'crude-oil': {
        category: 'basic-fluid',
        miningTime: 1,
        results: [{ type: 'fluid', name: 'crude-oil', amount: 10 }],
        infinite: true
      }
    })
  })

  it('records metadata', () => {
    expect(db.formatVersion).toBe(DB_FORMAT_VERSION)
    expect(db.gameVersion).toBe('2.1.25')
    expect(db.mods).toEqual([{ name: 'base', version: '2.1.25' }])
  })

  it('keeps blueprintable entities with sizes and boxes, in both vector notations', () => {
    expect(db.entities['assembling-machine-2']).toMatchObject({
      type: 'assembling-machine',
      width: 3,
      height: 3,
      collisionBox: [
        [-1.2, -1.2],
        [1.2, 1.2]
      ],
      selectionBox: [
        [-1.5, -1.5],
        [1.5, 1.5]
      ]
    })
    expect(db.entities['splitter']).toMatchObject({ width: 2, height: 1 })
    expect(db.entities['assembling-machine-2-remnants']).toBeUndefined()
  })

  it('keeps the default mask colour of train stops and rolling stock', () => {
    expect(db.entities['train-stop']!.color).toEqual([0.95, 0, 0, 1])
    expect(db.entities['assembling-machine-2']!.color).toBeUndefined()
  })

  it('stores normalised graphics for covered types only', () => {
    expect(db.entities['wooden-chest']!.graphics).toEqual([
      {
        node: {
          kind: 'sprite',
          file: '__base__/graphics/entity/wooden-chest/wooden-chest.png',
          width: 62,
          height: 72,
          shift: [0.015625, -0.0625],
          scale: 0.5
        }
      }
    ])
    expect(db.entities['splitter']!.graphics).toBeUndefined()
  })

  it('collects items of every item type', () => {
    expect(db.items['iron-plate']).toEqual({
      type: 'item',
      stackSize: 100,
      subgroup: 'raw-material',
      order: 'a'
    })
    expect(db.items['assembling-machine-2']!.placeResult).toBe('assembling-machine-2')
    expect(db.items['speed-module']!.type).toBe('module')
  })

  it('normalises recipes, with defaults and the short ingredient form', () => {
    expect(db.recipes['iron-gear-wheel']).toEqual({
      categories: ['crafting'],
      energy: 0.5,
      ingredients: [{ type: 'item', name: 'iron-plate', amount: 2 }],
      results: [{ type: 'item', name: 'iron-gear-wheel', amount: 1 }]
    })
    expect(db.recipes['basic-oil-processing']!.ingredients[0]!.type).toBe('fluid')
    // 1.x / 2.0 `category`.
    expect(db.recipes['basic-oil-processing']!.categories).toEqual(['oil-processing'])
    expect(db.recipes['legacy']!.ingredients).toEqual([
      { type: 'item', name: 'iron-plate', amount: 3 }
    ])
  })

  it('reads 2.1 recipe fields: categories, probabilities, productivity, surface conditions', () => {
    const r = buildPrototypeDb(
      {
        recipe: {
          crushing: {
            name: 'crushing',
            categories: ['crushing'],
            energy_required: 2,
            ingredients: [{ type: 'item', name: 'chunk', amount: 1, ignored_by_stats: 1 }],
            results: [
              { type: 'item', name: 'iron-ore', amount: 20 },
              {
                type: 'item',
                name: 'chunk',
                amount: 1,
                independent_probability: 0.3,
                ignored_by_stats: 1
              }
            ],
            allow_productivity: true
          },
          uranium: {
            name: 'uranium',
            categories: ['centrifuging'],
            ingredients: [{ type: 'item', name: 'uranium-ore', amount: 10 }],
            results: [
              { type: 'item', name: 'u235', amount: 1, shared_probability: { min: 0, max: 0.25 } },
              { type: 'item', name: 'u238', amount: 1, shared_probability: { min: 0.25, max: 1 } }
            ]
          },
          kovarex: {
            name: 'kovarex',
            results: [
              {
                type: 'item',
                name: 'u235',
                amount: 41,
                ignored_by_stats: 40,
                ignored_by_productivity: 40
              }
            ],
            maximum_productivity: 0.5,
            surface_conditions: [
              { property: 'pressure', min: 2000, max: 2000 },
              { property: 'gravity', max: 0 },
              {}
            ]
          },
          recycling: {
            name: 'recycling',
            hidden: true,
            results: [{ type: 'item', name: 'iron-plate', amount: 0, extra_count_fraction: 0.5 }]
          },
          'parameter-0': {
            name: 'parameter-0',
            categories: ['parameters'],
            parameter: true,
            results: {}
          },
          ranged: {
            name: 'ranged',
            results: [
              { type: 'item', name: 'gear', amount_min: 1, amount_max: 4, probability: 0.5 }
            ]
          }
        }
      } as never,
      { gameVersion: '2.1.25', mods: [] }
    ).recipes
    expect(r['crushing']).toEqual({
      categories: ['crushing'],
      energy: 2,
      ingredients: [{ type: 'item', name: 'chunk', amount: 1 }],
      results: [
        { type: 'item', name: 'iron-ore', amount: 20 },
        { type: 'item', name: 'chunk', amount: 1, probability: 0.3, ignoredByProductivity: 1 }
      ],
      allowProductivity: true
    })
    expect(r['uranium']!.results.map((p) => p.probability)).toEqual([0.25, 0.75])
    expect(r['uranium']!.allowProductivity).toBeUndefined()
    expect(r['kovarex']).toMatchObject({
      categories: ['crafting'],
      results: [{ amount: 41, ignoredByProductivity: 40 }],
      maximumProductivity: 0.5,
      surfaceConditions: [
        { property: 'pressure', min: 2000, max: 2000 },
        { property: 'gravity', max: 0 }
      ]
    })
    expect(r['recycling']).toMatchObject({
      hidden: true,
      results: [{ amount: 0, extraCountFraction: 0.5 }]
    })
    expect(r['parameter-0']).toMatchObject({ hidden: true, results: [] })
    expect(r['ranged']!.results).toEqual([
      { type: 'item', name: 'gear', amount: 2.5, probability: 0.5 }
    ])
  })

  it('lists fluids, signals, tiles and qualities', () => {
    expect(db.fluids).toEqual(['crude-oil', 'water'])
    expect(db.virtualSignals).toEqual(['signal-A'])
    expect(db.tiles).toEqual(['concrete'])
    expect(db.qualities).toEqual({
      normal: { level: 0, color: '#b3b3b3' },
      rare: { level: 2, color: '#1173f2' }
    })
  })

  it('provides a size lookup', () => {
    expect(dbPrototypeLookup(db)('splitter')).toMatchObject({
      type: 'splitter',
      width: 2,
      height: 1
    })
    expect(dbPrototypeLookup(db)('kr-steel-pipe')).toBeUndefined()
  })
})

describe('buildPrototypeDb analysis fields (format 7)', () => {
  const excerpt = {
    'assembling-machine': {
      foundry: {
        name: 'foundry',
        collision_box: [
          [-2.2, -2.2],
          [2.2, 2.2]
        ],
        crafting_speed: 4,
        crafting_categories: ['metallurgy'],
        energy_usage: '2500kW',
        energy_source: { type: 'electric' }
      }
    },
    'curved-rail-a': {
      'curved-rail-a': {
        name: 'curved-rail-a',
        collision_box: [
          [-0.75, -2.5],
          [0.75, 2.5]
        ],
        placeable_by: { item: 'rail', count: 3 }
      }
    },
    item: {
      foundry: { name: 'foundry', place_result: 'foundry', stack_size: 20 },
      rail: { name: 'rail', stack_size: 100 },
      concrete: { name: 'concrete', place_as_tile: { result: 'concrete' } },
      'hazard-concrete': {
        name: 'hazard-concrete',
        place_as_tile: { result: 'hazard-concrete-left' }
      },
      coal: { name: 'coal', fuel_value: '4MJ', fuel_categories: ['chemical'] },
      'battery-equipment': {
        name: 'battery-equipment',
        place_as_equipment_result: 'battery-equipment'
      }
    },
    recipe: {
      concrete: { name: 'concrete', results: [{ type: 'item', name: 'concrete', amount: 10 }] },
      'fill-water-barrel': {
        name: 'fill-water-barrel',
        localised_name: ['recipe-name.fill-barrel', ['fluid-name.water']],
        results: [{ type: 'item', name: 'water-barrel', amount: 1 }]
      },
      'oil-processing': {
        name: 'oil-processing',
        results: [
          { type: 'fluid', name: 'water', amount: 1 },
          { type: 'item', name: 'coal', amount: 1 }
        ]
      }
    },
    fluid: { water: { name: 'water' } },
    tile: {
      concrete: { name: 'concrete' },
      'hazard-concrete-left': {
        name: 'hazard-concrete-left',
        placeable_by: { item: 'hazard-concrete', count: 1 }
      }
    },
    quality: {
      legendary: {
        name: 'legendary',
        level: 5,
        next: undefined,
        beacon_power_usage_multiplier: 1 / 6
      },
      rare: { name: 'rare', level: 2, next: 'epic' }
    },
    planet: { nauvis: { name: 'nauvis' } }
  }
  const locale = {
    'entity-name.foundry': 'Foundry',
    'item-name.rail': 'Rail',
    'item-name.concrete': 'Concrete',
    'item-name.coal': 'Coal',
    'equipment-name.battery-equipment': 'Personal battery',
    'tile-name.concrete': 'Concrete',
    'fluid-name.water': 'Water',
    'recipe-name.fill-barrel': 'Fill __1__ barrel',
    'space-location-name.nauvis': 'Nauvis',
    'quality-name.legendary': 'Legendary'
  }
  const db = buildPrototypeDb(excerpt as never, { gameVersion: '2.1.25', mods: [], locale })

  it('stores entity stats and placeable_by', () => {
    expect(db.entities['foundry']!.stats).toEqual({
      craftingSpeed: 4,
      craftingCategories: ['metallurgy'],
      moduleSlots: 0,
      allowedEffects: [],
      energyUsage: 2_500_000,
      energySource: { type: 'electric' }
    })
    expect(db.entities['curved-rail-a']!.stats).toEqual({
      placeableBy: [{ item: 'rail', count: 3 }]
    })
  })

  it('stores item stats, quality multipliers and tile items', () => {
    expect(db.items['coal']).toMatchObject({ fuelValue: 4e6, fuelCategories: ['chemical'] })
    expect(db.qualities['legendary']).toEqual({
      level: 5,
      multipliers: { beacon_power_usage: 1 / 6 }
    })
    expect(db.qualities['rare']).toEqual({ level: 2, next: 'epic' })
    expect(db.tileItems).toEqual({
      concrete: [{ item: 'concrete', count: 1 }],
      'hazard-concrete-left': [{ item: 'hazard-concrete', count: 1 }]
    })
  })

  it('resolves display names with the game fallbacks', () => {
    expect(db.names.entity).toEqual({ foundry: 'Foundry' })
    // item → own name, else the entity or tile it places, else its equipment
    expect(db.names.item).toEqual({
      foundry: 'Foundry',
      rail: 'Rail',
      concrete: 'Concrete',
      coal: 'Coal',
      'battery-equipment': 'Personal battery'
    })
    // recipe → localised_name, recipe-name, else its only product; none with two products
    expect(db.names.recipe).toEqual({
      concrete: 'Concrete',
      'fill-water-barrel': 'Fill Water barrel'
    })
    expect(db.names['space-location']).toEqual({ nauvis: 'Nauvis' })
    expect(displayName(db, 'entity', 'foundry')).toBe('Foundry')
    expect(displayName(db, 'entity', 'kr-thing')).toBe('kr-thing')
    expect(displayName(null, 'item', 'coal')).toBe('coal')
  })

  it('stores no names without a locale', () => {
    expect(buildPrototypeDb(excerpt as never, { gameVersion: 'x', mods: [] }).names).toEqual({})
  })
})

describe('iconCategoryFor', () => {
  it.each([
    [undefined, 'item'],
    ['item', 'item'],
    ['virtual', 'virtual-signal'],
    ['virtual-signal', 'virtual-signal'],
    ['fluid', 'fluid'],
    ['planet', 'space-location'],
    ['entity', 'entity'],
    ['something-new', 'item']
  ])('%s → %s', (kind, category) => {
    expect(iconCategoryFor(kind)).toBe(category)
  })
})
