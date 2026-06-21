// @ts-nocheck
/* eslint-disable @typescript-eslint/no-require-imports */
//
// ORCH-1138 Leg 3 — consumer EXPERIENCE detail (foundation) + EBES deletion +
// chat/deck/venue repoint — happy-path regression.
//
// Source-string assertions (the RN screen can't mount under the node harness —
// the established ORCH-1138 consumer pattern, sibling
// orch_1138_consumer_event_foundation). Covers SC-7 (foundation consumer
// detail), SC-8 (EBES gone, repointed deck/venue/chat), and the byte-identical
// checkout contract (eventDateId only when a slot is selected).
//
// fails-on-revert: deleting any asserted line flips a case red. Owner:
// mingla-implementor.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// REPO_ROOT = up 5 from this __tests__ dir (…/app-mobile/src/screens/Experience/__tests__).
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

const screen = read(
  "app-mobile/src/screens/Experience/ConsumerExperienceDetailScreen.tsx",
);
const screenCode = stripComments(screen);
const modal = stripComments(
  read("app-mobile/src/components/ExpandedCardModal.tsx"),
);
const chat = stripComments(
  read("app-mobile/src/components/MessageInterface.tsx"),
);

// ── SC-7: the consumer experience detail is foundation-composed ──
ok(
  "SC-7a composes the gorhom scroll host as a DIRECT child of BaseBottomSheet (no frozen scroll)",
  /<BaseBottomSheet[\s\S]*?<BottomSheetScrollView/.test(screenCode),
  "the BottomSheetScrollView must be a direct child of BaseBottomSheet",
);
ok(
  "SC-7b does NOT mount ParallaxCoverShell as the sheet host (Leg-1C frozen-scroll rule)",
  !/ParallaxCoverShell/.test(screenCode),
  "the consumer detail composes the Direction-A look, never ParallaxCoverShell",
);
ok(
  // ORCH-1183 [experience-standardize] — the reserve bar was CONVERGED onto the
  // shared <TripReserveBar> (single all-in price, no split) — the SAME bar the
  // buyer-web /exp/ route uses; the prior forked ConsumerEventReserveBar is retired.
  "SC-7c pins the cover + chrome + a float→dock shared TripReserveBar (ORCH-1183)",
  /EventCoverMedia/.test(screenCode) &&
    /OfferingChrome/.test(screenCode) &&
    /TripReserveBar/.test(screenCode) &&
    !/ConsumerEventReserveBar/.test(screenCode) &&
    /variant="docked"/.test(screenCode) &&
    /variant="floating"/.test(screenCode),
);
ok(
  // ORCH-1183 — the hand-mirrored itinerary section moved to the ONE shared
  // <ExperienceOfferingBody> (the per-stop VIDEO-capable StopSpine). The screen now
  // mounts the shared body; the seed adapter threads the real authored stops
  // (aiDescription) into the normalized contract (rule 9 — only when present).
  "SC-7d renders the REAL authored itinerary via the shared ExperienceOfferingBody (ORCH-1183)",
  /<ExperienceOfferingBody/.test(screenCode) &&
    /buildExperienceOfferingDataFromSeed/.test(screenCode),
);

// ── COMMS-0009: anon-read, never .from('brands') ──
ok(
  "SC-7e anon-read: the consumer detail NEVER queries .from('brands') (COMMS-0009)",
  !/\.from\(['"]brands['"]\)/.test(screenCode),
  "theme via useEventTheme(card) (business_public_events_view); no brands table read",
);

// ── adaptive Reserve (ORCH-1072 ported) + byte-identical checkout ──
ok(
  "SC-3 adaptive beginBooking: >1 → picker; ===1 auto-select; 0 → cart",
  /bookableOccurrences\.length > 1/.test(screenCode) &&
    /bookableOccurrences\.length === 1/.test(screenCode) &&
    /setOccurrencePickerVisible\(true\)/.test(screenCode),
);
ok(
  "byte-identical checkout: eventDateId rides ONLY when a slot is selected",
  /selectedEventDateId !== null[\s\S]*?\{ eventDateId: selectedEventDateId \}/.test(
    screenCode,
  ),
  "the null path omits eventDateId → request byte-identical",
);
ok(
  "the consumer detail reserves via TicketCartSheet DIRECTLY (never EBES)",
  /<TicketCartSheet/.test(screenCode) &&
    !/ExpandedBusinessEventSheet/.test(screenCode),
);

// ── SC-8: EBES gone + repointed deck/venue/chat ──
ok(
  "SC-8a ExpandedBusinessEventSheet.tsx is DELETED",
  !fs.existsSync(
    path.join(
      REPO_ROOT,
      "app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx",
    ),
  ),
);
ok(
  "SC-8b ExpandedCardModal repoints deck experience + venue experiences to ConsumerExperienceDetailScreen (no EBES)",
  /<ConsumerExperienceDetailScreen/.test(modal) &&
    /isExperienceCard/.test(modal) &&
    !/<ExpandedBusinessEventSheet/.test(modal) &&
    !/import[\s\S]*?ExpandedBusinessEventSheet[\s\S]*?from/.test(modal),
);
ok(
  "SC-8c chat repoints trip → ConsumerTripDetailScreen, event → ConsumerEventDetailScreen (no EBES)",
  /friend\.linkedEntityType === "trip"[\s\S]*?<ConsumerTripDetailScreen/.test(
    chat,
  ) &&
    /<ConsumerEventDetailScreen/.test(chat) &&
    !/<ExpandedBusinessEventSheet/.test(chat),
);

console.log(`\n${passed} assertions passed.`);
