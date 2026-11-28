/** Number formatting for the analysis reports, in the game's style (`1.5 MW`, `5 MJ`). */

const PREFIXES = ['', 'k', 'M', 'G', 'T', 'P', 'E']

/** `value` with an SI prefix and three significant digits, e.g. `388 kW`, `5.82 MW`. */
export function formatSi(value: number, unit: string): string {
  if (!Number.isFinite(value)) return `– ${unit}`
  if (value === 0) return `0 ${unit}`
  let scaled = Math.abs(value)
  let i = 0
  while (scaled >= 999.5 && i < PREFIXES.length - 1) {
    scaled /= 1000
    i++
  }
  let digits = 2
  if (scaled >= 99.95) digits = 0
  else if (scaled >= 9.995) digits = 1
  const text = Number(scaled.toFixed(digits)).toString()
  return `${value < 0 ? '-' : ''}${text} ${PREFIXES[i]}${unit}`
}

export const formatWatts = (w: number): string => formatSi(w, 'W')
export const formatJoules = (j: number): string => formatSi(j, 'J')

export type TimeUnit = 'second' | 'minute' | 'hour'

/** Seconds per time unit. */
export const TIME_UNIT_SECONDS: Readonly<Record<TimeUnit, number>> = {
  second: 1,
  minute: 60,
  hour: 3600
}

const UNIT_SUFFIX: Readonly<Record<TimeUnit, string>> = { second: '/s', minute: '/min', hour: '/h' }

/**
 * A per-second rate in `unit`, with three significant digits and `k`/`M` above
 * 1000, as the game's production stats show it: `30/min`, `0.75/s`, `1.2k/h`.
 */
export function formatRate(perSecond: number, unit: TimeUnit): string {
  const value = perSecond * TIME_UNIT_SECONDS[unit]
  const suffix = UNIT_SUFFIX[unit]
  if (!Number.isFinite(value)) return `–${suffix}`
  const abs = Math.abs(value)
  if (abs < 999.5) {
    const text = abs < 0.0005 ? '0' : Number(abs.toPrecision(3)).toString()
    return `${value < 0 && text !== '0' ? '-' : ''}${text}${suffix}`
  }
  return `${formatSi(value, '').replace(' ', '')}${suffix}`
}

/** Sort comparator: highest count first, then by name. */
export const byCountThenName =
  <T extends { count: number }>(name: (r: T) => string) =>
  (a: T, b: T): number =>
    b.count - a.count || name(a).localeCompare(name(b))
