/**
 * ORCH-1116 [Cover picker GIF tab "This source is taking a break"] — TESTER
 * ADVERSARIAL regression (different angle from the implementor's happy-path).
 *
 * The implementor's happy-path test (CoverPicker.providerTelemetry.test.ts)
 * attacks the *telemetry split* via a re-implemented mirror of the helper plus
 * source-string assertions on CoverPicker.tsx. It NEVER exercises the real
 * `app.config.ts` fail-loud guard at runtime — SC-3 / SC-4 there are only an
 * uncommitted manual env-probe in the implementation report, and the strict-grep
 * gate only checks the guard exists *textually*.
 *
 * This test attacks the OTHER load-bearing half: the REAL exported
 * `app.config.ts` default function, invoked with a controlled `process.env`
 * matrix, asserting the actual THROW / NO-THROW behavior of the GIPHY guard
 * (§4.B, SC-3/SC-4) — including the VERCEL_ENV web-export branch the implementor
 * never covered with a committed test, and the key-plumbing (value lands in
 * `extra`) the SPEC requires. It also proves the dev/local asymmetry does not
 * crash a keyless dev build.
 *
 * Masking note: the sibling `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` guard runs in
 * the same `extra` object and throws FIRST on Vercel profiles when the Stripe
 * key is absent/wrong. So for VERCEL_ENV cases we supply a valid Stripe pk to
 * get past it and isolate the GIPHY assertion. EAS_BUILD_PROFILE-only cases set
 * no VERCEL_ENV, so the Stripe guard takes its local sandbox-fallback path and
 * does not interfere.
 *
 * Fails-on-revert: if the GIPHY guard IIFE in app.config.ts is reduced to a
 * passthrough (the throw removed), the THROW assertions below FAIL.
 */

// expo/config is types-only at runtime here; app.config.ts imports it solely for
// ExpoConfig / ConfigContext type names, so no runtime mock is needed under
// ts-jest's type-erasing transform. We still provide a stub to be safe.
jest.mock(
  "expo/config",
  () => ({}),
  { virtual: true },
);

// A minimal ConfigContext.config — the default fn only reads config.plugins,
// config.name, config.slug, etc., all optional-tolerant.
const FAKE_CTX = { config: { plugins: [] } } as never;

// Valid live publishable key shape so the Stripe guard passes on Vercel
// production (stripeMode defaults to "live"). NOT a real secret — shape only.
const FAKE_PK_LIVE = "pk_live_" + "0".repeat(24);
const FAKE_PK_TEST = "pk_test_" + "0".repeat(24);

// [ORCH-1062 drift-update] ORCH-1313 (§4.C) added a SIBLING AppsFlyer fail-loud
// guard that runs BEFORE the GIPHY guard on release-bound EAS profiles
// (production / production-apk / preview / preview-sim; app.config.ts:60-81).
// It throws when the three AppsFlyer env vars are unset — masking the GIPHY
// assertion on the EAS-profile cases (A1/A2/A7/A8). Supply a valid AppsFlyer env
// on those cases to get past it and isolate the GIPHY throw/no-throw behavior,
// exactly as the Stripe pk_live above already masks the Stripe guard on
// VERCEL_ENV cases. Shape-only placeholders, NOT real keys.
const FAKE_APPSFLYER_ENV = {
  EXPO_PUBLIC_APPSFLYER_DEV_KEY: "af_dev_key_placeholder",
  EXPO_PUBLIC_APPSFLYER_IOS_APP_ID: "id0000000000",
  EXPO_PUBLIC_APPSFLYER_ANDROID_APP_ID: "com.mingla.business.placeholder",
} as const;

const ORIGINAL_ENV = process.env;

function runConfigWithEnv(env: Record<string, string | undefined>): unknown {
  jest.resetModules();
  process.env = { ...ORIGINAL_ENV, ...env } as NodeJS.ProcessEnv;
  // Re-require after env mutation so the module reads the fresh process.env.
  // app.config.ts has no top-level env reads that matter to the guard — the
  // guard IIFE runs when the default fn is invoked.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require("../../app.config").default as (ctx: never) => {
    extra?: Record<string, unknown>;
  };
  return mod(FAKE_CTX);
}

