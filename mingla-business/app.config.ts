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

// [TRANSITIONAL] Apple Tap to Pay entitlement
// (`com.apple.developer.proximity-reader.payment.acceptance`) omitted from
// `ios.entitlements` in app.json until Apple approves the application.
// Re-add once approved. Used by Cycle 13 (Door Mode card-present payments).
// Not needed for Cycles 0a–12.

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
    [
      "@stripe/stripe-react-native",
      {
        merchantIdentifier: "merchant.com.sethogieva.minglabusiness",
        enableGooglePay: true,
      },
    ],
    "@sentry/react-native/expo",
    // [TRANSITIONAL] react-native-nfc-manager auto-linked via npm install
    // (D-NFC-OUTCOME = Option 3). No plugin entry required for auto-link.
    // If iOS NFC entitlement is needed for Cycle 13 door-mode, re-evaluate
    // with `expo-config-plugin-nfc-manager` (Option 1) at that time.
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
