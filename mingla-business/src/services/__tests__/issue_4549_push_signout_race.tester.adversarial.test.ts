/**
 * #4549 retest (tester, adversarial) — the sign-out race, end to end through
 * the REAL oneSignalService and the REAL pushRegistrationHealth. Only the
 * native push module, Supabase and diagnostics are faked. The implementor's
 * identity suite fakes oneSignalService (and with it the logout listener); this
 * suite proves the real `logoutOneSignal()` reaches the cancel, including
 * before the push library has started, and attacks sequences that suite does
 * not cover: A, out, B, out, A with a report still in flight; a session that
 * changes hands with no sign-out; a rejected session read inside a check.
 *
 * Fails on the pre-fix code (23a6be81bb): a check started for A links the
 * phone to A after A signed out.
 */

process.env.EXPO_PUBLIC_ONESIGNAL_APP_ID =
  "4505e476-0000-4000-8000-000000000000";
(globalThis as { __DEV__?: boolean }).__DEV__ = false;

jest.mock("react-native", () => ({ Platform: { OS: "ios" } }));
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: { getItem: async () => "1", setItem: async () => {} },
}));

const sdkCalls: string[] = [];
const device = { externalId: null as string | null, optedIn: true };
jest.mock("react-native-onesignal", () => ({
  LogLevel: { Verbose: 0, Warn: 4 },
  OneSignal: {
    Debug: { setLogLevel: () => {} },
    initialize: () => sdkCalls.push("initialize"),
    login: (id: string) => {
      sdkCalls.push(`login:${id}`);
      device.externalId = id;
    },
    logout: () => {
      sdkCalls.push("logout");
      device.externalId = null;
    },
    User: {
      removeTag: () => {},
      addTag: () => {},
      getExternalId: async () => device.externalId,
      pushSubscription: {
        optIn: () => {
          sdkCalls.push("optIn");
          device.optedIn = true;
        },
        optOut: () => {
          sdkCalls.push("optOut");
          device.optedIn = false;
        },
        getIdAsync: async () => "sub-1",
        getTokenAsync: async () => "tok",
        getOptedInAsync: async () => device.optedIn,
        addEventListener: () => {},
      },
    },
    Notifications: {
      canRequestPermission: async () => false,
      permissionNative: async () => 2,
      getPermissionAsync: async () => true,
      requestPermission: async () => true,
      addEventListener: () => {},
      removeEventListener: () => {},
    },
  },
}));

let sessionUserId: string | null = "user-a";
let getSessionRejectsOnce = false;
const reports: { session: string | null; linked: unknown }[] = [];
let rpcGate: Promise<void> | null = null;
let rpcAction = "none";
let afterRpc: (() => void) | null = null;

jest.mock("../supabase", () => ({
  supabase: {
    rpc: async (_fn: string, args: Record<string, unknown>) => {
      reports.push({ session: sessionUserId, linked: args.p_linked });
      const action = rpcAction; // the answer is decided when the call is made
      if (rpcGate) await rpcGate;
      const hook = afterRpc;
      afterRpc = null;
      hook?.();
      return { data: { action }, error: null };
    },
    auth: {
      getSession: async () => {
        if (getSessionRejectsOnce) {
          getSessionRejectsOnce = false;
          throw new Error("storage read failed");
        }
        return {
          data: {
            session: sessionUserId ? { user: { id: sessionUserId } } : null,
          },
        };
      },
    },
  },
}));
jest.mock("../../diagnostics/reportNonFatal", () => ({
  reportNonFatal: () => {},
}));
jest.mock("../appVersionIdentity", () => ({
  getInstalledNativeBuildVersion: () => "42",
}));

type OneSignalModule = typeof import("../oneSignalService");
type HealthModule = typeof import("../pushRegistrationHealth");
let os: OneSignalModule;
let health: HealthModule;

/** What AuthContext does on every sign-out path: session gone, then logoutOneSignal(). */
function signOut(): void {
  sessionUserId = null;
  os.logoutOneSignal();
}
/** What AuthContext does on sign-in: session set, loginToOneSignal, then the check. */
function signIn(user: string): Promise<void> {
  sessionUserId = user;
  os.loginToOneSignal(user);
  return health.ensurePushRegistration(user, "sign_in");
}
const loginsSince = (mark: number, user: string): string[] =>
  sdkCalls.slice(mark).filter((c) => c === `login:${user}`);

beforeEach(() => {
  jest.useFakeTimers();
  jest.resetModules();
  sdkCalls.length = 0;
  device.externalId = null;
  device.optedIn = true;
  sessionUserId = "user-a";
  getSessionRejectsOnce = false;
  reports.length = 0;
  rpcGate = null;
  rpcAction = "none";
  afterRpc = null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  os = require("../oneSignalService");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  health = require("../pushRegistrationHealth");
});

afterEach(() => {
  jest.useRealTimers();
});