describe("ORCH-1116 app.config GIPHY fail-loud guard (real default fn)", () => {
  afterEach(() => {
    process.env = ORIGINAL_ENV;
    jest.resetModules();
  });

  // ---- SC-3: release-bound profiles THROW when the GIPHY key is absent ------

  test("A1 — EAS preview profile, NO giphy key → THROWS with explicit message", () => {
    expect(() =>
      runConfigWithEnv({
        EAS_BUILD_PROFILE: "preview",
        VERCEL_ENV: undefined,
        ...FAKE_APPSFLYER_ENV, // [ORCH-1062] past the ORCH-1313 AppsFlyer guard.
        // [#1732 drift-update] The comment below is NO LONGER TRUE. #1732 made
        // the Stripe branch fail CLOSED on a release-bound EAS_BUILD_PROFILE
        // under live mode (the mode defaults to live), so the sandbox fallback
        // now THROWS here and would mask the GIPHY assertion — exactly as the
        // AppsFlyer guard already did. Supply a valid pk_live to get past it,
        // the same masking convention A3 uses for the Vercel branch.
        EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY: FAKE_PK_LIVE,
        EXPO_PUBLIC_GIPHY_API_KEY: undefined,
        EXPO_PUBLIC_GIPHY_KEY: undefined,
        // No VERCEL_ENV → Stripe guard uses sandbox fallback, no interference.
      }),
    ).toThrow(/EXPO_PUBLIC_GIPHY_API_KEY is required for the preview build/);
  });

  test("A2 — EAS production-apk profile, NO giphy key → THROWS", () => {
    expect(() =>
      runConfigWithEnv({
        EAS_BUILD_PROFILE: "production-apk",
        VERCEL_ENV: undefined,
        ...FAKE_APPSFLYER_ENV, // [ORCH-1062] past the ORCH-1313 AppsFlyer guard.
        EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY: FAKE_PK_LIVE, // [#1732] past the release-bound Stripe guard.
        EXPO_PUBLIC_GIPHY_API_KEY: undefined,
        EXPO_PUBLIC_GIPHY_KEY: undefined,
      }),
    ).toThrow(/EXPO_PUBLIC_GIPHY_API_KEY is required for the production-apk build/);
  });

  test("A3 — VERCEL_ENV=production web export, NO giphy key → THROWS (web branch the implementor never committed-tested)", () => {
    expect(() =>
      runConfigWithEnv({
        EAS_BUILD_PROFILE: undefined,
        VERCEL_ENV: "production",
        // Stripe pk_live supplied so the Stripe guard passes and we reach GIPHY.
        EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY: FAKE_PK_LIVE,
        MINGLA_STRIPE_MODE: "live",
        EXPO_PUBLIC_GIPHY_API_KEY: undefined,
        EXPO_PUBLIC_GIPHY_KEY: undefined,
      }),
    ).toThrow(/EXPO_PUBLIC_GIPHY_API_KEY is required for the production build/);
  });

  test("A4 — VERCEL_ENV=preview web export, NO giphy key → THROWS", () => {
    expect(() =>
      runConfigWithEnv({
        EAS_BUILD_PROFILE: undefined,
        VERCEL_ENV: "preview",
        EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY: FAKE_PK_TEST,
        EXPO_PUBLIC_GIPHY_API_KEY: undefined,
        EXPO_PUBLIC_GIPHY_KEY: undefined,
      }),
    ).toThrow(/EXPO_PUBLIC_GIPHY_API_KEY is required for the preview build/);
  });

  // ---- SC-4: dev / local do NOT throw on a missing key ----------------------

  test("A5 — EAS development profile, NO giphy key → does NOT throw (dev asymmetry)", () => {
    let result: { extra?: Record<string, unknown> } | undefined;
    expect(() => {
      result = runConfigWithEnv({
        EAS_BUILD_PROFILE: "development",
        VERCEL_ENV: undefined,
        EXPO_PUBLIC_GIPHY_API_KEY: undefined,
        EXPO_PUBLIC_GIPHY_KEY: undefined,
      }) as { extra?: Record<string, unknown> };
    }).not.toThrow();
    // Keyless dev build → the guard returns null into extra (degraded GIF tab).
    expect(result?.extra?.EXPO_PUBLIC_GIPHY_API_KEY ?? null).toBeNull();
  });

  test("A6 — local (no EAS_BUILD_PROFILE, no VERCEL_ENV), NO giphy key → does NOT throw", () => {
    expect(() =>
      runConfigWithEnv({
        EAS_BUILD_PROFILE: undefined,
        VERCEL_ENV: undefined,
        EXPO_PUBLIC_GIPHY_API_KEY: undefined,
        EXPO_PUBLIC_GIPHY_KEY: undefined,
      }),
    ).not.toThrow();
  });

  // ---- Key plumbing + fallback name ----------------------------------------

  test("A7 — release-bound profile WITH key present → no throw AND value plumbed into extra", () => {
    let result: { extra?: Record<string, unknown> } | undefined;
    expect(() => {
      result = runConfigWithEnv({
        EAS_BUILD_PROFILE: "preview",
        VERCEL_ENV: undefined,
        ...FAKE_APPSFLYER_ENV, // [ORCH-1062] past the ORCH-1313 AppsFlyer guard.
        EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY: FAKE_PK_LIVE, // [#1732] past the release-bound Stripe guard.
        EXPO_PUBLIC_GIPHY_API_KEY: "gphy_dummy_key_value_abcdef ".trim(),
        EXPO_PUBLIC_GIPHY_KEY: undefined,
      }) as { extra?: Record<string, unknown> };
    }).not.toThrow();
    expect(result?.extra?.EXPO_PUBLIC_GIPHY_API_KEY).toBe("gphy_dummy_key_value_abcdef");
  });

  test("A8 — only the legacy EXPO_PUBLIC_GIPHY_KEY name set on a release profile → satisfies the guard (no throw, fallback honored)", () => {
    expect(() =>
      runConfigWithEnv({
        EAS_BUILD_PROFILE: "preview",
        VERCEL_ENV: undefined,
        ...FAKE_APPSFLYER_ENV, // [ORCH-1062] past the ORCH-1313 AppsFlyer guard.
        EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY: FAKE_PK_LIVE, // [#1732] past the release-bound Stripe guard.
        EXPO_PUBLIC_GIPHY_API_KEY: undefined,
        EXPO_PUBLIC_GIPHY_KEY: "legacy_giphy_fallback_key_value",
      }),
    ).not.toThrow();
  });
});
