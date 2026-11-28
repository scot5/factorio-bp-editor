import type { Box } from '../geometry'
import type { EntityLayout } from '../model/layout'
import { placeConnection, type ConnectionPoint } from '../prototypes/connections'
import type { EntityProto, PrototypeDb } from '../prototypes/db'
import { resolveGraphics, resolveSprite } from './resolve'
import type { SpriteLayer } from './types'

/**
 * Neighbour-dependent sprites: belts (curves, start and end pieces),
 * underground belts, splitters, pipes, heat pipes and walls.
 * See docs/spec/03-game-assets.md § Connection-aware sprites.
 *
 * `pickShape` looks at the entity's neighbours and returns a small `Shape`
 * value; `resolveShape` turns it into layers. The shape is the cache key, so
 * the renderer resolves each (prototype, direction, shape) once.
 */

/** An entity next to the one being drawn, with its prototype. */
export interface Neighbour {
  layout: EntityLayout
  proto: EntityProto
}

/** Entities whose footprint covers tile (x, y), the tile with top-left corner (x, y). */
export type TileQuery = (x: number, y: number) => readonly Neighbour[]

export interface Shape {
  /** Rows of the belt sheet to draw, 0-based (TransportBeltAnimationSet index − 1). */
  belts?: { index: number; offset?: [number, number] }[]
  /** A key of `EntityProto.shapes`. */
  picture?: string
  /** Direction to resolve `picture` with, when not the entity's own. */
  pictureDirection?: number
  /**
   * Walls: also draw `filling` half a tile to the left, over the gap in a 2×2
   * block of walls. The block's top-right wall draws it (walls to its left,
   * below and below-left), as the Factorio Blueprint Editor does.
   */
  fill?: true
}

// TransportBeltAnimationSet indexes (1-based in the game), by facing 0/4/8/12 → N/E/S/W.
const STRAIGHT = [3, 1, 4, 2]
const STARTING = [17, 19, 13, 15]
const ENDING = [18, 20, 14, 16]
/**
 * Curves, by facing and the side the feeding belt is on. The game names them
 * `<side>_to_<facing>`: `east_to_north` (5) faces north and is fed from the
 * east. Confirmed from the sheet: rows 5 and 6 join the top and right edges.
 */
const CURVE: Record<number, Record<number, number>> = {
  0: { 4: 5, 12: 7 },
  4: { 0: 6, 8: 9 },
  8: { 4: 10, 12: 12 },
  12: { 0: 8, 8: 11 }
}

/** Types a neighbour shape looks at, besides anything with fluid or heat connections. */
const INDEXED_TYPES = new Set([
  'transport-belt',
  'underground-belt',
  'loader',
  'loader-1x1',
  'linked-belt',
  'splitter',
  'lane-splitter',
  'wall',
  'gate'
])

/** The shape of a neighbour-dependent entity, or null when its look depends only on itself. */
export function pickShape(db: PrototypeDb, e: EntityLayout, at: TileQuery): Shape | null {
  if (!e.known) return null
  const proto = db.entities[e.entity.name]
  if (!proto?.shapes) return null
  switch (proto.type) {
    case 'transport-belt':
      return beltShape(e, at)
    case 'underground-belt':
      return undergroundShape(e, at)
    case 'loader':
    case 'loader-1x1':
    case 'linked-belt':
      return loaderShape(e, at)
    case 'splitter':
    case 'lane-splitter':
      return splitterShape(e)
    case 'pipe':
    case 'infinity-pipe':
      return { picture: pipePicture(connectedSides(db, e, at, 'fluid'), false) }
    case 'heat-pipe':
      return { picture: pipePicture(connectedSides(db, e, at, 'heat'), true) }
    case 'wall':
      return wallShape(e, at)
    default:
      return null
  }
}

export function shapeKey(shape: Shape): string {
  return JSON.stringify(shape)
}

/** Layers for a picked shape: belts on the ground, then the static graphics, then the picture. */
export function resolveShape(proto: EntityProto, direction: number, shape: Shape): SpriteLayer[] {
  const out: SpriteLayer[] = []
  const belt = proto.shapes?.['belt']
  if (belt) {
    for (const b of shape.belts ?? [])
      out.push(
        ...resolveSprite(belt, direction, {
          index: b.index,
          ground: true,
          ...(b.offset ? { offset: b.offset } : {})
        })
      )
  }
  if (proto.graphics) out.push(...resolveGraphics(proto.graphics, direction))
  const picture = shape.picture ? proto.shapes?.[shape.picture] : undefined
  if (picture) out.push(...resolveSprite(picture, shape.pictureDirection ?? direction))
  const filling = shape.fill ? proto.shapes?.['filling'] : undefined
  if (filling) out.push(...resolveSprite(filling, direction, { offset: [-0.5, 0] }))
  return out
}

