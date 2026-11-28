import { directionVector, isCardinal, SpatialIndex, type Box, type Direction } from '../geometry'
import type { BlueprintLayout, EntityLayout } from '../model/layout'
import type { BlueprintEntity } from '../model/schema'
import {
  fallbackPrototypeLookup,
  poleWireReachBonus,
  ROLLING_STOCK_TYPES,
  type BoxTuple,
  type EntityProto,
  type PrototypeDb,
  type RecipeProto
} from '../prototypes'
import { MODULE_EFFECTS, type ModuleEffect } from '../prototypes/stats'
import { feedsForward, tileIndex } from '../sprites/shapes'
import { installedModules, isBeneficial, type InstalledModule } from './effects'
import type { PowerReport } from './power'
import type { ProductionReport, SurfaceWarning } from './production'

/**
 * Validation warnings (docs/spec/06-analysis.md § 6). Structural checks
 * (overlap, unpaired undergrounds) also run without game data; the others need
 * the PrototypeDb. Unpowered entities and surface conditions come from the
 * power and production reports, so they are computed once.
 */

export type Severity = 'error' | 'warning' | 'info'

export type WarningCode =
  | 'unknown-prototype'
  | 'overlap'
  | 'invalid-recipe'
  | 'invalid-module'
  | 'unpowered'
  | 'wire-out-of-reach'
  | 'underground-unpaired'
  | 'underground-too-far'
  | 'dangling-belt'
  | 'quality-unavailable'

/** Icon categories a warning names. */
export type WarningKind = 'entity' | 'item' | 'recipe' | 'tile' | 'fluid' | 'virtual-signal'

export interface PrototypeRef {
  kind: WarningKind
  name: string
}

export interface ValidationWarning extends PrototypeRef {
  code: WarningCode
  severity: Severity
  quality?: string
  /** A second prototype: the other entity (overlap, wires), the machine or the recipe (modules). */
  related?: PrototypeRef
  /**
   * What exactly is wrong, per code: the module effect or `category` / `slots`
   * (`invalid-module`), `category` or the surface property (`invalid-recipe`),
   * `signal` for names used in settings rather than placed (`unknown-prototype`).
   */
  detail?: string
  /** The largest measured value in the group (wire length, underground distance, module count, surface value). */
  value?: number
  /** The limit it breaks (reach, max distance, module slots, surface min or max). */
  limit?: number
  /** Occurrences: entities, wires, pairs or tiles. */
  count: number
  /** Entities involved (layout indexes), for selecting them. */
  indexes: number[]
}

export interface ValidationReport {
  /** Sorted by severity, code, then name. */
  warnings: ValidationWarning[]
  /** Occurrences per severity. */
  counts: Record<Severity, number>
}

/** Short fix hint per code. */
export const WARNING_HINTS: Readonly<Record<WarningCode, string>> = {
  'unknown-prototype':
    'Not in the loaded game data: removed from the game, or from a mod that is not loaded. The game drops it on import.',
  overlap: 'Move or remove one of the entities; the game will not build both.',
  'invalid-recipe':
    'Pick a recipe this machine can craft, or build it on a surface that allows it.',
  'invalid-module': 'Remove the module or swap it for one the machine and recipe allow.',
  unpowered: 'Place an electric pole whose supply area reaches it.',
  'wire-out-of-reach': 'Move the ends closer or add a pole in between.',
  'underground-unpaired':
    'Add the matching other end within reach, in line and facing the same way.',
  'underground-too-far': 'Move the ends closer, or use a longer-reaching tier.',
  'dangling-belt': 'The belt ends without feeding anything; fine at the edge of a tileable design.',
  'quality-unavailable': 'Not a quality level the loaded mods define.'
}

const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 }

const CODE_ORDER: readonly WarningCode[] = [
  'unknown-prototype',
  'quality-unavailable',
  'overlap',
  'invalid-recipe',
  'invalid-module',
  'wire-out-of-reach',
  'underground-too-far',
  'underground-unpaired',
  'unpowered',
  'dangling-belt'
]

/** Groups occurrences of the same problem into one row. */
class Warnings {
  private readonly rows = new Map<string, ValidationWarning>()
  /** Entity indexes already in each row. */
  private readonly seen = new Map<string, Set<number>>()

