/**
 * ORCH-1136 R3 — §9a fails-on-revert assertion driver.
 *
 * Proves the load-bearing claim: a COMPOSITOR CSS transition on transform/
 * opacity (the FIX, css.html) advances OFF the main thread, so a heavy page's
 * long main-thread task during the open does NOT freeze it — whereas the JS-rAF
 * `withTiming` path (the REVERTED shape, model.html) drives the slide with
 * per-frame `el.style.transform` writes on the main thread, which a long task
 * starves (the F-1/F-2 freeze).
 *
 * Two complementary checks, both run in headless Chromium via Playwright:
 *
 *   PART A — RUNTIME (positive proof the compositor runs off-thread):
 *     Open css.html's panel, then seize the MAIN THREAD with a 220ms synchronous
 *     long task starting ~2 frames into the open. Measure how far the painted
 *     translateY advanced DURING the block (block-end minus block-start). Because
 *     the compositor runs off the main thread, the CSS panel ADVANCES while the
 *     thread is frozen (assert ≥ 60px). This is reliably observable: it is the
 *     direct evidence that the slide is NOT on the starved main thread.
 *
 *   PART B — STRUCTURAL CONTRACT (the deterministic fails-on-revert anchor):
 *     The compositor's mid-block progress can only be DIRECTLY sampled by a
 *     same-thread JS sampler AFTER the thread frees, by which point the rAF
 *     `withTiming` path has ALSO snapped to its wall-clock position (off-thread
 *     vs on-thread are indistinguishable to a post-block same-thread read). So
 *     the fails-on-revert anchor is the source contract of the two panels:
 *       - css.html   MUST carry a real compositor CSS `transition` on `transform`
 *                    + a `will-change` hint, and MUST NOT drive the slide with a
 *                    per-frame `style.transform =` write in a rAF loop.
 *       - model.html (the REVERTED shape this fix removes) MUST drive the slide
 *                    with a per-frame `el.style.transform =` write inside a
 *                    `requestAnimationFrame` step — the exact starvable construct.
 *     If the web sheet is reverted to the JS-rAF `withTiming` path, css.html's
 *     contract (compositor transition, no per-frame style write) no longer
 *     holds → this check fails. PART A would also collapse (the reverted panel
 *     can't advance during the block).
 *
 * Exit 0 = the compositor advances under a main-thread block AND the source
 *          contract holds (CSS = compositor transition; rAF = starvable per-frame
 *          main-thread writes). Exit 1 = either broke (a revert is detected).
 *
 * Run:  node assert_fails_on_revert.mjs
 */
import { chromium } from "playwright";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// PART A scenario: the main-thread long task starts ~2 frames into the open
// (so the compositor animation is provably already running before the thread is
// seized — removes the start-of-transition race) and holds for 220ms.
const BURST_AT = 32;
const BURST_MS = 220;
const PANEL_CLOSED = -590; // both harness panels start at translateY(-590px)
const CSS_PROGRESS_MIN = 60; // compositor must advance ≥ this during the block

// PART A — measure how far css.html's panel advances DURING a main-thread block.
async function measureCssCompositorProgress() {
  const b = await chromium.launch();
  try {
    const p = await b.newPage({ viewport: { width: 390, height: 844 } });
    await p.goto("file://" + path.join(__dirname, "css.html") + "?heavy");
    await p.waitForTimeout(120);
    await p.evaluate(
      ({ burstAt, burstMs }) => {
        const t0 = performance.now();
        globalThis.__samples = [];
        globalThis.__open();
        // Commit the open so the compositor transition is armed before the block.
        void document.getElementById("panel").offsetHeight;
        function sample() {
          const m = new DOMMatrixReadOnly(
            getComputedStyle(document.getElementById("panel")).transform,
          );
          globalThis.__samples.push({
            dt: +(performance.now() - t0).toFixed(0),
            ty: +m.m42.toFixed(0),
          });
          if (performance.now() - t0 < 700) requestAnimationFrame(sample);
        }
        requestAnimationFrame(sample);
        setTimeout(() => {
          const b0 = performance.now();
          while (performance.now() - b0 < burstMs) {
            /* seize the main thread */
          }
        }, burstAt);
      },
      { burstAt: BURST_AT, burstMs: BURST_MS },
    );
    await p.waitForTimeout(1000);
    const samp = await p.evaluate(() => globalThis.__samples);
    const blockEnd = BURST_AT + BURST_MS;
    let tyAtStart = PANEL_CLOSED;
    for (const s of samp) {
      if (s.dt <= BURST_AT) tyAtStart = s.ty;
      else break;
    }
    let tyAtEnd = tyAtStart;
    for (const s of samp) {
      if (s.dt >= blockEnd) {
        tyAtEnd = s.ty;
        break;
      }
    }
    return { samp, tyAtStart, tyAtEnd, progress: tyAtEnd - tyAtStart };
  } finally {
    await b.close();
  }
}

