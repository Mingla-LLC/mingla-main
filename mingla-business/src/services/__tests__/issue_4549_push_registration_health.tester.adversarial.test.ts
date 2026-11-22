// #4549 S1 — tester adversarial suite for pushRegistrationHealth. Angles the
// implementor suite does not take: a storm of foreground events while a run is
// slow, the exact bound when the SDK never starts, a sign-in arriving while a
// launch run waits, the server answering `reregister` on every report, a
// report call that keeps failing, and the web twin's shape.

(globalThis as { __DEV__?: boolean }).__DEV__ = false;

jest.mock("react-native", () => ({ Platform: { OS: "android" } }));

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
let ready: () => Promise<boolean> = async () => true;
let state: State;
let rpc: () => Promise<{ data: unknown; error: { message: string } | null }> =
  async () => ({ data: { action: "none" }, error: null });
const rpcArgs: Array<Record<string, unknown>> = [];
const nonFatal: string[] = [];
let sessionUserId: string | null = "user-a";

const base = (over: Partial<State> = {}): State => ({
  sdkReady: true,
  permission: "granted",
  canPrompt: false,
  subscriptionIdPresent: true,
  subscriptionId: "sub-x",
  tokenPresent: true,
  optedIn: true,
  externalId: "user-a",
  ...over,
});

jest.mock("../oneSignalService", () => ({
  whenOneSignalReady: async (ms: number) => {
    log.push(`wait:${ms}`);
    return ready();
  },
  readPushRegistrationState: async () => {
    log.push("read");
    return { ...state };
  },
  repairPushRegistration: async (userId: string, step: string) => {
    log.push(`repair:${step}:${userId}`);
    if (step === "relink" || step === "resubscribe") {
      state = { ...state, externalId: userId, subscriptionIdPresent: true, subscriptionId: state.subscriptionId ?? "sub-new" };
    }
    return true;
  },
}));

jest.mock("../supabase", () => ({
  supabase: {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      log.push(`rpc:${fn}`);
      rpcArgs.push(args);
      return rpc();
    },
    auth: {
      getSession: async () => ({
        data: { session: sessionUserId ? { user: { id: sessionUserId } } : null },
      }),
    },
  },
}));

jest.mock("../../diagnostics/reportNonFatal", () => ({
  reportNonFatal: (scope: string, error: unknown, extra?: Record<string, unknown>) => {
    nonFatal.push(`${scope}:${error instanceof Error ? error.message : String(error)}:${JSON.stringify(extra ?? {})}`);
  },
}));

jest.mock("../appVersionIdentity", () => ({
  getInstalledNativeBuildVersion: () => "43",
}));

import * as native from "../pushRegistrationHealth";
import * as web from "../pushRegistrationHealth.web";
import {
  __resetPushRegistrationHealthForTests,
  ensurePushRegistration,
  ensurePushRegistrationOnForeground,
} from "../pushRegistrationHealth";

let clock = 0;
const sleeps: number[] = [];

beforeEach(() => {
  log.length = 0;
  rpcArgs.length = 0;
  nonFatal.length = 0;
  sleeps.length = 0;
  ready = async () => true;
  state = base();
  rpc = async () => ({ data: { action: "none" }, error: null });
  sessionUserId = "user-a";
  clock = 5_000_000;
  __resetPushRegistrationHealthForTests({
    sleep: async (ms: number) => {
      sleeps.push(ms);
      clock += ms;
    },
    now: () => clock,
  });
});

const count = (prefix: string): number => log.filter((l) => l.startsWith(prefix)).length;