  /** `count` defaults to the number of entities not yet in the row. */
  add(
    w: Omit<ValidationWarning, 'count' | 'indexes'>,
    indexes: readonly number[],
    count?: number
  ): void {
    const key = [
      w.code,
      w.severity,
      w.kind,
      w.name,
      w.quality ?? '',
      w.related?.kind ?? '',
      w.related?.name ?? '',
      w.detail ?? '',
      w.limit ?? ''
    ].join('|')
    let row = this.rows.get(key)
    if (!row) {
      row = { ...w, count: 0, indexes: [] }
      this.rows.set(key, row)
      this.seen.set(key, new Set())
    }
    const seen = this.seen.get(key)!
    if (w.value !== undefined) row.value = Math.max(row.value ?? w.value, w.value)
    let added = 0
    for (const i of indexes) {
      if (seen.has(i)) continue
      seen.add(i)
      row.indexes.push(i)
      added++
    }
    row.count += count ?? added
  }

  report(): ValidationReport {
    const counts: Record<Severity, number> = { error: 0, warning: 0, info: 0 }
    const warnings = [...this.rows.values()]
    for (const w of warnings) counts[w.severity] += w.count
    warnings.sort(
      (a, b) =>
        SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
        CODE_ORDER.indexOf(a.code) - CODE_ORDER.indexOf(b.code) ||
        a.name.localeCompare(b.name) ||
        (a.related?.name ?? '').localeCompare(b.related?.name ?? '')
    )
    return { warnings, counts }
  }
}

export interface ValidationInput {
  /** From the power report: entities outside pole coverage. */
  power?: PowerReport | null
  /** From the production report: recipes whose surface conditions fail. */
  production?: ProductionReport | null
}

export function validation(
  db: PrototypeDb | null,
  layout: BlueprintLayout,
  input: ValidationInput = {}
): ValidationReport {
  const out = new Warnings()
  const typeOf = (name: string): string | undefined =>
    db ? db.entities[name]?.type : fallbackPrototypeLookup(name)?.type
  checkOverlaps(out, db, layout, typeOf)
  checkUndergrounds(out, db, layout, typeOf)
  if (db) {
    checkUnknown(out, db, layout)
    checkRecipes(out, db, layout)
    checkModules(out, db, layout)
    checkWires(out, db, layout)
    checkDanglingBelts(out, db, layout)
  }
  for (const r of input.power?.unpowered ?? [])
    out.add(
      {
        code: 'unpowered',
        severity: 'warning',
        kind: 'entity',
        name: r.name,
        ...(r.quality ? { quality: r.quality } : {})
      },
      r.indexes,
      r.count
    )
  for (const s of input.production?.surfaceWarnings ?? [])
    out.add(
      {
        code: 'invalid-recipe',
        severity: 'warning',
        kind: 'recipe',
        name: s.recipe,
        detail: s.property,
        value: s.value,
        ...surfaceLimit(s)
      },
      s.indexes,
      s.indexes.length
    )
  return out.report()
}

/** The bound a surface value breaks: the minimum when below it, else the maximum. */
function surfaceLimit(s: SurfaceWarning): { limit?: number } {
  const limit = s.min !== undefined && s.value < s.min ? s.min : (s.max ?? s.min)
  return limit === undefined ? {} : { limit }
}

// ---------------------------------------------------------------- unknown prototypes and qualities

/** Entity fields that hold signals or item filters (2.x shapes; 1.1 strings are migrated). */
const SIGNAL_FIELDS = ['control_behavior', 'filters', 'filter', 'request_filters'] as const

/** A prototype an entity names, with the quality it asks for. */
interface Reference {
  ref: PrototypeRef
  quality?: unknown
  /** `signal` for names inside settings. */
  detail?: string
}

/** Every prototype an entity names: itself, its recipe, insert plan items and signals in its settings. */
function references(entity: BlueprintEntity): Reference[] {
  const out: Reference[] = [{ ref: { kind: 'entity', name: entity.name }, quality: entity.quality }]
  if (typeof entity.recipe === 'string')
    out.push({ ref: { kind: 'recipe', name: entity.recipe }, quality: entity.recipe_quality })
  if (Array.isArray(entity.items))
    for (const plan of entity.items)
      out.push({ ref: { kind: 'item', name: plan.id.name }, quality: plan.id.quality })
  for (const field of SIGNAL_FIELDS) {
    for (const s of signalsIn(entity[field])) {
      const ref = signalRef(s)
      if (ref) out.push({ ref, quality: s.quality, detail: 'signal' })
    }
  }
  return out
}

