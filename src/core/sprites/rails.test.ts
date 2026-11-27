import { describe, expect, it } from 'vitest'
import type { EntityLayout } from '../model/layout'
import type { EntityProto } from '../prototypes/db'
import { entityGraphics, modeByDirection } from './graphics'
import { drawLayerFor } from './layers'
import { normalizeSprite } from './normalize'
import { PLAYER_COLOR, resolveGraphics } from './resolve'
import type { SpriteLayer } from './types'
import { graphicsOptionsFor, graphicsOptionsKey } from './variant'

// Rails, rail signals, train stops and rolling stock (M3 step 7c). Excerpts
// are shortened from the Factorio 2.1.25 `data-raw-dump.json`.

const files = (layers: SpriteLayer[]): string[] => layers.map((l) => l.url.split('/').pop()!)
const rects = (layers: SpriteLayer[]): [number, number][] => layers.map((l) => [l.rect.x, l.rect.y])

const railLeaf = (file: string, y: number, size = 256): object => ({
  filename: `__base__/graphics/entity/rails/rail/${file}.png`,
  width: size,
  height: size,
  x: 0,
  y,
  variation_count: 8,
  scale: 0.5,
  shift: [0, 0],
  usage: 'rail'
})

const railPieces = (y: number, size?: number): object => ({
  metals: railLeaf('rail-metals', y, size),
  backplates: railLeaf('rail-backplates', y, size),
  ties: railLeaf('rail-ties', y, size),
  stone_path: railLeaf('rail-stone-path-inside', y, size),
  stone_path_background: railLeaf('rail-stone-path', y, size),
  segment_visualisation_middle: railLeaf('rail-segment-visualisations-middle', y, size)
})

const straightRail = {
  pictures: {
    north: railPieces(256),
    northeast: railPieces(2048, 384),
    east: railPieces(0),
    southeast: railPieces(896, 384),
    south: {},
    southwest: {},
    west: {},
    northwest: {},
    rail_endings: { sheets: [railLeaf('rail-endings-background', 0)] },
    render_layers: {
      stone_path_lower: 'rail-stone-path-lower',
      stone_path: 'rail-stone-path',
      tie: 'rail-tie',
      screw: 'rail-screw',
      metal: 'rail-metal'
    }
  }
}

describe('rails', () => {
  const parts = entityGraphics('straight-rail', straightRail)!

  it('draws stone path, ties, backplates and metals, each in its own rail pass', () => {
    const layers = resolveGraphics(parts, 0)
    expect(files(layers)).toEqual([
      'rail-stone-path.png',
      'rail-stone-path-inside.png',
      'rail-ties.png',
      'rail-backplates.png',
      'rail-metals.png'
    ])
    expect(layers.map((l) => l.layer)).toEqual([
      'rail-stone-path-lower',
      'rail-stone-path',
      'rail-tie',
      'rail-screw',
      'rail-metal'
    ])
  })

  it('picks the picture key from the 16-way direction (northeast = 2)', () => {
    expect(rects(resolveGraphics(parts, 0))[0]).toEqual([0, 256])
    expect(rects(resolveGraphics(parts, 2))[0]).toEqual([0, 2048])
    expect(rects(resolveGraphics(parts, 4))[0]).toEqual([0, 0])
    expect(rects(resolveGraphics(parts, 6))[0]).toEqual([0, 896])
    // Straight rails never use south … northwest; those keys are empty.
    expect(resolveGraphics(parts, 8)).toEqual([])
  })

  it('normalises the RailPictureSet diagonal keys', () => {
    const node = normalizeSprite({ north: railLeaf('a', 0), northeast: railLeaf('b', 0) })
    expect(node?.kind === 'directions' && Object.keys(node.directions)).toEqual([
      'north',
      'north_east'
    ])
  })

  it('elevated rails draw their passes and fences above the bodies', () => {
    const elevated = entityGraphics('elevated-straight-rail', {
      pictures: {
        ...straightRail.pictures,
        render_layers: {
          stone_path_lower: 'elevated-rail-stone-path-lower',
          stone_path: 'elevated-rail-stone-path',
          tie: 'elevated-rail-tie',
          screw: 'elevated-rail-screw',
          metal: 'elevated-rail-metal'
        }
      },
      fence_pictures: { side_A: { fence: { north: railLeaf('fence-A', 0) } } }
    })!
    const layers = resolveGraphics(elevated, 0)
    expect(layers.map((l) => l.layer)).toEqual([
      'elevated-rail-stone-path-lower',
      'elevated-rail-stone-path',
      'elevated-rail-tie',
      'elevated-rail-screw',
      'elevated-rail-metal',
      'elevated-rail-above-metal'
    ])
  })

  it('maps game render layers to draw passes', () => {
    expect(drawLayerFor('rail-tie')).toBe('rail-tie')
    expect(drawLayerFor('floor-mechanics')).toBe('ground')
    expect(drawLayerFor('object')).toBe('object')
    expect(drawLayerFor('train-stop-top')).toBe('higher-object')
    expect(drawLayerFor('elevated-higher-object')).toBe('elevated-object')
    expect(drawLayerFor(undefined)).toBe('object')
  })
})

