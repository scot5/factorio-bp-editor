import clsx from 'clsx'
import { useEffect, useId, type ReactNode } from 'react'
import { useSections } from '../store/sections'

interface Props {
  /** Stable id, saved in settings (`power`, `inventory.entities`, …). */
  id: string
  title: ReactNode
  /** Shown in the header, also when collapsed: a count or a key figure. */
  summary?: ReactNode
  /** Header summary and title in the danger colour (the section holds warnings). */
  warning?: boolean
  /** Report sections are larger; sub-lists are the default. */
  level?: 'report' | 'list'
  defaultOpen?: boolean
  /** Controls in the header beside the toggle (never inside the toggle button). */
  actions?: ReactNode
  children: ReactNode
}

/** A collapsible panel section (docs/spec/04-visualization.md § Side panel). */
export function Section({
  id,
  title,
  summary,
  warning = false,
  level = 'list',
  defaultOpen = true,
  actions,
  children
}: Readonly<Props>): React.JSX.Element {
  const open = useSections((s) => s.open[id] ?? defaultOpen)
  const toggle = useSections((s) => s.toggle)
  const register = useSections((s) => s.register)
  const bodyId = useId()

  useEffect(() => register(id, defaultOpen), [id, defaultOpen, register])

  return (
    <section data-testid={`section-${id}`} data-open={open}>
      <div
        className={clsx(
          'flex items-center gap-1 pr-2',
          level === 'report' && 'mt-1 border-t border-white/10 first:mt-0 first:border-t-0'
        )}
      >
        <button
          className={clsx(
            'panel-title flex min-w-0 flex-1 items-center gap-1.5 text-left hover:text-ink',
            level === 'report' && 'text-[12px] text-ink',
            warning && 'text-danger hover:text-danger'
          )}
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => toggle(id)}
          data-testid={`section-${id}-toggle`}
        >
          <span
            aria-hidden
            className={clsx(
              'inline-block w-3 text-center text-[14px] leading-none transition-transform',
              open && 'rotate-90'
            )}
          >
            ›
          </span>
          <span className="shrink-0">{title}</span>
          {summary !== undefined && (
            <span
              className={clsx(
                'ml-auto min-w-0 truncate pl-2 font-normal normal-case tracking-normal tabular-nums',
                warning ? 'text-danger' : 'text-ink-muted'
              )}
            >
              {summary}
            </span>
          )}
        </button>
        {actions}
      </div>
      {open && <div id={bodyId}>{children}</div>}
    </section>
  )
}