test("RT-1 sign-out while the launch check waits for a library that has not started: the real logoutOneSignal cancels it", async () => {
  const run = health.ensurePushRegistration("user-a", "launch");
  await jest.advanceTimersByTimeAsync(10_000);
  signOut();
  const mark = sdkCalls.length;
  os.initializeOneSignal(); // the library starts after the sign-out
  await jest.advanceTimersByTimeAsync(300_000);
  await run;
  expect(sdkCalls.slice(mark)).not.toContain("login:user-a");
  expect(sdkCalls.slice(mark)).not.toContain("optIn");
  expect(reports).toEqual([]);
  expect(device.externalId).toBeNull();
});

test("RT-2 sign-out then sign-in as B while the library is still starting: only B is linked, every report is B's and linked", async () => {
  const runA = health.ensurePushRegistration("user-a", "launch");
  await jest.advanceTimersByTimeAsync(25_000);
  signOut();
  const mark = sdkCalls.length;
  const runB = signIn("user-b");
  os.initializeOneSignal();
  await jest.advanceTimersByTimeAsync(300_000);
  await Promise.all([runA, runB]);
  await jest.advanceTimersByTimeAsync(300_000);
  expect(loginsSince(mark, "user-a")).toEqual([]);
  expect(loginsSince(mark, "user-b").length).toBeGreaterThan(0);
  expect(device.externalId).toBe("user-b");
  expect(reports.length).toBeGreaterThan(0);
  for (const r of reports)
    expect(r).toEqual({ session: "user-b", linked: true });
});

test("RT-3 A, out, B, out, A with A's first report still in flight and answered reregister: B is never linked, the stale run never resubscribes", async () => {
  os.initializeOneSignal();
  let release: () => void = () => undefined;
  rpcGate = new Promise<void>((r) => {
    release = r;
  });
  rpcAction = "reregister";
  const first = health.ensurePushRegistration("user-a", "launch");
  await jest.advanceTimersByTimeAsync(10_000); // A's report is now in flight
  expect(reports).toHaveLength(1);
  signOut();
  const mark = sdkCalls.length;
  void signIn("user-b");
  signOut();
  const afterOutB = sdkCalls.length;
  void signIn("user-a");
  rpcGate = null;
  rpcAction = "none";
  release();
  await jest.advanceTimersByTimeAsync(300_000);
  await first;
  await jest.advanceTimersByTimeAsync(300_000);
  // loginToOneSignal(B) itself is the sign-in, so B's only login is that one
  // direct call; no check ever linked B, and nothing linked B after B left.
  expect(loginsSince(mark, "user-b")).toEqual(["login:user-b"]);
  expect(loginsSince(afterOutB, "user-b")).toEqual([]);
  // The stale A run got "reregister" after A signed out: no optOut ever.
  expect(sdkCalls).not.toContain("optOut");
  expect(device.externalId).toBe("user-a");
  // Every report after the first was filed while A (the second sign-in) was signed in.
  for (const r of reports.slice(1))
    expect(r).toEqual({ session: "user-a", linked: true });
});

test("RT-4 the session changes hands with no sign-out event: A's waiting check does not link A under B", async () => {
  const runA = health.ensurePushRegistration("user-a", "launch");
  await jest.advanceTimersByTimeAsync(10_000);
  sessionUserId = "user-b"; // no logoutOneSignal(): only the session check can stop it
  const mark = sdkCalls.length;
  os.initializeOneSignal();
  await jest.advanceTimersByTimeAsync(300_000);
  await runA;
  expect(loginsSince(mark, "user-a")).toEqual([]);
  expect(reports).toEqual([]);
});

test("RT-5 a rejected session read inside a check leaves no stale waiter: the next check runs, and a later sign-out still cancels", async () => {
  os.initializeOneSignal();
  getSessionRejectsOnce = true;
  const first = health.ensurePushRegistration("user-a", "launch");
  await jest.advanceTimersByTimeAsync(300_000);
  await first;
  expect(reports).toEqual([]); // the check ended on the error, quietly
  // The next check (a sign-in, not throttled) runs normally.
  await jest.advanceTimersByTimeAsync(1);
  const second = health.ensurePushRegistration("user-a", "sign_in");
  await jest.advanceTimersByTimeAsync(300_000);
  await second;
  expect(reports).toEqual([{ session: "user-a", linked: true }]);
  // A third check is cancelled by sign-out mid-flight.
  let release: () => void = () => undefined;
  rpcGate = new Promise<void>((r) => {
    release = r;
  });
  rpcAction = "reregister";
  const third = health.ensurePushRegistration("user-a", "sign_in");
  await jest.advanceTimersByTimeAsync(10_000);
  signOut();
  rpcGate = null;
  release();
  await jest.advanceTimersByTimeAsync(300_000);
  await third;
  expect(sdkCalls).not.toContain("optOut");
  expect(reports).toHaveLength(2);
});

test("RT-6 sign-out before anything started, then a late launch call for the old account (bootstrap resuming after its awaits): nothing links or reports", async () => {
  signOut(); // before initialize, before any check
  const mark = sdkCalls.length;
  os.initializeOneSignal();
  const late = health.ensurePushRegistration("user-a", "launch");
  await jest.advanceTimersByTimeAsync(300_000);
  await late;
  expect(loginsSince(mark, "user-a")).toEqual([]);
  expect(sdkCalls.slice(mark)).not.toContain("optIn");
  expect(reports).toEqual([]);
});
