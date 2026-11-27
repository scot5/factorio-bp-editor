import { NOT_BLUEPRINTABLE_TYPES, tileSizeOf } from './blueprintable'
import type { PrototypeLookup } from './sizes'
import { entityGraphics, entityGraphicsFlipped, entityShapes } from '../sprites/graphics'
import { color } from '../sprites/normalize'
import { tileGraphics, type TileGraphics } from '../sprites/tiles'
import type { GraphicsPart, ShapePictures } from '../sprites/types'
import { entityConnections, type EntityConnections } from './connections'
import { entityWirePoints, type EntityWirePoints } from './wires'
import { localise, type Locale, type NameCategory } from './locale'
import {
  entityStats,
  fluidHeat,
  itemCounts,
  itemStats,
  qualityMultipliers,
  type EntityStats,
  type ItemCount,
  type ItemStats,
  type StatsContext
} from './stats'

/**
 * Compact prototype database built from Factorio's `data-raw-dump.json`.
 * See docs/spec/03-game-assets.md § Prototype data.
 *
 * Bump DB_FORMAT_VERSION whenever the shape or contents change, so cached
 * databases are rebuilt.
 */
export const DB_FORMAT_VERSION = 9

/** Types whose prototype `color` tints their runtime-tint masks. */
const TINTED_TYPES: ReadonlySet<string> = new Set([
  'train-stop',
  'locomotive',
  'cargo-wagon',
  'fluid-wagon',
  'artillery-wagon',
  'infinity-cargo-wagon'
])

export type BoxTuple = [[number, number], [number, number]]

export interface EntityProto {
  type: string
  width: number
  height: number
  collisionBox?: BoxTuple
  selectionBox?: BoxTuple
  /** Static sprite definitions for the types in `SPRITE_TYPES` (format 2+). */
  graphics?: GraphicsPart[]
  /** Graphics of a mirrored entity, when the prototype has its own (`graphics_set_flipped`; format 5+). */
  graphicsFlipped?: GraphicsPart[]
  /** Neighbour-dependent pictures: belts, pipes, heat pipes, walls, undergrounds (format 3+). */
  shapes?: ShapePictures
  /** Fluid and heat connection points (format 3+). */
  connections?: EntityConnections
  /**
   * Default colour for `apply_runtime_tint` masks, RGBA 0–1: train stops and
   * rolling stock (format 4+). A blueprint `color` overrides it.
   */
  color?: [number, number, number, number]
  /** Where red, green and copper wires attach (format 6+). */
  wirePoints?: EntityWirePoints
  /** Numbers for analysis: crafting, modules, energy, belts, inserters, poles (format 7+). */
  stats?: EntityStats
}

export interface ItemProto extends ItemStats {
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

/** A recipe or mining product (format 9+ for everything but `type`, `name` and `amount`). */
export interface RecipeProduct extends RecipeIngredient {
  /**
   * Chance the product is given: `independent_probability` × the width of its
   * `shared_probability` range (2.1), or the 1.x/2.0 `probability`. Omitted at 1.
   */
  probability?: number
  /** Chance of one extra product per craft (`extra_count_fraction`). */
  extraCountFraction?: number
  /** Amount productivity does not multiply (`ignored_by_productivity`, default `ignored_by_stats`). */
  ignoredByProductivity?: number
}

/** A surface property range a recipe needs (format 9+). */
export interface SurfaceCondition {
  property: string
  min?: number
  max?: number
}

export interface RecipeProto {
  /** Recipe categories (2.1 `categories`; 1.x/2.0 `category`; default `crafting`; format 9+). */
  categories: string[]
  energy: number
  ingredients: RecipeIngredient[]
  results: RecipeProduct[]
  /** Productivity applies (default false; format 9+). */
  allowProductivity?: true
  /** Productivity cap when not the default 3 (format 9+). */
  maximumProductivity?: number
  surfaceConditions?: SurfaceCondition[]
  /** Hidden recipes (recycling, parameters, …; format 9+). */
  hidden?: true
}

/** A minable resource (format 9+). */
export interface ResourceProto {
  /** Resource category (default `basic-solid`). */
  category: string
  /** Seconds to mine one cycle at mining speed 1. */
  miningTime: number
  results: RecipeProduct[]
  /** Fluid used up while mining, `fluidAmount` per 10 cycles (uranium: sulfuric acid). */
  requiredFluid?: string
  fluidAmount?: number
  /** Infinite resources (crude oil, geysers): the yield depends on the patch. */
  infinite?: true
}

export interface QualityProto {
  level: number
  color?: string
  /** Next quality level (format 7+). */
  next?: string
  /** Explicit `*_multiplier` fields without the suffix (format 7+); see `qualityMultiplier`. */
  multipliers?: Record<string, number>
}

/** Solar power of a planet (format 8+). */
export interface PlanetProto {
  /** Surface `solar-power` property in percent (default from the surface property, 100). */
  solarPower: number
  /** `solar_power_in_space` in percent, for platforms in its orbit. */
  solarPowerInSpace?: number
  /** The planet's own `surface_properties` (format 9+); see `surfaceProperties`. */
  properties?: Record<string, number>
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
  /** Tile sprites by tile name (format 5+). */
  tileGraphics: Record<string, TileGraphics>
  /** Items that place each tile, from the tile's `placeable_by` or an item's `place_as_tile` (format 7+). */
  tileItems: Record<string, ItemCount[]>
  /** Planets with their solar power (format 8+). */
  planets: Record<string, PlanetProto>
  /** Minable resources (format 9+). */
  resources: Record<string, ResourceProto>
  /**
   * Surface property defaults (`surface-property` `default_value`) and the space
   * platform surface's own properties (format 9+).
   */
  surfaces: { defaults: Record<string, number>; platform: Record<string, number> }
  /** English display names per category, when locale files were read (format 7+). */
  names: Partial<Record<NameCategory, Record<string, string>>>
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

const numOr = (v: unknown, fallback: number): number => (typeof v === 'number' ? v : fallback)

/** `amount`, else the mean of `amount_min` and `amount_max` (max below min counts as min). */
function amountOf(r: Record<string, unknown>): number {
  if (typeof r['amount'] === 'number') return r['amount']
  const min = numOr(r['amount_min'], 1)
  return (min + Math.max(min, numOr(r['amount_max'], min))) / 2
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
          amount: amountOf(r)
        }
      ]
    }
    return []
  })
}

