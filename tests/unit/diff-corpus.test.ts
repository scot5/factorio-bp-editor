import { describe, expect, it } from 'vitest'
import { decode, rootPayload } from '@core/codec'
import { compare, diffBlueprints } from '@core/analysis'
import { migrate1to2 } from '@core/migrate'
import { findAll, type Blueprint } from '@core/model'
import { fallbackPrototypeLookup } from '@core/prototypes'
import { loadCorpus } from './corpus'

/** Blueprint diff over the corpus (docs/spec/06-analysis.md § 7). */

const corpus = loadCorpus()
const blueprintIn = (name: string): Blueprint => {
  const file = corpus.find((f) => f.name === name)!
  return rootPayload(decode(file.text)) as Blueprint
}

describe('diff of the provider station pair', () => {
  const before = blueprintIn('provider_station.txt')
  const after = blueprintIn('station_provider_with_quality.txt')

  it('lines the two up and finds the swapped inserters', () => {
    const report = compare(before, after, null)
    expect(report.offset).toEqual({ x: 70, y: -450 })
    expect(report.counts.added).toBe(0)
    expect(report.counts.removed).toBe(0)
    expect(report.wires).toEqual({ added: 0, removed: 0 })
    const changed = Object.fromEntries(
      report.changed.map((r) => [`${r.from ?? ''}>${r.name}:${r.fields?.join(',')}`, r.count])
    )
    // 24 of the bulk inserters are legendary; the second string fills in the parameters.
    expect(changed).toMatchObject({
      'stack-inserter>bulk-inserter:name,filters': 24,
      'stack-inserter>bulk-inserter:name,control_behavior,filters,quality': 24,
      '>train-stop:station': 1
    })
    expect(report.changed.some((r) => r.name === 'passive-provider-chest')).toBe(false)
    expect(report.counts.changed + report.counts.unchanged).toBe(112)
    // The label and parameters went away in the second string.
    expect(report.fields).toEqual(expect.arrayContaining(['label', 'parameters']))
  })
})

const blueprints = corpus
  .filter((f) => f.category !== 'upgraded')
  .flatMap((file) =>
    findAll(migrate1to2(decode(file.text)).envelope, 'blueprint').map((node, i) => ({
      name: `${file.name} #${i}`,
      blueprint: node.payload as Blueprint
    }))
  )

describe('diff of each corpus blueprint with itself', () => {
  it.each(blueprints)('$name: no changes', ({ blueprint }) => {
    const diff = diffBlueprints(blueprint, blueprint, fallbackPrototypeLookup)
    expect(diff.offset).toEqual({ x: 0, y: 0 })
    expect(diff.added).toEqual([])
    expect(diff.removed).toEqual([])
    expect(diff.changed).toEqual([])
    expect(diff.wires).toEqual({ added: [], removed: [] })
  })
})
