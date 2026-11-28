import type { BlueprintLayout, EntityLayout } from '../model/layout'
import {
  qualityMultiplier,
  type PrototypeDb,
  type RecipeIngredient,
  type RecipeProduct,
  type RecipeProto,
  type ResourceProto
} from '../prototypes'
import { entityEffects, type Effects } from './effects'

/**
 * Production rates (docs/spec/06-analysis.md § 2 Production): steady-state
 * crafts per second of every crafting machine and mining drill, and the items
 * and fluids they make and use. Rates are per second; the UI scales them to
 * the chosen time unit.
 */

export interface ProductionSettings {
  /** Surface properties of the surface the blueprint is built on (`surfaceProperties`). */
  surface: Readonly<Record<string, number>>
  /**
   * What machines with no recipe in the blueprint are assumed to run, by entity
   * name: a recipe for furnaces, a resource for mining drills.
   */
  assume?: Readonly<Record<string, string>>
}

export interface MachineRow {
  name: string
  quality?: string
  /** Recipe of a crafting machine. */
  recipe?: string
  /** Resource of a mining drill. */
  resource?: string
  /** Quality of the recipe's ingredients and products (`recipe_quality`). */
  recipeQuality?: string
  /** The recipe or resource comes from `ProductionSettings.assume`. */
  assumed?: true
  count: number
  indexes: number[]
  /** Mean effective crafting or mining speed of one machine. */
  speed: number
  /** Mean productivity bonus (0.5 = +50 %). */
  productivity: number
  /** Crafts or mining cycles per second, all machines of the row together. */
  cycles: number
}

/**
 * Why a machine has no rate:
 * - `no-recipe`: an assembling machine with no recipe set.
 * - `needs-recipe`: a furnace (its recipe follows its input); `options` lists candidates.
 * - `needs-resource`: a mining drill; `options` lists the resources it can mine.
 * - `patch`: a drill whose resources all depend on the patch (fluids, infinite).
 * - `parameter`: a parameterised blueprint's placeholder recipe.
 * - `unknown-recipe`: a recipe the game data does not have.
 */
export type IdleReason =
  'no-recipe' | 'needs-recipe' | 'needs-resource' | 'patch' | 'parameter' | 'unknown-recipe'

export interface IdleRow {
  name: string
  quality?: string
  recipe?: string
  reason: IdleReason
  /** Recipes or resources the user can assume for this entity name. */
  options: string[]
  count: number
  indexes: number[]
}

export interface Flow {
  type: 'item' | 'fluid'
  name: string
  quality?: string
  /** Per second. */
  produced: number
  consumed: number
  /** `produced − consumed`; negative means the blueprint needs it as an input. */
  net: number
  producers: number[]
  consumers: number[]
  /** Items that spoil (Space Age). */
  spoils?: true
}

/** A flow both made and used inside the blueprint whose producers and consumers do not match. */
export interface RatioRow {
  type: 'item' | 'fluid'
  name: string
  quality?: string
  /** `produced / consumed`. */
  supply: number
  /** `under`: consumers get less than they use; `over`: producers make more than is used. */
  status: 'under' | 'over'
  /** The consumers (under) or producers (over). */
  indexes: number[]
}

export interface SurfaceWarning {
  recipe: string
  property: string
  /** The surface's value of the property. */
  value: number
  min?: number
  max?: number
  indexes: number[]
}

export interface ProductionReport {
  machines: MachineRow[]
  idle: IdleRow[]
  /** Sorted by type, then name. */
  flows: Flow[]
  ratios: RatioRow[]
  surfaceWarnings: SurfaceWarning[]
}

/**
 * How a flow shows in the report: `output` (made more than used), `input` (used
 * more than made) or `balanced` (made and used at the same rate, within rounding).
 */
export function flowRole(
  f: Pick<Flow, 'produced' | 'consumed' | 'net'>
): 'output' | 'input' | 'balanced' {
  if (Math.abs(f.net) <= 1e-9 + 1e-6 * Math.max(f.produced, f.consumed)) return 'balanced'
  return f.net > 0 ? 'output' : 'input'
}

