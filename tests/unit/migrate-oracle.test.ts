import { describe, expect, it } from 'vitest'
import { decode, type JsonObject } from '@core/codec'
import { findAll } from '@core/model'
import { migrate1to2 } from '@core/migrate'
import { loadCorpus } from './corpus'

/**
 * Compares our 1.1 → 2.x migration with the game's own upgrade of the same
 * strings (tests/corpus/legacy-1.1/upgraded: imported into 2.1.25 and exported).
 *
 * Compared: entity names, positions, directions/orientation, wires, module and
 * fuel totals, use_filters. NOT compared (deliberately not migrated, see spec 02):
 * control_behavior, request filters, filter quality/comparator fields, and
 * defaults the game adds (recipe_quality, enable_logistics_while_moving, …).
 */

/**
 * Prototypes that 2.0 no longer has. On import the game deletes entities whose
 * settings reference them (it shows an error); we keep them (lossless).
 * 0.14-era item names still used in the outpost book, and the removed
 * rocket-control-unit.
 */
const REMOVED_PROTOTYPES = [
  'uranium-rifle-magazine',
  'armor-piercing-rifle-magazine',
  'rocket-control-unit'
]

/**
 * Copper wire reach of vanilla poles (tiles). The game drops copper wires longer
 * than the shorter reach of their two poles. We keep them; analysis reports them
 * as `wire-out-of-reach` (spec 06) once prototype data is available.
 */
const POLE_REACH: Record<string, number> = {
  'small-electric-pole': 7.5,
  'medium-electric-pole': 9,
  'big-electric-pole': 30,
  substation: 18
}

/** Entities the game strips item requests from because they have no module slots. */
const NO_MODULE_SLOTS = new Set(['assembling-machine-1'])

const corpus = loadCorpus()
const pairs = corpus
  .filter((f) => f.category === 'legacy')
  .map((legacy) => ({
    name: legacy.name,
    legacy,
    upgraded: corpus.find(
      (f) => f.name === legacy.name.replace('legacy-1.1/', 'legacy-1.1/upgraded/')
    )
  }))
  .filter((p) => p.upgraded !== undefined)

type Pos = { x: number; y: number }
const posKey = (e: JsonObject): string => `${(e['position'] as Pos).x},${(e['position'] as Pos).y}`
const entityKey = (e: JsonObject): string => `${posKey(e)}|${e['name'] as string}`

/** Total requested count per "item@inventory". Stack layout may differ (the game splits fuel stacks). */
function itemTotals(e: JsonObject): Record<string, number> {
  const totals: Record<string, number> = {}
  for (const plan of (e['items'] as JsonObject[] | undefined) ?? []) {
    const id = (plan['id'] as { name: string }).name
    const slots = ((plan['items'] as JsonObject)['in_inventory'] as JsonObject[] | undefined) ?? []
    for (const slot of slots) {
      const key = `${id}@${slot['inventory'] as number}`
      totals[key] = (totals[key] ?? 0) + ((slot['count'] as number | undefined) ?? 1)
    }
  }
  return totals
}

function wireKeys(bp: JsonObject, byNumber: Map<number, JsonObject>): Map<string, number[]> {
  const keys = new Map<string, number[]>()
  for (const w of (bp['wires'] as number[][] | undefined) ?? []) {
    const a = byNumber.get(w[0]!)
    const b = byNumber.get(w[2]!)
    if (!a || !b) continue
    const ends = [`${entityKey(a)}#${w[1]}`, `${entityKey(b)}#${w[3]}`].sort()
    keys.set(ends.join(' — '), w)
  }
  return keys
}