function checkReference(out: Warnings, db: PrototypeDb, r: Reference, index: number): void {
  const { ref, quality, detail } = r
  if (!knownPrototype(db, ref))
    out.add(
      { code: 'unknown-prototype', severity: 'error', ...ref, ...(detail ? { detail } : {}) },
      [index]
    )
  if (typeof quality === 'string' && !db.qualities[quality])
    out.add({ code: 'quality-unavailable', severity: 'warning', ...ref, quality }, [index])
}

function checkUnknown(out: Warnings, db: PrototypeDb, layout: BlueprintLayout): void {
  for (const { entity, index } of layout.entities)
    for (const r of references(entity)) checkReference(out, db, r, index)
  const tiles = new Map<string, number>()
  for (const t of layout.tiles)
    if (!db.tiles.includes(t.name)) tiles.set(t.name, (tiles.get(t.name) ?? 0) + 1)
  for (const [name, count] of tiles)
    out.add({ code: 'unknown-prototype', severity: 'error', kind: 'tile', name }, [], count)
}

interface SignalLike {
  name: string
  type?: unknown
  quality?: unknown
}

/** Objects with a string `name` anywhere inside a settings value. */
function signalsIn(value: unknown, out: SignalLike[] = [], depth = 0): SignalLike[] {
  if (!value || typeof value !== 'object' || depth > 8) return out
  if (Array.isArray(value)) {
    for (const v of value) signalsIn(v, out, depth + 1)
    return out
  }
  const o = value as Record<string, unknown>
  if (typeof o['name'] === 'string') out.push(o as unknown as SignalLike)
  for (const v of Object.values(o)) signalsIn(v, out, depth + 1)
  return out
}

/** The prototype a signal names; undefined for types not checked (space locations, asteroid chunks, quality). */
function signalRef(s: SignalLike): PrototypeRef | undefined {
  switch (s.type ?? 'item') {
    case 'item':
      return { kind: 'item', name: s.name }
    case 'fluid':
      return { kind: 'fluid', name: s.name }
    case 'virtual':
      return { kind: 'virtual-signal', name: s.name }
    case 'entity':
      return { kind: 'entity', name: s.name }
    case 'recipe':
      return { kind: 'recipe', name: s.name }
    default:
      return undefined
  }
}

function knownPrototype(db: PrototypeDb, ref: PrototypeRef): boolean {
  switch (ref.kind) {
    case 'item':
      return ref.name in db.items
    case 'fluid':
      return db.fluids.includes(ref.name)
    case 'virtual-signal':
      return db.virtualSignals.includes(ref.name)
    case 'entity':
      return ref.name in db.entities
    case 'recipe':
      return ref.name in db.recipes
    default:
      return true
  }
}

// ---------------------------------------------------------------- overlap

interface Collider {
  e: EntityLayout
  box: Box
  /** Null without game data: collides with everything. */
  layers: readonly string[] | null
  notSelf: boolean
}

/**
 * Entities left out of the overlap check: rail pieces and signals (the game
 * lets rails cross and overlap, and their real collision shapes are not boxes),
 * rolling stock (placed on rails by orientation) and anything not facing a
 * cardinal direction (its box is rotated).
 */
function skipsOverlap(e: EntityLayout, type: string | undefined): boolean {
  if (type === undefined) return true
  if (e.category === 'rail' && type !== 'train-stop') return true
  return ROLLING_STOCK_TYPES.has(type) || !isCardinal(e.direction)
}

/** A collision box placed at the entity, rotated to its cardinal direction, shrunk against float noise. */
export function collisionBoxAt(
  box: BoxTuple,
  position: { x: number; y: number },
  direction: Direction
): Box {
  let [[l, t], [r, b]] = box
  for (let turn = 0; turn < direction / 4; turn++) [l, t, r, b] = [-b, l, -t, r]
  const eps = 1e-4
  return {
    left: position.x + l + eps,
    top: position.y + t + eps,
    right: position.x + r - eps,
    bottom: position.y + b - eps
  }
}

