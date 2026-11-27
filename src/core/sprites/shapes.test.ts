import { describe, expect, it } from 'vitest'
import { layoutBlueprint, type Blueprint, type BlueprintEntity } from '../model'
import { buildPrototypeDb, dbPrototypeLookup } from '../prototypes/db'
import {
  pickShape,
  pipePicture,
  resolveShape,
  tileIndex,
  wallPictureFor,
  type Shape
} from './shapes'

// Prototype excerpts from the Factorio 2.1.25 `data-raw-dump.json`, trimmed to
// the fields the shape code reads. Picture files are named after their key so
// the tests can see which piece was chosen.

const box1 = [
  [-0.4, -0.4],
  [0.4, 0.4]
]
const pic = (dir: string, key: string): Record<string, unknown> => ({
  filename: `__base__/graphics/entity/${dir}/${key}.png`,
  width: 128,
  height: 128,
  scale: 0.5
})
const pictures = (dir: string, keys: string[]): Record<string, unknown> =>
  Object.fromEntries(keys.map((k) => [k, pic(dir, k)]))
const four = (position: [number, number] = [0, 0]): Record<string, unknown>[] =>
  [0, 4, 8, 12].map((direction) => ({ direction, position }))

const beltSet = {
  animation_set: {
    filename: '__base__/graphics/entity/transport-belt/transport-belt.png',
    priority: 'extra-high',
    size: 128,
    scale: 0.5,
    frame_count: 16,
    direction_count: 20
  }
}
const structure = (y: number): Record<string, unknown> => ({
  sheet: {
    filename: '__base__/graphics/entity/underground-belt/underground-belt-structure.png',
    width: 192,
    height: 192,
    y,
    scale: 0.5
  }
})

