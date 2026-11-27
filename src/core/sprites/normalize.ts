import {
  DIRECTION_KEYS,
  type DirectionKey,
  type SpriteLeaf,
  type SpriteNode,
  type SpriteStripe
} from './types'

/**
 * Turns a graphics value from `data-raw-dump.json` (unknown JSON) into a
 * SpriteNode, or null when there is nothing to draw. This is the validation
 * step for sprite data: anything malformed is dropped, never trusted.
 *
 * Handles the shapes the 2.1 dump uses:
 *   { filename, width, height, … }           Sprite / Animation / Rotated*
 *   { filenames: [...], lines_per_file }       multi-file animations
 *   { stripes: [...] }                         striped animations
 *   { layers: [...] }
 *   { sheet: {...} } / { sheets: [...] }       Sprite4Way / SpriteNWaySheet
 *   { north, east, south, west, … }            per-direction objects
 *   { north, northeast, … }                    RailPictureSet / Sprite16Way keys
 *   [ ... ]                                    variations (the first is used)
 */
export function normalizeSprite(value: unknown): SpriteNode | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const node = normalizeSprite(item)
      if (node) return node
    }
    return null
  }
  if (!isRecord(value)) return null

  if (Array.isArray(value['layers'])) return layers(value['layers'].map(normalizeSprite))

  if (Array.isArray(value['sheets'])) return layers(value['sheets'].map(sheet))
  if (isRecord(value['sheet'])) return sheet(value['sheet'])

  if (DIRECTION_KEYS.some((k) => isRecord(value[k] ?? value[RAIL_KEYS[k]]))) {
    const directions: Partial<Record<DirectionKey, SpriteNode>> = {}
    for (const key of DIRECTION_KEYS) {
      const node = normalizeSprite(value[key] ?? value[RAIL_KEYS[key]])
      if (node) directions[key] = node
    }
    return Object.keys(directions).length ? { kind: 'directions', directions } : null
  }

  return leaf(value)
}

/** RailPictureSet and Sprite16Way spell the diagonals without an underscore. */
const RAIL_KEYS: Record<DirectionKey, string> = {
  north: 'north',
  north_east: 'northeast',
  east: 'east',
  south_east: 'southeast',
  south: 'south',
  south_west: 'southwest',
  west: 'west',
  north_west: 'northwest'
}

function layers(nodes: (SpriteNode | null)[]): SpriteNode | null {
  const present = nodes.filter((n): n is SpriteNode => n !== null)
  if (present.length === 0) return null
  return present.length === 1 ? present[0]! : { kind: 'layers', layers: present }
}

function sheet(value: unknown): SpriteNode | null {
  if (!isRecord(value)) return null
  const sprite = normalizeSprite(value)
  if (!sprite) return null
  const frames = positiveInt(value['frames']) ?? 4
  return { kind: 'sheet', frames, sprite }
}

const EMPTY_FILES = new Set(['__core__/graphics/empty.png'])

