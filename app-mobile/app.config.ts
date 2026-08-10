import { ExpoConfig, ConfigContext } from "expo/config";

// ORCH-1313 (§4.C) — env-drive the AppsFlyer dev key + app IDs with a
// RELEASE-BOUND fail-loud guard. Consumer AppsFlyer works today via hard-coded
// literals; moving to env must NEVER introduce a silent-dark release. So on a
// release-bound EAS profile a MISSING value FAILS the build (loud); on local/dev
// (EAS_BUILD_PROFILE undefined) it falls back to the current literal so a
// developer without env still gets a working build. The value is emitted into
// `extra` (below) because a DYNAMIC process.env read is NOT inlined by
// babel-preset-expo and is undefined in Hermes standalone/OTA builds (COMMS-0028)
// — the service reads Constants.expoConfig.extra FIRST, then process.env.
// #1732/#1733: renamed from APPSFLYER_RELEASE_BOUND_EAS_PROFILES — the same
// four profile names now gate TWO guards (AppsFlyer ORCH-1313 and the Stripe
// publishable key below), so the constant is no longer AppsFlyer-specific. One
// list per file; `mingla-business/app.config.ts` carries the identical list
// under the identical name for the same reason.
const RELEASE_BOUND_EAS_PROFILES = [
  "production",
  "production-apk",
  "preview",
  "preview-sim",
];
const appsFlyerConfigValue = (envName: string, devFallback: string): string => {
  const fromEnv = process.env[envName];
  const easProfile = process.env.EAS_BUILD_PROFILE;
  const isReleaseBound =
    easProfile !== undefined && RELEASE_BOUND_EAS_PROFILES.includes(easProfile);
  if (isReleaseBound && (fromEnv === undefined || fromEnv.length === 0)) {
    throw new Error(
      `${envName} is required for the ${easProfile} EAS_BUILD_PROFILE build — AppsFlyer attribution would ship dark. Provision it in the matching EAS environment. [ORCH-1313]`,
    );
  }
  return fromEnv && fromEnv.length > 0 ? fromEnv : devFallback;
};

