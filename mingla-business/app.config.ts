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
  process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? "618060733220-bdodi6h019rgnem7vrbmnn4ldued71do.apps.googleusercontent.com";

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
    EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL ?? "https://gqnoajqerqhnvulmnyvv.supabase.co",
    EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdxbm9hanFlcnFobnZ1bG1ueXZ2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc1MDUyNzIsImV4cCI6MjA3MzA4MTI3Mn0.p4yi9yD2RWfJ2HN4DD-dgrvXnyzhJi3g2YCouSK-hbo",
    googleWebClientId:
      process.env.GOOGLE_WEB_CLIENT_ID ??
      "618060733220-l9ls35bklsvlqbj7ii9v5tiok9neqhee.apps.googleusercontent.com",
    EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID:
      process.env.GOOGLE_WEB_CLIENT_ID ??
      "618060733220-l9ls35bklsvlqbj7ii9v5tiok9neqhee.apps.googleusercontent.com",
    ANDROID_CLIENT_ID:
      process.env.GOOGLE_ANDROID_CLIENT_ID ??
      "618060733220-hvlvia73dcm2sd5hgbvnp59bnas46gt0.apps.googleusercontent.com",
    IOS_CLIENT_ID:
      process.env.GOOGLE_IOS_CLIENT_ID ??
      "618060733220-t2vsovng5evma3vfkl0fd0f0pa28lnlc.apps.googleusercontent.com",
    GOOGLE_ANDROID_CLIENT_ID:
      process.env.GOOGLE_ANDROID_CLIENT_ID ??
      "618060733220-hvlvia73dcm2sd5hgbvnp59bnas46gt0.apps.googleusercontent.com",
  },
});
