import { SpatialIndex, type Box } from '../geometry'
import type { BlueprintEntity } from '../model/schema'
import type { BlueprintLayout } from '../model/layout'
import {
  MODULE_EFFECTS,
  qualityMultiplier,
  type ModuleEffect,
  type PrototypeDb
} from '../prototypes'

/**
 * Module and beacon effects per entity (docs/spec/06-analysis.md § 4 Power,
 * § 2 Production). Used by the power report for `consumption`; production
 * (M4 plan step 3) reuses the same totals for speed and productivity.
 */

export type Effects = Partial<Record<ModuleEffect, number>>

/**
 * Module inventory id per entity type, as 2.x insert plans write it.
 * Crafting machines 4, labs 3 and beacons 1 are confirmed from the corpus;
 * mining drills 2 from `defines.inventory.mining_drill_modules`.
 */
export const MODULE_INVENTORY: Readonly<Record<string, number>> = {
  'assembling-machine': 4,
  furnace: 4,
  'rocket-silo': 4,
  lab: 3,
  'mining-drill': 2,
  beacon: 1
}

/** Types that receive module and beacon effects. */
const RECEIVER_TYPES: ReadonlySet<string> = new Set([
  'assembling-machine',
  'furnace',
  'rocket-silo',
  'mining-drill',
  'lab'
])

/** Whether a positive value of the effect is good (quality improves only good values). */
const isBeneficial = (effect: ModuleEffect, value: number): boolean =>
  effect === 'consumption' || effect === 'pollution' ? value < 0 : value > 0

export interface InstalledModule {
  item: string
  quality?: string
  count: number
}

/** Modules in an entity's module inventory, from its insert plans. */
export function installedModules(
  db: PrototypeDb,
  entity: BlueprintEntity,
  type: string
): InstalledModule[] {
  const inventory = MODULE_INVENTORY[type]
  if (inventory === undefined || !Array.isArray(entity.items)) return []
  const out: InstalledModule[] = []
  for (const plan of entity.items) {
    if (!db.items[plan.id.name]?.module) continue
    const slots = plan.items.in_inventory ?? []
    const count = slots
      .filter((s) => s.inventory === inventory)
      .reduce((n, s) => n + (s.count ?? 1), 0)
    if (count > 0)
      out.push({
        item: plan.id.name,
        ...(plan.id.quality ? { quality: plan.id.quality } : {}),
        count
      })
  }
  return out
}

/** One module's effects. Quality scales only the beneficial ones (the penalties stay). */
export function moduleEffects(db: PrototypeDb, item: string, quality?: string): Effects {
  const effect = db.items[item]?.module?.effect ?? {}
  const q = db.qualities[quality ?? 'normal']
  const out: Effects = {}
  for (const name of MODULE_EFFECTS) {
    const value = effect[name]
    if (value === undefined) continue
    out[name] = isBeneficial(name, value) ? value * qualityMultiplier(q, `module_${name}`) : value
  }
  return out
}

function addEffects(
  target: Effects,
  source: Effects,
  scale = 1,
  allowed?: readonly string[]
): void {
  for (const name of MODULE_EFFECTS) {
    const value = source[name]
    if (value === undefined || (allowed && !allowed.includes(name))) continue
    target[name] = (target[name] ?? 0) + value * scale
  }
}

function sumModules(db: PrototypeDb, entity: BlueprintEntity, type: string): Effects {
  const out: Effects = {}
  for (const m of installedModules(db, entity, type))
    addEffects(out, moduleEffects(db, m.item, m.quality), m.count)
  return out
}

export interface ReceiverEffects {
  /** Total effects: base effect, own modules and beacons. */
  effects: Effects
  /** Layout indexes of the beacons affecting the entity. */
  beacons: number[]
}

interface Beacon {
  index: number
  name: string
  /** Module effects × distribution effectivity (before the profile). */
  transmitted: Effects
  allowed: readonly string[]
}

/**
 * Effects of every receiver (crafting machines, drills, labs) in the layout.
 * A beacon affects an entity whose box overlaps the beacon box grown by its
 * `supply_area_distance`. Each beacon's effect is scaled by its distribution
 * effectivity (plus the per-level quality bonus) and by `profile[n - 1]`, where
 * n counts the beacons affecting the entity (only same-named ones for
 * `beacon_counter: same_type`).
 */
export function entityEffects(
  db: PrototypeDb,
  layout: BlueprintLayout
): Map<number, ReceiverEffects> {
  const beacons = new SpatialIndex<Beacon>()
  for (const e of layout.entities) {
    const proto = db.entities[e.entity.name]
    if (proto?.type !== 'beacon') continue
    const s = proto.stats ?? {}
    const level = db.qualities[e.entity.quality ?? 'normal']?.level ?? 0
    const effectivity =
      (s.distributionEffectivity ?? 1) +
      (s.distributionEffectivityBonusPerQualityLevel ?? 0) * level
    const transmitted: Effects = {}
    addEffects(transmitted, sumModules(db, e.entity, 'beacon'), effectivity)
    if (Object.keys(transmitted).length === 0) continue
    beacons.insert(grow(e.box, s.supplyAreaDistance ?? 0), {
      index: e.index,
      name: e.entity.name,
      transmitted,
      allowed: s.allowedEffects ?? []
    })
  }

  const out = new Map<number, ReceiverEffects>()
  for (const e of layout.entities) {
    const proto = db.entities[e.entity.name]
    if (!proto || !RECEIVER_TYPES.has(proto.type)) continue
    const s = proto.stats ?? {}
    const allowed = s.allowedEffects ?? []
    const effects: Effects = { ...s.baseEffect }
    addEffects(effects, sumModules(db, e.entity, proto.type), 1, allowed)
    const near = beacons.query(e.box)
    for (const b of near) {
      const counted =
        db.entities[b.name]?.stats?.beaconCounter === 'same_type'
          ? near.filter((o) => o.name === b.name).length
          : near.length
      const profile = db.entities[b.name]?.stats?.profile ?? []
      const scale = profile.length ? profile[Math.min(counted, profile.length) - 1]! : 1
      addEffects(
        effects,
        b.transmitted,
        scale,
        allowed.filter((a) => b.allowed.includes(a))
      )
    }
    if (Object.keys(effects).length || near.length)
      out.set(e.index, { effects, beacons: near.map((b) => b.index) })
  }
  return out
}

/** A box grown by `d` tiles on every side. */
export const grow = (b: Box, d: number): Box => ({
  left: b.left - d,
  top: b.top - d,
  right: b.right + d,
  bottom: b.bottom + d
})
