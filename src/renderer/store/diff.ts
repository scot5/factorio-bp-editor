import { create } from 'zustand'
import type { AnalysisSettings, DiffReport } from '@core/analysis'
import type { BookPath, Blueprint } from '@core/model'
import type { PrototypeDb } from '@core/prototypes'
import { onWorkerError, requestAnalysis } from '../analysis/client'
import type { AnalysisResponse } from '../analysis/protocol'

/**
 * Comparison of the blueprint on the canvas with another open blueprint
 * (docs/spec/06-analysis.md § 7 Diff), computed in the analysis worker.
 */

/** A blueprint in an open document: the document and the book path to it. */
export interface DiffTarget {
  docId: string
  path: BookPath
}

interface DiffState {
  /** What the blueprint on the canvas is compared with; null when not comparing. */
  target: DiffTarget | null
  /** Draw the diff on the canvas. */
  overlay: boolean
  status: 'idle' | 'running' | 'done' | 'error'
  report: DiffReport | null
  /** The `after` blueprint the report belongs to. */
  after: Blueprint | null
  error: string | null
  setTarget(target: DiffTarget | null): void
  setOverlay(on: boolean): void
  /** Compares `before` with `after`; a null side clears the report. */
  run(
    before: Blueprint | null,
    after: Blueprint | null,
    db: PrototypeDb | null,
    settings: AnalysisSettings
  ): void
}

let latest = 0
let lastInputs: readonly unknown[] = []

function onResponse(response: AnalysisResponse): void {
  if (response.id !== latest) return
  if (!response.ok) useDiff.setState({ status: 'error', report: null, error: response.message })
  else if (response.kind === 'diff')
    useDiff.setState({ status: 'done', report: response.diff, error: null })
}

onWorkerError((message) => {
  if (latest) useDiff.setState({ status: 'error', error: message })
})

export const useDiff = create<DiffState>()((set) => ({
  target: null,
  overlay: true,
  status: 'idle',
  report: null,
  after: null,
  error: null,

  setTarget(target) {
    set({ target })
  },

  setOverlay(overlay) {
    set({ overlay })
  },

  run(before, after, db, settings) {
    const inputs = [before, after, db, settings]
    if (inputs.every((v, i) => v === lastInputs[i])) return
    lastInputs = inputs
    if (!before || !after) {
      latest = 0
      set({ status: 'idle', report: null, after: null, error: null })
      return
    }
    set({ status: 'running', after, error: null })
    latest = requestAnalysis({ kind: 'diff', before, after, settings }, db, onResponse)
  }
}))
