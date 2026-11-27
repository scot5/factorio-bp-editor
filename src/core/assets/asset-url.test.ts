import { describe, expect, it } from 'vitest'
import { dataUrl, iconUrl, parseAssetUrl } from './asset-url'

describe('asset URLs', () => {
  it('builds and parses icon URLs', () => {
    const url = iconUrl('item', 'iron-plate')
    expect(url).toBe('factorio-asset://icons/item/iron-plate.png')
    expect(parseAssetUrl(url)).toEqual({ root: 'icons', segments: ['item', 'iron-plate.png'] })
  })

  it('builds and parses data URLs from __mod__ paths', () => {
    const url = dataUrl(
      '__base__/graphics/entity/assembling-machine-2/assembling-machine-2-base.png'
    )!
    expect(url).toBe(
      'factorio-asset://data/base/graphics/entity/assembling-machine-2/assembling-machine-2-base.png'
    )
    expect(parseAssetUrl(url)).toEqual({
      root: 'data',
      mod: 'base',
      segments: ['graphics', 'entity', 'assembling-machine-2', 'assembling-machine-2-base.png']
    })
    expect(dataUrl('__space-age__/graphics/icons/foundry.png')).toBe(
      'factorio-asset://data/space-age/graphics/icons/foundry.png'
    )
    expect(dataUrl('graphics/no-mod.png')).toBeNull()
  })

  it.each([
    'factorio-asset://icons/item/../../secret.png',
    'factorio-asset://icons/item/%2e%2e/secret.png',
    'factorio-asset://icons/item/..%2F..%2Fsecret.png',
    'factorio-asset://icons/item/..%5C..%5Csecret.png',
    'factorio-asset://icons/C:%5Cwindows%5Cx.png',
    'factorio-asset://icons/item/a%00.png',
    'factorio-asset://icons/item//x.png',
    'factorio-asset://icons/item/x.exe',
    'factorio-asset://icons/item/x.png?y=1',
    'factorio-asset://icons/a/b/c.png',
    'factorio-asset://data/base/../../x.png',
    'factorio-asset://data/../x.png',
    'factorio-asset://data/base',
    'factorio-asset://elsewhere/x.png',
    'file:///etc/passwd',
    'https://example.com/x.png',
    'not a url'
  ])('rejects %s', (url) => {
    expect(parseAssetUrl(url)).toBeNull()
  })
})
