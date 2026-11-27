import { inflateSync } from 'zlib'
import { describe, expect, it } from 'vitest'
import { decode, decodeToJson, encode, rootKind, rootPayload, unpackVersion } from '@core/codec'
import { loadCorpus } from './corpus'

/**
 * Round-trip guarantee from docs/spec/02-blueprint-format.md § Round-trip guarantee,
 * checked against every string in tests/corpus.
 */

const corpus = loadCorpus()

/** Independent reference decoder using Node's zlib (not used by the app). */
function referenceDecode(text: string): unknown {
  return JSON.parse(inflateSync(Buffer.from(text.trim().slice(1), 'base64')).toString('utf8'))
}

describe('blueprint corpus', () => {
  it('has the expected number of strings', () => {
    // Update when strings are added to tests/corpus (and describe them in its README).
    expect(corpus.length).toBe(30)
  })

  describe.each(corpus)('$name', ({ category, text }) => {
    it('decodes to the same JSON as the reference decoder', () => {
      expect(decode(text)).toStrictEqual(referenceDecode(text))
    })

    it('survives decode → encode → decode unchanged', () => {
      const first = decode(text)
      const second = decode(encode(first))
      expect(second).toStrictEqual(first)
    })

    it('encodes to a string the reference decoder reads back', () => {
      expect(referenceDecode(encode(decode(text)))).toStrictEqual(referenceDecode(text))
    })

    it('has a readable game version', () => {
      const version = unpackVersion(rootPayload(decode(text))['version'] as number)
      const expectedMajor = category === 'legacy' ? 1 : 2
      expect(version.major).toBe(expectedMajor)
      expect(rootKind(decode(text))).toMatch(
        /^(blueprint|blueprint_book|deconstruction_planner|upgrade_planner)$/
      )
    })

    it('keeps the JSON text identical apart from shortened float digits', () => {
      // See spec 02: the game sometimes writes floats with their full decimal
      // expansion; JSON.stringify writes the shortest equivalent.
      const original = decodeToJson(text)
      const reencoded = decodeToJson(encode(decode(text)))
      const normaliseFloats = (json: string): string =>
        json.replace(/-?\d+\.\d{17,}/g, (n) => String(Number(n)))
      expect(reencoded).toBe(normaliseFloats(original))
    })
  })
})
