import type { Box, Position } from '@core/geometry'

/**
 * Pan/zoom camera. World unit = 1 tile; `scale` = screen pixels per tile.
 * See docs/spec/04-visualization.md § Canvas.
 */
export interface Camera {
  /** World position shown at the top-left corner of the view. */
  x: number
  y: number
  /** Pixels per tile. 64 px/tile is zoom 1 (the game's high-res sprites). */
  scale: number
}

export const PX_PER_TILE = 64
export const MIN_SCALE = PX_PER_TILE / 32
export const MAX_SCALE = PX_PER_TILE * 4

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
}

export function screenToWorld(camera: Camera, sx: number, sy: number): Position {
  return { x: camera.x + sx / camera.scale, y: camera.y + sy / camera.scale }
}

export function worldToScreen(camera: Camera, wx: number, wy: number): Position {
  return { x: (wx - camera.x) * camera.scale, y: (wy - camera.y) * camera.scale }
}

/** Zooms by `factor`, keeping the world point under the screen point (sx, sy) fixed. */
export function zoomAt(camera: Camera, factor: number, sx: number, sy: number): Camera {
  const scale = clampScale(camera.scale * factor)
  const anchor = screenToWorld(camera, sx, sy)
  return { scale, x: anchor.x - sx / scale, y: anchor.y - sy / scale }
}

/** Camera that shows `box` centred in a view of `width`×`height` pixels, with a margin. */
export function fitBox(box: Box | null, width: number, height: number, margin = 48): Camera {
  if (!box || width <= 0 || height <= 0) {
    const scale = PX_PER_TILE / 2
    return { scale, x: -width / 2 / scale, y: -height / 2 / scale }
  }
  const bw = Math.max(1, box.right - box.left)
  const bh = Math.max(1, box.bottom - box.top)
  const scale = clampScale(
    Math.min((width - 2 * margin) / bw, (height - 2 * margin) / bh, PX_PER_TILE)
  )
  const cx = (box.left + box.right) / 2
  const cy = (box.top + box.bottom) / 2
  return { scale, x: cx - width / 2 / scale, y: cy - height / 2 / scale }
}

/** World area visible in the view. */
export function visibleBox(camera: Camera, width: number, height: number): Box {
  return {
    left: camera.x,
    top: camera.y,
    right: camera.x + width / camera.scale,
    bottom: camera.y + height / camera.scale
  }
}