/** Supply within this fraction of demand counts as balanced. */
const RATIO_TOLERANCE = 0.01

const CRAFTING_TYPES: ReadonlySet<string> = new Set([
  'assembling-machine',
  'furnace',
  'rocket-silo'
])

/** Properties of a surface: the defaults overlaid with the planet's or the platform's own. */
export function surfaceProperties(
  db: PrototypeDb,
  planet: string,
  space: boolean
): Record<string, number> {
  const own = space ? db.surfaces?.platform : db.planets[planet]?.properties
  return { ...db.surfaces?.defaults, ...own }
}

/** Candidate recipes of a furnace: visible recipes in one of its categories. */
export function furnaceRecipes(db: PrototypeDb, entity: string): string[] {
  const categories = db.entities[entity]?.stats?.craftingCategories ?? []
  return Object.entries(db.recipes)
    .filter(([, r]) => !r.hidden && r.categories.some((c) => categories.includes(c)))
    .map(([name]) => name)
    .sort((a, b) => a.localeCompare(b))
}

/** Resources a drill can mine whose rate does not depend on the patch (item results, finite). */
export function drillResources(db: PrototypeDb, entity: string): string[] {
  const categories = db.entities[entity]?.stats?.resourceCategories ?? []
  return Object.entries(db.resources ?? {})
    .filter(
      ([, r]) =>
        categories.includes(r.category) &&
        !r.infinite &&
        r.results.length > 0 &&
        r.results.every((p) => p.type === 'item')
    )
    .map(([name]) => name)
    .sort((a, b) => a.localeCompare(b))
}

/**
 * Expected amount of a product per craft with productivity `p`. Productivity adds
 * `p` bonus crafts of the part not `ignoredByProductivity`; the extra-count chance
 * applies to bonus crafts too (prototype-api.json, ItemProductPrototype).
 */
export function productAmount(product: RecipeProduct, p: number): number {
  const probability = product.probability ?? 1
  const extra = product.extraCountFraction ?? 0
  const boosted = Math.max(0, product.amount - (product.ignoredByProductivity ?? 0)) + extra
  return probability * (product.amount + extra + boosted * p)
}

/** One machine's rate before grouping. */
interface MachineRate {
  key: string
  row: Omit<MachineRow, 'count' | 'indexes' | 'speed' | 'productivity' | 'cycles'>
  speed: number
  productivity: number
  cycles: number
  inputs: RecipeIngredient[]
  outputs: RecipeProduct[]
  /** Per-cycle quality of item ingredients and products. */
  itemQuality?: string
}

type Resolved = { rate: MachineRate } | { idle: Omit<IdleRow, 'count' | 'indexes'> }

const speedFactor = (effects: Effects | undefined): number =>
  Math.max(0.2, 1 + (effects?.speed ?? 0))

const clampProductivity = (effects: Effects | undefined, max: number): number =>
  Math.min(max, Math.max(0, effects?.productivity ?? 0))

const qualityOf = (q: string | undefined): string | undefined =>
  q && q !== 'normal' ? q : undefined

/** Items per second one machine takes in and puts out (fluids left out), for inserter checks. */
export interface ItemRates {
  input: number
  output: number
}

/**
 * `onRate`, when given, receives the item rates of every machine with a rate,
 * by layout index (used by the logistics report).
 */
