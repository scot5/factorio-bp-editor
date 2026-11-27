import { contextBridge, ipcRenderer } from 'electron'
import { IpcChannel, type AssetStatus, type BridgeApi } from '@core/ipc'

// The only surface the renderer gets. Each method maps to one IPC channel;
// raw ipcRenderer is never exposed.
const api: BridgeApi = {
  app: {
    getInfo: () => ipcRenderer.invoke(IpcChannel.AppGetInfo)
  },
  files: {
    openBlueprint: () => ipcRenderer.invoke(IpcChannel.FilesOpenBlueprint),
    saveBlueprint: (contents, suggestedName) =>
      ipcRenderer.invoke(IpcChannel.FilesSaveBlueprint, contents, suggestedName)
  },
  clipboard: {
    readText: () => ipcRenderer.invoke(IpcChannel.ClipboardReadText),
    writeText: (text) => ipcRenderer.invoke(IpcChannel.ClipboardWriteText, text)
  },
  assets: {
    getStatus: () => ipcRenderer.invoke(IpcChannel.AssetsGetStatus),
    load: () => ipcRenderer.invoke(IpcChannel.AssetsLoad),
    chooseGamePath: () => ipcRenderer.invoke(IpcChannel.AssetsChooseGamePath),
    getDb: () => ipcRenderer.invoke(IpcChannel.AssetsGetDb),
    onStatus: (listener) => {
      const handler = (_event: unknown, status: AssetStatus): void => listener(status)
      ipcRenderer.on(IpcChannel.AssetsStatusChanged, handler)
      return () => {
        ipcRenderer.removeListener(IpcChannel.AssetsStatusChanged, handler)
      }
    }
  }
}

contextBridge.exposeInMainWorld('api', api)
