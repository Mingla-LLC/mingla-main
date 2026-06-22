import path from "node:path";

const appConfigPath = path.resolve(__dirname, "../../app.config.ts");

const loadConfig = (): { extra?: Record<string, unknown> } => {
  jest.resetModules();
  const mod = require(appConfigPath);
  return mod.default({ config: {} });
};

describe("ORCH-0954 amendment — mingla-business publishable key fail-close", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // The release-bound (Vercel production/preview) cases also pass through the
    // ORCH-1116 GIPHY fail-loud config-eval guard, which throws when
    // EXPO_PUBLIC_GIPHY_API_KEY is absent. Provision it so these cases exercise
    // the Stripe-key branch (the subject under test), not the GIPHY guard.
    process.env.EXPO_PUBLIC_GIPHY_API_KEY = "test_giphy_key";
  });

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

});

describe("ORCH-1214 — native EAS build (VERCEL_ENV undefined) accepts pk_live_ under live mode", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  // Case (a): pk_live_ + MINGLA_STRIPE_MODE=live → SUCCEEDS, key passes through.
  // This is the live EAS production build path that branch 4 previously crashed.
  it("accepts a pk_live_ key when MINGLA_STRIPE_MODE=live (native live production build)", () => {
    delete process.env.VERCEL_ENV;
    process.env.MINGLA_STRIPE_MODE = "live";
    process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY = "pk_live_ok1214";
    const config = loadConfig();
    expect(config.extra?.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY).toBe("pk_live_ok1214");
  });

  // Case (b): pk_live_ + MINGLA_STRIPE_MODE=test → THROWS the mode-mismatch error.
  it("throws when a pk_live_ key is paired with MINGLA_STRIPE_MODE=test", () => {
    delete process.env.VERCEL_ENV;
    process.env.MINGLA_STRIPE_MODE = "test";
    process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY = "pk_live_ok1214";
    expect(loadConfig).toThrow(
      /pk_live_ value but MINGLA_STRIPE_MODE=test/,
    );
  });

  // Case (c): unset key → sandbox pk_test_ fallback → SUCCEEDS regardless of mode.
  it("keeps the sandbox pk_test_ fallback when the key is unset (local dev / native test)", () => {
    delete process.env.VERCEL_ENV;
    delete process.env.MINGLA_STRIPE_MODE;
    delete process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    const config = loadConfig();
    expect(config.extra?.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY).toMatch(/^pk_test_/);
  });

  // A pk_test_ key is still accepted under test mode (local dev with explicit key).
  it("accepts a pk_test_ key under test mode", () => {
    delete process.env.VERCEL_ENV;
    process.env.MINGLA_STRIPE_MODE = "test";
    process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY = "pk_test_localdev";
    const config = loadConfig();
    expect(config.extra?.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY).toBe("pk_test_localdev");
  });

  // A non-pk_test_/non-pk_live_ value is still rejected with the generalized message.
  it("throws for a value that is neither pk_test_ nor pk_live_", () => {
    delete process.env.VERCEL_ENV;
    process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY = "sk_live_wrong";
    expect(loadConfig).toThrow(
      /must be a pk_test_ \(test\/local\) or pk_live_ \(live\) value/,
    );
  });
});
