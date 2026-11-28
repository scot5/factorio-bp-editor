import type { BlueprintEnvelope, JsonObject } from '../codec'
import {
  boxCenter,
  directionOf,
  mirrorDirection,
  mirrorPosition,
  rotateDirection,
  rotatePosition,
  unionBoxes,
  type Box,
  type Direction,
  type Position
} from '../geometry'
import { entityFootprint, getNode, type BlueprintEntity, type BookPath } from '../model'
import {
  canMirror,
  canRotate,
  isRailGrid,
  mirrorOffset,
  normalizeDirection,
  type EntityPrototypeInfo,
  type PrototypeLookup
} from '../prototypes'
import { CommandRejected, defineCommand } from './command'

/**
 * Entity commands: move, rotate, mirror, delete
 * (docs/spec/05-editing.md § Entity commands, § Rotate and mirror).
 * Entities are addressed by their index in the blueprint's `entities`, as the
 * canvas selection is.
 */

export interface EntitiesArgs {
  /** Book path of the blueprint. */
  path: BookPath
  /** Indexes into the blueprint's `entities`. */
  indexes: readonly number[]
  /** Sizes and types (the PrototypeDb or the fallback table). */
  lookup: PrototypeLookup
}

export interface MoveArgs extends EntitiesArgs {
  /** Whole tiles; even when the selection holds rail-grid entities. */
  dx: number
  dy: number
}

export type Turn = 'cw' | 'ccw'
export type MirrorAxis = 'horizontal' | 'vertical'

export interface RotateArgs extends EntitiesArgs {
  turn: Turn
}

export interface MirrorArgs extends EntitiesArgs {
  axis: MirrorAxis
}

interface Target {
  entity: BlueprintEntity
  info: EntityPrototypeInfo | undefined
}

function blueprintOf(draft: BlueprintEnvelope, path: BookPath): JsonObject {
  const node = getNode(draft, path)
  if (node?.kind !== 'blueprint') throw new CommandRejected('That blueprint no longer exists.')
  return node.payload
}

function targets(draft: BlueprintEnvelope, args: EntitiesArgs): Target[] {
  const entities = (blueprintOf(draft, args.path)['entities'] ?? []) as BlueprintEntity[]
  return [...new Set(args.indexes)].map((i) => {
    const entity = entities[i]
    if (!entity) throw new CommandRejected('A selected entity no longer exists.')
    return { entity, info: args.lookup(entity.name) }
  })
}

const count = (n: number): string => (n === 1 ? 'entity' : `${n} entities`)

/** Whether a selection must stay on the 2×2 rail grid. */
export function selectionOnRailGrid(
  entities: readonly Pick<BlueprintEntity, 'name'>[],
  lookup: PrototypeLookup
): boolean {
  return entities.some((e) => isRailGrid(lookup(e.name)))
}

export const moveEntities = defineCommand<MoveArgs>({
  name: 'moveEntities',
  label: (args) => `Move ${count(new Set(args.indexes).size)}`,
  run(draft, args) {
    if (!Number.isInteger(args.dx) || !Number.isInteger(args.dy))
      throw new CommandRejected('Entities move by whole tiles.')
    const list = targets(draft, args)
    if (args.dx === 0 && args.dy === 0) return
    if ((args.dx % 2 !== 0 || args.dy % 2 !== 0) && list.some((t) => isRailGrid(t.info)))
      throw new CommandRejected('Rails move in steps of 2 tiles.')
    for (const { entity } of list) {
      entity.position.x += args.dx
      entity.position.y += args.dy
    }
  }
})

