import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname } from 'path'

/** App settings, stored as JSON in `<userData>/settings.json` (docs/spec/01-architecture.md § Persistence). */
export interface Settings {
  /** Factorio install chosen by the user; overrides detection. */
  gamePath?: string
}

export class SettingsStore {
  private settings: Settings

  constructor(private readonly file: string) {
    this.settings = SettingsStore.read(file)
  }

  get(): Settings {
    return this.settings
  }

  update(patch: Partial<Settings>): void {
    this.settings = { ...this.settings, ...patch }
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(this.file, JSON.stringify(this.settings, null, 2))
  }

  private static read(file: string): Settings {
    if (!existsSync(file)) return {}
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown
      return parsed && typeof parsed === 'object' ? (parsed as Settings) : {}
    } catch {
      return {} // corrupt settings: start fresh
    }
  }
}
