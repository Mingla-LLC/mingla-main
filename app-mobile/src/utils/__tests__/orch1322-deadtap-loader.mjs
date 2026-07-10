/**
 * ORCH-1322 [consumer-android-media-permission-latent] — module loader for the
 * TESTER adversarial dead-tap guard (orch1322DeadTapGuard.test.mjs).
 *
 * DIFFERENT ANGLE from the implementor's happy-path loader
 * (orch1322-wrapper-runtime-loader.mjs, which stubs the underlying
 * requestMediaLibraryPermissionsAsync to return { granted: true }). THIS loader
 * models the REAL post-strip Android <= 12 reality: once app.json blocks
 * READ/WRITE_EXTERNAL_STORAGE, the OS DENIES the now-absent storage permission,
 * so the underlying expo-image-picker request resolves { granted: false,
 * status: 'denied' }. The dead-tap that stripping the permissions ALONE (without
 * the wrapper's Android short-circuit) would cause is only observable when the
 * underlying API returns DENIED — which the implementor's granted:true stub can
 * never surface.
 *
 * Stubs are evaluated in the main thread, so they read/write globalThis, letting
 * the test flip Platform.OS and count real ImagePicker calls.
 *
 * Append-only tester artifact — does NOT modify the implementor's loader.
 */
const STUBS = {
  "react-native": `
    export const Platform = {
      get OS() { return globalThis.__ORCH1322_DEADTAP_PLATFORM_OS ?? 'ios'; },
    };
  `,
  // Underlying OS permission is DENIED (the post-strip Android reality) — the
  // opposite of the implementor's happy-path stub.
  "expo-image-picker": `
    export const PermissionStatus = { GRANTED: 'granted', DENIED: 'denied', UNDETERMINED: 'undetermined' };
    export async function requestMediaLibraryPermissionsAsync() {
      globalThis.__ORCH1322_DEADTAP_IP_CALLS = (globalThis.__ORCH1322_DEADTAP_IP_CALLS ?? 0) + 1;
      return { granted: false, canAskAgain: false, status: 'denied', expires: 'never' };
    }
  `,
};

const PREFIX = "orch1322-deadtap-stub:";

export async function resolve(specifier, context, nextResolve) {
  if (Object.prototype.hasOwnProperty.call(STUBS, specifier)) {
    return { url: PREFIX + specifier, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.startsWith(PREFIX)) {
    const key = url.slice(PREFIX.length);
    return { format: "module", source: STUBS[key], shortCircuit: true };
  }
  return nextLoad(url, context);
}
