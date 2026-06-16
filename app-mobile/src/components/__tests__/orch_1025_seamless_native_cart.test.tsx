// @ts-nocheck
/* eslint-disable @typescript-eslint/no-require-imports */
//
// ORCH-1025 [Seamless native consumer cart] — regression guard.
//
// Contract (SPEC_ORCH-1025_SEAMLESS_NATIVE_CART.md §2/§3/§5):
//   - The consumer cart no longer imports or renders CartTaxPreview (the buyer
//     billing-address + "Calculate tax" gate is RETIRED; the file is deleted).
//   - Continue-to-Payment is NO LONGER gated on a `taxPreview` (the buyer can pay
//     immediately).
//   - The onCheckout payload OMITS `address` and `taxCalculationId` (G-2: tax is
//     sourced at the venue server-side; the buyer never types an address).
//   - The displayed all-in total derives ONLY from server data — per-tier
//     `priceAllInGbp` (= compute_all_in_cents / 100) and base `price_cents` —
//     with NO inline `* taxRate` / `* feeBps` client-side math (G-1 / G-3).
//   - The upstream consumer (ExpandedBusinessEventSheet) no longer forwards
//     `payload.taxCalculationId` to runNativeCheckout.
//
// app-mobile has no jest/RTL runner; the repo convention for mobile regression
// tests is node:assert source-assertions (see orch_1016_*.test.tsx). Every
// assertion is written to FAIL if the guard it protects is reverted.
//
// Run with:
//   node app-mobile/src/components/__tests__/orch_1025_seamless_native_cart.test.tsx

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../../..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

// Strip line comments (// …) and block comments (/* … */) and JSX comments
// ({/* … */}) so the "no longer references X" assertions test ACTUAL CODE, not
// the explanatory comments that intentionally mention the retired symbols.
const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "") // block + JSX comments
    .replace(/^\s*\/\/.*$/gm, ""); // whole-line // comments

const cartRaw = read("src/components/expandedCard/TicketCartSheet.tsx");
const cartCode = stripComments(cartRaw);
// ORCH-1138 Leg 3 [TEST-MOD-APPROVED ORCH-1138] — ExpandedBusinessEventSheet was
// DELETED (EBES decommission). Its successor consumers are the foundation detail
// screens (ConsumerEventDetailScreen + ConsumerExperienceDetailScreen), which
// carry the ported handleBuy. Retarget E1 to those — the no-taxCalculationId
// invariant must hold on EVERY upstream consumer of runNativeCheckout.
const upstreamCode = stripComments(
  read("src/screens/Event/ConsumerEventDetailScreen.tsx") +
    "\n" +
    read("src/screens/Experience/ConsumerExperienceDetailScreen.tsx"),
);

let passed = 0;
function ok(name, cond, detail) {
  assert.ok(cond, `FAIL ${name}${detail ? " — " + detail : ""}`);
  console.log(`OK   ${name}`);
  passed += 1;
}

// ---------------------------------------------------------------------------
// G-A — CartTaxPreview is fully retired
// ---------------------------------------------------------------------------
ok(
  "A1 app-mobile CartTaxPreview.tsx is deleted",
  !exists("src/components/checkout/CartTaxPreview.tsx"),
  "the billing-address/Calculate-tax form must be removed, not just unrendered",
);

ok(
  "A2 TicketCartSheet no longer imports CartTaxPreview",
  !/import\s*\{[^}]*CartTaxPreview[^}]*\}\s*from/.test(cartCode) &&
    !/from\s*["'][^"']*checkout\/CartTaxPreview["']/.test(cartCode),
  "no import of the retired form",
);

ok(
  "A3 TicketCartSheet no longer renders <CartTaxPreview>",
  !/<CartTaxPreview[\s/>]/.test(cartCode),
  "the JSX render of the billing form is gone",
);

// ---------------------------------------------------------------------------
// G-B — Continue-to-Payment is no longer gated on taxPreview
// ---------------------------------------------------------------------------
ok(
  "B1 no `taxPreview` state/identifier remains in code",
  !/\btaxPreview\b/.test(cartCode) && !/\bsetTaxPreview\b/.test(cartCode),
  "the taxPreview state + its setter must be removed",
);

ok(
  "B2 Continue-to-Payment is NOT gated on a taxPreview === null check",
  !/taxPreview\s*===\s*null/.test(cartCode),
  "the buyer can pay immediately; no tax-preview wait",
);

