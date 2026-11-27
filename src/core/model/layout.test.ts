import { describe, expect, it } from 'vitest'
import { SpatialIndex } from '../geometry'
import type { PrototypeLookup } from '../prototypes/sizes'
import { layoutBlueprint } from './layout'
import type { Blueprint } from './schema'

const lookup: PrototypeLookup = (name) =>
  ({
    'assembling-machine-3': { type: 'assembling-machine', width: 3, height: 3 },
    splitter: { type: 'splitter', width: 2, height: 1 },
    inserter: { type: 'inserter', width: 1, height: 1 },
    locomotive: { type: 'locomotive', width: 2, height: 6 }
  })[name]

const bp = (entities: Blueprint['entities'], extra: Partial<Blueprint> = {}): Blueprint => ({
  item: 'blueprint',
  version: 1,
  entities,
  ...extra
})

describe('layoutBlueprint', () => {
  it('places footprints around entity centres', () => {
    const layout = layoutBlueprint(
      bp([{ entity_number: 1, name: 'assembling-machine-3', position: { x: 1.5, y: 1.5 } }]),
      lookup
    )
    expect(layout.entities[0]).toMatchObject({
      box: { left: 0, top: 0, right: 3, bottom: 3 },
      category: 'machine',
      known: true,
      directional: false
    })
    expect(layout.bounds).toEqual({ left: 0, top: 0, right: 3, bottom: 3 })
  })

  it('rotates non-square footprints for east/west', () => {
    const layout = layoutBlueprint(
      bp([
        { entity_number: 1, name: 'splitter', position: { x: 1, y: 0.5 } },
        { entity_number: 2, name: 'splitter', position: { x: 5.5, y: 1 }, direction: 4 }
      ]),
      lookup
    )
    expect(layout.entities.map((e) => e.box)).toEqual([
      { left: 0, top: 0, right: 2, bottom: 1 },
      { left: 5, top: 0, right: 6, bottom: 2 }
    ])
    expect(layout.entities[1]!.directional).toBe(true)
  })

  it('lays rolling stock along its orientation', () => {
    const layout = layoutBlueprint(
      bp([
        { entity_number: 1, name: 'locomotive', position: { x: 0, y: 0 }, orientation: 0 },
        { entity_number: 2, name: 'locomotive', position: { x: 0, y: 10 }, orientation: 0.25 }
      ]),
      lookup
    )
    expect(layout.entities.map((e) => [e.size, e.direction, e.directional])).toEqual([
      [{ width: 2, height: 6 }, 0, true],
      [{ width: 6, height: 2 }, 4, true]
    ])
  })

  it('marks unknown prototypes and gives them a 1×1 footprint', () => {
    const layout = layoutBlueprint(
      bp([{ entity_number: 1, name: 'kr-steel-pipe', position: { x: 0.5, y: 0.5 } }]),
      lookup
    )
    expect(layout.entities[0]).toMatchObject({ known: false, category: 'unknown' })
    expect(layout.entities[0]!.box).toEqual({ left: 0, top: 0, right: 1, bottom: 1 })
    expect(layout.unknownNames).toEqual(['kr-steel-pipe'])
  })

  it('includes tiles in the bounds and handles empty blueprints', () => {
    const layout = layoutBlueprint(
      bp([], { tiles: [{ name: 'concrete', position: { x: -3, y: 4 } }] }),
      lookup
    )
    expect(layout.tiles).toEqual([{ name: 'concrete', x: -3, y: 4 }])
    expect(layout.bounds).toEqual({ left: -3, top: 4, right: -2, bottom: 5 })
    expect(layoutBlueprint(bp(undefined), lookup).bounds).toBeNull()
  })
})

describe('SpatialIndex', () => {
  it('finds items by area and point, across cell boundaries, without duplicates', () => {
    const index = new SpatialIndex<string>(4)
    index.insert({ left: 0, top: 0, right: 3, bottom: 3 }, 'a')
    index.insert({ left: 2, top: 2, right: 10, bottom: 3 }, 'wide') // spans 3 cells
    index.insert({ left: -5, top: -5, right: -4, bottom: -4 }, 'neg')
    expect(index.size).toBe(3)
    expect(index.query({ left: 0, top: 0, right: 12, bottom: 12 }).sort()).toEqual(['a', 'wide'])
    expect(index.query({ left: -6, top: -6, right: 0, bottom: 0 })).toEqual(['neg'])
    expect(index.queryPoint({ x: 2.5, y: 2.5 }).sort()).toEqual(['a', 'wide'])
    expect(index.queryPoint({ x: 9.9, y: 2.5 })).toEqual(['wide'])
    expect(index.queryPoint({ x: 3, y: 0 })).toEqual([]) // right edge is exclusive
  })

  it('does not put a box ending on a cell boundary into the next cell', () => {
    const index = new SpatialIndex<string>(4)
    index.insert({ left: 0, top: 0, right: 4, bottom: 4 }, 'cell')
    expect(index.query({ left: 4, top: 0, right: 8, bottom: 4 })).toEqual([])
  })
})
