import type { Box, Position } from '../geometry'
import { layoutBlueprint, type Blueprint, type BlueprintEntity } from '../model'
import type { PrototypeLookup } from '../prototypes'
import type { AnalysisResult } from './index'
import { byCountThenName } from './format'

/**
 * Differences between two blueprints (docs/spec/06-analysis.md § 7 Diff).
 * `before` is the blueprint compared against, `after` the one on the canvas.
 */

export interface EntityChange {
  /** Index in `before.entities`. */
  before: number
  /** Index in `after.entities`. */
  after: number
  /** Top-level entity keys that differ (`position` and `entity_number` excluded), plus `wires`. */
  fields: string[]
}

export interface BlueprintDiff {
  /**
   * Shift added to `before` positions so they line up with `after`. Blueprint
   * positions are relative to the blueprint's centre, so adding one entity at
   * the edge moves every other one.
   */
  offset: Position
  /** Indexes in `after.entities`. */
  added: number[]
  /** Indexes in `before.entities`. */
  removed: number[]
  changed: EntityChange[]
  unchanged: number
  wires: {
    /** Indexes in `after.wires`. */
    added: number[]
    /** Indexes in `before.wires`. */
    removed: number[]
  }
  tiles: { added: number; removed: number; changed: number }
  /** Top-level blueprint keys that differ (label, icons, parameters, …); see `IGNORED_BLUEPRINT_KEYS`. */
  fields: string[]
}

/** Compared separately (entities, tiles, wires) or noise (`version` changes with every game update). */
const IGNORED_BLUEPRINT_KEYS: ReadonlySet<string> = new Set([
  'item',
  'version',
  'entities',
  'tiles',
  'wires'
])

const IGNORED_ENTITY_KEYS: ReadonlySet<string> = new Set(['entity_number', 'position'])

/** Pairs of same-name entities looked at when guessing the offset. */
const OFFSET_PAIR_BUDGET = 20_000
/** Most frequent offsets scored in full. */
const OFFSET_CANDIDATES = 8

export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => jsonEqual(v, b[i]))
  }
  const ao = a as Record<string, unknown>
  const bo = b as Record<string, unknown>
  const keys = Object.keys(ao)
  if (keys.length !== Object.keys(bo).length) return false
  return keys.every((k) => Object.hasOwn(bo, k) && jsonEqual(ao[k], bo[k]))
}

/** Keys whose values differ between two objects (missing counts as different). */
function changedKeys(
  a: Readonly<Record<string, unknown>>,
  b: Readonly<Record<string, unknown>>,
  ignored: ReadonlySet<string>
): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  return [...keys].filter((k) => !ignored.has(k) && !jsonEqual(a[k], b[k]))
}

const posKey = (x: number, y: number): string => `${x},${y}`

function byName(list: readonly BlueprintEntity[]): Map<string, BlueprintEntity[]> {
  const map = new Map<string, BlueprintEntity[]>()
  for (const e of list) {
    const group = map.get(e.name)
    if (group) group.push(e)
    else map.set(e.name, [e])
  }
  return map
}

/** The most frequent shifts between same-name entities, rarest names first, within a budget. */
function frequentOffsets(
  before: readonly BlueprintEntity[],
  after: readonly BlueprintEntity[]
): Position[] {
  const a = byName(before)
  const b = byName(after)
  const names = [...a.keys()]
    .filter((n) => b.has(n))
    .map((n) => ({ n, pairs: a.get(n)!.length * b.get(n)!.length }))
    .sort((x, y) => x.pairs - y.pairs || x.n.localeCompare(y.n))

  const votes = new Map<string, { offset: Position; votes: number }>()
  const vote = (p: BlueprintEntity, q: BlueprintEntity): void => {
    const dx = q.position.x - p.position.x
    const dy = q.position.y - p.position.y
    const key = posKey(dx, dy)
    const entry = votes.get(key)
    if (entry) entry.votes++
    else votes.set(key, { offset: { x: dx, y: dy }, votes: 1 })
  }
  let budget = OFFSET_PAIR_BUDGET
  for (const { n, pairs } of names) {
    if (pairs > budget) break
    budget -= pairs
    for (const p of a.get(n)!) for (const q of b.get(n)!) vote(p, q)
  }
  return [...votes.values()]
    .sort((x, y) => y.votes - x.votes)
    .slice(0, OFFSET_CANDIDATES)
    .map((v) => v.offset)
}

