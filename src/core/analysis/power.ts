import { SpatialIndex, boxCenter, type Box } from '../geometry'
import type { BlueprintLayout, EntityLayout } from '../model/layout'
import { WireConnectorId, wireNetworks } from '../model/wires'
import { qualityMultiplier, type EntityProto, type PrototypeDb } from '../prototypes'
import { entityEffects, type ReceiverEffects } from './effects'

/**
 * Power report: electric draw and drain, generation, heat, accumulators, pole
 * coverage and pole networks. See docs/spec/06-analysis.md § 4 Power.
 * Needs game data; `analyse()` returns `null` for it without a DB.
 */

/** Where the blueprint is assumed to be built, for solar output. */
export interface PowerSurface {
  /** Planet name (default `nauvis`). */
  planet?: string
  /**
   * On a space platform in the planet's orbit: no night, `solar_power_in_space`,
   * and no poles needed (a platform powers all its entities). Undefined = detect
   * it from the blueprint (`isSpacePlatform`).
   */
  space?: boolean
}

/** Entity types that only exist on space platforms. */
const PLATFORM_TYPES: ReadonlySet<string> = new Set([
  'space-platform-hub',
  'asteroid-collector',
  'thruster'
])

/** Whether the blueprint looks like a space platform: platform foundation tiles or platform-only entities. */
export function isSpacePlatform(db: PrototypeDb, layout: BlueprintLayout): boolean {
  return (
    layout.tiles.some((t) => t.name === 'space-platform-foundation') ||
    layout.entities.some((e) => PLATFORM_TYPES.has(db.entities[e.entity.name]?.type ?? ''))
  )
}

interface Row {
  name: string
  quality?: string
  count: number
  /** Indexes into `blueprint.entities`. */
  indexes: number[]
}

export interface ConsumerRow extends Row {
  /** Total peak draw in W, drain included. */
  peak: number
  /** Total drain in W (drawn even when idle). */
  drain: number
}

export type GeneratorKind = 'solar' | 'steam' | 'burner' | 'fusion' | 'interface'

export interface GeneratorRow extends Row {
  kind: GeneratorKind
  /** Total peak output in W. */
  peak: number
  /** Average output in W: solar over the day, others at their peak. */
  average: number
}

export interface HeatRow extends Row {
  /** Total heat output in W, neighbour bonus included. */
  output: number
}

export interface PoleNetwork {
  /** Name of its first pole (for an icon). */
  pole: string
  /** Layout indexes of the poles. */
  poles: number[]
  /** Electric entities supplied by this network's poles. */
  members: number[]
  peak: number
  generation: number
}

export interface PowerReport {
  /** Total peak electric draw in W, drain included. */
  peak: number
  drain: number
  consumers: ConsumerRow[]
  generationPeak: number
  generationAverage: number
  generators: GeneratorRow[]
  /** Solar output on this surface: `peak` × the panel's `production`, `average` over a day. */
  solar: SolarFactor
  surface: { planet: string; space: boolean; detected: boolean }
  heatOutput: number
  heat: HeatRow[]
  accumulators: Row & { capacity: number; output: number }
  /** Poles and power switches by copper network. */
  networks: PoleNetwork[]
  poleCount: number
  /** Electric entities that no pole's supply area reaches (always empty on a space platform). */
  unpowered: Row[]
  unpoweredCount: number
  /** Entities that run on fuel, heat or fluid instead of electricity. */
  nonElectric: Row[]
}

/** Night and dusk average of a day-night cycle: 70 % of peak. */
const DAY_AVERAGE = 0.7

/** Types that put power into the network (or store it) instead of drawing it. */
const PRODUCER_TYPES: ReadonlySet<string> = new Set([
  'solar-panel',
  'accumulator',
  'generator',
  'burner-generator',
  'fusion-generator',
  'electric-energy-interface',
  'lightning-attractor'
])

/** Crafting machines: an electric source without `drain` drains `energy_usage / 30`. */
const CRAFTING_TYPES: ReadonlySet<string> = new Set([
  'assembling-machine',
  'furnace',
  'rocket-silo'
])

const GENERATOR_KINDS: Readonly<Record<string, GeneratorKind>> = {
  'solar-panel': 'solar',
  generator: 'steam',
  'burner-generator': 'burner',
  'fusion-generator': 'fusion',
  'electric-energy-interface': 'interface'
}

export interface SolarFactor {
  peak: number
  average: number
}

/**
 * Solar output relative to the panel's `production`: the planet's `solar-power`
 * (or `solar_power_in_space` in orbit) in percent, and 70 % of that on average
 * over a day-night cycle on a planet (no night in space).
 */
