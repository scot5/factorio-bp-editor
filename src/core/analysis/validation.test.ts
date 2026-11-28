import { describe, expect, it } from 'vitest'
import { layoutBlueprint, type Blueprint } from '../model'
import {
  buildPrototypeDb,
  dbPrototypeLookup,
  fallbackPrototypeLookup,
  type PrototypeDb
} from '../prototypes'
import { blueprintOf, modules } from './test-db'
import {
  collisionBoxAt,
  validation,
  warningText,
  type ValidationReport,
  type ValidationWarning
} from './validation'
import type { PowerReport } from './power'
import type { ProductionReport } from './production'

const box = (w: number, h: number = w): number[][] => [
  [-w / 2 + 0.1, -h / 2 + 0.1],
  [w / 2 - 0.1, h / 2 - 0.1]
]

const OBJECT = { layers: { object: true, item: true, player: true } }
const BELT = { layers: { object: true, floor: true, transport_belt: true } }

/** A small 2.1.25-shaped excerpt with collision masks for the validation tests. */
const db: PrototypeDb = buildPrototypeDb(
  {
    'utility-constants': {
      default: {
        name: 'default',
        default_collision_masks: {
          'assembling-machine': OBJECT,
          furnace: OBJECT,
          beacon: OBJECT,
          inserter: OBJECT,
          container: OBJECT,
          'electric-pole': OBJECT,
          'transport-belt': BELT,
          'underground-belt': BELT,
          'pipe-to-ground': { layers: { object: true, floor: true } },
          'straight-rail': { layers: { rail: true, floor: true, object: true } },
          'simple-entity-with-owner': { layers: { doodad: true } }
        }
      }
    },
    'assembling-machine': {
      'assembling-machine-2': {
        name: 'assembling-machine-2',
        collision_box: box(3),
        crafting_categories: ['crafting', 'advanced-crafting'],
        module_slots: 2,
        allowed_effects: ['consumption', 'speed', 'productivity', 'pollution', 'quality'],
        energy_source: { type: 'electric' }
      },
      foundry: {
        name: 'foundry',
        collision_box: box(5),
        crafting_categories: ['metallurgy'],
        module_slots: 4,
        allowed_effects: ['consumption', 'speed', 'productivity', 'pollution', 'quality'],
        energy_source: { type: 'electric' }
      }
    },
    beacon: {
      beacon: {
        name: 'beacon',
        collision_box: box(3),
        module_slots: 2,
        allowed_effects: ['consumption', 'speed', 'pollution'],
        allowed_module_categories: ['speed', 'efficiency', 'productivity'],
        energy_source: { type: 'electric' }
      }
    },
    inserter: {
      inserter: { name: 'inserter', collision_box: box(1, 1), circuit_wire_max_distance: 9 }
    },
    container: {
      'iron-chest': { name: 'iron-chest', collision_box: box(1), circuit_wire_max_distance: 9 }
    },
    'electric-pole': {
      'small-electric-pole': {
        name: 'small-electric-pole',
        collision_box: box(1),
        maximum_wire_distance: 7.5,
        supply_area_distance: 2.5
      }
    },
    'transport-belt': {
      'transport-belt': { name: 'transport-belt', collision_box: box(1), speed: 0.03125 }
    },
    'underground-belt': {
      'underground-belt': {
        name: 'underground-belt',
        collision_box: box(1),
        max_distance: 5,
        speed: 0.03125
      },
      'fast-underground-belt': {
        name: 'fast-underground-belt',
        collision_box: box(1),
        max_distance: 7,
        speed: 0.0625
      }
    },
    'pipe-to-ground': {
      'pipe-to-ground': {
        name: 'pipe-to-ground',
        collision_box: box(1),
        fluid_box: {
          pipe_connections: [
            { direction: 0, position: [0, 0] },
            {
              direction: 8,
              position: [0, 0],
              connection_type: 'underground',
              max_underground_distance: 10
            }
          ]
        }
      }
    },
    'straight-rail': { 'straight-rail': { name: 'straight-rail', collision_box: box(2) } },
    'simple-entity-with-owner': {
      decal: { name: 'decal', collision_box: box(1) },
      crate: {
        name: 'crate',
        collision_box: box(1),
        collision_mask: { layers: { object: true }, not_colliding_with_itself: true }
      }
    },
    recipe: {
      'iron-gear-wheel': {
        name: 'iron-gear-wheel',
        allow_productivity: true,
        ingredients: [{ type: 'item', name: 'iron-plate', amount: 2 }],
        results: [{ type: 'item', name: 'iron-gear-wheel', amount: 1 }]
      },
      'casting-iron': {
        name: 'casting-iron',
        category: 'metallurgy',
        allow_productivity: true,
        allow_quality: false,
        results: [{ type: 'item', name: 'iron-plate', amount: 2 }]
      },
      'speed-only': {
        name: 'speed-only',
        allow_productivity: true,
        allowed_module_categories: ['speed']
      },
      'iron-chest': { name: 'iron-chest' },
      'parameter-0': { name: 'parameter-0', category: 'parameters' }
    },
    item: {
      'iron-plate': { name: 'iron-plate' },
      'iron-gear-wheel': { name: 'iron-gear-wheel' },
      coal: { name: 'coal', fuel_value: '4MJ', fuel_category: 'chemical' }
    },
    module: {
      'speed-module': {
        name: 'speed-module',
        category: 'speed',
        effect: { speed: 0.2, consumption: 0.5, quality: -0.1 }
      },
      'productivity-module': {
        name: 'productivity-module',
        category: 'productivity',
        effect: { productivity: 0.04, consumption: 0.4, pollution: 0.05, speed: -0.05 }
      },
      'quality-module': {
        name: 'quality-module',
        category: 'quality',
        effect: { quality: 0.1, speed: -0.05 }
      }
    },
    fluid: { water: { name: 'water' } },
    'virtual-signal': { 'signal-A': { name: 'signal-A' } },
    quality: {
      normal: { name: 'normal', level: 0 },
      rare: { name: 'rare', level: 2 }
    },
    tile: { concrete: { name: 'concrete' } }
  } as never,
  { gameVersion: '2.1.25', mods: [] }
)

