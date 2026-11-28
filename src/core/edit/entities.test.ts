import { describe, expect, it } from 'vitest'
import { encode, type BlueprintEnvelope, type JsonObject } from '../codec'
import type { Box } from '../geometry'
import type { BlueprintEntity } from '../model'
import { fallbackPrototypeLookup, type PrototypeLookup } from '../prototypes'
import {
  deleteEntities,
  emptyHistory,
  execute,
  mirrorEntities,
  mirrorPivot,
  moveEntities,
  rotateEntities,
  rotationPivot,
  undo,
  type Command,
  type ExecuteResult,
  type History
} from '.'

const lookup: PrototypeLookup = (name) => {
  const info = fallbackPrototypeLookup(name)
  // As the PrototypeDb says for these (format 12).
  if (name === 'oil-refinery' && info) return { ...info, mirroring: true }
  if (name === 'stone-furnace' && info) return { ...info, rotatable: false }
  return info
}

type Entity = Partial<BlueprintEntity> & Pick<BlueprintEntity, 'name' | 'position'>

function blueprint(entities: Entity[], extra: JsonObject = {}): BlueprintEnvelope {
  return {
    blueprint: {
      item: 'blueprint',
      entities: entities.map((e, i) => ({ entity_number: i + 1, ...e })) as JsonObject[],
      ...extra,
      version: 562954250027018
    }
  }
}

function ok(result: ExecuteResult): Extract<ExecuteResult, { ok: true }> {
  if (!result.ok) throw new Error(`unexpected rejection: ${result.message}`)
  return result
}

function entitiesOf(envelope: BlueprintEnvelope): BlueprintEntity[] {
  return (envelope['blueprint'] as JsonObject)['entities'] as unknown as BlueprintEntity[]
}

/** Runs commands in order and returns the final envelope and history. */
function run(
  start: BlueprintEnvelope,
  steps: [Command<never>, object][]
): { envelope: BlueprintEnvelope; history: History } {
  let envelope = start
  let history = emptyHistory()
  for (const [command, args] of steps) {
    const result = ok(execute(envelope, history, command, args as never))
    envelope = result.envelope
    history = result.history
  }
  return { envelope, history }
}

const all = (envelope: BlueprintEnvelope): number[] => entitiesOf(envelope).map((_, i) => i)
const sel = (
  envelope: BlueprintEnvelope
): { path: number[]; indexes: number[]; lookup: PrototypeLookup } => ({
  path: [],
  indexes: all(envelope),
  lookup
})

describe('moveEntities', () => {
  it('moves the selected entities by whole tiles', () => {
    const start = blueprint([
      { name: 'iron-chest', position: { x: 0.5, y: 0.5 } },
      { name: 'iron-chest', position: { x: 1.5, y: 0.5 } }
    ])
    const result = ok(
      execute(start, emptyHistory(), moveEntities, {
        path: [],
        indexes: [1],
        lookup,
        dx: 2,
        dy: -1
      })
    )
    expect(entitiesOf(result.envelope).map((e) => e.position)).toEqual([
      { x: 0.5, y: 0.5 },
      { x: 3.5, y: -0.5 }
    ])
    expect(result.history.undo[0]!.label).toBe('Move entity')
  })

  it('rejects fractions, odd rail steps and missing entities', () => {
    const start = blueprint([{ name: 'straight-rail', position: { x: 1, y: 1 } }])
    const args = { path: [], indexes: [0], lookup }
    expect(execute(start, emptyHistory(), moveEntities, { ...args, dx: 0.5, dy: 0 }).ok).toBe(false)
    expect(execute(start, emptyHistory(), moveEntities, { ...args, dx: 1, dy: 0 }).ok).toBe(false)
    expect(execute(start, emptyHistory(), moveEntities, { ...args, dx: 2, dy: -4 }).ok).toBe(true)
    expect(
      execute(start, emptyHistory(), moveEntities, { ...args, indexes: [3], dx: 2, dy: 0 }).ok
    ).toBe(false)
  })

  it('adds no step for a zero move', () => {
    const start = blueprint([{ name: 'iron-chest', position: { x: 0.5, y: 0.5 } }])
    const result = ok(execute(start, emptyHistory(), moveEntities, { ...sel(start), dx: 0, dy: 0 }))
    expect(result.changed).toBe(false)
  })
})

