import {
  isJsonObject,
  packVersion,
  unpackVersion,
  type BlueprintEnvelope,
  type JsonObject,
  type JsonValue
} from '../codec'
import { walk, type BookPath } from '../model/book'
import { WireConnectorId } from '../model/wires'
import { renameFrom1_1 } from './renames'

/**
 * Migrates a 1.x blueprint envelope to the 2.x format.
 * See docs/spec/02-blueprint-format.md § Version handling and plan task 1.5.
 *
 * Certain (from the game's migration files or confirmed formats):
 * - prototype renames (renames.ts)
 * - 8-way → 16-way directions
 * - per-entity `connections` / `neighbours` → top-level `wires`
 * - train schedules: record list → `{ records }`
 * - former filter inserters get `use_filters: true`
 *
 * UNVERIFIED (marked with ⚠ below, and reported as notes):
 * - inventory ids for converted `items` (modules, fuel, ammo)
 * - power switch copper connector ids
 * - 1.1 rails, which do not map onto 2.0 rail pieces
 * Compare against blueprints re-exported by the game before relying on them.
 *
 * Not migrated (kept as-is): `control_behavior` and other entity settings whose
 * format changed in 2.0. They are preserved verbatim, so nothing is lost.
 */

export interface MigrationNote {
  path: BookPath
  message: string
}

export interface MigrationResult {
  envelope: BlueprintEnvelope
  /** False when the envelope was already 2.x (it is returned unchanged). */
  migrated: boolean
  fromVersion: number
  notes: MigrationNote[]
  /** old name → new name → count, over the whole envelope. */
  renamed: Map<string, { to: string; count: number }>
}

export interface MigrateOptions {
  /** Version stamped on migrated items. Default 2.0.0.0. Pass the game's version when known. */
  targetVersion?: number
}

/** True when the envelope's root was saved by a game older than 2.0. */
export function needsMigration(envelope: BlueprintEnvelope): boolean {
  const root = Object.values(envelope)[0] as JsonObject
  const version = root['version']
  return typeof version === 'number' && unpackVersion(version).major < 2
}

export function migrate1to2(
  envelope: BlueprintEnvelope,
  options: MigrateOptions = {}
): MigrationResult {
  const root = Object.values(envelope)[0] as JsonObject
  const fromVersion = typeof root['version'] === 'number' ? root['version'] : 0
  const renamed = new Map<string, { to: string; count: number }>()
  const notes: MigrationNote[] = []

  if (!needsMigration(envelope)) {
    return { envelope, migrated: false, fromVersion, notes, renamed }
  }

  // Plain JSON data, so a JSON round-trip is an exact deep copy.
  const result = JSON.parse(JSON.stringify(envelope)) as BlueprintEnvelope
  const targetVersion =
    options.targetVersion ?? packVersion({ major: 2, minor: 0, patch: 0, build: 0 })
  const ctx: Context = { renamed, notes, path: [] }

  walk(result, (node) => {
    ctx.path = node.path
    node.payload['version'] = targetVersion
    renameNames(node.payload, ctx)
    if (node.kind === 'blueprint') migrateBlueprint(node.payload, ctx)
  })

  return { envelope: result, migrated: true, fromVersion, notes, renamed }
}

interface Context {
  renamed: Map<string, { to: string; count: number }>
  notes: MigrationNote[]
  path: BookPath
}

function note(ctx: Context, message: string): void {
  if (!ctx.notes.some((n) => n.message === message && samePath(n.path, ctx.path))) {
    ctx.notes.push({ path: ctx.path, message })
  }
}

function samePath(a: BookPath, b: BookPath): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

// ---------------------------------------------------------------------------
// Renames

/** Keys whose string value is a prototype name. */
const NAME_KEYS = new Set(['name', 'recipe'])

/**
 * Renames prototype names anywhere inside `value`, without descending into
 * nested books' items (each node is visited separately by `walk`).
 */
function renameNames(value: JsonObject, ctx: Context): void {
  const visit = (obj: JsonObject): void => {
    for (const [key, child] of Object.entries(obj)) {
      if (typeof child === 'string' && NAME_KEYS.has(key)) {
        const to = renameFrom1_1(child)
        if (to !== child) {
          obj[key] = to
          const entry = ctx.renamed.get(child)
          if (entry) entry.count++
          else ctx.renamed.set(child, { to, count: 1 })
        }
      } else if (key === 'blueprints' && Array.isArray(child)) {
        // Book contents are visited as their own nodes.
        continue
      } else {
        visitValue(child)
      }
    }
  }
  const visitValue = (child: JsonValue): void => {
    if (Array.isArray(child)) child.forEach(visitValue)
    else if (isJsonObject(child)) visit(child)
  }
  visit(value)
}

