import { describe, expect, it } from 'vitest'
import { packVersion, type BlueprintEnvelope, type JsonObject } from '../codec'
import { validateEnvelope } from '../model'
import { migrate1to2 } from './migrate'
import { dropItemSignalTypes, migrateEntitySettings } from './settings'

const item = (name: string): JsonObject => ({ type: 'item', name })
const virtual = (name: string): JsonObject => ({ type: 'virtual', name })

/** Migrates one entity's settings and returns it with the notes. */
function run(entity: JsonObject, wired = false): { entity: JsonObject; notes: string[] } {
  const notes: string[] = []
  const copy = JSON.parse(JSON.stringify(entity)) as JsonObject
  migrateEntitySettings(copy, { wired, note: (m) => notes.push(m) })
  return { entity: copy, notes }
}

const cbOf = (entity: JsonObject): JsonObject =>
  run(entity).entity['control_behavior'] as JsonObject

describe('signals', () => {
  it('drops type "item" from signal ids only', () => {
    const value: JsonObject = {
      first_signal: item('iron-plate'),
      second_signal: virtual('signal-A'),
      nested: [{ signal: { type: 'item', name: 'coal', quality: 'rare' } }],
      // Not a signal id: extra keys.
      entity_like: { type: 'item', name: 'x', count: 1 }
    }
    dropItemSignalTypes(value)
    expect(value).toEqual({
      first_signal: { name: 'iron-plate' },
      second_signal: virtual('signal-A'),
      nested: [{ signal: { name: 'coal', quality: 'rare' } }],
      entity_like: { type: 'item', name: 'x', count: 1 }
    })
  })

  it('leaves insert plans alone', () => {
    const items = [{ id: { name: 'coal' }, items: { in_inventory: [{ inventory: 1, stack: 0 }] } }]
    expect(run({ name: 'boiler', items }).entity['items']).toEqual(items)
  })
})

describe('decider combinators', () => {
  it('converts a constant condition, omitting the 2.x defaults', () => {
    const cb = cbOf({
      name: 'decider-combinator',
      control_behavior: {
        decider_conditions: {
          first_signal: item('coal'),
          constant: 0,
          comparator: '<',
          output_signal: virtual('signal-R'),
          copy_count_from_input: true
        }
      }
    })
    expect(cb).toEqual({
      decider_conditions: {
        conditions: [{ first_signal: { name: 'coal' } }],
        outputs: [{ signal: virtual('signal-R') }],
        else_outputs: []
      }
    })
  })

  it('keeps non-default values and a second signal', () => {
    const cb = cbOf({
      name: 'decider-combinator',
      control_behavior: {
        decider_conditions: {
          first_signal: virtual('signal-S'),
          second_signal: virtual('signal-R'),
          comparator: '≥',
          output_signal: virtual('signal-S'),
          copy_count_from_input: false
        }
      }
    })
    expect(cb['decider_conditions']).toEqual({
      conditions: [
        { first_signal: virtual('signal-S'), second_signal: virtual('signal-R'), comparator: '≥' }
      ],
      outputs: [{ signal: virtual('signal-S'), copy_count_from_input: false }],
      else_outputs: []
    })
  })

  it('has no outputs without an output signal, and keeps unknown keys', () => {
    const cb = cbOf({
      name: 'decider-combinator',
      control_behavior: { decider_conditions: { constant: 5, comparator: '>', extra: 1 } }
    })
    expect(cb['decider_conditions']).toEqual({
      conditions: [{ constant: 5, comparator: '>' }],
      outputs: [],
      else_outputs: [],
      extra: 1
    })
  })

  it('leaves 2.x decider conditions alone', () => {
    const decider_conditions = { conditions: [{ constant: 1 }], outputs: [] }
    const cb = cbOf({ name: 'decider-combinator', control_behavior: { decider_conditions } })
    expect(cb['decider_conditions']).toEqual(decider_conditions)
  })

  it('only drops the item type in arithmetic conditions', () => {
    const cb = cbOf({
      name: 'arithmetic-combinator',
      control_behavior: {
        arithmetic_conditions: {
          first_signal: item('coal'),
          second_constant: 2,
          operation: '*',
          output_signal: virtual('signal-A')
        }
      }
    })
    expect(cb['arithmetic_conditions']).toEqual({
      first_signal: { name: 'coal' },
      second_constant: 2,
      operation: '*',
      output_signal: virtual('signal-A')
    })
  })
})

