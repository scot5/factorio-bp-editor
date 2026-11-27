/**
 * Typed contract between the renderer and the main process.
 * See docs/spec/01-architecture.md § IPC contract.
 *
 * Channel names and payload types live here so main, preload and renderer share
 * one definition. Grow `BridgeApi` as features land; never expose raw
 * `ipcRenderer` to the renderer.
 */

export const IpcChannel = {
  AppGetInfo: 'app:get-info',
  FilesOpenBlueprint: 'files:open-blueprint',
  FilesSaveBlueprint: 'files:save-blueprint',
  ClipboardReadText: 'clipboard:read-text',
  ClipboardWriteText: 'clipboard:write-text'
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
}
