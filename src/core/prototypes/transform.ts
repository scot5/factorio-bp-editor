import type { EntityPrototypeInfo } from './sizes'

/**
 * How entities rotate and mirror. See docs/spec/05-editing.md § Rotate and mirror.
 *
 * `rotatable` and `mirroring` come from the PrototypeDb (format 12+). Without
 * game data, the type decides: the types below never rotate, and inserters
 * and mining drills mirror (their `use_mirroring` defaults to true).
 */

/** Types whose `direction` means nothing: rotating them only moves them. */
export const NON_ROTATABLE_TYPES: ReadonlySet<string> = new Set([
  'accumulator',
  'agricultural-tower',
  'beacon',
  'cargo-bay',
  'cargo-landing-pad',
  'container',
  'electric-pole',
  'heat-pipe',
  'infinity-container',
  'infinity-pipe',
  'lab',
  'lamp',
  'land-mine',
  'lightning-attractor',
  'linked-container',
  'logistic-container',
  'pipe',
  'power-switch',
  'programmable-speaker',
  'radar',
  'reactor',
  'roboport',
  'solar-panel',
  'space-platform-hub',
  'thruster',
  'wall'
])

/** Types placed on the 2×2 rail grid: they move in 2-tile steps and rotate around a rail grid point. */
export const RAIL_GRID_TYPES: ReadonlySet<string> = new Set([
  'straight-rail',
  'curved-rail-a',
  'curved-rail-b',
  'half-diagonal-rail',
  'elevated-straight-rail',
  'elevated-curved-rail-a',
  'elevated-curved-rail-b',
  'elevated-half-diagonal-rail',
  'legacy-straight-rail',
  'legacy-curved-rail',
  'rail-ramp',
  'rail-support',
  'train-stop'
])

/** Types whose 180° turn is the same piece: the game writes directions 0–7 only. */
const HALF_TURN_SYMMETRIC_TYPES: ReadonlySet<string> = new Set([
  'straight-rail',
  'elevated-straight-rail',
  'half-diagonal-rail',
  'elevated-half-diagonal-rail',
  'rail-support'
])

/**
 * Extra 16-way steps added to the plain mirrored direction (`mirrorDirection`).
 * Curves and half-diagonals change hand when mirrored (+2, checked against the
 * symmetric elevated intersection in the corpus). Signals and train stops move
 * to the other side of the track, so they now face the other way (+8).
 */
const MIRROR_OFFSET: Readonly<Record<string, number>> = {
  'curved-rail-a': 2,
  'curved-rail-b': 2,
  'elevated-curved-rail-a': 2,
  'elevated-curved-rail-b': 2,
  'legacy-curved-rail': 2,
  'half-diagonal-rail': 2,
  'elevated-half-diagonal-rail': 2,
  'rail-signal': 8,
  'rail-chain-signal': 8,
  'train-stop': 8
}

const CRAFTING_TYPES: ReadonlySet<string> = new Set([
  'assembling-machine',
  'furnace',
  'rocket-silo'
])

const MIRRORING_BY_DEFAULT: ReadonlySet<string> = new Set(['inserter', 'mining-drill'])

/** Whether an entity's `direction` turns with a rotation. Unknown prototypes turn. */
export function canRotate(info: EntityPrototypeInfo | undefined): boolean {
  if (!info) return true
  return info.rotatable ?? !NON_ROTATABLE_TYPES.has(info.type)
}

/** Whether mirroring sets the entity's `mirror` flag (`use_mirroring`). */
export function canMirror(info: EntityPrototypeInfo | undefined): boolean {
  if (!info) return false
  return info.mirroring ?? MIRRORING_BY_DEFAULT.has(info.type)
}

export function isRailGrid(info: EntityPrototypeInfo | undefined): boolean {
  return info !== undefined && RAIL_GRID_TYPES.has(info.type)
}

/** The direction value the game writes for `direction` (0–15) of a type. */
export function normalizeDirection(type: string | undefined, direction: number): number {
  const d = ((direction % 16) + 16) % 16
  if (type === undefined) return d
  if (HALF_TURN_SYMMETRIC_TYPES.has(type)) return d % 8
  // 1.1 straight rails: N/S and E/W are one piece each; the four diagonals differ.
  if (type === 'legacy-straight-rail' && d % 4 === 0) return d % 8
  return d
}

export function mirrorOffset(type: string | undefined): number {
  return (type && MIRROR_OFFSET[type]) || 0
}

type Raw = Record<string, unknown>

/**
 * `rotatable` / `mirroring` for the PrototypeDb, read from a dump prototype.
 * A square crafting machine turns only when it has fluid boxes or an output
 * vector (assembling machine 1, furnaces and the silo stay fixed; the 2×3
 * crusher turns).
 */
export function transformTraits(
  type: string,
  proto: Raw,
  size: { width: number; height: number }
): { rotatable?: false; mirroring?: true } {
  const flags = Array.isArray(proto['flags']) ? proto['flags'] : []
  const crafting = CRAFTING_TYPES.has(type)
  const outputVector = proto['vector_to_place_result'] !== undefined
  const fixed =
    flags.includes('not-rotatable') ||
    NON_ROTATABLE_TYPES.has(type) ||
    (crafting && size.width === size.height && !outputVector && !hasFluidBoxes(proto))
  const use = proto['use_mirroring']
  const mirroring =
    typeof use === 'boolean'
      ? use && (crafting || MIRRORING_BY_DEFAULT.has(type))
      : (crafting && outputVector) || MIRRORING_BY_DEFAULT.has(type)
  return { ...(fixed ? { rotatable: false } : {}), ...(mirroring ? { mirroring: true } : {}) }
}

function hasFluidBoxes(proto: Raw): boolean {
  const boxes = proto['fluid_boxes']
  if (Array.isArray(boxes)) return boxes.length > 0
  return typeof boxes === 'object' && boxes !== null && Object.keys(boxes).length > 0
}
