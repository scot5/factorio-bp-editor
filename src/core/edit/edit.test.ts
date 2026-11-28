import { describe, expect, it } from 'vitest'
import { type BlueprintEnvelope, type JsonObject } from '../codec'
import { getNode, type BookPath } from '../model'
import {
  CommandRejected,
  defineCommand,
  emptyHistory,
  execute,
  HISTORY_LIMIT,
  isDirty,
  markClean,
  MERGE_WINDOW_MS,
  redo,
  setDescription,
  setLabel,
  undo,
  type ExecuteResult,
  type History
} from '.'

const book = (): BlueprintEnvelope => ({
  blueprint_book: {
    item: 'blueprint-book',
    label: 'Book',
    blueprints: [
      {
        index: 0,
        blueprint: {
          item: 'blueprint',
          label: 'First',
          entities: [
            { entity_number: 1, name: 'iron-chest', position: { x: 0.5, y: 0.5 } },
            { entity_number: 2, name: 'iron-chest', position: { x: 1.5, y: 0.5 } }
          ],
          unknown_future_field: { kept: true },
          version: 562954250027018
        }
      },
      {
        index: 1,
        blueprint: {
          item: 'blueprint',
          entities: [
            { entity_number: 1, name: 'iron-chest', position: { x: 0.5, y: 0.5 } },
            { entity_number: 1, name: 'iron-chest', position: { x: 2.5, y: 0.5 } }
          ],
          version: 562954250027018
        }
      }
    ],
    active_index: 0,
    version: 562954250027018
  }
})

function ok(result: ExecuteResult): Extract<ExecuteResult, { ok: true }> {
  if (!result.ok) throw new Error(`unexpected rejection: ${result.message}`)
  return result
}

const payload = (envelope: BlueprintEnvelope, path: BookPath): JsonObject =>
  getNode(envelope, path)!.payload

/** Test command: set an entity's number in the blueprint at `path`. */
const setNumber = defineCommand<{ path: BookPath; entity: number; value: unknown }>({
  name: 'setNumber',
  label: () => 'Set number',
  run(draft, { path, entity, value }) {
    const entities = getNode(draft, path)!.payload['entities'] as JsonObject[]
    entities[entity]!['entity_number'] = value as number
  }
})

/** Test command: remove a book slot by array position. */
const removeSlot = defineCommand<number>({
  name: 'removeSlot',
  label: () => 'Remove slot',
  run(draft, position) {
    const slots = (draft as { blueprint_book: JsonObject }).blueprint_book[
      'blueprints'
    ] as JsonObject[]
    slots.splice(position, 1)
  }
})

describe('execute, undo and redo', () => {
  it('applies a command, records it, and undoes and redoes it', () => {
    const start = book()
    const result = ok(execute(start, emptyHistory(), setLabel, { path: [0], text: 'Renamed' }))
    expect(result.changed).toBe(true)
    expect(payload(result.envelope, [0])['label']).toBe('Renamed')
    expect(payload(start, [0])['label']).toBe('First')
    expect(result.history.undo.map((e) => e.label)).toEqual(['Set label'])
    expect(result.patches).toEqual([
      {
        op: 'replace',
        path: ['blueprint_book', 'blueprints', 0, 'blueprint', 'label'],
        value: 'Renamed'
      }
    ])

    const undone = undo(result.envelope, result.history)!
    expect(payload(undone.envelope, [0])['label']).toBe('First')
    expect(undone.history.undo).toHaveLength(0)
    expect(undone.history.redo).toHaveLength(1)
    expect(undone.entry.label).toBe('Set label')

    const redone = redo(undone.envelope, undone.history)!
    expect(payload(redone.envelope, [0])['label']).toBe('Renamed')
    expect(redone.history.undo).toHaveLength(1)
    expect(redone.history.redo).toHaveLength(0)
  })

  it('returns undefined when there is nothing to undo or redo', () => {
    expect(undo(book(), emptyHistory())).toBeUndefined()
    expect(redo(book(), emptyHistory())).toBeUndefined()
  })

  it('shares unchanged parts and keeps the result frozen', () => {
    const start = book()
    const result = ok(execute(start, emptyHistory(), setLabel, { path: [0], text: 'X' }))
    const slots = (e: BlueprintEnvelope): JsonObject[] =>
      (e as { blueprint_book: JsonObject }).blueprint_book['blueprints'] as JsonObject[]
    expect(slots(result.envelope)[1]).toBe(slots(start)[1])
    expect(payload(result.envelope, [0])['entities']).toBe(payload(start, [0])['entities'])
    expect(Object.isFrozen(result.envelope)).toBe(true)
    expect(Object.isFrozen(payload(result.envelope, [0]))).toBe(true)
  })

  it('adds no step for a command that changes nothing', () => {
    const start = book()
    const result = ok(execute(start, emptyHistory(), setLabel, { path: [0], text: 'First' }))
    expect(result.changed).toBe(false)
    expect(result.envelope).toBe(start)
    expect(result.history.undo).toHaveLength(0)
  })

  it('clears the redo stack on a new edit', () => {
    const a = ok(execute(book(), emptyHistory(), setLabel, { path: [0], text: 'A' }))
    const undone = undo(a.envelope, a.history)!
    const b = ok(execute(undone.envelope, undone.history, setDescription, { path: [0], text: 'B' }))
    expect(b.history.redo).toHaveLength(0)
    expect(b.history.undo.map((e) => e.label)).toEqual(['Set description'])
  })

  it('stores the active path with each step', () => {
    const result = ok(
      execute(book(), emptyHistory(), setLabel, { path: [], text: 'B' }, { activePath: [1] })
    )
    expect(result.history.undo[0]!.activePath).toEqual([1])
  })

  it('passes command warnings through', () => {
    const warn = defineCommand<null>({
      name: 'warn',
      label: () => 'Warn',
      run(draft) {
        ;(draft as { blueprint_book: JsonObject }).blueprint_book['label'] = 'W'
        return { warnings: ['careful'] }
      }
    })
    expect(ok(execute(book(), emptyHistory(), warn, null)).warnings).toEqual(['careful'])
  })
})

