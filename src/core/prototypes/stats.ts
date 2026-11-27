/**
 * Numbers from the dump that analysis needs (docs/spec/06-analysis.md):
 * crafting, modules, energy, belts, inserters, poles, drills, beacons.
 * See docs/spec/03-game-assets.md § Analysis fields (DB format 7).
 *
 * Every field is optional and omitted at its game default, so the DB stays small.
 * Energy is stored in watts (power) or joules (energy) as plain numbers.
 */

export type ModuleEffect = 'consumption' | 'speed' | 'productivity' | 'pollution' | 'quality'

export const MODULE_EFFECTS: readonly ModuleEffect[] = [
  'consumption',
  'speed',
  'productivity',
  'pollution',
  'quality'
]

export interface ItemCount {
  item: string
  count: number
}

export interface EnergySourceStats {
  /** `electric`, `burner`, `heat`, `fluid` or `void`. */
  type: string
  /** Electric drain in W. */
  drain?: number
  /** Burner fuel categories. */
  fuelCategories?: string[]
  /** Burner / fluid effectivity (default 1). */
  effectivity?: number
  /** Electric buffer in J (accumulators, roboports, electric turrets; format 8+). */
  bufferCapacity?: number
  /** Electric flow limits in W (format 8+). */
  inputFlowLimit?: number
  outputFlowLimit?: number
}

export interface EntityStats {
  /** Items that place this entity (`placeable_by`), when the prototype names them. */
  placeableBy?: ItemCount[]
  craftingSpeed?: number
  craftingCategories?: string[]
  /** Crafting machines whose recipe cannot change: rocket silo, captive spawner (format 9+). */
  fixedRecipe?: string
  moduleSlots?: number
  /** Effects modules and beacons may apply. Present for types with module slots. */
  allowedEffects?: ModuleEffect[]
  allowedModuleCategories?: string[]
  /** `effect_receiver.base_effect` (foundry, EM plant, biochamber productivity). */
  baseEffect?: Partial<Record<ModuleEffect, number>>
  /**
   * Working power in W: `energy_usage`, else lamp / speaker `energy_usage_per_tick`
   * (a power despite the name), boiler `energy_consumption`, fusion reactor
   * `power_input`, combinator `active_energy_usage`, or asteroid collector
   * `passive_energy_usage` (J per tick, × 60).
   */
  energyUsage?: number
  /**
   * Extra power while busy, in W (format 8+): rocket silo `active_energy_usage`
   * (launch sequence), agricultural tower `crane_energy_usage`, asteroid collector
   * `arm_energy_usage` (J per tick, × 60).
   */
  activeEnergyUsage?: number
  /** Crafting machines: quality scales `energy_usage` (format 8+). */
  qualityAffectsEnergyUsage?: boolean
  energySource?: EnergySourceStats
  /**
   * Peak electric output in W (format 8+): solar `production`, generator
   * `max_power_output` or its fluid's heat, burner generator `max_power_output`,
   * fusion generator `output_flow_limit`, electric energy interface `energy_production`.
   */
  powerOutput?: number
  /** Reactors: heat output in W (`consumption`) and `neighbour_bonus` (format 8+). */
  heatOutput?: number
  neighbourBonus?: number
  /** Inserters: energy per movement / rotation in J. */
  energyPerMovement?: number
  energyPerRotation?: number
  /** Belts, undergrounds, splitters, loaders: tiles per tick. */
  beltSpeed?: number
  /** Underground belts and pipes: max distance in tiles. */
  maxDistance?: number
  /** Inserters (turns and tiles per tick). */
  rotationSpeed?: number
  extensionSpeed?: number
  bulk?: boolean
  stackSizeBonus?: number
  maxBeltStackSize?: number
  /** Electric poles and beacons: supply area half-width in tiles. */
  supplyAreaDistance?: number
  /** Electric poles: copper and circuit wire reach in tiles. */
  maxWireDistance?: number
  /** Other wireable entities: circuit wire reach in tiles. */
  circuitWireMaxDistance?: number
  miningSpeed?: number
  resourceCategories?: string[]
  distributionEffectivity?: number
  distributionEffectivityBonusPerQualityLevel?: number
  /** Beacon profile: effect multiplier by number of beacons (index 0 = one beacon). */
  profile?: number[]
  /** Beacons: `same_type` counts only beacons of this prototype for `profile` (default `total`; format 8+). */
  beaconCounter?: 'same_type'
  researchingSpeed?: number
}

const SI: Readonly<Record<string, number>> = {
  '': 1,
  k: 1e3,
  K: 1e3,
  M: 1e6,
  G: 1e9,
  T: 1e12,
  P: 1e15,
  E: 1e18,
  Z: 1e21,
  Y: 1e24,
  R: 1e27,
  Q: 1e30
}

