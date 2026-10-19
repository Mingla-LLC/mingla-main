// #2107 — Sentry REACT-NATIVE-1C: an in-app restart must never let a request
// start while the bridge tears down.
//
// Explorer 1.1.6: the optional "tap to refresh" banner called reloadAsync and,
// 70 ms later, a Supabase upsert went out mid-teardown — NSInvalidArgumentException
// in -[RCTNetworking prioritizedHandlers], a fatal crash. Every restart now goes
// through safeReload: pause -> flush -> lockdown -> settle -> reload, failing
// open if the restart does not happen.
//
// MINGLA-INVARIANT: I-2107-SAFE-RELOAD | issue #2107 | Every in-app restart goes through safeReload: app network work is paused and new requests are held before reloadAsync, in-flight writes settle (capped), and a failed restart restores the app.
//
// The structural half (no bare reloadAsync anywhere, both copies identical) is
// .github/scripts/strict-grep/issue-2107-mandatory-js-update.mjs.

import {
  createSafeReload,
  SAFE_RELOAD_RESTORE_AFTER_MS,
  SAFE_RELOAD_SETTLE_CAP_MS,
  SAFE_RELOAD_STEP_CAP_MS,
  type SafeReloadDependencies,
  type SafeReloadPhase,
} from "../safeReload";
import {
  createTrackedFetch,
  heldNetworkRequests,
  inFlightNetworkRequests,
  isNetworkFenceClosed,
  resetNetworkFenceForTests,
} from "../reloadNetworkFence";

const mockRealtime = { removeAllChannels: jest.fn(async (): Promise<unknown[]> => []) };
const mockPostHog = { flush: jest.fn(async (): Promise<void> => undefined) };

