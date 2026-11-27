import type { JsonObject } from './json'

/** Root keys a blueprint string can have. See docs/spec/02-blueprint-format.md § Top-level envelope. */
export const ROOT_KINDS = [
  'blueprint',
  'blueprint_book',
  'deconstruction_planner',
  'upgrade_planner'
] as const

export type RootKind = (typeof ROOT_KINDS)[number]

/**
 * The decoded JSON of a blueprint string: an object with exactly one root key.
 * The payload is kept as raw JSON here. Typed models are layered on top in
 * src/core/model (task 1.4), so the codec never drops unknown fields.
 */
export type BlueprintEnvelope = { [K in RootKind]: { [P in K]: JsonObject } }[RootKind]

export function isRootKind(key: string): key is RootKind {
  return (ROOT_KINDS as readonly string[]).includes(key)
}

/** The root kind of an envelope (which of the four keys it has). */
export function rootKind(envelope: BlueprintEnvelope): RootKind {
  const key = Object.keys(envelope)[0]
  if (key === undefined || !isRootKind(key)) throw new Error('Invalid envelope')
  return key
}

/** The root payload (the object under the single root key). */
export function rootPayload(envelope: BlueprintEnvelope): JsonObject {
  return (envelope as Record<string, JsonObject>)[rootKind(envelope)]!
}