type Entities = Parameters<typeof blueprintOf>[0]

function check(
  entities: Entities,
  extra: Partial<Blueprint> = {},
  data: PrototypeDb | null = db
): ValidationReport {
  const bp = blueprintOf(entities, extra)
  const layout = layoutBlueprint(bp, data ? dbPrototypeLookup(data) : fallbackPrototypeLookup)
  return validation(data, layout)
}

const codes = (r: ValidationReport): string[] => r.warnings.map((w) => w.code)
const only = (r: ValidationReport, code: string): ValidationWarning[] =>
  r.warnings.filter((w) => w.code === code)

describe('collisionBoxAt', () => {
  it('rotates the box clockwise per quarter turn', () => {
    const b = collisionBoxAt(
      [
        [-1, -0.5],
        [1, 0.5]
      ],
      { x: 10, y: 20 },
      4
    )
    expect(b.left).toBeCloseTo(9.5)
    expect(b.right).toBeCloseTo(10.5)
    expect(b.top).toBeCloseTo(19)
    expect(b.bottom).toBeCloseTo(21)
  })
})

describe('validation: overlap', () => {
  it('flags entities whose collision boxes overlap on a shared layer', () => {
    const r = check([
      ['assembling-machine-2', 1.5, 1.5],
      ['inserter', 2.5, 2.5],
      ['inserter', 3.5, 0.5]
    ])
    expect(only(r, 'overlap')).toEqual([
      {
        code: 'overlap',
        severity: 'error',
        kind: 'entity',
        name: 'assembling-machine-2',
        related: { kind: 'entity', name: 'inserter' },
        count: 1,
        indexes: [0, 1]
      }
    ])
  })

  it('ignores touching boxes, other layers, not_colliding_with_itself and rails', () => {
    const r = check([
      ['iron-chest', 0.5, 0.5],
      ['iron-chest', 1.5, 0.5],
      ['decal', 1.5, 0.5],
      ['crate', 5.5, 5.5],
      ['crate', 5.5, 5.5],
      ['straight-rail', 10, 10],
      ['straight-rail', 10, 10]
    ])
    expect(only(r, 'overlap')).toEqual([])
  })

  it('collides layers with each other, not with themselves only', () => {
    const r = check([
      ['crate', 0.5, 0.5],
      ['iron-chest', 0.5, 0.5]
    ])
    expect(only(r, 'overlap')).toHaveLength(1)
  })

  it('uses footprints without game data', () => {
    const r = check(
      [
        ['assembling-machine-2', 1.5, 1.5],
        ['transport-belt', 2.5, 2.5],
        ['transport-belt', 3.5, 2.5]
      ],
      {},
      null
    )
    expect(only(r, 'overlap').map((w) => [w.name, w.related?.name, w.count])).toEqual([
      ['assembling-machine-2', 'transport-belt', 1]
    ])
  })
})

