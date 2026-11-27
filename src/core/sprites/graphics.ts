import { drawLayerFor } from './layers'
import { normalizeSprite } from './normalize'
import {
  DIRECTION_KEYS,
  type DirectionKey,
  type DrawLayer,
  type GraphicsPart,
  type RailLayer,
  type ShapePictures,
  type SpriteNode
} from './types'

/**
 * Which graphics properties of a prototype make up its static look, per type,
 * in draw order. Only these are copied into the PrototypeDb (whitelist), so
 * sounds, working lights, recipe tints and animations that only play while
 * working stay out of the cache.
 *
 * Neighbour-dependent pieces (belt shapes, pipe and wall pieces, underground
 * structures) are stored separately as named pictures (SHAPE_EXTRACTORS) and
 * picked per entity in shapes.ts. Types in neither table keep the footprint +
 * icon fallback. See
 * docs/spec/03-game-assets.md § Sprite definitions for the coverage table.
 */

type Raw = Record<string, unknown>

interface PartSpec {
  value: unknown
  fixedRotation?: true
  ground?: true
  exact?: true
  layer?: DrawLayer
  offset?: [number, number]
  along?: number
  railLayer?: RailLayer
  /** Set as `indexByDirection` on every sprite leaf of the part. */
  indexByDirection?: number[]
  arm?: GraphicsPart['arm']
}

type Extractor = (p: Raw) => PartSpec[]

const at = (value: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((o, key) => (isRecord(o) ? o[key] : undefined), value)

const parts = (p: Raw, ...paths: string[]): PartSpec[] =>
  paths.map((path) => ({ value: at(p, path) }))

/** `{ north: { structure }, east: { structure } }` → `{ north: structure, east: structure }`. */
function perDirection(value: unknown, key: string): unknown {
  if (!isRecord(value)) return undefined
  const out: Partial<Record<DirectionKey, unknown>> = {}
  for (const dir of DIRECTION_KEYS) if (isRecord(value[dir])) out[dir] = value[dir][key]
  return Object.keys(out).length ? out : undefined
}

/** Working visualisations that are always drawn, even when the machine is idle. */
function alwaysDrawn(graphicsSet: unknown): { before: PartSpec[]; after: PartSpec[] } {
  const list = at(graphicsSet, 'working_visualisations')
  const before: PartSpec[] = []
  const after: PartSpec[] = []
  if (!Array.isArray(list)) return { before, after }
  for (const wv of list) {
    if (!isRecord(wv) || wv['always_draw'] !== true) continue
    if (wv['apply_recipe_tint'] !== undefined) continue // fluid colours depend on the recipe
    const value =
      wv['animation'] ??
      Object.fromEntries(DIRECTION_KEYS.map((dir) => [dir, wv[`${dir}_animation`]]))
    const order = typeof wv['secondary_draw_order'] === 'number' ? wv['secondary_draw_order'] : 0
    ;(order < 0 ? before : after).push({ value, ...layerOf(wv) })
  }
  return { before, after }
}

/** `{ layer }` for an object's `render_layer`, when it names a pass other than `object`. */
function layerOf(value: Record<string, unknown>): Pick<PartSpec, 'layer'> {
  const name = value['render_layer']
  if (typeof name !== 'string') return {}
  const layer = drawLayerFor(name)
  return layer === 'object' ? {} : { layer }
}

/** CraftingMachineGraphicsSet / MiningDrillGraphicsSet. */
const craftingMachine: Extractor = (p) => craftingMachineSet(p['graphics_set'])

function craftingMachineSet(gs: unknown): PartSpec[] {
  const { before, after } = alwaysDrawn(gs)
  const animation = at(gs, 'animation')
  const idle = at(gs, 'idle_animation')
  const main: PartSpec[] = []
  if (idle && (at(gs, 'always_draw_idle_animation') === true || !animation))
    main.push({ value: idle })
  if (animation) main.push({ value: animation })
  return [...before, ...main, ...after]
}

/** Graphics drawn instead of the usual ones for a mirrored entity (`graphics_set_flipped`). */
const FLIPPED_EXTRACTORS: Record<string, Extractor> = {
  'assembling-machine': (p) => craftingMachineSet(p['graphics_set_flipped']),
  furnace: (p) => craftingMachineSet(p['graphics_set_flipped']),
  'mining-drill': (p) => craftingMachineSet(p['graphics_set_flipped'])
}

/** Each entry of a list of LayeredSpriteWithRenderLayer as its own part (cargo bays and hubs). */
function eachEntry(value: unknown): PartSpec[] {
  return Array.isArray(value) ? value.map((entry) => ({ value: entry })) : [{ value }]
}

/**
 * Cargo bays, the space platform hub and the cargo landing pad: the picture
 * pieces in their own render layers, then the animation's first frame.
 * Connections to neighbouring bays (`connections`) and the hatches are not drawn.
 */
const cargoHub: Extractor = (p) => [
  ...eachEntry(at(p, 'graphics_set.picture')),
  { value: at(p, 'graphics_set.animation') }
]

/** `{ north_graphics_set: { animation }, … }` → per-direction animations (fusion generator). */
function perDirectionSet(gs: unknown, key: string): unknown {
  if (!isRecord(gs)) return undefined
  const out: Partial<Record<DirectionKey, unknown>> = {}
  for (const dir of DIRECTION_KEYS) out[dir] = at(gs, `${dir}_graphics_set.${key}`)
  return out
}

const turret: Extractor = (p) => {
  const base = at(p, 'graphics_set.base_visualisation')
  const bases = Array.isArray(base) ? base : [base]
  return [
    ...bases.map((b) => ({ value: at(b, 'animation') })),
    { value: p['base_picture'] },
    { value: p['folded_animation'] }
  ]
}

const combinator: Extractor = (p) => parts(p, 'sprites')

/** Elevated rails and signals are drawn this many tiles above the ground. */
const ELEVATED_HEIGHT = 3

/**
 * RailPieceLayers properties in draw order, with their RailRenderLayers key.
 * `segment_visualisation_middle`, water reflections, underwater structures
 * and shadow masks are left out.
 */
const RAIL_PIECES = [
  ['stone_path_background', 'stone_path_lower'],
  ['stone_path', 'stone_path'],
  ['ties', 'tie'],
  ['backplates', 'screw'],
  ['metals', 'metal']
] as const

/**
 * RailPictureSet: one picture set per direction key, and the 16-way rail
 * direction picks the key exactly (direction / 2). Straight and half-diagonal
 * rails only fill north … southeast, which is all they use. Fences of
 * elevated rails and ramps are drawn over the rail.
 */
const rail: Extractor = (p) => {
  const pictures = p['pictures']
  const renderLayers = at(pictures, 'render_layers')
  const out: PartSpec[] = RAIL_PIECES.map(([piece, key]) => ({
    value: railPerDirection(pictures, piece),
    exact: true,
    layer: drawLayerFor(at(renderLayers, key))
  }))
  const fences = p['fence_pictures']
  for (const side of ['side_A', 'side_B'])
    out.push({
      value: at(fences, `${side}.fence`),
      exact: true,
      layer: 'elevated-rail-above-metal'
    })
  return out
}

function railPerDirection(pictures: unknown, piece: string): unknown {
  if (!isRecord(pictures)) return undefined
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(pictures))
    if (isRecord(value) && value[piece] !== undefined) out[key] = value[piece]
  return Object.keys(out).length ? out : undefined
}

