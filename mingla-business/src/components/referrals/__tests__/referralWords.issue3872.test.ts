import {
  memberStatusWords,
  offerPill,
  offerSummary,
  rankLeaderboard,
  slugIsValid,
} from "../referralWords";
import type {
  ReferralMember,
  ReferralOffer,
} from "../../../services/referralService";

// #3872 walkthrough: offers showed raw status keys ("active"), promoters
// showed "invited · active", and the slug field autocorrected "qa-bio".
const offer = (patch: Partial<ReferralOffer>): ReferralOffer => ({
  id: "o",
  brandId: "b",
  name: "Promoter team",
  audience: "invited",
  scopeKind: "brand",
  rewardKind: "cash",
  shareBps: 1000,
  voucherTemplate: null,
  perkText: null,
  perkThreshold: null,
  buyerDiscountId: null,
  budgetMinor: null,
  currency: "USD",
  startsAt: "2026-10-01",
  endsAt: null,
  status: "active",
  pausedReason: null,
  version: 1,
  listings: [],
  tiers: [],
  memberCount: 3,
  salesCount: 0,
  shareMinor: 0,
  ...patch,
});

describe("referral words", () => {
  it("shows Live / Paused / Ended pills", () => {
    expect(offerPill(offer({})).label).toBe("Live");
    expect(offerPill(offer({ status: "paused" })).label).toBe("Paused");
    expect(offerPill(offer({ status: "ended" })).label).toBe("Ended");
  });
  it("summarises offers in words", () => {
    expect(offerSummary(offer({}), "USD")).toBe(
      "Promoter team · 10% cash · 3 promoters",
    );
    expect(
      offerSummary(offer({ audience: "buyers", rewardKind: "voucher" }), "USD"),
    ).toBe("Every buyer earns · 10% back as a voucher · whole brand");
    expect(
      offerSummary(offer({ status: "ended", endsAt: "2026-09-30" }), "USD"),
    ).toMatch(/^Ended Sep 30/);
  });
  it("words member statuses and ranks the leaderboard", () => {
    expect(memberStatusWords("active")).toBe("Earning");
    const m = (id: string, sales: number, status = "active") =>
      ({
        id,
        displayName: id,
        salesCount: sales,
        revenueMinor: 0,
        status,
      }) as ReferralMember;
    expect(
      rankLeaderboard([m("a", 1), m("b", 9), m("c", 20, "removed")]).map(
        (x) => x.id,
      ),
    ).toEqual(["b", "a"]);
  });
  it("validates link endings", () => {
    expect(slugIsValid("qa-bio")).toBe(true);
    expect(slugIsValid("qa")).toBe(false);
    expect(slugIsValid("QA-BIO")).toBe(false);
  });
});
