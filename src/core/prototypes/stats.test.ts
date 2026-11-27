import { describe, expect, it } from 'vitest'
import {
  entityStats,
  fluidHeat,
  itemCounts,
  itemStats,
  parseEnergy,
  qualityMultiplier,
  qualityMultipliers
} from './stats'

// Excerpts from the 2.1.25 data-raw-dump.json.

describe('parseEnergy', () => {
  it('reads SI prefixes for W and J', () => {
    expect(parseEnergy('150kW')).toBe(150_000)
    expect(parseEnergy('0.4kW')).toBeCloseTo(400)
    expect(parseEnergy('4MJ')).toBe(4_000_000)
    expect(parseEnergy('1.21GJ')).toBeCloseTo(1.21e9)
    expect(parseEnergy('5W')).toBe(5)
    expect(parseEnergy('2EJ')).toBe(2e18)
    expect(parseEnergy(' 1.5e3 kW ')).toBe(1.5e6)
    expect(parseEnergy(12)).toBe(12)
  })
  it('rejects anything else', () => {
    expect(parseEnergy('fast')).toBeUndefined()
    expect(parseEnergy('5kV')).toBeUndefined()
    expect(parseEnergy(undefined)).toBeUndefined()
  })
})

describe('entityStats', () => {
  it('reads crafting machines, including base effects', () => {
    expect(
      entityStats('assembling-machine', {
        crafting_speed: 4,
        crafting_categories: ['metallurgy'],
        module_slots: 4,
        allowed_effects: ['consumption', 'speed', 'productivity', 'pollution', 'quality'],
        effect_receiver: { base_effect: { productivity: 0.5 } },
        energy_usage: '2500kW',
        energy_source: { type: 'electric', usage_priority: 'secondary-input' }
      })
    ).toEqual({
      craftingSpeed: 4,
      craftingCategories: ['metallurgy'],
      moduleSlots: 4,
      allowedEffects: ['consumption', 'speed', 'productivity', 'pollution', 'quality'],
      baseEffect: { productivity: 0.5 },
      energyUsage: 2_500_000,
      energySource: { type: 'electric' }
    })
  })

  it('applies the per-type allowed_effects and module_slots defaults', () => {
    expect(entityStats('furnace', { crafting_speed: 1 })).toMatchObject({
      moduleSlots: 0,
      allowedEffects: []
    })
    expect(entityStats('mining-drill', { mining_speed: 0.25 })?.allowedEffects).toHaveLength(5)
    expect(entityStats('lab', { researching_speed: 2 })?.allowedEffects).not.toContain('quality')
  })

  it('reads burner energy sources and boilers', () => {
    expect(
      entityStats('boiler', {
        energy_consumption: '1.8MW',
        energy_source: { type: 'burner', fuel_categories: ['chemical'], effectivity: 1 }
      })
    ).toEqual({
      energyUsage: 1_800_000,
      energySource: { type: 'burner', fuelCategories: ['chemical'] }
    })
  })

  it('reads inserters', () => {
    expect(
      entityStats('inserter', {
        rotation_speed: 0.04,
        extension_speed: 0.1,
        bulk: true,
        stack_size_bonus: 4,
        max_belt_stack_size: 4,
        energy_per_movement: '20kJ',
        energy_per_rotation: '20kJ',
        energy_source: { type: 'electric', drain: '1kW' },
        circuit_wire_max_distance: 9
      })
    ).toEqual({
      energySource: { type: 'electric', drain: 1000 },
      energyPerMovement: 20_000,
      energyPerRotation: 20_000,
      rotationSpeed: 0.04,
      extensionSpeed: 0.1,
      bulk: true,
      stackSizeBonus: 4,
      maxBeltStackSize: 4,
      circuitWireMaxDistance: 9
    })
  })

  it('reads belts and undergrounds, but not the speed of other types', () => {
    expect(entityStats('underground-belt', { speed: 0.125, max_distance: 11 })).toEqual({
      beltSpeed: 0.125,
      maxDistance: 11
    })
    expect(entityStats('car', { speed: 0.3 })).toBeUndefined()
  })

  it('reads the pipe-to-ground reach from its underground connection', () => {
    expect(
      entityStats('pipe-to-ground', {
        fluid_box: {
          pipe_connections: [
            { direction: 0, position: [0, 0] },
            {
              direction: 8,
              position: [0, 0],
              connection_type: 'underground',
              max_underground_distance: 10
            }
          ]
        }
      })
    ).toEqual({ maxDistance: 10 })
  })

  it('reads poles, beacons, drills and placeable_by', () => {
    expect(
      entityStats('electric-pole', { supply_area_distance: 3.5, maximum_wire_distance: 9 })
    ).toEqual({ supplyAreaDistance: 3.5, maxWireDistance: 9 })
    expect(
      entityStats('beacon', {
        module_slots: 2,
        allowed_effects: ['consumption', 'speed', 'pollution'],
        supply_area_distance: 3,
        distribution_effectivity: 1.5,
        distribution_effectivity_bonus_per_quality_level: 0.2,
        profile: [1, 0.7071, 0.5773]
      })
    ).toEqual({
      moduleSlots: 2,
      allowedEffects: ['consumption', 'speed', 'pollution'],
      supplyAreaDistance: 3,
      distributionEffectivity: 1.5,
      distributionEffectivityBonusPerQualityLevel: 0.2,
      profile: [1, 0.7071, 0.5773]
    })
    expect(
      entityStats('mining-drill', { mining_speed: 0.5, resource_categories: ['basic-solid'] })
    ).toMatchObject({ miningSpeed: 0.5, resourceCategories: ['basic-solid'] })
    expect(entityStats('curved-rail-a', { placeable_by: { item: 'rail', count: 3 } })).toEqual({
      placeableBy: [{ item: 'rail', count: 3 }]
    })
  })
})

