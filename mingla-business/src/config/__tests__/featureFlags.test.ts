/**
 * #426 — Feature flag kill-switch contract.
 */

const ORIGINAL_ENV = process.env;

describe("featureFlags", () => {
  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  // [TEST-MOD-APPROVED #2830] Sites is intentionally dark until the separately
  // governed Gogi pilot enablement; the existing flag expectations are intact.
  test("defaults: ari and marketing on; paystack, side toggle and Sites off", async () => {
    delete process.env.EXPO_PUBLIC_FF_ARI_ENABLED;
    delete process.env.EXPO_PUBLIC_FF_MARKETING_SEND_ENABLED;
    delete process.env.EXPO_PUBLIC_FF_PAYSTACK_ENABLED;
    delete process.env.EXPO_PUBLIC_FF_ACCOUNT_SIDE_TOGGLE;
    delete process.env.EXPO_PUBLIC_FF_SITES_ENABLED;
    const { featureFlags } = await import("../featureFlags");
    expect(featureFlags.ari).toBe(true);
    expect(featureFlags.marketingSend).toBe(true);
    expect(featureFlags.paystack).toBe(false);
    expect(featureFlags.accountSideToggle).toBe(false);
    expect(featureFlags.sites).toBe(false);
  });

  test("EXPO_PUBLIC_FF_*=false disables feature", async () => {
    process.env.EXPO_PUBLIC_FF_ARI_ENABLED = "false";
    process.env.EXPO_PUBLIC_FF_MARKETING_SEND_ENABLED = "0";
    const { isFeatureEnabled, isTabVisible } = await import("../featureFlags");
    expect(isFeatureEnabled("ari")).toBe(false);
    expect(isFeatureEnabled("marketingSend")).toBe(false);
    expect(isTabVisible("ari")).toBe(false);
    expect(isTabVisible("marketing")).toBe(false);
    expect(isTabVisible("home")).toBe(true);
  });

  test("fails-on-revert: tab visibility follows flags", async () => {
    process.env.EXPO_PUBLIC_FF_ARI_ENABLED = "false";
    const { isTabVisible } = await import("../featureFlags");
    expect(isTabVisible("hub")).toBe(true);
    expect(isTabVisible("ari")).toBe(false);
  });
});
