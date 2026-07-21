#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Strict-grep gate — #1022 [compact Theme control]
 * I-PROPOSED-1022-SHEET-DISMISS-PAN-HANDLE-ONLY
 *
 * SheetMobile's drag-to-dismiss Pan was attached to the ENTIRE panel
 * Animated.View containing {children}. Every downward drag inside a sheet body
 * — scrolling a list, reordering a DraggableFlatList row, and (new in #1022)
 * dragging the saturation/value colour plane — competed with dismissal, and
 * past 80pt or 600px/s the sheet closed under the user.
 *
 * The fix, mirroring the already-shipped web `webDragCatch`: the Pan is
 * attached to a transparent, absolutely-positioned 52pt band pinned to the top
 * of the panel over the handle, rendered as a SIBLING of SheetMobilePanelInner.
 *
 * This gate asserts, on mingla-business/src/components/ui/SheetMobile.tsx:
 *   INV-1  a single shared SHEET_DRAG_BAND_HEIGHT constant exists and is >= 44
 *          (the platform minimum touch target).
 *   INV-2  BOTH the native band and the web webDragCatch consume that constant
 *          — neither may hardcode a height, so the platforms cannot drift.
 *   INV-3  WebSafeGestureDetector wraps the drag band, NOT the panel
 *          Animated.View. (The panel must not be a gesture child.)
 *   INV-4  NONE of the four gesture-coordination APIs appear. ORCH-1173 R1
 *          tried exactly that coordination and it FAILED on a physical
 *          Samsung; R2's handle-only scoping is the proven answer
 *          (TopSheet.tsx:353-356, 497-502). This is a binding constraint from
 *          the orchestrator's GLOBAL-scope decision, not a preference.
 *   INV-5  scrim-tap dismissal is preserved, so narrowing the pan can never
 *          strand a sheet (dismissOnScrimTap appears in ZERO files repo-wide
 *          as `false`, and every sheet is inside <Modal onRequestClose>).
 *
 * Fails-on-revert: re-wrap the panel in WebSafeGestureDetector, hardcode
 * either band height, or introduce any coordination API → CI fails.
 *
 * Exit codes: 0 pass · 1 fail · 2 fs error
 * Self-test mode (--self-test) validates the detectors against fixtures.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

const TARGET_REL = "src/components/ui/SheetMobile.tsx";
const MIN_TOUCH_TARGET_PX = 44;

// INV-1 — the shared constant, exported so the value has exactly one owner.
const RE_BAND_CONST =
  /export\s+const\s+SHEET_DRAG_BAND_HEIGHT\s*=\s*(\d+)\s*;/;

// INV-2 — both style blocks must reference the constant, never a literal.
const RE_NATIVE_BAND_STYLE =
  /nativeDragCatch\s*:\s*\{[^}]*height\s*:\s*SHEET_DRAG_BAND_HEIGHT[^}]*\}/;
const RE_WEB_BAND_USES_CONST =
  /webDragCatch\s*:\s*\{[^}]*height\s*:\s*SHEET_DRAG_BAND_HEIGHT[^}]*\}/;

// INV-3 — the detector must wrap the band, and must NOT wrap the panel.
const RE_DETECTOR_WRAPS_BAND =
  /<WebSafeGestureDetector\s+gesture=\{panGesture\}>\s*<View\s+style=\{styles\.nativeDragCatch\}/;
const RE_DETECTOR_WRAPS_PANEL =
  /<WebSafeGestureDetector\s+gesture=\{panGesture\}>\s*<Animated\.View/;

// INV-4 — the four FORBIDDEN gesture-coordination APIs (ORCH-1173 R1 failure).
const FORBIDDEN_COORDINATION = [
  "Gesture.Simultaneous",
  "Gesture.Native",
  "simultaneousWithExternalGesture",
  "blocksExternalGesture",
];

// INV-5 — scrim tap must remain a live dismissal path.
const RE_SCRIM_TAP = /dismissOnScrimTap\s*\)?\s*onClose\(\)|if\s*\(dismissOnScrimTap\)/;

let failures = 0;
function fail(check, msg) {
  failures += 1;
  console.error(`FAIL [${check}] ${msg}`);
}
function ok(check, msg) {
  console.log(`OK   [${check}] ${msg}`);
}

