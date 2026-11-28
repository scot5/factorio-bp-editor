import {
  DEFAULT_RESEARCH,
  formatRate,
  type FluidSegment,
  type InserterLimitRow,
  type LogisticsReport,
  type ResearchBonuses,
  type SplitterRow
} from '@core/analysis'
import { displayName, type PrototypeDb } from '@core/prototypes'
import { useAnalysis } from '../store/analysis'
import { useAssets } from '../store/assets'
import { CountTable, type Row } from './CountTable'
import { Section } from './Section'

interface Props {
  /** Null without game data. */
  report: LogisticsReport | null
  onSelect(indexes: number[]): void
}

/** Belt and inserter figures are per second, as the game shows them. */
const perSecond = (n: number): string => formatRate(n, 'second')

const plural = (n: number, word: string): string =>
  `${n.toLocaleString('en')} ${word}${n === 1 ? '' : 's'}`

/** Logistics report (docs/spec/06-analysis.md § 3 Logistics). */
export function LogisticsSection({ report, onSelect }: Readonly<Props>): React.JSX.Element {
  const db = useAssets((s) => s.db)
  if (!report || !db) {
    return (
      <Section id="logistics" title="Logistics" level="report" summary="needs game data">
        <p className="m-0 px-3 pb-2 text-ink-muted" data-testid="logistics-needs-data">
          Requires game data.
        </p>
      </Section>
    )
  }
  const belts = report.belts.reduce((n, r) => n + r.count, 0)
  const inserters = report.inserters.reduce((n, r) => n + r.count, 0)
  const empty = belts + inserters + report.fluidSegments.length === 0
  return (
    <Section
      id="logistics"
      title="Logistics"
      level="report"
      summary={logisticsSummary(belts, inserters, report.limits.length)}
    >
      <div data-testid="logistics">
        <ResearchPicker />
        {empty && <p className="m-0 px-3 pb-2 text-ink-muted">No belts, inserters or pipes.</p>}

        {report.belts.length > 0 && (
          <Section id="logistics.belts" title="Belts" summary={report.belts.length}>
            <CountTable
              testId="belts"
              rows={report.belts.map((b) => ({
                key: b.name,
                kind: 'entity',
                name: b.name,
                label: displayName(db, 'entity', b.name),
                count: b.count,
                indexes: b.indexes,
                value: perSecond(b.throughput),
                note: `both lanes, stacks of ${report.beltStackSize}`
              }))}
              onSelect={onSelect}
            />
          </Section>
        )}

        {report.inserters.length > 0 && (
          <Section id="logistics.inserters" title="Inserters" summary={report.inserters.length}>
            <CountTable
              testId="inserters"
              wrap
              rows={report.inserters.map((i) => ({
                key: `${i.name}/${i.quality ?? ''}/${i.handSize}`,
                kind: 'entity',
                name: i.name,
                label: `${displayName(db, 'entity', i.name)} · hand ${i.handSize}`,
                quality: i.quality,
                count: i.count,
                indexes: i.indexes,
                value: perSecond(i.throughput),
                note: `chest to chest, ${Number(i.cycles.toFixed(2))} swings/s; slower from belts`
              }))}
              onSelect={onSelect}
            />
          </Section>
        )}

        {report.limits.length > 0 && (
          <Section
            id="logistics.limits"
            title="Limited by inserters"
            summary={report.limits.length}
          >
            <CountTable
              testId="inserter-limits"
              wrap
              rows={limitRows(db, report.limits)}
              onSelect={onSelect}
            />
          </Section>
        )}

        {report.splitters.length > 0 && (
          <Section id="logistics.splitters" title="Splitters" summary={report.splitters.length}>
            <CountTable
              testId="splitters"
              wrap
              rows={splitterRows(db, report.splitters)}
              onSelect={onSelect}
            />
          </Section>
        )}

        {report.fluidSegments.length > 0 && (
          <Section
            id="logistics.fluids"
            title="Fluid segments"
            summary={report.fluidSegments.length}
            defaultOpen={false}
          >
            <CountTable
              testId="fluid-segments"
              rows={segmentRows(report.fluidSegments)}
              onSelect={onSelect}
            />
          </Section>
        )}
      </div>
    </Section>
  )
}