describe('validation: undergrounds', () => {
  const ug = (type: 'input' | 'output', direction = 4): Record<string, unknown> => ({
    type,
    direction
  })

  it('pairs an input with the output ahead of it within reach', () => {
    const r = check([
      ['underground-belt', 0.5, 0.5, ug('input')],
      ['underground-belt', 5.5, 0.5, ug('output')]
    ])
    expect(codes(r).filter((c) => c.startsWith('underground'))).toEqual([])
  })

  it('reports ends beyond max_distance that a longer tier could bridge', () => {
    const r = check([
      ['underground-belt', 0.5, 0.5, ug('input')],
      ['underground-belt', 6.5, 0.5, ug('output')]
    ])
    expect(only(r, 'underground-too-far')).toMatchObject([
      { severity: 'error', name: 'underground-belt', value: 6, limit: 5, count: 1, indexes: [0, 1] }
    ])
  })

  it('counts ends beyond every tier as unpaired', () => {
    const r = check([
      ['underground-belt', 0.5, 0.5, ug('input')],
      ['underground-belt', 8.5, 0.5, ug('output')]
    ])
    expect(only(r, 'underground-too-far')).toEqual([])
    expect(only(r, 'underground-unpaired')).toMatchObject([{ count: 2, indexes: [0, 1] }])
  })

  it('reports unpaired ends: an output with no input behind it, an input with no output ahead', () => {
    const r = check([
      ['underground-belt', 0.5, 0.5, ug('output')],
      ['underground-belt', 3.5, 0.5, ug('input')],
      // another line (the next row), a valid pair facing west
      ['underground-belt', 3.5, 2.5, ug('input', 12)],
      ['underground-belt', 0.5, 2.5, ug('output', 12)]
    ])
    expect(only(r, 'underground-unpaired')).toMatchObject([
      { severity: 'warning', name: 'underground-belt', count: 2, indexes: [0, 1] }
    ])
  })

  it('nests ends like brackets', () => {
    const r = check([
      ['underground-belt', 0.5, 0.5, ug('input')],
      ['underground-belt', 1.5, 0.5, ug('input')],
      ['underground-belt', 2.5, 0.5, ug('output')],
      ['underground-belt', 3.5, 0.5, ug('output')]
    ])
    expect(codes(r).filter((c) => c.startsWith('underground'))).toEqual([])
  })

  it('pairs pipes to ground facing away from each other; unpaired ones are info', () => {
    const r = check([
      ['pipe-to-ground', 0.5, 0.5, { direction: 0 }],
      ['pipe-to-ground', 0.5, 10.5, { direction: 8 }],
      ['pipe-to-ground', 5.5, 0.5, { direction: 12 }],
      ['pipe-to-ground', 16.5, 0.5, { direction: 4 }],
      ['pipe-to-ground', 20.5, 20.5, { direction: 8 }]
    ])
    // 11 apart: beyond the only pipe-to-ground's reach, so both ends are unpaired
    expect(only(r, 'underground-too-far')).toEqual([])
    expect(only(r, 'underground-unpaired')).toMatchObject([
      { severity: 'info', count: 3, indexes: [2, 3, 4] }
    ])
  })

  it('pairs without game data, without a distance limit', () => {
    const r = check(
      [
        ['underground-belt', 0.5, 0.5, ug('input')],
        ['underground-belt', 9.5, 0.5, ug('output')],
        ['underground-belt', 0.5, 4.5, ug('input')]
      ],
      {},
      null
    )
    expect(only(r, 'underground-too-far')).toEqual([])
    expect(only(r, 'underground-unpaired')).toMatchObject([{ indexes: [2] }])
  })
})

