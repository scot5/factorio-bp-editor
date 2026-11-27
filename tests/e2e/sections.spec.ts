import { mkdtempSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { expect, test, type Page } from '@playwright/test'
import { launchApp } from './launch'

/** Collapsible analysis sections (docs/spec/04-visualization.md § Side panel). */

const roboport = readFileSync(join(__dirname, '..', 'corpus', 'roboport.txt'), 'utf8')

async function openAnalysis(page: Page): Promise<void> {
  await page.getByTestId('import-button').click()
  await page.getByTestId('import-text').fill(roboport)
  await page.getByTestId('import-submit').click()
  await page.getByTestId('tab-analysis').click()
  await expect(page.getByTestId('analysis-panel')).toBeVisible()
}

test('sections collapse, expand and remember their state across launches', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'fbe-e2e-'))
  let app = await launchApp(userData)
  let page = await app.firstWindow()
  await openAnalysis(page)

  const bom = page.getByTestId('section-inventory.bom')
  await expect(bom).toHaveAttribute('data-open', 'true')
  await expect(page.getByTestId('bom-row')).toHaveCount(2)
  // The header still says how many rows the section holds.
  await expect(page.getByTestId('section-inventory.bom-toggle')).toContainText('2')

  await page.getByTestId('section-inventory.bom-toggle').click()
  await expect(bom).toHaveAttribute('data-open', 'false')
  await expect(page.getByTestId('bom-row')).toHaveCount(0)
  await expect(page.getByTestId('section-inventory.bom-toggle')).toHaveAttribute(
    'aria-expanded',
    'false'
  )

  // Collapse all closes the reports; expand all reopens everything, nested lists too.
  await page.getByTestId('collapse-all').click()
  await expect(page.getByTestId('section-inventory')).toHaveAttribute('data-open', 'false')
  await expect(page.getByTestId('section-power')).toHaveAttribute('data-open', 'false')
  await page.getByTestId('expand-all').click()
  await expect(page.getByTestId('section-inventory.entities')).toHaveAttribute('data-open', 'true')
  await expect(page.getByTestId('bom-row')).toHaveCount(2)

  await page.getByTestId('section-power-toggle').click()
  await expect(page.getByTestId('section-power')).toHaveAttribute('data-open', 'false')
  await expect
    .poll(() => JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8')).sections?.power)
    .toBe(false)
  await app.close()

  app = await launchApp(userData)
  page = await app.firstWindow()
  await openAnalysis(page)
  await expect(page.getByTestId('section-power')).toHaveAttribute('data-open', 'false')
  await expect(page.getByTestId('section-inventory.entities')).toHaveAttribute('data-open', 'true')
  await app.close()
})
