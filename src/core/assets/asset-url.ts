import type { IconCategory } from '../prototypes/db'

/**
 * URLs of the `factorio-asset://` protocol (docs/spec/03-game-assets.md § Asset protocol):
 *
 *   factorio-asset://icons/<category>/<name>.png   icon from the prototype cache
 *   factorio-asset://data/<mod>/<path>             file from the install's data folder
 *
 * Built and parsed here so the renderer (builder) and main process (parser) agree.
 */
export const ASSET_SCHEME = 'factorio-asset'

export function iconUrl(category: IconCategory, name: string): string {
  return `${ASSET_SCHEME}://icons/${category}/${encodeURIComponent(name)}.png`
}

/** `__base__/graphics/entity/x.png` → `factorio-asset://data/base/graphics/entity/x.png`. */
export function dataUrl(factorioPath: string): string | null {
  const match = /^__([a-z0-9_-]+)__\/(.+)$/i.exec(factorioPath)
  if (!match) return null
  const segments = match[2]!.split('/').map(encodeURIComponent).join('/')
  return `${ASSET_SCHEME}://data/${match[1]}/${segments}`
}

export type AssetRequest =
  { root: 'icons'; segments: string[] } | { root: 'data'; mod: string; segments: string[] }

/**
 * Parses an asset URL into path segments, rejecting anything that could escape
 * its root: `..`, `.`, empty segments, backslashes, drive letters, NUL. The
 * main process still checks the resolved path (and symlinks) before reading.
 */
export function parseAssetUrl(url: string): AssetRequest | null {
  // Parsed by hand: `URL` is a DOM/Node global, not available in src/core.
  const match = /^factorio-asset:\/\/([a-z]+)(\/[^?#]*)$/i.exec(url)
  if (!match) return null
  const parsed = { hostname: match[1]!.toLowerCase(), pathname: match[2]! }
  let segments: string[]
  try {
    segments = parsed.pathname.split('/').slice(1).map(decodeURIComponent)
  } catch {
    return null
  }
  const safe = segments.every(
    (s) => s.length > 0 && s !== '.' && s !== '..' && !/[/\\:\0]/.test(s) && !s.startsWith('~')
  )
  if (!safe || segments.length === 0) return null
  if (!/\.(png|jpg)$/i.test(segments[segments.length - 1]!)) return null

  if (parsed.hostname === 'icons') return segments.length === 2 ? { root: 'icons', segments } : null
  if (parsed.hostname === 'data') {
    const [mod, ...rest] = segments
    if (!mod || !/^[a-z0-9_-]+$/i.test(mod) || rest.length === 0) return null
    return { root: 'data', mod, segments: rest }
  }
  return null
}
