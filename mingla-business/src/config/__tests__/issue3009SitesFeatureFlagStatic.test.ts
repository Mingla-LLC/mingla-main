import fs from "node:fs";
import path from "node:path";

const ORIGINAL_ENV = process.env;

describe("#3009 statically bundled Business feature flags", () => {
  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  test("the Sites pilot switch enables and disables at module evaluation", async () => {
    process.env.EXPO_PUBLIC_FF_SITES_ENABLED = "true";
    const enabled = await import("../featureFlags");
    expect(enabled.isFeatureEnabled("sites")).toBe(true);

    jest.resetModules();
    process.env.EXPO_PUBLIC_FF_SITES_ENABLED = "false";
    const disabled = await import("../featureFlags");
    expect(disabled.isFeatureEnabled("sites")).toBe(false);
  });

  test("every Expo public flag uses a statically substitutable member read", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "../featureFlags.ts"),
      "utf8",
    );

    expect(source).not.toContain("process.env[");
    for (const name of [
      "EXPO_PUBLIC_FF_ARI_ENABLED",
      "EXPO_PUBLIC_FF_MARKETING_SEND_ENABLED",
      "EXPO_PUBLIC_FF_PAYSTACK_ENABLED",
      "EXPO_PUBLIC_FF_ACCOUNT_SIDE_TOGGLE",
      "EXPO_PUBLIC_FF_SITES_ENABLED",
    ]) {
      expect(source).toContain(`process.env.${name}`);
    }
  });
});
