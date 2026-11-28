import { SpatialIndex, unionBoxes, type Box } from '../geometry'
import type { BlueprintLayout, EntityLayout } from '../model/layout'
import { qualityMultiplier, type PrototypeDb } from '../prototypes'
import { joinedNeighbours, tileIndex, type TileQuery } from '../sprites/shapes'
import type { ItemRates } from './production'
import { UnionFind } from './union-find'
import { undergroundLines } from './undergrounds'

/**
 * Logistics (docs/spec/06-analysis.md § 3): belt and inserter throughput,
 * inserters that limit the machine they serve, splitter settings and fluid
 * segments. Needs game data. Rates are items (or fluid units) per second.
 */

/** Research levels that change logistics (06 § 3). */
export interface ResearchBonuses {
  /** Items per stack that inserters put on belts: 1 + `belt-stack-size-bonus` (1–4). */
  beltStackSize?: number
  /** Total `inserter-stack-size-bonus` (non-bulk inserters). */
  inserterCapacityBonus?: number
  /** Total `bulk-inserter-capacity-bonus`; researching bulk inserters gives 1. */
  bulkInserterCapacityBonus?: number
}

export const DEFAULT_RESEARCH: Required<ResearchBonuses> = {
  beltStackSize: 1,
  inserterCapacityBonus: 0,
  bulkInserterCapacityBonus: 1
}

export interface LogisticsSettings {
  research?: ResearchBonuses
  /** Item rates of machines by layout index (from `production`). */
  machineRates?: ReadonlyMap<number, ItemRates>
}

export interface BeltRow {
  name: string
  count: number
  indexes: number[]
  /** Both lanes, items per second, at the research's belt stack size. */
  throughput: number
}

export interface InserterRow {
  name: string
  quality?: string
  count: number
  indexes: number[]
  handSize: number
  /** Swings per second (pickup and back). */
  cycles: number
  /** Items per second chest to chest (`handSize × cycles`): the best case. */
  throughput: number
}

/** A machine whose inserters cannot move what it uses or makes, even chest to chest. */
export interface InserterLimitRow {
  name: string
  quality?: string
  /** `input`: inserters dropping into the machine; `output`: taking out of it. */
  side: 'input' | 'output'
  count: number
  /** The machines and their inserters on that side. */
  indexes: number[]
  /** The worst machine's items per second needed and its inserters' capacity. */
  need: number
  capacity: number
}

export interface SplitterRow {
  name: string
  inputPriority?: string
  outputPriority?: string
  filter?: { name: string; quality?: string }
  count: number
  indexes: number[]
}

export interface FluidSegment {
  /** Pipes, pipes to ground and tanks in the segment. */
  indexes: number[]
  tanks: number
  /** Longer side of the box around the segment, in tiles. */
  extent: number
  /** Pumps joined to the segment. */
  pumps: number[]
  /** Units per second of the fastest joined pump (0 without pumps). */
  pumpRate: number
}

export interface LogisticsReport {
  beltStackSize: number
  belts: BeltRow[]
  inserters: InserterRow[]
  limits: InserterLimitRow[]
  splitters: SplitterRow[]
  /** Largest first. */
  fluidSegments: FluidSegment[]
}

/** Items per tile of belt, both lanes (4 per lane). */
const ITEMS_PER_TILE = 8

const BELT_TYPES: ReadonlySet<string> = new Set([
  'transport-belt',
  'underground-belt',
  'splitter',
  'lane-splitter',
  'loader',
  'loader-1x1',
  'linked-belt'
])

const SPLITTER_TYPES: ReadonlySet<string> = new Set(['splitter', 'lane-splitter'])

const SEGMENT_TYPES: ReadonlySet<string> = new Set([
  'pipe',
  'pipe-to-ground',
  'storage-tank',
  'infinity-pipe'
])

const qualityOf = (q: string | undefined): string | undefined =>
  q && q !== 'normal' ? q : undefined

export function logistics(
  db: PrototypeDb,
  layout: BlueprintLayout,
  settings: LogisticsSettings = {}
): LogisticsReport {
  const research = { ...DEFAULT_RESEARCH, ...settings.research }
  const beltStackSize = Math.min(4, Math.max(1, Math.round(research.beltStackSize)))
  return {
    beltStackSize,
    belts: belts(db, layout, beltStackSize),
    ...inserters(db, layout, research, settings.machineRates),
    splitters: splitters(db, layout),
    fluidSegments: fluidSegments(db, layout)
  }
}

