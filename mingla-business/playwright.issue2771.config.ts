import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './playwright',
  // #3214 rides this web-build step: it needs the same real `dist` export, and
  // its boot-outcome beacon is one more analytics emission gated on the grant.
  // Both of #3214's legs run here — the implementor's happy/failure proof and the
  // independent tester adversarial suite, which additionally SCANS that same
  // export for network destinations the policy has never been asked about.
  testMatch: /(?:issue2771-preconsent-analytics(?:\.tester\.adversarial)?|issue2795-posthog-alias-consent|issue3214-public-boot-order(?:\.tester\.adversarial)?)\.spec\.ts$/,
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
