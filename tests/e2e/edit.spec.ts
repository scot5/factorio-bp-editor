import { readFileSync } from 'fs'
import { join } from 'path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { launchApp } from './launch'
import { decode, encode, rootPayload } from '../../src/core/codec'

/** M5 PR 1: commands, undo/redo and the dirty marker (docs/spec/05-editing.md). */

const corpus = (name: string): string => readFileSync(join(__dirname, '..', 'corpus', name), 'utf8')

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  app = await launchApp()
  page = await app.firstWindow()
  await page.waitForSelector('[data-testid="blueprint-canvas"] canvas')
})

test.afterAll(async () => {
  await app?.close()
})

test('edits the label and description, undoes, redoes and exports the edit', async () => {
  const text = corpus('roboport.txt')
  await page.getByTestId('import-button').click()
  await page.getByTestId('import-text').fill(text)
  await page.getByTestId('import-submit').click()

  const tabs = page.getByRole('navigation', { name: 'Open documents' })
  await expect(tabs).toContainText('Roboports')
  await expect(page.getByTestId('undo-button')).toBeDisabled()
  await expect(page.getByTestId('dirty')).toHaveCount(0)

  // Escape cancels an edit.
  await page.getByTestId('node-label').click()
  await page.getByTestId('node-label-input').fill('Ignored')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('node-label')).toHaveText('Roboports')
  await expect(page.getByTestId('undo-button')).toBeDisabled()

  // Enter commits; the tab title follows the root label.
  await page.getByTestId('node-label').click()
  await page.getByTestId('node-label-input').fill('Hub')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('node-label')).toHaveText('Hub')
  await expect(tabs).toContainText('Hub')
  await expect(page.getByTestId('dirty')).toHaveCount(1)
  await expect(page.getByTestId('undo-button')).toHaveAttribute('title', /Undo set label/)

  // Ctrl+Z outside a text field undoes; back to the imported state, so not dirty.
  await page.locator('body').click({ position: { x: 5, y: 200 } })
  await page.keyboard.press('Control+z')
  await expect(page.getByTestId('node-label')).toHaveText('Roboports')
  await expect(page.getByTestId('dirty')).toHaveCount(0)
  await page.getByTestId('redo-button').click()
  await expect(page.getByTestId('node-label')).toHaveText('Hub')

  // Multiline description: Ctrl+Enter commits.
  await page.getByTestId('node-description').click()
  await page.getByTestId('node-description-input').fill('Line one\nLine two')
  await page.keyboard.press('Control+Enter')
  await expect(page.getByTestId('node-description')).toContainText('Line two')

  // Exporting the whole document saves it: the dirty marker goes away.
  await page.getByTestId('export-button').click()
  const exported = await page.getByTestId('export-text').inputValue()
  await page.getByTestId('export-copy').click()
  await page.keyboard.press('Escape')
  const payload = rootPayload(decode(exported))
  expect(payload['label']).toBe('Hub')
  expect(payload['description']).toBe('Line one\nLine two')
  await expect(page.getByTestId('dirty')).toHaveCount(0)

  // Undo both edits: the export is the original string again.
  await page.keyboard.press('Control+z')
  await page.keyboard.press('Control+z')
  await expect(page.getByTestId('dirty')).toHaveCount(1)
  await expect(page.getByTestId('undo-button')).toBeDisabled()
  await page.getByTestId('export-button').click()
  expect(await page.getByTestId('export-text').inputValue()).toBe(encode(decode(text)))
  await page.keyboard.press('Escape')
})
