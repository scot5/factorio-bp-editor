import { execFile } from 'child_process'
import { existsSync, readdirSync, readFileSync } from 'fs'
import { dirname, join } from 'path'
import { parseEnabledMods, resolveWriteDataDir } from '@core/assets'
import { parseLocaleCfg, type Locale } from '@core/prototypes'
import { systemWriteDataDir, type FactorioInstall } from './locate'

/** Folder where Factorio writes mods, saves and `script-output` for this install. */
export function writeDataDir(install: FactorioInstall): string {
  const cfgPath = join(install.path, 'config-path.cfg')
  return resolveWriteDataDir(
    existsSync(cfgPath) ? readFileSync(cfgPath, 'utf8') : null,
    {
      installDir: install.path,
      executableDir: dirname(install.executable),
      systemWriteData: systemWriteDataDir(),
      systemReadData: join(install.path, 'data')
    },
    (configDir) => {
      const ini = join(configDir, 'config.ini')
      return existsSync(ini) ? readFileSync(ini, 'utf8') : null
    }
  )
}

export interface ModInfo {
  name: string
  version: string
}

/**
 * Enabled mods and their versions. Built-in mods (base, space-age, …) take their
 * version from `data/<mod>/info.json`; downloaded mods from `<name>_<version>.zip`
 * or folder names in the mods directory.
 */
export function enabledMods(install: FactorioInstall, writeData: string): ModInfo[] {
  const modList = join(writeData, 'mods', 'mod-list.json')
  const names = existsSync(modList) ? parseEnabledMods(readFileSync(modList, 'utf8')) : ['base']
  const modsDir = join(writeData, 'mods')
  const modFiles = existsSync(modsDir) ? readdirSync(modsDir) : []
  return names.map((name) => {
    const builtin = join(install.path, 'data', name, 'info.json')
    if (existsSync(builtin)) {
      const { version } = JSON.parse(readFileSync(builtin, 'utf8')) as { version: string }
      return { name, version }
    }
    const versions = modFiles
      .map(
        (f) =>
          new RegExp(
            `^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_(\\d+\\.\\d+\\.\\d+)(\\.zip)?$`
          ).exec(f)?.[1]
      )
      .filter((v): v is string => v !== undefined)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    return { name, version: versions[versions.length - 1] ?? 'unknown' }
  })
}

/**
 * English locale of the built-in mods (`data/core` first, then the enabled mods
 * in load order), read from `data/<mod>/locale/en/*.cfg`. Downloaded mods are
 * not read yet (they may be zips; M7).
 */
export function readLocale(install: FactorioInstall, mods: ModInfo[]): Locale {
  const locale: Locale = {}
  for (const name of ['core', ...mods.map((m) => m.name)]) {
    const dir = join(install.path, 'data', name, 'locale', 'en')
    if (!existsSync(dir)) continue
    for (const file of readdirSync(dir)
      .filter((f) => f.endsWith('.cfg'))
      .sort())
      parseLocaleCfg(readFileSync(join(dir, file), 'utf8'), locale)
  }
  return locale
}

/** The game is running: Factorio holds an exclusive lock on its write-data folder. */
export class GameRunningError extends Error {
  constructor() {
    super('Factorio is running. Close the game and try again.')
    this.name = 'GameRunningError'
  }
}

/**
 * Runs the game binary with dump flags (`--dump-data`, `--dump-icon-sprites`).
 * Results go to `<write-data>/script-output`.
 *
 * `SteamAppId` keeps a Steam build from restarting itself through Steam (which
 * would detach from us, ignore the result and keep the lock); it only affects
 * this child process.
 */
export function runFactorio(
  install: FactorioInstall,
  args: string[],
  timeoutMs = 5 * 60_000
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      install.executable,
      args,
      {
        cwd: dirname(install.executable),
        env: { ...process.env, SteamAppId: '427520', SteamGameId: '427520' },
        timeout: timeoutMs,
        windowsHide: true,
        maxBuffer: 64 * 1024 * 1024
      },
      (error, stdout, stderr) => {
        const output = `${stdout}\n${stderr}`
        if (/Couldn't create lock file|Is another instance already running/i.test(output)) {
          reject(new GameRunningError())
        } else if (error) {
          const last = output.trim().split(/\r?\n/).slice(-5).join('\n')
          reject(new Error(`Factorio ${args.join(' ')} failed: ${error.message}\n${last}`))
        } else {
          resolve(output)
        }
      }
    )
  })
}
