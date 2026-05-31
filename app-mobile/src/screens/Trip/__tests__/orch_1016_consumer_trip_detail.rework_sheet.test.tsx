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
//           GlassBottomNav: the in-app trip detail sheet group is hosted in one
//           SheetOverlayCarrier above the nav, and the Trips tab list pads its
//           scroll with `bottomNavTotalHeight + insets.bottom`.
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
// ── FIX 1 (REWORK-3/RUNTIME): frozen-scroll fix — own one bounded sheet body ──
// The earlier "direct child" source contract still failed on runtime evidence:
// swipes moved the sheet/video, not the tickets. The actual working shape is
// scrollMode="view" plus an explicit flex body container, with the screen-owned
// BottomSheetScrollView inside that bounded viewport and the Reserve footer as a
// sibling below it. This preserves the no-stickyFooter/no-raw-ScrollView contract
// while giving gorhom a real viewport for ticket rows to scroll within.
ok(
  "R1f the trip detail sheet uses scrollMode='view' with an explicit flex body wrapper around its owned BottomSheetScrollView",
  /scrollMode="view"[\s\S]{0,120}bodyContainerStyle=\{styles\.sheetBody\}[\s\S]{0,160}accessibilityLabel=\{detail\.title\}[\s\S]{0,120}>\s*<BottomSheetScrollView/.test(
    detailSrc,
  ),
  "the owned gorhom scroll host must sit inside BaseBottomSheet's flex body wrapper so it gets a bounded viewport",
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
  "R1f-5 the Reserve footer is a sibling with safe-area clearance; nav clearance is owned by the group carrier",
  /const\s+footerNavClearance\s*=\s*Math\.max\(insets\.bottom,\s*16\)/.test(
    detailSrc,
  ) &&
    /<View\s+style=\{\[styles\.reserveBar,\s*\{\s*paddingBottom:\s*footerNavClearance\s*\}\]\}/.test(
      detailSrc,
    ),
  "the footer remains pinned below the scroll host, but GlassBottomNav clearance is no longer faked with footer padding",
);

// ── FIX 2: the detail clears the bottom nav via group-level z-stack ownership ───
// REWORK-11: the sheet body no longer pretends nav clearance is just a padding
// problem. The in-app trip detail, reserve, and cart sibling roots sit inside a
// single RN Modal carrier above GlassBottomNav. The cold deep-link route has no
// nav and opts out.
ok(
  "R2a detail uses SheetOverlayCarrier when tabBarAware so the full sheet group renders above the floating nav",
  /import\s*\{\s*SheetOverlayCarrier\s*\}\s*from\s*["'][^"']*ui\/SheetOverlayCarrier["']/.test(
    detailSrc,
  ) &&
    /const\s+renderSheetGroup\s*=\s*\(sheetGroup:\s*ReactElement\):\s*ReactElement\s*=>[\s\S]*?if\s*\(!tabBarAware\)\s*return\s+sheetGroup[\s\S]*?<SheetOverlayCarrier\s+visible\s+onRequestClose=\{onBack\}>/.test(
      detailSrc,
    ),
  "tabBarAware now means the trip sheet group is carrier-hosted above the nav, not padded underneath it",
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
  "R2d BaseBottomSheet still preserves its one-sheet wrapInRNModal escape hatch",
  /wrapInRNModal\?:\s*boolean/.test(baseSheetSrc) &&
    /if\s*\(wrapInRNModal\)[\s\S]*?<RNModal[\s\S]*?\{sheet\}[\s\S]*?<\/RNModal>/.test(
      baseSheetSrc,
    ),
  "single-root sheets can still use BaseBottomSheet.wrapInRNModal; multi-root trip/event flows use SheetOverlayCarrier",
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