export function production(
  db: PrototypeDb,
  layout: BlueprintLayout,
  settings: ProductionSettings,
  onRate?: (index: number, rates: ItemRates) => void
): ProductionReport {
  const effects = entityEffects(db, layout)
  const machines = new Map<string, MachineRow>()
  const idle = new Map<string, IdleRow>()
  const flows = new FlowTally(db)
  const surface = new SurfaceCheck(settings.surface)
  const choices = new Choices(db, settings.assume ?? {})

  for (const e of layout.entities) {
    const resolved = resolveMachine(db, e, effects.get(e.index)?.effects, choices)
    if (!resolved) continue
    if ('idle' in resolved) {
      addIdle(idle, resolved.idle, e)
      continue
    }
    const { rate } = resolved
    addMachine(machines, rate, e.index)
    flows.add(rate, e.index)
    onRate?.(e.index, itemRates(rate))
    if (rate.row.recipe) surface.check(db.recipes[rate.row.recipe]!, rate.row.recipe, e.index)
  }

  const flowList = flows.list()
  return {
    machines: [...machines.values()]
      .map((m) => ({ ...m, speed: m.speed / m.count, productivity: m.productivity / m.count }))
      .sort(byNameThen((m) => m.recipe ?? m.resource ?? '')),
    idle: [...idle.values()].sort(byNameThen((r) => r.reason)),
    flows: flowList,
    ratios: ratios(flowList),
    surfaceWarnings: surface.list()
  }
}

const byNameThen =
  <T extends { name: string; quality?: string }>(second: (r: T) => string) =>
  (a: T, b: T): number =>
    a.name.localeCompare(b.name) ||
    second(a).localeCompare(second(b)) ||
    (a.quality ?? '').localeCompare(b.quality ?? '')

/** Assumed recipes and resources, with each entity name's options computed once per run. */
class Choices {
  private readonly cache = new Map<string, string[]>()

  constructor(
    private readonly db: PrototypeDb,
    private readonly assume: Readonly<Record<string, string>>
  ) {}

  options(kind: 'recipe' | 'resource', entity: string): string[] {
    const key = `${kind}:${entity}`
    let list = this.cache.get(key)
    if (!list) {
      list = kind === 'recipe' ? furnaceRecipes(this.db, entity) : drillResources(this.db, entity)
      this.cache.set(key, list)
    }
    return list
  }

  /** The assumed recipe or resource, when the entity can use it. */
  assumed(kind: 'recipe' | 'resource', entity: string): string | undefined {
    const value = this.assume[entity]
    return value && this.options(kind, entity).includes(value) ? value : undefined
  }
}

function resolveMachine(
  db: PrototypeDb,
  e: EntityLayout,
  effects: Effects | undefined,
  choices: Choices
): Resolved | undefined {
  const proto = db.entities[e.entity.name]
  if (!proto) return undefined
  if (CRAFTING_TYPES.has(proto.type)) return resolveCrafting(db, e, proto.type, effects, choices)
  if (proto.type === 'mining-drill') return resolveDrill(db, e, effects, choices)
  return undefined
}

function resolveCrafting(
  db: PrototypeDb,
  e: EntityLayout,
  type: string,
  effects: Effects | undefined,
  choices: Choices
): Resolved {
  const name = e.entity.name
  const stats = db.entities[name]?.stats ?? {}
  const own = stats.fixedRecipe ?? e.entity.recipe
  const choose = type === 'furnace' && !own
  const options = choose ? choices.options('recipe', name) : []
  const assumed = choose ? choices.assumed('recipe', name) : undefined
  const recipeName = own ?? assumed
  if (!recipeName)
    return { idle: { name, reason: type === 'furnace' ? 'needs-recipe' : 'no-recipe', options } }
  const recipe = db.recipes[recipeName]
  if (!recipe) return { idle: { name, recipe: recipeName, reason: 'unknown-recipe', options } }
  if (recipe.categories.includes('parameters'))
    return { idle: { name, recipe: recipeName, reason: 'parameter', options } }

  const quality = db.qualities[e.entity.quality ?? 'normal']
  const speed =
    (stats.craftingSpeed ?? 1) *
    qualityMultiplier(quality, 'crafting_machine_speed') *
    speedFactor(effects)
  const productivity = recipe.allowProductivity
    ? clampProductivity(effects, recipe.maximumProductivity ?? 3)
    : 0
  const itemQuality = assumed ? undefined : qualityOf(e.entity.recipe_quality)
  return rateOf(e, { recipe: recipeName, itemQuality, assumed: !!assumed }, speed, productivity, {
    cycles: speed / recipe.energy,
    inputs: recipe.ingredients,
    outputs: recipe.results
  })
}

