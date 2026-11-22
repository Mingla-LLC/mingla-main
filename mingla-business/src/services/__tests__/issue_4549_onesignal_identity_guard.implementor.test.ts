/**
 * #4549 rework P1-1 — the SDK boundary: a repair whose identity check fails
 * never calls login or optIn, and sign-out listeners run even before the SDK
 * is initialized (the window of the race). Fails on revert: drop the
 * isStillCurrent checks or move the listener loop below the `_initialized`
 * return in logoutOneSignal.
 */
process.env.EXPO_PUBLIC_ONESIGNAL_APP_ID = "4505e476-0000-4000-8000-000000000000";
(globalThis as { __DEV__?: boolean }).__DEV__ = false;

jest.mock("react-native", () => ({ Platform: { OS: "ios" } }));
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: { getItem: async () => "1", setItem: async () => {} },
}));

const calls: string[] = [];
jest.mock("react-native-onesignal", () => ({
  LogLevel: { Verbose: 0, Warn: 4 },
  OneSignal: {
    Debug: { setLogLevel: () => {} },
    initialize: () => {},
    login: (id: string) => calls.push(`login:${id}`),
    logout: () => calls.push("logout"),
    User: {
      removeTag: () => {},
      pushSubscription: {
        optIn: () => calls.push("optIn"),
        optOut: () => calls.push("optOut"),
      },
    },
    Notifications: { addEventListener: () => {}, removeEventListener: () => {} },
  },
}));

function load(): typeof import("../oneSignalService") {
  jest.resetModules();
  calls.length = 0;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("../oneSignalService");
}

afterEach(() => jest.useRealTimers());

test("relink with a failed identity check never calls login or optIn", async () => {
  const svc = load();
  svc.initializeOneSignal();
  expect(await svc.repairPushRegistration("user-a", "relink", () => false)).toBe(false);
  expect(calls).toEqual([]);
});

test("resubscribe stops after the pause when the identity changed meanwhile", async () => {
  jest.useFakeTimers();
  const svc = load();
  svc.initializeOneSignal();
  let current = true;
  const run = svc.repairPushRegistration("user-a", "resubscribe", () => current);
  current = false; // sign-out during the 1 s pause
  await jest.advanceTimersByTimeAsync(1_000);
  expect(await run).toBe(false);
  expect(calls).toEqual(["optOut"]);
});

test("logout listeners run synchronously even before the SDK is initialized", () => {
  const svc = load();
  const seen: string[] = [];
  svc.onOneSignalLogout(() => seen.push("cancelled"));
  svc.logoutOneSignal(); // not initialized
  expect(seen).toEqual(["cancelled"]);
  expect(calls).toEqual([]);
});
