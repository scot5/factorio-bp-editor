import { directionVector, isCardinal, type Direction } from '../geometry'
import type { BlueprintLayout, EntityLayout } from '../model/layout'

/**
 * Pairing of underground belts and pipes to ground (docs/spec/06-analysis.md
 * § 6 Validation, Undergrounds). Pure bracket pairing along each line; the
 * distance limit is applied by the callers (validation reports pairs beyond
 * it, logistics leaves them unconnected).
 */

export type UndergroundType = 'underground-belt' | 'pipe-to-ground'

export interface UndergroundPair {
  /** The end the run starts from (belt input; for pipes the end nearer the line's start). */
  start: EntityLayout
  end: EntityLayout
  /** Tiles between the two centres, along the line. */
  distance: number
}

export interface UndergroundLine {
  type: UndergroundType
  /** Prototype name; only ends of the same prototype pair. */
  name: string
  pairs: UndergroundPair[]
  unpaired: EntityLayout[]
}

interface End {
  e: EntityLayout
  opener: boolean
  /** Position along the line. */
  t: number
}

/**
 * Line and role of an underground belt or pipe-to-ground. An underground
 * belt's direction is the flow direction for both ends; a pipe-to-ground's
 * direction is its above-ground side, so a pair faces away from each other.
 */
function placeEnd(e: EntityLayout, type: UndergroundType): { key: string; end: End } | undefined {
  if (!isCardinal(e.direction)) return undefined
  const d = e.direction
  const pipe = type === 'pipe-to-ground'
  // Pipes: one canonical flow per axis (south or east).
  const axisFlow = d === 0 || d === 8 ? 8 : 4
  const flow = pipe ? axisFlow : d
  const v = directionVector(flow as Direction)
  const { x, y } = e.entity.position
  const across = v.x === 0 ? x : y
  return {
    key: `${e.entity.name}|${flow}|${across.toFixed(2)}`,
    end: {
      e,
      opener: pipe ? d !== flow : e.entity['type'] !== 'output',
      t: x * v.x + y * v.y
    }
  }
}

/**
 * Groups underground belts and pipes to ground into lines (same name, axis
 * and row) and pairs their ends like brackets: an output (or closing pipe)
 * takes the nearest open input behind it, so an end placed inside a pair
 * takes the connection, as same-tier undergrounds do in game.
 */
export function undergroundLines(
  layout: BlueprintLayout,
  typeOf: (name: string) => string | undefined
): UndergroundLine[] {
  const lines = new Map<string, { type: UndergroundType; ends: End[] }>()
  for (const e of layout.entities) {
    const type = typeOf(e.entity.name)
    if (type !== 'underground-belt' && type !== 'pipe-to-ground') continue
    const placed = placeEnd(e, type)
    if (!placed) continue
    const line = lines.get(placed.key)
    if (line) line.ends.push(placed.end)
    else lines.set(placed.key, { type, ends: [placed.end] })
  }
  return [...lines.values()].map(({ type, ends }) => pairEnds(type, ends))
}

function pairEnds(type: UndergroundType, ends: End[]): UndergroundLine {
  ends.sort((a, b) => a.t - b.t)
  const line: UndergroundLine = { type, name: ends[0]!.e.entity.name, pairs: [], unpaired: [] }
  const open: End[] = []
  for (const end of ends) {
    if (end.opener) {
      open.push(end)
      continue
    }
    const start = open.pop()
    if (start) line.pairs.push({ start: start.e, end: end.e, distance: end.t - start.t })
    else line.unpaired.push(end.e)
  }
  line.unpaired.push(...open.map((end) => end.e))
  return line
}
