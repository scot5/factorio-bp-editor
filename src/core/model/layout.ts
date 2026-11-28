import {
  directionFromOrientation,
  directionOf,
  footprint,
  isCardinal,
  orientedSize,
  unionBoxes,
  type Box,
  type Direction,
  type TileSize
} from '../geometry'
import {
  categoryOf,
  FACING_TYPES,
  ROLLING_STOCK_TYPES,
  type EntityCategory,
  type EntityPrototypeInfo,
  type PrototypeLookup
} from '../prototypes/sizes'
import type { Blueprint, BlueprintEntity } from './schema'
import { blueprintWires, type Wire } from './wires'

/**
 * Footprint layout of a blueprint for the viewer (docs/spec/04-visualization.md).
 * Pure: the canvas, hit testing and status bar all use the same result.
 */

export interface EntityLayout {
  /** Index in `blueprint.entities`. */
  index: number
  entity: BlueprintEntity
  /** Occupied area in tiles. */
  box: Box
  size: TileSize
  /** Facing; for rolling stock derived from `orientation`. */
  direction: Direction
  /** Whether the entity has a meaningful facing to draw. */
  directional: boolean
  category: EntityCategory
  /** False when the prototype is not in the lookup (modded or removed); drawn as a 1×1 marker. */
  known: boolean
}

export interface TileLayout {
  name: string
  x: number
  y: number
}

export interface BlueprintLayout {
  entities: EntityLayout[]
  tiles: TileLayout[]
  /** The blueprint's wires (top-level 2.x `wires`). */
  wires: Wire[]
  /** Bounding box of entities and tiles, or null for an empty blueprint. */
  bounds: Box | null
  unknownNames: string[]
}

/**
 * Where an entity sits: its occupied box, size and facing. Rolling stock lies
 * along its `orientation`; the box snaps to the nearest axis.
 */
export function entityFootprint(
  entity: Pick<BlueprintEntity, 'position' | 'direction' | 'orientation'>,
  info: EntityPrototypeInfo | undefined
): { box: Box; size: TileSize; direction: Direction; rolling: boolean } {
  const rolling = info !== undefined && ROLLING_STOCK_TYPES.has(info.type)
  const direction =
    rolling && typeof entity.orientation === 'number'
      ? directionFromOrientation(entity.orientation)
      : directionOf(entity)
  const base: TileSize = info ? { width: info.width, height: info.height } : { width: 1, height: 1 }
  let size = base
  if (rolling) {
    if (Math.round(((entity.orientation ?? 0) * 4) % 2) === 1)
      size = { width: base.height, height: base.width }
  } else if (isCardinal(direction)) {
    size = orientedSize(base, direction)
  }
  return { box: footprint(entity.position, size), size, direction, rolling }
}

export function layoutBlueprint(blueprint: Blueprint, lookup: PrototypeLookup): BlueprintLayout {
  const unknown = new Set<string>()
  const entities = (blueprint.entities ?? []).map((entity, index): EntityLayout => {
    const info = lookup(entity.name)
    if (!info) unknown.add(entity.name)
    const { box, size, direction, rolling } = entityFootprint(entity, info)
    return {
      index,
      entity,
      box,
      size,
      direction,
      directional:
        entity.direction !== undefined ||
        rolling ||
        (info !== undefined && FACING_TYPES.has(info.type)),
      category: categoryOf(info),
      known: info !== undefined
    }
  })

  const tiles = (blueprint.tiles ?? []).map((t) => ({
    name: t.name,
    x: t.position.x,
    y: t.position.y
  }))

  const bounds = unionBoxes([
    ...entities.map((e) => e.box),
    ...tiles.map((t) => ({ left: t.x, top: t.y, right: t.x + 1, bottom: t.y + 1 }))
  ])

  return {
    entities,
    tiles,
    wires: blueprintWires(blueprint),
    bounds,
    unknownNames: [...unknown].sort((a, b) => a.localeCompare(b))
  }
}
