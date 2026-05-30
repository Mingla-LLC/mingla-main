// @ts-nocheck
/* eslint-disable @typescript-eslint/no-require-imports */
//
// ORCH-1016 [Consumer Discover Trips tab] — REWORK regression test.
// Operator UX corrections (2026-05-30):
//   FIX 1 — the consumer trip detail must render inside the app's CANONICAL sheet
//           (BaseBottomSheet, the SOLE permitted gorhom consumer used by
//           ExpandedBusinessEventSheet + every other detail surface), NOT the
//           prior bespoke full-screen overlay (no `<ScrollView>` + manual
//           absolute reserve bar over a raw `<View style={host}>`).
//   FIX 2 — every ORCH-1016 consumer scroll surface must CLEAR the floating
//           GlassBottomNav: the detail sheet is `tabBarAware` (so BaseBottomSheet
//           pads the body with BOTTOM_NAV_CONTENT_HEIGHT + safe-area), and the
//           Trips tab list (TripsContent) pads its scroll with
//           `bottomNavTotalHeight + insets.bottom`.
//
// app-mobile has no jest/RTL runner; the repo convention for mobile regression
// tests is node:assert source-assertions + behavioral replicas (see the sibling
// orch_1016_consumer_trip_detail.adversarial.test.tsx). Every assertion is
// written to FAIL if the guard it protects is reverted.
//
// Run with:
//   node app-mobile/src/screens/Trip/__tests__/orch_1016_consumer_trip_detail.rework_sheet.test.tsx

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../../../..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const detailSrc = read("src/screens/Trip/ConsumerTripDetailScreen.tsx");
const discoverScreenSrc = read("src/components/DiscoverScreen.tsx");
const tripsContentSrc = read("src/components/discover/TripsContent.tsx");
const deepLinkSrc = read("app/t/[brandSlug]/[tripSlug].tsx");
const layoutSrc = read("src/hooks/useAppLayout.ts");
const baseSheetSrc = read("src/components/ui/BaseBottomSheet.tsx");

let passed = 0;
function ok(name, cond, detail) {
  assert.ok(cond, `FAIL ${name}${detail ? " — " + detail : ""}`);
  console.log(`OK   ${name}`);
  passed += 1;
}

// ── FIX 1: detail renders inside the canonical BaseBottomSheet ──────────────
ok(
  "R1a detail imports the canonical BaseBottomSheet primitive",
  /import\s*\{[^}]*BaseBottomSheet[^}]*\}\s*from\s*["'][^"']*ui\/BaseBottomSheet["']/.test(
    detailSrc,
  ),
  "must import BaseBottomSheet from the shared ui primitive",
);
ok(
  "R1b detail body is wrapped in <BaseBottomSheet ...>",
  /<BaseBottomSheet[\s\S]*?<\/BaseBottomSheet>/.test(detailSrc),
  "the detail must be presented through the canonical sheet, not a bespoke overlay",
);
ok(
  "R1c sheet uses canonical snap tokens + 90% initial index (parity w/ ExpandedBusinessEventSheet)",
  /glass\.bottomSheet\.snapPoints/.test(detailSrc) &&
    /SHEET_INITIAL_INDEX\s*=\s*1/.test(detailSrc) &&
    /initialIndex=\{SHEET_INITIAL_INDEX\}/.test(detailSrc),
  "snapPoints from glass.bottomSheet + open at the 90% snap",
);
ok(
  "R1d sheet close routes to onBack via the primitive's onClose (pan-down + X parity)",
  /<BaseBottomSheet[\s\S]*?onClose=\{onBack\}/.test(detailSrc),
  "onClose must be wired to onBack so drag-to-dismiss and X close identically",
);
ok(
  "R1e the bespoke full-screen overlay host is GONE (no styles.host root + no manual absolute reserve bar)",
  !/styles\.host/.test(detailSrc) &&
    !/position:\s*"absolute"[\s\S]{0,120}bottom:\s*0/.test(detailSrc),
  "the old full-bleed <View style={host}> + absolute-bottom reserveBar overlay must be removed",
);
// ── FIX 1 (REWORK-2): frozen-scroll fix — the PRIMITIVE owns the gorhom scroll ──
// Operator on-device 2026-05-30: "sheets hang and don't scroll". Root cause: the
// first rework hand-rolled a <BottomSheetScrollView> as the body with
// scrollMode="view" + a stickyFooter, so the scroll landed two Views deep inside
// BaseBottomSheet's view+sticky branch and gorhom's sheet pan-responder swallowed
// the scroll gesture. The fix: scrollMode="scroll" so BaseBottomSheet renders the
// gorhom BottomSheetScrollView as a flex:1 DIRECT child of its BottomSheetView (the
// gesture-coordinated TicketCartSheet pattern). The screen must NOT hand-roll its
// own gorhom scroll, and must NEVER use a raw RN <ScrollView> inside the sheet.
ok(
  "R1f the trip detail sheet uses scrollMode='scroll' (the primitive owns the gorhom scroll host)",
  /<BaseBottomSheet[\s\S]*?scrollMode="scroll"[\s\S]*?<\/BaseBottomSheet>/.test(
    detailSrc,
  ),
  "scrollMode='scroll' lets BaseBottomSheet own the flex:1 BottomSheetScrollView that scrolls + pan-dismisses",
);
ok(
  "R1f-2 the screen does NOT hand-roll its own BottomSheetScrollView nor a raw RN <ScrollView> (the frozen-scroll regression)",
  !/<BottomSheetScrollView\b/.test(detailSrc) && !/<ScrollView\b/.test(detailSrc),
  "a hand-rolled scroll nested under the sticky-footer View is exactly the swallowed-gesture freeze; the primitive must own it",
);
ok(
  "R1f-3 the detail sheet keeps its sticky Reserve footer + tabBarAware nav clearance with the new scroll mode",
  /<BaseBottomSheet[\s\S]*?scrollMode="scroll"[\s\S]*?tabBarAware=\{tabBarAware\}[\s\S]*?stickyFooter=\{reserveFooter\}[\s\S]*?<\/BaseBottomSheet>/.test(
    detailSrc,
  ),
  "the scroll body must still pair with the pinned Reserve footer + nav clearance",
);

