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
  await expect(page.getByTestId('export-text')).toHaveValue(encode(decode(text)))
  await page.keyboard.press('Escape')
})

/** M5 PR 2: select, move, rotate, mirror and delete (05 § Entity commands, § Tools). */
test('moves, rotates, mirrors and deletes the selection, and undoes it all', async () => {
  const text = encode({
    blueprint: {
      item: 'blueprint',
      label: 'Transform',
      entities: [
        { entity_number: 1, name: 'assembling-machine-2', position: { x: 1.5, y: 1.5 } },
        { entity_number: 2, name: 'iron-chest', position: { x: 4.5, y: 1.5 } },
        { entity_number: 3, name: 'inserter', position: { x: 3.5, y: 1.5 }, direction: 4 }
      ],
      version: 562954250027018
    }
  })
  await page.getByTestId('import-button').click()
  await page.getByTestId('import-text').fill(text)
  await page.getByTestId('import-submit').click()
  await expect(page.getByTestId('entity-count')).toHaveText('3 entities')

  const exportEntities = async (): Promise<Record<string, unknown>[]> => {
    await page.getByTestId('export-button').click()
    const exported = await page.getByTestId('export-text').inputValue()
    await page.keyboard.press('Escape')
    return rootPayload(decode(exported))['entities'] as Record<string, unknown>[]
  }

  // Box-select everything.
  const canvas = page.getByTestId('blueprint-canvas')
  const box = (await canvas.boundingBox())!
  await expect(page.getByTestId('tool-rotate')).toBeDisabled()
  await page.mouse.move(box.x + 5, box.y + 5)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width - 5, box.y + box.height - 5, { steps: 5 })
  await page.mouse.up()
  await expect(page.getByTestId('selection-count')).toHaveText('3 selected')

  // Drag the selection by its middle (the assembler) to the right.
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  await page.mouse.move(cx + 150, cy, { steps: 8 })
  await page.mouse.up()
  await expect(page.getByTestId('undo-button')).toHaveAttribute('title', /Undo move 3 entities/)
  await expect(page.getByTestId('selection-count')).toHaveText('3 selected')
  const moved = await exportEntities()
  const dx = (moved[0]!['position'] as { x: number }).x - 1.5
  expect(dx).toBeGreaterThan(0)
  expect(Number.isInteger(dx)).toBe(true)
  expect(moved.map((e) => e['position'])).toEqual([
    { x: 1.5 + dx, y: 1.5 },
    { x: 4.5 + dx, y: 1.5 },
    { x: 3.5 + dx, y: 1.5 }
  ])

  // R turns, F mirrors (the assembler has no mirror flag), G mirrors vertically.
  await canvas.press('r')
  let entities = await exportEntities()
  expect(entities[0]!['direction']).toBe(4)
  expect(entities[2]!['direction']).toBe(8)
  await canvas.press('Shift+r')
  await canvas.press('f')
  entities = await exportEntities()
  expect(entities[2]!['direction']).toBe(12)
  await page.getByTestId('tool-mirror-v').click()
  await expect(page.getByTestId('undo-button')).toHaveAttribute('title', /Undo mirror 3 entities/)

  // Delete clears the selection; undo brings the entities back.
  await canvas.press('Delete')
  await expect(page.getByTestId('entity-count')).toHaveText('0 entities')
  await expect(page.getByTestId('selection-count')).toBeHidden()
  for (let i = 0; i < 6; i++) await page.keyboard.press('Control+z')
  await expect(page.getByTestId('undo-button')).toBeDisabled()
  await expect(page.getByTestId('entity-count')).toHaveText('3 entities')
  await page.getByTestId('export-button').click()
  await expect(page.getByTestId('export-text')).toHaveValue(encode(decode(text)))
  await page.keyboard.press('Escape')
})
