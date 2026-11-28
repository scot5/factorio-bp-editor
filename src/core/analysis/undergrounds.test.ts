import { describe, expect, it } from 'vitest'
import { fallbackPrototypeLookup } from '../prototypes'
import { layoutBlueprint } from '../model'
import { blueprintOf } from './test-db'
import { undergroundLines } from './undergrounds'

const TYPES: Record<string, string> = {
  'underground-belt': 'underground-belt',
  'fast-underground-belt': 'underground-belt',
  'pipe-to-ground': 'pipe-to-ground'
}

interface Summary {
  type: string
  name: string
  pairs: number[][]
  unpaired: number[]
}

const lines = (entities: Parameters<typeof blueprintOf>[0]): Summary[] =>
  undergroundLines(
    layoutBlueprint(blueprintOf(entities), fallbackPrototypeLookup),
    (name) => TYPES[name]
  ).map((l) => ({
    type: l.type,
    name: l.name,
    pairs: l.pairs.map((p) => [p.start.index, p.end.index, p.distance]),
    unpaired: l.unpaired.map((e) => e.index)
  }))

describe('undergroundLines', () => {
  it('pairs underground belts along their flow, nesting like brackets', () => {
    // Flowing east: input 0, input 1, output 2, output 3.
    expect(
      lines([
        ['underground-belt', 0.5, 0.5, { direction: 4, type: 'input' }],
        ['underground-belt', 2.5, 0.5, { direction: 4, type: 'input' }],
        ['underground-belt', 4.5, 0.5, { direction: 4, type: 'output' }],
        ['underground-belt', 7.5, 0.5, { direction: 4, type: 'output' }]
      ])
    ).toEqual([
      {
        type: 'underground-belt',
        name: 'underground-belt',
        pairs: [
          [1, 2, 2],
          [0, 3, 7]
        ],
        unpaired: []
      }
    ])
  })

  it('keeps names, rows and directions apart, and reports lone ends', () => {
    const result = lines([
      ['underground-belt', 0.5, 0.5, { direction: 4, type: 'input' }],
      ['fast-underground-belt', 3.5, 0.5, { direction: 4, type: 'output' }],
      ['underground-belt', 3.5, 1.5, { direction: 4, type: 'output' }],
      ['underground-belt', 0.5, 2.5, { direction: 12, type: 'input' }]
    ])
    expect(result.flatMap((l) => l.pairs)).toEqual([])
    expect(result.flatMap((l) => l.unpaired).sort()).toEqual([0, 1, 2, 3])
  })

  it('pairs pipes to ground that face away from each other', () => {
    expect(
      lines([
        ['pipe-to-ground', 0.5, 0.5, { direction: 0 }],
        ['pipe-to-ground', 0.5, 5.5, { direction: 8 }],
        ['pipe-to-ground', 0.5, 7.5, { direction: 8 }]
      ])
    ).toEqual([
      { type: 'pipe-to-ground', name: 'pipe-to-ground', pairs: [[0, 1, 5]], unpaired: [2] }
    ])
  })
})
