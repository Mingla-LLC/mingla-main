// Issue #4423 (W1.1, W1.6): the gate every background read goes through.
//
// lib/pollGate.js with an injected clock and a fixed `random` (0.5 = no
// jitter) unless a test sets the jitter bounds on purpose.
//
// FAILS-ON-REVERT: delete the in-flight check in why() and "dedupe" goes red;
// delete the backoff assignment in settle() and "backoff" goes red; delete the
// breaker trip and "breaker" goes red; delete the budget check and "budget"
// goes red.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  BACKOFF_STEPS_MS,
  BREAKER_BASE_MS,
  BREAKER_MAX_MS,
  POLL_BUDGET,
  createPollGate,
  createPoller,
  gatedRun,
  isServerFailure,
} from "../lib/pollGate.js";

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, set: (v) => { t = v; }, add: (ms) => { t += ms; } };
}

const S503 = { ok: false, status: 503 };

describe("#4423 pollGate: dedupe in flight", () => {
  it("a key with a read in flight never starts a second one", () => {
    const c = clock();
    const g = createPollGate({ now: c.now, random: () => 0.5 });
    assert.equal(g.allow("ops_work_list"), true);
    g.start("ops_work_list");
    for (let i = 0; i < 50; i += 1) assert.equal(g.allow("ops_work_list"), false);
    assert.equal(g.why("ops_work_list"), "in_flight");
    // other keys are not held by it
    assert.equal(g.allow("ops_config"), true);
    g.settle("ops_work_list", { ok: true });
    assert.equal(g.allow("ops_work_list"), true);
  });

  it("gatedRun: 20 overlapping background calls of one key send exactly 1 request", async () => {
    const c = clock();
    const g = createPollGate({ now: c.now, random: () => 0.5 });
    let sent = 0;
    let release;
    const slow = () => { sent += 1; return new Promise((r) => { release = r; }); };
    const runs = Array.from({ length: 20 }, () => gatedRun(g, "team_inbox", slow));
    const settled = await Promise.race([Promise.all(runs.slice(1)), new Promise((r) => setTimeout(() => r("pending"), 20))]);
    assert.equal(sent, 1);
    assert.ok(Array.isArray(settled) && settled.every((r) => r.skipped && r.why === "in_flight"));
    release("data");
    const first = await runs[0];
    assert.deepEqual([first.ok, first.data], [true, "data"]);
  });
});

describe("#4423 pollGate: backoff on server failures", () => {
  it("waits 30 / 60 / 120 / 240 / 300 / 300 s after consecutive 5xx (no jitter)", () => {
    const c = clock();
    const g = createPollGate({ now: c.now, random: () => 0.5 });
    const waits = [];
    for (let n = 0; n < 6; n += 1) {
      assert.equal(g.allow("k"), true);
      g.start("k");
      assert.equal(g.settle("k", S503), "backoff");
      const retry = g.state().backoff.k.retryInMs;
      waits.push(retry);
      c.add(retry - 1);
      assert.equal(g.allow("k"), false, `still held 1 ms before the retry (step ${n})`);
      c.add(1);
    }
    assert.deepEqual(waits, [30_000, 60_000, 120_000, 240_000, 300_000, 300_000]);
    assert.deepEqual(BACKOFF_STEPS_MS, [30_000, 60_000, 120_000, 240_000, 300_000]);
  });

  it("jitter stays within +-20 %, at both extremes of random()", () => {
    for (const r of [0, 0.999999]) {
      const c = clock();
      const g = createPollGate({ now: c.now, random: () => r });
      for (let n = 0; n < 5; n += 1) {
        g.start("k");
        g.settle("k", S503);
        const wait = g.state().backoff.k.retryInMs;
        const base = BACKOFF_STEPS_MS[n];
        assert.ok(wait >= base * 0.8 - 1 && wait <= base * 1.2 + 1, `${wait} within ${base} +-20%`);
        c.add(wait);
      }
    }
  });

  it("a success resets the key to no wait", () => {
    const c = clock();
    const g = createPollGate({ now: c.now, random: () => 0.5 });
    g.start("k"); g.settle("k", S503);
    c.add(30_000);
    g.start("k"); g.settle("k", { ok: true });
    assert.equal(g.allow("k"), true);
    g.start("k"); g.settle("k", S503);
    assert.equal(g.state().backoff.k.retryInMs, 30_000, "back to the first step");
  });

  it("each server-side failure kind backs off: 5xx, PGRST003, statement timeout, network, timeout, the request ceiling", () => {
    const cases = [
      { status: 500 }, { status: 502 }, { status: 503 }, { status: 504 },
      { code: "PGRST003" }, { code: "57014" },
      { error: { token: "network" } },
      { error: new TypeError("Failed to fetch") },
      { error: Object.assign(new Error("signal timed out"), { name: "TimeoutError" }) },
      { error: Object.assign(new Error("aborted"), { name: "AbortError" }) },
      { error: { message: "TimeoutError: signal timed out" } },
      { error: { message: "Error: request_ceiling" } },
    ];
    for (const outcome of cases) assert.equal(isServerFailure(outcome), true, JSON.stringify(outcome));
  });

  it("a 4xx is not backed off (today's behaviour), and an unknown failure is not either", () => {
    const c = clock();
    const g = createPollGate({ now: c.now, random: () => 0.5 });
    for (const status of [400, 401, 403, 404, 409, 422]) {
      g.start("k");
      assert.equal(g.settle("k", { ok: false, status }), "failed");
      assert.equal(g.allow("k"), true, `${status} must not hold the key`);
    }
    g.start("k");
    assert.equal(g.settle("k", { ok: false, error: { token: "forbidden", message: "" } }), "failed");
    assert.equal(g.allow("k"), true);
  });

  it("supabase-js hides the status: a transport failure seen by the fetch layer during the read counts", () => {
    const c = clock();
    let seq = 0;
    const g = createPollGate({ now: c.now, random: () => 0.5, transportFailureSeq: () => seq });
    g.start("k");
    seq += 1; // governedFetch saw a 503 while this read was in flight
    assert.equal(g.settle("k", { ok: false, error: { token: "unknown" } }), "backoff");
    // a failure with no transport failure in its window is not backed off
    c.add(30_000);
    g.start("k");
    assert.equal(g.settle("k", { ok: false, error: { token: "unknown" } }), "failed");
  });
});

