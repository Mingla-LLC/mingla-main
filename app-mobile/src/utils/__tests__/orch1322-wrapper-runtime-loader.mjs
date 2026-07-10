/**
 * ORCH-1322 — module loader for the mediaLibraryPermission runtime test.
 *
 * Stubs `react-native` (Platform) and `expo-image-picker` (PermissionStatus +
 * requestMediaLibraryPermissionsAsync) so the REAL wrapper source can be
 * executed under plain node (app-mobile has no jest — OQ-1). The stub source is
 * evaluated in the main thread, so it reads/writes globalThis, letting the test
 * flip Platform.OS and count real ImagePicker calls.
 */
const STUBS = {
  "react-native": `
    export const Platform = {
      get OS() { return globalThis.__ORCH1322_PLATFORM_OS ?? 'ios'; },
    };
  `,
  "expo-image-picker": `
    export const PermissionStatus = { GRANTED: 'granted', DENIED: 'denied', UNDETERMINED: 'undetermined' };
    export async function requestMediaLibraryPermissionsAsync() {
      globalThis.__ORCH1322_IP_CALLS = (globalThis.__ORCH1322_IP_CALLS ?? 0) + 1;
      return { granted: true, canAskAgain: true, status: 'granted', expires: 'never' };
    }
  `,
};

const PREFIX = "orch1322-stub:";

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
