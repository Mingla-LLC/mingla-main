/**
 * #3872 round 2 — the Blast tab's sections, in the approved order: the ways
 * to promote first (Overview, Campaigns, Ads, Creators, Referrals), the email
 * tools last (People, Templates). Pure data so the order, the routes and the
 * active-tab rule are testable without rendering.
 */
export type MarketingSubNavId =
  | "overview"
  | "campaigns"
  | "ads"
  | "creators"
  | "referrals"
  | "people"
  | "templates";

export interface MarketingSubNavTab {
  id: MarketingSubNavId;
  label: string;
  /** Expo-router path (relative to `/(tabs)/marketing/`). */
  path: string;
}

export const MARKETING_SUB_NAV_TABS: ReadonlyArray<MarketingSubNavTab> = [
  { id: "overview", label: "Overview", path: "/(tabs)/marketing" },
  { id: "campaigns", label: "Campaigns", path: "/(tabs)/marketing/campaigns" },
  { id: "ads", label: "Ads", path: "/(tabs)/marketing/ads" },
  { id: "creators", label: "Creators", path: "/(tabs)/marketing/creators" },
  { id: "referrals", label: "Referrals", path: "/(tabs)/marketing/referrals" },
  { id: "people", label: "People", path: "/(tabs)/marketing/people" },
  { id: "templates", label: "Templates", path: "/(tabs)/marketing/templates" },
];

export function detectMarketingSubNavActive(pathname: string): MarketingSubNavId {
  const lower = pathname.toLowerCase();
  if (lower.includes("/marketing/people") || lower.includes("/marketing/audiences"))
    return "people";
  if (lower.includes("/marketing/campaigns")) return "campaigns";
  if (lower.includes("/marketing/templates")) return "templates";
  if (lower.includes("/marketing/ads")) return "ads";
  if (lower.includes("/marketing/creators")) return "creators";
  if (lower.includes("/marketing/referrals")) return "referrals";
  return "overview";
}

/**
 * The brand-level Creators and Referrals hubs now live in Blast. Their old
 * routes (`/brand/[id]/creators`, `/brand/[id]/referrals`) set the current
 * brand and land here; Referrals keeps its `tab` (offers, promoters, links,
 * results).
 */
export function blastHubHref(
  hub: "creators" | "referrals",
  tab?: string | null,
): string {
  const base = `/(tabs)/marketing/${hub}`;
  if (hub === "referrals" && tab && ["offers", "promoters", "links", "results"].includes(tab)) {
    return `${base}?tab=${tab}`;
  }
  return base;
}