describe('validation: recipes and modules', () => {
  it('flags a recipe whose categories the machine cannot craft', () => {
    const r = check([
      ['assembling-machine-2', 1.5, 1.5, { recipe: 'casting-iron' }],
      ['foundry', 10.5, 10.5, { recipe: 'casting-iron' }],
      ['assembling-machine-2', 20.5, 1.5, { recipe: 'parameter-0' }]
    ])
    expect(only(r, 'invalid-recipe')).toEqual([
      {
        code: 'invalid-recipe',
        severity: 'error',
        kind: 'recipe',
        name: 'casting-iron',
        related: { kind: 'entity', name: 'assembling-machine-2' },
        detail: 'category',
        count: 1,
        indexes: [0]
      }
    ])
  })

  it('flags more modules than slots', () => {
    const r = check([
      ['assembling-machine-2', 1.5, 1.5, { items: [modules('speed-module', 3, 4)] }]
    ])
    expect(only(r, 'invalid-module')).toMatchObject([
      { kind: 'entity', name: 'assembling-machine-2', detail: 'slots', value: 3, limit: 2 }
    ])
  })

  it('flags beneficial effects the machine or recipe forbids, never penalties', () => {
    const r = check([
      // productivity in a beacon: the machine forbids it
      ['beacon', 1.5, 1.5, { items: [modules('productivity-module', 1, 1)] }],
      // quality in a recipe with allow_quality false; the speed module's quality penalty is fine
      [
        'foundry',
        10.5,
        10.5,
        {
          recipe: 'casting-iron',
          items: [modules('quality-module', 1, 4), modules('speed-module', 2, 4)]
        }
      ],
      // productivity in a recipe without allow_productivity
      [
        'assembling-machine-2',
        20.5,
        1.5,
        { recipe: 'iron-chest', items: [modules('productivity-module', 2, 4)] }
      ]
    ])
    expect(
      only(r, 'invalid-module').map((w) => [w.name, w.related?.name, w.detail, w.count])
    ).toEqual([
      ['productivity-module', 'beacon', 'productivity', 1],
      ['productivity-module', 'iron-chest', 'productivity', 2],
      ['quality-module', 'casting-iron', 'quality', 1]
    ])
  })

  it('flags module categories the machine or recipe does not allow', () => {
    const r = check([
      ['beacon', 1.5, 1.5, { items: [modules('quality-module', 1, 1)] }],
      [
        'assembling-machine-2',
        10.5,
        1.5,
        { recipe: 'speed-only', items: [modules('productivity-module', 1, 4)] }
      ]
    ])
    expect(only(r, 'invalid-module').map((w) => [w.name, w.related?.name, w.detail])).toEqual([
      ['productivity-module', 'speed-only', 'category'],
      ['quality-module', 'beacon', 'category'],
      ['quality-module', 'beacon', 'quality']
    ])
  })
})

describe('validation: wires', () => {
  const wire = (a: number, b: number, connector = 5): [number, number, number, number] => [
    a,
    connector,
    b,
    connector
  ]

  it('flags wires longer than the shorter reach: pole centres, else selection box gaps', () => {
    const r = check(
      [
        ['small-electric-pole', 0.5, 0.5],
        ['small-electric-pole', 8.5, 0.5],
        ['small-electric-pole', 8.5, 7.5],
        ['iron-chest', 8.5, 16.5]
      ],
      { wires: [wire(1, 2), wire(2, 3), wire(3, 4, 1)] }
    )
    expect(only(r, 'wire-out-of-reach')).toEqual([
      expect.objectContaining({
        name: 'iron-chest',
        related: { kind: 'entity', name: 'small-electric-pole' },
        value: expect.closeTo(8.2, 3) as number,
        limit: 7.5
      }),
      {
        code: 'wire-out-of-reach',
        severity: 'error',
        kind: 'entity',
        name: 'small-electric-pole',
        related: { kind: 'entity', name: 'small-electric-pole' },
        value: 8,
        limit: 7.5,
        count: 1,
        indexes: [0, 1]
      }
    ])
  })

  it('measures a pole to another entity between their boxes', () => {
    // 8 between centres, 7.2 between the boxes
    const r = check(
      [
        ['small-electric-pole', 0.5, 0.5],
        ['iron-chest', 8.5, 0.5]
      ],
      { wires: [wire(1, 2, 1)] }
    )
    expect(only(r, 'wire-out-of-reach')).toEqual([])
  })

  it('adds the quality wire reach bonus of poles', () => {
    const r = check(
      [
        ['small-electric-pole', 0.5, 0.5, { quality: 'rare' }],
        ['small-electric-pole', 10.5, 0.5, { quality: 'rare' }]
      ],
      { wires: [wire(1, 2)] }
    )
    expect(only(r, 'wire-out-of-reach')).toEqual([])
  })
})