/** Items per second on both lanes of a belt moving `speed` tiles per tick. */
export function beltThroughput(speed: number, stackSize = 1): number {
  return speed * 60 * ITEMS_PER_TILE * stackSize
}

function belts(db: PrototypeDb, layout: BlueprintLayout, stackSize: number): BeltRow[] {
  const rows = new Map<string, BeltRow & { speed: number }>()
  for (const e of layout.entities) {
    const proto = db.entities[e.entity.name]
    const speed = proto?.stats?.beltSpeed
    if (!proto || !BELT_TYPES.has(proto.type) || speed === undefined) continue
    let row = rows.get(e.entity.name)
    if (!row) {
      row = {
        name: e.entity.name,
        count: 0,
        indexes: [],
        speed,
        throughput: beltThroughput(speed, stackSize)
      }
      rows.set(e.entity.name, row)
    }
    row.count++
    row.indexes.push(e.index)
  }
  return [...rows.values()]
    .sort((a, b) => a.speed - b.speed || a.name.localeCompare(b.name))
    .map(({ name, count, indexes, throughput }) => ({ name, count, indexes, throughput }))
}

// ---------------------------------------------------------------- inserters

/**
 * Ticks for one half turn: the ticks the arm needs strictly below half a turn
 * (fits the wiki's chest-to-chest table: inserter 70, long-handed 48, bulk 24
 * ticks per swing and back).
 */
export function inserterCycleTicks(rotationSpeed: number): number {
  const half = Math.max(1, Math.ceil(0.5 / rotationSpeed - 1e-9) - 1)
  return 2 * half
}

/** Hand size: 1 + `stack_size_bonus` + research, capped by the blueprint's `override_stack_size`. */
export function inserterHandSize(
  db: PrototypeDb,
  e: EntityLayout,
  research: Required<ResearchBonuses>
): number {
  const stats = db.entities[e.entity.name]?.stats ?? {}
  const bonus = stats.bulk ? research.bulkInserterCapacityBonus : research.inserterCapacityBonus
  const size = 1 + (stats.stackSizeBonus ?? 0) + bonus
  const override = e.entity['override_stack_size']
  return typeof override === 'number' && override >= 1 ? Math.min(size, override) : size
}

interface PlacedInserter {
  e: EntityLayout
  throughput: number
  pickup: { x: number; y: number }
  drop: { x: number; y: number }
}

function inserters(
  db: PrototypeDb,
  layout: BlueprintLayout,
  research: Required<ResearchBonuses>,
  rates: ReadonlyMap<number, ItemRates> | undefined
): Pick<LogisticsReport, 'inserters' | 'limits'> {
  const rows = new Map<string, InserterRow>()
  const placed: PlacedInserter[] = []
  for (const e of layout.entities) {
    const proto = db.entities[e.entity.name]
    const rotation = proto?.stats?.rotationSpeed
    if (proto?.type !== 'inserter' || !rotation) continue
    const quality = db.qualities[e.entity.quality ?? 'normal']
    const cycles = 60 / inserterCycleTicks(rotation * qualityMultiplier(quality, 'inserter_speed'))
    const handSize = inserterHandSize(db, e, research)
    const throughput = handSize * cycles
    addInserter(rows, e, handSize, cycles)
    const at = (
      v: [number, number] | undefined,
      fallback: [number, number]
    ): PlacedInserter['pickup'] => offset(e, v ?? fallback)
    placed.push({
      e,
      throughput,
      pickup: at(proto.stats?.pickupPosition, [0, -1]),
      drop: at(proto.stats?.insertPosition, [0, 1.2])
    })
  }
  return {
    inserters: [...rows.values()].sort(
      (a, b) =>
        a.name.localeCompare(b.name) ||
        (a.quality ?? '').localeCompare(b.quality ?? '') ||
        a.handSize - b.handSize
    ),
    limits: rates ? inserterLimits(layout, placed, rates) : []
  }
}

