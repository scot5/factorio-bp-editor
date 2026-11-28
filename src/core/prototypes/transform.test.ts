import { describe, expect, it } from 'vitest'
import {
  canMirror,
  canRotate,
  isRailGrid,
  mirrorOffset,
  normalizeDirection,
  transformTraits
} from './transform'

const SQUARE = { width: 3, height: 3 }

describe('transformTraits', () => {
  it('turns non-square crafting machines', () => {
    expect(transformTraits('assembling-machine', {}, { width: 2, height: 3 })).toEqual({})
  })

  it('fixes crafting machines without fluid boxes or an output vector', () => {
    expect(transformTraits('assembling-machine', {}, SQUARE)).toEqual({ rotatable: false })
    expect(transformTraits('furnace', { fluid_boxes: [] }, SQUARE)).toEqual({ rotatable: false })
    expect(transformTraits('assembling-machine', { fluid_boxes: [{}] }, SQUARE)).toEqual({})
  })

  it('reads use_mirroring, defaulting to the output vector for crafting machines', () => {
    expect(
      transformTraits('assembling-machine', { fluid_boxes: [{}], use_mirroring: true }, SQUARE)
    ).toEqual({ mirroring: true })
    expect(transformTraits('furnace', { vector_to_place_result: [0, -1] }, SQUARE)).toEqual({
      mirroring: true
    })
    expect(transformTraits('inserter', {}, SQUARE)).toEqual({ mirroring: true })
    expect(transformTraits('mining-drill', { use_mirroring: false }, SQUARE)).toEqual({})
    expect(transformTraits('container', { use_mirroring: true }, SQUARE)).toEqual({
      rotatable: false
    })
  })

  it('honours the not-rotatable flag', () => {
    expect(
      transformTraits('simple-entity-with-owner', { flags: ['not-rotatable'] }, SQUARE)
    ).toEqual({
      rotatable: false
    })
  })
})

describe('fallbacks without game data', () => {
  it('decides by type', () => {
    expect(canRotate({ type: 'container', width: 1, height: 1 })).toBe(false)
    expect(canRotate({ type: 'assembling-machine', width: 3, height: 3 })).toBe(true)
    expect(canRotate({ type: 'assembling-machine', width: 3, height: 3, rotatable: false })).toBe(
      false
    )
    expect(canRotate(undefined)).toBe(true)
    expect(canMirror({ type: 'inserter', width: 1, height: 1 })).toBe(true)
    expect(canMirror({ type: 'assembling-machine', width: 3, height: 3 })).toBe(false)
    expect(canMirror(undefined)).toBe(false)
    expect(isRailGrid({ type: 'train-stop', width: 2, height: 2 })).toBe(true)
    expect(isRailGrid({ type: 'rail-signal', width: 1, height: 1 })).toBe(false)
  })
})

describe('directions', () => {
  it('writes half-turn symmetric pieces as 0–7', () => {
    expect(normalizeDirection('straight-rail', 12)).toBe(4)
    expect(normalizeDirection('rail-support', 10)).toBe(2)
    expect(normalizeDirection('curved-rail-a', 12)).toBe(12)
    expect(normalizeDirection('legacy-straight-rail', 8)).toBe(0)
    expect(normalizeDirection('legacy-straight-rail', 10)).toBe(10)
    expect(normalizeDirection(undefined, -4)).toBe(12)
  })

  it('offsets mirrored curves and signals', () => {
    expect(mirrorOffset('curved-rail-b')).toBe(2)
    expect(mirrorOffset('rail-chain-signal')).toBe(8)
    expect(mirrorOffset('inserter')).toBe(0)
    expect(mirrorOffset(undefined)).toBe(0)
  })
})