describe('itemCounts', () => {
  it('accepts one entry or a list, and defaults count to 1', () => {
    expect(itemCounts({ item: 'rail', count: 4 })).toEqual([{ item: 'rail', count: 4 }])
    expect(itemCounts([{ item: 'a' }, { item: 'b', count: 2 }, 'junk'])).toEqual([
      { item: 'a', count: 1 },
      { item: 'b', count: 2 }
    ])
    expect(itemCounts(undefined)).toBeUndefined()
  })
})

describe('itemStats', () => {
  it('reads fuel, tiles and modules', () => {
    expect(itemStats('item', { fuel_value: '4MJ', fuel_categories: ['chemical'] })).toEqual({
      fuelValue: 4_000_000,
      fuelCategories: ['chemical']
    })
    expect(
      itemStats('item', { place_as_tile: { result: 'stone-path', condition_size: 1 } })
    ).toEqual({ placeAsTile: 'stone-path' })
    expect(
      itemStats('module', {
        category: 'speed',
        tier: 3,
        effect: { consumption: 0.7, speed: 0.5, quality: -0.025 }
      })
    ).toEqual({
      module: {
        category: 'speed',
        tier: 3,
        effect: { consumption: 0.7, speed: 0.5, quality: -0.025 }
      }
    })
    expect(itemStats('item', { fuel_value: '0J' })).toEqual({})
  })
})

describe('quality multipliers', () => {
  const legendary = {
    level: 5,
    multipliers: qualityMultipliers({
      level: 5,
      beacon_power_usage_multiplier: 1 / 6,
      mining_drill_resource_drain_multiplier: 1 / 6,
      next_probability: 0.1
    })
  }
  it('keeps only explicit *_multiplier fields', () => {
    expect(legendary.multipliers).toEqual({
      beacon_power_usage: 1 / 6,
      mining_drill_resource_drain: 1 / 6
    })
  })
  it('derives the game defaults from level', () => {
    expect(qualityMultiplier(legendary, 'default')).toBeCloseTo(2.5)
    expect(qualityMultiplier(legendary, 'crafting_machine_speed')).toBeCloseTo(2.5)
    expect(qualityMultiplier(legendary, 'beacon_power_usage')).toBeCloseTo(1 / 6)
    expect(qualityMultiplier({ level: 2 }, 'beacon_power_usage')).toBe(1)
    expect(qualityMultiplier({ level: 5 }, 'range')).toBeCloseTo(1.5)
    expect(qualityMultiplier(undefined, 'default')).toBe(1)
    expect(qualityMultiplier(legendary, 'accumulator_capacity')).toBe(6)
  })
})

