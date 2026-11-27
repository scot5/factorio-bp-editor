import { NOT_BLUEPRINTABLE_TYPES, tileSizeOf } from './blueprintable'
import type { PrototypeLookup } from './sizes'

/**
 * Compact prototype database built from Factorio's `data-raw-dump.json`.
 * See docs/spec/03-game-assets.md § Prototype data.
 *
 * Bump DB_FORMAT_VERSION whenever the shape or contents change, so cached
 * databases are rebuilt.
 */
export const DB_FORMAT_VERSION = 1

export type BoxTuple = [[number, number], [number, number]]

export interface EntityProto {
  type: string
  width: number
  height: number
  collisionBox?: BoxTuple
  selectionBox?: BoxTuple
}

export interface ItemProto {
  type: string
  stackSize?: number
  placeResult?: string
  subgroup?: string
  order?: string
}

export interface RecipeIngredient {
  type: 'item' | 'fluid'
  name: string
  amount: number
}

export interface RecipeProto {
  category: string
  energy: number
  ingredients: RecipeIngredient[]
  results: (RecipeIngredient & { probability?: number })[]
}

export interface QualityProto {
  level: number
  color?: string
}

/** Icon categories as written by `--dump-icon-sprites` (one folder each). */
export type IconCategory =
  | 'item'
  | 'entity'
  | 'recipe'
  | 'fluid'
  | 'virtual-signal'
  | 'tile'
  | 'quality'
  | 'technology'
  | 'space-location'
  | 'item-group'
  | 'achievement'
  | 'equipment'
  | 'asteroid-chunk'

export interface PrototypeDb {
  formatVersion: number
  gameVersion: string
  mods: { name: string; version: string }[]
  entities: Record<string, EntityProto>
  items: Record<string, ItemProto>
  recipes: Record<string, RecipeProto>
  fluids: string[]
  virtualSignals: string[]
  qualities: Record<string, QualityProto>
  tiles: string[]
  /** Names that have an icon file, per category (filled in by the main process). */
  icons: Partial<Record<IconCategory, string[]>>
}

/** Item prototype types (anything that can be in an inventory). */
const ITEM_TYPES = [
  'item',
  'ammo',
  'armor',
  'blueprint',
  'blueprint-book',
  'capsule',
  'copy-paste-tool',
  'deconstruction-item',
  'gun',
  'item-with-entity-data',
  'item-with-inventory',
  'item-with-label',
  'item-with-tags',
  'module',
  'rail-planner',
  'repair-tool',
  'selection-tool',
  'space-platform-starter-pack',
  'spidertron-remote',
  'tool',
  'upgrade-item'
]

type Raw = Record<string, Record<string, Record<string, unknown>>>
type Vec = [number, number] | { x: number; y: number }

const toTuple = (v: Vec): [number, number] => (Array.isArray(v) ? [v[0], v[1]] : [v.x, v.y])

function box(value: unknown): BoxTuple | undefined {
  if (!Array.isArray(value) || value.length !== 2) return undefined
  return [toTuple(value[0] as Vec), toTuple(value[1] as Vec)]
}

function ingredients(value: unknown): RecipeIngredient[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((raw): RecipeIngredient[] => {
    if (Array.isArray(raw))
      return [{ type: 'item', name: String(raw[0]), amount: Number(raw[1] ?? 1) }]
    if (raw && typeof raw === 'object') {
      const r = raw as Record<string, unknown>
      return [
        {
          type: r['type'] === 'fluid' ? 'fluid' : 'item',
          name: String(r['name']),
          amount: Number(r['amount'] ?? r['amount_max'] ?? 1),
          ...(typeof r['probability'] === 'number' ? { probability: r['probability'] } : {})
        }
      ]
    }
    return []
  })
}

