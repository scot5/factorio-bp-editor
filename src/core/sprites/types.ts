/**
 * Sprite definitions as stored in the PrototypeDb, and the resolved layers the
 * renderer draws. See docs/spec/03-game-assets.md § Sprite definitions.
 *
 * The dump's graphics properties (Sprite, Animation, RotatedSprite, Sprite4Way,
 * Animation4Way, SpriteNWaySheet, …) are normalised at DB build time into this
 * small tree, so the renderer only handles four node kinds. Fields equal to the
 * game's defaults are omitted to keep the cached DB small.
 */

/** Keys of per-direction objects in the dump (`Sprite4Way`, `Animation4Way`, 8-way turret bases). */
export const DIRECTION_KEYS = [
  'north',
  'north_east',
  'east',
  'south_east',
  'south',
  'south_west',
  'west',
  'north_west'
] as const
export type DirectionKey = (typeof DIRECTION_KEYS)[number]

export interface SpriteStripe {
  file: string
  widthInFrames: number
  heightInFrames: number
  x?: number
  y?: number
}

/** One image region definition: a Sprite, Animation, RotatedSprite or RotatedAnimation. */
export interface SpriteLeaf {
  kind: 'sprite'
  /** `__mod__/path.png`; the first file when `files` or `stripes` is set. */
  file: string
  /** `filenames`: frames continue across files, `linesPerFile` lines each. */
  files?: string[]
  linesPerFile?: number
  stripes?: SpriteStripe[]
  width: number
  height: number
  x?: number
  y?: number
  /** Offset of the image centre from the entity centre, in tiles. */
  shift?: [number, number]
  /** Default 1; 0.5 for the high-resolution graphics every 2.x sprite uses. */
  scale?: number
  lineLength?: number
  frameCount?: number
  repeatCount?: number
  /** RotatedSprite / RotatedAnimation: number of orientations in the sheet. */
  directionCount?: number
  /** `back_equals_front`: the orientations cover half a turn, so opposite facings share a frame. */
  backEqualsFront?: true
  /**
   * Sheet index per 16-way direction, from a lookup table in the prototype
   * (rail signal `structure_align_to_animation_index` and the rail piece's
   * `align_to_frame_index`): the direction index of a rotated sheet, or the
   * frame of an animation.
   */
  indexByDirection?: number[]
  variationCount?: number
  shadow?: true
  /** RGBA, 0–1. */
  tint?: [number, number, number, number]
  /** `apply_runtime_tint`: a mask coloured with the player colour. */
  runtimeTint?: true
  additive?: true
}

export interface SpriteLayers {
  kind: 'layers'
  layers: SpriteNode[]
}

/** Different graphics per direction; missing keys fall back (see resolve.ts). */
export interface SpriteDirections {
  kind: 'directions'
  directions: Partial<Record<DirectionKey, SpriteNode>>
}

/** SpriteNWaySheet: one horizontal sheet with `frames` directions (default 4). */
export interface SpriteSheet {
  kind: 'sheet'
  frames: number
  sprite: SpriteNode
}

export type SpriteNode = SpriteLeaf | SpriteLayers | SpriteDirections | SpriteSheet

/** One graphics property of an entity, drawn in order. */
export interface GraphicsPart {
  node: SpriteNode
  /**
   * The node's `direction_count` is a variation or animation, not the facing
   * (electric pole wire angles, radar dish), so always draw index 0.
   */
  fixedRotation?: true
  /** Drawn on the ground, beneath every shadow and body (integration patches, belts). */
  ground?: true
  /**
   * Per-direction objects: draw only the exact direction, with no fallback
   * (the splitter's `structure_patch` is empty for north and south).
   */
  exact?: true
  /** Where the part is drawn, when not the usual ground / shadow / body passes. */
  layer?: DrawLayer
  /** Added to every layer's shift, in tiles (elevated rail signals sit at rail height). */
  offset?: [number, number]
  /**
   * Rolling stock: the part sits this many tiles along the entity's
   * orientation (front positive), like the wheel bogies at ±joint_distance/2.
   */
  along?: number
  /** Rail signals: only drawn for a signal on this rail layer (blueprint `rail_layer`). */
  railLayer?: RailLayer
}

export type RailLayer = 'ground' | 'elevated'

/**
 * Draw passes beyond the default three (ground patches, shadows, bodies sorted
 * by y), named after the game's render layers. Bottom to top:
 * rail-stone-path-lower, rail-stone-path, rail-tie, rail-chain-signal-metal,
 * rail-screw, rail-metal, (ground), (shadows), (bodies), higher-object,
 * elevated-rail-stone-path-lower … elevated-rail-above-metal, elevated-object.
 * `ground` and `object` name the default passes.
 */
export const DRAW_LAYERS = [
  'rail-stone-path-lower',
  'rail-stone-path',
  'rail-tie',
  'rail-chain-signal-metal',
  'rail-screw',
  'rail-metal',
  'ground',
  'object',
  'higher-object',
  'elevated-rail-stone-path-lower',
  'elevated-rail-stone-path',
  'elevated-rail-tie',
  'elevated-rail-screw',
  'elevated-rail-metal',
  'elevated-rail-above-metal',
  'elevated-object'
] as const
export type DrawLayer = (typeof DRAW_LAYERS)[number]

/**
 * Named pictures of a neighbour-dependent entity, chosen per entity from its
 * neighbours (see shapes.ts): pipe and heat-pipe pieces, wall pieces,
 * underground belt structures, and `belt` (the TransportBeltAnimationSet sheet).
 */
export type ShapePictures = Record<string, SpriteNode>

/** What the renderer draws: a sub-rectangle of one image, placed relative to the entity centre. */
export interface SpriteLayer {
  /** `factorio-asset://data/…` URL of the image. */
  url: string
  /** Source rectangle in image pixels. */
  rect: { x: number; y: number; w: number; h: number }
  /** Offset of the rectangle's centre from the entity centre, in tiles. */
  shift: [number, number]
  /** Image pixels per tile = 32 / scale. */
  scale: number
  tint?: [number, number, number, number]
  additive?: boolean
  shadow: boolean
  ground: boolean
  /** Draw pass other than ground / shadow / body (shadows still go to the shadow pass). */
  layer?: DrawLayer
}
