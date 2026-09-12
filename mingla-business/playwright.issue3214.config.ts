import { defineConfig, devices } from '@playwright/test'

// #3214 — standalone runner for the public-page handoff proof, for local and
// tester runs. In CI the same spec runs inside the web-build lane through
// playwright.issue2771.config.ts, against the export that lane builds.
//
//   npx expo export -p web --clear --output-dir dist
//   npx playwright test -c playwright.issue3214.config.ts
//
// ISSUE_3214_WEB_BUILD points it at another export directory.
export default defineConfig({
  testDir: './playwright',
  testMatch: /issue3214-public-boot-order\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npx expo serve ${process.env.ISSUE_3214_WEB_BUILD ?? 'dist'} --port 43172`,
    cwd: '.',
    port: 43172,
    reuseExistingServer: false,
    timeout: 180_000,
  },
})
