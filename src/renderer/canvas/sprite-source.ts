import type { BlueprintLayout, EntityLayout } from '@core/model'
import type { EntityProto, PrototypeDb } from '@core/prototypes'
import {
  drawsFlipped,
  graphicsFor,
  graphicsOptionsFor,
  graphicsOptionsKey,
  circuitConnector,
  circuitWiredEntities,
  pickShape,
  poleVariations,
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
  let variations: Map<number, number> | undefined
  let wired: Set<number> | undefined
  /** The picture variation a pole's wires pick. */
  const poleVariation = (e: EntityLayout): number => {
    if (!layout) return 0
    variations ??= poleVariations(db, layout)
    return variations.get(e.index) ?? 0
  }
  /** The circuit connector of an entity with circuit wires, or null. */
  const wiredConnector = (
    proto: EntityProto,
    e: EntityLayout,
    shape: Shape | null,
    variation: number
  ): ReturnType<typeof circuitConnector> => {
    wired ??= circuitWiredEntities(layout?.wires ?? [])
    if (!proto.wirePoints || !wired.has(e.entity.entity_number)) return null
    return circuitConnector(proto.wirePoints, e, { shape, variation })
  }
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
    const variation = proto.type === 'electric-pole' ? poleVariation(e) : 0
    if (variation) options.variation = variation
    const connector = wiredConnector(proto, e, shape, variation)
    const key = [
      e.entity.name,
      e.direction,
      shape ? shapeKey(shape) : '',
      graphicsOptionsKey(options),
      drawsFlipped(proto, e) ? 'm' : '',
      connector?.key ?? ''
    ].join('\u0000')
    let layers = cache.get(key)
    if (layers === undefined) {
      const graphics = graphicsFor(proto, e)
      layers = shape
        ? resolveShape(proto, e.direction, shape)
        : graphics
          ? resolveGraphics(graphics, e.direction, options)
          : null
      if (layers && connector) layers = [...layers, ...connector.layers()]
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