function resolveDrill(
  db: PrototypeDb,
  e: EntityLayout,
  effects: Effects | undefined,
  choices: Choices
): Resolved {
  const name = e.entity.name
  const options = choices.options('resource', name)
  const resourceName = choices.assumed('resource', name)
  const resource: ResourceProto | undefined = resourceName ? db.resources[resourceName] : undefined
  if (!resourceName || !resource)
    return { idle: { name, reason: options.length ? 'needs-resource' : 'patch', options } }

  // Quality does not change mining speed: QualityPrototype has no multiplier for it.
  const speed = (db.entities[name]?.stats?.miningSpeed ?? 1) * speedFactor(effects)
  const productivity = clampProductivity(effects, Infinity)
  const inputs: RecipeIngredient[] = resource.requiredFluid
    ? [{ type: 'fluid', name: resource.requiredFluid, amount: (resource.fluidAmount ?? 0) / 10 }]
    : []
  return rateOf(
    e,
    { resource: resourceName, itemQuality: undefined, assumed: true },
    speed,
    productivity,
    {
      cycles: speed / resource.miningTime,
      inputs,
      outputs: resource.results
    }
  )
}

function rateOf(
  e: EntityLayout,
  what: { recipe?: string; resource?: string; itemQuality: string | undefined; assumed: boolean },
  speed: number,
  productivity: number,
  work: { cycles: number; inputs: RecipeIngredient[]; outputs: RecipeProduct[] }
): Resolved {
  const quality = qualityOf(e.entity.quality)
  const row: MachineRate['row'] = {
    name: e.entity.name,
    ...(quality ? { quality } : {}),
    ...(what.recipe ? { recipe: what.recipe } : {}),
    ...(what.resource ? { resource: what.resource } : {}),
    ...(what.itemQuality ? { recipeQuality: what.itemQuality } : {}),
    ...(what.assumed ? { assumed: true as const } : {})
  }
  const key = [row.name, quality, what.recipe ?? what.resource, what.itemQuality].join('|')
  return {
    rate: {
      key,
      row,
      speed,
      productivity,
      ...work,
      ...(what.itemQuality ? { itemQuality: what.itemQuality } : {})
    }
  }
}

function itemRates(rate: MachineRate): ItemRates {
  let input = 0
  let output = 0
  for (const i of rate.inputs) if (i.type === 'item') input += rate.cycles * i.amount
  for (const o of rate.outputs)
    if (o.type === 'item') output += rate.cycles * productAmount(o, rate.productivity)
  return { input, output }
}

function addMachine(machines: Map<string, MachineRow>, rate: MachineRate, index: number): void {
  let row = machines.get(rate.key)
  if (!row) {
    row = { ...rate.row, count: 0, indexes: [], speed: 0, productivity: 0, cycles: 0 }
    machines.set(rate.key, row)
  }
  row.count++
  row.indexes.push(index)
  row.speed += rate.speed
  row.productivity += rate.productivity
  row.cycles += rate.cycles
}

function addIdle(
  idle: Map<string, IdleRow>,
  row: Omit<IdleRow, 'count' | 'indexes'>,
  e: EntityLayout
): void {
  const quality = qualityOf(e.entity.quality)
  const key = [row.name, quality, row.reason, row.recipe].join('|')
  let r = idle.get(key)
  if (!r) {
    r = { ...row, ...(quality ? { quality } : {}), count: 0, indexes: [] }
    idle.set(key, r)
  }
  r.count++
  r.indexes.push(e.index)
}

