import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SectionState } from '@core/ipc'

const saved: SectionState[] = []
let stored: SectionState = {}
vi.stubGlobal('window', {
  api: {
    ui: {
      getSections: () => Promise.resolve(stored),
      setSections: (state: SectionState) => {
        saved.push(state)
        return Promise.resolve()
      }
    }
  }
})

const { isOpen, loadSections, useSections } = await import('./sections')

beforeEach(() => {
  saved.length = 0
  stored = {}
  useSections.setState({ open: {}, defaults: {} })
})

describe('sections store', () => {
  it('uses the default until toggled, and saves every change', () => {
    const s = useSections.getState()
    s.register('inventory.entities', false)
    expect(isOpen(useSections.getState(), 'inventory.entities')).toBe(false)
    useSections.getState().toggle('inventory.entities')
    expect(isOpen(useSections.getState(), 'inventory.entities')).toBe(true)
    expect(saved).toEqual([{ 'inventory.entities': true }])
  })

  it('opens or closes every registered section', () => {
    const s = useSections.getState()
    s.register('power', true)
    s.register('power.consumers', true)
    s.register('inventory.tiles', false)
    s.setAll(false)
    expect(useSections.getState().open).toEqual({
      power: false,
      'power.consumers': false,
      'inventory.tiles': false
    })
    useSections.getState().setAll(true)
    expect(Object.values(useSections.getState().open)).toEqual([true, true, true])
  })

  it('loads the saved state; choices made before it arrives win', async () => {
    stored = { power: false, production: true }
    // Open by default, so this closes it before the saved state arrives.
    useSections.getState().toggle('production')
    await loadSections()
    expect(useSections.getState().open).toEqual({ power: false, production: false })
  })
})