// ---------------------------------------------------------------------------
// Belts

/** 4-way facing (0/4/8/12) of a belt-like entity. */
const facing4 = (e: EntityLayout): number => (Math.round(e.direction / 4) % 4) * 4

const STEP: Record<number, [number, number]> = { 0: [0, -1], 4: [1, 0], 8: [0, 1], 12: [-1, 0] }

/** Top-left corner of the tile the (1×1) entity stands on. */
function tileOf(e: EntityLayout): [number, number] {
  return [Math.floor((e.box.left + e.box.right) / 2), Math.floor((e.box.top + e.box.bottom) / 2)]
}

function neighbourTile(tile: [number, number], dir: number): [number, number] {
  const step = STEP[dir]!
  return [tile[0] + step[0], tile[1] + step[1]]
}

const containsTile = (box: Box, x: number, y: number): boolean =>
  x + 0.5 > box.left && x + 0.5 < box.right && y + 0.5 > box.top && y + 0.5 < box.bottom

const undergroundType = (e: EntityLayout): 'input' | 'output' =>
  e.entity['type'] === 'output' ? 'output' : 'input'

/**
 * Whether `n` moves items out of its front onto tile `target`. Belt ends
 * (undergrounds, loaders, linked belts) have `type: "input" | "output"` and
 * their `direction` is the flow direction for both types.
 */
function outputsInto({ layout: n, proto }: Neighbour, target: [number, number]): boolean {
  switch (proto.type) {
    case 'underground-belt':
    case 'loader':
    case 'loader-1x1':
    case 'linked-belt':
      if (undergroundType(n) === 'input') return false
      break
    case 'transport-belt':
    case 'splitter':
    case 'lane-splitter':
      break
    default:
      return false
  }
  const back = STEP[(facing4(n) + 8) % 16]!
  return containsTile(n.box, target[0] + back[0], target[1] + back[1])
}

/** Whether `n` takes items from a belt moving in `dir` onto its tile. */
function acceptsFrom({ layout: n, proto }: Neighbour, dir: number): boolean {
  const f = facing4(n)
  if (f === (dir + 8) % 16) return false
  switch (proto.type) {
    case 'transport-belt':
      return true
    case 'underground-belt':
    case 'linked-belt':
      return !(undergroundType(n) === 'output' && f === dir)
    case 'loader':
    case 'loader-1x1':
      return undergroundType(n) === 'input' && f === dir
    case 'splitter':
    case 'lane-splitter':
      return f === dir
    default:
      return false
  }
}

/**
 * Whether the tile in front of a (1×1) belt-like entity holds something that
 * takes its items: a belt not facing it, an underground or linked belt, a
 * splitter or an input loader. Used by validation (`dangling-belt`).
 */
export function feedsForward(e: EntityLayout, at: TileQuery): boolean {
  const f = facing4(e)
  const front = neighbourTile(tileOf(e), f)
  return at(front[0], front[1]).some((n) => n.layout !== e && acceptsFrom(n, f))
}

function feeds(at: TileQuery, tile: [number, number], fromDir: number): boolean {
  const source = neighbourTile(tile, fromDir)
  return at(source[0], source[1]).some((n) => outputsInto(n, tile))
}

function beltShape(e: EntityLayout, at: TileQuery): Shape {
  const f = facing4(e)
  const i = f / 4
  const tile = tileOf(e)
  const fromBehind = feeds(at, tile, (f + 8) % 16)
  const left = (f + 12) % 16
  const right = (f + 4) % 16
  const fromLeft = feeds(at, tile, left)
  const fromRight = feeds(at, tile, right)
  const belts: { index: number }[] = []
  if (!fromBehind && fromLeft !== fromRight) {
    belts.push({ index: CURVE[f]![fromLeft ? left : right]! - 1 })
  } else {
    belts.push({ index: STRAIGHT[i]! - 1 })
    if (!fromBehind) belts.push({ index: STARTING[i]! - 1 })
  }
  if (!continues(at, tile, f)) belts.push({ index: ENDING[i]! - 1 })
  return { belts }
}

function continues(at: TileQuery, tile: [number, number], f: number): boolean {
  const front = neighbourTile(tile, f)
  return at(front[0], front[1]).some((n) => acceptsFrom(n, f))
}

