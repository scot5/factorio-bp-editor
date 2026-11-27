import type { Blueprint } from '../model/schema'
import type { BlueprintLayout } from '../model/layout'
import type { ItemCount, PrototypeDb } from '../prototypes'

/**
 * Inventory report: entity and tile counts, the bill of materials and the
 * footprint. See docs/spec/06-analysis.md § 1 Inventory.
 *
 * Works without game data: entity and tile names then stand in for their
 * items, and those rows are marked `guessed`.
 */

export interface EntityCountRow {
  name: string
  quality?: string
  count: number
  /** Indexes into `blueprint.entities`. */
  indexes: number[]
}

export interface TileCountRow {
  name: string
  count: number
}

export type MaterialSource = 'entity' | 'insert-plan' | 'tile'

export interface MaterialRow {
  item: string
  quality?: string
  count: number
  /** Where the items are needed: placing entities, insert plans (modules, fuel, ammo), tiles. */
  sources: MaterialSource[]
  /** Entities that need this item, placed or inserted. */
  indexes: number[]
  /** The item was inferred from the entity or tile name (no game data, or an unknown prototype). */
  guessed?: boolean
}

export interface InventoryReport {
  entityCount: number
  tileCount: number
  entities: EntityCountRow[]
  tiles: TileCountRow[]
  materials: MaterialRow[]
  /** Entities that the prototype data knows, but no item places (for example, `rail-ramp` in some mods). */
  unplaceable: EntityCountRow[]
  footprint: { width: number; height: number; occupiedTiles: number }
}

/** Items that place an entity: `placeable_by`, else an item whose `place_result` is the entity. */
export function placingItems(db: PrototypeDb, entity: string): ItemCount[] | undefined {
  const proto = db.entities[entity]
  if (proto?.stats?.placeableBy) return proto.stats.placeableBy
  const item = placeResultIndex(db).get(entity)
  return item ? [{ item, count: 1 }] : undefined
}

const placeResultCache = new WeakMap<PrototypeDb, Map<string, string>>()

/** Entity → placing item. When several items place one entity, the item of the same name wins, then the first by name. */
function placeResultIndex(db: PrototypeDb): Map<string, string> {
  let index = placeResultCache.get(db)
  if (index) return index
  index = new Map()
  for (const [item, proto] of Object.entries(db.items).sort(([a], [b]) => a.localeCompare(b))) {
    const target = proto.placeResult
    if (!target) continue
    if (!index.has(target) || item === target) index.set(target, item)
  }
  placeResultCache.set(db, index)
  return index
}

const keyOf = (name: string, quality: string | undefined): string => `${name}\u0000${quality ?? ''}`

const byCountThenName =
  <T extends { count: number }>(name: (r: T) => string) =>
  (a: T, b: T) =>
    b.count - a.count || name(a).localeCompare(name(b))

/** Number of items an insert plan asks for. */
function planCount(items: unknown): number {
  if (!items || typeof items !== 'object') return 0
  const r = items as { in_inventory?: { count?: number }[]; grid_count?: number }
  const slots = (r.in_inventory ?? []).reduce((n, slot) => n + (slot.count ?? 1), 0)
  return slots + (r.grid_count ?? 0)
}

