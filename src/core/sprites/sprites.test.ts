import { describe, expect, it } from 'vitest'
import { entityGraphics } from './graphics'
import { color, normalizeSprite } from './normalize'
import { PLAYER_COLOR, pickDirection, resolveGraphics } from './resolve'
import type { GraphicsPart, SpriteLayer } from './types'

// Excerpts copied from the Factorio 2.1.25 `data-raw-dump.json` (fields the
// resolver ignores, like priority and animation_speed, are left in on purpose).

const N = 0
const E = 4
const S = 8
const W = 12

function resolve(value: unknown, direction = N, opts: Partial<GraphicsPart> = {}): SpriteLayer[] {
  const node = normalizeSprite(value)
  if (!node) return []
  return resolveGraphics([{ node, ...opts }], direction)
}

const rects = (layers: SpriteLayer[]): [number, number][] => layers.map((l) => [l.rect.x, l.rect.y])
const files = (layers: SpriteLayer[]): string[] => layers.map((l) => l.url.split('/').pop()!)

describe('single sprites and layers', () => {
  const woodenChest = {
    layers: [
      {
        filename: '__base__/graphics/entity/wooden-chest/wooden-chest.png',
        priority: 'extra-high',
        width: 62,
        height: 72,
        shift: [0.015625, -0.0625],
        scale: 0.5
      },
      {
        filename: '__base__/graphics/entity/wooden-chest/wooden-chest-shadow.png',
        priority: 'extra-high',
        width: 104,
        height: 40,
        shift: [0.3125, 0.203125],
        draw_as_shadow: true,
        scale: 0.5
      }
    ]
  }

  it('resolves each layer with url, rect, shift, scale and shadow flag', () => {
    expect(resolve(woodenChest)).toEqual([
      {
        url: 'factorio-asset://data/base/graphics/entity/wooden-chest/wooden-chest.png',
        rect: { x: 0, y: 0, w: 62, h: 72 },
        shift: [0.015625, -0.0625],
        scale: 0.5,
        shadow: false,
        ground: false
      },
      {
        url: 'factorio-asset://data/base/graphics/entity/wooden-chest/wooden-chest-shadow.png',
        rect: { x: 0, y: 0, w: 104, h: 40 },
        shift: [0.3125, 0.203125],
        scale: 0.5,
        shadow: true,
        ground: false
      }
    ])
  })

  it('ignores the direction for a plain sprite', () => {
    expect(resolve(woodenChest, W)).toEqual(resolve(woodenChest, N))
  })

  it('takes frame 0 of an animation, and repeat_count stretches frames', () => {
    // Assembling machine 2: a 1-frame base repeated 64× and a 64-frame animation, 8 per line.
    const am2 = {
      layers: [
        {
          repeat_count: 64,
          scale: 0.5,
          width: 200,
          height: 188,
          shift: [0, 0.078125],
          line_length: 1,
          filename: '__base__/graphics/entity/assembling-machine-2/assembling-machine-2-base.png'
        },
        {
          frame_count: 64,
          scale: 0.5,
          width: 148,
          height: 158,
          shift: [0.046875, -0.484375],
          line_length: 8,
          filename: '__base__/graphics/entity/assembling-machine-2/assembling-machine-2-anim.png'
        }
      ]
    }
    const node = normalizeSprite(am2)!
    expect(rects(resolveGraphics([{ node }], N))).toEqual([
      [0, 0],
      [0, 0]
    ])
    // Frame 10: base stays at frame 0, animation frame 10 → column 2, row 1.
    expect(rects(resolveGraphics([{ node }], N, { frame: 10 }))).toEqual([
      [0, 0],
      [296, 158]
    ])
  })

  it('reads `size` and `position` instead of width/height/x/y', () => {
    expect(
      resolve({ filename: '__base__/graphics/x.png', size: [64, 32], position: [128, 64] })[0]!.rect
    ).toEqual({ x: 128, y: 64, w: 64, h: 32 })
    expect(resolve({ filename: '__base__/graphics/x.png', size: 64 })[0]!.rect).toEqual({
      x: 0,
      y: 0,
      w: 64,
      h: 64
    })
  })

  it('drops lights, empty sprites and malformed values', () => {
    expect(
      normalizeSprite({
        filename: '__base__/graphics/entity/stone-furnace/stone-furnace-ground-light.png',
        width: 116,
        height: 110,
        draw_as_light: true,
        blend_mode: 'additive'
      })
    ).toBeNull()
    expect(normalizeSprite({ filename: '__core__/graphics/empty.png', width: 1, height: 1 })).toBe(
      null
    )
    expect(normalizeSprite({ filename: '__base__/x.png' })).toBeNull() // no size
    expect(normalizeSprite({ filename: 42, width: 1, height: 1 })).toBeNull()
    expect(normalizeSprite('nope')).toBeNull()
    expect(
      normalizeSprite({ layers: [{ filename: '__core__/graphics/empty.png', size: 1 }] })
    ).toBe(null)
  })

  it('uses the first of a variations array', () => {
    expect(
      files(
        resolve([
          { filename: '__base__/graphics/a.png', size: 32 },
          { filename: '__base__/graphics/b.png', size: 32 }
        ])
      )
    ).toEqual(['a.png'])
  })

  it('keeps tints, colours runtime-tint masks with the player colour, and marks additive', () => {
    const [mask] = resolve({
      filename: '__base__/graphics/entity/gun-turret/gun-turret-base-mask.png',
      flags: ['mask', 'low-object'],
      line_length: 1,
      width: 122,
      height: 102,
      shift: [0, -0.140625],
      apply_runtime_tint: true,
      scale: 0.5
    })
    expect(mask!.tint).toEqual(PLAYER_COLOR)
    const [tinted] = resolve({
      filename: '__base__/graphics/x.png',
      size: 8,
      tint: { r: 255, g: 128, b: 0 },
      blend_mode: 'additive'
    })
    expect(tinted!.tint).toEqual([1, 128 / 255, 0, 1])
    expect(tinted!.additive).toBe(true)
  })
})

