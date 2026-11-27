import { describe, expect, it } from 'vitest'
import {
  Direction,
  directionFrom8Way,
  directionFromOrientation,
  directionOf,
  directionVector,
  isCardinal,
  mirrorDirection,
  rotateDirection
} from './direction'
import { footprint, isOnGrid, orientedSize, snapCenter, tilesInBox } from './footprint'
import { boxesOverlap, mirrorPosition, rotatePosition, unionBoxes } from './position'

describe('direction', () => {
  it('defaults to north when absent', () => {
    expect(directionOf({})).toBe(Direction.North)
    expect(directionOf({ direction: 12 })).toBe(Direction.West)
  })

  it('rotates clockwise and counter-clockwise, wrapping around', () => {
    expect(rotateDirection(Direction.North, 1)).toBe(Direction.East)
    expect(rotateDirection(Direction.West, 1)).toBe(Direction.North)
    expect(rotateDirection(Direction.North, -1)).toBe(Direction.West)
    expect(rotateDirection(Direction.NorthEast, 2)).toBe(Direction.SouthWest)
    expect(rotateDirection(Direction.NorthNorthEast, 4)).toBe(Direction.NorthNorthEast)
  })

  it('mirrors horizontally (east ↔ west) and vertically (north ↔ south)', () => {
    expect(mirrorDirection(Direction.East, 'horizontal')).toBe(Direction.West)
    expect(mirrorDirection(Direction.North, 'horizontal')).toBe(Direction.North)
    expect(mirrorDirection(Direction.NorthEast, 'horizontal')).toBe(Direction.NorthWest)
    expect(mirrorDirection(Direction.North, 'vertical')).toBe(Direction.South)
    expect(mirrorDirection(Direction.East, 'vertical')).toBe(Direction.East)
    expect(mirrorDirection(Direction.NorthEast, 'vertical')).toBe(Direction.SouthEast)
    // Mirroring twice is the identity for every direction.
    for (let d = 0; d < 16; d++) {
      const dir = d as Direction
      expect(mirrorDirection(mirrorDirection(dir, 'horizontal'), 'horizontal')).toBe(dir)
      expect(mirrorDirection(mirrorDirection(dir, 'vertical'), 'vertical')).toBe(dir)
    }
  })

  it('gives unit vectors in screen coordinates (y down)', () => {
    expect(directionVector(Direction.North)).toEqual({ x: 0, y: -1 })
    expect(directionVector(Direction.East)).toEqual({ x: 1, y: 0 })
    expect(directionVector(Direction.South)).toEqual({ x: 0, y: 1 })
    expect(directionVector(Direction.West)).toEqual({ x: -1, y: 0 })
    const ne = directionVector(Direction.NorthEast)
    expect(ne.x).toBeCloseTo(Math.SQRT1_2)
    expect(ne.y).toBeCloseTo(-Math.SQRT1_2)
  })

  it('converts 1.1 8-way directions and rolling-stock orientation', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(directionFrom8Way)).toEqual([0, 2, 4, 6, 8, 10, 12, 14])
    expect(directionFromOrientation(0)).toBe(Direction.North)
    expect(directionFromOrientation(0.25)).toBe(Direction.East) // train_with_schedule.txt
    expect(directionFromOrientation(0.99)).toBe(Direction.North)
  })

  it('knows cardinal directions', () => {
    expect([0, 4, 8, 12].every((d) => isCardinal(d as Direction))).toBe(true)
    expect(isCardinal(Direction.NorthEast)).toBe(false)
  })
})

describe('position', () => {
  const c = { x: 0, y: 0 }

  it('rotates around a centre clockwise on screen', () => {
    expect(rotatePosition({ x: 1, y: 0 }, c, 1)).toEqual({ x: 0, y: 1 }) // east → south
    expect(rotatePosition({ x: 0, y: -1 }, c, 1)).toEqual({ x: 1, y: 0 }) // north → east
    expect(rotatePosition({ x: 1, y: 0 }, c, -1)).toEqual({ x: 0, y: -1 })
    expect(rotatePosition({ x: 3.5, y: 1.5 }, { x: 1, y: 1 }, 2)).toEqual({ x: -1.5, y: 0.5 })
    expect(rotatePosition({ x: 2, y: 5 }, { x: 1, y: 1 }, 4)).toEqual({ x: 2, y: 5 })
  })

  it('mirrors around a centre line', () => {
    expect(mirrorPosition({ x: 3, y: 2 }, { x: 1, y: 0 }, 'horizontal')).toEqual({ x: -1, y: 2 })
    expect(mirrorPosition({ x: 3, y: 2 }, { x: 1, y: 0 }, 'vertical')).toEqual({ x: 3, y: -2 })
  })

  it('unions and overlaps boxes', () => {
    expect(unionBoxes([])).toBeNull()
    expect(
      unionBoxes([
        { left: 0, top: 0, right: 2, bottom: 2 },
        { left: -1, top: 1, right: 1, bottom: 5 }
      ])
    ).toEqual({ left: -1, top: 0, right: 2, bottom: 5 })
    const a = { left: 0, top: 0, right: 2, bottom: 2 }
    expect(boxesOverlap(a, { left: 1, top: 1, right: 3, bottom: 3 })).toBe(true)
    expect(boxesOverlap(a, { left: 2, top: 0, right: 4, bottom: 2 })).toBe(false) // touching edges
  })
})

describe('footprint', () => {
  it('swaps width and height for non-square entities facing east or west', () => {
    const splitter = { width: 2, height: 1 }
    expect(orientedSize(splitter, Direction.North)).toEqual(splitter)
    expect(orientedSize(splitter, Direction.South)).toEqual(splitter)
    expect(orientedSize(splitter, Direction.East)).toEqual({ width: 1, height: 2 })
    expect(orientedSize(splitter, Direction.West)).toEqual({ width: 1, height: 2 })
  })

  it('computes the footprint around the centre', () => {
    expect(footprint({ x: 0.5, y: 0.5 }, { width: 3, height: 3 })).toEqual({
      left: -1,
      top: -1,
      right: 2,
      bottom: 2
    })
    expect(footprint({ x: 2, y: 2 }, { width: 4, height: 4 })).toEqual({
      left: 0,
      top: 0,
      right: 4,
      bottom: 4
    })
  })

  it('snaps odd sizes to x.5 and even sizes to whole numbers', () => {
    expect(snapCenter({ x: 3.2, y: -0.7 }, { width: 3, height: 3 })).toEqual({ x: 3.5, y: -0.5 })
    expect(snapCenter({ x: 3.2, y: -0.7 }, { width: 2, height: 2 })).toEqual({ x: 3, y: -1 })
    expect(snapCenter({ x: 3.2, y: 3.2 }, { width: 2, height: 1 })).toEqual({ x: 3, y: 3.5 })
    expect(isOnGrid({ x: 0.5, y: 0.5 }, { width: 1, height: 1 })).toBe(true)
    expect(isOnGrid({ x: 0, y: 0.5 }, { width: 1, height: 1 })).toBe(false)
  })

  it('lists covered tiles', () => {
    const tiles = [...tilesInBox(footprint({ x: 1, y: 1 }, { width: 2, height: 2 }))]
    expect(tiles).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 }
    ])
  })
})
