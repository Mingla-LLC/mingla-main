// @ts-nocheck
/* eslint-disable @typescript-eslint/no-require-imports */
//
// ORCH-1016 [Consumer Discover Trips tab] — sheet/nav ownership regression test.
//
// The failed REWORK-5/6/7/10 family treated the bug as padding: content padding,
// real scroll spacers, gorhom bottomInset, and a window-bounded inline host. Real
// device screenshots still showed the bottom nav covering the ticket area because
// the sheet group was still an inline sibling below GlassBottomNav. This guard pins
// the corrected contract: whole multi-root sheet groups render in one RN Modal
// carrier above the nav; padding remains only for safe-area/breathing room.
//
// Run with:
//   node app-mobile/src/components/__tests__/orch_1016_nav_container_clearance.test.tsx

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../../..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const carrierSrc = read("src/components/ui/SheetOverlayCarrier.tsx");
const baseSheetSrc = read("src/components/ui/BaseBottomSheet.tsx");
const expandedSheetSrc = read(
  "src/components/expandedCard/ExpandedBusinessEventSheet.tsx",
);
const cartSheetSrc = read("src/components/expandedCard/TicketCartSheet.tsx");
const tripDetailSrc = read("src/screens/Trip/ConsumerTripDetailScreen.tsx");
const expandedCardModalSrc = read("src/components/ExpandedCardModal.tsx");

let passed = 0;
function ok(name, cond, detail) {
  assert.ok(cond, `FAIL ${name}${detail ? " — " + detail : ""}`);
  console.log(`OK   ${name}`);
  passed += 1;
}

ok(
  "N1 SheetOverlayCarrier hosts a sheet group in RN Modal + GestureHandlerRootView",
  /Modal\s+as\s+RNModal/.test(carrierSrc) &&
    /GestureHandlerRootView/.test(carrierSrc) &&
    /<RNModal[\s\S]*?transparent[\s\S]*?animationType="none"[\s\S]*?statusBarTranslucent/.test(
      carrierSrc,
    ) &&
    /<GestureHandlerRootView\s+style=\{styles\.root\}>[\s\S]*?\{children\}/.test(
      carrierSrc,
    ),
  "the proven ORCH-0908 z-stack fix is the RN Modal carrier, with RNGH inside the modal window",
);

ok(
  "N2 BaseBottomSheet still owns only a single-sheet RN Modal escape hatch",
  /wrapInRNModal\?:\s*boolean/.test(baseSheetSrc) &&
    /if\s*\(wrapInRNModal\)[\s\S]*?<RNModal[\s\S]*?\{sheet\}[\s\S]*?<\/RNModal>/.test(
      baseSheetSrc,
    ),
  "multi-root flows must use SheetOverlayCarrier; BaseBottomSheet.wrapInRNModal wraps only one sheet root",
);

ok(
  "N3 ExpandedBusinessEventSheet can wrap the EBES + TicketCartSheet sibling group together",
  /renderInOverlayCarrier\?:\s*boolean/.test(expandedSheetSrc) &&
    /const\s+sheetGroup\s*=\s*\(\s*<>[\s\S]*?<BaseBottomSheet[\s\S]*?<TicketCartSheet[\s\S]*?<\/>\s*\)/.test(
      expandedSheetSrc,
    ) &&
    /bodyContainerStyle=\{styles\.sheetBody\}/.test(expandedSheetSrc) &&
    /if\s*\(renderInOverlayCarrier\)[\s\S]*?<SheetOverlayCarrier[\s\S]*?visible=\{visible\s*\|\|\s*cartSheetVisible\}[\s\S]*?\{sheetGroup\}[\s\S]*?<\/SheetOverlayCarrier>/.test(
      expandedSheetSrc,
    ),
  "ticket checkout is a second sibling sheet root, so the carrier must wrap the group, and the parent sheet body must be flex-bounded so tickets can scroll",
);

ok(
  "N4 EBES overlay-carrier mode disables TicketCartSheet's floating-nav padding",
  /<TicketCartSheet[\s\S]*?clearFloatingNav=\{!renderInOverlayCarrier\}/.test(
    expandedSheetSrc,
  ) &&
    /clearFloatingNav\?:\s*boolean/.test(cartSheetSrc) &&
    /\(clearFloatingNav\s*\?\s*BOTTOM_NAV_CONTENT_HEIGHT\s*:\s*0\)\s*\+\s*Math\.max\(insets\.bottom,\s*16\)/.test(
      cartSheetSrc,
    ),
  "when the whole group is already above the nav, the cart CTA should keep safe-area clearance without adding a fake nav-height gap",
);

ok(
  "N5 Consumer event detail opts the business-event branch into the group carrier",
  /<ExpandedBusinessEventSheet[\s\S]*?renderInOverlayCarrier[\s\S]*?bottomContentInset=\{Math\.max\(insets\.bottom,\s*16\)\s*\+\s*32\}/.test(
    expandedCardModalSrc,
  ) &&
    !/getFloatingBottomNavSheetInset/.test(expandedCardModalSrc) &&
    !/BOTTOM_NAV_CONTENT_HEIGHT/.test(expandedCardModalSrc),
  "the direct business-event early return bypasses the normal ExpandedCardModal wrapper, so it must host EBES itself",
);

ok(
  "N6 Trip detail wraps the main detail + reserve sheet sibling roots in one carrier",
  /import\s*\{\s*SheetOverlayCarrier\s*\}/.test(tripDetailSrc) &&
    /const\s+renderSheetGroup\s*=\s*\(sheetGroup:\s*ReactElement\):\s*ReactElement\s*=>[\s\S]*?<SheetOverlayCarrier\s+visible\s+onRequestClose=\{onBack\}>[\s\S]*?\{sheetGroup\}[\s\S]*?<\/SheetOverlayCarrier>/.test(
      tripDetailSrc,
    ) &&
    /return\s+renderSheetGroup\(\s*<>[\s\S]*?<BaseBottomSheet[\s\S]*?<ExpandedBusinessEventSheet[\s\S]*?<\/>/.test(
      tripDetailSrc,
    ),
  "the main trip detail, reserve sheet, and cart must share the same overlay owner when the nav exists",
);

ok(
  "N7 Trip Reserve no longer relies on floating-nav bottomSheetInset plumbing",
  /<ExpandedBusinessEventSheet[\s\S]*?bottomContentInset=\{Math\.max\(insets\.bottom,\s*16\)\s*\+\s*32\}/.test(
    tripDetailSrc,
  ) &&
    !/getFloatingBottomNavSheetInset/.test(tripDetailSrc) &&
    !/BOTTOM_NAV_CONTENT_HEIGHT/.test(tripDetailSrc),
  "the fix is group z-stack ownership; the reserve path should not claim another padding/inset-only fix",
);

console.log(
  `\nORCH-1016 sheet/nav ownership regression — ${passed} checks PASS`,
);