function addInserter(
  rows: Map<string, InserterRow>,
  e: EntityLayout,
  handSize: number,
  cycles: number
): void {
  const quality = qualityOf(e.entity.quality)
  const key = [e.entity.name, quality, handSize].join('|')
  let row = rows.get(key)
  if (!row) {
    row = {
      name: e.entity.name,
      ...(quality ? { quality } : {}),
      count: 0,
      indexes: [],
      handSize,
      cycles,
      throughput: handSize * cycles
    }
    rows.set(key, row)
  }
  row.count++
  row.indexes.push(e.index)
}

/** A north-facing vector rotated to the inserter's facing, from its centre. */
function offset(e: EntityLayout, v: [number, number]): { x: number; y: number } {
  let [x, y] = v
  const turns = Math.round(e.direction / 4) % 4
  for (let i = 0; i < turns; i++) [x, y] = [-y, x]
  return { x: (e.box.left + e.box.right) / 2 + x, y: (e.box.top + e.box.bottom) / 2 + y }
}

interface Served {
  machine: EntityLayout
  rates: ItemRates
  input: PlacedInserter[]
  output: PlacedInserter[]
}

/** Machines with a rate whose inserters on one side move less than it needs (by more than 1 %). */
function inserterLimits(
  layout: BlueprintLayout,
  placed: PlacedInserter[],
  rates: ReadonlyMap<number, ItemRates>
): InserterLimitRow[] {
  const index = new SpatialIndex<EntityLayout>(4)
  for (const i of rates.keys()) index.insert(layout.entities[i]!.box, layout.entities[i]!)
  const served = new Map<number, Served>()
  const serve = (
    p: { x: number; y: number },
    side: 'input' | 'output',
    ins: PlacedInserter
  ): void => {
    const machine = index.queryPoint(p)[0]
    if (!machine) return
    let s = served.get(machine.index)
    if (!s) {
      s = { machine, rates: rates.get(machine.index)!, input: [], output: [] }
      served.set(machine.index, s)
    }
    s[side].push(ins)
  }
  for (const ins of placed) {
    serve(ins.drop, 'input', ins)
    serve(ins.pickup, 'output', ins)
  }
  const rows = new Map<string, InserterLimitRow>()
  for (const s of served.values()) {
    for (const side of ['input', 'output'] as const) {
      const list = s[side]
      const need = s.rates[side]
      const capacity = list.reduce((sum, i) => sum + i.throughput, 0)
      if (list.length === 0 || capacity >= need * 0.99) continue
      addLimit(rows, s.machine, side, list, need, capacity)
    }
  }
  return [...rows.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || a.side.localeCompare(b.side)
  )
}

function addLimit(
  rows: Map<string, InserterLimitRow>,
  machine: EntityLayout,
  side: 'input' | 'output',
  list: PlacedInserter[],
  need: number,
  capacity: number
): void {
  const quality = qualityOf(machine.entity.quality)
  const key = [machine.entity.name, quality, side].join('|')
  let row = rows.get(key)
  if (!row) {
    row = {
      name: machine.entity.name,
      ...(quality ? { quality } : {}),
      side,
      count: 0,
      indexes: [],
      need,
      capacity
    }
    rows.set(key, row)
  }
  row.count++
  row.indexes.push(machine.index, ...list.map((i) => i.e.index))
  if (capacity / need < row.capacity / row.need) {
    row.need = need
    row.capacity = capacity
  }
}

// ---------------------------------------------------------------- splitters

function splitters(db: PrototypeDb, layout: BlueprintLayout): SplitterRow[] {
  const rows = new Map<string, SplitterRow>()
  for (const e of layout.entities) {
    const type = db.entities[e.entity.name]?.type
    if (!type || !SPLITTER_TYPES.has(type)) continue
    const settings = splitterSettings(e)
    const key = [
      e.entity.name,
      settings.inputPriority,
      settings.outputPriority,
      settings.filter?.name,
      settings.filter?.quality
    ].join('|')
    let row = rows.get(key)
    if (!row) {
      row = { name: e.entity.name, ...settings, count: 0, indexes: [] }
      rows.set(key, row)
    }
    row.count++
    row.indexes.push(e.index)
  }
  return [...rows.values()].sort(
    (a, b) =>
      a.name.localeCompare(b.name) ||
      Number(!!a.inputPriority || !!a.outputPriority || !!a.filter) -
        Number(!!b.inputPriority || !!b.outputPriority || !!b.filter) ||
      b.count - a.count
  )
}

