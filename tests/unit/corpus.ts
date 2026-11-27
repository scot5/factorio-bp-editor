import { readdirSync, readFileSync } from 'fs'
import { join, relative } from 'path'

export const CORPUS_DIR = join(__dirname, '..', 'corpus')

export interface CorpusFile {
  /** Path relative to tests/corpus, with forward slashes (e.g. "legacy-1.1/mall_starter_factory.txt"). */
  name: string
  text: string
}

/** Every `.txt` blueprint string under tests/corpus, sorted by name. */
export function loadCorpus(): CorpusFile[] {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]
    )
  return walk(CORPUS_DIR)
    .filter((path) => path.endsWith('.txt'))
    .map((path) => ({
      name: relative(CORPUS_DIR, path).split('\\').join('/'),
      text: readFileSync(path, 'utf8')
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}
