// ORCH-1250 [business push-permission parity] — IMPLEMENTOR happy-path regression.
//
// BUG: the business app launch In-App Message ("Open Settings / notifications
// off") mis-fires on a device where iOS notifications are actually ON, because
// the business oneSignalService was ~24 days behind consumer and never received
// ORCH-1243 (syncPushPermissionTag → tag TRUE OS permission) or ORCH-1244
// (requestPermission fallbackToSettings true→false).
//
// This test EXECUTES the real business oneSignalService against a mocked
// `react-native-onesignal` boundary and asserts:
//   1. syncPushPermissionTag writes push_os_permission='granted' when the OS
//      reports permission granted (getPermissionAsync → true).
//   2. requestPushPermission calls the SDK with fallbackToSettings = FALSE
//      (the ORCH-1244 parity argument the consumer uses).
//   3. init seeds the tag; login refreshes it; the request refreshes it.
//
// FAILS-ON-REVERT (recorded in the PR / return):
//   - remove `OneSignal.User.addTag('push_os_permission', ...)` → tag assertions
//     see zero writes → FAIL.
//   - flip requestPermission(false) back to requestPermission(true) → the
//     fallbackToSettings assertion (arg === false) FAILS.

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
const requestPermissionCalls: unknown[] = [];
let permissionGranted = true;

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
  requestPermissionCalls.length = 0;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("../oneSignalService");
}

const flush = (): Promise<void> =>
  new Promise((r) => setImmediate(r));

describe("ORCH-1250 push-permission parity (happy path)", () => {
  beforeEach(() => {
    permissionGranted = true;
  });

  test("granted OS permission → addTag(push_os_permission, 'granted')", async () => {
    const svc = loadService();
    svc.initializeOneSignal();
    await flush(); // let the init seed fire-and-forget settle
    tagCalls.length = 0; // isolate the explicit call below
    await svc.syncPushPermissionTag();
    expect(tagCalls).toEqual([[TAG_KEY, "granted"]]);
  });

  test("initializeOneSignal seeds the OS-permission tag at startup", async () => {
    const svc = loadService();
    svc.initializeOneSignal();
    await flush();
    expect(tagCalls).toEqual([[TAG_KEY, "granted"]]);
  });

  test("requestPushPermission passes fallbackToSettings = FALSE (ORCH-1244 parity)", async () => {
    const svc = loadService();
    svc.initializeOneSignal();
    await flush();
    await svc.requestPushPermission();
    // The parity contract: the native dialog is requested with fallbackToSettings
    // === false, so a prior decliner is NEVER steered into iOS Settings — the
    // root of the false "Open Settings / notifications off" popup.
    expect(requestPermissionCalls).toEqual([false]);
  });

  test("requestPushPermission refreshes the tag after the OS dialog", async () => {
    const svc = loadService();
    svc.initializeOneSignal();
    await flush();
    tagCalls.length = 0;
    await svc.requestPushPermission();
    expect(tagCalls).toContainEqual([TAG_KEY, "granted"]);
  });

  test("loginToOneSignal refreshes the OS-permission tag", async () => {
    const svc = loadService();
    svc.initializeOneSignal();
    await flush();
    tagCalls.length = 0;
    svc.loginToOneSignal("user-123");
    await flush(); // login fires syncPushPermissionTag fire-and-forget
    expect(tagCalls).toContainEqual([TAG_KEY, "granted"]);
  });

  test("NOT initialized → syncPushPermissionTag is a no-op (self-guard)", async () => {
    const svc = loadService();
    // Deliberately DO NOT call initializeOneSignal(): _initialized stays false.
    await svc.syncPushPermissionTag();
    expect(tagCalls.length).toBe(0);
  });
});
