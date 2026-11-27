import { isJsonObject, type JsonObject, type JsonValue } from '../codec'

/**
 * 1.1 → 2.x entity settings (plan task 1.6, spec 02 § Version handling).
 *
 * Verified against the game's own upgrade (tests/corpus/legacy-1.1/upgraded,
 * checked by migrate-oracle.test.ts) unless marked ⚠ (those report a note):
 * - signals: `type: "item"` is the 2.x default and is omitted
 * - decider conditions → `conditions` / `outputs` / `else_outputs`
 * - constant combinator `filters` → `sections`
 * - `request_filters` (requester, buffer and storage chests) → `sections`
 * - item filters get `quality: "normal"` and `comparator: "="`; splitter `filter` becomes an object
 * - `circuit_enabled`: from the inserter mode of operation, from `circuit_enable_disable`,
 *   and on lamps, pumps and power switches that have a circuit condition
 * - roboport `read_logistics` → `read_items_mode`
 * - speaker `playback_globally` → `playback_mode`
 * - storage tank `temperature_signal` default (circuit-connected tanks only), artillery turret auto targeting,
 *   rolling stock `enable_logistics_while_moving: false` (1.1 behaviour made explicit)
 *
 * Defaults the game only writes out (`recipe_quality`, `import_from`, empty
 * request sections, …) are not added: an absent field means the same thing.
 */

export type Note = (message: string) => void

export interface SettingsContext {
  /** The 1.1 entity had circuit `connections` (before they became wires). */
  wired: boolean
  note: Note
}

const ITEM_QUALITY = { quality: 'normal', comparator: '=' } as const

/** Migrates the settings of one 1.1 entity in place (after renames). */
export function migrateEntitySettings(entity: JsonObject, { wired, note }: SettingsContext): void {
  for (const [key, value] of Object.entries(entity)) {
    if (key !== 'items') dropItemSignalTypes(value)
  }
  const name = typeof entity['name'] === 'string' ? entity['name'] : ''

  migrateFilters(entity)
  if (Array.isArray(entity['request_filters'])) {
    entity['request_filters'] = { sections: [section(entity['request_filters'].map(qualified))] }
  }
  migrateSpeaker(entity)
  migrateDefaults(entity, name, wired, note)

  const cb = entity['control_behavior']
  if (!isJsonObject(cb)) return
  migrateDecider(cb)
  migrateConstantCombinator(cb)
  migrateCircuitEnabled(cb, name, note)
  if (typeof cb['read_logistics'] === 'boolean') {
    if (cb['read_logistics'])
      note('Roboport "read logistics" was converted with an unverified mode.')
    // defines.control_behavior.roboport.read_items_mode: none = 0, logistics = 1.
    renameKey(cb, 'read_logistics', 'read_items_mode', cb['read_logistics'] ? 1 : 0)
  }
}

// ---------------------------------------------------------------------------
// Signals

const SIGNAL_KEYS = new Set(['type', 'name', 'quality'])

function isSignalId(obj: JsonObject): boolean {
  return (
    typeof obj['name'] === 'string' &&
    typeof obj['type'] === 'string' &&
    Object.keys(obj).every((k) => SIGNAL_KEYS.has(k))
  )
}

/** Removes `type: "item"` from every signal id inside `value` (2.x omits the default type). */
export function dropItemSignalTypes(value: JsonValue | undefined): void {
  if (Array.isArray(value)) {
    value.forEach(dropItemSignalTypes)
  } else if (isJsonObject(value)) {
    if (isSignalId(value)) {
      if (value['type'] === 'item') delete value['type']
      return
    }
    Object.values(value).forEach(dropItemSignalTypes)
  }
}

// ---------------------------------------------------------------------------
// Filters

/** Adds `quality: "normal"` and `comparator: "="` after `name`, as the game does: 1.1 items were all normal. */
function qualified(filter: JsonValue): JsonValue {
  if (!isJsonObject(filter) || typeof filter['name'] !== 'string' || 'quality' in filter) {
    return filter
  }
  const out: JsonObject = {}
  for (const [key, value] of Object.entries(filter)) {
    out[key] = value
    if (key === 'name') Object.assign(out, ITEM_QUALITY)
  }
  return out
}

