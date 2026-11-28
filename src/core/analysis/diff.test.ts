import { describe, expect, it } from 'vitest'
import type { Blueprint } from '../model'
import type { PrototypeLookup } from '../prototypes'
import { alignmentOffset, diffBlueprints, jsonEqual } from './diff'
import { compare } from './index'
import { blueprintOf, powerDb } from './test-db'

const TYPES: Record<string, [string, number]> = {
  'transport-belt': ['transport-belt', 1],
  'fast-transport-belt': ['transport-belt', 1],
  inserter: ['inserter', 1],
  'stack-inserter': ['inserter', 1],
  'bulk-inserter': ['inserter', 1],
  'iron-chest': ['container', 1],
  'assembling-machine-2': ['assembling-machine', 3],
  'assembling-machine-3': ['assembling-machine', 3],
  'small-electric-pole': ['electric-pole', 1]
}

const lookup: PrototypeLookup = (name) => {
  const t = TYPES[name]
  return t ? { type: t[0], width: t[1], height: t[1] } : undefined
}

describe('jsonEqual', () => {
  it('ignores key order but not array order', () => {
    expect(jsonEqual({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 })).toBe(true)
    expect(jsonEqual({ a: [1, 2] }, { a: [2, 1] })).toBe(false)
    expect(jsonEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false)
    expect(jsonEqual([], {})).toBe(false)
    expect(jsonEqual(null, {})).toBe(false)
  })
})

describe('alignmentOffset', () => {
  it('finds the shift that lines up the most entities', () => {
    const before = blueprintOf([
      ['iron-chest', 0.5, 0.5],
      ['inserter', 1.5, 0.5],
      ['transport-belt', 2.5, 0.5]
    ])
    const after = blueprintOf([
      ['iron-chest', -1.5, 1.5],
      ['inserter', -0.5, 1.5],
      ['transport-belt', 0.5, 1.5],
      ['transport-belt', 5.5, 5.5]
    ])
    expect(alignmentOffset(before.entities!, after.entities!)).toEqual({ x: -2, y: 1 })
  })

  it('keeps no shift when nothing lines up better', () => {
    const before = blueprintOf([['iron-chest', 0.5, 0.5]])
    const after = blueprintOf([['inserter', 4.5, 4.5]])
    expect(alignmentOffset(before.entities!, after.entities!)).toEqual({ x: 0, y: 0 })
    const same = blueprintOf([['iron-chest', 0.5, 0.5]])
    expect(alignmentOffset(same.entities!, same.entities!)).toEqual({ x: 0, y: 0 })
  })

  it('prefers the smaller shift on a tie', () => {
    // A row of identical belts: shifting by one tile matches all but one, no shift matches all.
    const row = blueprintOf([
      ['transport-belt', 0.5, 0.5],
      ['transport-belt', 1.5, 0.5],
      ['transport-belt', 2.5, 0.5]
    ])
    expect(alignmentOffset(row.entities!, row.entities!)).toEqual({ x: 0, y: 0 })
  })
})

