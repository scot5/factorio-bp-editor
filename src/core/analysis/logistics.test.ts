import { describe, expect, it } from 'vitest'
import { layoutBlueprint, type Blueprint } from '../model'
import { buildPrototypeDb, dbPrototypeLookup, type PrototypeDb } from '../prototypes'
import { analyse } from './index'
import {
  beltThroughput,
  inserterCycleTicks,
  logistics,
  type InserterRow,
  type LogisticsReport,
  type LogisticsSettings
} from './logistics'
import type { ItemRates } from './production'
import { blueprintOf } from './test-db'

/** Belts, inserters, splitters, pipes and pumps with 2.1.25 values. */

const box = (w: number, h: number = w): number[][] => [
  [-w / 2 + 0.1, -h / 2 + 0.1],
  [w / 2 - 0.1, h / 2 - 0.1]
]
const four = [0, 4, 8, 12].map((direction) => ({ direction, position: [0, 0] }))
const inserter = (name: string, extra: Record<string, unknown>): Record<string, unknown> => ({
  name,
  collision_box: box(1),
  pickup_position: [0, -1],
  insert_position: [0, 1.2],
  ...extra
})

const db: PrototypeDb = buildPrototypeDb(
  {
    'transport-belt': {
      'transport-belt': { name: 'transport-belt', collision_box: box(1), speed: 0.03125 },
      'turbo-transport-belt': { name: 'turbo-transport-belt', collision_box: box(1), speed: 0.125 }
    },
    'underground-belt': {
      'underground-belt': {
        name: 'underground-belt',
        collision_box: box(1),
        speed: 0.03125,
        max_distance: 5
      }
    },
    splitter: { splitter: { name: 'splitter', collision_box: box(2, 1), speed: 0.03125 } },
    inserter: {
      inserter: inserter('inserter', { rotation_speed: 0.014000000000000002 }),
      'long-handed-inserter': inserter('long-handed-inserter', {
        rotation_speed: 0.02,
        pickup_position: [0, -2],
        insert_position: [0, 2.2]
      }),
      'bulk-inserter': inserter('bulk-inserter', { rotation_speed: 0.04, bulk: true }),
      'stack-inserter': inserter('stack-inserter', {
        rotation_speed: 0.04,
        bulk: true,
        stack_size_bonus: 4,
        max_belt_stack_size: 4
      })
    },
    'assembling-machine': {
      'assembling-machine-3': {
        name: 'assembling-machine-3',
        collision_box: box(3),
        crafting_speed: 1.25,
        crafting_categories: ['crafting']
      }
    },
    recipe: {
      'iron-gear-wheel': {
        name: 'iron-gear-wheel',
        ingredients: [{ type: 'item', name: 'iron-plate', amount: 2 }],
        results: [{ type: 'item', name: 'iron-gear-wheel', amount: 1 }]
      }
    },
    pipe: { pipe: { name: 'pipe', collision_box: box(1), fluid_box: { pipe_connections: four } } },
    'pipe-to-ground': {
      'pipe-to-ground': {
        name: 'pipe-to-ground',
        collision_box: box(1),
        fluid_box: {
          pipe_connections: [
            { direction: 0, position: [0, 0] },
            {
              connection_type: 'underground',
              direction: 8,
              position: [0, 0],
              max_underground_distance: 10
            }
          ]
        }
      }
    },
    'storage-tank': {
      'storage-tank': {
        name: 'storage-tank',
        collision_box: box(3),
        fluid_box: {
          pipe_connections: [
            { direction: 12, position: [-1, -1] },
            { direction: 4, position: [1, 1] }
          ]
        }
      }
    },
    pump: {
      pump: {
        name: 'pump',
        collision_box: box(1, 2),
        pumping_speed: 20,
        fluid_box: {
          pipe_connections: [
            { direction: 0, position: [0, -0.5] },
            { direction: 8, position: [0, 0.5] }
          ]
        }
      }
    },
    quality: {
      normal: { name: 'normal', level: 0 },
      legendary: { name: 'legendary', level: 5 }
    }
  } as never,
  { gameVersion: '2.1.25', mods: [] }
)

const report = (bp: Blueprint, settings: LogisticsSettings = {}): LogisticsReport =>
  logistics(db, layoutBlueprint(bp, dbPrototypeLookup(db)), settings)