function section(filters: JsonValue[]): JsonObject {
  return filters.length > 0 ? { index: 1, filters } : { index: 1 }
}

function migrateFilters(entity: JsonObject): void {
  // Inserter and loader filters.
  if (Array.isArray(entity['filters'])) entity['filters'] = entity['filters'].map(qualified)
  // Cargo wagon inventory filters.
  const inventory = entity['inventory']
  if (isJsonObject(inventory) && Array.isArray(inventory['filters'])) {
    inventory['filters'] = inventory['filters'].map(qualified)
  }
  // Splitter filter: an item name in 1.1, an item filter in 2.x.
  if (typeof entity['filter'] === 'string') {
    entity['filter'] = { name: entity['filter'], ...ITEM_QUALITY }
  }
}

// ---------------------------------------------------------------------------
// Combinators

function migrateDecider(cb: JsonObject): void {
  const old = cb['decider_conditions']
  if (!isJsonObject(old) || 'conditions' in old) return
  const {
    first_signal,
    second_signal,
    constant,
    comparator,
    output_signal,
    copy_count_from_input,
    ...rest
  } = old
  // 2.x omits the defaults: comparator "<" and constant 0.
  const condition: JsonObject = {}
  if (first_signal !== undefined) condition['first_signal'] = first_signal
  if (second_signal !== undefined) condition['second_signal'] = second_signal
  if (constant !== undefined && constant !== 0) condition['constant'] = constant
  if (comparator !== undefined && comparator !== '<') condition['comparator'] = comparator
  // 2.x omits copy_count_from_input when it is true (the default).
  const outputs: JsonObject[] = []
  if (output_signal !== undefined) {
    const output: JsonObject = { signal: output_signal }
    if (copy_count_from_input === false) output['copy_count_from_input'] = false
    outputs.push(output)
  }
  cb['decider_conditions'] = { conditions: [condition], outputs, else_outputs: [], ...rest }
}

function migrateConstantCombinator(cb: JsonObject): void {
  const filters = cb['filters']
  if (!Array.isArray(filters)) return
  const converted: JsonValue[] = []
  for (const filter of filters) {
    if (!isJsonObject(filter)) continue
    const { signal, ...rest } = filter
    if (!isJsonObject(signal)) {
      converted.push(filter)
      continue
    }
    // { signal: { type, name }, count, index } → { index, type, name, quality, comparator, count }
    const out: JsonObject = {}
    if (rest['index'] !== undefined) out['index'] = rest['index']
    Object.assign(out, signal, ITEM_QUALITY)
    for (const [key, value] of Object.entries(rest)) if (key !== 'index') out[key] = value
    converted.push(out)
  }
  renameKey(cb, 'filters', 'sections', { sections: [section(converted)] })
}

// ---------------------------------------------------------------------------
// circuit_enabled

/** Entities whose 1.1 circuit condition always enabled or disabled them. */
const CONDITION_ENABLED = new Set(['small-lamp', 'pump', 'offshore-pump', 'power-switch'])
const UNVERIFIED_CONDITION_ENABLED = new Set(['offshore-pump'])

/** 1.1 `defines.control_behavior.inserter.circuit_mode_of_operation`. */
const InserterMode = {
  EnableDisable: 0,
  SetFilters: 1,
  ReadHandContents: 2,
  None: 3,
  SetStackSize: 4
}

/** Vanilla inserters are `inserter` and `*-inserter`; the same holds for most modded ones. */
const isInserter = (name: string): boolean => name === 'inserter' || name.endsWith('-inserter')

