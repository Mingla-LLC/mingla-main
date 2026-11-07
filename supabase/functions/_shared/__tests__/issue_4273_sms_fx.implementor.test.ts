// #4273 — a Blast SMS to numbers priced in different currencies (Termii NGN,
// Twilio USD) quotes one total in the brand's currency, converted with the FX
// snapshot as of quotedAt and sealed in the quote hash.
// MINGLA-INVARIANT: I-4273-SMS-COST-ONE-CURRENCY-SEALED | issue #4273 | A Blast SMS quote states one total in one currency; mixed provider currencies are converted to the brand's currency with the FX snapshot as of quotedAt, sealed in the quote hash, and per-person allocations sum exactly to the total.
// Run: deno test --allow-read --allow-env supabase/functions/_shared/__tests__/issue_4273_sms_fx.implementor.test.ts

import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  buildMarketingBookQuote,
  publicMarketingBookQuote,
} from "../marketingBookQuote.ts";
import { allocateSmsCosts, type SmsRateV1 } from "../smsPriceBook.ts";
import { dbSmsFxConverter, type SmsFxConverter } from "../marketingSmsFx.ts";
import { marketingBookQuoteErrorCode } from "../../marketing-send/index.ts";

const NOW = new Date("2026-11-05T12:00:00.000Z");
const RATES: SmsRateV1[] = [
  {
    rateId: "termii-ng",
    provider: "termii",
    country: "NG",
    currency: "NGN",
    unit: "sms_segment",
    minorNumerator: 793,
    minorDenominator: 3,
    effectiveAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2099-01-01T00:00:00.000Z",
    sourceReference: "termii-card",
  },
  {
    rateId: "twilio-us",
    provider: "twilio",
    country: "US",
    currency: "USD",
    unit: "sms_segment",
    minorNumerator: 79,
    minorDenominator: 10,
    effectiveAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2099-01-01T00:00:00.000Z",
    sourceReference: "twilio-card",
  },
];

function person(id: string, phone: string) {
  return {
    personKey: id,
    brandPersonId: `p-${id}`,
    contactMethodId: `m-${id}`,
    normalizedContact: phone,
    allowed: true,
    safeReasonCode: "allowed",
  };
}

function sms(phones: string[]) {
  return {
    brandId: "brand",
    channel: "sms" as const,
    selectedCount: phones.length,
    content: { kind: "sms", body: "Doors at 9" },
    candidates: phones.map((phone, index) => person(`x${index}`, phone)),
  };
}

const MIXED = sms([
  "+2348012345678",
  "+2348098765432",
  "+14155550100",
  "+14155550101",
]);

/** USD → NGN at 1583.3, rounded half (what fx_convert_minor does). */
function fakeFx(
  snapshotId = "snap-1",
  calls: Array<Record<string, unknown>> = [],
): SmsFxConverter {
  return {
    convert({ subtotals, targetCurrency, at }) {
      calls.push({ subtotals, targetCurrency, at: at.toISOString() });
      return Promise.resolve({
        snapshotId,
        provider: "exchange_rate_api_open_v6" as const,
        converted: subtotals.map((row) => ({
          currency: row.currency,
          providerCostMinor: row.estimatedCostMinor,
          convertedCostMinor: row.currency === targetCurrency
            ? row.estimatedCostMinor
            : Math.round(row.estimatedCostMinor * 1583.3),
        })),
      });
    },
  };
}

const OPTIONS = { smsRates: RATES, trackingOrigin: "https://x.test/m" };

Deno.test("#4273 T-1 a mixed NGN + USD SMS quote converts to the brand currency and seals the snapshot", async () => {
  const quote = await buildMarketingBookQuote(MIXED as never, NOW, {
    ...OPTIONS,
    costCurrency: "NGN",
    fx: fakeFx(),
  });
  // NGN: 2 × 793/3 = 528.67 → 529. USD: 2 × 7.9 = 15.8 → 16 → ×1583.3 = 25333.
  assertEquals(quote.currency, "NGN");
  assertEquals(quote.estimatedCostMinor, 529 + 25333);
  assertEquals(quote.costBreakdown, [
    { currency: "NGN", providerCostMinor: 529, convertedCostMinor: 529 },
    { currency: "USD", providerCostMinor: 16, convertedCostMinor: 25333 },
  ]);
  assertEquals(quote.fxSnapshotId, "snap-1");
  assert(
    quote.sourceReferences.includes("fx:exchange_rate_api_open_v6:snap-1"),
  );
  assertEquals(quote.rateIds, ["termii-ng", "twilio-us"]);
  // Per-person shares are in NGN and sum exactly to the total.
  const shares = quote.candidates.map((c) => c.allocatedCostMinor ?? 0);
  assertEquals(shares.reduce((a, b) => a + b, 0), quote.estimatedCostMinor);
  assertEquals(
    quote.candidates.map((c) => [c.brandPersonId, c.allocatedCostMinor]),
    [["p-x0", 265], ["p-x1", 264], ["p-x2", 12667], ["p-x3", 12666]],
  );
  // The public quote keeps the parts but never the snapshot id or references.
  const safe = publicMarketingBookQuote(quote) as Record<string, unknown>;
  assertEquals(safe.costBreakdown, quote.costBreakdown);
  assertEquals("fxSnapshotId" in safe, false);
  assertEquals("sourceReferences" in safe, false);
});

