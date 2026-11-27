import { describe, expect, it } from 'vitest'
import { dbPrototypeLookup } from '../prototypes'
import { layoutBlueprint, type Blueprint } from '../model'
import { analyse } from './index'
import { isSpacePlatform, power, solarFactor, type PowerReport, type PowerSurface } from './power'
import { blueprintOf, modules, powerDb as db } from './test-db'

const report = (bp: Blueprint, surface: PowerSurface = { space: false }): PowerReport =>
  power(db, layoutBlueprint(bp, dbPrototypeLookup(db)), surface)

/** A pole covering the origin, so consumers there count as powered. */
const pole: [string, number, number] = ['small-electric-pole', -1.5, -1.5]

const peakOf = (bp: Blueprint, name: string): number | undefined =>
  report(bp).consumers.find((c) => c.name === name)?.peak

describe('electric draw', () => {
  it('adds the default crafting machine drain of energy_usage / 30', () => {
    const r = report(blueprintOf([pole, ['assembling-machine-3', 0.5, 0.5]]))
    expect(r.consumers).toEqual([
      expect.objectContaining({ name: 'assembling-machine-3', count: 1, indexes: [1] })
    ])
    // The game's tooltip shows 388 kW.
    expect(r.peak).toBeCloseTo(387_500)
    expect(r.drain).toBeCloseTo(12_500)
  })

  it('applies module consumption, at least -80 %', () => {
    const speed = blueprintOf([
      pole,
      ['assembling-machine-3', 0.5, 0.5, { items: [modules('speed-module', 4, 4)] }]
    ])
    expect(peakOf(speed, 'assembling-machine-3')).toBeCloseTo(375_000 * 3 + 12_500)
    const efficiency = blueprintOf([
      pole,
      ['assembling-machine-3', 0.5, 0.5, { items: [modules('efficiency-module', 4, 4)] }]
    ])
    expect(peakOf(efficiency, 'assembling-machine-3')).toBeCloseTo(375_000 * 0.2 + 12_500)
  })

  it('computes inserters from movement and rotation energy', () => {
    const bp = blueprintOf([pole, ['inserter', 0.5, 0.5]])
    // (5 kJ × 0.035 + 5 kJ × 0.014) × 60 + 0.4 kW drain.
    expect(peakOf(bp, 'inserter')).toBeCloseTo(15_100)
    const legendary = blueprintOf([pole, ['inserter', 0.5, 0.5, { quality: 'legendary' }]])
    expect(report(legendary).consumers[0]).toMatchObject({ quality: 'legendary' })
    expect(peakOf(legendary, 'inserter')).toBeCloseTo(14_700 * 2.5 + 400)
  })

  it('uses quality beacon power, turret drain and roboport flow limit', () => {
    const bp = blueprintOf([
      pole,
      ['beacon', 0.5, 0.5, { quality: 'legendary' }],
      ['laser-turret', 1, -1],
      ['roboport', 2, 2]
    ])
    const r = report(bp)
    expect(peakOf(bp, 'beacon')).toBeCloseTo(80_000)
    expect(r.consumers.find((c) => c.name === 'laser-turret')).toMatchObject({
      peak: 24_000,
      drain: 24_000
    })
    expect(peakOf(bp, 'roboport')).toBe(5_000_000)
    // Sorted by peak.
    expect(r.consumers.map((c) => c.name)).toEqual(['roboport', 'beacon', 'laser-turret'])
  })

  it('lists entities that run on fuel separately', () => {
    const r = report(
      blueprintOf([
        ['stone-furnace', 0, 0],
        ['nuclear-reactor', 10.5, 10.5]
      ])
    )
    expect(r.consumers).toEqual([])
    expect(r.nonElectric.map((n) => n.name).sort()).toEqual(['nuclear-reactor', 'stone-furnace'])
    expect(r.unpoweredCount).toBe(0)
  })
})