/**
 * The most common entry per direction of a rail signal lookup table with the
 * same number of entries per 16-way direction (the other entries are for
 * other rail shapes beside the signal).
 */
export function modeByDirection(table: unknown): number[] | undefined {
  if (!Array.isArray(table) || table.length < 16 || table.length % 16 !== 0) return undefined
  const n = table.length / 16
  const out: number[] = []
  for (let d = 0; d < 16; d++) {
    const counts = new Map<number, number>()
    for (const v of table.slice(d * n, d * n + n))
      if (typeof v === 'number') counts.set(v, (counts.get(v) ?? 0) + 1)
    let best = 0
    let bestCount = 0
    for (const [v, c] of counts)
      if (c > bestCount) {
        best = v
        bestCount = c
      }
    out.push(best)
  }
  return out
}

/**
 * RailSignalPictureSet: the rail pieces, then the structure. The structure's
 * animation frame is the colour (frame 0: green for rail signals, none/red
 * for chain signals); the direction index comes from the alignment tables.
 */
function signalSet(set: unknown, railLayer: RailLayer): PartSpec[] {
  if (!isRecord(set)) return []
  const base: Pick<PartSpec, 'railLayer' | 'offset'> = {
    railLayer,
    ...(railLayer === 'elevated' ? { offset: [0, -ELEVATED_HEIGHT] as [number, number] } : {})
  }
  const piece = (value: unknown): PartSpec[] => {
    if (!isRecord(value)) return []
    const index = modeByDirection(value['align_to_frame_index'])
    return [
      {
        ...base,
        value: value['sprites'],
        layer: drawLayerFor(value['render_layer'] ?? 'rail-chain-signal-metal'),
        ...(index ? { indexByDirection: index } : {})
      }
    ]
  }
  const structureIndex = modeByDirection(set['structure_align_to_animation_index'])
  return [
    ...piece(set['rail_piece']),
    ...piece(set['upper_rail_piece']),
    {
      ...base,
      value: set['structure'],
      layer: drawLayerFor(set['structure_render_layer']),
      ...(structureIndex ? { indexByDirection: structureIndex } : {})
    }
  ]
}

