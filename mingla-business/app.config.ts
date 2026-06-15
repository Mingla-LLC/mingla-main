import { ExpoConfig, ConfigContext } from "expo/config";

type ExpoPluginEntry = NonNullable<ExpoConfig["plugins"]>[number];

const pluginName = (plugin: ExpoPluginEntry): string | null => {
  if (typeof plugin === "string") return plugin;
  if (Array.isArray(plugin) && typeof plugin[0] === "string") {
    return plugin[0];
  }
  return null;
};

const hasAppsFlyerEnv = (): boolean =>
  Boolean(
    process.env.EXPO_PUBLIC_APPSFLYER_DEV_KEY &&
    process.env.EXPO_PUBLIC_APPSFLYER_IOS_APP_ID &&
    process.env.EXPO_PUBLIC_APPSFLYER_ANDROID_APP_ID,
  );

const hasOneSignalEnv = (): boolean =>
  Boolean(process.env.EXPO_PUBLIC_ONESIGNAL_APP_ID);

const filterOptionalNativeStartupPlugins = (
  plugins: ExpoPluginEntry[] | undefined,
): ExpoPluginEntry[] =>
  (plugins ?? []).filter((plugin) => {
    const name = pluginName(plugin);
    if (name === "react-native-appsflyer") return hasAppsFlyerEnv();
    if (name === "onesignal-expo-plugin") return hasOneSignalEnv();
    return true;
  });

/**
 * Reads env at build time. Set in `.env` (EAS secrets / local):
 * - EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY
 * - EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID — must be the same Web Application client ID registered in
 *   Supabase Auth → Google (first in the comma-separated Client IDs list). Native Android ID tokens
 *   use this as `aud`.
 * - EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID — iOS ID tokens use this client as `aud`; add it to Supabase
 *   Google Client IDs as well (comma-separated after the Web client).
 */
const iosClientIdRaw =
  process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ??
  process.env.GOOGLE_IOS_CLIENT_ID ??
  "169132274606-3o5ecs4kn9fag36sbm8hesgmgl5bgf5e.apps.googleusercontent.com";

const iosClientId = iosClientIdRaw.replace(".apps.googleusercontent.com", "");

const iosUrlScheme = iosClientId
  ? `com.googleusercontent.apps.${iosClientId}`
  : "com.googleusercontent.apps.placeholder";

// [TRANSITIONAL] Apple Tap to Pay entitlement
// (`com.apple.developer.proximity-reader.payment.acceptance`) omitted from
// `ios.entitlements` in app.json until Apple approves the application.
// Re-add once approved. Used by Cycle 13 (Door Mode card-present payments).
// Not needed for Cycles 0a–12.

