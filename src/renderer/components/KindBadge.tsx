import clsx from 'clsx'
import type { RootKind } from '@core/codec'
import { KIND_STYLES } from './kinds'

export function KindBadge({ kind }: { kind: RootKind }): React.JSX.Element {
  const k = KIND_STYLES[kind]
  return (
    <span
      title={k.label}
      className={clsx(
        'inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-sm px-0.5 text-[9px] font-bold text-white',
        k.className
      )}
    >
      {k.letter}
    </span>
  )
}
