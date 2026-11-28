import type { BlueprintLayout, EntityLayout } from '../model/layout'
import { WireConnectorId, wireNetworks, type WireEnd } from '../model/wires'
import type { PrototypeLookup } from '../prototypes'

/**
 * Circuit networks (docs/spec/06-analysis.md § 5): red and green networks
 * with their members and the signals they may carry (static: constant
 * combinators, combinator outputs and entity readers), and each wired
 * entity's circuit settings as readable lines. Not a simulator.
 *
 * Lines are Factorio rich text (`[item=iron-plate] > 1000`), so the UI shows
 * icons through the rich text parser and the text reads as in game.
 */

export type CircuitColor = 'red' | 'green'

/** A signal as blueprints write it (`type` absent = item). */
export interface CircuitSignal {
  type: string
  name: string
  quality?: string
}

/** A signal a network may carry, or a dynamic reading (`label`, e.g. `contents`). */
export interface CarriedSignal {
  signal?: CircuitSignal
  /** For readings without one fixed signal: `contents`, `hand contents`, `input signals`, … */
  label?: string
  /** Sum of the constant combinators' values, when only constant combinators send it. */
  count?: number
  /** Entities that send it (layout indexes). */
  sources: number[]
}

export interface CircuitNetwork {
  color: CircuitColor
  /** 1-based number per colour, in list order. */
  id: number
  /** Entities on the network (layout indexes, sorted). */
  members: number[]
  /** Entities that read it: combinator inputs, conditions and set-from-signal settings. */
  readers: number[]
  /** Indexes into the blueprint's `wires`. */
  wires: number[]
  /** Specific signals first (sorted by type and name), then dynamic readings. */
  signals: CarriedSignal[]
}

/** Entities with the same prototype and the same settings, grouped. */
export interface CircuitEntityRow {
  name: string
  /** Readable settings, one rich-text line each. */
  lines: string[]
  count: number
  indexes: number[]
}

export interface CircuitReport {
  /** Red networks, then green; each by member count (largest first), then first member. */
  networks: CircuitNetwork[]
  /** Combinators first, then other entities by name. */
  entities: CircuitEntityRow[]
}

const COMBINATOR_TYPES: ReadonlySet<string> = new Set([
  'decider-combinator',
  'arithmetic-combinator',
  'selector-combinator'
])

/** Types whose contents are read by default (`read_contents` defaults to true). */
const CONTENT_READERS: ReadonlySet<string> = new Set([
  'container',
  'logistic-container',
  'infinity-container',
  'proxy-container',
  'linked-container',
  'cargo-landing-pad',
  'space-platform-hub'
])

/** Combinators with input and output connectors, or the constant combinator. */
const anyCombinator = (type: string | undefined): boolean =>
  type !== undefined && (COMBINATOR_TYPES.has(type) || type === 'constant-combinator')

const LOGISTIC_CONDITION = 'enabled when the logistic network has'

const WILDCARDS: ReadonlySet<string> = new Set([
  'signal-each',
  'signal-everything',
  'signal-anything'
])

type Settings = Readonly<Record<string, unknown>>

const record = (v: unknown): Settings | undefined =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Settings) : undefined

const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

const flag = (o: Settings, key: string, fallback = false): boolean =>
  typeof o[key] === 'boolean' ? o[key] : fallback

const integer = (v: unknown, fallback: number): number => (typeof v === 'number' ? v : fallback)

/** A `SignalID`, or undefined when absent or nameless. */
export function circuitSignal(v: unknown): CircuitSignal | undefined {
  const o = record(v)
  if (!o || typeof o['name'] !== 'string' || o['name'] === '') return undefined
  const type = typeof o['type'] === 'string' ? o['type'] : 'item'
  const quality = typeof o['quality'] === 'string' ? o['quality'] : undefined
  return { type, name: o['name'], ...(quality ? { quality } : {}) }
}

/** Rich text tag per signal type; other types are written as plain names. */
const TAGS: Readonly<Record<string, string>> = {
  item: 'item',
  fluid: 'fluid',
  virtual: 'virtual-signal',
  entity: 'entity',
  recipe: 'recipe',
  quality: 'quality',
  'space-location': 'space-location'
}

