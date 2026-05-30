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
// ── FIX 1 (REWORK-3): frozen-scroll fix — MIRROR the empirically-proven sheet ──
// Operator on-device STILL froze after REWORK-2: "swiping the sheet down closes,
// but i cant scroll the content of the sheet itself". REWORK-2 used
// scrollMode="scroll" + a `stickyFooter`, which routes BaseBottomSheet into its
// sticky-footer branch: <BottomSheetContent> → <BottomSheetView flex:1> →
// <BottomSheetScrollView flex:1>. gorhom's BottomSheetContent is a height-bounded
// overflow:hidden box; the ONLY sheet that physically scrolls in this app
// (ExpandedBusinessEventSheet) injects its gorhom BottomSheetScrollView as a
// flex:1 *DIRECT* child of BottomSheetContent. Wrapping the scroll one
// BottomSheetView deeper changed the measured viewport and froze it.
//
// FIX (mirror ExpandedBusinessEventSheet LINE-FOR-LINE): scrollMode="view" so the
// primitive passes children straight into BottomSheetContent, and the screen
// renders the gorhom BottomSheetScrollView (re-exported from the primitive — the
// SOLE permitted gorhom importer) as its OWN flex:1 scroll host, with the sticky
// Reserve footer as a SIBLING <View> below it (NOT the stickyFooter prop, which
// re-introduces the freezing wrapper). These assertions FAIL on a revert to the
// scrollMode="scroll"+stickyFooter (frozen) wiring.
ok(
  "R1f the trip detail sheet uses scrollMode='view' WITH the BottomSheetScrollView host as its direct child (proven ExpandedBusinessEventSheet wiring)",
  /scrollMode="view"[\s\S]{0,200}accessibilityLabel=\{detail\.title\}[\s\S]{0,80}>\s*<BottomSheetScrollView/.test(
    detailSrc,
  ),
  "scrollMode='view' must pass the gorhom scroll host straight into BottomSheetContent as a flex:1 direct child (the only config that scrolls)",
);
ok(
  "R1f-2 the screen OWNS a BottomSheetScrollView (re-exported from the primitive) as its scroll host — exactly like ExpandedBusinessEventSheet",
  /import\s*\{[\s\S]*?BottomSheetScrollView[\s\S]*?\}\s*from\s*["'][^"']*ui\/BaseBottomSheet["']/.test(
    detailSrc,
  ) && /<BottomSheetScrollView\b/.test(detailSrc),
  "the proven pattern injects gorhom's BottomSheetScrollView as the OWN scroll host; the frozen REWORK-2 let the primitive own it via scrollMode='scroll'",
);
ok(
  "R1f-2b the screen does NOT use a raw RN <ScrollView> inside the sheet (raw RN scroll fights the gorhom pan)",
  !/<ScrollView\b/.test(detailSrc),
  "a raw RN ScrollView nested in a gorhom sheet fights the sheet pan; must be the gorhom BottomSheetScrollView",
);
ok(
  "R1f-3 the detail sheet does NOT use the stickyFooter prop (that branch is the frozen-scroll regression)",
  !/stickyFooter=\{/.test(detailSrc) && !/scrollMode="scroll"/.test(detailSrc),
  "the stickyFooter prop + scrollMode='scroll' is exactly the height-bounded-wrapper config that froze on device; the Reserve bar is now a sibling View",
);
ok(
  "R1f-4 the scroll host claims flex:1 (bounded viewport inside BottomSheetContent) so a tall body actually scrolls",
  /scrollHost:\s*\{\s*flex:\s*1\s*\}/.test(detailSrc) &&
    /style=\{styles\.scrollHost\}/.test(detailSrc),
  "without flex:1 the scroll host sizes to content inside the height-bounded BottomSheetContent and never scrolls",
);
ok(
  "R1f-5 the Reserve footer is a sibling that still clears the floating nav (BOTTOM_NAV_CONTENT_HEIGHT) + safe area",
  /import\s*\{\s*BOTTOM_NAV_CONTENT_HEIGHT\s*\}\s*from\s*["'][^"']*useAppLayout["']/.test(
    detailSrc,
  ) &&
    /footerNavClearance\s*=[\s\S]*?BOTTOM_NAV_CONTENT_HEIGHT[\s\S]*?insets\.bottom/.test(
      detailSrc,
    ),
  "the sibling footer now owns the nav clearance the primitive's tabBarAware path used to provide",
);

// ── FIX 2: the detail clears the bottom nav (tabBarAware threads to the footer) ─
// REWORK-3: the sheet body no longer uses scrollMode="scroll"/stickyFooter, so the
// primitive's tabBarAware padding no longer applies. The screen consumes the
// tabBarAware prop directly to size its SIBLING footer's nav clearance. The last
// Day + Reserve CTA still clear the floating GlassBottomNav.
ok(
  "R2a detail consumes tabBarAware to size the footer nav clearance (folds BOTTOM_NAV when in-app)",
  /tabBarAware\s*\?\s*BOTTOM_NAV_CONTENT_HEIGHT\s*:\s*0/.test(detailSrc),
  "tabBarAware must gate the floating-nav clearance on the sibling Reserve footer",
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
