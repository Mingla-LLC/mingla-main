// Issue #4423 (W1.1, W1.6): the one shared "page came back" signal.
//
// Drives lib/pageReturn.js with Node's own EventTarget as the window and the
// document, and an injected clock. Each subscriber stands for one of the ~14
// hooks that used to refresh on every focus / visibility / online event.
//
// FAILS-ON-REVERT: delete the gap check in emitReturn (`if (t - lastAt <
// minGapMs) return false;`) and (a), (b), (e) and (f) go red.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PAGE_RETURN_MIN_GAP_MS, createPageReturn } from "../lib/pageReturn.js";

function makeTab({ visible = true, online = true } = {}) {
  const win = new EventTarget();
  const doc = new EventTarget();
  doc.visibilityState = visible ? "visible" : "hidden";
  const nav = { onLine: online };
  let t = 0;
  const clock = { now: () => t, set: (v) => { t = v; } };
  const pr = createPageReturn({ win, doc, nav, now: clock.now });
  const fire = {
    focus: () => win.dispatchEvent(new Event("focus")),
    online: () => win.dispatchEvent(new Event("online")),
    offline: () => win.dispatchEvent(new Event("offline")),
    visibility: (state) => { doc.visibilityState = state; doc.dispatchEvent(new Event("visibilitychange")); },
  };
  return { win, doc, nav, clock, pr, fire };
}

function subscribers(pr, n) {
  const calls = Array.from({ length: n }, () => 0);
  const offs = calls.map((_, i) => pr.subscribePageReturn(() => { calls[i] += 1; }));
  return { calls, offs };
}

/** Alternate focus and hidden->visible events, `count` of each, spread over `spanMs`. */
function burst(tab, { from, spanMs, count }) {
  const total = count * 2;
  for (let i = 0; i < total; i += 1) {
    tab.clock.set(from + Math.floor((i * spanMs) / total));
    if (i % 2 === 0) tab.fire.focus();
    else { tab.fire.visibility("hidden"); tab.fire.visibility("visible"); }
  }
}

describe("#4423 pageReturn: one throttled signal for the whole tab", () => {
  it("the gap is 20 s, inside the allowed 15-30 s", () => {
    assert.equal(PAGE_RETURN_MIN_GAP_MS, 20_000);
  });

  it("(a) 14 subscribers, 100 focus + 100 visibilitychange in 10 s: each is called exactly once", () => {
    const tab = makeTab();
    const { calls } = subscribers(tab.pr, 14);
    burst(tab, { from: 1_000, spanMs: 10_000, count: 100 });
    assert.deepEqual(calls, Array(14).fill(1));
    assert.equal(tab.pr.state().emits, 1);
  });

  it("(b) the same events kept up for 60 s: exactly 3 calls each (t = 0, 20, 40 s)", () => {
    const tab = makeTab();
    const { calls } = subscribers(tab.pr, 14);
    burst(tab, { from: 0, spanMs: 60_000, count: 600 });
    assert.deepEqual(calls, Array(14).fill(3));
  });

  it("(c) a hidden document: 0 calls, however many focus events arrive", () => {
    const tab = makeTab({ visible: false });
    const { calls } = subscribers(tab.pr, 14);
    for (let i = 0; i < 200; i += 1) { tab.clock.set(i * 50); tab.fire.focus(); tab.fire.online(); }
    // visibilitychange that stays hidden (another tab's echo) emits nothing either
    for (let i = 0; i < 50; i += 1) { tab.clock.set(20_000 + i * 1_000); tab.fire.visibility("hidden"); }
    assert.deepEqual(calls, Array(14).fill(0));
  });

  it("(d) offline: 0 calls", () => {
    const tab = makeTab({ online: false });
    const { calls } = subscribers(tab.pr, 14);
    burst(tab, { from: 0, spanMs: 60_000, count: 100 });
    assert.deepEqual(calls, Array(14).fill(0));
  });

  it("(d2) coming back online emits once, and the gap still holds", () => {
    const tab = makeTab({ online: false });
    const { calls } = subscribers(tab.pr, 3);
    tab.clock.set(5_000);
    tab.nav.onLine = true;
    tab.fire.online();
    tab.clock.set(6_000);
    tab.fire.online();
    tab.fire.focus();
    assert.deepEqual(calls, [1, 1, 1]);
  });

  it("(e) markRefreshed (a timer tick) suppresses a return 2 s later, and the next return waits a full gap", () => {
    const tab = makeTab();
    const { calls } = subscribers(tab.pr, 2);
    tab.clock.set(100_000);
    tab.pr.markRefreshed();
    tab.clock.set(102_000);
    tab.fire.focus();
    assert.deepEqual(calls, [0, 0]);
    tab.clock.set(119_999);
    tab.fire.focus();
    assert.deepEqual(calls, [0, 0]);
    tab.clock.set(120_000);
    tab.fire.focus();
    assert.deepEqual(calls, [1, 1]);
  });

  it("(f) leading edge: the first event fires at once, extra events in the gap are dropped, not queued", () => {
    const tab = makeTab();
    const { calls } = subscribers(tab.pr, 1);
    tab.clock.set(50_000);
    tab.fire.focus();
    assert.deepEqual(calls, [1]);
    for (let t = 50_001; t < 70_000; t += 997) { tab.clock.set(t); tab.fire.focus(); }
    assert.deepEqual(calls, [1]);
    // nothing fires later by itself: there is no trailing call
    tab.clock.set(200_000);
    assert.deepEqual(calls, [1]);
  });

  it("listeners are installed once, lazily, and removed when the last subscriber leaves", () => {
    const tab = makeTab();
    let added = 0;
    let removed = 0;
    for (const target of [tab.win, tab.doc]) {
      const add = target.addEventListener.bind(target);
      const remove = target.removeEventListener.bind(target);
      target.addEventListener = (...args) => { added += 1; add(...args); };
      target.removeEventListener = (...args) => { removed += 1; remove(...args); };
    }
    assert.equal(tab.pr.state().installed, false);
    const offs = [tab.pr.subscribePageReturn(() => {}), tab.pr.subscribePageReturn(() => {}), tab.pr.subscribeVisibility(() => {}), tab.pr.subscribeConnectivity(() => {})];
    assert.equal(added, 4, "focus, online, offline, visibilitychange: once each");
    offs.slice(0, 3).forEach((off) => off());
    assert.equal(removed, 0);
    offs[3]();
    assert.equal(removed, 4);
    assert.equal(tab.pr.state().installed, false);
  });

  it("raw visibility and connectivity subscribers see every change (they make no request)", () => {
    const tab = makeTab();
    const seen = [];
    tab.pr.subscribeVisibility((v) => seen.push(`v:${v}`));
    tab.pr.subscribeConnectivity((o) => seen.push(`o:${o}`));
    tab.fire.visibility("hidden");
    tab.fire.visibility("visible");
    tab.fire.offline();
    tab.fire.online();
    assert.deepEqual(seen, ["v:false", "v:true", "o:false", "o:true"]);
  });

  it("one subscriber that throws does not stop the others", () => {
    const tab = makeTab();
    const orig = console.error;
    console.error = () => {};
    try {
      let after = 0;
      tab.pr.subscribePageReturn(() => { throw new Error("boom"); });
      tab.pr.subscribePageReturn(() => { after += 1; });
      tab.fire.focus();
      assert.equal(after, 1);
    } finally {
      console.error = orig;
    }
  });
});
