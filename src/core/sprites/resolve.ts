import { dataUrl } from '../assets/asset-url'
import { armPose } from './inserter'
import {
  DIRECTION_KEYS,
  type RailLayer,
  type DirectionKey,
  type GraphicsPart,
  type SpriteLayer,
  type SpriteLeaf,
  type SpriteNode
} from './types'

/**
 * SpriteResolver: (entity graphics, direction, frame) → layers to draw.
 * Pure; see docs/spec/03-game-assets.md § Sprite definitions.
 *
 * Frame selection inside a sheet:
 *   index = direction_index × frame_count + frame
 *   col   = index mod line_length,  row = ⌊index / line_length⌋
 * `line_length` 0/absent means one row per direction (frame_count wide), or
 * all directions/variations in one row when there is a single frame.
 * `filenames` continue the index across files (`lines_per_file` rows each);
 * `stripes` continue it across stripes (width × height frames each).
 */
export interface GraphicsOptions {
  /** Animation frame, default 0. */
  frame?: number
  /**
   * Rolling stock: the real `orientation` (0–1, clockwise from north). Rotated
   * sheets take their frame from it instead of the 16-way direction, and parts
   * with `along` are placed along it.
   */
  orientation?: number
  /** Rail signals: which rail layer the signal is on (default ground). */
  railLayer?: RailLayer
  /** Colour for `apply_runtime_tint` masks (train stop, locomotive `color`); default PLAYER_COLOR. */
  runtimeTint?: [number, number, number, number]
}

export function resolveGraphics(
  parts: readonly GraphicsPart[],
  direction: number,
  options: GraphicsOptions = {}
): SpriteLayer[] {
  const out: SpriteLayer[] = []
  const railLayer = options.railLayer ?? 'ground'
  for (const part of parts) {
    if (part.railLayer && part.railLayer !== railLayer) continue
    const start = out.length
    walk(part.node, {
      direction,
      frame: options.frame ?? 0,
      fixedRotation: part.fixedRotation === true,
      ground: part.ground === true,
      exact: part.exact === true,
      out,
      ...(options.orientation !== undefined ? { orientation: options.orientation } : {}),
      ...(options.runtimeTint ? { runtimeTint: options.runtimeTint } : {})
    })
    let offset = part.offset
    if (part.along !== undefined) {
      const o = (options.orientation ?? direction / 16) * 2 * Math.PI
      const [ox, oy] = offset ?? [0, 0]
      offset = [ox + Math.sin(o) * part.along, oy - Math.cos(o) * part.along]
    }
    const arm = part.arm ? armPose(part.arm.piece, direction, part.arm.reach) : undefined
    if (arm) offset = [(offset?.[0] ?? 0) + arm.offset[0], (offset?.[1] ?? 0) + arm.offset[1]]
    for (let i = start; i < out.length; i++) {
      const layer = out[i]!
      if (offset) layer.shift = [layer.shift[0] + offset[0], layer.shift[1] + offset[1]]
      if (part.layer && part.layer !== 'object' && !layer.layer) layer.layer = part.layer
      if (arm) {
        layer.anchor = [0.5, 1]
        layer.squash = arm.squash
        if (arm.rotation) layer.rotation = (arm.rotation * Math.PI) / 180
      }
    }
  }
  return out
}

export interface ResolveOptions {
  /**
   * Take this index of a rotated sheet instead of the one for `direction`
   * (TransportBeltAnimationSet rows: the index is the belt shape, 0-based).
   */
  index?: number
  ground?: boolean
  /** Added to every layer's shift, in tiles (the two belt halves under a splitter). */
  offset?: [number, number]
}

/** Resolves one sprite node, for the neighbour-dependent shapes (see shapes.ts). */
export function resolveSprite(
  node: SpriteNode,
  direction: number,
  options: ResolveOptions = {}
): SpriteLayer[] {
  const out: SpriteLayer[] = []
  walk(node, {
    direction,
    frame: 0,
    fixedRotation: false,
    ground: options.ground === true,
    exact: false,
    out,
    ...(options.index !== undefined ? { index: options.index } : {})
  })
  const offset = options.offset
  if (!offset) return out
  return out.map((layer) => ({
    ...layer,
    shift: [layer.shift[0] + offset[0], layer.shift[1] + offset[1]]
  }))
}

interface Context {
  direction: number
  frame: number
  fixedRotation: boolean
  ground: boolean
  exact: boolean
  /** Forced rotated-sheet index (ResolveOptions.index). */
  index?: number
  orientation?: number
  runtimeTint?: [number, number, number, number]
  out: SpriteLayer[]
  /** Inside a SpriteNWaySheet: which of its frames to take. */
  sheet?: { index: number; frames: number }
}

function walk(node: SpriteNode, ctx: Context): void {
  switch (node.kind) {
    case 'layers':
      for (const layer of node.layers) walk(layer, ctx)
      return
    case 'directions': {
      const picked = ctx.exact
        ? node.directions[DIRECTION_KEYS[Math.round(ctx.direction / 2) % 8]!]
        : pickDirection(node.directions, ctx.direction)
      if (picked) walk(picked, ctx)
      return
    }
    case 'sheet': {
      const index =
        node.frames >= 8
          ? (Math.round(ctx.direction / 2) % 8) % node.frames
          : (Math.round(ctx.direction / 4) % 4) % node.frames
      walk(node.sprite, { ...ctx, sheet: { index, frames: node.frames } })
      return
    }
    case 'sprite': {
      const layer = resolveLeaf(node, ctx)
      if (layer) ctx.out.push(layer)
      return
    }
  }
}