/** Parses a Factorio energy string such as `"150kW"`, `"4MJ"` or `"0.4kW"`. W and J alike. */
export function parseEnergy(value: unknown): number | undefined {
  if (typeof value === 'number') return value
  if (typeof value !== 'string') return undefined
  const m = /^([kKMGTPEZYRQ]?)([WJ])$/.exec(
    value
      .trim()
      .replace(/^[\d.e+-]+/, '')
      .trim()
  )
  const amount = Number.parseFloat(value)
  if (!m || Number.isNaN(amount)) return undefined
  return amount * SI[m[1]!]!
}

const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined)

function strings(v: unknown): string[] | undefined {
  if (typeof v === 'string') return [v]
  if (!Array.isArray(v)) return undefined
  return v.filter((x): x is string => typeof x === 'string')
}

/** `placeable_by` / `minable` style item references: one `{ item, count }` or a list. */
export function itemCounts(value: unknown): ItemCount[] | undefined {
  let list: unknown[] = []
  if (Array.isArray(value)) list = value
  else if (value) list = [value]
  const out = list.flatMap((raw): ItemCount[] => {
    if (!raw || typeof raw !== 'object') return []
    const r = raw as Record<string, unknown>
    return typeof r['item'] === 'string' ? [{ item: r['item'], count: num(r['count']) ?? 1 }] : []
  })
  return out.length ? out : undefined
}

function energySource(value: unknown): EnergySourceStats | undefined {
  if (!value || typeof value !== 'object') return undefined
  const r = value as Record<string, unknown>
  if (typeof r['type'] !== 'string') return undefined
  const fuel = strings(r['fuel_categories'])
  const effectivity = num(r['effectivity'])
  return compact<EnergySourceStats>({
    type: r['type'],
    drain: parseEnergy(r['drain']),
    fuelCategories: fuel?.length ? fuel : undefined,
    effectivity: effectivity !== undefined && effectivity !== 1 ? effectivity : undefined,
    bufferCapacity: parseEnergy(r['buffer_capacity']),
    inputFlowLimit: parseEnergy(r['input_flow_limit']),
    outputFlowLimit: parseEnergy(r['output_flow_limit'])
  })
}

/** Fluid data a generator's output depends on. */
export interface FluidHeat {
  defaultTemperature: number
  /** J per unit per °C. */
  heatCapacity: number
}

export interface StatsContext {
  fluid(name: string): FluidHeat | undefined
}

/** Fluid heat from a raw fluid prototype (`heat_capacity` default 1kJ, `default_temperature` required). */
export function fluidHeat(proto: Record<string, unknown> | undefined): FluidHeat | undefined {
  if (!proto) return undefined
  const defaultTemperature = num(proto['default_temperature'])
  if (defaultTemperature === undefined) return undefined
  return { defaultTemperature, heatCapacity: parseEnergy(proto['heat_capacity']) ?? 1000 }
}

/** Per-tick energies (J) as power in W. */
const perTick = (v: unknown): number | undefined => {
  const e = parseEnergy(v)
  return e === undefined ? undefined : e * 60
}

function energyUsage(type: string, proto: Record<string, unknown>): number | undefined {
  if (type === 'asteroid-collector') return perTick(proto['passive_energy_usage'])
  return parseEnergy(
    proto['energy_usage'] ??
      proto['energy_usage_per_tick'] ??
      proto['energy_consumption'] ??
      proto['power_input'] ??
      proto['active_energy_usage']
  )
}

function activeEnergyUsage(type: string, proto: Record<string, unknown>): number | undefined {
  switch (type) {
    case 'rocket-silo':
      return parseEnergy(proto['active_energy_usage']) || undefined
    case 'agricultural-tower':
      return parseEnergy(proto['crane_energy_usage']) || undefined
    case 'asteroid-collector':
      return perTick(proto['arm_energy_usage']) || undefined
    default:
      return undefined
  }
}

/**
 * Peak electric output. Generators without `max_power_output`:
 * `fluid_usage_per_tick × 60 × (maximum_temperature − fluid default temperature)
 * × heat_capacity × effectivity` (prototype-api.json, GeneratorPrototype::burns_fluid).
 */
function powerOutput(
  type: string,
  proto: Record<string, unknown>,
  context: StatsContext | undefined
): number | undefined {
  switch (type) {
    case 'solar-panel':
      return parseEnergy(proto['production'])
    case 'burner-generator':
      return parseEnergy(proto['max_power_output'])
    case 'electric-energy-interface':
      return parseEnergy(proto['energy_production']) || undefined
    case 'fusion-generator': {
      const source = proto['energy_source'] as Record<string, unknown> | undefined
      return parseEnergy(source?.['output_flow_limit'])
    }
    case 'generator':
      return generatorOutput(proto, context)
    default:
      return undefined
  }
}

