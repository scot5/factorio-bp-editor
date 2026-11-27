/**
 * Factorio's packed version number: major.minor.patch.build, 16 bits each.
 * See docs/spec/02-blueprint-format.md § Version handling.
 *
 * Values exceed 32 bits, so this uses multiplication and division. JS bitwise
 * operators would truncate to 32 bits.
 */

export interface GameVersion {
  major: number
  minor: number
  patch: number
  build: number
}

const PART = 0x10000 // 2^16

export function unpackVersion(packed: number): GameVersion {
  if (!Number.isSafeInteger(packed) || packed < 0) {
    throw new RangeError(`Not a valid packed version: ${packed}`)
  }
  const build = packed % PART
  const patch = Math.floor(packed / PART) % PART
  const minor = Math.floor(packed / PART ** 2) % PART
  const major = Math.floor(packed / PART ** 3)
  return { major, minor, patch, build }
}

export function packVersion({ major, minor, patch, build }: GameVersion): number {
  for (const part of [minor, patch, build]) {
    if (!Number.isInteger(part) || part < 0 || part >= PART) {
      throw new RangeError(`Version part out of range: ${part}`)
    }
  }
  const packed = ((major * PART + minor) * PART + patch) * PART + build
  if (!Number.isSafeInteger(packed) || major < 0) {
    throw new RangeError(
      `Version does not fit in a safe integer: ${major}.${minor}.${patch}.${build}`
    )
  }
  return packed
}

/** "2.1.25", or "2.1.25.10" with `withBuild`. */
export function formatVersion(v: GameVersion, withBuild = false): string {
  const base = `${v.major}.${v.minor}.${v.patch}`
  return withBuild ? `${base}.${v.build}` : base
}