function logisticsSummary(belts: number, inserters: number, limits: number): string {
  const parts = [
    belts > 0 ? plural(belts, 'belt') : '',
    inserters > 0 ? plural(inserters, 'inserter') : '',
    limits > 0 ? `${limits} limited` : ''
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : 'none'
}

function limitRows(db: PrototypeDb, list: InserterLimitRow[]): Row[] {
  return list.map((l) => ({
    key: `${l.name}/${l.quality ?? ''}/${l.side}`,
    kind: 'entity',
    name: l.name,
    label: `${displayName(db, 'entity', l.name)} ${l.side === 'input' ? 'inputs' : 'outputs'}`,
    quality: l.quality,
    count: l.count,
    indexes: l.indexes,
    value: `${Number(l.capacity.toFixed(2))} of ${perSecond(l.need)}`,
    note: 'inserter capacity chest to chest / items the machine uses or makes at full speed'
  }))
}

function filterText(db: PrototypeDb, filter: NonNullable<SplitterRow['filter']>): string {
  const name = displayName(db, 'item', filter.name)
  return filter.quality ? `${name} (${filter.quality})` : name
}

function splitterRows(db: PrototypeDb, list: SplitterRow[]): Row[] {
  return list.map((s, i) => {
    const settings = [
      s.inputPriority ? `input ${s.inputPriority}` : '',
      s.outputPriority ? `output ${s.outputPriority}` : '',
      s.filter ? `filter ${filterText(db, s.filter)}` : ''
    ].filter(Boolean)
    return {
      key: `${s.name}/${i}`,
      kind: 'entity',
      name: s.name,
      label: `${displayName(db, 'entity', s.name)} · ${settings.join(' · ') || 'no priority'}`,
      count: s.count,
      indexes: s.indexes
    }
  })
}

function segmentRows(list: FluidSegment[]): Row[] {
  return list.map((s, i) => {
    const pumps = s.pumps.length
    const parts = [
      'Pipes',
      s.tanks > 0 ? plural(s.tanks, 'tank') : '',
      pumps > 0 ? `${plural(pumps, 'pump')} (up to ${perSecond(s.pumpRate)} each)` : ''
    ].filter(Boolean)
    return {
      key: `segment/${i}`,
      kind: 'entity',
      name: s.tanks > 0 ? 'storage-tank' : 'pipe',
      label: parts.join(' · '),
      count: s.indexes.length,
      indexes: [...s.indexes, ...s.pumps],
      value: `${s.extent} tiles`,
      note: 'no flow limit inside a segment; pumps move fluid between segments'
    }
  })
}

const RESEARCH: readonly {
  key: keyof ResearchBonuses
  label: string
  values: number[]
  testId: string
}[] = [
  {
    key: 'beltStackSize',
    label: 'Belt stack',
    values: [1, 2, 3, 4],
    testId: 'research-belt-stack'
  },
  {
    key: 'inserterCapacityBonus',
    label: 'Inserter bonus',
    values: [0, 1, 2, 3],
    testId: 'research-inserter'
  },
  {
    key: 'bulkInserterCapacityBonus',
    label: 'Bulk bonus',
    values: Array.from({ length: 12 }, (_, i) => i),
    testId: 'research-bulk'
  }
]

/** Research levels that change belt and inserter throughput. */
function ResearchPicker(): React.JSX.Element {
  const settings = useAnalysis((s) => s.settings)
  const setSettings = useAnalysis((s) => s.setSettings)
  const research = { ...DEFAULT_RESEARCH, ...settings.research }
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 px-3 pb-1 text-[11px] text-ink-muted">
      {RESEARCH.map((r) => (
        <label key={r.key} className="flex items-center gap-1">
          <span>{r.label}</span>
          <select
            className="rounded border border-white/10 bg-transparent px-1 py-0.5 text-ink"
            value={research[r.key]}
            onChange={(e) =>
              setSettings({
                ...settings,
                research: { ...research, [r.key]: Number(e.target.value) }
              })
            }
            data-testid={r.testId}
          >
            {r.values.map((v) => (
              <option key={v} value={v}>
                {r.key === 'beltStackSize' ? v : `+${v}`}
              </option>
            ))}
          </select>
        </label>
      ))}
    </div>
  )
}