describe("#4549 tester: pushRegistrationHealth under pressure", () => {
  it("a storm of 50 foreground events during a slow run starts one run and one report", async () => {
    let release: (v: boolean) => void = () => undefined;
    ready = () => new Promise<boolean>((r) => { release = r; });
    const first = ensurePushRegistrationOnForeground();
    for (let i = 0; i < 50 && count("wait:") === 0; i++) await new Promise((r) => setImmediate(r));
    expect(count("wait:")).toBe(1);
    const storm = Array.from({ length: 50 }, () => ensurePushRegistrationOnForeground());
    release(true);
    ready = async () => true;
    await Promise.all([first, ...storm]);
    await new Promise((r) => setImmediate(r));
    expect(count("rpc:")).toBe(1);
    expect(count("wait:")).toBe(1);
    // Inside 5 minutes: nothing. After: exactly one more.
    await ensurePushRegistrationOnForeground();
    expect(count("rpc:")).toBe(1);
    clock += 5 * 60 * 1000;
    await ensurePushRegistrationOnForeground();
    expect(count("rpc:")).toBe(2);
  });

  it("an SDK that never starts: exactly 4 bounded waits, pauses 2/5/15/60 s, one sdk_not_ready, no repair, no report", async () => {
    ready = async () => false;
    await ensurePushRegistration("user-a", "launch");
    expect(log.filter((l) => l.startsWith("wait:"))).toEqual(["wait:15000", "wait:15000", "wait:15000", "wait:15000"]);
    expect(sleeps).toEqual([2_000, 5_000, 15_000, 60_000]);
    expect(count("repair:")).toBe(0);
    expect(count("rpc:")).toBe(0);
    expect(nonFatal.filter((n) => n.includes("sdk_not_ready"))).toHaveLength(1);
    // The next launch-type run tries again rather than giving up forever.
    ready = async () => true;
    await ensurePushRegistration("user-a", "launch");
    expect(count("rpc:")).toBe(1);
  });

  it("a sign-in that arrives while the launch run waits runs next, for the new account, and relinks it", async () => {
    let release: (v: boolean) => void = () => undefined;
    let first = true;
    ready = () => {
      if (!first) return Promise.resolve(true);
      first = false;
      return new Promise<boolean>((r) => { release = r; });
    };
    const launch = ensurePushRegistration("user-a", "launch");
    for (let i = 0; i < 50 && count("wait:") === 0; i++) await new Promise((r) => setImmediate(r));
    expect(count("wait:")).toBe(1);
    void ensurePushRegistration("user-b", "sign_in");
    release(true);
    await launch;
    for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
    const repairsForB = log.filter((l) => l === "repair:relink:user-b");
    expect(repairsForB).toHaveLength(1);
    expect(state.externalId).toBe("user-b");
    expect(rpcArgs[rpcArgs.length - 1]).toMatchObject({ p_linked: true, p_reason: "sign_in" });
  });

  it("a server that answers reregister on every report gets one resubscribe per launch, never a loop", async () => {
    rpc = async () => ({ data: { action: "reregister" }, error: null });
    for (let i = 0; i < 5; i++) {
      clock += 6 * 60 * 1000;
      await ensurePushRegistration("user-a", i === 0 ? "launch" : "foreground");
    }
    expect(count("repair:resubscribe")).toBe(1);
    // 5 runs, plus one follow-up report after the one resubscribe.
    expect(count("rpc:")).toBe(6);
  });

  it("an unexpected server answer is treated as none", async () => {
    rpc = async () => ({ data: { action: "delete_everything" }, error: null });
    await ensurePushRegistration("user-a", "launch");
    rpc = async () => ({ data: null, error: null });
    clock += 6 * 60 * 1000;
    await ensurePushRegistration("user-a", "foreground");
    expect(count("repair:")).toBe(0);
  });

  it("a report call that keeps failing is reported to Sentry each time with no ids, and never retried in a loop", async () => {
    rpc = async () => ({ data: null, error: { message: "network request failed" } });
    for (let i = 0; i < 3; i++) {
      clock += 6 * 60 * 1000;
      await ensurePushRegistration("user-a", "foreground");
    }
    expect(count("rpc:")).toBe(3);
    const reports = nonFatal.filter((n) => n.includes("network request failed"));
    expect(reports).toHaveLength(3);
    for (const n of nonFatal) {
      expect(n).not.toContain("user-a");
      expect(n).not.toContain("sub-x");
    }
  });

  it("denied permission: no repair, no prompt path, report says denied", async () => {
    state = base({ permission: "denied", optedIn: false, tokenPresent: false });
    await ensurePushRegistration("user-a", "launch");
    expect(count("repair:")).toBe(0);
    expect(rpcArgs[0]).toMatchObject({ p_permission: "denied", p_platform: "android", p_app_build: "43" });
  });

  it("the web twin exports the same names as the native module and does nothing", async () => {
    expect(Object.keys(web).sort()).toEqual(Object.keys(native).sort());
    await web.ensurePushRegistration("user-a", "launch");
    await web.ensurePushRegistrationOnForeground();
    expect(log).toEqual([]);
  });
});
