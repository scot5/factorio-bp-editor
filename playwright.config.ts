import { defineConfig } from '@playwright/test'

// End-to-end tests launch the built app (out/) through Playwright's Electron
// support. `pnpm test:e2e` builds first.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  workers: 1,
  reporter: process.env['CI'] ? 'github' : 'list'
})