const railSignal: Extractor = (p) => [
  ...signalSet(p['ground_picture_set'], 'ground'),
  ...signalSet(p['elevated_picture_set'], 'elevated')
]

/**
 * Rolling stock: wheel bogies at +-joint_distance / 2 along the orientation,
 * then the body (`pictures.rotated`; `sloped` is for ramps), then the
 * artillery wagon's parked cannon.
 */
const rollingStock: Extractor = (p) => {
  const joint = typeof p['joint_distance'] === 'number' ? p['joint_distance'] / 2 : 0
  const wheels = at(p, 'wheels.rotated')
  return [
    { value: wheels, along: joint },
    { value: wheels, along: -joint },
    { value: at(p, 'pictures.rotated') },
    { value: at(p, 'cannon_base_pictures.rotated') },
    { value: at(p, 'cannon_barrel_pictures.rotated') }
  ]
}

const EXTRACTORS: Record<string, Extractor> = {
  'assembling-machine': craftingMachine,
  furnace: craftingMachine,
  'mining-drill': craftingMachine,
  'rocket-silo': (p) => [
    ...parts(p, 'shadow_sprite', 'hole_sprite', 'door_back_sprite', 'door_front_sprite'),
    ...parts(p, 'base_day_sprite'),
    ...alwaysDrawn(p['graphics_set']).after,
    ...parts(p, 'base_front_sprite')
  ],
  container: (p) => [{ value: p['integration_patch'], ground: true }, ...parts(p, 'picture')],
  'logistic-container': (p) => [
    { value: p['integration_patch'], ground: true },
    { value: p['animation'] ?? at(p, 'robot_door.animation') }
  ],
  inserter: (p) => {
    const reach = distance(p['pickup_position'])
    return [
      ...parts(p, 'platform_picture'),
      // The arm rests with the hand over the pickup position, above belts and machines.
      {
        value: p['hand_base_picture'],
        layer: 'higher-object-under',
        arm: { piece: 'base', reach }
      },
      { value: p['hand_open_picture'], layer: 'higher-object-under', arm: { piece: 'hand', reach } }
    ]
  },
  'electric-pole': (p) => [{ value: p['pictures'], fixedRotation: true }],
  lab: (p) => parts(p, 'off_animation'),
  beacon: (p) => {
    const list = at(p, 'graphics_set.animation_list')
    if (!Array.isArray(list)) return parts(p, 'animation', 'base_picture')
    return list.flatMap((entry): PartSpec[] =>
      isRecord(entry) && entry['always_draw'] === true
        ? [{ value: entry['animation'], ...layerOf(entry) }]
        : []
    )
  },
  boiler: (p) => [{ value: perDirection(p['pictures'], 'structure') }],
  generator: (p) => [
    {
      value: perDirection(p['pictures'], 'animation') ?? {
        north: p['vertical_animation'],
        east: p['horizontal_animation']
      }
    }
  ],
  'burner-generator': (p) => [{ value: p['idle_animation'] ?? p['animation'] }],
  'solar-panel': (p) => parts(p, 'picture'),
  accumulator: (p) => [{ value: at(p, 'chargable_graphics.picture') ?? p['picture'] }],
  radar: (p) => [
    { value: p['integration_patch'], ground: true },
    { value: p['pictures'], fixedRotation: true }
  ],
  roboport: (p) => parts(p, 'base', 'base_patch', 'door_animation_up', 'door_animation_down'),
  lamp: (p) => parts(p, 'picture_off'),
  'arithmetic-combinator': combinator,
  'decider-combinator': combinator,
  'constant-combinator': combinator,
  'selector-combinator': combinator,
  'display-panel': combinator,
  'storage-tank': (p) => parts(p, 'pictures.picture'),
  pump: (p) => parts(p, 'animations'),
  'offshore-pump': (p) => parts(p, 'graphics_set.base_pictures', 'graphics_set.animation'),
  'ammo-turret': turret,
  'electric-turret': turret,
  'fluid-turret': turret,
  'artillery-turret': (p) => [
    { value: p['base_picture'] },
    { value: p['cannon_base_pictures'] },
    { value: p['cannon_barrel_pictures'] }
  ],
  gate: (p) => [{ value: { north: p['vertical_animation'], east: p['horizontal_animation'] } }],
  'pipe-to-ground': (p) => parts(p, 'pictures'),
  splitter: (p) => [{ value: p['structure'] }, { value: p['structure_patch'], exact: true }],
  'lane-splitter': (p) => [{ value: p['structure'] }, { value: p['structure_patch'], exact: true }],
  reactor: (p) => parts(p, 'lower_layer_picture', 'picture'),
  'heat-interface': (p) => parts(p, 'picture'),
  'power-switch': (p) => parts(p, 'power_on_animation'),
  'programmable-speaker': (p) => parts(p, 'sprite'),
  'straight-rail': rail,
  'half-diagonal-rail': rail,
  'curved-rail-a': rail,
  'curved-rail-b': rail,
  'legacy-straight-rail': rail,
  'legacy-curved-rail': rail,
  'elevated-straight-rail': rail,
  'elevated-half-diagonal-rail': rail,
  'elevated-curved-rail-a': rail,
  'elevated-curved-rail-b': rail,
  'rail-ramp': rail,
  'rail-support': (p) => parts(p, 'graphics_set.structure'),
  'rail-signal': railSignal,
  'rail-chain-signal': railSignal,
  'train-stop': (p) => [
    { value: p['rail_overlay_animations'], layer: 'ground' },
    { value: p['animations'] },
    { value: p['top_animations'], layer: 'higher-object' }
  ],
  locomotive: rollingStock,
  'cargo-wagon': rollingStock,
  'fluid-wagon': rollingStock,
  'artillery-wagon': rollingStock,
  'infinity-cargo-wagon': rollingStock,
  'simple-entity-with-owner': simpleEntity,
  'simple-entity-with-force': simpleEntity,
  'infinity-container': (p) => parts(p, 'picture'),
  'linked-container': (p) => parts(p, 'picture'),
  'proxy-container': (p) => parts(p, 'picture'),
  'electric-energy-interface': (p) => [{ value: p['picture'] ?? p['animation'] ?? p['pictures'] }],
  valve: (p) => parts(p, 'animations'),
  'land-mine': (p) => parts(p, 'picture_set'),
  market: (p) => parts(p, 'picture'),
  car: (p) => parts(p, 'animation', 'turret_animation'),
  // Space Age
  'agricultural-tower': craftingMachine, // the crane is not drawn
  'asteroid-collector': (p) =>
    // the arm is not drawn
    parts(
      p,
      'graphics_set.below_ground_pictures',
      'graphics_set.below_arm_pictures',
      'graphics_set.animation'
    ),
  thruster: (p) => [
    { value: at(p, 'graphics_set.integration_patch'), ground: true },
    { value: at(p, 'graphics_set.animation') }
  ],
  'cargo-bay': cargoHub,
  'space-platform-hub': cargoHub,
  'cargo-landing-pad': cargoHub,
  // connections_graphics depend on the neighbouring fusion entities
  'fusion-reactor': (p) => parts(p, 'graphics_set.structure'),
  'fusion-generator': (p) => [{ value: perDirectionSet(p['graphics_set'], 'animation') }],
  'lightning-attractor': (p) => parts(p, 'chargable_graphics.picture')
}

