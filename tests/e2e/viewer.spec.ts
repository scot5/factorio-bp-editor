import { readFileSync } from 'fs'
import { join } from 'path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { launchApp } from './launch'
import { decode, encode } from '../../src/core/codec'

/** M2 viewer end to end (plan task 2.10). */

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

async function importViaDialog(text: string): Promise<void> {
  await page.getByTestId('import-button').click()
  await page.getByTestId('import-text').fill(text)
  await page.getByTestId('import-submit').click()
}

test('imports a string, shows its entities and exports it unchanged', async () => {
  const text = corpus('roboport.txt')
  await importViaDialog(text)
  await expect(page.getByTestId('import-dialog')).toBeHidden()
  await expect(page.getByTestId('entity-count')).toHaveText('9 entities')
  await expect(page.getByTestId('inspector-node')).toContainText('Roboports')

  await page.getByTestId('export-button').click()
  const exported = await page.getByTestId('export-text').inputValue()
  expect(exported).toMatch(/^0/)
  expect(decode(exported)).toStrictEqual(decode(text))
  await page.keyboard.press('Escape')

  // Copper wires are drawn from 1/4 zoom up (fallback end points: no game data here).
  const canvas = page.getByTestId('blueprint-canvas')
  const box = (await canvas.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -120)
  await expect(canvas.locator('canvas')).toHaveAttribute('data-wires', /^[1-9]\d*$/)
  await page.getByRole('button', { name: 'Fit' }).click()
})

test('selects an entity by clicking and shows it in the inspector', async () => {
  // The view is fitted to the blueprint, so the roboport (centre) is under the canvas centre.
  const canvas = page.getByTestId('blueprint-canvas')
  const box = (await canvas.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await expect(page.getByTestId('hover-tooltip')).toContainText('roboport')
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await expect(page.getByTestId('inspector-entity')).toContainText('roboport')
  await expect(page.getByTestId('selection-count')).toHaveText('1 selected')
  await canvas.press('Escape')
  await expect(page.getByTestId('selection-count')).toBeHidden()
})

test('analyses the blueprint in the worker; rows select their entities', async () => {
  await page.getByTestId('tab-analysis').click()
  await expect(page.getByTestId('analysis-summary')).toContainText('9')
  // Bill of materials without game data: entity names stand in for items.
  await expect(page.getByTestId('bom-row')).toHaveCount(2)
  await expect(page.getByTestId('bom-row').first()).toContainText('big-electric-pole')
  await expect(page.getByTestId('bom-row').first()).toContainText('8')
  // Production and power need game data.
  await expect(page.getByTestId('production-needs-data')).toBeVisible()
  await expect(page.getByTestId('logistics-needs-data')).toBeVisible()
  await expect(page.getByTestId('power-needs-data')).toBeVisible()
  // The entity list starts collapsed.
  await expect(page.getByTestId('entities-row')).toHaveCount(0)
  await page.getByTestId('section-inventory.entities-toggle').click()
  await page.getByTestId('entities-row').first().click()
  await expect(page.getByTestId('selection-count')).toHaveText('8 selected')
  await page.getByTestId('blueprint-canvas').press('Escape')
  // Validation runs its structural checks without game data.
  await expect(page.getByTestId('section-validation-toggle')).toContainText('no problems')
  await page.getByTestId('tab-inspector').click()
})

test('lists validation warnings; rows select the entities involved', async () => {
  const entity = (
    n: number,
    name: string,
    x: number,
    extra: Record<string, string | number> = {}
  ): Record<string, unknown> => ({
    entity_number: n,
    name,
    position: { x, y: 0.5 },
    ...extra
  })
  await importViaDialog(
    encode({
      blueprint: {
        item: 'blueprint',
        label: 'Validation check',
        version: 562954250027018,
        entities: [
          entity(1, 'wooden-chest', 0.5),
          entity(2, 'iron-chest', 0.5),
          entity(3, 'underground-belt', 5.5, { direction: 4, type: 'input' })
        ]
      }
    } as never)
  )
  await expect(page.getByTestId('entity-count')).toHaveText('3 entities')
  await page.getByTestId('tab-analysis').click()
  const toggle = page.getByTestId('section-validation-toggle')
  await expect(toggle).toContainText('1 error · 1 warning')
  await expect(page.getByTestId('validation-error-row')).toHaveCount(1)
  await expect(page.getByTestId('validation-error-row')).toContainText('overlaps')
  await expect(page.getByTestId('validation-warning-row')).toContainText('without its other end')
  await page.getByTestId('validation-error-row').click()
  await expect(page.getByTestId('selection-count')).toHaveText('2 selected')
  await page.getByTestId('blueprint-canvas').press('Escape')
  await page.getByTestId('tab-inspector').click()
})

test('lists circuit networks and settings; a network row highlights its wires', async () => {
  const A = { type: 'virtual', name: 'signal-A' }
  const B = { type: 'virtual', name: 'signal-B' }
  await importViaDialog(
    encode({
      blueprint: {
        item: 'blueprint',
        label: 'Circuit check',
        version: 562954250027018,
        entities: [
          {
            entity_number: 1,
            name: 'constant-combinator',
            position: { x: 0.5, y: 0.5 },
            control_behavior: {
              sections: { sections: [{ index: 1, filters: [{ index: 1, ...A, count: 5 }] }] }
            }
          },
          {
            entity_number: 2,
            name: 'decider-combinator',
            position: { x: 3.5, y: 1 },
            control_behavior: {
              decider_conditions: {
                conditions: [{ first_signal: A, comparator: '>' }],
                outputs: [{ signal: B, copy_count_from_input: false }],
                else_outputs: []
              }
            }
          },
          {
            entity_number: 3,
            name: 'small-lamp',
            position: { x: 6.5, y: 0.5 },
            control_behavior: { circuit_enabled: true, circuit_condition: { first_signal: B } }
          }
        ],
        wires: [
          [1, 1, 2, 1],
          [2, 4, 3, 2]
        ]
      }
    } as never)
  )
  await expect(page.getByTestId('entity-count')).toHaveText('3 entities')
  await page.getByTestId('tab-analysis').click()
  await expect(page.getByTestId('section-circuits-toggle')).toContainText('1 red · 1 green')
  const settings = page.getByTestId('circuit-settings-row')
  await expect(settings).toHaveCount(3)
  await expect(settings.nth(1)).toContainText('signal-A')
  await expect(settings.nth(1)).toContainText('> 0 then')
  await expect(settings.nth(2)).toContainText('enabled when')

  const networks = page.getByTestId('circuit-networks-row')
  await expect(networks).toHaveCount(2)
  await networks.first().click()
  await expect(page.getByTestId('selection-count')).toHaveText('2 selected')
  const canvas = page.getByTestId('blueprint-canvas')
  await expect(canvas.locator('canvas')).toHaveAttribute('data-wire-highlight', '1')
  await canvas.press('Escape')
  await expect(canvas.locator('canvas')).toHaveAttribute('data-wire-highlight', '0')
  await page.getByTestId('tab-inspector').click()
})

test('rejects an invalid string with a readable message', async () => {
  await importViaDialog('this is not a blueprint')
  await expect(page.getByTestId('import-error')).toContainText('should start with "0"')
  await page.keyboard.press('Escape')
})

test('pasting anywhere imports, and books open on their active item', async () => {
  const text = corpus('balancer_book.txt')
  await page.evaluate((t) => {
    const data = new DataTransfer()
    data.setData('text/plain', t)
    document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }))
  }, text)
  const tree = page.getByTestId('book-tree')
  await expect(tree).toContainText('Balancers')
  // active_index 1 → "2 to X Balancers" book → its first item is shown, not the book.
  await expect(page.getByTestId('entity-count')).toHaveText(/\d+ entities/)

  await tree.getByText('128_128_balancer (128x95)').click()
  await expect(page.getByTestId('entity-count')).toHaveText('8512 entities')

  // Export only the selected item.
  await page.getByTestId('export-button').click()
  await page.getByText('Selected item only').click()
  const exported = decode(await page.getByTestId('export-text').inputValue())
  expect(Object.keys(exported)).toEqual(['blueprint'])
  expect((exported as { blueprint: { label: string } }).blueprint.label).toBe(
    '128_128_balancer (128x95)'
  )
  await page.keyboard.press('Escape')
})

