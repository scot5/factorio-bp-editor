import { contextBridge, ipcRenderer } from 'electron'
import { IpcChannel, type BridgeApi } from '@core/ipc'

// The only surface the renderer gets. Each method maps to one IPC channel;
// raw ipcRenderer is never exposed.
const api: BridgeApi = {
  app: {
    getInfo: () => ipcRenderer.invoke(IpcChannel.AppGetInfo)
  }
}

contextBridge.exposeInMainWorld('api', api)