/**
 * The shift that lines up the most entities by name and position. Candidates
 * are the most frequent offsets between same-name entities (rarest names
 * first, within a budget), plus no shift; ties keep the smaller shift.
 */
export function alignmentOffset(
  before: readonly BlueprintEntity[],
  after: readonly BlueprintEntity[]
): Position {
  const targets = new Set(after.map((e) => `${e.name}@${posKey(e.position.x, e.position.y)}`))
  const score = (offset: Position): number =>
    before.filter((e) =>
      targets.has(`${e.name}@${posKey(e.position.x + offset.x, e.position.y + offset.y)}`)
    ).length
  let best = { offset: { x: 0, y: 0 }, score: score({ x: 0, y: 0 }), size: 0 }
  for (const offset of frequentOffsets(before, after)) {
    const candidate = {
      offset,
      score: score(offset),
      size: Math.abs(offset.x) + Math.abs(offset.y)
    }
    if (
      candidate.score > best.score ||
      (candidate.score === best.score && candidate.size < best.size)
    )
      best = candidate
  }
  return best.offset
}

/**
 * Matches entities by position (after the alignment offset), then by name:
 * identical entities first, then the same name, then the same prototype type
 * (an upgrade, such as a stack inserter replaced by a bulk inserter). The rest
 * are added or removed. Wires are compared through the matched entities.
 */
export function diffBlueprints(
  before: Blueprint,
  after: Blueprint,
  lookup: PrototypeLookup
): BlueprintDiff {
  const beforeEntities = before.entities ?? []
  const afterEntities = after.entities ?? []
  const offset = alignmentOffset(beforeEntities, afterEntities)

  const at = new Map<string, number[]>()
  afterEntities.forEach((e, i) => {
    const key = posKey(e.position.x, e.position.y)
    const list = at.get(key)
    if (list) list.push(i)
    else at.set(key, [i])
  })
  const pairOf = new Map<number, number>() // before index → after index
  const taken = new Set<number>()
  const passes: ((p: BlueprintEntity, q: BlueprintEntity) => boolean)[] = [
    (p, q) => p.name === q.name && changedKeys(p, q, IGNORED_ENTITY_KEYS).length === 0,
    (p, q) => p.name === q.name,
    (p, q) => {
      const type = lookup(p.name)?.type
      return type !== undefined && type === lookup(q.name)?.type
    }
  ]
  for (const matches of passes) {
    beforeEntities.forEach((p, i) => {
      if (pairOf.has(i)) return
      const candidates = at.get(posKey(p.position.x + offset.x, p.position.y + offset.y))
      const j = candidates?.find((c) => !taken.has(c) && matches(p, afterEntities[c]!))
      if (j === undefined) return
      pairOf.set(i, j)
      taken.add(j)
    })
  }

  // Wires: each wire as a key in the after numbering.
  const afterNumber = new Map<number, number>() // before entity_number → after entity_number
  for (const [i, j] of pairOf)
    afterNumber.set(beforeEntities[i]!.entity_number, afterEntities[j]!.entity_number)
  const wireKey = (a: number, ca: number, b: number, cb: number): string =>
    a < b || (a === b && ca <= cb) ? `${a}:${ca}-${b}:${cb}` : `${b}:${cb}-${a}:${ca}`
  const afterWires = new Map<string, number>()
  ;(after.wires ?? []).forEach(([a, ca, b, cb], i) => afterWires.set(wireKey(a, ca, b, cb), i))
  const keptWires = new Set<string>()
  const removedWires: number[] = []
  const rewired = new Set<number>() // after entity_numbers whose wires changed
  ;(before.wires ?? []).forEach(([a, ca, b, cb], i) => {
    const na = afterNumber.get(a)
    const nb = afterNumber.get(b)
    const key = na !== undefined && nb !== undefined ? wireKey(na, ca, nb, cb) : undefined
    if (key !== undefined && afterWires.has(key)) {
      keptWires.add(key)
      return
    }
    removedWires.push(i)
    if (na !== undefined) rewired.add(na)
    if (nb !== undefined) rewired.add(nb)
  })
  const addedWires: number[] = []
  for (const [key, i] of afterWires) {
    if (keptWires.has(key)) continue
    addedWires.push(i)
    const [a, , b] = after.wires![i]!
    rewired.add(a)
    rewired.add(b)
  }
  addedWires.sort((x, y) => x - y)

  const changed: EntityChange[] = []
  let unchanged = 0
  for (const [i, j] of [...pairOf].sort((x, y) => x[1] - y[1])) {
    const p = beforeEntities[i]!
    const q = afterEntities[j]!
    const fields = changedKeys(p, q, IGNORED_ENTITY_KEYS)
    if (rewired.has(q.entity_number)) fields.push('wires')
    if (fields.length) changed.push({ before: i, after: j, fields })
    else unchanged++
  }

  return {
    offset,
    added: afterEntities.map((_, j) => j).filter((j) => !taken.has(j)),
    removed: beforeEntities.map((_, i) => i).filter((i) => !pairOf.has(i)),
    changed,
    unchanged,
    wires: { added: addedWires, removed: removedWires },
    tiles: diffTiles(before, after, offset),
    fields: changedKeys(before, after, IGNORED_BLUEPRINT_KEYS)
  }
}

