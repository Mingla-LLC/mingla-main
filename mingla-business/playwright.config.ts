import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.META_ORCH_0952_PORT ?? 43095);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./src/components/checkout/__tests__",
  testMatch: /meta_orch_0952_.*\.test\.ts$/,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npm run web:export && node playwright/meta-orch-0952-static-server.mjs web-build ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      ...process.env,
      EXPO_PUBLIC_SUPABASE_URL: "https://meta-orch-0952.supabase.co",
      EXPO_PUBLIC_SUPABASE_ANON_KEY: "meta-orch-0952-anon-key",
      EXPO_PUBLIC_MINGLA_BUSINESS_WEB_URL: baseURL,
    },
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
  ],
});
