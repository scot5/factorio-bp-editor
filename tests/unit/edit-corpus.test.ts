import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { decode, encode, type BlueprintEnvelope } from '@core/codec'
import {
  deleteEntities,
  emptyHistory,
  execute,
  mirrorEntities,
  moveEntities,
  rotateEntities,
  setDescription,
  setLabel,
  undo,
  type Command,
  type History
} from '@core/edit'
import { defaultPath, getNode, type Blueprint } from '@core/model'
import { fallbackPrototypeLookup as lookup } from '@core/prototypes'
import { CORPUS_DIR, loadCorpus } from './corpus'

/**
 * Edits and their undo keep every corpus string lossless
 * (docs/spec/05-editing.md § Undo history, 02 § Round-trip guarantee).
 */

describe.each(loadCorpus())('$name', ({ text }) => {
  it('encodes to the original string again after edits are undone', () => {
    const start = decode(text)
    let envelope = start
    let history = emptyHistory()
    const paths = [[], [...defaultPath(start)]]
    for (const path of paths) {
      for (const command of [setLabel, setDescription]) {
        for (const value of ['Edited [item=iron-plate]', '']) {
          const result = execute(envelope, history, command, { path, text: value })
          if (!result.ok) throw new Error(result.message)
          envelope = result.envelope
          history = result.history
        }
      }
    }
    const bp = getNode(envelope, defaultPath(envelope))
    const count = bp?.kind === 'blueprint' ? ((bp.payload as Blueprint).entities?.length ?? 0) : 0
    if (count > 0) {
      const sel = { path: [...defaultPath(start)], indexes: [...Array(count).keys()], lookup }
      const edits: [Command<never>, object][] = [
        [rotateEntities as Command<never>, { ...sel, turn: 'cw' }],
        [mirrorEntities as Command<never>, { ...sel, axis: 'horizontal' }],
        [moveEntities as Command<never>, { ...sel, dx: 2, dy: -2 }],
        [mirrorEntities as Command<never>, { ...sel, axis: 'vertical' }],
        [rotateEntities as Command<never>, { ...sel, turn: 'ccw' }],
        [deleteEntities as Command<never>, { ...sel, indexes: [0, count - 1] }]
      ]
      for (const [command, args] of edits) {
        const result = execute(envelope, history, command, args as never)
        if (!result.ok) throw new Error(result.message)
        envelope = result.envelope
        history = result.history
      }
    }
    for (let step = undo(envelope, history); step; step = undo(envelope, history)) {
      envelope = step.envelope
      history = step.history
    }
    expect(encode(envelope)).toBe(encode(start))
  })
})

/**
 * The elevated intersection is symmetric: a quarter turn maps every entity onto
 * one of the same kind, and a mirror maps the rails and supports onto
 * themselves. This is the oracle for the rail rules (05 § Rotate and mirror).
 */
describe('elevated_rail_intersection.txt', () => {
  const start = decode(readFileSync(join(CORPUS_DIR, 'elevated_rail_intersection.txt'), 'utf8'))
  const entities = (envelope: BlueprintEnvelope): Blueprint['entities'] & object =>
    (envelope['blueprint'] as unknown as Blueprint).entities ?? []
  const keys = (envelope: BlueprintEnvelope, filter: (name: string) => boolean): string[] =>
    entities(envelope)
      .filter((e) => filter(e.name))
      .map((e) => `${e.name}@${e.position.x},${e.position.y}:${e.direction ?? 0}`)
      .sort((a, b) => a.localeCompare(b))
  const apply = (command: Command<never>, args: object): BlueprintEnvelope => {
    const sel = { path: [], indexes: [...entities(start).keys()], lookup }
    const result = execute(start, emptyHistory() as History, command, { ...sel, ...args } as never)
    if (!result.ok) throw new Error(result.message)
    return result.envelope
  }

  it('maps onto itself when turned a quarter', () => {
    for (const turn of ['cw', 'ccw']) {
      const turned = apply(rotateEntities as Command<never>, { turn })
      expect(keys(turned, (n) => n !== 'roboport' && n !== 'big-electric-pole')).toEqual(
        keys(start, (n) => n !== 'roboport' && n !== 'big-electric-pole')
      )
    }
  })

  it('maps its rails and supports onto themselves when mirrored', () => {
    const rails = (n: string): boolean => /rail|support/.test(n) && !/signal/.test(n)
    for (const axis of ['horizontal', 'vertical']) {
      const mirrored = apply(mirrorEntities as Command<never>, { axis })
      expect(keys(mirrored, rails)).toEqual(keys(start, rails))
    }
  })
})
