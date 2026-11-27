import { describe, expect, it } from 'vitest'
import { entityConnections, placeConnection } from './connections'

// Excerpts from the Factorio 2.1.25 `data-raw-dump.json`.

describe('entityConnections', () => {
  it('collects every fluid box, including output and energy-source boxes (boiler)', () => {
    const boiler = {
      fluid_box: {
        pipe_connections: [
          { flow_direction: 'input-output', direction: 12, position: [-1, 0.5] },
          { flow_direction: 'input-output', direction: 4, position: [1, 0.5] }
        ]
      },
      output_fluid_box: {
        pipe_connections: [{ flow_direction: 'output', direction: 0, position: [0, -0.5] }]
      },
      energy_source: { type: 'burner' }
    }
    expect(entityConnections(boiler)).toEqual({
      fluid: [
        { position: [-1, 0.5], direction: 12 },
        { position: [1, 0.5], direction: 4 },
        { position: [0, -0.5], direction: 0 }
      ]
    })
  })

  it('skips underground connections (pipe-to-ground)', () => {
    const p2g = {
      fluid_box: {
        pipe_connections: [
          { direction: 0, position: [0, 0] },
          { connection_type: 'underground', direction: 8, position: [0, 0] }
        ]
      }
    }
    expect(entityConnections(p2g)?.fluid).toEqual([{ position: [0, 0], direction: 0 }])
  })

  it('marks the role of boxes that switch off without a fluid recipe', () => {
    const assembler = {
      fluid_boxes_off_when_no_fluid_recipe: true,
      fluid_boxes: [
        { production_type: 'input', pipe_connections: [{ direction: 0, position: [0, -1] }] },
        { production_type: 'output', pipe_connections: [{ direction: 8, position: [0, 1] }] }
      ]
    }
    expect(entityConnections(assembler)?.fluid).toEqual([
      { position: [0, -1], direction: 0, production: 'input' },
      { position: [0, 1], direction: 8, production: 'output' }
    ])
  })

  it('keeps non-default connection categories (fusion reactor)', () => {
    const reactor = {
      fluid_boxes: [
        {
          pipe_connections: [
            { direction: 0, position: [0, -2], connection_category: ['fusion-reactor'] },
            { direction: 8, position: [0, 2], connection_category: 'default' }
          ]
        }
      ]
    }
    expect(entityConnections(reactor)?.fluid).toEqual([
      { position: [0, -2], direction: 0, categories: ['fusion-reactor'] },
      { position: [0, 2], direction: 8 }
    ])
  })

  it('reads heat connections from the heat buffer and heat energy sources', () => {
    expect(
      entityConnections({ heat_buffer: { connections: [{ position: [-2, -2], direction: 0 }] } })
    ).toEqual({ heat: [{ position: [-2, -2], direction: 0 }] })
    expect(
      entityConnections({
        energy_source: { type: 'heat', connections: [{ position: [0, 0.5], direction: 8 }] }
      })
    ).toEqual({ heat: [{ position: [0, 0.5], direction: 8 }] })
  })

  it('returns undefined without connections', () => {
    expect(entityConnections({ name: 'wooden-chest' })).toBeUndefined()
  })
})

describe('placeConnection', () => {
  it('rotates the position and direction clockwise with the facing', () => {
    const point = { position: [0, -1] as [number, number], direction: 0 }
    expect(placeConnection(point, 0)).toEqual({ position: [0, -1], direction: 0 })
    expect(placeConnection(point, 4)).toEqual({ position: [1, 0], direction: 4 })
    expect(placeConnection(point, 8)).toEqual({ position: [0, 1], direction: 8 })
    expect(placeConnection(point, 12)).toEqual({ position: [-1, 0], direction: 12 })
  })

  it('mirrors left to right before rotating (mirror: true)', () => {
    // A chemical plant input at the bottom left, pointing down.
    const point = { position: [-1, 1] as [number, number], direction: 8 }
    expect(placeConnection(point, 0, true)).toEqual({ position: [1, 1], direction: 8 })
    // East-facing: unmirrored at (-1, -1); mirrored at (-1, 1), still pointing left.
    expect(placeConnection(point, 4)).toEqual({ position: [-1, -1], direction: 12 })
    expect(placeConnection(point, 4, true)).toEqual({ position: [-1, 1], direction: 12 })
    // A side connection flips its direction.
    const side = { position: [1, 0] as [number, number], direction: 4 }
    expect(placeConnection(side, 0, true)).toEqual({ position: [-1, 0], direction: 12 })
    expect(placeConnection(side, 4, true)).toEqual({ position: [0, -1], direction: 0 })
  })

  it('uses per-facing positions when given (pumpjack)', () => {
    const [point] = entityConnections({
      fluid_box: {
        pipe_connections: [
          {
            direction: 0,
            positions: [
              [1, -2],
              [2, -1],
              [-1, 2],
              [-2, 1]
            ]
          }
        ]
      }
    })!.fluid!
    expect(placeConnection(point!, 4)).toEqual({ position: [2, -1], direction: 4 })
  })
})