export const rotateEntities = defineCommand<RotateArgs>({
  name: 'rotateEntities',
  label: (args) => `Rotate ${count(new Set(args.indexes).size)}`,
  run(draft, args) {
    const list = targets(draft, args)
    const box = selectionBox(list)
    if (!box) return
    const quarter = args.turn === 'cw' ? 1 : -1
    const pivot = rotationPivot(
      box,
      args.turn,
      list.some((t) => isRailGrid(t.info))
    )
    for (const { entity, info } of list) {
      setPosition(entity, rotatePosition(entity.position, pivot, quarter))
      if (typeof entity.orientation === 'number') {
        entity.orientation = wrap(entity.orientation + quarter / 4)
      } else if (canRotate(info)) {
        setDirection(
          entity,
          normalizeDirection(info?.type, rotateDirection(direction(entity), quarter))
        )
      }
    }
  }
})

export const mirrorEntities = defineCommand<MirrorArgs>({
  name: 'mirrorEntities',
  label: (args) => `Mirror ${count(new Set(args.indexes).size)}`,
  run(draft, args) {
    const list = targets(draft, args)
    const box = selectionBox(list)
    if (!box) return
    const pivot = mirrorPivot(
      box,
      list.some((t) => isRailGrid(t.info))
    )
    const horizontal = args.axis === 'horizontal'
    for (const { entity, info } of list) {
      setPosition(entity, mirrorPosition(entity.position, pivot, args.axis))
      if (typeof entity.orientation === 'number') {
        entity.orientation = wrap((horizontal ? 1 : 1.5) - entity.orientation)
        continue
      }
      if (canRotate(info)) {
        const d = mirrorDirection(direction(entity), args.axis) + mirrorOffset(info?.type)
        setDirection(entity, normalizeDirection(info?.type, d))
      }
      if (canMirror(info)) {
        if (entity.mirror === true) delete entity.mirror
        else entity.mirror = true
      }
      if (info?.type === 'splitter' || info?.type === 'lane-splitter') swapPriorities(entity)
    }
  }
})

export const deleteEntities = defineCommand<EntitiesArgs>({
  name: 'deleteEntities',
  label: (args) => `Delete ${count(new Set(args.indexes).size)}`,
  run(draft, args) {
    const blueprint = blueprintOf(draft, args.path)
    const list = targets(draft, args)
    if (!list.length) return
    const doomed = new Set(list.map((t) => t.entity))
    const removed = new Set(list.map((t) => t.entity.entity_number))
    const entities = blueprint['entities'] as BlueprintEntity[]
    setOrDelete(
      blueprint,
      'entities',
      entities.filter((e) => !doomed.has(e))
    )
    removeReferences(blueprint, removed)
  }
})

/** Drops wires, train schedule locomotives and stock connections that name removed entities. */
function removeReferences(blueprint: JsonObject, removed: ReadonlySet<number>): void {
  const gone = (n: unknown): boolean => removed.has(n as number)
  prune(blueprint, 'wires', (w) => !(Array.isArray(w) && (gone(w[0]) || gone(w[2]))))
  prune(blueprint, 'schedules', (schedule) => {
    const locomotives = isObject(schedule) ? schedule['locomotives'] : undefined
    if (!isObject(schedule) || !Array.isArray(locomotives)) return true
    const left = locomotives.filter((n) => !gone(n))
    if (left.length !== locomotives.length) schedule['locomotives'] = left
    return left.length > 0
  })
  prune(blueprint, 'stock_connections', (connection) => {
    if (!isObject(connection)) return true
    if (gone(connection['stock'])) return false
    for (const end of ['front', 'back'] as const) if (gone(connection[end])) delete connection[end]
    return true
  })
}

/** Keeps the items of a list where `keep` says so (it may also change them); an emptied list is removed. */
function prune(object: JsonObject, key: string, keep: (item: unknown) => boolean): void {
  const list = object[key]
  if (!Array.isArray(list)) return
  const kept = list.filter((item) => keep(item))
  if (kept.length !== list.length) setOrDelete(object, key, kept)
}

// ---------------------------------------------------------------------------
// Pivots. See docs/spec/05-editing.md § Rotate and mirror.

