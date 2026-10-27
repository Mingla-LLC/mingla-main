import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  applicationFeeWithReferralShare,
  type ReferralAttributionStore,
  type ReferralMemberCandidate,
  resolveReferrer,
  roundHalfUpBasisPoints,
} from "../attribution.ts";

const MEMBER: ReferralMemberCandidate = {
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
    latestMemberTouch: async () => MEMBER,
    latestTrackingTouch: async () => ({
      trackingId: "tracking-1",
      touchId: "touch-tracking-1",
    }),
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
    visitorKey: "a".repeat(64),
    eligibleMinor: 1_255,
    brandRail: "stripe" as const,
    currency: "usd",
    nowIso: "2026-10-24T12:00:00.000Z",
  };
}

Deno.test("#3872 D8 resolves the latest member touch and independent tracking", async () => {
  const resolved = await resolveReferrer(
    store({
      completedSales: async () => 4,
      tierShareBps: async (_offerId, completedSales) =>
        completedSales === 4 ? 1_500 : null,
    }),
    input(),
  );

  assertEquals(resolved, {
    version: 1,
    source: "member_link",
    touchId: "touch-member-1",
    memberId: "member-1",
    trackingId: "tracking-1",
    offerId: "offer-1",
    rejectedReason: null,
    eligibleMinor: 1_255,
    shareBps: 1_500,
    shareMinor: 188,
    rewardKind: "cash",
    voucherTemplate: null,
    payeeUserId: "referrer-1",
    payeeEmailNorm: "referrer@example.test",
    rail: "stripe",
    currency: "USD",
    listingKind: "event",
    listingId: "event-1",
    orderKind: "ticket",
  });
});

Deno.test("#3872 a typed code beats the latest member link", async () => {
  const codeMember = { ...MEMBER, id: "member-code", touchId: null };
  let linkLookupCount = 0;
  const resolved = await resolveReferrer(
    store({
      memberByCode: async () => codeMember,
      latestMemberTouch: async () => {
        linkLookupCount += 1;
        return MEMBER;
      },
    }),
    { ...input(), typedCode: " member1 " },
  );

  assertEquals(resolved.source, "code");
  assertEquals(resolved.memberId, "member-code");
  assertEquals(resolved.touchId, null);
  assertEquals(linkLookupCount, 0);
});

Deno.test("#3872 application fee adds the gross share without changing buyer money", async () => {
  const buyerTotal = 15_500;
  const resolved = await resolveReferrer(store(), input());
  assertEquals(resolved.shareMinor, 126);
  assertEquals(applicationFeeWithReferralShare(775, resolved), 901);
  assertEquals(buyerTotal, 15_500);
  assertEquals(roundHalfUpBasisPoints(1_255, 1_000), 126);
});

Deno.test("#3872 flag off leaves both member and tracking attribution inert", async () => {
  const resolved = await resolveReferrer(
    store({
      referralsEnabled: async () => false,
      latestMemberTouch: async () => {
        throw new Error("touch lookup must not run");
      },
    }),
    input(),
  );

  assertEquals(resolved.source, "none");
  assertEquals(resolved.shareMinor, 0);
  assertEquals(resolved.trackingId, null);
});

Deno.test("#3872 resolver rejects invalid money before reading attribution", async () => {
  await assertRejects(
    () => resolveReferrer(store(), { ...input(), eligibleMinor: 1.5 }),
    Error,
    "referral_eligible_minor_invalid",
  );
});
