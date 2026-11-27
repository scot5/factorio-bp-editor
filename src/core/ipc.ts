/**
 * Typed contract between the renderer and the main process.
 * See docs/spec/01-architecture.md § IPC contract.
 *
 * Channel names and payload types live here so main, preload and renderer share
 * one definition. Grow `BridgeApi` as features land; never expose raw
 * `ipcRenderer` to the renderer.
 */
import type { PrototypeDb } from './prototypes/db'

export const IpcChannel = {
  AppGetInfo: 'app:get-info',
  FilesOpenBlueprint: 'files:open-blueprint',
  FilesSaveBlueprint: 'files:save-blueprint',
  ClipboardReadText: 'clipboard:read-text',
  ClipboardWriteText: 'clipboard:write-text',
  AssetsGetStatus: 'assets:get-status',
  AssetsLoad: 'assets:load',
  AssetsChooseGamePath: 'assets:choose-game-path',
  AssetsGetDb: 'assets:get-db',
  UiGetSections: 'ui:get-sections',
  UiSetSections: 'ui:set-sections',
  /** main → renderer event */
  AssetsStatusChanged: 'assets:status-changed'
} as const

export type IpcChannel = (typeof IpcChannel)[keyof typeof IpcChannel]

export interface AppInfo {
  appVersion: string
  electronVersion: string
  chromeVersion: string
  nodeVersion: string
  platform: string
}

export interface OpenedFile {
  /** File name without directory. */
  name: string
  contents: string
}

/** Largest blueprint text file the app will open (a 75 MB-JSON book is ~6 MB as a string). */
export const MAX_BLUEPRINT_FILE_BYTES = 32 * 1024 * 1024

/** Game data status (docs/spec/03-game-assets.md). */
export type AssetState =
  | 'detecting' // looking for the install / cache
  | 'no-install' // no Factorio found; ask the user
  | 'not-loaded' // install found, no cache for this version + mods yet
  | 'loading' // running the dumps and building the cache
  | 'ready'
  | 'error'

export interface AssetStatus {
  state: AssetState
  install?: { path: string; version: string }
  mods?: { name: string; version: string }[]
  /** Progress text while loading, or the error message. */
  message?: string
  /** True when loading failed because the game is running. */
  gameRunning?: boolean
}

/**
 * Which collapsible panel sections are open, by section id (true = open).
 * Ids not listed use the section's default. See docs/spec/04-visualization.md § Side panel.
 */
export type SectionState = Record<string, boolean>

/** Limits on a saved `SectionState`, so a bad renderer cannot bloat settings.json. */
export const MAX_SECTION_IDS = 200
export const MAX_SECTION_ID_LENGTH = 64

/** Keeps the valid entries of untrusted section state (string ids within limits, boolean values). */
export function sanitizeSectionState(value: unknown): SectionState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: SectionState = {}
  for (const [id, open] of Object.entries(value).slice(0, MAX_SECTION_IDS)) {
    if (typeof open === 'boolean' && id.length > 0 && id.length <= MAX_SECTION_ID_LENGTH)
      out[id] = open
  }
  return out
}

export interface BridgeApi {
  app: {
    getInfo(): Promise<AppInfo>
  }
  files: {
    /** Shows an open dialog; `null` when cancelled. */
    openBlueprint(): Promise<OpenedFile | null>
    /** Shows a save dialog; `false` when cancelled. */
    saveBlueprint(contents: string, suggestedName: string): Promise<boolean>
  }
  clipboard: {
    readText(): Promise<string>
    writeText(text: string): Promise<void>
  }
  assets: {
    getStatus(): Promise<AssetStatus>
    /** Runs Factorio's data and icon dumps (only on user request). */
    load(): Promise<AssetStatus>
    /** Folder picker for the game; resolves to false if the folder is not a Factorio install. */
    chooseGamePath(): Promise<boolean>
    /** The prototype database, or null when not ready. */
    getDb(): Promise<PrototypeDb | null>
    onStatus(listener: (status: AssetStatus) => void): () => void
  }
  ui: {
    /** Saved open/closed state of collapsible panel sections. */
    getSections(): Promise<SectionState>
    /** Replaces the saved section state. */
    setSections(state: SectionState): Promise<void>
  }
}
