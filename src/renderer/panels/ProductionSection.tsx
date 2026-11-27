import {
  flowRole,
  formatRate,
  type Flow,
  type IdleReason,
  type IdleRow,
  type MachineRow,
  type ProductionReport,
  type RatioRow,
  type TimeUnit
} from '@core/analysis'
import { displayName, type PrototypeDb } from '@core/prototypes'
import { Icon } from '../components/Icon'
import { useAnalysis } from '../store/analysis'
import { useAssets } from '../store/assets'
import { CountTable, type Row } from './CountTable'
import { Section } from './Section'

interface Props {
  /** Null without game data. */
  report: ProductionReport | null
  onSelect(indexes: number[]): void
}

const UNITS: { value: TimeUnit; label: string }[] = [
  { value: 'second', label: 'per second' },
  { value: 'minute', label: 'per minute' },
  { value: 'hour', label: 'per hour' }
]

const IDLE_TEXT: Record<IdleReason, string> = {
  'no-recipe': 'no recipe set',
  'needs-recipe': 'recipe follows its input',
  'needs-resource': 'resource depends on the patch',
  patch: 'output depends on the patch',
  parameter: 'parameter recipe',
  'unknown-recipe': 'recipe not in the game data'
}

const percent = (f: number): string => `${Math.round(f * 100)} %`

/** Production report (docs/spec/06-analysis.md § 2 Production). */
export function ProductionSection({ report, onSelect }: Readonly<Props>): React.JSX.Element {
  const db = useAssets((s) => s.db)
  const unit = useAnalysis((s) => s.settings.timeUnit)
  if (!report || !db) {
    return (
      <Section id="production" title="Production" level="report" summary="needs game data">
        <p className="m-0 px-3 pb-2 text-ink-muted" data-testid="production-needs-data">
          Requires game data.
        </p>
      </Section>
    )
  }
  const rate = (perSecond: number): string => formatRate(perSecond, unit)
  const flows = (role: ReturnType<typeof flowRole>): Flow[] =>
    report.flows.filter((f) => flowRole(f) === role)
  const outputs = flows('output')
  const inputs = flows('input')
  const balanced = flows('balanced')
  const under = report.ratios.filter((r) => r.status === 'under')
  const over = report.ratios.filter((r) => r.status === 'over')
  const machineCount = report.machines.reduce((n, m) => n + m.count, 0)
  const warnings = report.surfaceWarnings.length + under.length

  return (
    <Section
      id="production"
      title="Production"
      level="report"
      summary={productionSummary(machineCount, report.surfaceWarnings.length, under.length)}
      warning={warnings > 0}
    >
      <div data-testid="production">
        <UnitPicker />
        {report.machines.length === 0 && report.idle.length === 0 && (
          <p className="m-0 px-3 pb-2 text-ink-muted">No crafting machines or mining drills.</p>
        )}

        {report.surfaceWarnings.length > 0 && (
          <Section
            id="production.surface"
            title="Surface conditions not met"
            summary={report.surfaceWarnings.length}
            warning
          >
            <CountTable
              testId="surface-warnings"
              rows={report.surfaceWarnings.map((w) => ({
                key: `${w.recipe}/${w.property}`,
                kind: 'recipe',
                name: w.recipe,
                label: displayName(db, 'recipe', w.recipe),
                count: w.indexes.length,
                indexes: w.indexes,
                value: `${w.property} ${w.value}`,
                note: `needs ${rangeText(w.min, w.max)}`
              }))}
              onSelect={onSelect}
            />
          </Section>
        )}

        {report.machines.length > 0 && (
          <Section id="production.machines" title="Machines" summary={report.machines.length}>
            <CountTable
              testId="machines"
              rows={machineRows(db, report.machines, rate)}
              onSelect={onSelect}
            />
          </Section>
        )}

        {report.idle.length > 0 && (
          <Section id="production.idle" title="No rate" summary={report.idle.length}>
            <IdleList db={db} rows={report.idle} onSelect={onSelect} />
          </Section>
        )}

        {under.length > 0 && (
          <Section id="production.under" title="Under-supplied" summary={under.length} warning>
            <CountTable
              testId="under-supplied"
              rows={ratioRows(db, under, 'supply as a share of what its consumers use')}
              onSelect={onSelect}
            />
          </Section>
        )}

        {outputs.length > 0 && (
          <FlowTable
            testId="outputs"
            title="Outputs"
            db={db}
            list={outputs}
            rate={rate}
            onSelect={onSelect}
          />
        )}
        {inputs.length > 0 && (
          <FlowTable
            testId="inputs"
            title="Inputs"
            db={db}
            list={inputs}
            rate={rate}
            onSelect={onSelect}
          />
        )}
        {balanced.length > 0 && (
          <FlowTable
            testId="balanced"
            title="Balanced"
            db={db}
            list={balanced}
            rate={rate}
            onSelect={onSelect}
          />
        )}

        {over.length > 0 && (
          <Section id="production.surplus" title="Surplus" summary={over.length}>
            <CountTable
              testId="over-supplied"
              rows={ratioRows(db, over, 'made as a share of what is used inside the blueprint')}
              onSelect={onSelect}
            />
          </Section>
        )}
      </div>
    </Section>
  )
}