function selectionBox(list: readonly Target[]): Box | null {
  return unionBoxes(list.map((t) => entityFootprint(t.entity, t.info).box))
}

/**
 * The point a selection turns around: its box centre, moved by half a tile when
 * needed so every footprint stays on the tile grid (both coordinates whole or
 * both half). The adjustment for `ccw` undoes the one for `cw`, and four turns
 * the same way return to the start. With rail-grid entities the pivot is a
 * whole point with an even coordinate sum, which keeps rails on the rail grid.
 */
export function rotationPivot(box: Box, turn: Turn, railGrid: boolean): Position {
  const c = boxCenter(box)
  if (railGrid) return railRotationPivot(c, turn)
  const xHalf = !Number.isInteger(c.x)
  const yHalf = !Number.isInteger(c.y)
  if (xHalf === yHalf) return c
  if (turn === 'cw') return { x: c.x + (xHalf ? -0.5 : 0.5), y: c.y }
  return { x: c.x, y: c.y + (xHalf ? 0.5 : -0.5) }
}

function railRotationPivot(c: Position, turn: Turn): Position {
  const candidates = railCandidates(c)
  if (turn === 'cw') return candidates[0]!
  // Pick the pivot a clockwise turn would have used to get here, so ccw undoes cw.
  for (const p of candidates) {
    const before = rotatePosition(c, p, -1)
    const cw = railCandidates(before)[0]!
    if (cw.x === p.x && cw.y === p.y) return p
  }
  return candidates[0]!
}

/** Whole points with an even coordinate sum near `c`, nearest first. */
function railCandidates(c: Position): Position[] {
  const points: Position[] = []
  for (let x = Math.floor(c.x) - 2; x <= Math.ceil(c.x) + 2; x++)
    for (let y = Math.floor(c.y) - 2; y <= Math.ceil(c.y) + 2; y++)
      if ((((x + y) % 2) + 2) % 2 === 0) points.push({ x, y })
  const distance = (p: Position): number => (p.x - c.x) ** 2 + (p.y - c.y) ** 2
  return points.sort((a, b) => distance(a) - distance(b) || a.x - b.x || a.y - b.y)
}

/**
 * The line a selection mirrors across: through its box centre, which keeps
 * footprints on the grid. Rails need a whole line; a half one moves to the even
 * neighbour, so mirroring twice returns to the start.
 */
export function mirrorPivot(box: Box, railGrid: boolean): Position {
  const c = boxCenter(box)
  if (!railGrid) return c
  const whole = (v: number): number => {
    if (Number.isInteger(v)) return v
    const low = Math.floor(v)
    return low % 2 === 0 ? low : low + 1
  }
  return { x: whole(c.x), y: whole(c.y) }
}

// ---------------------------------------------------------------------------
// Field helpers

function direction(entity: BlueprintEntity): Direction {
  return directionOf(entity)
}

/** North is written by leaving `direction` out, as the game does. */
function setDirection(entity: BlueprintEntity, value: number): void {
  if (value === 0) {
    if ('direction' in entity) delete entity.direction
  } else if (entity.direction !== value) {
    entity.direction = value
  }
}

function setPosition(entity: BlueprintEntity, p: Position): void {
  // + 0 turns -0 into 0.
  if (entity.position.x !== p.x) entity.position.x = p.x + 0
  if (entity.position.y !== p.y) entity.position.y = p.y + 0
}

function swapPriorities(entity: BlueprintEntity): void {
  const record = entity as Record<string, unknown>
  for (const key of ['input_priority', 'output_priority']) {
    if (record[key] === 'left') record[key] = 'right'
    else if (record[key] === 'right') record[key] = 'left'
  }
}

function setOrDelete(object: JsonObject, key: string, list: unknown[]): void {
  if (list.length) object[key] = list as JsonObject[keyof JsonObject]
  else delete object[key]
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function wrap(orientation: number): number {
  return ((orientation % 1) + 1) % 1
}
