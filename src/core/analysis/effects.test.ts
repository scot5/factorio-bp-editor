import { describe, expect, it } from 'vitest'
import { dbPrototypeLookup, type PrototypeDb } from '../prototypes'
import { layoutBlueprint, type Blueprint } from '../model'
import { entityEffects, installedModules, moduleEffects } from './effects'
import { blueprintOf, modules, powerDb as db } from './test-db'

const layout = (bp: Blueprint, d: PrototypeDb = db): ReturnType<typeof layoutBlueprint> =>
  layoutBlueprint(bp, dbPrototypeLookup(d))

describe('installedModules', () => {
  it('counts modules in the module inventory only', () => {
    const bp = blueprintOf([
      [
        'assembling-machine-3',
        0.5,
        0.5,
        {
          items: [
            modules('speed-module', 2, 4, 'legendary'),
            // Modules as a recipe ingredient (input inventory 2) are not installed.
            modules('speed-module', 5, 2),
            {
              id: { name: 'efficiency-module' },
              items: { in_inventory: [{ inventory: 4, stack: 2, count: 2 }] }
            },
            // Not a module.
            { id: { name: 'iron-plate' }, items: { in_inventory: [{ inventory: 4, stack: 3 }] } }
          ]
        }
      ]
    ])
    expect(installedModules(db, bp.entities![0]!, 'assembling-machine')).toEqual([
      { item: 'speed-module', quality: 'legendary', count: 2 },
      { item: 'efficiency-module', count: 2 }
    ])
    expect(installedModules(db, bp.entities![0]!, 'container')).toEqual([])
  })
})

describe('moduleEffects', () => {
  it('scales only the beneficial effects by quality', () => {
    expect(moduleEffects(db, 'speed-module')).toEqual({
      speed: 0.2,
      consumption: 0.5,
      quality: -0.1
    })
    const legendary = moduleEffects(db, 'speed-module', 'legendary')
    expect(legendary.speed).toBeCloseTo(0.5)
    expect(legendary.consumption).toBe(0.5)
    expect(legendary.quality).toBe(-0.1)
    expect(moduleEffects(db, 'efficiency-module', 'legendary').consumption).toBeCloseTo(-0.75)
    expect(moduleEffects(db, 'iron-plate')).toEqual({})
  })
})

describe('entityEffects', () => {
  const speed2 = { items: [modules('speed-module', 2, 1)] }

  it('adds own modules and beacons, scaled by distribution effectivity and profile', () => {
    // Assembler at the origin, beacons left and right of it, one far away.
    const bp = blueprintOf([
      ['assembling-machine-3', 0.5, 0.5, { items: [modules('efficiency-module', 1, 4)] }],
      ['beacon', -2.5, 0.5, speed2],
      ['beacon', 3.5, 0.5, speed2],
      ['beacon', 30.5, 0.5, speed2],
      // Beacons without modules transmit nothing and do not count.
      ['beacon', 0.5, 3.5]
    ])
    const effects = entityEffects(db, layout(bp))
    const machine = effects.get(0)!
    expect(machine.beacons.sort()).toEqual([1, 2])
    // Each beacon: 2 × 0.5 consumption × 1.5 effectivity × profile[1] 0.7071.
    expect(machine.effects.consumption).toBeCloseTo(-0.3 + 2 * 2 * 0.5 * 1.5 * 0.7071)
    expect(machine.effects.speed).toBeCloseTo(2 * 2 * 0.2 * 1.5 * 0.7071)
    // The beacon does not allow quality, so the speed module's quality penalty stays out.
    expect(machine.effects.quality).toBeUndefined()
    expect(effects.has(1)).toBe(false)
  })

  it('adds the per-level distribution bonus of a quality beacon', () => {
    const bp = blueprintOf([
      ['assembling-machine-3', 0.5, 0.5],
      ['beacon', 3.5, 0.5, { quality: 'legendary', ...speed2 }]
    ])
    const machine = entityEffects(db, layout(bp)).get(0)!
    expect(machine.effects.speed).toBeCloseTo(2 * 0.2 * (1.5 + 0.2 * 5))
  })

  it('leaves machines without modules or beacons out', () => {
    expect(entityEffects(db, layout(blueprintOf([['assembling-machine-3', 0.5, 0.5]]))).size).toBe(
      0
    )
  })
})
