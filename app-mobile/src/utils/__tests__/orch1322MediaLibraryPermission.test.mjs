/**
 * ORCH-1322 [consumer-android-media-permission-latent] — happy-path RUNTIME test
 * for the shared gallery-permission wrapper (I-PROPOSED-1322-*).
 *
 * Executes the REAL wrapper source (../mediaLibraryPermission.ts) with
 * `react-native` and `expo-image-picker` stubbed by a loader (app-mobile has no
 * jest — OQ-1), and asserts the two runtime contracts:
 *   T1 — Android: returns { granted:true, status:'granted' } WITHOUT calling the
 *        underlying ImagePicker.requestMediaLibraryPermissionsAsync (the Android
 *        Photo Picker needs no permission → no dead-tap after the app.json strip).
 *   T2 — iOS: delegates to ImagePicker.requestMediaLibraryPermissionsAsync
 *        (still gated on NSPhotoLibraryUsageDescription) and returns its result.
 *
 * FAILS-ON-REVERT: delete the `if (Platform.OS === 'android') { return {granted:true...} }`
 * short-circuit from the wrapper and T1 flips — the ImagePicker mock IS called on
 * Android (the "not-called" assertion fails).
 *
 * Runs under plain node (no test runner needed):
 *   node ./src/utils/__tests__/orch1322MediaLibraryPermission.test.mjs
 */
import assert from "node:assert/strict";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Register the stub loader BEFORE importing the wrapper.
register("./orch1322-wrapper-runtime-loader.mjs", pathToFileURL(__filename));

const wrapperUrl = pathToFileURL(
  path.join(__dirname, "..", "mediaLibraryPermission.ts"),
).href;
const { requestGalleryPermission } = await import(wrapperUrl);

const failures = [];

// T1 — Android short-circuits granted WITHOUT calling ImagePicker.
globalThis.__ORCH1322_IP_CALLS = 0;
globalThis.__ORCH1322_PLATFORM_OS = "android";
const androidRes = await requestGalleryPermission();
try {
  assert.equal(androidRes.granted, true, "android result.granted must be true");
  assert.equal(
    androidRes.status,
    "granted",
    "android result.status must be 'granted'",
  );
  assert.equal(
    globalThis.__ORCH1322_IP_CALLS,
    0,
    "ImagePicker.requestMediaLibraryPermissionsAsync MUST NOT be called on Android",
  );
} catch (e) {
  failures.push("T1 (android short-circuit): " + e.message);
}

// T2 — iOS delegates to the real ImagePicker API.
globalThis.__ORCH1322_IP_CALLS = 0;
globalThis.__ORCH1322_PLATFORM_OS = "ios";
const iosRes = await requestGalleryPermission();
try {
  assert.equal(
    globalThis.__ORCH1322_IP_CALLS,
    1,
    "ImagePicker.requestMediaLibraryPermissionsAsync MUST be called once on iOS",
  );
  assert.equal(
    iosRes.granted,
    true,
    "iOS must return the delegated ImagePicker result",
  );
} catch (e) {
  failures.push("T2 (iOS delegation): " + e.message);
}

if (failures.length) {
  console.error("ORCH-1322 media-library permission wrapper test FAIL:");
  failures.forEach((m) => console.error("  - " + m));
  process.exit(1);
}
console.log(
  "ORCH-1322 media-library permission wrapper test PASS " +
    "(2/2: Android short-circuits granted without ImagePicker; iOS delegates).",
);
