import { describe, expect, it } from 'vitest'
import { dbPrototypeLookup } from '../prototypes'
import { layoutBlueprint, type Blueprint } from '../model'
import { analyse } from './index'
import {
  drillResources,
  flowRole,
  furnaceRecipes,
  production,
  productAmount,
  surfaceProperties,
  type Flow,
  type ProductionReport,
  type ProductionSettings
} from './production'
import { blueprintOf, modules } from './test-db'
import { productionDb as db } from './test-production-db'

const nauvis = surfaceProperties(db, 'nauvis', false)

const report = (bp: Blueprint, settings: Partial<ProductionSettings> = {}): ProductionReport =>
  production(db, layoutBlueprint(bp, dbPrototypeLookup(db)), { surface: nauvis, ...settings })

const flow = (r: ProductionReport, name: string, quality?: string): Flow | undefined =>
  r.flows.find((f) => f.name === name && f.quality === quality)

/** Entities spaced far apart, so beacons only reach what a test puts next to them. */
const row = (...entities: [string, Record<string, unknown>?][]): Blueprint =>
  blueprintOf(entities.map(([name, extra], i) => [name, i * 20 + 0.5, 0.5, extra]))

describe('crafting machines', () => {
  it('crafts at crafting speed / recipe energy', () => {
    const r = report(row(['assembling-machine-3', { recipe: 'iron-gear-wheel' }]))
    expect(r.machines).toEqual([
      {
        name: 'assembling-machine-3',
        recipe: 'iron-gear-wheel',
        count: 1,
        indexes: [0],
        speed: 1.25,
        productivity: 0,
        cycles: 2.5
      }
    ])
    expect(flow(r, 'iron-plate')).toMatchObject({ consumed: 5, produced: 0, net: -5 })
    expect(flow(r, 'iron-gear-wheel')).toMatchObject({ produced: 2.5, net: 2.5, producers: [0] })
  })

  it('groups machines by name, quality and recipe', () => {
    const r = report(
      row(
        ['assembling-machine-3', { recipe: 'iron-gear-wheel' }],
        ['assembling-machine-3', { recipe: 'iron-gear-wheel' }],
        ['assembling-machine-3', { recipe: 'iron-gear-wheel', quality: 'legendary' }]
      )
    )
    expect(r.machines.map((m) => [m.quality, m.count, m.cycles, m.speed])).toEqual([
      [undefined, 2, 5, 1.25],
      // crafting_machine_speed quality: 1 + 0.3 × 5.
      ['legendary', 1, 6.25, 3.125]
    ])
    expect(flow(r, 'iron-gear-wheel')!.producers).toEqual([0, 1, 2])
  })

  it('applies module speed and productivity', () => {
    const r = report(
      row([
        'assembling-machine-3',
        { recipe: 'iron-gear-wheel', items: [modules('productivity-module', 4, 4)] }
      ])
    )
    const m = r.machines[0]!
    expect(m.speed).toBeCloseTo(1.25 * 0.8)
    expect(m.productivity).toBeCloseTo(0.16)
    expect(m.cycles).toBeCloseTo(2)
    expect(flow(r, 'iron-plate')!.consumed).toBeCloseTo(4)
    expect(flow(r, 'iron-gear-wheel')!.produced).toBeCloseTo(2 * 1.16)
  })

  it('applies beacons', () => {
    const bp = blueprintOf([
      ['assembling-machine-3', 0.5, 0.5, { recipe: 'iron-gear-wheel' }],
      ['beacon', 3.5, 0.5, { items: [modules('speed-module', 2, 1)] }]
    ])
    // 2 × 0.2 speed × 1.5 distribution effectivity.
    expect(report(bp).machines[0]!.speed).toBeCloseTo(1.25 * 1.6)
  })

  it('adds the base productivity of Space Age machines, unless the recipe disallows it', () => {
    const r = report(
      row(
        ['foundry', { recipe: 'casting-iron-gear-wheel' }],
        ['foundry', { recipe: 'casting-pipe' }]
      )
    )
    expect(r.machines.map((m) => [m.recipe, m.productivity])).toEqual([
      ['casting-iron-gear-wheel', 0.5],
      ['casting-pipe', 0]
    ])
    expect(flow(r, 'iron-gear-wheel')!.produced).toBeCloseTo(6)
    expect(flow(r, 'pipe')!.produced).toBeCloseTo(4)
    expect(flow(r, 'molten-iron')).toMatchObject({ type: 'fluid', consumed: 80 })
  })

  it('uses the fixed recipe of rocket silos', () => {
    const r = report(row(['rocket-silo']))
    expect(r.machines[0]).toMatchObject({ recipe: 'rocket-part', cycles: 1 / 3 })
    expect(r.machines[0]!.assumed).toBeUndefined()
  })

  it('keeps the recipe quality on item flows, not fluids', () => {
    const r = report(
      row(
        ['assembling-machine-3', { recipe: 'iron-gear-wheel', recipe_quality: 'uncommon' }],
        ['foundry', { recipe: 'casting-iron-gear-wheel', recipe_quality: 'uncommon' }]
      )
    )
    expect(r.machines.map((m) => m.recipeQuality)).toEqual(['uncommon', 'uncommon'])
    expect(flow(r, 'iron-plate', 'uncommon')!.consumed).toBe(5)
    expect(flow(r, 'iron-gear-wheel', 'uncommon')!.producers).toEqual([0, 1])
    expect(flow(r, 'molten-iron')!.quality).toBeUndefined()
  })

  it('takes probabilities and productivity-ignored amounts into account', () => {
    const r = report(
      row([
        'crusher',
        { recipe: 'metallic-asteroid-crushing', items: [modules('productivity-module', 2, 4)] }
      ])
    )
    const cycles = (1 * 0.9) / 2
    expect(r.machines[0]!.cycles).toBeCloseTo(cycles)
    expect(flow(r, 'iron-ore')!.produced).toBeCloseTo(cycles * 20 * 1.08)
    // The returned chunk is ignored by productivity: 30 % of one per craft. A
    // catalyst counts by its net amount, so it is not "produced" and not flagged.
    const chunk = flow(r, 'metallic-asteroid-chunk')!
    expect(chunk).toMatchObject({ produced: 0, producers: [], consumers: [0] })
    expect(chunk.consumed).toBeCloseTo(cycles * 0.7)
    expect(r.ratios).toEqual([])
  })

  it('counts a catalyst made in surplus as produced', () => {
    const r = report(row(['centrifuge', { recipe: 'kovarex-enrichment-process' }]))
    expect(flow(r, 'uranium-235')).toMatchObject({ consumed: 0, producers: [0], consumers: [] })
    expect(flow(r, 'uranium-235')!.produced).toBeCloseTo(1 / 60)
    expect(flow(r, 'uranium-238')!.consumed).toBeCloseTo(3 / 60)
  })
})

