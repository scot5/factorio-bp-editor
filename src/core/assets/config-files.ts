/**
 * Parsers for the small config files used to locate a Factorio install and its
 * write-data directory. See docs/spec/03-game-assets.md § Locating the install.
 * Pure string functions; the main process does the file system work.
 */

/**
 * Library folder paths from Steam's `steamapps/libraryfolders.vdf`.
 * The file is Valve KeyValues; each library entry has a `"path"` key.
 */
export function parseSteamLibraryFolders(vdf: string): string[] {
  const paths: string[] = []
  for (const match of vdf.matchAll(/"path"\s+"((?:[^"\\]|\\.)*)"/g)) {
    paths.push(match[1]!.replace(/\\\\/g, '\\'))
  }
  return paths
}

/** `key=value` lines grouped by `[section]`; `;` and `#` start comments. Keys before any section go in "". */
export function parseIni(text: string): Record<string, Record<string, string>> {
  const result: Record<string, Record<string, string>> = { '': {} }
  let section = ''
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith(';') || line.startsWith('#')) continue
    const header = /^\[(.+)\]$/.exec(line)
    if (header) {
      section = header[1]!.trim()
      result[section] ??= {}
      continue
    }
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    result[section]![line.slice(0, eq).trim()] = line.slice(eq + 1).trim()
  }
  return result
}

export interface FactorioPathContext {
  /** `<install>/bin/x64` (the executable's directory). */
  executableDir: string
  /** Per-user application data, e.g. `%APPDATA%\Factorio` on Windows. */
  systemWriteData: string
  /** Per-user read data; Factorio uses the install's `data` folder. */
  systemReadData: string
}

/** Replaces Factorio's `__PATH__executable__` style placeholders. */
export function resolveFactorioPath(value: string, ctx: FactorioPathContext): string {
  return value
    .replace('__PATH__executable__', ctx.executableDir)
    .replace('__PATH__system-write-data__', ctx.systemWriteData)
    .replace('__PATH__system-read-data__', ctx.systemReadData)
}

/**
 * Where Factorio writes user data (mods, saves, script-output), following
 * `config-path.cfg` and then `config/config.ini` like the game does.
 *
 * @param configPathCfg contents of `<install>/config-path.cfg`, or null if absent
 * @param readConfigIni reads `config.ini` from a directory, or null if absent
 */
export function resolveWriteDataDir(
  configPathCfg: string | null,
  ctx: FactorioPathContext & { installDir: string },
  readConfigIni: (configDir: string) => string | null
): string {
  const cfg = parseIni(configPathCfg ?? '')['']!
  // Without the file, or when it says false, the game keeps everything next to itself.
  const useSystem = (cfg['use-system-read-write-data-directories'] ?? 'false') === 'true'
  const defaultWriteData = useSystem ? ctx.systemWriteData : ctx.installDir
  const configDir = resolveFactorioPath(
    cfg['config-path'] ??
      (useSystem ? '__PATH__system-write-data__/config' : `${ctx.installDir}/config`),
    { ...ctx, systemWriteData: defaultWriteData }
  )
  const ini = readConfigIni(configDir)
  const writeData = ini ? parseIni(ini)['path']?.['write-data'] : undefined
  return writeData
    ? resolveFactorioPath(writeData, { ...ctx, systemWriteData: defaultWriteData })
    : defaultWriteData
}

/** Mods enabled in `mods/mod-list.json`, in file order. */
export function parseEnabledMods(modListJson: string): string[] {
  const parsed = JSON.parse(modListJson) as { mods?: { name?: unknown; enabled?: unknown }[] }
  return (parsed.mods ?? [])
    .filter((m) => m.enabled === true && typeof m.name === 'string')
    .map((m) => m.name as string)
}
