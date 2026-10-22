import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  applyVenueDiscountQuote,
  venueOrderIdempotencyKey,
} from "../../_shared/venueOrderPricing.ts";
import { posixTimezoneForOffset } from "../../_shared/venueOrderCore.ts";

const source = await Deno.readTextFile(
  new URL("../index.ts", import.meta.url),
);

Deno.test("D6 venue checkout bans client money and carries the server quote", () => {
  for (
    const key of [
      '"discountCents"',
      '"discountAmount"',
      '"discountMinor"',
      '"listSubtotalCents"',
      '"netSubtotalCents"',
    ]
  ) assert(source.includes(key), `missing banned client key ${key}`);
  for (
    const seam of [
      "callDiscountQuoteLines",
      "subtotalCents: discountedCart.netSubtotalCents",
      "callReserveDiscountUses",
      "callReleaseDiscountUses",
      "await releaseDiscountUses();",
      'kind: "free_completed"',
      'type: "tip_dropped_free_order"',
    ]
  ) assert(source.includes(seam), `missing venue discount seam ${seam}`);
});

Deno.test("D6 quoted venue lines preserve list - discount = net", () => {
  const cart = applyVenueDiscountQuote(
    [{
      lineNo: 1,
      menuItemId: "item",
      itemNameAtOrder: "Lunch",
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
  assertEquals(cart.listSubtotalCents - cart.discountCents, 6_500);
  assertEquals(cart.netSubtotalCents, 6_500);
  assertEquals(cart.lines[0].discountCents, 1_500);
});

Deno.test("D6 a code changes the venue idempotency key and no code does not add a segment", async () => {
  const hash = (value: string) => Promise.resolve(value);
  const base = {
    scopeId: "session",
    buyerKey: "buyer",
    lines: [{ menuItemId: "item", quantity: 1, modifierIds: [], notes: null }],
    tipBps: null,
  };
  const noCode = await venueOrderIdempotencyKey(base, hash);
  const coded = await venueOrderIdempotencyKey({
    ...base,
    discountCode: "SAVE10",
  }, hash);
  assert(!noCode.includes("code:"));
  assert(coded.includes("code:SAVE10"));
});

Deno.test("D6 venue schedule fallback preserves fixed UTC offsets", () => {
  assertEquals(posixTimezoneForOffset(330), "-05:30");
  assertEquals(posixTimezoneForOffset(-300), "+05:00");
  assertEquals(posixTimezoneForOffset(Number.NaN), "UTC");
});