describe('rotationPivot', () => {
  const boxes: Box[] = []
  for (const left of [0, 0.5, 1, -3])
    for (const top of [0, 0.5, 2])
      for (const w of [1, 2, 3, 4])
        for (const h of [1, 2, 3]) boxes.push({ left, top, right: left + w, bottom: top + h })

  const turnBox = (b: Box, turn: 'cw' | 'ccw', rail: boolean): Box => {
    const p = rotationPivot(b, turn, rail)
    const corners = [
      [b.left, b.top],
      [b.right, b.bottom]
    ].map(([x, y]) => {
      const dx = x! - p.x
      const dy = y! - p.y
      return turn === 'cw' ? { x: p.x - dy, y: p.y + dx } : { x: p.x + dy, y: p.y - dx }
    })
    return {
      left: Math.min(corners[0]!.x, corners[1]!.x),
      top: Math.min(corners[0]!.y, corners[1]!.y),
      right: Math.max(corners[0]!.x, corners[1]!.x),
      bottom: Math.max(corners[0]!.y, corners[1]!.y)
    }
  }

  it.each(boxes.filter((b) => Number.isInteger(b.left) && Number.isInteger(b.top)))(
    'keeps tiles on the grid, and ccw undoes cw (%o)',
    (box) => {
      for (const rail of [false, true]) {
        const cw = turnBox(box, 'cw', rail)
        for (const v of [cw.left, cw.top]) expect(Number.isInteger(v)).toBe(true)
        expect(turnBox(cw, 'ccw', rail)).toEqual(box)
        expect(turnBox(turnBox(box, 'ccw', rail), 'cw', rail)).toEqual(box)
      }
      let b = box
      for (let i = 0; i < 4; i++) b = turnBox(b, 'cw', false)
      expect(b).toEqual(box)
      for (let i = 0; i < 4; i++) b = turnBox(b, 'ccw', false)
      expect(b).toEqual(box)
    }
  )

  it('uses a whole point with an even sum for rails', () => {
    for (const box of boxes) {
      const p = rotationPivot(box, 'cw', true)
      expect(Number.isInteger(p.x) && Number.isInteger(p.y)).toBe(true)
      expect(Math.abs((p.x + p.y) % 2)).toBe(0)
    }
  })

  it('mirrors rails across a whole line, the same one twice', () => {
    const box = { left: 0, top: 0, right: 3, bottom: 5 }
    expect(mirrorPivot(box, false)).toEqual({ x: 1.5, y: 2.5 })
    expect(mirrorPivot(box, true)).toEqual({ x: 2, y: 2 })
    // Mirrored across x = 2, the box becomes 1..4, centre 2.5 → the same line.
    expect(mirrorPivot({ left: 1, top: 0, right: 4, bottom: 5 }, true).x).toBe(2)
  })
})

