import { describe, expect, it } from 'vitest'
import { formatVersion, packVersion, unpackVersion } from './version'

describe('version', () => {
  it('unpacks 2.1.25.10 (from the 2.1.25 corpus)', () => {
    expect(unpackVersion(562954250027018)).toEqual({ major: 2, minor: 1, patch: 25, build: 10 })
  })

  it('round-trips 1.1.x versions from the legacy corpus', () => {
    for (const v of [
      { major: 1, minor: 1, patch: 34, build: 0 },
      { major: 1, minor: 1, patch: 107, build: 0 },
      { major: 2, minor: 0, patch: 77, build: 0 }
    ]) {
      expect(unpackVersion(packVersion(v))).toEqual(v)
    }
  })

  it('packs without 32-bit truncation', () => {
    expect(packVersion({ major: 2, minor: 1, patch: 25, build: 10 })).toBe(562954250027018)
  })

  it('handles the largest parts', () => {
    const max = { major: 31, minor: 0xffff, patch: 0xffff, build: 0xffff }
    expect(unpackVersion(packVersion(max))).toEqual(max)
  })

  it('rejects versions that do not fit in a safe integer', () => {
    expect(() => packVersion({ major: 32, minor: 0, patch: 0, build: 0 })).toThrow(RangeError)
    expect(() => unpackVersion(2 ** 53)).toThrow(RangeError)
    expect(() => unpackVersion(-1)).toThrow(RangeError)
    expect(() => packVersion({ major: 2, minor: 0x10000, patch: 0, build: 0 })).toThrow(RangeError)
  })

  it('formats', () => {
    const v = { major: 2, minor: 1, patch: 25, build: 10 }
    expect(formatVersion(v)).toBe('2.1.25')
    expect(formatVersion(v, true)).toBe('2.1.25.10')
  })
})
