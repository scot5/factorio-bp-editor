import type { z } from 'zod'
import { isJsonObject, unpackVersion, type BlueprintEnvelope, type JsonObject } from '../codec'
import { slotKind, walk } from './book'
import { ROOT_SCHEMAS } from './schema'
import { wireColor } from './wires'

/**
 * Structural validation of a decoded envelope.
 *
 * Validation never changes the envelope and never blocks loading: the app shows
 * issues and keeps working (docs/spec/05-editing.md § Principles). Issues with
 * severity `error` would make an export unreadable to the game.
 *
 * Content checks that need prototype data (unknown entities, overlaps, recipes)
 * belong to analysis (docs/spec/06-analysis.md), not here.
 */

export type IssueSeverity = 'error' | 'warning'

export interface ValidationIssue {
  severity: IssueSeverity
  /** Path into the envelope JSON, e.g. ['blueprint_book', 'blueprints', 3, 'blueprint', 'entities', 7, 'position']. */
  path: (string | number)[]
  message: string
}

export interface ValidateOptions {
  /** Stop after this many issues (default 200). */
  maxIssues?: number
}

export function validateEnvelope(
  envelope: BlueprintEnvelope,
  options: ValidateOptions = {}
): ValidationIssue[] {
  const max = options.maxIssues ?? 200
  const issues: ValidationIssue[] = []
  const report = (issue: ValidationIssue): void => {
    if (issues.length < max) issues.push(issue)
  }

  const kind = Object.keys(envelope)[0] as keyof typeof ROOT_SCHEMAS
  const result = ROOT_SCHEMAS[kind].safeParse((envelope as Record<string, unknown>)[kind])
  if (!result.success) {
    for (const issue of result.error.issues) report(fromZodIssue(issue, [kind]))
  }

  walk(envelope, (node) => {
    const base = jsonPath(kind, node.path, envelope)
    if (node.kind === 'blueprint') checkBlueprint(node.payload, base, report)
    if (node.kind === 'blueprint_book') checkBook(node.payload, base, report)
  })

  return issues
}

function fromZodIssue(issue: z.core.$ZodIssue, prefix: (string | number)[]): ValidationIssue {
  return {
    severity: 'error',
    path: [...prefix, ...issue.path.map((p) => (typeof p === 'symbol' ? String(p) : p))],
    message: issue.message
  }
}

/** JSON path of a node: ['blueprint_book', 'blueprints', <array position>, '<kind>', ...]. */
function jsonPath(
  rootKey: string,
  bookPath: readonly number[],
  envelope: BlueprintEnvelope
): (string | number)[] {
  const path: (string | number)[] = [rootKey]
  let current = (envelope as Record<string, unknown>)[rootKey]
  for (const index of bookPath) {
    if (!isJsonObject(current) || !Array.isArray(current['blueprints'])) break
    const position = current['blueprints'].findIndex(
      (slot) => isJsonObject(slot) && slot['index'] === index
    )
    const slot = current['blueprints'][position]
    const kind = isJsonObject(slot) ? slotKind(slot) : undefined
    if (!kind || !isJsonObject(slot)) break
    path.push('blueprints', position, kind)
    current = slot[kind]
  }
  return path
}

function checkBook(
  book: JsonObject,
  base: (string | number)[],
  report: (issue: ValidationIssue) => void
): void {
  const slots = Array.isArray(book['blueprints']) ? book['blueprints'] : []
  const seen = new Set<number>()
  slots.forEach((slot, position) => {
    if (!isJsonObject(slot)) return
    const path = [...base, 'blueprints', position]
    const kinds = ['blueprint', 'blueprint_book', 'deconstruction_planner', 'upgrade_planner']
    const present = kinds.filter((k) => k in slot)
    if (present.length !== 1) {
      report({
        severity: 'error',
        path,
        message:
          present.length === 0
            ? 'Book slot holds no blueprint, book or planner'
            : `Book slot holds more than one item: ${present.join(', ')}`
      })
    }
    const index = slot['index']
    if (typeof index === 'number') {
      if (seen.has(index)) {
        report({ severity: 'error', path, message: `Duplicate book slot index ${index}` })
      }
      seen.add(index)
    }
  })
}

function checkBlueprint(
  blueprint: JsonObject,
  base: (string | number)[],
  report: (issue: ValidationIssue) => void
): void {
  const entities = Array.isArray(blueprint['entities']) ? blueprint['entities'] : []
  const numbers = new Set<number>()
  entities.forEach((entity, position) => {
    if (!isJsonObject(entity) || typeof entity['entity_number'] !== 'number') return
    const n = entity['entity_number']
    if (numbers.has(n)) {
      report({
        severity: 'error',
        path: [...base, 'entities', position, 'entity_number'],
        message: `Duplicate entity_number ${n}`
      })
    }
    numbers.add(n)
  })

  // 1.1 blueprints have no top-level wires; their connections are migrated in task 1.5.
  const version = typeof blueprint['version'] === 'number' ? blueprint['version'] : 0
  const isLegacy = Number.isSafeInteger(version) && unpackVersion(version).major < 2

  const checkRef = (n: unknown, path: (string | number)[], what: string): void => {
    if (typeof n === 'number' && !numbers.has(n)) {
      report({ severity: 'error', path, message: `${what} refers to missing entity ${n}` })
    }
  }

  const wires = Array.isArray(blueprint['wires']) ? blueprint['wires'] : []
  wires.forEach((wire, position) => {
    if (!Array.isArray(wire) || wire.length !== 4) return
    const path = [...base, 'wires', position]
    checkRef(wire[0], path, 'Wire')
    checkRef(wire[2], path, 'Wire')
    const ca = typeof wire[1] === 'number' ? wireColor(wire[1]) : null
    const cb = typeof wire[3] === 'number' ? wireColor(wire[3]) : null
    if (!isLegacy && ca !== null && cb !== null && ca !== cb) {
      report({
        severity: 'warning',
        path,
        message: `Wire connects a ${ca} connector to a ${cb} connector`
      })
    }
  })

  const stock = Array.isArray(blueprint['stock_connections']) ? blueprint['stock_connections'] : []
  stock.forEach((connection, position) => {
    if (!isJsonObject(connection)) return
    const path = [...base, 'stock_connections', position]
    for (const key of ['stock', 'front', 'back']) checkRef(connection[key], path, `Stock ${key}`)
  })

  const schedules = Array.isArray(blueprint['schedules']) ? blueprint['schedules'] : []
  schedules.forEach((schedule, position) => {
    if (!isJsonObject(schedule) || !Array.isArray(schedule['locomotives'])) return
    for (const n of schedule['locomotives']) {
      checkRef(n, [...base, 'schedules', position, 'locomotives'], 'Schedule')
    }
  })
}

/** Human-readable path, e.g. `blueprint_book.blueprints[3].blueprint.entities[7].position`. */
export function formatIssuePath(path: readonly (string | number)[]): string {
  return path.reduce<string>(
    (out, part) => (typeof part === 'number' ? `${out}[${part}]` : out ? `${out}.${part}` : part),
    ''
  )
}
