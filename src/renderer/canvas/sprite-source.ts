import type { BlueprintLayout } from '@core/model'
import type { PrototypeDb } from '@core/prototypes'
import {
  drawsFlipped,
  graphicsFor,
  graphicsOptionsFor,
  graphicsOptionsKey,
  pickShape,
  resolveGraphics,
  resolveShape,
  resolveTile,
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
  const entity: SpriteSource['entity'] = (e) => {
    if (!e.known) return null
    const proto = db.entities[e.entity.name]
    if (!proto || (!proto.graphics && !proto.shapes)) return null
    let shape: Shape | null = null
    if (proto.shapes) {
      at ??= tileIndex(db, layout?.entities ?? [])
      shape = pickShape(db, e, at)
    }
    const options = graphicsOptionsFor(proto, e)
    const key = [
      e.entity.name,
      e.direction,
      shape ? shapeKey(shape) : '',
      graphicsOptionsKey(options),
      drawsFlipped(proto, e) ? 'm' : ''
    ].join('\u0000')
    let layers = cache.get(key)
    if (layers === undefined) {
      const graphics = graphicsFor(proto, e)
      layers = shape
        ? resolveShape(proto, e.direction, shape)
        : graphics
          ? resolveGraphics(graphics, e.direction, options)
          : null
      cache.set(key, layers)
    }
    return layers
  }
  const tile: SpriteSource['tile'] = (t) => {
    const g = db.tileGraphics?.[t.name]
    return g ? resolveTile(g, t.x, t.y) : null
  }
  return { entity, tile }
}