/** Chance a product is given: independent × shared range (2.1), else `probability` (2.0). */
function productProbability(r: Record<string, unknown>): number {
  const shared = r['shared_probability'] as Record<string, unknown> | undefined
  const range = shared ? numOr(shared['max'], 1) - numOr(shared['min'], 0) : 1
  return numOr(r['independent_probability'], numOr(r['probability'], 1)) * range
}

/** Recipe or minable products (`results`), with probability and productivity fields. */
export function products(value: unknown): RecipeProduct[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((raw): RecipeProduct[] => {
    const [base] = ingredients([raw])
    if (!base) return []
    if (Array.isArray(raw)) return [base]
    const r = raw as Record<string, unknown>
    const probability = productProbability(r)
    const extra = numOr(r['extra_count_fraction'], 0)
    const ignored = numOr(r['ignored_by_productivity'], numOr(r['ignored_by_stats'], 0))
    return [
      {
        ...base,
        ...(probability === 1 ? {} : { probability }),
        ...(extra ? { extraCountFraction: extra } : {}),
        ...(ignored ? { ignoredByProductivity: ignored } : {})
      }
    ]
  })
}

function surfaceConditions(value: unknown): SurfaceCondition[] | undefined {
  if (!Array.isArray(value)) return undefined
  const out = value.flatMap((raw): SurfaceCondition[] => {
    const r = raw as Record<string, unknown> | null
    if (typeof r?.['property'] !== 'string') return []
    return [
      {
        property: r['property'],
        ...(typeof r['min'] === 'number' ? { min: r['min'] } : {}),
        ...(typeof r['max'] === 'number' ? { max: r['max'] } : {})
      }
    ]
  })
  return out.length ? out : undefined
}

function recipeCategories(proto: Record<string, unknown>): string[] {
  const list = proto['categories']
  if (Array.isArray(list)) return list.filter((c): c is string => typeof c === 'string')
  return [typeof proto['category'] === 'string' ? proto['category'] : 'crafting']
}

function recipe(proto: Record<string, unknown>): RecipeProto {
  const max = proto['maximum_productivity']
  const conditions = surfaceConditions(proto['surface_conditions'])
  return {
    categories: recipeCategories(proto),
    energy: typeof proto['energy_required'] === 'number' ? proto['energy_required'] : 0.5,
    ingredients: ingredients(proto['ingredients']),
    results: products(proto['results']),
    ...(proto['allow_productivity'] === true ? { allowProductivity: true } : {}),
    ...(typeof max === 'number' && max !== 3 ? { maximumProductivity: max } : {}),
    ...(conditions ? { surfaceConditions: conditions } : {}),
    ...(proto['hidden'] === true || proto['parameter'] === true ? { hidden: true } : {})
  }
}

/** `minable.results`, else `result` × `count` (only loaded without `results`). */
function minedProducts(minable: Record<string, unknown>): RecipeProduct[] {
  if (minable['results'] !== undefined) return products(minable['results'])
  const result = minable['result']
  if (typeof result !== 'string') return []
  return products([{ type: 'item', name: result, amount: numOr(minable['count'], 1) }])
}