describe('rail supports and rolling stock (rotated sheets)', () => {
  it('back_equals_front sheets cover half a turn', () => {
    // Rail support: 8 directions for 180°, so direction 8 (south) is frame 0 again.
    const parts = entityGraphics('rail-support', {
      graphics_set: {
        structure: {
          layers: [
            {
              filename:
                '__elevated-rails__/graphics/entity/elevated-rail-pylon/elevated-rail-pylon.png',
              width: 280,
              height: 430,
              line_length: 4,
              direction_count: 8,
              back_equals_front: true,
              scale: 0.5
            }
          ]
        }
      }
    })!
    expect(rects(resolveGraphics(parts, 0))).toEqual([[0, 0]])
    expect(rects(resolveGraphics(parts, 2))).toEqual([[560, 0]])
    expect(rects(resolveGraphics(parts, 4))).toEqual([[0, 430]])
    expect(rects(resolveGraphics(parts, 8))).toEqual([[0, 0]])
  })

  const wagon = {
    joint_distance: 4,
    pictures: {
      rotated: {
        layers: [
          {
            filenames: [1, 2, 3, 4].map(
              (i) => `__base__/graphics/entity/cargo-wagon/cargo-wagon-${i}.png`
            ),
            width: 442,
            height: 408,
            line_length: 4,
            lines_per_file: 8,
            direction_count: 128,
            back_equals_front: true,
            dice: 4,
            scale: 0.5,
            shift: [0, -0.78125]
          }
        ]
      },
      sloped: { layers: [] }
    },
    wheels: {
      rotated: {
        filenames: [1, 2, 3, 4, 5, 6, 7, 8].map(
          (i) => `__base__/graphics/entity/train-wheel/train-wheel-${i}.png`
        ),
        width: 230,
        height: 228,
        line_length: 4,
        lines_per_file: 8,
        direction_count: 256,
        scale: 0.5
      }
    }
  }
  const parts = entityGraphics('cargo-wagon', wagon)!

  it('draws two wheel bogies at ±joint_distance / 2 along the orientation, then the body', () => {
    const layers = resolveGraphics(parts, 4, { orientation: 0.25 })
    expect(files(layers)).toEqual(['train-wheel-3.png', 'train-wheel-3.png', 'cargo-wagon-3.png'])
    expect(layers[0]!.shift[0]).toBeCloseTo(2)
    expect(layers[1]!.shift[0]).toBeCloseTo(-2)
    expect(layers[0]!.shift[1]).toBeCloseTo(0)
  })

  it('takes the frame from the real orientation, not the 16-way direction', () => {
    // 128 frames over half a turn: orientation 0.25 → frame 64 → file 3 (32 frames each), first cell.
    const body = (o: number): SpriteLayer => resolveGraphics(parts, 0, { orientation: o })[2]!
    expect([files([body(0.25)]), body(0.25).rect.x, body(0.25).rect.y]).toEqual([
      ['cargo-wagon-3.png'],
      0,
      0
    ])
    // back_equals_front: the opposite orientation uses the same frame.
    expect(body(0.75)).toEqual(body(0.25))
  })

  it('applies the 45° projection to diagonal orientations', () => {
    // Model angle atan2(sin 45°, cos 45° × √2) = 35.26° → frame 25 of 256 (not 32).
    const wheel = resolveGraphics(parts, 0, { orientation: 0.125 })[0]!
    expect(files([wheel])).toEqual(['train-wheel-1.png'])
    expect([wheel.rect.x, wheel.rect.y]).toEqual([1 * 230, 6 * 228])
  })
})