export function solarFactor(db: PrototypeDb, surface: PowerSurface = {}): SolarFactor {
  const planet = db.planets[surface.planet ?? 'nauvis']
  if (surface.space) {
    const peak = (planet?.solarPowerInSpace ?? 100) / 100
    return { peak, average: peak }
  }
  const peak = (planet?.solarPower ?? 100) / 100
  return { peak, average: peak * DAY_AVERAGE }
}

const qualityOf = (
  db: PrototypeDb,
  e: EntityLayout
): PrototypeDb['qualities'][string] | undefined => db.qualities[e.entity.quality ?? 'normal']

/** Peak draw and drain of one electric consumer in W. */
export function electricDraw(
  db: PrototypeDb,
  proto: EntityProto,
  e: EntityLayout,
  effects: ReceiverEffects | undefined
): { peak: number; drain: number } {
  const s = proto.stats ?? {}
  const source = s.energySource
  const usage = s.energyUsage ?? 0
  const q = qualityOf(db, e)
  const drain = source?.drain ?? (CRAFTING_TYPES.has(proto.type) ? usage / 30 : 0)

  switch (proto.type) {
    case 'inserter': {
      // energy_per_movement per tile of extension, energy_per_rotation per turn.
      const speed = qualityMultiplier(q, 'inserter_speed')
      const perTick =
        (s.energyPerMovement ?? 0) * (s.extensionSpeed ?? 0) +
        (s.energyPerRotation ?? 0) * (s.rotationSpeed ?? 0)
      return { peak: perTick * 60 * speed + drain, drain }
    }
    case 'electric-turret':
      // Shots draw from the buffer; only the drain is steady.
      return { peak: drain, drain }
    case 'roboport':
      return { peak: (source?.inputFlowLimit ?? usage) + drain, drain }
    case 'beacon':
      return { peak: usage * qualityMultiplier(q, 'beacon_power_usage') + drain, drain }
    default: {
      const consumption = Math.max(0.2, 1 + (effects?.effects.consumption ?? 0))
      const quality = s.qualityAffectsEnergyUsage
        ? qualityMultiplier(q, 'crafting_machine_energy_usage')
        : 1
      return {
        peak: usage * consumption * quality + (s.activeEnergyUsage ?? 0) + drain,
        drain
      }
    }
  }
}

function addRow<T extends Row>(
  map: Map<string, T>,
  e: EntityLayout,
  make: () => Omit<T, keyof Row>
): T {
  const q = e.entity.quality && e.entity.quality !== 'normal' ? e.entity.quality : undefined
  const key = `${e.entity.name}\u0000${q ?? ''}`
  let row = map.get(key)
  if (!row) {
    row = {
      name: e.entity.name,
      ...(q ? { quality: q } : {}),
      count: 0,
      indexes: [],
      ...make()
    } as unknown as T
    map.set(key, row)
  }
  row.count++
  row.indexes.push(e.index)
  return row
}

const byValue =
  <T extends Row>(value: (r: T) => number) =>
  (a: T, b: T): number =>
    value(b) - value(a) || b.count - a.count || a.name.localeCompare(b.name)

/** Whether two boxes of the same size share a whole edge. */
function sharesEdge(a: EntityLayout, b: EntityLayout): boolean {
  const sameRow = a.box.top === b.box.top && a.box.bottom === b.box.bottom
  const sameColumn = a.box.left === b.box.left && a.box.right === b.box.right
  const touchX = a.box.right === b.box.left || b.box.right === a.box.left
  const touchY = a.box.bottom === b.box.top || b.box.bottom === a.box.top
  return (sameRow && touchX) || (sameColumn && touchY)
}

/** Reactor neighbours: same-named reactors whose boxes share a full edge. */
function reactorNeighbours(reactors: EntityLayout[]): Map<number, number> {
  const out = new Map<number, number>()
  for (const a of reactors) {
    const n = reactors.filter((b) => a !== b && a.entity.name === b.entity.name && sharesEdge(a, b))
    out.set(a.index, n.length)
  }
  return out
}

interface ElectricEntity {
  e: EntityLayout
  peak: number
  generation: number
}

/** Running totals of the power report. */
class PowerTally {
  readonly consumers = new Map<string, ConsumerRow>()
  readonly generators = new Map<string, GeneratorRow>()
  readonly nonElectric = new Map<string, Row>()
  readonly accumulators: PowerReport['accumulators'] = {
    name: 'accumulator',
    count: 0,
    indexes: [],
    capacity: 0,
    output: 0
  }
  readonly reactors: EntityLayout[] = []
  readonly poles: EntityLayout[] = []
  readonly electric: ElectricEntity[] = []
  peak = 0
  drain = 0
  generationPeak = 0
  generationAverage = 0