function resources(raw: Raw): Record<string, ResourceProto> {
  const out: Record<string, ResourceProto> = {}
  for (const [name, proto] of Object.entries(raw['resource'] ?? {})) {
    const m = proto['minable'] as Record<string, unknown> | undefined
    if (typeof m?.['mining_time'] !== 'number') continue
    const results = minedProducts(m)
    const fluidAmount = numOr(m['fluid_amount'], 0)
    out[name] = {
      category: typeof proto['category'] === 'string' ? proto['category'] : 'basic-solid',
      miningTime: m['mining_time'],
      results,
      ...(typeof m['required_fluid'] === 'string' && fluidAmount > 0
        ? { requiredFluid: m['required_fluid'], fluidAmount }
        : {}),
      ...(proto['infinite'] === true ? { infinite: true } : {})
    }
  }
  return out
}

const numberRecord = (value: unknown): Record<string, number> =>
  Object.fromEntries(
    Object.entries((value ?? {}) as Record<string, unknown>).filter(
      (e): e is [string, number] => typeof e[1] === 'number'
    )
  )

function surfaces(raw: Raw): PrototypeDb['surfaces'] {
  const defaults: Record<string, number> = {}
  for (const [name, proto] of Object.entries(raw['surface-property'] ?? {}))
    if (typeof proto['default_value'] === 'number') defaults[name] = proto['default_value']
  return {
    defaults,
    platform: numberRecord(raw['surface']?.['space-platform']?.['surface_properties'])
  }
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
  meta: { gameVersion: string; mods: { name: string; version: string }[]; locale?: Locale }
): PrototypeDb {
  const entities: Record<string, EntityProto> = {}
  const context: StatsContext = { fluid: (name) => fluidHeat(raw['fluid']?.[name]) }
  for (const [type, prototypes] of Object.entries(raw)) {
    if (NOT_BLUEPRINTABLE_TYPES.has(type)) continue
    for (const proto of Object.values(prototypes)) {
      if (!proto['collision_box'] && proto['tile_width'] === undefined) continue
      const name = String(proto['name'])
      const size = tileSizeOf(proto as Parameters<typeof tileSizeOf>[0])
      const collisionBox = box(proto['collision_box'])
      const selectionBox = box(proto['selection_box'])
      const graphics = entityGraphics(type, proto)
      const graphicsFlipped = entityGraphicsFlipped(type, proto)
      const shapes = entityShapes(type, proto)
      const connections = entityConnections(proto)
      const wirePoints = entityWirePoints(type, proto)
      const tint = TINTED_TYPES.has(type) ? color(proto['color']) : undefined
      const stats = entityStats(type, proto, context)
      entities[name] = {
        type,
        ...size,
        ...(collisionBox ? { collisionBox } : {}),
        ...(selectionBox ? { selectionBox } : {}),
        ...(graphics ? { graphics } : {}),
        ...(graphicsFlipped ? { graphicsFlipped } : {}),
        ...(shapes ? { shapes } : {}),
        ...(connections ? { connections } : {}),
        ...(tint ? { color: tint } : {}),
        ...(wirePoints ? { wirePoints } : {}),
        ...(stats ? { stats } : {})
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
        ...(typeof proto['order'] === 'string' ? { order: proto['order'] } : {}),
        ...itemStats(type, proto)
      }
    }
  }

  const recipes: Record<string, RecipeProto> = {}
  for (const proto of Object.values(raw['recipe'] ?? {})) {
    recipes[String(proto['name'])] = recipe(proto)
  }

  const qualities: Record<string, QualityProto> = {}
  for (const proto of Object.values(raw['quality'] ?? {})) {
    const color = colorToCss(proto['color'])
    const multipliers = qualityMultipliers(proto)
    qualities[String(proto['name'])] = {
      level: typeof proto['level'] === 'number' ? proto['level'] : 0,
      ...(color ? { color } : {}),
      ...(typeof proto['next'] === 'string' ? { next: proto['next'] } : {}),
      ...(Object.keys(multipliers).length ? { multipliers } : {})
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
    tileGraphics: Object.fromEntries(
      Object.entries(raw['tile'] ?? {}).flatMap(([name, proto]) => {
        const g = tileGraphics(proto)
        return g ? [[name, g]] : []
      })
    ),
    tileItems: tileItems(raw, items),
    planets: planets(raw),
    resources: resources(raw),
    surfaces: surfaces(raw),
    names: meta.locale ? displayNames(raw, entities, items, meta.locale) : {},
    icons: {}
  }
}

function planets(raw: Raw): Record<string, PlanetProto> {
  const property = raw['surface-property']?.['solar-power']?.['default_value']
  const fallback = typeof property === 'number' ? property : 100
  const out: Record<string, PlanetProto> = {}
  for (const [name, proto] of Object.entries(raw['planet'] ?? {})) {
    const surface = proto['surface_properties'] as Record<string, unknown> | undefined
    const solar = surface?.['solar-power']
    const space = proto['solar_power_in_space']
    const properties = numberRecord(surface)
    out[name] = {
      solarPower: typeof solar === 'number' ? solar : fallback,
      ...(typeof space === 'number' ? { solarPowerInSpace: space } : {}),
      ...(Object.keys(properties).length ? { properties } : {})
    }
  }
  return out
}

function tileItems(raw: Raw, items: Record<string, ItemProto>): Record<string, ItemCount[]> {
  const out: Record<string, ItemCount[]> = {}
  for (const [name, proto] of Object.entries(raw['tile'] ?? {})) {
    const by = itemCounts(proto['placeable_by'])
    if (by) out[name] = by
  }
  for (const [item, proto] of Object.entries(items)) {
    if (proto.placeAsTile && !out[proto.placeAsTile]) out[proto.placeAsTile] = [{ item, count: 1 }]
  }
  return out
}

/**
 * Display names, as the game picks them: the prototype's `localised_name`,
 * then `<category>-name.<name>`. Items without one take the name of the
 * entity or tile they place; recipes the name of their only (or main) product.
 */
function displayNames(
  raw: Raw,
  entities: Record<string, EntityProto>,
  items: Record<string, ItemProto>,
  locale: Locale
): PrototypeDb['names'] {
  const own = (
    category: string,
    proto: Record<string, unknown> | undefined,
    name: string
  ): string | undefined =>
    (proto ? localise(proto['localised_name'], locale) : undefined) ??
    locale[`${category}-name.${name}`]
  const protoOf = (types: string[], name: string): Record<string, unknown> | undefined => {
    for (const t of types) if (raw[t]?.[name]) return raw[t][name]
    return undefined
  }
  const fill = (
    names: Iterable<string>,
    pick: (name: string) => string | undefined
  ): Record<string, string> => {
    const out: Record<string, string> = {}
    for (const name of names) {
      const value = pick(name)
      if (value) out[name] = value
    }
    return out
  }

  const entity = fill(Object.keys(entities), (n) => own('entity', raw[entities[n]!.type]?.[n], n))
  const tile = fill(Object.keys(raw['tile'] ?? {}), (n) => own('tile', raw['tile']?.[n], n))
  const item = fill(Object.keys(items), (n) => {
    const proto = items[n]!
    const equipment = raw[proto.type]?.[n]?.['place_as_equipment_result']
    return (
      own('item', raw[proto.type]?.[n], n) ??
      (proto.placeResult
        ? (entity[proto.placeResult] ?? locale[`entity-name.${proto.placeResult}`])
        : undefined) ??
      (proto.placeAsTile ? tile[proto.placeAsTile] : undefined) ??
      (typeof equipment === 'string' ? locale[`equipment-name.${equipment}`] : undefined)
    )
  })
  const fluid = fill(Object.keys(raw['fluid'] ?? {}), (n) => own('fluid', raw['fluid']?.[n], n))
  const recipe = fill(Object.keys(raw['recipe'] ?? {}), (n) => {
    const proto = raw['recipe']![n]!
    const named = own('recipe', proto, n)
    if (named) return named
    const main = mainProduct(proto)
    if (!main) return undefined
    return main.type === 'fluid' ? fluid[main.name] : item[main.name]
  })
  return {
    entity,
    item,
    recipe,
    fluid,
    tile,
    'virtual-signal': fill(Object.keys(raw['virtual-signal'] ?? {}), (n) =>
      own('virtual-signal', raw['virtual-signal']?.[n], n)
    ),
    quality: fill(Object.keys(raw['quality'] ?? {}), (n) => own('quality', raw['quality']?.[n], n)),
    'space-location': fill(
      [...Object.keys(raw['planet'] ?? {}), ...Object.keys(raw['space-location'] ?? {})],
      (n) => own('space-location', protoOf(['planet', 'space-location'], n), n)
    )
  }
}

/** A recipe's `main_product`, else its only result. */
function mainProduct(proto: Record<string, unknown>): RecipeIngredient | undefined {
  const results = ingredients(proto['results'])
  if (typeof proto['main_product'] === 'string')
    return results.find((r) => r.name === proto['main_product'])
  return results.length === 1 ? results[0] : undefined
}

/** The display name of a prototype, or its internal name without game data or locale. */
export function displayName(
  db: PrototypeDb | null | undefined,
  category: NameCategory,
  name: string
): string {
  return db?.names?.[category]?.[name] ?? name
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