/** Names that cannot break out of a tag (blueprint data is untrusted). */
const SAFE_NAME = /^[\w.-]+$/

/** The signal as a rich text icon tag, e.g. `[item=iron-plate,quality=rare]`. */
export function signalTag(s: CircuitSignal | undefined): string {
  if (!s) return '(none)'
  const tag = TAGS[s.type]
  if (!tag || !SAFE_NAME.test(s.name)) return s.name
  const quality =
    s.quality && s.quality !== 'normal' && SAFE_NAME.test(s.quality) ? `,quality=${s.quality}` : ''
  return `[${tag}=${s.name}${quality}]`
}

/** `red` / `green` when a `CircuitNetworkSelection` reads only one wire colour, else empty. */
function networksName(v: unknown): string {
  const o = record(v)
  if (!o) return ''
  const red = flag(o, 'red', true)
  const green = flag(o, 'green', true)
  if (red && green) return ''
  if (red) return 'red'
  return green ? 'green' : 'no network'
}

function networksSuffix(v: unknown): string {
  const name = networksName(v)
  return name ? ` (${name})` : ''
}

const COMPARATORS: Readonly<Record<string, string>> = { '>=': '≥', '<=': '≤', '!=': '≠' }

/** `[signal-A] > 1000`; comparator `<` and constant 0 are the defaults. */
export function conditionText(v: unknown): string {
  const c = record(v) ?? {}
  const first =
    signalTag(circuitSignal(c['first_signal'])) + networksSuffix(c['first_signal_networks'])
  const raw = typeof c['comparator'] === 'string' ? c['comparator'] : '<'
  const second = circuitSignal(c['second_signal'])
  const right = second
    ? signalTag(second) + networksSuffix(c['second_signal_networks'])
    : String(integer(c['constant'], 0))
  return `${first} ${COMPARATORS[raw] ?? raw} ${right}`
}

/** Decider conditions: `and` binds tighter than `or` (the default `compare_type`). */
function deciderConditions(conditions: unknown[]): string {
  const groups: string[][] = []
  for (const [i, c] of conditions.entries()) {
    const type = record(c)?.['compare_type']
    if (i === 0 || type !== 'and') groups.push([])
    groups.at(-1)!.push(conditionText(c))
  }
  return groups.length ? groups.map((g) => g.join(' and ')).join(' or ') : 'always'
}

function deciderOutputs(outputs: unknown[]): string {
  const parts = outputs.map((v) => {
    const o = record(v) ?? {}
    const tag = signalTag(circuitSignal(o['signal']))
    if (!flag(o, 'copy_count_from_input', true)) return `${tag} = ${integer(o['constant'], 1)}`
    const from = networksName(o['networks'])
    return from ? `${tag} (input count from ${from})` : `${tag} (input count)`
  })
  return parts.length ? parts.join(', ') : 'nothing'
}

function deciderLines(cb: Settings): string[] {
  const p = record(cb['decider_conditions']) ?? {}
  const lines = [
    `if ${deciderConditions(list(p['conditions']))} then ${deciderOutputs(list(p['outputs']))}`
  ]
  const otherwise = list(p['else_outputs'])
  if (otherwise.length) lines.push(`else ${deciderOutputs(otherwise)}`)
  return lines
}

const OPERATIONS: Readonly<Record<string, string>> = { '*': '×', '/': '÷' }

function operand(p: Settings, side: 'first' | 'second'): string {
  const s = circuitSignal(p[`${side}_signal`])
  return s
    ? signalTag(s) + networksSuffix(p[`${side}_signal_networks`])
    : String(integer(p[`${side}_constant`], 0))
}

function arithmeticLines(cb: Settings): string[] {
  const p = record(cb['arithmetic_conditions']) ?? {}
  const op = typeof p['operation'] === 'string' ? p['operation'] : '*'
  const out = signalTag(circuitSignal(p['output_signal']))
  return [`${operand(p, 'first')} ${OPERATIONS[op] ?? op} ${operand(p, 'second')} → ${out}`]
}

