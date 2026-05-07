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
  // Cycle B2a — deep link scheme for Stripe Connect onboarding return.
  // expo-web-browser.openAuthSessionAsync requires this scheme to redirect
  // back into the native app after the embedded onboarding flow completes
  // at business.mingla.com/connect-onboarding. Per
  // SPEC_BIZ_CYCLE_B2A_STRIPE_CONNECT_ONBOARDING.md §3.3 A6.
  scheme: "mingla-business",
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
    EXPO_PUBLIC_SUPABASE_URL:
      process.env.EXPO_PUBLIC_SUPABASE_URL ??
      "https://gqnoajqerqhnvulmnyvv.supabase.co",
    EXPO_PUBLIC_SUPABASE_ANON_KEY:
      process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdxbm9hanFlcnFobnZ1bG1ueXZ2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc1MDUyNzIsImV4cCI6MjA3MzA4MTI3Mn0.p4yi9yD2RWfJ2HN4DD-dgrvXnyzhJi3g2YCouSK-hbo",
    // Cycle B2a Path C V3 — Stripe Connect publishable key. Used by the
    // Mingla-hosted connect-onboarding page (Path B host) when initialising
    // @stripe/connect-js. Publishable keys are public-by-design (ship in client
    // bundle); operator MUST set EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY in EAS env
    // for production builds. Test fallback is `pk_test_…` from the MINGLA LLC
    // sandbox account `acct_1TTnt1PjlZyAYA40` per V3 SPEC §13 amendment A2.
    EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY:
      process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ??
      "pk_test_51TTnt1PjlZyAYA40f3kjmxF6uXjfEJKfFR25LiJpVqd7qw6TYfDqqKLcNamL3JGlD2vxh94Bzn4ciaqsMNN1PJ0C00oZVosOxd",
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
