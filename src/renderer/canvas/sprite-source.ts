import type { BlueprintLayout } from '@core/model'
import type { PrototypeDb } from '@core/prototypes'
import {
  pickShape,
  resolveGraphics,
  resolveShape,
  shapeKey,
  tileIndex,
  type Shape,
  type SpriteLayer,
  type TileQuery
} from '@core/sprites'
import type { SpriteSource } from './scene'

/**
 * Resolved sprite layers per prototype, direction and neighbour shape, shared
 * by every blueprint drawn with the same DB.
 */
export interface SpriteResolver {
  db: PrototypeDb
  cache: Map<string, readonly SpriteLayer[] | null>
}

export function spriteResolverFor(db: PrototypeDb): SpriteResolver {
  return { db, cache: new Map() }
}

/**
 * Sprite layers for one blueprint layout. Belts, pipes, walls and the like
 * look at their neighbours through a tile index of the layout, built on the
 * first sprite request.
 */
export function spriteSourceFor(
  resolver: SpriteResolver,
  layout: BlueprintLayout | null
): SpriteSource {
  const { db, cache } = resolver
  let at: TileQuery | undefined
  return (e) => {
    if (!e.known) return null
    const proto = db.entities[e.entity.name]
    if (!proto || (!proto.graphics && !proto.shapes)) return null
    let shape: Shape | null = null
    if (proto.shapes) {
      at ??= tileIndex(db, layout?.entities ?? [])
      shape = pickShape(db, e, at)
    }
    const key = `${e.entity.name}\u0000${e.direction}\u0000${shape ? shapeKey(shape) : ''}`
    let layers = cache.get(key)
    if (layers === undefined) {
      layers = shape
        ? resolveShape(proto, e.direction, shape)
        : proto.graphics
          ? resolveGraphics(proto.graphics, e.direction)
          : null
      cache.set(key, layers)
    }
    return layers
  }
}
