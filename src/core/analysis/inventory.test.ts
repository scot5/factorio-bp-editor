import { describe, expect, it } from 'vitest'
import { layoutBlueprint, type Blueprint } from '../model'
import {
  buildPrototypeDb,
  dbPrototypeLookup,
  fallbackPrototypeLookup,
  type PrototypeDb
} from '../prototypes'
import { analyse } from './index'
import { inventory, materialsText, placingItems } from './inventory'

const box = (w: number, h: number): number[][] => [
  [-w / 2 + 0.1, -h / 2 + 0.1],
  [w / 2 - 0.1, h / 2 - 0.1]
]

const db: PrototypeDb = buildPrototypeDb(
  {
    'assembling-machine': {
      'assembling-machine-2': { name: 'assembling-machine-2', collision_box: box(3, 3) }
    },
    'transport-belt': { 'transport-belt': { name: 'transport-belt', collision_box: box(1, 1) } },
    'curved-rail-a': {
      'curved-rail-a': {
        name: 'curved-rail-a',
        collision_box: box(2, 5),
        placeable_by: { item: 'rail', count: 3 }
      }
    },
    'rail-ramp': { 'rail-ramp': { name: 'rail-ramp', collision_box: box(4, 16) } },
    item: {
      'assembling-machine-2': {
        name: 'assembling-machine-2',
        place_result: 'assembling-machine-2'
      },
      'transport-belt': { name: 'transport-belt', place_result: 'transport-belt' },
      // A second item placing the same entity: the same-named item wins.
      'belt-kit': { name: 'belt-kit', place_result: 'transport-belt' },
      rail: { name: 'rail' },
      concrete: { name: 'concrete', place_as_tile: { result: 'concrete' } },
      'hazard-concrete': {
        name: 'hazard-concrete',
        place_as_tile: { result: 'hazard-concrete-left' }
      }
    },
    module: { 'speed-module-2': { name: 'speed-module-2', category: 'speed' } },
    tile: {
      concrete: { name: 'concrete' },
      'hazard-concrete-left': { name: 'hazard-concrete-left' },
      'hazard-concrete-right': {
        name: 'hazard-concrete-right',
        placeable_by: { item: 'hazard-concrete', count: 1 }
      }
    }
  } as never,
  { gameVersion: '2.1.25', mods: [] }
)

const blueprint: Blueprint = {
  item: 'blueprint',
  version: 562954250027018,
  entities: [
    { entity_number: 1, name: 'assembling-machine-2', position: { x: 1.5, y: 1.5 } },
    {
      entity_number: 2,
      name: 'assembling-machine-2',
      position: { x: 4.5, y: 1.5 },
      quality: 'rare',
      items: [
        {
          id: { name: 'speed-module-2' },
          items: {
            in_inventory: [
              { inventory: 4, stack: 0 },
              { inventory: 4, stack: 1, count: 1 }
            ]
          }
        }
      ]
    },
    { entity_number: 3, name: 'transport-belt', position: { x: 0.5, y: 3.5 } },
    { entity_number: 4, name: 'transport-belt', position: { x: 1.5, y: 3.5 }, quality: 'normal' },
    { entity_number: 5, name: 'curved-rail-a', position: { x: 10, y: 10 } },
    { entity_number: 6, name: 'rail-ramp', position: { x: 20, y: 20 } },
    { entity_number: 7, name: 'kr-steel-pipe', position: { x: 0.5, y: 5.5 } }
  ],
  tiles: [
    { name: 'concrete', position: { x: 0, y: 0 } },
    { name: 'concrete', position: { x: 1, y: 0 } },
    { name: 'hazard-concrete-left', position: { x: 2, y: 0 } },
    { name: 'hazard-concrete-right', position: { x: 3, y: 0 } },
    { name: 'kr-tile', position: { x: 4, y: 0 } }
  ]
}

describe('placingItems', () => {
  it('prefers placeable_by, then the same-named item, then any place_result', () => {
    expect(placingItems(db, 'curved-rail-a')).toEqual([{ item: 'rail', count: 3 }])
    expect(placingItems(db, 'transport-belt')).toEqual([{ item: 'transport-belt', count: 1 }])
    expect(placingItems(db, 'rail-ramp')).toBeUndefined()
  })
})

