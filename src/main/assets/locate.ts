import { execFile } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { promisify } from 'util'
import { parseSteamLibraryFolders } from '@core/assets'

/**
 * Finding the Factorio install. See docs/spec/03-game-assets.md § Locating the install.
 * Order: saved setting → Steam libraries → common standalone paths. The caller
 * falls back to asking the user.
 */

export interface FactorioInstall {
  /** Game root: contains `data/` (on macOS the app's `Contents` folder). */
  path: string
  version: string
  executable: string
}

const execFileAsync = promisify(execFile)

function executableFor(root: string): string {
  if (process.platform === 'win32') return join(root, 'bin', 'x64', 'factorio.exe')
  if (process.platform === 'darwin') return join(root, 'MacOS', 'factorio')
  return join(root, 'bin', 'x64', 'factorio')
}

/** A folder is an install when it has `data/base/info.json` and the game executable. */
export function validateInstall(root: string): FactorioInstall | null {
  const info = join(root, 'data', 'base', 'info.json')
  const executable = executableFor(root)
  if (!existsSync(info) || !existsSync(executable)) return null
  try {
    const { version } = JSON.parse(readFileSync(info, 'utf8')) as { version?: unknown }
    if (typeof version !== 'string') return null
    return { path: root, version, executable }
  } catch {
    return null
  }
}

async function steamRoots(): Promise<string[]> {
  const roots: string[] = []
  if (process.platform === 'win32') {
    try {
      const { stdout } = await execFileAsync(
        'reg',
        ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'],
        {
          windowsHide: true,
          timeout: 5000
        }
      )
      const match = /SteamPath\s+REG_SZ\s+(.+)/.exec(stdout)
      if (match) roots.push(match[1]!.trim())
    } catch {
      // Steam not installed, or registry not readable.
    }
    roots.push('C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam')
  } else if (process.platform === 'darwin') {
    roots.push(join(homedir(), 'Library', 'Application Support', 'Steam'))
  } else {
    roots.push(join(homedir(), '.steam', 'steam'), join(homedir(), '.local', 'share', 'Steam'))
  }
  return roots
}

/** Candidate install folders, most likely first, without duplicates. */
export async function installCandidates(): Promise<string[]> {
  const candidates: string[] = []
  for (const steam of await steamRoots()) {
    for (const vdf of [
      join(steam, 'steamapps', 'libraryfolders.vdf'),
      join(steam, 'config', 'libraryfolders.vdf')
    ]) {
      if (!existsSync(vdf)) continue
      try {
        for (const library of parseSteamLibraryFolders(readFileSync(vdf, 'utf8'))) {
          const game = join(library, 'steamapps', 'common', 'Factorio')
          candidates.push(
            process.platform === 'darwin' ? join(game, 'factorio.app', 'Contents') : game
          )
        }
      } catch {
        // Unreadable library file: skip.
      }
    }
    candidates.push(join(steam, 'steamapps', 'common', 'Factorio'))
  }
  if (process.platform === 'win32') {
    candidates.push('C:\\Program Files\\Factorio', 'C:\\Program Files (x86)\\Factorio')
  } else if (process.platform === 'darwin') {
    candidates.push('/Applications/factorio.app/Contents')
  } else {
    candidates.push(join(homedir(), 'factorio'), '/opt/factorio')
  }
  const seen = new Set<string>()
  return candidates.filter((c) => {
    const key = process.platform === 'win32' ? c.toLowerCase() : c
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export async function findInstall(savedPath?: string): Promise<FactorioInstall | null> {
  if (savedPath) {
    const saved = validateInstall(savedPath)
    if (saved) return saved
  }
  for (const candidate of await installCandidates()) {
    const install = validateInstall(candidate)
    if (install) return install
  }
  return null
}

/** Per-user data folder Factorio uses when `use-system-read-write-data-directories=true`. */
export function systemWriteDataDir(): string {
  if (process.platform === 'win32')
    return join(process.env['APPDATA'] ?? join(homedir(), 'AppData', 'Roaming'), 'Factorio')
  if (process.platform === 'darwin')
    return join(homedir(), 'Library', 'Application Support', 'factorio')
  return join(homedir(), '.factorio')
}
