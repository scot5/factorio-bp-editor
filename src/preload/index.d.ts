import type { BridgeApi } from '../core/ipc'

declare global {
  interface Window {
    api: BridgeApi
  }
}