function collider(db: PrototypeDb | null, e: EntityLayout): Collider {
  const proto: EntityProto | undefined = db?.entities[e.entity.name]
  const shrink = 0.1
  const box = proto?.collisionBox
    ? collisionBoxAt(proto.collisionBox, e.entity.position, e.direction)
    : {
        left: e.box.left + shrink,
        top: e.box.top + shrink,
        right: e.box.right - shrink,
        bottom: e.box.bottom - shrink
      }
  return {
    e,
    box,
    layers: proto ? (proto.collisionLayers ?? ['object']) : null,
    notSelf: proto?.notCollidingWithItself === true
  }
}

function collides(a: Collider, b: Collider): boolean {
  if (a.notSelf && a.e.entity.name === b.e.entity.name) return false
  if (a.layers === null || b.layers === null) return true
  return a.layers.some((l) => b.layers!.includes(l))
}

function checkOverlaps(
  out: Warnings,
  db: PrototypeDb | null,
  layout: BlueprintLayout,
  typeOf: (name: string) => string | undefined
): void {
  // Small cells: a dense base puts ~1,000 entities in one 32-tile cell.
  const index = new SpatialIndex<Collider>(4)
  const colliders: Collider[] = []
  for (const e of layout.entities) {
    if (skipsOverlap(e, typeOf(e.entity.name))) continue
    const c = collider(db, e)
    colliders.push(c)
    index.insert(c.box, c)
  }
  for (const a of colliders) {
    for (const b of index.query(a.box)) {
      if (b.e.index <= a.e.index || !collides(a, b)) continue
      const [first, second] = a.e.entity.name.localeCompare(b.e.entity.name) <= 0 ? [a, b] : [b, a]
      out.add(
        {
          code: 'overlap',
          severity: 'error',
          kind: 'entity',
          name: first.e.entity.name,
          related: { kind: 'entity', name: second.e.entity.name }
        },
        [first.e.index, second.e.index],
        1
      )
    }
  }
}

// ---------------------------------------------------------------- recipes and modules

const CRAFTING_TYPES: ReadonlySet<string> = new Set([
  'assembling-machine',
  'furnace',
  'rocket-silo'
])

/** The recipe a crafting machine runs: its fixed recipe, else the blueprint's. */
function machineRecipe(proto: EntityProto, e: EntityLayout): string | undefined {
  if (!CRAFTING_TYPES.has(proto.type)) return undefined
  return proto.stats?.fixedRecipe ?? e.entity.recipe
}

function checkRecipes(out: Warnings, db: PrototypeDb, layout: BlueprintLayout): void {
  for (const e of layout.entities) {
    const proto = db.entities[e.entity.name]
    const name = proto ? machineRecipe(proto, e) : undefined
    const recipe = name ? db.recipes[name] : undefined
    const categories = proto?.stats?.craftingCategories
    if (!name || !recipe || !categories || recipe.categories.includes('parameters')) continue
    if (recipe.categories.some((c) => categories.includes(c))) continue
    out.add(
      {
        code: 'invalid-recipe',
        severity: 'error',
        kind: 'recipe',
        name,
        related: { kind: 'entity', name: e.entity.name },
        detail: 'category'
      },
      [e.index]
    )
  }
}

/** Effects a module applies that count for allowed-effect checks: only its beneficial ones (penalties never block it). */
function moduleBenefits(db: PrototypeDb, item: string): ModuleEffect[] {
  const effect = db.items[item]?.module?.effect ?? {}
  return MODULE_EFFECTS.filter((k) => {
    const v = effect[k]
    return v !== undefined && isBeneficial(k, v)
  })
}

function recipeForbids(recipe: RecipeProto, effect: ModuleEffect): boolean {
  if (effect === 'productivity') return recipe.allowProductivity !== true
  return recipe.disallowedEffects?.includes(effect) === true
}

