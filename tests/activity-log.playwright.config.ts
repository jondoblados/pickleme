import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: '.', testMatch: 'activity-log.browser.spec.ts', workers: 1,
  use: { baseURL: 'http://127.0.0.1:4173/pickleme/', headless: true, acceptDownloads: true },
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173/pickleme/tests/activity-log.harness.html', reuseExistingServer: false },
})
