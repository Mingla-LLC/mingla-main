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
const APPSFLYER_RELEASE_BOUND_EAS_PROFILES = [
  "production",
  "production-apk",
  "preview",
  "preview-sim",
];
const appsFlyerConfigValue = (envName: string, devFallback: string): string => {
  const fromEnv = process.env[envName];
  const easProfile = process.env.EAS_BUILD_PROFILE;
  const isReleaseBound =
    easProfile !== undefined &&
    APPSFLYER_RELEASE_BOUND_EAS_PROFILES.includes(easProfile);
  if (isReleaseBound && (fromEnv === undefined || fromEnv.length === 0)) {
    throw new Error(
      `${envName} is required for the ${easProfile} EAS_BUILD_PROFILE build — AppsFlyer attribution would ship dark. Provision it in the matching EAS environment. [ORCH-1313]`,
    );
  }
  return fromEnv && fromEnv.length > 0 ? fromEnv : devFallback;
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
