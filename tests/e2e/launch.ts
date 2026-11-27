import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { _electron as electron, type ElectronApplication } from '@playwright/test'

/**
 * Launches the built app with a fresh user-data folder, so tests never read or
 * change the developer's real settings and game-data cache.
 */
export async function launchApp(
  userData = mkdtempSync(join(tmpdir(), 'fbe-e2e-'))
): Promise<ElectronApplication> {
  return electron.launch({
    args: ['.'],
    env: { ...process.env, FBE_USER_DATA: userData }
  })
}
