// #2107 (Sentry REACT-NATIVE-1C) — TESTER adversarial test, safe-restart leg (Host copy; the modules are byte-identical).
//
// Angle the implementor suite does not cover: a restart whose reloadAsync
// resolved but did NOT restart leaves a restore timer pending (the process
// lives on). If the person taps "tap to refresh" again inside that window, the
// first attempt's late timer must never reopen the network in the middle of the
// second restart — that would release held requests while the bridge tears
// down, which is exactly the crash this fix exists to prevent.
//
// Runs against the real reloadNetworkFence module (the same fence the Supabase
// client and the XHR lockdown use on device) and the real createSafeReload.

import { createSafeReload } from "../safeReload";
import {
  closeNetworkFence,
  heldNetworkRequests,
  isNetworkFenceClosed,
  lockDownXhrSends,
  openNetworkFence,
  resetNetworkFenceForTests,
  trackNetworkRequest,
  waitForNetworkIdle,
} from "../reloadNetworkFence";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe("#2107 tester — a second tap inside the first restart's restore window", () => {
  afterEach(() => resetNetworkFenceForTests());

  it("the first attempt's late restore never reopens the network during the second restart", async () => {
    const nativeSend = jest.fn();
    const xhrPrototype: { send: (...args: unknown[]) => unknown } = { send: nativeSend };
    let reloadCalls = 0;
    const safeReload = createSafeReload({
      pause: [{ name: "app_network_fence", pause: closeNetworkFence, resume: openNetworkFence }],
      flush: [],
      lockdown: [
        {
          name: "xhr_lockdown",
          pause: () => {
            lockDownXhrSends(xhrPrototype);
          },
          resume: openNetworkFence,
        },
      ],
      settle: waitForNetworkIdle,
      reload: () => {
        reloadCalls += 1;
        // Attempt 1: resolves but the process lives on (no restart happened).
        // Attempt 2: the restart is underway and never returns to JS.
        return reloadCalls === 1 ? Promise.resolve() : new Promise<void>(() => undefined);
      },
      warn: () => undefined,
      stepCapMs: 20,
      flushCapMs: 20,
      settleCapMs: 20,
      restoreAfterMs: 120,
    });

    await safeReload(); // attempt 1 resolves; its restore timer is now pending
    expect(isNetworkFenceClosed()).toBe(true);

    await sleep(40); // the person taps again well inside the 120 ms window
    void safeReload(); // attempt 2 — its reload never returns
    await sleep(200); // well past attempt 1's restore timer

    expect(reloadCalls).toBe(2);
    // Mid-restart: the fence must still be closed and the XHR lockdown still on.
    expect(isNetworkFenceClosed()).toBe(true);
    const started = jest.fn(() => Promise.resolve("sent"));
    void trackNetworkRequest(started);
    await sleep(10);
    expect(started).not.toHaveBeenCalled();
    expect(heldNetworkRequests()).toBeGreaterThan(0);

    // Any other HTTP send (analytics, direct fetch) is still held, not sent.
    expect(xhrPrototype.send).not.toBe(nativeSend);
    xhrPrototype.send.call({}, "late-xhr");
    expect(nativeSend).not.toHaveBeenCalled();
  });
});
