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
  ROLLING_STOCK_TYPES,
  type EntityCategory,
  type PrototypeLookup
} from '../prototypes/sizes'
import type { Blueprint, BlueprintEntity } from './schema'

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
  /** Bounding box of entities and tiles, or null for an empty blueprint. */
  bounds: Box | null
  unknownNames: string[]
}

export function layoutBlueprint(blueprint: Blueprint, lookup: PrototypeLookup): BlueprintLayout {
  const unknown = new Set<string>()
  const entities = (blueprint.entities ?? []).map((entity, index): EntityLayout => {
    const info = lookup(entity.name)
    if (!info) unknown.add(entity.name)
    const rolling = info !== undefined && ROLLING_STOCK_TYPES.has(info.type)
    const direction =
      rolling && typeof entity.orientation === 'number'
        ? directionFromOrientation(entity.orientation)
        : directionOf(entity)
    const base: TileSize = info
      ? { width: info.width, height: info.height }
      : { width: 1, height: 1 }
    // Rolling stock lies along its orientation; snap to the nearest axis for the footprint.
    const size = rolling
      ? Math.round(((entity.orientation ?? 0) * 4) % 2) === 1
        ? { width: base.height, height: base.width }
        : base
      : isCardinal(direction)
        ? orientedSize(base, direction)
        : base
    return {
      index,
      entity,
      box: footprint(entity.position, size),
      size,
      direction,
      directional: entity.direction !== undefined || rolling,
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

  return { entities, tiles, bounds, unknownNames: [...unknown].sort() }
}
