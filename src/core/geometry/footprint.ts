import { isCardinal, type Direction } from './direction'
import type { Box, Position } from './position'

/**
 * Entity footprints on the tile grid. See docs/spec/02-blueprint-format.md § Positions.
 *
 * Positions are entity centres. An entity with an odd size sits on half-tile
 * centres (x.5); an even size sits on whole numbers. Sizes come from the
 * prototype (collision box rounded up to whole tiles), i.e. from the
 * PrototypeDb or the fallback size table (M2/M3), never from the blueprint.
 *
 * Rails, rolling stock and other non-grid entities have their own rules and
 * are not handled here.
 */

export interface TileSize {
  width: number
  height: number
}

/**
 * The size an entity occupies for a direction. Non-square 4-way entities swap
 * width and height when facing east or west (e.g. a 2×1 splitter facing east is 1×2).
 */
export function orientedSize(size: TileSize, direction: Direction): TileSize {
  if (size.width === size.height || !isCardinal(direction)) return size
  return direction === 4 || direction === 12 ? { width: size.height, height: size.width } : size
}

/** Tile-aligned footprint of an entity centred at `center`. */
export function footprint(center: Position, size: TileSize): Box {
  return {
    left: center.x - size.width / 2,
    top: center.y - size.height / 2,
    right: center.x + size.width / 2,
    bottom: center.y + size.height / 2
  }
}

/** Nearest valid centre for an entity of `size` at `point`: x.5 for odd sizes, whole for even. */
export function snapCenter(point: Position, size: TileSize): Position {
  return { x: snapAxis(point.x, size.width), y: snapAxis(point.y, size.height) }
}

/** Whether `center` is a valid grid position for an entity of `size`. */
export function isOnGrid(center: Position, size: TileSize): boolean {
  const snapped = snapCenter(center, size)
  return snapped.x === center.x && snapped.y === center.y
}

/** Integer tile coordinates covered by a footprint (top-left corner of each tile). */
export function* tilesInBox(box: Box): Generator<Position> {
  for (let y = Math.floor(box.top); y < Math.ceil(box.bottom); y++) {
    for (let x = Math.floor(box.left); x < Math.ceil(box.right); x++) yield { x, y }
  }
}

function snapAxis(value: number, size: number): number {
  return size % 2 === 1 ? Math.floor(value) + 0.5 : Math.round(value)
}
