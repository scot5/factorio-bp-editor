import { describe, expect, it } from 'vitest'
import { decodeBase64, encodeBase64 } from './base64'

const bytes = (...values: number[]): Uint8Array => new Uint8Array(values)
const ascii = (s: string): Uint8Array => new Uint8Array([...s].map((c) => c.charCodeAt(0)))

describe('base64', () => {
  it.each([
    ['', ''],
    ['f', 'Zg=='],
    ['fo', 'Zm8='],
    ['foo', 'Zm9v'],
    ['foob', 'Zm9vYg=='],
    ['fooba', 'Zm9vYmE='],
    ['foobar', 'Zm9vYmFy']
  ])('RFC 4648 vector %j ⇄ %j', (plain, encoded) => {
    expect(encodeBase64(ascii(plain))).toBe(encoded)
    expect(decodeBase64(encoded)).toEqual(ascii(plain))
  })

  it('uses + and / for the high values', () => {
    expect(encodeBase64(bytes(0xfb, 0xff, 0xbf))).toBe('+/+/')
    expect(decodeBase64('+/+/')).toEqual(bytes(0xfb, 0xff, 0xbf))
  })

  it('round-trips every byte value and long inputs', () => {
    const all = new Uint8Array(70_000).map((_, i) => (i * 7 + 3) & 0xff)
    expect(decodeBase64(encodeBase64(all))).toEqual(all)
  })

  it('tolerates missing trailing padding', () => {
    expect(decodeBase64('Zg')).toEqual(ascii('f'))
    expect(decodeBase64('Zm8')).toEqual(ascii('fo'))
  })

  it.each(['Zm9v!', 'Zm 9v', 'Z', 'Zg=a', 'Zm9vé', 'Zg===', '=Zg='])('rejects %j', (input) => {
    expect(decodeBase64(input)).toBeNull()
  })
})
