import { expect, test, type ElectronApplication } from '@playwright/test'
import { launchApp } from './launch'

let app: ElectronApplication

test.beforeAll(async () => {
  app = await launchApp()
})

test.afterAll(async () => {
  await app?.close()
})

test('opens the main window', async () => {
  const page = await app.firstWindow()
  await expect(page).toHaveTitle('Factorio Blueprint Editor')
  await expect(page.getByTestId('empty-state')).toBeVisible()
})

test('typed bridge works end to end', async () => {
  const page = await app.firstWindow()
  const info = await page.evaluate(() =>
    (
      globalThis as unknown as { api: { app: { getInfo(): Promise<{ electronVersion: string }> } } }
    ).api.app.getInfo()
  )
  expect(info.electronVersion).toMatch(/^\d+\./)
})

test('renderer has no Node access and only the typed bridge', async () => {
  // webPreferences themselves are unit-tested in src/main/security.test.ts;
  // this checks the effect from inside the page.
  const page = await app.firstWindow()
  const exposure = await page.evaluate(() => {
    const g = globalThis as Record<string, unknown>
    return {
      require: typeof g['require'],
      process: typeof g['process'],
      module: typeof g['module'],
      electron: typeof g['electron'],
      api: typeof g['api']
    }
  })
  expect(exposure).toEqual({
    require: 'undefined',
    process: 'undefined',
    module: 'undefined',
    electron: 'undefined',
    api: 'object'
  })
})