describe("#4423 pollGate: the tab-wide breaker", () => {
  it("opens when 5 of the last 10 background reads failed, pauses every key, and closes on the first success", () => {
    const c = clock();
    const g = createPollGate({ now: c.now, random: () => 0.5 });
    // 5 successes then 4 failures: closed
    for (let i = 0; i < 5; i += 1) { g.start(`ok${i}`); g.settle(`ok${i}`, { ok: true }); }
    for (let i = 0; i < 4; i += 1) { g.start(`bad${i}`); g.settle(`bad${i}`, S503); }
    assert.equal(g.state().breakerOpen, false);
    assert.equal(g.allow("fresh"), true);
    // the 5th failure in the window opens it
    g.start("bad4"); g.settle("bad4", S503);
    let st = g.state();
    assert.equal(st.breakerOpen, true);
    assert.equal(st.breakerRetryInMs, BREAKER_BASE_MS);
    assert.equal(g.allow("fresh"), false);
    assert.equal(g.why("unrelated"), "breaker");
    // 60 s later a probe may go; it succeeds; the breaker closes
    c.add(BREAKER_BASE_MS);
    assert.equal(g.allow("fresh"), true);
    g.start("fresh"); g.settle("fresh", { ok: true });
    st = g.state();
    assert.equal(st.breakerOpen, false);
    assert.equal(st.breakerMs, 0);
    assert.equal(g.allow("other"), true);
  });

  it("a failing probe re-opens it for twice as long, up to 300 s", () => {
    const c = clock();
    const g = createPollGate({ now: c.now, random: () => 0.5 });
    for (let i = 0; i < 5; i += 1) { g.start(`b${i}`); g.settle(`b${i}`, S503); }
    const pauses = [g.state().breakerRetryInMs];
    for (let n = 0; n < 4; n += 1) {
      c.add(pauses[pauses.length - 1]);
      const key = `probe${n}`;
      assert.equal(g.allow(key), true, "a probe may go when the pause ends");
      g.start(key); g.settle(key, S503);
      pauses.push(g.state().breakerRetryInMs);
    }
    assert.deepEqual(pauses, [60_000, 120_000, 240_000, 300_000, 300_000]);
    assert.equal(BREAKER_MAX_MS, 300_000);
  });

  it("4xx answers never open it", () => {
    const c = clock();
    const g = createPollGate({ now: c.now, random: () => 0.5 });
    for (let i = 0; i < 20; i += 1) { g.start(`k${i}`); g.settle(`k${i}`, { ok: false, status: 403 }); }
    assert.equal(g.state().breakerOpen, false);
  });

  it("a person's own refresh (not background) still closes it when it succeeds", () => {
    const c = clock();
    const g = createPollGate({ now: c.now, random: () => 0.5 });
    for (let i = 0; i < 5; i += 1) { g.start(`b${i}`); g.settle(`b${i}`, S503); }
    assert.equal(g.state().breakerOpen, true);
    g.start("manual", { background: false });
    g.settle("manual", { ok: true }, { background: false });
    assert.equal(g.state().breakerOpen, false);
  });
});

