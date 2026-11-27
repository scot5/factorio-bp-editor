import { describe, expect, it } from 'vitest'
import { decode } from '@core/codec'
import { analyse } from '@core/analysis'
import { migrate1to2 } from '@core/migrate'
import { findAll, type Blueprint } from '@core/model'
import { loadCorpus } from './corpus'

/** Inventory over every corpus blueprint, without game data (docs/spec/06-analysis.md § 1). */

const blueprints = loadCorpus()
  .filter((f) => f.category !== 'upgraded')
  .flatMap((file) =>
    findAll(migrate1to2(decode(file.text)).envelope, 'blueprint').map((node, i) => ({
      name: `${file.name} #${i}`,
      blueprint: node.payload as Blueprint
    }))
  )

describe('inventory over the corpus', () => {
  it('covers many blueprints', () => {
    expect(blueprints.length).toBeGreaterThan(30)
  })

  it.each(blueprints)('$name: counts add up', ({ blueprint }) => {
    const { inventory } = analyse(blueprint, null)
    const entities = blueprint.entities?.length ?? 0
    expect(inventory.entityCount).toBe(entities)
    expect(inventory.entities.reduce((n, r) => n + r.count, 0)).toBe(entities)
    expect(inventory.tiles.reduce((n, r) => n + r.count, 0)).toBe(blueprint.tiles?.length ?? 0)
    // Without game data every entity and tile stands in for at least one item.
    const guessed = inventory.materials.filter((m) => m.guessed).reduce((n, m) => n + m.count, 0)
    expect(guessed).toBeGreaterThanOrEqual(entities + (blueprint.tiles?.length ?? 0))
    if (entities > 0) expect(inventory.footprint.occupiedTiles).toBeGreaterThan(0)
  })
})
