import type { EntityLayout } from '../model/layout'
import type { EntityProto } from '../prototypes/db'
import { ROLLING_STOCK_TYPES } from '../prototypes/sizes'
import { color } from './normalize'
import type { GraphicsOptions } from './resolve'

/**
 * What else besides the prototype and direction decides an entity's static
 * graphics: rolling stock `orientation`, a signal's `rail_layer`, and the
 * `color` that tints train stop and rolling stock masks (the prototype's
 * default when the blueprint has none). Part of the renderer's cache key.
 */
export function graphicsOptionsFor(proto: EntityProto, e: EntityLayout): GraphicsOptions {
  const out: GraphicsOptions = {}
  const { orientation } = e.entity
  if (ROLLING_STOCK_TYPES.has(proto.type) && typeof orientation === 'number')
    out.orientation = orientation
  if (e.entity['rail_layer'] === 'elevated') out.railLayer = 'elevated'
  if (proto.color) out.runtimeTint = color(e.entity['color']) ?? proto.color
  return out
}

/** Cache key of graphics options; empty for the common case. */
export function graphicsOptionsKey(options: GraphicsOptions): string {
  let key = ''
  if (options.orientation !== undefined) key += `o${options.orientation}`
  if (options.railLayer) key += `r${options.railLayer}`
  if (options.runtimeTint) key += `t${options.runtimeTint.join(',')}`
  return key
}
