// @ts-nocheck
/* eslint-disable @typescript-eslint/no-require-imports */
//
// ORCH-1138 [content-sized cart] — the consumer ticket CART sheet
// (TicketCartSheet) must SIZE TO ITS CONTENT, not open to a fixed tall snap.
//
// THE BUG (Seth, consumer device 2026-06-15): tapping "Get tickets" / "Reserve"
// opened the cart at a FIXED ["92%"] snap. Because the whole cart (header + body
// + "Continue to Payment" CTA) renders as ONE BottomSheetScrollView content block
// (scrollMode="scroll", no header/stickyFooter props), a short single-ticket cart
// sat at the TOP of the 92% viewport, leaving a large empty black gap at the
// bottom and the CTA stranded mid-screen.
//
// THE FIX: enable gorhom v5 dynamic sizing on the cart's BaseBottomSheet
// (`enableDynamicSizing` + `maxDynamicContentSize` clamped to ~92% of the window).
// The sheet now sizes to its scroll content — short cart = short sheet with the
// CTA anchored at the content bottom; tall cart caps at 92% and the inner
// scrollable scrolls (preserving the ORCH-1016/1043 scroll-to-Pay behavior). This
// is the SHARED cart used by events, trips, AND experiences, so the single fix
// covers all three.
//
// app-mobile has no jest/RTL runner; the repo convention is node:assert
// source-assertions. Every assertion FAILS on a TRUE LINE-DELETION of the wiring
// it protects (fails-on-revert).
//
// Run with:
//   node app-mobile/src/components/expandedCard/__tests__/orch_1138_cart_sheet_content_sized.test.ts

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../../../..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const stripComments = (src) =>
  src
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/\/\*[\s\S]*?\*\//g, "");

const cart = stripComments(
  read("src/components/expandedCard/TicketCartSheet.tsx"),
);
const primitive = stripComments(read("src/components/ui/BaseBottomSheet.tsx"));

let passed = 0;
function ok(name, cond, detail) {
  assert.ok(cond, `FAIL ${name}${detail ? " — " + detail : ""}`);
  console.log(`OK   ${name}`);
  passed += 1;
}

// ── T-1 — the cart sheet opts into dynamic (content) sizing ──
// Isolate the <BaseBottomSheet …> opening tag the cart renders.
const cartSheetOpen = (() => {
  const start = cart.indexOf("<BaseBottomSheet");
  assert.ok(start >= 0, "T-precheck: TicketCartSheet must render <BaseBottomSheet>");
  const end = cart.indexOf(">", start);
  return cart.slice(start, end);
})();

ok(
  "T1a the cart's BaseBottomSheet enables dynamic (content) sizing",
  /\benableDynamicSizing\b/.test(cartSheetOpen),
  "without enableDynamicSizing the sheet reverts to a fixed tall snap and the empty-gap bug returns",
);
ok(
  "T1b the cart passes a maxDynamicContentSize clamp (caps growth at the 92% ceiling)",
  /maxDynamicContentSize=\{maxDynamicContentSize\}/.test(cartSheetOpen),
  "the dynamic content snap must be clamped so a tall cart caps + scrolls instead of growing to full screen",
);

// ── T-2 — the clamp is derived from the window height (content-sized, not fixed) ──
ok(
  "T2a the clamp fraction (MAX_DYNAMIC_FRACTION) exists",
  /const MAX_DYNAMIC_FRACTION = 0\.92;/.test(cart),
);
ok(
  "T2b maxDynamicContentSize = round(windowHeight * MAX_DYNAMIC_FRACTION)",
  /Math\.round\(windowHeight \* MAX_DYNAMIC_FRACTION\)/.test(cart),
  "the cap must track the device window so it adapts across phone sizes",
);
ok(
  "T2c the window height is read via useWindowDimensions",
  /useWindowDimensions/.test(cart) &&
    /const \{ height: windowHeight \} = useWindowDimensions\(\)/.test(cart),
);

// ── T-3 — the single-scroll structure that makes content-sizing correct is intact ──
// All content (header + body + CTA) must remain ONE scroll block so the measured
// contentHeight includes the CTA and the sheet fits it exactly.
ok(
  "T3a the cart still uses scrollMode=\"scroll\" (one measured scroll block)",
  /scrollMode="scroll"/.test(cartSheetOpen),
);
ok(
  "T3b the cart does NOT route header/stickyFooter through BaseBottomSheet props (CTA stays a scroll child)",
  !/\bheader=\{/.test(cartSheetOpen) && !/\bstickyFooter=\{/.test(cartSheetOpen),
  "passing header/stickyFooter props would split the CTA out of the measured content",
);

// ── T-4 — BaseBottomSheet forwards maxDynamicContentSize to gorhom ──
ok(
  "T4a the primitive declares the maxDynamicContentSize prop",
  /maxDynamicContentSize\?: number;/.test(primitive),
);
ok(
  "T4b the primitive destructures maxDynamicContentSize",
  /^\s*maxDynamicContentSize,\s*$/m.test(primitive),
);
ok(
  "T4c the primitive forwards maxDynamicContentSize to <BottomSheet>",
  /maxDynamicContentSize=\{maxDynamicContentSize\}/.test(primitive),
);

console.log(
  `\n${passed} assertions passed (ORCH-1138 content-sized cart sheet).`,
);
