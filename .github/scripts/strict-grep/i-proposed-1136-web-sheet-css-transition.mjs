#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Strict-grep gate — ORCH-1136 R3 [biz-web sheet animation: compositor CSS transition]
 * I-PROPOSED-1136-WEB-SHEET-CSS-TRANSITION (DRAFT → ACTIVE on CLOSE)
 *
 * WHY (root cause this fix removes): on mingla-business WEB, react-native-
 * reanimated 4 is JSReanimated — `withTiming`/`withSpring` compute each frame
 * inside the browser-native requestAnimationFrame (no off-thread driver on web)
 * and write `transform`/`opacity` to the DOM per frame. When a heavy page throws
 * a long (>50ms) main-thread task during the ~200-280ms open window, no anim
 * frame can paint → the half-open sheet FREEZES at a mid-slide position, then
 * snaps to rest (ORCH-1136 R3 F-1/F-2, harness-proven `evidence/ORCH-1136-R3/`).
 *
 * THE FIX: for `Platform.OS === 'web'` ONLY, drive the sheet open/close animation
 * with a COMPOSITOR CSS `transition` on `transform`/`opacity` — the compositor
 * advances independently of the starved main thread. NATIVE keeps reanimated
 * (`withTiming`/`withSpring`) byte-identical behind the web gate.
 *
 * This gate enforces that the fix cannot be silently reverted, for each of the
 * 5 shared sheet/overlay primitives:
 *   - src/components/ui/TopSheet.tsx
 *   - src/components/ui/Sheet.web.tsx
 *   - src/components/ui/SheetMobile.tsx
 *   - src/components/ui/Modal.tsx
 *   - src/components/ui/Toast.tsx
 *
 *   INV-1 (web path is CSS-transition-driven):
 *     each primitive's WEB animation is a CSS `transition:` on `transform`
 *     and/or `opacity` (the literal `transition:` with `transform`/`opacity`).
 *     `Sheet.web.tsx` is a web-only file (its whole body is the web path);
 *     the other four carry the web path behind a `Platform.OS === 'web'`
 *     dispatch to a web variant component.
 *   INV-2 (no layout/reflow animation on the web sheet path):
 *     NO `height`/`top`/`width`/`left`/`right`/`bottom` may appear inside a
 *     web `transition:` property list (those reflow on the main thread and
 *     defeat the compositor fix). transform/opacity ONLY.
 *   INV-3 (web variant calls ZERO reanimated animation hooks):
 *     the web variant must NOT drive a `useAnimatedStyle`/`withTiming`/
 *     `withSpring` transform/opacity on the web path — i.e. the reverted
 *     construct. For Sheet.web.tsx (web-only), the file MUST NOT import
 *     react-native-reanimated at all. For the four shared files, native still
 *     uses reanimated (allowed) — the gate verifies the web CSS transition is
 *     PRESENT (INV-1), which a pure-reanimated revert removes.
 *
 * Comments are stripped before scanning so the protective header references to
 * `withTiming` / `height` do not self-trip the gate.
 *
 * Exit codes: 0 pass · 1 fail · 2 fs error
 * Self-test mode (--self-test) validates the detectors against fixtures.
 *
 * Per SPEC_ORCH-1136_R3_SHEET_ANIM §6 / §9b.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

const UI_DIR = "mingla-business/src/components/ui";
// Files + whether they are WEB-ONLY (Sheet.web.tsx) or SHARED (native+web).
const PRIMITIVES = [
  { rel: `${UI_DIR}/TopSheet.tsx`, webOnly: false },
  { rel: `${UI_DIR}/Sheet.web.tsx`, webOnly: true },
  { rel: `${UI_DIR}/SheetMobile.tsx`, webOnly: false },
  { rel: `${UI_DIR}/Modal.tsx`, webOnly: false },
  { rel: `${UI_DIR}/Toast.tsx`, webOnly: false },
];

// INV-1 — a CSS transition on transform and/or opacity (the compositor path).
// The transition value is commonly a multi-line template-literal ternary, e.g.
//   transition: reduceMotion
//     ? `opacity ${d}ms ${e}`
//     : `transform ${d}ms ${e}`,
// so we allow up to ~140 chars INCLUDING newlines (incl. backticks/quotes/
// `${...}`) between the `transition:` key and the first `transform`/`opacity`
// keyword, but stop at a `;` (statement boundary). The window is short enough
// that it cannot reach a sibling style property on a later line.
const CSS_TRANSITION_RE = /transition:[^;]{0,140}?\b(?:transform|opacity)\b/;
// INV-2 — a layout/reflow property inside a `transition:` value (banned).
const LAYOUT_IN_TRANSITION_RE =
  /transition:[^;]{0,140}?\b(?:height|width|top|left|right|bottom)\b/;
