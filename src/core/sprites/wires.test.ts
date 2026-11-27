import { describe, expect, it } from 'vitest'
import {
  layoutBlueprint,
  type Blueprint,
  type BlueprintEntity,
  type BlueprintLayout
} from '../model'
import { buildPrototypeDb, dbPrototypeLookup } from '../prototypes/db'
import { entityWirePoints } from '../prototypes/wires'
import { pipePicture } from './shapes'
import {
  circuitConnector,
  circuitWiredEntities,
  pipeIndex,
  poleVariation,
  poleVariations,
  WIRE_SAG,
  wireCurve,
  wireEndpoint,
  wirePointIndex,
  wireSegments
} from './wires'

// Prototype excerpts from the Factorio 2.1.25 `data-raw-dump.json` (shadow
// points left out: they are not read).
const box = (r: number): number[][] => [
  [-r, -r],
  [r, r]
]
type Vecs = Record<string, [number, number]>
const wp = (wire: Vecs): { wire: Vecs } => ({ wire })
const RAW = {
  'electric-pole': {
    'small-electric-pole': {
      name: 'small-electric-pole',
      collision_box: box(0.15),
      connection_points: [
        wp({ copper: [0, -2.578125], red: [0.40625, -2.53125], green: [-0.390625, -2.53125] }),
        wp({ copper: [0.046875, -2.53125], red: [0.375, -2.375], green: [-0.1875, -2.796875] }),
        wp({ copper: [0.078125, -2.484375], red: [0.125, -2.21875], green: [0.15625, -2.796875] }),
        wp({ copper: [0.015625, -2.703125], red: [-0.328125, -2.546875], green: [0.25, -2.921875] })
      ]
    }
  },
  'decider-combinator': {
    'decider-combinator': {
      name: 'decider-combinator',
      collision_box: [
        [-0.35, -0.85],
        [0.35, 0.85]
      ],
      input_connection_points: [
        wp({ red: [-0.265625, 0.484375], green: [0.28125, 0.46875] }),
        wp({ red: [-0.703125, -0.578125], green: [-0.78125, -0.125] }),
        wp({ red: [0.265625, -0.609375], green: [-0.296875, -0.609375] }),
        wp({ red: [0.734375, -0.125], green: [0.8125, -0.59375] })
      ],
      output_connection_points: [
        wp({ red: [-0.28125, -0.671875], green: [0.3125, -0.65625] }),
        wp({ red: [0.609375, -0.53125], green: [0.71875, -0.109375] }),
        wp({ red: [0.296875, 0.53125], green: [-0.28125, 0.546875] }),
        wp({ red: [-0.59375, -0.125], green: [-0.703125, -0.53125] })
      ]
    }
  },
  'power-switch': {
    'power-switch': {
      name: 'power-switch',
      collision_box: box(0.7),
      circuit_wire_connection_point: wp({ red: [-0.53125, 0.90625], green: [-0.75, 0.90625] }),
      left_wire_connection_point: wp({ copper: [-0.8125, -0.9375] }),
      right_wire_connection_point: wp({ copper: [0.90625, -0.90625] })
    }
  },
  furnace: {
    recycler: {
      name: 'recycler',
      collision_box: [
        [-0.7, -1.2],
        [0.7, 1.2]
      ],
      circuit_connector: [0, 1, 2, 3].map((i) => ({ points: wp({ red: [i, 0.5] }) })),
      circuit_connector_flipped: [0, 1, 2, 3].map((i) => ({ points: wp({ red: [-i, 0.5] }) }))
    }
  },
  'rail-signal': {
    'rail-signal': {
      name: 'rail-signal',
      collision_box: box(0.2),
      ground_picture_set: {
        circuit_connector: Array.from({ length: 16 }, (_, i) => ({ points: wp({ red: [i, 0] }) }))
      },
      elevated_picture_set: {
        circuit_connector: Array.from({ length: 16 }, (_, i) => ({ points: wp({ red: [i, -3] }) }))
      }
    }
  },
  'transport-belt': {
    'transport-belt': {
      name: 'transport-belt',
      collision_box: box(0.4),
      circuit_connector: Array.from({ length: 7 }, (_, i) => ({ points: wp({ red: [i, 0] }) }))
    }
  },
  loader: {
    loader: {
      name: 'loader',
      collision_box: [
        [-0.4, -0.9],
        [0.4, 0.9]
      ],
      circuit_connector: Array.from({ length: 8 }, (_, i) => ({ points: wp({ red: [i, 0] }) }))
    }
  }
}