describe('belts', () => {
  it('carries 8 items per tile on both lanes, times the belt stack size', () => {
    expect(beltThroughput(0.03125)).toBe(15)
    expect(beltThroughput(0.125)).toBe(60)
    expect(beltThroughput(0.125, 4)).toBe(240)
  })

  it('lists belt-like entities per name, slowest first', () => {
    const r = report(
      blueprintOf([
        ['turbo-transport-belt', 0.5, 0.5],
        ['transport-belt', 1.5, 0.5],
        ['transport-belt', 2.5, 0.5],
        ['splitter', 4, 0.5],
        ['inserter', 9.5, 9.5]
      ]),
      { research: { beltStackSize: 2 } }
    )
    expect(r.beltStackSize).toBe(2)
    expect(r.belts).toEqual([
      { name: 'splitter', count: 1, indexes: [3], throughput: 30 },
      { name: 'transport-belt', count: 2, indexes: [1, 2], throughput: 30 },
      { name: 'turbo-transport-belt', count: 1, indexes: [0], throughput: 120 }
    ])
  })
})

describe('inserters', () => {
  it('swings in the ticks the wiki lists chest to chest', () => {
    expect(inserterCycleTicks(0.014000000000000002)).toBe(70)
    expect(inserterCycleTicks(0.02)).toBe(48)
    expect(inserterCycleTicks(0.04)).toBe(24)
  })

  it('moves hand size × swings per second, with research and quality', () => {
    const r = report(
      blueprintOf([
        ['inserter', 0.5, 0.5],
        ['inserter', 2.5, 0.5, { quality: 'legendary' }],
        ['bulk-inserter', 4.5, 0.5],
        ['stack-inserter', 6.5, 0.5],
        ['stack-inserter', 8.5, 0.5, { override_stack_size: 2 }]
      ])
    )
    const row = (name: string, quality?: string, hand?: number): InserterRow | undefined =>
      r.inserters.find(
        (i) =>
          i.name === name && i.quality === quality && (hand === undefined || i.handSize === hand)
      )
    expect(row('inserter')).toMatchObject({ handSize: 1, cycles: 60 / 70 })
    // 0.014 × 2.5 = 0.035 turns per tick: 14 ticks per half turn.
    expect(row('inserter', 'legendary')).toMatchObject({ handSize: 1, cycles: 60 / 28 })
    expect(row('bulk-inserter')).toMatchObject({ handSize: 2, throughput: 5 })
    expect(row('stack-inserter', undefined, 6)).toMatchObject({ throughput: 15 })
    expect(row('stack-inserter', undefined, 2)).toMatchObject({ throughput: 5 })

    const researched = report(blueprintOf([['bulk-inserter', 0.5, 0.5]]), {
      research: { bulkInserterCapacityBonus: 11 }
    })
    expect(researched.inserters[0]).toMatchObject({ handSize: 12, throughput: 30 })
  })

  describe('limits', () => {
    // Gears: 1.25 / 0.5 = 2.5 crafts per second, 5 plates in and 2.5 gears out.
    const rates = new Map<number, ItemRates>([[0, { input: 5, output: 2.5 }]])
    // An inserter facing north picks up north of it and drops south of it.
    const machine = (...inserters: [string, number, number][]): Blueprint =>
      blueprintOf([['assembling-machine-3', 0.5, 0.5], ...inserters])

    it('flags a machine its inserters cannot serve, even chest to chest', () => {
      const r = report(machine(['inserter', 0.5, -1.5], ['inserter', 0.5, 2.5]), {
        machineRates: rates
      })
      expect(r.limits).toEqual([
        {
          name: 'assembling-machine-3',
          side: 'input',
          count: 1,
          indexes: [0, 1],
          need: 5,
          capacity: 60 / 70
        },
        {
          name: 'assembling-machine-3',
          side: 'output',
          count: 1,
          indexes: [0, 2],
          need: 2.5,
          capacity: 60 / 70
        }
      ])
    })

    it('adds up the inserters on one side and leaves sides without inserters alone', () => {
      const r = report(machine(['bulk-inserter', 0.5, -1.5], ['bulk-inserter', -0.5, -1.5]), {
        machineRates: rates
      })
      expect(r.limits).toEqual([])
    })

    it('reaches two tiles with long-handed inserters', () => {
      const r = report(machine(['long-handed-inserter', 0.5, -2.5]), { machineRates: rates })
      expect(r.limits).toMatchObject([{ side: 'input', indexes: [0, 1], capacity: 60 / 48 }])
    })

    it('turns the pickup and drop with the inserter', () => {
      // Facing north, west of the machine: neither end is in it.
      const r = report(machine(['inserter', -1.5, 0.5]), { machineRates: rates })
      expect(r.limits).toEqual([])
      // Facing west: picks up west of it, drops east of it (into the machine).
      const west = report(
        blueprintOf([
          ['assembling-machine-3', 0.5, 0.5],
          ['inserter', -1.5, 0.5, { direction: 12 }]
        ]),
        { machineRates: rates }
      )
      expect(west.limits).toMatchObject([{ side: 'input', indexes: [0, 1] }])
    })
  })
})

