import clsx from 'clsx'
import {
  formatRate,
  formatWatts,
  type DeltaRow,
  type DiffReport,
  type DiffRow
} from '@core/analysis'
import { findAll, type BookPath } from '@core/model'
import { displayName, type PrototypeDb } from '@core/prototypes'
import { richTextToPlain } from '@core/richtext'
import { Icon } from '../components/Icon'
import { useAnalysis } from '../store/analysis'
import { useAssets } from '../store/assets'
import { useDiff, type DiffTarget } from '../store/diff'
import { useDocuments, type OpenDocument } from '../store/documents'
import { CountTable, type Row } from './CountTable'
import { Section } from './Section'

/** Overlay colours (docs/spec/04-visualization.md § Overlays); the canvas uses the same values. */
const ADDED = 'text-[#7bd389]'
const REMOVED = 'text-[#ff6b5b]'
const CHANGED = 'text-[#f5d33d]'

interface Choice {
  key: string
  target: DiffTarget
  label: string
}

const targetKey = (docId: string, path: BookPath): string => `${docId}:${path.join('/')}`

/** Every blueprint in the open documents, except the one on the canvas. */
function choicesOf(documents: readonly OpenDocument[], active: string): Choice[] {
  return documents.flatMap((doc) =>
    findAll(doc.envelope, 'blueprint')
      .map((node) => {
        const label =
          typeof node.payload['label'] === 'string' ? richTextToPlain(node.payload['label']) : ''
        const name =
          node.path.length === 0
            ? doc.title
            : `${doc.title} › ${label || `#${node.path.join('.')}`}`
        return {
          key: targetKey(doc.id, node.path),
          target: { docId: doc.id, path: node.path },
          label: name
        }
      })
      .filter((c) => c.key !== active)
  )
}

function diffSummary(report: DiffReport | null, comparing: boolean): string {
  if (!comparing) return 'not comparing'
  if (!report) return '…'
  const { added, removed, changed } = report.counts
  if (added + removed + changed === 0) return 'no entity changes'
  return [added ? `+${added}` : '', removed ? `−${removed}` : '', changed ? `~${changed}` : '']
    .filter(Boolean)
    .join(' · ')
}

function sign(n: number): string {
  if (n > 0) return '+'
  if (n < 0) return '−'
  return '±'
}

const signed = (n: number, format: (v: number) => string = (v) => v.toLocaleString('en')): string =>
  `${sign(n)}${format(Math.abs(n))}`

/**
 * Compare the blueprint on the canvas with another open blueprint
 * (docs/spec/06-analysis.md § 7 Diff): entity, wire and tile changes, material,
 * power and production deltas, and the canvas overlay toggle.
 */