describe('diffBlueprints', () => {
  it('reports no changes for the same blueprint', () => {
    const bp = blueprintOf(
      [
        ['iron-chest', 0.5, 0.5],
        ['inserter', 1.5, 0.5, { direction: 4 }]
      ],
      { wires: [[1, 1, 2, 1]] }
    )
    const diff = diffBlueprints(bp, structuredCloneJson(bp), lookup)
    expect(diff).toMatchObject({
      offset: { x: 0, y: 0 },
      added: [],
      removed: [],
      changed: [],
      unchanged: 2,
      wires: { added: [], removed: [] },
      fields: []
    })
  })

  it('finds added, removed and changed entities', () => {
    const before = blueprintOf([
      ['iron-chest', 0.5, 0.5],
      ['inserter', 1.5, 0.5, { direction: 4 }],
      ['transport-belt', 2.5, 0.5]
    ])
    const after = blueprintOf([
      ['inserter', 1.5, 0.5, { direction: 12 }],
      ['transport-belt', 2.5, 0.5],
      ['small-electric-pole', 1.5, 1.5]
    ])
    const diff = diffBlueprints(before, after, lookup)
    expect(diff.added).toEqual([2])
    expect(diff.removed).toEqual([0])
    expect(diff.changed).toEqual([{ before: 1, after: 0, fields: ['direction'] }])
    expect(diff.unchanged).toBe(1)
  })

  it('ignores entity_number and key order', () => {
    const before = blueprintOf([
      ['iron-chest', 0.5, 0.5, { bar: 3 }],
      ['inserter', 1.5, 0.5]
    ])
    const after: Blueprint = {
      ...before,
      entities: [
        { name: 'inserter', position: { x: 1.5, y: 0.5 }, entity_number: 1 },
        { bar: 3, name: 'iron-chest', position: { y: 0.5, x: 0.5 }, entity_number: 2 }
      ]
    }
    const diff = diffBlueprints(before, after, lookup)
    expect(diff.changed).toEqual([])
    expect(diff.unchanged).toBe(2)
  })

  it('matches a replaced prototype of the same type as a change', () => {
    const before = blueprintOf([
      ['stack-inserter', 0.5, 0.5],
      ['assembling-machine-2', 3.5, 3.5, { recipe: 'gear' }]
    ])
    const after = blueprintOf([
      ['bulk-inserter', 0.5, 0.5],
      ['assembling-machine-3', 3.5, 3.5, { recipe: 'gear', quality: 'rare' }]
    ])
    const diff = diffBlueprints(before, after, lookup)
    expect(diff.changed).toEqual([
      { before: 0, after: 0, fields: ['name'] },
      { before: 1, after: 1, fields: ['name', 'quality'] }
    ])
  })

  it('does not match different types at one position', () => {
    const before = blueprintOf([['iron-chest', 0.5, 0.5]])
    const after = blueprintOf([['inserter', 0.5, 0.5]])
    const diff = diffBlueprints(before, after, lookup)
    expect(diff.added).toEqual([0])
    expect(diff.removed).toEqual([0])
  })

  it('prefers the identical entity when several share a position', () => {
    // Two inserters stacked (invalid in game, but strings can hold it).
    const before = blueprintOf([
      ['inserter', 0.5, 0.5, { direction: 4 }],
      ['inserter', 0.5, 0.5, { direction: 8 }]
    ])
    const after = blueprintOf([['inserter', 0.5, 0.5, { direction: 8 }]])
    const diff = diffBlueprints(before, after, lookup)
    expect(diff.removed).toEqual([0])
    expect(diff.changed).toEqual([])
  })

  it('compares through the alignment offset', () => {
    const before = blueprintOf([
      ['iron-chest', 0.5, 0.5],
      ['inserter', 1.5, 0.5]
    ])
    const after = blueprintOf([
      ['iron-chest', 1.5, 1.5],
      ['inserter', 2.5, 1.5, { direction: 4 }],
      ['transport-belt', 0.5, 0.5]
    ])
    const diff = diffBlueprints(before, after, lookup)
    expect(diff.offset).toEqual({ x: 1, y: 1 })
    expect(diff.added).toEqual([2])
    expect(diff.changed).toEqual([{ before: 1, after: 1, fields: ['direction'] }])
  })

  it('compares wires through matched entities, whatever the numbering', () => {
    const before = blueprintOf(
      [
        ['iron-chest', 0.5, 0.5],
        ['inserter', 1.5, 0.5],
        ['small-electric-pole', 2.5, 0.5]
      ],
      {
        wires: [
          [1, 1, 2, 1],
          [2, 2, 3, 2]
        ]
      }
    )
    // Same entities in another order; the red wire is kept (ends swapped), the green one moved.
    const after = blueprintOf(
      [
        ['small-electric-pole', 2.5, 0.5],
        ['inserter', 1.5, 0.5],
        ['iron-chest', 0.5, 0.5]
      ],
      {
        wires: [
          [2, 1, 3, 1],
          [1, 2, 3, 2]
        ]
      }
    )
    const diff = diffBlueprints(before, after, lookup)
    expect(diff.wires).toEqual({ added: [1], removed: [1] })
    expect(diff.changed).toEqual([
      { before: 2, after: 0, fields: ['wires'] },
      { before: 1, after: 1, fields: ['wires'] },
      { before: 0, after: 2, fields: ['wires'] }
    ])
  })

  it('counts a wire to a removed entity as removed', () => {
    const before = blueprintOf(
      [
        ['iron-chest', 0.5, 0.5],
        ['inserter', 1.5, 0.5]
      ],
      { wires: [[1, 1, 2, 1]] }
    )
    const after = blueprintOf([['iron-chest', 0.5, 0.5]])
    const diff = diffBlueprints(before, after, lookup)
    expect(diff.wires).toEqual({ added: [], removed: [0] })
    expect(diff.removed).toEqual([1])
    expect(diff.changed).toEqual([{ before: 0, after: 0, fields: ['wires'] }])
  })

  it('diffs tiles and blueprint fields', () => {
    const tile = (
      name: string,
      x: number,
      y: number
    ): { name: string; position: { x: number; y: number } } => ({
      name,
      position: { x, y }
    })
    const before = blueprintOf([], {
      label: 'A',
      version: 1,
      tiles: [tile('concrete', 0, 0), tile('concrete', 1, 0), tile('stone-path', 2, 0)]
    })
    const after = blueprintOf([], {
      label: 'B',
      version: 2,
      tiles: [tile('concrete', 0, 0), tile('refined-concrete', 1, 0), tile('concrete', 5, 0)]
    })
    const diff = diffBlueprints(before, after, lookup)
    expect(diff.tiles).toEqual({ added: 1, removed: 1, changed: 1 })
    expect(diff.fields).toEqual(['label'])
  })
})

