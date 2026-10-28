/**
 * #3872 Promote polish — "Whole brand" replaces "All listings" everywhere,
 * and the Overview words no longer say "listing" where a host means an event
 * or venue (NAMING.md, approved 2026-10-27).
 *
 * FAILS ON REVERT: put back "All listings" / "all listings" / "Every listing"
 * in any shipped Business file, "Boost this listing with ads", or the old
 * section labels, and this suite goes red.
 */
import fs from "node:fs";
import path from "node:path";

import {
  WHOLE_BRAND_LABEL,
  mapPromotionOverview,
  promotionFallbackNotice,
  promotionListingSubtitle,
  promotionRowWords,
  promotionSectionLabel,
  promotionStrip,
  promotionStripAllZero,
} from "../../../services/promotionOverview";
import { offerRowSummary, offerSummary } from "../../referrals/referralWords";

const root = path.resolve(__dirname, "../../../..");

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "__tests__" || entry.name === "node_modules" ? [] : sourceFiles(full);
    }
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

describe("the brand-wide scope is called Whole brand", () => {
  it("no shipped Business file says All listings / Every listing", () => {
    const offenders = [...sourceFiles(path.join(root, "src")), ...sourceFiles(path.join(root, "app"))]
      .filter((file) => /All listings|all listings|Every listing/.test(fs.readFileSync(file, "utf8")))
      .map((file) => path.relative(root, file));
    expect(offenders).toEqual([]);
  });

  it("the Overview, picker and Referrals use it", () => {
    expect(WHOLE_BRAND_LABEL).toBe("Whole brand");
    const overview = fs.readFileSync(
      path.join(root, "src/components/marketing/BlastPromotionOverview.tsx"),
      "utf8",
    );
    expect(overview).toContain("title={WHOLE_BRAND_LABEL}");
    expect(overview).toContain("See whole brand");
    expect(overview).not.toContain("Pull down to try again");
    const sheet = fs.readFileSync(
      path.join(root, "src/components/referrals/ReferralOfferSheet.tsx"),
      "utf8",
    );
    expect(sheet).toContain('title: "Whole brand"');
    expect(sheet).toContain('copy: "Works on everything this brand sells."');
  });

  it("referral summaries name the scope Whole brand", () => {
    const offer = {
      status: "active" as const,
      audience: "buyers" as const,
      scopeKind: "brand" as const,
      listings: [],
      memberCount: 0,
      endsAt: null,
      rewardKind: "cash" as const,
      shareBps: 1000,
      perkText: null,
      voucherTemplate: null,
      currency: "NGN",
    };
    expect(offerRowSummary(offer)).toBe("Every buyer · whole brand");
    expect(offerSummary(offer, "NGN")).toBe("Every buyer earns · 10% cash · whole brand");
    // The singular count form stays.
    expect(
      offerRowSummary({
        ...offer,
        scopeKind: "listings" as const,
        listings: [{ kind: "event", id: "e1", title: "A" }] as never,
      }),
    ).toBe("Every buyer · 1 listing");
  });
});

const base = {
  ok: true,
  listings: [],
  listing: null,
  currency: "NGN",
  sold_minor: 0,
  clicks: 0,
  spent_minor: 0,
  campaigns: null,
  ads: null,
  creators: {},
  referrals: {},
};

describe("Overview words", () => {
  it("section label is kind-aware", () => {
    expect(promotionSectionLabel(null)).toBe("Promotion across the brand");
    expect(promotionSectionLabel({ kind: "event" })).toBe("Promotion for this event");
    expect(promotionSectionLabel({ kind: "venue" })).toBe("Promotion for this venue");
  });

  it("the Ads invite never says 'this listing'", () => {
    expect(promotionRowWords(mapPromotionOverview(base)).ads).toBe(
      "Boost what you're selling with ads",
    );
    expect(
      promotionRowWords(
        mapPromotionOverview({ ...base, listing: { kind: "venue", id: "v1", title: "Sky" } }),
      ).ads,
    ).toBe("Boost this venue with ads");
    expect(
      promotionRowWords(
        mapPromotionOverview({ ...base, listing: { kind: "event", id: "e1", title: "Brunch" } }),
      ).ads,
    ).toBe("Boost this event with ads");
  });

  it("sheet subtitles carry the date; the notice names the kind", () => {
    expect(
      promotionListingSubtitle({ kind: "event", id: "e", title: "Brunch", startsAt: "2026-11-09T14:00:00Z" }),
    ).toBe("Event · Nov 9");
    expect(promotionListingSubtitle({ kind: "venue", id: "v", title: "Sky", startsAt: null })).toBe("Venue");
    expect(promotionFallbackNotice("event")).toBe(
      "That event isn't published any more, so you're seeing the whole brand.",
    );
    expect(promotionFallbackNotice(null)).toBe(
      "That listing isn't published any more, so you're seeing the whole brand.",
    );
  });

  it("zero values read quiet and the all-zero strip is detected", () => {
    const zero = mapPromotionOverview(base);
    expect(promotionStripAllZero(zero)).toBe(true);
    expect(promotionStrip(zero).every((cell) => cell.tone === "muted")).toBe(true);
    const live = mapPromotionOverview({ ...base, clicks: 5 });
    expect(promotionStripAllZero(live)).toBe(false);
    expect(promotionStrip(live)[1]).toEqual({ value: "5", label: "Link clicks" });
  });
});
