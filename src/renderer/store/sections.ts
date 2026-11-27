import { create } from 'zustand'
import type { SectionState } from '@core/ipc'

/**
 * Open/closed state of collapsible panel sections (docs/spec/04-visualization.md
 * § Side panel). Saved in settings.json through the bridge; ids not saved use
 * the section's default.
 */
interface SectionsState {
  /** Saved choices, by section id. */
  open: SectionState
  /**
   * Defaults of every section shown this session, registered by `Section`. Ids
   * stay registered when a section unmounts (inside a collapsed report), so
   * "Expand all" also reaches the nested ones.
   */
  defaults: Record<string, boolean>
  register(id: string, defaultOpen: boolean): void
  toggle(id: string): void
  /** Opens or closes every registered section. */
  setAll(open: boolean): void
}

export const isOpen = (s: Pick<SectionsState, 'open' | 'defaults'>, id: string): boolean =>
  s.open[id] ?? s.defaults[id] ?? true

export const useSections = create<SectionsState>()((set, get) => ({
  open: {},
  defaults: {},

  register(id, defaultOpen) {
    if (get().defaults[id] === defaultOpen) return
    set((s) => ({ defaults: { ...s.defaults, [id]: defaultOpen } }))
  },

  toggle(id) {
    save({ ...get().open, [id]: !isOpen(get(), id) })
  },

  setAll(open) {
    const next = { ...get().open }
    for (const id of Object.keys(get().defaults)) next[id] = open
    save(next)
  }
}))

function save(open: SectionState): void {
  useSections.setState({ open })
  void window.api.ui.setSections(open)
}

/** Loads the saved state once at startup. Choices made before it arrives win. */
export async function loadSections(): Promise<void> {
  const saved = await window.api.ui.getSections()
  useSections.setState((s) => ({ open: { ...saved, ...s.open } }))
}
