import { app, BrowserWindow, clipboard, dialog, ipcMain } from 'electron'
import { readFile, stat, writeFile } from 'fs/promises'
import { basename } from 'path'
import {
  IpcChannel,
  MAX_BLUEPRINT_FILE_BYTES,
  type AppInfo,
  type AssetStatus,
  type OpenedFile,
  type SectionState,
  sanitizeSectionState
} from '@core/ipc'
import type { PrototypeDb } from '@core/prototypes'
import type { AssetService } from './assets/service'
import type { SettingsStore } from './settings'

const TEXT_FILTERS = [
  { name: 'Blueprint strings', extensions: ['txt'] },
  { name: 'All files', extensions: ['*'] }
]

export function registerIpcHandlers(assets: AssetService, settings: SettingsStore): void {
  ipcMain.handle(IpcChannel.AppGetInfo, (): AppInfo => ({
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron,
    chromeVersion: process.versions.chrome,
    nodeVersion: process.versions.node,
    platform: process.platform
  }))

  ipcMain.handle(IpcChannel.FilesOpenBlueprint, async (event): Promise<OpenedFile | null> => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const options = { properties: ['openFile' as const], filters: TEXT_FILTERS }
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    const path = result.filePaths[0]
    if (result.canceled || !path) return null
    const { size } = await stat(path)
    if (size > MAX_BLUEPRINT_FILE_BYTES) {
      throw new Error(`File is too large (${Math.round(size / 1024 / 1024)} MB).`)
    }
    return { name: basename(path), contents: await readFile(path, 'utf8') }
  })

  ipcMain.handle(
    IpcChannel.FilesSaveBlueprint,
    async (event, contents: unknown, suggestedName: unknown): Promise<boolean> => {
      if (typeof contents !== 'string' || typeof suggestedName !== 'string') {
        throw new TypeError('Invalid arguments')
      }
      const window = BrowserWindow.fromWebContents(event.sender)
      const options = { defaultPath: sanitizeFileName(suggestedName), filters: TEXT_FILTERS }
      const result = window
        ? await dialog.showSaveDialog(window, options)
        : await dialog.showSaveDialog(options)
      if (result.canceled || !result.filePath) return false
      await writeFile(result.filePath, contents, 'utf8')
      return true
    }
  )

  ipcMain.handle(IpcChannel.AssetsGetStatus, (): AssetStatus => assets.getStatus())
  ipcMain.handle(IpcChannel.AssetsLoad, (): Promise<AssetStatus> => assets.load())
  ipcMain.handle(IpcChannel.AssetsGetDb, (): Promise<PrototypeDb | null> => assets.getDb())
  ipcMain.handle(IpcChannel.AssetsChooseGamePath, async (event): Promise<boolean> => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const options = {
      title: 'Select the Factorio folder (the one containing "data" and "bin")',
      properties: ['openDirectory' as const]
    }
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    const path = result.filePaths[0]
    if (result.canceled || !path) return false
    return assets.setGamePath(path)
  })
  // Push status changes to every window.
  assets.onStatus((status) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(IpcChannel.AssetsStatusChanged, status)
    }
  })

  ipcMain.handle(IpcChannel.UiGetSections, (): SectionState =>
    sanitizeSectionState(settings.get().sections)
  )
  ipcMain.handle(IpcChannel.UiSetSections, (_event, state: unknown): void => {
    settings.update({ sections: sanitizeSectionState(state) })
  })

  ipcMain.handle(
    IpcChannel.ClipboardReadText,
    async (): Promise<string> => await clipboard.readText()
  )

  ipcMain.handle(IpcChannel.ClipboardWriteText, async (_event, text: unknown): Promise<void> => {
    if (typeof text !== 'string') throw new TypeError('Invalid arguments')
    await clipboard.writeText(text)
  })
}

/** A safe default file name from a blueprint label (labels may contain rich text and symbols). */
export function sanitizeFileName(name: string): string {
  const forbidden = '<>:"/\\|?*'
  const cleaned = [...name.replace(/\[[^\]]*\]/g, '')] // drop rich text tags
    .filter((c) => c.charCodeAt(0) >= 32 && !forbidden.includes(c))
    .join('')
    .trim()
    .slice(0, 80)
  return `${cleaned || 'blueprint'}.txt`
}
