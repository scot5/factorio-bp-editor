import type { Box, Position } from '../geometry'
import type { BlueprintLayout, EntityLayout } from '../model/layout'
import { WireConnectorId, type Wire, type WireColor } from '../model/wires'
import type { PrototypeDb } from '../prototypes/db'
import type { EntityWirePoints, WirePoint, WireVec } from '../prototypes/wires'
import { ELEVATED_HEIGHT } from './graphics'
import { resolveSprite } from './resolve'
import { pickShape, tileIndex, type Shape, type TileQuery } from './shapes'
import type { SpriteLayer } from './types'

/**
 * Where wires are drawn: the two world points of each wire, from the
 * prototype's wire connection points (docs/spec/03-game-assets.md § Wire
 * connection points), and the electric pole picture variation, which the game
 * picks from the directions of the pole's wires.
 */

export interface WireSegment {
  wire: Wire
  color: WireColor
  /** World positions of the two ends, in tiles. */
  a: WireVec
  b: WireVec
  /** Box around the drawn curve (the ends plus the sag). */
  box: Box
}

/**
 * Pole picture variation (0–3) from the positions of the entities its wires
 * go to: each one's angle falls in one of four sectors (N–S, NE–SW, E–W,
 * NW–SE, counted from north-north-east), and the variation is the rounded-down
 * mean sector. 0 without wires. The Factorio Blueprint Editor's rule
 * (`getPowerPoleRotation`); its frames match the game's for straight lines.
 */
export function poleVariation(centre: Position, partners: readonly Position[]): number {
  if (!partners.length) return 0
  let sum = 0
  for (const p of partners) {
    // Counter-clockwise from east with y up, in degrees.
    const angle = (Math.atan2(-(p.y - centre.y), p.x - centre.x) * 180) / Math.PI
    let a = 360 - ((angle + 360) % 360) - 67.5 // clockwise from east, less 1.5 sectors
    if (a < 0) a += 360
    sum += Math.floor(a / 45) % 4
  }
  return Math.floor(sum / partners.length)
}

/** entity_number → layout entity. */
export function entitiesByNumber(layout: BlueprintLayout): Map<number, EntityLayout> {
  const out = new Map<number, EntityLayout>()
  for (const e of layout.entities) out.set(e.entity.entity_number, e)
  return out
}

/** Picture variation of every wired electric pole, by layout index (absent = 0). */
export function poleVariations(
  db: PrototypeDb,
  layout: BlueprintLayout,
  byNumber = entitiesByNumber(layout)
): Map<number, number> {
  const partners = new Map<EntityLayout, Position[]>()
  const add = (self: number, other: number): void => {
    const e = byNumber.get(self)
    const o = byNumber.get(other)
    if (!e || !o || e === o || db.entities[e.entity.name]?.type !== 'electric-pole') return
    const list = partners.get(e)
    if (list) list.push(o.entity.position)
    else partners.set(e, [o.entity.position])
  }
  for (const w of layout.wires) {
    add(w.a.entity, w.b.entity)
    add(w.b.entity, w.a.entity)
  }
  const out = new Map<number, number>()
  for (const [e, list] of partners) {
    const v = poleVariation(e.entity.position, list)
    if (v) out.set(e.index, v)
  }
  return out
}

/** What besides the entity picks its wire points. */
export interface WirePointContext {
  /** Pole picture variation. */
  variation?: number
  /** Neighbour shape of a belt or pipe (sprites/shapes.ts). */
  shape?: Shape | null
}

const OUTPUT_CONNECTORS: ReadonlySet<number> = new Set([
  WireConnectorId.CombinatorOutputRed,
  WireConnectorId.CombinatorOutputGreen,
  WireConnectorId.PowerSwitchRightCopper
])

/** The list of points a connector uses: output, elevated, flipped or the plain one. */
export function wirePointList(
  points: EntityWirePoints,
  e: EntityLayout,
  connector: number
): WirePoint[] | undefined {
  if (OUTPUT_CONNECTORS.has(connector)) return points.output
  if (e.entity['rail_layer'] === 'elevated' && points.elevated) return points.elevated
  if (e.entity['mirror'] === true && points.flipped) return points.flipped
  return points.points
}