/**
 * Sums what machines make and use, per item or fluid and quality. An item a
 * machine both uses and makes (a catalyst: the chunk a crusher returns, kovarex
 * U-235) counts only by its net amount per machine, as the game's statistics
 * do with `ignored_by_stats`.
 */
class FlowTally {
  private readonly flows = new Map<string, Flow>()

  constructor(private readonly db: PrototypeDb) {}

  add(rate: MachineRate, index: number): void {
    const net = new Map<string, { what: RecipeIngredient; amount: number }>()
    const add = (what: RecipeIngredient, amount: number): void => {
      const key = `${what.type}:${what.name}`
      const entry = net.get(key) ?? { what, amount: 0 }
      entry.amount += amount
      net.set(key, entry)
    }
    for (const i of rate.inputs) add(i, -rate.cycles * i.amount)
    for (const o of rate.outputs) add(o, rate.cycles * productAmount(o, rate.productivity))
    for (const { what, amount } of net.values()) {
      if (amount === 0) continue
      this.flow(what, rate.itemQuality, (f) => {
        if (amount > 0) {
          f.produced += amount
          pushOnce(f.producers, index)
        } else {
          f.consumed -= amount
          pushOnce(f.consumers, index)
        }
      })
    }
  }

  list(): Flow[] {
    return [...this.flows.values()]
      .map((f) => ({ ...f, net: f.produced - f.consumed }))
      .sort(
        (a, b) =>
          a.type.localeCompare(b.type) ||
          a.name.localeCompare(b.name) ||
          (a.quality ?? '').localeCompare(b.quality ?? '')
      )
  }

  private flow(
    what: RecipeIngredient,
    itemQuality: string | undefined,
    update: (f: Flow) => void
  ): void {
    const quality = what.type === 'item' ? itemQuality : undefined
    const key = `${what.type}:${what.name}:${quality ?? ''}`
    let f = this.flows.get(key)
    if (!f) {
      f = {
        type: what.type,
        name: what.name,
        ...(quality ? { quality } : {}),
        produced: 0,
        consumed: 0,
        net: 0,
        producers: [],
        consumers: [],
        ...(what.type === 'item' && this.db.items[what.name]?.spoilTicks ? { spoils: true } : {})
      }
      this.flows.set(key, f)
    }
    update(f)
  }
}

/** Machines are added one entity at a time, so the last index is the only possible duplicate. */
function pushOnce(list: number[], index: number): void {
  if (list.at(-1) !== index) list.push(index)
}

function ratios(flows: Flow[]): RatioRow[] {
  const out: RatioRow[] = []
  for (const f of flows) {
    if (f.produced <= 0 || f.consumed <= 0) continue
    const supply = f.produced / f.consumed
    if (Math.abs(supply - 1) <= RATIO_TOLERANCE) continue
    const under = supply < 1
    out.push({
      type: f.type,
      name: f.name,
      ...(f.quality ? { quality: f.quality } : {}),
      supply,
      status: under ? 'under' : 'over',
      indexes: under ? f.consumers : f.producers
    })
  }
  return out
}

/** Recipes whose surface conditions the surface fails. */
class SurfaceCheck {
  private readonly warnings = new Map<string, SurfaceWarning>()

  constructor(private readonly surface: Readonly<Record<string, number>>) {}

  check(recipe: RecipeProto, name: string, index: number): void {
    for (const c of recipe.surfaceConditions ?? []) {
      const value = this.surface[c.property] ?? 0
      if (value >= (c.min ?? -Infinity) && value <= (c.max ?? Infinity)) continue
      const key = `${name}|${c.property}`
      let w = this.warnings.get(key)
      if (!w) {
        w = {
          recipe: name,
          property: c.property,
          value,
          ...(c.min === undefined ? {} : { min: c.min }),
          ...(c.max === undefined ? {} : { max: c.max }),
          indexes: []
        }
        this.warnings.set(key, w)
      }
      w.indexes.push(index)
    }
  }

  list(): SurfaceWarning[] {
    return [...this.warnings.values()]
  }
}