/** Exact 8-way key, then the cardinal, then the opposite (N for S, E for W), then north. */
export function pickDirection<T>(
  directions: Partial<Record<DirectionKey, T>>,
  direction: number
): T | undefined {
  const d8 = Math.round(direction / 2) % 8
  const d4 = Math.round(direction / 4) % 4
  const candidates = [d8, d4 * 2, ((d4 + 2) % 4) * 2, 0]
  for (const c of candidates) {
    const value = directions[DIRECTION_KEYS[c]!]
    if (value !== undefined) return value
  }
  return Object.values(directions)[0] as T | undefined
}

function resolveLeaf(leaf: SpriteLeaf, ctx: Context): SpriteLayer | null {
  const frameCount = leaf.frameCount ?? 1
  const frameIndex = Math.floor(ctx.frame / (leaf.repeatCount ?? 1)) % frameCount

  let index: number
  let defaultLineLength: number
  if (ctx.sheet) {
    index = ctx.sheet.index
    defaultLineLength = ctx.sheet.frames
  } else if (leaf.directionCount) {
    const dc = leaf.directionCount
    const dirIndex =
      ctx.index ??
      byDirection(leaf, ctx.direction) ??
      (ctx.fixedRotation ? 0 : rotatedIndex(leaf, dc, ctx))
    index = dirIndex * frameCount + frameIndex
    defaultLineLength = frameCount > 1 ? frameCount : dc
  } else {
    index = byDirection(leaf, ctx.direction) ?? frameIndex
    defaultLineLength = frameCount > 1 ? frameCount : (leaf.variationCount ?? 1)
  }
  const lineLength = leaf.lineLength ?? defaultLineLength

  let file = leaf.file
  let x0 = leaf.x ?? 0
  let y0 = leaf.y ?? 0
  let col: number
  let row: number
  if (leaf.stripes) {
    let local = index
    let stripe = leaf.stripes[leaf.stripes.length - 1]!
    for (const s of leaf.stripes) {
      const capacity = s.widthInFrames * s.heightInFrames
      if (local < capacity) {
        stripe = s
        break
      }
      local -= capacity
    }
    file = stripe.file
    x0 = stripe.x ?? 0
    y0 = stripe.y ?? 0
    col = local % stripe.widthInFrames
    row = Math.floor(local / stripe.widthInFrames)
  } else if (leaf.files) {
    const perFile = (leaf.linesPerFile ?? 1) * lineLength
    const fileIndex = Math.min(Math.floor(index / perFile), leaf.files.length - 1)
    const local = index - fileIndex * perFile
    file = leaf.files[fileIndex]!
    col = local % lineLength
    row = Math.floor(local / lineLength)
  } else {
    col = index % lineLength
    row = Math.floor(index / lineLength)
  }

  const url = dataUrl(file)
  if (!url) return null
  return {
    url,
    rect: { x: x0 + col * leaf.width, y: y0 + row * leaf.height, w: leaf.width, h: leaf.height },
    shift: leaf.shift ?? [0, 0],
    scale: leaf.scale ?? 1,
    ...(leaf.tint
      ? { tint: leaf.tint }
      : leaf.runtimeTint
        ? { tint: ctx.runtimeTint ?? PLAYER_COLOR }
        : {}),
    ...(leaf.additive ? { additive: true } : {}),
    shadow: leaf.shadow === true,
    ground: ctx.ground,
    ...(leaf.layer ? { layer: leaf.layer } : {})
  }
}

function byDirection(leaf: SpriteLeaf, direction: number): number | undefined {
  return leaf.indexByDirection?.[Math.round(direction) % 16]
}

/**
 * Index of a rotated sheet's frame for the entity's facing. With a real
 * orientation (rolling stock) the game's `apply_projection` applies: the
 * frames are evenly spaced in the 3D model, which the 45° view squashes
 * vertically, so a screen angle o comes from the model angle
 * atan2(sin o, cos o × √2). `back_equals_front` sheets cover half a turn.
 */
function rotatedIndex(leaf: SpriteLeaf, dc: number, ctx: Context): number {
  const turns = leaf.backEqualsFront ? 2 : 1
  let o: number
  if (ctx.orientation === undefined) o = ctx.direction / 16
  else {
    const a = ctx.orientation * 2 * Math.PI
    o = Math.atan2(Math.sin(a), Math.cos(a) * Math.SQRT2) / (2 * Math.PI)
  }
  const i = Math.round((((o % 1) + 1) % 1) * dc * turns) % dc
  return i
}

/**
 * Colour for `apply_runtime_tint` masks: the game's default player colour
 * (orange), since a blueprint has no owner.
 */
export const PLAYER_COLOR: [number, number, number, number] = [0.869, 0.5, 0.13, 1]