function undergroundShape(e: EntityLayout, at: TileQuery): Shape {
  const f = facing4(e)
  const i = f / 4
  const tile = tileOf(e)
  const belts = [{ index: STRAIGHT[i]! - 1 }]
  if (undergroundType(e) === 'input') {
    const fromBehind = feeds(at, tile, (f + 8) % 16)
    const fromSide = feeds(at, tile, (f + 4) % 16) || feeds(at, tile, (f + 12) % 16)
    if (!fromBehind && !fromSide) belts.push({ index: STARTING[i]! - 1 })
    return {
      belts,
      picture: !fromBehind && fromSide ? 'direction_in_side_loading' : 'direction_in'
    }
  }
  const front = neighbourTile(tile, f)
  const ahead = at(front[0], front[1])
  const sideLoading = ahead.some(
    (n) => n.proto.type === 'transport-belt' && facing4(n.layout) % 8 !== f % 8
  )
  if (!ahead.some((n) => acceptsFrom(n, f))) belts.push({ index: ENDING[i]! - 1 })
  return {
    belts,
    picture: sideLoading ? 'direction_out_side_loading' : 'direction_out',
    // The structure sheet is ordered by the side the opening faces.
    pictureDirection: (f + 8) % 16
  }
}

/**
 * Loaders and linked belts: a straight belt on the belt side (the tail of an
 * input loader, the head of an output one; the whole tile for 1×1 loaders and
 * linked belts) with its start or end cap, then the structure, chosen like an
 * underground belt's.
 */
function loaderShape(e: EntityLayout, at: TileQuery): Shape {
  const f = facing4(e)
  const i = f / 4
  const input = undergroundType(e) === 'input'
  const long = Math.max(e.box.right - e.box.left, e.box.bottom - e.box.top) >= 2
  const step = STEP[f]!
  const along = long ? (input ? -0.5 : 0.5) : 0
  const offset: [number, number] = [step[0] * along + 0, step[1] * along + 0] // no -0
  const belt = (index: number): { index: number; offset?: [number, number] } =>
    along ? { index, offset } : { index }
  const belts = [belt(STRAIGHT[i]! - 1)]
  // The tile on the belt side, and the tile beyond it.
  const centre = [(e.box.left + e.box.right) / 2, (e.box.top + e.box.bottom) / 2]
  const tile: [number, number] = [
    Math.floor(centre[0]! + offset[0]),
    Math.floor(centre[1]! + offset[1])
  ]
  if (input) {
    if (!feeds(at, tile, (f + 8) % 16)) belts.push(belt(STARTING[i]! - 1))
  } else if (!continues(at, tile, f)) belts.push(belt(ENDING[i]! - 1))
  return input
    ? { belts, picture: 'direction_in' }
    : { belts, picture: 'direction_out', pictureDirection: (f + 8) % 16 }
}

function splitterShape(e: EntityLayout): Shape {
  const f = facing4(e)
  const index = STRAIGHT[f / 4]! - 1
  const across = f % 8 === 0 ? e.box.right - e.box.left : e.box.bottom - e.box.top
  if (across < 2) return { belts: [{ index }] }
  const half: [number, number] = f % 8 === 0 ? [0.5, 0] : [0, 0.5]
  return {
    belts: [
      { index, offset: [-half[0], -half[1]] },
      { index, offset: half }
    ]
  }
}

// ---------------------------------------------------------------------------
// Pipes, heat pipes and walls

/** Sides (0/4/8/12) of a 1×1 entity that join a neighbour's matching connection. */
export function connectedSides(
  db: PrototypeDb,
  e: EntityLayout,
  at: TileQuery,
  kind: 'fluid' | 'heat'
): Set<number> {
  const sides = new Set<number>()
  const proto = db.entities[e.entity.name]
  const own = activeConnections(db, e, proto, kind)
  const tile = tileOf(e)
  for (const c of own) {
    const side = Math.round(c.direction / 4) * 4
    const target = neighbourTile(tile, side % 16)
    for (const { layout: n, proto: nProto } of at(target[0], target[1])) {
      if (n === e) continue
      const joined = activeConnections(db, n, nProto, kind).some((nc) => {
        if (!sharesCategory(c.categories, nc.categories)) return false
        const cx = (n.box.left + n.box.right) / 2 + nc.position[0]
        const cy = (n.box.top + n.box.bottom) / 2 + nc.position[1]
        if (Math.floor(cx) !== target[0] || Math.floor(cy) !== target[1]) return false
        const step = STEP[(Math.round(nc.direction / 4) * 4) % 16]!
        return Math.floor(cx + step[0]) === tile[0] && Math.floor(cy + step[1]) === tile[1]
      })
      if (joined) {
        sides.add(side % 16)
        break
      }
    }
  }
  return sides
}

interface PlacedConnection {
  position: [number, number]
  direction: number
  categories?: string[]
}

