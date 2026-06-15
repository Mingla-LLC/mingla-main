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
// ── FIX 1 (ORCH-1138 Leg 1C RETARGET — Direction-A foundation + FLOATING reserve)
// ────────────────────────────────────────────────────────────────────────────
// ORCH-1138 Leg 1C re-rendered the populated body via the shared
// @mingla/offering-rendering ParallaxCoverShell to reach FULL parity with the
// business/web trip page, AND made the Reserve bar FLOAT (Seth's explicit ask).
//
// The ORCH-1016/1043 scroll-freeze contract is STILL honored, by a DIFFERENT
// proven shape (the original R1f/R1f-2/R1f-4 "bare scrollMode='scroll' + scroll-
// sibling footer" assertions are RETARGETED here — see SPEC §9 + the ORCH-1016/
// 1043 freeze history they protected):
//   • The sheet runs scrollMode="view" and mounts ParallaxCoverShell as its body.
//   • ParallaxCoverShell is given ScrollComponent={BottomSheetScrollView} so the
//     gorhom scrollable remains the SINGLE registered scrollable (no nested raw
//     ScrollView, no second scrollable, no viewport==content freeze).
//   • The Reserve bar FLOATS via a position:"absolute" overlay sibling of the
//     shell inside a flex:1 host — NOT BaseBottomSheet.stickyFooter (which would
//     nest the gorhom scroll one BottomSheetView level deeper and re-freeze it).
// These assertions FAIL when the foundation change is reverted, preserving the
// scroll-freeze guard under the new structure.
ok(
  "R1f the populated trip detail sheet renders via the shared ParallaxCoverShell + hidesBottomNav (Direction-A foundation parity)",
  /import\s*\{[\s\S]*?ParallaxCoverShell[\s\S]*?\}\s*from\s*["']@mingla\/offering-rendering["']/.test(
    detailSrc,
  ) &&
    /<ParallaxCoverShell[\s\S]*?<\/ParallaxCoverShell>/.test(detailSrc) &&
    /scrollMode="view"\s*\n\s*hidesBottomNav/.test(detailSrc),
  "the populated body composes the shared foundation primitive (ParallaxCoverShell) inside a scrollMode='view' sheet, hiding the floating nav",
);
ok(
  "R1f-2 ParallaxCoverShell is given ScrollComponent={BottomSheetScrollView} (gorhom owns the SINGLE registered scrollable — no viewport==content freeze)",
  /ScrollComponent=\{BottomSheetScrollView\}/.test(detailSrc),
  "the shell's native scroll host MUST be gorhom's BottomSheetScrollView so the gorhom scroll stays the single registered scrollable (ORCH-1016/1043 contract)",
);
ok(
  "R1f-2b the screen does NOT use a raw RN <ScrollView> inside the sheet (raw RN scroll fights the gorhom pan)",
  !/<ScrollView\b/.test(detailSrc),
  "a raw RN ScrollView nested in a gorhom sheet fights the sheet pan; the foundation lets gorhom own the single registered scrollable via ScrollComponent",
);
ok(
  "R1f-3 the populated detail sheet does NOT use the stickyFooter / header / bodyContainerStyle wrapper props (each routes gorhom into the frozen viewport==content config) — the Reserve bar FLOATS as an absolute overlay instead",
  !/stickyFooter=\{/.test(detailSrc) &&
    !/<BaseBottomSheet[\s\S]*?bodyContainerStyle=/.test(detailSrc) &&
    !/<BaseBottomSheet[\s\S]*?\bheader=/.test(detailSrc),
  "the wrapper props nest the scroll one BottomSheetView level deeper, the exact height-bounded-wrapper config that froze on device (ORCH-1016/1043); the floating reserve is a position:absolute overlay sibling of the shell instead (ConsumerTripReserveBar)",
);
ok(
  "R1f-4 the Reserve bar FLOATS via the consumer-local ConsumerTripReserveBar overlay (Seth's explicit floating-bar ask), wired to the existing checkout",
  /import\s*\{[^}]*ConsumerTripReserveBar[^}]*\}\s*from\s*["'][^"']*offering\/ConsumerTripReserveBar["']/.test(
    detailSrc,
  ) &&
    /<ConsumerTripReserveBar[\s\S]*?onPress=\{\(\)\s*=>\s*setReserveSheetVisible\(true\)\}/.test(
      detailSrc,
    ),
  "the floating Reserve bar is the absolute-overlay ConsumerTripReserveBar, and its press still opens the existing reserve flow (setReserveSheetVisible(true)) — checkout unchanged",
);

// ── FIX 2: the detail clears the bottom nav by HIDING it (hidesBottomNav), not
// by padding under it and not by a SheetOverlayCarrier RN Modal above it ───────
// The carrier (REWORK-7/11) broke Android scroll gestures and didn't fix z-order;
// it is removed. The populated sheet sets hidesBottomNav so the GlassBottomNav is
// hidden while the sheet is open. renderSheetGroup is now a pure passthrough.
ok(
  "R2a the trip detail hides the floating nav via hidesBottomNav and no longer imports/renders the removed SheetOverlayCarrier",
  /hidesBottomNav/.test(detailSrc) &&
    !/import\s*\{[^}]*SheetOverlayCarrier/.test(detailSrc) &&
    !/<SheetOverlayCarrier\b/.test(detailSrc),
  "nav clearance is solved by hiding the nav (hidesBottomNav), not by importing/rendering the removed RN Modal carrier (a prose mention of the removal is fine)",
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