describe('inventory', () => {
  const report = inventory(blueprint, layoutBlueprint(blueprint, dbPrototypeLookup(db)), db)

  it('counts entities by name and quality, with their indexes', () => {
    expect(report.entityCount).toBe(7)
    expect(report.entities).toEqual([
      { name: 'transport-belt', count: 2, indexes: [2, 3] },
      { name: 'assembling-machine-2', count: 1, indexes: [0] },
      { name: 'assembling-machine-2', quality: 'rare', count: 1, indexes: [1] },
      { name: 'curved-rail-a', count: 1, indexes: [4] },
      { name: 'kr-steel-pipe', count: 1, indexes: [6] },
      { name: 'rail-ramp', count: 1, indexes: [5] }
    ])
  })

  it('counts tiles by name', () => {
    expect(report.tileCount).toBe(5)
    expect(report.tiles[0]).toEqual({ name: 'concrete', count: 2 })
  })

  it('builds the bill of materials from placing items, insert plans and tiles', () => {
    expect(report.materials).toEqual(
      [
        { item: 'hazard-concrete', count: 2, sources: ['tile'], indexes: [] },
        { item: 'concrete', count: 2, sources: ['tile'], indexes: [] },
        { item: 'speed-module-2', count: 2, sources: ['insert-plan'], indexes: [1] },
        { item: 'rail', count: 3, sources: ['entity'], indexes: [4] },
        { item: 'transport-belt', count: 2, sources: ['entity'], indexes: [2, 3] },
        { item: 'assembling-machine-2', count: 1, sources: ['entity'], indexes: [0] },
        {
          item: 'assembling-machine-2',
          quality: 'rare',
          count: 1,
          sources: ['entity'],
          indexes: [1]
        },
        { item: 'kr-steel-pipe', count: 1, sources: ['entity'], indexes: [6], guessed: true },
        { item: 'kr-tile', count: 1, sources: ['tile'], indexes: [], guessed: true }
      ].sort((a, b) => b.count - a.count || a.item.localeCompare(b.item))
    )
  })

  it('lists known entities that no item places', () => {
    expect(report.unplaceable).toEqual([{ name: 'rail-ramp', count: 1, indexes: [5] }])
  })

  it('measures the footprint', () => {
    expect(report.footprint.width).toBeGreaterThan(20)
    // 2 machines × 9, 2 belts, the unknown 1×1 marker, 5 tiles (two overlap a machine), rails.
    const smallParts = 18 + 2 + 1 + 3
    expect(report.footprint.occupiedTiles).toBeGreaterThan(smallParts)
  })

  it('formats the bill of materials as text', () => {
    expect(materialsText(report).split('\n')).toContain('1 × assembling-machine-2 (rare)')
    expect(materialsText(report, (n) => n.toUpperCase()).split('\n')[0]).toBe('3 × RAIL')
  })
})

describe('inventory without game data', () => {
  const report = inventory(blueprint, layoutBlueprint(blueprint, fallbackPrototypeLookup), null)

  it('uses entity and tile names as items, marked guessed', () => {
    expect(report.unplaceable).toEqual([])
    expect(report.materials.find((m) => m.item === 'curved-rail-a')).toMatchObject({
      count: 1,
      guessed: true
    })
    expect(report.materials.find((m) => m.item === 'speed-module-2')?.guessed).toBeUndefined()
    expect(report.materials.find((m) => m.item === 'hazard-concrete-left')?.guessed).toBe(true)
  })
})

describe('analyse', () => {
  it('runs the reports with or without game data', () => {
    expect(analyse(blueprint, db).hasGameData).toBe(true)
    const bare = analyse({ item: 'blueprint', version: 0 }, null)
    expect(bare.hasGameData).toBe(false)
    expect(bare.inventory).toMatchObject({
      entityCount: 0,
      materials: [],
      footprint: { width: 0, height: 0, occupiedTiles: 0 }
    })
  })
})
