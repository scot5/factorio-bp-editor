import { layoutBlueprint, type Blueprint } from '../model'
import { dbPrototypeLookup, fallbackPrototypeLookup, type PrototypeDb } from '../prototypes'
import { inventory, type InventoryReport } from './inventory'
import { power, type PowerReport } from './power'

export * from './effects'
export * from './format'
export * from './inventory'
export * from './power'

/**
 * Blueprint analysis (docs/spec/06-analysis.md). A pure function of
 * `(blueprint, PrototypeDb, settings)`; the renderer runs it in a Web Worker.
 */

export interface AnalysisSettings {
  timeUnit: 'second' | 'minute' | 'hour'
  /** Planet the blueprint is built on, for solar output (default `nauvis`). */
  planet?: string
  /** Built on a space platform in the planet's orbit; undefined detects it from the blueprint. */
  space?: boolean
}

export const DEFAULT_ANALYSIS_SETTINGS: AnalysisSettings = { timeUnit: 'minute' }

export interface AnalysisResult {
  /** Whether game data was available; rate-based reports need it. */
  hasGameData: boolean
  /** Time unit of the rate reports (M4 PR 3). */
  timeUnit: AnalysisSettings['timeUnit']
  inventory: InventoryReport
  /** Needs game data; null without it. */
  power: PowerReport | null
}

export function analyse(
  blueprint: Blueprint,
  db: PrototypeDb | null,
  settings: AnalysisSettings = DEFAULT_ANALYSIS_SETTINGS
): AnalysisResult {
  const layout = layoutBlueprint(blueprint, db ? dbPrototypeLookup(db) : fallbackPrototypeLookup)
  return {
    hasGameData: db !== null,
    timeUnit: settings.timeUnit,
    inventory: inventory(blueprint, layout, db),
    power: db
      ? power(db, layout, {
          ...(settings.planet ? { planet: settings.planet } : {}),
          ...(settings.space === undefined ? {} : { space: settings.space })
        })
      : null
  }
}
