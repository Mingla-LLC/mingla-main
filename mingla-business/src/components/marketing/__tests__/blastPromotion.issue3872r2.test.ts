import fs from "node:fs";
import path from "node:path";

import {
  MARKETING_SUB_NAV_TABS,
  blastHubHref,
  detectMarketingSubNavActive,
} from "../marketingSubNavTabs";
import {
  blastOverviewHref,
  mapPromotionOverview,
  promoteTileStatus,
  promotionOverviewError,
  promotionRowWords,
  promotionStrip,
} from "../../../services/promotionOverview";

// #3872 round 2: promotion moved into the Blast tab. The sub-nav cut labels
// off ("Campai…"), there was no Creators or Referrals tab, Overview only
// covered email, and /brand/[id]/promote was a separate screen.
const root = path.resolve(__dirname, "../../../..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

describe("Blast sub-nav", () => {
  it("lists every section in the approved order", () => {
    expect(MARKETING_SUB_NAV_TABS.map((tab) => tab.label)).toEqual([
      "Overview",
      "Campaigns",
      "Ads",
      "Creators",
      "Referrals",
      "People",
      "Templates",
    ]);
    for (const tab of MARKETING_SUB_NAV_TABS) {
      expect(fs.existsSync(path.join(root, "app", `${tab.path}${tab.id === "overview" ? "" : ""}`.replace("/(tabs)", "(tabs)") + "/index.tsx"))).toBe(true);
    }
  });

  it("marks the right tab active, including deep pages", () => {
    expect(detectMarketingSubNavActive("/marketing/creators")).toBe("creators");
    expect(detectMarketingSubNavActive("/marketing/referrals")).toBe("referrals");
    expect(detectMarketingSubNavActive("/marketing/ads/abc")).toBe("ads");
    expect(detectMarketingSubNavActive("/marketing")).toBe("overview");
  });

  it("scrolls sideways and never truncates a label", () => {
    const nav = read("src/components/marketing/MarketingSubNav.tsx");
    expect(nav).toMatch(/<ScrollView[\s\S]{0,80}horizontal/);
    expect(nav).not.toContain("numberOfLines");
    expect(nav).not.toMatch(/pill:\s*\{\s*flex:\s*1/);
  });
});

describe("old hub routes land in Blast", () => {
  it("Creators and Referrals keep their links (and the Referrals tab)", () => {
    expect(blastHubHref("creators")).toBe("/(tabs)/marketing/creators");
    expect(blastHubHref("referrals", "links")).toBe(
      "/(tabs)/marketing/referrals?tab=links",
    );
    expect(blastHubHref("referrals", "nope")).toBe("/(tabs)/marketing/referrals");
    // The old routes are thin lazy routes; their bodies (all BlastRedirect)
    // live behind the program's one lazy owner.
    for (const [file, screen] of [
      ["app/brand/[id]/creators/index.tsx", "BrandCreatorsRedirect"],
      ["app/brand/[id]/referrals.tsx", "BrandReferralsRedirect"],
      ["app/brand/[id]/promote.tsx", "PromoteRedirect"],
    ]) {
      expect(read(file)).toContain(`mod.${screen}`);
    }
    const bodies = read("src/components/creators/screens/BlastRedirectScreens.tsx");
    expect(bodies.match(/<BlastRedirect\b/g)).toHaveLength(3);
    expect(read("src/components/marketing/BlastRedirect.tsx")).toMatch(
      /setCurrentBrandId\(brandId\)[\s\S]*router\.replace/,
    );
  });

  it("/promote redirects to Overview with the listing picked", () => {
    expect(blastOverviewHref({ kind: "event", id: "e-1" })).toBe(
      "/(tabs)/marketing?listingKind=event&listingId=e-1",
    );
    expect(blastOverviewHref({ kind: "venue", id: "v 1" })).toBe(
      "/(tabs)/marketing?listingKind=venue&listingId=v%201",
    );
    expect(blastOverviewHref({ kind: undefined, id: undefined })).toBe(
      "/(tabs)/marketing",
    );
    const route = read("src/components/creators/screens/BlastRedirectScreens.tsx");
    expect(route).toContain("blastOverviewHref");
    expect(route).not.toContain("fetchPromoteListing");
  });
});

const sample = {
  ok: true,
  listings: [
    { kind: "event", id: "e-1", title: "QA Rooftop Social", starts_at: "2026-11-09T14:56:00Z" },
    { kind: "venue", id: "v-1", title: "Sky Lounge", starts_at: null },
    { id: null, title: "broken" },
  ],
  listing: { kind: "event", id: "e-1", title: "QA Rooftop Social", starts_at: "2026-11-09T14:56:00Z" },
  currency: "USD",
  sold_minor: 0,
  tickets: 0,
  clicks: 12,
  spent_minor: 34500,
  campaigns: { sent: 0, last_sent_at: null },
  ads: { live: 0, draft: 0, needs_setup: true },
  creators: { gigs_live: 1, interested: 2, hired: 1, paid: 1 },
  referrals: { offers_live: 2, promoters: 2 },
};

describe("brand_promotion_overview mapping", () => {
  it("maps the contract shape and drops broken listings", () => {
    const overview = mapPromotionOverview(sample);
    expect(overview.listings.map((row) => row.id)).toEqual(["e-1", "v-1"]);
    expect(overview.listing?.title).toBe("QA Rooftop Social");
    expect(overview.ads).toEqual({ live: 0, draft: 0, needsSetup: true });
    expect(overview.creators).toEqual({ gigsLive: 1, interested: 2, hired: 1, paid: 1 });
  });

  it("treats {ok:false} as a failure, never an empty overview", () => {
    expect(promotionOverviewError({ ok: false, error: "listing_not_found" })).toBe(
      "listing_not_found",
    );
    expect(promotionOverviewError(sample)).toBeNull();
  });

  it("words the strip and rows without raw values", () => {
    const overview = mapPromotionOverview(sample);
    expect(promotionStrip(overview)).toEqual([
      { value: "$0", label: "Sold via promotion" },
      { value: "12", label: "Link clicks" },
      { value: "$345", label: "Spent" },
    ]);
    expect(promotionRowWords(overview)).toEqual({
      campaigns: "None sent yet",
      ads: "Finish payout setup to run ads",
      creators: "1 gig live · 2 interested · 1 hired · 1 paid",
      referrals: "2 offers live · 2 promoters",
    });
  });

  it("gives the event page's Promote tile a short live status", () => {
    expect(promoteTileStatus(mapPromotionOverview(sample))).toBe(
      "1 gig · 2 interested",
    );
    expect(promoteTileStatus(mapPromotionOverview({}))).toBe("Get it seen");
    expect(promoteTileStatus(null)).toBe("Get it seen");
  });
});
