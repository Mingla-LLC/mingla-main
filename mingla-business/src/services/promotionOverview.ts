/**
 * #3872 round 2 — Blast › Overview reads `brand_promotion_overview` (one
 * listing or the whole brand). Pure types, mapping and words, so the screen,
 * the event page's Promote tile and the tests share one reading of the
 * server contract:
 *
 * brand_promotion_overview(p_brand_id, p_listing_kind default null,
 *   p_listing_id default null) → {listings:[{kind,id,title,starts_at}],
 *   listing:{kind,id,title,starts_at}|null, currency, sold_minor, tickets,
 *   clicks, spent_minor, campaigns:{sent,last_sent_at}|null,
 *   ads:{live,draft,needs_setup}|null,
 *   creators:{gigs_live,interested,hired,paid},
 *   referrals:{offers_live,promoters}}
 */
import { programMoneyShort, shortDate } from "../utils/creatorProgramFormat";

export type PromotionListingKind = "event" | "venue";

export type PromotionListing = {
  kind: PromotionListingKind;
  id: string;
  title: string;
  startsAt: string | null;
};

export type PromotionOverview = {
  listings: PromotionListing[];
  listing: PromotionListing | null;
  currency: string;
  soldMinor: number;
  tickets: number;
  clicks: number;
  spentMinor: number;
  campaigns: { sent: number; lastSentAt: string | null } | null;
  ads: { live: number; draft: number; needsSetup: boolean } | null;
  creators: { gigsLive: number; interested: number; hired: number; paid: number };
  referrals: { offersLive: number; promoters: number };
};

const obj = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const num = (value: unknown): number => {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
};
const strOrNull = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

export function mapPromotionListing(raw: unknown): PromotionListing | null {
  const row = obj(raw);
  if (!row) return null;
  const id = strOrNull(row.id);
  if (!id) return null;
  return {
    kind: row.kind === "venue" ? "venue" : "event",
    id,
    title: strOrNull(row.title) ?? "Untitled listing",
    startsAt: strOrNull(row.starts_at),
  };
}

/**
 * `{ok:false, error}` answers (listing_required, listing_not_found) are
 * failures, never an empty overview. Returns the error code, or null.
 */
export function promotionOverviewError(raw: unknown): string | null {
  const value = obj(raw);
  if (!value || value.ok !== false) return null;
  return strOrNull(value.error) ?? "unknown";
}

/** Server JSON → screen shape. Missing blocks read as zero, never as a crash. */
export function mapPromotionOverview(raw: unknown): PromotionOverview {
  const value = obj(raw) ?? {};
  const campaigns = obj(value.campaigns);
  const ads = obj(value.ads);
  const creators = obj(value.creators) ?? {};
  const referrals = obj(value.referrals) ?? {};
  return {
    listings: Array.isArray(value.listings)
      ? value.listings
          .map(mapPromotionListing)
          .filter((row): row is PromotionListing => row !== null)
      : [],
    listing: mapPromotionListing(value.listing),
    currency: strOrNull(value.currency) ?? "USD",
    soldMinor: num(value.sold_minor),
    tickets: num(value.tickets),
    clicks: num(value.clicks),
    spentMinor: num(value.spent_minor),
    campaigns: campaigns
      ? { sent: num(campaigns.sent), lastSentAt: strOrNull(campaigns.last_sent_at) }
      : null,
    ads: ads
      ? { live: num(ads.live), draft: num(ads.draft), needsSetup: ads.needs_setup === true }
      : null,
    creators: {
      gigsLive: num(creators.gigs_live),
      interested: num(creators.interested),
      hired: num(creators.hired),
      paid: num(creators.paid),
    },
    referrals: {
      offersLive: num(referrals.offers_live),
      promoters: num(referrals.promoters),
    },
  };
}

const plural = (count: number, one: string, many = `${one}s`): string =>
  `${count} ${count === 1 ? one : many}`;

/** "QA Rooftop Social · Nov 9" (picker chip and rows). */
export function promotionListingLabel(listing: PromotionListing): string {
  const day = listing.startsAt ? shortDate(listing.startsAt) : "";
  return day ? `${listing.title} · ${day}` : listing.title;
}

/**
 * The three numbers at the top of Overview. Spend is never green. A zero
 * reads quiet (`tone: "muted"`) so an all-zero strip does not shout.
 */
export function promotionStrip(overview: PromotionOverview): Array<{
  value: string;
  label: string;
  tone?: "muted";
}> {
  const cell = (value: string, label: string, amount: number) =>
    amount === 0 ? { value, label, tone: "muted" as const } : { value, label };
  return [
    cell(
      programMoneyShort(overview.soldMinor, overview.currency),
      "Sold via promotion",
      overview.soldMinor,
    ),
    cell(overview.clicks.toLocaleString("en-US"), "Link clicks", overview.clicks),
    cell(
      programMoneyShort(overview.spentMinor, overview.currency),
      "Spent",
      overview.spentMinor,
    ),
  ];
}

