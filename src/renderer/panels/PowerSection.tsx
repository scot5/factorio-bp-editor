import { formatJoules, formatWatts, type AnalysisSettings, type PowerReport } from '@core/analysis'
import { displayName, type PrototypeDb } from '@core/prototypes'
import { useAnalysis } from '../store/analysis'
import { useAssets } from '../store/assets'
import { CountTable, type Row } from './CountTable'
import { Section } from './Section'

interface Props {
  /** Null without game data. */
  report: PowerReport | null
  onSelect(indexes: number[]): void
}

const percent = (f: number): string => `${Math.round(f * 100)} %`

/** Power report (docs/spec/06-analysis.md § 4 Power). */
export function PowerSection({ report, onSelect }: Readonly<Props>): React.JSX.Element {
  const db = useAssets((s) => s.db)
  if (!report || !db) {
    return (
      <Section id="power" title="Power" level="report" summary="needs game data">
        <p className="m-0 px-3 pb-2 text-ink-muted" data-testid="power-needs-data">
          Requires game data.
        </p>
      </Section>
    )
  }
  const entity = (name: string): string => displayName(db, 'entity', name)
  const rows = <T extends { name: string; quality?: string; count: number; indexes: number[] }>(
    list: T[],
    value?: (r: T) => string
  ): Row[] =>
    list.map((r) => ({
      key: `${r.name}/${r.quality ?? ''}`,
      kind: 'entity',
      name: r.name,
      label: entity(r.name),
      quality: r.quality,
      count: r.count,
      indexes: r.indexes,
      ...(value ? { value: value(r) } : {})
    }))

  return (
    <Section
      id="power"
      title="Power"
      level="report"
      summary={powerSummary(report)}
      warning={report.unpoweredCount > 0}
    >
      <div data-testid="power">
        <SurfacePicker db={db} report={report} />
        <dl className="kv" data-testid="power-summary">
          <dt>Peak draw</dt>
          <dd>{formatWatts(report.peak)}</dd>
          <dt>Drain</dt>
          <dd>{formatWatts(report.drain)}</dd>
          {report.generators.length > 0 && (
            <>
              <dt>Generation</dt>
              <dd>{formatWatts(report.generationPeak)}</dd>
              {formatWatts(report.generationAverage) !== formatWatts(report.generationPeak) && (
                <>
                  <dt>Average</dt>
                  <dd title={`Solar at ${percent(report.solar.average)} of rated output`}>
                    {formatWatts(report.generationAverage)}
                  </dd>
                </>
              )}
            </>
          )}
          {report.heat.length > 0 && (
            <>
              <dt>Heat</dt>
              <dd>{formatWatts(report.heatOutput)}</dd>
            </>
          )}
          {report.accumulators.count > 0 && (
            <>
              <dt>Storage</dt>
              <dd>
                {formatJoules(report.accumulators.capacity)} in {report.accumulators.count}
              </dd>
            </>
          )}
          <dt>Poles</dt>
          <dd>{polesText(report)}</dd>
          {report.unpoweredCount > 0 && (
            <>
              <dt>Unpowered</dt>
              <dd className="text-danger">{report.unpoweredCount}</dd>
            </>
          )}
        </dl>

        {report.unpowered.length > 0 && (
          <Section
            id="power.unpowered"
            title="Outside pole coverage"
            summary={report.unpoweredCount}
            warning
          >
            <CountTable testId="unpowered" rows={rows(report.unpowered)} onSelect={onSelect} />
          </Section>
        )}

        <Section id="power.consumers" title="Consumers" summary={report.consumers.length}>
          <CountTable
            testId="consumers"
            rows={rows(report.consumers, (r) => formatWatts(r.peak)).map((r, i) => ({
              ...r,
              note: `drain ${formatWatts(report.consumers[i]!.drain)}`
            }))}
            onSelect={onSelect}
          />
        </Section>

        {report.generators.length > 0 && (
          <Section id="power.generators" title="Generators" summary={report.generators.length}>
            <CountTable
              testId="generators"
              rows={rows(report.generators, (r) => formatWatts(r.peak)).map((r, i) => {
                const g = report.generators[i]!
                return g.average === g.peak
                  ? r
                  : { ...r, note: `average ${formatWatts(g.average)}` }
              })}
              onSelect={onSelect}
            />
          </Section>
        )}

        {report.heat.length > 0 && (
          <Section id="power.heat" title="Heat sources" summary={report.heat.length}>
            <CountTable
              testId="heat"
              rows={rows(report.heat, (r) => formatWatts(r.output))}
              onSelect={onSelect}
            />
          </Section>
        )}

        {report.networks.length > 1 && (
          <Section id="power.networks" title="Pole networks" summary={report.networks.length}>
            <CountTable
              testId="networks"
              rows={report.networks.map((n, i) => ({
                key: String(i),
                kind: 'entity',
                name: n.pole,
                label: `Network ${i + 1}: ${n.poles.length} ${n.poles.length === 1 ? 'pole' : 'poles'}`,
                count: n.members.length,
                value: formatWatts(n.peak),
                note: `${n.members.length} supplied entities`,
                indexes: [...n.poles, ...n.members]
              }))}
              onSelect={onSelect}
            />
          </Section>
        )}

        {report.nonElectric.length > 0 && (
          <Section
            id="power.non-electric"
            title="Fuel, heat or fluid powered"
            summary={report.nonElectric.length}
          >
            <CountTable testId="non-electric" rows={rows(report.nonElectric)} onSelect={onSelect} />
          </Section>
        )}
      </div>
    </Section>
  )
}