function selectLine(p: Settings): string {
  const which = flag(p, 'select_max', true) ? 'largest' : 'smallest'
  const index = circuitSignal(p['index_signal'])
  const at = index ? signalTag(index) : String(integer(p['index_constant'], 0))
  return `select the ${which} input at index ${at}`
}

function qualityFilterLine(p: Settings): string {
  const q = record(p['quality_filter']) ?? {}
  const cmp = typeof q['comparator'] === 'string' ? q['comparator'] : '='
  const quality = typeof q['quality'] === 'string' ? q['quality'] : 'any'
  return `pass inputs with quality ${COMPARATORS[cmp] ?? cmp} ${quality}`
}

function qualityTransferLine(p: Settings): string {
  const source = circuitSignal(p['quality_source_signal'])
  const fixed = record(p['quality_source_static'])?.['name']
  let from = 'the inputs'
  if (flag(p, 'select_quality_from_signal') && source) from = signalTag(source)
  else if (typeof fixed === 'string') from = fixed
  return `quality from ${from} → ${signalTag(circuitSignal(p['quality_destination_signal']))}`
}

function selectorLines(p: Settings): string[] {
  const op = typeof p['operation'] === 'string' ? p['operation'] : 'select'
  switch (op) {
    case 'select':
      return [selectLine(p)]
    case 'count':
      return [`count input signals → ${signalTag(circuitSignal(p['count_signal']))}`]
    case 'random': {
      const ticks = integer(p['random_update_interval'], 0)
      return [ticks > 0 ? `random input every ${ticks} ticks` : 'random input']
    }
    case 'stack-size':
      return ['stack sizes of input items']
    case 'rocket-capacity':
      return ['rocket capacities of input items']
    case 'quality-filter':
      return [qualityFilterLine(p)]
    case 'quality-select':
      return [`${flag(p, 'select_highest_quality', true) ? 'highest' : 'lowest'} input quality`]
    case 'quality-transfer':
      return [qualityTransferLine(p)]
    case 'time':
      return ['game time']
    default:
      return [op]
  }
}

interface SectionFilter {
  signal: CircuitSignal
  count: number
}

/** Filters of the active sections (a section's `active` defaults to true). */
function constantFilters(cb: Settings): SectionFilter[] {
  if (!flag(cb, 'is_on', true)) return []
  const out: SectionFilter[] = []
  for (const s of list(record(cb['sections'])?.['sections'])) {
    const section = record(s)
    if (!section || !flag(section, 'active', true)) continue
    for (const f of list(section['filters'])) {
      const signal = circuitSignal(f)
      if (signal) out.push({ signal, count: integer(record(f)?.['count'], 0) })
    }
  }
  return out
}

const MAX_CONSTANTS = 12

function constantLines(cb: Settings): string[] {
  const filters = constantFilters(cb)
  const shown = filters.slice(0, MAX_CONSTANTS).map((f) => `${signalTag(f.signal)} = ${f.count}`)
  if (filters.length > MAX_CONSTANTS) shown.push(`… ${filters.length - MAX_CONSTANTS} more`)
  const text = shown.length ? shown.join(', ') : 'no signals'
  return [flag(cb, 'is_on', true) ? text : 'switched off']
}

/** A condition that is active when one of its flags is set. */
interface ConditionRule {
  flags: readonly string[]
  field: string
  text: string
}

const CONDITIONS: readonly ConditionRule[] = [
  {
    flags: ['circuit_enabled', 'circuit_enable_disable', 'circuit_condition_enabled'],
    field: 'circuit_condition',
    text: 'enabled when'
  },
  { flags: ['circuit_close_signal'], field: 'circuit_condition', text: 'closes when' },
  { flags: ['circuit_open_gate'], field: 'circuit_condition', text: 'opens when' },
  {
    flags: ['connect_to_logistic_network'],
    field: 'logistic_condition',
    text: LOGISTIC_CONDITION
  },
  { flags: ['enable_harvesting_condition'], field: 'harvesting_condition', text: 'harvests when' },
  { flags: ['enable_planting_condition'], field: 'planting_condition', text: 'plants when' },
  {
    flags: ['set_ignore_unlisted_targets'],
    field: 'ignore_unlisted_targets_condition',
    text: 'ignores unlisted targets when'
  }
]

