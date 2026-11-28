import type { PrototypeDb } from '@core/prototypes'
import type { AnalysisRequest, AnalysisResponse } from './protocol'

/**
 * The one analysis Web Worker, shared by the analysis and diff stores. Sends
 * the DB only when it changes and routes each response to its request.
 */

type Request = Exclude<AnalysisRequest, { kind: 'db' }>
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

let worker: Worker | null = null
let workerDb: PrototypeDb | null | undefined
let nextId = 1
const pending = new Map<number, (response: AnalysisResponse) => void>()
const failures = new Set<(message: string) => void>()

function post(request: AnalysisRequest): void {
  if (!worker) {
    worker = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<AnalysisResponse>) => {
      const done = pending.get(event.data.id)
      pending.delete(event.data.id)
      done?.(event.data)
    }
    worker.onerror = (event) => {
      pending.clear()
      for (const fail of failures) fail(event.message || 'Analysis worker failed.')
    }
  }
  worker.postMessage(request)
}

/** The DB the worker holds (undefined before the first request). */
export function currentWorkerDb(): PrototypeDb | null | undefined {
  return workerDb
}

/** Sends `request` with `db`; `onResponse` gets the worker's answer. Returns the request id. */
export function requestAnalysis(
  request: DistributiveOmit<Request, 'id'>,
  db: PrototypeDb | null,
  onResponse: (response: AnalysisResponse) => void
): number {
  if (db !== workerDb) {
    post({ kind: 'db', db })
    workerDb = db
  }
  const id = nextId++
  pending.set(id, onResponse)
  post({ ...request, id } as Request)
  return id
}

/** Called with the message when the worker itself fails. Returns an unsubscribe function. */
export function onWorkerError(listener: (message: string) => void): () => void {
  failures.add(listener)
  return () => failures.delete(listener)
}
