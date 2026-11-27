import { ROOT_KINDS, rootKind, rootPayload, type BlueprintEnvelope, type RootKind } from '../codec'
import { isJsonObject, type JsonObject } from '../codec/json'

/**
 * Navigating blueprint books. See docs/spec/02-blueprint-format.md § Top-level envelope.
 *
 * A *path* is a list of book slot `index` values from the root, e.g. [3, 0] is
 * slot 0 of the book in slot 3. Indexes are the slot numbers shown in game,
 * not array positions: books may be sparse (empty slots).
 * The root itself has the path [].
 */

export type BookPath = readonly number[]

export interface EnvelopeNode {
  kind: RootKind
  /** The raw JSON object (blueprint, book or planner). Mutations affect the envelope. */
  payload: JsonObject
  path: BookPath
}

export interface BookSlotEntry {
  index: number
  kind: RootKind
  payload: JsonObject
}

export function rootNode(envelope: BlueprintEnvelope): EnvelopeNode {
  return { kind: rootKind(envelope), payload: rootPayload(envelope), path: [] }
}

/** Which item a book slot holds, or `undefined` if it holds none (invalid slot). */
export function slotKind(slot: JsonObject): RootKind | undefined {
  return ROOT_KINDS.find((kind) => isJsonObject(slot[kind]))
}

/** The slots of a book, sorted by index. Invalid slots are skipped (validation reports them). */
export function bookSlots(book: JsonObject): BookSlotEntry[] {
  const slots = Array.isArray(book['blueprints']) ? book['blueprints'] : []
  const entries: BookSlotEntry[] = []
  for (const slot of slots) {
    if (!isJsonObject(slot) || typeof slot['index'] !== 'number') continue
    const kind = slotKind(slot)
    if (kind) entries.push({ index: slot['index'], kind, payload: slot[kind] as JsonObject })
  }
  return entries.sort((a, b) => a.index - b.index)
}

/** The node at `path`, or `undefined` if the path does not exist. */
export function getNode(envelope: BlueprintEnvelope, path: BookPath): EnvelopeNode | undefined {
  let node: EnvelopeNode = rootNode(envelope)
  for (let depth = 0; depth < path.length; depth++) {
    if (node.kind !== 'blueprint_book') return undefined
    const slot = bookSlots(node.payload).find((s) => s.index === path[depth])
    if (!slot) return undefined
    node = { kind: slot.kind, payload: slot.payload, path: path.slice(0, depth + 1) }
  }
  return node
}

/**
 * Visits every node depth-first, books before their contents, slots in index order.
 * Return `false` from `visit` to skip a book's contents.
 */
export function walk(
  envelope: BlueprintEnvelope,
  visit: (node: EnvelopeNode) => boolean | void
): void {
  const recurse = (node: EnvelopeNode): void => {
    if (visit(node) === false || node.kind !== 'blueprint_book') return
    for (const slot of bookSlots(node.payload)) {
      recurse({ kind: slot.kind, payload: slot.payload, path: [...node.path, slot.index] })
    }
  }
  recurse(rootNode(envelope))
}

/** All nodes of one kind, depth-first. */
export function findAll(envelope: BlueprintEnvelope, kind: RootKind): EnvelopeNode[] {
  const found: EnvelopeNode[] = []
  walk(envelope, (node) => {
    if (node.kind === kind) found.push(node)
  })
  return found
}

/**
 * The path to open by default: the root if it is not a book; otherwise follow
 * each book's `active_index` while it points at a non-empty slot, and fall back
 * to the first non-book item depth-first. Returns [] for an empty book.
 */
export function defaultPath(envelope: BlueprintEnvelope): BookPath {
  let node = rootNode(envelope)
  while (node.kind === 'blueprint_book') {
    const active = node.payload['active_index']
    const slot = bookSlots(node.payload).find((s) => s.index === active)
    if (!slot) break
    node = { kind: slot.kind, payload: slot.payload, path: [...node.path, slot.index] }
  }
  if (node.kind !== 'blueprint_book') return node.path

  let first: BookPath | undefined
  walk(envelope, (n) => {
    if (first) return false
    if (n.kind !== 'blueprint_book') first = n.path
    return undefined
  })
  return first ?? []
}