function splitterSettings(
  e: EntityLayout
): Pick<SplitterRow, 'inputPriority' | 'outputPriority' | 'filter'> {
  const side = (v: unknown): string | undefined => (v === 'left' || v === 'right' ? v : undefined)
  const input = side(e.entity['input_priority'])
  const output = side(e.entity['output_priority'])
  const raw = e.entity['filter']
  const filter =
    raw && typeof raw === 'object' && typeof (raw as Record<string, unknown>)['name'] === 'string'
      ? (raw as { name: string; quality?: unknown })
      : undefined
  const quality = typeof filter?.quality === 'string' ? qualityOf(filter.quality) : undefined
  return {
    ...(input ? { inputPriority: input } : {}),
    ...(output ? { outputPriority: output } : {}),
    ...(filter ? { filter: { name: filter.name, ...(quality ? { quality } : {}) } } : {})
  }
}

// ---------------------------------------------------------------- fluids

/**
 * Fluid segments: pipes, pipes to ground and storage tanks joined by their
 * connections (and pipe-to-ground pairs within reach). Pumps and machines
 * sit between segments.
 */
function fluidSegments(db: PrototypeDb, layout: BlueprintLayout): FluidSegment[] {
  const typeOf = (e: EntityLayout): string | undefined => db.entities[e.entity.name]?.type
  const members = layout.entities.filter((e) => SEGMENT_TYPES.has(typeOf(e) ?? ''))
  if (members.length === 0) return []
  const at = tileIndex(db, layout.entities)
  const sets = joinSegments(db, layout, members, at)
  const segments = new Map<number, Segment>()
  for (const e of members) addToSegment(segments, sets.find(e.index), e, typeOf(e))
  for (const e of layout.entities) {
    if (typeOf(e) === 'pump') addPump(db, segments, sets, e, joinedNeighbours(db, e, at, 'fluid'))
  }
  return [...segments.values()]
    .map(({ boxes, ...s }) => {
      const b = unionBoxes(boxes)!
      return { ...s, extent: Math.max(b.right - b.left, b.bottom - b.top) }
    })
    .sort((a, b) => b.indexes.length - a.indexes.length || a.indexes[0]! - b.indexes[0]!)
}

type Segment = FluidSegment & { boxes: Box[] }

/** Union of segment members joined by connections or by pipe-to-ground pairs within reach. */
function joinSegments(
  db: PrototypeDb,
  layout: BlueprintLayout,
  members: EntityLayout[],
  at: TileQuery
): UnionFind {
  const sets = new UnionFind(members.map((e) => e.index))
  for (const e of members) {
    for (const n of joinedNeighbours(db, e, at, 'fluid'))
      if (sets.has(n.index)) sets.union(e.index, n.index)
  }
  for (const line of undergroundLines(layout, (name) => db.entities[name]?.type)) {
    if (line.type !== 'pipe-to-ground') continue
    const max = db.entities[line.name]?.stats?.maxDistance ?? Infinity
    for (const p of line.pairs) if (p.distance <= max + 1e-6) sets.union(p.start.index, p.end.index)
  }
  return sets
}

function addToSegment(
  segments: Map<number, Segment>,
  root: number,
  e: EntityLayout,
  type: string | undefined
): void {
  let s = segments.get(root)
  if (!s) {
    s = { indexes: [], tanks: 0, extent: 0, pumps: [], pumpRate: 0, boxes: [] }
    segments.set(root, s)
  }
  s.indexes.push(e.index)
  s.boxes.push(e.box)
  if (type === 'storage-tank') s.tanks++
}

function addPump(
  db: PrototypeDb,
  segments: Map<number, Segment>,
  sets: UnionFind,
  pump: EntityLayout,
  neighbours: EntityLayout[]
): void {
  const rate = pumpRate(db, pump)
  for (const n of neighbours) {
    const s = sets.has(n.index) ? segments.get(sets.find(n.index)) : undefined
    if (!s || s.pumps.includes(pump.index)) continue
    s.pumps.push(pump.index)
    s.pumpRate = Math.max(s.pumpRate, rate)
  }
}

/** Units per second: `pumping_speed` per tick × 60 × the quality's default multiplier. */
export function pumpRate(db: PrototypeDb, e: EntityLayout): number {
  const speed = db.entities[e.entity.name]?.stats?.pumpingSpeed ?? 0
  return speed * 60 * qualityMultiplier(db.qualities[e.entity.quality ?? 'normal'], 'default')
}
