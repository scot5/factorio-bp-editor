import { describe, expect, it } from 'vitest'
import type { EntityLayout } from '../model/layout'
import type { EntityProto } from '../prototypes/db'
import { entityGraphics, entityGraphicsFlipped } from './graphics'
import { armPose } from './inserter'
import { drawLayerFor } from './layers'
import { normalizeSprite } from './normalize'
import { resolveGraphics } from './resolve'
import { MATERIAL_BLOCK, resolveTile, tileGraphics } from './tiles'
import type { SpriteLayer } from './types'
import { drawsFlipped, graphicsFor, graphicsOptionsFor } from './variant'

// Trimmed excerpts from the Factorio 2.1.25 `data-raw-dump.json`.

const sprite = (name: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  filename: `__space-age__/graphics/entity/${name}.png`,
  width: 64,
  height: 64,
  scale: 0.5,
  ...extra
})
const files = (layers: SpriteLayer[]): string[] => layers.map((l) => l.url.split('/').pop()!)

describe('render layers', () => {
  it('maps every game render layer to a draw pass', () => {
    expect(drawLayerFor('lower-object')).toBe('lower-object')
    expect(drawLayerFor('lower-object-overlay')).toBe('lower-object-above-shadow')
    expect(drawLayerFor('object-under')).toBe('object-under')
    expect(drawLayerFor('cargo-hatch')).toBe('cargo-hatch')
    expect(drawLayerFor('higher-object-under')).toBe('higher-object-under')
    expect(drawLayerFor('item-in-inserter-hand')).toBe('higher-object')
    expect(drawLayerFor('above-inserters')).toBe('above-inserters')
    expect(drawLayerFor('decals')).toBe('ground')
    expect(drawLayerFor('wires')).toBe('above-inserters')
  })

  it("keeps a sprite's own render_layer, or its container's, and it wins over the part's", () => {
    const node = normalizeSprite({
      render_layer: 'lower-object-above-shadow',
      layers: [sprite('a'), sprite('b', { render_layer: 'object' })]
    })!
    const layers = resolveGraphics([{ node, layer: 'higher-object' }], 0)
    expect(layers.map((l) => l.layer)).toEqual(['lower-object-above-shadow', 'higher-object'])
  })

  it('working visualisations and beacon entries keep their render_layer', () => {
    const parts = entityGraphics('beacon', {
      graphics_set: {
        animation_list: [
          { render_layer: 'floor-mechanics', always_draw: true, animation: sprite('bottom') },
          { render_layer: 'object', always_draw: true, animation: sprite('top') }
        ]
      }
    })!
    expect(parts.map((p) => p.layer)).toEqual(['ground', undefined])
  })
})

describe('Space Age buildings', () => {
  it('cargo bays and hubs draw every picture piece in its render layer, then the animation', () => {
    const parts = entityGraphics('space-platform-hub', {
      graphics_set: {
        picture: [
          { render_layer: 'lower-object-above-shadow', layers: [sprite('hub-0-A')] },
          { render_layer: 'object-under', layers: [sprite('hub-2')] },
          {
            render_layer: 'object',
            layers: [sprite('hub-3'), sprite('hub-shadow', { draw_as_shadow: true })]
          },
          { render_layer: 'cargo-hatch', layers: [sprite('hub-hatch-occluder')] }
        ],
        animation: { layers: [sprite('cockpit', { frame_count: 9, line_length: 3 })] }
      }
    })!
    const layers = resolveGraphics(parts, 0)
    expect(files(layers)).toEqual([
      'hub-0-A.png',
      'hub-2.png',
      'hub-3.png',
      'hub-shadow.png',
      'hub-hatch-occluder.png',
      'cockpit.png'
    ])
    expect(layers.map((l) => l.layer ?? (l.shadow ? 'shadow' : 'object'))).toEqual([
      'lower-object-above-shadow',
      'object-under',
      'object',
      'shadow',
      'cargo-hatch',
      'object'
    ])
  })

  it('fusion generators take the per-direction graphics set', () => {
    const parts = entityGraphics('fusion-generator', {
      graphics_set: {
        north_graphics_set: { animation: sprite('fusion-generator-north') },
        east_graphics_set: { animation: sprite('fusion-generator-east') },
        south_graphics_set: { animation: sprite('fusion-generator-south') },
        west_graphics_set: { animation: sprite('fusion-generator-west') }
      }
    })!
    expect(files(resolveGraphics(parts, 4))).toEqual(['fusion-generator-east.png'])
    expect(files(resolveGraphics(parts, 12))).toEqual(['fusion-generator-west.png'])
  })

  it('asteroid collectors draw the parts below the platform edge first', () => {
    const parts = entityGraphics('asteroid-collector', {
      graphics_set: {
        animation: { north: sprite('top-north'), east: sprite('top-east') },
        below_arm_pictures: sprite('middle', { direction_count: 4, line_length: 4 }),
        below_ground_pictures: sprite('bottom', { direction_count: 4, line_length: 4 })
      }
    })!
    const layers = resolveGraphics(parts, 4)
    expect(files(layers)).toEqual(['bottom.png', 'middle.png', 'top-east.png'])
    expect(layers[0]!.rect.x).toBe(64) // the east frame of the rotated sheet
  })

  it('thrusters draw their integration patch on the ground; lightning rods their picture', () => {
    const thruster = entityGraphics('thruster', {
      graphics_set: { integration_patch: sprite('bckg'), animation: sprite('thruster-1') }
    })!
    expect(resolveGraphics(thruster, 0).map((l) => l.ground)).toEqual([true, false])
    const rod = entityGraphics('lightning-attractor', {
      chargable_graphics: { picture: { layers: [sprite('lightning-rod')] } }
    })!
    expect(files(resolveGraphics(rod, 0))).toEqual(['lightning-rod.png'])
  })
})

