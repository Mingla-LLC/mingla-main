/**
 * #3645 flat 4.5% — application fee = take-rate + service; host net ignores
 * provider processing (Mingla pays card fees out of the 4.5% cut).
 */
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildPricingBreakdown,
  MINGLA_SERVICE_FEE_BPS,
  type ComputeAllInInput,
} from "../allInPricingEngine.ts";
import {
  computePendingItems,
  type MoneyCandidate,
} from "../../payout-release-sweep/engine.ts";

Deno.test("#3645 buildPricingBreakdown: application fee = take-rate + service (flat 4.5%)", () => {
  const input: ComputeAllInInput = {
    baseCents: 10_000,
    switches: {
      pass_tax: false,
      pass_mingla_fee: true,
      pass_service_fee: true,
    },
    region: "US",
    currency: "usd",
    // 150 bps take-rate + 300 bps service = 450 bps = 4.5%
    effectiveTakeRateBps: 150,
    takeRateSource: "platform_default",
    serviceFeeBps: MINGLA_SERVICE_FEE_BPS,
  };
  const breakdown = buildPricingBreakdown({
    input,
    amountTotalCents: 10_450, // base + passed fees
    taxCents: 0,
    taxBasis: "unresolved_flat_absorb",
    stripeTaxCalculationId: null,
  });
  assertEquals(breakdown.components.mingla_fee_cents, 150);
  assertEquals(breakdown.components.service_fee_cents, 300);
  assertEquals(breakdown.application_fee_amount_cents, 450);
});

Deno.test("#3645 computePendingItems: host net ignores providerFeeCents", () => {
  const candidate: MoneyCandidate = {
    sourceType: "order",
    sourceId: "o-3645-flat",
    brandId: "b1",
    eventId: "e1",
    eventDateId: "d1",
    provider: "stripe",
    currency: "usd",
    finalizedAt: "2026-10-01T00:00:00.000Z",
    cutoverAt: "2026-09-01T00:00:00.000Z",
    eventStatus: "live",
    occurrences: [{ id: "d1", endAt: "2026-12-01T00:00:00.000Z" }],
    grossCents: 10_450,
    refundedCents: 0,
    disputedCents: 0,
    minglaFeeCents: 450,
    partnerShareCents: 45,
    providerFeeCents: 333, // snapshotted; must NOT reduce host net
  };
  const rows = computePendingItems(
    [candidate],
    "2026-10-03T00:00:00.000Z",
  );
  assertEquals(rows.length, 1);
  assertEquals(rows[0].netCents, 10_450 - 450);
  assertEquals(rows[0].providerFeeCents, 333);
});

Deno.test("#3645 venue-order-create/staff set application_fee from mingla + service", async () => {
  const createSrc = await Deno.readTextFile(
    new URL("../../venue-order-create/index.ts", import.meta.url),
  );
  const staffSrc = await Deno.readTextFile(
    new URL("../../venue-order-staff/index.ts", import.meta.url),
  );
  for (const [label, src] of [["create", createSrc], ["staff", staffSrc]] as const) {
    assert(
      src.includes("money.minglaFeeCents + money.platformServiceFeeCents"),
      `venue-order-${label} must sum mingla + platform service for application_fee`,
    );
    assert(
      /application_fee_amount\s*[:=]/.test(src) ||
        src.includes("piBody.application_fee_amount"),
      `venue-order-${label} must assign Stripe application_fee_amount`,
    );
  }
});
