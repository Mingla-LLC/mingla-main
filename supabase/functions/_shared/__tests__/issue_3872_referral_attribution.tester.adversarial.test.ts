import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type ReferralAttributionStore,
  type ReferralMemberCandidate,
  resolveReferrer,
} from "../attribution.ts";

const ACTIVE_MEMBER: ReferralMemberCandidate = {
  id: "member-1",
  offerId: "offer-1",
  brandId: "brand-1",
  userId: "referrer-1",
  emailNorm: "referrer@example.test",
  status: "active",
  touchId: "touch-member-1",
};

function store(
  overrides: Partial<ReferralAttributionStore> = {},
): ReferralAttributionStore {
  return {
    referralsEnabled: async () => true,
    memberByCode: async () => null,
    latestMemberTouch: async () => ACTIVE_MEMBER,
    latestTrackingTouch: async () => null,
    offerForMember: async () => ({
      id: "offer-1",
      brandId: "brand-1",
      status: "active",
      startsAt: "2026-01-01T00:00:00.000Z",
      endsAt: null,
      rewardKind: "cash",
      shareBps: 1_000,
      voucherTemplate: null,
      budgetMinor: null,
      currency: "USD",
      coversListing: true,
    }),
    tierShareBps: async () => null,
    completedSales: async () => 0,
    committedGrossMinor: async () => 0,
    payeeRails: async () => ({ stripe: true, paystack: false }),
    ...overrides,
  };
}

function input() {
  return {
    brandId: "brand-1",
    listingKind: "event" as const,
    listingId: "event-1",
    orderKind: "ticket" as const,
    buyer: {
      userId: "buyer-1",
      emailNorm: "buyer@example.test",
    },
    typedCode: null,
    visitorKey: "b".repeat(64),
    eligibleMinor: 10_000,
    brandRail: "stripe" as const,
    currency: "USD",
    nowIso: "2026-10-24T12:00:00.000Z",
  };
}

Deno.test("#3872 D8 blocks self-referral by user id and normalized email", async () => {
  const byUser = await resolveReferrer(store(), {
    ...input(),
    buyer: { userId: "referrer-1", emailNorm: "other@example.test" },
  });
  assertEquals(byUser.rejectedReason, "self_referral");
  assertEquals(byUser.shareMinor, 0);

  const byEmail = await resolveReferrer(store(), {
    ...input(),
    buyer: { userId: null, emailNorm: " Referrer@Example.Test " },
  });
  assertEquals(byEmail.rejectedReason, "self_referral");
  assertEquals(byEmail.shareMinor, 0);
});

Deno.test("#3872 removed member remains attributable only as a rejection", async () => {
  const removed = await resolveReferrer(
    store({
      latestMemberTouch: async () => ({
        ...ACTIVE_MEMBER,
        status: "removed",
      }),
    }),
    input(),
  );

  assertEquals(removed.memberId, "member-1");
  assertEquals(removed.rejectedReason, "member_removed");
  assertEquals(removed.shareMinor, 0);
});

Deno.test("#3872 explicit cross-rail payee downgrades only with voucher fallback", async () => {
  const voucher = {
    value_type: "amount",
    value_minor: 500,
    expires_days: 30,
  };
  const downgraded = await resolveReferrer(
    store({
      payeeRails: async () => ({ stripe: false, paystack: true }),
      offerForMember: async () => ({
        id: "offer-1",
        brandId: "brand-1",
        status: "active",
        startsAt: "2026-01-01T00:00:00.000Z",
        endsAt: null,
        rewardKind: "cash",
        shareBps: 1_000,
        voucherTemplate: voucher,
        budgetMinor: null,
        currency: "USD",
        coversListing: true,
      }),
    }),
    input(),
  );

  assertEquals(downgraded.rejectedReason, "cross_rail");
  assertEquals(downgraded.rewardKind, "voucher");
  assertEquals(downgraded.voucherTemplate, voucher);
  assertEquals(downgraded.shareMinor, 0);

  const rejected = await resolveReferrer(
    store({
      payeeRails: async () => ({ stripe: false, paystack: true }),
    }),
    input(),
  );
  assertEquals(rejected.rejectedReason, "cross_rail");
  assertEquals(rejected.rewardKind, null);
});

Deno.test("#3872 guest/unclaimed payee is held for claim, not treated as cross-rail", async () => {
  const resolved = await resolveReferrer(
    store({
      latestMemberTouch: async () => ({
        ...ACTIVE_MEMBER,
        userId: null,
        emailNorm: "guest-payee@example.test",
      }),
    }),
    input(),
  );

  assertEquals(resolved.rejectedReason, null);
  assertEquals(resolved.rewardKind, "cash");
  assertEquals(resolved.shareMinor, 1_000);
});

Deno.test("#3872 budget cap rejects the whole share instead of partial credit", async () => {
  const resolved = await resolveReferrer(
    store({
      offerForMember: async () => ({
        id: "offer-1",
        brandId: "brand-1",
        status: "active",
        startsAt: "2026-01-01T00:00:00.000Z",
        endsAt: null,
        rewardKind: "cash",
        shareBps: 1_000,
        voucherTemplate: null,
        budgetMinor: 1_500,
        currency: "USD",
        coversListing: true,
      }),
      committedGrossMinor: async () => 1_000,
    }),
    input(),
  );

  assertEquals(resolved.rejectedReason, "budget_reached");
  assertEquals(resolved.shareMinor, 0);
});