describe('rejection', () => {
  it('rejects when the command throws CommandRejected, leaving everything as it was', () => {
    const start = book()
    const result = execute(start, emptyHistory(), setLabel, { path: [7], text: 'X' })
    expect(result).toEqual({ ok: false, message: 'That book slot no longer exists.' })
  })

  it('rethrows other errors', () => {
    const broken = defineCommand<null>({
      name: 'broken',
      label: () => 'Broken',
      run() {
        throw new TypeError('bug')
      }
    })
    expect(() => execute(book(), emptyHistory(), broken, null)).toThrow(TypeError)
  })

  it('rejects an edit that adds a duplicate entity_number', () => {
    const result = execute(book(), emptyHistory(), setNumber, { path: [0], entity: 1, value: 1 })
    expect(result).toEqual({ ok: false, message: 'Duplicate entity_number 1' })
  })

  it('rejects an invalid entity_number', () => {
    for (const value of [0, -1, 1.5, '3']) {
      const result = execute(book(), emptyHistory(), setNumber, { path: [0], entity: 1, value })
      expect(result.ok).toBe(false)
    }
  })

  it('allows edits to a blueprint that was imported with a duplicate', () => {
    const start = book()
    // Slot 1 already has entity_number 1 twice. Renumbering one of the pair is fine,
    // and so is an unrelated edit in the same blueprint.
    expect(execute(start, emptyHistory(), setNumber, { path: [1], entity: 1, value: 2 }).ok).toBe(
      true
    )
    expect(execute(start, emptyHistory(), setLabel, { path: [1], text: 'Still broken' }).ok).toBe(
      true
    )
  })

  it('allows removing a book slot next to one with an imported duplicate', () => {
    const result = ok(execute(book(), emptyHistory(), removeSlot, 0))
    expect(payload(result.envelope, [1])['label']).toBeUndefined()
  })
})

describe('merging', () => {
  type Done = ReturnType<typeof ok>
  const type = (history: History, envelope: BlueprintEnvelope, text: string, now: number): Done =>
    ok(execute(envelope, history, setLabel, { path: [0], text }, { now }))

  it('merges consecutive edits with the same key inside the window', () => {
    const a = type(emptyHistory(), book(), 'F', 0)
    const b = type(a.history, a.envelope, 'Fo', 100)
    const c = type(b.history, b.envelope, 'Foo', 100 + MERGE_WINDOW_MS)
    expect(c.history.undo).toHaveLength(1)
    expect(c.patches).toHaveLength(1)
    const undone = undo(c.envelope, c.history)!
    expect(payload(undone.envelope, [0])['label']).toBe('First')
    const redone = redo(undone.envelope, undone.history)!
    expect(payload(redone.envelope, [0])['label']).toBe('Foo')
  })

  it('does not merge after the window, across keys, or into the saved step', () => {
    const a = type(emptyHistory(), book(), 'A', 0)
    const late = type(a.history, a.envelope, 'AB', MERGE_WINDOW_MS + 1)
    expect(late.history.undo).toHaveLength(2)

    const other = ok(
      execute(a.envelope, a.history, setLabel, { path: [1], text: 'Other' }, { now: 10 })
    )
    expect(other.history.undo).toHaveLength(2)

    const saved = markClean(a.history)
    const afterSave = type(saved, a.envelope, 'AB', 10)
    expect(afterSave.history.undo).toHaveLength(2)
    expect(isDirty(afterSave.history)).toBe(true)
  })
})

