// MINGLA-INVARIANT: I-4549-HOST-APP-PUSH-SELF-REPAIR | issue #4549 | the Host app never returns silently when the push SDK is not up: it waits at most four bounded times, repairs only what the device can see, resubscribes at most once per launch for itself and once for the server, reports every run to report_host_push_device or to Sentry, and never repairs or prompts a device whose owner denied permission.
//
// #4549 S1 — pushRegistrationHealth against a mocked oneSignalService boundary.

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

const calls: string[] = [];
let readyAnswers: boolean[] = [];
let states: State[] = [];
let rpcAnswers: Array<{ data: unknown; error: { message: string } | null } | Error> = [];
const rpcArgs: Array<Record<string, unknown>> = [];
const nonFatal: string[] = [];
let sessionUserId: string | null = "user-a";

const baseState = (over: Partial<State> = {}): State => ({
  sdkReady: true,
  permission: "granted",
  canPrompt: false,
  subscriptionIdPresent: true,
  subscriptionId: "sub-1",
  tokenPresent: true,
  optedIn: true,
  externalId: "user-a",
  ...over,
});

jest.mock("../oneSignalService", () => ({
  whenOneSignalReady: async (ms: number) => {
    calls.push(`wait:${ms}`);
    return readyAnswers.length > 0 ? (readyAnswers.shift() as boolean) : true;
  },
  readPushRegistrationState: async () => {
    calls.push("read");
    return states.length > 1 ? states.shift() : states[0];
  },
  repairPushRegistration: async (userId: string, step: string) => {
    calls.push(`repair:${step}:${userId}`);
    return true;
  },
}));

jest.mock("../supabase", () => ({
  supabase: {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push(`rpc:${fn}`);
      rpcArgs.push(args);
      const next = rpcAnswers.length > 0
        ? rpcAnswers.shift()
        : { data: { action: "none" }, error: null };
      if (next instanceof Error) throw next;
      return next;
    },
    auth: {
      getSession: async () => ({
        data: { session: sessionUserId ? { user: { id: sessionUserId } } : null },
      }),
    },
  },
}));

jest.mock("../../diagnostics/reportNonFatal", () => ({
  reportNonFatal: (scope: string, error: unknown) => {
    nonFatal.push(`${scope}:${error instanceof Error ? error.message : String(error)}`);
  },
}));

jest.mock("../appVersionIdentity", () => ({
  getInstalledNativeBuildVersion: () => "42",
}));

import {
  __resetPushRegistrationHealthForTests,
  ensurePushRegistration,
  ensurePushRegistrationOnForeground,
} from "../pushRegistrationHealth";

let clock = 0;
const sleeps: number[] = [];

beforeEach(() => {
  calls.length = 0;
  rpcArgs.length = 0;
  nonFatal.length = 0;
  readyAnswers = [];
  states = [baseState()];
  rpcAnswers = [];
  sessionUserId = "user-a";
  clock = 1_000_000;
  sleeps.length = 0;
  __resetPushRegistrationHealthForTests({
    sleep: async (ms: number) => {
      sleeps.push(ms);
      clock += ms;
    },
    now: () => clock,
  });
});

const waits = (): number => calls.filter((c) => c.startsWith("wait:")).length;
const repairs = (): string[] => calls.filter((c) => c.startsWith("repair:"));

test("happy: ready, linked and opted in — no repair, one report with the device's state", async () => {
  await ensurePushRegistration("user-a", "launch");
  expect(repairs()).toEqual([]);
  expect(calls.filter((c) => c === "rpc:report_host_push_device")).toHaveLength(1);
  expect(rpcArgs[0]).toEqual({
    p_subscription_id: "sub-1",
    p_platform: "ios",
    p_app_build: "42",
    p_permission: "granted",
    p_opted_in: true,
    p_token_present: true,
    p_linked: true,
    p_reason: "launch",
  });
  expect(nonFatal).toEqual([]);
});

test("SDK not ready at launch: waits until ready (4th wait), never repairs or reads before", async () => {
  readyAnswers = [false, false, false, true];
  states = [baseState({ externalId: null }), baseState()];
  await ensurePushRegistration("user-a", "launch");
  expect(waits()).toBe(4);
  const firstRead = calls.indexOf("read");
  const lastWait = calls.lastIndexOf("wait:15000");
  expect(firstRead).toBeGreaterThan(lastWait);
  expect(calls.indexOf("repair:relink:user-a")).toBeGreaterThan(lastWait);
  // SC-3: the cold start still ends linked and reported, without a sign-in.
  expect(rpcArgs[rpcArgs.length - 1]).toMatchObject({ p_linked: true, p_opted_in: true });
  expect(sleeps.slice(0, 4)).toEqual([2_000, 5_000, 15_000, 60_000]);
});

