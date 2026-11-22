/**
 * #4549 S0 — once OneSignal is linked on Android, no Notifications call may
 * reach the native SDK before initialize(): OneSignal-Android 5.10.2 throws
 * "Must call 'initWithContext' before use" there, which is a native crash.
 * The fake SDK below throws exactly that way.
 *
 * Fails on revert: delete the `_mustWaitForInit && !_initialized` guard or the
 * runAfterInit deferral and the "before init" assertions throw.
 */

process.env.EXPO_PUBLIC_ONESIGNAL_APP_ID = "4505e476-0000-4000-8000-000000000000";
(globalThis as { __DEV__?: boolean }).__DEV__ = false;

let platform = "android";
jest.mock("react-native", () => ({
  Platform: {
    get OS() {
      return platform;
    },
  },
}));

let sdkInitialized = false;
const nativeCalls: string[] = [];
const guard = (name: string): void => {
  if (!sdkInitialized) throw new Error("Must call 'initWithContext' before use");
  nativeCalls.push(name);
};

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: { getItem: async () => "1", setItem: async () => {} },
}));

jest.mock("react-native-onesignal", () => ({
  LogLevel: { Verbose: 0, Warn: 4 },
  OneSignal: {
    Debug: { setLogLevel: () => {} },
    initialize: () => {
      sdkInitialized = true;
    },
    login: () => guard("login"),
    logout: () => guard("logout"),
    User: {
      removeTag: () => guard("removeTag"),
      pushSubscription: { optIn: () => guard("optIn") },
    },
    Notifications: {
      addEventListener: (event: string) => guard(`add:${event}`),
      removeEventListener: (event: string) => guard(`remove:${event}`),
      clearAll: () => guard("clearAll"),
    },
  },
}));

function load(): typeof import("../oneSignalService") {
  jest.resetModules();
  sdkInitialized = false;
  nativeCalls.length = 0;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("../oneSignalService");
}

describe("#4549 S0 Android: nothing touches the SDK before initialize()", () => {
  beforeEach(() => {
    platform = "android";
  });

  test("module load and early listeners do not call the native SDK; they attach after init", () => {
    let svc!: typeof import("../oneSignalService");
    expect(() => {
      svc = load();
    }).not.toThrow();
    expect(() => {
      svc.onForegroundNotification(() => {});
      svc.onNotificationClicked(() => {});
    }).not.toThrow();
    expect(nativeCalls).toEqual([]);

    svc.initializeOneSignal();
    expect(nativeCalls).toEqual(
      expect.arrayContaining(["add:click", "add:foregroundWillDisplay"]),
    );
    expect(nativeCalls.filter((c) => c === "add:click")).toHaveLength(1);
  });

  test("a listener removed before init never attaches", () => {
    const svc = load();
    const remove = svc.onForegroundNotification(() => {});
    remove();
    svc.initializeOneSignal();
    expect(nativeCalls).not.toContain("add:foregroundWillDisplay");
  });

  test("after init, a new foreground listener attaches and detaches at once", () => {
    const svc = load();
    svc.initializeOneSignal();
    nativeCalls.length = 0;
    const remove = svc.onForegroundNotification(() => {});
    remove();
    expect(nativeCalls).toEqual([
      "add:foregroundWillDisplay",
      "remove:foregroundWillDisplay",
    ]);
  });

  test("iOS keeps the early click capture at module load (its bridge allows it)", () => {
    platform = "ios";
    jest.resetModules();
    sdkInitialized = true; // the iOS bridge accepts listeners before initialize
    nativeCalls.length = 0;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("../oneSignalService");
    expect(nativeCalls).toContain("add:click");
  });
});
