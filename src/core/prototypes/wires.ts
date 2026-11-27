import { ELEVATED_HEIGHT, modeByDirection } from '../sprites/graphics'
import { normalizeSprite } from '../sprites/normalize'
import type { SpriteNode } from '../sprites/types'

/**
 * Wire connection points of a prototype, read from the dump: where red, green
 * and copper wires attach, as offsets in tiles from the entity centre.
 * See docs/spec/03-game-assets.md § Wire connection points.
 *
 * Only the `wire` positions are kept; the `shadow` positions are not drawn.
 */

export type WireVec = [number, number]

export interface WirePoint {
  red?: WireVec
  green?: WireVec
  copper?: WireVec
  /**
   * The circuit connector the game draws on an entity with circuit wires
   * (`CircuitConnectorSprites`: connector_main, wire_pins and their shadows;
   * LEDs are left out).
   */
  sprite?: SpriteNode
}

/**
 * How a list of points is indexed, when not by its length (see `wirePointIndex`):
 * - `pole`: by the pole's picture variation, from the angles of its wires;
 * - `belt`: 7 belt shapes in the order X, H, V, SE, SW, NE, NW;
 * - `pipe`: 16 pipe shapes, index = bitmask of connected sides (up 1, right 2, down 4, left 8);
 * - `loader`: 4 directions of an output loader, then 4 of an input loader.
 */
export type WireIndexing = 'pole' | 'belt' | 'pipe' | 'loader'

export interface EntityWirePoints {
  /** Connectors 1/2 (circuit red/green; combinator input) and 5 (pole copper; power switch left). */
  points: WirePoint[]
  /** Connectors 3/4 (combinator output) and 6 (power switch right copper). */
  output?: WirePoint[]
  /** Points of a mirrored entity (`circuit_connector_flipped`). */
  flipped?: WirePoint[]
  /**
   * Rail signals on elevated rails (`elevated_picture_set`), raised by
   * ELEVATED_HEIGHT like the structure. Signal lists are stored by 16-way
   * direction (see `signalConnectors`).
   */
  elevated?: WirePoint[]
  indexing?: WireIndexing
}

type Raw = Record<string, unknown>

const COMBINATOR_TYPES: ReadonlySet<string> = new Set([
  'arithmetic-combinator',
  'decider-combinator',
  'selector-combinator'
])

const INDEXING: Readonly<Record<string, WireIndexing>> = {
  'electric-pole': 'pole',
  'transport-belt': 'belt',
  pipe: 'pipe',
  'infinity-pipe': 'pipe',
  'heat-pipe': 'pipe',
  loader: 'loader',
  'loader-1x1': 'loader'
}

export function entityWirePoints(type: string, proto: Raw): EntityWirePoints | undefined {
  let points: WirePoint[] = []
  let output: WirePoint[] = []
  let flipped: WirePoint[] = []
  let elevated: WirePoint[] = []

  if (type === 'electric-pole') points = connectionPoints(proto['connection_points'])
  else if (COMBINATOR_TYPES.has(type)) {
    points = connectionPoints(proto['input_connection_points'])
    output = connectionPoints(proto['output_connection_points'])
  } else if (type === 'constant-combinator')
    points = connectionPoints(proto['circuit_wire_connection_points'])
  else if (type === 'power-switch') {
    const circuit = connectionPoint(proto['circuit_wire_connection_point'])
    const left = connectionPoint(proto['left_wire_connection_point'])
    const right = connectionPoint(proto['right_wire_connection_point'])
    const both = { ...circuit, ...(left?.copper ? { copper: left.copper } : {}) }
    if (Object.keys(both).length) points = [both]
    if (right?.copper) output = [{ copper: right.copper }]
  } else if (type === 'rail-signal' || type === 'rail-chain-signal') {
    const ground = proto['ground_picture_set']
    const high = proto['elevated_picture_set']
    if (isRecord(ground)) points = signalConnectors(ground)
    if (isRecord(high)) elevated = signalConnectors(high).map((p) => raise(p, ELEVATED_HEIGHT))
  } else {
    points = circuitConnectors(proto['circuit_connector'])
    flipped = circuitConnectors(proto['circuit_connector_flipped'])
  }

  if (!points.length) return undefined
  const indexing = INDEXING[type]
  return {
    points,
    ...(output.length ? { output } : {}),
    ...(flipped.length ? { flipped } : {}),
    ...(elevated.length ? { elevated } : {}),
    ...(indexing ? { indexing } : {})
  }
}

/** `CircuitConnectorDefinition` or an array of them → their wire points and connector sprites. */
function circuitConnectors(value: unknown): WirePoint[] {
  const list = Array.isArray(value) ? value : value === undefined ? [] : [value]
  return list.map((c) => {
    if (!isRecord(c)) return {}
    const point = connectionPoint(c['points']) ?? {}
    const sprite = connectorSprite(c['sprites'])
    return sprite ? { ...point, sprite } : point
  })
}

const CONNECTOR_SPRITES = ['connector_shadow', 'wire_pins_shadow', 'connector_main', 'wire_pins']

/** The static parts of `CircuitConnectorSprites`, as one layered node. */
function connectorSprite(value: unknown): SpriteNode | undefined {
  if (!isRecord(value)) return undefined
  const layers = CONNECTOR_SPRITES.map((k) => value[k]).filter(isRecord)
  if (!layers.length) return undefined
  const layer = value['render_layer']
  return (
    normalizeSprite({ layers, ...(typeof layer === 'string' ? { render_layer: layer } : {}) }) ??
    undefined
  )
}

/**
 * A RailSignalPictureSet's connectors, one per structure frame, reordered to
 * one per 16-way direction through `structure_align_to_animation_index` (the
 * most common entry per direction, as the structure sprite does). The ground
 * set's table is the identity; the elevated set has 25 frames.
 */
function signalConnectors(set: Raw): WirePoint[] {
  const list = circuitConnectors(set['circuit_connector'])
  const byDirection = modeByDirection(set['structure_align_to_animation_index'])
  return byDirection ? byDirection.map((i) => list[i] ?? {}) : list
}

function raise(p: WirePoint, height: number): WirePoint {
  const out: WirePoint = p.sprite ? { sprite: p.sprite } : {}
  for (const color of ['red', 'green', 'copper'] as const) {
    const v = p[color]
    if (v) out[color] = [v[0], v[1] - height]
  }
  return out
}

/** An array of `WireConnectionPoint`. */
function connectionPoints(value: unknown): WirePoint[] {
  return Array.isArray(value) ? value.map((p) => connectionPoint(p) ?? {}) : []
}

/** `WireConnectionPoint` → its `wire` positions. */
function connectionPoint(value: unknown): WirePoint | undefined {
  if (!isRecord(value) || !isRecord(value['wire'])) return undefined
  const wire = value['wire']
  const out: WirePoint = {}
  for (const color of ['red', 'green', 'copper'] as const) {
    const v = vector(wire[color])
    if (v) out[color] = v
  }
  return out
}

function vector(value: unknown): WireVec | undefined {
  if (Array.isArray(value) && typeof value[0] === 'number' && typeof value[1] === 'number')
    return [value[0], value[1]]
  if (isRecord(value) && typeof value['x'] === 'number' && typeof value['y'] === 'number')
    return [value['x'], value['y']]
  return undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
