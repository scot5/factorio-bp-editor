import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { parseAssetUrl } from '@core/assets'

vi.mock('electron', () => ({ protocol: {} }))

const { resolveAssetPath } = await import('./protocol')
const { validateInstall } = await import('./locate')
const { enabledMods } = await import('./factorio')

let tmp: string

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'fbe-assets-'))
  // icons root and an outside folder
  mkdirSync(join(tmp, 'cache', 'icons', 'item'), { recursive: true })
  writeFileSync(join(tmp, 'cache', 'icons', 'item', 'iron-plate.png'), 'png')
  mkdirSync(join(tmp, 'outside'), { recursive: true })
  writeFileSync(join(tmp, 'outside', 'secret.png'), 'secret')
  // a link inside the icons root pointing outside it ("junction" works on Windows without admin)
  symlinkSync(join(tmp, 'outside'), join(tmp, 'cache', 'icons', 'escape'), 'junction')

  // fake install
  const game = join(tmp, 'Factorio')
  mkdirSync(join(game, 'data', 'base', 'graphics', 'entity'), { recursive: true })
  mkdirSync(join(game, 'data', 'space-age'), { recursive: true })
  writeFileSync(join(game, 'data', 'base', 'info.json'), JSON.stringify({ version: '2.1.25' }))
  writeFileSync(join(game, 'data', 'space-age', 'info.json'), JSON.stringify({ version: '2.1.25' }))
  writeFileSync(join(game, 'data', 'base', 'graphics', 'entity', 'belt.png'), 'png')
  const exe =
    process.platform === 'win32'
      ? join(game, 'bin', 'x64', 'factorio.exe')
      : process.platform === 'darwin'
        ? join(game, 'MacOS', 'factorio')
        : join(game, 'bin', 'x64', 'factorio')
  mkdirSync(join(exe, '..'), { recursive: true })
  writeFileSync(exe, '')

  // fake write-data with mods
  mkdirSync(join(tmp, 'write', 'mods'), { recursive: true })
  writeFileSync(
    join(tmp, 'write', 'mods', 'mod-list.json'),
    JSON.stringify({
      mods: [
        { name: 'base', enabled: true },
        { name: 'space-age', enabled: true },
        { name: 'Krastorio2', enabled: true },
        { name: 'disabled-mod', enabled: false }
      ]
    })
  )
  writeFileSync(join(tmp, 'write', 'mods', 'Krastorio2_2.0.9.zip'), '')
  writeFileSync(join(tmp, 'write', 'mods', 'Krastorio2_2.0.10.zip'), '')
})

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true })
})

describe('resolveAssetPath', () => {
  const roots = (): { icons: string; data: string } => ({
    icons: join(tmp, 'cache', 'icons'),
    data: join(tmp, 'Factorio', 'data')
  })
  const resolveUrl = (url: string): string | null => {
    const request = parseAssetUrl(url)
    return request ? resolveAssetPath(request, roots()) : null
  }

  it('serves files inside the roots', () => {
    expect(resolveUrl('factorio-asset://icons/item/iron-plate.png')).toBe(
      join(tmp, 'cache', 'icons', 'item', 'iron-plate.png')
    )
    expect(resolveUrl('factorio-asset://data/base/graphics/entity/belt.png')).toBe(
      join(tmp, 'Factorio', 'data', 'base', 'graphics', 'entity', 'belt.png')
    )
  })

  it('refuses missing files and links that lead outside the root', () => {
    expect(resolveUrl('factorio-asset://icons/item/missing.png')).toBeNull()
    expect(resolveUrl('factorio-asset://icons/escape/secret.png')).toBeNull()
  })

  it('refuses everything when the root is not available', () => {
    const request = parseAssetUrl('factorio-asset://icons/item/iron-plate.png')!
    expect(resolveAssetPath(request, { icons: null, data: null })).toBeNull()
  })

  it('refuses requests crafted past the URL parser', () => {
    expect(resolveAssetPath({ root: 'icons', segments: ['..', 'outside.png'] }, roots())).toBeNull()
    expect(
      resolveAssetPath({ root: 'data', mod: '..', segments: ['outside', 'secret.png'] }, roots())
    ).toBeNull()
  })
})

describe('validateInstall', () => {
  it('accepts a folder with data/base/info.json and the executable', () => {
    expect(validateInstall(join(tmp, 'Factorio'))).toMatchObject({
      path: join(tmp, 'Factorio'),
      version: '2.1.25'
    })
  })
  it('rejects other folders', () => {
    expect(validateInstall(join(tmp, 'outside'))).toBeNull()
    expect(validateInstall(join(tmp, 'does-not-exist'))).toBeNull()
  })
})

describe('enabledMods', () => {
  it('reads versions of built-in and downloaded mods', () => {
    const install = validateInstall(join(tmp, 'Factorio'))!
    expect(enabledMods(install, join(tmp, 'write'))).toEqual([
      { name: 'base', version: '2.1.25' },
      { name: 'space-age', version: '2.1.25' },
      { name: 'Krastorio2', version: '2.0.10' }
    ])
  })
})
