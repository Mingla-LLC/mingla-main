// #2107 — finding R2 from the "SAFE-RESTART DEVICE TEST": the settle step
// counted a Supabase request only until its fetch promise resolved. Reading the
// body (`text()` / `json()`, on iOS RCTFileReaderModule readAsText) happens
// after that, so a restart could tear the bridge down mid-read — the one
// network-class crash on old code was exactly -[RCTFileReaderModule readAsText:].
//
// Enforces I-2107-SAFE-RELOAD-BODY-READ (declared once, in the Explorer copy of this suite).
//
// Runs against the real reloadNetworkFence and the real safeReloadRuntime
// settle step (byte-identical in app-mobile and mingla-business).

import { createSafeReload, SAFE_RELOAD_SETTLE_CAP_MS } from "../safeReload";
import {
  BODY_HOLD_CEILING_MS,
  BODY_READ_GRACE_MS,
  inFlightNetworkRequests,
  resetNetworkFenceForTests,
  trackNetworkRequest,
} from "../reloadNetworkFence";
import { buildSafeReloadDependencies } from "../safeReloadRuntime";

type FakeResponse = {
  ok: boolean;
  status: number;
  text: (...args: unknown[]) => Promise<string>;
  json: (...args: unknown[]) => Promise<unknown>;
};

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve: (v: T) => void = () => undefined;
  let reject: (e: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** A restart whose only step is the real runtime settle (fence idle + yield). */
function restartWithRealSettle(events: string[]): () => Promise<void> {
  const reload = async (): Promise<void> => {
    events.push("reload");
  };
  const { settle } = buildSafeReloadDependencies(reload);
  return createSafeReload({ pause: [], flush: [], lockdown: [], settle, reload, restoreAfterMs: 60_000 });
}

const flushMicrotasks = async (): Promise<void> => {
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
};

describe("#2107 R2 — a restart waits for a response body being read", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    resetNetworkFenceForTests();
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => {
    resetNetworkFenceForTests();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("happy: a body still being read keeps settle waiting; reload follows the read, after one macrotask", async () => {
    const events: string[] = [];
    const body = deferred<string>();
    const response: FakeResponse = {
      ok: true,
      status: 200,
      text: jest.fn(() => body.promise),
      json: jest.fn(async () => ({})),
    };
    // supabase-js: `const res = await fetch(...); const body = await res.text();`
    const caller = trackNetworkRequest(async () => response as unknown as Response).then(async (res) => {
      const text = await (res as unknown as FakeResponse).text();
      events.push(`read:${text}`);
      return text;
    });
    await flushMicrotasks();
    expect(response.text).not.toBe(undefined);
    expect(inFlightNetworkRequests()).toBe(1); // headers arrived, body still being read

    const done = restartWithRealSettle(events)();
    await jest.advanceTimersByTimeAsync(BODY_READ_GRACE_MS + 400);
    expect(events).toEqual([]); // past the unread grace: a read in progress still holds

    body.resolve("payload");
    await flushMicrotasks();
    expect(inFlightNetworkRequests()).toBe(0);
    expect(events).toEqual(["read:payload"]); // the yield: not reloaded in the same tick
    await jest.advanceTimersByTimeAsync(0);
    await done;
    await expect(caller).resolves.toBe("payload");
    expect(events).toEqual(["read:payload", "reload"]);
  });

  it("adversarial: a body nobody reads releases after the grace, well before the settle cap", async () => {
    const events: string[] = [];
    const response: FakeResponse = {
      ok: true,
      status: 204,
      text: jest.fn(async () => ""),
      json: jest.fn(async () => null),
    };
    await trackNetworkRequest(async () => response as unknown as Response);
    expect(inFlightNetworkRequests()).toBe(1);

    const done = restartWithRealSettle(events)();
    await jest.advanceTimersByTimeAsync(BODY_READ_GRACE_MS - 50);
    expect(events).toEqual([]);
    await jest.advanceTimersByTimeAsync(100);
    await done;
    expect(events).toEqual(["reload"]);
    expect(inFlightNetworkRequests()).toBe(0);
    expect(BODY_READ_GRACE_MS + 100).toBeLessThan(SAFE_RELOAD_SETTLE_CAP_MS);
  });

  it("adversarial: a body read that never settles cannot hold the count past the ceiling", async () => {
    const response: FakeResponse = {
      ok: true,
      status: 200,
      text: jest.fn(() => new Promise<string>(() => undefined)),
      json: jest.fn(async () => ({})),
    };
    const res = (await trackNetworkRequest(async () => response as unknown as Response)) as unknown as FakeResponse;
    void res.text();
    await jest.advanceTimersByTimeAsync(BODY_HOLD_CEILING_MS - 10);
    expect(inFlightNetworkRequests()).toBe(1);
    await jest.advanceTimersByTimeAsync(20);
    expect(inFlightNetworkRequests()).toBe(0);

    // And the restart itself still happens at the settle cap at the latest.
    const events: string[] = [];
    const again = (await trackNetworkRequest(async () => ({
      ok: true,
      status: 200,
      text: () => new Promise<string>(() => undefined),
      json: async () => ({}),
    }) as unknown as Response)) as unknown as FakeResponse;
    void again.text();
    const done = restartWithRealSettle(events)();
    await jest.advanceTimersByTimeAsync(SAFE_RELOAD_SETTLE_CAP_MS + 10);
    await done;
    expect(events).toEqual(["reload"]);
  });

  it("adversarial: a body read that throws or rejects still releases, and the caller sees its own error", async () => {
    const syncFailure = new Error("body already used");
    const asyncFailure = new Error("stream aborted");
    const throwing: FakeResponse = {
      ok: true,
      status: 200,
      text: () => {
        throw syncFailure;
      },
      json: () => Promise.reject(asyncFailure),
    };
    const res = (await trackNetworkRequest(async () => throwing as unknown as Response)) as unknown as FakeResponse;
    expect(inFlightNetworkRequests()).toBe(1);
    expect(() => res.text()).toThrow(syncFailure);
    expect(inFlightNetworkRequests()).toBe(0);

    const res2 = (await trackNetworkRequest(async () => ({
      ...throwing,
      text: async () => "",
    }) as unknown as Response)) as unknown as FakeResponse;
    expect(inFlightNetworkRequests()).toBe(1);
    await expect(res2.json()).rejects.toBe(asyncFailure);
    await flushMicrotasks();
    expect(inFlightNetworkRequests()).toBe(0);

    // A read that already released never double-counts later.
    await expect(res2.text()).resolves.toBe("");
    await jest.advanceTimersByTimeAsync(BODY_HOLD_CEILING_MS + 10);
    expect(inFlightNetworkRequests()).toBe(0);
  });
});
