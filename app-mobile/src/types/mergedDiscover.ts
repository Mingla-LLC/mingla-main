/**
 * ORCH-0824 — Type definitions for the merged Discover response shape.
 *
 * Discriminated union: `items: MergedDiscoverItem[]` where each item is
 * either a first-party business event or a Ticketmaster result.
 * Consumers render via `it.source === "business_event"` discriminator.
 *
 * Mirrors the edge-function response shape in
 * `supabase/functions/discover-merged-events/index.ts` §3.2.3 of the spec.
 */

import type { NightOutVenue } from "../services/nightOutExperiencesService";

/**
 * First-party business event card (events table + brand join + tickets aggregates).
 * Field-for-field aligned with the edge function's `BusinessEventCard` interface.
 */
export interface BusinessEventCard {
  // Identity
  eventId: string;
  brandId: string;
  brandSlug: string;
  brandName: string;
  brandProfilePhotoUrl: string | null;
  eventSlug: string;
  // Display
  title: string;
  description: string | null;
  coverMediaUrl: string | null;
  coverMediaType: "image" | "video" | "gif" | null;
  coverHue: number;
  // Date / venue
  masterDateUtc: string | null;
  doorsOpenLocal: string | null;
  endsAtLocal: string | null;
  timezone: string;
  venueName: string | null;
  city: string | null;
  /**
   * ORCH-0846: address is now passed unconditionally; the shared
   * @mingla/event-rendering PublicEventPage gates rendering via
   * hideAddressUntilTicket (matches brand-side mechanism).
   */
  address: string | null;
  hideAddressUntilTicket: boolean;
  /**
   * ORCH-0846: shared-component format string consumed by
   * @mingla/event-rendering PublicEventPage. Resolved server-side from
   * theme.business_event.format with events.is_online as fallback.
   */
  format: "in-person" | "online" | "hybrid";
  locationGeo: { lat: number; lng: number } | null;
  // Taxonomy (canonical slugs from `eventTaxonomy.ts`)
  partyTypes: string[];
  vibeTags: string[];
  musicGenres: string[];
  // Pricing (lowest/highest active ticket; null when no priced tickets exist)
  priceMin: number | null;
  priceMax: number | null;
  /** ISO 4217. */
  currency: string;
  /** The anon-tolerant buyer route in mingla-business. Opened via in-app WebView. */
  publicBuyerUrl: string;
}

export type MergedDiscoverItem =
  | { source: "business_event"; item: BusinessEventCard }
  | { source: "ticketmaster"; item: NightOutVenue };

export interface DiscoverMergedResponse {
  items: MergedDiscoverItem[];
  meta: {
    businessCount: number;
    ticketmasterCount: number;
    /** False when partyTypeSlugs or vibeTagSlugs is non-empty (TM suppression). */
    tmCalled: boolean;
    /** Non-null when TM upstream failed but business results still returned. */
    tmError: string | null;
    page: number;
    pageSize: number;
    fromCache: boolean;
  };
}

export interface DiscoverMergedSearchInput {
  city: {
    name: string;
    stateCode?: string | null;
    countryCode?: string | null;
    fallbackLat?: number;
    fallbackLng?: number;
    fallbackRadiusKm?: number;
  };
  /** Existing Ticketmaster facets — server resolves slugs → TM IDs. */
  segmentSlug?: string;
  genreSlugs?: string[];
  localStartEndDateTime?: string;
  keywords?: string[];
  sort?: string;
  page?: number;
  size?: number;
  /** ORCH-0824 Mingla-native facets. */
  partyTypeSlugs?: string[];
  vibeTagSlugs?: string[];
  musicGenreSlugs?: string[];
  /**
   * ORCH-0828: IANA timezone identifier used by the server to convert
   * `localStartEndDateTime` (wall-clock pair) to UTC instants for the
   * business-events `event_dates.start_at` window filter. When omitted
   * the server defaults to "UTC", which produces incorrect windows for
   * any non-UTC device — callers SHOULD always pass this.
   */
  timezone?: string;
}