describe('constant combinators', () => {
  it('turns filters into one section, in place', () => {
    const cb = cbOf({
      name: 'constant-combinator',
      control_behavior: {
        filters: [
          { signal: item('coal'), count: 5, index: 1 },
          { signal: { type: 'fluid', name: 'water' }, count: -2, index: 3 }
        ],
        is_on: false
      }
    })
    expect(Object.keys(cb)).toEqual(['sections', 'is_on'])
    expect(cb['sections']).toEqual({
      sections: [
        {
          index: 1,
          filters: [
            { index: 1, name: 'coal', quality: 'normal', comparator: '=', count: 5 },
            {
              index: 3,
              type: 'fluid',
              name: 'water',
              quality: 'normal',
              comparator: '=',
              count: -2
            }
          ]
        }
      ]
    })
  })

  it('writes an empty section for empty filters', () => {
    const cb = cbOf({ name: 'constant-combinator', control_behavior: { filters: [] } })
    expect(cb).toEqual({ sections: { sections: [{ index: 1 }] } })
  })
})

describe('filters', () => {
  it('turns request filters into one section with normal quality', () => {
    const { entity } = run({
      name: 'requester-chest',
      request_filters: [{ index: 2, name: 'coal', count: 50 }],
      request_from_buffers: true
    })
    expect(entity['request_filters']).toEqual({
      sections: [
        {
          index: 1,
          filters: [{ index: 2, name: 'coal', quality: 'normal', comparator: '=', count: 50 }]
        }
      ]
    })
    // Kept: the game drops it, but it is a valid 2.x field.
    expect(entity['request_from_buffers']).toBe(true)
  })

  it('adds quality to inserter and cargo wagon filters', () => {
    const q = { quality: 'normal', comparator: '=' }
    expect(
      run({ name: 'fast-inserter', filters: [{ index: 1, name: 'coal' }] }).entity['filters']
    ).toEqual([{ index: 1, name: 'coal', ...q }])
    const wagon = run({
      name: 'cargo-wagon',
      inventory: { filters: [{ index: 4, name: 'rail' }], bar: 10 }
    }).entity
    expect(wagon['inventory']).toEqual({ filters: [{ index: 4, name: 'rail', ...q }], bar: 10 })
  })

  it('keeps an existing quality', () => {
    const filters = [{ index: 1, name: 'coal', quality: 'rare' }]
    expect(run({ name: 'inserter', filters }).entity['filters']).toEqual(filters)
  })

  it('turns a splitter filter into an item filter', () => {
    expect(run({ name: 'splitter', filter: 'iron-plate' }).entity['filter']).toEqual({
      name: 'iron-plate',
      quality: 'normal',
      comparator: '='
    })
  })
})

describe('circuit_enabled', () => {
  const condition = { first_signal: virtual('signal-A'), constant: 1, comparator: '>' }

  it('enables inserters in the default enable/disable mode', () => {
    expect(cbOf({ name: 'inserter', control_behavior: { circuit_condition: condition } })).toEqual({
      circuit_enabled: true,
      circuit_condition: condition
    })
    // Logistic conditions use the same mode.
    expect(
      cbOf({
        name: 'bulk-inserter',
        control_behavior: { connect_to_logistic_network: true, circuit_mode_of_operation: 0 }
      })
    ).toEqual({ circuit_enabled: true, connect_to_logistic_network: true })
  })

  it('maps the other inserter modes', () => {
    expect(
      cbOf({ name: 'fast-inserter', control_behavior: { circuit_mode_of_operation: 1 } })
    ).toEqual({ circuit_set_filters: true })
    expect(
      cbOf({
        name: 'inserter',
        control_behavior: { circuit_mode_of_operation: 3, circuit_read_hand_contents: true }
      })
    ).toEqual({ circuit_read_hand_contents: true })

    const stack = run({ name: 'bulk-inserter', control_behavior: { circuit_mode_of_operation: 4 } })
    expect(stack.entity['control_behavior']).toEqual({ circuit_set_stack_size: true })
    expect(stack.notes).toHaveLength(1)

    const hand = run({ name: 'inserter', control_behavior: { circuit_mode_of_operation: 2 } })
    expect(hand.entity['control_behavior']).toEqual({})
    expect(hand.notes).toHaveLength(1)

    const unknown = run({ name: 'inserter', control_behavior: { circuit_mode_of_operation: 9 } })
    expect(unknown.entity['control_behavior']).toEqual({ circuit_mode_of_operation: 9 })
    expect(unknown.notes).toHaveLength(1)
  })

  it('renames circuit_enable_disable, dropping it when false', () => {
    expect(
      cbOf({
        name: 'train-stop',
        control_behavior: { circuit_condition: condition, circuit_enable_disable: true }
      })
    ).toEqual({ circuit_enabled: true, circuit_condition: condition })
    expect(
      cbOf({
        name: 'transport-belt',
        control_behavior: { circuit_enable_disable: false, circuit_read_hand_contents: true }
      })
    ).toEqual({ circuit_read_hand_contents: true })
  })

  it('enables lamps, pumps and power switches that have a circuit condition', () => {
    for (const name of ['small-lamp', 'pump', 'power-switch']) {
      const { entity, notes } = run({ name, control_behavior: { circuit_condition: condition } })
      expect(entity['control_behavior']).toEqual({
        circuit_enabled: true,
        circuit_condition: condition
      })
      expect(notes).toEqual([])
    }
    expect(cbOf({ name: 'small-lamp', control_behavior: { use_colors: true } })).toEqual({
      use_colors: true
    })
    expect(
      run({ name: 'offshore-pump', control_behavior: { circuit_condition: condition } }).notes
    ).toHaveLength(1)
  })

  it('does not enable other entities with a circuit condition', () => {
    const control_behavior = { circuit_condition: condition }
    expect(cbOf({ name: 'programmable-speaker', control_behavior })).toEqual(control_behavior)
  })
})

