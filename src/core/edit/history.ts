import { applyPatches, enablePatches, produce, produceWithPatches, type Patch } from 'immer'
import type { BlueprintEnvelope } from '../codec'
import type { BookPath } from '../model'
import { CommandRejected, type Command } from './command'
import { newInvariantProblem } from './invariants'

/**
 * Undo/redo per document with Immer patches. See docs/spec/05-editing.md § Undo history.
 *
 * Everything here is immutable: each call returns a new envelope and history.
 * Envelopes stay frozen (Immer's auto-freeze); edits copy only the changed path.
 */

enablePatches()

/** Undo steps kept per document. Older steps are dropped. */
export const HISTORY_LIMIT = 200
/** Edits with the same merge key closer together than this merge into one step. */
export const MERGE_WINDOW_MS = 1000

export interface HistoryEntry {
  /** Unique within its history, increasing. 0 is reserved for "no edits". */
  readonly id: number
  readonly label: string
  readonly patches: readonly Patch[]
  readonly inverse: readonly Patch[]
  /** The blueprint shown when the edit was made; undo and redo go back to it. */
  readonly activePath: readonly number[]
  readonly mergeKey?: string
  /** When the edit was made (ms), for merging. */
  readonly time: number
  /** Key order of objects that gained or lost keys, before and after the edit (see `KeyOrder`). */
  readonly orderBefore: readonly KeyOrder[]
  readonly orderAfter: readonly KeyOrder[]
}

/**
 * Immer's inverse of removing an object key is an `add`, which appends the key.
 * Undoing "clear the label" would then move `label` to the end of the blueprint,
 * breaking the lossless round-trip (02 § Round-trip guarantee). So each step
 * records the key order of every object whose keys it adds or removes, and
 * undo/redo restore it.
 */
export interface KeyOrder {
  readonly path: readonly (string | number)[]
  readonly keys: readonly string[]
}

export interface History {
  readonly undo: readonly HistoryEntry[]
  readonly redo: readonly HistoryEntry[]
  /** Id of the top undo entry when the document was last saved; 0 = as imported. */
  readonly cleanId: number
  readonly nextId: number
}

export function emptyHistory(): History {
  return { undo: [], redo: [], cleanId: 0, nextId: 1 }
}

/** Whether the document differs from its last saved (or imported) state. */
export function isDirty(history: History): boolean {
  return (history.undo.at(-1)?.id ?? 0) !== history.cleanId
}

/** Records the current state as saved (after an export of the whole document). */
export function markClean(history: History): History {
  return { ...history, cleanId: history.undo.at(-1)?.id ?? 0 }
}

export interface ExecuteOptions {
  /** The blueprint shown in the editor; stored with the step. */
  activePath?: BookPath
  /** Current time in ms (tests pass it); defaults to `Date.now()`. */
  now?: number
}

export type ExecuteResult =
  | {
      ok: true
      /** `false` when the command changed nothing; no undo step is added. */
      changed: boolean
      envelope: BlueprintEnvelope
      history: History
      /** Forward patches of this edit alone (the canvas redraws from them). */
      patches: readonly Patch[]
      warnings: string[]
    }
  | { ok: false; message: string }

/** Runs a command and records it as an undo step. */
export function execute<A>(
  envelope: BlueprintEnvelope,
  history: History,
  command: Command<A>,
  args: A,
  options: ExecuteOptions = {}
): ExecuteResult {
  let warnings: string[] = []
  let next: BlueprintEnvelope
  let patches: Patch[]
  let inverse: Patch[]
  try {
    ;[next, patches, inverse] = produceWithPatches(envelope, (draft) => {
      warnings = command.run(draft as BlueprintEnvelope, args)?.warnings ?? []
    })
  } catch (error) {
    if (error instanceof CommandRejected) return { ok: false, message: error.message }
    throw error
  }
  if (patches.length === 0)
    return { ok: true, changed: false, envelope, history, patches: [], warnings }

  const problem = newInvariantProblem(envelope, next, patches)
  if (problem !== undefined) return { ok: false, message: problem }

  const now = options.now ?? Date.now()
  const mergeKey = command.mergeKey?.(args)
  const top = history.undo.at(-1)
  const merge =
    mergeKey !== undefined &&
    top?.mergeKey === mergeKey &&
    top.id !== history.cleanId &&
    now - top.time <= MERGE_WINDOW_MS
  const orderBefore = keyOrders(envelope, patches)
  const orderAfter = keyOrders(next, patches)
  const entry: HistoryEntry = {
    id: history.nextId,
    label: command.label(args),
    patches: merge ? [...top.patches, ...patches] : patches,
    inverse: merge ? [...inverse, ...top.inverse] : inverse,
    activePath: [...(options.activePath ?? [])],
    time: now,
    // A merged step goes from the state before `top` to the state after this edit.
    orderBefore: merge ? unionOrders(top.orderBefore, orderBefore) : orderBefore,
    orderAfter: merge ? unionOrders(orderAfter, top.orderAfter) : orderAfter,
    ...(mergeKey === undefined ? {} : { mergeKey })
  }
  const kept = merge ? history.undo.slice(0, -1) : history.undo
  return {
    ok: true,
    changed: true,
    envelope: next,
    history: {
      undo: [...kept, entry].slice(-HISTORY_LIMIT),
      redo: [],
      cleanId: history.cleanId,
      nextId: history.nextId + 1
    },
    patches,
    warnings
  }
}

