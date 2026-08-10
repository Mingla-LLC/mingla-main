/**
 * #1732 [payment-key-fail-closed] — IMPLEMENTOR happy-path regression.
 *
 * WHAT THIS PINS, in one paragraph. `mingla-business/app.config.ts` resolves
 * EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY through four branches. Three are strict.
 * The fourth — `VERCEL_ENV === undefined`, which covers BOTH a native EAS build
 * AND local dev — was asymmetric: it rejected a pk_live_ value under
 * MINGLA_STRIPE_MODE=test, but ACCEPTED a pk_test_ value under mode=live, in
 * silence. Because the mode DEFAULTS to "live" (app.config.ts), a native release
 * build with the environment absent resolved to the committed pk_test_ sandbox
 * literal and shipped it against the live backend. That is the #990 brick:
 * verifyStripeModeAlignment() throws at boot, the ErrorBoundary unmounts the
 * component holding the pending SplashScreen.hideAsync(), and the app sticks on
 * the splash forever.
 *
 * WHY THE OBVIOUS RULE IS WRONG, and why these cases are shaped the way they
 * are. "Require pk_live_ whenever stripeMode is live" cannot be used: local dev
 * with no env resolves to mode=live PLUS the sandbox fallback, i.e. exactly the
 * combination that rule rejects, so every developer's `expo config` and every CI
 * config read would start throwing. EAS_BUILD_PROFILE is the discriminator — EAS
 * sets it, local dev does not — so B5/B6 below are as load-bearing as B1/B2: a
 * fix that failed closed on local dev would be a worse bug than the one it fixed.
 *
 * WHY THIS IS NOT A DUPLICATE of appConfig_pkLiveFailClose.test.ts. That file
 * covers the Vercel branches and the ORCH-1214 native pk_live acceptance. NONE
 * of its cases set EAS_BUILD_PROFILE, so none of them reach the branch this
 * issue is about.
 *
 * FAILS-ON-REVERT: delete the `isReleaseBoundStripeBuild` throw from
 * app.config.ts (true line deletion, not a comment-out) and B1/B2/B3 go red —
 * the config resolves the sandbox literal and returns 0.
 *
 * NOTE ON GUARD ORDER. Two SIBLING release-bound guards run before this one on a
 * release-bound profile: the ORCH-1313 AppsFlyer guard (top of the default fn)
 * and — after the Stripe key in `extra` — the ORCH-1116 GIPHY guard. AppsFlyer
 * is supplied on every case here so the Stripe branch is what is actually being
 * measured; without it a green run would prove only that SOMETHING threw.
 */

import path from "node:path";

const appConfigPath = path.resolve(__dirname, "../../app.config.ts");

const ORIGINAL_ENV = process.env;

/** Shape-only placeholders. NOT real keys, and not real secrets. */
const FAKE_PK_LIVE = "pk_live_" + "0".repeat(24);
const FAKE_APPSFLYER_ENV = {
  EXPO_PUBLIC_APPSFLYER_DEV_KEY: "af_dev_key_placeholder",
  EXPO_PUBLIC_APPSFLYER_IOS_APP_ID: "id0000000000",
  EXPO_PUBLIC_APPSFLYER_ANDROID_APP_ID: "com.mingla.business.placeholder",
  EXPO_PUBLIC_GIPHY_API_KEY: "giphy_key_placeholder",
} as const;

function runConfigWithEnv(env: Record<string, string | undefined>): {
  extra?: Record<string, unknown>;
} {
  jest.resetModules();
  process.env = {
    ...ORIGINAL_ENV,
    ...FAKE_APPSFLYER_ENV,
    ...env,
  } as NodeJS.ProcessEnv;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require(appConfigPath).default as (ctx: never) => {
    extra?: Record<string, unknown>;
  };
  return mod({ config: { plugins: [] } } as never);
}