export function inventory(
  blueprint: Blueprint,
  layout: BlueprintLayout,
  db: PrototypeDb | null
): InventoryReport {
  const entities = new Map<string, EntityCountRow>()
  const unplaceable = new Map<string, EntityCountRow>()
  const materials = new Map<string, MaterialRow>()

  const addMaterial = (
    item: string,
    quality: string | undefined,
    count: number,
    source: MaterialSource,
    index: number | undefined,
    guessed: boolean
  ): void => {
    const q = quality && quality !== 'normal' ? quality : undefined
    const key = keyOf(item, q)
    let row = materials.get(key)
    if (!row) {
      row = { item, ...(q ? { quality: q } : {}), count: 0, sources: [], indexes: [] }
      materials.set(key, row)
    }
    row.count += count
    if (!row.sources.includes(source)) row.sources.push(source)
    if (index !== undefined && row.indexes.at(-1) !== index) row.indexes.push(index)
    if (guessed) row.guessed = true
  }

  const addEntityRow = (
    map: Map<string, EntityCountRow>,
    name: string,
    quality: string | undefined,
    index: number
  ): void => {
    const q = quality && quality !== 'normal' ? quality : undefined
    const key = keyOf(name, q)
    let row = map.get(key)
    if (!row) {
      row = { name, ...(q ? { quality: q } : {}), count: 0, indexes: [] }
      map.set(key, row)
    }
    row.count++
    row.indexes.push(index)
  }

  const list = blueprint.entities ?? []
  list.forEach((entity, index) => {
    addEntityRow(entities, entity.name, entity.quality, index)
    const known = db?.entities[entity.name] !== undefined
    const items = db && known ? placingItems(db, entity.name) : undefined
    if (items) {
      for (const { item, count } of items)
        addMaterial(item, entity.quality, count, 'entity', index, false)
    } else if (db && known) {
      addEntityRow(unplaceable, entity.name, entity.quality, index)
    } else {
      addMaterial(entity.name, entity.quality, 1, 'entity', index, true)
    }

    if (Array.isArray(entity.items)) {
      for (const plan of entity.items) {
        const count = planCount(plan.items)
        if (count > 0)
          addMaterial(plan.id.name, plan.id.quality, count, 'insert-plan', index, false)
      }
    }
  })

  const tileCounts = new Map<string, number>()
  for (const tile of blueprint.tiles ?? [])
    tileCounts.set(tile.name, (tileCounts.get(tile.name) ?? 0) + 1)
  for (const [name, count] of tileCounts) {
    const items = db?.tileItems?.[name]
    if (items)
      for (const t of items)
        addMaterial(t.item, undefined, t.count * count, 'tile', undefined, false)
    else addMaterial(name, undefined, count, 'tile', undefined, true)
  }

  return {
    entityCount: list.length,
    tileCount: blueprint.tiles?.length ?? 0,
    entities: [...entities.values()].sort(byCountThenName((r) => r.name)),
    tiles: [...tileCounts]
      .map(([name, count]) => ({ name, count }))
      .sort(byCountThenName((r) => r.name)),
    materials: [...materials.values()].sort(byCountThenName((r) => r.item)),
    unplaceable: [...unplaceable.values()].sort(byCountThenName((r) => r.name)),
    footprint: footprintOf(layout)
  }
}

function footprintOf(layout: BlueprintLayout): InventoryReport['footprint'] {
  if (!layout.bounds) return { width: 0, height: 0, occupiedTiles: 0 }
  const occupied = new Set<number>()
  // Tile coordinates are packed into one number; blueprints are far smaller than 2^20 tiles across.
  const pack = (x: number, y: number): number => (x + 524_288) * 1_048_576 + (y + 524_288)
  for (const e of layout.entities) {
    const { left, top, right, bottom } = e.box
    for (let x = Math.floor(left); x < Math.ceil(right); x++)
      for (let y = Math.floor(top); y < Math.ceil(bottom); y++) occupied.add(pack(x, y))
  }
  for (const t of layout.tiles) occupied.add(pack(Math.floor(t.x), Math.floor(t.y)))
  const b = layout.bounds
  return {
    width: Math.ceil(b.right) - Math.floor(b.left),
    height: Math.ceil(b.bottom) - Math.floor(b.top),
    occupiedTiles: occupied.size
  }
}

/** The bill of materials as plain text, one `count × name` line per item. */
export function materialsText(
  report: InventoryReport,
  name: (item: string) => string = (item) => item
): string {
  return report.materials
    .map((r) => {
      const quality = r.quality ? ` (${r.quality})` : ''
      return `${r.count} × ${name(r.item)}${quality}`
    })
    .join('\n')
}
