import type { Blueprint, BlueprintEntity, InsertPlan } from '../model'
import { buildPrototypeDb, type PrototypeDb } from '../prototypes'

/** A small PrototypeDb with 2.1.25 values, for the power and effects tests. */

const box = (w: number, h: number = w): number[][] => [
  [-w / 2 + 0.1, -h / 2 + 0.1],
  [w / 2 - 0.1, h / 2 - 0.1]
]

const electric = { type: 'electric', usage_priority: 'secondary-input' }

export const powerDb: PrototypeDb = buildPrototypeDb(
  {
    'assembling-machine': {
      'assembling-machine-3': {
        name: 'assembling-machine-3',
        collision_box: box(3),
        crafting_speed: 1.25,
        module_slots: 4,
        allowed_effects: ['consumption', 'speed', 'productivity', 'pollution', 'quality'],
        energy_usage: '375kW',
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
        energy_usage: '480kW',
        energy_source: electric,
        distribution_effectivity: 1.5,
        distribution_effectivity_bonus_per_quality_level: 0.2,
        profile: [1, 0.7071, 0.5773],
        beacon_counter: 'same_type'
      }
    },
    inserter: {
      inserter: {
        name: 'inserter',
        collision_box: box(1),
        energy_per_movement: '5kJ',
        energy_per_rotation: '5kJ',
        extension_speed: 0.035,
        rotation_speed: 0.014,
        energy_source: { ...electric, drain: '0.4kW' }
      }
    },
    'electric-pole': {
      'small-electric-pole': {
        name: 'small-electric-pole',
        collision_box: box(1),
        supply_area_distance: 2.5,
        maximum_wire_distance: 7.5
      }
    },
    'power-switch': { 'power-switch': { name: 'power-switch', collision_box: box(2) } },
    'solar-panel': {
      'solar-panel': {
        name: 'solar-panel',
        collision_box: box(3),
        production: '60kW',
        energy_source: { type: 'electric', usage_priority: 'solar' }
      }
    },
    accumulator: {
      accumulator: {
        name: 'accumulator',
        collision_box: box(2),
        energy_source: {
          type: 'electric',
          buffer_capacity: '5MJ',
          usage_priority: 'tertiary',
          input_flow_limit: '300kW',
          output_flow_limit: '300kW'
        }
      }
    },
    reactor: {
      'nuclear-reactor': {
        name: 'nuclear-reactor',
        collision_box: box(5),
        consumption: '40MW',
        neighbour_bonus: 1,
        energy_source: { type: 'burner', fuel_categories: ['nuclear'] }
      }
    },
    'electric-turret': {
      'laser-turret': {
        name: 'laser-turret',
        collision_box: box(2),
        energy_source: {
          type: 'electric',
          buffer_capacity: '801kJ',
          input_flow_limit: '9600kW',
          drain: '24kW',
          usage_priority: 'primary-input'
        }
      }
    },
    roboport: {
      roboport: {
        name: 'roboport',
        collision_box: box(4),
        energy_usage: '50kW',
        energy_source: { ...electric, input_flow_limit: '5MW', buffer_capacity: '100MJ' }
      }
    },
    furnace: {
      'stone-furnace': {
        name: 'stone-furnace',
        collision_box: box(2),
        energy_usage: '90kW',
        energy_source: { type: 'burner', fuel_categories: ['chemical'] }
      }
    },
    'asteroid-collector': {
      'asteroid-collector': {
        name: 'asteroid-collector',
        collision_box: box(3),
        passive_energy_usage: '200J',
        energy_source: electric
      }
    },
    module: {
      'speed-module': {
        name: 'speed-module',
        category: 'speed',
        tier: 1,
        effect: { speed: 0.2, consumption: 0.5, quality: -0.1 }
      },
      'efficiency-module': {
        name: 'efficiency-module',
        category: 'efficiency',
        tier: 1,
        effect: { consumption: -0.3 }
      }
    },
    quality: {
      normal: { name: 'normal', level: 0 },
      legendary: { name: 'legendary', level: 5, beacon_power_usage_multiplier: 1 / 6 }
    },
    'surface-property': { 'solar-power': { name: 'solar-power', default_value: 100 } },
    planet: {
      nauvis: { name: 'nauvis', surface_properties: {}, solar_power_in_space: 300 },
      vulcanus: {
        name: 'vulcanus',
        surface_properties: { 'solar-power': 400 },
        solar_power_in_space: 600
      }
    },
    tile: { 'space-platform-foundation': { name: 'space-platform-foundation' } }
  } as never,
  { gameVersion: '2.1.25', mods: [] }
)

type Extra = Partial<BlueprintEntity> & Record<string, unknown>

/** Builds a blueprint from `[name, x, y, extra?]` tuples, numbering entities from 1. */
export function blueprintOf(
  entities: [string, number, number, Extra?][],
  extra: Partial<Blueprint> = {}
): Blueprint {
  return {
    item: 'blueprint',
    version: 562954250027018,
    entities: entities.map(([name, x, y, rest], i) => ({
      entity_number: i + 1,
      name,
      position: { x, y },
      ...rest
    })) as BlueprintEntity[],
    ...extra
  } as Blueprint
}

/** An insert plan putting `count` modules into inventory `inventory`. */
export function modules(
  name: string,
  count: number,
  inventory: number,
  quality?: string
): InsertPlan {
  return {
    id: { name, ...(quality ? { quality } : {}) },
    items: {
      in_inventory: Array.from({ length: count }, (_, stack) => ({ inventory, stack }))
    }
  }
}
