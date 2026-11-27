import { useState } from 'react'
import {
  materialsText,
  type EntityCountRow,
  type InventoryReport,
  type MaterialRow
} from '@core/analysis'
import { displayName, type PrototypeDb } from '@core/prototypes'
import { CountTable, type Row } from './CountTable'
import { PowerSection } from './PowerSection'
import { ProductionSection } from './ProductionSection'
import { useAnalysis } from '../store/analysis'
import { useAssets } from '../store/assets'

interface Props {
  /** True when the analysis result belongs to the blueprint on the canvas. */
  current: boolean
  onSelect(indexes: number[]): void
}

const SOURCE_LABELS: Record<MaterialRow['sources'][number], string> = {
  entity: 'placed',
  'insert-plan': 'inserted',
  tile: 'tile'
}

/** Analysis reports of the active blueprint (docs/spec/06-analysis.md). Inventory, production and power. */
export function AnalysisPanel({ current, onSelect }: Readonly<Props>): React.JSX.Element {
  const status = useAnalysis((s) => s.status)
  const result = useAnalysis((s) => s.result)
  const error = useAnalysis((s) => s.error)

  if (status === 'error') return <p className="p-3 text-danger">Analysis failed: {error}</p>
  if (!result || !current) {
    return (
      <p className="p-3 text-ink-muted" data-testid="analysis-pending">
        {status === 'idle' ? 'Select a blueprint to analyse it.' : 'Analysing…'}
      </p>
    )
  }
  return (
    <div data-testid="analysis-panel">
      <Inventory report={result.inventory} hasGameData={result.hasGameData} onSelect={onSelect} />
      <ProductionSection report={result.production} onSelect={onSelect} />
      <PowerSection report={result.power} onSelect={onSelect} />
    </div>
  )
}

function Inventory({
  report,
  hasGameData,
  onSelect
}: Readonly<{
  report: InventoryReport
  hasGameData: boolean
  onSelect(indexes: number[]): void
}>): React.JSX.Element {
  const db = useAssets((s) => s.db)
  const [copied, setCopied] = useState(false)
  const itemName = (name: string): string => displayName(db, 'item', name)

  const copy = async (): Promise<void> => {
    await window.api.clipboard.writeText(materialsText(report, itemName))
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <>
      <div className="panel-title">Summary</div>
      <dl className="kv" data-testid="analysis-summary">
        <dt>Entities</dt>
        <dd>{report.entityCount.toLocaleString('en')}</dd>
        <dt>Tiles</dt>
        <dd>{report.tileCount.toLocaleString('en')}</dd>
        <dt>Size</dt>
        <dd>
          {report.footprint.width}×{report.footprint.height}
        </dd>
        <dt>Occupied</dt>
        <dd>{report.footprint.occupiedTiles.toLocaleString('en')} tiles</dd>
      </dl>

      <div className="panel-title flex items-center">
        <span>Bill of materials</span>
        <button
          className="btn ml-auto px-1.5 py-0 text-[11px] normal-case"
          disabled={report.materials.length === 0}
          onClick={() => void copy()}
          data-testid="copy-materials"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      {!hasGameData && report.materials.length > 0 && (
        <p className="m-0 px-3 pb-1 text-[11px] text-ink-muted">
          Without game data, entity and tile names stand in for their items.
        </p>
      )}
      <CountTable
        testId="bom"
        rows={report.materials.map((m) => ({
          key: `${m.item}/${m.quality ?? ''}`,
          kind: 'item',
          name: m.item,
          label: itemName(m.item),
          quality: m.quality,
          count: m.count,
          indexes: m.indexes,
          note: [
            m.sources.map((s) => SOURCE_LABELS[s]).join(', '),
            m.guessed ? 'item guessed from the name' : ''
          ]
            .filter(Boolean)
            .join(' · '),
          muted: m.guessed === true
        }))}
        onSelect={onSelect}
      />

      {report.unplaceable.length > 0 && (
        <>
          <div className="panel-title">No placing item</div>
          <CountTable
            testId="unplaceable"
            rows={entityRows(report.unplaceable, db)}
            onSelect={onSelect}
          />
        </>
      )}

      <div className="panel-title">Entities</div>
      <CountTable testId="entities" rows={entityRows(report.entities, db)} onSelect={onSelect} />

      {report.tiles.length > 0 && (
        <>
          <div className="panel-title">Tiles</div>
          <CountTable
            testId="tiles"
            rows={report.tiles.map((t) => ({
              key: t.name,
              kind: 'tile',
              name: t.name,
              label: displayName(db, 'tile', t.name),
              count: t.count,
              indexes: []
            }))}
            onSelect={onSelect}
          />
        </>
      )}
    </>
  )
}

function entityRows(rows: EntityCountRow[], db: PrototypeDb | null): Row[] {
  return rows.map((r) => ({
    key: `${r.name}/${r.quality ?? ''}`,
    kind: 'entity',
    name: r.name,
    label: displayName(db, 'entity', r.name),
    quality: r.quality,
    count: r.count,
    indexes: r.indexes
  }))
}
