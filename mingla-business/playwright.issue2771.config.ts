import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './playwright',
  testMatch: /(?:issue2771-preconsent-analytics(?:\.tester\.adversarial)?|issue2795-posthog-alias-consent)\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  use: {
    ...devices['Desktop Chrome'],
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'npx expo serve dist --port 43172',
      cwd: '.',
      port: 43172,
      reuseExistingServer: false,
      timeout: 180_000,
    },
    {
      command: 'NEXT_PUBLIC_POSTHOG_KEY=phc_issue2771 NEXT_PUBLIC_GA4_MEASUREMENT_ID=G-ISSUE2771 npm run build && NEXT_PUBLIC_POSTHOG_KEY=phc_issue2771 NEXT_PUBLIC_GA4_MEASUREMENT_ID=G-ISSUE2771 npm run start -- --port 43171',
      cwd: '../mingla-marketing',
      port: 43171,
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
})
