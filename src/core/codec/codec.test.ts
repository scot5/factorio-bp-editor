import { strToU8, zlibSync, deflateSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { encodeBase64 } from './base64'
import { decode, decodeToJson, encode, encodeJson } from './codec'
import { ROOT_KINDS, rootKind, rootPayload, type BlueprintEnvelope } from './envelope'
import { DecodeError, type DecodeErrorReason } from './errors'

const VERSION_2_1_25 = 562954250027018

const sample: BlueprintEnvelope = {
  blueprint: {
    item: 'blueprint',
    label: 'Test',
    entities: [
      { entity_number: 1, name: 'roboport', position: { x: 0, y: 0 } },
      {
        entity_number: 2,
        name: 'asteroid-collector',
        position: { x: 4.5, y: -2.5 },
        'result-inventory': null
      }
    ],
    wires: [[1, 5, 2, 5]],
    unknown_future_field: { nested: [1, 'two', true, null] },
    version: VERSION_2_1_25
  }
}

function expectDecodeError(input: string, reason: DecodeErrorReason): void {
  try {
    decode(input)
  } catch (error) {
    expect(error).toBeInstanceOf(DecodeError)
    expect((error as DecodeError).reason).toBe(reason)
    expect((error as DecodeError).userMessage.length).toBeGreaterThan(0)
    return
  }
  throw new Error(`expected DecodeError(${reason})`)
}

/** Builds a string from raw JSON text, bypassing `encode`'s typing. */
const stringFor = (json: string): string => '0' + encodeBase64(zlibSync(strToU8(json)))

describe('encode / decode', () => {
  it('round-trips an envelope, keeping unknown fields and null', () => {
    const decoded = decode(encode(sample))
    expect(decoded).toStrictEqual(sample)
    expect(rootKind(decoded)).toBe('blueprint')
    expect(rootPayload(decoded)['unknown_future_field']).toEqual({ nested: [1, 'two', true, null] })
    expect(rootPayload(decoded)['version']).toBe(VERSION_2_1_25)
  })

  it('produces a string starting with the version byte 0', () => {
    expect(encode(sample)).toMatch(/^0[A-Za-z0-9+/]+=*$/)
  })

  it('keeps key order', () => {
    const json = JSON.stringify(sample)
    expect(decodeToJson(encode(sample))).toBe(json)
  })

  it('handles non-ASCII text (rich text, emoji, CJK)', () => {
    const env: BlueprintEnvelope = {
      blueprint: {
        item: 'blueprint',
        label: '[color=124,252,0]☢️ 東方 ✓[/color]',
        version: VERSION_2_1_25
      }
    }
    expect(decode(encode(env))).toStrictEqual(env)
  })

  it('accepts all four root kinds', () => {
    for (const key of ROOT_KINDS) {
      const env = { [key]: { item: key, version: VERSION_2_1_25 } } as unknown as BlueprintEnvelope
      expect(rootKind(decode(encode(env)))).toBe(key)
    }
  })

  it('ignores whitespace and line breaks anywhere in the string', () => {
    const s = encode(sample)
    const messy = `  \n${s.slice(0, 10)}\r\n ${s.slice(10, 30)}\t${s.slice(30)}\n\n`
    expect(decode(messy)).toStrictEqual(sample)
  })

  it('supports other compression levels', () => {
    expect(decode(encode(sample, { level: 0 }))).toStrictEqual(sample)
    expect(decode(encode(sample, { level: 1 }))).toStrictEqual(sample)
  })

  it('encodeJson writes the JSON text unchanged', () => {
    const json = '{"blueprint":{"item":"blueprint","version":1}}'
    expect(decodeToJson(encodeJson(json))).toBe(json)
  })
})

describe('decode errors', () => {
  it('empty', () => {
    expectDecodeError('', 'empty')
    expectDecodeError('  \n\t ', 'empty')
  })

  it('bad-version-byte', () => {
    expectDecodeError('1' + encode(sample).slice(1), 'bad-version-byte')
    expectDecodeError('hello world', 'bad-version-byte')
  })

  it('bad-base64', () => {
    expectDecodeError('0', 'bad-base64')
    expectDecodeError('0eNq!!!!', 'bad-base64')
    expectDecodeError('0eNqé', 'bad-base64')
  })

  it('bad-zlib', () => {
    expectDecodeError('0' + encodeBase64(strToU8('not compressed at all')), 'bad-zlib')
    // Raw deflate without the zlib header is not accepted.
    expectDecodeError('0' + encodeBase64(deflateSync(strToU8('{}'))), 'bad-zlib')
    // Truncated stream.
    const full = zlibSync(strToU8(JSON.stringify(sample)))
    expectDecodeError('0' + encodeBase64(full.subarray(0, full.length >> 1)), 'bad-zlib')
  })

  it('too-large', () => {
    // 1 MB of zeros compresses to about 1 KB: a miniature zip bomb.
    const bomb = '0' + encodeBase64(zlibSync(new Uint8Array(1024 * 1024)))
    try {
      decode(bomb, { maxInflatedBytes: 64 * 1024 })
      throw new Error('expected too-large')
    } catch (error) {
      expect((error as DecodeError).reason).toBe('too-large')
    }
  })

  it('bad-json', () => {
    expectDecodeError(stringFor('{"blueprint": '), 'bad-json')
    expectDecodeError(stringFor('[1, 2, 3]'), 'bad-json')
    expectDecodeError(stringFor('"just a string"'), 'bad-json')
    expectDecodeError(stringFor('{"blueprint": 42}'), 'bad-json')
  })

  it('unknown-root', () => {
    expectDecodeError(stringFor('{}'), 'unknown-root')
    expectDecodeError(stringFor('{"spaceship": {}}'), 'unknown-root')
    expectDecodeError(stringFor('{"blueprint": {}, "blueprint_book": {}}'), 'unknown-root')
  })

  it('unsafe-version', () => {
    expectDecodeError(stringFor('{"blueprint": {"version": 18014398509481984}}'), 'unsafe-version')
    expectDecodeError(stringFor('{"blueprint": {"version": "2.1"}}'), 'unsafe-version')
  })
})