// ── FIX 2: the detail sheet clears the bottom nav (tabBarAware) ─────────────
ok(
  "R2a detail sheet is tabBarAware (adds BOTTOM_NAV clearance to the body)",
  /<BaseBottomSheet[\s\S]*?tabBarAware/.test(detailSrc),
  "tabBarAware must be set so the last Day + Reserve CTA clear the floating nav",
);
ok(
  "R2b in-app overlay (app/index.tsx) presents the detail tabBarAware",
  /<ConsumerTripDetailScreen[\s\S]*?tabBarAware[\s\S]*?\/>/.test(read("app/index.tsx")),
  "the in-app overlay sits below the floating nav and must pad for it",
);
ok(
  "R2c cold deep-link route passes tabBarAware={false} (no nav on that route)",
  /tabBarAware=\{false\}/.test(deepLinkSrc),
  "the standalone /t/ route has no GlassBottomNav, so it only needs OS-inset clearance",
);

// ── FIX 2: BaseBottomSheet's tabBarAware actually sources the nav height ─────
// Pin the primitive contract the detail relies on, so a refactor that severs
// tabBarAware → BOTTOM_NAV_CONTENT_HEIGHT fails HERE not silently on device.
ok(
  "R2d BaseBottomSheet derives tab-bar clearance from BOTTOM_NAV_CONTENT_HEIGHT (single source of truth)",
  /import\s*\{\s*BOTTOM_NAV_CONTENT_HEIGHT\s*\}\s*from\s*["'][^"']*useAppLayout["']/.test(
    baseSheetSrc,
  ) &&
    /tabBarExtra\s*=\s*tabBarAware\s*\?\s*BOTTOM_NAV_CONTENT_HEIGHT\s*:\s*0/.test(
      baseSheetSrc,
    ),
  "the primitive must add the canonical nav height when tabBarAware",
);
ok(
  "R2e useAppLayout exports BOTTOM_NAV_CONTENT_HEIGHT (the canonical nav-height token)",
  /export\s+const\s+BOTTOM_NAV_CONTENT_HEIGHT\s*=/.test(layoutSrc),
);

// ── FIX 2: the Trips tab list clears the bottom nav too ─────────────────────
ok(
  "R2f TripsContent sources nav height from useAppLayout().bottomNavTotalHeight (not a magic number)",
  /useAppLayout\(\)/.test(tripsContentSrc) &&
    /bottomNavTotalHeight/.test(tripsContentSrc),
);
ok(
  "R2g TripsContent scroll padding = bottomNavTotalHeight + insets.bottom + breathing room",
  /contentPaddingBottom\s*=\s*bottomNavTotalHeight\s*\+\s*insets\.bottom\s*\+\s*\d+/.test(
    tripsContentSrc,
  ),
  "the last trip card must sit above the floating nav",
);
ok(
  "R2h TripsContent applies contentPaddingBottom to BOTH the FlatList and the state containers",
  /paddingBottom:\s*contentPaddingBottom/.test(tripsContentSrc) &&
    (tripsContentSrc.match(/paddingBottom:\s*contentPaddingBottom/g) || []).length >= 2,
  "loading/empty/populated states must all clear the nav, not just one",
);

// ── FIX 2 (REWORK-2): the Trips tab pill reads as travel (plane / send glyph) ──
// Operator on-device 2026-05-30: the trips/travel tab should carry a plane or send
// icon, not the generic compass. `paper-plane-outline` maps to Lucide's `Send`
// glyph in the app's Icon set (already bundled; also used for "Leaving from" in the
// trip detail). The Events pill keeps `sparkles-outline`.
ok(
  "R3a the Trips tab pill uses a plane/send glyph (paper-plane-outline | send | airplane), not compass",
  /id:\s*"trips"[^}]*icon:\s*"(paper-plane-outline|paper-plane|send-outline|send|airplane-outline|airplane|navigate-outline|navigate)"/.test(
    discoverScreenSrc,
  ),
  "the Trips pill icon must read as travel (plane / send), not the prior compass-outline",
);
ok(
  "R3b the Trips pill is NOT the old compass-outline (the icon the operator rejected)",
  !/id:\s*"trips"[^}]*icon:\s*"compass-outline"/.test(discoverScreenSrc),
  "compass-outline was the rejected generic icon; the Trips pill must no longer use it",
);
ok(
  "R3c the Events pill icon is untouched (sparkles-outline)",
  /id:\s*"events"[^}]*icon:\s*"sparkles-outline"/.test(discoverScreenSrc),
  "only the Trips pill icon changes; the Events pill stays as-is",
);

console.log(
  `\n# ORCH-1016 consumer-trip-detail REWORK-2 (frozen-scroll fix + Trips plane icon) — ${passed} checks PASS`,
);
