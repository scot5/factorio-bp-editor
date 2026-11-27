import { describe, expect, it } from 'vitest'
import type { BlueprintEnvelope, JsonObject } from '../codec'
import { bookSlots, defaultPath, findAll, getNode, walk } from './book'
import { formatIssuePath, validateEnvelope } from './validate'
import { toWire, wireColor, wireGraph, wireNetworks, WireConnectorId } from './wires'

const V = 562954250027018
const bp = (label: string, extra: JsonObject = {}): JsonObject => ({
  item: 'blueprint',
  label,
  version: V,
  ...extra
})

// Book with sparse slots: 0, 2 (nested book with slots 1 and 5), 7.
const book: BlueprintEnvelope = {
  blueprint_book: {
    item: 'blueprint-book',
    active_index: 2,
    blueprints: [
      { index: 7, upgrade_planner: { item: 'upgrade-planner', version: V } },
      { index: 0, blueprint: bp('first') },
      {
        index: 2,
        blueprint_book: {
          item: 'blueprint-book',
          active_index: 5,
          blueprints: [
            { index: 5, blueprint: bp('nested five') },
            { index: 1, blueprint: bp('nested one') }
          ],
          version: V
        }
      }
    ],
    version: V
  }
}

const label = (envelope: BlueprintEnvelope, path: number[]): unknown =>
  getNode(envelope, path)?.payload['label']

describe('book navigation', () => {
  it('sorts slots by index, not array position', () => {
    const root = (book as { blueprint_book: JsonObject }).blueprint_book
    expect(bookSlots(root).map((s) => s.index)).toEqual([0, 2, 7])
  })

  it('resolves paths of slot indexes', () => {
    expect(getNode(book, [])?.kind).toBe('blueprint_book')
    expect(label(book, [0])).toBe('first')
    expect(label(book, [2, 5])).toBe('nested five')
    expect(label(book, [2, 1])).toBe('nested one')
    expect(getNode(book, [7])?.kind).toBe('upgrade_planner')
    expect(getNode(book, [1])).toBeUndefined() // empty slot
    expect(getNode(book, [0, 0])).toBeUndefined() // a blueprint has no slots
  })

  it('walks depth-first in index order', () => {
    const order: string[] = []
    walk(book, (node) => {
      order.push(`${node.kind}@${node.path.join('/')}`)
    })
    expect(order).toEqual([
      'blueprint_book@',
      'blueprint@0',
      'blueprint_book@2',
      'blueprint@2/1',
      'blueprint@2/5',
      'upgrade_planner@7'
    ])
  })

  it('can skip a book’s contents', () => {
    const seen: string[] = []
    walk(book, (node) => {
      seen.push(node.path.join('/'))
      return node.path.length === 0 ? undefined : false
    })
    expect(seen).toEqual(['', '0', '2', '7'])
  })

  it('finds all nodes of a kind', () => {
    expect(findAll(book, 'blueprint').map((n) => n.path)).toEqual([[0], [2, 1], [2, 5]])
  })

  it('follows active_index for the default path', () => {
    expect(defaultPath(book)).toEqual([2, 5])
  })

  it('falls back to the first item when active_index points to an empty slot', () => {
    const b = structuredClone(book) as { blueprint_book: JsonObject }
    b.blueprint_book['active_index'] = 3
    expect(defaultPath(b as BlueprintEnvelope)).toEqual([0])
  })

  it('handles a non-book root and an empty book', () => {
    expect(defaultPath({ blueprint: bp('x') })).toEqual([])
    const empty: BlueprintEnvelope = {
      blueprint_book: { item: 'blueprint-book', blueprints: [], active_index: 0, version: V }
    }
    expect(defaultPath(empty)).toEqual([])
    expect(findAll(empty, 'blueprint')).toEqual([])
  })
})

describe('wires', () => {
  it('maps confirmed connector ids to colours', () => {
    expect(wireColor(WireConnectorId.CircuitRed)).toBe('red')
    expect(wireColor(WireConnectorId.CombinatorOutputRed)).toBe('red')
    expect(wireColor(WireConnectorId.CircuitGreen)).toBe('green')
    expect(wireColor(WireConnectorId.CombinatorOutputGreen)).toBe('green')
    expect(wireColor(WireConnectorId.PoleCopper)).toBe('copper')
    expect(wireColor(6)).toBeNull()
  })

  it('builds an adjacency graph and colour networks', () => {
    // 1 —red— 2 —red— 3(combinator input); combinator output 3 —red— 4; 1 —green— 4
    const wires = [
      [1, 1, 2, 1],
      [2, 1, 3, 1],
      [3, 3, 4, 1],
      [1, 2, 4, 2]
    ].map((t, i) => toWire(t as [number, number, number, number], i))

    const graph = wireGraph(wires)
    expect(graph.get(1)?.map((w) => w.index)).toEqual([0, 3])
    expect(graph.get(3)?.map((w) => w.index)).toEqual([1, 2])

    const red = wireNetworks(wires, 'red').map((net) =>
      net.map((e) => `${e.entity}:${e.connector}`).sort()
    )
    // The combinator's input (3:1) and output (3:3) are on different red networks.
    expect(red).toContainEqual(['1:1', '2:1', '3:1'])
    expect(red).toContainEqual(['3:3', '4:1'])
    expect(wireNetworks(wires, 'green')).toHaveLength(1)
  })
})

