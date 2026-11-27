import { describe, expect, it } from 'vitest'
import { decode, encode, type JsonObject } from '@core/codec'
import { findAll, validateEnvelope, wireColor, type Blueprint } from '@core/model'
import { migrate1to2, needsMigration, RENAME_STEPS } from '@core/migrate'
import { loadCorpus } from './corpus'

const corpus = loadCorpus()
const legacy = corpus.filter((f) => f.name.startsWith('legacy-1.1/'))
const current = corpus.filter((f) => !f.name.startsWith('legacy-1.1/'))

/** Every name a 1.1 string may contain that 2.x renamed. */
const OLD_NAMES = new Set(RENAME_STEPS.slice(1).flatMap((s) => Object.keys(s.renames)))

describe('1.1 → 2.x migration on the legacy corpus', () => {
  it('has legacy strings to test', () => {
    expect(legacy.length).toBeGreaterThanOrEqual(3)
  })

  describe.each(legacy)('$name', ({ text }) => {
    const original = decode(text)
    const result = migrate1to2(original)
    const out = result.envelope

    it('needs and gets migration', () => {
      expect(needsMigration(original)).toBe(true)
      expect(result.migrated).toBe(true)
      expect(needsMigration(out)).toBe(false)
    })

    it('validates without issues', () => {
      expect(validateEnvelope(out)).toEqual([])
    })

    it('leaves no 1.1 wiring or renamed prototypes behind', () => {
      for (const node of findAll(out, 'blueprint')) {
        for (const entity of (node.payload as Blueprint).entities ?? []) {
          expect(entity).not.toHaveProperty('connections')
          expect(entity).not.toHaveProperty('neighbours')
          expect(OLD_NAMES.has(entity.name), entity.name).toBe(false)
        }
      }
    })

    it('produces only matching-colour wires', () => {
      // Connector 6 is the (unverified) power switch right copper connector
      // assumed by the migration; wireColor deliberately does not know it yet.
      const colour = (c: number): string | null => wireColor(c) ?? (c === 6 ? 'copper' : null)
      for (const node of findAll(out, 'blueprint')) {
        for (const [, ca, , cb] of (node.payload as Blueprint).wires ?? []) {
          expect(colour(ca)).not.toBeNull()
          expect(colour(ca)).toBe(colour(cb))
        }
      }
    })

    it('keeps every entity and its position', () => {
      const before = findAll(original, 'blueprint').map(
        (n) => ((n.payload as JsonObject)['entities'] as JsonObject[] | undefined)?.length ?? 0
      )
      const after = findAll(out, 'blueprint').map(
        (n) => (n.payload as Blueprint).entities?.length ?? 0
      )
      expect(after).toEqual(before)
    })

    it('round-trips through the codec after migration', () => {
      expect(decode(encode(out))).toStrictEqual(out)
    })
  })

  it('converts the expected amount of wiring in the mall', () => {
    const mall = legacy.find((f) => f.name.endsWith('mall_starter_factory.txt'))!
    const out = migrate1to2(decode(mall.text)).envelope
    const wires = findAll(out, 'blueprint').flatMap((n) => (n.payload as Blueprint).wires ?? [])
    expect(wires.length).toBeGreaterThan(100)
  })
})

describe('2.x corpus is untouched by migration', () => {
  it.each(current.map((f) => [f.name, f.text]))('%s', (_name, text) => {
    const env = decode(text)
    expect(migrate1to2(env).migrated).toBe(false)
  })
})