/** Which entry of a point list an entity uses (see `WireIndexing`). */
export function wirePointIndex(
  points: EntityWirePoints,
  length: number,
  e: EntityLayout,
  ctx: WirePointContext = {}
): number {
  const facing4 = Math.round(e.direction / 4) % 4
  let index: number
  switch (points.indexing) {
    case 'pole':
      index = ctx.variation ?? 0
      break
    case 'belt':
      index = beltIndex(ctx.shape, facing4)
      break
    case 'pipe':
      index = pipeIndex(ctx.shape?.picture)
      break
    case 'loader':
      index = (e.entity['type'] === 'input' ? 4 : 0) + facing4
      break
    default:
      index =
        length === 4
          ? facing4
          : length === 8
            ? Math.round(e.direction / 2) % 8
            : length === 16
              ? e.direction % 16
              : 0
  }
  return index < length ? index : 0
}

/** Belt connectors in the order X, H, V, SE, SW, NE, NW, from the belt sheet row. */
function beltIndex(shape: Shape | null | undefined, facing4: number): number {
  const row = (shape?.belts?.[0]?.index ?? -1) + 1 // 1-based TransportBeltAnimationSet index
  if (row >= 5 && row <= 12) return [5, 5, 6, 6, 3, 3, 4, 4][row - 5]! // curves: NE NE NW NW SE SE SW SW
  return facing4 % 2 === 1 ? 1 : 2 // straight, start and end pieces: H for east/west, else V
}

const SIDE_BITS: Readonly<Record<string, number>> = { up: 1, right: 2, down: 4, left: 8 }
const OPPOSITE: Readonly<Record<string, string>> = {
  up: 'down',
  down: 'up',
  left: 'right',
  right: 'left'
}

/** Pipe connectors are in the order of their pictures, which is the bitmask of connected sides. */
export function pipeIndex(picture: string | undefined): number {
  if (!picture || picture.endsWith('single')) return 0
  if (picture === 'cross') return 15
  if (picture === 'straight_vertical') return 5
  if (picture === 'straight_horizontal') return 10
  const words = picture.split('_')
  if (words[0] === 't') return 15 - (SIDE_BITS[OPPOSITE[words[1]!] ?? ''] ?? 0)
  return words.reduce((sum, w) => sum + (SIDE_BITS[w] ?? 0), 0)
}

/**
 * Fallback offsets (north-facing, tiles) when there are no points: inputs at
 * the back, outputs at the front, red left of green, copper at the top.
 */
const FALLBACK: Readonly<Record<number, WireVec>> = {
  [WireConnectorId.CircuitRed]: [-0.2, 0.1],
  [WireConnectorId.CircuitGreen]: [0.2, 0.1],
  [WireConnectorId.CombinatorOutputRed]: [-0.2, -0.3],
  [WireConnectorId.CombinatorOutputGreen]: [0.2, -0.3],
  [WireConnectorId.PoleCopper]: [0, -0.15],
  [WireConnectorId.PowerSwitchRightCopper]: [0.3, -0.15]
}

/** World position where a wire of `color` attaches to connector `connector` of an entity. */
export function wireEndpoint(
  db: PrototypeDb | null,
  e: EntityLayout,
  connector: number,
  color: WireColor,
  ctx: WirePointContext = {}
): WireVec {
  const { x, y } = e.entity.position
  const points = db?.entities[e.entity.name]?.wirePoints
  const list = points ? wirePointList(points, e, connector) : undefined
  if (points && list?.length) {
    const p = list[wirePointIndex(points, list.length, e, ctx)]?.[color]
    if (p) return [x + p[0], y + p[1]]
  }
  let [fx, fy] = FALLBACK[connector] ?? [0, 0]
  for (let i = Math.round(e.direction / 4) % 4; i > 0; i--) [fx, fy] = [-fy, fx]
  return [x + fx + 0, y + fy + 0]
}