Deno.test("#4273 T-1b the price book returns per-currency subtotals instead of refusing", () => {
  const priced = allocateSmsCosts(
    [
      { key: "a", normalizedPhone: "+2348012345678", segments: 1, target: 1 },
      { key: "b", normalizedPhone: "+14155550100", segments: 1, target: 2 },
    ],
    NOW,
    RATES,
  );
  assertEquals(priced.subtotals, [
    { currency: "NGN", estimatedCostMinor: 265 },
    { currency: "USD", estimatedCostMinor: 8 },
  ]);
  assertEquals(priced.estimatedCostMinor, null);
  assertEquals(priced.currency, null);
});

Deno.test("#4273 T-2 single-currency quotes keep origin/main's numbers and never call FX", async () => {
  const calls: Array<Record<string, unknown>> = [];
  // Goldens frozen from origin/main b78b1f08d9 for exactly these inputs.
  const ng = await buildMarketingBookQuote(
    sms(["+2348012345678", "+2348098765432", "+2348033334444"]) as never,
    NOW,
    { ...OPTIONS, costCurrency: "USD", fx: fakeFx("snap-1", calls) },
  );
  assertEquals(ng.estimatedCostMinor, 793);
  assertEquals(ng.currency, "NGN");
  assertEquals(
    ng.candidates.map((c) => [c.brandPersonId, c.allocatedCostMinor]),
    [["p-x0", 265], ["p-x1", 264], ["p-x2", 264]],
  );
  assertEquals(ng.costBreakdown, [
    { currency: "NGN", providerCostMinor: 793, convertedCostMinor: 793 },
  ]);
  assertEquals(ng.fxSnapshotId, null);
  const us = await buildMarketingBookQuote(
    sms(["+14155550100", "+14155550101", "+14155550102"]) as never,
    NOW,
    { ...OPTIONS, costCurrency: "NGN", fx: fakeFx("snap-1", calls) },
  );
  assertEquals(us.estimatedCostMinor, 24);
  assertEquals(us.currency, "USD");
  assertEquals(
    us.candidates.map((c) => c.allocatedCostMinor),
    [8, 8, 8],
  );
  assertEquals(calls.length, 0);
  assert(!us.sourceReferences.some((ref) => ref.startsWith("fx:")));
});

Deno.test("#4273 T-3 a mixed quote with no converter or no brand currency cannot be priced", async () => {
  for (
    const options of [
      { ...OPTIONS, costCurrency: "NGN" },
      { ...OPTIONS, costCurrency: null, fx: fakeFx() },
      { ...OPTIONS, costCurrency: "naira", fx: fakeFx() },
    ]
  ) {
    const error = await assertRejects(
      () => buildMarketingBookQuote(MIXED as never, NOW, options),
      Error,
      "cost_unavailable:fx_unavailable",
    );
    assertEquals(
      marketingBookQuoteErrorCode(error),
      "BOOK_BLAST_COST_UNAVAILABLE",
    );
  }
});

Deno.test("#4273 T-4 a converter failure is COST_UNAVAILABLE, never stale", async () => {
  const failing: SmsFxConverter = {
    convert: () => Promise.reject(new Error("cost_unavailable:fx_unavailable")),
  };
  const error = await assertRejects(() =>
    buildMarketingBookQuote(MIXED as never, NOW, {
      ...OPTIONS,
      costCurrency: "NGN",
      fx: failing,
    })
  );
  assertEquals(marketingBookQuoteErrorCode(error), "BOOK_BLAST_COST_UNAVAILABLE");
  // A converter that answers with a part missing is refused too.
  const short: SmsFxConverter = {
    convert: (input) =>
      fakeFx().convert(input).then((out) => ({
        ...out,
        converted: out.converted.slice(0, 1),
      })),
  };
  await assertRejects(
    () =>
      buildMarketingBookQuote(MIXED as never, NOW, {
        ...OPTIONS,
        costCurrency: "NGN",
        fx: short,
      }),
    Error,
    "fx_unavailable",
  );
});

