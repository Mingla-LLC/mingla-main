import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "@jest/globals";

const mockInvoke = jest.fn();
jest.mock("../../src/services/supabase", () => ({
  supabase: { functions: { invoke: mockInvoke } },
}));

import { writeReferralOffer } from "../../src/services/referralService";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { renderContentShareHtml } = require("../socialPreview") as {
  renderContentShareHtml: (
    share: Record<string, unknown>,
    install: unknown,
    sharedBy: { firstName: string; avatarUrl: string | null } | null,
    friendDiscount: boolean,
  ) => string;
};

const repoRoot = path.resolve(__dirname, "../../..");

describe("#3872 B5 buyer referral web", () => {
  it("renders only the safe shared-by presentation and friend-discount copy", () => {
    const html = renderContentShareHtml({
      shortCode: "Aa0Bb1Cc2Dd3Ee4F",
      version: 1,
      facts: { schemaVersion: 1, kind: "event", title: "Night market" },
      media: null,
      publicDetails: { actionEligible: true },
      destination: {
        kind: "event",
        brandSlug: "lantern-room",
        eventSlug: "night-market",
        webPath: "/e/lantern-room/night-market",
      },
    }, null, { firstName: "<Ada>", avatarUrl: null }, true);
    expect(html).toContain("&lt;Ada&gt; shared this with you");
    expect(html).toContain("A friend discount is available");
    expect(html).toContain("shared_by_card_viewed");
    expect(html).not.toContain("email");
  });

  it("records the shared-by view only when the card is rendered", () => {
    const share = {
      shortCode: "Aa0Bb1Cc2Dd3Ee4F",
      version: 1,
      facts: { schemaVersion: 1, kind: "event", title: "Night market" },
      media: null,
      publicDetails: { actionEligible: true },
      destination: { kind: "event", brandSlug: "lantern-room", eventSlug: "night-market" },
    };
    expect(renderContentShareHtml(share)).not.toContain("shared_by_card_viewed");
    expect(renderContentShareHtml(share, null, { firstName: "Ada", avatarUrl: null }, false))
      .toContain("record('shared_by_card_viewed')");
  });

  it("threads only a valid opaque referral visitor cookie into checkout", () => {
    const attribution = readFileSync(
      path.join(repoRoot, "mingla-business/src/services/referralAttribution.ts"),
      "utf8",
    );
    const tickets = readFileSync(
      path.join(repoRoot, "mingla-business/src/services/ticketCheckoutService.ts"),
      "utf8",
    );
    const venues = readFileSync(
      path.join(repoRoot, "mingla-business/src/services/venueOrderingService.ts"),
      "utf8",
    );
    expect(attribution).toContain('const REFERRAL_VISITOR_KEY = /^[0-9a-f]{64}$/');
    expect(tickets).toContain("getStoredReferralVisitorKey()");
    expect(venues).toContain("getStoredReferralVisitorKey()");
    expect(tickets).toContain("{ visitorKey: referralVisitorKey }");
    expect(venues).toContain("{ visitorKey: referralVisitorKey }");
    expect(`${tickets}\n${venues}`).not.toMatch(/visitorKey:\s*(?:email|phone|userId)/);
  });

  it("keeps the usemingla.com personal landing private, noindex and non-transactional", () => {
    const route = readFileSync(
      path.join(repoRoot, "mingla-marketing/app/r/[slug]/route.ts"),
      "utf8",
    );
    expect(route).toContain("public_referral_landing");
    expect(route).toContain("referral-touch");
    expect(route).toContain("mingla_referral_visitor");
    expect(route).toContain("noindex,nofollow");
    expect(route).toContain("Opening this link does not charge you");
    expect(route).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
  });

  it("keeps the two help registries byte-identical", () => {
    expect(readFileSync(path.join(repoRoot, "packages/help-content/index.ts"), "utf8"))
      .toBe(readFileSync(path.join(repoRoot, "mingla-marketing/content/help/registry.ts"), "utf8"));
  });

  it("sends a buyer offer through the reviewed referral boundary", async () => {
    mockInvoke.mockResolvedValueOnce({
      data: {
        offer: {
          id: "offer-1",
          brand_id: "brand-1",
          name: "Friends save",
          audience: "buyers",
          scope_kind: "brand",
          reward_kind: "cash",
          share_bps: 500,
          currency: "USD",
          starts_at: "2026-10-26T00:00:00.000Z",
          status: "active",
          version: 1,
        },
      },
      error: null,
    });
    const offer = await writeReferralOffer("create", {
      brandId: "brand-1",
      name: "Friends save",
      audience: "buyers",
      scopeKind: "brand",
      rewardKind: "cash",
      shareBps: 500,
      currency: "USD",
      startsAt: "2026-10-26T00:00:00.000Z",
      status: "active",
      listings: [],
      tiers: [],
    });
    expect(offer.brandId).toBe("brand-1");
    expect(offer.shareBps).toBe(500);
    expect(mockInvoke).toHaveBeenCalledWith("referral-offer-upsert", {
      body: expect.objectContaining({ action: "create" }),
    });
  });
});
