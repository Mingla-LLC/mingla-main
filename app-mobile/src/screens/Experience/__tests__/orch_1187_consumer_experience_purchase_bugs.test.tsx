// @ts-nocheck
/* eslint-disable @typescript-eslint/no-require-imports */
//
// ORCH-1187 — consumer EXPERIENCE purchase bugs (Seth device testing).
// Source-string regression for the 4 client fixes on
// ConsumerExperienceDetailScreen.tsx (the RN screen can't mount under the node
// harness — the established ORCH-1138 consumer pattern).
//
// FIX-1: the black band — the scroll-content clearance now MATCHES the trip page
//        (reserveBarClearance = 8), NOT the prior SHEET_BOTTOM_OVERSHOOT + 8.
// FIX-3(a): fresh by-slug RPC fetch + prefer-fresh openDaily / occurrences.
// FIX-3(b): beginBooking branches on openDaily FIRST (the open-daily wizard always
//           opens, matching usesPicker = openDaily || bookable.length > 1).
// FIX-4(a): ended occurrences (endAt <= now) are filtered before the picker.
// FIX-4(b): the 422 occurrence_not_* reasons map to a friendly toast + re-open the
//           reserve picker (not the generic "Payment failed.").
//
// fails-on-revert: deleting any asserted line flips a case red. Owner:
// mingla-implementor.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// REPO_ROOT = up 5 from this __tests__ dir.
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

const screenCode = stripComments(
  read("app-mobile/src/screens/Experience/ConsumerExperienceDetailScreen.tsx"),
);

// ── FIX-1: black band — clearance matches the trip page (8, not overshoot+8) ──
ok(
  "FIX-1 reserveBarClearance is a flat 8 (matches the trip page; no overshoot pad on scroll content)",
  /const\s+reserveBarClearance\s*=\s*8\b/.test(screenCode) &&
    !/reserveBarClearance\s*=\s*SHEET_BOTTOM_OVERSHOOT\s*\+\s*8/.test(screenCode),
  "the prior `SHEET_BOTTOM_OVERSHOOT + 8` exposed the dark sheet bg as a black band",
);
ok(
  "FIX-1 the overshoot is kept ONLY on the floating pill's sheetBottomOvershoot prop",
  /sheetBottomOvershoot=\{SHEET_BOTTOM_OVERSHOOT\}/.test(screenCode) &&
    /const\s+SHEET_BOTTOM_OVERSHOOT\s*=\s*63/.test(screenCode),
);

// ── FIX-3(a): fresh by-slug RPC fetch + prefer-fresh ──
ok(
  "FIX-3(a) fetches FRESH detail via useConsumerExperienceDetail keyed on the seed's brandSlug+eventSlug",
  /useConsumerExperienceDetail\(\s*seed\?\.brandSlug\s*\?\?\s*null,\s*seed\?\.eventSlug\s*\?\?\s*null,?\s*\)/.test(
    screenCode,
  ),
);
ok(
  "FIX-3(a) PREFERS the fresh RPC isRecurring/recurrenceRule for openDaily (seed is the fallback)",
  /freshDetail\s*!==\s*null/.test(screenCode) &&
    /isRecurring:\s*freshDetail\.isRecurring/.test(screenCode) &&
    /recurrenceRule:\s*freshDetail\.recurrenceRule/.test(screenCode),
);
ok(
  "FIX-3(a) PREFERS the fresh RPC occurrences over the (stale) seed.upcomingOccurrences",
  /freshDetail\s*!==\s*null[\s\S]*?freshDetail\.occurrences/.test(screenCode) &&
    /seed\?\.upcomingOccurrences/.test(screenCode),
);

// ── FIX-3(b): beginBooking branches on openDaily FIRST ──
ok(
  "FIX-3(b) beginBooking branches on openDaily FIRST (before the bookable.length > 1 check)",
  /if\s*\(openDaily\)\s*\{[\s\S]*?setReservePickerVisible\(true\);[\s\S]*?return;[\s\S]*?\}[\s\S]*?if\s*\(bookableOccurrences\.length > 1\)/.test(
    screenCode,
  ),
  "an open-daily experience must ALWAYS open the day→time→party wizard",
);

// ── FIX-4(a): ended occurrences are filtered (endAt > now) ──
ok(
  "FIX-4(a) ended occurrences (endAt <= now) are filtered before the reserve picker",
  /new Date\(o\.endAt\)\.getTime\(\)/.test(screenCode) &&
    /end\s*>\s*now/.test(screenCode),
  "mirrors the server's event_dates end_at filter so the cart never submits a passed slot",
);

// ── FIX-4(b): 422 occurrence_not_* → friendly toast + re-open the picker ──
ok(
  "FIX-4(b) maps the 422 occurrence_not_available / occurrence_not_found to a friendly, actionable toast",
  /occurrence_not_available/.test(screenCode) &&
    /occurrence_not_found/.test(screenCode) &&
    /That time just passed — pick another\./.test(screenCode),
);
ok(
  "FIX-4(b) re-opens the reserve picker on the stale-occurrence 422 (not a dead 'Payment failed.')",
  /isStaleOccurrence[\s\S]*?(setReservePickerVisible\(true\)|setOccurrencePickerVisible\(true\))/.test(
    screenCode,
  ),
);

console.log(`\n${passed} assertions passed.`);