describe('other settings', () => {
  it('converts roboport read_logistics', () => {
    expect(
      cbOf({
        name: 'roboport',
        control_behavior: { read_logistics: false, read_robot_stats: true }
      })
    ).toEqual({ read_items_mode: 0, read_robot_stats: true })
    const on = run({ name: 'roboport', control_behavior: { read_logistics: true } })
    expect(on.entity['control_behavior']).toEqual({ read_items_mode: 1 })
    expect(on.notes).toHaveLength(1)
  })

  it('converts speaker playback_globally', () => {
    const parameters = (globally: boolean): unknown =>
      run({
        name: 'programmable-speaker',
        parameters: { playback_volume: 1, playback_globally: globally, allow_polyphony: false }
      }).entity['parameters']
    expect(parameters(false)).toEqual({
      playback_volume: 1,
      playback_mode: 'local',
      allow_polyphony: false
    })
    expect(Object.keys(parameters(true) as JsonObject)[1]).toBe('playback_mode')
    expect((parameters(true) as JsonObject)['playback_mode']).toBe('global')
  })

  it('turns on the temperature signal of circuit-connected storage tanks only', () => {
    expect(run({ name: 'storage-tank' }, false).entity['control_behavior']).toBeUndefined()
    expect(run({ name: 'storage-tank' }, true).entity['control_behavior']).toEqual({
      temperature_signal: virtual('signal-T')
    })
    const custom = { temperature_signal: virtual('signal-A') }
    expect(
      run({ name: 'storage-tank', control_behavior: custom }, true).entity['control_behavior']
    ).toEqual(custom)
  })

  it('makes 1.1 artillery and train behaviour explicit', () => {
    expect(run({ name: 'artillery-turret' }).entity['artillery_auto_targeting']).toBe(true)
    expect(
      run({ name: 'artillery-turret', artillery_auto_targeting: false }).entity[
        'artillery_auto_targeting'
      ]
    ).toBe(false)
    const loco = run({ name: 'locomotive' })
    expect(loco.entity['enable_logistics_while_moving']).toBe(false)
    expect(loco.notes).toEqual([])
    const fluid = run({ name: 'fluid-wagon' })
    expect(fluid.entity['enable_logistics_while_moving']).toBe(false)
    expect(fluid.notes).toHaveLength(1)
  })
})

describe('through migrate1to2', () => {
  const V1_1 = packVersion({ major: 1, minor: 1, patch: 107, build: 0 })

  it('migrates icons, schedules and wired tanks, and stays valid', () => {
    const env: BlueprintEnvelope = {
      blueprint_book: {
        item: 'blueprint-book',
        icons: [{ signal: item('locomotive'), index: 1 }],
        blueprints: [
          {
            index: 0,
            blueprint: {
              item: 'blueprint',
              icons: [{ signal: item('train-stop'), index: 1 }],
              entities: [
                {
                  entity_number: 1,
                  name: 'storage-tank',
                  position: { x: 1.5, y: 1.5 },
                  connections: { '1': { red: [{ entity_id: 2 }] } }
                },
                { entity_number: 2, name: 'locomotive', position: { x: 6, y: 3 }, orientation: 0 }
              ],
              schedules: [
                {
                  locomotives: [2],
                  schedule: [
                    {
                      station: 'A',
                      wait_conditions: [
                        {
                          type: 'item_count',
                          compare_type: 'or',
                          condition: { first_signal: item('coal'), constant: 10, comparator: '>' }
                        }
                      ]
                    }
                  ]
                }
              ],
              version: V1_1
            }
          }
        ],
        version: V1_1
      }
    }
    const out = migrate1to2(env).envelope as { blueprint_book: JsonObject }
    const book = out.blueprint_book
    expect(book['icons']).toEqual([{ signal: { name: 'locomotive' }, index: 1 }])
    const bp = (book['blueprints'] as JsonObject[])[0]!['blueprint'] as JsonObject
    expect(bp['icons']).toEqual([{ signal: { name: 'train-stop' }, index: 1 }])
    const [tank] = bp['entities'] as JsonObject[]
    expect(tank!['control_behavior']).toEqual({ temperature_signal: virtual('signal-T') })
    const schedule = (bp['schedules'] as JsonObject[])[0]!['schedule'] as JsonObject
    expect(JSON.stringify(schedule)).toContain('"first_signal":{"name":"coal"}')
    expect(validateEnvelope(out)).toEqual([])
  })
})
