import type { PrototypeDb } from '@core/prototypes'
import { resolveGraphics, type SpriteLayer } from '@core/sprites'
import type { SpriteSource } from './scene'

/** Sprite layers from the prototype DB, resolved once per prototype and direction. */
export function spriteSourceFor(db: PrototypeDb): SpriteSource {
  const cache = new Map<string, readonly SpriteLayer[] | null>()
  return (e) => {
    if (!e.known) return null
    const key = `${e.entity.name}\u0000${e.direction}`
    let layers = cache.get(key)
    if (layers === undefined) {
      const graphics = db.entities[e.entity.name]?.graphics
      layers = graphics ? resolveGraphics(graphics, e.direction) : null
      cache.set(key, layers)
    }
    return layers
  }
}