/** Settings that take values from the network. */
interface SetRule {
  flag: string
  text: string
  signal?: string
}

const SETS: readonly SetRule[] = [
  { flag: 'set_recipe', text: 'sets its recipe from signals' },
  { flag: 'set_requests', text: 'sets requests from signals' },
  { flag: 'circuit_set_filters', text: 'sets filters from signals' },
  { flag: 'set_filter', text: 'sets its filter from signals' },
  { flag: 'set_research', text: 'sets research from signals' },
  { flag: 'set_priority_list', text: 'sets target priorities from signals' },
  {
    flag: 'circuit_set_stack_size',
    text: 'sets hand size from',
    signal: 'stack_control_input_signal'
  },
  { flag: 'set_trains_limit', text: 'sets the train limit from', signal: 'trains_limit_signal' },
  { flag: 'set_priority', text: 'sets priority from', signal: 'priority_signal' },
  { flag: 'use_colors', text: 'sets its colour from signals' }
]

/** Readings an entity sends: a label, or named signal fields. */
interface ReadRule {
  flag: string
  label: string
  signals?: readonly string[]
}

const READS: readonly ReadRule[] = [
  { flag: 'read_contents', label: 'contents' },
  { flag: 'circuit_read_contents', label: 'contents' },
  { flag: 'circuit_read_resources', label: 'resources' },
  { flag: 'read_fuel', label: 'fuel' },
  { flag: 'read_ingredients', label: 'ingredients' },
  { flag: 'read_ammo', label: 'ammo' },
  { flag: 'read_from_train', label: 'train contents' },
  { flag: 'circuit_read_transfers', label: 'transfers' },
  { flag: 'read_research_cost', label: 'research cost' },
  { flag: 'read_items_mode', label: 'logistic network contents' },
  { flag: 'read_recipe_finished', label: 'recipe finished', signals: ['recipe_finished_signal'] },
  { flag: 'read_working', label: 'working', signals: ['working_signal'] },
  { flag: 'read_temperature', label: 'temperature', signals: ['temperature_signal'] },
  { flag: 'read_charge', label: 'charge', signals: ['output_signal'] },
  { flag: 'circuit_read_sensor', label: 'nearby units', signals: ['output_signal'] },
  { flag: 'read_stopped_train', label: 'stopped train', signals: ['train_stopped_signal'] },
  { flag: 'read_trains_count', label: 'trains on the way', signals: ['trains_count_signal'] },
  { flag: 'read_empty_slots', label: 'empty slots', signals: ['empty_slots_signal'] },
  { flag: 'read_launched', label: 'launched rockets', signals: ['launched_signal'] },
  { flag: 'read_damage_taken', label: 'damage taken', signals: ['damage_taken_signal'] },
  { flag: 'read_speed', label: 'speed', signals: ['speed_signal'] },
  {
    flag: 'read_technology_level',
    label: 'technology level',
    signals: ['technology_level_signal']
  },
  {
    flag: 'circuit_read_signal',
    label: 'signal state',
    signals: [
      'red_output_signal',
      'orange_output_signal',
      'green_output_signal',
      'blue_output_signal'
    ]
  },
  {
    flag: 'read_robot_stats',
    label: 'robot counts',
    signals: [
      'available_logistic_output_signal',
      'total_logistic_output_signal',
      'available_construction_output_signal',
      'total_construction_output_signal',
      'roboport_count_output_signal'
    ]
  }
]

/** What one entity does on the circuit network. */
interface Behaviour {
  lines: string[]
  /** Sent on its circuit connectors (combinators: on the output connectors). */
  sends: CarriedSignal[]
  /** Uses the network's values (conditions, set-from-signal settings, combinator inputs). */
  reads: boolean
}

/** Whether a read flag is on; contents default to on for containers, charge for accumulators. */
function readOn(cb: Settings, rule: ReadRule, type: string | undefined): boolean {
  const v = cb[rule.flag]
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0 // roboport read_items_mode
  if (rule.flag === 'read_contents') return type !== undefined && CONTENT_READERS.has(type)
  return rule.flag === 'read_charge' && type === 'accumulator'
}