/** entity_numbers of the entities with a red or green wire on connector 1 or 2. */
export function circuitWiredEntities(wires: readonly Wire[]): Set<number> {
  const out = new Set<number>()
  for (const w of wires)
    for (const end of [w.a, w.b])
      if (
        end.connector === WireConnectorId.CircuitRed ||
        end.connector === WireConnectorId.CircuitGreen
      )
        out.add(end.entity)
  return out
}

/**
 * The circuit connector an entity with circuit wires shows (chests,
 * inserters, machines, pipes, …), at the same index as its wire points, or
 * null when it has none. Elevated rail signals draw it raised like their
 * points. Returns the cache key part too.
 */
export function circuitConnector(
  points: EntityWirePoints,
  e: EntityLayout,
  ctx: WirePointContext = {}
): { key: string; layers: () => SpriteLayer[] } | null {
  const list = wirePointList(points, e, WireConnectorId.CircuitRed)
  if (!list?.length) return null
  const index = wirePointIndex(points, list.length, e, ctx)
  const node = list[index]?.sprite
  if (!node) return null
  const raised = list === points.elevated
  return {
    key: `c${index}${raised ? 'e' : ''}${list === points.flipped ? 'f' : ''}`,
    layers: () => resolveSprite(node, e.direction, raised ? { offset: [0, -ELEVATED_HEIGHT] } : {})
  }
}

/** Most a wire sags below the line between its ends, in tiles (reached from 3 tiles long). */
export const WIRE_SAG = 0.9375

/**
 * Cubic Bézier control points of a sagging wire from `a` to `b`: at 1/5 and
 * 4/5 of the way, pushed down (perpendicular to the wire) by up to WIRE_SAG,
 * more the longer and the more horizontal the wire. Vertical wires are
 * straight. As in the Factorio Blueprint Editor (`WiresContainer`).
 */
export function wireCurve(a: WireVec, b: WireVec): [WireVec, WireVec] {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const d = Math.hypot(dx, dy)
  const h = d > 0 ? (dx / d) * Math.min(1, d / 3) * WIRE_SAG : 0
  const ox = d > 0 ? (h * -dy) / d : 0
  const oy = d > 0 ? (h * dx) / d : 0
  return [
    [a[0] + dx / 5 + ox, a[1] + dy / 5 + oy],
    [a[0] + (dx * 4) / 5 + ox, a[1] + (dy * 4) / 5 + oy]
  ]
}

/**
 * Every drawable wire of a layout: both ends on entities in the blueprint and
 * a known colour. `db` null draws them from the fallback offsets.
 */
export function wireSegments(db: PrototypeDb | null, layout: BlueprintLayout): WireSegment[] {
  if (!layout.wires.length) return []
  const byNumber = entitiesByNumber(layout)
  const variations = db ? poleVariations(db, layout, byNumber) : new Map<number, number>()
  let at: TileQuery | undefined
  const shapes = new Map<EntityLayout, Shape | null>()
  const ctxFor = (e: EntityLayout): WirePointContext => {
    const indexing = db?.entities[e.entity.name]?.wirePoints?.indexing
    if (!db || (indexing !== 'belt' && indexing !== 'pipe'))
      return { variation: variations.get(e.index) ?? 0 }
    let shape = shapes.get(e)
    if (shape === undefined) {
      at ??= tileIndex(db, layout.entities)
      shape = pickShape(db, e, at)
      shapes.set(e, shape)
    }
    return { shape }
  }
  const out: WireSegment[] = []
  for (const wire of layout.wires) {
    const color = wire.color
    const ea = byNumber.get(wire.a.entity)
    const eb = byNumber.get(wire.b.entity)
    if (!color || !ea || !eb) continue
    const a = wireEndpoint(db, ea, wire.a.connector, color, ctxFor(ea))
    const b = wireEndpoint(db, eb, wire.b.connector, color, ctxFor(eb))
    const [c1, c2] = wireCurve(a, b)
    out.push({
      wire,
      color,
      a,
      b,
      box: {
        left: Math.min(a[0], b[0], c1[0], c2[0]),
        top: Math.min(a[1], b[1], c1[1], c2[1]),
        right: Math.max(a[0], b[0], c1[0], c2[0]),
        bottom: Math.max(a[1], b[1], c1[1], c2[1])
      }
    })
  }
  return out
}
