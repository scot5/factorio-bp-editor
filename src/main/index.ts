import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { handleAssetProtocol, registerAssetScheme } from './assets/protocol'
import { AssetService } from './assets/service'
import { registerIpcHandlers } from './ipc'
import { secureWebPreferences } from './security'
import { SettingsStore } from './settings'
import icon from '../../resources/icon.png?asset'

// Tests (and power users) can keep settings and caches in another folder.
if (process.env['FBE_USER_DATA']) app.setPath('userData', process.env['FBE_USER_DATA'])

// Custom schemes must be registered before the app is ready.
registerAssetScheme()

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#1e1e1e',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: secureWebPreferences(join(__dirname, '../preload/index.js'))
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // Open external links in the user's browser, never in the app.
  mainWindow.webContents.setWindowOpenHandler((details) => {
    if (details.url.startsWith('https://')) void shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Block in-app navigation away from the renderer (e.g. a file dropped outside the drop zone).
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (!(is.dev && devUrl && url.startsWith(devUrl))) event.preventDefault()
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

void app.whenReady().then(() => {
  electronApp.setAppUserModelId('dev.factorio-bp-editor')

  // F12 toggles DevTools in development; Ctrl+R is ignored in production.
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  const settings = new SettingsStore(join(app.getPath('userData'), 'settings.json'))
  const assets = new AssetService(join(app.getPath('userData'), 'prototype-cache'), settings)
  handleAssetProtocol(() => assets.roots())
  registerIpcHandlers(assets)
  createWindow()
  void assets.detect() // reads files only; the game is never started without a click

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
