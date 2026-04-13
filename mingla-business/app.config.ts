import { ExpoConfig, ConfigContext } from "expo/config";

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

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: config.name ?? "mingla-business",
  slug: config.slug ?? "mingla-business",
  plugins: [
    ...(config.plugins ?? []),
    [
      "@react-native-google-signin/google-signin",
      {
        iosUrlScheme,
      },
    ],
    "expo-apple-authentication",
  ],
  extra: {
    ...config.extra,
    EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL ?? "",
    EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "",
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
});