const RAW = {
  'transport-belt': {
    'transport-belt': {
      name: 'transport-belt',
      collision_box: box1,
      belt_animation_set: beltSet
    }
  },
  'underground-belt': {
    'underground-belt': {
      name: 'underground-belt',
      collision_box: box1,
      belt_animation_set: beltSet,
      structure: {
        direction_in: structure(192),
        direction_out: structure(0),
        direction_in_side_loading: structure(576),
        direction_out_side_loading: structure(384)
      }
    }
  },
  splitter: {
    splitter: {
      name: 'splitter',
      collision_box: [
        [-0.9, -0.4],
        [0.9, 0.4]
      ],
      belt_animation_set: beltSet,
      structure: {
        north: { ...pic('splitter', 'splitter-north'), width: 160, height: 70 },
        east: { ...pic('splitter', 'splitter-east'), width: 90, height: 84 },
        south: { ...pic('splitter', 'splitter-south'), width: 164, height: 64 },
        west: { ...pic('splitter', 'splitter-west'), width: 90, height: 86 }
      },
      structure_patch: {
        north: { filename: '__core__/graphics/empty.png', width: 1, height: 1 },
        east: { ...pic('splitter', 'splitter-east-top_patch'), width: 90, height: 104 },
        south: { filename: '__core__/graphics/empty.png', width: 1, height: 1 },
        west: { ...pic('splitter', 'splitter-west-top_patch'), width: 90, height: 96 }
      }
    }
  },
  pipe: {
    pipe: {
      name: 'pipe',
      collision_box: box1,
      fluid_box: { volume: 100, pipe_connections: four() },
      pictures: pictures('pipe', [
        'straight_vertical_single',
        'straight_vertical',
        'straight_horizontal',
        'corner_up_right',
        'corner_down_left',
        't_up',
        'cross',
        'ending_up',
        'ending_right',
        'ending_left'
      ])
    }
  },
  'pipe-to-ground': {
    'pipe-to-ground': {
      name: 'pipe-to-ground',
      collision_box: box1,
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
  'assembling-machine': {
    'assembling-machine-2': {
      name: 'assembling-machine-2',
      collision_box: [
        [-1.2, -1.2],
        [1.2, 1.2]
      ],
      fluid_boxes_off_when_no_fluid_recipe: true,
      fluid_boxes: [
        {
          production_type: 'input',
          pipe_connections: [{ flow_direction: 'input', direction: 0, position: [0, -1] }]
        },
        {
          production_type: 'output',
          pipe_connections: [{ flow_direction: 'output', direction: 8, position: [0, 1] }]
        }
      ]
    }
  },
  'heat-pipe': {
    'heat-pipe': {
      name: 'heat-pipe',
      collision_box: box1,
      heat_buffer: { connections: four() },
      connection_sprites: pictures('heat-pipe', [
        'single',
        'corner_right_up',
        'corner_left_down',
        'ending_up'
      ])
    }
  },
  wall: {
    'stone-wall': {
      name: 'stone-wall',
      collision_box: box1,
      pictures: pictures('wall', [
        'single',
        'straight_vertical',
        'straight_horizontal',
        'corner_right_down',
        'corner_left_down',
        't_up',
        'ending_right',
        'ending_left',
        'filling'
      ])
    }
  },
  gate: { gate: { name: 'gate', collision_box: box1 } },
  recipe: {
    'iron-gear-wheel': {
      name: 'iron-gear-wheel',
      ingredients: [{ type: 'item', name: 'iron-plate', amount: 2 }],
      results: [{ type: 'item', name: 'iron-gear-wheel', amount: 1 }]
    },
    'electric-engine-unit': {
      name: 'electric-engine-unit',
      ingredients: [{ type: 'fluid', name: 'lubricant', amount: 15 }],
      results: [{ type: 'item', name: 'electric-engine-unit', amount: 1 }]
    }
  }
}

const db = buildPrototypeDb(RAW, { gameVersion: '2.1.25', mods: [] })

type E = Partial<BlueprintEntity> & { name: string; x: number; y: number }

/** Lays out the entities and returns each one's shape, in order. */
function shapesOf(list: E[]): (Shape | null)[] {
  const entities = list.map(({ x, y, ...rest }, i) => ({
    entity_number: i + 1,
    position: { x, y },
    ...rest
  })) as BlueprintEntity[]
  const layout = layoutBlueprint(
    { item: 'blueprint', entities } as Blueprint,
    dbPrototypeLookup(db)
  )
  const at = tileIndex(db, layout.entities)
  return layout.entities.map((e) => pickShape(db, e, at))
}

const N = 0
const E_ = 4
const S = 8
const W = 12

// 0-based belt sheet rows.
const row = {
  east: 0,
  west: 1,
  north: 2,
  south: 3,
  eastToNorth: 4,
  westToNorth: 6,
  southToEast: 8,
  startNorth: 16,
  endNorth: 17,
  startEast: 18,
  endEast: 19
}
const belts = (shape: Shape | null): number[] => shape?.belts?.map((b) => b.index) ?? []
const belt = (x: number, y: number, direction = N): E => ({
  name: 'transport-belt',
  x: x + 0.5,
  y: y + 0.5,
  direction
})

describe('belts', () => {
  it('a lone belt is straight, with a start and an end piece', () => {
    expect(belts(shapesOf([belt(0, 0)])[0]!)).toEqual([row.north, row.startNorth, row.endNorth])
  })

  it('a belt line has no start or end pieces in the middle', () => {
    const [first, middle, last] = shapesOf([belt(0, 2), belt(0, 1), belt(0, 0)])
    expect(belts(first!)).toEqual([row.north, row.startNorth])
    expect(belts(middle!)).toEqual([row.north])
    expect(belts(last!)).toEqual([row.north, row.endNorth])
  })

  it('curves when exactly one side feeds it and nothing feeds it from behind', () => {
    // An east-moving belt at (-1, 0) feeds the north-facing belt at (0, 0) from the west.
    const [, fromWest] = shapesOf([belt(-1, 0, E_), belt(0, 0, N), belt(0, -1, N)])
    expect(belts(fromWest!)).toEqual([row.westToNorth])
    const [, fromEast] = shapesOf([belt(1, 0, W), belt(0, 0, N), belt(0, -1, N)])
    expect(belts(fromEast!)).toEqual([row.eastToNorth])
    // East-facing belt fed from the south (a north-moving belt below it).
    const [, southToEast] = shapesOf([belt(0, 1, N), belt(0, 0, E_), belt(1, 0, E_)])
    expect(belts(southToEast!)).toEqual([row.southToEast])
  })

  it('stays straight when fed from behind as well, or from both sides (side-loading)', () => {
    const [, , behind] = shapesOf([belt(-1, 0, E_), belt(0, 1, N), belt(0, 0, N), belt(0, -1)])
    expect(belts(behind!)).toEqual([row.north])
    const [, , both] = shapesOf([belt(-1, 0, E_), belt(1, 0, W), belt(0, 0, N), belt(0, -1)])
    expect(belts(both!)).toEqual([row.north, row.startNorth])
  })

  it('a side belt that points away does not feed', () => {
    const [, straight] = shapesOf([belt(-1, 0, W), belt(0, 0, N), belt(0, -1)])
    expect(belts(straight!)).toEqual([row.north, row.startNorth])
  })

  it('a belt pointing into a belt that faces back ends', () => {
    const [a] = shapesOf([belt(0, 0, E_), belt(1, 0, W)])
    expect(belts(a!)).toContain(row.endEast)
  })

  it('belts feed into undergrounds and splitters, and come out of them', () => {
    const [into, , out] = shapesOf([
      belt(0, 1),
      { name: 'underground-belt', x: 0.5, y: 0.5, type: 'input' },
      belt(0, -4)
    ])
    expect(belts(into!)).toEqual([row.north, row.startNorth])
    expect(belts(out!)).toContain(row.endNorth)

    const [before, , after] = shapesOf([
      belt(0, 1),
      { name: 'splitter', x: 1, y: 0.5 },
      belt(0, -1)
    ])
    expect(belts(before!)).toEqual([row.north, row.startNorth])
    expect(belts(after!)).toEqual([row.north, row.endNorth])
  })
})

describe('underground belts', () => {
  it('input: belt, start piece and direction_in sheet at its own facing', () => {
    const [ug] = shapesOf([{ name: 'underground-belt', x: 0.5, y: 0.5, type: 'input' }])
    expect(ug).toEqual({
      belts: [{ index: row.north }, { index: row.startNorth }],
      picture: 'direction_in'
    })
  })

  it('input fed from a side uses the side-loading structure', () => {
    const [, ug] = shapesOf([
      belt(-1, 0, E_),
      { name: 'underground-belt', x: 0.5, y: 0.5, type: 'input' }
    ])
    expect(ug?.picture).toBe('direction_in_side_loading')
    expect(belts(ug!)).toEqual([row.north])
  })

  it('output: the structure sheet takes the opposite facing, and side-loading onto a belt', () => {
    const [ug] = shapesOf([
      { name: 'underground-belt', x: 0.5, y: 0.5, type: 'output', direction: E_ }
    ])
    expect(ug).toEqual({
      belts: [{ index: row.east }, { index: row.endEast }],
      picture: 'direction_out',
      pictureDirection: W
    })
    const [side] = shapesOf([
      { name: 'underground-belt', x: 0.5, y: 0.5, type: 'output' },
      belt(0, -1, E_)
    ])
    expect(side?.picture).toBe('direction_out_side_loading')
    expect(belts(side!)).toEqual([row.north])
  })

  it('resolves the structure sheet frame from pictureDirection', () => {
    const proto = db.entities['underground-belt']!
    const [ug] = shapesOf([{ name: 'underground-belt', x: 0.5, y: 0.5, type: 'output' }])
    const layers = resolveShape(proto, N, ug!)
    // Belt row 2 (north) at frame 0, on the ground.
    expect(layers[0]).toMatchObject({ rect: { x: 0, y: 2 * 128, w: 128, h: 128 }, ground: true })
    // direction_out (y 0) at the south frame (index 2 of 4).
    expect(layers.at(-1)).toMatchObject({
      rect: { x: 2 * 192, y: 0, w: 192, h: 192 },
      ground: false
    })
  })
})

describe('splitters', () => {
  it('draws two belts, half a tile either side, then the structure', () => {
    const [north] = shapesOf([{ name: 'splitter', x: 1, y: 0.5 }])
    expect(north).toEqual({
      belts: [
        { index: row.north, offset: [-0.5, -0] },
        { index: row.north, offset: [0.5, 0] }
      ]
    })
    const layers = resolveShape(db.entities['splitter']!, N, north!)
    expect(layers.map((l) => [l.shift, l.ground])).toEqual([
      [[-0.5, 0], true],
      [[0.5, 0], true],
      [[0, 0], false]
    ])
  })

  it('the structure patch is drawn only where it exists (east and west)', () => {
    const proto = db.entities['splitter']!
    const files = (d: number): string[] =>
      resolveShape(proto, d, { belts: [] }).map((l) => l.url.split('/').pop()!)
    expect(files(N)).toEqual(['splitter-north.png'])
    expect(files(S)).toEqual(['splitter-south.png'])
    expect(files(E_)).toEqual(['splitter-east.png', 'splitter-east-top_patch.png'])
    expect(files(W)).toEqual(['splitter-west.png', 'splitter-west-top_patch.png'])
  })
})

describe('pipes', () => {
  const pipe = (x: number, y: number): E => ({ name: 'pipe', x: x + 0.5, y: y + 0.5 })

  it('names pieces after their connected sides', () => {
    expect(pipePicture(new Set(), false)).toBe('straight_vertical_single')
    expect(pipePicture(new Set([0]), false)).toBe('ending_up')
    expect(pipePicture(new Set([0, 8]), false)).toBe('straight_vertical')
    expect(pipePicture(new Set([4, 12]), false)).toBe('straight_horizontal')
    expect(pipePicture(new Set([0, 4]), false)).toBe('corner_up_right')
    expect(pipePicture(new Set([8, 12]), false)).toBe('corner_down_left')
    expect(pipePicture(new Set([0, 4, 12]), false)).toBe('t_up')
    expect(pipePicture(new Set([0, 4, 8]), false)).toBe('t_right')
    expect(pipePicture(new Set([0, 4, 8, 12]), false)).toBe('cross')
    // Heat pipe corners put the horizontal side first.
    expect(pipePicture(new Set(), true)).toBe('single')
    expect(pipePicture(new Set([0, 4]), true)).toBe('corner_right_up')
  })

  it('connects pipe to pipe', () => {
    const shapes = shapesOf([pipe(0, 0), pipe(1, 0), pipe(1, 1), pipe(5, 5)])
    expect(shapes.map((s) => s?.picture)).toEqual([
      'ending_right',
      'corner_down_left',
      'ending_up',
      'straight_vertical_single'
    ])
  })

  it('connects to a pipe-to-ground only on its normal side', () => {
    // Pipe-to-ground at (0, 0) facing north: its connection points up.
    const above = shapesOf([{ name: 'pipe-to-ground', x: 0.5, y: 0.5 }, pipe(0, -1)])[1]
    expect(above?.picture).toBe('ending_down')
    const below = shapesOf([{ name: 'pipe-to-ground', x: 0.5, y: 0.5 }, pipe(0, 1)])[1]
    expect(below?.picture).toBe('straight_vertical_single')
  })

  it('connects to a machine fluid box only when its recipe uses fluid there', () => {
    // Assembler at (1.5, 1.5): the input box is on the top tile (1, 0) and points up.
    const machine = (recipe?: string, direction = N): E => ({
      name: 'assembling-machine-2',
      x: 1.5,
      y: 1.5,
      direction,
      ...(recipe ? { recipe } : {})
    })
    expect(shapesOf([machine('electric-engine-unit'), pipe(1, -1)])[1]?.picture).toBe('ending_down')
    expect(shapesOf([machine('iron-gear-wheel'), pipe(1, -1)])[1]?.picture).toBe(
      'straight_vertical_single'
    )
    expect(shapesOf([machine(), pipe(1, -1)])[1]?.picture).toBe('straight_vertical_single')
    // Turned to face south, the input box is on the bottom tile and points down.
    expect(shapesOf([machine('electric-engine-unit', S), pipe(1, 3)])[1]?.picture).toBe('ending_up')
    // A pipe beside the machine, not at a connection, stays unconnected.
    expect(shapesOf([machine('electric-engine-unit'), pipe(-1, 1)])[1]?.picture).toBe(
      'straight_vertical_single'
    )
  })

  it('heat pipes connect through heat connections', () => {
    const heat = (x: number, y: number): E => ({ name: 'heat-pipe', x: x + 0.5, y: y + 0.5 })
    expect(shapesOf([heat(0, 0), heat(1, 0), heat(0, -1)])[0]?.picture).toBe('corner_right_up')
  })
})

describe('walls', () => {
  const wall = (x: number, y: number): E => ({ name: 'stone-wall', x: x + 0.5, y: y + 0.5 })

  it('picks pieces from the right, left and down neighbours', () => {
    expect(wallPictureFor(false, false, false)).toBe('single')
    expect(wallPictureFor(true, false, false)).toBe('ending_right')
    expect(wallPictureFor(true, true, false)).toBe('straight_horizontal')
    expect(wallPictureFor(false, false, true)).toBe('straight_vertical')
    expect(wallPictureFor(true, false, true)).toBe('corner_right_down')
    expect(wallPictureFor(true, true, true)).toBe('t_up')
  })

  it('a wall with only a wall above is a single piece', () => {
    const shapes = shapesOf([wall(0, 0), wall(0, 1), wall(1, 0)])
    expect(shapes.map((s) => s?.picture)).toEqual(['corner_right_down', 'single', 'ending_left'])
  })

  it('fills the gap in a 2×2 block from its top-right wall', () => {
    const shapes = shapesOf([wall(0, 0), wall(1, 0), wall(0, 1), wall(1, 1)])
    expect(shapes.map((s) => s?.fill)).toEqual([undefined, true, undefined, undefined])
    const layers = resolveShape(db.entities['stone-wall']!, N, shapes[1]!)
    expect(layers.at(-1)).toMatchObject({ shift: [-0.5, 0] })
    expect(layers.at(-1)?.url).toMatch(/filling\.png$/)
    expect(shapesOf([wall(0, 0), wall(1, 0), wall(1, 1)])[1]?.fill).toBeUndefined()
  })

  it('joins gates in line with the wall', () => {
    // A gate facing north stands in a vertical wall line: it joins the wall above it.
    const gate = (direction: number): E => ({ name: 'gate', x: 0.5, y: 1.5, direction })
    expect(shapesOf([wall(0, 0), gate(N)])[0]?.picture).toBe('straight_vertical')
    expect(shapesOf([wall(0, 0), gate(E_)])[0]?.picture).toBe('single')
  })
})

describe('tileIndex', () => {
  it('skips entities that take no part in shapes', () => {
    const entities = [{ entity_number: 1, name: 'iron-chest', position: { x: 0.5, y: 0.5 } }]
    const layout = layoutBlueprint(
      { item: 'blueprint', entities } as Blueprint,
      dbPrototypeLookup(db)
    )
    expect(tileIndex(db, layout.entities)(0, 0)).toEqual([])
  })
})
