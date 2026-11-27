import { DRAW_LAYERS, type DrawLayer } from './types'

/**
 * The draw pass for a game render layer name (RenderLayer in the prototype
 * API): the rail and body passes keep their own name, floor-level layers go
 * to the ground pass, the rest to the nearest pass above or below. See
 * docs/spec/04-visualization.md § Layer order.
 */
export function drawLayerFor(renderLayer: unknown): DrawLayer {
  if (typeof renderLayer !== 'string') return 'object'
  if ((DRAW_LAYERS as readonly string[]).includes(renderLayer)) return renderLayer as DrawLayer
  const mapped = NEAREST[renderLayer]
  if (mapped) return mapped
  if (FLOOR_LAYERS.has(renderLayer)) return 'ground'
  if (renderLayer.startsWith('higher-object')) return 'higher-object'
  if (renderLayer.startsWith('elevated-')) return 'elevated-object'
  return 'object'
}

const NEAREST: Record<string, DrawLayer> = {
  'transport-belt-circuit-connector': 'lower-object',
  'lower-object-overlay': 'lower-object-above-shadow',
  'higher-object-above': 'higher-object',
  'train-stop-top': 'higher-object',
  'item-in-inserter-hand': 'higher-object',
  wires: 'above-inserters',
  'wires-above': 'above-inserters'
}

const FLOOR_LAYERS = new Set([
  'zero',
  'background-transitions',
  'under-tiles',
  'decals',
  'above-tiles',
  'ground-layer-1',
  'ground-layer-2',
  'ground-layer-3',
  'ground-layer-4',
  'ground-layer-5',
  'lower-radius-visualization',
  'radius-visualization',
  'transport-belt-integration',
  'resource',
  'building-smoke',
  'decorative',
  'ground-patch',
  'ground-patch-higher',
  'ground-patch-higher2',
  'remnants',
  'floor',
  'transport-belt',
  'transport-belt-endings',
  'transport-belt-reader',
  'floor-mechanics-under-corpse',
  'corpse',
  'floor-mechanics',
  'item'
])
