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
  /**
   * ORCH-0877 — full UTC end-instant populated by `discover-merged-events`
   * from `event_dates.end_at`. Source of truth for cross-midnight rendering
   * (consumer formatters compare calendar-day in event timezone). Optional
   * for back-compat with payloads from edge functions running pre-0877.
   */
  masterEndAtUtc?: string | null;
  doorsOpenLocal: string | null;
  endsAtLocal: string | null;
  timezone: string;
  venueName: string | null;
  city: string | null;
  /**
   * ORCH-0846: address is now passed unconditionally; the shared
   * @mingla/offering-rendering PublicEventPage gates rendering via
   * hideAddressUntilTicket (matches brand-side mechanism).
   */
  address: string | null;
  hideAddressUntilTicket: boolean;
  /**
   * ORCH-0846: shared-component format string consumed by
   * @mingla/offering-rendering PublicEventPage. Resolved server-side from
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
  /**
   * ORCH-1006 Slice 3 Wave 2 — server-computed all-in (tax/fee-inclusive)
   * lowest-tier price in CENTS, from
   * business_public_events_view.display_price_cents. null when there is no
   * priced tier (free / unpriced) → consumers fall back to priceMin (which
   * is in MAJOR units). Pure data-plumbing of an existing column; no
   * client-side pricing math runs.
   */
  displayPriceCents: number | null;
  displayCurrency: string | null;
  /** ISO 4217. */
  currency: string;
  /** The anon-tolerant buyer route in mingla-business. Opened via in-app WebView. */
  publicBuyerUrl: string;
  /**
   * ORCH-1150 — the offering discriminator. 'rsvp' ⇒ a Partiful-style RSVP event
   * surfaced on the deck (host opted in via rsvp_discoverable); the card renders
   * a Going/Not-going CTA instead of Book, and writes via public-submit-rsvp.
   * Undefined/'event' ⇒ the existing ticketed/Book path (byte-safe default).
   */
  eventType?: "event" | "rsvp";
  /**
   * ORCH-1072 — present ONLY for brand experiences (event_type='experience').
   * The multi-stop itinerary, rendered by the detail sheet beneath the cover +
   * description. Undefined for events/trips → no itinerary section (byte-safe).
   */
  experienceStops?: Array<{
    stopNumber: number;
    placeName: string | null;
    address: string | null;
    imageUrl: string | null;
    aiDescription: string | null;
    /**
     * ORCH-1138 rework (§4.C.1) — the FULL per-stop gallery (not just one
     * image). Empty array when the stop has no photos (rule 9). The detail
     * screen renders a count-aware gallery (1=full / 2=split / 3+=slider).
     */
    imageUrls: string[];
    /** ORCH-1138 rework — per-stop coords (the "Where you'll start" map reads stop-1). */
    lat: number | null;
    lng: number | null;
    /** ORCH-1138 rework — per-stop authored start time (HH:MM[:SS]) → time pill. null when unauthored. */
    startTime: string | null;
    /** ORCH-1138 rework — START HERE / THEN / END WITH (canonical consumer label). */
    stopLabel: "Start Here" | "Then" | "End With";
  }>;
  /**
   * ORCH-1138 rework (§4.C.1) — the experience's curated vibes (the canonical 4:
   * adventurous|first-date|romantic|group-fun) → consumer vibe chips. Present
   * ONLY for experiences; empty/undefined → no vibe row (rule 9).
   */
  experienceIntents?: string[];
  /**
   * ORCH-1138 rework (§4.C.1) — the anon-safe resolved brand theme passthrough
   * (COMMS-0009: NEVER a client `.from('brands')`). The seed mappers feed it so
   * useEventTheme has a SYNCHRONOUS fallback while the query settles → no flash
   * of the default palette. null when the brand carries no theme.
   */
  brandTheme?: {
    color: string | null;
    font: string | null;
    animation: string | null;
    color_override: string | null;
    font_override: string | null;
    animation_override: string | null;
  } | null;
  /**
   * ORCH-1072 — present ONLY for brand experiences. The experience's upcoming
   * bookable occurrences (from event_dates), each with remaining capacity.
   * A one-off experience carries a single element (auto-selected in the Book
   * sheet); sold-out occurrences (remaining === 0) render disabled. remaining
   * === null ⇒ unlimited. Undefined for events/trips (no occurrence picker).
   */
  upcomingOccurrences?: Array<{
    eventDateId: string;
    startAt: string;
    endAt: string;
    capacity: number | null;
    sold: number;
    remaining: number | null;
  }>;
  /**
   * ORCH-1153 WS2 — recurrence fields for the SHARED rule-based open-daily
   * detector (isOpenDailyExperience). Present ONLY for experiences, plumbed from
   * the deck-supply + venue RPCs through every seed mapper. undefined → the
   * detector returns false (flat slot list) — the safe default for a cold
   * deep-link or a pre-OTA payload that lacks the fields (rule 9, no fabrication).
   */
  isRecurring?: boolean;
  recurrenceRule?: {
    preset?: string;
    byDay?: string;
    byMonthDay?: number;
    bySetPos?: number;
    termination?: { kind?: string; count?: number; until?: string };
  } | null;
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
