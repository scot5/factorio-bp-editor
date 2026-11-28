import { analyse, compare } from '@core/analysis'
import type { PrototypeDb } from '@core/prototypes'
import type { AnalysisRequest, AnalysisResponse } from './protocol'

/**
 * Analysis Web Worker. Runs the pure `analyse()` and `compare()` from src/core
 * off the UI thread (docs/spec/01-architecture.md, 06-analysis.md).
 */

interface WorkerScope {
  onmessage: ((event: MessageEvent<AnalysisRequest>) => void) | null
  postMessage(message: AnalysisResponse): void
}

const scope = self as unknown as WorkerScope
let db: PrototypeDb | null = null

scope.onmessage = (event) => {
  const request = event.data
  if (request.kind === 'db') {
    db = request.db
    return
  }
  const start = performance.now()
  try {
    if (request.kind === 'analyse') {
      const result = analyse(request.blueprint, db, request.settings)
      scope.postMessage({
        id: request.id,
        ok: true,
        kind: 'analyse',
        result,
        ms: performance.now() - start
      })
    } else {
      const diff = compare(request.before, request.after, db, request.settings)
      scope.postMessage({
        id: request.id,
        ok: true,
        kind: 'diff',
        diff,
        ms: performance.now() - start
      })
    }
  } catch (error) {
    scope.postMessage({
      id: request.id,
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    })
  }
}