describe('color', () => {
  it('reads objects and arrays, 0–1 and 0–255', () => {
    expect(color({ r: 0.5, g: 0.25, b: 0 })).toEqual([0.5, 0.25, 0, 1])
    expect(color([255, 0, 0, 128])).toEqual([1, 0, 0, 128 / 255])
    expect(color('red')).toBeUndefined()
  })
})

describe('direction-indexed sheets', () => {
  it('picks the sheet frame by direction (inserter platform, 4 frames)', () => {
    const platform = {
      sheet: {
        filename: '__base__/graphics/entity/inserter/inserter-platform.png',
        priority: 'extra-high',
        width: 105,
        height: 79,
        shift: [0.046875, 0.203125],
        scale: 0.5
      }
    }
    expect([N, E, S, W].map((d) => resolve(platform, d)[0]!.rect.x)).toEqual([0, 105, 210, 315])
  })

  it('wraps a 2-frame sheet (storage tank: N/S and E/W share a frame)', () => {
    const tank = {
      sheets: [
        {
          filename: '__base__/graphics/entity/storage-tank/storage-tank.png',
          priority: 'extra-high',
          frames: 2,
          width: 219,
          height: 235,
          shift: [-0.0078125, -0.0390625],
          scale: 0.5
        },
        {
          filename: '__base__/graphics/entity/storage-tank/storage-tank-shadow.png',
          priority: 'extra-high',
          frames: 2,
          width: 291,
          height: 153,
          shift: [0.9296875, 0.6953125],
          scale: 0.5,
          draw_as_shadow: true
        }
      ]
    }
    expect([N, E, S, W].map((d) => rects(resolve(tank, d)))).toEqual([
      [
        [0, 0],
        [0, 0]
      ],
      [
        [219, 0],
        [291, 0]
      ],
      [
        [0, 0],
        [0, 0]
      ],
      [
        [219, 0],
        [291, 0]
      ]
    ])
  })
})

