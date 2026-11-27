import { describe, expect, it } from 'vitest'
import { IpcChannel, MAX_SECTION_ID_LENGTH, MAX_SECTION_IDS, sanitizeSectionState } from './ipc'

describe('IpcChannel', () => {
  it('has unique, namespaced channel names', () => {
    const names = Object.values(IpcChannel)
    expect(new Set(names).size).toBe(names.length)
    for (const name of names) expect(name).toMatch(/^[a-z]+:[a-z-]+$/)
  })
})

describe('sanitizeSectionState', () => {
  it('keeps string ids with boolean values', () => {
    expect(sanitizeSectionState({ power: false, 'inventory.entities': true })).toEqual({
      power: false,
      'inventory.entities': true
    })
  })

  it('drops anything else', () => {
    for (const bad of [null, undefined, 'power', 42, [true], true]) {
      expect(sanitizeSectionState(bad)).toEqual({})
    }
    const long = 'x'.repeat(MAX_SECTION_ID_LENGTH + 1)
    expect(sanitizeSectionState({ a: 'yes', b: 1, '': true, [long]: true, c: false })).toEqual({
      c: false
    })
  })

  it('caps the number of ids', () => {
    const many = Object.fromEntries(
      Array.from({ length: MAX_SECTION_IDS + 50 }, (_, i) => [`s${i}`, true])
    )
    expect(Object.keys(sanitizeSectionState(many))).toHaveLength(MAX_SECTION_IDS)
  })
})
