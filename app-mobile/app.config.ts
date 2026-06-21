import { ExpoConfig, ConfigContext } from "expo/config";

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