describe('splitters', () => {
  it('groups splitters by priorities and filter, plain ones first', () => {
    const r = report(
      blueprintOf([
        ['splitter', 1, 0.5, { input_priority: 'left', output_priority: 'right' }],
        ['splitter', 4, 0.5],
        [
          'splitter',
          7,
          0.5,
          {
            output_priority: 'left',
            filter: { name: 'iron-plate', quality: 'normal', comparator: '=' }
          }
        ],
        ['splitter', 10, 0.5, { input_priority: 'left', output_priority: 'right' }]
      ])
    )
    expect(r.splitters).toEqual([
      { name: 'splitter', count: 1, indexes: [1] },
      {
        name: 'splitter',
        inputPriority: 'left',
        outputPriority: 'right',
        count: 2,
        indexes: [0, 3]
      },
      {
        name: 'splitter',
        outputPriority: 'left',
        filter: { name: 'iron-plate' },
        count: 1,
        indexes: [2]
      }
    ])
  })
})

describe('fluid segments', () => {
  it('joins pipes and tanks, and splits segments at pumps', () => {
    // A pump facing north at x 0.5 covers y 2 … 4; pipes above and below it.
    const r = report(
      blueprintOf([
        ['pipe', 0.5, 0.5],
        ['pipe', 0.5, 1.5],
        ['pump', 0.5, 3],
        ['pipe', 0.5, 4.5],
        ['pipe', 0.5, 5.5],
        ['pipe', 0.5, 6.5],
        ['pipe', 20.5, 20.5]
      ])
    )
    expect(r.fluidSegments).toEqual([
      { indexes: [3, 4, 5], tanks: 0, extent: 3, pumps: [2], pumpRate: 1200 },
      { indexes: [0, 1], tanks: 0, extent: 2, pumps: [2], pumpRate: 1200 },
      { indexes: [6], tanks: 0, extent: 1, pumps: [], pumpRate: 0 }
    ])
  })

  it('joins pipes to ground within reach and storage tanks', () => {
    const r = report(
      blueprintOf([
        // Above ground west, then east, 6 tiles apart: one segment.
        ['pipe-to-ground', 0.5, 0.5, { direction: 12 }],
        ['pipe-to-ground', 6.5, 0.5, { direction: 4 }],
        // A tank whose east connection at (9, 1) points at (10, 1).
        ['storage-tank', 8.5, 0.5],
        ['pipe', 6.5, -0.5],
        ['pipe', 10.5, 1.5],
        // 12 tiles apart: beyond the reach of 10, two segments.
        ['pipe-to-ground', 0.5, 10.5, { direction: 12 }],
        ['pipe-to-ground', 12.5, 10.5, { direction: 4 }]
      ])
    )
    const sizes = r.fluidSegments.map((s) => s.indexes)
    expect(sizes).toContainEqual([0, 1])
    expect(sizes).toContainEqual([2, 3, 4])
    expect(sizes).toContainEqual([5])
    expect(sizes).toContainEqual([6])
    expect(r.fluidSegments.find((s) => s.tanks)).toMatchObject({ indexes: [2, 3, 4], tanks: 1 })
  })

  it('counts a legendary pump at 2.5 × 1200 units per second', () => {
    const r = report(
      blueprintOf([
        ['pump', 0.5, 1, { quality: 'legendary' }],
        ['pipe', 0.5, 2.5]
      ])
    )
    expect(r.fluidSegments[0]).toMatchObject({ pumps: [0], pumpRate: 3000 })
  })
})

describe('analyse', () => {
  it('needs game data', () => {
    expect(analyse(blueprintOf([['transport-belt', 0.5, 0.5]]), null).logistics).toBeNull()
  })

  it('checks inserters against the production rates', () => {
    const r = analyse(
      blueprintOf([
        ['assembling-machine-3', 0.5, 0.5, { recipe: 'iron-gear-wheel' }],
        ['inserter', 0.5, -1.5]
      ]),
      db
    )
    expect(r.logistics?.limits).toMatchObject([{ side: 'input', need: 5 }])
  })
})
