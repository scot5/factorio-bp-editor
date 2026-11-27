import type { EntityCategory } from '@core/prototypes'

/** Footprint colours per category (fallback renderer, before real sprites in M3). */
export const CATEGORY_COLORS: Record<EntityCategory, number> = {
  belt: 0xd8b23a,
  inserter: 0x6fa8dc,
  machine: 0x7a8b99,
  module: 0x9b6fd6,
  power: 0xe07b39,
  fluid: 0x3f7fbf,
  rail: 0x8c7b6b,
  vehicle: 0xb35c5c,
  storage: 0xa58b5a,
  circuit: 0x4caf7a,
  logistics: 0xc9a227,
  defense: 0x9e4a4a,
  other: 0x6b6b6b,
  unknown: 0xff00ff
}

export const CATEGORY_LABELS: Record<EntityCategory, string> = {
  belt: 'Belts',
  inserter: 'Inserters',
  machine: 'Machines',
  module: 'Beacons',
  power: 'Power',
  fluid: 'Fluids',
  rail: 'Rails & signals',
  vehicle: 'Vehicles',
  storage: 'Storage',
  circuit: 'Circuits & lamps',
  logistics: 'Roboports & radar',
  defense: 'Defense',
  other: 'Other',
  unknown: 'Unknown prototype'
}

export const TILE_COLOR = 0x3a3a34
export const BACKGROUND = 0x1b1b1b
export const GRID_COLOR = 0x2a2a2a
export const CHUNK_COLOR = 0x3c3c3c
export const SELECTION_COLOR = 0xffa200
export const HOVER_COLOR = 0xffffff
export const BOX_SELECT_COLOR = 0xffa200

/** Wire colours, close to the game's wire sprites. */
export const WIRE_COLORS = { copper: 0xcf7c00, red: 0xc83718, green: 0x588c38 } as const