/** One reading: its line, and what it sends (its named signals, else the label). */
function addReading(
  out: Behaviour,
  label: string,
  signals: readonly CircuitSignal[],
  index: number
): void {
  if (signals.length === 0) {
    out.lines.push(`outputs ${label}`)
    out.sends.push({ label, sources: [index] })
    return
  }
  out.lines.push(`outputs ${label} as ${signals.map(signalTag).join(', ')}`)
  for (const signal of signals) out.sends.push({ signal, sources: [index] })
}

function readerBehaviour(cb: Settings, type: string | undefined, index: number): Behaviour {
  const out: Behaviour = { lines: [], sends: [], reads: false }
  for (const rule of READS) {
    if (!readOn(cb, rule, type)) continue
    const signals = (rule.signals ?? [])
      .map((f) => circuitSignal(cb[f]))
      .filter((s) => s !== undefined)
    addReading(out, rule.label, signals, index)
  }
  if (flag(cb, 'circuit_read_hand_contents'))
    addReading(out, type === 'inserter' ? 'hand contents' : 'belt contents', [], index)
  if (type === 'storage-tank' && integer(cb['circuit_mode_of_operation'], 0) === 0)
    addReading(out, 'contents', [], index)
  return out
}

function conditionLines(cb: Settings, type: string | undefined): string[] {
  const lines: string[] = []
  for (const rule of CONDITIONS)
    if (rule.flags.some((f) => flag(cb, f)) && cb[rule.field] !== undefined)
      lines.push(`${rule.text} ${conditionText(cb[rule.field])}`)
  if (type === 'programmable-speaker' && cb['circuit_condition'] !== undefined)
    lines.push(`plays when ${conditionText(cb['circuit_condition'])}`)
  if (type === 'splitter') lines.push(...splitterLines(cb))
  if (type === 'display-panel') lines.push(...displayPanelLines(cb))
  return lines
}

function splitterLines(cb: Settings): string[] {
  const lines: string[] = []
  for (const side of ['input', 'output'] as const) {
    if (!flag(cb, `set_${side}_side`)) continue
    const left = conditionText(cb[`${side}_left_condition`])
    const right = conditionText(cb[`${side}_right_condition`])
    lines.push(`${side} priority left when ${left}, right when ${right}`)
  }
  return lines
}

function displayPanelLines(cb: Settings): string[] {
  return list(cb['parameters']).map((v) => {
    const p = record(v) ?? {}
    const icon = circuitSignal(p['icon'])
    const text = typeof p['text'] === 'string' ? p['text'] : ''
    const shows = [icon ? signalTag(icon) : '', text].filter(Boolean).join(' ')
    return `shows ${shows || 'nothing'} when ${conditionText(p['condition'])}`
  })
}

function setLines(cb: Settings): string[] {
  const lines: string[] = []
  for (const rule of SETS) {
    if (!flag(cb, rule.flag)) continue
    const signal = rule.signal ? circuitSignal(cb[rule.signal]) : undefined
    lines.push(rule.signal ? `${rule.text} ${signalTag(signal)}` : rule.text)
  }
  return lines
}

/** Signals a combinator sends on its output: wildcards become `input signals`. */
function outputSignal(s: CircuitSignal | undefined, index: number): CarriedSignal | undefined {
  if (!s) return undefined
  if (s.type === 'virtual' && WILDCARDS.has(s.name))
    return { label: 'input signals', sources: [index] }
  return { signal: s, sources: [index] }
}

function combinatorSends(cb: Settings, type: string, index: number): CarriedSignal[] {
  const signals: (CarriedSignal | undefined)[] = []
  if (type === 'decider-combinator') {
    const p = record(cb['decider_conditions']) ?? {}
    for (const o of [...list(p['outputs']), ...list(p['else_outputs'])])
      signals.push(outputSignal(circuitSignal(record(o)?.['signal']), index))
  } else if (type === 'arithmetic-combinator') {
    const p = record(cb['arithmetic_conditions']) ?? {}
    signals.push(outputSignal(circuitSignal(p['output_signal']), index))
  } else {
    signals.push(...selectorSends(cb, index))
  }
  return signals.filter((s) => s !== undefined)
}

