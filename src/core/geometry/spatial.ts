import type { Box, Position } from './position'

/**
 * Uniform-grid spatial index for hit testing and viewport culling.
 * See docs/spec/04-visualization.md § Level of detail (32×32-tile cells, like chunks).
 */
export class SpatialIndex<T> {
  private readonly cells = new Map<string, { box: Box; item: T }[]>()
  private count = 0

  constructor(private readonly cellSize = 32) {}

  get size(): number {
    return this.count
  }

  insert(box: Box, item: T): void {
    const entry = { box, item }
    this.forCells(box, (key) => {
      const cell = this.cells.get(key)
      if (cell) cell.push(entry)
      else this.cells.set(key, [entry])
    })
    this.count++
  }

  /** Items whose box overlaps `area` (touching edges excluded), each once. */
  query(area: Box): T[] {
    const seen = new Set<{ box: Box; item: T }>()
    const result: T[] = []
    this.forCells(area, (key) => {
      for (const entry of this.cells.get(key) ?? []) {
        if (seen.has(entry)) continue
        seen.add(entry)
        const b = entry.box
        if (
          b.left < area.right &&
          area.left < b.right &&
          b.top < area.bottom &&
          area.top < b.bottom
        ) {
          result.push(entry.item)
        }
      }
    })
    return result
  }

  /** Items whose box contains `p` (left/top edges inclusive). */
  queryPoint(p: Position): T[] {
    const key = `${Math.floor(p.x / this.cellSize)},${Math.floor(p.y / this.cellSize)}`
    return (this.cells.get(key) ?? [])
      .filter(({ box: b }) => p.x >= b.left && p.x < b.right && p.y >= b.top && p.y < b.bottom)
      .map((e) => e.item)
  }

  private forCells(box: Box, fn: (key: string) => void): void {
    const s = this.cellSize
    const x0 = Math.floor(box.left / s)
    const y0 = Math.floor(box.top / s)
    // Exclusive right/bottom edges: a box ending exactly on a cell boundary does not enter the next cell.
    const x1 = Math.max(x0, Math.ceil(box.right / s) - 1)
    const y1 = Math.max(y0, Math.ceil(box.bottom / s) - 1)
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) fn(`${x},${y}`)
  }
}
