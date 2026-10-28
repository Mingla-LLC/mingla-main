/**
 * #4037 — the traffic analytics contract's fixed lists (ranges, sources in
 * contract order, tap types, page types). Kept apart from the service so the
 * lazily loaded dashboard can use them without dragging the service's
 * normalizers into the shared web boot chunk (#943 bundle budget).
 */
export const TRAFFIC_RANGES = ["7d", "30d", "90d", "all"] as const;
export const TRAFFIC_SOURCES = [
  "mingla_app",
  "mingla_ads",
  "search",
  "social",
  "own_links",
  "direct_unknown",
] as const;
export const TRAFFIC_CTA_TYPES = [
  "buy",
  "book",
  "rsvp",
  "share",
  "save",
  "directions",
  "website",
  "call",
  // Decision 5 (#4037): taps that open the brand, a venue or an offering are
  // engagement too, so they are listed and counted in Button taps.
  "view_brand",
  "view_venue",
  "view_offering",
] as const;
export const TRAFFIC_ENTITY_TYPES = [
  "event",
  "brand",
  "trip",
  "experience",
  "venue",
] as const;
export const TRAFFIC_LISTING_TYPES = [
  "event",
  "brand",
  "trip",
  "experience",
  "rsvp",
  "venue",
] as const;

export type TrafficRange = (typeof TRAFFIC_RANGES)[number];
export type TrafficSource = (typeof TRAFFIC_SOURCES)[number];
export type TrafficCtaType = (typeof TRAFFIC_CTA_TYPES)[number];
export type TrafficEntityType = (typeof TRAFFIC_ENTITY_TYPES)[number];
export type TrafficListingType = (typeof TRAFFIC_LISTING_TYPES)[number];