describe('per-direction objects', () => {
  const combinator = {
    north: {
      layers: [
        {
          filename: '__base__/graphics/entity/combinator/arithmetic-combinator.png',
          width: 144,
          height: 124,
          scale: 0.5,
          x: 0,
          y: 0
        }
      ]
    },
    east: {
      layers: [
        {
          filename: '__base__/graphics/entity/combinator/arithmetic-combinator.png',
          width: 144,
          height: 124,
          scale: 0.5,
          x: 144,
          y: 0
        }
      ]
    },
    south: {
      layers: [
        {
          filename: '__base__/graphics/entity/combinator/arithmetic-combinator.png',
          width: 144,
          height: 124,
          scale: 0.5,
          x: 288,
          y: 0
        }
      ]
    },
    west: {
      layers: [
        {
          filename: '__base__/graphics/entity/combinator/arithmetic-combinator.png',
          width: 144,
          height: 124,
          scale: 0.5,
          x: 432,
          y: 0
        }
      ]
    }
  }

  it('picks the matching key (combinator sprites)', () => {
    expect([N, E, S, W].map((d) => resolve(combinator, d)[0]!.rect.x)).toEqual([0, 144, 288, 432])
  })

  it('falls back to the opposite direction when only north and east exist (steam engine)', () => {
    const engine = {
      north: { filename: '__base__/graphics/entity/steam-engine/steam-engine-V.png', size: 8 },
      east: { filename: '__base__/graphics/entity/steam-engine/steam-engine-H.png', size: 8 }
    }
    expect([N, E, S, W].map((d) => files(resolve(engine, d))[0])).toEqual([
      'steam-engine-V.png',
      'steam-engine-H.png',
      'steam-engine-V.png',
      'steam-engine-H.png'
    ])
  })

  it('uses 8-way keys for diagonal directions (flamethrower turret base)', () => {
    const base = {
      north: { filename: '__base__/graphics/entity/flamethrower-turret/n.png', size: 8 },
      north_east: {
        filename:
          '__base__/graphics/entity/flamethrower-turret/flamethrower-turret-base-north-east.png',
        width: 220,
        height: 190,
        shift: [0.21875, 0.03125],
        scale: 0.5
      },
      east: { filename: '__base__/graphics/entity/flamethrower-turret/e.png', size: 8 }
    }
    expect(files(resolve(base, 2))).toEqual(['flamethrower-turret-base-north-east.png'])
    expect(files(resolve(base, 15))).toEqual(['n.png']) // 16-way rounds to the nearest 8-way key
  })

  it('pickDirection rounds 16-way directions', () => {
    expect(pickDirection({ north: 'n', east: 'e', south: 's', west: 'w' }, 14)).toBe('n')
    expect(pickDirection({ east: 'e' }, 0)).toBe('e')
  })
})

