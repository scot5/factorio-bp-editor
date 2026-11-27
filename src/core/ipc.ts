/**
 * Typed contract between the renderer and the main process.
 * See docs/spec/01-architecture.md § IPC contract.
 *
 * Channel names and payload types live here so main, preload and renderer share
 * one definition. Grow `BridgeApi` as features land; never expose raw
 * `ipcRenderer` to the renderer.
 */

export const IpcChannel = {
  AppGetInfo: 'app:get-info'
} as const

export type IpcChannel = (typeof IpcChannel)[keyof typeof IpcChannel]

export interface AppInfo {
  appVersion: string
  electronVersion: string
  chromeVersion: string
  nodeVersion: string
  platform: string
}

export interface BridgeApi {
  app: {
    getInfo(): Promise<AppInfo>
  }
}
