import { ENTITY_SIZES } from '../generated/entity-sizes'

/**
 * Entity size and type lookup. In M2 this is backed by the generated fallback
 * table; in M3 the PrototypeDb provides the same interface for the user's game
 * and mods (docs/spec/03-game-assets.md).
 */
export interface EntityPrototypeInfo {
  type: string
  width: number
  height: number
}

export type PrototypeLookup = (name: string) => EntityPrototypeInfo | undefined

export const fallbackPrototypeLookup: PrototypeLookup = (name) => {
  const entry = ENTITY_SIZES[name]
  return entry ? { type: entry[0], width: entry[1], height: entry[2] } : undefined
}

/** Colour groups for the footprint renderer and legends. */
export type EntityCategory =
  | 'belt'
  | 'inserter'
  | 'machine'
  | 'module'
  | 'power'
  | 'fluid'
  | 'rail'
  | 'vehicle'
  | 'storage'
  | 'circuit'
  | 'logistics'
  | 'defense'
  | 'other'
  | 'unknown'

const CATEGORY_BY_TYPE: Readonly<Record<string, EntityCategory>> = {
  'transport-belt': 'belt',
  'underground-belt': 'belt',
  splitter: 'belt',
  'lane-splitter': 'belt',
  loader: 'belt',
  'loader-1x1': 'belt',
  'linked-belt': 'belt',
  inserter: 'inserter',
  'assembling-machine': 'machine',
  furnace: 'machine',
  'rocket-silo': 'machine',
  lab: 'machine',
  'mining-drill': 'machine',
  'agricultural-tower': 'machine',
  'asteroid-collector': 'machine',
  beacon: 'module',
  'electric-pole': 'power',
  'power-switch': 'power',
  'solar-panel': 'power',
  accumulator: 'power',
  boiler: 'power',
  generator: 'power',
  'burner-generator': 'power',
  reactor: 'power',
  'heat-pipe': 'power',
  'heat-interface': 'power',
  'fusion-reactor': 'power',
  'fusion-generator': 'power',
  'lightning-attractor': 'power',
  'electric-energy-interface': 'power',
  pipe: 'fluid',
  'pipe-to-ground': 'fluid',
  pump: 'fluid',
  'storage-tank': 'fluid',
  'offshore-pump': 'fluid',
  valve: 'fluid',
  'infinity-pipe': 'fluid',
  'straight-rail': 'rail',
  'curved-rail-a': 'rail',
  'curved-rail-b': 'rail',
  'half-diagonal-rail': 'rail',
  'legacy-straight-rail': 'rail',
  'legacy-curved-rail': 'rail',
  'elevated-straight-rail': 'rail',
  'elevated-curved-rail-a': 'rail',
  'elevated-curved-rail-b': 'rail',
  'elevated-half-diagonal-rail': 'rail',
  'rail-ramp': 'rail',
  'rail-support': 'rail',
  'rail-signal': 'rail',
  'rail-chain-signal': 'rail',
  'train-stop': 'rail',
  locomotive: 'vehicle',
  'cargo-wagon': 'vehicle',
  'fluid-wagon': 'vehicle',
  'artillery-wagon': 'vehicle',
  'infinity-cargo-wagon': 'vehicle',
  car: 'vehicle',
  'spider-vehicle': 'vehicle',
  container: 'storage',
  'logistic-container': 'storage',
  'linked-container': 'storage',
  'infinity-container': 'storage',
  'cargo-bay': 'storage',
  'cargo-landing-pad': 'storage',
  'space-platform-hub': 'storage',
  'arithmetic-combinator': 'circuit',
  'decider-combinator': 'circuit',
  'constant-combinator': 'circuit',
  'selector-combinator': 'circuit',
  'programmable-speaker': 'circuit',
  lamp: 'circuit',
  'display-panel': 'circuit',
  roboport: 'logistics',
  radar: 'logistics',
  'ammo-turret': 'defense',
  'electric-turret': 'defense',
  'fluid-turret': 'defense',
  'artillery-turret': 'defense',
  wall: 'defense',
  gate: 'defense',
  'land-mine': 'defense',
  thruster: 'power'
}

export function categoryOf(info: EntityPrototypeInfo | undefined): EntityCategory {
  if (!info) return 'unknown'
  return CATEGORY_BY_TYPE[info.type] ?? 'other'
}

/** Rolling stock uses `orientation`, not `direction`, and is not tile-aligned. */
export const ROLLING_STOCK_TYPES: ReadonlySet<string> = new Set([
  'locomotive',
  'cargo-wagon',
  'fluid-wagon',
  'artillery-wagon',
  'infinity-cargo-wagon'
])