function diffTiles(before: Blueprint, after: Blueprint, offset: Position): BlueprintDiff['tiles'] {
  const afterTiles = new Map<string, string>()
  for (const t of after.tiles ?? []) afterTiles.set(posKey(t.position.x, t.position.y), t.name)
  let removed = 0
  let changed = 0
  let kept = 0
  for (const t of before.tiles ?? []) {
    const name = afterTiles.get(posKey(t.position.x + offset.x, t.position.y + offset.y))
    if (name === undefined) removed++
    else {
      kept++
      if (name !== t.name) changed++
    }
  }
  return { added: afterTiles.size - kept, removed, changed }
}

// ---------------------------------------------------------------------------
// Report: the diff grouped for the UI, plus analysis deltas.

export interface DiffRow {
  name: string
  quality?: string
  /** Entity name in `before` when the change replaced the prototype. */
  from?: string
  /** Changed keys (changed rows only). */
  fields?: string[]
  count: number
  /** Indexes in `after.entities`; empty for removed entities. */
  indexes: number[]
}

export interface DeltaRow {
  type: 'item' | 'fluid'
  name: string
  quality?: string
  before: number
  after: number
}

export interface DiffReport {
  offset: Position
  counts: { added: number; removed: number; changed: number; unchanged: number }
  added: DiffRow[]
  removed: DiffRow[]
  changed: DiffRow[]
  /** Footprints of removed entities, shifted into the after blueprint's coordinates. */
  removedBoxes: Box[]
  /** Indexes in `after.entities`, for the overlay. */
  addedIndexes: number[]
  changedIndexes: number[]
  wires: { added: number; removed: number }
  tiles: BlueprintDiff['tiles']
  fields: string[]
  /** Bill of materials per item that changed. */
  materials: DeltaRow[]
  /** Electric power in W; null without game data. */
  power: {
    peak: { before: number; after: number }
    drain: { before: number; after: number }
    generation: { before: number; after: number }
  } | null
  /** Net rate per second of every flow that changed; null without game data. */
  production: DeltaRow[] | null
}

const qualityOf = (e: BlueprintEntity): string | undefined =>
  e.quality && e.quality !== 'normal' ? e.quality : undefined

function groupRows(
  items: readonly { entity: BlueprintEntity; from?: string; fields?: string[]; index?: number }[]
): DiffRow[] {
  const rows = new Map<string, DiffRow>()
  for (const { entity, from, fields, index } of items) {
    const quality = qualityOf(entity)
    const key = [entity.name, quality ?? '', from ?? '', fields?.join(',') ?? ''].join('\n')
    let row = rows.get(key)
    if (!row) {
      row = {
        name: entity.name,
        ...(quality ? { quality } : {}),
        ...(from ? { from } : {}),
        ...(fields ? { fields } : {}),
        count: 0,
        indexes: []
      }
      rows.set(key, row)
    }
    row.count++
    if (index !== undefined) row.indexes.push(index)
  }
  return [...rows.values()].sort(byCountThenName((r) => r.name))
}

/** Relative tolerance below which two rates count as equal. */
const RATE_TOLERANCE = 1e-6

