import { readdirSync, readFileSync } from 'fs'
import { join, relative } from 'path'

export const CORPUS_DIR = join(__dirname, '..', 'corpus')

/**
 * - `current`: exported from 2.x (top level)
 * - `legacy`: exported from 1.1 (legacy-1.1/)
 * - `upgraded`: a legacy string imported into 2.1 and exported again by the
 *   game (legacy-1.1/upgraded/, same file name as the original). Used as the
 *   reference for the 1.1 migration.
 * - `modded`: needs mods (modded/)
 */
export type CorpusCategory = 'current' | 'legacy' | 'upgraded' | 'modded'

export interface CorpusFile {
  /** Path relative to tests/corpus, with forward slashes (e.g. "legacy-1.1/mall_starter_factory.txt"). */
  name: string
  category: CorpusCategory
  text: string
}

function categoryOf(name: string): CorpusCategory {
  if (name.startsWith('legacy-1.1/upgraded/')) return 'upgraded'
  if (name.startsWith('legacy-1.1/')) return 'legacy'
  if (name.startsWith('modded/')) return 'modded'
  return 'current'
}

/** Every `.txt` blueprint string under tests/corpus, sorted by name. */
export function loadCorpus(): CorpusFile[] {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]
    )
  return walk(CORPUS_DIR)
    .filter((path) => path.endsWith('.txt'))
    .map((path) => {
      const name = relative(CORPUS_DIR, path).split('\\').join('/')
      return { name, category: categoryOf(name), text: readFileSync(path, 'utf8') }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}
