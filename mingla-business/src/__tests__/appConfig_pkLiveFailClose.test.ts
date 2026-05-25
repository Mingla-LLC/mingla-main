import path from "node:path";

const appConfigPath = path.resolve(__dirname, "../../app.config.ts");

const loadConfig = (): { extra?: Record<string, unknown> } => {
  jest.resetModules();
  const mod = require(appConfigPath);
  return mod.default({ config: {} });
};

describe("ORCH-0954 amendment — mingla-business publishable key fail-close", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  it("throws for Vercel production build with missing publishable key", () => {
    process.env.VERCEL_ENV = "production";
    delete process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    expect(loadConfig).toThrow(/pk_live_/);
  });

  it("throws for Vercel production build with pk_test publishable key", () => {
    process.env.VERCEL_ENV = "production";
    process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY = "pk_test_bad";
    expect(loadConfig).toThrow(/pk_live_/);
  });

  it("accepts pk_live publishable key for Vercel production", () => {
    process.env.VERCEL_ENV = "production";
    process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY = "pk_live_ok";
    const config = loadConfig();
    expect(config.extra?.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY).toBe("pk_live_ok");
  });

  it("throws for Vercel preview with pk_live publishable key", () => {
    process.env.VERCEL_ENV = "preview";
    process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY = "pk_live_bad";
    expect(loadConfig).toThrow(/pk_test_/);
  });

  it("accepts pk_test publishable key for Vercel preview", () => {
    process.env.VERCEL_ENV = "preview";
    process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY = "pk_test_ok";
    const config = loadConfig();
    expect(config.extra?.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY).toBe("pk_test_ok");
  });

  it("keeps sandbox fallback outside Vercel builds", () => {
    delete process.env.VERCEL_ENV;
    delete process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    const config = loadConfig();
    expect(config.extra?.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY).toMatch(/^pk_test_/);
  });

  it("throws outside Vercel builds with pk_live publishable key", () => {
    delete process.env.VERCEL_ENV;
    process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY = "pk_live_bad";
    expect(loadConfig).toThrow(/pk_test_/);
  });
});
