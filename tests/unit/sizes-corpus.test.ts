import { describe, expect, it } from 'vitest'
import { decode } from '@core/codec'
import { migrate1to2 } from '@core/migrate'
import { findAll, layoutBlueprint, type Blueprint } from '@core/model'
import { ENTITY_SIZES_GAME_VERSION, fallbackPrototypeLookup } from '@core/prototypes'
import { loadCorpus } from './corpus'

/**
 * The generated fallback size table (src/core/generated/entity-sizes.ts) must
 * know every entity in the vanilla corpus, including migrated 1.1 blueprints.
 */

const corpus = loadCorpus()

function unknownNames(text: string): string[] {
  const envelope = migrate1to2(decode(text)).envelope
  const unknown = new Set<string>()
  for (const node of findAll(envelope, 'blueprint')) {
    for (const name of layoutBlueprint(node.payload as Blueprint, fallbackPrototypeLookup)
      .unknownNames) {
      unknown.add(name)
    }
  }
  return [...unknown].sort()
}

describe('fallback size table', () => {
  it('is generated from a game dump', () => {
    expect(ENTITY_SIZES_GAME_VERSION).toMatch(/^2\.\d+\.\d+$/)
  })

  it('has the expected sizes for a few well-known entities', () => {
    const size = (name: string): [number, number] | undefined => {
      const info = fallbackPrototypeLookup(name)
      return info && [info.width, info.height]
    }
    expect(size('assembling-machine-3')).toEqual([3, 3])
    expect(size('splitter')).toEqual([2, 1])
    expect(size('decider-combinator')).toEqual([1, 2])
    expect(size('roboport')).toEqual([4, 4])
    expect(size('rocket-silo')).toEqual([9, 9])
    expect(size('foundry')).toEqual([5, 5])
    expect(size('straight-rail')).toEqual([2, 2])
    // Not blueprintable, filtered out by the generator.
    expect(size('tree-01')).toBeUndefined()
    expect(size('assembling-machine-3-remnants')).toBeUndefined()
  })

  describe.each(corpus.filter((f) => f.category !== 'modded'))('$name', ({ text }) => {
    it('has no unknown entities', () => {
      expect(unknownNames(text)).toEqual([])
    })
  })

  describe.each(corpus.filter((f) => f.category === 'modded'))('$name', ({ text }) => {
    it('reports only modded entities as unknown', () => {
      const unknown = unknownNames(text)
      expect(unknown.length).toBeGreaterThan(0)
      for (const name of unknown) {
        expect(name).toMatch(/^(kr-|py-|washer$|nexelit-|soil-extractor)/)
      }
    })
  })
})
