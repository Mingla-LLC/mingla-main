// ORCH-1250 [business push-permission parity] — IMPLEMENTOR happy-path
// regression, REWRITTEN by #4549 S4.
//
// ORCH-1250 mirrored the OS permission into the account-wide OneSignal tag
// `push_os_permission` from every phone. #4549 proved nothing sends, segments
// or shows an in-app message on it in the Host app, and that its value was
// "whatever the last phone saw" for accounts with several phones. S4 stops
// writing it and removes it once per install. The ORCH-1244 half of ORCH-1250
// (requestPermission with fallbackToSettings = false) is unchanged and still
// pinned here.
//
// FAILS-ON-REVERT:
//   - restore any addTag('push_os_permission', ...) → the never-written
//     assertions FAIL.
//   - delete the removeTag call or its once-per-install flag → the removal
//     assertions FAIL.
//   - flip requestPermission(false) to requestPermission(true) → FAIL.

// The service reads EXPO_PUBLIC_ONESIGNAL_APP_ID at module load and only wires
// the native module when it is present + Platform.OS !== 'web'. testEnvironment
// is 'node' (Platform.OS defaults to a non-'web' value under the RN shim in
// ts-jest), so we just supply the env var.
process.env.EXPO_PUBLIC_ONESIGNAL_APP_ID =
  process.env.EXPO_PUBLIC_ONESIGNAL_APP_ID ?? "388b3efc-test-app-id";

// The service reads the RN global __DEV__; define it for the node test env.
(globalThis as { __DEV__?: boolean }).__DEV__ = false;

// react-native is Flow/ESM and not transformed under the node/ts-jest config;
// the service only uses Platform.OS, so mock it to a native (non-'web') OS.
jest.mock("react-native", () => ({ Platform: { OS: "ios" } }));

// ── Controllable mock of the OneSignal boundary ──────────────────────────────
const tagCalls: Array<[string, string]> = [];
const removeTagCalls: string[] = [];
const requestPermissionCalls: unknown[] = [];
let permissionGranted = true;

// In-memory AsyncStorage that survives module reloads (one install).
const storage = new Map<string, string>();
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: async (k: string) => storage.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      storage.set(k, v);
    },
  },
}));

jest.mock("react-native-onesignal", () => ({
  LogLevel: { Verbose: 0, Warn: 4 },
  OneSignal: {
    Debug: { setLogLevel: () => {} },
    initialize: () => {},
    login: () => {},
    logout: () => {},
    User: {
      addTag: (k: string, v: string) => {
        tagCalls.push([k, v]);
      },
      removeTag: (k: string) => {
        removeTagCalls.push(k);
      },
      pushSubscription: { optIn: async () => {} },
    },
    Notifications: {
      getPermissionAsync: async () => permissionGranted,
      canRequestPermission: async () => true,
      requestPermission: async (fallbackToSettings: unknown) => {
        requestPermissionCalls.push(fallbackToSettings);
        return permissionGranted;
      },
      clearAll: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
    },
  },
}));

const TAG_KEY = "push_os_permission";

// Fresh module (resets the module-level _initialized) + fresh mock state.
function loadService(): typeof import("../oneSignalService") {
  jest.resetModules();
  tagCalls.length = 0;
  removeTagCalls.length = 0;
  requestPermissionCalls.length = 0;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("../oneSignalService");
}

const flush = (): Promise<void> =>
  new Promise((r) => setImmediate(r));

describe("ORCH-1250 push-permission parity, after #4549 S4 (happy path)", () => {
  beforeEach(() => {
    permissionGranted = true;
    storage.clear();
  });

  test("initializeOneSignal never writes push_os_permission and removes it once", async () => {
    const svc = loadService();
    svc.initializeOneSignal();
    await flush();
    expect(tagCalls).toEqual([]);
    expect(removeTagCalls).toEqual([TAG_KEY]);
    expect(storage.get("mingla-business.pushPermissionTagRemoved.v1")).toBe("1");
  });

  test("the removal runs once per install, not once per launch", async () => {
    const first = loadService();
    first.initializeOneSignal();
    await flush();
    const second = loadService(); // next launch, same install
    second.initializeOneSignal();
    await flush();
    expect(removeTagCalls).toEqual([]);
  });

  test("login and the permission request never write the tag", async () => {
    const svc = loadService();
    svc.initializeOneSignal();
    await flush();
    svc.loginToOneSignal("user-123");
    await svc.requestPushPermission();
    await flush();
    expect(tagCalls).toEqual([]);
  });

  test("syncPushPermissionTag no longer exists", () => {
    const svc = loadService();
    expect("syncPushPermissionTag" in svc).toBe(false);
  });

  test("requestPushPermission passes fallbackToSettings = FALSE (ORCH-1244 parity)", async () => {
    const svc = loadService();
    svc.initializeOneSignal();
    await flush();
    await svc.requestPushPermission();
    expect(requestPermissionCalls).toEqual([false]);
  });

  test("NOT initialized → nothing is removed (self-guard)", async () => {
    loadService();
    await flush();
    expect(removeTagCalls).toEqual([]);
  });
});
