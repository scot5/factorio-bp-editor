import {
  WARNING_HINTS,
  warningText,
  type Severity,
  type ValidationReport,
  type ValidationWarning
} from '@core/analysis'
import { displayName, type PrototypeDb } from '@core/prototypes'
import { useAssets } from '../store/assets'
import { CountTable, type Row } from './CountTable'
import { Section } from './Section'

interface Props {
  report: ValidationReport
  hasGameData: boolean
  onSelect(indexes: number[]): void
}

const LISTS: readonly { severity: Severity; id: string; title: string; open: boolean }[] = [
  { severity: 'error', id: 'validation.errors', title: 'Errors', open: true },
  { severity: 'warning', id: 'validation.warnings', title: 'Warnings', open: true },
  { severity: 'info', id: 'validation.info', title: 'Notes', open: false }
]

const plural = (n: number, word: string): string =>
  `${n.toLocaleString('en')} ${word}${n === 1 ? '' : 's'}`

/** Header figure: errors and warnings, else notes, else "no problems". */
function validationSummary(counts: ValidationReport['counts']): string {
  const parts = [
    counts.error > 0 ? plural(counts.error, 'error') : '',
    counts.warning > 0 ? plural(counts.warning, 'warning') : ''
  ].filter(Boolean)
  if (parts.length > 0) return parts.join(' · ')
  return counts.info > 0 ? plural(counts.info, 'note') : 'no problems'
}

/** Validation warnings (docs/spec/06-analysis.md § 6 Validation). */
export function ValidationSection({
  report,
  hasGameData,
  onSelect
}: Readonly<Props>): React.JSX.Element {
  const db = useAssets((s) => s.db)
  const { counts } = report
  return (
    <Section
      id="validation"
      title="Validation"
      level="report"
      summary={validationSummary(counts)}
      warning={counts.error + counts.warning > 0}
    >
      <div data-testid="validation">
        {!hasGameData && (
          <p className="m-0 px-3 pb-1 text-[11px] text-ink-muted">
            Without game data only overlaps and underground pairs are checked.
          </p>
        )}
        {report.warnings.length === 0 && (
          <p className="m-0 px-3 pb-2 text-ink-muted" data-testid="validation-clean">
            No problems found.
          </p>
        )}
        {LISTS.map(({ severity, id, title, open }) => {
          const list = report.warnings.filter((w) => w.severity === severity)
          if (list.length === 0) return null
          return (
            <Section
              key={id}
              id={id}
              title={title}
              summary={counts[severity]}
              warning={severity !== 'info'}
              defaultOpen={open}
            >
              <CountTable
                testId={`validation-${severity}`}
                wrap
                rows={warningRows(db, list)}
                onSelect={onSelect}
              />
            </Section>
          )
        })}
      </div>
    </Section>
  )
}

function warningRows(db: PrototypeDb | null, list: ValidationWarning[]): Row[] {
  const nameOf = ({ kind, name }: { kind: ValidationWarning['kind']; name: string }): string =>
    displayName(db, kind, name)
  return list.map((w, i) => {
    const { text, value } = warningText(w, nameOf)
    const knownQuality = w.code !== 'quality-unavailable' && w.quality
    return {
      key: `${w.code}/${i}`,
      kind: w.kind,
      name: w.name,
      label: text,
      ...(knownQuality ? { quality: w.quality } : {}),
      count: w.count,
      indexes: w.indexes,
      ...(value === undefined ? {} : { value }),
      note: WARNING_HINTS[w.code]
    }
  })
}
