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

// ORCH-1183 [experience-standardize] — the hand-mirrored render sections (vibe
// chips, meta chips, per-stop count-aware galleries, "Where you'll start" map,
// START HERE/THEN/END WITH labels + time pills) were RETIRED into the ONE shared
// @mingla/offering-rendering ExperienceOfferingBody (+ its StopSpine). The screen
// now mounts the shared body; the seed adapter
// (useConsumerExperienceOfferingData.buildExperienceOfferingDataFromSeed) threads
// the real intents/stops/coords/occurrences into the normalized contract. These
// SC-3..SC-7 assertions follow each section to its new owner so the "renders ALL
// sections" intent still fails-on-revert.
const adapter = stripComments(
  read("app-mobile/src/hooks/useConsumerExperienceOfferingData.ts"),
);
const body = stripComments(
  read("packages/offering-rendering/ExperienceOfferingBody.tsx"),
);
const spine = stripComments(read("packages/offering-rendering/StopSpine.tsx"));

// the screen mounts the shared body from the seed.
ok(
  "ORCH-1183 the screen mounts the shared <ExperienceOfferingBody> from the seed adapter",
  /<ExperienceOfferingBody/.test(screen) &&
    /buildExperienceOfferingDataFromSeed/.test(screen),
);

// ── SC-3: vibe chips (now in the shared body; adapter threads the intents) ──
ok(
  "SC-3 the adapter threads seed.experienceIntents; the body renders vibe chips",
  /seed\.experienceIntents/.test(adapter) &&
    /vibeLabels/.test(body) &&
    /vibeChip/.test(body),
);
ok(
  "SC-3 vibe ids map to display labels via the ONE shared EXPERIENCE_VIBE_LABELS map",
  /EXPERIENCE_VIBE_LABELS/.test(body),
);

// ── SC-4: count-aware per-stop galleries (NOT a single <Image>) — shared StopSpine ──
ok(
  "SC-4 the shared StopSpine renders a CountAwareGallery from each stop's media",
  /CountAwareGallery/.test(spine) && /stop\.media\.map/.test(spine),
);

// ── SC-5: "Where you'll start" map (shared body, stop-1 coords) ──
ok(
  "SC-5 the shared body renders a 'Where you'll start' static map from stop-1 coords",
  /Where you&rsquo;ll start/.test(body) &&
    /buildStaticMapUrl\(/.test(body) &&
    /s\.lat !== null && s\.lng !== null/.test(body),
);

// ── SC-6: meta row City + dates + seats + start-time (adapter builds, body renders) ──
ok(
  "SC-6 the adapter builds dates + seats + start-time labels; the body renders the chips",
  /buildDatesLabel/.test(adapter) &&
    /buildSeatsLabel/.test(adapter) &&
    /buildStartTimeLabel/.test(adapter) &&
    /datesLabel/.test(body) &&
    /seatsLabel/.test(body) &&
    /startTimeLabel/.test(body),
);

// ── SC-7: START HERE / THEN / END WITH + time pill (shared StopSpine) ──
ok(
  "SC-7 the shared StopSpine uses START HERE/THEN/END WITH labels + a per-stop time pill",
  /stopLabelForIndex/.test(spine) &&
    /START HERE/.test(spine) &&
    /END WITH/.test(spine) &&
    /formatStopTime\(/.test(spine),
);
ok(
  "SC-7 the consumer per-stop time still resolves via the device-locale formatStartTime, threaded to the body",
  /formatStopTime=\{\(iso: string \| null\) => formatStartTime\(iso\)\}/.test(
    screen,
  ),
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
