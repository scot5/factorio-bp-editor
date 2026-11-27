/**
 * Prototype types that have a collision box but can never be in a blueprint
 * (decoratives, corpses, enemies, projectiles, …). Shared by the PrototypeDb
 * builder and scripts/gen-entity-sizes.ts, so this file has no imports.
 */
export const NOT_BLUEPRINTABLE_TYPES: ReadonlySet<string> = new Set([
  'optimized-decorative',
  'corpse',
  'rail-remnants',
  'segment',
  'segmented-unit',
  'simple-entity',
  'tree',
  'plant',
  'fish',
  'asteroid',
  'resource',
  'cliff',
  'unit',
  'unit-spawner',
  'turret', // worms; player turrets are ammo-, electric-, fluid- and artillery-turret
  'spider-unit',
  'spider-leg',
  'character',
  'combat-robot',
  'construction-robot',
  'logistic-robot',
  'capture-robot',
  'projectile',
  'rocket-silo-rocket',
  'rocket-silo-rocket-shadow',
  'cargo-pod',
  'temporary-container',
  'item-entity',
  'item-request-proxy',
  'tile-ghost',
  'deconstructible-tile-proxy',
  'armor'
])

type Vec = readonly [number, number] | { readonly x: number; readonly y: number }

/** Tile size from a prototype's `tile_width`/`tile_height` or collision box (rounded up). */
export function tileSizeOf(proto: {
  collision_box?: readonly [Vec, Vec]
  tile_width?: number
  tile_height?: number
}): { width: number; height: number } {
  let width = proto.tile_width
  let height = proto.tile_height
  if ((width === undefined || height === undefined) && proto.collision_box) {
    const xy = (v: Vec): readonly [number, number] => ('x' in v ? [v.x, v.y] : v)
    const [x1, y1] = xy(proto.collision_box[0])
    const [x2, y2] = xy(proto.collision_box[1])
    // Collision boxes are slightly smaller than the tiles they occupy (e.g. ±1.2 for 3×3).
    width ??= Math.max(1, Math.ceil(x2 - x1 - 1e-6))
    height ??= Math.max(1, Math.ceil(y2 - y1 - 1e-6))
  }
  return { width: width ?? 1, height: height ?? 1 }
}
