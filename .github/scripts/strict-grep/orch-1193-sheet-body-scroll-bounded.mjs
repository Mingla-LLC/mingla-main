#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Strict-grep gate — ORCH-1193 [venue/event sheet bottom-cutoff fix]
 * I-PROPOSED-1193-SHEET-BODY-SCROLL-BOUNDED
 *
 * The 8 business-app action sheets that previously rendered their body
 * <ScrollView> with NO `flex:1` on the ScrollView's own `style` (only a
 * contentContainerStyle) inside the fixed-height, overflow:hidden SheetMobile
 * panel — so the box grew past the panel bottom and the CTA was clipped and
 * unscrollable. The canonical fix (matching the known-good RefundSheet /
 * DoorSaleNewSheet / AddCompGuestSheet) is:
 *
 *   (a) bound the body scroll viewport to the panel with `flex:1` on the
 *       ScrollView's `style`  (this gate asserts a `scrollFlex: { flex: 1 }`
 *       style exists AND is applied via `style={styles.scrollFlex}`); AND
 *   (b) for the input/interactive sheets, import the body ScrollView from
 *       `wrappers/SmartScrollView` so the focused input + CTA clear the
 *       keyboard + 42dp Done bar (I-PROPOSED-KEYBOARD-TOOLBAR-CLEARANCE).
 *
 * Per-file exception (per the SPEC + investigation):
 *   - PublishErrorsSheet.tsx is read-only (no inputs) → it must carry the
 *     `flex:1` bound but is intentionally a PLAIN react-native ScrollView;
 *     SmartScrollView would add no value. This gate does NOT require the
 *     SmartScrollView import for that file.
 *
 * This is a fails-on-revert guard: deleting the `flex:1` style (or the
 * `style={styles.scrollFlex}` application) or reverting the SmartScrollView
 * import on any required file fails CI.
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

// rel path (under mingla-business/) → requireSmartScrollView
const TARGETS = [
  { rel: "src/components/venue/VenueTableSheet.tsx", smart: true },
  { rel: "src/components/venue/ReservationCreateSheet.tsx", smart: true },
  { rel: "src/components/venue/WaitlistAddSheet.tsx", smart: true },
  { rel: "src/components/venue/MenuItemSheet.tsx", smart: true },
  { rel: "src/components/venue/MenuCategorySheet.tsx", smart: true },
  { rel: "src/components/venue/VenueBlackoutSheet.tsx", smart: true },
  { rel: "src/components/event/CreatorStep2WhenRepeatPickerSheet.tsx", smart: true },
  // Exception: read-only error list → flex:1 bound only, plain RN ScrollView.
  { rel: "src/components/event/PublishErrorsSheet.tsx", smart: false },
];

// `scrollFlex: { flex: 1 }` style block (whitespace/comma tolerant).
const RE_SCROLLFLEX_STYLE =
  /scrollFlex\s*:\s*\{[^}]*\bflex\s*:\s*1\b[^}]*\}/;
// `style={styles.scrollFlex}` applied to the body ScrollView.
const RE_SCROLLFLEX_APPLIED = /style=\{\s*styles\.scrollFlex\s*\}/;
// Body ScrollView imported from the SmartScrollView wrapper (named or aliased).
const RE_SMART_IMPORT =
  /import\s*\{[^}]*\bScrollView\b[^}]*\}\s*from\s*["'][^"']*wrappers\/SmartScrollView["']/;

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