describe('productAmount', () => {
  it('scales the part not ignored by productivity, with probability and extra count', () => {
    expect(productAmount({ type: 'item', name: 'a', amount: 2 }, 0.5)).toBe(3)
    expect(
      productAmount({ type: 'item', name: 'a', amount: 41, ignoredByProductivity: 40 }, 0.1)
    ).toBeCloseTo(41.1)
    expect(productAmount({ type: 'item', name: 'a', amount: 1, probability: 0.3 }, 1)).toBeCloseTo(
      0.6
    )
    expect(productAmount({ type: 'item', name: 'a', amount: 0, extraCountFraction: 0.5 }, 0)).toBe(
      0.5
    )
  })
})

describe('machines without a rate', () => {
  it('lists machines without a recipe, with parameters or unknown recipes', () => {
    const r = report(
      row(
        ['assembling-machine-3'],
        ['assembling-machine-3', { recipe: 'parameter-0' }],
        ['assembling-machine-3', { recipe: 'removed-recipe' }]
      )
    )
    expect(r.machines).toEqual([])
    expect(r.idle.map((i) => [i.reason, i.recipe, i.indexes])).toEqual([
      ['no-recipe', undefined, [0]],
      ['parameter', 'parameter-0', [1]],
      ['unknown-recipe', 'removed-recipe', [2]]
    ])
  })

  it('offers furnace recipes, and uses an assumed one', () => {
    expect(furnaceRecipes(db, 'electric-furnace')).toEqual(['copper-plate', 'iron-plate'])
    // Recycling recipes are hidden.
    expect(furnaceRecipes(db, 'recycler')).toEqual([])

    const bp = row(['electric-furnace'], ['electric-furnace'], ['recycler'])
    expect(report(bp).idle).toEqual([
      {
        name: 'electric-furnace',
        reason: 'needs-recipe',
        options: ['copper-plate', 'iron-plate'],
        count: 2,
        indexes: [0, 1]
      },
      { name: 'recycler', reason: 'needs-recipe', options: [], count: 1, indexes: [2] }
    ])

    const r = report(bp, { assume: { 'electric-furnace': 'iron-plate' } })
    expect(r.machines).toEqual([
      expect.objectContaining({ recipe: 'iron-plate', assumed: true, count: 2, cycles: 1.25 })
    ])
    expect(r.idle.map((i) => i.name)).toEqual(['recycler'])
    // An assumption the furnace cannot run is ignored.
    expect(report(bp, { assume: { 'electric-furnace': 'iron-gear-wheel' } }).machines).toEqual([])
  })

  it('offers drill resources, and mines an assumed one', () => {
    expect(drillResources(db, 'electric-mining-drill')).toEqual(['iron-ore', 'uranium-ore'])
    // Crude oil is infinite and fluid: its yield depends on the patch.
    expect(drillResources(db, 'pumpjack')).toEqual([])
    const bp = row(['electric-mining-drill'], ['pumpjack'])
    expect(report(bp).idle.map((i) => [i.name, i.reason])).toEqual([
      ['electric-mining-drill', 'needs-resource'],
      ['pumpjack', 'patch']
    ])

    const iron = report(bp, { assume: { 'electric-mining-drill': 'iron-ore' } })
    expect(iron.machines[0]).toMatchObject({ resource: 'iron-ore', speed: 0.5, cycles: 0.5 })
    expect(flow(iron, 'iron-ore')!.produced).toBe(0.5)

    // Uranium: mining time 2, and 10 sulfuric acid per 10 cycles.
    const uranium = report(bp, { assume: { 'electric-mining-drill': 'uranium-ore' } })
    expect(flow(uranium, 'uranium-ore')!.produced).toBe(0.25)
    expect(flow(uranium, 'sulfuric-acid')).toMatchObject({ type: 'fluid', consumed: 0.25 })
  })
})