const db = buildPrototypeDb(RAW, { gameVersion: '2.1.25', mods: [] })

type E = Partial<BlueprintEntity> & { name: string; x: number; y: number }

function layoutOf(list: E[], wires: [number, number, number, number][] = []): BlueprintLayout {
  const entities = list.map(({ x, y, ...rest }, i) => ({
    entity_number: i + 1,
    position: { x, y },
    ...rest
  })) as BlueprintEntity[]
  return layoutBlueprint({ item: 'blueprint', entities, wires } as Blueprint, dbPrototypeLookup(db))
}

const N = 0
const E_ = 4
const S = 8
const W = 12

describe('poleVariation', () => {
  const c = { x: 0, y: 0 }
  it('is 0 for a north–south line and without wires', () => {
    expect(poleVariation(c, [])).toBe(0)
    expect(poleVariation(c, [{ x: 0, y: -7 }])).toBe(0)
    expect(poleVariation(c, [{ x: 0, y: 7 }])).toBe(0)
    expect(
      poleVariation(c, [
        { x: 0, y: -7 },
        { x: 0, y: 7 }
      ])
    ).toBe(0)
  })
  it('is 1 for north-east / south-west, 2 for east–west, 3 for north-west / south-east', () => {
    expect(poleVariation(c, [{ x: 5, y: -5 }])).toBe(1)
    expect(poleVariation(c, [{ x: -5, y: 5 }])).toBe(1)
    expect(poleVariation(c, [{ x: 7, y: 0 }])).toBe(2)
    expect(
      poleVariation(c, [
        { x: -7, y: 0 },
        { x: 7, y: 0 }
      ])
    ).toBe(2)
    expect(poleVariation(c, [{ x: -5, y: -5 }])).toBe(3)
    expect(poleVariation(c, [{ x: 5, y: 5 }])).toBe(3)
  })
  it('takes the rounded-down mean sector of several wires', () => {
    // North (0) and east (2): the diagonal between them.
    expect(
      poleVariation(c, [
        { x: 0, y: -7 },
        { x: 7, y: 0 }
      ])
    ).toBe(1)
  })
})

describe('poleVariations', () => {
  it('picks the variation of wired poles from their partners, keyed by layout index', () => {
    const layout = layoutOf(
      [
        { name: 'small-electric-pole', x: 0.5, y: 0.5 },
        { name: 'small-electric-pole', x: 7.5, y: 0.5 },
        { name: 'small-electric-pole', x: 0.5, y: 7.5 }
      ],
      [
        [1, 5, 2, 5],
        [1, 5, 3, 5]
      ]
    )
    const v = poleVariations(db, layout)
    expect(v.get(0)).toBe(1) // east + south: sectors 2 and 0
    expect(v.get(1)).toBe(2) // west
    expect(v.has(2)).toBe(false) // north: variation 0
  })
})