// #1733 [consumer-stripe-key-in-extra] — the Stripe publishable key, emitted
// into `extra` with a RELEASE-BOUND FAIL-LOUD guard.
//
// WHY IT MUST BE IN `extra`. A DYNAMIC `process.env[name]` read is NOT inlined
// by babel-preset-expo and is undefined in Hermes standalone/OTA builds
// (COMMS-0028) — the same lesson that put AppsFlyer and PostHog there. Until
// now this app emitted NO Stripe key at all, so `resolvePublishableKey()`
// (`packages/payments-native/StripeNativeProvider.tsx`) fell through to that
// dead dynamic read and produced `<StripeProvider publishableKey="">`.
//
// WHY IT MATTERS EVEN THOUGH CHECKOUT STILL WORKED. Every consumer payment path
// calls `initStripe()` with a SERVER-supplied key immediately before opening the
// sheet, and `initStripe` REPLACES the SDK config rather than merging, so the
// bundled key is overwritten at payment time. The 2026-08-06 blind publish did
// NOT break checkout. What it broke was DETECTABILITY: `EXPO_PUBLIC_POSTHOG_KEY`
// was this app's ONLY manifest tripwire, i.e. one thread by which a blind
// publish is visible at all. Emitting the payment key makes it directly
// assertable by #994's post-publish check and gives the app a second,
// independent tripwire (I-994-PRODUCTION-OTA-ENV-BOUND, Corollary 4).
//
// WHY THE FALLBACK IS `null` AND NOT A LITERAL. Corollary 4 is explicit: a
// tripwire that acquires a committed literal fallback resolves IDENTICALLY on a
// blind and a correct publish, which silently converts the guardrail into an
// always-green check. So local dev falls back to `null` — never a key — exactly
// like EXPO_PUBLIC_POSTHOG_KEY below. `null` is harmless at runtime: the root
// provider mounts without a bundled key and every payment path re-initialises
// with the server-supplied one anyway.
//
// The release-bound half is the AppsFlyer pattern above: on a profile a tester
// or user actually installs, a MISSING key FAILS the build loudly; on local/dev
// (EAS_BUILD_PROFILE undefined) nothing changes at all.
const stripePublishableKeyConfigValue = (): string | null => {
  const fromEnv = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  const easProfile = process.env.EAS_BUILD_PROFILE;
  const isReleaseBound =
    easProfile !== undefined && RELEASE_BOUND_EAS_PROFILES.includes(easProfile);
  if (isReleaseBound && (fromEnv === undefined || fromEnv.length === 0)) {
    throw new Error(
      `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY is required for the ${easProfile} EAS_BUILD_PROFILE build — the published update would carry no payment key, so the #994 post-publish manifest check has nothing to assert and a blind publish becomes invisible again. Provision it in the matching EAS environment. [#1733]`,
    );
  }
  return fromEnv && fromEnv.length > 0 ? fromEnv : null;
};

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: config.name ?? "Mingla",
  slug: config.slug ?? "mingla",
  plugins: [
    ...(config.plugins ?? []),
    "./plugins/withGooglePodsModularHeaders",
    [
      "@react-native-google-signin/google-signin",
      {
        iosUrlScheme: `com.googleusercontent.apps.${(process.env.GOOGLE_IOS_CLIENT_ID ?? "169132274606-k622epnsdbthemkatrctjpadcke6un46").replace(/\.apps\.googleusercontent\.com$/, "")}`,
      },
    ],
    "expo-localization",
  ],
  extra: {
    ...config.extra,
    // #1733 — FIRST on purpose. Object-literal properties evaluate in source
    // order, so whichever release-bound guard sits first is the one that speaks
    // when a release build is missing its environment. The payment key is the
    // highest-consequence value this config carries, so it refuses first and
    // the build log names it rather than an attribution key.
    EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY: stripePublishableKeyConfigValue(),
    // ORCH-1313 (§4.C) — AppsFlyer dev key + app IDs, env-driven with a
    // release-bound fail-loud guard (see appsFlyerConfigValue above). Dev
    // fallbacks are the pre-ORCH-1313 hard-coded literals so local/dev builds
    // keep working; a release build with the env UNSET fails loud. RISK-1 is
    // CLEARED: the dev-key literal digest matches the account APPSFLYER_DEV_KEY,
    // so this is pure hygiene (env-drive the SAME value), not an account change.
    EXPO_PUBLIC_APPSFLYER_DEV_KEY: appsFlyerConfigValue(
      "EXPO_PUBLIC_APPSFLYER_DEV_KEY",
      "W29Z6cqfWKvML3FdQAX27E",
    ),
    EXPO_PUBLIC_APPSFLYER_IOS_APP_ID: appsFlyerConfigValue(
      "EXPO_PUBLIC_APPSFLYER_IOS_APP_ID",
      "6760440898",
    ),
    EXPO_PUBLIC_APPSFLYER_ANDROID_APP_ID: appsFlyerConfigValue(
      "EXPO_PUBLIC_APPSFLYER_ANDROID_APP_ID",
      "com.mingla.app.v2",
    ),
    // META-ORCH-1187 [Growth Analytics Hub] Phase 1 — PostHog native keys.
    // Read at runtime via Constants.expoConfig.extra (COMMS-0028 — a dynamic
    // process.env read is NOT inlined by babel-preset-expo and is undefined in
    // Hermes standalone/OTA builds; emitting into `extra` is the runtime-safe
    // path, mirroring supabase/giphy above). The PUBLIC phc_* project key is set
    // in EAS env per profile (eas.json) — NO key literal is committed here.
    // SECRET HYGIENE: only the public phc_* key ever ships; the phx_* personal/
    // MCP key MUST NEVER appear here. Absent at runtime → postHogService no-ops.
    EXPO_PUBLIC_POSTHOG_KEY: process.env.EXPO_PUBLIC_POSTHOG_KEY ?? null,
    // US region — dispatch-locked. Default to the US host literal so the host is
    // always present even if the env is unset.
    EXPO_PUBLIC_POSTHOG_HOST:
      process.env.EXPO_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com",
    googleWebClientId:
      process.env.GOOGLE_WEB_CLIENT_ID ??
      "169132274606-hp7cne780gsp7s6l1rrvbfktp6smrfs0.apps.googleusercontent.com",
    EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID:
      process.env.GOOGLE_WEB_CLIENT_ID ??
      "169132274606-hp7cne780gsp7s6l1rrvbfktp6smrfs0.apps.googleusercontent.com",
    ANDROID_CLIENT_ID:
      process.env.GOOGLE_ANDROID_CLIENT_ID ??
      "169132274606-ibip7eu1oq892ilolnfjarqefn1d65as.apps.googleusercontent.com",
    IOS_CLIENT_ID:
      process.env.GOOGLE_IOS_CLIENT_ID ??
      "169132274606-k622epnsdbthemkatrctjpadcke6un46.apps.googleusercontent.com",
    GOOGLE_ANDROID_CLIENT_ID:
      process.env.GOOGLE_ANDROID_CLIENT_ID ??
      "169132274606-ibip7eu1oq892ilolnfjarqefn1d65as.apps.googleusercontent.com",
  },
});