describe('rotated sheets (direction_count)', () => {
  it('stacks directions in rows when line_length is 1 (gun turret folded)', () => {
    const folded = {
      filename: '__base__/graphics/entity/gun-turret/gun-turret-raising.png',
      width: 130,
      height: 126,
      direction_count: 4,
      frame_count: 1,
      line_length: 1,
      shift: [0, -0.875],
      scale: 0.5
    }
    expect([N, E, S, W].map((d) => resolve(folded, d)[0]!.rect.y)).toEqual([0, 126, 252, 378])
  })

  it('treats line_length 0 as one row per direction (gun turret preparing, 5 frames)', () => {
    const preparing = {
      filename: '__base__/graphics/entity/gun-turret/gun-turret-raising.png',
      width: 130,
      height: 126,
      direction_count: 4,
      frame_count: 5,
      line_length: 0,
      shift: [0, -0.875],
      scale: 0.5
    }
    expect(rects(resolve(preparing, E))).toEqual([[0, 126]])
    expect(rects(resolve(preparing, W))).toEqual([[0, 378]])
  })

  it('puts single-frame rotations in one row, and fixedRotation always takes index 0', () => {
    const pole = {
      filename: '__base__/graphics/entity/medium-electric-pole/medium-electric-pole.png',
      priority: 'extra-high',
      width: 84,
      height: 252,
      direction_count: 4,
      shift: [0.109375, -1.375],
      scale: 0.5
    }
    expect(rects(resolve(pole, E))).toEqual([[84, 0]])
    expect(rects(resolve(pole, E, { fixedRotation: true }))).toEqual([[0, 0]])
    // The pole variation picked from its wires chooses the frame instead.
    const node = normalizeSprite(pole)!
    const varied = resolveGraphics([{ node, fixedRotation: true }], N, { variation: 2 })
    expect(rects(varied)).toEqual([[168, 0]])
  })

  it('maps 16-way directions onto 64 orientations (radar, 8 per line)', () => {
    const radar = {
      filename: '__base__/graphics/entity/radar/radar.png',
      width: 196,
      height: 254,
      direction_count: 64,
      line_length: 8,
      scale: 0.5
    }
    // South = orientation 0.5 → index 32 → column 0, row 4.
    expect(rects(resolve(radar, S))).toEqual([[0, 4 * 254]])
  })

  it('continues across `filenames` with lines_per_file (artillery cannon base)', () => {
    const cannonBase = {
      dice: 4,
      priority: 'very-low',
      allow_low_quality_rotation: true,
      direction_count: 256,
      scale: 0.5,
      width: 378,
      height: 280,
      shift: [0, -1.359375],
      line_length: 4,
      filenames: [1, 2, 3, 4, 5, 6, 7, 8].map(
        (i) => `__base__/graphics/entity/artillery-wagon/artillery-wagon-cannon-base-${i}.png`
      ),
      lines_per_file: 8
    }
    // 32 orientations per file. East = 64 → file 3, first frame. Index 70 → file 3, col 2, row 1.
    const east = resolve(cannonBase, E)[0]!
    expect(east.url).toMatch(/cannon-base-3\.png$/)
    expect(east.rect).toEqual({ x: 0, y: 0, w: 378, h: 280 })
    const south = resolve(cannonBase, S)[0]!
    expect(south.url).toMatch(/cannon-base-5\.png$/)
  })

  it('continues across stripes (gun turret prepared, 16 orientations per stripe)', () => {
    const prepared = {
      width: 132,
      height: 130,
      frame_count: 1,
      direction_count: 64,
      shift: [0, -0.859375],
      stripes: [1, 2, 3, 4].map((i) => ({
        filename: `__base__/graphics/entity/gun-turret/gun-turret-shooting-${i}.png`,
        width_in_frames: 1,
        height_in_frames: 16
      })),
      scale: 0.5
    }
    const north = resolve(prepared, N)[0]!
    expect(north.url).toMatch(/shooting-1\.png$/)
    expect(north.rect.y).toBe(0)
    // East = 16 → second stripe, row 0. 16-way direction 6 (SE) = 24 → second stripe, row 8.
    expect(resolve(prepared, E)[0]!.url).toMatch(/shooting-2\.png$/)
    const se = resolve(prepared, 6)[0]!
    expect(se.url).toMatch(/shooting-2\.png$/)
    expect(se.rect.y).toBe(8 * 130)
  })
})

