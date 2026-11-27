import { describe, expect, it } from 'vitest'
import { decode, rootKind } from '@core/codec'
import {
  blueprintWires,
  defaultPath,
  findAll,
  formatIssuePath,
  getNode,
  validateEnvelope,
  wireColor,
  type Blueprint
} from '@core/model'
import { directionOf, isOnGrid } from '@core/geometry'
import { loadCorpus } from './corpus'

const corpus = loadCorpus().map((file) => ({ ...file, envelope: decode(file.text) }))
const isLegacy = (name: string): boolean => name.startsWith('legacy-1.1/')

describe.each(corpus)('$name', ({ name, envelope }) => {
  it('validates without issues', () => {
    const issues = validateEnvelope(envelope).map(
      (i) => `${i.severity} ${formatIssuePath(i.path)}: ${i.message}`
    )
    expect(issues).toEqual([])
  })

  it('every node is reachable by its path', () => {
    for (const kind of [
      'blueprint',
      'blueprint_book',
      'deconstruction_planner',
      'upgrade_planner'
    ] as const) {
      for (const node of findAll(envelope, kind)) {
        expect(getNode(envelope, node.path)?.payload).toBe(node.payload)
      }
    }
  })

  it('has a default path that resolves', () => {
    const path = defaultPath(envelope)
    const node = getNode(envelope, path)
    expect(node).toBeDefined()
    if (rootKind(envelope) === 'blueprint_book' && findAll(envelope, 'blueprint').length > 0) {
      expect(node!.kind).not.toBe('blueprint_book')
    }
  })

  it.skipIf(isLegacy(name))(
    'wire connectors pair up by colour (confirms the connector ids)',
    () => {
      for (const node of findAll(envelope, 'blueprint')) {
        for (const wire of blueprintWires(node.payload as Blueprint)) {
          expect(wireColor(wire.a.connector)).not.toBeNull()
          expect(wireColor(wire.a.connector)).toBe(wireColor(wire.b.connector))
        }
      }
    }
  )
})

describe('corpus-wide facts used by geometry', () => {
  it('cardinal-only entities sit on the tile grid for their size', () => {
    // Sizes of a few vanilla entities, to check snapCenter/isOnGrid against real data.
    const sizes: Record<string, { width: number; height: number }> = {
      roboport: { width: 4, height: 4 },
      'big-electric-pole': { width: 2, height: 2 },
      substation: { width: 2, height: 2 },
      'medium-electric-pole': { width: 1, height: 1 },
      'assembling-machine-3': { width: 3, height: 3 },
      'oil-refinery': { width: 5, height: 5 },
      'transport-belt': { width: 1, height: 1 }
    }
    let checked = 0
    for (const { name, envelope } of corpus) {
      if (isLegacy(name)) continue
      for (const node of findAll(envelope, 'blueprint')) {
        for (const entity of (node.payload as Blueprint).entities ?? []) {
          const size = sizes[entity.name]
          if (!size) continue
          expect(isOnGrid(entity.position, size), `${name}: ${entity.name}`).toBe(true)
          expect(directionOf(entity) % 4).toBe(0)
          checked++
        }
      }
    }
    expect(checked).toBeGreaterThan(400)
  })
})
