import clsx from 'clsx'
import { Icon } from '../components/Icon'

export interface Row {
  key: string
  kind: string
  name: string
  label: string
  quality?: string
  count: number
  indexes: number[]
  /** Shown instead of the count (the count then follows the label as `× n`). */
  value?: string
  note?: string
  muted?: boolean
}

/**
 * Rows of icon, name and count (or value); clicking a row selects its entities.
 * `wrap` lets long labels (sentences) wrap instead of truncating, and keeps the
 * icon's space when a prototype has no icon, so the text lines up.
 */
export function CountTable({
  rows,
  testId,
  wrap = false,
  onSelect
}: Readonly<{
  rows: Row[]
  testId: string
  wrap?: boolean
  onSelect(indexes: number[]): void
}>): React.JSX.Element {
  if (rows.length === 0) return <p className="m-0 px-3 pb-2 text-ink-muted">None.</p>
  return (
    <ul className="m-0 list-none px-1 pb-2" data-testid={testId}>
      {rows.map((r) => (
        <li key={r.key}>
          <button
            className={clsx(
              'flex w-full gap-2 rounded px-2 py-0.5 text-left',
              wrap ? 'items-start' : 'items-center',
              r.indexes.length > 0 ? 'hover:bg-white/5' : 'cursor-default',
              r.muted && 'text-ink-muted'
            )}
            disabled={r.indexes.length === 0}
            title={[r.name, r.quality, r.note].filter(Boolean).join(' · ')}
            onClick={() => onSelect(r.indexes)}
            data-testid={`${testId}-row`}
          >
            {wrap ? (
              <span className="flex size-5 shrink-0 items-center">
                <Icon kind={r.kind} name={r.name} quality={r.quality} size={20} fallback="none" />
              </span>
            ) : (
              <Icon kind={r.kind} name={r.name} quality={r.quality} size={20} fallback="none" />
            )}
            <span className={clsx('min-w-0 flex-1', wrap ? 'break-words' : 'truncate')}>
              {r.label}
              {r.quality && <span className="ml-1 text-accent">({r.quality})</span>}
              {r.value !== undefined && (
                <span className="ml-1 text-ink-muted tabular-nums">
                  × {r.count.toLocaleString('en')}
                </span>
              )}
            </span>
            <span className={clsx('font-mono tabular-nums', wrap && 'shrink-0 whitespace-nowrap')}>
              {r.value ?? r.count.toLocaleString('en')}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}
