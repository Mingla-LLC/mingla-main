import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './playwright',
  testMatch: 'issue2771-preconsent-analytics.spec.ts',
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
      command: 'EXPO_PUBLIC_POSTHOG_KEY=phc_issue2771 EXPO_PUBLIC_GA4_MEASUREMENT_ID=G-ISSUE2771 EXPO_PUBLIC_META_PIXEL_ID=issue2771 npx expo start --web --port 43172',
      cwd: '.',
      port: 43172,
      reuseExistingServer: false,
      timeout: 180_000,
    },
    {
      command: 'NEXT_PUBLIC_POSTHOG_KEY=phc_issue2771 NEXT_PUBLIC_GA4_MEASUREMENT_ID=G-ISSUE2771 npm run dev -- --port 43171',
      cwd: '../mingla-marketing',
      port: 43171,
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
})