/**
 * Strip block and line comments so INV-4 scans CODE only. The source
 * deliberately NAMES the forbidden APIs in its explanatory comment (so the
 * next engineer knows why they are absent); matching those would be a false
 * positive.
 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function readSource(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (e) {
    console.error(`fs error reading ${filePath}: ${e.message}`);
    process.exit(2);
  }
}

function runSelfTest() {
  let selfFail = 0;

  const goodConst = `export const SHEET_DRAG_BAND_HEIGHT = 52;`;
  const badConst = `const DRAG_BAND = 52;`;
  if (!RE_BAND_CONST.test(goodConst)) {
    console.error("SELF-TEST FAIL: exported band constant not detected");
    selfFail += 1;
  }
  if (RE_BAND_CONST.test(badConst)) {
    console.error("SELF-TEST FAIL: non-exported constant wrongly accepted");
    selfFail += 1;
  }

  const goodNative = `  nativeDragCatch: {\n    position: "absolute",\n    height: SHEET_DRAG_BAND_HEIGHT,\n  },`;
  const badNative = `  nativeDragCatch: {\n    position: "absolute",\n    height: 52,\n  },`;
  if (!RE_NATIVE_BAND_STYLE.test(goodNative)) {
    console.error("SELF-TEST FAIL: native band constant usage not detected");
    selfFail += 1;
  }
  if (RE_NATIVE_BAND_STYLE.test(badNative)) {
    console.error("SELF-TEST FAIL: hardcoded native band height wrongly accepted");
    selfFail += 1;
  }

  const goodWrap = `<WebSafeGestureDetector gesture={panGesture}>\n  <View style={styles.nativeDragCatch}`;
  const badWrap = `<WebSafeGestureDetector gesture={panGesture}>\n  <Animated.View`;
  if (!RE_DETECTOR_WRAPS_BAND.test(goodWrap)) {
    console.error("SELF-TEST FAIL: band-wrapping detector not detected");
    selfFail += 1;
  }
  if (!RE_DETECTOR_WRAPS_PANEL.test(badWrap)) {
    console.error("SELF-TEST FAIL: panel-wrapping regression not detected");
    selfFail += 1;
  }
  if (RE_DETECTOR_WRAPS_PANEL.test(goodWrap)) {
    console.error("SELF-TEST FAIL: good shape wrongly flagged as panel-wrapping");
    selfFail += 1;
  }

  const commentOnly = `/** mentions Gesture.Simultaneous in prose */\nconst x = 1;`;
  const realUsage = `const g = Gesture.Simultaneous(a, b);`;
  if (stripComments(commentOnly).includes("Gesture.Simultaneous")) {
    console.error("SELF-TEST FAIL: comment mention not stripped (false positive)");
    selfFail += 1;
  }
  if (!stripComments(realUsage).includes("Gesture.Simultaneous")) {
    console.error("SELF-TEST FAIL: real coordination usage was stripped (false negative)");
    selfFail += 1;
  }

  if (selfFail > 0) {
    console.error(`SELF-TEST: ${selfFail} detector failure(s)`);
    process.exit(1);
  }
  console.log("SELF-TEST: all detectors behave correctly");
  process.exit(0);
}

if (process.argv.includes("--self-test")) {
  runSelfTest();
}

const file = path.join(REPO_ROOT, "mingla-business", TARGET_REL);
if (!fs.existsSync(file)) {
  fail("INV-0: target-present", `mingla-business/${TARGET_REL} missing`);
  process.exit(1);
}
const src = readSource(file);

// INV-1
const constMatch = src.match(RE_BAND_CONST);
if (constMatch === null) {
  fail(
    "INV-1: shared-constant",
    `${TARGET_REL} does not export SHEET_DRAG_BAND_HEIGHT — the native band and the web webDragCatch would each carry their own literal and could drift`,
  );
} else {
  const height = Number(constMatch[1]);
  if (height >= MIN_TOUCH_TARGET_PX) {
    ok("INV-1: shared-constant", `SHEET_DRAG_BAND_HEIGHT = ${height} (>= ${MIN_TOUCH_TARGET_PX}pt touch target)`);
  } else {
    fail(
      "INV-1: shared-constant",
      `SHEET_DRAG_BAND_HEIGHT = ${height} is below the ${MIN_TOUCH_TARGET_PX}pt minimum touch target — the handle would be hard to grab`,
    );
  }
}

// INV-2
if (RE_NATIVE_BAND_STYLE.test(src)) {
  ok("INV-2: native-band-uses-constant", "nativeDragCatch height comes from SHEET_DRAG_BAND_HEIGHT");
} else {
  fail(
    "INV-2: native-band-uses-constant",
    "nativeDragCatch does not derive its height from SHEET_DRAG_BAND_HEIGHT",
  );
}
if (RE_WEB_BAND_USES_CONST.test(src)) {
  ok("INV-2: web-band-uses-constant", "webDragCatch height comes from the same constant — platforms cannot drift");
} else {
  fail(
    "INV-2: web-band-uses-constant",
    "webDragCatch does not derive its height from SHEET_DRAG_BAND_HEIGHT — native and web drag bands could drift apart",
  );
}

// INV-3
if (RE_DETECTOR_WRAPS_BAND.test(src)) {
  ok("INV-3: pan-scoped-to-band", "WebSafeGestureDetector wraps the 52pt drag band");
} else {
  fail(
    "INV-3: pan-scoped-to-band",
    "WebSafeGestureDetector does NOT wrap <View style={styles.nativeDragCatch}> — the dismiss pan must live on the band",
  );
}
if (RE_DETECTOR_WRAPS_PANEL.test(src)) {
  fail(
    "INV-3: panel-not-gesture-child",
    "WebSafeGestureDetector wraps the panel Animated.View — this is the reverted shape; every body drag would compete with dismissal",
  );
} else {
  ok("INV-3: panel-not-gesture-child", "the panel Animated.View is NOT a gesture child");
}

// INV-4 — scan CODE only; the docblock names these APIs on purpose.
const codeOnly = stripComments(src);
for (const api of FORBIDDEN_COORDINATION) {
  if (codeOnly.includes(api)) {
    fail(
      "INV-4: no-gesture-coordination",
      `${TARGET_REL} references \`${api}\` — gesture coordination between the sheet pan and an inner draggable is FORBIDDEN here: ORCH-1173 R1 tried it and it failed on a physical Samsung. Handle-scoping only.`,
    );
  }
}
if (!FORBIDDEN_COORDINATION.some((a) => codeOnly.includes(a))) {
  ok("INV-4: no-gesture-coordination", "none of the 4 forbidden coordination APIs are present");
}

// INV-5
if (RE_SCRIM_TAP.test(src)) {
  ok("INV-5: scrim-tap-preserved", "scrim tap still dismisses — narrowing the pan cannot strand a sheet");
} else {
  fail(
    "INV-5: scrim-tap-preserved",
    "scrim-tap dismissal was removed — with the pan narrowed to the handle, short sheets could become undismissable",
  );
}

process.exit(failures > 0 ? 1 : 0);
