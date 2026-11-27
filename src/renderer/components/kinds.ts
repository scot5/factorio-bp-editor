import type { RootKind } from '@core/codec'

export const KIND_STYLES: Record<RootKind, { letter: string; className: string; label: string }> = {
  blueprint: { letter: 'B', className: 'bg-[#3d6fb6]', label: 'Blueprint' },
  blueprint_book: { letter: 'Bk', className: 'bg-[#8a5a2b]', label: 'Blueprint book' },
  deconstruction_planner: {
    letter: 'D',
    className: 'bg-[#b23b3b]',
    label: 'Deconstruction planner'
  },
  upgrade_planner: { letter: 'U', className: 'bg-[#3f8f4f]', label: 'Upgrade planner' }
}

export function kindLabel(kind: RootKind): string {
  return KIND_STYLES[kind].label
}