export default ({ config }: ConfigContext): ExpoConfig => {
  const basePlugins = filterOptionalNativeStartupPlugins(config.plugins);

  return {
    ...config,
    name: config.name ?? "Business",
    slug: config.slug ?? "mingla-business",
    // Cycle B2a — deep link scheme for Stripe Connect onboarding return.
    // expo-web-browser.openAuthSessionAsync requires this scheme to redirect
    // back into the native app after the embedded onboarding flow completes
    // at business.mingla.com/connect-onboarding. Per
    // SPEC_BIZ_CYCLE_B2A_STRIPE_CONNECT_ONBOARDING.md §3.3 A6.
    scheme: "mingla-business",
    plugins: [
      ...basePlugins,
      [
        "@react-native-google-signin/google-signin",
        {
          iosUrlScheme,
        },
      ],
      "expo-apple-authentication",
      // expo-blur 15.0.8 has no config plugin — auto-links via React Native
      // auto-linking only. Adding it as a plugin entry throws PluginError.
      // Surfaced as D-DEV-1 in implementation report.
      "expo-camera",
      [
        "expo-image-picker",
        {
          photosPermission:
            "Mingla Business uses your photo library to upload brand and event imagery.",
        },
      ],
      "expo-video",
      // ORCH-0839-B (2026-05-14): @stripe/stripe-react-native plugin removed.
      // mingla-business pivoted from native PaymentSheet to hosted Stripe
      // Checkout via expo-web-browser. Removing the plugin omits the native
      // framework on the next EAS rebuild — shrinking binary size and
      // retiring the iOS 26 + bridgeless TurboModule hang surface.
      "@sentry/react-native/expo",
      // [TRANSITIONAL] react-native-nfc-manager auto-linked via npm install
      // (D-NFC-OUTCOME = Option 3). No plugin entry required for auto-link.
      // If iOS NFC entitlement is needed for Cycle 13 door-mode, re-evaluate
      // with `expo-config-plugin-nfc-manager` (Option 1) at that time.
      // ORCH-0950: generated Android New Architecture CMake must avoid
      // React Native's bracket-unsafe generated-source glob so per-ORCH
      // worktrees such as ORCH-0950-[trip-capacity-single-source] can build.
      "./plugins/withAndroidBracketSafeCmake",
      // ORCH-0989: Xcode 26 / clang 21 cannot compile fmt 10.x consteval
      // format-string checking. Inject FMT_USE_CONSTEVAL=0 into the generated
      // Podfile post_install so iOS dev/device builds compile on this toolchain.
      "./plugins/withIosFmtConsteval",
      // ORCH-1129: GoogleSignIn 9.x → AppCheckCore (Swift) imports GoogleUtilities
      // + RecaptchaInterop, which lack module maps. Under static libraries + New
      // Architecture, CocoaPods aborts `pod install` (COMMS-0030). Inject targeted
      // `:modular_headers => true` for those 3 pods before resolution so every iOS
      // EAS build clears the Install pods phase. Compile-time only; no runtime change.
      "./plugins/withGooglePodsModularHeaders",
    ],
    extra: {
      ...config.extra,
      EXPO_PUBLIC_SUPABASE_URL:
        process.env.EXPO_PUBLIC_SUPABASE_URL ??
        "https://gqnoajqerqhnvulmnyvv.supabase.co",
      EXPO_PUBLIC_SUPABASE_ANON_KEY:
        process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdxbm9hanFlcnFobnZ1bG1ueXZ2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc1MDUyNzIsImV4cCI6MjA3MzA4MTI3Mn0.p4yi9yD2RWfJ2HN4DD-dgrvXnyzhJi3g2YCouSK-hbo",
      // Cycle B2a Path C V3 — Stripe Connect publishable key. Used by the
      // Mingla-hosted connect-onboarding page (Path B host) when initialising
      // @stripe/connect-js. Publishable keys are public-by-design (ship in client
      // bundle).
      //
      // ORCH-0954 amendment: Vercel production previously required pk_live_;
      // Vercel preview/development and local dev required pk_test_.
      //
      // pre-ORCH-1056 hotfix (2026-06-02): the live-on-production rule assumed
      // Supabase edge fns were also flipped to rk_live_*. They are NOT — Supabase
      // is on rk_test_* across the board, which silently collapses the Stripe
      // Connect embedded iframe (cross-account pk vs ak mismatch). Until the
      // unified-mode system lands (ORCH-1056), production must MATCH the
      // backend mode. MINGLA_STRIPE_MODE (defaults to "test") gates which pk
      // prefix is required on production builds.
      EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY: (() => {
        const fromEnv = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY;
        const vercelEnv = process.env.VERCEL_ENV;
        const sandboxFallback =
          "pk_test_51TTnt1PjlZyAYA40f3kjmxF6uXjfEJKfFR25LiJpVqd7qw6TYfDqqKLcNamL3JGlD2vxh94Bzn4ciaqsMNN1PJ0C00oZVosOxd";
        // Default to "live" when unset preserves the pre-hotfix behavior so a
        // mid-rollout deploy (validator landed, MINGLA_STRIPE_MODE not yet set)
        // does not start rejecting the existing pk_live_ production env. Set
        // MINGLA_STRIPE_MODE=test on Vercel + swap the pk to pk_test_* in the
        // same change to align production with the test-mode backend.
        const stripeMode = process.env.MINGLA_STRIPE_MODE ?? "live";
        if (stripeMode !== "test" && stripeMode !== "live") {
          throw new Error(
            `Unsupported MINGLA_STRIPE_MODE "${stripeMode}". Expected "test" or "live".`,
          );
        }
        const requiredPkPrefix = stripeMode === "live" ? "pk_live_" : "pk_test_";
        if (vercelEnv === "production") {
          if (!fromEnv || !fromEnv.startsWith(requiredPkPrefix)) {
            throw new Error(
              `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY must be a ${requiredPkPrefix} value for Vercel production builds when MINGLA_STRIPE_MODE=${stripeMode}.`,
            );
          }
          return fromEnv;
        }
        if (vercelEnv === "preview" || vercelEnv === "development") {
          if (!fromEnv || !fromEnv.startsWith("pk_test_")) {
            throw new Error(
              "EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY must be a pk_test_ value for Vercel preview/development builds.",
            );
          }
          return fromEnv;
        }
        if (vercelEnv !== undefined) {
          throw new Error(
            `Unsupported VERCEL_ENV "${vercelEnv}". Expected production, preview, development, or undefined.`,
          );
        }
        const localValue = fromEnv ?? sandboxFallback;
        if (!localValue.startsWith("pk_test_")) {
          throw new Error(
            "EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY must be a pk_test_ value for local development.",
          );
        }
        return localValue;
      })(),
      // ORCH-1116: fail the build (not the user) if the client-direct GIPHY key
      // is missing on a release-bound profile. GIPHY cannot be edge-proxied
      // (ToS); a missing key silently breaks the cover-picker GIF tab. Mirrors
      // the EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY guard above.
      // ORCH-1127 correction: this IIFE both (a) fails the build when the key is
      // missing on a release-bound profile AND (b) emits the resolved key into
      // `extra` below — and THAT emission IS the runtime plumbing path. The
      // giphy services read Constants.expoConfig.extra.EXPO_PUBLIC_GIPHY_API_KEY
      // FIRST (mirroring supabase.ts). The earlier assumption that the services
      // read process.env directly and "EAS inlines it" was WRONG: a DYNAMIC
      // process.env[name] read is NOT inlined by babel-preset-expo and is
      // undefined in Hermes standalone/OTA builds — only `extra` survives.
      EXPO_PUBLIC_GIPHY_API_KEY: (() => {
        const fromEnv =
          process.env.EXPO_PUBLIC_GIPHY_API_KEY ??
          process.env.EXPO_PUBLIC_GIPHY_KEY ??
          null;
        // EAS sets EAS_BUILD_PROFILE at build time; VERCEL_ENV is set for the
        // web export. A release-bound profile is one a tester/user actually
        // touches: production, production-apk, preview, preview-sim, plus the
        // Vercel production/preview web exports.
        const easProfile = process.env.EAS_BUILD_PROFILE;
        const vercelEnv = process.env.VERCEL_ENV;
        const releaseBoundEasProfiles = [
          "production",
          "production-apk",
          "preview",
          "preview-sim",
        ];
        const isReleaseBound =
          (easProfile !== undefined &&
            releaseBoundEasProfiles.includes(easProfile)) ||
          vercelEnv === "production" ||
          vercelEnv === "preview";
        if (isReleaseBound && (fromEnv === null || fromEnv.length === 0)) {
          const profileLabel = easProfile ?? vercelEnv ?? "release";
          throw new Error(
            `EXPO_PUBLIC_GIPHY_API_KEY is required for the ${profileLabel} build (cover-picker GIF tab). Provision it in the matching EAS environment.`,
          );
        }
        // Development profile / local (EAS_BUILD_PROFILE + VERCEL_ENV undefined):
        // do NOT throw — a developer without a key still gets a working dev
        // build with a degraded GIF tab (friendly copy), not a hard config
        // crash. Mirrors the Stripe guard's local-vs-production asymmetry.
        if (fromEnv === null || fromEnv.length === 0) {
          console.warn(
            "[app.config] EXPO_PUBLIC_GIPHY_API_KEY is not set — the cover-picker GIF tab will show the friendly degraded state. Set it in .env for local GIF browsing.",
          );
        }
        return fromEnv;
      })(),
      // ORCH-1138 Leg 1: client-safe PUBLIC Mapbox token for the public trip
      // page "Where you'll be" STATIC map image (Mapbox Static Images API). A
      // `pk.*` token is client-safe by design (publishable, scoped) — unlike the
      // server-only MAPBOX_ACCESS_TOKEN behind the `mapbox-geocode` edge fn. This
      // is the ONLY runtime-safe path: a DYNAMIC process.env read is NOT inlined
      // by babel-preset-expo and is undefined in Hermes standalone/OTA builds, so
      // we emit it into `extra` here and read it via
      // Constants.expoConfig.extra.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN FIRST (mirrors
      // the GIPHY/supabase pattern above). NO hardcoded literal — the value is
      // provisioned to the EAS/Vercel env + OTA shell by the operator. Absent at
      // runtime → the trip page HIDES the map gracefully (honest pin+caption
      // fallback), never crashes. Do NOT throw here: a missing token degrades a
      // single page, it does not break the build.
      EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN:
        process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN ?? null,
      // B2a Path C V3 forensics R-1: canonical Mingla Business public web URL.
      // Single source of truth read by mingla-business/src/constants/platformUrl.ts.
      // Production canonical: https://business.usemingla.com (Vercel-hosted Expo Web export).
      // Vercel build also sets this in env so the web bundle reads consistently.
      EXPO_PUBLIC_MINGLA_BUSINESS_WEB_URL:
        process.env.EXPO_PUBLIC_MINGLA_BUSINESS_WEB_URL ??
        "https://business.usemingla.com",
      googleWebClientId:
        process.env.GOOGLE_WEB_CLIENT_ID ??
        "169132274606-hp7cne780gsp7s6l1rrvbfktp6smrfs0.apps.googleusercontent.com",
      EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID:
        process.env.GOOGLE_WEB_CLIENT_ID ??
        "169132274606-hp7cne780gsp7s6l1rrvbfktp6smrfs0.apps.googleusercontent.com",
      ANDROID_CLIENT_ID:
        process.env.GOOGLE_ANDROID_CLIENT_ID ??
        "169132274606-5cmvk27gpgr9dbhu5l2o2hgg4l53fc25.apps.googleusercontent.com",
      IOS_CLIENT_ID:
        process.env.GOOGLE_IOS_CLIENT_ID ??
        "169132274606-3o5ecs4kn9fag36sbm8hesgmgl5bgf5e.apps.googleusercontent.com",
      GOOGLE_ANDROID_CLIENT_ID:
        process.env.GOOGLE_ANDROID_CLIENT_ID ??
        "169132274606-5cmvk27gpgr9dbhu5l2o2hgg4l53fc25.apps.googleusercontent.com",
    },
  };
};