describe("#1732 — mingla-business release-bound Stripe fail-close", () => {
  afterEach(() => {
    process.env = ORIGINAL_ENV;
    jest.resetModules();
  });

  // ---- the hole, closed. A release build may not resolve a non-live key. ----

  it.each(["production", "production-apk", "preview", "preview-sim"])(
    "B1 — EAS %s profile + live mode + NO key → THROWS instead of shipping the sandbox literal",
    (profile) => {
      expect(() =>
        runConfigWithEnv({
          EAS_BUILD_PROFILE: profile,
          VERCEL_ENV: undefined,
          MINGLA_STRIPE_MODE: "live",
          EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY: undefined,
        }),
      ).toThrow(/must be a pk_live_ value for the .* EAS_BUILD_PROFILE build/);
    },
  );

  it("B1b — the default (UNSET) mode is live, so an unset MINGLA_STRIPE_MODE must throw too", () => {
    // This is the actual production shape of the bug: nobody sets the mode on a
    // native build, the config defaults it to "live", and the sandbox literal
    // sailed through. A guard that only fired on an EXPLICIT mode=live would
    // have missed every real occurrence.
    expect(() =>
      runConfigWithEnv({
        EAS_BUILD_PROFILE: "production",
        VERCEL_ENV: undefined,
        MINGLA_STRIPE_MODE: undefined,
        EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY: undefined,
      }),
    ).toThrow(/must be a pk_live_ value for the production EAS_BUILD_PROFILE build/);
  });

  it("B2 — the failure names the #990 consequence and the issue, not just the constraint", () => {
    // A build log that says only "wrong prefix" gets a key pasted in from
    // wherever is nearest. The message has to say what shipping it does.
    expect(() =>
      runConfigWithEnv({
        EAS_BUILD_PROFILE: "production",
        VERCEL_ENV: undefined,
        MINGLA_STRIPE_MODE: "live",
        EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY: undefined,
      }),
    ).toThrow(/#990 boot brick[\s\S]*splash screen[\s\S]*\[#1732\]/);
  });

  it("B3 — an EXPLICIT pk_test_ key on a release profile under live mode also throws", () => {
    // Not only the fallback: a human pasting the sandbox key into the EAS
    // environment produces the identical brick and must be refused identically.
    expect(() =>
      runConfigWithEnv({
        EAS_BUILD_PROFILE: "production",
        VERCEL_ENV: undefined,
        MINGLA_STRIPE_MODE: "live",
        EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_pastedbyhand",
      }),
    ).toThrow(/must be a pk_live_ value for the production EAS_BUILD_PROFILE build/);
  });

  it("B4 — the resolved value is never echoed in full (only a truncated prefix)", () => {
    const secretish = "pk_test_" + "S3CR3T".repeat(6);
    let message = "";
    try {
      runConfigWithEnv({
        EAS_BUILD_PROFILE: "production",
        VERCEL_ENV: undefined,
        MINGLA_STRIPE_MODE: "live",
        EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY: secretish,
      });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain("pk_test_");
    expect(message).not.toContain(secretish);
  });

  // ---- the half that must NOT change: a release build with a live key, and
  // ---- every non-release-bound path, are untouched.

  it("B5 — a pk_live_ key on a release profile still resolves and lands in extra", () => {
    const config = runConfigWithEnv({
      EAS_BUILD_PROFILE: "production",
      VERCEL_ENV: undefined,
      MINGLA_STRIPE_MODE: "live",
      EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY: FAKE_PK_LIVE,
    });
    expect(config.extra?.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY).toBe(FAKE_PK_LIVE);
  });

  it("B6 — LOCAL DEV (no EAS_BUILD_PROFILE) with no key still resolves the sandbox literal", () => {
    // The whole reason the guard is keyed on EAS_BUILD_PROFILE rather than on
    // the mode. This is also the exact condition #994's S-4 assertion pins: the
    // sanitiser deletes EAS_BUILD_PROFILE, so S-4 must keep passing unchanged.
    const config = runConfigWithEnv({
      EAS_BUILD_PROFILE: undefined,
      VERCEL_ENV: undefined,
      MINGLA_STRIPE_MODE: undefined,
      EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY: undefined,
    });
    expect(config.extra?.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY).toMatch(/^pk_test_/);
  });

  it("B7 — a NON-release-bound EAS profile (development) with no key does not throw", () => {
    const config = runConfigWithEnv({
      EAS_BUILD_PROFILE: "development",
      VERCEL_ENV: undefined,
      MINGLA_STRIPE_MODE: "live",
      EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY: undefined,
    });
    expect(config.extra?.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY).toMatch(/^pk_test_/);
  });

  it("B8 — a release profile under TEST mode still accepts the sandbox literal", () => {
    // The guard is scoped to live mode on purpose: a deliberate test-mode
    // release build (mode explicitly flipped) is a legitimate, if rare, shape,
    // and the pre-existing pk_live-under-test rejection already covers the
    // mirror-image mistake.
    const config = runConfigWithEnv({
      EAS_BUILD_PROFILE: "production",
      VERCEL_ENV: undefined,
      MINGLA_STRIPE_MODE: "test",
      EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY: undefined,
    });
    expect(config.extra?.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY).toMatch(/^pk_test_/);
  });

  it("B9 — the pre-existing pk_live-under-test rejection (ORCH-1214) is unchanged", () => {
    expect(() =>
      runConfigWithEnv({
        EAS_BUILD_PROFILE: "production",
        VERCEL_ENV: undefined,
        MINGLA_STRIPE_MODE: "test",
        EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY: FAKE_PK_LIVE,
      }),
    ).toThrow(/pk_live_ value but MINGLA_STRIPE_MODE=test/);
  });

  it("B10 — the Vercel production branch is untouched by the EAS-profile guard", () => {
    // VERCEL_ENV takes the earlier branch, so a release-bound EAS profile set in
    // the same environment must not change that branch's verdict.
    const config = runConfigWithEnv({
      EAS_BUILD_PROFILE: "production",
      VERCEL_ENV: "production",
      MINGLA_STRIPE_MODE: "live",
      EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY: FAKE_PK_LIVE,
    });
    expect(config.extra?.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY).toBe(FAKE_PK_LIVE);
  });

  // ---- vacuity guard: the fixture must really be exercising the branch. ----

  it("B11 — the sandbox literal really is what the local branch returns (anti-vacuity)", () => {
    // If this stopped being true, B6/B7/B8 would be passing because the config
    // returned SOMETHING pk_test_-shaped from a path nobody intended, and the
    // B1 throw cases would be proving nothing about the fallback.
    const config = runConfigWithEnv({
      EAS_BUILD_PROFILE: undefined,
      VERCEL_ENV: undefined,
      MINGLA_STRIPE_MODE: undefined,
      EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY: undefined,
    });
    const resolved = String(config.extra?.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "");
    expect(resolved.startsWith("pk_test_51TTnt1")).toBe(true);
    expect(resolved.length).toBeGreaterThan(50);
  });
});
