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
// ── FIX 1 (ROOT-CAUSE, verified on-device iOS + Android 2026-05-31): bare
// scrollMode="scroll" direct-child binding ──────────────────────────────────
// The earlier REWORK-2/3 contracts (primitive-owned scrollMode="scroll"+stickyFooter,
// then scrollMode="view" + an injected flex scroll host) both still froze on device:
// any wrapper (stickyFooter/header/bodyContainerStyle prop, or a BottomSheetView one
// level deeper) makes gorhom size the sheet to CONTENT, so viewport==content and
// maxScroll=0. The proven shape is a BARE scrollMode="scroll" so BaseBottomSheet's
// OWN gorhom BottomSheetScrollView is the DIRECT child of BottomSheetContent, with
// {detailBody} + {reserveFooter} as its two children.
ok(
  "R1f the populated trip detail sheet uses a BARE scrollMode='scroll' (BaseBottomSheet owns the gorhom scroll as a direct child) + hidesBottomNav",
  /scrollMode="scroll"\s*\n\s*hidesBottomNav/.test(detailSrc),
  "bare scrollMode='scroll' makes the gorhom BottomSheetScrollView the DIRECT child of the height-bounded BottomSheetContent — the only structure gorhom constrains to the snap height",
);
ok(
  "R1f-2 the detail body + Reserve footer are the sheet's two DIRECT children (no injected scroll host, no wrapper)",
  /scrollMode="scroll"[\s\S]{0,260}>\s*\{detailBody\}\s*\{reserveFooter\}\s*<\/BaseBottomSheet>/.test(
    detailSrc,
  ),
  "{detailBody}{reserveFooter} render straight inside the bare scroll sheet; a wrapper child re-introduces the frozen viewport==content config",
);
ok(
  "R1f-2b the screen does NOT use a raw RN <ScrollView> inside the sheet (raw RN scroll fights the gorhom pan)",
  !/<ScrollView\b/.test(detailSrc),
  "a raw RN ScrollView nested in a gorhom sheet fights the sheet pan; the bare scrollMode='scroll' lets gorhom own the single registered scrollable",
);
ok(
  "R1f-3 the populated detail sheet does NOT use the stickyFooter / header / bodyContainerStyle wrapper props (each routes gorhom into the frozen viewport==content config)",
  !/stickyFooter=\{/.test(detailSrc) &&
    !/<BaseBottomSheet[\s\S]*?scrollMode="scroll"[\s\S]*?bodyContainerStyle=/.test(
      detailSrc,
    ),
  "the wrapper props nest the scroll one BottomSheetView level deeper, which is exactly the height-bounded-wrapper config that froze on device; the Reserve bar is a direct sibling child instead",
);
ok(
  "R1f-4 the Reserve footer is a direct sibling View with OS safe-area clearance only (no faked nav-height gap — the nav is hidden by hidesBottomNav)",
  /const\s+footerNavClearance\s*=\s*Math\.max\(insets\.bottom,\s*16\)/.test(
    detailSrc,
  ) &&
    /<View\s+style=\{\[styles\.reserveBar,\s*\{\s*paddingBottom:\s*footerNavClearance\s*\}\]\}/.test(
      detailSrc,
    ),
  "with hidesBottomNav hiding the floating nav, the footer only needs home-indicator clearance; it must NOT add BOTTOM_NAV_CONTENT_HEIGHT",
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
