// Issue #4423 (W1.6, W1-D1..D4 in a model): one Admin tab on the Work board.
//
// Every poller the Work tab mounts (Forensics A's table) is built from the
// REAL modules the hooks use: lib/pageReturn (createPageReturn), lib/pollGate
// (createPollGate, createPoller, gatedRun) and lib/authEvents. Only the clock,
// the timers, the window/document (Node EventTarget) and the RPCs are fakes.
// Each RPC takes 200 ms of fake time, so in-flight dedupe matters.
//
// Done criteria asserted (exact counts where the timeline is deterministic):
//   W1-D1  100 focus + 100 visibilitychange in 10 s  -> <= 14 RPCs (exactly 12)
//   W1-D2  the same, continuously for 60 s           -> <= 42 RPCs (exactly 36)
//   W1-D3  a hidden tab, 10 hidden->visible toggles elsewhere and 100 SIGNED_IN echoes -> 0
//   W1-D4  one key answering 503: retries >= 30 s apart, then doubling
//   plus the per-tab background budget (<= 60 per minute) under a storm.
//
// FAILS-ON-REVERT: delete the gap check in lib/pageReturn.js (emitReturn) and
// D1/D2 go red (1,200 and 7,200 RPCs); delete the in-flight check in
// lib/pollGate.js why() and the in-flight test goes red.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createPageReturn } from "../lib/pageReturn.js";
import { createPollGate, createPoller, gatedRun } from "../lib/pollGate.js";
import { decideAuthEvent } from "../lib/authEvents.js";

// The Work tab's background reads (Forensics A): gate key, RPCs per read, timer.
const WORK_TAB = [
  ["auth-access", ["admin_team_my_access", "admin_team_my_operational_areas"], 30_000],
  ["ops:work-list", ["ops_work_list"], 30_000],
  ["ops:config", ["ops_config"], 0],
  ["ops:people", ["ops_people_directory"], 300_000],
  ["ops:status-list", ["ops_status_list"], 60_000],
  ["ops:sprint-plan", ["ops_sprint_plan_get"], 60_000],
  ["ops:draft-list", ["team_draft_list"], 30_000],
  ["ops:my-counts", ["ops_my_counts"], 30_000],
  ["draft-counts", ["team_draft_counts"], 30_000],
  ["messages", ["team_badge", "team_inbox"], 30_000],
];
const RPCS_PER_RETURN = WORK_TAB.reduce((n, [, rpcs]) => n + rpcs.length, 0);
const RPC_MS = 200;

const flush = async () => { for (let i = 0; i < 5; i += 1) await new Promise((r) => setImmediate(r)); };

function makeTab({ visible = true, failing = {} } = {}) {
  let t = 0;
  const q = [];
  let id = 0;
  const now = () => t;
  const setTimer = (fn, ms) => { const h = { id: ++id, at: t + ms, fn }; q.push(h); return h; };
  const clearTimer = (h) => { const i = q.indexOf(h); if (i >= 0) q.splice(i, 1); };
  async function advanceTo(until) {
    for (;;) {
      q.sort((a, b) => a.at - b.at || a.id - b.id);
      const h = q[0];
      if (!h || h.at > until) break;
      q.shift();
      t = h.at;
      h.fn();
      await flush();
    }
    t = until;
    await flush();
  }

  const win = new EventTarget();
  const doc = new EventTarget();
  doc.visibilityState = visible ? "visible" : "hidden";
  const nav = { onLine: true };
  const pageReturn = createPageReturn({ win, doc, nav, now });
  const gate = createPollGate({ now, random: () => 0.5 });
  const calls = []; // { t, rpc }
  const attempts = {}; // key -> [t]

  const rpc = (key, names) => () => new Promise((resolve, reject) => {
    (attempts[key] ||= []).push(t);
    for (const name of names) calls.push({ t, rpc: name });
    setTimer(() => {
      if (failing[key]) reject(Object.assign(new Error("Service Unavailable"), { status: 503 }));
      else resolve({ ok: true });
    }, RPC_MS);
  });

  const pollers = WORK_TAB.map(([key, names, intervalMs]) => createPoller({
    refresh: ({ quiet }) => gatedRun(gate, key, rpc(key, names), { background: quiet }),
    intervalMs,
    pageReturn,
    isVisible: () => doc.visibilityState === "visible",
    isOnline: () => nav.onLine !== false,
    setTimer,
    clearTimer,
  }));

  // AuthContext's listener, modelled: "resolve" re-reads access (2 RPCs).
  const authEvent = (event, userId = "me") => {
    const decision = decideAuthEvent({ event, sessionUserId: userId, acceptedUserId: "me", visible: doc.visibilityState === "visible" });
    if (decision === "resolve") { calls.push({ t, rpc: "admin_team_my_access" }, { t, rpc: "admin_team_my_operational_areas" }); }
  };

  return {
    now, setTimer, clearTimer, advanceTo, flush, win, doc, pageReturn, gate, calls, attempts, authEvent,
    mount: async () => { pollers.forEach((p) => p.start()); await advanceTo(1_000); calls.length = 0; },
    unmount: () => pollers.forEach((p) => p.stop()),
    focus: () => win.dispatchEvent(new Event("focus")),
    showHide: () => {
      doc.visibilityState = "hidden"; doc.dispatchEvent(new Event("visibilitychange"));
      doc.visibilityState = "visible"; doc.dispatchEvent(new Event("visibilitychange"));
    },
    rpcsBetween: (a, b) => calls.filter((c) => c.t >= a && c.t < b).length,
  };
}

