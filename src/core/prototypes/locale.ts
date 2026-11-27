/**
 * English display names from the game's locale files
 * (`data/<mod>/locale/en/*.cfg`). See docs/spec/03-game-assets.md § Display names.
 *
 * The files are INI-like: `[section]` headers, then `key=value` lines. The
 * flat dictionary keys are `<section>.<key>`, the form LocalisedStrings use
 * (`"entity-name.assembling-machine-2"`).
 */

export type Locale = Record<string, string>

/** Prototype categories that get a display name in the DB. */
export type NameCategory =
  'entity' | 'item' | 'recipe' | 'fluid' | 'tile' | 'virtual-signal' | 'quality' | 'space-location'

/** Parses one locale file into `out` (later files win, as in the game's load order). */
export function parseLocaleCfg(text: string, out: Locale = {}): Locale {
  let section = ''
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith(';') || line.startsWith('#')) continue
    const header = /^\[([^\]]+)\]$/.exec(line)
    if (header) {
      section = header[1]!.trim()
      continue
    }
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    out[section ? `${section}.${key}` : key] = line.slice(eq + 1)
  }
  return out
}

const REFERENCE: Readonly<Record<string, string>> = {
  ENTITY: 'entity-name',
  ITEM: 'item-name',
  FLUID: 'fluid-name',
  TILE: 'tile-name',
  RECIPE: 'recipe-name',
  'SPACE-LOCATION': 'space-location-name'
}

const MAX_DEPTH = 8

/**
 * Resolves a LocalisedString (`"text"`, `["key", ...params]`, or `["", ...parts]`)
 * against the locale. Returns undefined when the key is missing.
 * Handles `__1__` parameters and `__ENTITY__name__` style references; other
 * `__…__` forms (controls, plurals) are left out.
 */
export function localise(value: unknown, locale: Locale, depth = 0): string | undefined {
  if (depth > MAX_DEPTH) return undefined
  if (typeof value === 'string') return expand(value, [], locale, depth)
  if (typeof value === 'number') return String(value)
  if (!Array.isArray(value) || typeof value[0] !== 'string') return undefined
  const [key, ...params] = value as [string, ...unknown[]]
  if (key === '') {
    const parts = params.map((p) => localise(p, locale, depth + 1))
    return parts.some((p) => p === undefined) ? undefined : parts.join('')
  }
  const template = locale[key]
  return template === undefined ? undefined : expand(template, params, locale, depth)
}

function expand(template: string, params: unknown[], locale: Locale, depth: number): string {
  return template
    .replace(
      /__(\d+)__/g,
      (_, n: string) => localise(params[Number(n) - 1], locale, depth + 1) ?? ''
    )
    .replace(/__([A-Z-]+)__(.+?)__/g, (whole, kind: string, name: string) => {
      const section = REFERENCE[kind]
      if (!section) return whole
      return localise([`${section}.${name}`], locale, depth + 1) ?? name
    })
    .replace(/\\n/g, ' ')
}