export interface StepResult {
  envelope: BlueprintEnvelope
  history: History
  /** The step that was undone or redone. */
  entry: HistoryEntry
  /** The patches applied (inverse ones for undo). */
  patches: readonly Patch[]
}

/** Undoes the last step, or returns `undefined` if there is none. */
export function undo(envelope: BlueprintEnvelope, history: History): StepResult | undefined {
  const entry = history.undo.at(-1)
  if (!entry) return undefined
  return {
    envelope: restoreKeyOrder(applyPatches(envelope, entry.inverse as Patch[]), entry.orderBefore),
    history: { ...history, undo: history.undo.slice(0, -1), redo: [...history.redo, entry] },
    entry,
    patches: entry.inverse
  }
}

/** Redoes the last undone step, or returns `undefined` if there is none. */
export function redo(envelope: BlueprintEnvelope, history: History): StepResult | undefined {
  const entry = history.redo.at(-1)
  if (!entry) return undefined
  return {
    envelope: restoreKeyOrder(applyPatches(envelope, entry.patches as Patch[]), entry.orderAfter),
    history: { ...history, undo: [...history.undo, entry], redo: history.redo.slice(0, -1) },
    entry,
    patches: entry.patches
  }
}

type PathKey = string | number

function valueAt(root: unknown, path: readonly PathKey[]): unknown {
  let value: unknown = root
  for (const key of path) {
    if (value === null || typeof value !== 'object') return undefined
    value = (value as Record<PathKey, unknown>)[key]
  }
  return value
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/** Key order, in `state`, of each object that an add or remove patch changes. */
function keyOrders(state: unknown, patches: readonly Patch[]): KeyOrder[] {
  const orders = new Map<string, KeyOrder>()
  for (const patch of patches) {
    if (patch.op === 'replace' || patch.path.length === 0) continue
    const path = patch.path.slice(0, -1)
    const id = JSON.stringify(path)
    if (orders.has(id)) continue
    const parent = valueAt(state, path)
    if (isPlainObject(parent)) orders.set(id, { path, keys: Object.keys(parent) })
  }
  return [...orders.values()]
}

/** Orders from `first`, plus those of `second` for paths `first` lacks. */
function unionOrders(first: readonly KeyOrder[], second: readonly KeyOrder[]): KeyOrder[] {
  const ids = new Set(first.map((o) => JSON.stringify(o.path)))
  return [...first, ...second.filter((o) => !ids.has(JSON.stringify(o.path)))]
}

/** Rebuilds objects whose keys came back in another order. Same key set only. */
function restoreKeyOrder(
  envelope: BlueprintEnvelope,
  orders: readonly KeyOrder[]
): BlueprintEnvelope {
  const wrong = orders.filter((order) => {
    const parent = valueAt(envelope, order.path)
    if (!isPlainObject(parent)) return false
    const keys = Object.keys(parent)
    if (keys.length !== order.keys.length || !order.keys.every((k) => k in parent)) return false
    return keys.some((k, i) => k !== order.keys[i])
  })
  if (wrong.length === 0) return envelope
  return produce(envelope, (draft) => {
    for (const order of wrong) {
      const parent = valueAt(draft, order.path) as Record<string, unknown>
      const values = order.keys.map((k) => parent[k])
      for (const k of order.keys) delete parent[k]
      order.keys.forEach((k, i) => {
        parent[k] = values[i]
      })
    }
  })
}
