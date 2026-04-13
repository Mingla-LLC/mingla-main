import { ExpoConfig, ConfigContext } from "expo/config";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: config.name ?? "Mingla",
  slug: config.slug ?? "mingla",
  ios: {
    ...config.ios,
    config: {
      googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY ?? "",
    },
  },
  android: {
    ...config.android,
    config: {
      googleMaps: {
        apiKey: process.env.GOOGLE_MAPS_API_KEY ?? "",
      },
    },
  },
  plugins: [
    ...(config.plugins ?? []),
    [
      "@react-native-google-signin/google-signin",
      {
        iosUrlScheme: `com.googleusercontent.apps.${process.env.GOOGLE_IOS_CLIENT_ID ?? "169132274606-k622epnsdbthemkatrctjpadcke6un46"}`,
      },
    ],
    "expo-localization",
  ],
  extra: {
    ...config.extra,
    googleWebClientId:
      process.env.GOOGLE_WEB_CLIENT_ID ??
      "169132274606-hp7cne780gsp7s6l1rrvbfktp6smrfs0.apps.googleusercontent.com",
    EXPO_PUBLIC_OPENWEATHER_API_KEY:
      process.env.EXPO_PUBLIC_OPENWEATHER_API_KEY ?? "",
    EXPO_PUBLIC_FOURSQUARE_API_KEY:
      process.env.EXPO_PUBLIC_FOURSQUARE_API_KEY ?? "",
    EXPO_PUBLIC_GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_API_KEY ?? "",
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