function runSelfTest() {
  let selfFail = 0;
  const goodStyle = `  scrollFlex: {\n    flex: 1,\n  },`;
  const badStyle = `  scroll: {\n    paddingBottom: spacing.xxl,\n  },`;
  const goodApplied = `<ScrollView style={styles.scrollFlex} contentContainerStyle={styles.scroll}>`;
  const badApplied = `<ScrollView contentContainerStyle={styles.scroll}>`;
  const goodSmartNamed = `import { ScrollView } from "../../wrappers/SmartScrollView";`;
  const goodSmartAliased = `import { ScrollView as BodyScrollView } from "../../wrappers/SmartScrollView";`;
  const badSmart = `import { Pressable, ScrollView, StyleSheet } from "react-native";`;

  if (!RE_SCROLLFLEX_STYLE.test(goodStyle)) {
    console.error("SELF-TEST FAIL: scrollFlex flex:1 style not detected");
    selfFail++;
  }
  if (RE_SCROLLFLEX_STYLE.test(badStyle)) {
    console.error("SELF-TEST FAIL: scrollFlex false-positive on non-flex style");
    selfFail++;
  }
  if (!RE_SCROLLFLEX_APPLIED.test(goodApplied)) {
    console.error("SELF-TEST FAIL: style={styles.scrollFlex} application not detected");
    selfFail++;
  }
  if (RE_SCROLLFLEX_APPLIED.test(badApplied)) {
    console.error("SELF-TEST FAIL: scrollFlex application false-positive when absent");
    selfFail++;
  }
  if (!RE_SMART_IMPORT.test(goodSmartNamed)) {
    console.error("SELF-TEST FAIL: SmartScrollView named import not detected");
    selfFail++;
  }
  if (!RE_SMART_IMPORT.test(goodSmartAliased)) {
    console.error("SELF-TEST FAIL: SmartScrollView aliased import not detected");
    selfFail++;
  }
  if (RE_SMART_IMPORT.test(badSmart)) {
    console.error("SELF-TEST FAIL: SmartScrollView false-positive on react-native import");
    selfFail++;
  }
  if (selfFail > 0) {
    console.error(`SELF-TEST: ${selfFail} expectation(s) failed`);
    process.exit(1);
  }
  console.log("SELF-TEST OK: I-PROPOSED-1193-SHEET-BODY-SCROLL-BOUNDED detectors behave");
  process.exit(0);
}

if (process.argv.includes("--self-test")) {
  runSelfTest();
}

for (const target of TARGETS) {
  const file = path.join(REPO_ROOT, "mingla-business", target.rel);
  const rel = target.rel;
  if (!fs.existsSync(file)) {
    fail("INV-1: target-present", `mingla-business/${rel} missing`);
    continue;
  }
  const src = readSource(file);

  if (RE_SCROLLFLEX_STYLE.test(src)) {
    ok("INV-1: scrollFlex-style", `${rel} defines scrollFlex { flex: 1 }`);
  } else {
    fail(
      "INV-1: scrollFlex-style",
      `${rel} is missing a \`scrollFlex: { flex: 1 }\` style — the body ScrollView would overflow the panel and clip the CTA (ORCH-1193)`,
    );
  }

  if (RE_SCROLLFLEX_APPLIED.test(src)) {
    ok("INV-1: scrollFlex-applied", `${rel} applies style={styles.scrollFlex} on the body ScrollView`);
  } else {
    fail(
      "INV-1: scrollFlex-applied",
      `${rel} does NOT apply \`style={styles.scrollFlex}\` to the body ScrollView — flex:1 must be on the ScrollView's own style (ORCH-1193)`,
    );
  }

  if (target.smart) {
    if (RE_SMART_IMPORT.test(src)) {
      ok("INV-2: smart-scrollview-import", `${rel} imports the body ScrollView from wrappers/SmartScrollView`);
    } else {
      fail(
        "INV-2: smart-scrollview-import",
        `${rel} does NOT import its body ScrollView from wrappers/SmartScrollView — the keyboard + 42dp Done bar would occlude the CTA (I-PROPOSED-KEYBOARD-TOOLBAR-CLEARANCE / ORCH-1193)`,
      );
    }
  } else {
    ok(
      "INV-2: smart-scrollview-exempt",
      `${rel} is the read-only PublishErrorsSheet exception (plain RN ScrollView is intentional; flex:1 bound still required)`,
    );
  }
}

process.exit(failures > 0 ? 1 : 0);