function selectorSends(cb: Settings, index: number): CarriedSignal[] {
  const op = typeof cb['operation'] === 'string' ? cb['operation'] : 'select'
  const named = (field: string): CarriedSignal[] => {
    const s = circuitSignal(cb[field])
    return s ? [{ signal: s, sources: [index] }] : []
  }
  if (op === 'count') return named('count_signal')
  if (op === 'quality-transfer') return named('quality_destination_signal')
  if (op === 'time')
    return ['game_tick_signal', 'day_tick_signal', 'day_length_signal'].flatMap(named)
  return [{ label: 'input signals', sources: [index] }]
}

/** An entity's circuit behaviour from its `control_behavior` and prototype type. */
export function circuitBehaviour(e: EntityLayout, type: string | undefined): Behaviour {
  const cb = record(e.entity['control_behavior']) ?? {}
  const index = e.index
  switch (type) {
    case 'decider-combinator':
      return { lines: deciderLines(cb), sends: combinatorSends(cb, type, index), reads: true }
    case 'arithmetic-combinator':
      return { lines: arithmeticLines(cb), sends: combinatorSends(cb, type, index), reads: true }
    case 'selector-combinator':
      return { lines: selectorLines(cb), sends: combinatorSends(cb, type, index), reads: true }
    case 'constant-combinator':
      return {
        lines: constantLines(cb),
        sends: constantFilters(cb).map((f) => ({
          signal: f.signal,
          count: f.count,
          sources: [index]
        })),
        reads: false
      }
    default: {
      const uses = [...conditionLines(cb, type), ...setLines(cb)]
      const reader = readerBehaviour(cb, type, index)
      return { lines: [...uses, ...reader.lines], sends: reader.sends, reads: uses.length > 0 }
    }
  }
}

/** Normal quality and no quality are the same signal. */
const signalKey = (s: CarriedSignal): string => {
  if (!s.signal) return `~${s.label ?? ''}`
  const { type, name, quality } = s.signal
  return `${type}:${name}:${quality === 'normal' ? '' : (quality ?? '')}`
}

/** Merges sends into a network's signal list; counts add up while every source is a constant. */
class SignalSet {
  private readonly byKey = new Map<string, CarriedSignal & { dynamic: boolean }>()

  add(s: CarriedSignal): void {
    const key = signalKey(s)
    const known = this.byKey.get(key)
    if (!known) {
      this.byKey.set(key, { ...s, sources: [...s.sources], dynamic: s.count === undefined })
      return
    }
    for (const i of s.sources) if (!known.sources.includes(i)) known.sources.push(i)
    if (s.count === undefined) known.dynamic = true
    else known.count = (known.count ?? 0) + s.count
  }

  list(): CarriedSignal[] {
    const out = [...this.byKey.entries()]
      .sort(([a], [b]) => (a < b ? -1 : Number(a > b)))
      .map(([, { dynamic, count, ...s }]) => (dynamic || count === undefined ? s : { ...s, count }))
    for (const s of out) s.sources.sort((a, b) => a - b)
    return out
  }
}

const isOutputConnector = (connector: number): boolean =>
  connector === WireConnectorId.CombinatorOutputRed ||
  connector === WireConnectorId.CombinatorOutputGreen

/** Whether an entity's `output_networks` / `input_networks` include the colour (default both). */
function onColour(cb: Settings, field: string, color: CircuitColor): boolean {
  const o = record(cb[field])
  return !o || flag(o, color, true)
}

interface Member {
  layout: EntityLayout
  type: string | undefined
  behaviour: Behaviour
}

/**
 * Whether an entity sends to and reads from the network at this end: a
 * combinator sends on its output connectors and reads on its input ones;
 * other entities follow `output_networks` / `input_networks`.
 */
function endRole(m: Member, end: WireEnd, color: CircuitColor): { sends: boolean; reads: boolean } {
  if (m.type !== undefined && COMBINATOR_TYPES.has(m.type)) {
    const output = isOutputConnector(end.connector)
    return { sends: output, reads: !output }
  }
  const cb = record(m.layout.entity['control_behavior']) ?? {}
  return {
    sends: onColour(cb, 'output_networks', color),
    reads: onColour(cb, 'input_networks', color)
  }
}

