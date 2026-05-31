// @ts-nocheck
/* eslint-disable @typescript-eslint/no-require-imports */
//
// ORCH-1016 [Consumer Discover Trips tab] — sheet/nav ownership regression test.
//
// ROOT-CAUSE FIX (verified on-device iOS + Android 2026-05-31): the consumer
// ticket sheets (trip detail Reserve, EBES event/ticket, cart) clear the floating
// GlassBottomNav by HIDING it while a sheet is open — NOT by padding under it
// (REWORK-5/6) and NOT by hosting the sheet group in a SheetOverlayCarrier RN
// Modal above it (REWORK-7/11, which broke Android scroll gestures and didn't fix
// z-order; the carrier component is deleted). A ref-counted bottomNavStore lets
// nested sheets stack their hide requests; index.tsx gates the GlassBottomNav
// render on the resulting `bottomNavHidden`. This guard pins that contract so a
// refactor that re-introduces the carrier, drops the store, or un-gates the nav
// fails HERE, not silently on device.
//
// app-mobile has no jest/RTL runner; the repo convention for mobile regression
// tests is node:assert source-assertions. Every assertion is written to FAIL if
// the guard it protects is reverted.
//
// Run with:
//   node app-mobile/src/components/__tests__/orch_1016_nav_container_clearance.test.tsx

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../../..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

const navStoreSrc = read("src/store/bottomNavStore.ts");
const baseSheetSrc = read("src/components/ui/BaseBottomSheet.tsx");
const indexSrc = read("app/index.tsx");
const expandedSheetSrc = read(
  "src/components/expandedCard/ExpandedBusinessEventSheet.tsx",
);
const cartSheetSrc = read("src/components/expandedCard/TicketCartSheet.tsx");
const tripDetailSrc = read("src/screens/Trip/ConsumerTripDetailScreen.tsx");

let passed = 0;
function ok(name, cond, detail) {
  assert.ok(cond, `FAIL ${name}${detail ? " — " + detail : ""}`);
  console.log(`OK   ${name}`);
  passed += 1;
}

ok(
  "N1 bottomNavStore is a ref-counted hide store (hideCount + push/pop, clamped at 0)",
  /hideCount:\s*number/.test(navStoreSrc) &&
    /pushHide:\s*\(\)\s*=>\s*set\(\(s\)\s*=>\s*\(\{\s*hideCount:\s*s\.hideCount\s*\+\s*1/.test(
      navStoreSrc,
    ) &&
    /popHide:\s*\(\)\s*=>\s*set\(\(s\)\s*=>\s*\(\{\s*hideCount:\s*Math\.max\(0,\s*s\.hideCount\s*-\s*1/.test(
      navStoreSrc,
    ),
  "ref-counting (not a boolean) is what lets nested sheets — EBES + cart open together — both hide the nav and only restore it when the LAST one closes",
);

ok(
  "N2 bottomNavStore exposes useBottomNavHidden + imperative push/pop helpers",
  /export\s+const\s+useBottomNavHidden\s*=\s*\(\):\s*boolean\s*=>/.test(
    navStoreSrc,
  ) &&
    /s\.hideCount\s*>\s*0/.test(navStoreSrc) &&
    /export\s+const\s+pushHideBottomNav\b/.test(navStoreSrc) &&
    /export\s+const\s+popHideBottomNav\b/.test(navStoreSrc),
  "the hook drives the index.tsx gate; the imperative helpers are what BaseBottomSheet's effect calls",
);

ok(
  "N3 BaseBottomSheet owns the hidesBottomNav prop and push/pops the store for the sheet's lifetime",
  /hidesBottomNav\?:\s*boolean/.test(baseSheetSrc) &&
    /pushHideBottomNav/.test(baseSheetSrc) &&
    /popHideBottomNav/.test(baseSheetSrc) &&
    /if\s*\(!visible\s*\|\|\s*!hidesBottomNav\)\s*return undefined;[\s\S]{0,80}pushHideBottomNav\(\);[\s\S]{0,80}return\s*\(\)\s*=>\s*popHideBottomNav\(\);/.test(
      baseSheetSrc,
    ),
  "any sheet sets hidesBottomNav and the primitive pushes a hide on mount + pops on unmount/close — single source of the hide lifecycle",
);

ok(
  "N4 index.tsx gates the GlassBottomNav render on !bottomNavHidden (the nav is removed, not painted-over)",
  /import\s*\{\s*useBottomNavHidden\s*\}\s*from\s*["'][^"']*store\/bottomNavStore["']/.test(
    indexSrc,
  ) &&
    /const\s+bottomNavHidden\s*=\s*useBottomNavHidden\(\);/.test(indexSrc) &&
    /\{!bottomNavHidden\s*&&\s*\(/.test(indexSrc),
  "the floating nav must be unmounted while a hidesBottomNav sheet is open so the sheet's CTA is never covered",
);

ok(
  "N5 the SheetOverlayCarrier RN Modal is DELETED (the superseded z-stack approach is gone, not dormant)",
  !exists("src/components/ui/SheetOverlayCarrier.tsx"),
  "the carrier broke Android scroll gestures and didn't fix z-order; nav clearance is now hidesBottomNav, and the dead component must not linger",
);

ok(
  "N6 ExpandedBusinessEventSheet sets hidesBottomNav and no longer imports/renders SheetOverlayCarrier",
  /scrollMode="scroll"\s*\n\s*hidesBottomNav/.test(expandedSheetSrc) &&
    !/import\s*\{[^}]*SheetOverlayCarrier/.test(expandedSheetSrc) &&
    !/<SheetOverlayCarrier\b/.test(expandedSheetSrc) &&
    !/renderInOverlayCarrier/.test(expandedSheetSrc),
  "the EBES event sheet (and its sibling cart) hide the nav themselves; the carrier prop/import are removed",
);

ok(
  "N7 the cart + trip-detail sheets also set hidesBottomNav (every consumer ticket sheet hides the nav)",
  /hidesBottomNav/.test(cartSheetSrc) && /hidesBottomNav/.test(tripDetailSrc),
  "cart 'Continue to Payment' and trip 'Reserve' must both clear the nav via the same hide mechanism",
);

console.log(
  `\nORCH-1016 sheet/nav ownership (hidesBottomNav) regression — ${passed} checks PASS`,
);