  constructor(
    private readonly db: PrototypeDb,
    private readonly effects: Map<number, ReceiverEffects>,
    private readonly solar: SolarFactor
  ) {}

  add(e: EntityLayout, proto: EntityProto): void {
    const sourceType = proto.stats?.energySource?.type
    if (proto.type === 'electric-pole') {
      this.poles.push(e)
      return
    }
    if (proto.type === 'reactor') this.reactors.push(e)
    if (sourceType && sourceType !== 'electric' && sourceType !== 'void')
      addRow(this.nonElectric, e, () => ({}))
    if (sourceType !== 'electric') return
    if (proto.type === 'accumulator') this.addAccumulator(e, proto)
    else if (PRODUCER_TYPES.has(proto.type)) this.addProducer(e, proto)
    else this.addConsumer(e, proto)
  }

  private addAccumulator(e: EntityLayout, proto: EntityProto): void {
    const source = proto.stats?.energySource
    const a = this.accumulators
    a.count++
    a.indexes.push(e.index)
    a.capacity +=
      (source?.bufferCapacity ?? 0) *
      qualityMultiplier(qualityOf(this.db, e), 'accumulator_capacity')
    a.output += source?.outputFlowLimit ?? 0
    this.electric.push({ e, peak: 0, generation: 0 })
  }

  private addProducer(e: EntityLayout, proto: EntityProto): void {
    const kind = GENERATOR_KINDS[proto.type]
    const rated =
      (proto.stats?.powerOutput ?? 0) * qualityMultiplier(qualityOf(this.db, e), 'default')
    const solar = kind === 'solar'
    const out = solar ? rated * this.solar.peak : rated
    if (kind && out > 0) {
      const average = solar ? rated * this.solar.average : out
      const row = addRow(this.generators, e, () => ({ kind, peak: 0, average: 0 }))
      row.peak += out
      row.average += average
      this.generationPeak += out
      this.generationAverage += average
    }
    this.electric.push({ e, peak: 0, generation: out })
  }

  private addConsumer(e: EntityLayout, proto: EntityProto): void {
    const draw = electricDraw(this.db, proto, e, this.effects.get(e.index))
    const row = addRow(this.consumers, e, () => ({ peak: 0, drain: 0 }))
    row.peak += draw.peak
    row.drain += draw.drain
    this.peak += draw.peak
    this.drain += draw.drain
    this.electric.push({ e, peak: draw.peak, generation: 0 })
  }

  /** Heat rows of the reactors, with the neighbour bonus. */
  heat(): { rows: HeatRow[]; total: number } {
    const neighbours = reactorNeighbours(this.reactors)
    const rows = new Map<string, HeatRow>()
    let total = 0
    for (const e of this.reactors) {
      const s = this.db.entities[e.entity.name]?.stats ?? {}
      const bonus = 1 + (s.neighbourBonus ?? 1) * (neighbours.get(e.index) ?? 0)
      const out = (s.heatOutput ?? 0) * bonus * qualityMultiplier(qualityOf(this.db, e), 'default')
      addRow(rows, e, () => ({ output: 0 })).output += out
      total += out
    }
    return { rows: [...rows.values()].sort(byValue((r) => r.output)), total }
  }
}

export function power(
  db: PrototypeDb,
  layout: BlueprintLayout,
  surface: PowerSurface = {}
): PowerReport {
  const space = surface.space ?? isSpacePlatform(db, layout)
  const solar = solarFactor(db, { ...surface, space })
  const tally = new PowerTally(db, entityEffects(db, layout), solar)
  for (const e of layout.entities) {
    const proto = db.entities[e.entity.name]
    if (proto) tally.add(e, proto)
  }

  const heat = tally.heat()
  const { networks, supplied } = poleNetworks(db, layout, tally.poles, tally.electric)
  const unpowered = new Map<string, Row>()
  if (!space)
    for (const { e } of tally.electric) if (!supplied.has(e.index)) addRow(unpowered, e, () => ({}))

  return {
    peak: tally.peak,
    drain: tally.drain,
    consumers: [...tally.consumers.values()].sort(byValue((r) => r.peak)),
    generationPeak: tally.generationPeak,
    generationAverage: tally.generationAverage,
    generators: [...tally.generators.values()].sort(byValue((r) => r.peak)),
    solar,
    surface: { planet: surface.planet ?? 'nauvis', space, detected: surface.space === undefined },
    heatOutput: heat.total,
    heat: heat.rows,
    accumulators: tally.accumulators,
    networks,
    poleCount: tally.poles.length,
    unpowered: [...unpowered.values()].sort(byValue((r) => r.count)),
    unpoweredCount: [...unpowered.values()].reduce((n, r) => n + r.count, 0),
    nonElectric: [...tally.nonElectric.values()].sort(byValue((r) => r.count))
  }
}