describe('generation', () => {
  const panels = blueprintOf([
    ['solar-panel', 0.5, 0.5],
    ['solar-panel', 3.5, 0.5, { quality: 'legendary' }]
  ])

  it('averages solar at 70 % on a planet, scaled by its solar power', () => {
    const nauvis = report(panels)
    expect(nauvis.generationPeak).toBeCloseTo(60_000 + 150_000)
    expect(nauvis.generationAverage).toBeCloseTo(0.7 * 210_000)
    expect(nauvis.generators.map((g) => [g.name, g.quality, g.kind])).toEqual([
      ['solar-panel', 'legendary', 'solar'],
      ['solar-panel', undefined, 'solar']
    ])
    const vulcanus = report(panels, { planet: 'vulcanus', space: false })
    expect(vulcanus.generationPeak).toBeCloseTo(4 * 210_000)
    expect(vulcanus.surface).toEqual({ planet: 'vulcanus', space: false, detected: false })
  })

  it('has no night in orbit', () => {
    expect(solarFactor(db, { space: true })).toEqual({ peak: 3, average: 3 })
    expect(solarFactor(db, { planet: 'vulcanus', space: true })).toEqual({ peak: 6, average: 6 })
    expect(solarFactor(db, { planet: 'unknown' }).average).toBeCloseTo(0.7)
  })

  it('adds the reactor neighbour bonus', () => {
    // A 2 × 2 block: each reactor has 2 neighbours, so 3 × 40 MW each.
    const block = blueprintOf([
      ['nuclear-reactor', 0.5, 0.5],
      ['nuclear-reactor', 5.5, 0.5],
      ['nuclear-reactor', 0.5, 5.5],
      ['nuclear-reactor', 5.5, 5.5],
      // Diagonal and gap: no bonus.
      ['nuclear-reactor', 10.5, 10.5],
      ['nuclear-reactor', 30.5, 0.5]
    ])
    const r = report(block)
    expect(r.heatOutput).toBeCloseTo(4 * 120e6 + 2 * 40e6)
    expect(r.heat).toEqual([expect.objectContaining({ name: 'nuclear-reactor', count: 6 })])
  })

  it('sums accumulator storage, with quality', () => {
    const r = report(
      blueprintOf([
        ['accumulator', 0, 0],
        ['accumulator', 2, 0, { quality: 'legendary' }]
      ])
    )
    expect(r.accumulators).toMatchObject({ count: 2, capacity: 5e6 + 30e6, output: 600_000 })
    expect(r.generators).toEqual([])
  })
})

describe('pole coverage and networks', () => {
  it('flags electric entities outside every supply area', () => {
    const r = report(
      blueprintOf([
        pole,
        ['inserter', 0.5, 0.5],
        // The supply area ends at x = 1; a box starting there is outside.
        ['inserter', 1.5, -1.5],
        ['solar-panel', 20.5, 20.5],
        ['stone-furnace', 30, 30]
      ])
    )
    expect(r.unpoweredCount).toBe(2)
    expect(r.unpowered.map((u) => [u.name, u.indexes])).toEqual([
      ['inserter', [2]],
      ['solar-panel', [3]]
    ])
  })

  const wired = (switchState: boolean): Blueprint =>
    blueprintOf(
      [
        ['small-electric-pole', 0.5, 0.5],
        ['small-electric-pole', 5.5, 0.5],
        ['power-switch', 9, 1, { switch_state: switchState }],
        ['small-electric-pole', 12.5, 0.5],
        ['small-electric-pole', 40.5, 0.5],
        ['inserter', 1.5, 1.5]
      ],
      {
        wires: [
          [1, 5, 2, 5],
          [2, 5, 3, 5],
          [3, 6, 4, 5]
        ]
      }
    )

  it('joins poles through copper wires, and through power switches that are on', () => {
    const off = report(wired(false))
    expect(off.poleCount).toBe(4)
    expect(off.networks.map((n) => n.poles.sort())).toEqual([[0, 1], [3], [4]])
    expect(off.networks[0]).toMatchObject({ pole: 'small-electric-pole', members: [5] })
    expect(off.networks[0]!.peak).toBeCloseTo(15_100)
    const on = report(wired(true))
    expect(on.networks.map((n) => n.poles.sort())).toEqual([[0, 1, 3], [4]])
  })

  it('needs no poles on a space platform', () => {
    const bp = blueprintOf([['inserter', 0.5, 0.5]], {
      tiles: [{ name: 'space-platform-foundation', position: { x: 0, y: 0 } }]
    })
    const lookup = dbPrototypeLookup(db)
    expect(isSpacePlatform(db, layoutBlueprint(bp, lookup))).toBe(true)
    expect(
      isSpacePlatform(db, layoutBlueprint(blueprintOf([['asteroid-collector', 0.5, 0.5]]), lookup))
    ).toBe(true)
    expect(isSpacePlatform(db, layoutBlueprint(blueprintOf([pole]), lookup))).toBe(false)

    const auto = report(bp, {})
    expect(auto.surface).toEqual({ planet: 'nauvis', space: true, detected: true })
    expect(auto.unpoweredCount).toBe(0)
    expect(report(bp, { space: false }).unpoweredCount).toBe(1)
  })
})

describe('analyse', () => {
  it('reports power only with game data, and passes the surface settings', () => {
    const bp = blueprintOf([['solar-panel', 0.5, 0.5]])
    expect(analyse(bp, null).power).toBeNull()
    expect(analyse(bp, db).power?.surface).toEqual({
      planet: 'nauvis',
      space: false,
      detected: true
    })
    const orbit = analyse(bp, db, { timeUnit: 'minute', planet: 'vulcanus', space: true })
    expect(orbit.power?.generationPeak).toBeCloseTo(360_000)
  })
})