jest.mock("../../config/queryClient", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { QueryClient } = require("@tanstack/react-query") as typeof import("@tanstack/react-query");
  return { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) };
});
jest.mock("../supabase", () => ({ supabase: mockRealtime }));
jest.mock("../postHogService", () => ({
  postHogService: { getClient: () => mockPostHog },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { onlineManager } = require("@tanstack/react-query") as typeof import("@tanstack/react-query");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { queryClient } = require("../../config/queryClient") as {
  queryClient: import("@tanstack/react-query").QueryClient;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { buildSafeReloadDependencies } = require("../safeReloadRuntime") as typeof import("../safeReloadRuntime");

/** A stand-in XMLHttpRequest that records every send that actually happens. */
class FakeXhr {
  static sends: string[] = [];
  send(body?: string): void {
    FakeXhr.sends.push(body ?? "");
  }
}

type FakeCall = { url: string; settle: (status: number) => void };

function fakeNetwork(): {
  calls: FakeCall[];
  fetch: (input: RequestInfo | URL) => Promise<Response>;
} {
  const calls: FakeCall[] = [];
  return {
    calls,
    fetch: (input) =>
      new Promise<Response>((resolve) => {
        calls.push({
          url: String(input),
          settle: (status) => resolve({ ok: status < 400, status } as Response),
        });
      }),
  };
}

const flushMicrotasks = async (): Promise<void> => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
};

describe("#2107 safeReload — no request starts while the app restarts", () => {
  const xhrHolder = globalThis as { XMLHttpRequest?: unknown };
  let originalXhr: unknown;

  beforeEach(() => {
    resetNetworkFenceForTests();
    FakeXhr.sends = [];
    originalXhr = xhrHolder.XMLHttpRequest;
    xhrHolder.XMLHttpRequest = FakeXhr;
    onlineManager.setOnline(true);
    mockRealtime.removeAllChannels.mockClear();
    mockPostHog.flush.mockClear();
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => {
    resetNetworkFenceForTests();
    xhrHolder.XMLHttpRequest = originalXhr;
    onlineManager.setOnline(true);
    queryClient.clear();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("happy: pause -> flush -> lockdown -> settle -> reload; an in-flight write finishes; nothing new starts", async () => {
    const network = fakeNetwork();
    const supabaseFetch = createTrackedFetch(() => network.fetch);
    const phases: string[] = [];
    let startedAfterPause = 0;
    let pauseBegan = false;
    const queryFn = jest.fn(async () => "fresh");

    // The person's write is already on the wire when they tap the banner.
    const write = supabaseFetch("https://x/rest/v1/visits?on_conflict=profile_id,experience_id");
    expect(network.calls).toHaveLength(1);
    expect(inFlightNetworkRequests()).toBe(1);

    let atRestart: {
      fetches: number;
      xhrSends: number;
      queryRuns: number;
      held: number;
      online: boolean;
      writeSettled: boolean;
    } | null = null;
    let writeSettled = false;
    void write.then(() => {
      writeSettled = true;
    });
    const reload = jest.fn(async (): Promise<void> => {
      phases.push("reload:called");
      // Snapshot the world at the moment of the restart.
      atRestart = {
        fetches: network.calls.length,
        xhrSends: FakeXhr.sends.length,
        queryRuns: queryFn.mock.calls.length,
        held: heldNetworkRequests(),
        online: onlineManager.isOnline(),
        writeSettled,
      };
      startedAfterPause = network.calls.length - 1 + FakeXhr.sends.length + queryFn.mock.calls.length;
    });

    // A short restore grace so this test also sees the process-lived-on path.
    const dependencies = { ...buildSafeReloadDependencies(reload), restoreAfterMs: 20 };
    const safeReload = createSafeReload(dependencies, (phase: SafeReloadPhase, name?: string) => {
      phases.push(name === undefined ? phase : `${phase}:${name}`);
      if (phase === "pause" && !pauseBegan) pauseBegan = true;
      if (phase === "settle") {
        // A realtime handler / user action fires mid-restart: a Supabase upsert,
        // a direct XHR, and a query. None of them may start.
        void supabaseFetch("https://x/rest/v1/visits?on_conflict=profile_id,experience_id");
        new FakeXhr().send("direct");
        void queryClient
          .fetchQuery({ queryKey: ["issue-2107", "mid-restart"], queryFn })
          .catch(() => undefined);
        // The write completes shortly after; settle lets it.
        setTimeout(() => network.calls[0].settle(200), 50);
      }
    });

    await safeReload();
    await expect(write).resolves.toMatchObject({ status: 200 });

    expect(pauseBegan).toBe(true);
    expect(phases).toEqual([
      "pause:app_network_fence",
      "pause:react_query",
      "pause:realtime",
      "flush:posthog",
      "lockdown:xhr_lockdown",
      "settle",
      "reload",
      "reload:called",
    ]);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(startedAfterPause).toBe(0);
    expect(atRestart).toEqual({
      fetches: 1, // only the write that was already on the wire
      xhrSends: 0,
      queryRuns: 0,
      held: 2, // the mid-restart upsert and the direct XHR, held not dropped
      online: false,
      writeSettled: true, // settle let the person's write finish first
    });
    expect(mockRealtime.removeAllChannels).toHaveBeenCalledTimes(1);
    expect(mockPostHog.flush).toHaveBeenCalledTimes(1);

    // The process lived on (no real restart in a test): everything comes back.
    await new Promise((resolve) => setTimeout(resolve, 60));
    await flushMicrotasks();
    expect(isNetworkFenceClosed()).toBe(false);
    expect(onlineManager.isOnline()).toBe(true);
    expect(network.calls).toHaveLength(2);
    expect(FakeXhr.sends).toEqual(["direct"]);
  });

  it("adversarial: a query that ignores offline (Host's networkMode \"always\") still cannot reach the network", async () => {
    const network = fakeNetwork();
    const supabaseFetch = createTrackedFetch(() => network.fetch);
    let atRestart = -1;
    const dependencies = {
      ...buildSafeReloadDependencies(async () => {
        await flushMicrotasks();
        atRestart = network.calls.length;
      }),
      restoreAfterMs: 0,
    };
    const safeReload = createSafeReload(dependencies, (phase) => {
      if (phase === "settle") {
        void queryClient
          .fetchQuery({
            queryKey: ["issue-2107", "always"],
            networkMode: "always",
            queryFn: () => supabaseFetch("https://x/rest/v1/brands"),
          })
          .catch(() => undefined);
      }
    });
    await safeReload();
    expect(atRestart).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, 10));
    await flushMicrotasks();
    expect(network.calls).toHaveLength(1); // released once the app lived on
  });

  it("adversarial: the reload rejects -> everything restored, held requests sent, app online, error surfaced", async () => {
    const network = fakeNetwork();
    const supabaseFetch = createTrackedFetch(() => network.fetch);
    const failure = new Error("reload refused");
    const dependencies = buildSafeReloadDependencies(async () => {
      throw failure;
    });
    const safeReload = createSafeReload(dependencies, (phase) => {
      if (phase === "settle") {
        void supabaseFetch("https://x/held");
        new FakeXhr().send("held-xhr");
      }
    });

    await expect(safeReload()).rejects.toBe(failure);
    await flushMicrotasks();

    expect(isNetworkFenceClosed()).toBe(false);
    expect(onlineManager.isOnline()).toBe(true);
    expect(heldNetworkRequests()).toBe(0);
    expect(network.calls.map((call) => call.url)).toEqual(["https://x/held"]);
    expect(FakeXhr.sends).toEqual(["held-xhr"]);
    // The prototype is back to the original: a new send goes straight out.
    new FakeXhr().send("after");
    expect(FakeXhr.sends).toEqual(["held-xhr", "after"]);
  });

  it("adversarial: a step that throws, a flush that rejects and a step that hangs never stop the reload", async () => {
    jest.useFakeTimers();
    const reload = jest.fn(async (): Promise<void> => undefined);
    const resumed: string[] = [];
    const dependencies: SafeReloadDependencies = {
      pause: [
        { name: "throws", pause: () => { throw new Error("boom"); }, resume: () => { resumed.push("throws"); } },
        { name: "hangs", pause: () => new Promise<void>(() => undefined), resume: () => { resumed.push("hangs"); } },
      ],
      flush: [{ name: "analytics", run: async () => { throw new Error("offline"); } }],
      lockdown: [],
      settle: async () => undefined,
      reload,
    };
    const done = createSafeReload(dependencies)();
    await jest.advanceTimersByTimeAsync(SAFE_RELOAD_STEP_CAP_MS + 10);
    await done;
    expect(reload).toHaveBeenCalledTimes(1);
    expect(resumed).toEqual([]);
  });

  it("adversarial: settle never resolves -> the reload happens at the cap, not before", async () => {
    jest.useFakeTimers();
    const reload = jest.fn(async (): Promise<void> => undefined);
    const done = createSafeReload({
      pause: [],
      flush: [],
      lockdown: [],
      settle: () => new Promise<void>(() => undefined),
      reload,
    })();
    await jest.advanceTimersByTimeAsync(SAFE_RELOAD_SETTLE_CAP_MS - 50);
    expect(reload).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(100);
    await done;
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("adversarial: the reload resolves but the process lives on -> restored after the grace, once", async () => {
    jest.useFakeTimers();
    const resumed: string[] = [];
    const safeReload = createSafeReload({
      pause: [{ name: "a", pause: () => undefined, resume: () => { resumed.push("a"); } }],
      flush: [],
      lockdown: [{ name: "b", pause: () => undefined, resume: () => { resumed.push("b"); } }],
      settle: async () => undefined,
      reload: async () => undefined,
    });
    await safeReload();
    expect(resumed).toEqual([]);
    await jest.advanceTimersByTimeAsync(SAFE_RELOAD_RESTORE_AFTER_MS + 10);
    // Lockdown is undone first, then the pause, in reverse.
    expect(resumed).toEqual(["b", "a"]);
    await jest.advanceTimersByTimeAsync(SAFE_RELOAD_RESTORE_AFTER_MS * 2);
    expect(resumed).toEqual(["b", "a"]);
  });

  it("adversarial: a second tap joins the restart in progress instead of starting another", async () => {
    let release: () => void = () => undefined;
    const reload = jest.fn(
      () => new Promise<void>((resolve) => { release = resolve; }),
    );
    const safeReload = createSafeReload({
      pause: [],
      flush: [],
      lockdown: [],
      settle: async () => undefined,
      reload,
      restoreAfterMs: 0,
    });
    const first = safeReload();
    const second = safeReload();
    expect(second).toBe(first);
    await flushMicrotasks();
    release();
    await Promise.all([first, second]);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
