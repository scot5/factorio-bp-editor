import type { AnalysisResult, AnalysisSettings } from '@core/analysis'
import type { Blueprint } from '@core/model'
import type { PrototypeDb } from '@core/prototypes'

/** Messages between the renderer and the analysis worker (docs/spec/06-analysis.md). */

export type AnalysisRequest =
  /** Sent once per database change, so each analysis does not copy the DB again. */
  | { kind: 'db'; db: PrototypeDb | null }
  | { kind: 'analyse'; id: number; blueprint: Blueprint; settings: AnalysisSettings }

export type AnalysisResponse =
  | { id: number; ok: true; result: AnalysisResult; ms: number }
  | { id: number; ok: false; message: string }
