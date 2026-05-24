import path from "node:path";

const appConfigPath = path.resolve(__dirname, "../../app.config.ts");

const loadConfig = (): { extra?: Record<string, unknown> } => {
  jest.resetModules();
  const mod = require(appConfigPath);
  return mod.default({ config: {} });
};

describe("ORCH-0953 §3.2 — mingla-business publishable key fail-close", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  it("throws for production build with missing publishable key", () => {
    process.env.EAS_BUILD_PROFILE = "production";
    delete process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    expect(loadConfig).toThrow(/pk_live_/);
  });

  it("throws for production build with pk_test publishable key", () => {
    process.env.EAS_BUILD_PROFILE = "production";
    process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY = "pk_test_bad";
    expect(loadConfig).toThrow(/pk_live_/);
  });

  it("keeps sandbox fallback outside production builds", () => {
    process.env.EAS_BUILD_PROFILE = "development";
    delete process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    const config = loadConfig();
    expect(config.extra?.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY).toMatch(/^pk_test_/);
  });
});
