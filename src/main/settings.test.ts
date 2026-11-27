import { mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { SettingsStore } from './settings'

const tempFile = (): string => join(mkdtempSync(join(tmpdir(), 'fbe-settings-')), 'settings.json')

describe('SettingsStore', () => {
  it('saves section state next to the other settings and reads it back', () => {
    const file = tempFile()
    const store = new SettingsStore(file)
    store.update({ gamePath: 'C:/Games/Factorio' })
    store.update({ sections: { power: false } })
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({
      gamePath: 'C:/Games/Factorio',
      sections: { power: false }
    })
    expect(new SettingsStore(file).get().sections).toEqual({ power: false })
  })

  it('starts fresh from a corrupt file', () => {
    const file = tempFile()
    writeFileSync(file, '{ not json')
    expect(new SettingsStore(file).get()).toEqual({})
  })
})