export function DiffSection({
  onSelect
}: Readonly<{ onSelect(indexes: number[]): void }>): React.JSX.Element {
  const documents = useDocuments((s) => s.documents)
  const activeId = useDocuments((s) => s.activeId)
  const doc = documents.find((d) => d.id === activeId)
  const target = useDiff((s) => s.target)
  const overlay = useDiff((s) => s.overlay)
  const report = useDiff((s) => s.report)
  const status = useDiff((s) => s.status)
  const error = useDiff((s) => s.error)
  const setTarget = useDiff((s) => s.setTarget)
  const setOverlay = useDiff((s) => s.setOverlay)

  const active = doc ? targetKey(doc.id, doc.activePath) : ''
  const choices = choicesOf(documents, active)
  const selected = target ? targetKey(target.docId, target.path) : ''
  const comparing =
    target !== null && selected !== active && choices.some((c) => c.key === selected)
  const shown = comparing && status === 'done' ? report : null

  return (
    <Section id="diff" title="Compare" level="report" summary={diffSummary(shown, comparing)}>
      <div data-testid="diff">
        <label className="flex items-center gap-2 px-3 pb-1.5 text-[12px]">
          <span className="shrink-0 text-ink-muted">Compare with</span>
          <select
            className="min-w-0 flex-1 rounded border border-white/10 bg-transparent px-1 py-0.5 text-ink"
            value={comparing ? selected : ''}
            onChange={(e) =>
              setTarget(choices.find((c) => c.key === e.target.value)?.target ?? null)
            }
            data-testid="diff-target"
          >
            <option value="">{choices.length ? 'Nothing' : 'No other blueprint open'}</option>
            {choices.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        {comparing && (
          <label className="flex items-center gap-2 px-3 pb-1.5 text-[12px]">
            <input
              type="checkbox"
              checked={overlay}
              onChange={(e) => setOverlay(e.target.checked)}
              data-testid="diff-overlay"
            />
            Show changes on the canvas
          </label>
        )}
        {!comparing && (
          <p className="m-0 px-3 pb-2 text-[11px] text-ink-muted">
            Pick another open blueprint to see what this one adds, removes and changes.
          </p>
        )}
        {comparing && status === 'error' && (
          <p className="m-0 px-3 pb-2 text-danger">Compare failed: {error}</p>
        )}
        {comparing && status === 'running' && (
          <p className="m-0 px-3 pb-2 text-ink-muted">Comparing…</p>
        )}
        {shown && <DiffBody report={shown} onSelect={onSelect} />}
      </div>
    </Section>
  )
}

function DiffBody({
  report,
  onSelect
}: Readonly<{ report: DiffReport; onSelect(indexes: number[]): void }>): React.JSX.Element {
  const db = useAssets((s) => s.db)
  const unit = useAnalysis((s) => s.settings.timeUnit)
  const { offset, counts, wires, tiles } = report
  const tileChanges = tiles.added + tiles.removed + tiles.changed

  return (
    <>
      <dl className="kv pb-1.5" data-testid="diff-summary">
        <dt className={ADDED}>Added</dt>
        <dd data-testid="diff-added-count">{counts.added.toLocaleString('en')}</dd>
        <dt className={REMOVED}>Removed</dt>
        <dd data-testid="diff-removed-count">{counts.removed.toLocaleString('en')}</dd>
        <dt className={CHANGED}>Changed</dt>
        <dd data-testid="diff-changed-count">{counts.changed.toLocaleString('en')}</dd>
        <dt>Unchanged</dt>
        <dd>{counts.unchanged.toLocaleString('en')}</dd>
        {wires.added + wires.removed > 0 && (
          <>
            <dt>Wires</dt>
            <dd>
              +{wires.added} · −{wires.removed}
            </dd>
          </>
        )}
        {tileChanges > 0 && (
          <>
            <dt>Tiles</dt>
            <dd>
              +{tiles.added} · −{tiles.removed} · ~{tiles.changed}
            </dd>
          </>
        )}
        {report.fields.length > 0 && (
          <>
            <dt>Blueprint</dt>
            <dd>{report.fields.map(fieldName).join(', ')}</dd>
          </>
        )}
        {(offset.x !== 0 || offset.y !== 0) && (
          <>
            <dt>Aligned by</dt>
            <dd title="The other blueprint's positions are shifted by this many tiles to line up with this one.">
              {offset.x}, {offset.y} tiles
            </dd>
          </>
        )}
      </dl>

      {report.added.length > 0 && (
        <Section id="diff.added" title="Added" summary={report.added.length}>
          <CountTable testId="diff-added" rows={entityRows(report.added, db)} onSelect={onSelect} />
        </Section>
      )}
      {report.removed.length > 0 && (
        <Section id="diff.removed" title="Removed" summary={report.removed.length}>
          <CountTable
            testId="diff-removed"
            rows={entityRows(report.removed, db)}
            onSelect={onSelect}
          />
        </Section>
      )}
      {report.changed.length > 0 && (
        <Section id="diff.changed" title="Changed" summary={report.changed.length}>
          <CountTable
            testId="diff-changed"
            wrap
            rows={entityRows(report.changed, db)}
            onSelect={onSelect}
          />
        </Section>
      )}

      {report.power && <PowerDelta power={report.power} />}

      {report.production && report.production.length > 0 && (
        <Section id="diff.production" title="Production" summary={report.production.length}>
          <DeltaList
            testId="diff-production"
            rows={report.production}
            db={db}
            format={(v) => formatRate(v, unit)}
          />
        </Section>
      )}

      {report.materials.length > 0 && (
        <Section id="diff.materials" title="Bill of materials" summary={report.materials.length}>
          <DeltaList testId="diff-materials" rows={report.materials} db={db} />
        </Section>
      )}
    </>
  )
}

/** A blueprint key as words: `control_behavior` → `control behavior`. */
const fieldName = (key: string): string => key.replaceAll(/[_-]/g, ' ')

function entityRows(rows: readonly DiffRow[], db: PrototypeDb | null): Row[] {
  return rows.map((r) => {
    const name = displayName(db, 'entity', r.name)
    const base = r.from ? `${displayName(db, 'entity', r.from)} → ${name}` : name
    // The arrow already says the prototype changed.
    const fields = (r.fields ?? []).filter((f) => f !== 'name' || !r.from).map(fieldName)
    return {
      key: [r.name, r.quality ?? '', r.from ?? '', r.fields?.join(',') ?? ''].join('/'),
      kind: 'entity',
      name: r.name,
      label: fields.length ? `${base}: ${fields.join(', ')}` : base,
      quality: r.quality,
      count: r.count,
      indexes: r.indexes
    }
  })
}

function PowerDelta({
  power
}: Readonly<{ power: NonNullable<DiffReport['power']> }>): React.JSX.Element | null {
  const rows = (
    [
      ['Peak draw', power.peak],
      ['Drain', power.drain],
      ['Generation', power.generation]
    ] as const
  ).filter(([, v]) => v.before !== v.after)
  if (rows.length === 0) return null
  return (
    <Section
      id="diff.power"
      title="Power"
      summary={signed(power.peak.after - power.peak.before, formatWatts)}
    >
      <dl className="kv pb-2" data-testid="diff-power">
        {rows.map(([label, v]) => (
          <div key={label} className="contents">
            <dt>{label}</dt>
            <dd>
              {formatWatts(v.before)} → {formatWatts(v.after)}{' '}
              <span className="text-ink-muted">({signed(v.after - v.before, formatWatts)})</span>
            </dd>
          </div>
        ))}
      </dl>
    </Section>
  )
}

/** Item and fluid rows with their before → after values and the change. */
function DeltaList({
  rows,
  testId,
  db,
  format = (v) => v.toLocaleString('en')
}: Readonly<{
  rows: readonly DeltaRow[]
  testId: string
  db: PrototypeDb | null
  format?: (v: number) => string
}>): React.JSX.Element {
  return (
    <ul className="m-0 list-none px-1 pb-2" data-testid={testId}>
      {rows.map((r) => {
        const change = r.after - r.before
        return (
          <li
            key={`${r.type}:${r.name}:${r.quality ?? ''}`}
            className="flex items-center gap-2 px-2 py-0.5"
            title={`${format(r.before)} → ${format(r.after)}`}
            data-testid={`${testId}-row`}
          >
            <Icon kind={r.type} name={r.name} quality={r.quality} size={20} fallback="none" />
            <span className="min-w-0 flex-1 truncate">
              {displayName(db, r.type, r.name)}
              {r.quality && <span className="ml-1 text-accent">({r.quality})</span>}
            </span>
            <span className={clsx('font-mono tabular-nums', change > 0 ? ADDED : REMOVED)}>
              {signed(change, format)}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
