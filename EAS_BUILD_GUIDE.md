# EAS Build Guide -- After Adding expo-av

This guide walks you through rebuilding the Mingla app after adding `expo-av` to `app.json` plugins.

---

## Why is a rebuild needed?

`expo-av` requires native modules for microphone access and audio encoding. When you add it to the plugins array, Expo needs to regenerate the native iOS and Android projects with the correct permissions and native code. This cannot be done with a simple JS-only update (OTA via `eas update`) -- it requires a full native build via `eas build`.

Specifically, `expo-av` plugin adds:
- **iOS:** `NSMicrophoneUsageDescription` to `Info.plist` (microphone permission prompt text)
- **iOS:** Audio session native module linking
- **Android:** Ensures `RECORD_AUDIO` permission is in `AndroidManifest.xml` (already present in our `app.json` permissions, but the plugin handles native module linking)

Without the native rebuild, the app will crash with "native module not found" when the user taps the record button in the PostExperienceModal.

---

## Prerequisites

1. **EAS CLI installed:**
   ```bash
   npm install -g eas-cli
   ```

2. **Logged into EAS:**
   ```bash
   eas login
   ```
   Use your Expo account credentials. Verify with:
   ```bash
   eas whoami
   ```

3. **Expo account linked to the project:**
   The project ID is `fa733082-682f-4e47-92cc-6013b0640373` (set in `app-mobile/app.json` under `extra.eas.projectId`).
   **Note:** The root-level `app.json` has a different project ID (`76bcd738-...`) for a separate EAS project. All build commands must run from the `app-mobile/` directory.

---

## Steps

### 1. Verify the change in app.json

Open `app-mobile/app.json` and confirm `"expo-av"` is in the plugins array:

```json
"plugins": [
  "expo-location",
  "expo-notifications",
  "expo-camera",
  "expo-calendar",
  "expo-apple-authentication",
  "expo-av",
  [
    "@react-native-google-signin/google-signin",
    {
      "iosUrlScheme": "com.googleusercontent.apps.618060733220-t2vsovng5evma3vfkl0fd0f0pa28lnlc"
    }
  ],
  [
    "expo-build-properties",
    {
      "android": {
        "newArchEnabled": true
      }
    }
  ]
]
```

If `"expo-av"` is missing, add it after `"expo-apple-authentication"` (line 60 in the current file).

### 2. Ensure expo-av is installed as a dependency

```bash
cd app-mobile
npx expo install expo-av
```

This ensures the correct version of `expo-av` is in `package.json` and compatible with the current Expo SDK version.

### 3. Check your EAS profile

```bash
cd app-mobile
eas build:configure
```

This ensures `eas.json` exists and is configured. If it already exists, this command will tell you -- skip if so.

**Important:** Use the `eas.json` inside `app-mobile/`, NOT the root-level one (the root `eas.json` belongs to a different EAS project).

Verify `app-mobile/eas.json` has at least `development`, `preview`, and `production` profiles:
```json
{
  "cli": {
    "version": ">= 5.0.0"
  },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "android": {
        "gradleCommand": ":app:assembleDebug"
      },
      "ios": {
        "buildConfiguration": "Debug"
      }
    },
    "preview": {
      "distribution": "internal",
      "android": {
        "buildType": "apk"
      }
    },
    "production": {
      "android": {
        "buildType": "apk"
      }
    }
  },
  "submit": {
    "production": {}
  }
}
```

### 4. Build for development (testing)

Choose the platform you need:

**iOS simulator only (fastest for testing):**
```bash
eas build --profile development --platform ios
```

**Android emulator only:**
```bash
eas build --profile development --platform android
```

**Both platforms (physical devices + emulators):**
```bash
eas build --profile development --platform all
```

Build times:
- iOS: ~15-25 minutes
- Android: ~10-20 minutes

The EAS CLI will output a URL where you can monitor build progress.

### 5. Build for production (release)

When ready to release to users:

```bash
eas build --profile production --platform all
```

This creates signed production builds ready for App Store and Play Store submission.

### 6. Install the development build

