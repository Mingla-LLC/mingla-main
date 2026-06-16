// @ts-nocheck
/* eslint-disable @typescript-eslint/no-require-imports */
//
// ORCH-1138 Leg 3 REWORK (§9) — consumer EXPERIENCE detail renders ALL the
// mockup sections — happy-path regression.
//
// Source-string assertions (the established ORCH-1138 consumer pattern — the RN
// screen can't mount under the node harness; sibling
// orch_1138_consumer_experience_foundation.test.tsx). Asserts the rework added
// every mockup-load-bearing section: vibe chips, count-aware galleries, the
// "Where you'll start" map, the City/dates/seats/start-time meta chips, the
// sold-out/ended state banner, START HERE/THEN/END WITH labels + time pills, the
// synchronous seed-theme fallback, and the open-daily ExperienceReservePicker
// entry. SC-3..SC-10.
//
// fails-on-revert: deleting any asserted render section flips a case red. Owner:
// mingla-implementor.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

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

const screen = stripComments(
  read("app-mobile/src/screens/Experience/ConsumerExperienceDetailScreen.tsx"),
);

// ── SC-3: vibe chips ──
ok(
  "SC-3 renders vibe chips from seed.experienceIntents (only when non-empty)",
  /vibeChips\.length > 0/.test(screen) &&
    /seed\.experienceIntents/.test(screen) &&
    /vibeChip/.test(screen),
);
ok(
  "SC-3 vibe ids map to display labels (EXPERIENCE_INTENT_LABEL)",
  /EXPERIENCE_INTENT_LABEL/.test(screen),
);

// ── SC-4: count-aware per-stop galleries (NOT a single <Image> for stop media) ──
ok(
  "SC-4 each stop renders a CountAwareGallery from stop.imageUrls",
  /CountAwareGallery[\s\S]*items=\{galleryItems\}/.test(screen) &&
    /stopGalleryItems\(/.test(screen),
);

// ── SC-5: "Where you'll start" map ──
ok(
  "SC-5 renders a 'Where you'll start' static map from stop-1 coords",
  /Where you&apos;ll start/.test(screen) &&
    /buildStaticMapUrl\(/.test(screen) &&
    /startMapUrl/.test(screen),
);

// ── SC-6: meta row City + dates + seats + start-time ──
ok(
  "SC-6 meta row carries dates + seats + start-time chips (beyond City)",
  /datesSubline/.test(screen) &&
    /seatsLabel/.test(screen) &&
    /experienceStartTime/.test(screen),
);

// ── SC-7: START HERE / THEN / END WITH + time pill ──
ok(
  "SC-7 stop labels use stop.stopLabel (not 'Stop N') + per-stop time pill",
  /stop\.stopLabel/.test(screen) &&
    /stopTimePill/.test(screen) &&
    /formatStartTime\(stop\.startTime\)/.test(screen),
);
ok(
  "SC-7 the generic 'Stop {stopNumber}' ordinal label is gone from the stop card",
  !/Stop \{stop\.stopNumber/.test(screen),
);

// ── SC-8: themed render via synchronous seed fallback (no #FF6B35 content flash) ──
ok(
  "SC-8 a synchronous seedTheme fallback from seed.brandTheme feeds resolveTheme",
  /seedTheme/.test(screen) &&
    /seed\?\.brandTheme/.test(screen) &&
    /themeQuery\.data \?\? seedTheme/.test(screen),
);

// ── SC-9: state banner ──
ok(
  "SC-9 renders a sold-out/ended state banner from the resolved CTA",
  /stateBanner/.test(screen) &&
    /offeringCta\.kind === "unavailable"/.test(screen),
);

// ── SC-10: open-daily adaptive Reserve ──
ok(
  "SC-10 Reserve opens the open-daily ExperienceReservePicker for open-daily models",
  /ExperienceReservePicker/.test(screen) &&
    /mode="open-daily"/.test(screen) &&
    /openDaily/.test(screen),
);
ok(
  "SC-10/SC-11 the picker confirm seeds the cart with the chosen quantity (party size)",
  /handleReserveConfirm/.test(screen) &&
    /initialQuantity=\{selectedQuantity\}/.test(screen),
);

// ── no mingla-business import (I-MOR-0827) ──
ok(
  "I-MOR-0827 the screen imports nothing from mingla-business/src",
  !/mingla-business\/src/.test(screen),
);

console.log(`\n${passed} assertions passed.`);
