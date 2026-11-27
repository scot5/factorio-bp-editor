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