test('stays responsive with a 16,937-entity blueprint', async () => {
  await importViaDialog(corpus('legacy-1.1/self_building_rocket_book.txt'))
  await expect(page.getByText('migrated from 1.1', { exact: true })).toBeVisible()
  await page.getByTestId('book-tree').getByText('Step 7').click()
  await expect(page.getByTestId('entity-count')).toHaveText('16937 entities')

  // Zoom and pan for ~1 s while measuring frame intervals.
  const canvas = page.getByTestId('blueprint-canvas')
  const box = (await canvas.boundingBox())!
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  await page.evaluate(() => {
    const w = window as unknown as { frames_: number[] }
    w.frames_ = []
    let last = performance.now()
    const tick = (now: number): void => {
      w.frames_.push(now - last)
      last = now
      if (w.frames_.length < 600) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  for (let i = 0; i < 30; i++) {
    await page.mouse.move(cx, cy)
    await page.mouse.wheel(0, i < 15 ? -120 : 120)
  }
  await page.mouse.move(cx, cy)
  await page.mouse.down({ button: 'middle' })
  for (let i = 0; i < 30; i++) await page.mouse.move(cx + i * 10, cy + i * 5)
  await page.mouse.up({ button: 'middle' })

  const frames = await page.evaluate(() => (window as unknown as { frames_: number[] }).frames_)
  const sorted = frames.slice(5).sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]!
  const p95 = sorted[Math.floor(sorted.length * 0.95)]!
  console.log(`frames=${sorted.length} median=${median.toFixed(1)}ms p95=${p95.toFixed(1)}ms`)
  // ≥ 50 fps (spec 04 § Level of detail). The GPU-less Windows CI runner renders
  // in software and has measured up to 31 ms, so CI only checks for 20 fps.
  expect(median).toBeLessThan(process.env['CI'] ? 50 : 20)
})