describe('rail signals', () => {
  // 12 entries per direction; the most common one is the plain straight-rail case.
  const align = [...Array(16).keys()].flatMap((d) => [d === 3 ? 43 : d, ...Array(11).fill(d)])

  it('takes the most common entry per direction of an alignment table', () => {
    expect(modeByDirection(align)).toEqual([...Array(16).keys()])
    expect(modeByDirection([1, 2, 3])).toBeUndefined()
  })

  const signalSet = (
    prefix: string,
    structureFrames: number,
    structureAlign: number[]
  ): object => ({
    structure: {
      layers: [
        {
          filename: `__base__/graphics/entity/rail-signal/${prefix}.png`,
          width: 128,
          height: 128,
          frame_count: 3,
          line_length: 3,
          direction_count: structureFrames,
          scale: 0.5
        },
        {
          filename: `__base__/graphics/entity/rail-signal/${prefix}-lights.png`,
          width: 94,
          height: 94,
          frame_count: 3,
          line_length: 3,
          direction_count: structureFrames,
          draw_as_light: true
        }
      ]
    },
    structure_render_layer: prefix === 'elevated' ? 'elevated-rail-stone-path' : 'floor-mechanics',
    structure_align_to_animation_index: structureAlign,
    rail_piece: {
      sprites: {
        filename: `__base__/graphics/entity/rail-signal/${prefix}-metals.png`,
        width: 162,
        height: 158,
        frame_count: 50,
        line_length: 6,
        scale: 0.5
      },
      render_layer: prefix === 'elevated' ? 'elevated-rail-stone-path-lower' : undefined,
      align_to_frame_index: align
    }
  })
  // Elevated structures have 25 frames; the table maps direction 2 → frame 3.
  const elevatedAlign = [0, 1, 3, 5, 6, 7, 9, 10, 12, 14, 16, 17, 19, 20, 22, 23].flatMap((v) =>
    Array(12).fill(v)
  )
  const parts = entityGraphics('rail-signal', {
    ground_picture_set: signalSet(
      'ground',
      16,
      align.map((_, i) => Math.floor(i / 12))
    ),
    elevated_picture_set: signalSet('elevated', 25, elevatedAlign)
  })!

  it('draws the rail piece then the structure for the signal’s rail layer', () => {
    const ground = resolveGraphics(parts, 2)
    expect(files(ground)).toEqual(['ground-metals.png', 'ground.png'])
    expect(ground.map((l) => l.layer)).toEqual(['rail-chain-signal-metal', 'ground'])
    const elevated = resolveGraphics(parts, 2, { railLayer: 'elevated' })
    expect(files(elevated)).toEqual(['elevated-metals.png', 'elevated.png'])
    expect(elevated.map((l) => l.layer)).toEqual([
      'elevated-rail-stone-path-lower',
      'elevated-rail-stone-path'
    ])
    // Elevated signals sit at rail height.
    expect(elevated.every((l) => l.shift[1] === -3)).toBe(true)
  })

  it('picks frames through the alignment tables', () => {
    // Rail piece: direction 3 → frame 3 (the most common entry, not the first, 43).
    expect(rects(resolveGraphics(parts, 3)).at(0)).toEqual([3 * 162, 0])
    // Structure: direction × frame_count (3 colours), green = frame 0.
    expect(rects(resolveGraphics(parts, 4)).at(1)).toEqual([0, 4 * 128])
    // Elevated structure: direction 2 → frame 3 of 25.
    expect(rects(resolveGraphics(parts, 2, { railLayer: 'elevated' })).at(1)).toEqual([0, 3 * 128])
  })
})