function migrateCircuitEnabled(cb: JsonObject, name: string, note: Note): void {
  // Belts, train stops, mining drills, …: an explicit flag.
  if (typeof cb['circuit_enable_disable'] === 'boolean') {
    const enabled = cb['circuit_enable_disable']
    delete cb['circuit_enable_disable']
    if (enabled) prependKey(cb, 'circuit_enabled', true)
  }

  if (isInserter(name)) {
    const mode = cb['circuit_mode_of_operation'] ?? InserterMode.EnableDisable
    delete cb['circuit_mode_of_operation']
    switch (mode) {
      case InserterMode.EnableDisable:
        prependKey(cb, 'circuit_enabled', true)
        break
      case InserterMode.SetFilters:
        cb['circuit_set_filters'] = true
        break
      case InserterMode.SetStackSize:
        cb['circuit_set_stack_size'] = true
        note(`"${name}" set-stack-size mode was converted, unverified.`)
        break
      case InserterMode.None:
        break
      case InserterMode.ReadHandContents:
        // Superseded in 1.1 by the circuit_read_hand_contents flag.
        note(`"${name}" read-hand-contents mode was dropped, unverified.`)
        break
      default:
        cb['circuit_mode_of_operation'] = mode
        note(`"${name}" has an unknown circuit mode; it was kept as-is.`)
    }
    return
  }

  if (CONDITION_ENABLED.has(name) && 'circuit_condition' in cb && !('circuit_enabled' in cb)) {
    prependKey(cb, 'circuit_enabled', true)
    if (UNVERIFIED_CONDITION_ENABLED.has(name)) {
      note(`"${name}" circuit condition was converted, unverified.`)
    }
  }
}

// ---------------------------------------------------------------------------
// Other settings

function migrateSpeaker(entity: JsonObject): void {
  const parameters = entity['parameters']
  if (isJsonObject(parameters) && typeof parameters['playback_globally'] === 'boolean') {
    renameKey(
      parameters,
      'playback_globally',
      'playback_mode',
      parameters['playback_globally'] ? 'global' : 'local'
    )
  }
}

const ROLLING_STOCK = new Set(['locomotive', 'cargo-wagon', 'fluid-wagon', 'artillery-wagon'])
const VERIFIED_ROLLING_STOCK = new Set(['locomotive', 'cargo-wagon'])

/** Settings 2.x added whose 1.1 behaviour differs from what an absent field may mean. */
function migrateDefaults(entity: JsonObject, name: string, wired: boolean, note: Note): void {
  if (name === 'storage-tank' && wired) {
    // The game turns on the temperature output (signal T) on upgraded tanks that are
    // connected to a circuit network.
    const cb = isJsonObject(entity['control_behavior']) ? entity['control_behavior'] : {}
    if (cb['temperature_signal'] === undefined) {
      cb['temperature_signal'] = { type: 'virtual', name: 'signal-T' }
    }
    entity['control_behavior'] = cb
  }
  if (name === 'artillery-turret' && entity['artillery_auto_targeting'] === undefined) {
    entity['artillery_auto_targeting'] = true
  }
  if (ROLLING_STOCK.has(name) && entity['enable_logistics_while_moving'] === undefined) {
    // 1.1 trains had no logistics; the game writes the setting off on upgraded trains.
    entity['enable_logistics_while_moving'] = false
    if (!VERIFIED_ROLLING_STOCK.has(name)) {
      note(`"${name}" got enable_logistics_while_moving: false, unverified.`)
    }
  }
}

// ---------------------------------------------------------------------------
// Key order helpers (2.x key order matches the game's export where it is cheap to)

/** Replaces `from` with `to` at the same position. */
function renameKey(obj: JsonObject, from: string, to: string, value: JsonValue): void {
  const entries = Object.entries(obj)
  for (const key of Object.keys(obj)) delete obj[key]
  for (const [key, v] of entries) {
    if (key === from) obj[to] = value
    else obj[key] = v
  }
}

function prependKey(obj: JsonObject, key: string, value: JsonValue): void {
  const entries = Object.entries(obj).filter(([k]) => k !== key)
  for (const k of Object.keys(obj)) delete obj[k]
  obj[key] = value
  for (const [k, v] of entries) obj[k] = v
}