function checkModules(out: Warnings, db: PrototypeDb, layout: BlueprintLayout): void {
  for (const e of layout.entities) {
    const proto = db.entities[e.entity.name]
    if (!proto) continue
    const modules = installedModules(db, e.entity, proto.type)
    if (modules.length === 0) continue
    const total = modules.reduce((n, m) => n + m.count, 0)
    const slots = proto.stats?.moduleSlots ?? 0
    if (total > slots)
      out.add(
        {
          code: 'invalid-module',
          severity: 'error',
          kind: 'entity',
          name: e.entity.name,
          detail: 'slots',
          value: total,
          limit: slots
        },
        [e.index]
      )
    const recipeName = machineRecipe(proto, e)
    const recipe = recipeName ? db.recipes[recipeName] : undefined
    const context = {
      proto,
      e,
      recipe: recipe && recipeName ? { name: recipeName, recipe } : undefined
    }
    for (const m of modules) checkModule(out, db, m, context)
  }
}

/** One installed module against the machine's and the recipe's limits. */
function checkModule(
  out: Warnings,
  db: PrototypeDb,
  m: InstalledModule,
  {
    proto,
    e,
    recipe
  }: {
    proto: EntityProto
    e: EntityLayout
    recipe: { name: string; recipe: RecipeProto } | undefined
  }
): void {
  const module = db.items[m.item]?.module
  if (!module) return
  const stats = proto.stats ?? {}
  const machine: PrototypeRef = { kind: 'entity', name: e.entity.name }
  const recipeRef: PrototypeRef | undefined = recipe && { kind: 'recipe', name: recipe.name }
  const add = (related: PrototypeRef, detail: string): void =>
    out.add(
      {
        code: 'invalid-module',
        severity: 'error',
        kind: 'item',
        name: m.item,
        ...(m.quality ? { quality: m.quality } : {}),
        related,
        detail
      },
      [e.index],
      m.count
    )
  if (stats.allowedModuleCategories && !stats.allowedModuleCategories.includes(module.category))
    add(machine, 'category')
  const recipeCategories = recipe?.recipe.allowedModuleCategories
  if (recipeRef && recipeCategories && !recipeCategories.includes(module.category))
    add(recipeRef, 'category')
  for (const effect of moduleBenefits(db, m.item)) {
    if (stats.allowedEffects && !stats.allowedEffects.includes(effect)) add(machine, effect)
    else if (recipeRef && recipe && recipeForbids(recipe.recipe, effect)) add(recipeRef, effect)
  }
}

// ---------------------------------------------------------------- wires

/**
 * Wire reach of an entity: an electric pole's `maximum_wire_distance` plus its
 * quality bonus (copper and circuit wires alike), else `circuit_wire_max_distance`.
 */
export function wireReach(db: PrototypeDb, e: EntityLayout): number | undefined {
  const stats = db.entities[e.entity.name]?.stats
  if (stats?.maxWireDistance !== undefined)
    return stats.maxWireDistance + poleWireReachBonus(db.qualities[e.entity.quality ?? 'normal'])
  return stats?.circuitWireMaxDistance
}

const isPole = (db: PrototypeDb, e: EntityLayout): boolean =>
  db.entities[e.entity.name]?.stats?.maxWireDistance !== undefined

/** Shortest distance between two boxes (0 when they touch or overlap). */
function boxGap(a: Box, b: Box): number {
  const dx = Math.max(0, a.left - b.right, b.left - a.right)
  const dy = Math.max(0, a.top - b.bottom, b.top - a.bottom)
  return Math.hypot(dx, dy)
}

function selectionBoxOf(db: PrototypeDb, e: EntityLayout): Box {
  const proto = db.entities[e.entity.name]
  const box = proto?.selectionBox ?? proto?.collisionBox
  return box ? collisionBoxAt(box, e.entity.position, e.direction) : e.box
}

/**
 * Length of a wire as the reach check measures it: between the centres of two
 * poles, else the gap between the two selection boxes. Corpus-fitted, not
 * confirmed in game (docs/spec/06-analysis.md § 6).
 */
export function wireLength(db: PrototypeDb, a: EntityLayout, b: EntityLayout): number {
  if (isPole(db, a) && isPole(db, b))
    return Math.hypot(
      a.entity.position.x - b.entity.position.x,
      a.entity.position.y - b.entity.position.y
    )
  return boxGap(selectionBoxOf(db, a), selectionBoxOf(db, b))
}

