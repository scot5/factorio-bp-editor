import { describe, expect, it } from 'vitest'
import { packVersion, type BlueprintEnvelope, type JsonObject } from '../codec'
import { validateEnvelope } from '../model'
import { migrate1to2, needsMigration } from './migrate'
import { RENAME_STEPS, renameFrom1_1 } from './renames'

const V1_1 = packVersion({ major: 1, minor: 1, patch: 107, build: 0 })
const V2_1 = 562954250027018

const legacy = (entities: JsonObject[], extra: JsonObject = {}): BlueprintEnvelope => ({
  blueprint: { item: 'blueprint', entities, ...extra, version: V1_1 }
})

const migratedBlueprint = (env: BlueprintEnvelope): JsonObject =>
  (migrate1to2(env).envelope as { blueprint: JsonObject }).blueprint

const entitiesOf = (bp: JsonObject): JsonObject[] => bp['entities'] as JsonObject[]

describe('renames', () => {
  it('applies the stack inserter swap before the 2.0 renames', () => {
    expect(renameFrom1_1('stack-inserter')).toBe('bulk-inserter')
    expect(renameFrom1_1('stack-filter-inserter')).toBe('bulk-inserter')
    expect(renameFrom1_1('filter-inserter')).toBe('fast-inserter')
    expect(renameFrom1_1('fast-inserter')).toBe('fast-inserter')
    expect(renameFrom1_1('logistic-chest-requester')).toBe('requester-chest')
    expect(renameFrom1_1('effectivity-module-3')).toBe('efficiency-module-3')
    expect(renameFrom1_1('used-up-uranium-fuel-cell')).toBe('depleted-uranium-fuel-cell')
    expect(renameFrom1_1('assembling-machine-2')).toBe('assembling-machine-2')
  })

  it('never chains a rename into another rename within the 2.0 step', () => {
    const step = RENAME_STEPS.find((s) => s.source === '2.0.0.json')!
    for (const to of Object.values(step.renames)) expect(step.renames[to]).toBeUndefined()
  })
})

