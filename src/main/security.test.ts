import { describe, expect, it } from 'vitest'
import { secureWebPreferences } from './security'

describe('secureWebPreferences', () => {
  it('enables isolation and sandbox and disables Node in the renderer', () => {
    expect(secureWebPreferences('/preload.js')).toMatchObject({
      preload: '/preload.js',
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      webviewTag: false
    })
  })
})