describe('entityGraphics (which properties make up an entity)', () => {
  const sprite = (name: string, extra: object = {}): object => ({
    filename: `__base__/graphics/${name}.png`,
    size: 8,
    ...extra
  })

  it('returns undefined for types without sprites yet', () => {
    expect(entityGraphics('transport-belt', { belt_animation_set: {} })).toBeUndefined()
    expect(entityGraphics('container', {})).toBeUndefined()
  })

  it('crafting machines: always-drawn working visualisations around the main animation', () => {
    // Pumpjack: the base is an always-drawn visualisation with secondary_draw_order -1.
    const parts = entityGraphics('mining-drill', {
      graphics_set: {
        animation: { north: sprite('horsehead') },
        working_visualisations: [
          {
            always_draw: true,
            secondary_draw_order: -1,
            north_animation: sprite('base-n'),
            east_animation: sprite('base-e')
          },
          { fadeout: true, animation: sprite('working-light') },
          { always_draw: true, apply_recipe_tint: 'primary', animation: sprite('fluid') },
          { always_draw: true, animation: sprite('top') }
        ]
      }
    })!
    expect(files(resolveGraphics(parts, E))).toEqual(['base-e.png', 'horsehead.png', 'top.png'])
  })

  it('crafting machines: idle animation when there is no animation (centrifuge)', () => {
    const parts = entityGraphics('assembling-machine', {
      graphics_set: { always_draw_idle_animation: true, idle_animation: sprite('centrifuge') }
    })!
    expect(files(resolveGraphics(parts, N))).toEqual(['centrifuge.png'])
  })

  it('logistic chests use the closed robot door frame', () => {
    const parts = entityGraphics('logistic-container', {
      robot_door: {
        opened_duration: 7,
        animation: {
          layers: [
            {
              filename: '__base__/graphics/entity/logistic-chest/passive-provider-chest.png',
              width: 66,
              height: 74,
              frame_count: 7,
              scale: 0.5
            }
          ]
        }
      }
    })!
    expect(resolveGraphics(parts, N)[0]!.rect).toEqual({ x: 0, y: 0, w: 66, h: 74 })
  })

  it('marks integration patches as ground and pole pictures as fixed rotation', () => {
    const radar = entityGraphics('radar', {
      integration_patch: sprite('radar-integration'),
      pictures: sprite('radar', { direction_count: 64, line_length: 8 })
    })!
    expect(radar.map((p) => [!!p.ground, !!p.fixedRotation])).toEqual([
      [true, false],
      [false, true]
    ])
    expect(resolveGraphics(radar, N).map((l) => l.ground)).toEqual([true, false])
  })

  it('beacons draw the always-drawn entries of animation_list', () => {
    const parts = entityGraphics('beacon', {
      graphics_set: {
        animation_list: [
          { render_layer: 'floor-mechanics', always_draw: true, animation: sprite('bottom') },
          { render_layer: 'object', always_draw: true, animation: sprite('top') },
          { render_layer: 'object', always_draw: false, animation: sprite('light') }
        ]
      }
    })!
    expect(files(resolveGraphics(parts, N))).toEqual(['bottom.png', 'top.png'])
  })

  it('boilers and generators unwrap per-direction sub-keys', () => {
    const boiler = entityGraphics('boiler', {
      pictures: {
        north: { structure: sprite('boiler-n'), fire: sprite('fire') },
        east: { structure: sprite('boiler-e') }
      }
    })!
    expect(files(resolveGraphics(boiler, E))).toEqual(['boiler-e.png'])
    const legacy = entityGraphics('generator', {
      vertical_animation: sprite('v'),
      horizontal_animation: sprite('h')
    })!
    expect(files(resolveGraphics(legacy, W))).toEqual(['h.png'])
  })

  it('turrets draw the base, then the folded gun', () => {
    const parts = entityGraphics('ammo-turret', {
      graphics_set: { base_visualisation: { animation: sprite('base') } },
      folded_animation: sprite('folded', { direction_count: 4, line_length: 1 }),
      prepared_animation: sprite('prepared')
    })!
    expect(files(resolveGraphics(parts, N))).toEqual(['base.png', 'folded.png'])
  })
})