describe('migrate1to2', () => {
  it('leaves 2.x envelopes alone', () => {
    const env: BlueprintEnvelope = { blueprint: { item: 'blueprint', version: V2_1 } }
    expect(needsMigration(env)).toBe(false)
    const result = migrate1to2(env)
    expect(result.migrated).toBe(false)
    expect(result.envelope).toBe(env)
  })

  it('does not modify the input', () => {
    const env = legacy([
      { entity_number: 1, name: 'filter-inserter', position: { x: 0.5, y: 0.5 } }
    ])
    const before = JSON.stringify(env)
    migrate1to2(env)
    expect(JSON.stringify(env)).toBe(before)
  })

  it('stamps the target version', () => {
    const env = legacy([])
    expect(migrate1to2(env).fromVersion).toBe(V1_1)
    expect((migrate1to2(env).envelope as { blueprint: JsonObject }).blueprint['version']).toBe(
      packVersion({ major: 2, minor: 0, patch: 0, build: 0 })
    )
    const custom = migrate1to2(env, { targetVersion: V2_1 })
    expect((custom.envelope as { blueprint: JsonObject }).blueprint['version']).toBe(V2_1)
  })

  it('doubles directions', () => {
    const bp = migratedBlueprint(
      legacy([
        { entity_number: 1, name: 'inserter', position: { x: 0.5, y: 0.5 }, direction: 2 },
        { entity_number: 2, name: 'rail-signal', position: { x: 3.5, y: 0.5 }, direction: 7 },
        { entity_number: 3, name: 'inserter', position: { x: 1.5, y: 0.5 } }
      ])
    )
    expect(entitiesOf(bp).map((e) => e['direction'])).toEqual([4, 14, undefined])
  })

  it('renames names in entities, recipes, filters, signals and icons, and counts them', () => {
    const env = legacy(
      [
        {
          entity_number: 1,
          name: 'stack-filter-inserter',
          position: { x: 0.5, y: 0.5 },
          filters: [{ index: 1, name: 'effectivity-module' }],
          control_behavior: {
            logistic_condition: { first_signal: { type: 'item', name: 'logistic-chest-storage' } }
          }
        },
        {
          entity_number: 2,
          name: 'assembling-machine-2',
          position: { x: 3.5, y: 0.5 },
          recipe: 'fill-water-barrel'
        }
      ],
      {
        icons: [{ index: 1, signal: { type: 'item', name: 'stack-inserter' } }],
        label: 'stack-inserter'
      }
    )
    const result = migrate1to2(env)
    const bp = (result.envelope as { blueprint: JsonObject }).blueprint
    const [ins, asm] = entitiesOf(bp)
    expect(ins!['name']).toBe('bulk-inserter')
    expect(ins!['filters']).toEqual([
      { index: 1, name: 'efficiency-module', quality: 'normal', comparator: '=' }
    ])
    expect(JSON.stringify(ins!['control_behavior'])).toContain('"storage-chest"')
    expect(asm!['recipe']).toBe('water-barrel')
    expect((bp['icons'] as JsonObject[])[0]!['signal']).toEqual({ name: 'bulk-inserter' })
    expect(bp['label']).toBe('stack-inserter') // free text is not renamed
    expect(result.renamed.get('stack-filter-inserter')).toEqual({ to: 'bulk-inserter', count: 1 })
  })

  it('turns on filters for former filter inserters only', () => {
    const bp = migratedBlueprint(
      legacy([
        {
          entity_number: 1,
          name: 'filter-inserter',
          position: { x: 0.5, y: 0.5 },
          filters: [{ index: 1, name: 'coal' }]
        },
        { entity_number: 2, name: 'fast-inserter', position: { x: 1.5, y: 0.5 } }
      ])
    )
    const [filtered, plain] = entitiesOf(bp)
    expect(filtered!['use_filters']).toBe(true)
    expect(plain!['use_filters']).toBeUndefined()
  })

  it('converts circuit connections to wires, once per wire', () => {
    // Pole 1 —red— combinator 2 input; combinator 2 output —green— pole 3.
    // 1.1 lists each connection on both ends.
    const bp = migratedBlueprint(
      legacy([
        {
          entity_number: 1,
          name: 'medium-electric-pole',
          position: { x: 0.5, y: 0.5 },
          connections: { '1': { red: [{ entity_id: 2 }] } }
        },
        {
          entity_number: 2,
          name: 'decider-combinator',
          position: { x: 2.5, y: 1 },
          connections: {
            '1': { red: [{ entity_id: 1 }] },
            '2': { green: [{ entity_id: 3, circuit_id: 1 }] }
          }
        },
        {
          entity_number: 3,
          name: 'medium-electric-pole',
          position: { x: 4.5, y: 0.5 },
          connections: { '1': { green: [{ entity_id: 2, circuit_id: 2 }] } }
        }
      ])
    )
    expect(bp['wires']).toEqual([
      [1, 1, 2, 1],
      [2, 4, 3, 2]
    ])
    expect(entitiesOf(bp).every((e) => !('connections' in e))).toBe(true)
  })

  it('converts copper neighbours to pole copper wires, once per wire', () => {
    const bp = migratedBlueprint(
      legacy([
        {
          entity_number: 1,
          name: 'small-electric-pole',
          position: { x: 0.5, y: 0.5 },
          neighbours: [2]
        },
        {
          entity_number: 2,
          name: 'small-electric-pole',
          position: { x: 5.5, y: 0.5 },
          neighbours: [1, 3]
        },
        {
          entity_number: 3,
          name: 'small-electric-pole',
          position: { x: 10.5, y: 0.5 },
          neighbours: [2]
        }
      ])
    )
    expect(bp['wires']).toEqual([
      [1, 5, 2, 5],
      [2, 5, 3, 5]
    ])
    expect(entitiesOf(bp).every((e) => !('neighbours' in e))).toBe(true)
  })

  it('converts power switch copper wires and notes that the ids are unverified', () => {
    const result = migrate1to2(
      legacy([
        {
          entity_number: 1,
          name: 'power-switch',
          position: { x: 1, y: 1 },
          connections: { Cu0: [{ entity_id: 2, wire_id: 0 }], Cu1: [{ entity_id: 3, wire_id: 0 }] }
        },
        { entity_number: 2, name: 'medium-electric-pole', position: { x: -2.5, y: 0.5 } },
        { entity_number: 3, name: 'medium-electric-pole', position: { x: 4.5, y: 0.5 } }
      ])
    )
    const bp = (result.envelope as { blueprint: JsonObject }).blueprint
    expect(bp['wires']).toEqual([
      [1, 5, 2, 5],
      [1, 6, 3, 5]
    ])
    expect(result.notes).toEqual([])
  })

  it('converts item requests to insert plans', () => {
    const result = migrate1to2(
      legacy([
        {
          entity_number: 1,
          name: 'assembling-machine-2',
          position: { x: 1.5, y: 1.5 },
          items: { 'effectivity-module': 1, 'speed-module': 1 }
        },
        {
          entity_number: 2,
          name: 'locomotive',
          position: { x: 10, y: 0 },
          orientation: 0.25,
          items: { 'nuclear-fuel': 3 }
        },
        {
          entity_number: 3,
          name: 'modded-machine',
          position: { x: 20.5, y: 0.5 },
          items: { 'speed-module': 2 }
        },
        {
          entity_number: 4,
          name: 'gun-turret',
          position: { x: 30, y: 0 },
          items: { 'piercing-rounds-magazine': 10 }
        }
      ])
    )
    const [asm, loco, modded, turret] = entitiesOf(
      (result.envelope as { blueprint: JsonObject }).blueprint
    )
    expect(asm!['items']).toEqual([
      { id: { name: 'efficiency-module' }, items: { in_inventory: [{ inventory: 4, stack: 0 }] } },
      { id: { name: 'speed-module' }, items: { in_inventory: [{ inventory: 4, stack: 1 }] } }
    ])
    expect(loco!['items']).toEqual([
      {
        id: { name: 'nuclear-fuel' },
        items: { in_inventory: [{ inventory: 1, stack: 0, count: 3 }] }
      }
    ])
    expect(modded!['items']).toEqual({ 'speed-module': 2 }) // unknown inventory: left as is
    expect(turret!['items']).toEqual([
      {
        id: { name: 'piercing-rounds-magazine' },
        items: { in_inventory: [{ inventory: 1, stack: 0, count: 10 }] }
      }
    ])
    // Verified entities (assembler, locomotive) produce no notes; the others do.
    expect(result.notes.map((n) => n.message)).toEqual([
      'Item requests on "modded-machine" were kept in the 1.1 format (unknown inventory).',
      'Item requests on "gun-turret" were converted with an unverified inventory id.'
    ])
  })

  it('wraps 1.1 schedule record lists', () => {
    const bp = migratedBlueprint(
      legacy([{ entity_number: 1, name: 'locomotive', position: { x: 0, y: 0 } }], {
        schedules: [{ locomotives: [1], schedule: [{ station: 'Depot' }] }]
      })
    )
    expect(bp['schedules']).toEqual([
      { locomotives: [1], schedule: { records: [{ station: 'Depot' }] } }
    ])
  })

  it('migrates every node of a book and keeps the result valid', () => {
    const env: BlueprintEnvelope = {
      blueprint_book: {
        item: 'blueprint-book',
        blueprints: [
          {
            index: 0,
            blueprint: {
              item: 'blueprint',
              entities: [
                { entity_number: 1, name: 'logistic-chest-buffer', position: { x: 0.5, y: 0.5 } }
              ],
              version: V1_1
            }
          },
          {
            index: 1,
            upgrade_planner: {
              item: 'upgrade-planner',
              settings: {
                mappers: [
                  {
                    index: 0,
                    from: { type: 'entity', name: 'filter-inserter' },
                    to: { type: 'entity', name: 'stack-filter-inserter' }
                  }
                ]
              },
              version: V1_1
            }
          }
        ],
        version: V1_1
      }
    }
    const out = migrate1to2(env).envelope
    const json = JSON.stringify(out)
    expect(json).not.toMatch(/logistic-chest|filter-inserter|"version":281479278/)
    expect(json).toContain('"name":"buffer-chest"')
    expect(json).toContain('"to":{"type":"entity","name":"bulk-inserter"}')
    expect(validateEnvelope(out)).toEqual([])
  })

  it('turns 1.1 rails into legacy rails, as the game does', () => {
    const result = migrate1to2(
      legacy([
        { entity_number: 1, name: 'curved-rail', position: { x: 0, y: 0 }, direction: 3 },
        { entity_number: 2, name: 'straight-rail', position: { x: 9, y: 1 }, direction: 2 }
      ])
    )
    const [curved, straight] = entitiesOf((result.envelope as { blueprint: JsonObject }).blueprint)
    expect([curved!['name'], curved!['direction']]).toEqual(['legacy-curved-rail', 6])
    expect([straight!['name'], straight!['direction']]).toEqual(['legacy-straight-rail', 4])
    expect(result.renamed.get('curved-rail')).toEqual({ to: 'legacy-curved-rail', count: 1 })
  })
})
