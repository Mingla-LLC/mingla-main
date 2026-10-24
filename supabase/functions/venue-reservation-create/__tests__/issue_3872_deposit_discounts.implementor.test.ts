import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const source = await Deno.readTextFile(new URL("../index.ts", import.meta.url));

Deno.test("D7 deposit preview is read-only and returns the full server quote", () => {
  const previewStart = source.indexOf("const previewPayload =");
  const previewEnd = source.indexOf("// #3392", previewStart);
  assert(previewStart > 0 && previewEnd > previewStart);
  const preview = source.slice(previewStart, previewEnd);
  for (
    const field of [
      "depositListCents",
      "discountCents",
      "depositNetCents",
      "feesAndTaxCents",
      "quoteDigest",
      "requiresPayment",
    ]
  ) assert(preview.includes(field), `preview missing ${field}`);
  assert(!preview.includes(".insert("), "preview must not insert a row");
  assert(
    !preview.includes("callReserveDiscountUses"),
    "preview must not reserve a use",
  );
});

Deno.test("D7 free and paid deposits both use the discounted net", () => {
  for (
    const seam of [
      "const depositNetCents = discountQuote.netSubtotalMinor",
      "if (depositNetCents === 0)",
      "completeFreeReservation",
      "baseCents: number",
      "priceReservationDeposit(",
      "deposit_list_cents: s.depositListCents",
      "discount_snapshot: s.discountSnapshot",
    ]
  ) assert(source.includes(seam), `missing deposit discount seam ${seam}`);
  assert(
    source.includes(
      "priceReservationDeposit(\n    pricing,\n    providerRouting.provider,\n    depositNetCents,",
    ),
  );
});

Deno.test("D7 failed persistence releases the reserved deposit use", () => {
  assert(
    source.includes(
      'callReleaseDiscountUses(\n        supabase,\n        "reservation_deposit"',
    ),
  );
  assert(
    source.match(
      /sessionId === null[\s\S]{0,180}await releaseDiscountUses\(\)/g,
    )?.length === 2,
  );
});
