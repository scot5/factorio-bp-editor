import { normalizeSprite } from './normalize'
import {
  DIRECTION_KEYS,
  type DirectionKey,
  type GraphicsPart,
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
 * picked per entity in shapes.ts. Types in neither table (rails, rolling
 * stock, …) keep the footprint + icon fallback. See
 * docs/spec/03-game-assets.md § Sprite definitions for the coverage table.
 */

type Raw = Record<string, unknown>

interface PartSpec {
  value: unknown
  fixedRotation?: true
  ground?: true
  exact?: true
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
    ;(order < 0 ? before : after).push({ value })
  }
  return { before, after }
}

/** CraftingMachineGraphicsSet / MiningDrillGraphicsSet. */
const craftingMachine: Extractor = (p) => {
  const gs = p['graphics_set']
  const { before, after } = alwaysDrawn(gs)
  const animation = at(gs, 'animation')
  const idle = at(gs, 'idle_animation')
  const main: PartSpec[] = []
  if (idle && (at(gs, 'always_draw_idle_animation') === true || !animation))
    main.push({ value: idle })
  if (animation) main.push({ value: animation })
  return [...before, ...main, ...after]
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
  inserter: (p) => parts(p, 'platform_picture'),
  'electric-pole': (p) => [{ value: p['pictures'], fixedRotation: true }],
  lab: (p) => parts(p, 'off_animation'),
  beacon: (p) => {
    const list = at(p, 'graphics_set.animation_list')
    if (!Array.isArray(list)) return parts(p, 'animation', 'base_picture')
    return list.flatMap((entry): PartSpec[] =>
      isRecord(entry) && entry['always_draw'] === true ? [{ value: entry['animation'] }] : []
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
  'simple-entity-with-owner': (p) => [{ value: p['picture'] ?? p['pictures'] ?? p['animations'] }]
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

const SHAPE_EXTRACTORS: Record<string, ShapeExtractor> = {
  'transport-belt': belt,
  'underground-belt': (p) => ({
    ...belt(p),
    ...pick(p['structure'], [
      'direction_in',
      'direction_out',
      'direction_in_side_loading',
      'direction_out_side_loading'
    ])
  }),
  splitter: belt,
  'lane-splitter': belt,
  pipe: (p) => pick(p['pictures'], PIPE_KEYS),
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
  if (!extract) return undefined
  const result: GraphicsPart[] = []
  for (const spec of extract(proto)) {
    const node: SpriteNode | null = normalizeSprite(spec.value)
    if (!node) continue
    result.push({
      node,
      ...(spec.fixedRotation ? { fixedRotation: true as const } : {}),
      ...(spec.ground ? { ground: true as const } : {}),
      ...(spec.exact ? { exact: true as const } : {})
    })
  }
  return result.length ? result : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
