import { describe, expect, it } from 'vitest'
import { entityWirePoints } from './wires'

// Excerpts from the 2.1.25 data-raw-dump.json (shadow points shortened).
type Vecs = Record<string, [number, number]>
const point = (wire: Vecs): { wire: Vecs; shadow: Vecs } => ({ wire, shadow: wire })

describe('entityWirePoints', () => {
  it('reads electric pole connection_points, indexed by pole variation', () => {
    const smallPole = {
      connection_points: [
        point({ copper: [0, -2.578125], red: [0.40625, -2.53125], green: [-0.390625, -2.53125] }),
        point({ copper: [0.046875, -2.53125], red: [0.375, -2.375], green: [-0.1875, -2.796875] })
      ]
    }
    expect(entityWirePoints('electric-pole', smallPole)).toEqual({
      points: [
        { red: [0.40625, -2.53125], green: [-0.390625, -2.53125], copper: [0, -2.578125] },
        { red: [0.375, -2.375], green: [-0.1875, -2.796875], copper: [0.046875, -2.53125] }
      ],
      indexing: 'pole'
    })
  })

  it('keeps combinator input and output points apart', () => {
    const decider = {
      input_connection_points: [point({ red: [-0.265625, 0.484375], green: [0.28125, 0.46875] })],
      output_connection_points: [point({ red: [-0.28125, -0.671875], green: [0.3125, -0.65625] })]
    }
    expect(entityWirePoints('decider-combinator', decider)).toEqual({
      points: [{ red: [-0.265625, 0.484375], green: [0.28125, 0.46875] }],
      output: [{ red: [-0.28125, -0.671875], green: [0.3125, -0.65625] }]
    })
  })

  it('reads constant combinator circuit_wire_connection_points', () => {
    const constant = {
      circuit_wire_connection_points: [
        point({ red: [-0.265625, -0.546875], green: [0.21875, -0.546875] })
      ]
    }
    expect(entityWirePoints('constant-combinator', constant)?.points).toEqual([
      { red: [-0.265625, -0.546875], green: [0.21875, -0.546875] }
    ])
  })

  it('puts the power switch left copper with the circuit point and the right one in output', () => {
    const powerSwitch = {
      circuit_wire_connection_point: point({ red: [-0.53125, 0.90625], green: [-0.75, 0.90625] }),
      left_wire_connection_point: point({ copper: [-0.8125, -0.9375] }),
      right_wire_connection_point: point({ copper: [0.90625, -0.90625] })
    }
    expect(entityWirePoints('power-switch', powerSwitch)).toEqual({
      points: [{ red: [-0.53125, 0.90625], green: [-0.75, 0.90625], copper: [-0.8125, -0.9375] }],
      output: [{ copper: [0.90625, -0.90625] }]
    })
  })

  it('reads circuit_connector as one object or a list, plus the flipped list', () => {
    const chest = {
      circuit_connector: {
        sprites: {},
        points: point({ red: [0.34375, 0.203125], green: [0.40625, 0.421875] })
      }
    }
    expect(entityWirePoints('container', chest)).toEqual({
      points: [{ red: [0.34375, 0.203125], green: [0.40625, 0.421875] }]
    })
    const recycler = {
      circuit_connector: [{ points: point({ red: [0.90625, -0.3125] }) }],
      circuit_connector_flipped: [{ points: point({ red: [-0.875, -0.3125] }) }]
    }
    expect(entityWirePoints('furnace', recycler)).toEqual({
      points: [{ red: [0.90625, -0.3125] }],
      flipped: [{ red: [-0.875, -0.3125] }]
    })
  })

  it('reads rail signal connectors from the ground and elevated picture sets', () => {
    const signal = {
      ground_picture_set: { circuit_connector: [{ points: point({ red: [0.5625, 0.5] }) }] },
      elevated_picture_set: { circuit_connector: [{ points: point({ red: [0.5, 0.25] }) }] }
    }
    // Elevated signal points are raised 3 tiles, like the structure.
    expect(entityWirePoints('rail-signal', signal)).toEqual({
      points: [{ red: [0.5625, 0.5] }],
      elevated: [{ red: [0.5, -2.75] }]
    })
  })

  it('orders rail signal connectors by direction through the structure alignment table', () => {
    // 12 entries per direction; the elevated set skips every third of its 25 frames.
    const frames = [0, 1, 3, 4, 6, 7, 9, 10, 12, 13, 16, 17, 19, 20, 22, 23]
    const table = frames.flatMap((f) => [f, f, f, f, f, f, f, f, f, 24, 24, 24])
    const set = {
      structure_align_to_animation_index: table,
      circuit_connector: Array.from({ length: 25 }, (_, i) => ({ points: point({ red: [i, 3] }) }))
    }
    const points = entityWirePoints('rail-chain-signal', {
      ground_picture_set: set,
      elevated_picture_set: set
    })!
    expect(points.points.map((p) => p.red![0])).toEqual(frames)
    expect(points.elevated![2]).toEqual({ red: [3, 0] })
  })

  it('marks belts, pipes and loaders as indexed by shape or loader type', () => {
    const one = { circuit_connector: [{ points: point({ red: [0, 0] }) }] }
    expect(entityWirePoints('transport-belt', one)?.indexing).toBe('belt')
    expect(entityWirePoints('pipe', one)?.indexing).toBe('pipe')
    expect(entityWirePoints('heat-pipe', one)?.indexing).toBe('pipe')
    expect(entityWirePoints('loader-1x1', one)?.indexing).toBe('loader')
  })

  it('returns undefined without points', () => {
    expect(entityWirePoints('container', {})).toBeUndefined()
    expect(entityWirePoints('rail-signal', { ground_picture_set: {} })).toBeUndefined()
  })
})
