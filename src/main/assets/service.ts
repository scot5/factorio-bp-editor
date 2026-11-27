import { createHash } from 'crypto'
import { existsSync, readdirSync } from 'fs'
import { cp, mkdir, readFile, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import type { AssetStatus } from '@core/ipc'
import {
  buildPrototypeDb,
  DB_FORMAT_VERSION,
  type IconCategory,
  type PrototypeDb
} from '@core/prototypes'
import {
  enabledMods,
  GameRunningError,
  readLocale,
  runFactorio,
  writeDataDir,
  type ModInfo
} from './factorio'
import { findInstall, validateInstall, type FactorioInstall } from './locate'
import type { AssetRoots } from './protocol'
import type { SettingsStore } from '../settings'

/**
 * Game data for the app: the install, the prototype database and icons.
 * See docs/spec/03-game-assets.md.
 *
 * Cache: `<userData>/prototype-cache/<game version>-<mods hash>-f<format>/`
 *   prototype-db.json
 *   icons/<category>/<name>.png   (copied from `--dump-icon-sprites`)
 *
 * The game is only started when the user asks (`load`), never automatically.
 */

const ICON_CATEGORIES: IconCategory[] = [
  'item',
  'entity',
  'recipe',
  'fluid',
  'virtual-signal',
  'tile',
  'quality',
  'technology',
  'space-location',
  'item-group',
  'equipment',
  'asteroid-chunk'
]

export class AssetService {
  private status: AssetStatus = { state: 'detecting' }
  private install: FactorioInstall | null = null
  private cacheDir: string | null = null
  private db: PrototypeDb | null = null
  private listeners = new Set<(status: AssetStatus) => void>()

  constructor(
    private readonly cacheRoot: string,
    private readonly settings: SettingsStore
  ) {}

  getStatus(): AssetStatus {
    return this.status
  }

  onStatus(listener: (status: AssetStatus) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  roots(): AssetRoots {
    return {
      icons: this.status.state === 'ready' && this.cacheDir ? join(this.cacheDir, 'icons') : null,
      data: this.install ? join(this.install.path, 'data') : null
    }
  }

  async getDb(): Promise<PrototypeDb | null> {
    if (this.db) return this.db
    if (this.status.state !== 'ready' || !this.cacheDir) return null
    this.db = JSON.parse(
      await readFile(join(this.cacheDir, 'prototype-db.json'), 'utf8')
    ) as PrototypeDb
    return this.db
  }

  /** Finds the install and checks for a usable cache. Never starts the game. */
  async detect(): Promise<AssetStatus> {
    this.setStatus({ state: 'detecting' })
    this.db = null
    this.install = await findInstall(this.settings.get().gamePath)
    if (!this.install) return this.setStatus({ state: 'no-install' })
    const { key, mods } = this.cacheKey(this.install)
    this.cacheDir = join(this.cacheRoot, key)
    const base = { install: { path: this.install.path, version: this.install.version }, mods }
    if (existsSync(join(this.cacheDir, 'prototype-db.json')))
      return this.setStatus({ state: 'ready', ...base })
    return this.setStatus({ state: 'not-loaded', ...base })
  }

  /** Uses a folder the user picked. Returns false if it is not a Factorio install. */
  async setGamePath(path: string): Promise<boolean> {
    if (!validateInstall(path)) return false
    this.settings.update({ gamePath: path })
    await this.detect()
    return true
  }

  /** Runs the game's data and icon dumps and builds the cache. */
  async load(): Promise<AssetStatus> {
    if (!this.install || !this.cacheDir) await this.detect()
    const install = this.install
    const cacheDir = this.cacheDir
    if (!install || !cacheDir) return this.status
    const { mods } = this.cacheKey(install)
    const base = { install: { path: install.path, version: install.version }, mods }
    const scriptOutput = join(writeDataDir(install), 'script-output')

    try {
      this.setStatus({ state: 'loading', ...base, message: 'Reading prototypes from Factorio…' })
      await runFactorio(install, ['--dump-data'])
      this.setStatus({ state: 'loading', ...base, message: 'Rendering icons with Factorio…' })
      await runFactorio(install, ['--dump-icon-sprites'])

      this.setStatus({ state: 'loading', ...base, message: 'Building the prototype database…' })
      const raw = JSON.parse(await readFile(join(scriptOutput, 'data-raw-dump.json'), 'utf8'))
      const db = buildPrototypeDb(raw, {
        gameVersion: install.version,
        mods,
        locale: readLocale(install, mods)
      })

      await rm(cacheDir, { recursive: true, force: true })
      await mkdir(join(cacheDir, 'icons'), { recursive: true })
      for (const category of ICON_CATEGORIES) {
        const from = join(scriptOutput, category)
        if (!existsSync(from)) continue
        await cp(from, join(cacheDir, 'icons', category), { recursive: true })
        db.icons[category] = readdirSync(from)
          .filter((f) => f.endsWith('.png'))
          .map((f) => f.slice(0, -4))
          .sort()
      }
      await writeFile(join(cacheDir, 'prototype-db.json'), JSON.stringify(db))
      this.db = db
      return this.setStatus({ state: 'ready', ...base })
    } catch (error) {
      return this.setStatus({
        state: 'error',
        ...base,
        message:
          error instanceof GameRunningError
            ? error.message
            : String(error instanceof Error ? error.message : error),
        gameRunning: error instanceof GameRunningError
      })
    }
  }

  private cacheKey(install: FactorioInstall): { key: string; mods: ModInfo[] } {
    const mods = enabledMods(install, writeDataDir(install))
    const hash = createHash('sha1').update(JSON.stringify(mods)).digest('hex').slice(0, 10)
    return { key: `${install.version}-${hash}-f${DB_FORMAT_VERSION}`, mods }
  }

  private setStatus(status: AssetStatus): AssetStatus {
    this.status = status
    for (const listener of this.listeners) listener(status)
    return status
  }
}