function simpleEntity(p: Raw): PartSpec[] {
  return [{ value: p['picture'] ?? p['pictures'] ?? p['animations'] }]
}

/** Pipe pieces by name (PipePictures); windows, visualisations and frozen variants are left out. */
const PIPE_KEYS = [
  'straight_vertical_single',
  'straight_vertical',
  'straight_horizontal',
  'corner_up_right',
  'corner_up_left',
  'corner_down_right',
  'corner_down_left',
  't_up',
  't_down',
  't_right',
  't_left',
  'cross',
  'ending_up',
  'ending_down',
  'ending_right',
  'ending_left'
]

/** Heat pipe pieces (ConnectableEntityGraphics): the corners are named the other way round. */
const HEAT_PIPE_KEYS = [
  'single',
  'straight_vertical',
  'straight_horizontal',
  'corner_right_up',
  'corner_left_up',
  'corner_right_down',
  'corner_left_down',
  't_up',
  't_down',
  't_right',
  't_left',
  'cross',
  'ending_up',
  'ending_down',
  'ending_right',
  'ending_left'
]

/** WallPictures: a wall only connects right, left and down (the wall above draws the joint). */
const WALL_KEYS = [
  'single',
  'straight_vertical',
  'straight_horizontal',
  'corner_right_down',
  'corner_left_down',
  't_up',
  'ending_right',
  'ending_left'
]

type ShapeExtractor = (p: Raw) => Record<string, unknown>