describe('rotateEntities', () => {
  it('turns directions, moves fixed entities and keeps north implicit', () => {
    const start = blueprint([
      { name: 'assembling-machine-2', position: { x: 1.5, y: 1.5 } },
      { name: 'iron-chest', position: { x: 3.5, y: 0.5 } },
      { name: 'transport-belt', position: { x: 3.5, y: 2.5 }, direction: 12 },
      { name: 'stone-furnace', position: { x: 0, y: 4 } }
    ])
    const { envelope } = run(start, [
      [rotateEntities as Command<never>, { ...sel(start), turn: 'cw' }]
    ])
    const [assembler, chest, belt, furnace] = entitiesOf(envelope)
    expect(assembler!.direction).toBe(4)
    expect(chest).not.toHaveProperty('direction')
    expect(belt).not.toHaveProperty('direction') // west + 90° = north
    expect(furnace).not.toHaveProperty('direction')
    // The box is -1..4 × 0..5, so the pivot is its centre 1.5, 2.5.
    expect(assembler!.position).toEqual({ x: 2.5, y: 2.5 })
    expect(chest!.position).toEqual({ x: 3.5, y: 4.5 })
  })

  it('returns to the start after four turns and after cw then ccw', () => {
    const start = blueprint([
      { name: 'splitter', position: { x: 1, y: 0.5 } },
      { name: 'iron-chest', position: { x: 0.5, y: 1.5 } }
    ])
    const s = sel(start)
    const cw = [rotateEntities as Command<never>, { ...s, turn: 'cw' }] as [Command<never>, object]
    const ccw = [rotateEntities as Command<never>, { ...s, turn: 'ccw' }] as [
      Command<never>,
      object
    ]
    expect(entitiesOf(run(start, [cw, cw, cw, cw]).envelope)).toEqual(entitiesOf(start))
    expect(entitiesOf(run(start, [cw, ccw]).envelope)).toEqual(entitiesOf(start))
    expect(entitiesOf(run(start, [ccw, ccw, ccw, ccw]).envelope)).toEqual(entitiesOf(start))
  })

  it('writes rail directions the way the game does', () => {
    const start = blueprint([
      { name: 'straight-rail', position: { x: 1, y: 1 }, direction: 6 },
      { name: 'curved-rail-a', position: { x: 4, y: 3 }, direction: 14 }
    ])
    const { envelope } = run(start, [
      [rotateEntities as Command<never>, { ...sel(start), turn: 'cw' }]
    ])
    const [straight, curve] = entitiesOf(envelope)
    expect(straight!.direction).toBe(2) // 10, the same piece as 2
    expect(curve!.direction).toBe(2)
    // Still on the rail grid: straight rails on odd points, curves on mixed ones.
    expect(Math.abs(straight!.position.x % 2)).toBe(1)
    expect(Math.abs(straight!.position.y % 2)).toBe(1)
    expect(Math.abs((curve!.position.x + curve!.position.y) % 2)).toBe(1)
  })

  it('turns rolling stock by its orientation', () => {
    const start = blueprint([
      { name: 'locomotive', position: { x: 45.5625, y: 3 }, orientation: 0.75 }
    ])
    const { envelope } = run(start, [
      [rotateEntities as Command<never>, { ...sel(start), turn: 'cw' }]
    ])
    expect(entitiesOf(envelope)[0]).toMatchObject({ orientation: 0 })
    expect(entitiesOf(envelope)[0]).not.toHaveProperty('direction')
  })
})