function productionSummary(machines: number, surface: number, under: number): string {
  const parts = [`${machines.toLocaleString('en')} ${machines === 1 ? 'machine' : 'machines'}`]
  if (surface) parts.push(`${surface} surface`)
  if (under) parts.push(`${under} under-supplied`)
  return parts.join(' · ')
}

function ratioRows(db: PrototypeDb, list: RatioRow[], note: string): Row[] {
  return list.map((r) => ({
    key: `${r.type}/${r.name}/${r.quality ?? ''}`,
    kind: r.type,
    name: r.name,
    label: displayName(db, r.type, r.name),
    quality: r.quality,
    count: r.indexes.length,
    indexes: r.indexes,
    value: percent(r.supply),
    note
  }))
}

function rangeText(min: number | undefined, max: number | undefined): string {
  if (min !== undefined && min === max) return String(min)
  if (min !== undefined && max !== undefined) return `${min} to ${max}`
  return min === undefined ? `at most ${max}` : `at least ${min}`
}

/** A resource shows as the item or fluid it yields (resources have no display name of their own here). */
function resourceView(
  db: PrototypeDb,
  resource: string
): { kind: string; name: string; label: string } {
  const product = db.resources[resource]?.results[0]
  if (!product) return { kind: 'entity', name: resource, label: resource }
  return {
    kind: product.type,
    name: product.name,
    label: displayName(db, product.type, product.name)
  }
}

/** Machine rows; a recipe run by several machine types names the machine in its label. */
function machineRows(db: PrototypeDb, list: MachineRow[], rate: (s: number) => string): Row[] {
  const machinesOf = new Map<string, Set<string>>()
  for (const m of list) {
    const key = m.recipe ?? m.resource ?? ''
    machinesOf.set(key, (machinesOf.get(key) ?? new Set()).add(m.name))
  }
  return list.map((m) => {
    const row = machineRow(db, m, rate)
    const shared = (machinesOf.get(m.recipe ?? m.resource ?? '')?.size ?? 0) > 1
    return shared ? { ...row, label: `${row.label} · ${displayName(db, 'entity', m.name)}` } : row
  })
}

function machineRow(db: PrototypeDb, m: MachineRow, rate: (s: number) => string): Row {
  const what = m.recipe
    ? { kind: 'recipe', name: m.recipe, label: displayName(db, 'recipe', m.recipe) }
    : resourceView(db, m.resource!)
  return {
    key: `${m.name}/${m.quality ?? ''}/${what.name}/${m.recipeQuality ?? ''}`,
    ...what,
    label: `${what.label}${m.assumed ? ' (assumed)' : ''}`,
    quality: m.recipeQuality,
    count: m.count,
    indexes: m.indexes,
    value: rate(m.cycles),
    note: [
      m.quality
        ? `${displayName(db, 'entity', m.name)} (${m.quality})`
        : displayName(db, 'entity', m.name),
      `speed ${Number(m.speed.toFixed(3))}`,
      m.productivity ? `+${Math.round(m.productivity * 100)} % productivity` : '',
      m.recipe ? 'crafts' : 'mining cycles'
    ]
      .filter(Boolean)
      .join(' · '),
    muted: m.assumed === true
  }
}