describe('mirror', () => {
  const recycler = {
    graphics_set: { animation: { north: sprite('recycler-N') } },
    graphics_set_flipped: { animation: { north: sprite('recycler-flipped-N') } }
  }

  it('keeps graphics_set_flipped only where the prototype has one', () => {
    expect(files(resolveGraphics(entityGraphicsFlipped('furnace', recycler)!, 0))).toEqual([
      'recycler-flipped-N.png'
    ])
    expect(entityGraphicsFlipped('assembling-machine', { graphics_set: {} })).toBeUndefined()
    expect(entityGraphicsFlipped('container', { graphics_set_flipped: {} })).toBeUndefined()
  })

  it('a mirrored entity draws the flipped set when there is one, else the normal one', () => {
    const proto: EntityProto = {
      type: 'furnace',
      width: 4,
      height: 4,
      graphics: entityGraphics('furnace', recycler)!,
      graphicsFlipped: entityGraphicsFlipped('furnace', recycler)!
    }
    const layout = (mirror: boolean): EntityLayout =>
      ({
        entity: { entity_number: 1, name: 'recycler', position: { x: 0, y: 0 }, mirror },
        direction: 0
      }) as unknown as EntityLayout
    expect(drawsFlipped(proto, layout(true))).toBe(true)
    expect(graphicsFor(proto, layout(true))).toBe(proto.graphicsFlipped)
    expect(graphicsFor(proto, layout(false))).toBe(proto.graphics)
    const plain = { ...proto, graphicsFlipped: undefined }
    expect(drawsFlipped(plain, layout(true))).toBe(false)
    expect(graphicsFor(plain, layout(true))).toBe(proto.graphics)
  })
})

describe('cars', () => {
  it('are drawn from their orientation, like rolling stock', () => {
    const proto: EntityProto = { type: 'car', width: 2, height: 3 }
    const e = {
      entity: { entity_number: 1, name: 'car', position: { x: 0, y: 0 }, orientation: 0.3 }
    } as unknown as EntityLayout
    expect(graphicsOptionsFor(proto, e)).toEqual({ orientation: 0.3 })
  })
})

describe('inserter arm', () => {
  const inserter = {
    platform_picture: { sheet: sprite('platform', { width: 105, height: 79 }) },
    hand_base_picture: sprite('hand-base', { width: 32, height: 136, scale: 0.25 }),
    hand_open_picture: sprite('hand-open', { width: 72, height: 164, scale: 0.25 }),
    hand_closed_picture: sprite('hand-closed', { width: 72, height: 164, scale: 0.25 }),
    pickup_position: [0, -1],
    insert_position: [0, 1.2]
  }

  it('draws the platform, then the arm base and the open hand above belts and machines', () => {
    const parts = entityGraphics('inserter', inserter)!
    const layers = resolveGraphics(parts, 0)
    expect(files(layers)).toEqual(['platform.png', 'hand-base.png', 'hand-open.png'])
    expect(layers.map((l) => l.layer)).toEqual([
      undefined,
      'higher-object-under',
      'higher-object-under'
    ])
    expect(parts[1]!.arm).toEqual({ piece: 'base', reach: 1 })
  })

  it('poses the arm towards the pickup side, rotated and squashed from its bottom centre', () => {
    const parts = entityGraphics('inserter', inserter)!
    const [, base, hand] = resolveGraphics(parts, 12) // pickup on the west
    expect(base).toMatchObject({ anchor: [0.5, 1], shift: [0.03, 0.03] })
    expect(base!.rotation).toBeCloseTo(-Math.PI / 4)
    expect(base!.squash).toBeCloseTo(1 / 1.9)
    expect(hand).toMatchObject({ anchor: [0.5, 1], shift: [-0.325, -0.325] })
    expect(hand!.rotation).toBeCloseTo((-135 * Math.PI) / 180)
    // North: no rotation.
    const [, northBase] = resolveGraphics(parts, 0)
    expect(northBase!.rotation).toBeUndefined()
  })

  it('long-handed inserters (pickup 2 tiles away) use the long poses', () => {
    expect(armPose('hand', 4, 2)).toEqual({ rotation: 155, squash: 1 / 1.5, offset: [0.275, -0.7] })
    expect(armPose('hand', 4, 1)).toEqual({
      rotation: 135,
      squash: 1 / 2.5,
      offset: [0.325, -0.325]
    })
    const parts = entityGraphics('inserter', { ...inserter, pickup_position: { x: 0, y: -2 } })!
    expect(parts[2]!.arm).toEqual({ piece: 'hand', reach: 2 })
  })
})

