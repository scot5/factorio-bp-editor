/**
 * Prototype renames between 1.1 and 2.0, copied from the game's own migration
 * files (Factorio 2.1.25, data/base/migrations). Applied in the order of
 * data/base/migrations/migrations.txt.
 *
 * Each step is applied as one simultaneous mapping: "1.2.0 stack inserter
 * rename" swaps stack-inserter and bulk-inserter, so its pairs must not be
 * applied one after another.
 *
 * The game keeps separate tables per category (item, entity, recipe, …). In a
 * blueprint the same name can be an entity, an item and a recipe at once, and
 * the tables never disagree for a name, so each step merges its categories.
 * (Checked by migrate.test.ts.) Technology and decorative renames are left out:
 * blueprints do not reference them.
 */
export interface RenameStep {
  /** Source file in data/base/migrations. */
  source: string
  renames: Readonly<Record<string, string>>
}

export const RENAME_STEPS: readonly RenameStep[] = [
  {
    source: '1.2.0 stack inserter rename.json',
    renames: {
      'stack-inserter': 'bulk-inserter',
      'bulk-inserter': 'stack-inserter'
    }
  },
  {
    source: '2.0.0.json',
    renames: {
      // item / entity
      'empty-barrel': 'barrel',
      'filter-inserter': 'fast-inserter',
      'stack-filter-inserter': 'bulk-inserter',
      'fusion-reactor-equipment': 'fission-reactor-equipment',
      'logistic-chest-passive-provider': 'passive-provider-chest',
      'logistic-chest-active-provider': 'active-provider-chest',
      'logistic-chest-storage': 'storage-chest',
      'logistic-chest-buffer': 'buffer-chest',
      'logistic-chest-requester': 'requester-chest',
      'effectivity-module': 'efficiency-module',
      'effectivity-module-2': 'efficiency-module-2',
      'effectivity-module-3': 'efficiency-module-3',
      'straight-rail-remnants': 'legacy-straight-rail-remnants',
      'curved-rail-remnants': 'legacy-curved-rail-remnants',
      'rock-huge': 'huge-rock',
      'rock-big': 'big-rock',
      'rock-medium': 'medium-rock',
      'sand-rock-big': 'big-sand-rock',
      // recipe only
      'empty-barrel-recycling': 'barrel-recycling',
      'fill-water-barrel': 'water-barrel',
      'fill-crude-oil-barrel': 'crude-oil-barrel',
      'fill-petroleum-gas-barrel': 'petroleum-gas-barrel',
      'fill-light-oil-barrel': 'light-oil-barrel',
      'fill-heavy-oil-barrel': 'heavy-oil-barrel',
      'fill-lubricant-barrel': 'lubricant-barrel',
      'fill-sulfuric-acid-barrel': 'sulfuric-acid-barrel',
      'fill-fluoroketone-hot-barrel': 'fluoroketone-hot-barrel',
      'fill-fluoroketone-cold-barrel': 'fluoroketone-cold-barrel'
    }
  },
  {
    source: '2.0.0-internal3.json',
    renames: { 'used-up-uranium-fuel-cell': 'depleted-uranium-fuel-cell' }
  }
]

/** Applies every step in order to one name. */
export function renameFrom1_1(name: string): string {
  let current = name
  for (const step of RENAME_STEPS) current = step.renames[current] ?? current
  return current
}