Deno.test("#4273 T-5 preview and confirm at the same quotedAt seal the same hash", async () => {
  // As-of lookup keyed by `at`: a newer snapshot after quotedAt changes nothing.
  const snapshots = [
    { id: "snap-day1", fetchedAt: "2026-11-05T01:15:00.000Z" },
  ];
  const asOf: SmsFxConverter = {
    convert(input) {
      const id = snapshots
        .filter((s) => Date.parse(s.fetchedAt) <= input.at.getTime())
        .sort((a, b) => b.fetchedAt.localeCompare(a.fetchedAt))[0].id;
      return fakeFx(id).convert(input);
    },
  };
  const preview = await buildMarketingBookQuote(
    MIXED as never,
    new Date("2026-11-05T12:00:00.400Z"),
    { ...OPTIONS, costCurrency: "NGN", fx: asOf },
  );
  snapshots.push({ id: "snap-day1-late", fetchedAt: "2026-11-05T12:01:00.000Z" });
  const confirm = await buildMarketingBookQuote(
    MIXED as never,
    new Date(preview.quotedAt),
    { ...OPTIONS, costCurrency: "NGN", fx: asOf },
  );
  assertEquals(confirm.quoteHash, preview.quoteHash);
  assertEquals(confirm.fxSnapshotId, "snap-day1");
  // A different snapshot or brand currency is a different sealed quote.
  const otherSnapshot = await buildMarketingBookQuote(
    MIXED as never,
    new Date(preview.quotedAt),
    { ...OPTIONS, costCurrency: "NGN", fx: fakeFx("snap-other") },
  );
  assert(otherSnapshot.quoteHash !== preview.quoteHash);
});

function stubDb(options: {
  snapshots: Array<
    { id: string; status: string; fetched_at: string; expires_at: string }
  >;
  rpcs: Array<Record<string, unknown>>;
  convert: (args: Record<string, unknown>) => unknown;
}) {
  return {
    from: (table: string) => {
      assertEquals(table, "fx_rate_snapshots");
      const filters: Array<(row: Record<string, string>) => boolean> = [];
      const chain = {
        select: () => chain,
        in: (column: string, values: string[]) => {
          filters.push((row) => values.includes(row[column]));
          return chain;
        },
        lte: (column: string, value: string) => {
          filters.push((row) => row[column] <= value);
          return chain;
        },
        gte: (column: string, value: string) => {
          filters.push((row) => row[column] >= value);
          return chain;
        },
        order: () => chain,
        limit: () => chain,
        maybeSingle: () => {
          const rows = options.snapshots
            .filter((row) => filters.every((f) => f(row)))
            .sort((a, b) => b.fetched_at.localeCompare(a.fetched_at));
          return Promise.resolve({
            data: rows[0] === undefined ? null : { id: rows[0].id },
            error: null,
          });
        },
      };
      return chain;
    },
    rpc: (name: string, args: Record<string, unknown>) => {
      assertEquals(name, "fx_convert_minor");
      options.rpcs.push(args);
      return Promise.resolve({ data: options.convert(args), error: null });
    },
  };
}

Deno.test("#4273 T-6 the DB converter picks the snapshot as of quotedAt, not the latest", async () => {
  const rpcs: Array<Record<string, unknown>> = [];
  const db = stubDb({
    snapshots: [
      {
        id: "day1",
        status: "superseded",
        fetched_at: "2026-11-04T01:15:00.000Z",
        expires_at: "2026-11-11T00:00:00.000Z",
      },
      {
        id: "day2",
        status: "active",
        fetched_at: "2026-11-05T01:15:00.000Z",
        expires_at: "2026-11-12T00:00:00.000Z",
      },
      {
        id: "rejected",
        status: "rejected",
        fetched_at: "2026-11-05T01:10:00.000Z",
        expires_at: "2026-11-12T00:00:00.000Z",
      },
    ],
    rpcs,
    convert: (args) => (args.p_amount === 1 ? 0 : 1600),
  });
  const out = await dbSmsFxConverter(db).convert({
    subtotals: [
      { currency: "USD", estimatedCostMinor: 1 },
      { currency: "NGN", estimatedCostMinor: 529 },
    ],
    targetCurrency: "NGN",
    at: new Date("2026-11-05T01:14:59.000Z"),
  });
  assertEquals(out.snapshotId, "day1");
  // Same-currency part makes no call; the other part names the day-1 snapshot.
  assertEquals(rpcs, [{
    p_amount: 1,
    p_source: "USD",
    p_target: "NGN",
    p_snapshot: "day1",
  }]);
  // A non-zero cost never converts to zero; parts come back sorted.
  assertEquals(out.converted, [
    { currency: "NGN", providerCostMinor: 529, convertedCostMinor: 529 },
    { currency: "USD", providerCostMinor: 1, convertedCostMinor: 1 },
  ]);
});

Deno.test("#4273 T-6b no snapshot as of quotedAt, or a failed conversion, is fx_unavailable", async () => {
  const none = stubDb({ snapshots: [], rpcs: [], convert: () => 1 });
  await assertRejects(
    () =>
      dbSmsFxConverter(none).convert({
        subtotals: [{ currency: "USD", estimatedCostMinor: 5 }],
        targetCurrency: "NGN",
        at: NOW,
      }),
    Error,
    "cost_unavailable:fx_unavailable",
  );
  const broken = stubDb({
    snapshots: [{
      id: "s",
      status: "active",
      fetched_at: "2026-11-05T01:15:00.000Z",
      expires_at: "2026-11-12T00:00:00.000Z",
    }],
    rpcs: [],
    convert: () => null,
  });
  await assertRejects(
    () =>
      dbSmsFxConverter(broken).convert({
        subtotals: [{ currency: "USD", estimatedCostMinor: 5 }],
        targetCurrency: "NGN",
        at: NOW,
      }),
    Error,
    "cost_unavailable:fx_unavailable",
  );
});
