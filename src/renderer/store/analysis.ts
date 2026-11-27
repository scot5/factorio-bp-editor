import { create } from 'zustand'
import {
  DEFAULT_ANALYSIS_SETTINGS,
  type AnalysisResult,
  type AnalysisSettings
} from '@core/analysis'
import type { Blueprint } from '@core/model'
import type { PrototypeDb } from '@core/prototypes'
import type { AnalysisRequest, AnalysisResponse } from '../analysis/protocol'

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

let worker: Worker | null = null
let workerDb: PrototypeDb | null | undefined
let nextId = 1

function post(request: AnalysisRequest): void {
  if (!worker) {
    worker = new Worker(new URL('../analysis/analysis.worker.ts', import.meta.url), {
      type: 'module'
    })
    worker.onmessage = (event: MessageEvent<AnalysisResponse>) => onResponse(event.data)
    worker.onerror = (event) => {
      useAnalysis.setState({ status: 'error', error: event.message || 'Analysis worker failed.' })
    }
  }
  worker.postMessage(request)
}

let latest = 0

function onResponse(response: AnalysisResponse): void {
  if (response.id !== latest) return
  if (response.ok) useAnalysis.setState({ status: 'done', result: response.result, error: null })
  else useAnalysis.setState({ status: 'error', result: null, error: response.message })
}

export const useAnalysis = create<AnalysisState>()((set, get) => ({
  status: 'idle',
  result: null,
  blueprint: null,
  error: null,
  settings: DEFAULT_ANALYSIS_SETTINGS,

  run(blueprint, db) {
    if (blueprint === get().blueprint && db === workerDb) return
    analyseNow(blueprint, db)
  },

  setSettings(settings) {
    set({ settings })
    analyseNow(get().blueprint, workerDb ?? null)
  }
}))

function analyseNow(blueprint: Blueprint | null, db: PrototypeDb | null): void {
  const set = useAnalysis.setState
  if (!blueprint) {
    latest = 0
    set({ status: 'idle', result: null, blueprint: null, error: null })
    return
  }
  if (db !== workerDb) {
    post({ kind: 'db', db })
    workerDb = db
  }
  latest = nextId++
  set({ status: 'running', blueprint, error: null })
  post({ kind: 'analyse', id: latest, blueprint, settings: useAnalysis.getState().settings })
}