function deltas(
  before: readonly { type: 'item' | 'fluid'; name: string; quality?: string; value: number }[],
  after: readonly { type: 'item' | 'fluid'; name: string; quality?: string; value: number }[]
): DeltaRow[] {
  const rows = new Map<string, DeltaRow>()
  const add = (
    r: { type: 'item' | 'fluid'; name: string; quality?: string; value: number },
    side: 'before' | 'after'
  ): void => {
    const key = `${r.type}:${r.name}:${r.quality ?? ''}`
    let row = rows.get(key)
    if (!row) {
      row = {
        type: r.type,
        name: r.name,
        ...(r.quality ? { quality: r.quality } : {}),
        before: 0,
        after: 0
      }
      rows.set(key, row)
    }
    row[side] += r.value
  }
  for (const r of before) add(r, 'before')
  for (const r of after) add(r, 'after')
  return [...rows.values()]
    .filter(
      (r) =>
        Math.abs(r.after - r.before) >
        1e-9 + RATE_TOLERANCE * Math.max(Math.abs(r.before), Math.abs(r.after))
    )
    .sort(
      (x, y) =>
        Math.abs(y.after - y.before) - Math.abs(x.after - x.before) || x.name.localeCompare(y.name)
    )
}

/** Groups a diff for the UI and adds the material, power and production deltas from both analyses. */
export function diffReport(
  before: Blueprint,
  after: Blueprint,
  diff: BlueprintDiff,
  beforeAnalysis: AnalysisResult,
  afterAnalysis: AnalysisResult,
  lookup: PrototypeLookup
): DiffReport {
  const beforeEntities = before.entities ?? []
  const afterEntities = after.entities ?? []
  const beforeLayout = layoutBlueprint(
    { ...before, entities: diff.removed.map((i) => beforeEntities[i]!) },
    lookup
  )
  const { x: dx, y: dy } = diff.offset
  const removedBoxes = beforeLayout.entities.map(({ box }) => ({
    left: box.left + dx,
    top: box.top + dy,
    right: box.right + dx,
    bottom: box.bottom + dy
  }))

  const materials = (
    r: AnalysisResult
  ): { type: 'item'; name: string; quality?: string; value: number }[] =>
    r.inventory.materials.map((m) => ({
      type: 'item',
      name: m.item,
      ...(m.quality ? { quality: m.quality } : {}),
      value: m.count
    }))
  const flows = (
    r: AnalysisResult
  ): { type: 'item' | 'fluid'; name: string; quality?: string; value: number }[] =>
    (r.production?.flows ?? []).map((f) => ({
      type: f.type,
      name: f.name,
      ...(f.quality ? { quality: f.quality } : {}),
      value: f.net
    }))
  const bp = beforeAnalysis.power
  const ap = afterAnalysis.power

  return {
    offset: diff.offset,
    counts: {
      added: diff.added.length,
      removed: diff.removed.length,
      changed: diff.changed.length,
      unchanged: diff.unchanged
    },
    added: groupRows(diff.added.map((j) => ({ entity: afterEntities[j]!, index: j }))),
    removed: groupRows(diff.removed.map((i) => ({ entity: beforeEntities[i]! }))),
    changed: groupRows(
      diff.changed.map((c) => {
        const from = beforeEntities[c.before]!.name
        const entity = afterEntities[c.after]!
        return {
          entity,
          ...(from === entity.name ? {} : { from }),
          fields: c.fields,
          index: c.after
        }
      })
    ),
    removedBoxes,
    addedIndexes: diff.added,
    changedIndexes: diff.changed.map((c) => c.after),
    wires: { added: diff.wires.added.length, removed: diff.wires.removed.length },
    tiles: diff.tiles,
    fields: diff.fields,
    materials: deltas(materials(beforeAnalysis), materials(afterAnalysis)),
    power:
      bp && ap
        ? {
            peak: { before: bp.peak, after: ap.peak },
            drain: { before: bp.drain, after: ap.drain },
            generation: { before: bp.generationPeak, after: ap.generationPeak }
          }
        : null,
    production:
      beforeAnalysis.production && afterAnalysis.production
        ? deltas(flows(beforeAnalysis), flows(afterAnalysis))
        : null
  }
}