describe('train stops', () => {
  const dir = (file: string, extra: object = {}): object => ({
    north: {
      filename: `__base__/graphics/entity/train-stop/${file}.png`,
      width: 10,
      height: 10,
      ...extra
    },
    east: {
      filename: `__base__/graphics/entity/train-stop/${file}.png`,
      width: 10,
      height: 10,
      x: 10,
      ...extra
    }
  })
  const parts = entityGraphics('train-stop', {
    rail_overlay_animations: dir('train-stop-ground'),
    animations: dir('train-stop-bottom'),
    top_animations: dir('train-stop-top-mask', { apply_runtime_tint: true })
  })!

  it('draws the rail overlay on the ground, the bottom as a body and the top above bodies', () => {
    const layers = resolveGraphics(parts, 4)
    expect(files(layers)).toEqual([
      'train-stop-ground.png',
      'train-stop-bottom.png',
      'train-stop-top-mask.png'
    ])
    expect(layers.map((l) => l.layer)).toEqual(['ground', undefined, 'higher-object'])
    expect(layers[2]!.tint).toEqual(PLAYER_COLOR)
  })

  it('tints the runtime-tint mask with the given colour', () => {
    const layers = resolveGraphics(parts, 4, { runtimeTint: [0, 0, 1, 1] })
    expect(layers[2]!.tint).toEqual([0, 0, 1, 1])
  })
})

describe('graphicsOptionsFor', () => {
  const layout = (entity: object): EntityLayout =>
    ({
      entity: { entity_number: 1, name: 'x', position: { x: 0, y: 0 }, ...entity }
    }) as EntityLayout
  const stop: EntityProto = { type: 'train-stop', width: 2, height: 2, color: [0.95, 0, 0, 1] }
  const wagon: EntityProto = { type: 'cargo-wagon', width: 2, height: 5, color: [0.43, 0.23, 0, 1] }
  const signal: EntityProto = { type: 'rail-signal', width: 1, height: 1 }

  it('uses the blueprint colour, else the prototype default', () => {
    expect(graphicsOptionsFor(stop, layout({}))).toEqual({ runtimeTint: [0.95, 0, 0, 1] })
    expect(
      graphicsOptionsFor(stop, layout({ color: { r: 0, g: 0.5, b: 1, a: 1 } })).runtimeTint
    ).toEqual([0, 0.5, 1, 1])
  })

  it('passes rolling stock orientation and the signal rail layer', () => {
    expect(graphicsOptionsFor(wagon, layout({ orientation: 0.25 })).orientation).toBe(0.25)
    expect(graphicsOptionsFor(signal, layout({ rail_layer: 'elevated' }))).toEqual({
      railLayer: 'elevated'
    })
    expect(graphicsOptionsFor(signal, layout({}))).toEqual({})
  })

  it('has an empty cache key for plain entities and distinct keys otherwise', () => {
    expect(graphicsOptionsKey({})).toBe('')
    expect(graphicsOptionsKey({ orientation: 0.25 })).not.toBe(
      graphicsOptionsKey({ orientation: 0.75 })
    )
    expect(graphicsOptionsKey({ railLayer: 'elevated' })).not.toBe('')
  })
})