function FlowTable({
  testId,
  title,
  db,
  list,
  rate,
  onSelect
}: Readonly<{
  testId: string
  title: string
  db: PrototypeDb
  list: Flow[]
  rate: (perSecond: number) => string
  onSelect(indexes: number[]): void
}>): React.JSX.Element {
  return (
    <Section id={`production.${testId}`} title={title} summary={list.length}>
      <CountTable
        testId={testId}
        rows={list.map((f) => {
          const indexes = testId === 'inputs' ? f.consumers : f.producers
          return {
            key: `${f.type}/${f.name}/${f.quality ?? ''}`,
            kind: f.type,
            name: f.name,
            label: `${displayName(db, f.type, f.name)}${f.spoils ? ' (spoils)' : ''}`,
            quality: f.quality,
            count: testId === 'balanced' ? f.producers.length + f.consumers.length : indexes.length,
            indexes: testId === 'balanced' ? [...f.producers, ...f.consumers] : indexes,
            value: rate(testId === 'balanced' ? f.produced : Math.abs(f.net)),
            note: `made ${rate(f.produced)} · used ${rate(f.consumed)}`
          }
        })}
        onSelect={onSelect}
      />
    </Section>
  )
}

function IdleList({
  db,
  rows,
  onSelect
}: Readonly<{
  db: PrototypeDb
  rows: IdleRow[]
  onSelect(indexes: number[]): void
}>): React.JSX.Element {
  const settings = useAnalysis((s) => s.settings)
  const setSettings = useAnalysis((s) => s.setSettings)
  const assume = (entity: string, value: string): void => {
    const next = { ...settings.assume }
    if (value) next[entity] = value
    else delete next[entity]
    setSettings({ ...settings, assume: next })
  }
  return (
    <ul className="m-0 list-none px-1 pb-2" data-testid="idle">
      {rows.map((r) => {
        const optionName = (o: string): string =>
          r.reason === 'needs-resource' ? resourceView(db, o).label : displayName(db, 'recipe', o)
        return (
          <li
            key={`${r.name}/${r.quality ?? ''}/${r.reason}/${r.recipe ?? ''}`}
            className="px-2 py-0.5"
          >
            <button
              className="flex w-full items-center gap-2 rounded text-left hover:bg-white/5"
              title={[r.name, r.recipe].filter(Boolean).join(' · ')}
              onClick={() => onSelect(r.indexes)}
              data-testid="idle-row"
            >
              <Icon kind="entity" name={r.name} quality={r.quality} size={20} fallback="none" />
              <span className="min-w-0 flex-1 truncate">
                {displayName(db, 'entity', r.name)}
                <span className="ml-1 text-ink-muted tabular-nums">
                  × {r.count.toLocaleString('en')}
                </span>
              </span>
              <span className="text-[11px] text-ink-muted">{IDLE_TEXT[r.reason]}</span>
            </button>
            {r.options.length > 0 && (
              <label className="flex items-center gap-2 pl-7 text-[11px] text-ink-muted">
                <span>{r.reason === 'needs-resource' ? 'Assume' : 'Assume recipe'}</span>
                <select
                  className="min-w-0 flex-1 rounded border border-white/10 bg-transparent px-1 py-0.5 text-ink"
                  value={settings.assume?.[r.name] ?? ''}
                  onChange={(e) => assume(r.name, e.target.value)}
                  data-testid="idle-assume"
                >
                  <option value="">None</option>
                  {r.options.map((o) => (
                    <option key={o} value={o}>
                      {optionName(o)}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </li>
        )
      })}
    </ul>
  )
}

function UnitPicker(): React.JSX.Element {
  const settings = useAnalysis((s) => s.settings)
  const setSettings = useAnalysis((s) => s.setSettings)
  return (
    <label className="flex items-center gap-2 px-3 pb-1 text-[11px] text-ink-muted">
      <span>Rates</span>
      <select
        className="min-w-0 flex-1 rounded border border-white/10 bg-transparent px-1 py-0.5 text-ink"
        value={settings.timeUnit}
        onChange={(e) => setSettings({ ...settings, timeUnit: e.target.value as TimeUnit })}
        data-testid="production-unit"
      >
        {UNITS.map((u) => (
          <option key={u.value} value={u.value}>
            {u.label}
          </option>
        ))}
      </select>
    </label>
  )
}