describe("#4423 pollGate: the 60 per minute background budget", () => {
  it("allows exactly 60 background reads in a rolling 60 s, then skips", () => {
    const c = clock();
    const g = createPollGate({ now: c.now, random: () => 0.5 });
    let allowed = 0;
    for (let i = 0; i < 200; i += 1) {
      const key = `k${i}`;
      if (g.allow(key)) { allowed += 1; g.start(key); g.settle(key, { ok: true }); }
      c.add(100); // 200 tries in 20 s
    }
    assert.equal(POLL_BUDGET, 60);
    assert.equal(allowed, 60);
    assert.equal(g.why("another"), "budget");
    // the window rolls: 60 s after the first read, room again
    c.set(1_000_000 + 60_000);
    assert.equal(g.allow("another"), true);
  });

  it("a person's own refresh does not use the budget and is never held", async () => {
    const c = clock();
    const g = createPollGate({ now: c.now, random: () => 0.5 });
    for (let i = 0; i < 60; i += 1) { g.start(`k${i}`); g.settle(`k${i}`, { ok: true }); }
    assert.equal(g.allow("x"), false);
    const r = await gatedRun(g, "x", async () => "fresh", { background: false });
    assert.equal(r.ok, true);
    assert.equal(g.state().budgetUsed, 60);
  });
});

describe("#4423 createPoller: the timer counts from the last refresh", () => {
  function fakeTimers(c) {
    const q = [];
    let id = 0;
    return {
      setTimer: (fn, ms) => { const h = { id: ++id, at: c.now() + ms, fn }; q.push(h); return h; },
      clearTimer: (h) => { const i = q.indexOf(h); if (i >= 0) q.splice(i, 1); },
      async run(until) {
        for (;;) {
          q.sort((a, b) => a.at - b.at || a.id - b.id);
          const h = q[0];
          if (!h || h.at > until) break;
          q.shift();
          c.set(h.at);
          h.fn();
          await new Promise((r) => setImmediate(r));
        }
        c.set(until);
      },
    };
  }

  it("a page-return refresh pushes the next timer tick a full interval back; the tick marks refreshed", async () => {
    const c = clock(0);
    const timers = fakeTimers(c);
    const calls = [];
    let marked = 0;
    let returnFn = null;
    const pageReturn = { subscribePageReturn: (fn) => { returnFn = fn; return () => { returnFn = null; }; }, markRefreshed: () => { marked += 1; } };
    const p = createPoller({
      refresh: async ({ quiet }) => { calls.push([c.now(), quiet]); return { skipped: false }; },
      intervalMs: 30_000, pageReturn, isVisible: () => true, isOnline: () => true, setTimer: timers.setTimer, clearTimer: timers.clearTimer,
    });
    p.start();
    await new Promise((r) => setImmediate(r));
    await timers.run(20_000);
    returnFn();
    await new Promise((r) => setImmediate(r));
    await timers.run(49_999);
    assert.deepEqual(calls.map(([t]) => t), [0, 20_000], "no tick at 30 s: the return at 20 s re-armed it");
    await timers.run(50_000);
    assert.deepEqual(calls.map(([t, q]) => [t, q]), [[0, false], [20_000, true], [50_000, true]]);
    assert.equal(marked, 1);
    p.stop();
    await timers.run(500_000);
    assert.equal(calls.length, 3, "nothing after stop");
    assert.equal(returnFn, null, "unsubscribed");
  });

  it("a hidden tab's timer makes no request and does not mark refreshed", async () => {
    const c = clock(0);
    const timers = fakeTimers(c);
    let calls = 0;
    let marked = 0;
    const p = createPoller({
      refresh: async ({ quiet }) => { if (quiet) calls += 1; return { skipped: false }; },
      intervalMs: 30_000,
      pageReturn: { subscribePageReturn: () => () => {}, markRefreshed: () => { marked += 1; } },
      isVisible: () => false, isOnline: () => true, setTimer: timers.setTimer, clearTimer: timers.clearTimer,
    });
    p.start();
    await timers.run(600_000);
    assert.equal(calls, 0);
    assert.equal(marked, 0);
    p.stop();
  });
});