/**
 * A pole's supply area: its centre ± `supply_area_distance` (small pole 2.5 → 5 × 5).
 * Unlike beacons, whose area is their box grown by the distance.
 */
export function supplyArea(pole: EntityLayout, distance: number): Box {
  const { x, y } = boxCenter(pole.box)
  return { left: x - distance, top: y - distance, right: x + distance, bottom: y + distance }
}

/** Union-find over layout indexes. */
class UnionFind {
  private readonly parent = new Map<number, number>()

  constructor(items: Iterable<number>) {
    for (const i of items) this.parent.set(i, i)
  }

  has(i: number): boolean {
    return this.parent.has(i)
  }

  find(i: number): number {
    let root = i
    while (this.parent.get(root) !== root) root = this.parent.get(root)!
    this.parent.set(i, root)
    return root
  }

  union(a: number, b: number): void {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra !== rb) this.parent.set(ra, rb)
  }
}

/**
 * Joins poles connected by copper wires. A power switch's two copper
 * connectors are separate ends of the copper networks; its sides are joined
 * only when `switch_state` is on.
 */
function joinCopperNetworks(db: PrototypeDb, layout: BlueprintLayout, poles: UnionFind): void {
  const byNumber = new Map<number, EntityLayout>()
  for (const e of layout.entities)
    if (typeof e.entity.entity_number === 'number') byNumber.set(e.entity.entity_number, e)

  const switches = new SwitchSides()
  for (const group of wireNetworks(layout.wires, 'copper')) {
    const ends = group.flatMap((end) => {
      const e = byNumber.get(end.entity)
      return e ? [{ e, connector: end.connector }] : []
    })
    const first = ends.find(({ e }) => poles.has(e.index))?.e.index
    if (first === undefined) continue
    for (const { e, connector } of ends) {
      if (poles.has(e.index)) poles.union(first, e.index)
      else if (db.entities[e.entity.name]?.type === 'power-switch')
        switches.set(e, connector, first)
    }
  }
  switches.join(poles)
}

/** The pole each side of each power switch reaches. */
class SwitchSides {
  private readonly sides = new Map<EntityLayout, { left?: number; right?: number }>()

  set(entity: EntityLayout, connector: number, pole: number): void {
    const sides = this.sides.get(entity) ?? {}
    if (connector === WireConnectorId.PowerSwitchRightCopper) sides.right = pole
    else sides.left = pole
    this.sides.set(entity, sides)
  }

  /** Joins both sides of every switch that is on. */
  join(poles: UnionFind): void {
    for (const [e, { left, right }] of this.sides) {
      const on = (e.entity as { switch_state?: unknown }).switch_state === true
      if (on && left !== undefined && right !== undefined) poles.union(left, right)
    }
  }
}

/**
 * Copper networks of the poles. Each electric entity belongs to the network
 * of the first pole whose supply area reaches it.
 */
function poleNetworks(
  db: PrototypeDb,
  layout: BlueprintLayout,
  poles: EntityLayout[],
  electric: ElectricEntity[]
): { networks: PoleNetwork[]; supplied: Set<number> } {
  const sets = new UnionFind(poles.map((p) => p.index))
  joinCopperNetworks(db, layout, sets)

  const areas = new SpatialIndex<EntityLayout>()
  const networks = new Map<number, PoleNetwork>()
  for (const p of poles) {
    areas.insert(supplyArea(p, db.entities[p.entity.name]?.stats?.supplyAreaDistance ?? 0), p)
    const root = sets.find(p.index)
    const n = networks.get(root) ?? {
      pole: p.entity.name,
      poles: [],
      members: [],
      peak: 0,
      generation: 0
    }
    n.poles.push(p.index)
    networks.set(root, n)
  }

  const supplied = new Set<number>()
  for (const { e, peak, generation } of electric) {
    const pole = areas.query(e.box)[0]
    if (!pole) continue
    supplied.add(e.index)
    const n = networks.get(sets.find(pole.index))!
    n.members.push(e.index)
    n.peak += peak
    n.generation += generation
  }
  return {
    networks: [...networks.values()].sort((a, b) => b.poles.length - a.poles.length),
    supplied
  }
}
