/**
 * Inserter arm in its resting pose: the hand waits over the pickup position.
 * See docs/spec/03-game-assets.md § Inserter hands.
 *
 * The game draws the arm in 3D (a base from the platform to the elbow, then
 * the hand), so the screen pose is not a plain rotation of the pickup vector.
 * These poses are the ones the Factorio Blueprint Editor uses, per side the
 * pickup is on (the inserter's `direction`), for regular and long-handed
 * reach. Both sprites point up from their bottom centre (anchor 0.5, 1),
 * then are rotated clockwise by `rotation` degrees and squashed vertically
 * by `squash`; `offset` (tiles) moves the anchor from the entity centre.
 */

export type ArmPiece = 'base' | 'hand'

export interface ArmPose {
  /** Degrees, clockwise. */
  rotation: number
  /** Vertical scale of the sprite before rotation (foreshortening). */
  squash: number
  offset: [number, number]
}

type SidePoses = Record<ArmPiece, ArmPose>

const pose = (rotation: number, divisor: number, x: number, y: number): ArmPose => ({
  rotation,
  squash: 1 / divisor,
  offset: [x, y]
})

/** By pickup side N, E, S, W. */
const REGULAR: SidePoses[] = [
  { hand: pose(0, 3, 0, -0.5), base: pose(0, 1.4, 0, 0.05) },
  { hand: pose(135, 2.5, 0.325, -0.325), base: pose(45, 1.9, -0.03, 0.03) },
  { hand: pose(180, 1.75, 0, 0.03), base: pose(180, 7, 0, -0.03) },
  { hand: pose(-135, 2.5, -0.325, -0.325), base: pose(-45, 1.9, 0.03, 0.03) }
]

const LONG: SidePoses[] = [
  { hand: pose(180, 3.5, 0, -0.95), base: pose(0, 1, 0, 0.05) },
  { hand: pose(155, 1.5, 0.275, -0.7), base: pose(25, 1.25, -0.03, 0.03) },
  { hand: pose(180, 1.25, 0, -0.3), base: pose(0, 2.5, 0, 0.03) },
  { hand: pose(-155, 1.5, -0.275, -0.7), base: pose(-25, 1.25, 0.03, 0.03) }
]

/** Pickup distances above this use the long-handed poses (regular 1, long-handed 2). */
const LONG_REACH = 1.5

/**
 * The pose of one arm piece for an inserter facing `direction` (16-way,
 * rounded to 4-way) whose pickup is `reach` tiles away.
 */
export function armPose(piece: ArmPiece, direction: number, reach: number): ArmPose {
  const side = Math.round(direction / 4) % 4
  return (reach >= LONG_REACH ? LONG : REGULAR)[side]![piece]
}
