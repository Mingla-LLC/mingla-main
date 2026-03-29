# FIX: GitGuardian Hardcoded Secrets in app.json

## What's Wrong (Plain English)

Your `app-mobile/app.json` has API keys written directly in the file — like writing your password on a sticky note and checking it into GitHub. GitGuardian caught the Google Maps API key, but there are actually **5 hardcoded secrets** in that file:

1. **Google Maps API Key** (`AIzaSyDqDfjlRxbpNvV3J20rK6YSfC0NWkpFsS4`) — appears 3 times (iOS config, Android config, extra vars)
2. **OpenWeather API Key** (`299d1497ef6fbdb0c63f1606ddfc72f9`)
3. **Foursquare API Key** (`RXN0EIVNOQ1MMLL2XXQGLXWEYV0YB53ELZECFGHQ5GZM2VW0`)
4. **Google OAuth Client IDs** (multiple) — these are less sensitive (they're meant to be public in mobile apps) but still better to externalize
5. **EAS/Expo Project ID** — not a secret, fine to keep

The key is already baked into 91 commits of git history. Even if you remove it from the file now, anyone with repo access can find it in old commits.

---

## Root Cause

**Fact:** `app-mobile/app.json` is a static JSON file. Expo reads it at build time. There is no `app.config.ts` or `app.config.js` to dynamically inject environment variables.

**Fact:** No `.env` file exists (correctly gitignored), but nothing reads from it because `app.json` can't reference env vars — only `app.config.ts/js` can.

**Fact:** `eas.json` has no `env` blocks configured for any build profile.

**Inference:** When the project was set up, keys were put directly in `app.json` for convenience. There was no mechanism to externalize them.

---

## Remediation Plan (3 Steps)

### Step 1: Convert `app.json` → `app.config.ts`

Expo supports a dynamic config file that can read from `process.env`. This is the standard pattern.

**Create `app-mobile/app.config.ts`:**

```typescript
import { ExpoConfig, ConfigContext } from "expo/config";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "Mingla",
  slug: "mingla",
  version: "1.0.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "light",
  newArchEnabled: true,
  scheme: "com.mingla.app.v2",
  splash: {
    image: "./assets/splash-icon.png",
    resizeMode: "contain",
    backgroundColor: "#FAFAFA",
  },
  ios: {
    supportsTablet: true,
    bundleIdentifier: "com.mingla.app.v2",
    infoPlist: {
      NSLocationWhenInUseUsageDescription:
        "Mingla needs location access to find experiences near you and provide location-based recommendations.",
      NSLocationAlwaysAndWhenInUseUsageDescription:
        "Mingla needs location access to find experiences near you and provide location-based recommendations.",
      NSLocationAlwaysUsageDescription:
        "Mingla needs location access to find experiences near you and provide location-based recommendations.",
      NSCameraUsageDescription:
        "Mingla needs camera access to capture photos for your experiences.",
      NSPhotoLibraryUsageDescription:
        "Mingla needs photo library access to select images for your experiences.",
      NSCalendarsUsageDescription:
        "Mingla needs calendar access to add scheduled experiences to your device calendar.",
      NSRemindersUsageDescription:
        "Mingla needs reminders access to add scheduled experiences to your device calendar.",
      NSMicrophoneUsageDescription:
        "Mingla needs microphone access to record voice reviews about your experiences.",
      ITSAppUsesNonExemptEncryption: false,
    },
    associatedDomains: ["applinks:usemingla.com"],
    config: {
      googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY ?? "",
    },
  },
  android: {
    googleServicesFile: "./google-services.json",
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon.png",
      backgroundColor: "#FAFAFA",
    },
    config: {
      googleMaps: {
        apiKey: process.env.GOOGLE_MAPS_API_KEY ?? "",
      },
    },
    edgeToEdgeEnabled: true,
    predictiveBackGestureEnabled: false,
    softwareKeyboardLayoutMode: "pan",
    package: "com.mingla.app.v2",
    intentFilters: [
      {
        action: "VIEW",
        autoVerify: true,
        data: [
          {
            scheme: "https",
            host: "usemingla.com",
            pathPrefix: "/invite",
          },
          {
            scheme: "https",
            host: "usemingla.com",
            pathPrefix: "/board",
          },
        ],
        category: ["BROWSABLE", "DEFAULT"],
      },
    ],
    permissions: [
      "ACCESS_FINE_LOCATION",
      "ACCESS_COARSE_LOCATION",
      "CAMERA",
      "READ_EXTERNAL_STORAGE",
      "WRITE_EXTERNAL_STORAGE",
      "android.permission.ACCESS_COARSE_LOCATION",
      "android.permission.ACCESS_FINE_LOCATION",
      "android.permission.CAMERA",
      "android.permission.RECORD_AUDIO",
      "android.permission.READ_CALENDAR",
      "android.permission.WRITE_CALENDAR",
      "android.permission.MODIFY_AUDIO_SETTINGS",
    ],
  },
  web: {
    favicon: "./assets/favicon.png",
  },
  plugins: [
    "expo-splash-screen",
    "expo-location",
    "expo-camera",
    "expo-calendar",
    "expo-apple-authentication",
    "expo-av",
    [
      "@react-native-google-signin/google-signin",
      {
        iosUrlScheme: `com.googleusercontent.apps.${process.env.GOOGLE_IOS_CLIENT_ID ?? "618060733220-t2vsovng5evma3vfkl0fd0f0pa28lnlc"}`,
      },
    ],
    [
      "expo-build-properties",
      {
        android: { newArchEnabled: true },
        ios: { newArchEnabled: true },
      },
    ],
    "@react-native-community/datetimepicker",
    "expo-router",
    "expo-web-browser",
    [
      "onesignal-expo-plugin",
      {
        mode: "production",
        smallIcons: ["./assets/ic_stat_onesignal_default.png"],
        largeIcons: ["./assets/ic_onesignal_large_icon_default.png"],
        smallIconAccentColor: "#EB7825",
      },
    ],
    "react-native-appsflyer",
    "@maplibre/maplibre-react-native",
  ],
  updates: {
    enabled: true,
    fallbackToCacheTimeout: 0,
    url: "https://u.expo.dev/01f9ff7c-379a-4be5-9236-1195d6921c6d",
  },
  extra: {
    eas: {
      projectId: "01f9ff7c-379a-4be5-9236-1195d6921c6d",
    },
    googleWebClientId:
      process.env.GOOGLE_WEB_CLIENT_ID ??
      "618060733220-l9ls35bklsvlqbj7ii9v5tiok9neqhee.apps.googleusercontent.com",
    EXPO_PUBLIC_OPENWEATHER_API_KEY:
      process.env.EXPO_PUBLIC_OPENWEATHER_API_KEY ?? "",
    EXPO_PUBLIC_FOURSQUARE_API_KEY:
      process.env.EXPO_PUBLIC_FOURSQUARE_API_KEY ?? "",
    EXPO_PUBLIC_GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_API_KEY ?? "",
    EXPO_PUBLIC_DISCOVER_MAP_PROVIDER: "maplibre",
    EXPO_PUBLIC_MAPLIBRE_STYLE_URL:
      "https://demotiles.maplibre.org/style.json",
    EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID:
      process.env.GOOGLE_WEB_CLIENT_ID ??
      "618060733220-l9ls35bklsvlqbj7ii9v5tiok9neqhee.apps.googleusercontent.com",
    ANDROID_CLIENT_ID:
      process.env.GOOGLE_ANDROID_CLIENT_ID ??
      "618060733220-hvlvia73dcm2sd5hgbvnp59bnas46gt0.apps.googleusercontent.com",
    IOS_CLIENT_ID:
      process.env.GOOGLE_IOS_CLIENT_ID ??
      "618060733220-t2vsovng5evma3vfkl0fd0f0pa28lnlc.apps.googleusercontent.com",
    GOOGLE_PROJECT_ID: "mingla-dev",
    GOOGLE_WEB_CLIENT_SECRET: "",
    GOOGLE_IOS_CLIENT_SECRET: "",
    GOOGLE_ANDROID_CLIENT_ID:
      process.env.GOOGLE_ANDROID_CLIENT_ID ??
      "618060733220-hvlvia73dcm2sd5hgbvnp59bnas46gt0.apps.googleusercontent.com",
  },
  runtimeVersion: {
    policy: "appVersion",
  },
});
```

**Then delete `app-mobile/app.json`.**

### Step 2: Create `.env.example` and local `.env`

**Create `app-mobile/.env.example`** (committed to git — placeholder values only):

```env
# Google Maps (iOS/Android native SDK + Places API)
GOOGLE_MAPS_API_KEY=your_google_maps_api_key_here

# Third-party APIs
EXPO_PUBLIC_OPENWEATHER_API_KEY=your_openweather_key_here
EXPO_PUBLIC_FOURSQUARE_API_KEY=your_foursquare_key_here

# Google OAuth (these are client IDs, less sensitive but still externalized)
GOOGLE_WEB_CLIENT_ID=your_google_web_client_id_here
GOOGLE_IOS_CLIENT_ID=your_google_ios_client_id_here
GOOGLE_ANDROID_CLIENT_ID=your_google_android_client_id_here
```

**Create `app-mobile/.env`** (NOT committed — already in `.gitignore`):

```env
GOOGLE_MAPS_API_KEY=AIzaSyDqDfjlRxbpNvV3J20rK6YSfC0NWkpFsS4
EXPO_PUBLIC_OPENWEATHER_API_KEY=299d1497ef6fbdb0c63f1606ddfc72f9
EXPO_PUBLIC_FOURSQUARE_API_KEY=RXN0EIVNOQ1MMLL2XXQGLXWEYV0YB53ELZECFGHQ5GZM2VW0
GOOGLE_WEB_CLIENT_ID=618060733220-l9ls35bklsvlqbj7ii9v5tiok9neqhee.apps.googleusercontent.com
GOOGLE_IOS_CLIENT_ID=618060733220-t2vsovng5evma3vfkl0fd0f0pa28lnlc.apps.googleusercontent.com
GOOGLE_ANDROID_CLIENT_ID=618060733220-hvlvia73dcm2sd5hgbvnp59bnas46gt0.apps.googleusercontent.com
```

### Step 3: Configure EAS Build Secrets

For EAS Cloud builds, secrets must be set via CLI or Expo dashboard:

```bash
# Set secrets for EAS builds (run once)
eas secret:create --scope project --name GOOGLE_MAPS_API_KEY --value "AIzaSyDqDfjlRxbpNvV3J20rK6YSfC0NWkpFsS4"
eas secret:create --scope project --name EXPO_PUBLIC_OPENWEATHER_API_KEY --value "299d1497ef6fbdb0c63f1606ddfc72f9"
eas secret:create --scope project --name EXPO_PUBLIC_FOURSQUARE_API_KEY --value "RXN0EIVNOQ1MMLL2XXQGLXWEYV0YB53ELZECFGHQ5GZM2VW0"
eas secret:create --scope project --name GOOGLE_WEB_CLIENT_ID --value "618060733220-l9ls35bklsvlqbj7ii9v5tiok9neqhee.apps.googleusercontent.com"
eas secret:create --scope project --name GOOGLE_IOS_CLIENT_ID --value "618060733220-t2vsovng5evma3vfkl0fd0f0pa28lnlc.apps.googleusercontent.com"
eas secret:create --scope project --name GOOGLE_ANDROID_CLIENT_ID --value "618060733220-hvlvia73dcm2sd5hgbvnp59bnas46gt0.apps.googleusercontent.com"
```

---

## About Git History Rewriting

The key is in 91 commits of history. You have two options:

### Option A: Rotate the key (RECOMMENDED)
1. Go to Google Cloud Console → APIs & Services → Credentials
2. Create a new API key with the same restrictions as the current one
3. Delete/disable the old key
4. Use the new key in your `.env` and EAS secrets
5. Mark the GitGuardian incident as "resolved — key rotated"

This is safer and simpler than rewriting history. The old key becomes worthless.

### Option B: Rewrite git history with BFG
```bash
# Only if you really want to scrub history (disrupts all open branches)
bfg --replace-text passwords.txt repo.git
```

**Recommendation: Option A.** Rewriting history on a multi-branch repo with open PRs is painful and error-prone. Rotating the key takes 5 minutes and fully mitigates the risk.

---

## Unblocking the PR

After implementing Steps 1-2 and pushing:
1. GitGuardian will re-scan and may still flag the historical commits
2. Go to GitGuardian dashboard → mark the incident as "resolved" (after rotating the key)
3. The PR check should then pass

If GitGuardian keeps flagging historical commits even after the current code is clean, you can configure a `.gitguardian.yml` to acknowledge the resolved incident.

---

## Verification Checklist

- [ ] `app.json` deleted, `app.config.ts` created
- [ ] `grep -r "AIzaSy" app-mobile/` returns zero results in tracked files
- [ ] `.env` exists locally with real keys, is NOT tracked by git
- [ ] `.env.example` committed with placeholder values
- [ ] Local dev build works (`npx expo start`)
- [ ] EAS secrets configured for cloud builds
- [ ] Google Maps API key rotated in Google Cloud Console
- [ ] GitGuardian incident marked resolved
- [ ] PR re-check passes
