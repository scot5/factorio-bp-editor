import { dataUrl } from '../assets/asset-url'
import type { SpriteLayer } from './types'

/**
 * Tile sprites: which part of a tile's image a blueprint tile draws.
 * See docs/spec/03-game-assets.md § Tiles.
 *
 * Two kinds of TileSpriteLayout are used, both read from `variants`:
 * - `material`: `material_background`, one texture of `count` blocks of
 *   `material_texture_width_in_tiles` × `…_height_in_tiles` tiles (default
 *   8 × 8), `lineLength` blocks per row (concrete, landfill, foundation,
 *   Fulgora's ground). A tile draws its square of the block its position
 *   falls in.
 * - `main`: the 1×1 entry of `main`, `count` single-tile variations in rows
 *   of `lineLength` (stone path, space platform foundation).
 * Transitions to neighbouring tiles are not drawn.
 */
export interface TileGraphics {
  kind: 'material' | 'main'
  file: string
  count: number
  /** Default 1; 0.5 for the high-resolution tiles (64 px per tile). */
  scale?: number
  x?: number
  y?: number
  /** Variations (blocks for `material`) per row, default `count`. */
  lineLength?: number
  /** `material` only: block size in tiles, default MATERIAL_BLOCK. */
  blockWidth?: number
  blockHeight?: number
}

/** Default tiles per side of one `material_background` block (4096 × 512 px sheets of 8 blocks at scale 0.5). */
export const MATERIAL_BLOCK = 8

/** The drawable graphics of a raw tile prototype, or undefined. */
export function tileGraphics(proto: Record<string, unknown>): TileGraphics | undefined {
  const variants = proto['variants']
  if (!isRecord(variants)) return undefined
  const material = variants['material_background']
  if (isRecord(material) && typeof material['picture'] === 'string')
    return build('material', material, material['picture'], {
      blockWidth: positiveInt(variants['material_texture_width_in_tiles']),
      blockHeight: positiveInt(variants['material_texture_height_in_tiles'])
    })
  const main = variants['main']
  if (!Array.isArray(main)) return undefined
  const single = main.find((m) => isRecord(m) && (m['size'] ?? 1) === 1)
  if (!isRecord(single) || typeof single['picture'] !== 'string') return undefined
  if (single['picture'].endsWith('-dummy.png')) return undefined
  return build('main', single, single['picture'])
}

function build(
  kind: TileGraphics['kind'],
  raw: Record<string, unknown>,
  file: string,
  block: { blockWidth?: number | undefined; blockHeight?: number | undefined } = {}
): TileGraphics | undefined {
  const count = positiveInt(raw['count']) ?? 1
  const scale = typeof raw['scale'] === 'number' && raw['scale'] > 0 ? raw['scale'] : 1
  const x = positiveInt(raw['x'])
  const y = positiveInt(raw['y'])
  const lineLength = positiveInt(raw['line_length'])
  return {
    kind,
    file,
    count,
    ...(scale !== 1 ? { scale } : {}),
    ...(x ? { x } : {}),
    ...(y ? { y } : {}),
    ...(lineLength && lineLength !== count ? { lineLength } : {}),
    ...(block.blockWidth && block.blockWidth !== MATERIAL_BLOCK
      ? { blockWidth: block.blockWidth }
      : {}),
    ...(block.blockHeight && block.blockHeight !== MATERIAL_BLOCK
      ? { blockHeight: block.blockHeight }
      : {})
  }
}

/** The layer for the tile at (x, y) (its top-left corner), centred on the tile. */
export function resolveTile(g: TileGraphics, x: number, y: number): SpriteLayer | null {
  const url = dataUrl(g.file)
  if (!url) return null
  const scale = g.scale ?? 1
  const px = Math.round(32 / scale)
  let rx: number
  let ry: number
  if (g.kind === 'material') {
    const bw = g.blockWidth ?? MATERIAL_BLOCK
    const bh = g.blockHeight ?? MATERIAL_BLOCK
    const variant = hash(Math.floor(x / bw), Math.floor(y / bh)) % g.count
    const line = g.lineLength ?? g.count
    rx = ((variant % line) * bw + mod(x, bw)) * px
    ry = (Math.floor(variant / line) * bh + mod(y, bh)) * px
  } else {
    const variant = hash(x, y) % g.count
    const line = g.lineLength ?? g.count
    rx = (variant % line) * px
    ry = Math.floor(variant / line) * px
  }
  return {
    url,
    rect: { x: (g.x ?? 0) + rx, y: (g.y ?? 0) + ry, w: px, h: px },
    shift: [0, 0],
    scale,
    shadow: false,
    ground: true
  }
}

/** A stable, well-mixed variation choice per position (the game's own is random). */
function hash(x: number, y: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h ^= h >>> 13
  return h >>> 0
}

const mod = (a: number, n: number): number => ((a % n) + n) % n

const positiveInt = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v >= 1 ? Math.floor(v) : undefined

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
