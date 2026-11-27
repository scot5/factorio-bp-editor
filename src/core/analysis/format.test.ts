import { describe, expect, it } from 'vitest'
import { formatJoules, formatSi, formatWatts } from './format'

describe('formatSi', () => {
  it('uses three significant digits and SI prefixes', () => {
    expect(formatWatts(387_500)).toBe('388 kW')
    expect(formatWatts(5_820_000)).toBe('5.82 MW')
    expect(formatWatts(41_100_000)).toBe('41.1 MW')
    expect(formatWatts(2.4e9)).toBe('2.4 GW')
    expect(formatWatts(400)).toBe('400 W')
    expect(formatWatts(999.7)).toBe('1 kW')
    expect(formatWatts(0)).toBe('0 W')
    expect(formatJoules(5e6)).toBe('5 MJ')
    expect(formatSi(-1500, 'W')).toBe('-1.5 kW')
    expect(formatSi(Number.NaN, 'W')).toBe('– W')
  })
})