// ---------------------------------------------------------------------------
// Blueprint

function migrateBlueprint(blueprint: JsonObject, ctx: Context): void {
  const entities = Array.isArray(blueprint['entities']) ? blueprint['entities'] : []
  const wires = new WireSet()

  for (const entity of entities) {
    if (!isJsonObject(entity)) continue
    migrateDirection(entity)
    collectWires(entity, wires, ctx)
    migrateItems(entity, ctx)
    migrateFilterInserter(entity)
    noteLegacyRail(entity, ctx)
  }

  if (wires.size > 0) {
    const existing = Array.isArray(blueprint['wires']) ? blueprint['wires'] : []
    blueprint['wires'] = [...existing, ...wires.values()]
  }

  migrateSchedules(blueprint)
}

function migrateDirection(entity: JsonObject): void {
  const d = entity['direction']
  if (typeof d === 'number') entity['direction'] = (d * 2) % 16
}

/**
 * Filter inserters were merged into fast and bulk inserters in 2.0; those only
 * filter when `use_filters` is set. Renaming already happened in renameNames.
 * In 1.1 only filter inserters could have `filters`, so their presence on a
 * fast or bulk inserter identifies a former filter inserter.
 */
function migrateFilterInserter(entity: JsonObject): void {
  const name = entity['name']
  const wasFilterInserter =
    (name === 'fast-inserter' || name === 'bulk-inserter') && Array.isArray(entity['filters'])
  if (wasFilterInserter && entity['use_filters'] === undefined) entity['use_filters'] = true
}

function migrateSchedules(blueprint: JsonObject): void {
  const schedules = blueprint['schedules']
  if (!Array.isArray(schedules)) return
  for (const schedule of schedules) {
    if (isJsonObject(schedule) && Array.isArray(schedule['schedule'])) {
      schedule['schedule'] = { records: schedule['schedule'] }
    }
  }
}

// ---------------------------------------------------------------------------
// Wires

type WireTuple = [number, number, number, number]

/** Wires keyed by their unordered ends, so connections listed on both entities appear once. */
class WireSet {
  private readonly wires = new Map<string, WireTuple>()

  add(a: number, ca: number, b: number, cb: number): void {
    const ends = [`${a}:${ca}`, `${b}:${cb}`].sort()
    const key = ends.join('-')
    if (!this.wires.has(key)) this.wires.set(key, [a, ca, b, cb])
  }

  get size(): number {
    return this.wires.size
  }

  values(): WireTuple[] {
    return [...this.wires.values()]
  }
}

/** 1.1 circuit connection point ("1" or "2") + colour → 2.x connector id. */
function circuitConnector(point: number, color: 'red' | 'green'): number {
  if (point === 2) {
    return color === 'red'
      ? WireConnectorId.CombinatorOutputRed
      : WireConnectorId.CombinatorOutputGreen
  }
  return color === 'red' ? WireConnectorId.CircuitRed : WireConnectorId.CircuitGreen
}

/**
 * ⚠ UNVERIFIED: power switch copper connectors. 1.1 used "Cu0" (left) and
 * "Cu1" (right). Assumed to be 5 and 6 in 2.x (5 is confirmed for pole copper).
 */
const POWER_SWITCH_COPPER = [5, 6] as const