const pick = (value: unknown, keys: readonly string[]): Record<string, unknown> =>
  Object.fromEntries(keys.map((key) => [key, at(value, key)]))

const belt = (p: Raw): Record<string, unknown> => ({
  belt: at(p, 'belt_animation_set.animation_set')
})

/** Belt ends with an input/output structure: underground belts, loaders, linked belts. */
const beltEnd = (p: Raw): Record<string, unknown> => ({
  ...belt(p),
  ...pick(p['structure'], [
    'direction_in',
    'direction_out',
    'direction_in_side_loading',
    'direction_out_side_loading'
  ])
})

const SHAPE_EXTRACTORS: Record<string, ShapeExtractor> = {
  'transport-belt': belt,
  'underground-belt': beltEnd,
  loader: beltEnd,
  'loader-1x1': beltEnd,
  'linked-belt': beltEnd,
  splitter: belt,
  'lane-splitter': belt,
  pipe: (p) => pick(p['pictures'], PIPE_KEYS),
  'infinity-pipe': (p) => pick(p['pictures'], PIPE_KEYS),
  'heat-pipe': (p) => pick(p['connection_sprites'], HEAT_PIPE_KEYS),
  wall: (p) => pick(p['pictures'], [...WALL_KEYS, 'filling'])
}

/** Types that have graphics in the DB (the rest use the footprint fallback). */
export const SPRITE_TYPES: ReadonlySet<string> = new Set([
  ...Object.keys(EXTRACTORS),
  ...Object.keys(SHAPE_EXTRACTORS)
])

/** The named neighbour-dependent pictures of a raw prototype, or undefined. */
export function entityShapes(type: string, proto: Raw): ShapePictures | undefined {
  const extract = SHAPE_EXTRACTORS[type]
  if (!extract) return undefined
  const result: ShapePictures = {}
  for (const [key, value] of Object.entries(extract(proto))) {
    const node = normalizeSprite(value)
    if (node) result[key] = node
  }
  return Object.keys(result).length ? result : undefined
}

/** The static graphics of a raw prototype, or undefined when its type is not covered. */
export function entityGraphics(type: string, proto: Raw): GraphicsPart[] | undefined {
  const extract = EXTRACTORS[type]
  return extract ? buildParts(extract(proto)) : undefined
}

/**
 * The graphics of a mirrored entity (`mirror: true`), when the prototype has
 * its own (`graphics_set_flipped`: recycler, burner mining drill, pumpjack).
 * Other mirrored entities look the same; only their fluid boxes flip.
 */
export function entityGraphicsFlipped(type: string, proto: Raw): GraphicsPart[] | undefined {
  const extract = FLIPPED_EXTRACTORS[type]
  return extract && proto['graphics_set_flipped'] ? buildParts(extract(proto)) : undefined
}

function buildParts(specs: PartSpec[]): GraphicsPart[] | undefined {
  const result: GraphicsPart[] = []
  for (const spec of specs) {
    let node: SpriteNode | null = normalizeSprite(spec.value)
    if (!node) continue
    if (spec.indexByDirection) node = withIndexByDirection(node, spec.indexByDirection)
    result.push({
      node,
      ...(spec.fixedRotation ? { fixedRotation: true as const } : {}),
      ...(spec.ground ? { ground: true as const } : {}),
      ...(spec.exact ? { exact: true as const } : {}),
      ...(spec.layer && spec.layer !== 'object' ? { layer: spec.layer } : {}),
      ...(spec.offset ? { offset: spec.offset } : {}),
      ...(spec.along ? { along: spec.along } : {}),
      ...(spec.railLayer ? { railLayer: spec.railLayer } : {}),
      ...(spec.arm ? { arm: spec.arm } : {})
    })
  }
  return result.length ? result : undefined
}

function withIndexByDirection(node: SpriteNode, table: number[]): SpriteNode {
  switch (node.kind) {
    case 'sprite':
      return { ...node, indexByDirection: table }
    case 'layers':
      return { ...node, layers: node.layers.map((n) => withIndexByDirection(n, table)) }
    case 'sheet':
      return { ...node, sprite: withIndexByDirection(node.sprite, table) }
    case 'directions':
      return {
        ...node,
        directions: Object.fromEntries(
          Object.entries(node.directions).map(([k, n]) => [k, withIndexByDirection(n, table)])
        )
      }
  }
}

/** Length of a Vector (`[x, y]` or `{ x, y }`), 1 when missing. */
function distance(value: unknown): number {
  const [x, y] = Array.isArray(value) ? value : isRecord(value) ? [value['x'], value['y']] : []
  return typeof x === 'number' && typeof y === 'number' ? Math.hypot(x, y) : 1
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
