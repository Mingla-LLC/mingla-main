import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { applyVenueDiscountQuote } from "../../_shared/venueOrderPricing.ts";

const source = await Deno.readTextFile(new URL("../index.ts", import.meta.url));

Deno.test("D11 every money-bearing staff handler refuses a supplied code", () => {
  assertEquals(source.match(/"discountCode" in body/g)?.length, 4);
  assertEquals(source.match(/error: "discount_code_not_accepted"/g)?.length, 4);
  assert(!/\bp_code\s*:\s*(?!null\b|NULL\b)/.test(source));
});

Deno.test("D11 staff create snapshots automatic and sale discounts once", () => {
  for (
    const seam of [
      "callDiscountQuoteLines",
      "code: null",
      "buyer: {}",
      "subtotal_cents: discountedCart.netSubtotalCents",
      "discount_snapshot: venueDiscountSnapshot",
      'channel: "staff"',
      "discountedCart.lines",
    ]
  ) assert(source.includes(seam), `missing staff snapshot seam ${seam}`);
  const settle = source.slice(
    source.indexOf("async function handleSettle"),
    source.indexOf("async function billToPhone"),
  );
  assert(
    !settle.includes("callDiscountQuoteLines"),
    "settle must use the stored net snapshot",
  );
});

Deno.test("D11 weekly lunch sale carries 8000 list and 6500 net", () => {
  const discounted = applyVenueDiscountQuote(
    [{
      lineNo: 1,
      menuItemId: "lunch",
      itemNameAtOrder: "Weekly lunch",
      unitPriceCents: 8_000,
      currency: "NGN",
      quantity: 1,
      modifiersTotalCents: 0,
      lineTotalCents: 8_000,
      notes: null,
      modifiers: [],
    }],
    {
      lines: [{
        lineRef: "001",
        listUnitMinor: 8_000,
        netUnitMinor: 6_500,
        qty: 1,
        unitsCounted: 1,
        lineListMinor: 8_000,
        lineNetMinor: 6_500,
        lineDiscountMinor: 1_500,
        applied: [],
      }],
      listSubtotalMinor: 8_000,
      discountMinor: 1_500,
      netSubtotalMinor: 6_500,
      applied: [],
      codeOutcome: {
        status: "none",
        reason: null,
        required: null,
        with: null,
        replaced: [],
      },
      notices: [],
      digest: "a".repeat(32),
      listDigest: "b".repeat(32),
    },
  );
  assertEquals(discounted.listSubtotalCents, 8_000);
  assertEquals(discounted.netSubtotalCents, 6_500);
});

Deno.test("D11 tab settlement is explicitly undiscounted", () => {
  const close = source.slice(source.indexOf("async function handleTabClose"));
  assert(close.includes("list_subtotal_cents: null"));
  assert(close.includes("discount_cents: 0"));
  assert(close.includes("discount_snapshot: null"));
  assert(close.includes("subtotal_cents: subtotal"));
});