describe('dirty state and limits', () => {
  it('is clean as imported, dirty after an edit, clean again after undo', () => {
    expect(isDirty(emptyHistory())).toBe(false)
    const a = ok(execute(book(), emptyHistory(), setLabel, { path: [0], text: 'A' }))
    expect(isDirty(a.history)).toBe(true)
    expect(isDirty(undo(a.envelope, a.history)!.history)).toBe(false)
  })

  it('tracks the saved point through undo and redo', () => {
    const a = ok(execute(book(), emptyHistory(), setLabel, { path: [0], text: 'A' }, { now: 0 }))
    const saved = markClean(a.history)
    expect(isDirty(saved)).toBe(false)
    const undone = undo(a.envelope, saved)!
    expect(isDirty(undone.history)).toBe(true)
    expect(isDirty(redo(undone.envelope, undone.history)!.history)).toBe(false)
  })

  it(`keeps at most ${HISTORY_LIMIT} steps`, () => {
    let envelope = book()
    let history = emptyHistory()
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) {
      const now = i * (MERGE_WINDOW_MS + 1)
      const r = ok(execute(envelope, history, setLabel, { path: [0], text: `L${i}` }, { now }))
      envelope = r.envelope
      history = r.history
    }
    expect(history.undo).toHaveLength(HISTORY_LIMIT)
    expect(history.undo[0]!.id).toBe(6)
    expect(isDirty(history)).toBe(true)
  })
})

describe('setLabel and setDescription', () => {
  it('replaces a label in place, keeping key order and unknown fields', () => {
    const r = ok(execute(book(), emptyHistory(), setLabel, { path: [0], text: 'New' }))
    const bp = payload(r.envelope, [0])
    expect(Object.keys(bp)).toEqual([
      'item',
      'label',
      'entities',
      'unknown_future_field',
      'version'
    ])
    expect(bp['unknown_future_field']).toEqual({ kept: true })
  })

  it('removes the key for empty text and adds it at the end when missing', () => {
    const removed = ok(execute(book(), emptyHistory(), setLabel, { path: [0], text: '' }))
    expect('label' in payload(removed.envelope, [0])).toBe(false)
    const added = ok(execute(book(), emptyHistory(), setDescription, { path: [1], text: 'Hi' }))
    expect(Object.keys(payload(added.envelope, [1])).at(-1)).toBe('description')
  })

  it('puts a removed key back in its place on undo, and keeps redo order too', () => {
    const keys = ['item', 'label', 'entities', 'unknown_future_field', 'version']
    const removed = ok(execute(book(), emptyHistory(), setLabel, { path: [0], text: '' }))
    const undone = undo(removed.envelope, removed.history)!
    expect(Object.keys(payload(undone.envelope, [0]))).toEqual(keys)
    expect(Object.isFrozen(payload(undone.envelope, [0]))).toBe(true)
    // Unchanged siblings are still shared after the reorder.
    expect(payload(undone.envelope, [0])['entities']).toBe(
      payload(removed.envelope, [0])['entities']
    )

    const added = ok(execute(book(), emptyHistory(), setDescription, { path: [0], text: 'D' }))
    const back = undo(added.envelope, added.history)!
    const again = redo(back.envelope, back.history)!
    expect(Object.keys(payload(again.envelope, [0]))).toEqual([...keys, 'description'])
  })

  it('keeps key order when a merged step removes and re-adds a key', () => {
    const start = book()
    const a = ok(execute(start, emptyHistory(), setLabel, { path: [0], text: '' }, { now: 0 }))
    const b = ok(execute(a.envelope, a.history, setLabel, { path: [0], text: 'Z' }, { now: 1 }))
    expect(b.history.undo).toHaveLength(1)
    const undone = undo(b.envelope, b.history)!
    expect(JSON.stringify(undone.envelope)).toBe(JSON.stringify(start))
    const redone = redo(undone.envelope, undone.history)!
    expect(JSON.stringify(redone.envelope)).toBe(JSON.stringify(b.envelope))
  })

  it('edits the root of a plain blueprint and of a planner', () => {
    const planner: BlueprintEnvelope = {
      upgrade_planner: { item: 'upgrade-planner', settings: {}, version: 1 }
    }
    const r = ok(execute(planner, emptyHistory(), setDescription, { path: [], text: 'Hi' }))
    expect(payload(r.envelope, [])['description']).toBe('Hi')
  })

  it('names its steps and merges per item', () => {
    expect(setLabel.label({ path: [], text: '' })).toBe('Set label')
    expect(setLabel.mergeKey!({ path: [2, 1], text: '' })).toBe('setLabel:2/1')
    expect(setDescription.mergeKey!({ path: [], text: '' })).toBe('setDescription:')
  })

  it('rejects a missing path', () => {
    expect(() => {
      throw new CommandRejected('x')
    }).toThrow(CommandRejected)
    expect(execute(book(), emptyHistory(), setDescription, { path: [0, 1], text: 'x' }).ok).toBe(
      false
    )
  })
})