describe('compare', () => {
  it('groups rows for the UI and works without game data', () => {
    const before = blueprintOf([
      ['iron-chest', 0.5, 0.5],
      ['iron-chest', 1.5, 0.5],
      ['stack-inserter', 2.5, 0.5]
    ])
    const after = blueprintOf([
      ['bulk-inserter', 2.5, 0.5],
      ['transport-belt', 3.5, 0.5],
      ['transport-belt', 4.5, 0.5]
    ])
    const report = compare(before, after, null)
    expect(report.counts).toEqual({ added: 2, removed: 2, changed: 1, unchanged: 0 })
    expect(report.added).toEqual([{ name: 'transport-belt', count: 2, indexes: [1, 2] }])
    expect(report.removed).toEqual([{ name: 'iron-chest', count: 2, indexes: [] }])
    expect(report.changed).toEqual([
      { name: 'bulk-inserter', from: 'stack-inserter', fields: ['name'], count: 1, indexes: [0] }
    ])
    expect(report.removedBoxes).toEqual([
      { left: 0, top: 0, right: 1, bottom: 1 },
      { left: 1, top: 0, right: 2, bottom: 1 }
    ])
    expect(report.addedIndexes).toEqual([1, 2])
    expect(report.changedIndexes).toEqual([0])
    expect(report.power).toBeNull()
    expect(report.production).toBeNull()
    // Without game data entity names stand in for items.
    expect(report.materials.map((m) => [m.name, m.before, m.after])).toEqual([
      ['iron-chest', 2, 0],
      ['transport-belt', 0, 2],
      ['bulk-inserter', 0, 1],
      ['stack-inserter', 1, 0]
    ])
  })

  it('shifts removed boxes into the after coordinates', () => {
    const before = blueprintOf([
      ['iron-chest', 0.5, 0.5],
      ['inserter', 1.5, 0.5],
      ['transport-belt', 2.5, 0.5]
    ])
    const after = blueprintOf([
      ['iron-chest', 10.5, 0.5],
      ['inserter', 11.5, 0.5]
    ])
    expect(compare(before, after, null).removedBoxes).toEqual([
      { left: 12, top: 0, right: 13, bottom: 1 }
    ])
  })

  it('reports power deltas with game data', () => {
    const before = blueprintOf([['assembling-machine-3', 1.5, 1.5]])
    const after = blueprintOf([
      ['assembling-machine-3', 1.5, 1.5],
      ['assembling-machine-3', 4.5, 1.5]
    ])
    const report = compare(before, after, powerDb)
    expect(report.power?.peak.after).toBeCloseTo(2 * report.power!.peak.before)
    expect(report.power?.peak.before).toBeGreaterThan(0)
    expect(report.production).toEqual([])
  })
})

function structuredCloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
