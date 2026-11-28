import type { Patch } from 'immer'
import { isJsonObject, type BlueprintEnvelope, type JsonObject, type JsonValue } from '../codec'

/**
 * Checks that make an edit be rejected rather than applied with a warning:
 * the export would be unreadable to the game (docs/spec/05-editing.md § Principles).
 *
 * Only problems the edit *adds* count, so a blueprint imported with a problem
 * can still be edited. Patches inside one blueprint check that blueprint only;
 * patches above any blueprint (book slots, the root) check the whole envelope,
 * since slot positions may have shifted.
 */

type PathKey = string | number
type Problems = Map<string, number>

/** The first problem `after` has more of than `before`, or `undefined`. */
export function newInvariantProblem(
  before: BlueprintEnvelope,
  after: BlueprintEnvelope,
  patches: readonly Patch[]
): string | undefined {
  const prefixes = new Map<string, PathKey[]>()
  for (const patch of patches) {
    const prefix = blueprintPrefix(patch.path)
    if (prefix === undefined) return added(collect(before, []), collect(after, []))
    prefixes.set(prefix.join('\u0000'), prefix)
  }
  for (const prefix of prefixes.values()) {
    const problem = added(collect(before, prefix), collect(after, prefix))
    if (problem !== undefined) return problem
  }
  return undefined
}

/**
 * The path of the blueprint a patch lies in: the value under a `blueprint` key
 * at the root or in a book slot (right after a slot's array position).
 */
function blueprintPrefix(path: readonly PathKey[]): PathKey[] | undefined {
  for (let i = 0; i < path.length; i++) {
    if (path[i] === 'blueprint' && (i === 0 || typeof path[i - 1] === 'number'))
      return path.slice(0, i + 1)
  }
  return undefined
}

function added(before: Problems, after: Problems): string | undefined {
  for (const [problem, count] of after) if (count > (before.get(problem) ?? 0)) return problem
  return undefined
}

function collect(root: unknown, path: readonly PathKey[]): Problems {
  let value: unknown = root
  for (const key of path) {
    if (value === null || typeof value !== 'object') return new Map()
    value = (value as Record<PathKey, unknown>)[key]
  }
  const problems: Problems = new Map()
  for (const blueprint of nestedBlueprints(value)) addBlueprintProblems(blueprint, problems)
  return problems
}

function addBlueprintProblems(blueprint: JsonObject, problems: Problems): void {
  const entities = blueprint['entities']
  if (!Array.isArray(entities)) return
  const add = (problem: string): void => {
    problems.set(problem, (problems.get(problem) ?? 0) + 1)
  }
  const numbers = new Set<number>()
  for (const entity of entities) {
    if (!isJsonObject(entity)) continue
    const n = entity['entity_number']
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1) {
      add(`Invalid entity_number ${JSON.stringify(n)}`)
      continue
    }
    if (numbers.has(n)) add(`Duplicate entity_number ${n}`)
    numbers.add(n)
  }
}

/** Blueprints at or below `value`, following root keys and book slots only. */
function nestedBlueprints(value: unknown): JsonObject[] {
  const found: JsonObject[] = []
  const visit = (node: JsonValue | undefined): void => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item)
      return
    }
    if (!isJsonObject(node)) return
    if (Array.isArray(node['entities'])) found.push(node)
    for (const key of ['blueprint', 'blueprint_book', 'blueprints']) visit(node[key])
  }
  visit(value as JsonValue)
  return found
}