function leaf(value: Record<string, unknown>): SpriteLeaf | null {
  // Lights are additive glows drawn into the light map; a static view has none.
  if (value['draw_as_light'] === true) return null

  const files = Array.isArray(value['filenames'])
    ? value['filenames'].filter((f): f is string => typeof f === 'string')
    : undefined
  const stripes = Array.isArray(value['stripes'])
    ? value['stripes'].flatMap((s): SpriteStripe[] => {
        if (!isRecord(s) || typeof s['filename'] !== 'string') return []
        const widthInFrames = positiveInt(s['width_in_frames'])
        const heightInFrames = positiveInt(s['height_in_frames'])
        if (!widthInFrames || !heightInFrames) return []
        return [
          {
            file: s['filename'],
            widthInFrames,
            heightInFrames,
            ...optional('x', nonNegative(s['x'])),
            ...optional('y', nonNegative(s['y']))
          }
        ]
      })
    : undefined
  const file =
    typeof value['filename'] === 'string' ? value['filename'] : (files?.[0] ?? stripes?.[0]?.file)
  if (!file || EMPTY_FILES.has(file)) return null

  const size = value['size']
  const sizeTuple = Array.isArray(size) ? size : [size, size]
  const width = positiveInt(value['width']) ?? positiveInt(sizeTuple[0])
  const height = positiveInt(value['height']) ?? positiveInt(sizeTuple[1])
  if (!width || !height) return null

  const position = Array.isArray(value['position']) ? value['position'] : []
  const x = nonNegative(value['x']) ?? nonNegative(position[0])
  const y = nonNegative(value['y']) ?? nonNegative(position[1])
  const shift = vector(value['shift'])
  const scale = positive(value['scale'])
  const tint = color(value['tint'])

  return {
    kind: 'sprite',
    file,
    ...(files && files.length > 1 ? { files } : {}),
    ...(files && files.length > 1
      ? optional('linesPerFile', positiveInt(value['lines_per_file']))
      : {}),
    ...(stripes && stripes.length ? { stripes } : {}),
    width,
    height,
    ...optional('x', x || undefined),
    ...optional('y', y || undefined),
    ...(shift && (shift[0] !== 0 || shift[1] !== 0) ? { shift } : {}),
    ...optional('scale', scale === 1 ? undefined : scale),
    ...optional('lineLength', positiveInt(value['line_length'])),
    ...optional('frameCount', above1(value['frame_count'])),
    ...optional('repeatCount', above1(value['repeat_count'])),
    ...optional('directionCount', above1(value['direction_count'])),
    ...optional('variationCount', above1(value['variation_count'])),
    ...(value['back_equals_front'] === true && above1(value['direction_count'])
      ? { backEqualsFront: true as const }
      : {}),
    ...(value['draw_as_shadow'] === true ? { shadow: true as const } : {}),
    ...(tint && tint.some((c) => c !== 1) ? { tint } : {}),
    ...(value['apply_runtime_tint'] === true ? { runtimeTint: true as const } : {}),
    ...(typeof value['blend_mode'] === 'string' && value['blend_mode'].startsWith('additive')
      ? { additive: true as const }
      : {})
  }
}

// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optional<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  return (value === undefined ? {} : { [key]: value }) as { [P in K]?: V }
}

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const positive = (v: unknown): number | undefined => (isNumber(v) && v > 0 ? v : undefined)
const nonNegative = (v: unknown): number | undefined => (isNumber(v) && v >= 0 ? v : undefined)
const positiveInt = (v: unknown): number | undefined =>
  isNumber(v) && v >= 1 ? Math.floor(v) : undefined
const above1 = (v: unknown): number | undefined => {
  const n = positiveInt(v)
  return n && n > 1 ? n : undefined
}

function vector(value: unknown): [number, number] | undefined {
  if (Array.isArray(value) && isNumber(value[0]) && isNumber(value[1])) return [value[0], value[1]]
  if (isRecord(value) && isNumber(value['x']) && isNumber(value['y']))
    return [value['x'], value['y']]
  return undefined
}

/** Factorio Color: `{r,g,b,a}` or `[r,g,b,a]`, either 0–1 or 0–255. */
export function color(value: unknown): [number, number, number, number] | undefined {
  let parts: unknown[]
  if (Array.isArray(value)) parts = value
  else if (isRecord(value)) parts = [value['r'] ?? 0, value['g'] ?? 0, value['b'] ?? 0, value['a']]
  else return undefined
  const [r, g, b] = parts.map((p) => (isNumber(p) ? p : 0)) as [number, number, number]
  const a = isNumber(parts[3]) ? parts[3] : undefined
  const div = r > 1 || g > 1 || b > 1 || (a ?? 0) > 1 ? 255 : 1
  return [r / div, g / div, b / div, a === undefined ? 1 : a / div]
}