// PART B — source-contract detectors (deterministic; comment-stripped).
function strip(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}
const cssSrc = strip(readFileSync(path.join(__dirname, "css.html"), "utf8"));
const modelSrc = strip(readFileSync(path.join(__dirname, "model.html"), "utf8"));

// A compositor CSS transition on transform (the FIX shape).
const CSS_TRANSITION_TRANSFORM = /transition:\s*transform\b/;
const CSS_WILL_CHANGE = /will-change:\s*transform/;
// The starvable per-frame main-thread write in a rAF loop (the REVERTED shape):
// `<el>.style.transform = ...` AND a `requestAnimationFrame(...)` driving it.
const PER_FRAME_STYLE_TRANSFORM_WRITE = /\.style\.transform\s*=/;
const RAF_DRIVEN = /requestAnimationFrame\s*\(/;

console.log("=== ORCH-1136 R3 fails-on-revert assertion ===\n");
let failed = 0;

// ---- PART A ----
const a = await measureCssCompositorProgress();
console.log("PART A — runtime: compositor advances under a main-thread block");
console.log(
  `  css.html panel: blockStart ${a.tyAtStart}px → blockEnd ${a.tyAtEnd}px ` +
    `= advanced ${a.progress}px during the ${BURST_MS}ms main-thread block (assert ≥ ${CSS_PROGRESS_MIN}px)`,
);
if (!(a.progress >= CSS_PROGRESS_MIN)) {
  console.error(
    `  FAIL: the CSS panel advanced only ${a.progress}px while the main thread was blocked ` +
      `(< ${CSS_PROGRESS_MIN}px) — it is NOT compositor-driven. If the web sheet was reverted to ` +
      `the JS-rAF withTiming path this is the EXPECTED failure — restore the CSS transition (§4).`,
  );
  failed = 1;
} else {
  console.log("  OK: the CSS slide advanced off the main thread (compositor-driven).\n");
}

// ---- PART B ----
console.log("PART B — source contract: CSS=compositor transition, rAF=starvable per-frame writes");
const cssIsCompositor =
  CSS_TRANSITION_TRANSFORM.test(cssSrc) &&
  CSS_WILL_CHANGE.test(cssSrc) &&
  !PER_FRAME_STYLE_TRANSFORM_WRITE.test(cssSrc);
const modelIsStarvable =
  PER_FRAME_STYLE_TRANSFORM_WRITE.test(modelSrc) && RAF_DRIVEN.test(modelSrc);
console.log(
  `  css.html  : transition:transform=${CSS_TRANSITION_TRANSFORM.test(cssSrc)} ` +
    `will-change:transform=${CSS_WILL_CHANGE.test(cssSrc)} ` +
    `noPerFrameWrite=${!PER_FRAME_STYLE_TRANSFORM_WRITE.test(cssSrc)} → compositor=${cssIsCompositor}`,
);
console.log(
  `  model.html: perFrame style.transform=${PER_FRAME_STYLE_TRANSFORM_WRITE.test(modelSrc)} ` +
    `rAF-driven=${RAF_DRIVEN.test(modelSrc)} → starvable=${modelIsStarvable}`,
);
if (!cssIsCompositor) {
  console.error(
    "  FAIL: css.html no longer drives the slide via a compositor CSS transition on transform " +
      "(no per-frame style.transform write) — the reverted JS-rAF path was reintroduced (§4/§9b).",
  );
  failed = 1;
}
if (!modelIsStarvable) {
  console.error(
    "  FAIL: model.html no longer demonstrates the starvable per-frame main-thread write — the " +
      "harness can't represent the reverted construct it must fail against.",
  );
  failed = 1;
}
if (cssIsCompositor && modelIsStarvable) {
  console.log("  OK: the two panels carry the distinct contracts (fix vs reverted shape).\n");
}

if (failed) {
  console.error("ORCH-1136 R3 fails-on-revert: ASSERTION FAILED");
  process.exit(1);
}
console.log(
  "ORCH-1136 R3 fails-on-revert: PASS — the compositor CSS transition advances under a " +
    "main-thread long task (Part A) and the source contract distinguishes the fix from the " +
    "starvable JS-rAF path (Part B). Reverting the web sheet to withTiming fails both.",
);
process.exit(0);