describe('wireEndpoint', () => {
  it('uses the pole point of its variation', () => {
    const [pole] = layoutOf([{ name: 'small-electric-pole', x: 0.5, y: 0.5 }]).entities
    expect(wireEndpoint(db, pole!, 5, 'copper')).toEqual([0.5, 0.5 - 2.578125])
    expect(wireEndpoint(db, pole!, 5, 'copper', { variation: 2 })).toEqual([
      0.5 + 0.078125,
      0.5 - 2.484375
    ])
    expect(wireEndpoint(db, pole!, 1, 'red', { variation: 3 })).toEqual([
      0.5 - 0.328125,
      0.5 - 2.546875
    ])
  })

  it('uses combinator input points for 1/2 and output points for 3/4, by direction / 4', () => {
    const entities = layoutOf(
      [N, E_, S, W].map((direction, i) => ({
        name: 'decider-combinator',
        x: i * 4,
        y: 0,
        direction
      }))
    ).entities
    expect(wireEndpoint(db, entities[0]!, 1, 'red')).toEqual([-0.265625, 0.484375])
    expect(wireEndpoint(db, entities[0]!, 4, 'green')).toEqual([0.3125, -0.65625])
    expect(wireEndpoint(db, entities[1]!, 2, 'green')).toEqual([4 - 0.78125, -0.125])
    expect(wireEndpoint(db, entities[2]!, 3, 'red')).toEqual([8 + 0.296875, 0.53125])
    expect(wireEndpoint(db, entities[3]!, 3, 'red')).toEqual([12 - 0.59375, -0.125])
  })

  it('uses the power switch left copper for 5 and the right one for 6', () => {
    const [ps] = layoutOf([{ name: 'power-switch', x: 1, y: 1 }]).entities
    expect(wireEndpoint(db, ps!, 5, 'copper')).toEqual([1 - 0.8125, 1 - 0.9375])
    expect(wireEndpoint(db, ps!, 6, 'copper')).toEqual([1 + 0.90625, 1 - 0.90625])
    expect(wireEndpoint(db, ps!, 2, 'green')).toEqual([1 - 0.75, 1 + 0.90625])
  })

  it('uses circuit_connector_flipped for mirrored entities', () => {
    const [plain, mirrored] = layoutOf([
      { name: 'recycler', x: 0, y: 0, direction: E_ },
      { name: 'recycler', x: 0, y: 0, direction: E_, mirror: true }
    ]).entities
    expect(wireEndpoint(db, plain!, 1, 'red')).toEqual([1, 0.5])
    expect(wireEndpoint(db, mirrored!, 1, 'red')).toEqual([-1, 0.5])
  })

  it('indexes rail signals by 16-way direction, from the elevated set on elevated rails', () => {
    const [ground, elevated] = layoutOf([
      { name: 'rail-signal', x: 0, y: 0, direction: 6 },
      { name: 'rail-signal', x: 0, y: 0, direction: 6, rail_layer: 'elevated' } as E
    ]).entities
    expect(wireEndpoint(db, ground!, 1, 'red')).toEqual([6, 0])
    expect(wireEndpoint(db, elevated!, 1, 'red')).toEqual([6, -6]) // raised 3 tiles
  })

  it('falls back to small offsets around the centre without points or game data', () => {
    const [d] = layoutOf([{ name: 'decider-combinator', x: 0, y: 0, direction: E_ }]).entities
    // North-facing fallback: input red [-0.2, 0.1], output red [-0.2, -0.3]; turned east.
    expect(wireEndpoint(null, d!, 1, 'red')).toEqual([-0.1, -0.2])
    expect(wireEndpoint(null, d!, 3, 'red')).toEqual([0.3, -0.2])
    // Red, green and copper never share a point.
    const ends = [1, 2, 5].map((c) => wireEndpoint(null, d!, c, 'red').join())
    expect(new Set(ends).size).toBe(3)
    // Known prototype without points for that colour: also the fallback.
    const [pole] = layoutOf([{ name: 'power-switch', x: 0, y: 0 }]).entities
    expect(wireEndpoint(db, pole!, 6, 'red')).toEqual([0.3, -0.15])
  })
})

describe('wirePointIndex', () => {
  const proto = db.entities['transport-belt']!.wirePoints!
  const [belt] = layoutOf([{ name: 'transport-belt', x: 0.5, y: 0.5, direction: E_ }]).entities

  it('picks belt connectors X, H, V, SE, SW, NE, NW from the belt sheet row', () => {
    expect(wirePointIndex(proto, 7, belt!)).toBe(1) // straight east: H
    expect(wirePointIndex(proto, 7, { ...belt!, direction: N })).toBe(2) // V
    expect(wirePointIndex(proto, 7, belt!, { shape: { belts: [{ index: 4 }] } })).toBe(5) // east_to_north: NE
    expect(wirePointIndex(proto, 7, belt!, { shape: { belts: [{ index: 6 }] } })).toBe(6) // west_to_north: NW
    expect(wirePointIndex(proto, 7, belt!, { shape: { belts: [{ index: 9 }] } })).toBe(3) // east_to_south: SE
    expect(wirePointIndex(proto, 7, belt!, { shape: { belts: [{ index: 11 }] } })).toBe(4) // west_to_south: SW
  })

  it('picks output loaders from the first four and input loaders from the last four', () => {
    const loader = db.entities['loader']!.wirePoints!
    const [out, inp] = layoutOf([
      { name: 'loader', x: 0.5, y: 1, direction: S, type: 'output' } as E,
      { name: 'loader', x: 0.5, y: 1, direction: S, type: 'input' } as E
    ]).entities
    expect(wirePointIndex(loader, 8, out!)).toBe(2)
    expect(wirePointIndex(loader, 8, inp!)).toBe(6)
  })

  it('falls back to entry 0 when the index is out of range', () => {
    const [d] = layoutOf([{ name: 'decider-combinator', x: 0, y: 0, direction: W }]).entities
    expect(wirePointIndex({ points: [{}] }, 1, d!)).toBe(0)
    expect(wirePointIndex({ points: [{}, {}], indexing: 'pole' }, 2, d!, { variation: 3 })).toBe(0)
  })
})