describe('validation: unknown prototypes and qualities', () => {
  it('names unknown entities, recipes, items, signals and tiles', () => {
    const r = check(
      [
        ['kr-thing', 0.5, 0.5],
        [
          'assembling-machine-2',
          5.5,
          5.5,
          { recipe: 'rocket-control-unit', items: [modules('uranium-rifle-magazine', 1, 4)] }
        ],
        [
          'inserter',
          9.5,
          0.5,
          {
            control_behavior: {
              circuit_condition: { first_signal: { name: 'rocket-control-unit' }, constant: 5 }
            },
            filters: [
              { index: 1, name: 'iron-plate' },
              { index: 2, name: 'old-item' }
            ]
          }
        ]
      ],
      {
        tiles: [
          { name: 'modded-tile', position: { x: 0, y: 0 } },
          { name: 'concrete', position: { x: 1, y: 0 } }
        ]
      }
    )
    expect(
      only(r, 'unknown-prototype').map((w) => [w.kind, w.name, w.detail, w.count, w.indexes])
    ).toEqual([
      ['entity', 'kr-thing', undefined, 1, [0]],
      ['tile', 'modded-tile', undefined, 1, []],
      ['item', 'old-item', 'signal', 1, [2]],
      ['recipe', 'rocket-control-unit', undefined, 1, [1]],
      ['item', 'rocket-control-unit', 'signal', 1, [2]],
      ['item', 'uranium-rifle-magazine', undefined, 1, [1]]
    ])
  })

  it('checks signal types against fluids and virtual signals', () => {
    const r = check([
      [
        'inserter',
        0.5,
        0.5,
        {
          control_behavior: {
            circuit_condition: {
              first_signal: { type: 'virtual', name: 'signal-A' },
              second_signal: { type: 'fluid', name: 'water' }
            },
            logistic_condition: { first_signal: { type: 'virtual', name: 'signal-Z' } },
            other: { type: 'space-location', name: 'nauvis' }
          }
        }
      ]
    ])
    expect(only(r, 'unknown-prototype').map((w) => [w.kind, w.name])).toEqual([
      ['virtual-signal', 'signal-Z']
    ])
  })

  it('flags quality levels the game data does not define', () => {
    const r = check([
      [
        'assembling-machine-2',
        1.5,
        1.5,
        { quality: 'mythic', recipe: 'iron-gear-wheel', recipe_quality: 'rare' }
      ],
      [
        'iron-chest',
        5.5,
        5.5,
        {
          items: [
            {
              id: { name: 'coal', quality: 'mythic' },
              items: { in_inventory: [{ inventory: 1, stack: 0 }] }
            }
          ]
        }
      ]
    ])
    expect(
      only(r, 'quality-unavailable').map((w) => [w.kind, w.name, w.quality, w.severity])
    ).toEqual([
      ['entity', 'assembling-machine-2', 'mythic', 'warning'],
      ['item', 'coal', 'mythic', 'warning']
    ])
  })

  it('needs game data', () => {
    expect(codes(check([['kr-thing', 0.5, 0.5]], {}, null))).toEqual([])
  })
})

describe('validation: dangling belts', () => {
  it('marks belts that point into nothing or into a belt facing them', () => {
    const r = check([
      ['transport-belt', 0.5, 0.5, { direction: 4 }],
      ['transport-belt', 1.5, 0.5, { direction: 4 }],
      // side-loads onto the belt above it
      ['transport-belt', 1.5, 1.5, { direction: 0 }],
      ['transport-belt', 5.5, 5.5, { direction: 4 }],
      ['transport-belt', 6.5, 5.5, { direction: 12 }]
    ])
    expect(only(r, 'dangling-belt')).toEqual([
      {
        code: 'dangling-belt',
        severity: 'info',
        kind: 'entity',
        name: 'transport-belt',
        count: 3,
        indexes: [1, 3, 4]
      }
    ])
  })
})

