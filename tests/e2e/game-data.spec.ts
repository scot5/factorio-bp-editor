import { readFileSync } from 'fs'
import { join } from 'path'
import { expect, test } from '@playwright/test'
import { launchApp } from './launch'

/**
 * Loading real game data (M3). Opt-in: it runs the local Factorio install
 * (`--dump-data`, `--dump-icon-sprites`), which must be closed.
 *
 *   FBE_E2E_GAME=1 pnpm test:e2e
 */
test.skip(
  !process.env['FBE_E2E_GAME'],
  'set FBE_E2E_GAME=1 to run against a local Factorio install'
)
test.setTimeout(5 * 60_000)

test('loads game data on request and shows real sizes and icons', async () => {
  const app = await launchApp()
  const page = await app.firstWindow()
  const status = page.getByTestId('game-data-status')

  // Detection finds the install but never starts the game by itself.
  await expect(status).toHaveAttribute('data-state', 'not-loaded', { timeout: 20_000 })

  await page.getByTestId('load-game-data').click()
  await expect(status).toHaveAttribute('data-state', 'ready', { timeout: 4 * 60_000 })
  await expect(status).toContainText('Game data: Factorio')

  // Import a blueprint with icons in its label and check that game icons render.
  await page.getByTestId('import-button').click()
  await page
    .getByTestId('import-text')
    .fill(readFileSync(join(__dirname, '..', 'corpus', 'requester_station.txt'), 'utf8'))
  await page.getByTestId('import-submit').click()
  const labelIcon = page.getByTestId('book-tree').locator('img[alt="requester-chest"]').first()
  await expect(labelIcon).toBeVisible()
  const loaded = await labelIcon.evaluate(
    (img: HTMLImageElement) => img.complete && img.naturalWidth
  )
  expect(loaded).toBe(64)

  // A protocol request outside the roots is refused.
  const blocked = await page.evaluate(async () => {
    const r = await fetch('factorio-asset://icons/item/..%2F..%2Fsettings.json.png').catch(
      () => null
    )
    return r ? r.status : 'network-error'
  })
  expect(blocked === 404 || blocked === 'network-error').toBe(true)

  await app.close()
})