function colorToCss(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined
  const c = value as Record<string, number>
  const r = c['r'] ?? (value as number[])[0] ?? 0
  const g = c['g'] ?? (value as number[])[1] ?? 0
  const b = c['b'] ?? (value as number[])[2] ?? 0
  const scale = r > 1 || g > 1 || b > 1 ? 1 : 255
  const hex = (n: number): string =>
    Math.round(n * scale)
      .toString(16)
      .padStart(2, '0')
  return `#${hex(r)}${hex(g)}${hex(b)}`
}

/**
 * Builds the database from the parsed `data-raw-dump.json`.
 * `icons` is filled in separately from the icon dump folders.
 */
export function buildPrototypeDb(
  raw: Raw,
  meta: { gameVersion: string; mods: { name: string; version: string }[] }
): PrototypeDb {
  const entities: Record<string, EntityProto> = {}
  for (const [type, prototypes] of Object.entries(raw)) {
    if (NOT_BLUEPRINTABLE_TYPES.has(type)) continue
    for (const proto of Object.values(prototypes)) {
      if (!proto['collision_box'] && proto['tile_width'] === undefined) continue
      const name = String(proto['name'])
      const size = tileSizeOf(proto as Parameters<typeof tileSizeOf>[0])
      const collisionBox = box(proto['collision_box'])
      const selectionBox = box(proto['selection_box'])
      entities[name] = {
        type,
        ...size,
        ...(collisionBox ? { collisionBox } : {}),
        ...(selectionBox ? { selectionBox } : {})
      }
    }
  }

  const items: Record<string, ItemProto> = {}
  for (const type of ITEM_TYPES) {
    for (const proto of Object.values(raw[type] ?? {})) {
      items[String(proto['name'])] = {
        type,
        ...(typeof proto['stack_size'] === 'number' ? { stackSize: proto['stack_size'] } : {}),
        ...(typeof proto['place_result'] === 'string'
          ? { placeResult: proto['place_result'] }
          : {}),
        ...(typeof proto['subgroup'] === 'string' ? { subgroup: proto['subgroup'] } : {}),
        ...(typeof proto['order'] === 'string' ? { order: proto['order'] } : {})
      }
    }
  }

  const recipes: Record<string, RecipeProto> = {}
  for (const proto of Object.values(raw['recipe'] ?? {})) {
    recipes[String(proto['name'])] = {
      category: typeof proto['category'] === 'string' ? proto['category'] : 'crafting',
      energy: typeof proto['energy_required'] === 'number' ? proto['energy_required'] : 0.5,
      ingredients: ingredients(proto['ingredients']),
      results: ingredients(proto['results'])
    }
  }

  const qualities: Record<string, QualityProto> = {}
  for (const proto of Object.values(raw['quality'] ?? {})) {
    const color = colorToCss(proto['color'])
    qualities[String(proto['name'])] = {
      level: typeof proto['level'] === 'number' ? proto['level'] : 0,
      ...(color ? { color } : {})
    }
  }

  const names = (type: string): string[] => Object.keys(raw[type] ?? {}).sort()

  return {
    formatVersion: DB_FORMAT_VERSION,
    gameVersion: meta.gameVersion,
    mods: meta.mods,
    entities,
    items,
    recipes,
    fluids: names('fluid'),
    virtualSignals: names('virtual-signal'),
    qualities,
    tiles: names('tile'),
    icons: {}
  }
}

export function dbPrototypeLookup(db: PrototypeDb): PrototypeLookup {
  return (name) => db.entities[name]
}

/** Which icon folder a signal / rich-text reference lives in. */
export function iconCategoryFor(kind: string | undefined): IconCategory {
  switch (kind) {
    case undefined:
    case 'item':
      return 'item'
    case 'virtual':
    case 'virtual-signal':
      return 'virtual-signal'
    case 'planet':
    case 'space-location':
      return 'space-location'
    case 'entity':
    case 'recipe':
    case 'fluid':
    case 'tile':
    case 'quality':
    case 'technology':
    case 'item-group':
    case 'achievement':
    case 'equipment':
    case 'asteroid-chunk':
      return kind
    default:
      return 'item'
  }
}
