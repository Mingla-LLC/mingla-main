/**
 * #4549 rework P1-1 / P2-5 — a push check never links, opts in or reports for
 * an account that is no longer the signed-in one. Fake timers drive the whole
 * ~140 s SDK wait window (pauses 2/5/15/60 s, each wait up to 15 s).
 *
 * Fails on revert: drop the generation / session checks in
 * pushRegistrationHealth.ts (assertStillCurrent, cancellable, the logout hook)
 * and the sign-out cases relink and report the signed-out account.
 */

(globalThis as { __DEV__?: boolean }).__DEV__ = false;

jest.mock("react-native", () => ({ Platform: { OS: "ios" } }));

type State = {
  sdkReady: boolean;
  permission: "granted" | "denied" | "not_determined";
  canPrompt: boolean;
  subscriptionIdPresent: boolean;
  subscriptionId: string | null;
  tokenPresent: boolean;
  optedIn: boolean;
  externalId: string | null;
};

const log: string[] = [];
let sdkReady = false;
let linkedTo: string | null = null;
let sessionUserId: string | null = "user-a";
let logoutListener: (() => void) | null = null;
let rpcHook: (() => void) | null = null;
let rpcAction = "none";
let reading = 0;
let maxConcurrentReads = 0;

const state = (): State => ({
  sdkReady: true,
  permission: "granted",
  canPrompt: false,
  subscriptionIdPresent: true,
  subscriptionId: "sub-1",
  tokenPresent: true,
  optedIn: true,
  externalId: linkedTo,
});

jest.mock("../oneSignalService", () => ({
  whenOneSignalReady: (ms: number) =>
    new Promise<boolean>((resolve) => {
      log.push("wait");
      if (sdkReady) {
        resolve(true);
        return;
      }
      setTimeout(() => resolve(sdkReady), ms);
    }),
  readPushRegistrationState: async () => {
    reading += 1;
    maxConcurrentReads = Math.max(maxConcurrentReads, reading);
    await Promise.resolve();
    reading -= 1;
    log.push("read");
    return state();
  },
  repairPushRegistration: async (
    userId: string,
    step: string,
    isStillCurrent: () => boolean = () => true,
  ) => {
    if (!isStillCurrent()) {
      log.push(`refused:${step}:${userId}`);
      return false;
    }
    log.push(`repair:${step}:${userId}`);
    linkedTo = userId;
    return true;
  },
  onOneSignalLogout: (listener: () => void) => {
    logoutListener = listener;
    return () => {};
  },
}));

jest.mock("../supabase", () => ({
  supabase: {
    rpc: async (_fn: string, args: Record<string, unknown>) => {
      log.push(`report:${sessionUserId}:${String(args.p_linked)}`);
      rpcHook?.();
      return { data: { action: rpcAction }, error: null };
    },
    auth: {
      getSession: async () => ({
        data: { session: sessionUserId ? { user: { id: sessionUserId } } : null },
      }),
    },
  },
}));

jest.mock("../../diagnostics/reportNonFatal", () => ({
  reportNonFatal: () => {},
}));
jest.mock("../appVersionIdentity", () => ({
  getInstalledNativeBuildVersion: () => "42",
}));

import {
  __resetPushRegistrationHealthForTests,
  ensurePushRegistration,
  ensurePushRegistrationOnForeground,
} from "../pushRegistrationHealth";

function signOut(): void {
  sessionUserId = null;
  linkedTo = null; // logoutOneSignal unlinks the device
  logoutListener?.(); // logoutOneSignal tells listeners first, synchronously
}

const linksFor = (user: string): string[] => log.filter((l) => l.startsWith("repair:") && l.endsWith(user));
const reports = (): string[] => log.filter((l) => l.startsWith("report:"));

beforeEach(() => {
  jest.useFakeTimers();
  log.length = 0;
  sdkReady = false;
  linkedTo = null;
  sessionUserId = "user-a";
  rpcHook = null;
  rpcAction = "none";
  reading = 0;
  maxConcurrentReads = 0;
  __resetPushRegistrationHealthForTests();
});

afterEach(() => {
  jest.useRealTimers();
});

test("sign-out during the SDK wait: nothing links, opts in or reports afterwards", async () => {
  const run = ensurePushRegistration("user-a", "launch");
  await jest.advanceTimersByTimeAsync(10_000); // inside the first wait
  expect(logoutListener).not.toBeNull();
  signOut();
  sdkReady = true;
  await jest.advanceTimersByTimeAsync(200_000);
  await run;
  expect(linksFor("user-a")).toEqual([]);
  expect(reports()).toEqual([]);
  expect(linkedTo).toBeNull();
});

test("sign-out then sign-in as B during the wait: only B is linked and reported", async () => {
  const runA = ensurePushRegistration("user-a", "launch");
  await jest.advanceTimersByTimeAsync(30_000);
  signOut();
  sessionUserId = "user-b";
  const runB = ensurePushRegistration("user-b", "sign_in");
  sdkReady = true;
  await jest.advanceTimersByTimeAsync(200_000);
  await Promise.all([runA, runB]);
  await jest.advanceTimersByTimeAsync(200_000);
  expect(linksFor("user-a")).toEqual([]);
  expect(linksFor("user-b")).toEqual(["repair:relink:user-b"]);
  // P2-5: every report was filed while B was signed in, and says linked.
  expect(reports()).toEqual(["report:user-b:true"]);
  expect(linkedTo).toBe("user-b");
});

test("sign-out between the server's reregister answer and the repair: no resubscribe, no login", async () => {
  sdkReady = true;
  linkedTo = "user-a";
  rpcAction = "reregister";
  rpcHook = () => {
    rpcHook = null;
    signOut();
  };
  const run = ensurePushRegistration("user-a", "launch");
  await jest.advanceTimersByTimeAsync(200_000);
  await run;
  expect(log.filter((l) => l.includes("resubscribe"))).toEqual([]);
  expect(linkedTo).toBeNull();
  expect(reports()).toHaveLength(1);
});

test("background and foreground during the wait: still one run, one report", async () => {
  const run = ensurePushRegistration("user-a", "launch");
  await jest.advanceTimersByTimeAsync(20_000);
  // Fired, not awaited: a foreground event during a run shares that run.
  const fg1 = ensurePushRegistrationOnForeground();
  const fg2 = ensurePushRegistrationOnForeground();
  sdkReady = true;
  await jest.advanceTimersByTimeAsync(200_000);
  await Promise.all([run, fg1, fg2]);
  expect(reports()).toEqual(["report:user-a:true"]);
});

test("two overlapping checks never run at the same time", async () => {
  sdkReady = true;
  const a = ensurePushRegistration("user-a", "launch");
  const b = ensurePushRegistration("user-a", "sign_in");
  await jest.advanceTimersByTimeAsync(200_000);
  await Promise.all([a, b]);
  await jest.advanceTimersByTimeAsync(200_000);
  expect(maxConcurrentReads).toBe(1);
  expect(reports()).toEqual(["report:user-a:true", "report:user-a:true"]);
});

test("after sign-out a new check for the old account never links it", async () => {
  sdkReady = true;
  signOut();
  const run = ensurePushRegistration("user-a", "launch");
  await jest.advanceTimersByTimeAsync(200_000);
  await run;
  expect(linksFor("user-a")).toEqual([]);
  expect(reports()).toEqual([]);
});