test("SDK never ready: four waits maximum, sdk_not_ready reported, nothing else", async () => {
  readyAnswers = [false, false, false, false, true];
  await ensurePushRegistration("user-a", "launch");
  expect(waits()).toBe(4);
  expect(calls).not.toContain("read");
  expect(repairs()).toEqual([]);
  expect(nonFatal).toContain("push.registration:sdk_not_ready");
});

test("permission denied: no repair and no prompt; the report says denied", async () => {
  states = [baseState({ permission: "denied", optedIn: false })];
  await ensurePushRegistration("user-a", "launch");
  expect(repairs()).toEqual([]);
  expect(rpcArgs[0]).toMatchObject({ p_permission: "denied", p_opted_in: false });
});

test("permission revoked then restored: denied does nothing; granted and off relinks, then resubscribes", async () => {
  states = [baseState({ permission: "denied", optedIn: false })];
  await ensurePushRegistration("user-a", "launch");
  expect(repairs()).toEqual([]);

  clock += 6 * 60 * 1000;
  calls.length = 0;
  states = [
    baseState({ optedIn: false }),
    baseState({ optedIn: false }), // still off after relink
    baseState(), // on after resubscribe
  ];
  await ensurePushRegistration("user-a", "foreground");
  expect(repairs()).toEqual(["repair:relink:user-a", "repair:resubscribe:user-a"]);
  expect(rpcArgs[rpcArgs.length - 1]).toMatchObject({ p_opted_in: true, p_reason: "foreground" });
});

test("local resubscribe runs at most once per launch", async () => {
  states = [baseState({ optedIn: false })];
  await ensurePushRegistration("user-a", "launch");
  await ensurePushRegistration("user-a", "sign_in");
  expect(repairs().filter((r) => r.startsWith("repair:resubscribe"))).toHaveLength(1);
});

test("account switch without restart: linked to the old account, relinks to the new one", async () => {
  states = [baseState({ externalId: "user-old" }), baseState({ externalId: "user-new" })];
  await ensurePushRegistration("user-new", "sign_in");
  expect(repairs()).toEqual(["repair:relink:user-new"]);
  expect(rpcArgs[0]).toMatchObject({ p_linked: true, p_reason: "sign_in" });
});

test("server reregister: resubscribe exactly once per launch even when two reports return it", async () => {
  rpcAnswers = [
    { data: { action: "reregister" }, error: null },
    { data: { action: "none" }, error: null },
    { data: { action: "reregister" }, error: null },
  ];
  await ensurePushRegistration("user-a", "launch");
  await ensurePushRegistration("user-a", "sign_in");
  expect(repairs().filter((r) => r.startsWith("repair:resubscribe"))).toHaveLength(1);
});

test("foreground: at most every 5 minutes, and never for a signed-out app", async () => {
  await ensurePushRegistrationOnForeground();
  await ensurePushRegistrationOnForeground();
  expect(calls.filter((c) => c === "rpc:report_host_push_device")).toHaveLength(1);
  clock += 5 * 60 * 1000;
  await ensurePushRegistrationOnForeground();
  expect(calls.filter((c) => c === "rpc:report_host_push_device")).toHaveLength(2);
  clock += 10 * 60 * 1000;
  sessionUserId = null;
  await ensurePushRegistrationOnForeground();
  expect(calls.filter((c) => c === "rpc:report_host_push_device")).toHaveLength(2);
  expect(repairs()).toEqual([]);
});

test("one run in flight: a second launch call shares it", async () => {
  const first = ensurePushRegistration("user-a", "launch");
  const second = ensurePushRegistration("user-a", "foreground");
  await Promise.all([first, second]);
  expect(calls.filter((c) => c === "rpc:report_host_push_device")).toHaveLength(1);
});

test("report fails: reported to Sentry, kept, and sent on the next run that cannot build one", async () => {
  rpcAnswers = [new Error("network down")];
  await ensurePushRegistration("user-a", "launch");
  expect(nonFatal).toContain("push.registration:network down");
  readyAnswers = [false, false, false, false];
  await ensurePushRegistration("user-a", "sign_in");
  expect(rpcArgs).toHaveLength(2);
  expect(rpcArgs[1]).toEqual(rpcArgs[0]);
});

test("no subscription id even after relink: reported to Sentry, never a silent return", async () => {
  states = [baseState({ subscriptionIdPresent: false, subscriptionId: null })];
  await ensurePushRegistration("user-a", "launch");
  expect(repairs()).toEqual(["repair:relink:user-a"]);
  expect(nonFatal).toContain("push.registration:no_subscription_id");
  expect(rpcArgs).toHaveLength(0);
});
