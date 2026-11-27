import { dataUrl } from '../assets/asset-url'
import {
  DIRECTION_KEYS,
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
export function resolveGraphics(
  parts: readonly GraphicsPart[],
  direction: number,
  frame = 0
): SpriteLayer[] {
  const out: SpriteLayer[] = []
  for (const part of parts) {
    walk(part.node, {
      direction,
      frame,
      fixedRotation: part.fixedRotation === true,
      ground: part.ground === true,
      out
    })
  }
  return out
}

interface Context {
  direction: number
  frame: number
  fixedRotation: boolean
  ground: boolean
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
      const picked = pickDirection(node.directions, ctx.direction)
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
    const dirIndex = ctx.fixedRotation ? 0 : Math.round((ctx.direction / 16) * dc) % dc
    index = dirIndex * frameCount + frameIndex
    defaultLineLength = frameCount > 1 ? frameCount : dc
  } else {
    index = frameIndex
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
    ...(leaf.tint ? { tint: leaf.tint } : leaf.runtimeTint ? { tint: PLAYER_COLOR } : {}),
    ...(leaf.additive ? { additive: true } : {}),
    shadow: leaf.shadow === true,
    ground: ctx.ground
  }
}

/**
 * Colour for `apply_runtime_tint` masks: the game's default player colour
 * (orange), since a blueprint has no owner.
 */
export const PLAYER_COLOR: [number, number, number, number] = [0.869, 0.5, 0.13, 1]