function checkWires(out: Warnings, db: PrototypeDb, layout: BlueprintLayout): void {
  const byNumber = new Map<number, EntityLayout>()
  for (const e of layout.entities) byNumber.set(e.entity.entity_number, e)
  for (const w of layout.wires) {
    const a = byNumber.get(w.a.entity)
    const b = byNumber.get(w.b.entity)
    if (!a || !b || a === b) continue
    const ra = wireReach(db, a)
    const rb = wireReach(db, b)
    if (ra === undefined || rb === undefined) continue
    const reach = Math.min(ra, rb)
    const length = wireLength(db, a, b)
    if (length <= reach + 1e-6) continue
    const [first, second] = a.entity.name.localeCompare(b.entity.name) <= 0 ? [a, b] : [b, a]
    out.add(
      {
        code: 'wire-out-of-reach',
        severity: 'error',
        kind: 'entity',
        name: first.entity.name,
        related: { kind: 'entity', name: second.entity.name },
        value: length,
        limit: reach
      },
      [first.index, second.index],
      1
    )
  }
}

// ---------------------------------------------------------------- undergrounds and belts

interface UndergroundEnd {
  e: EntityLayout
  /** The end the run starts from (belt input; pipe-to-ground facing against the line). */
  opener: boolean
  /** Position along the line. */
  t: number
}

/**
 * Line and role of an underground belt or pipe-to-ground. An underground
 * belt's direction is the flow direction for both ends; a pipe-to-ground's
 * direction is its above-ground side, so a pair faces away from each other.
 */
function undergroundEnd(
  e: EntityLayout,
  type: string
): { key: string; end: UndergroundEnd } | undefined {
  if (!isCardinal(e.direction)) return undefined
  const d = e.direction
  const pipe = type === 'pipe-to-ground'
  // Pipes: one canonical flow per axis (south or east).
  const axisFlow = d === 0 || d === 8 ? 8 : 4
  const flow = pipe ? axisFlow : d
  const v = directionVector(flow as Direction)
  const { x, y } = e.entity.position
  const across = v.x === 0 ? x : y
  return {
    key: `${e.entity.name}|${flow}|${across.toFixed(2)}`,
    end: {
      e,
      opener: pipe ? d !== flow : e.entity['type'] !== 'output',
      t: x * v.x + y * v.y
    }
  }
}

function checkUndergrounds(
  out: Warnings,
  db: PrototypeDb | null,
  layout: BlueprintLayout,
  typeOf: (name: string) => string | undefined
): void {
  const lines = new Map<string, { pipe: boolean; ends: UndergroundEnd[] }>()
  for (const e of layout.entities) {
    const type = typeOf(e.entity.name)
    if (type !== 'underground-belt' && type !== 'pipe-to-ground') continue
    const placed = undergroundEnd(e, type)
    if (!placed) continue
    const line = lines.get(placed.key)
    if (line) line.ends.push(placed.end)
    else lines.set(placed.key, { pipe: type === 'pipe-to-ground', ends: [placed.end] })
  }
  const longest = db ? longestReach(db) : undefined
  for (const { pipe, ends } of lines.values()) {
    const type = pipe ? 'pipe-to-ground' : 'underground-belt'
    pairLine(out, db, ends, { pipe, longest: longest?.get(type) })
  }
}

/** Longest `max_distance` per underground type, over every prototype in the DB. */
function longestReach(db: PrototypeDb): Map<string, number> {
  const out = new Map<string, number>()
  for (const proto of Object.values(db.entities)) {
    const d = proto.stats?.maxDistance
    if (d !== undefined) out.set(proto.type, Math.max(out.get(proto.type) ?? 0, d))
  }
  return out
}

/**
 * Pairs the ends of one line in order, nesting like brackets (an end placed
 * inside a pair takes the connection, as in game); reports the rest. A pair
 * beyond its reach is `too-far` when a longer tier of the type could bridge
 * it, else both ends count as unpaired.
 */
