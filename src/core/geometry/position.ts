/** A position in tiles: x to the right, y down (Factorio's map coordinates). */
export interface Position {
  x: number
  y: number
}

/** An axis-aligned box in tiles. `left`/`top` inclusive, `right`/`bottom` exclusive edges. */
export interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

export function addPositions(a: Position, b: Position): Position {
  return { x: a.x + b.x, y: a.y + b.y }
}

export function subtractPositions(a: Position, b: Position): Position {
  return { x: a.x - b.x, y: a.y - b.y }
}

/** Rotates `p` around `center` by `quarterTurns` × 90° (positive = clockwise on screen). */
export function rotatePosition(p: Position, center: Position, quarterTurns: number): Position {
  const turns = ((quarterTurns % 4) + 4) % 4
  let { x, y } = subtractPositions(p, center)
  for (let i = 0; i < turns; i++) [x, y] = [-y, x]
  return addPositions(center, { x: x + 0, y: y + 0 }) // + 0 turns -0 into 0
}

/** Mirrors `p` across the vertical (horizontal flip) or horizontal (vertical flip) line through `center`. */
export function mirrorPosition(
  p: Position,
  center: Position,
  axis: 'horizontal' | 'vertical'
): Position {
  return axis === 'horizontal'
    ? { x: 2 * center.x - p.x, y: p.y }
    : { x: p.x, y: 2 * center.y - p.y }
}

export function boxWidth(b: Box): number {
  return b.right - b.left
}

export function boxHeight(b: Box): number {
  return b.bottom - b.top
}

export function boxCenter(b: Box): Position {
  return { x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 }
}

/** Smallest box containing all given boxes, or `null` when there are none. */
export function unionBoxes(boxes: Iterable<Box>): Box | null {
  let result: Box | null = null
  for (const b of boxes) {
    result = result
      ? {
          left: Math.min(result.left, b.left),
          top: Math.min(result.top, b.top),
          right: Math.max(result.right, b.right),
          bottom: Math.max(result.bottom, b.bottom)
        }
      : { ...b }
  }
  return result
}

export function boxesOverlap(a: Box, b: Box): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
}