function powerSummary(report: PowerReport): string {
  const peak = `${formatWatts(report.peak)} peak`
  return report.unpoweredCount > 0 ? `${peak} · ${report.unpoweredCount} unpowered` : peak
}

function polesText(report: PowerReport): string {
  if (report.surface.space) return 'not needed (platform)'
  if (report.poleCount === 0) return 'none'
  const n = report.networks.length
  return `${report.poleCount} in ${n} ${n === 1 ? 'network' : 'networks'}`
}

function SurfacePicker({
  db,
  report
}: Readonly<{ db: PrototypeDb; report: PowerReport }>): React.JSX.Element {
  const settings = useAnalysis((s) => s.settings)
  const setSettings = useAnalysis((s) => s.setSettings)
  const planets = Object.keys(db.planets)
  const planetName = (p: string): string => displayName(db, 'space-location', p)

  let value = ''
  if (settings.space !== undefined)
    value = `${settings.planet ?? 'nauvis'}${settings.space ? ':space' : ''}`
  const auto = report.surface.space ? 'space platform' : planetName(report.surface.planet)

  const change = (v: string): void => {
    // Keep the other settings (time unit, production assumptions).
    const next: AnalysisSettings = { ...settings }
    delete next.planet
    delete next.space
    if (v) {
      const [planet, space] = v.split(':')
      next.planet = planet ?? 'nauvis'
      next.space = space === 'space'
    }
    setSettings(next)
  }

  return (
    <label className="flex items-center gap-2 px-3 pb-1 text-[11px] text-ink-muted">
      <span>Surface</span>
      <select
        className="min-w-0 flex-1 rounded border border-white/10 bg-transparent px-1 py-0.5 text-ink"
        value={value}
        onChange={(e) => change(e.target.value)}
        data-testid="power-surface"
      >
        <option value="">Auto ({auto})</option>
        {planets.map((p) => (
          <option key={p} value={p}>
            {planetName(p)}
          </option>
        ))}
        {planets.map((p) => (
          <option key={`${p}:space`} value={`${p}:space`}>
            {planetName(p)} orbit (platform)
          </option>
        ))}
      </select>
    </label>
  )
}