describe('mirrorEntities', () => {
  it('flips positions and directions, and sets mirror where the prototype uses it', () => {
    const start = blueprint([
      { name: 'oil-refinery', position: { x: 2.5, y: 2.5 }, direction: 4 },
      { name: 'inserter', position: { x: 5.5, y: 0.5 }, direction: 4 },
      { name: 'iron-chest', position: { x: 5.5, y: 4.5 } },
      { name: 'assembling-machine-2', position: { x: 8.5, y: 2.5 }, direction: 4 }
    ])
    const { envelope } = run(start, [
      [mirrorEntities as Command<never>, { ...sel(start), axis: 'horizontal' }]
    ])
    const [refinery, inserter, chest, assembler] = entitiesOf(envelope)
    expect(refinery).toMatchObject({ position: { x: 7.5, y: 2.5 }, direction: 12, mirror: true })
    expect(inserter).toMatchObject({ position: { x: 4.5, y: 0.5 }, direction: 12, mirror: true })
    expect(chest).toEqual({ entity_number: 3, name: 'iron-chest', position: { x: 4.5, y: 4.5 } })
    expect(assembler).toMatchObject({ position: { x: 1.5, y: 2.5 }, direction: 12 })
    expect(assembler).not.toHaveProperty('mirror')
  })

  it('turns a vertical mirror into a mirror plus a half turn', () => {
    const start = blueprint([{ name: 'oil-refinery', position: { x: 2.5, y: 2.5 } }])
    const { envelope } = run(start, [
      [mirrorEntities as Command<never>, { ...sel(start), axis: 'vertical' }]
    ])
    expect(entitiesOf(envelope)[0]).toMatchObject({ direction: 8, mirror: true })
  })

  it('swaps splitter priorities and moves signals to the other side', () => {
    const start = blueprint([
      {
        name: 'splitter',
        position: { x: 1, y: 0.5 },
        input_priority: 'left',
        output_priority: 'right'
      },
      { name: 'rail-signal', position: { x: 2.5, y: 4.5 } },
      { name: 'curved-rail-a', position: { x: 6, y: 5 } },
      { name: 'straight-rail', position: { x: 4, y: 4 }, direction: 2 }
    ])
    const { envelope } = run(start, [
      [mirrorEntities as Command<never>, { ...sel(start), axis: 'horizontal' }]
    ])
    const [splitter, signal, curve, straight] = entitiesOf(envelope)
    expect(splitter).toMatchObject({ input_priority: 'right', output_priority: 'left' })
    expect(signal!.direction).toBe(8)
    expect(curve!.direction).toBe(2)
    expect(straight!.direction).toBe(6)
  })

  it('mirrors rolling stock orientation', () => {
    const start = blueprint([{ name: 'locomotive', position: { x: 1, y: 3 }, orientation: 0.125 }])
    const h = run(start, [
      [mirrorEntities as Command<never>, { ...sel(start), axis: 'horizontal' }]
    ])
    expect(entitiesOf(h.envelope)[0]!.orientation).toBe(0.875)
    const v = run(start, [[mirrorEntities as Command<never>, { ...sel(start), axis: 'vertical' }]])
    expect(entitiesOf(v.envelope)[0]!.orientation).toBe(0.375)
  })

  it('returns to the start when mirrored twice', () => {
    const start = blueprint([
      { name: 'oil-refinery', position: { x: 2.5, y: 2.5 }, direction: 4 },
      { name: 'straight-rail', position: { x: 7, y: 7 }, direction: 2 },
      { name: 'rail-chain-signal', position: { x: 8.5, y: 5.5 }, direction: 14 }
    ])
    for (const axis of ['horizontal', 'vertical']) {
      const m = [mirrorEntities as Command<never>, { ...sel(start), axis }] as [
        Command<never>,
        object
      ]
      expect(entitiesOf(run(start, [m, m]).envelope)).toEqual(entitiesOf(start))
    }
  })
})

describe('deleteEntities', () => {
  const start = blueprint(
    [
      { name: 'small-electric-pole', position: { x: 0.5, y: 0.5 } },
      { name: 'small-electric-pole', position: { x: 5.5, y: 0.5 } },
      { name: 'locomotive', position: { x: 10, y: 3 }, orientation: 0 },
      { name: 'cargo-wagon', position: { x: 10, y: 10 }, orientation: 0 }
    ],
    {
      wires: [
        [1, 5, 2, 5],
        [2, 1, 1, 1]
      ],
      schedules: [{ locomotives: [3], schedule: { records: [] } }],
      stock_connections: [
        { stock: 3, back: 4 },
        { stock: 4, front: 3 }
      ]
    }
  )

  it('removes the entities and the wires, schedules and couplings that name them', () => {
    const { envelope, history } = run(start, [
      [deleteEntities as Command<never>, { path: [], indexes: [0, 2], lookup }]
    ])
    const bp = envelope['blueprint'] as JsonObject
    expect(entitiesOf(envelope).map((e) => e.entity_number)).toEqual([2, 4])
    expect(bp).not.toHaveProperty('wires')
    expect(bp).not.toHaveProperty('schedules')
    expect(bp['stock_connections']).toEqual([{ stock: 4 }])
    expect(history.undo[0]!.label).toBe('Delete 2 entities')
    const back = undo(envelope, history)!
    expect(encode(back.envelope)).toBe(encode(start))
  })

  it('drops the entities key when nothing is left', () => {
    const { envelope } = run(start, [[deleteEntities as Command<never>, sel(start)]])
    expect(envelope['blueprint']).not.toHaveProperty('entities')
  })
})