function buildNetwork(
  color: CircuitColor,
  ends: readonly WireEnd[],
  members: ReadonlyMap<number, Member>
): Omit<CircuitNetwork, 'id' | 'wires'> {
  const indexes = new Set<number>()
  const readers = new Set<number>()
  const signals = new SignalSet()
  for (const end of ends) {
    const m = members.get(end.entity)
    if (!m) continue
    const index = m.layout.index
    indexes.add(index)
    const { sends, reads } = endRole(m, end, color)
    if (sends) for (const s of m.behaviour.sends) signals.add(s)
    if (reads && m.behaviour.reads) readers.add(index)
  }
  return {
    color,
    members: [...indexes].sort((a, b) => a - b),
    readers: [...readers].sort((a, b) => a - b),
    signals: signals.list()
  }
}

function networksOf(
  layout: BlueprintLayout,
  color: CircuitColor,
  members: ReadonlyMap<number, Member>
): CircuitNetwork[] {
  const groups = wireNetworks(layout.wires, color)
  const groupOf = new Map<string, number>()
  for (const [g, ends] of groups.entries())
    for (const end of ends) groupOf.set(`${end.entity}:${end.connector}`, g)
  const wires = groups.map((): number[] => [])
  for (const w of layout.wires) {
    if (w.color !== color) continue
    const g = groupOf.get(`${w.a.entity}:${w.a.connector}`)
    if (g !== undefined) wires[g]!.push(w.index)
  }
  return groups
    .map((ends, g) => ({ ...buildNetwork(color, ends, members), wires: wires[g]!, id: 0 }))
    .filter((n) => n.members.length > 0)
    .sort((a, b) => b.members.length - a.members.length || a.members[0]! - b.members[0]!)
    .map((n, i) => ({ ...n, id: i + 1 }))
}

/** Entity rows: combinators first, then by name, then by text. */
function entityRows(members: Iterable<Member>): CircuitEntityRow[] {
  const rows = new Map<string, { row: CircuitEntityRow; combinator: boolean; text: string }>()
  for (const m of members) {
    const { lines } = m.behaviour
    if (lines.length === 0) continue
    const name = m.layout.entity.name
    const text = lines.join('\n')
    const known = rows.get(`${name}\n${text}`)
    if (known) {
      known.row.count++
      known.row.indexes.push(m.layout.index)
    } else {
      const row = { name, lines, count: 1, indexes: [m.layout.index] }
      rows.set(`${name}\n${text}`, { row, combinator: anyCombinator(m.type), text })
    }
  }
  return [...rows.values()]
    .sort(
      (a, b) =>
        Number(b.combinator) - Number(a.combinator) ||
        a.row.name.localeCompare(b.row.name) ||
        a.text.localeCompare(b.text)
    )
    .map((r) => r.row)
}

/**
 * Circuit networks and settings. Only entities on a red or green wire, plus
 * combinators and entities that use the logistic network, are described.
 * Works without game data (prototype types come from the lookup).
 */
export function circuits(layout: BlueprintLayout, lookup: PrototypeLookup): CircuitReport {
  const wired = new Set<number>()
  for (const w of layout.wires)
    if (w.color === 'red' || w.color === 'green') {
      wired.add(w.a.entity)
      wired.add(w.b.entity)
    }
  const members = new Map<number, Member>()
  const described: Member[] = []
  for (const e of layout.entities) {
    const type = lookup(e.entity.name)?.type
    const cb = record(e.entity['control_behavior'])
    const onWire = wired.has(e.entity.entity_number)
    const combinator = anyCombinator(type)
    if (!onWire && !combinator && !(cb && flag(cb, 'connect_to_logistic_network'))) continue
    const behaviour = circuitBehaviour(e, type)
    // Off the wires only the logistic condition does anything.
    if (!onWire && !combinator)
      behaviour.lines = behaviour.lines.filter((l) => l.startsWith(LOGISTIC_CONDITION))
    const m: Member = { layout: e, type, behaviour }
    described.push(m)
    if (onWire) members.set(e.entity.entity_number, m)
  }
  return {
    networks: [...networksOf(layout, 'red', members), ...networksOf(layout, 'green', members)],
    entities: entityRows(described)
  }
}