describe('validation: report', () => {
  it('passes unpowered entities and surface conditions through, sorted by severity', () => {
    const bp = blueprintOf([
      ['iron-chest', 0.5, 0.5],
      ['iron-chest', 0.5, 0.5]
    ])
    const layout = layoutBlueprint(bp, dbPrototypeLookup(db))
    const power = {
      unpowered: [{ name: 'inserter', count: 2, indexes: [4, 5] }]
    } as unknown as PowerReport
    const production = {
      surfaceWarnings: [
        { recipe: 'casting-iron', property: 'pressure', value: 1000, min: 4000, indexes: [7] }
      ]
    } as unknown as ProductionReport
    const r = validation(db, layout, { power, production })
    expect(r.warnings.map((w) => [w.severity, w.code, w.name])).toEqual([
      ['error', 'overlap', 'iron-chest'],
      ['warning', 'invalid-recipe', 'casting-iron'],
      ['warning', 'unpowered', 'inserter']
    ])
    expect(r.warnings[1]).toMatchObject({ detail: 'pressure', value: 1000, limit: 4000, count: 1 })
    expect(r.counts).toEqual({ error: 1, warning: 3, info: 0 })
  })
})

describe('warningText', () => {
  const nameOf = (r: { kind: string; name: string }): string => `<${r.name}>`
  const w = (extra: Partial<ValidationWarning>): ValidationWarning => ({
    code: 'overlap',
    severity: 'error',
    kind: 'entity',
    name: 'a',
    count: 1,
    indexes: [],
    ...extra
  })

  it.each([
    [
      w({ code: 'unknown-prototype', kind: 'recipe', name: 'rcu' }),
      'Unknown recipe <rcu>',
      undefined
    ],
    [
      w({ code: 'unknown-prototype', kind: 'virtual-signal', name: 's', detail: 'signal' }),
      'Unknown signal <s> (in settings)',
      undefined
    ],
    [
      w({ code: 'quality-unavailable', quality: 'mythic' }),
      '<a>: unknown quality mythic',
      undefined
    ],
    [w({ related: { kind: 'entity', name: 'b' } }), '<a> overlaps <b>', undefined],
    [
      w({
        code: 'invalid-recipe',
        kind: 'recipe',
        related: { kind: 'entity', name: 'm' },
        detail: 'category'
      }),
      "<a> can't be made in <m>",
      undefined
    ],
    [
      w({ code: 'invalid-recipe', detail: 'pressure', value: 1000, limit: 4000 }),
      '<a> needs pressure ≥ 4000',
      '1000 / 4000'
    ],
    [
      w({ code: 'invalid-recipe', detail: 'gravity', value: 10, limit: 0 }),
      '<a> needs gravity ≤ 0',
      '10 / 0'
    ],
    [
      w({ code: 'invalid-module', detail: 'slots', value: 3, limit: 2 }),
      '<a>: more modules than slots',
      '3 / 2'
    ],
    [
      w({ code: 'invalid-module', detail: 'category', related: { kind: 'entity', name: 'b' } }),
      '<a> not allowed in <b>',
      undefined
    ],
    [
      w({ code: 'invalid-module', detail: 'productivity', related: { kind: 'recipe', name: 'r' } }),
      '<a>: productivity not allowed by <r>',
      undefined
    ],
    [w({ code: 'unpowered' }), '<a> outside pole coverage', undefined],
    [
      w({
        code: 'wire-out-of-reach',
        related: { kind: 'entity', name: 'b' },
        value: 9.6153,
        limit: 9
      }),
      'Wire <a> – <b> too long',
      '9.6 / 9'
    ],
    [w({ code: 'underground-too-far', value: 9, limit: 7 }), '<a> ends too far apart', '9 / 7'],
    [w({ code: 'underground-unpaired' }), '<a> without its other end', undefined],
    [w({ code: 'dangling-belt' }), '<a> ends without feeding anything', undefined]
  ])('%#: %s', (warning, text, value) => {
    expect(warningText(warning, nameOf)).toEqual(value === undefined ? { text } : { text, value })
  })
})