describe('1.1 migration matches the game’s own upgrade', () => {
  it('has reference upgrades for the legacy corpus', () => {
    expect(pairs.length).toBeGreaterThanOrEqual(3)
  })

  describe.each(pairs)('$name', ({ legacy, upgraded }) => {
    const ours = migrate1to2(decode(legacy.text)).envelope
    const game = decode(upgraded!.text)
    const blueprints = findAll(game, 'blueprint').map((g) => ({
      path: g.path.join('/'),
      game: g.payload,
      ours: findAll(ours, 'blueprint').find((o) => o.path.join('/') === g.path.join('/'))?.payload
    }))

    it('has the same book structure', () => {
      expect(findAll(ours, 'blueprint').map((n) => n.path)).toEqual(
        findAll(game, 'blueprint').map((n) => n.path)
      )
      expect(findAll(ours, 'upgrade_planner').map((n) => n.path)).toEqual(
        findAll(game, 'upgrade_planner').map((n) => n.path)
      )
    })

    it.each(blueprints)('blueprint $path: entities, wires and items', ({ game: g, ours: o }) => {
      expect(o).toBeDefined()
      const gameEntities = (g['entities'] as JsonObject[] | undefined) ?? []
      const ourEntities = (o!['entities'] as JsonObject[] | undefined) ?? []

      // Match by position and name.
      const ourByKey = new Map<string, JsonObject[]>()
      for (const e of ourEntities)
        ourByKey.set(entityKey(e), [...(ourByKey.get(entityKey(e)) ?? []), e])
      const matched = new Set<JsonObject>()
      const problems: string[] = []

      for (const ge of gameEntities) {
        const oe = (ourByKey.get(entityKey(ge)) ?? []).find((c) => !matched.has(c))
        if (!oe) {
          problems.push(`missing in ours: ${entityKey(ge)}`)
          continue
        }
        matched.add(oe)
        for (const field of ['direction', 'orientation', 'use_filters', 'mirror']) {
          if (JSON.stringify(ge[field]) !== JSON.stringify(oe[field])) {
            problems.push(
              `${entityKey(ge)} ${field}: ours=${JSON.stringify(oe[field])} game=${JSON.stringify(ge[field])}`
            )
          }
        }
        const gameItems = itemTotals(ge)
        const ourItems = itemTotals(oe)
        const gameDroppedItems =
          ge['items'] === undefined && NO_MODULE_SLOTS.has(ge['name'] as string)
        if (!gameDroppedItems && JSON.stringify(gameItems) !== JSON.stringify(ourItems)) {
          problems.push(
            `${entityKey(ge)} items: ours=${JSON.stringify(ourItems)} game=${JSON.stringify(gameItems)}`
          )
        }
      }

      // Entities only in ours must be ones the game deleted for referencing removed prototypes.
      const removedByGame = ourEntities.filter((e) => !matched.has(e))
      for (const e of removedByGame) {
        const json = JSON.stringify(e)
        if (!REMOVED_PROTOTYPES.some((name) => json.includes(`"${name}"`))) {
          problems.push(`extra in ours: ${entityKey(e)}`)
        }
      }

      // Wires: all of the game's wires exist in ours; extra ones touch removed entities
      // or are copper wires the game dropped as too long (see spec 02).
      const ourByNumber = new Map(ourEntities.map((e) => [e['entity_number'] as number, e]))
      const gameByNumber = new Map(gameEntities.map((e) => [e['entity_number'] as number, e]))
      const ourWires = wireKeys(o!, ourByNumber)
      const gameWires = wireKeys(g, gameByNumber)
      for (const key of gameWires.keys())
        if (!ourWires.has(key)) problems.push(`wire missing in ours: ${key}`)
      const removed = new Set(removedByGame.map((e) => e['entity_number'] as number))
      for (const [key, w] of ourWires) {
        if (gameWires.has(key) || removed.has(w[0]!) || removed.has(w[2]!)) continue
        const a = ourByNumber.get(w[0]!)!['position'] as Pos
        const b = ourByNumber.get(w[2]!)!['position'] as Pos
        const length = Math.hypot(a.x - b.x, a.y - b.y)
        const reach = Math.min(
          POLE_REACH[ourByNumber.get(w[0]!)!['name'] as string] ?? Infinity,
          POLE_REACH[ourByNumber.get(w[2]!)!['name'] as string] ?? Infinity
        )
        const tooLong = w[1] === 5 && w[3] === 5 && length > reach
        if (!tooLong) problems.push(`extra wire in ours: ${key}`)
      }

      expect(problems).toEqual([])
    })

    it('upgrade planners match apart from the quality fields the game adds', () => {
      const strip = (v: unknown): unknown =>
        JSON.parse(JSON.stringify(v), (k, val) =>
          k === 'quality' || k === 'comparator' || k === 'version' ? undefined : val
        )
      const ourPlanners = findAll(ours, 'upgrade_planner').map((n) => strip(n.payload))
      const gamePlanners = findAll(game, 'upgrade_planner').map((n) => strip(n.payload))
      expect(ourPlanners).toEqual(gamePlanners)
    })
  })
})
