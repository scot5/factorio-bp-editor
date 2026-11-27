import { layoutBlueprint, type Blueprint } from '../model'
import { dbPrototypeLookup, fallbackPrototypeLookup, type PrototypeDb } from '../prototypes'
import { inventory, type InventoryReport } from './inventory'

export * from './inventory'

/**
 * Blueprint analysis (docs/spec/06-analysis.md). A pure function of
 * `(blueprint, PrototypeDb, settings)`; the renderer runs it in a Web Worker.
 */

export interface AnalysisSettings {
  timeUnit: 'second' | 'minute' | 'hour'
}

export const DEFAULT_ANALYSIS_SETTINGS: AnalysisSettings = { timeUnit: 'minute' }

export interface AnalysisResult {
  /** Whether game data was available; rate-based reports need it. */
  hasGameData: boolean
  /** Time unit of the rate reports (M4 PR 3). */
  timeUnit: AnalysisSettings['timeUnit']
  inventory: InventoryReport
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
    inventory: inventory(blueprint, layout, db)
  }
}
