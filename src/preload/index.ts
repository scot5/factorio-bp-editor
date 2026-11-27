import { contextBridge, ipcRenderer } from 'electron'
import { IpcChannel, type BridgeApi } from '@core/ipc'

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
  }
}

contextBridge.exposeInMainWorld('api', api)