ok(
  "B3 handleConfirm guard is lines/submitting-only (no taxPreview term)",
  /if\s*\(\s*totals\.isEmpty\s*\|\|\s*isSubmitting\s*\)\s*return\s*;/.test(
    cartCode,
  ),
  "the early-return guard dropped the taxPreview clause",
);

// ---------------------------------------------------------------------------
// G-C — checkout payload omits address + taxCalculationId (G-2)
// ---------------------------------------------------------------------------
// Isolate the onCheckout({ … }) argument object so we test the PAYLOAD, not the
// payload TYPE's doc comment (already stripped) or unrelated code.
const onCheckoutMatch = cartCode.match(/onCheckout\(\{([\s\S]*?)\}\);/);
ok(
  "C0 onCheckout call site is present",
  onCheckoutMatch !== null,
  "must still call onCheckout with the assembled payload",
);
const payloadBody = onCheckoutMatch ? onCheckoutMatch[1] : "";

ok(
  "C1 onCheckout payload omits `address`",
  !/\baddress\s*:/.test(payloadBody),
  "no buyer address is sent (tax is venue-sourced)",
);

ok(
  "C2 onCheckout payload omits `taxCalculationId`",
  !/\btaxCalculationId\s*:/.test(payloadBody),
  "no taxCalculationId is sent; the backend owns the calculation",
);

ok(
  "C3 onCheckout payload still carries totalCents from the all-in sum",
  /\btotalCents\s*:\s*pricing\.allInCents\b/.test(payloadBody),
  "totalCents = the server-derived all-in sum (display/telemetry only)",
);

ok(
  "C4 the payload TYPE no longer declares address/taxCalculationId fields",
  !/taxCalculationId\s*:\s*string\s*\|\s*null\s*;/.test(cartCode) &&
    !/address\s*:\s*CartTaxPreviewResult/.test(cartCode),
  "TicketCartCheckoutPayload dropped the address + taxCalculationId members",
);

// ---------------------------------------------------------------------------
// G-D — all-in derives ONLY from server all_in_cents / price_cents (G-1/G-3)
// ---------------------------------------------------------------------------
ok(
  "D1 all-in total reads the server priceAllInGbp field",
  /ticket\?\.\s*priceAllInGbp/.test(cartCode) ||
    /ticket\.priceAllInGbp/.test(cartCode),
  "the displayed all-in comes from the server-computed per-tier price",
);

ok(
  "D2 a tier with no server all-in falls back to base (never fabricated)",
  /priceAllInGbp\s*!=\s*null\s*\?\s*ticket\.priceAllInGbp\s*:\s*null/.test(
    cartCode,
  ) && /lineAllInCents\s*=[\s\S]*?:\s*lineBaseCents/.test(cartCode),
  "null all-in → base price_cents fallback, drop the affordance",
);

ok(
  "D3 NO inline tax/fee arithmetic anywhere in the cart",
  !/\*\s*taxRate/.test(cartCode) &&
    !/\*\s*feeBps/.test(cartCode) &&
    !/\btaxRate\b/.test(cartCode) &&
    !/\bfeeBps\b/.test(cartCode),
  "the app only sums server all_in_cents and does cents/100 — no fee/tax math",
);

ok(
  "D4 fees & tax is the all-in − base delta (the ONE truthful derived figure)",
  /allInCents\s*-\s*baseCents/.test(cartCode),
  "feesTax = all-in minus base; never a fabricated split",
);

// ---------------------------------------------------------------------------
// G-E — upstream consumer no longer forwards taxCalculationId
// ---------------------------------------------------------------------------
ok(
  "E1 foundation detail consumers no longer pass payload.taxCalculationId",
  !/taxCalculationId\s*:\s*payload\.taxCalculationId/.test(upstreamCode),
  "the runNativeCheckout call drops the taxCalculationId forward (post-EBES successors)",
);

// ---------------------------------------------------------------------------
// G-F — ORCH-1016 scroll/nav fix preserved (no regression)
// ---------------------------------------------------------------------------
ok(
  "F1 ORCH-1016 bare scrollMode=\"scroll\" + hidesBottomNav preserved",
  /scrollMode=\{?["']scroll["']\}?/.test(cartRaw) &&
    /\bhidesBottomNav\b/.test(cartRaw),
  "the cart keeps the proven ROOT-CAUSE scroll/nav wiring",
);

ok(
  "F2 ORCH-1016 {header}{body}{stickyFooter} direct-children order preserved",
  /\{header\}\s*\{body\}\s*\{stickyFooter\}/.test(cartRaw),
  "the three scroll children stay direct children of BaseBottomSheet",
);

console.log(`\n${passed} assertions passed.`);