/** True when every number in the strip is zero (the strip shows a guide line). */
export function promotionStripAllZero(overview: PromotionOverview): boolean {
  return (
    overview.soldMinor === 0 && overview.clicks === 0 && overview.spentMinor === 0
  );
}

/** The whole-brand scope's one name, everywhere it appears (#3872, NAMING.md). */
export const WHOLE_BRAND_LABEL = "Whole brand";

/** "Promotion across the brand" / "Promotion for this event|venue". */
export function promotionSectionLabel(
  listing: Pick<PromotionListing, "kind"> | null,
): string {
  if (!listing) return "Promotion across the brand";
  return `Promotion for this ${listing.kind === "venue" ? "venue" : "event"}`;
}

/** Sheet option subtitle: "Event · Nov 9" or "Venue". */
export function promotionListingSubtitle(listing: PromotionListing): string {
  if (listing.kind === "venue") return "Venue";
  const day = listing.startsAt ? shortDate(listing.startsAt) : "";
  return day ? `Event · ${day}` : "Event";
}

/** The notice when a deep-linked listing is no longer published. */
export function promotionFallbackNotice(
  kind: PromotionListingKind | null,
): string {
  const noun = kind === "venue" ? "venue" : kind === "event" ? "event" : "listing";
  return `That ${noun} isn't published any more, so you're seeing the whole brand.`;
}

/** One-line subtitles for the four ways to promote. */
export function promotionRowWords(overview: PromotionOverview): {
  campaigns: string;
  ads: string;
  creators: string;
  referrals: string;
} {
  const campaigns =
    overview.campaigns === null
      ? "Message your buyers and followers"
      : overview.campaigns.sent === 0
        ? "None sent yet"
        : [
            `${plural(overview.campaigns.sent, "sent", "sent")}`,
            overview.campaigns.lastSentAt
              ? `last ${shortDate(overview.campaigns.lastSentAt)}`
              : null,
          ]
            .filter(Boolean)
            .join(" · ");
  const adsInvite =
    overview.listing === null
      ? "Boost what you're selling with ads"
      : `Boost this ${overview.listing.kind === "venue" ? "venue" : "event"} with ads`;
  const ads =
    overview.ads === null
      ? adsInvite
      : overview.ads.needsSetup
        ? "Finish payout setup to run ads"
        : overview.ads.live > 0
          ? `${overview.ads.live} live${overview.ads.draft > 0 ? ` · ${overview.ads.draft} draft` : ""}`
          : overview.ads.draft > 0
            ? plural(overview.ads.draft, "draft")
            : "No ads yet";
  const c = overview.creators;
  const creators =
    c.gigsLive === 0 && c.hired === 0 && c.interested === 0
      ? "Hire creators to make videos"
      : [
          c.gigsLive > 0 ? `${plural(c.gigsLive, "gig")} live` : null,
          c.interested > 0 ? `${c.interested} interested` : null,
          c.hired > 0 ? `${c.hired} hired` : null,
          c.paid > 0 ? `${c.paid} paid` : null,
        ]
          .filter(Boolean)
          .join(" · ");
  const r = overview.referrals;
  const referrals =
    r.offersLive === 0 && r.promoters === 0
      ? "Pay people for the tickets they sell"
      : [
          r.offersLive > 0 ? `${plural(r.offersLive, "offer")} live` : null,
          r.promoters > 0 ? plural(r.promoters, "promoter") : null,
        ]
          .filter(Boolean)
          .join(" · ");
  return { campaigns, ads, creators, referrals };
}

/**
 * Live status on the event page's Promote tile ("1 gig · 2 offers").
 * `null` overview (still loading or failed) → a plain invitation.
 */
export function promoteTileStatus(overview: PromotionOverview | null): string {
  if (!overview) return "Get it seen";
  const parts = [
    overview.creators.gigsLive > 0
      ? plural(overview.creators.gigsLive, "gig")
      : null,
    overview.creators.interested > 0
      ? `${overview.creators.interested} interested`
      : null,
    overview.referrals.offersLive > 0
      ? plural(overview.referrals.offersLive, "offer")
      : null,
    overview.ads && overview.ads.live > 0 ? plural(overview.ads.live, "ad") : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.slice(0, 2).join(" · ") : "Get it seen";
}

/** Blast Overview route for one listing (Get it seen, Promote tile, old /promote). */
export function blastOverviewHref(
  listing?: { kind: string | null | undefined; id: string | null | undefined } | null,
): string {
  if (!listing || !listing.id) return "/(tabs)/marketing";
  const kind = listing.kind === "venue" ? "venue" : "event";
  return `/(tabs)/marketing?listingKind=${kind}&listingId=${encodeURIComponent(listing.id)}`;
}
