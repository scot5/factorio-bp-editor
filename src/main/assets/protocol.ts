import { protocol } from 'electron'
import { realpathSync } from 'fs'
import { readFile } from 'fs/promises'
import { isAbsolute, join, relative, resolve } from 'path'
import { ASSET_SCHEME, parseAssetUrl, type AssetRequest } from '@core/assets'

/**
 * The `factorio-asset://` protocol. See docs/spec/03-game-assets.md § Asset protocol.
 * Serves files only from the prototype cache's icon folder and the install's
 * `data/<mod>` folders.
 */

export interface AssetRoots {
  /** `<cache>/icons`, or null before game data is loaded. */
  icons: string | null
  /** `<install>/data`, or null without an install. */
  data: string | null
}

/** Must run before `app` is ready. */
export function registerAssetScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: ASSET_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
    }
  ])
}

/**
 * Resolves a request to a file inside its root, or null. Checks the joined path
 * and, when the file exists, its real path (so symlinks cannot leave the root).
 */
export function resolveAssetPath(request: AssetRequest, roots: AssetRoots): string | null {
  const root =
    request.root === 'icons' ? roots.icons : roots.data ? join(roots.data, request.mod) : null
  if (!root) return null
  const target = resolve(root, ...request.segments)
  if (!isInside(root, target)) return null
  try {
    const realRoot = realpathSync(root)
    const realTarget = realpathSync(target)
    if (!isInside(realRoot, realTarget)) return null
  } catch {
    return null // missing file (or root)
  }
  return target
}

function isInside(root: string, target: string): boolean {
  const rel = relative(resolve(root), target)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

export function handleAssetProtocol(getRoots: () => AssetRoots): void {
  protocol.handle(ASSET_SCHEME, async (request) => {
    const parsed = parseAssetUrl(request.url)
    const file = parsed ? resolveAssetPath(parsed, getRoots()) : null
    if (!file) return new Response('Not found', { status: 404 })
    try {
      const body = await readFile(file)
      return new Response(body, {
        headers: {
          'content-type': file.toLowerCase().endsWith('.jpg') ? 'image/jpeg' : 'image/png',
          'cache-control': 'max-age=31536000, immutable',
          // The page has another origin; WebGL only accepts CORS-approved images.
          'access-control-allow-origin': '*'
        }
      })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
}