function collectWires(entity: JsonObject, wires: WireSet, ctx: Context): void {
  const self = entity['entity_number']
  if (typeof self !== 'number') return

  const neighbours = entity['neighbours']
  if (Array.isArray(neighbours)) {
    for (const other of neighbours) {
      if (typeof other === 'number') {
        wires.add(self, WireConnectorId.PoleCopper, other, WireConnectorId.PoleCopper)
      }
    }
    delete entity['neighbours']
  }

  const connections = entity['connections']
  if (!isJsonObject(connections)) return
  for (const [point, value] of Object.entries(connections)) {
    if (point === 'Cu0' || point === 'Cu1') {
      note(ctx, 'Power switch copper wires were converted with unverified connector ids.')
      const own = POWER_SWITCH_COPPER[point === 'Cu0' ? 0 : 1]
      for (const target of Array.isArray(value) ? value : []) {
        if (!isJsonObject(target) || typeof target['entity_id'] !== 'number') continue
        // The other end is a pole (wire_id 0) or another power switch (wire_id 0/1).
        const wireId = typeof target['wire_id'] === 'number' ? target['wire_id'] : 0
        const otherConnector = wireId === 1 ? POWER_SWITCH_COPPER[1] : WireConnectorId.PoleCopper
        wires.add(self, own, target['entity_id'], otherConnector)
      }
      continue
    }
    const pointNumber = Number(point)
    if (!isJsonObject(value) || !(pointNumber === 1 || pointNumber === 2)) continue
    for (const color of ['red', 'green'] as const) {
      const targets = value[color]
      for (const target of Array.isArray(targets) ? targets : []) {
        if (!isJsonObject(target) || typeof target['entity_id'] !== 'number') continue
        const circuitId = target['circuit_id'] === 2 ? 2 : 1
        wires.add(
          self,
          circuitConnector(pointNumber, color),
          target['entity_id'],
          circuitConnector(circuitId, color)
        )
      }
    }
  }
  delete entity['connections']
}

// ---------------------------------------------------------------------------
// Items: 1.1 `{ name: count }` → 2.x insert plans

/**
 * ⚠ UNVERIFIED except where noted: the inventory that 1.1 item requests go
 * into, per vanilla entity. Values follow `defines.inventory`.
 * Confirmed from the 2.x corpus: assembling machine modules = 4, electric
 * furnace modules = 4, locomotive fuel = 1.
 */
const ITEM_INVENTORY: Readonly<Record<string, number>> = {
  // Crafting machine modules (assembling_machine_modules / furnace_modules = 4)
  'assembling-machine-1': 4,
  'assembling-machine-2': 4,
  'assembling-machine-3': 4,
  'chemical-plant': 4,
  'oil-refinery': 4,
  centrifuge: 4,
  'rocket-silo': 4,
  'electric-furnace': 4,
  // Mining drill modules = 2
  'electric-mining-drill': 2,
  pumpjack: 2,
  // Lab modules = 3, beacon modules = 1
  lab: 3,
  beacon: 1,
  // Fuel = 1
  'stone-furnace': 1,
  'steel-furnace': 1,
  'burner-mining-drill': 1,
  'burner-inserter': 1,
  boiler: 1,
  'nuclear-reactor': 1,
  locomotive: 1,
  // Ammo = 1
  'gun-turret': 1,
  'artillery-turret': 1,
  'artillery-wagon': 1
}

function migrateItems(entity: JsonObject, ctx: Context): void {
  const items = entity['items']
  if (!isJsonObject(items)) return // absent, or already insert plans
  const name = typeof entity['name'] === 'string' ? entity['name'] : ''
  const inventory = ITEM_INVENTORY[name]
  if (inventory === undefined) {
    note(ctx, `Item requests on "${name}" were kept in the 1.1 format (unknown inventory).`)
    return
  }
  note(ctx, 'Item requests (modules, fuel, ammo) were converted with unverified inventory ids.')

  let stack = 0
  const plans: JsonObject[] = []
  for (const [itemName, count] of Object.entries(items)) {
    if (typeof count !== 'number' || count <= 0) continue
    const item = renameFrom1_1(itemName)
    if (item.includes('-module')) {
      // One module per slot.
      const slots: JsonObject[] = []
      for (let i = 0; i < count; i++) slots.push({ inventory, stack: stack++ })
      plans.push({ id: { name: item }, items: { in_inventory: slots } })
    } else {
      // Fuel or ammo: one stack with a count.
      const slot: JsonObject = { inventory, stack: stack++ }
      if (count > 1) slot['count'] = count
      plans.push({ id: { name: item }, items: { in_inventory: [slot] } })
    }
  }
  entity['items'] = plans
}

// ---------------------------------------------------------------------------
// Rails

/**
 * ⚠ 1.1 rails (`straight-rail`, `curved-rail`) do not map one-to-one onto the
 * 2.0 rail pieces. They are kept with their 1.1 names and directions doubled;
 * how the game converts them is still to be checked against a game re-export.
 */
function noteLegacyRail(entity: JsonObject, ctx: Context): void {
  const name = entity['name']
  if (name === 'curved-rail' || name === 'straight-rail') {
    note(ctx, '1.1 rails are not converted to 2.0 rail pieces yet; they may render incorrectly.')
  }
}
