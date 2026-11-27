import { buildPrototypeDb, type PrototypeDb } from '../prototypes'

/** Crafting machines, drills, recipes and resources with 2.1.25 values, for production tests. */

const box = (w: number, h: number = w): number[][] => [
  [-w / 2 + 0.1, -h / 2 + 0.1],
  [w / 2 - 0.1, h / 2 - 0.1]
]

const electric = { type: 'electric', usage_priority: 'secondary-input' }
const allEffects = ['consumption', 'speed', 'productivity', 'pollution', 'quality']
const item = (name: string, amount: number): Record<string, unknown> => ({
  type: 'item',
  name,
  amount
})

export const productionDb: PrototypeDb = buildPrototypeDb(
  {
    'assembling-machine': {
      'assembling-machine-3': {
        name: 'assembling-machine-3',
        collision_box: box(3),
        crafting_speed: 1.25,
        crafting_categories: ['crafting', 'advanced-crafting', 'crafting-with-fluid'],
        module_slots: 4,
        allowed_effects: allEffects,
        energy_usage: '375kW',
        energy_source: electric
      },
      foundry: {
        name: 'foundry',
        collision_box: box(5),
        crafting_speed: 4,
        crafting_categories: ['metallurgy'],
        module_slots: 4,
        allowed_effects: allEffects,
        effect_receiver: { base_effect: { productivity: 0.5 } },
        energy_usage: '2500kW',
        energy_source: electric
      },
      biochamber: {
        name: 'biochamber',
        collision_box: box(3),
        crafting_speed: 2,
        crafting_categories: ['organic'],
        module_slots: 4,
        allowed_effects: allEffects,
        energy_source: { type: 'burner', fuel_categories: ['nutrients'] }
      },
      centrifuge: {
        name: 'centrifuge',
        collision_box: box(3),
        crafting_speed: 1,
        crafting_categories: ['centrifuging'],
        module_slots: 2,
        allowed_effects: allEffects,
        energy_source: electric
      },
      crusher: {
        name: 'crusher',
        collision_box: box(2, 3),
        crafting_speed: 1,
        crafting_categories: ['crushing'],
        module_slots: 2,
        allowed_effects: allEffects,
        energy_source: electric
      }
    },
    furnace: {
      'electric-furnace': {
        name: 'electric-furnace',
        collision_box: box(3),
        crafting_speed: 2,
        crafting_categories: ['smelting'],
        module_slots: 2,
        allowed_effects: allEffects,
        energy_source: electric
      },
      recycler: {
        name: 'recycler',
        collision_box: box(2, 4),
        crafting_speed: 0.5,
        crafting_categories: ['recycling'],
        module_slots: 4,
        energy_source: electric
      }
    },
    'rocket-silo': {
      'rocket-silo': {
        name: 'rocket-silo',
        collision_box: box(9),
        crafting_speed: 1,
        crafting_categories: ['rocket-building'],
        fixed_recipe: 'rocket-part',
        module_slots: 4,
        allowed_effects: ['consumption', 'speed', 'productivity', 'pollution'],
        energy_source: electric
      }
    },
    'mining-drill': {
      'electric-mining-drill': {
        name: 'electric-mining-drill',
        collision_box: box(3),
        mining_speed: 0.5,
        resource_categories: ['basic-solid'],
        module_slots: 3,
        energy_source: electric
      },
      pumpjack: {
        name: 'pumpjack',
        collision_box: box(3),
        mining_speed: 1,
        resource_categories: ['basic-fluid'],
        module_slots: 2,
        energy_source: electric
      }
    },
    beacon: {
      beacon: {
        name: 'beacon',
        collision_box: box(3),
        module_slots: 2,
        allowed_effects: ['consumption', 'speed', 'pollution'],
        supply_area_distance: 3,
        energy_source: electric,
        distribution_effectivity: 1.5,
        profile: [1, 0.7071],
        beacon_counter: 'same_type'
      }
    },
    module: {
      'speed-module': {
        name: 'speed-module',
        category: 'speed',
        tier: 1,
        effect: { speed: 0.2, consumption: 0.5, quality: -0.01 }
      },
      'productivity-module': {
        name: 'productivity-module',
        category: 'productivity',
        tier: 1,
        effect: { productivity: 0.04, consumption: 0.4, pollution: 0.05, speed: -0.05 }
      }
    },
    item: {
      'iron-plate': { name: 'iron-plate', stack_size: 100 },
      'iron-bacteria': { name: 'iron-bacteria', stack_size: 50, spoil_ticks: 3600 }
    },
    recipe: {
      'iron-gear-wheel': {
        name: 'iron-gear-wheel',
        ingredients: [item('iron-plate', 2)],
        results: [item('iron-gear-wheel', 1)],
        allow_productivity: true
      },
      'copper-cable': {
        name: 'copper-cable',
        categories: ['crafting', 'electromagnetics'],
        ingredients: [item('copper-plate', 1)],
        results: [item('copper-cable', 2)],
        allow_productivity: true
      },
      'electronic-circuit': {
        name: 'electronic-circuit',
        categories: ['crafting', 'electromagnetics'],
        ingredients: [item('iron-plate', 1), item('copper-cable', 3)],
        results: [item('electronic-circuit', 1)],
        allow_productivity: true
      },
      'iron-plate': {
        name: 'iron-plate',
        categories: ['smelting'],
        energy_required: 3.2,
        ingredients: [item('iron-ore', 1)],
        results: [item('iron-plate', 1)],
        allow_productivity: true
      },
      'copper-plate': {
        name: 'copper-plate',
        categories: ['smelting'],
        energy_required: 3.2,
        ingredients: [item('copper-ore', 1)],
        results: [item('copper-plate', 1)],
        allow_productivity: true
      },
      'casting-iron-gear-wheel': {
        name: 'casting-iron-gear-wheel',
        categories: ['metallurgy'],
        energy_required: 1,
        ingredients: [{ type: 'fluid', name: 'molten-iron', amount: 10, fluidbox_multiplier: 10 }],
        results: [item('iron-gear-wheel', 1)],
        allow_productivity: true
      },
      'casting-pipe': {
        name: 'casting-pipe',
        categories: ['metallurgy'],
        energy_required: 1,
        ingredients: [{ type: 'fluid', name: 'molten-iron', amount: 10 }],
        results: [item('pipe', 1)],
        allow_productivity: false
      },
      'iron-bacteria-cultivation': {
        name: 'iron-bacteria-cultivation',
        categories: ['organic'],
        energy_required: 4,
        ingredients: [item('iron-bacteria', 1), item('bioflux', 1)],
        results: [{ ...item('iron-bacteria', 4), reset_freshness_on_craft: true }],
        allow_productivity: true,
        surface_conditions: [{ property: 'pressure', min: 2000, max: 2000 }]
      },
      'metallic-asteroid-crushing': {
        name: 'metallic-asteroid-crushing',
        categories: ['crushing'],
        energy_required: 2,
        ingredients: [{ ...item('metallic-asteroid-chunk', 1), ignored_by_stats: 1 }],
        results: [
          item('iron-ore', 20),
          {
            ...item('metallic-asteroid-chunk', 1),
            independent_probability: 0.3,
            ignored_by_stats: 1
          }
        ],
        allow_productivity: true
      },
      'uranium-processing': {
        name: 'uranium-processing',
        categories: ['centrifuging'],
        energy_required: 12,
        ingredients: [item('uranium-ore', 10)],
        results: [
          { ...item('uranium-235', 1), shared_probability: { min: 0, max: 0.007 } },
          { ...item('uranium-238', 1), shared_probability: { min: 0.007, max: 1 } }
        ],
        allow_productivity: true
      },
      'kovarex-enrichment-process': {
        name: 'kovarex-enrichment-process',
        categories: ['centrifuging'],
        energy_required: 60,
        ingredients: [item('uranium-235', 40), item('uranium-238', 5)],
        results: [
          { ...item('uranium-235', 41), ignored_by_stats: 40, ignored_by_productivity: 40 },
          { ...item('uranium-238', 2), ignored_by_stats: 2, ignored_by_productivity: 2 }
        ],
        allow_productivity: true
      },
      'iron-gear-wheel-recycling': {
        name: 'iron-gear-wheel-recycling',
        categories: ['recycling'],
        hidden: true,
        energy_required: 0.03125,
        ingredients: [item('iron-gear-wheel', 1)],
        results: [{ ...item('iron-plate', 0), extra_count_fraction: 0.5 }]
      },
      'rocket-part': {
        name: 'rocket-part',
        categories: ['rocket-building'],
        energy_required: 3,
        ingredients: [
          item('processing-unit', 1),
          item('low-density-structure', 1),
          item('rocket-fuel', 1)
        ],
        results: [item('rocket-part', 1)],
        allow_productivity: true
      },
      'parameter-0': { name: 'parameter-0', categories: ['parameters'], parameter: true },
      legacy: {
        name: 'legacy',
        category: 'oil-processing',
        ingredients: [['iron-plate', 3]],
        results: [{ type: 'item', name: 'gear', amount_min: 1, amount_max: 4, probability: 0.5 }],
        maximum_productivity: 0.5
      }
    },
    resource: {
      'iron-ore': {
        name: 'iron-ore',
        collision_box: box(1),
        minable: { mining_time: 1, result: 'iron-ore' }
      },
      'uranium-ore': {
        name: 'uranium-ore',
        collision_box: box(1),
        minable: {
          mining_time: 2,
          result: 'uranium-ore',
          fluid_amount: 10,
          required_fluid: 'sulfuric-acid'
        }
      },
      'crude-oil': {
        name: 'crude-oil',
        collision_box: box(1),
        category: 'basic-fluid',
        infinite: true,
        minable: { mining_time: 1, results: [{ type: 'fluid', name: 'crude-oil', amount: 10 }] }
      }
    },
    quality: {
      normal: { name: 'normal', level: 0, next: 'uncommon' },
      uncommon: { name: 'uncommon', level: 1 },
      legendary: { name: 'legendary', level: 5 }
    },
    'surface-property': {
      pressure: { name: 'pressure', default_value: 1000 },
      gravity: { name: 'gravity', default_value: 10 },
      'solar-power': { name: 'solar-power', default_value: 100 }
    },
    planet: {
      nauvis: { name: 'nauvis', surface_properties: { 'day-night-cycle': 25200 } },
      gleba: { name: 'gleba', surface_properties: { pressure: 2000, gravity: 20 } }
    },
    surface: {
      'space-platform': {
        name: 'space-platform',
        surface_properties: { gravity: 0, pressure: 0 }
      }
    },
    tile: { 'space-platform-foundation': { name: 'space-platform-foundation' } }
  } as never,
  { gameVersion: '2.1.25', mods: [] }
)
