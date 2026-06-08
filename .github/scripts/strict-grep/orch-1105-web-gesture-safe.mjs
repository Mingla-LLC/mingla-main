#!/usr/bin/env node
/**
 * ORCH-1105 [Business-web parity strict-grep gates] — I-WEB-GESTURE-SAFE.
 *
 * WHY: ORCH-1098/1100 — `react-native-gesture-handler@2.28`'s `<GestureDetector>`
 * calls `Reanimated.useEvent`, which has no web implementation. Mounting a bare
 * `<GestureDetector>` on web throws and crashes the whole route into the app
 * error boundary (the swipe-dismiss sheets did exactly this). The fix wraps the
 * detector in `WebSafeGestureDetector` — native delegates to the real
 * `<GestureDetector>`; `WebSafeGestureDetector.web.tsx` renders children with no
 * detector → `useEvent` never runs → no crash.
 *
 * RULE:
 *   1. each swipe-dismiss sheet — TopSheet, SheetMobile, Toast — imports
 *      `WebSafeGestureDetector`.
 *   2. those sheets do NOT import `GestureDetector` directly from
 *      `react-native-gesture-handler` (that would re-introduce the web crash).
 *   3. the ONLY sanctioned importer of `GestureDetector` from
 *      `react-native-gesture-handler` is the wrapper itself
 *      (`WebSafeGestureDetector.tsx`, the native passthrough).
 *
 * SCOPE: shipped business UI components. `.web.tsx` of the wrapper is the web
 * passthrough (no detector) and is also allowed. Comments/JSDoc that merely
 * MENTION "GestureDetector" are fine — only the IMPORT statement is gated.
 *
 * Self-test (`--self-test`) proves the gate FIRES when a sheet imports
 * GestureDetector directly / drops the wrapper, and PASSES on the wrapper +
 * compliant sheets.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const UI_DIR = "mingla-business/src/components/ui";

// Swipe-dismiss sheets (relative to UI_DIR). Each MUST use the wrapper.
const GATED_SHEETS = ["TopSheet.tsx", "SheetMobile.tsx", "Toast.tsx"];

// The ONLY file allowed to import GestureDetector from rngh (the native wrapper).
const WRAPPER_BASENAME = "WebSafeGestureDetector.tsx";

const USES_WRAPPER = /\bWebSafeGestureDetector\b/;

// Direct import of `GestureDetector` from react-native-gesture-handler. Handles
// single-line and multi-line import blocks; tolerant of other named members.
const DIRECT_GESTURE_DETECTOR_IMPORT =
  /import\s*(?:type\s*)?{[^}]*\bGestureDetector\b[^}]*}\s*from\s*["']react-native-gesture-handler["']/;

function checkSheet(basename, failures) {
  const abs = path.join(root, UI_DIR, basename);
  if (!fs.existsSync(abs)) {
    failures.push(
      `sheet "${basename}" not found — gate sheet list out of sync with source.`,
    );
    return;
  }
  const src = fs.readFileSync(abs, "utf8");
  if (!USES_WRAPPER.test(src)) {
    failures.push(
      `${basename}: does not use \`WebSafeGestureDetector\` — a swipe-dismiss sheet must wrap its detector so it doesn't crash on web (ORCH-1098/1100).`,
    );
  }
  if (DIRECT_GESTURE_DETECTOR_IMPORT.test(src)) {
    failures.push(
      `${basename}: imports \`GestureDetector\` directly from "react-native-gesture-handler" — this re-introduces the reanimated useEvent-on-web crash. Use \`WebSafeGestureDetector\` instead.`,
    );
  }
}

function checkWrapperIsSoleImporter(failures) {
  // Sweep the whole UI dir: any file OTHER than the wrapper that imports
  // GestureDetector directly from rngh is a violation.
  const dir = path.join(root, UI_DIR);
  if (!fs.existsSync(dir)) {
    failures.push(`UI dir not found at ${UI_DIR}.`);
    return;
  }
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!ent.isFile()) continue;
    if (!/\.(tsx?|jsx?)$/.test(ent.name)) continue;
    if (ent.name === WRAPPER_BASENAME) continue; // sanctioned native passthrough
    const src = fs.readFileSync(path.join(dir, ent.name), "utf8");
    if (DIRECT_GESTURE_DETECTOR_IMPORT.test(src)) {
      failures.push(
        `${ent.name}: imports \`GestureDetector\` directly from "react-native-gesture-handler". Only ${WRAPPER_BASENAME} (the native wrapper) may do so; everything else must use \`WebSafeGestureDetector\`.`,
      );
    }
  }
}

// ---- Self-test
if (process.argv.includes("--self-test")) {
  const selfFailures = [];

  // Wrapper-detection: a direct import IS detected; a comment mention is NOT.
  if (
    !DIRECT_GESTURE_DETECTOR_IMPORT.test(
      `import { GestureDetector, Gesture } from "react-native-gesture-handler";`,
    )
  ) {
    selfFailures.push("direct GestureDetector import not detected");
  }
  if (
    DIRECT_GESTURE_DETECTOR_IMPORT.test(
      `// swipe-up-to-dismiss via the GestureDetector\nconst x = 1;`,
    )
  ) {
    selfFailures.push("comment mention of GestureDetector wrongly flagged");
  }
  if (
    !DIRECT_GESTURE_DETECTOR_IMPORT.test(
      `import {\n  GestureDetector,\n  type GestureType,\n} from "react-native-gesture-handler";`,
    )
  ) {
    selfFailures.push("multi-line GestureDetector import not detected");
  }

  // A compliant sheet: uses wrapper, no direct import.
  const goodSheet = `import { WebSafeGestureDetector } from "./WebSafeGestureDetector";\nimport { Gesture } from "react-native-gesture-handler";\n<WebSafeGestureDetector gesture={g} />`;
  if (USES_WRAPPER.test(goodSheet) === false) {
    selfFailures.push("compliant sheet not recognized as using wrapper");
  }
  if (DIRECT_GESTURE_DETECTOR_IMPORT.test(goodSheet)) {
    selfFailures.push("compliant sheet (Gesture-only import) wrongly flagged");
  }

  // A bad sheet: imports GestureDetector directly.
  const badSheet = `import { GestureDetector, Gesture } from "react-native-gesture-handler";\n<GestureDetector gesture={g} />`;
  if (!DIRECT_GESTURE_DETECTOR_IMPORT.test(badSheet)) {
    selfFailures.push("bad sheet (direct import) not flagged");
  }

  if (selfFailures.length) {
    console.error("ORCH-1105 I-WEB-GESTURE-SAFE self-test FAIL:");
    selfFailures.forEach((f) => console.error("  - " + f));
    process.exit(1);
  }
  console.log("ORCH-1105 I-WEB-GESTURE-SAFE self-test PASS (5/5 cases).");
  process.exit(0);
}

// ---- Live mode
const failures = [];
GATED_SHEETS.forEach((s) => checkSheet(s, failures));
checkWrapperIsSoleImporter(failures);

if (failures.length > 0) {
  console.error(
    `ORCH-1105 I-WEB-GESTURE-SAFE FAIL — the ORCH-1098/1100 web-safe gesture wrapper regressed.\n` +
      `Swipe-dismiss sheets must use \`WebSafeGestureDetector\`; only the native wrapper may import\n` +
      `\`GestureDetector\` from react-native-gesture-handler (reanimated useEvent crashes on web otherwise).\n\nFailures:\n  ` +
      failures.join("\n  "),
  );
  process.exit(1);
}
console.log(
  `ORCH-1105 I-WEB-GESTURE-SAFE PASS — all ${GATED_SHEETS.length} sheets use WebSafeGestureDetector; wrapper is the sole direct importer.`,
);