function generatorOutput(
  proto: Record<string, unknown>,
  context: StatsContext | undefined
): number | undefined {
  const max = parseEnergy(proto['max_power_output'])
  if (max !== undefined) return max
  const box = proto['fluid_box'] as Record<string, unknown> | undefined
  const filter = box?.['filter']
  const fluid = typeof filter === 'string' ? context?.fluid(filter) : undefined
  const usage = num(proto['fluid_usage_per_tick'])
  const temperature = num(proto['maximum_temperature'])
  if (!fluid || usage === undefined || temperature === undefined) return undefined
  const effectivity = num(proto['effectivity']) ?? 1
  return usage * 60 * (temperature - fluid.defaultTemperature) * fluid.heatCapacity * effectivity
}

function effects(value: unknown): Partial<Record<ModuleEffect, number>> | undefined {
  if (!value || typeof value !== 'object') return undefined
  const r = value as Record<string, unknown>
  const out: Partial<Record<ModuleEffect, number>> = {}
  for (const effect of MODULE_EFFECTS) {
    const v = num(r[effect])
    if (v !== undefined && v !== 0) out[effect] = v
  }
  return Object.keys(out).length ? out : undefined
}

/** `allowed_effects` defaults differ per type (prototype-api.json). */
function defaultAllowedEffects(type: string): ModuleEffect[] {
  switch (type) {
    case 'mining-drill':
      return [...MODULE_EFFECTS]
    case 'lab':
      return MODULE_EFFECTS.filter((e) => e !== 'quality')
    default:
      return []
  }
}

const MODULE_TYPES: ReadonlySet<string> = new Set([
  'assembling-machine',
  'furnace',
  'rocket-silo',
  'mining-drill',
  'lab',
  'beacon'
])

const BELT_TYPES: ReadonlySet<string> = new Set([
  'transport-belt',
  'underground-belt',
  'splitter',
  'lane-splitter',
  'loader',
  'loader-1x1',
  'linked-belt'
])

/** Extracts the analysis fields of one entity prototype. Undefined when it has none. */
export function entityStats(
  type: string,
  proto: Record<string, unknown>,
  context?: StatsContext
): EntityStats | undefined {
  const receiver = proto['effect_receiver'] as Record<string, unknown> | undefined
  const s = compact<EntityStats>({
    placeableBy: itemCounts(proto['placeable_by']),
    craftingSpeed: num(proto['crafting_speed']),
    craftingCategories: strings(proto['crafting_categories']),
    fixedRecipe: typeof proto['fixed_recipe'] === 'string' ? proto['fixed_recipe'] : undefined,
    ...(MODULE_TYPES.has(type) ? moduleStats(type, proto) : {}),
    baseEffect: effects(receiver?.['base_effect']),
    energyUsage: energyUsage(type, proto),
    activeEnergyUsage: activeEnergyUsage(type, proto),
    qualityAffectsEnergyUsage: proto['quality_affects_energy_usage'] === true || undefined,
    energySource: energySource(proto['energy_source']),
    powerOutput: powerOutput(type, proto, context),
    heatOutput: type === 'reactor' ? parseEnergy(proto['consumption']) : undefined,
    neighbourBonus: type === 'reactor' ? (num(proto['neighbour_bonus']) ?? 1) : undefined,
    energyPerMovement: parseEnergy(proto['energy_per_movement']),
    energyPerRotation: parseEnergy(proto['energy_per_rotation']),
    maxDistance:
      type === 'pipe-to-ground' ? undergroundPipeReach(proto) : num(proto['max_distance']),
    beltSpeed: BELT_TYPES.has(type) ? num(proto['speed']) : undefined,
    ...(type === 'inserter' ? inserterStats(proto) : {}),
    supplyAreaDistance: num(proto['supply_area_distance']),
    maxWireDistance: num(proto['maximum_wire_distance']),
    circuitWireMaxDistance: num(proto['circuit_wire_max_distance']) || undefined,
    miningSpeed: num(proto['mining_speed']),
    resourceCategories: strings(proto['resource_categories']),
    distributionEffectivity: num(proto['distribution_effectivity']),
    distributionEffectivityBonusPerQualityLevel: num(
      proto['distribution_effectivity_bonus_per_quality_level']
    ),
    profile: Array.isArray(proto['profile'])
      ? proto['profile'].filter((x): x is number => typeof x === 'number')
      : undefined,
    beaconCounter: proto['beacon_counter'] === 'same_type' ? 'same_type' : undefined,
    researchingSpeed: num(proto['researching_speed'])
  })
  return Object.keys(s).length ? s : undefined
}

