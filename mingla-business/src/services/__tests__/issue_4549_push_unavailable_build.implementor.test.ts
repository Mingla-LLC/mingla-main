/**
 * #4549 retest P2-A — a build without push (Host Android today: the native
 * module is not linked, so react-native-onesignal's getEnforcing throws at
 * require time) stays silent: no waits, no timers, no error reports, no
 * server reports. A build WITH the module that is merely slow to start still
 * waits (bounded) and reports once.
 *
 * Runs the REAL oneSignalService and pushRegistrationHealth; only the native
 * SDK, Supabase and the Sentry helper are faked. Fails on revert: drop the
 * isPushAvailableInBuild early returns and the first test sees 7
 * `sdk_not_ready` reports and pending timers.
 */
process.env.EXPO_PUBLIC_ONESIGNAL_APP_ID = "4505e476-0000-4000-8000-000000000000";
(globalThis as { __DEV__?: boolean }).__DEV__ = false;

const nonFatal: string[] = [];
const rpcCalls: string[] = [];

function wire(platform: string, nativeLinked: boolean, sdk: Record<string, unknown> = {}): void {
  jest.resetModules();
  nonFatal.length = 0;
  rpcCalls.length = 0;
  jest.doMock("react-native", () => ({ Platform: { OS: platform } }));
  jest.doMock("@react-native-async-storage/async-storage", () => ({
    __esModule: true,
    default: { getItem: async () => "1", setItem: async () => {} },
  }));
  jest.doMock("react-native-onesignal", () => {
    if (!nativeLinked) {
      // What TurboModuleRegistry.getEnforcing("OneSignal") does when unlinked.
      throw new Error("TurboModuleRegistry.getEnforcing(...): 'OneSignal' could not be found");
    }
    return { LogLevel: { Verbose: 0, Warn: 4 }, OneSignal: sdk };
  });
  jest.doMock("../supabase", () => ({
    supabase: {
      rpc: async (fn: string) => {
        rpcCalls.push(fn);
        return { data: { action: "none" }, error: null };
      },
      auth: { getSession: async () => ({ data: { session: { user: { id: "user-a" } } } }) },
    },
  }));
  jest.doMock("../../diagnostics/reportNonFatal", () => ({
    reportNonFatal: (scope: string, error: unknown) => {
      nonFatal.push(`${scope}:${error instanceof Error ? error.message : String(error)}`);
    },
  }));
  jest.doMock("../appVersionIdentity", () => ({ getInstalledNativeBuildVersion: () => "42" }));
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.useRealTimers();
  jest.resetModules();
});

test("Android without the native module: 1 launch + 6 foregrounds = 0 reports, 0 timers, 0 server calls", async () => {
  wire("android", false);
  const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const svc = require("../oneSignalService") as typeof import("../oneSignalService");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const health = require("../pushRegistrationHealth") as typeof import("../pushRegistrationHealth");
  expect(svc.isPushAvailableInBuild()).toBe(false);
  await health.ensurePushRegistration("user-a", "launch");
  for (let i = 0; i < 6; i++) {
    jest.setSystemTime(Date.now() + 10 * 60 * 1000);
    await health.ensurePushRegistrationOnForeground();
  }
  expect(jest.getTimerCount()).toBe(0);
  await jest.advanceTimersByTimeAsync(500_000);
  expect(nonFatal).toEqual([]);
  expect(rpcCalls).toEqual([]);
  warn.mockRestore();
});

test("module present but slow to start: the bounded wait still runs and one report is sent", async () => {
  const sdk = {
    Debug: { setLogLevel: () => {} },
    initialize: () => {},
    login: () => {},
    logout: () => {},
    User: {
      getExternalId: async () => "user-a",
      removeTag: () => {},
      pushSubscription: {
        getIdAsync: async () => "sub-1",
        getTokenAsync: async () => "tok",
        getOptedInAsync: async () => true,
        optIn: () => {},
        optOut: () => {},
      },
    },
    Notifications: {
      addEventListener: () => {},
      removeEventListener: () => {},
      canRequestPermission: async () => false,
      permissionNative: async () => 2,
    },
  };
  wire("ios", true, sdk);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const svc = require("../oneSignalService") as typeof import("../oneSignalService");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const health = require("../pushRegistrationHealth") as typeof import("../pushRegistrationHealth");
  expect(svc.isPushAvailableInBuild()).toBe(true);
  const run = health.ensurePushRegistration("user-a", "launch");
  await jest.advanceTimersByTimeAsync(40_000); // still inside the bounded wait
  expect(rpcCalls).toEqual([]);
  svc.initializeOneSignal(); // the SDK comes up late
  await jest.advanceTimersByTimeAsync(200_000);
  await run;
  expect(rpcCalls).toEqual(["report_host_push_device"]);
  expect(nonFatal).toEqual([]);
});

test("web twin: push is never available", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const web = require("../oneSignalService.web") as typeof import("../oneSignalService.web");
  expect(web.isPushAvailableInBuild()).toBe(false);
});