After the build completes:

**iOS Simulator:**
```bash
eas build:run --platform ios
```
This downloads the latest development build and installs it on the iOS simulator.

**Android Emulator:**
```bash
eas build:run --platform android
```
This downloads and installs on the running Android emulator.

**Physical Device (iOS):**
- Option A: Run `eas build:run --platform ios` with device connected
- Option B: Open the build URL from the EAS dashboard on your device and install the provisioned `.ipa`
- Note: Device must be registered in the Apple Developer portal for ad-hoc distribution

**Physical Device (Android):**
- Download the `.apk` from the EAS build dashboard URL
- Open the APK on the device and install (you may need to enable "Install from unknown sources")

### 7. Start the development server

After installing the development build, start the local bundler:

```bash
cd app-mobile
npx expo start --dev-client
```

The development build will connect to this local server for JS bundle and hot reload.

---

## Verify audio recording works

After installing the new build, verify the full voice review flow:

1. Open the app and log in
2. Create a calendar entry for a past date (or use an existing past-due entry)
3. Wait for the PostExperienceModal to appear (10-second delay after app foreground)
4. Tap "Yes, I went"
5. Give a star rating (e.g., 4 stars)
6. Tap the microphone button on the record step
7. **Grant microphone permission when prompted** (first time only)
8. Record for a few seconds (verify timer counts up in MM:SS format)
9. Tap the stop button (or wait 60 seconds for auto-stop)
10. Verify the clip appears in the clip list below the mic button
11. Tap the play button on the clip to verify playback
12. Tap "Submit review"
13. Verify the thank-you screen appears
14. Tap "Done"
15. Verify the modal closes and the app returns to normal

### Quick test for reschedule path

1. Open app with a past-due calendar entry
2. When the PostExperienceModal appears, tap "No, I'll go later"
3. Select "Today" or a custom date
4. Select a time
5. Tap "Confirm"
6. Verify success toast appears
7. Verify modal closes

---

## Troubleshooting

### "expo-av is not available" error

**Cause:** You are running on an old build that does not include the `expo-av` native module. This happens when:
- You did not rebuild after adding `expo-av` to plugins
- You installed an old build from cache
- You are using Expo Go instead of a custom development build

**Fix:** Rebuild with `eas build --profile development --platform <ios|android>` and reinstall.

### Microphone permission denied

**iOS:** Check `Info.plist` for `NSMicrophoneUsageDescription`. The `expo-av` plugin should add this automatically. If missing, add it manually to `app.json`:
```json
"ios": {
  "infoPlist": {
    "NSMicrophoneUsageDescription": "Mingla needs microphone access to record voice reviews of your experiences."
  }
}
```

**Android:** Check `AndroidManifest.xml` for `RECORD_AUDIO` permission. Already present in `app.json` `android.permissions` array. If the app still denies, go to device Settings > Apps > Mingla > Permissions > Microphone and toggle it on.

### Build fails with "native module not found"

This usually means the native prebuild cache is stale. Clean and rebuild:

```bash
cd app-mobile
npx expo prebuild --clean
eas build --profile development --platform <ios|android>
```

### Audio recording crash on iOS simulator

**This is expected.** iOS simulator does not support microphone hardware. Audio recording will not work on the simulator. Test recording on a physical iOS device.

Audio playback DOES work on the simulator -- you can test clip playback by using pre-recorded audio files.

### Build fails with signing/certificate errors

**iOS:**
```bash
eas credentials
```
This will walk you through creating or selecting provisioning profiles and certificates.

**Android:**
EAS manages Android signing automatically for development builds. For production, ensure your keystore is configured in `eas.json`.

### "Unable to find expo module" after build

Clear the Metro bundler cache:
```bash
cd app-mobile
npx expo start --dev-client --clear
```

### OTA update after native rebuild

Once the native build with `expo-av` is installed on devices, subsequent JS-only changes can be deployed via OTA:
```bash
eas update --branch production --message "Update description"
```

OTA updates do NOT include native module changes. If you add another native module later, you will need another `eas build`.