describe('validateEnvelope', () => {
  const messages = (env: BlueprintEnvelope): string[] =>
    validateEnvelope(env).map((i) => `${formatIssuePath(i.path)}: ${i.message}`)

  it('accepts valid envelopes and unknown fields', () => {
    expect(validateEnvelope(book)).toEqual([])
    expect(validateEnvelope({ blueprint: bp('x', { some_future_field: [1, 2] }) })).toEqual([])
  })

  it('reports schema problems with a JSON path', () => {
    const env: BlueprintEnvelope = {
      blueprint: bp('x', {
        entities: [{ entity_number: 1, name: 'pipe', position: { x: 'a', y: 0 } }]
      })
    }
    expect(messages(env)).toEqual([
      expect.stringMatching(/^blueprint\.entities\[0\]\.position\.x: .*number/i)
    ])
  })

  it('reports duplicate entity numbers as errors', () => {
    const env: BlueprintEnvelope = {
      blueprint: bp('x', {
        entities: [
          { entity_number: 1, name: 'pipe', position: { x: 0.5, y: 0.5 } },
          { entity_number: 1, name: 'pipe', position: { x: 1.5, y: 0.5 } }
        ]
      })
    }
    const issues = validateEnvelope(env)
    expect(issues).toHaveLength(1)
    expect(issues[0]!.severity).toBe('error')
    expect(issues[0]!.message).toBe('Duplicate entity_number 1')
  })

  it('reports wires, schedules and couplings that point to missing entities', () => {
    const env: BlueprintEnvelope = {
      blueprint: bp('x', {
        entities: [{ entity_number: 1, name: 'locomotive', position: { x: 0, y: 0 } }],
        wires: [[1, 1, 9, 1]],
        stock_connections: [{ stock: 1, back: 8 }],
        schedules: [{ locomotives: [7] }]
      })
    }
    expect(messages(env)).toEqual([
      'blueprint.wires[0]: Wire refers to missing entity 9',
      'blueprint.stock_connections[0]: Stock back refers to missing entity 8',
      'blueprint.schedules[0].locomotives: Schedule refers to missing entity 7'
    ])
  })

  it('warns about wires joining different colours', () => {
    const env: BlueprintEnvelope = {
      blueprint: bp('x', {
        entities: [
          { entity_number: 1, name: 'a', position: { x: 0, y: 0 } },
          { entity_number: 2, name: 'b', position: { x: 1, y: 0 } }
        ],
        wires: [[1, 1, 2, 2]]
      })
    }
    const issues = validateEnvelope(env)
    expect(issues.map((i) => [i.severity, i.message])).toEqual([
      ['warning', 'Wire connects a red connector to a green connector']
    ])
  })

  it('reports invalid book slots with the path through the book', () => {
    const env: BlueprintEnvelope = {
      blueprint_book: {
        item: 'blueprint-book',
        blueprints: [
          {
            index: 0,
            blueprint: bp('a'),
            upgrade_planner: { item: 'upgrade-planner', version: V }
          },
          { index: 0, blueprint: bp('b') },
          { index: 1 }
        ],
        version: V
      }
    }
    expect(messages(env)).toEqual([
      'blueprint_book.blueprints[0]: Book slot holds more than one item: blueprint, upgrade_planner',
      'blueprint_book.blueprints[1]: Duplicate book slot index 0',
      'blueprint_book.blueprints[2]: Book slot holds no blueprint, book or planner'
    ])
  })

  it('reports problems inside nested books with the full path', () => {
    const env = structuredClone(book) as { blueprint_book: { blueprints: JsonObject[] } }
    const nested = env.blueprint_book.blueprints[2]!['blueprint_book'] as {
      blueprints: JsonObject[]
    }
    nested.blueprints[0]!['blueprint'] = bp('dup', {
      entities: [
        { entity_number: 3, name: 'pipe', position: { x: 0, y: 0 } },
        { entity_number: 3, name: 'pipe', position: { x: 1, y: 0 } }
      ]
    })
    expect(messages(env as unknown as BlueprintEnvelope)).toEqual([
      'blueprint_book.blueprints[2].blueprint_book.blueprints[0].blueprint.entities[1].entity_number: Duplicate entity_number 3'
    ])
  })

  it('caps the number of issues', () => {
    const entities = Array.from({ length: 50 }, () => ({
      entity_number: 1,
      name: 'pipe',
      position: { x: 0, y: 0 }
    }))
    expect(validateEnvelope({ blueprint: bp('x', { entities }) }, { maxIssues: 10 })).toHaveLength(
      10
    )
  })
})
