import type { WebPreferences } from 'electron'

/**
 * webPreferences for every app window. See docs/spec/01-architecture.md § Security.
 * Kept in one place (and unit-tested) so a window can't be created with weaker settings.
 */
export function secureWebPreferences(preloadPath: string): WebPreferences {
  return {
    preload: preloadPath,
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    webviewTag: false
  }
}
