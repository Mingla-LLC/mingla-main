// #2829 W7c (A13.2) — the parity capture settles at the very top before the
// screenshot, on a site with `scroll-behavior: smooth` too: after the scroll
// pass it jumps back with behavior "instant", waits until scrollY has been 0
// for 500 ms, and gives the page at least 1,200 ms. The W7b procedure (a
// plain scrollTo(0, 0) and a fixed wait) ends mid-scroll on such a site,
// which is what made the about-us 390 capture timing-dependent.
import assert from "node:assert/strict";
import test from "node:test";
import { settleInPage } from "../../../mingla-sites/e2e/ys-parity/lib.mjs";

/** A page whose plain scrollTo animates smoothly over `smoothMs` (like `scroll-behavior: smooth`). */
function fakePage({ height = 4000, smoothMs = 3000 } = {}) {
  const calls = [];
  let from = 0;
  let to = 0;
  let startedAt = 0;
  let duration = 0;
  const position = () => {
    if (!duration) return to;
    const t = Math.min(1, (Date.now() - startedAt) / duration);
    return Math.round(from + (to - from) * t);
  };
  const window = {
    get scrollY() { return position(); },
    scrollTo(a, b) {
      const instant = typeof a === "object" && a.behavior === "instant";
      const target = typeof a === "object" ? a.top : b;
      calls.push({ target, instant });
      from = position();
      to = target;
      startedAt = Date.now();
      duration = instant ? 0 : smoothMs;
    },
  };
  return { window, document: { body: { scrollHeight: height } }, calls };
}

async function run(page, options) {
  const saved = { window: globalThis.window, document: globalThis.document };
  globalThis.window = page.window;
  globalThis.document = page.document;
  try {
    return await settleInPage(options);
  } finally {
    globalThis.window = saved.window;
    globalThis.document = saved.document;
  }
}

test("#2829 settle ends at the top, held for the stable window, on a smooth-scrolling page", async () => {
  const page = fakePage();
  const started = Date.now();
  const observed = await run(page, { step: 1000, pauseMs: 5, stableMs: 500, minSettleMs: 1200 });
  assert.deepEqual(observed, { scrollY: 0, stable: true });
  assert.equal(page.window.scrollY, 0);
  const last = page.calls.at(-1);
  assert.deepEqual(last, { target: 0, instant: true });
  assert.ok(Date.now() - started >= 1200, "at least 1,200 ms from the jump");
  // The pass visited the page in steps.
  assert.deepEqual(page.calls.slice(0, 4).map((call) => call.target), [0, 1000, 2000, 3000]);
});

test("#2829 settle restarts the stable window when the page moves again", async () => {
  const page = fakePage({ height: 1000 });
  const original = page.window.scrollTo.bind(page.window);
  let nudged = false;
  setTimeout(() => { if (!nudged) { nudged = true; original(0, 300); } }, 150);
  const started = Date.now();
  const observed = await run(page, { step: 1000, pauseMs: 5, stableMs: 500, minSettleMs: 0 });
  assert.deepEqual(observed, { scrollY: 0, stable: true });
  assert.ok(Date.now() - started >= 600, "the window restarted after the nudge");
});
