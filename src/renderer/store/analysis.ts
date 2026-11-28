import { create } from 'zustand'
import {
  DEFAULT_ANALYSIS_SETTINGS,
  type AnalysisResult,
  type AnalysisSettings
} from '@core/analysis'
import type { Blueprint } from '@core/model'
import type { PrototypeDb } from '@core/prototypes'
import { currentWorkerDb, onWorkerError, requestAnalysis } from '../analysis/client'
import type { AnalysisResponse } from '../analysis/protocol'

/**
 * Analysis of the active blueprint, computed in a Web Worker
 * (docs/spec/06-analysis.md). Only the latest request's result is kept.
 */
interface AnalysisState {
  status: 'idle' | 'running' | 'done' | 'error'
  result: AnalysisResult | null
  /** The blueprint the result belongs to. */
  blueprint: Blueprint | null
  error: string | null
  settings: AnalysisSettings
  /** Analyses `blueprint` with `db`; null clears the result. */
  run(blueprint: Blueprint | null, db: PrototypeDb | null): void
  /** Changes the settings and analyses the current blueprint again. */
  setSettings(settings: AnalysisSettings): void
}

let latest = 0

function onResponse(response: AnalysisResponse): void {
  if (response.id !== latest) return
  if (!response.ok) useAnalysis.setState({ status: 'error', result: null, error: response.message })
  else if (response.kind === 'analyse')
    useAnalysis.setState({ status: 'done', result: response.result, error: null })
}

onWorkerError((message) => {
  if (latest) useAnalysis.setState({ status: 'error', error: message })
})

export const useAnalysis = create<AnalysisState>()((set, get) => ({
  status: 'idle',
  result: null,
  blueprint: null,
  error: null,
  settings: DEFAULT_ANALYSIS_SETTINGS,

  run(blueprint, db) {
    if (blueprint === get().blueprint && db === currentWorkerDb()) return
    analyseNow(blueprint, db)
  },

  setSettings(settings) {
    set({ settings })
    analyseNow(get().blueprint, currentWorkerDb() ?? null)
  }
}))

function analyseNow(blueprint: Blueprint | null, db: PrototypeDb | null): void {
  const set = useAnalysis.setState
  if (!blueprint) {
    latest = 0
    set({ status: 'idle', result: null, blueprint: null, error: null })
    return
  }
  set({ status: 'running', blueprint, error: null })
  latest = requestAnalysis(
    { kind: 'analyse', blueprint, settings: useAnalysis.getState().settings },
    db,
    onResponse
  )
}