function activeConnections(
  db: PrototypeDb,
  e: EntityLayout,
  proto: EntityProto | undefined,
  kind: 'fluid' | 'heat'
): PlacedConnection[] {
  const points = proto?.connections?.[kind]
  if (!points) return []
  let roles: { input: boolean; output: boolean } | undefined
  const out: PlacedConnection[] = []
  for (const point of points) {
    if (point.production) {
      roles ??= recipeFluids(db, e.entity.recipe)
      if (!roles[point.production]) continue
    }
    out.push(place(point, e.direction, e.entity['mirror'] === true))
  }
  return out
}

function place(point: ConnectionPoint, direction: number, mirror: boolean): PlacedConnection {
  const placed = placeConnection(point, direction, mirror)
  return point.categories ? { ...placed, categories: point.categories } : placed
}

function recipeFluids(
  db: PrototypeDb,
  recipe: string | undefined
): { input: boolean; output: boolean } {
  const r = recipe ? db.recipes[recipe] : undefined
  return {
    input: r?.ingredients.some((i) => i.type === 'fluid') ?? false,
    output: r?.results.some((i) => i.type === 'fluid') ?? false
  }
}

function sharesCategory(a: string[] | undefined, b: string[] | undefined): boolean {
  const left = a ?? ['default']
  const right = b ?? ['default']
  return left.some((c) => right.includes(c))
}

const SIDE_NAMES: Record<number, 'up' | 'right' | 'down' | 'left'> = {
  0: 'up',
  4: 'right',
  8: 'down',
  12: 'left'
}

/** Pipe or heat-pipe piece for the connected sides. */
export function pipePicture(sides: ReadonlySet<number>, heat: boolean): string {
  const up = sides.has(0)
  const right = sides.has(4)
  const down = sides.has(8)
  const left = sides.has(12)
  switch (sides.size) {
    case 0:
      return heat ? 'single' : 'straight_vertical_single'
    case 1:
      return `ending_${SIDE_NAMES[[...sides][0]!]!}`
    case 2: {
      if (up && down) return 'straight_vertical'
      if (left && right) return 'straight_horizontal'
      const v = up ? 'up' : 'down'
      const h = right ? 'right' : 'left'
      return heat ? `corner_${h}_${v}` : `corner_${v}_${h}`
    }
    case 3: {
      // t_up joins left, right and up: named after the side opposite the missing one.
      const missing = [0, 4, 8, 12].find((s) => !sides.has(s))!
      return `t_${SIDE_NAMES[(missing + 8) % 16]!}`
    }
    default:
      return 'cross'
  }
}

/** Wall piece from the walls (and gates in line) to the right, left and below. */
function wallShape(e: EntityLayout, at: TileQuery): Shape {
  const tile = tileOf(e)
  const isWall = (x: number, y: number): boolean =>
    at(x, y).some(({ proto }) => proto.type === 'wall')
  const joins = (side: number): boolean => {
    const t = neighbourTile(tile, side)
    return at(t[0], t[1]).some(({ layout: n, proto }) => {
      if (proto.type === 'wall') return true
      // A gate facing north or south stands in a vertical wall line.
      if (proto.type === 'gate') return facing4(n) % 8 === (side % 8 === 0 ? 0 : 4)
      return false
    })
  }
  const right = joins(4)
  const down = joins(8)
  const [x, y] = tile
  const fill = isWall(x - 1, y) && isWall(x, y + 1) && isWall(x - 1, y + 1)
  return {
    picture: wallPictureFor(right, joins(12), down),
    ...(fill ? { fill: true as const } : {})
  }
}

export function wallPictureFor(right: boolean, left: boolean, down: boolean): string {
  if (down) {
    if (left && right) return 't_up'
    if (right) return 'corner_right_down'
    if (left) return 'corner_left_down'
    return 'straight_vertical'
  }
  if (left && right) return 'straight_horizontal'
  if (right) return 'ending_right'
  if (left) return 'ending_left'
  return 'single'
}

// ---------------------------------------------------------------------------

/**
 * Tile index of the entities that take part in neighbour shapes: belt-like
 * entities, walls, gates and anything with fluid or heat connections.
 */
export function tileIndex(db: PrototypeDb, entities: readonly EntityLayout[]): TileQuery {
  const map = new Map<number, Neighbour[]>()
  const key = (x: number, y: number): number => x * 4194304 + y
  for (const e of entities) {
    if (!e.known) continue
    const proto = db.entities[e.entity.name]
    if (!proto) continue
    if (!INDEXED_TYPES.has(proto.type) && !proto.connections) continue
    const entry: Neighbour = { layout: e, proto }
    for (let x = Math.floor(e.box.left); x < Math.ceil(e.box.right); x++) {
      for (let y = Math.floor(e.box.top); y < Math.ceil(e.box.bottom); y++) {
        const k = key(x, y)
        const list = map.get(k)
        if (list) list.push(entry)
        else map.set(k, [entry])
      }
    }
  }
  return (x, y) => map.get(key(x, y)) ?? []
}