/** Drops undefined values. */
function compact<T extends object>(value: { [K in keyof T]: T[K] | undefined }): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T
}

function moduleStats(type: string, proto: Record<string, unknown>): Partial<EntityStats> {
  const allowed = strings(proto['allowed_effects'])
  return {
    moduleSlots: num(proto['module_slots']) ?? 0,
    allowedEffects: allowed
      ? MODULE_EFFECTS.filter((e) => allowed.includes(e))
      : defaultAllowedEffects(type),
    allowedModuleCategories: strings(proto['allowed_module_categories'])
  }
}

function inserterStats(proto: Record<string, unknown>): Partial<EntityStats> {
  return {
    rotationSpeed: num(proto['rotation_speed']),
    extensionSpeed: num(proto['extension_speed']),
    bulk: proto['bulk'] === true || undefined,
    stackSizeBonus: num(proto['stack_size_bonus']) || undefined,
    maxBeltStackSize: num(proto['max_belt_stack_size'])
  }
}

/** Pipe-to-ground reach: `max_underground_distance` of its underground connection. */
function undergroundPipeReach(proto: Record<string, unknown>): number | undefined {
  const box = proto['fluid_box'] as Record<string, unknown> | undefined
  const connections = box?.['pipe_connections']
  if (!Array.isArray(connections)) return undefined
  return connections
    .map((c) => num((c as Record<string, unknown>)['max_underground_distance']))
    .find((d) => d !== undefined)
}

export interface ItemStats {
  /** Fuel value in J. */
  fuelValue?: number
  fuelCategories?: string[]
  /** Tile this item places (`place_as_tile.result`). */
  placeAsTile?: string
  /** Ticks until the item spoils (format 9+). */
  spoilTicks?: number
  /** Module items. */
  module?: { category: string; tier: number; effect: Partial<Record<ModuleEffect, number>> }
}

/** Extracts the analysis fields of one item prototype. */
export function itemStats(type: string, proto: Record<string, unknown>): ItemStats {
  const s: ItemStats = {}
  const fuel = parseEnergy(proto['fuel_value'])
  if (fuel) {
    s.fuelValue = fuel
    const categories = strings(proto['fuel_categories'] ?? proto['fuel_category'])
    if (categories?.length) s.fuelCategories = categories
  }
  const tile = (proto['place_as_tile'] as Record<string, unknown> | undefined)?.['result']
  if (typeof tile === 'string') s.placeAsTile = tile
  const spoil = num(proto['spoil_ticks'])
  if (spoil) s.spoilTicks = spoil
  if (type === 'module' && typeof proto['category'] === 'string') {
    s.module = {
      category: proto['category'],
      tier: num(proto['tier']) ?? 0,
      effect: effects(proto['effect']) ?? {}
    }
  }
  return s
}

/** Quality multipliers the game derives from `level` when the prototype does not set them. */
export type QualityMultiplier =
  | 'default'
  | 'crafting_machine_speed'
  | 'crafting_machine_energy_usage'
  | 'inserter_speed'
  | 'lab_research_speed'
  | 'module_speed'
  | 'module_productivity'
  | 'module_consumption'
  | 'module_pollution'
  | 'module_quality'
  | 'beacon_power_usage'
  | 'mining_drill_resource_drain'
  | 'range'
  | 'accumulator_capacity'

/** Explicit `*_multiplier` fields of a quality prototype, keyed without the suffix. */
export function qualityMultipliers(proto: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [key, value] of Object.entries(proto)) {
    if (key.endsWith('_multiplier') && typeof value === 'number')
      out[key.slice(0, -'_multiplier'.length)] = value
  }
  return out
}

/**
 * A quality multiplier with the game's defaults (prototype-api.json, QualityPrototype):
 * `default` = 1 + 0.3 × level; speed, module and inserter multipliers fall back to
 * `default`; beacon power, drill drain and machine energy default to 1; range
 * = min(1 + 0.1 × level, 3); accumulator capacity = 1 + level.
 */
export function qualityMultiplier(
  quality: { level: number; multipliers?: Record<string, number> } | undefined,
  key: QualityMultiplier
): number {
  if (!quality) return 1
  const explicit = quality.multipliers?.[key]
  if (explicit !== undefined) return explicit
  const base = quality.multipliers?.['default'] ?? 1 + 0.3 * quality.level
  switch (key) {
    case 'beacon_power_usage':
    case 'mining_drill_resource_drain':
    case 'crafting_machine_energy_usage':
      return 1
    case 'range':
      return Math.min(1 + 0.1 * quality.level, 3)
    case 'accumulator_capacity':
      return 1 + quality.level
    default:
      return base
  }
}