function pairLine(
  out: Warnings,
  db: PrototypeDb | null,
  ends: UndergroundEnd[],
  { pipe, longest }: { pipe: boolean; longest: number | undefined }
): void {
  ends.sort((a, b) => a.t - b.t)
  const name = ends[0]!.e.entity.name
  const max = db?.entities[name]?.stats?.maxDistance
  const open: UndergroundEnd[] = []
  const unpaired = (end: UndergroundEnd): void =>
    out.add(
      { code: 'underground-unpaired', severity: pipe ? 'info' : 'warning', kind: 'entity', name },
      [end.e.index]
    )
  for (const end of ends) {
    if (end.opener) {
      open.push(end)
      continue
    }
    const start = open.pop()
    if (!start) {
      unpaired(end)
      continue
    }
    const distance = end.t - start.t
    if (max === undefined || distance <= max + 1e-6) continue
    if (longest !== undefined && distance > longest + 1e-6) {
      unpaired(start)
      unpaired(end)
    } else
      out.add(
        {
          code: 'underground-too-far',
          severity: 'error',
          kind: 'entity',
          name,
          value: distance,
          limit: max
        },
        [start.e.index, end.e.index],
        1
      )
  }
  for (const end of open) unpaired(end)
}

function checkDanglingBelts(out: Warnings, db: PrototypeDb, layout: BlueprintLayout): void {
  const at = tileIndex(db, layout.entities)
  for (const e of layout.entities) {
    const type = db.entities[e.entity.name]?.type
    const outputs =
      type === 'transport-belt' || (type === 'underground-belt' && e.entity['type'] === 'output')
    if (!outputs || feedsForward(e, at)) continue
    out.add({ code: 'dangling-belt', severity: 'info', kind: 'entity', name: e.entity.name }, [
      e.index
    ])
  }
}

// ---------------------------------------------------------------- text

/** Names a prototype for the user (display name, or the internal name without game data). */
export type NameOf = (ref: PrototypeRef) => string

const KIND_WORDS: Readonly<Record<WarningKind, string>> = {
  entity: 'entity',
  item: 'item',
  recipe: 'recipe',
  tile: 'tile',
  fluid: 'fluid',
  'virtual-signal': 'signal'
}

const round = (n: number): string => String(Math.round(n * 10) / 10)

/** One line describing a warning, plus the measured value against its limit where there is one. */
export function warningText(
  w: ValidationWarning,
  nameOf: NameOf
): { text: string; value?: string } {
  const name = nameOf(w)
  const related = w.related ? nameOf(w.related) : ''
  const measured =
    w.value !== undefined && w.limit !== undefined
      ? { value: `${round(w.value)} / ${round(w.limit)}` }
      : {}
  switch (w.code) {
    case 'unknown-prototype':
      return {
        text: `Unknown ${KIND_WORDS[w.kind]} ${name}${w.detail === 'signal' ? ' (in settings)' : ''}`
      }
    case 'quality-unavailable':
      return { text: `${name}: unknown quality ${w.quality ?? ''}` }
    case 'overlap':
      return { text: `${name} overlaps ${related}` }
    case 'invalid-recipe':
      return w.detail === 'category'
        ? { text: `${name} can't be made in ${related}` }
        : {
            text: `${name} needs ${w.detail ?? 'a surface property'} ${surfaceRange(w)}`,
            ...measured
          }
    case 'invalid-module':
      return moduleText(w, name, related, measured)
    case 'unpowered':
      return { text: `${name} outside pole coverage` }
    case 'wire-out-of-reach':
      return { text: `Wire ${name} – ${related} too long`, ...measured }
    case 'underground-too-far':
      return { text: `${name} ends too far apart`, ...measured }
    case 'underground-unpaired':
      return { text: `${name} without its other end` }
    case 'dangling-belt':
      return { text: `${name} ends without feeding anything` }
  }
}

function surfaceRange(w: ValidationWarning): string {
  if (w.limit === undefined) return ''
  return w.value !== undefined && w.value < w.limit ? `≥ ${round(w.limit)}` : `≤ ${round(w.limit)}`
}

function moduleText(
  w: ValidationWarning,
  name: string,
  related: string,
  measured: { value?: string }
): { text: string; value?: string } {
  if (w.detail === 'slots') return { text: `${name}: more modules than slots`, ...measured }
  if (w.detail === 'category') return { text: `${name} not allowed in ${related}` }
  return { text: `${name}: ${w.detail ?? 'effect'} not allowed by ${related}` }
}