describe('power fields (format 8)', () => {
  const steam = fluidHeat({ default_temperature: 15, max_temperature: 500, heat_capacity: '0.2kJ' })
  const context = { fluid: (name: string) => (name === 'steam' ? steam : undefined) }
  const electric = { type: 'electric', usage_priority: 'secondary-output' }

  it('reads fluid heat, with the 1kJ heat capacity default', () => {
    expect(steam).toEqual({ defaultTemperature: 15, heatCapacity: 200 })
    expect(fluidHeat({ default_temperature: 25 })).toEqual({
      defaultTemperature: 25,
      heatCapacity: 1000
    })
    expect(fluidHeat({})).toBeUndefined()
  })

  it('derives steam engine and turbine output from the fluid heat', () => {
    const engine = {
      fluid_usage_per_tick: 0.5,
      maximum_temperature: 165,
      effectivity: 1,
      fluid_box: { filter: 'steam' },
      energy_source: electric
    }
    expect(entityStats('generator', engine, context)?.powerOutput).toBeCloseTo(900_000)
    const turbine = { ...engine, fluid_usage_per_tick: 1, maximum_temperature: 500 }
    expect(entityStats('generator', turbine, context)?.powerOutput).toBeCloseTo(5_820_000)
    expect(
      entityStats('generator', { ...engine, max_power_output: '1MW' }, context)?.powerOutput
    ).toBe(1_000_000)
    // No fluid data: no output rather than a guess.
    expect(entityStats('generator', engine)?.powerOutput).toBeUndefined()
  })

  it('reads solar panels, burner and fusion generators and energy interfaces', () => {
    expect(entityStats('solar-panel', { production: '60kW', energy_source: electric })).toEqual({
      energySource: { type: 'electric' },
      powerOutput: 60_000
    })
    expect(entityStats('burner-generator', { max_power_output: '1MW' })?.powerOutput).toBe(1e6)
    expect(
      entityStats('fusion-generator', {
        max_fluid_usage: 0.0333,
        energy_source: { ...electric, output_flow_limit: '50MW' }
      })
    ).toEqual({
      energySource: { type: 'electric', outputFlowLimit: 50e6 },
      powerOutput: 50e6
    })
    expect(
      entityStats('electric-energy-interface', { energy_production: '500GW' })?.powerOutput
    ).toBe(500e9)
  })

  it('reads reactors, with the neighbour bonus default of 1', () => {
    expect(
      entityStats('reactor', {
        consumption: '40MW',
        energy_source: { type: 'burner', fuel_categories: ['nuclear'] }
      })
    ).toEqual({
      heatOutput: 40e6,
      neighbourBonus: 1,
      energySource: { type: 'burner', fuelCategories: ['nuclear'] }
    })
    expect(
      entityStats('reactor', { consumption: '40MW', neighbour_bonus: 0 })?.neighbourBonus
    ).toBe(0)
  })

  it('reads electric buffers and flow limits', () => {
    expect(
      entityStats('accumulator', {
        energy_source: {
          type: 'electric',
          buffer_capacity: '5MJ',
          usage_priority: 'tertiary',
          input_flow_limit: '300kW',
          output_flow_limit: '300kW'
        }
      })
    ).toEqual({
      energySource: {
        type: 'electric',
        bufferCapacity: 5e6,
        inputFlowLimit: 300_000,
        outputFlowLimit: 300_000
      }
    })
  })

  it('reads the other names of energy usage', () => {
    const usage = (type: string, proto: Record<string, unknown>): unknown => {
      const s = entityStats(type, proto)
      return [s?.energyUsage, s?.activeEnergyUsage]
    }
    expect(usage('lamp', { energy_usage_per_tick: '5kW' })).toEqual([5000, undefined])
    expect(usage('programmable-speaker', { energy_usage_per_tick: '2kW' })).toEqual([
      2000,
      undefined
    ])
    expect(usage('decider-combinator', { active_energy_usage: '1kW' })).toEqual([1000, undefined])
    expect(usage('fusion-reactor', { power_input: '10MW' })).toEqual([10e6, undefined])
    expect(usage('rocket-silo', { energy_usage: '250kW', active_energy_usage: '3990kW' })).toEqual([
      250_000, 3_990_000
    ])
    expect(
      usage('agricultural-tower', { energy_usage: '100kW', crane_energy_usage: '100kW' })
    ).toEqual([100_000, 100_000])
    // Asteroid collector energies are per tick.
    expect(
      usage('asteroid-collector', { passive_energy_usage: '200J', arm_energy_usage: '1kJ' })
    ).toEqual([12_000, 60_000])
  })

  it('reads the beacon counter and quality_affects_energy_usage', () => {
    expect(entityStats('beacon', { beacon_counter: 'same_type' })?.beaconCounter).toBe('same_type')
    expect(entityStats('beacon', { beacon_counter: 'total' })?.beaconCounter).toBeUndefined()
    expect(
      entityStats('assembling-machine', { quality_affects_energy_usage: true })
        ?.qualityAffectsEnergyUsage
    ).toBe(true)
  })
})