/** Alternating focus and hidden->visible (with auth-js's SIGNED_IN), `count` of each over [from, from+span). */
async function storm(tab, { from, spanMs, count }) {
  const total = count * 2;
  for (let i = 0; i < total; i += 1) {
    await tab.advanceTo(from + Math.floor((i * spanMs) / total));
    if (i % 2 === 0) tab.focus();
    else { tab.showHide(); tab.authEvent("SIGNED_IN"); }
  }
  await tab.advanceTo(from + spanMs);
}

describe("#4423 fan-out: one Work tab under focus / visibility storms", () => {
  it("one page return refreshes the 10 Work-tab reads: 12 RPCs", () => {
    assert.equal(WORK_TAB.length, 10);
    assert.equal(RPCS_PER_RETURN, 12);
  });

  it("W1-D1: 100 focus + 100 visibilitychange (with SIGNED_IN) in 10 s -> exactly 12 RPCs (<= 14)", async () => {
    const tab = makeTab();
    await tab.mount();
    const from = tab.now();
    await storm(tab, { from, spanMs: 10_000, count: 100 });
    const n = tab.rpcsBetween(from, from + 10_000);
    assert.ok(n <= 14, `${n} RPCs in 10 s`);
    assert.equal(n, 12);
    tab.unmount();
  });

  it("W1-D2: the same storm for 60 s -> exactly 36 RPCs (<= 42; 13 Nov saw ~550)", async () => {
    const tab = makeTab();
    await tab.mount();
    const from = tab.now();
    await storm(tab, { from, spanMs: 60_000, count: 600 });
    const n = tab.rpcsBetween(from, from + 60_000);
    assert.ok(n <= 42, `${n} RPCs in 60 s`);
    assert.equal(n, 36, "3 page returns (t = 0, 20, 40 s); the returns re-arm every timer");
    tab.unmount();
  });

  it("W1-D2 sustained: 10 minutes of storm stays at <= 42 per minute, every minute", async () => {
    const tab = makeTab();
    await tab.mount();
    const from = tab.now();
    await storm(tab, { from, spanMs: 600_000, count: 6_000 });
    for (let m = 0; m < 10; m += 1) {
      const n = tab.rpcsBetween(from + m * 60_000, from + (m + 1) * 60_000);
      assert.ok(n <= 42, `minute ${m}: ${n}`);
    }
    tab.unmount();
  });

  it("baseline with no events: the timers alone stay at Forensics A's ~18 per minute", async () => {
    const tab = makeTab();
    await tab.mount();
    const from = tab.now();
    await tab.advanceTo(from + 300_000);
    const perMinute = tab.rpcsBetween(from, from + 300_000) / 5;
    assert.ok(perMinute >= 16 && perMinute <= 19, `${perMinute} per minute`);
    tab.unmount();
  });

  it("W1-D3: a hidden tab sends 0 requests: 10 hidden->visible toggles in another tab, their SIGNED_IN echoes and focus noise, over 5 minutes", async () => {
    const tabB = makeTab({ visible: false });
    await tabB.mount();
    const from = tabB.now();
    for (let i = 0; i < 10; i += 1) {
      await tabB.advanceTo(from + i * 3_000);
      // tab A's hidden->visible reaches tab B only as auth-js's broadcast SIGNED_IN
      tabB.authEvent("SIGNED_IN");
      tabB.authEvent("TOKEN_REFRESHED");
      tabB.focus(); // a stray focus while hidden
      tabB.doc.dispatchEvent(new Event("visibilitychange")); // stays hidden
    }
    await tabB.advanceTo(from + 300_000);
    assert.equal(tabB.rpcsBetween(from, from + 300_000), 0);
    // but a sign-out in the other tab still reaches it
    tabB.authEvent("SIGNED_OUT", null);
    assert.equal(tabB.calls.length, 2);
    tabB.unmount();
  });

  it("W1-D4: one key answering 503 is retried >= 30 s apart, then 60, 120, 240, 300 s, while the storm goes on", async () => {
    const tab = makeTab({ failing: { "ops:work-list": true } });
    await tab.mount();
    const from = tab.now();
    await storm(tab, { from, spanMs: 1_200_000, count: 6_000 });
    // attempts since mount: the first load at t = 0 is the first failure
    const times = tab.attempts["ops:work-list"];
    assert.equal(times[0], 0);
    const gaps = times.slice(1).map((t, i) => t - times[i]);
    const steps = [30_000, 60_000, 120_000, 240_000, 300_000, 300_000];
    assert.ok(gaps.length >= 5, `gaps ${gaps}`);
    gaps.slice(0, steps.length).forEach((gap, i) => {
      // retried at the first page return (every 20 s) or timer tick after the wait
      assert.ok(gap >= steps[i] && gap <= steps[i] + 20_000 + RPC_MS, `gap ${i}: ${gap} vs ${steps[i]}`);
    });
    // deterministic here: each retry is the timer (armed when the failed read
    // ended, RPC_MS after it started) landing on the end of the wait
    assert.deepEqual(gaps.slice(0, 6), steps.map((s) => s + RPC_MS));
    // the other keys keep refreshing at the page-return rate
    assert.ok(tab.attempts["ops:config"].length >= 55);
    // and the breaker stayed closed (1 bad key out of 10)
    assert.equal(tab.gate.state().breakerOpen, false);
    tab.unmount();
  });

  it("the whole backend failing: the breaker opens and background RPCs drop to a trickle, then recover", async () => {
    const failing = Object.fromEntries(WORK_TAB.map(([k]) => [k, true]));
    const tab = makeTab({ failing });
    await tab.mount();
    const from = tab.now();
    await storm(tab, { from, spanMs: 600_000, count: 6_000 });
    const n = tab.rpcsBetween(from, from + 600_000);
    // with no gate this storm is ~7,200 RPCs per minute of storm
    assert.ok(n <= 60, `${n} RPCs in 10 minutes against a failing backend`);
    assert.equal(tab.gate.state().breakerMs > 0, true);
    // the backend comes back: within the breaker's pause plus one key backoff, reads succeed again
    for (const k of Object.keys(failing)) failing[k] = false;
    const back = tab.now();
    await storm(tab, { from: back, spanMs: 900_000, count: 6_000 });
    assert.equal(tab.gate.state().breakerOpen, false);
    assert.ok(tab.rpcsBetween(back + 600_000, back + 660_000) >= RPCS_PER_RETURN, "refreshing normally again");
    tab.unmount();
  });

  it("budget: however the events arrive, background reads stay <= 60 per rolling minute", async () => {
    const tab = makeTab();
    await tab.mount();
    // 30 extra pollers with 1 s timers (a page with fast pollers), plus a storm
    const extra = Array.from({ length: 30 }, (_, i) => createPoller({
      refresh: ({ quiet }) => gatedRun(tab.gate, `fast-${i}`, () => { tab.calls.push({ t: tab.now(), rpc: `fast-${i}` }); return Promise.resolve(); }, { background: quiet }),
      intervalMs: 1_000, pageReturn: tab.pageReturn, isVisible: () => true, isOnline: () => true,
      setTimer: tab.setTimer, clearTimer: tab.clearTimer, initial: false,
    }));
    extra.forEach((p) => p.start());
    const from = tab.now();
    await storm(tab, { from, spanMs: 120_000, count: 1_200 });
    // one read = one gate start (auth-access and messages send 2 RPCs per read)
    const SECOND_RPC = new Set(["admin_team_my_operational_areas", "team_inbox"]);
    let peak = 0;
    for (let s = 0; s + 60_000 <= 120_000; s += 1_000) {
      const reads = tab.calls.filter((c) => c.t >= from + s && c.t < from + s + 60_000 && !SECOND_RPC.has(c.rpc)).length;
      peak = Math.max(peak, reads);
      assert.ok(reads <= 60, `window at +${s / 1000}s: ${reads} reads`);
    }
    assert.equal(peak, 60, "the budget is reached, and held");
    extra.forEach((p) => p.stop());
    tab.unmount();
  });
});
