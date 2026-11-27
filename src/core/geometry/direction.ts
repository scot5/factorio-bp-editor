/**
 * Factorio 2.x directions: 16 values, clockwise from north.
 * See docs/spec/02-blueprint-format.md § Direction handling.
 *
 * Values are as written in blueprint strings (confirmed against the corpus).
 * Most entities use only the 4 cardinal values; rails and signals use 8 or 16.
 */
export const Direction = {
  North: 0,
  NorthNorthEast: 1,
  NorthEast: 2,
  EastNorthEast: 3,
  East: 4,
  EastSouthEast: 5,
  SouthEast: 6,
  SouthSouthEast: 7,
  South: 8,
  SouthSouthWest: 9,
  SouthWest: 10,
  WestSouthWest: 11,
  West: 12,
  WestNorthWest: 13,
  NorthWest: 14,
  NorthNorthWest: 15
} as const

export type Direction = (typeof Direction)[keyof typeof Direction]

export const DIRECTION_COUNT = 16

export function isDirection(value: unknown): value is Direction {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) < DIRECTION_COUNT
}

/** Direction of an entity; absent means north. */
export function directionOf(entity: { direction?: number | undefined }): Direction {
  return isDirection(entity.direction) ? entity.direction : Direction.North
}

export function isCardinal(d: Direction): boolean {
  return d % 4 === 0
}

/** Rotates by `quarterTurns` × 90° (positive = clockwise). */
export function rotateDirection(d: Direction, quarterTurns: number): Direction {
  return mod(d + quarterTurns * 4, DIRECTION_COUNT) as Direction
}

/**
 * Mirrors a direction. `horizontal` flips left↔right (east↔west),
 * `vertical` flips top↔bottom (north↔south).
 */
export function mirrorDirection(d: Direction, axis: 'horizontal' | 'vertical'): Direction {
  return mod(axis === 'horizontal' ? -d : 8 - d, DIRECTION_COUNT) as Direction
}

/** Unit vector for a direction, in tile coordinates (x right, y down). */
export function directionVector(d: Direction): { x: number; y: number } {
  const angle = (d / DIRECTION_COUNT) * 2 * Math.PI
  // Round away float noise so cardinal vectors are exact.
  const clean = (n: number): number => (Math.abs(n) < 1e-12 ? 0 : n)
  return { x: clean(Math.sin(angle)), y: clean(-Math.cos(angle)) }
}

/** 1.1 used 8 directions (0–7); 2.x uses 16. */
export function directionFrom8Way(d8: number): Direction {
  return mod(d8 * 2, DIRECTION_COUNT) as Direction
}

/**
 * Rolling stock uses a float `orientation` (0–1, clockwise from north) instead of
 * `direction`. Returns the nearest 16-way direction.
 */
export function directionFromOrientation(orientation: number): Direction {
  return mod(Math.round(orientation * DIRECTION_COUNT), DIRECTION_COUNT) as Direction
}

function mod(n: number, m: number): number {
  return ((n % m) + m) % m
}