describe('pipeIndex', () => {
  it('is the bitmask of connected sides (up 1, right 2, down 4, left 8) for every pipe and heat pipe piece', () => {
    for (let mask = 0; mask < 16; mask++) {
      const sides = new Set([0, 4, 8, 12].filter((_, i) => mask & (1 << i)))
      expect(pipeIndex(pipePicture(sides, false))).toBe(mask)
      expect(pipeIndex(pipePicture(sides, true))).toBe(mask)
    }
  })
})

describe('wireCurve', () => {
  it('sags down by up to WIRE_SAG, and keeps vertical wires straight', () => {
    const [c1, c2] = wireCurve([0, 0], [10, 0])
    expect(c1).toEqual([2, WIRE_SAG])
    expect(c2).toEqual([8, WIRE_SAG])
    // Right to left sags down too.
    expect(wireCurve([10, 0], [0, 0])[0][1]).toBeCloseTo(WIRE_SAG)
    // Short wires sag less.
    expect(wireCurve([0, 0], [1.5, 0])[0][1]).toBeCloseTo(WIRE_SAG / 2)
    expect(wireCurve([0, 0], [0, 10])).toEqual([
      [0, 2],
      [0, 8]
    ])
  })
})

describe('wireSegments', () => {
  it('draws wires between entities in the blueprint, with a box around the sag', () => {
    const layout = layoutOf(
      [
        { name: 'small-electric-pole', x: 0.5, y: 0.5 },
        { name: 'small-electric-pole', x: 7.5, y: 0.5 },
        { name: 'decider-combinator', x: 3, y: 3 }
      ],
      [
        [1, 5, 2, 5],
        [1, 1, 3, 3],
        [1, 5, 9, 5], // entity 9 is not in the blueprint
        [1, 7, 2, 7] // unknown connector: no colour
      ]
    )
    const segments = wireSegments(db, layout)
    expect(segments.map((s) => s.color)).toEqual(['copper', 'red'])
    const [copper] = segments
    // Both poles see the other east or west: variation 2.
    expect(copper!.a).toEqual([0.5 + 0.078125, 0.5 - 2.484375])
    expect(copper!.b).toEqual([7.5 + 0.078125, 0.5 - 2.484375])
    expect(copper!.box.bottom).toBeGreaterThan(copper!.a[1] + 0.5)
    // Without game data the same wires are drawn from the fallback offsets.
    expect(wireSegments(null, layout)).toHaveLength(2)
  })
})

describe('circuit connectors', () => {
  const sprite = (x: number): Record<string, unknown> => ({
    filename: '__base__/graphics/entity/circuit-connector/ccm-universal-04a-base-sequence.png',
    width: 52,
    height: 50,
    scale: 0.5,
    x,
    y: 150,
    shift: [0.09375, 0.203125]
  })
  const points = entityWirePoints('rail-signal', {
    ground_picture_set: {
      circuit_connector: Array.from({ length: 16 }, (_, i) => ({
        sprites: { connector_main: sprite(i), led_red: sprite(99) },
        points: wp({ red: [0, 0] })
      }))
    },
    elevated_picture_set: {
      circuit_connector: Array.from({ length: 16 }, (_, i) => ({
        sprites: { connector_main: sprite(i) },
        points: wp({ red: [0, 0] })
      }))
    }
  })!

  it('lists the entities with red or green wires on connector 1 or 2', () => {
    const wires = layoutOf(
      [],
      [
        [1, 1, 2, 2],
        [3, 5, 4, 5],
        [5, 3, 6, 4]
      ]
    ).wires
    expect([...circuitWiredEntities(wires)].sort()).toEqual([1, 2])
  })

  it('draws the connector sprite at the wire point index, raised on elevated rails, without LEDs', () => {
    const [ground, elevated] = layoutOf([
      { name: 'rail-signal', x: 0.5, y: 0.5, direction: 4 },
      { name: 'rail-signal', x: 0.5, y: 0.5, direction: 4, rail_layer: 'elevated' } as E
    ]).entities
    const a = circuitConnector(points, ground!)!
    expect(a.key).toBe('c4')
    expect(a.layers().map((l) => [l.rect.x, l.shift[1]])).toEqual([[4, 0.203125]])
    const b = circuitConnector(points, elevated!)!
    expect(b.key).toBe('c4e')
    expect(b.layers().map((l) => l.shift[1])).toEqual([0.203125 - 3])
  })

  it('is null without connector sprites', () => {
    const [d] = layoutOf([{ name: 'decider-combinator', x: 0, y: 0 }]).entities
    expect(circuitConnector(db.entities['decider-combinator']!.wirePoints!, d!)).toBeNull()
  })
})