describe('tiles', () => {
  const concrete = {
    variants: {
      material_background: {
        picture: '__base__/graphics/terrain/concrete/concrete.png',
        count: 8,
        scale: 0.5
      }
    }
  }
  const stonePath = {
    variants: {
      main: [
        { picture: '__base__/graphics/terrain/stone-path/stone-path-4.png', count: 16, size: 4 },
        {
          picture: '__base__/graphics/terrain/stone-path/stone-path-1.png',
          count: 16,
          size: 1,
          scale: 0.5
        }
      ]
    }
  }

  it('reads material backgrounds and the 1×1 main variant', () => {
    expect(tileGraphics(concrete)).toEqual({
      kind: 'material',
      file: '__base__/graphics/terrain/concrete/concrete.png',
      count: 8,
      scale: 0.5
    })
    expect(tileGraphics(stonePath)).toMatchObject({ kind: 'main', count: 16 })
    expect(
      tileGraphics({ variants: { main: [{ picture: 'foundation-dummy.png', size: 1 }] } })
    ).toBeUndefined()
    expect(tileGraphics({ name: 'out-of-map' })).toBeUndefined()
  })

  it('a material tile draws its square of an 8×8 block, the same block for its neighbours', () => {
    const g = tileGraphics(concrete)!
    const a = resolveTile(g, 0, 0)!
    const b = resolveTile(g, 3, 5)!
    expect(a).toMatchObject({ scale: 0.5, ground: true, shift: [0, 0] })
    expect(a.rect.w).toBe(64)
    // Same block: the same variant column, offset by the tile's place in the block.
    expect(b.rect.x - a.rect.x).toBe(3 * 64)
    expect(b.rect.y - a.rect.y).toBe(5 * 64)
    for (let x = -20; x < 20; x++)
      for (let y = -20; y < 20; y++) {
        const r = resolveTile(g, x, y)!.rect
        expect(r.x + r.w).toBeLessThanOrEqual(8 * MATERIAL_BLOCK * 64)
        expect(r.y + r.h).toBeLessThanOrEqual(MATERIAL_BLOCK * 64)
      }
  })

  it('honours line_length and the material block size (Fulgora)', () => {
    const withBlock = tileGraphics({
      variants: {
        material_background: {
          picture: '__space-age__/graphics/terrain/fulgoran-dunes.png',
          line_length: 4,
          count: 16,
          scale: 0.5
        },
        material_texture_width_in_tiles: 10,
        material_texture_height_in_tiles: 7
      }
    })!
    // 16 blocks of 10 × 7 tiles, 4 per row: a 2560 × 1792 px sheet.
    expect(withBlock).toMatchObject({ lineLength: 4, blockWidth: 10, blockHeight: 7 })
    for (let x = -30; x < 30; x++)
      for (let y = -30; y < 30; y++) {
        const r = resolveTile(withBlock, x, y)!.rect
        expect(r.x + r.w).toBeLessThanOrEqual(2560)
        expect(r.y + r.h).toBeLessThanOrEqual(1792)
      }
  })

  it('a main tile picks one of its variations per tile', () => {
    const g = tileGraphics(stonePath)!
    const xs = new Set<number>()
    for (let x = 0; x < 40; x++) {
      const r = resolveTile(g, x, 0)!.rect
      expect(r).toMatchObject({ y: 0, w: 64, h: 64 })
      xs.add(r.x)
    }
    expect(xs.size).toBeGreaterThan(4)
    expect(Math.max(...xs)).toBeLessThanOrEqual(15 * 64)
  })
})
