import { describe, expect, it } from 'vitest'
import { buildPrototypeDb, dbPrototypeLookup, DB_FORMAT_VERSION, iconCategoryFor } from './db'

// A tiny excerpt in the shape of data-raw-dump.json.
const raw = {
  'assembling-machine': {
    'assembling-machine-2': {
      type: 'assembling-machine',
      name: 'assembling-machine-2',
      collision_box: [
        [-1.2, -1.2],
        [1.2, 1.2]
      ],
      selection_box: [
        [-1.5, -1.5],
        [1.5, 1.5]
      ]
    }
  },
  splitter: {
    splitter: {
      type: 'splitter',
      name: 'splitter',
      collision_box: [
        { x: -0.9, y: -0.4 },
        { x: 0.9, y: 0.4 }
      ]
    }
  },
  container: {
    'wooden-chest': {
      type: 'container',
      name: 'wooden-chest',
      collision_box: [
        [-0.35, -0.35],
        [0.35, 0.35]
      ],
      picture: {
        layers: [
          {
            filename: '__base__/graphics/entity/wooden-chest/wooden-chest.png',
            priority: 'extra-high',
            width: 62,
            height: 72,
            shift: [0.015625, -0.0625],
            scale: 0.5
          }
        ]
      },
      open_sound: { filename: '__base__/sound/open.ogg' }
    }
  },
  corpse: {
    'assembling-machine-2-remnants': {
      name: 'assembling-machine-2-remnants',
      collision_box: [
        [-1, -1],
        [1, 1]
      ]
    }
  },
  item: {
    'iron-plate': { name: 'iron-plate', stack_size: 100, subgroup: 'raw-material', order: 'a' },
    'assembling-machine-2': {
      name: 'assembling-machine-2',
      stack_size: 50,
      place_result: 'assembling-machine-2'
    }
  },
  module: { 'speed-module': { name: 'speed-module', stack_size: 50 } },
  recipe: {
    'iron-gear-wheel': {
      name: 'iron-gear-wheel',
      ingredients: [{ type: 'item', name: 'iron-plate', amount: 2 }],
      results: [{ type: 'item', name: 'iron-gear-wheel', amount: 1 }]
    },
    'basic-oil-processing': {
      name: 'basic-oil-processing',
      category: 'oil-processing',
      energy_required: 5,
      ingredients: [{ type: 'fluid', name: 'crude-oil', amount: 100 }],
      results: [{ type: 'fluid', name: 'petroleum-gas', amount: 45 }]
    },
    legacy: { name: 'legacy', ingredients: [['iron-plate', 3]], results: [] }
  },
  fluid: { water: { name: 'water' }, 'crude-oil': { name: 'crude-oil' } },
  'virtual-signal': { 'signal-A': { name: 'signal-A' } },
  quality: {
    normal: { name: 'normal', level: 0, color: { r: 0.7, g: 0.7, b: 0.7 } },
    rare: { name: 'rare', level: 2, color: [17, 115, 242] }
  },
  tile: { concrete: { name: 'concrete' } }
}

describe('buildPrototypeDb', () => {
  const db = buildPrototypeDb(raw as never, {
    gameVersion: '2.1.25',
    mods: [{ name: 'base', version: '2.1.25' }]
  })

  it('records metadata', () => {
    expect(db.formatVersion).toBe(DB_FORMAT_VERSION)
    expect(db.gameVersion).toBe('2.1.25')
    expect(db.mods).toEqual([{ name: 'base', version: '2.1.25' }])
  })

  it('keeps blueprintable entities with sizes and boxes, in both vector notations', () => {
    expect(db.entities['assembling-machine-2']).toEqual({
      type: 'assembling-machine',
      width: 3,
      height: 3,
      collisionBox: [
        [-1.2, -1.2],
        [1.2, 1.2]
      ],
      selectionBox: [
        [-1.5, -1.5],
        [1.5, 1.5]
      ]
    })
    expect(db.entities['splitter']).toMatchObject({ width: 2, height: 1 })
    expect(db.entities['assembling-machine-2-remnants']).toBeUndefined()
  })

  it('stores normalised graphics for covered types only', () => {
    expect(db.entities['wooden-chest']!.graphics).toEqual([
      {
        node: {
          kind: 'sprite',
          file: '__base__/graphics/entity/wooden-chest/wooden-chest.png',
          width: 62,
          height: 72,
          shift: [0.015625, -0.0625],
          scale: 0.5
        }
      }
    ])
    expect(db.entities['splitter']!.graphics).toBeUndefined()
  })

  it('collects items of every item type', () => {
    expect(db.items['iron-plate']).toEqual({
      type: 'item',
      stackSize: 100,
      subgroup: 'raw-material',
      order: 'a'
    })
    expect(db.items['assembling-machine-2']!.placeResult).toBe('assembling-machine-2')
    expect(db.items['speed-module']!.type).toBe('module')
  })

  it('normalises recipes, with defaults and the short ingredient form', () => {
    expect(db.recipes['iron-gear-wheel']).toEqual({
      category: 'crafting',
      energy: 0.5,
      ingredients: [{ type: 'item', name: 'iron-plate', amount: 2 }],
      results: [{ type: 'item', name: 'iron-gear-wheel', amount: 1 }]
    })
    expect(db.recipes['basic-oil-processing']!.ingredients[0]!.type).toBe('fluid')
    expect(db.recipes['legacy']!.ingredients).toEqual([
      { type: 'item', name: 'iron-plate', amount: 3 }
    ])
  })

  it('lists fluids, signals, tiles and qualities', () => {
    expect(db.fluids).toEqual(['crude-oil', 'water'])
    expect(db.virtualSignals).toEqual(['signal-A'])
    expect(db.tiles).toEqual(['concrete'])
    expect(db.qualities).toEqual({
      normal: { level: 0, color: '#b3b3b3' },
      rare: { level: 2, color: '#1173f2' }
    })
  })

  it('provides a size lookup', () => {
    expect(dbPrototypeLookup(db)('splitter')).toMatchObject({
      type: 'splitter',
      width: 2,
      height: 1
    })
    expect(dbPrototypeLookup(db)('kr-steel-pipe')).toBeUndefined()
  })
})

describe('iconCategoryFor', () => {
  it.each([
    [undefined, 'item'],
    ['item', 'item'],
    ['virtual', 'virtual-signal'],
    ['virtual-signal', 'virtual-signal'],
    ['fluid', 'fluid'],
    ['planet', 'space-location'],
    ['entity', 'entity'],
    ['something-new', 'item']
  ])('%s → %s', (kind, category) => {
    expect(iconCategoryFor(kind)).toBe(category)
  })
})
