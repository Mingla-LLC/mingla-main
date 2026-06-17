// @ts-nocheck
/* eslint-disable @typescript-eslint/no-require-imports */
//
// ORCH-1153 attempt #2 — the consumer EXPERIENCE detail FLOATING "Reserve →"
// pill was clipped under the home indicator (Seth, device). The pill is an
// absolute child of the gorhom BottomSheetContent whose layout extends below the
// VISIBLE sheet bottom; gorhom CLIPS that overflow. The shared
// ConsumerEventReserveBar (event + experience consumer details) lifted the float
// only by SHEET_BOTTOM_OVERSHOOT(63) + home-indicator floor(34) + gap(16) = 113,
// which landed the pill BELOW the sheet's clip line → cut off. Device-measured on
// an iPhone 17 Pro: the content clip sits ~158pt above the float wrapper's layout
// anchor, so the pill must lift ~120pt of overshoot (170 total) to render whole.
//
// FIX: ConsumerEventReserveBar.SHEET_BOTTOM_OVERSHOOT = 120 (was 63), used by the
// FLOAT wrapper's `bottom`. This is the SOLE owner of the float-pill `bottom` for
// BOTH consumer details. Device proof: Mingla_Artifacts/evidence/ORCH-1153/
// float_clears_ios.png.
//
// Source-string assertions (the RN component can't mount under the node harness —
// the established ORCH-1138/1153 consumer pattern). fails-on-revert: deleting the
// `SHEET_BOTTOM_OVERSHOOT = 120` line (or restoring 63) flips a case red. Owner:
// mingla-implementor.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// REPO_ROOT = up 5 from this dir (…/app-mobile/src/components/offering/__tests__).
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..", "..");
const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

let passed = 0;
function ok(name, cond, detail) {
  assert.ok(cond, `FAIL ${name}${detail ? " — " + detail : ""}`);
  console.log(`OK   ${name}`);
  passed += 1;
}

const BAR = "app-mobile/src/components/offering/ConsumerEventReserveBar.tsx";
const barRaw = read(BAR);
const bar = stripComments(barRaw);

// ── 1: the float overshoot is the device-corrected 120, NOT the old 63 ──────────
// FAILS-ON-REVERT: restoring `SHEET_BOTTOM_OVERSHOOT = 63` (the value that left
// the pill clipped under the sheet's bottom clip on a home-indicator device)
// flips this case red.
ok(
  "float overshoot is the device-corrected 120 (clears the gorhom sheet clip)",
  /SHEET_BOTTOM_OVERSHOOT\s*=\s*120\b/.test(bar) &&
    !/SHEET_BOTTOM_OVERSHOOT\s*=\s*63\b/.test(bar),
);

// ── 2: the float wrapper's `bottom` is still driven by the overshoot math ───────
// (overshoot + home-indicator floor + gap). If the wrapper stops consuming the
// overshoot, the fix is inert even with the right constant.
ok(
  "float wrapperBottom = safeBottom + SHEET_BOTTOM_OVERSHOOT + FLOAT_GAP",
  /wrapperBottom\s*=\s*safeBottom\s*\+\s*SHEET_BOTTOM_OVERSHOOT\s*\+\s*FLOAT_GAP/.test(
    bar,
  ),
);
ok(
  "the floating variant applies wrapperBottom to the absolute float wrapper",
  /styles\.floatWrapper,\s*\{\s*bottom:\s*wrapperBottom\s*\}/.test(bar),
);

// ── 3: safeBottom still floors on the home indicator (34) — never regress the ──
// home-indicator clearance the overshoot is layered on top of.
ok(
  "safeBottom still floors on HOME_INDICATOR_FLOOR (34)",
  /HOME_INDICATOR_FLOOR\s*=\s*34\b/.test(bar) &&
    /safeBottom\s*=\s*Math\.max\([^)]*HOME_INDICATOR_FLOOR\)/.test(bar),
);

// ── 4: the DOCKED variant is NOT regressed — it still pads its own safe-area ────
// bottom (the attempt-#1 docked fix) and is independent of the overshoot.
ok(
  "docked variant keeps paddingBottom: safeBottom + 8 (attempt-#1 fix preserved)",
  /paddingBottom:\s*safeBottom\s*\+\s*8/.test(bar),
);

// ── 5: the all-in price display path is intact (kicker + price rendered) ────────
ok(
  "all-in price block still renders (kicker + price) for the buy CTA",
  /kicker !== null/.test(bar) && /price\.length > 0/.test(bar),
);

console.log(`\n${passed} assertions passed.`);
