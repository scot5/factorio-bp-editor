import type { Blueprint, WireTuple } from './schema'

/**
 * Wire connector ids as written in 2.x blueprint strings.
 * Confirmed from the corpus, see docs/spec/02-blueprint-format.md § Wires.
 * (runtime-api.json's `order` for defines.wire_connector_id is NOT these values.)
 */
export const WireConnectorId = {
  /** Red circuit; for combinators the red input. */
  CircuitRed: 1,
  /** Green circuit; for combinators the green input. */
  CircuitGreen: 2,
  CombinatorOutputRed: 3,
  CombinatorOutputGreen: 4,
  PoleCopper: 5
} as const

export type WireColor = 'red' | 'green' | 'copper'

/** Colour of the wire attached at a connector, or `null` for ids not confirmed yet (e.g. power switch). */
export function wireColor(connector: number): WireColor | null {
  switch (connector) {
    case WireConnectorId.CircuitRed:
    case WireConnectorId.CombinatorOutputRed:
      return 'red'
    case WireConnectorId.CircuitGreen:
    case WireConnectorId.CombinatorOutputGreen:
      return 'green'
    case WireConnectorId.PoleCopper:
      return 'copper'
    default:
      return null
  }
}

export interface WireEnd {
  entity: number
  connector: number
}

export interface Wire {
  /** Index in the blueprint's `wires` array (for editing and round-trip). */
  index: number
  a: WireEnd
  b: WireEnd
  /** From the connectors; `null` when unknown or when both ends disagree. */
  color: WireColor | null
}

export function toWire(tuple: WireTuple, index: number): Wire {
  const [ea, ca, eb, cb] = tuple
  const colorA = wireColor(ca)
  const colorB = wireColor(cb)
  return {
    index,
    a: { entity: ea, connector: ca },
    b: { entity: eb, connector: cb },
    color: colorA !== null && colorA === colorB ? colorA : (colorA ?? colorB)
  }
}

export function blueprintWires(blueprint: Pick<Blueprint, 'wires'>): Wire[] {
  return (blueprint.wires ?? []).map(toWire)
}

/** Adjacency: entity_number → wires touching it (both directions). */
export function wireGraph(wires: readonly Wire[]): Map<number, Wire[]> {
  const graph = new Map<number, Wire[]>()
  const add = (entity: number, wire: Wire): void => {
    const list = graph.get(entity)
    if (list) list.push(wire)
    else graph.set(entity, [wire])
  }
  for (const wire of wires) {
    add(wire.a.entity, wire)
    if (wire.b.entity !== wire.a.entity) add(wire.b.entity, wire)
  }
  return graph
}

/**
 * Circuit or copper networks: groups of connected (entity, connector) ends.
 * Each network is a list of ends; a combinator's input and output are separate ends.
 */
export function wireNetworks(wires: readonly Wire[], color: WireColor): WireEnd[][] {
  const key = (end: WireEnd): string => `${end.entity}:${end.connector}`
  const parent = new Map<string, string>()
  const ends = new Map<string, WireEnd>()
  const find = (k: string): string => {
    let root = k
    while (parent.get(root) !== root) root = parent.get(root)!
    // Path compression.
    let node = k
    while (parent.get(node) !== root) {
      const next = parent.get(node)!
      parent.set(node, root)
      node = next
    }
    return root
  }
  const ensure = (end: WireEnd): string => {
    const k = key(end)
    if (!parent.has(k)) {
      parent.set(k, k)
      ends.set(k, end)
    }
    return k
  }
  for (const wire of wires) {
    if (wire.color !== color) continue
    const ra = find(ensure(wire.a))
    const rb = find(ensure(wire.b))
    if (ra !== rb) parent.set(ra, rb)
  }
  const groups = new Map<string, WireEnd[]>()
  for (const [k, end] of ends) {
    const root = find(k)
    const group = groups.get(root)
    if (group) group.push(end)
    else groups.set(root, [end])
  }
  return [...groups.values()]
}
