/**
 * #3645 Ilashe — processing recovery surplus to Mingla; organiser absorbs deficit.
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { allocateProcessingRecovery } from "../allInPricingEngine.ts";
import { computePendingItems, type MoneyCandidate } from "../../payout-release-sweep/engine.ts";

Deno.test("#3645 local NGN example: pool 2100, fee 1197 → surplus 903 to Mingla", () => {
  const out = allocateProcessingRecovery({
    processingRecoveryPoolCents: 2100,
    actualProviderFeeCents: 1197,
  });
  assertEquals(out.recoverySurplusCents, 903);
  assertEquals(out.processingDeficitCents, 0);
});

Deno.test("#3645 international deficit: pool 2100, fee 2953 → organiser deficit 853", () => {
  const out = allocateProcessingRecovery({
    processingRecoveryPoolCents: 2100,
    actualProviderFeeCents: 2953,
  });
  assertEquals(out.recoverySurplusCents, 0);
  assertEquals(out.processingDeficitCents, 853);
});

Deno.test("#3645 payout net withholds surplus from organiser", () => {
  const candidate: MoneyCandidate = {
    sourceType: "order",
    sourceId: "o1",
    brandId: "b1",
    eventId: "e1",
    eventDateId: "d1",
    provider: "paystack",
    currency: "ngn",
    finalizedAt: "2026-10-01T00:00:00.000Z",
    cutoverAt: "2026-09-01T00:00:00.000Z",
    eventStatus: "live",
    occurrences: [{ id: "d1", endAt: "2026-12-01T00:00:00.000Z" }],
    grossCents: 73_150,
    refundedCents: 0,
    disputedCents: 0,
    minglaFeeCents: 1_050,
    partnerShareCents: 0,
    providerFeeCents: 1_197,
    processingRecoveryPoolCents: 2_100,
  };
  const rows = computePendingItems(
    [candidate],
    "2026-10-03T00:00:00.000Z",
  );
  assertEquals(rows.length, 1);
  // base 70000 = 73150 - 1050 - 1197 - 903
  assertEquals(rows[0].netCents, 70_000);
});

Deno.test("#3645 legacy pool 0 leaves net unchanged vs pre-surplus formula", () => {
  const candidate: MoneyCandidate = {
    sourceType: "order",
    sourceId: "o2",
    brandId: "b1",
    eventId: "e1",
    eventDateId: "d1",
    provider: "stripe",
    currency: "gbp",
    finalizedAt: "2026-10-01T00:00:00.000Z",
    cutoverAt: "2026-09-01T00:00:00.000Z",
    eventStatus: "live",
    occurrences: [{ id: "d1", endAt: "2026-12-01T00:00:00.000Z" }],
    grossCents: 20_000,
    refundedCents: 0,
    disputedCents: 0,
    minglaFeeCents: 300,
    partnerShareCents: 0,
    providerFeeCents: 610,
  };
  const rows = computePendingItems(
    [candidate],
    "2026-10-03T00:00:00.000Z",
  );
  assertEquals(rows[0].netCents, 20_000 - 300 - 610);
});
