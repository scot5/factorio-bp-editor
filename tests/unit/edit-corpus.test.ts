import { describe, expect, it } from 'vitest'
import { decode, encode } from '@core/codec'
import { emptyHistory, execute, setDescription, setLabel, undo } from '@core/edit'
import { defaultPath } from '@core/model'
import { loadCorpus } from './corpus'

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
    for (let step = undo(envelope, history); step; step = undo(envelope, history)) {
      envelope = step.envelope
      history = step.history
    }
    expect(encode(envelope)).toBe(encode(start))
  })
})
