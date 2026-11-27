import { describe, expect, it, vi } from 'vitest'

// ipc.ts imports electron at module load; the pure helper does not need it.
vi.mock('electron', () => ({}))

const { sanitizeFileName } = await import('./ipc')

describe('sanitizeFileName', () => {
  it.each([
    ['Outpost Station V 1.9', 'Outpost Station V 1.9.txt'],
    ['[item=requester-chest]Requester', 'Requester.txt'],
    ['[color=124,252,0]☢️ Large - 2.4 GW Nuclear ☢️[/color]', '☢️ Large - 2.4 GW Nuclear ☢️.txt'],
    ['a/b\\c:d*e?f"g<h>i|j', 'abcdefghij.txt'],
    ['', 'blueprint.txt'],
    ['[item=coal]', 'blueprint.txt']
  ])('%j → %j', (input, expected) => {
    expect(sanitizeFileName(input)).toBe(expected)
  })
})