// INV-3 (Sheet.web only) — must NOT import react-native-reanimated.
const REANIMATED_IMPORT_RE = /from\s*["']react-native-reanimated["']/;
// Shared-file web gate present (the dispatch to a web variant).
const WEB_GATE_RE = /Platform\.OS\s*===\s*["']web["']/;

let failures = 0;
function fail(check, msg) {
  failures += 1;
  console.error(`FAIL [${check}] ${msg}`);
}
function ok(check, msg) {
  console.log(`OK   [${check}] ${msg}`);
}

function readSource(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (e) {
    console.error(`fs error reading ${filePath}: ${e.message}`);
    process.exit(2);
  }
}

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function runSelfTest() {
  let selfFail = 0;

  // GOOD web variant: a CSS transition on transform, no layout prop, no
  // reanimated transform write on web.
  const goodWeb = stripComments(`
    if (Platform.OS === "web") return <FooWeb {...props} />;
    const webStyle = {
      transition: "transform 280ms cubic-bezier(0.33,1,0.68,1)",
      transform: animateOpen ? "translateY(0px)" : "translateY(-590px)",
      willChange: "transform",
    };
  `);
  // BAD: reverted to a layout (height) animation in the transition.
  const badLayout = stripComments(`
    if (Platform.OS === "web") return <FooWeb {...props} />;
    const webStyle = { transition: "height 280ms ease, opacity 220ms ease" };
  `);
  // BAD: no CSS transition at all (reverted to pure reanimated web path).
  const badNoTransition = stripComments(`
    const s = useAnimatedStyle(() => ({ transform: [{ translateY: tY.value }] }));
  `);

  if (!CSS_TRANSITION_RE.test(goodWeb)) {
    console.error("SELF-TEST FAIL: good web CSS transition not detected");
    selfFail++;
  }
  if (LAYOUT_IN_TRANSITION_RE.test(goodWeb)) {
    console.error("SELF-TEST FAIL: good web transition falsely flagged as layout-animating");
    selfFail++;
  }
  if (!WEB_GATE_RE.test(goodWeb)) {
    console.error("SELF-TEST FAIL: web gate not detected in good shared fixture");
    selfFail++;
  }
  if (!LAYOUT_IN_TRANSITION_RE.test(badLayout)) {
    console.error("SELF-TEST FAIL: height-in-transition (layout reflow) not detected");
    selfFail++;
  }
  if (CSS_TRANSITION_RE.test(badNoTransition)) {
    console.error("SELF-TEST FAIL: reverted reanimated-only fixture falsely matched a CSS transition");
    selfFail++;
  }
  // Sheet.web reanimated-import detector.
  const sheetWebGood = stripComments(`
    import React from "react";
    const cardWebStyle = { transition: "opacity 200ms ease, transform 200ms ease" };
  `);
  const sheetWebBad = stripComments(`
    import Animated, { withTiming, useAnimatedStyle } from "react-native-reanimated";
    const s = useAnimatedStyle(() => ({ opacity: o.value }));
  `);
  if (REANIMATED_IMPORT_RE.test(sheetWebGood)) {
    console.error("SELF-TEST FAIL: clean Sheet.web fixture falsely flagged for reanimated import");
    selfFail++;
  }
  if (!REANIMATED_IMPORT_RE.test(sheetWebBad)) {
    console.error("SELF-TEST FAIL: reanimated import in Sheet.web not detected");
    selfFail++;
  }

  if (selfFail > 0) {
    console.error(`SELF-TEST: ${selfFail} expectation(s) failed`);
    process.exit(1);
  }
  console.log("SELF-TEST OK: I-PROPOSED-1136-WEB-SHEET-CSS-TRANSITION detectors behave");
  process.exit(0);
}

if (process.argv.includes("--self-test")) {
  runSelfTest();
}

for (const { rel, webOnly } of PRIMITIVES) {
  const abs = path.join(REPO_ROOT, rel);
  if (!fs.existsSync(abs)) {
    fail("present", `${rel} missing`);
    continue;
  }
  const code = stripComments(readSource(abs));

  // INV-1 — a compositor CSS transition on transform/opacity in the web path.
  if (CSS_TRANSITION_RE.test(code)) {
    ok("INV-1: web-css-transition", `${rel} drives its web animation via a CSS transition on transform/opacity`);
  } else {
    fail(
      "INV-1: web-css-transition",
      `${rel} has NO web CSS \`transition:\` on transform/opacity — the compositor path was removed. ` +
        `Reverting the web sheet to a withTiming/withSpring useAnimatedStyle on web reintroduces the ` +
        `heavy-page freeze (ORCH-1136 R3 F-1/F-2). Restore the web CSS transition (SPEC §4).`,
    );
  }

  // INV-2 — no layout/reflow property inside a web transition.
  if (LAYOUT_IN_TRANSITION_RE.test(code)) {
    fail(
      "INV-2: no-layout-animation",
      `${rel} animates a layout property (height/width/top/left/right/bottom) inside a \`transition:\` — ` +
        `layout props reflow on the main thread and defeat the compositor fix. Animate transform/opacity ONLY (SPEC §4.0).`,
    );
  } else {
    ok("INV-2: no-layout-animation", `${rel} animates transform/opacity only (no layout/reflow property in any transition)`);
  }

  if (webOnly) {
    // INV-3a — Sheet.web.tsx is web-only and must NOT import reanimated.
    if (REANIMATED_IMPORT_RE.test(code)) {
      fail(
        "INV-3: web-only-no-reanimated",
        `${rel} is a web-only file but imports react-native-reanimated — its animation must be the ` +
          `compositor CSS transition with ZERO reanimated hooks (SPEC §4.2).`,
      );
    } else {
      ok("INV-3: web-only-no-reanimated", `${rel} (web-only) imports NO react-native-reanimated`);
    }
  } else {
    // INV-3b — the shared file must carry a Platform.OS==='web' dispatch (so the
    // web CSS transition runs only on web and native keeps reanimated).
    if (WEB_GATE_RE.test(code)) {
      ok("INV-3: web-gate-present", `${rel} gates the web CSS-transition variant behind Platform.OS === 'web'`);
    } else {
      fail(
        "INV-3: web-gate-present",
        `${rel} (shared native+web primitive) has no \`Platform.OS === 'web'\` dispatch — the web CSS ` +
          `transition must be web-gated so native stays byte-identical reanimated (SPEC §4.0 gating shape).`,
      );
    }
  }
}

if (failures > 0) {
  console.error(`\nI-PROPOSED-1136-WEB-SHEET-CSS-TRANSITION: ${failures} violation(s)`);
  process.exit(1);
}
console.log("\nI-PROPOSED-1136-WEB-SHEET-CSS-TRANSITION: PASS · violations=0");
process.exit(0);