describe('ratio check', () => {
  const cablesFor = (cable: number, circuit: number): Blueprint =>
    row(
      ...Array.from(
        { length: cable },
        () =>
          ['assembling-machine-3', { recipe: 'copper-cable' }] as [string, Record<string, unknown>]
      ),
      ...Array.from(
        { length: circuit },
        () =>
          ['assembling-machine-3', { recipe: 'electronic-circuit' }] as [
            string,
            Record<string, unknown>
          ]
      )
    )

  it('flags under-supplied consumers and over-supplying producers', () => {
    // A cable machine makes 5/s, a circuit machine uses 7.5/s.
    const under = report(cablesFor(1, 1))
    expect(under.ratios).toEqual([
      { type: 'item', name: 'copper-cable', supply: 2 / 3, status: 'under', indexes: [1] }
    ])
    expect(report(cablesFor(3, 2)).ratios).toEqual([])
    const over = report(cablesFor(2, 1))
    expect(over.ratios).toEqual([
      expect.objectContaining({ name: 'copper-cable', status: 'over', indexes: [0, 1] })
    ])
    expect(over.ratios[0]!.supply).toBeCloseTo(4 / 3)
  })

  it('sorts flows into outputs, inputs and balanced ones', () => {
    const r = report(cablesFor(3, 2))
    expect(r.flows.map((f) => [f.name, flowRole(f)])).toEqual([
      ['copper-cable', 'balanced'],
      ['copper-plate', 'input'],
      ['electronic-circuit', 'output'],
      ['iron-plate', 'input']
    ])
    expect(flowRole({ produced: 1 / 3, consumed: 1 / 3 + 1e-12, net: -1e-12 })).toBe('balanced')
  })

  it('does not flag pure inputs or outputs', () => {
    const r = report(cablesFor(1, 0))
    expect(r.flows.map((f) => f.name)).toEqual(['copper-cable', 'copper-plate'])
    expect(r.ratios).toEqual([])
  })
})

describe('Space Age', () => {
  const bacteria = row(['biochamber', { recipe: 'iron-bacteria-cultivation' }])

  it('warns about recipes whose surface conditions fail', () => {
    expect(report(bacteria).surfaceWarnings).toEqual([
      {
        recipe: 'iron-bacteria-cultivation',
        property: 'pressure',
        value: 1000,
        min: 2000,
        max: 2000,
        indexes: [0]
      }
    ])
    expect(
      report(bacteria, { surface: surfaceProperties(db, 'gleba', false) }).surfaceWarnings
    ).toEqual([])
  })

  it('marks items that spoil', () => {
    const r = report(bacteria)
    expect(flow(r, 'iron-bacteria')).toMatchObject({ spoils: true, net: 1.5 })
    expect(flow(r, 'bioflux')!.spoils).toBeUndefined()
  })

  it('reads surface properties from planets, the platform and defaults', () => {
    expect(nauvis).toMatchObject({ pressure: 1000, gravity: 10, 'day-night-cycle': 25200 })
    expect(surfaceProperties(db, 'gleba', false)).toMatchObject({ pressure: 2000, gravity: 20 })
    expect(surfaceProperties(db, 'gleba', true)).toMatchObject({ pressure: 0, gravity: 0 })
  })

  it('checks conditions on the detected platform surface in analyse()', () => {
    const platform = blueprintOf(
      [['biochamber', 0.5, 0.5, { recipe: 'iron-bacteria-cultivation' }]],
      {
        tiles: [{ name: 'space-platform-foundation', position: { x: 0, y: 0 } }]
      }
    )
    const r = analyse(platform, db).production!
    expect(r.surfaceWarnings[0]).toMatchObject({ property: 'pressure', value: 0 })
    expect(
      analyse(platform, db, { timeUnit: 'minute', planet: 'gleba', space: false }).production!
        .surfaceWarnings
    ).toEqual([])
  })
})

describe('analyse', () => {
  it('has no production report without game data', () => {
    expect(analyse(row(['assembling-machine-3']), null).production).toBeNull()
  })

  it('passes the assumptions through', () => {
    const r = analyse(row(['electric-furnace']), db, {
      timeUnit: 'minute',
      assume: { 'electric-furnace': 'copper-plate' }
    })
    expect(r.production!.machines[0]).toMatchObject({ recipe: 'copper-plate', assumed: true })
  })
})
