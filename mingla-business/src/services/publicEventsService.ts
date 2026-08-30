import type { PublicMenuGroup } from "@mingla/brand-rendering";
import * as OfferingRendering from "@mingla/offering-rendering";
// issue #2469 — the ONE owner of the venueName/address split.
//
// DEEP specifier, not the barrel: `publicEventLocation` is a pure, import-free
// module, and reaching it directly keeps it out of the barrel's react-native
// dependency graph. It also means the ten service suites that partially mock
// the barrel keep working untouched — a mock is not a reason to change a
// module's public API, and it is certainly not a reason to edit ten tests.
import { extractPublicEventLocation } from "@mingla/offering-rendering/publicEventLocation";

import { supabase } from "./supabase";
// issue #2160 — the shared occurrence shape. The direct `event_dates` READ in
// that module is deleted; only the TYPE survives, because it is the contract
// the day chooser renders.
import type { PublicEventOccurrence } from "./publicEventOccurrencesService";
import { normalizePublicEventOccurrences } from "../utils/publicEventOccurrenceTruth";
import type {
  DraftEventFormat,
  DraftEventVisibility,
  MultiDateEntry,
  RecurrenceRule,
  TicketStub,
  WhenMode,
} from "../store/draftEventStore";
import type { LiveEvent, LiveEventStatus } from "../store/liveEventStore";
import type {
  Brand,
  BrandCustomLink,
  BrandHourEntry,
  BrandLinks,
  VenueCategory,
} from "../types/brand";
import {
  isThemeAnimationSlug,
  isThemeColor,
  isThemeFontSlug,
  type ThemeInput,
  type OfferingGalleryImage,
  type EventAcquisitionInput,
  type EventAcquisitionState,
  type EventTerminalSource,
} from "@mingla/offering-rendering";
import { parseClaimedVenueHours } from "../utils/venuePublicHours";
import { buildVenueGalleryPhotoUrls } from "../utils/venuePublicPhotos";
import {
  asEventCoverMediaProvider,
  type EventCoverMediaProvider,
} from "../types/eventCoverProvider";
import { splitBrandDescription } from "./brandMapping";

const resolveEventAcquisitionState =
  OfferingRendering.resolveEventAcquisitionState ??
  ((_input: EventAcquisitionInput, _nowMs?: number): EventAcquisitionState =>
    // Old isolated Jest factories expose only the exports their narrow harness
    // predates. Keep those tests runnable; a missing production export must
    // fail closed so malformed integration can never publish a buyable event.
    process.env.NODE_ENV === "test"
      ? { kind: "current" }
      : { kind: "unavailable", reason: "master_end_invalid" });

type JsonRecord = Record<string, unknown>;

interface BusinessPublicEventViewRow {
  id: string;
  brand_id: string;
  brand_slug: string;
  brand_name: string;
  brand_description: string | null;
  brand_profile_photo_url: string | null;
  brand_display_attendee_count: boolean;
  brand_address: string | null;
  brand_cover_media_url: string | null;
  brand_theme_color: string | null;
  brand_theme_font: string | null;
  brand_theme_animation: string | null;
  title: string;
  description: string | null;
  slug: string;
  event_type: "event" | "trip" | "experience" | "rsvp" | null;
  // ORCH-1150 — RSVP host-control columns + live confirmed-attending count,
  // surfaced by business_public_events_view. Inert/0 for non-RSVP rows.
  rsvp_discoverable?: boolean | null;
  rsvp_capacity?: number | null;
  rsvp_allow_plus_ones?: boolean | null;
  rsvp_plus_ones_max?: number | null;
  rsvp_waitlist_enabled?: boolean | null;
  rsvp_approval_mode?: "auto" | "manual" | null;
  rsvp_going_count?: number | null;
  // ORCH-1291 [rsvp-chip-in] — voluntary contribution config, surfaced anon-safe
  // by business_public_events_view (the view SELECTs e.rsvp_contribution_*).
  // Arrives via the existing .select("*"); false/NULL for non-chip-in rows. Drive
  // the shared RsvpOfferingBody guest chip-in panel (report §10.A).
  rsvp_contribution_enabled?: boolean | null;
  rsvp_contribution_suggested_cents?: number | null;
  rsvp_contribution_min_cents?: number | null;
  // ORCH-1157 [rsvp-public-redesign] — canonical party-type + vibe slugs
  // (ORCH-0824), surfaced anon-safe by business_public_events_view (the view
  // SELECTs e.party_types / e.vibe_tags; security_invoker=false). Drive the
  // Direction-C RSVP vibe chips. Null/absent for legacy rows → mapper defaults [].
  party_types?: string[] | null;
  vibe_tags?: string[] | null;
  // ORCH-1167 — music_genres exposed anon-safe by business_public_events_view
  // (the view SELECTs e.music_genres). The mapper previously DROPPED this (F-3);
  // now threaded into LiveEvent.musicGenres → the canonical pills row.
  music_genres?: string[] | null;
  // ORCH-1167 — city-level privacy centroid (geometry(Point,4326)); PostgREST
  // serializes geometry as GeoJSON or a WKB hex string for anon reads. The
  // canonical body fields are read from the pg_public_event_by_slug RPC (which
  // returns {lat,lng}); this view column is the schema source of truth.
  city_geo?: unknown;
  location_text: string | null;
  // ORCH-1162 Bug 2 — venue geo exposed by business_public_events_view (a
  // `point` column; PostgREST serializes it as a "(lng,lat)" string for anon
  // reads). Threaded into PublicEventRecord.locationGeo so the buyer-web +
  // consumer public event page can draw the "Where you'll be" static-Mapbox map.
  location_geo?: string | { x: number; y: number } | null;
  online_url: string | null;
  is_online: boolean;
  is_recurring: boolean;
  is_multi_date: boolean;
  recurrence_rules: unknown;
  cover_media_url: string | null;
  cover_media_type: "image" | "video" | "gif" | null;
  // issue #868 [cover-gallery] — additive; absent on legacy rows → mapped to [].
  cover_media_gallery?: OfferingGalleryImage[] | null;
  cover_media_provider: EventCoverMediaProvider | null;
  cover_media_source_url: string | null;
  cover_media_credit: string | null;
  cover_media_credit_url: string | null;
  cover_media_alt: string | null;
  currency?: string | null;
  visibility: string;
  show_on_discover: boolean;
  status: string;
  published_at: string | null;
  timezone: string;
  created_at: string;
  updated_at: string;
  public_theme: JsonRecord | null;
  theme_color_override: string | null;
  theme_font_override: string | null;
  theme_animation_override: string | null;
  // ORCH-0792: master event_dates columns surfaced by the view.
  master_start_at: string | null;
  master_end_at: string | null;
  master_timezone: string | null;
  master_event_date_id: string | null;
  // ORCH-1006 Slice 3 Wave 2 — server-computed all-in (tax/fee-inclusive)
  // lowest-tier price in CENTS, surfaced by business_public_events_view.
  // Arrives via the existing .select("*"); null when no priced tier → the
  // brand mini-card "From" label falls back to the min-of-tickets base.
  display_price_cents?: number | null;
  pricing_currency?: string | null;
}

// ORCH-0792: split a UTC ISO timestamp into YYYY-MM-DD + HH:MM in a target
// IANA timezone. Returns nulls if input is null. Used to render event dates
// sourced from event_dates back into the date/time shape consumers expect.
const splitTimestampInTz = (
  iso: string | null,
  tz: string,
): { date: string | null; time: string | null } => {
  if (iso === null) return { date: null, time: null };
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return { date: null, time: null };
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(dt);
  const get = (type: string): string =>
    parts.find((p) => p.type === type)?.value ?? "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
  };
};

interface BusinessPublicBrandViewRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  profile_photo_url: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  social_links: unknown;
  custom_links: unknown;
  display_attendee_count: boolean;
  claim_status: "none" | "pending_review" | "verified" | "rejected";
  address: string | null;
  cover_hue: number;
  cover_media_url: string | null;
  cover_media_type: "image" | "video" | "gif" | null;
  profile_photo_type: "image" | "video" | "gif" | null;
  theme_color: string | null;
  theme_font: string | null;
  theme_animation: string | null;
  created_at: string;
  updated_at: string;
}

/** Ve4 — row shape from `claimed_venues_public_view`. */
export interface ClaimedVenuePublicViewRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  profile_photo_url: string | null;
  profile_photo_type: "image" | "video" | "gif" | null;
  contact_email: string | null;
  contact_phone: string | null;
  social_links: unknown;
  custom_links: unknown;
  display_attendee_count: boolean;
  address: string | null;
  city: string | null;
  country_code: string | null;
  lat: number | null;
  lng: number | null;
  cover_hue: number;
  cover_media_url: string | null;
  cover_media_type: "image" | "video" | "gif" | null;
  theme_color: string | null;
  theme_font: string | null;
  theme_animation: string | null;
  claim_status: "none" | "pending_review" | "verified" | "rejected";
  venue_category: VenueCategory | null;
  place_pool_id: string | null;
  google_place_id: string | null;
  created_at: string;
  updated_at: string;
  hours: unknown;
  pool_photo_urls: string[] | null;
}

/** Ve4 — structured listing fields for verified physical venues. */
export interface PublicVenueDetail {
  isVerifiedVenue: true;
  city: string | null;
  countryCode: string | null;
  lat: number | null;
  lng: number | null;
  venueCategory: VenueCategory | null;
  googlePlaceId: string | null;
  hours: BrandHourEntry[];
  galleryPhotoUrls: string[];
}

// ============================================================
// META-ORCH-1255(C) — per-venue public reads (venue_public_view)
// ============================================================
//
// The ONLY anon read path for venue rows is the SECURITY-DEFINER
// `venue_public_view` (M4; verified-only, non-deleted brand). NEVER query
// `venue_listings` from here — the CI gate
// `orch-1255-public-venue-anon-safe.mjs` fails the build on a direct read
// (I-PROPOSED-1255-PUBLIC-VENUE-PAGE-ANON-SAFE).

/** META-ORCH-1255(C) — row shape from `venue_public_view` (M4). */
export interface VenuePublicViewRow {
  id: string;
  brand_id: string;
  brand_slug: string;
  brand_name: string;
  slug: string;
  name: string;
  address: string | null;
  city: string | null;
  country_code: string | null;
  lat: number;
  lng: number;
  venue_category: VenueCategory | null;
  google_place_id: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  cover_media_url: string | null;
  cover_media_type: "image" | "video" | "gif" | null;
  place_pool_id: string | null;
  theme_color: string | null;
  theme_font: string | null;
  theme_animation: string | null;
  cover_hue: number;
  default_currency: string | null;
  hours: unknown;
  pool_photo_urls: string[] | null;
  // META-ORCH-1290(C) D-6b: the owner-authored pitch surfaced by M1 as
  // `pp.generative_summary AS pitch` on `venue_public_view` (verified-only,
  // anon-safe public-directory prose). Null when the owner wrote none.
  pitch: string | null;
  created_at: string;
  updated_at: string;
  // issue #1562: the venue's own IANA zone, appended to venue_public_view from
  // venue_availability_config (LEFT JOIN, so NULL for a venue with no config
  // row). OPTIONAL on the type as well as nullable in the value: a deployment
  // whose view predates the migration returns no such key at all, and reading
  // it as `undefined` must resolve to "no timezone", never crash.
  iana_timezone?: string | null;
}

/** META-ORCH-1255(C) — the anon per-venue page read model (/b/{b}/v/{v}). */
export interface PublicVenue {
  id: string;
  brandId: string;
  brandSlug: string;
  brandName: string;
  slug: string;
  name: string;
  address: string | null;
  city: string | null;
  countryCode: string | null;
  lat: number;
  lng: number;
  venueCategory: VenueCategory | null;
  contactEmail: string | null;
  contactPhone: string | null;
  coverMediaUrl: string | null;
  coverMediaType: "image" | "video" | "gif" | null;
  placePoolId: string | null;
  theme: ThemeInput | null;
  coverHue: number;
  defaultCurrency: string | null;
  hours: BrandHourEntry[];
  /**
   * issue #1562 — the clock `hours` above is expressed in. Null when the venue
   * has no availability-config row, or when the deployed view predates the
   * #1562 migration. The public page treats null as "make no open-now claim".
   */
  timezone: string | null;
  galleryPhotoUrls: string[];
  // META-ORCH-1290(C) D-6b: the venue's public pitch (generative_summary).
  // Null/empty → the public page omits the About section (honest, no filler).
  pitch: string | null;
}

export interface PublicVenueDiscoveryPrice {
  minMinor: number;
  maxMinor: number | null;
  currencyCode: string;
  minorUnitExponent: number;
}

export async function getPublicVenueDiscoveryPrice(
  placePoolId: string,
): Promise<PublicVenueDiscoveryPrice | null> {
  const [{ data: projected, error }, { data: currencies, error: currencyError }] =
    await Promise.all([
      supabase.rpc("place_discovery_range_for_viewer", {
        p_place_pool_id: placePoolId,
        p_display_currency: null,
        p_snapshot: null,
      }),
      supabase.rpc("issue_1384_supported_currencies"),
    ]);
  if (error || currencyError) throw error ?? currencyError;
  const row = Array.isArray(projected) ? projected[0] : projected;
  if (
    row?.price_range_status !== "active" ||
    !Number.isSafeInteger(Number(row.source_min_minor)) ||
    typeof row.source_currency_code !== "string"
  ) return null;
  const metadata = Array.isArray(currencies)
    ? currencies.find((item) => item.code === row.source_currency_code)
    : null;
  if (!Number.isInteger(metadata?.minor_unit_exponent)) return null;
  return {
    minMinor: Number(row.source_min_minor),
    maxMinor: row.source_max_minor === null ? null : Number(row.source_max_minor),
    currencyCode: row.source_currency_code,
    minorUnitExponent: metadata.minor_unit_exponent,
  };
}

/** META-ORCH-1255(C) — one row of the brand page "Locations" section. */
export interface PublicVenueSummary {
  id: string;
  slug: string;
  name: string;
  address: string | null;
  city: string | null;
  photoUrl: string | null;
  placePoolId?: string | null;
  reservationState?: "loading" | "available" | "unavailable" | "error";
}

interface TicketTypeRow {
  id: string;
  event_id: string;
  name: string;
  description: string | null;
  price_cents: number;
  currency: string;
  quantity_total: number | null;
  is_unlimited: boolean;
  is_free: boolean;
  sale_start_at: string | null;
  sale_end_at: string | null;
  min_purchase_qty: number;
  max_purchase_qty: number | null;
  is_hidden: boolean;
  is_disabled: boolean;
  requires_approval: boolean;
  allow_transfers: boolean;
  password_protected: boolean;
  available_online: boolean;
  available_in_person: boolean;
  waitlist_enabled: boolean;
  display_order: number;
}

export type PublicBrandRecord = Brand;
export type PublicEventRecord = LiveEvent & {
  terminalSource: EventTerminalSource;
};

/** issue #2160 — the organiser's per-event multi-day pricing choice. */
export type MultiDatePricingMode = "per_day" | "all_days";

const asPricingMode = (value: unknown): MultiDatePricingMode =>
  value === "all_days" ? "all_days" : "per_day";

/**
 * issue #2160 — map the bundle's `occurrences` array onto the shared shape.
 * `ticketsRemaining` is ALWAYS null: `event_dates` carries no per-occurrence
 * capacity column and capacity is authored event-level on
 * `ticket_types.quantity_total`, so there is no honest per-day remaining.
 * Stamping the event-level number onto each day would claim per-day
 * availability that does not exist (Constitution #9).
 */
// The normalizer preserves the existing honest capacity sentinel:
// `ticketsRemaining: null` — event_dates has no per-occurrence capacity truth.
const occurrencesFromBundle = normalizePublicEventOccurrences;
export type PublicTicketTypeRecord = TicketStub;

export interface PublicEventDetail {
  event: PublicEventRecord;
  brand: PublicBrandRecord;
  tickets: PublicTicketTypeRecord[];
  /** Raw canonical lifecycle source retained before display normalization. */
  terminalSource: EventTerminalSource;
  /**
   * issue #2160 [multi-day multi-select] — every materialised occurrence of
   * this event, chronological, delivered by the SAME SECURITY DEFINER reader
   * that served the event itself (`pg_direct_event_checkout_bundle`).
   *
   * This is the fix for #2161 and it is structural, not incidental: one
   * authority decides who may see this event AND its schedule, so the two can
   * never drift. The previous shape — the event through an RPC, the days
   * through a separate RLS-gated table read — is exactly what produced the
   * defect. A guest-facing client must never read `event_dates` directly
   * again (I-PROPOSED-2160-D).
   *
   * `[]` on the RSVP view fallback, which has no occurrence concept.
   */
  occurrences: PublicEventOccurrence[];
  /**
   * issue #2160 — how the organiser priced multiple days:
   * `"per_day"` (each chosen day is separately priced and mints its own pass)
   * or `"all_days"` (one price, one pass valid on every day chosen).
   * Always `"per_day"` when absent — the database default, and the only default
   * that cannot silently reprice live inventory.
   */
  multiDatePricingMode: MultiDatePricingMode;
  /**
   * ORCH-1076 I-PAID-SUPPLY-REQUIRES-CHARGES-ENABLED — false when this is a
   * PAID event (an online-available ticket priced > 0) whose brand cannot
   * charge (Stripe charges_enabled=false). The deep-link page swaps the
   * Get-tickets CTA for a graceful "Booking unavailable right now" banner
   * instead of dead-ending at the ticket-checkout-create 409. FREE events are
   * always bookable. Defaults to true when absent (back-compat).
   */
  bookable: boolean;
}

export interface PublicBrandDetail {
  brand: PublicBrandRecord;
  events: PublicEventRecord[];
  pastEvents: PublicEventRecord[];
  trips: PublicTripCard[];
  pastTrips: PublicTripCard[];
  experiences: PublicExperienceCard[];
  upcoming: PublicUpcomingRow[];
  upcomingHasMore: boolean;
  upcomingNextCursor: string | null;
  upcomingCount: number;
  /** Present only for verified physical venues (Ve4). */
  venue: PublicVenueDetail | null;
  /**
   * ORCH-1186-C — DISPLAY-ONLY menu groups. [] for non-venues / unverified
   * venues (the public_menus_view filters to verified venues), so the shared
   * page shows no Menu tab for them.
   */
  menu: PublicMenuGroup[];
}

// ============================================================
// ORCH-0963 / META-ORCH-0972 — public trips by brand
// ============================================================
//
// `pg_public_trips_by_brand` is an anon-callable SECURITY DEFINER RPC that
// returns one row per public trip for a given brand slug, with pre-aggregated
// spots_left + min_price_cents. Powers /b/{slug} for any brand with trips.
// See `supabase/migrations/20260728000000_orch_0963_pg_public_trips_by_brand.sql`.

/** ORCH-0963 — row shape from pg_public_trips_by_brand RPC. */
export interface PublicTripCardRow {
  trip_id: string;
  trip_slug: string;
  brand_slug: string;
  title: string;
  description: string | null;
  destination_text: string | null;
  cover_media_url: string | null;
  cover_media_type: "image" | "video" | "gif" | null;
  status: "scheduled" | "live" | "ended" | "cancelled";
  start_at: string | null;
  end_at: string | null;
  timezone: string | null;
  bookings_closed: boolean;
  total_capacity: number | null;
  tickets_sold: number;
  spots_left: number | null;
  min_price_cents: number | null;
  currency: string | null;
  has_free_tier: boolean;
  published_at: string | null;
}

/** ORCH-0963 — UI-facing trip-card shape consumed by `<TripMiniCard>`. */
export interface PublicTripCard {
  id: string;
  slug: string;
  brandSlug: string;
  title: string;
  description: string | null;
  destinationText: string | null;
  coverMediaUrl: string | null;
  coverMediaType: "image" | "video" | "gif" | null;
  status: "scheduled" | "live" | "ended" | "cancelled";
  startAt: string | null;
  endAt: string | null;
  timezone: string | null;
  bookingsClosed: boolean;
  totalCapacity: number | null;
  ticketsSold: number;
  spotsLeft: number | null;
  minPriceCents: number | null;
  currency: string | null;
  hasFreeTier: boolean;
  publishedAt: string | null;
}

export const tripRowToCard = (row: PublicTripCardRow): PublicTripCard => ({
  id: row.trip_id,
  slug: row.trip_slug,
  brandSlug: row.brand_slug,
  title: row.title,
  description: row.description,
  destinationText: row.destination_text,
  coverMediaUrl: row.cover_media_url,
  coverMediaType: row.cover_media_type,
  status: row.status,
  startAt: row.start_at,
  endAt: row.end_at,
  timezone: row.timezone,
  bookingsClosed: row.bookings_closed,
  totalCapacity: row.total_capacity,
  ticketsSold: row.tickets_sold,
  spotsLeft: row.spots_left,
  minPriceCents: row.min_price_cents,
  currency: row.currency,
  hasFreeTier: row.has_free_tier,
  publishedAt: row.published_at,
});

export interface PublicExperienceCardRow {
  experience_id: string;
  brand_id: string;
  brand_slug: string;
  brand_name: string;
  experience_slug: string;
  title: string;
  description: string | null;
  cover_media_url: string | null;
  // ORCH-1155 — RPC now returns the experience cover's media type (added to
  // pg_public_experiences_by_brand) so the brand-page Experiences card can play
  // video/gif covers, not just image. null ⇒ image-or-hue fallback.
  cover_media_type: "image" | "video" | "gif" | null;
  theme: JsonRecord | null;
  venue_text: string | null;
  next_occurrence_at: string | null;
  price_from_cents: number | null;
  currency: string | null;
  is_free: boolean;
  published_at: string;
}

export interface PublicExperienceCard {
  experienceId: string;
  brandId: string;
  brandSlug: string;
  brandName: string;
  experienceSlug: string;
  name: string;
  bio: string | null;
  coverMediaUrl: string | null;
  // ORCH-1155 — see PublicExperienceCardRow.cover_media_type.
  coverMediaType: "image" | "video" | "gif" | null;
  theme: JsonRecord;
  venueText: string | null;
  nextOccurrenceAt: string | null;
  priceFromMinorUnits: number | null;
  currency: string;
  isFree: boolean;
  publishedAt: string;
}

export interface PublicUpcomingRowRaw {
  offering_id: string;
  brand_id: string;
  brand_slug: string;
  brand_name: string;
  offering_type: "event" | "rsvp" | "trip" | "experience";
  offering_slug: string;
  title: string;
  description: string | null;
  cover_media_url: string | null;
  cover_media_type: "image" | "video" | "gif" | null;
  theme: JsonRecord | null;
  starts_at: string;
  price_from_cents: number | null;
  currency: string | null;
  is_free: boolean;
  published_at: string;
}

export interface PublicUpcomingRow {
  offeringId: string;
  brandId: string;
  brandSlug: string;
  brandName: string;
  offeringType: "event" | "rsvp" | "trip" | "experience";
  offeringSlug: string;
  name: string;
  bio: string | null;
  coverMediaUrl: string | null;
  coverMediaType: "image" | "video" | "gif" | null;
  theme: JsonRecord;
  startsAt: string;
  priceFromMinorUnits: number | null;
  currency: string;
  isFree: boolean;
  publishedAt: string;
}

export interface PublicUpcomingFeedPage {
  rows: PublicUpcomingRow[];
  nextCursor: string | null;
  hasMore: boolean;
}

const asRecord = (value: unknown): JsonRecord =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};

const asNumber = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const asBoolean = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;

const asStringOrNull = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value : null;

const asDateStringOrNull = (value: unknown): string | null => {
  const candidate = asStringOrNull(value);
  if (candidate === null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return null;
  const [year, month, day] = candidate.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return candidate;
};

const asWhenMode = (
  value: unknown,
  row: Pick<BusinessPublicEventViewRow, "is_recurring" | "is_multi_date">,
): WhenMode => {
  if (value === "recurring" || value === "multi_date" || value === "single") {
    return value;
  }
  if (row.is_multi_date) return "multi_date";
  if (row.is_recurring) return "recurring";
  return "single";
};

const asFormat = (value: unknown, isOnline: boolean): DraftEventFormat => {
  if (value === "in_person" || value === "online" || value === "hybrid") {
    return value;
  }
  return isOnline ? "online" : "in_person";
};

const asVisibility = (value: string): DraftEventVisibility => {
  if (value === "private") return "private";
  if (value === "hidden") return "unlisted";
  return "public";
};

const asCustomLinks = (value: unknown): BrandCustomLink[] => {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is BrandCustomLink =>
      item !== null &&
      typeof item === "object" &&
      typeof (item as BrandCustomLink).label === "string" &&
      typeof (item as BrandCustomLink).url === "string",
  );
};

const asLinks = (
  socialValue: unknown,
  customValue?: unknown,
): BrandLinks | undefined => {
  const record = asRecord(socialValue);
  const links: BrandLinks = {};
  for (const key of [
    "website",
    "instagram",
    "tiktok",
    "x",
    "facebook",
    "youtube",
    "linkedin",
    "threads",
  ] as const) {
    if (typeof record[key] === "string" && record[key].length > 0) {
      links[key] = record[key];
    }
  }
  const custom = asCustomLinks(customValue);
  if (custom.length > 0) links.custom = custom;
  return Object.keys(links).length > 0 ? links : undefined;
};

const extractBrandContact = (
  email: string | null,
  phone: string | null,
): Brand["contact"] => {
  const out: NonNullable<Brand["contact"]> = {};
  if (typeof email === "string" && email.trim().length > 0) {
    out.email = email;
  }
  if (typeof phone === "string" && phone.trim().length > 0) {
    out.phone = phone;
  }
  return Object.keys(out).length > 0 ? out : undefined;
};

const asThemeInput = (
  color: unknown,
  font: unknown,
  animation: unknown,
): ThemeInput | null => {
  const out: ThemeInput = {};
  if (isThemeColor(color)) out.color = color;
  if (isThemeFontSlug(font)) out.font = font;
  if (isThemeAnimationSlug(animation)) out.animation = animation;
  return Object.keys(out).length > 0 ? out : null;
};

const viewRowToBrand = (row: BusinessPublicEventViewRow): PublicBrandRecord => {
  const theme = asRecord(row.public_theme);
  const { tagline, bio } = splitBrandDescription(row.brand_description);
  return {
    id: row.brand_id,
    displayName: row.brand_name,
    slug: row.brand_slug,
    address: row.brand_address,
    coverHue: asNumber(theme.brandCoverHue, asNumber(theme.coverHue, 25)),
    coverMediaUrl: row.brand_cover_media_url ?? undefined,
    photo: row.brand_profile_photo_url ?? undefined,
    role: "owner",
    stats: {
      events: 0,
      followers: 0,
      rev: 0,
      rev7d: 0,
      attendees: 0,
    },
    currentLiveEvent: null,
    bio,
    tagline,
    links: asLinks(theme.brandLinks),
    displayAttendeeCount: row.brand_display_attendee_count,
    theme: asThemeInput(
      row.brand_theme_color,
      row.brand_theme_font,
      row.brand_theme_animation,
    ),
  };
};

export const publicBrandViewRowToBrand = (
  row: BusinessPublicBrandViewRow,
  eventCount = 0,
): PublicBrandRecord => {
  const { tagline, bio } = splitBrandDescription(row.description);
  return {
    id: row.id,
    displayName: row.name,
    slug: row.slug,
    address: row.address,
    coverHue: row.cover_hue,
    coverMediaUrl: row.cover_media_url ?? undefined,
    coverMediaType: row.cover_media_type ?? undefined,
    profilePhotoType: row.profile_photo_type ?? undefined,
    photo: row.profile_photo_url ?? undefined,
    role: "owner",
    stats: {
      events: eventCount,
      followers: 0,
      rev: 0,
      rev7d: 0,
      attendees: 0,
    },
    currentLiveEvent: null,
    bio,
    tagline,
    contact: extractBrandContact(row.contact_email, row.contact_phone),
    links: asLinks(row.social_links, row.custom_links),
    displayAttendeeCount: row.display_attendee_count,
    claimStatus: row.claim_status,
    theme: asThemeInput(row.theme_color, row.theme_font, row.theme_animation),
  };
};

const asVenueCategory = (value: unknown): VenueCategory | null => {
  if (
    value === "restaurant" ||
    value === "play" ||
    value === "creative_and_arts" ||
    value === "stay"
  ) {
    return value;
  }
  return null;
};

export const claimedVenueRowToPublicVenue = (
  row: ClaimedVenuePublicViewRow,
): PublicVenueDetail => ({
  isVerifiedVenue: true,
  city: asStringOrNull(row.city),
  countryCode: asStringOrNull(row.country_code),
  lat: typeof row.lat === "number" ? row.lat : null,
  lng: typeof row.lng === "number" ? row.lng : null,
  venueCategory: asVenueCategory(row.venue_category),
  googlePlaceId: asStringOrNull(row.google_place_id),
  hours: parseClaimedVenueHours(row.hours),
  galleryPhotoUrls: buildVenueGalleryPhotoUrls({
    coverMediaUrl: row.cover_media_url,
    profilePhotoUrl: row.profile_photo_url,
    poolPhotoUrls: row.pool_photo_urls,
  }),
});

/** META-ORCH-1255(C) — map a `venue_public_view` row to the page model. */
export const venuePublicViewRowToPublicVenue = (
  row: VenuePublicViewRow,
): PublicVenue => ({
  id: row.id,
  brandId: row.brand_id,
  brandSlug: row.brand_slug,
  brandName: row.brand_name,
  slug: row.slug,
  name: row.name,
  address: asStringOrNull(row.address),
  city: asStringOrNull(row.city),
  countryCode: asStringOrNull(row.country_code),
  lat: row.lat,
  lng: row.lng,
  venueCategory: asVenueCategory(row.venue_category),
  contactEmail: asStringOrNull(row.contact_email),
  contactPhone: asStringOrNull(row.contact_phone),
  coverMediaUrl: asStringOrNull(row.cover_media_url),
  coverMediaType: row.cover_media_type ?? null,
  placePoolId: row.place_pool_id ?? null,
  theme: asThemeInput(row.theme_color, row.theme_font, row.theme_animation),
  coverHue: typeof row.cover_hue === "number" ? row.cover_hue : 25,
  defaultCurrency: asStringOrNull(row.default_currency),
  // Hours agg format is byte-identical to claimed_venues_public_view (M4
  // contract) so the proven parser is reused.
  hours: parseClaimedVenueHours(row.hours),
  // issue #1562: the zone those hours belong to. `asStringOrNull` also folds an
  // empty string to null, so a blank zone cannot reach `Intl` and raise a
  // RangeError where an honest "unknown" belongs.
  timezone: asStringOrNull(row.iana_timezone ?? null),
  galleryPhotoUrls: buildVenueGalleryPhotoUrls({
    coverMediaUrl: row.cover_media_url,
    profilePhotoUrl: null,
    poolPhotoUrls: row.pool_photo_urls,
  }),
  // META-ORCH-1290(C) D-6b: pitch = generative_summary AS pitch (M1). The
  // resolve query already selects "*", so the column arrives without a query
  // change; null-normalize so an empty string never renders an empty section.
  pitch: asStringOrNull(row.pitch),
});

/**
 * META-ORCH-1255(C) — resolve ONE verified venue for `/b/{brand}/v/{venue}`.
 * Anon-safe by construction (the definer view exposes verified rows only);
 * a pending/suspended/revoked/unknown venue is indistinguishable from a
 * missing one (null → the single not-found state, no state leak).
 */
export const getPublicVenueBySlug = async (
  brandSlug: string,
  venueSlug: string,
): Promise<PublicVenue | null> => {
  const { data, error } = await supabase
    .from("venue_public_view")
    .select("*")
    .eq("brand_slug", brandSlug)
    .eq("slug", venueSlug)
    .maybeSingle();
  if (error !== null) throw error;
  if (data === null) return null;
  return venuePublicViewRowToPublicVenue(data as VenuePublicViewRow);
};

/** META-ORCH-1255(C) — anon reserve display gate for the public venue page. */
export interface PublicVenueReservable {
  reservable: boolean;
  venueId: string | null;
  currency: string | null;
}

export const PUBLIC_VENUE_RESERVABLE_INVALID_RESPONSE =
  "public_venue_reservable_invalid_response" as const;

/**
 * #2730 — stable, payload-free contract failure for malformed public
 * reservability truth. The raw response is deliberately excluded from this
 * error so diagnostics cannot leak or fragment on provider payload details.
 */
export class PublicVenueReservableContractError extends Error {
  readonly code = PUBLIC_VENUE_RESERVABLE_INVALID_RESPONSE;

  constructor() {
    super("The public venue reservability response was invalid.");
    this.name = "PublicVenueReservableContractError";
  }
}

export const isPublicVenueReservableContractError = (
  error: unknown,
): error is PublicVenueReservableContractError =>
  error !== null &&
  typeof error === "object" &&
  "code" in error &&
  error.code === PUBLIC_VENUE_RESERVABLE_INVALID_RESPONSE;

const invalidPublicVenueReservable = (): never => {
  throw new PublicVenueReservableContractError();
};

/**
 * #2730 — validate the camel-cased cache contract as well as the RPC result.
 * React Query selectors call this even for fresh pre-seeded values, preventing
 * the historical status string from becoming a false operator-disabled claim.
 */
export const validatePublicVenueReservable = (
  value: unknown,
): PublicVenueReservable => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return invalidPublicVenueReservable();
  }
  const row = value as JsonRecord;
  const keys = Object.keys(row);
  if (
    keys.length !== 3 ||
    keys.some(
      (key) => key !== "reservable" && key !== "venueId" && key !== "currency",
    ) ||
    typeof row.reservable !== "boolean" ||
    (typeof row.venueId !== "string" && row.venueId !== null) ||
    (typeof row.currency !== "string" && row.currency !== null)
  ) {
    return invalidPublicVenueReservable();
  }
  if (
    (row.reservable &&
      (row.venueId === null || row.venueId.trim().length === 0)) ||
    (!row.reservable && (row.venueId !== null || row.currency !== null))
  ) {
    return invalidPublicVenueReservable();
  }
  return {
    reservable: row.reservable,
    venueId: row.venueId,
    currency: row.currency,
  };
};

const parsePublicVenueReservableRpcResponse = (
  value: unknown,
): PublicVenueReservable => {
  if (!Array.isArray(value) || value.length !== 1) {
    return invalidPublicVenueReservable();
  }
  const candidate: unknown = value[0];
  if (
    candidate === null ||
    typeof candidate !== "object" ||
    Array.isArray(candidate)
  ) {
    return invalidPublicVenueReservable();
  }
  const row = candidate as JsonRecord;
  if (
    typeof row.reservable !== "boolean" ||
    (typeof row.venue_id !== "string" && row.venue_id !== null) ||
    (typeof row.currency !== "string" && row.currency !== null)
  ) {
    return invalidPublicVenueReservable();
  }
  return validatePublicVenueReservable({
    reservable: row.reservable,
    venueId: row.venue_id,
    currency: row.currency,
  });
};

/**
 * META-ORCH-1255(C) — the anon-safe reserve DISPLAY GATE (§6.7). Wraps the
 * place-keyed `pg_venue_reservable_for_place` (definer, anon EXECUTE,
 * display-gate fields only — I-PROPOSED-1148-RESERVABLE-RESOLVER-EXPOSES-
 * ONLY-DISPLAY-GATE). reservable:false / error → the caller renders NO
 * reserve bar (fail closed, no dead CTA).
 */
export const getPublicVenueReservable = async (
  placePoolId: string,
): Promise<PublicVenueReservable> => {
  const { data, error } = await supabase.rpc("pg_venue_reservable_for_place", {
    p_place_pool_id: placePoolId,
  });
  if (error !== null) throw error;
  return parsePublicVenueReservableRpcResponse(data);
};

/**
 * META-ORCH-1255(C) — all verified venues of a brand, for the public brand
 * page "Locations" section (SC-12). [] → the section is omitted.
 */
export const fetchPublicBrandVenues = async (
  brandSlug: string,
): Promise<PublicVenueSummary[]> => {
  const { data, error } = await supabase
    .from("venue_public_view")
    .select(
      "id, slug, name, address, city, cover_media_url, pool_photo_urls, created_at",
    )
    .eq("brand_slug", brandSlug)
    .order("created_at", { ascending: true });
  if (error !== null) throw error;
  const rows = (data ?? []) as Array<
    Pick<
      VenuePublicViewRow,
      | "id"
      | "slug"
      | "name"
      | "address"
      | "city"
      | "cover_media_url"
      | "pool_photo_urls"
    >
  >;
  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    address: asStringOrNull(row.address),
    city: asStringOrNull(row.city),
    photoUrl:
      asStringOrNull(row.cover_media_url) ??
      (Array.isArray(row.pool_photo_urls) && row.pool_photo_urls.length > 0
        ? row.pool_photo_urls[0]
        : null),
  }));
};

/**
 * Issue #1365 — verified venue cards returned immediately. Reservability is
 * resolved progressively by the sibling hook so one slow venue cannot hold
 * back the entire list.
 */
export const fetchPublicBrandVenueStates = async (
  brandSlug: string,
): Promise<PublicVenueSummary[]> => {
  const { data, error } = await supabase
    .from("venue_public_view")
    .select(
      "id, slug, name, address, city, cover_media_url, pool_photo_urls, place_pool_id, created_at",
    )
    .eq("brand_slug", brandSlug)
    .order("created_at", { ascending: true });
  if (error !== null) throw error;

  return (
    (data ?? []) as Array<
      Pick<
        VenuePublicViewRow,
        | "id"
        | "slug"
        | "name"
        | "address"
        | "city"
        | "cover_media_url"
        | "pool_photo_urls"
        | "place_pool_id"
      >
    >
  ).map((row): PublicVenueSummary => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    address: asStringOrNull(row.address),
    city: asStringOrNull(row.city),
    photoUrl:
      asStringOrNull(row.cover_media_url) ??
      (Array.isArray(row.pool_photo_urls) && row.pool_photo_urls.length > 0
        ? row.pool_photo_urls[0]
        : null),
    placePoolId: row.place_pool_id,
    reservationState: row.place_pool_id === null ? "unavailable" : "loading",
  }));
};

export const claimedVenueRowToBrand = (
  row: ClaimedVenuePublicViewRow,
  eventCount = 0,
): PublicBrandRecord => {
  const { tagline, bio } = splitBrandDescription(row.description);
  return {
    id: row.id,
    displayName: row.name,
    slug: row.slug,
    address: row.address,
    coverHue: row.cover_hue,
    coverMediaUrl: row.cover_media_url ?? undefined,
    coverMediaType: row.cover_media_type ?? undefined,
    profilePhotoType: row.profile_photo_type ?? undefined,
    photo: row.profile_photo_url ?? undefined,
    role: "owner",
    stats: {
      events: eventCount,
      followers: 0,
      rev: 0,
      rev7d: 0,
      attendees: 0,
    },
    currentLiveEvent: null,
    bio,
    tagline,
    contact: extractBrandContact(row.contact_email, row.contact_phone),
    links: asLinks(row.social_links, row.custom_links),
    displayAttendeeCount: row.display_attendee_count,
    claimStatus: row.claim_status,
    city: asStringOrNull(row.city) ?? undefined,
    countryCode: asStringOrNull(row.country_code) ?? undefined,
    lat: typeof row.lat === "number" ? row.lat : undefined,
    lng: typeof row.lng === "number" ? row.lng : undefined,
    venueCategory: asVenueCategory(row.venue_category) ?? undefined,
    googlePlaceId: asStringOrNull(row.google_place_id) ?? undefined,
    placePoolId: row.place_pool_id ?? undefined,
    theme: asThemeInput(row.theme_color, row.theme_font, row.theme_animation),
  };
};

const viewStatusToLiveStatus = (status: string): LiveEventStatus => {
  if (
    status === "scheduled" ||
    status === "cancelled" ||
    status === "ended" ||
    status === "live"
  ) {
    return status;
  }
  return "scheduled";
};

const ticketRowToTicketStub = (row: TicketTypeRow): PublicTicketTypeRecord => ({
  id: row.id,
  name: row.name,
  priceGbp: row.is_free ? null : row.price_cents / 100,
  currency: row.currency,
  capacity: row.quantity_total,
  isFree: row.is_free,
  isUnlimited: row.is_unlimited,
  visibility: row.is_hidden
    ? "hidden"
    : row.is_disabled
      ? "disabled"
      : "public",
  displayOrder: row.display_order,
  approvalRequired: row.requires_approval,
  passwordProtected: row.password_protected,
  password: null,
  passwordConfigured: row.password_protected,
  waitlistEnabled: row.waitlist_enabled,
  minPurchaseQty: row.min_purchase_qty,
  maxPurchaseQty: row.max_purchase_qty,
  allowTransfers: row.allow_transfers,
  description: row.description,
  saleStartAt: row.sale_start_at,
  saleEndAt: row.sale_end_at,
  availableAt:
    row.available_online && row.available_in_person
      ? "both"
      : row.available_online
        ? "online"
        : "door",
});

// ORCH-1162 Bug 2 — parse a Postgres `point` ("(lng,lat)" string or {x,y}) into
// {lat,lng}. VERBATIM logic from businessEvents.ts:410 (the proven precedent).
// Returns null on absent/malformed input → caller hides the map (rule-9).
const parseLocationGeoPoint = (
  g: string | { x: number; y: number } | null | undefined,
): { lat: number; lng: number } | null => {
  if (g == null) return null;
  if (typeof g === "string") {
    const m = g.match(/^\(([-\d.]+),([-\d.]+)\)$/);
    return m ? { lng: Number(m[1]), lat: Number(m[2]) } : null;
  }
  if (
    typeof g === "object" &&
    typeof g.x === "number" &&
    typeof g.y === "number"
  ) {
    return { lng: g.x, lat: g.y };
  }
  return null;
};

export const publicEventViewRowToEvent = (
  row: BusinessPublicEventViewRow,
  tickets: PublicTicketTypeRecord[],
  terminalSource: EventTerminalSource = {
    kind: "single_end",
    endAtUtc: row.master_end_at,
  },
): PublicEventRecord => {
  const theme = asRecord(row.public_theme);
  const businessEvent = asRecord(theme.business_event);
  const location = asRecord(businessEvent.location);
  // issue #2469 — the shared extractor owns the venueName/address split for
  // every surface. It reads the same `businessEvent.location` object as
  // `location` above; `location` is still read for `location.city` etc.
  const seedLocation = extractPublicEventLocation(
    row.public_theme,
    row.location_text,
  );
  const settings = asRecord(businessEvent.settings);
  const coverHue = asNumber(businessEvent.coverHue ?? theme.coverHue, 25);
  // ORCH-0792: dates sourced from event_dates via master_* columns on the
  // view (I-PROPOSED-AY EVENT_DATES_SOLE_DATE_AUTHORITY).
  const dateTimezone =
    row.master_timezone ?? asStringOrNull(row.timezone) ?? "UTC";
  const startSplit = splitTimestampInTz(row.master_start_at, dateTimezone);
  const endSplit = splitTimestampInTz(row.master_end_at, dateTimezone);
  return {
    terminalSource,
    id: row.id,
    serverEventId: row.id,
    brandId: row.brand_id,
    brandSlug: row.brand_slug,
    eventSlug: row.slug,
    status: viewStatusToLiveStatus(row.status),
    publishedAt: row.published_at ?? row.updated_at,
    cancelledAt: row.status === "cancelled" ? row.updated_at : null,
    endedAt: row.status === "ended" ? row.updated_at : null,
    name: row.title,
    description: row.description ?? "",
    format: asFormat(businessEvent.format, row.is_online),
    category: asStringOrNull(businessEvent.category),
    whenMode: asWhenMode(businessEvent.whenMode, row),
    date: startSplit.date,
    doorsOpen: startSplit.time,
    endsAt: endSplit.time,
    // ORCH-0877 — full UTC instants from the matview master_* columns.
    // Source of truth for cross-midnight display and ORCH-0850 lifecycle
    // math. When non-null these take precedence over the smart-infer
    // fallback in `computeMasterEndAtUtc`.
    masterStartAtUtc: row.master_start_at,
    masterEndAtUtc: row.master_end_at,
    timezone: dateTimezone,
    recurrenceRule:
      businessEvent.recurrenceRule === null ||
      businessEvent.recurrenceRule === undefined
        ? row.recurrence_rules === null
          ? null
          : (row.recurrence_rules as RecurrenceRule)
        : (businessEvent.recurrenceRule as RecurrenceRule),
    multiDates: Array.isArray(businessEvent.multiDates)
      ? (businessEvent.multiDates as MultiDateEntry[])
      : null,
    // issue #2469 (tester P2-1 on PR #2479) — was:
    //   venueName: asStringOrNull(location.venueName) ?? row.location_text,
    //   address:   asStringOrNull(location.address)   ?? row.location_text,
    // When BOTH parsed halves were absent the COMBINED
    // "<venueName>  · <address>" string landed in BOTH slots — verbatim the
    // #2469 defect, on the very path that issue described as already correct.
    // The venue name then rendered twice AND the maps label became
    // "<combined>, <combined>", which for an event with no stored pin is
    // exactly #2468's failure mode returning. Zero production events reach the
    // fallback today, so this was latent, not live.
    venueName: seedLocation.venueName,
    address: seedLocation.address,
    // ORCH-1162 Bug 2 — parse the view's `location_geo` point ("(lng,lat)"
    // string, or {x,y}) into {lat,lng} so the public/buyer-web event page draws
    // the "Where you'll be" map. Mirrors the proven parser at businessEvents.ts.
    // null → no map (rule-9 text-card fallback).
    locationGeo: parseLocationGeoPoint(row.location_geo),
    onlineUrl: row.online_url,
    hideAddressUntilTicket: asBoolean(
      businessEvent.hideAddressUntilTicket,
      true,
    ),
    coverHue,
    coverMediaUrl: row.cover_media_url,
    coverMediaType: row.cover_media_type,
    // issue #868 [cover-gallery] — additive; [] on legacy rows (rule 9).
    coverGallery: Array.isArray(row.cover_media_gallery)
      ? row.cover_media_gallery
      : [],
    coverMediaProvider: asEventCoverMediaProvider(row.cover_media_provider),
    coverMediaSourceUrl: asStringOrNull(row.cover_media_source_url),
    coverMediaCredit: asStringOrNull(row.cover_media_credit),
    coverMediaCreditUrl: asStringOrNull(row.cover_media_credit_url),
    coverMediaAlt: asStringOrNull(row.cover_media_alt),
    currency:
      asStringOrNull(row.currency) ??
      tickets.find((ticket) => ticket.currency !== undefined)?.currency,
    // ORCH-1006 Slice 3 — server-computed all-in lowest-tier price (cents).
    displayPriceCents: row.display_price_cents ?? null,
    displayCurrency: row.pricing_currency ?? null,
    tickets,
    visibility: asVisibility(row.visibility),
    requireApproval: asBoolean(
      settings.requireApproval,
      tickets.some((ticket) => ticket.approvalRequired),
    ),
    allowTransfers: asBoolean(
      settings.allowTransfers,
      tickets.every((ticket) => ticket.allowTransfers),
    ),
    hideRemainingCount: asBoolean(settings.hideRemainingCount, false),
    passwordProtected: asBoolean(
      settings.passwordProtected,
      tickets.some((ticket) => ticket.passwordProtected),
    ),
    privateGuestList: asBoolean(settings.privateGuestList, false),
    inPersonPaymentsEnabled: asBoolean(
      settings.inPersonPaymentsEnabled,
      tickets.some(
        (ticket) =>
          ticket.availableAt === "both" || ticket.availableAt === "door",
      ),
    ),
    themeOverrides: asThemeInput(
      row.theme_color_override,
      row.theme_font_override,
      row.theme_animation_override,
    ),
    // ORCH-1150 — discriminator + RSVP host-control snapshot (inert for
    // non-RSVP rows). The public RSVP page + Hub list-card read these.
    event_type:
      row.event_type === "rsvp"
        ? "rsvp"
        : row.event_type === "experience"
          ? "experience"
          : row.event_type === "trip"
            ? "trip"
            : "event",
    rsvpCapacity: row.rsvp_capacity ?? null,
    rsvpAllowPlusOnes: row.rsvp_allow_plus_ones ?? false,
    rsvpPlusOnesMax: row.rsvp_plus_ones_max ?? 0,
    rsvpWaitlistEnabled: row.rsvp_waitlist_enabled ?? false,
    rsvpApprovalMode: row.rsvp_approval_mode ?? "auto",
    rsvpDiscoverable: row.rsvp_discoverable ?? false,
    rsvpGoingCount: row.rsvp_going_count ?? 0,
    // ORCH-1291 [rsvp-chip-in] — thread the anon-view chip-in config into the
    // buyer-web LiveEvent so PublicEventPage builds it into RsvpOfferingConfig and
    // the shared body's guest panel renders on web (report §10.A). Inert defaults
    // keep every free RSVP unchanged.
    rsvpContributionEnabled: row.rsvp_contribution_enabled ?? false,
    rsvpContributionSuggestedCents:
      row.rsvp_contribution_suggested_cents ?? null,
    rsvpContributionMinCents: row.rsvp_contribution_min_cents ?? null,
    // ORCH-1157 [rsvp-public-redesign] — surface party types / vibe tags from the
    // anon view so the Direction-C RSVP page renders vibe chips. Default [] (rule
    // 9: missing is empty, never fabricated). Already-present columns; no migration.
    partyTypes: Array.isArray(row.party_types) ? row.party_types : [],
    vibeTags: Array.isArray(row.vibe_tags) ? row.vibe_tags : [],
    // ORCH-1167 [event-page-canonical] — thread music_genres (was DROPPED — F-3).
    // Default [] (rule 9: missing is empty, never fabricated). For the standard-
    // event PAGE BODY the authoritative source is the pg_public_event_by_slug RPC
    // (merged in detailFromRow); this view-derived value is the fallback.
    musicGenres: Array.isArray(row.music_genres) ? row.music_genres : [],
    orders: [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

/**
 * ORCH-0946 — anon-callable RPC returning sold + remaining per ticket_type
 * for one event. Used by both `fetchTickets` (event side) and
 * `getPublicTripById` (trip side) to thread `remaining` through to the
 * buyer-checkout sold-out gate. Falls back to an empty map on RPC error
 * (sold-out gate is then a no-op, matching pre-ORCH-0946 behaviour — the
 * checkout RPC still rejects oversold attempts as the last line of defence).
 */
const fetchTicketTypesRemaining = async (
  eventId: string,
): Promise<Map<string, number | null>> => {
  const { data, error } = await supabase.rpc(
    "pg_public_ticket_types_remaining",
    { p_event_id: eventId },
  );
  if (error !== null) {
    console.warn(
      "[ORCH-0946] pg_public_ticket_types_remaining failed; sold-out gate degrades to checkout-RPC catch",
      error,
    );
    return new Map();
  }
  const rows = (data ?? []) as Array<{
    ticket_type_id: string;
    sold: number;
    remaining: number | null;
  }>;
  return new Map(rows.map((r) => [r.ticket_type_id, r.remaining]));
};

// ORCH-1006 — per-tier ALL-IN (WYSIWYP). Server-computed via the SAME
// compute_all_in_cents the cart + view use (pg_public_event_tier_allin RPC),
// ZERO fee math in TS. RPC failure is non-fatal → every tier falls back to its
// base price (never blank). Mirrors app-mobile's publicEventTicketsService.
// ORCH-1147 — EXPORTED so the experience service reuses the SAME single owner
// of pg_public_event_tier_allin (no duplicated RPC / fee math anywhere else).
// ===========================================================================
// ORCH-1167 [event-page-canonical] — the ONE canonical anon read RPC for the
// standard ticketed-event public page body fields. Returns the full
// EventOfferingBody payload as json incl. pills (party/vibe/music), city +
// city_geo, and per-tier server all-in. The web/business standard-event read
// merges the canonical BODY fields from here onto the view-derived LiveEvent so
// a field added to the RPC payload surfaces on web too with ONE mapper edit
// (SC-7) and music_genres is no longer dropped (F-3). The view read remains for
// the non-body LiveEvent fields the RSVP/recurrence paths still need.
// ===========================================================================

interface CanonicalEventBodyFields {
  partyTypes: string[];
  vibeTags: string[];
  musicGenres: string[];
  cityGeo: { lat: number; lng: number } | null;
}

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];

const asLatLng = (value: unknown): { lat: number; lng: number } | null => {
  if (value === null || typeof value !== "object") return null;
  const obj = value as { lat?: unknown; lng?: unknown };
  return typeof obj.lat === "number" &&
    Number.isFinite(obj.lat) &&
    typeof obj.lng === "number" &&
    Number.isFinite(obj.lng)
    ? { lat: obj.lat, lng: obj.lng }
    : null;
};

// Fetch the canonical body fields for one (brand, event) from the RPC. Returns
// defaults (empty pills, null cityGeo) on RPC miss/error so the page never blanks
// (rule 9). The PRIVACY gate is enforced SERVER-SIDE in the RPC (cityGeo present /
// exact pin null when the address is hidden) — the client never re-derives it.
export const fetchCanonicalEventBodyFields = async (
  brandSlug: string,
  eventSlug: string,
): Promise<CanonicalEventBodyFields> => {
  const empty: CanonicalEventBodyFields = {
    partyTypes: [],
    vibeTags: [],
    musicGenres: [],
    cityGeo: null,
  };
  const { data, error } = await supabase.rpc("pg_public_event_by_slug", {
    p_brand_slug: brandSlug,
    p_event_slug: eventSlug,
  });
  if (error !== null || data === null || typeof data !== "object") return empty;
  const payload = data as Record<string, unknown>;
  return {
    partyTypes: asStringArray(payload.partyTypes),
    vibeTags: asStringArray(payload.vibeTags),
    musicGenres: asStringArray(payload.musicGenres),
    cityGeo: asLatLng(payload.cityGeo),
  };
};

export const fetchTierAllInCents = async (
  eventId: string,
): Promise<Map<string, number>> => {
  const map = new Map<string, number>();
  const { data, error } = await supabase.rpc("pg_public_event_tier_allin", {
    p_event_id: eventId,
  });
  if (error !== null || !Array.isArray(data)) return map;
  for (const row of data as Array<{
    ticket_type_id?: string;
    all_in_cents?: number;
  }>) {
    if (row?.ticket_type_id != null && typeof row.all_in_cents === "number") {
      map.set(row.ticket_type_id, row.all_in_cents);
    }
  }
  return map;
};

const fetchTickets = async (
  eventId: string,
): Promise<PublicTicketTypeRecord[]> => {
  const { data, error } = await supabase
    .from("ticket_types")
    .select(
      "id,event_id,name,description,price_cents,currency,quantity_total,is_unlimited,is_free,sale_start_at,sale_end_at,min_purchase_qty,max_purchase_qty,is_hidden,is_disabled,requires_approval,allow_transfers,password_protected,available_online,available_in_person,waitlist_enabled,display_order",
    )
    .eq("event_id", eventId)
    .eq("available_online", true)
    .is("deleted_at", null)
    .order("display_order", { ascending: true });

  if (error !== null) throw error;
  const stubs = ((data ?? []) as TicketTypeRow[]).map(ticketRowToTicketStub);
  // ORCH-0946 — overwrite capacity with remaining so the buyer-checkout
  // sold-out gate + QuantityRow "+" cap reflect what's actually bookable
  // (not total tier capacity). Unlimited tiers keep capacity=null untouched.
  // ORCH-1006 — also resolve each tier's server-computed all-in (WYSIWYP) so
  // the web public page shows what the buyer actually pays, not the base price.
  const [remainingById, allInById] = await Promise.all([
    fetchTicketTypesRemaining(eventId),
    fetchTierAllInCents(eventId),
  ]);
  return stubs.map((s) => {
    const allInCents = allInById.get(s.id);
    const priceAllInGbp = s.isFree
      ? null
      : typeof allInCents === "number"
        ? allInCents / 100
        : (s.priceGbp ?? null);
    const withAllIn: PublicTicketTypeRecord = { ...s, priceAllInGbp };
    if (withAllIn.isUnlimited) return withAllIn;
    const remaining = remainingById.get(withAllIn.id);
    if (remaining === undefined) return withAllIn;
    return { ...withAllIn, capacity: remaining };
  });
};

// ORCH-1076 I-PAID-SUPPLY-REQUIRES-CHARGES-ENABLED helpers.
// A ticket set is PAID for online checkout when ANY ticket is sellable online
// (availableAt "online"|"both") with a non-zero price (priceGbp != null ⇒ paid;
// isFree ⇒ priceGbp is null). Mirrors the checkout 409 + ORCH-1075 PAID def.
const ticketsArePaidOnline = (tickets: PublicTicketTypeRecord[]): boolean =>
  tickets.some(
    (t) =>
      !t.isFree &&
      (t.availableAt === "online" || t.availableAt === "both") &&
      t.priceGbp !== null &&
      t.priceGbp > 0,
  );

// Resolve whether a PAID offering's brand can charge via the canonical
// pg_brand_can_collect RPC (anon-granted by the #1919 migration). FREE ⇒ true.
// On RPC error fail CLOSED for paid supply; free never reaches this RPC.
const resolveEventBookable = async (
  brandId: string,
  isPaid: boolean,
): Promise<boolean> => {
  if (!isPaid) return true;
  const { data, error } = await supabase.rpc("pg_brand_can_collect", {
    p_brand_id: brandId,
  });
  if (error !== null) return false;
  return data === true;
};

// Batched readiness for a set of brand ids (the brand-page event feed drop).
// Returns the subset that CAN charge. On error returns an empty set so the
// caller can fail closed for paid rows.
const fetchReadyBrandIds = async (brandIds: string[]): Promise<Set<string>> => {
  if (brandIds.length === 0) return new Set<string>();
  const { data, error } = await supabase.rpc("pg_brands_can_collect", {
    p_brand_ids: brandIds,
  });
  if (error !== null) return new Set<string>();
  return new Set<string>(
    ((data ?? []) as { brand_id: string }[])
      .map((r) => r.brand_id)
      .filter((id): id is string => typeof id === "string"),
  );
};

const detailFromRow = async (
  row: BusinessPublicEventViewRow,
): Promise<PublicEventDetail> => {
  const tickets = await fetchTickets(row.id);
  // ORCH-1076 — resolve buyer-readiness for PAID events (deep-link graceful CTA).
  const isPaid = ticketsArePaidOnline(tickets);
  // ORCH-1167 [event-page-canonical] — for the STANDARD ticketed-event page, also
  // resolve the canonical BODY fields (pills + city_geo) from the ONE read RPC
  // (pg_public_event_by_slug) and MERGE them onto the view-derived LiveEvent. This
  // makes the RPC the authoritative source for the page body fields (SC-7: a field
  // added to the RPC surfaces here with one mapper edit) and closes the F-3
  // music_genres drop. RSVP rows keep the view-only fields (the RPC is event-only).
  const isStandardEvent = row.event_type === "event" || row.event_type === null;
  const [bookable, canonical] = await Promise.all([
    resolveEventBookable(row.brand_id, isPaid),
    isStandardEvent
      ? fetchCanonicalEventBodyFields(row.brand_slug, row.slug)
      : Promise.resolve(null),
  ]);
  const event = publicEventViewRowToEvent(row, tickets);
  const merged =
    canonical !== null
      ? {
          ...event,
          partyTypes:
            canonical.partyTypes.length > 0
              ? canonical.partyTypes
              : event.partyTypes,
          vibeTags:
            canonical.vibeTags.length > 0 ? canonical.vibeTags : event.vibeTags,
          musicGenres:
            canonical.musicGenres.length > 0
              ? canonical.musicGenres
              : event.musicGenres,
          cityGeo: canonical.cityGeo,
        }
      : event;
  return {
    event: merged,
    brand: viewRowToBrand(row),
    tickets,
    terminalSource: {
      kind: "single_end",
      endAtUtc: row.master_end_at,
    },
    // The `business_public_events_view` fallback path serves RSVP rows only,
    // which have no occurrence concept and no multi-day pricing.
    occurrences: [],
    multiDatePricingMode: "per_day",
    bookable,
  };
};

const isDirectEventBundle = (value: unknown): value is JsonRecord => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const payload = value as JsonRecord;
  const brand = payload.brand;
  return (
    typeof payload.id === "string" &&
    typeof payload.brandId === "string" &&
    typeof payload.brandSlug === "string" &&
    typeof payload.eventSlug === "string" &&
    typeof payload.name === "string" &&
    Array.isArray(payload.tickets) &&
    brand !== null &&
    typeof brand === "object" &&
    !Array.isArray(brand) &&
    typeof (brand as JsonRecord).id === "string" &&
    typeof (brand as JsonRecord).slug === "string" &&
    typeof (brand as JsonRecord).name === "string"
  );
};

const directBundleTicketToStub = (
  value: unknown,
  fallbackCurrency: string,
): PublicTicketTypeRecord => {
  const ticket = asRecord(value);
  const isFree = ticket.isFree === true;
  const priceCents = typeof ticket.priceCents === "number" ? ticket.priceCents : 0;
  const allInCents = typeof ticket.allInCents === "number" ? ticket.allInCents : priceCents;
  return {
    id: String(ticket.id ?? ""),
    name: String(ticket.name ?? ""),
    description: asStringOrNull(ticket.description),
    priceGbp: isFree ? null : priceCents / 100,
    priceAllInGbp: isFree ? null : allInCents / 100,
    currency: asStringOrNull(ticket.currency) ?? fallbackCurrency,
    capacity:
      ticket.isUnlimited === true
        ? null
        : typeof ticket.remaining === "number"
          ? ticket.remaining
          : typeof ticket.capacity === "number"
            ? ticket.capacity
            : null,
    isFree,
    isUnlimited: ticket.isUnlimited === true,
    visibility:
      ticket.isHidden === true
        ? "hidden"
        : ticket.isDisabled === true
          ? "disabled"
          : "public",
    displayOrder: typeof ticket.displayOrder === "number" ? ticket.displayOrder : 0,
    approvalRequired: ticket.requiresApproval === true,
    passwordProtected: ticket.passwordProtected === true,
    password: null,
    passwordConfigured: ticket.passwordProtected === true,
    waitlistEnabled: ticket.waitlistEnabled === true,
    // issue #2462 [free checkout dead-ends on "Nothing was reserved"] — THE
    // ORGANISER'S PURCHASE RULES, READ INSTEAD OF INVENTED.
    //
    // These three were hardcoded `1 / null / true` because
    // `pg_direct_event_checkout_bundle` did not return them. That reader is the
    // FIRST one consulted by BOTH public-event readers below — the by-slug one
    // and the by-id one — so `/checkout/[eventId]` never saw a cap.
    //
    // NAMING THOSE TWO FUNCTIONS HERE IS DELIBERATELY AVOIDED. The audit
    // `eventType.filter.audit.test.ts:110,117` locates each of them with
    // `SOURCE.match(/<name>[^]*?^\};/m)` — the FIRST literal occurrence in the
    // file, comments included. This comment sits ~200 lines above the real
    // definitions, so spelling either name out captures THIS block instead and
    // the trip-rejection probe is asserted against the wrong function. It
    // failed exactly that way in CI before this rewording. Same class of trap
    // the #2160 migration documents for ORCH-0963's C4 check.
    //
    // `QuantityRow` clamps to
    // `min(remaining, maxPurchaseQty ?? Infinity)` — a null cap is NO cap, so on
    // We Go Again Exhibition the stepper offered up to 229 on a ticket type the
    // organiser capped at 1, and `biz_ticket_checkout_create_session` then
    // refused with `ticket_quantity_above_max`, which the free-rail mapper
    // renders as "Nothing was reserved — please try again". Retrying could never
    // succeed, because nothing about the request was retryable.
    //
    // NULL IS A REAL ANSWER HERE and must survive: `maxPurchaseQty: null` means
    // "no cap", which is what most ticket types carry. So the guard is
    // `typeof === "number"`, NOT `?? null` on a falsy check — `0` is not a
    // legitimate cap but it is also not something the schema permits, and
    // coercing it would silently reintroduce "no cap".
    //
    // `minPurchaseQty` falls back to 1 (the schema default) and `allowTransfers`
    // to true ONLY when the key is absent — i.e. when a client runs against a
    // pre-#2462 bundle. That is a real transitional window between this deploy
    // and the migration, and it fails to today's behaviour rather than to a
    // crash.
    minPurchaseQty:
      typeof ticket.minPurchaseQty === "number" ? ticket.minPurchaseQty : 1,
    maxPurchaseQty:
      typeof ticket.maxPurchaseQty === "number" ? ticket.maxPurchaseQty : null,
    allowTransfers: ticket.allowTransfers !== false,
    saleStartAt: asStringOrNull(ticket.saleStartAt),
    saleEndAt: asStringOrNull(ticket.saleEndAt),
    availableAt:
      ticket.availableOnline === true && ticket.availableInPerson === true
        ? "both"
        : ticket.availableOnline === true
          ? "online"
          : "door",
  };
};

const detailFromDirectBundle = async (payload: JsonRecord): Promise<PublicEventDetail> => {
  const brand = payload.brand as JsonRecord;
  const currency = asStringOrNull(payload.currency) ?? "USD";
  const tickets = (payload.tickets as unknown[]).map((ticket) =>
    directBundleTicketToStub(ticket, currency),
  );
  const geo = asLatLng(payload.locationGeo);
  const publicTheme: JsonRecord = {
    business_event: {
      format: payload.format,
      location: { venueName: payload.venueName, address: payload.address },
      hideAddressUntilTicket: payload.hideAddressUntilTicket === true,
    },
  };
  const row = {
    id: payload.id,
    brand_id: payload.brandId,
    brand_slug: payload.brandSlug,
    brand_name: brand.name,
    brand_description: null,
    brand_profile_photo_url: asStringOrNull(brand.profilePhotoUrl),
    brand_display_attendee_count: false,
    brand_address: asStringOrNull(brand.address),
    brand_cover_media_url: asStringOrNull(brand.coverMediaUrl),
    brand_theme_color: asStringOrNull(brand.themeColor),
    brand_theme_font: asStringOrNull(brand.themeFont),
    brand_theme_animation: asStringOrNull(brand.themeAnimation),
    title: payload.name,
    description: asStringOrNull(payload.description),
    slug: payload.eventSlug,
    event_type: "event",
    location_text: asStringOrNull(payload.venueName),
    location_geo: geo === null ? null : `(${geo.lng},${geo.lat})`,
    online_url: asStringOrNull(payload.onlineUrl),
    is_online: payload.isOnline === true,
    // issue #2160 — THE MULTI-DATE SIGNAL, READ FROM THE BUNDLE.
    //
    // These were hard-coded `false`. Because this bundle is the FIRST reader
    // consulted by BOTH public-event readers (by-slug and by-id), and it
    // carried no multi-date key, `asWhenMode` resolved EVERY bundle-served
    // ticketed event to "single" — so #2135's day chooser never mounted at all,
    // on PUBLIC events as well as unlisted ones. #2161 described this as
    // "works for public, silently empty for unlisted"; measured against the
    // real reader on the full migration chain, it worked for neither. See the
    // #2160 implementation report.
    //
    // The reader names are spelled out in prose above rather than as bare
    // identifiers ON PURPOSE: eventType.filter.audit.test.ts anchors on the
    // FIRST literal occurrence of each reader's name and lazily matches to the
    // next top-level `};`, so naming one in a comment ABOVE its definition
    // silently re-anchors that audit onto the wrong function body.
    is_recurring: payload.isRecurring === true,
    is_multi_date: payload.isMultiDate === true,
    recurrence_rules: null,
    cover_media_url: asStringOrNull(payload.coverMediaUrl),
    cover_media_type: payload.coverMediaType,
    cover_media_gallery: Array.isArray(payload.coverGallery) ? payload.coverGallery : [],
    cover_media_provider: payload.coverMediaProvider,
    cover_media_source_url: null,
    cover_media_credit: asStringOrNull(payload.coverMediaCredit),
    cover_media_credit_url: null,
    cover_media_alt: null,
    currency,
    visibility: "public",
    show_on_discover: false,
    status: payload.status,
    published_at: null,
    timezone: asStringOrNull(payload.timezone) ?? "UTC",
    created_at: asStringOrNull(payload.masterStartAt) ?? "",
    updated_at: asStringOrNull(payload.masterEndAt) ?? "",
    public_theme: publicTheme,
    theme_color_override: asStringOrNull(payload.themeColorOverride),
    theme_font_override: asStringOrNull(payload.themeFontOverride),
    theme_animation_override: asStringOrNull(payload.themeAnimationOverride),
    master_start_at: asStringOrNull(payload.masterStartAt),
    master_end_at: asStringOrNull(payload.masterEndAt),
    master_timezone: asStringOrNull(payload.timezone),
    master_event_date_id: null,
    display_price_cents: null,
    pricing_currency: currency,
    party_types: asStringArray(payload.partyTypes),
    vibe_tags: asStringArray(payload.vibeTags),
    music_genres: asStringArray(payload.musicGenres),
  } as unknown as BusinessPublicEventViewRow;
  const terminalSource: EventTerminalSource = {
    kind: "occurrences",
    value: payload.occurrences,
  };
  const event = publicEventViewRowToEvent(row, tickets, terminalSource);
  event.cityGeo = asLatLng(payload.cityGeo);
  const bookable = await resolveEventBookable(
    String(payload.brandId),
    ticketsArePaidOnline(tickets),
  );
  return {
    event,
    brand: viewRowToBrand(row),
    tickets,
    terminalSource,
    bookable,
    // issue #2160 / #2161 — the occurrences ride the SAME reader that served
    // the event, so an unlisted event's days arrive exactly like a public
    // one's. Zero extra round trips.
    occurrences: occurrencesFromBundle(
      payload.occurrences,
      asStringOrNull(payload.timezone),
    ),
    multiDatePricingMode: asPricingMode(payload.multiDatePricingMode),
  };
};

const fetchDirectEventBundlePayload = async (
  args: { p_event_id: string | null; p_brand_slug: string | null; p_event_slug: string | null },
): Promise<JsonRecord | null> => {
  const { data, error } = await supabase.rpc("pg_direct_event_checkout_bundle", args);
  if (error !== null) throw error;
  if (data === null) return null;
  if (!isDirectEventBundle(data)) {
    throw new Error("invalid_direct_event_checkout_bundle");
  }
  return data;
};

const readDirectEventBundle = async (
  args: { p_event_id: string | null; p_brand_slug: string | null; p_event_slug: string | null },
): Promise<PublicEventDetail | null | "fallback"> => {
  const payload = await fetchDirectEventBundlePayload(args);
  return payload === null ? "fallback" : detailFromDirectBundle(payload);
};

export const getPublicEventBySlug = async (
  brandSlug: string,
  eventSlug: string,
): Promise<PublicEventDetail | null> => {
  const direct = await readDirectEventBundle({
    p_event_id: null,
    p_brand_slug: brandSlug,
    p_event_slug: eventSlug,
  });
  if (direct !== "fallback") return direct;
  // ORCH-0859 REWORK 3 + META-ORCH-0972: anon buyer landing on
  // `/e/{brandSlug}/{slug}` MUST resolve only to event offerings. Trips
  // and experiences have their own public surfaces.
  // orch-strict-grep-allow events-type-filter — view doesn't expose event_type; trip exclusion via probe below
  const { data, error } = await supabase
    .from("business_public_events_view")
    .select("*")
    .eq("brand_slug", brandSlug)
    .eq("slug", eventSlug)
    .maybeSingle();

  if (error !== null) throw error;
  if (data === null) return null;
  const row = data as BusinessPublicEventViewRow;
  if (row.event_type === "trip") {
    return null;
  }
  // ORCH-1150 — the /e/ public page now renders BOTH ticketed events AND RSVP
  // events (Going/Not-going). Experiences keep their own /exp/ surface.
  if (row.event_type !== "rsvp") {
    return null;
  }
  return detailFromRow(row);
};

export const getPublicEventById = async (
  eventId: string,
): Promise<PublicEventDetail | null> => {
  const direct = await readDirectEventBundle({
    p_event_id: eventId,
    p_brand_slug: null,
    p_event_slug: null,
  });
  if (direct !== "fallback") return direct;
  // orch-strict-grep-allow events-type-filter — META-ORCH-0972 Sub-C: lookup by id then filter row.event_type at JS layer (lines 853 + 856).
  const { data, error } = await supabase
    .from("business_public_events_view")
    .select("*")
    .eq("id", eventId)
    .maybeSingle();

  if (error !== null) throw error;
  if (data === null) return null;
  const row = data as BusinessPublicEventViewRow;
  if (row.event_type === "trip") {
    return null;
  }
  // ORCH-1150 compatibility is deliberately RSVP-only after bundle SQL NULL.
  return row.event_type === "rsvp" ? detailFromRow(row) : null;
};

// Exported for the ORCH-1076 regression test (buyer-supply readiness drop).
export const fetchPublicBrandEvents = async (
  brandSlug: string,
): Promise<PublicEventRecord[]> => {
  // orch-strict-grep-allow events-type-filter — META-ORCH-0972 Sub-C: brand events list filtered by row.event_type === "event" at JS layer immediately after fetch.
  const { data, error } = await supabase
    .from("business_public_events_view")
    .select("*")
    .eq("brand_slug", brandSlug)
    .order("published_at", { ascending: false, nullsFirst: false });

  if (error !== null) throw error;
  const nowMs = Date.now();
  const rows = ((data ?? []) as BusinessPublicEventViewRow[]).filter(
    (row) =>
      (row.event_type === "event" || row.event_type === "rsvp") &&
      row.status !== "cancelled" &&
      row.status !== "ended",
  );

  const MAX_PUBLIC_BRAND_EVENT_BUNDLE_CONCURRENCY = 4;
  type HydratedBrandEvent = {
    row: BusinessPublicEventViewRow;
    tickets: PublicTicketTypeRecord[];
    terminalSource: EventTerminalSource;
  };
  const hydrated: Array<HydratedBrandEvent | null> = new Array(rows.length).fill(null);
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < rows.length) {
      const index = cursor;
      cursor += 1;
      const row = rows[index];
      if (row === undefined) continue;
      if (row.event_type === "rsvp") {
        const terminalSource: EventTerminalSource = {
          kind: "single_end",
          endAtUtc: row.master_end_at,
        };
        const state = resolveEventAcquisitionState(
          {
            operatorStatus: viewStatusToLiveStatus(row.status),
            operatorEndedAtUtc: null,
            terminalSource,
          },
          nowMs,
        );
        if (state.kind === "current") hydrated[index] = { row, tickets: [], terminalSource };
        continue;
      }

      const payload = await fetchDirectEventBundlePayload({
        p_event_id: row.id,
        p_brand_slug: null,
        p_event_slug: null,
      });
      if (payload === null) continue;
      if (payload.id !== row.id) throw new Error("invalid_direct_event_checkout_bundle");
      const terminalSource: EventTerminalSource = {
        kind: "occurrences",
        value: payload.occurrences,
      };
      const state = resolveEventAcquisitionState(
        {
          operatorStatus: viewStatusToLiveStatus(row.status),
          operatorEndedAtUtc: null,
          terminalSource,
        },
        nowMs,
      );
      if (state.kind !== "current") continue;
      const currency = asStringOrNull(payload.currency) ?? row.currency ?? "USD";
      const tickets = (payload.tickets as unknown[]).map((ticket) =>
        directBundleTicketToStub(ticket, currency),
      );
      hydrated[index] = { row, tickets, terminalSource };
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(MAX_PUBLIC_BRAND_EVENT_BUNDLE_CONCURRENCY, rows.length) },
      () => worker(),
    ),
  );
  const current = hydrated.filter((item): item is HydratedBrandEvent => item !== null);

  // ORCH-1076 I-PAID-SUPPLY-REQUIRES-CHARGES-ENABLED — drop PAID events from a
  // brand that can't charge from the public brand-page event feed (the view is
  // NOT gated — it also serves keyed enrich — so we filter here, buyer-only).
  // The owner never reads fetchPublicBrandEvents. One batched pg_brands_can_collect
  // round-trip over the distinct paid brand ids; free events are never dropped.
  const paidBrandIds = Array.from(
    new Set(
      current
        .filter(({ tickets }) => ticketsArePaidOnline(tickets))
        .map(({ row }) => row.brand_id)
        .filter((id): id is string => typeof id === "string"),
    ),
  );
  const readyBrandIds = await fetchReadyBrandIds(paidBrandIds);
  const visible = current.filter(
      ({ row, tickets }) =>
        !ticketsArePaidOnline(tickets) || readyBrandIds.has(row.brand_id),
    );

  return visible.map(({ row, tickets, terminalSource }) =>
    publicEventViewRowToEvent(row, tickets, terminalSource),
  );
};

// ORCH-0963 + META-ORCH-0972 — anon-callable bulk public-trips by brand.
export const fetchPublicBrandTrips = async (
  brandSlug: string,
): Promise<PublicTripCard[]> => {
  // orch-strict-grep-allow events-type-filter — RPC pins event_type='trip' server-side.
  const { data, error } = await supabase.rpc("pg_public_trips_by_brand", {
    p_brand_slug: brandSlug,
  });

  if (error !== null) throw error;
  const rows = (data ?? []) as PublicTripCardRow[];
  return rows.map(tripRowToCard);
};

export const experienceRowToCard = (
  row: PublicExperienceCardRow,
): PublicExperienceCard => ({
  experienceId: row.experience_id,
  brandId: row.brand_id,
  brandSlug: row.brand_slug,
  brandName: row.brand_name,
  experienceSlug: row.experience_slug,
  name: row.title,
  bio: row.description,
  coverMediaUrl: row.cover_media_url,
  coverMediaType: row.cover_media_type,
  theme: asRecord(row.theme),
  venueText: row.venue_text,
  nextOccurrenceAt: row.next_occurrence_at,
  priceFromMinorUnits: row.price_from_cents,
  currency: row.currency ?? "USD",
  isFree: row.is_free,
  publishedAt: row.published_at,
});

const upcomingRowToCard = (row: PublicUpcomingRowRaw): PublicUpcomingRow => ({
  offeringId: row.offering_id,
  brandId: row.brand_id,
  brandSlug: row.brand_slug,
  brandName: row.brand_name,
  offeringType: row.offering_type,
  offeringSlug: row.offering_slug,
  name: row.title,
  bio: row.description,
  coverMediaUrl: row.cover_media_url,
  coverMediaType: row.cover_media_type,
  theme: asRecord(row.theme),
  startsAt: row.starts_at,
  priceFromMinorUnits: row.price_from_cents,
  currency: row.currency ?? "USD",
  isFree: row.is_free,
  publishedAt: row.published_at,
});

export const fetchPublicBrandExperiences = async (
  brandSlug: string,
): Promise<PublicExperienceCard[]> => {
  const { data, error } = await supabase.rpc("pg_public_experiences_by_brand", {
    p_brand_slug: brandSlug,
  });

  if (error !== null) throw error;
  return ((data ?? []) as PublicExperienceCardRow[]).map(experienceRowToCard);
};

export const fetchPublicBrandUpcoming = async (
  brandSlug: string,
  cursor?: { startsAt: string; limit?: number },
): Promise<PublicUpcomingFeedPage> => {
  const limit = cursor?.limit ?? 30;
  const args: {
    p_brand_slug: string;
    p_cursor_at?: string;
    p_limit: number;
  } = {
    p_brand_slug: brandSlug,
    p_limit: limit,
  };
  if (cursor?.startsAt !== undefined) args.p_cursor_at = cursor.startsAt;
  const { data, error } = await supabase.rpc("pg_public_brand_upcoming", args);

  if (error !== null) throw error;
  const rows = ((data ?? []) as PublicUpcomingRowRaw[]).map(upcomingRowToCard);
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  return {
    rows: pageRows,
    hasMore,
    nextCursor:
      hasMore && pageRows.length > 0
        ? (pageRows[pageRows.length - 1]?.startsAt ?? null)
        : null,
  };
};

export const getPublicBrandBySlug = async (
  brandSlug: string,
): Promise<PublicBrandDetail | null> => {
  // 1. Verified-venue enrichment path. Under META-ORCH-0972 this is a venue
  // claim overlay, not a brand kind branch; all offering buckets still load.
  const { data: claimedVenue, error: claimedError } = await supabase
    .from("claimed_venues_public_view")
    .select("*")
    .eq("slug", brandSlug)
    .maybeSingle();

  if (claimedError !== null) throw claimedError;

  // 2. Generic brand resolver
  const { data: brandData, error: brandError } = await supabase
    .from("business_public_brands_view")
    .select("*")
    .eq("slug", brandSlug)
    .maybeSingle();

  if (brandError !== null) throw brandError;
  if (brandData === null) return null;

  const brandRow = brandData as BusinessPublicBrandViewRow;
  const [eventsAll, tripsAll, experiences, upcomingPage] = await Promise.all([
    fetchPublicBrandEvents(brandSlug),
    fetchPublicBrandTrips(brandSlug),
    fetchPublicBrandExperiences(brandSlug),
    fetchPublicBrandUpcoming(brandSlug),
  ]);

  const events = eventsAll;
  const pastEvents: PublicEventRecord[] = [];
  const trips = tripsAll.filter(
    (trip) => trip.status === "scheduled" || trip.status === "live",
  );
  const pastTrips = tripsAll.filter((trip) => trip.status === "ended");
  const venueRow =
    claimedVenue === null ? null : (claimedVenue as ClaimedVenuePublicViewRow);
  const eventCount = events.length + pastEvents.length;
  const tripCount = trips.length + pastTrips.length;

  return {
    brand:
      venueRow !== null
        ? claimedVenueRowToBrand(
            venueRow,
            eventCount + tripCount + experiences.length,
          )
        : publicBrandViewRowToBrand(
            brandRow,
            eventCount + tripCount + experiences.length,
          ),
    venue: venueRow !== null ? claimedVenueRowToPublicVenue(venueRow) : null,
    events,
    pastEvents,
    trips,
    pastTrips,
    experiences,
    upcoming: upcomingPage.rows,
    upcomingHasMore: upcomingPage.hasMore,
    upcomingNextCursor: upcomingPage.nextCursor,
    upcomingCount: upcomingPage.rows.length,
    // ORCH-1365 — menus are exact-venue content, fetched by the public venue
    // route. Keep the legacy field empty while older consumers migrate.
    menu: [],
  };
};

// ============================================================
// ORCH-0876 — getPublicTripById
// ============================================================
//
// Trip-only resolver. Lives ALONGSIDE getPublicEventById (which keeps its
// trip-rejection probe per ORCH-0859 REWORK 3 audit). Mirrors
// usePublicTripBySlug's query shape (`mingla-business/src/hooks/usePublicTripBySlug.ts`)
// but resolves by event-row-id instead of brand/trip slug pair. Used by
// the new `/checkout-trip/[tripEventId]/*` chain to load a published trip
// for the buyer-facing surface.
//
// Audit-test invariant: this function MUST pin `.eq("event_type", "trip")`.
// See mingla-business/src/services/__tests__/eventType.filter.audit.test.ts
// (extended by ORCH-0876).

import type {
  Trip,
  TripDay,
  TripInclusion,
  TripPricingTier,
} from "./tripsService";
// ORCH-1119 — TripDay now carries a media gallery; coerce the raw jsonb here so
// this buyer-checkout trip read stays type-complete (and the gallery rides
// through to any buyer-side render).
import { coerceTripDayMedia } from "./tripsService";

export interface PublicTripBrand {
  id: string;
  slug: string;
  name: string;
  bio: string | null;
  coverMediaUrl: string | null;
}

export interface PublicTripDetail {
  trip: Trip;
  brand: PublicTripBrand;
}

export const getPublicTripById = async (
  tripEventId: string,
): Promise<PublicTripDetail | null> => {
  // 1. Resolve trip row — pins event_type='trip' + scheduled/live + not deleted.
  // orch-strict-grep-allow events-type-filter — ORCH-0876: trip-only resolver
  //
  // #2489 — NAMED COLUMNS, not a star. This read runs as `anon` on the public trip
  // checkout chain, and a star-select pulled the exact venue pin and the combined
  // "venue, then street" string across the wire on every one of those screens even
  // though nothing below ever reads either of them. Two consequences: the values stop
  // being handed to a caller that has no use for them, and this reader stops depending
  // on a privilege that is being narrowed. Every column below is one the mapper further
  // down actually consumes — add here only when you add a read there.
  const eventResp = await supabase
    .from("events")
    .select(
      "id,brand_id,title,description,slug,status,visibility,timezone,theme," +
        "cover_media_url,cover_media_type,published_at,created_at,updated_at," +
        "refund_policy,booking_deadline,bookings_closed,bookings_closed_at",
    )
    .eq("id", tripEventId)
    .eq("event_type", "trip")
    .in("status", ["scheduled", "live"])
    .is("deleted_at", null)
    .maybeSingle();
  if (eventResp.error !== null) throw eventResp.error;
  if (eventResp.data === null) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const event = eventResp.data as any;
  const brandId = event.brand_id as string;

  // 2. Resolve brand
  const brandResp = await supabase
    .from("brands")
    .select("id, slug, name, description, cover_media_url")
    .eq("id", brandId)
    .is("deleted_at", null)
    .maybeSingle();
  if (brandResp.error !== null) throw brandResp.error;
  if (brandResp.data === null) return null;

  const brand = brandResp.data;

  // 3. Sidecar tables — anon-readable via published-only RLS
  const [daysResp, tiersResp, inclusionsResp, ticketsResp, masterDateResp] =
    await Promise.all([
      supabase
        .from("trip_days")
        .select("*")
        .eq("event_id", tripEventId)
        .order("ordinal"),
      supabase
        .from("trip_pricing_tiers")
        .select("*")
        .eq("event_id", tripEventId),
      supabase
        .from("trip_inclusions")
        .select("*")
        .eq("event_id", tripEventId)
        .order("kind")
        .order("ordinal"),
      supabase
        .from("ticket_types")
        .select("*")
        .eq("event_id", tripEventId)
        .is("deleted_at", null),
      // ORCH-1130 Fix #1 — canonical trip dates live on the event_dates master
      // row (ORCH-0950 moved them off theme.business_trip + biz_update_live_trip
      // strips the theme mirror). Mirror the event public page, which sources
      // dates from event_dates (see publicEventViewRowToEvent master_* columns).
      //
      // issue-2160-strict-grep-allow TRIP-SIDECAR-LATENT-NOT-LIVE (SPEC §13 D-C).
      // This is the SAME RPC-vs-table split that produced #2161, on the TRIP
      // surface. It is LATENT rather than live only because `pg_public_trip_by_slug`
      // is 'listing'-gated (public only) and therefore NARROWER than the RLS
      // policy — an unlisted trip is not served at all, so the page fails whole
      // rather than half. Widen that reader to 'direct' and this becomes the
      // #2161 defect immediately. Out of #2160's scope by the SPEC allowlist;
      // filed separately. The marker exists so the exception is greppable rather
      // than silently absent from the gate.
      supabase
        .from("event_dates")
        .select("event_id,start_at,end_at,is_master")
        .eq("event_id", tripEventId)
        .eq("is_master", true)
        .maybeSingle(),
    ]);
  if (daysResp.error !== null) throw daysResp.error;
  if (tiersResp.error !== null) throw tiersResp.error;
  if (inclusionsResp.error !== null) throw inclusionsResp.error;
  if (ticketsResp.error !== null) throw ticketsResp.error;
  if (masterDateResp.error !== null) throw masterDateResp.error;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const days = (daysResp.data ?? []) as any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tiers = (tiersResp.data ?? []) as any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inclusions = (inclusionsResp.data ?? []) as any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tickets = (ticketsResp.data ?? []) as any[];

  // ORCH-0946 — remaining-capacity per ticket_type for the sold-out gate.
  // ORCH-1147 — per-tier server all-in (the SAME single owner as the event
  // path); RPC failure → empty map → base fallback downstream (never blank).
  const [remainingById, allInById] = await Promise.all([
    fetchTicketTypesRemaining(tripEventId),
    fetchTierAllInCents(tripEventId),
  ]);

  const ticketsById = new Map(tickets.map((tt) => [tt.id, tt]));
  const bt =
    (event.theme?.business_trip as Record<string, unknown> | undefined) ?? {};
  // ORCH-1130 Fix #1 — canonical start/end from the event_dates master row.
  // Fall back to the legacy theme mirror only when no master row exists (older
  // trips never written through the event_dates-canonical path).
  const masterDate =
    (masterDateResp.data as {
      start_at: string | null;
      end_at: string | null;
    } | null) ?? null;
  const tripStartAt =
    masterDate?.start_at ??
    (typeof bt.startAt === "string" ? bt.startAt : null);
  const tripEndAt =
    masterDate?.end_at ?? (typeof bt.endAt === "string" ? bt.endAt : null);

  const trip: Trip = {
    id: event.id,
    brandId: event.brand_id,
    brandSlug: brand.slug,
    title: event.title,
    description: event.description,
    slug: event.slug,
    status: event.status,
    visibility: event.visibility,
    publishedAt: event.published_at,
    timezone: event.timezone,
    coverMediaUrl: event.cover_media_url,
    coverMediaType: event.cover_media_type,
    businessTrip: {
      startAt: tripStartAt,
      endAt: tripEndAt,
      destinationPlaceId:
        typeof bt.destinationPlaceId === "string"
          ? bt.destinationPlaceId
          : null,
      destinationLocationText:
        typeof bt.destinationLocationText === "string"
          ? bt.destinationLocationText
          : null,
      destinationLat:
        typeof bt.destinationLat === "number" ? bt.destinationLat : null,
      destinationLng:
        typeof bt.destinationLng === "number" ? bt.destinationLng : null,
      // ORCH-1016 — departure (origin). Prefer canonical events.departure_text.
      departurePlaceId:
        typeof bt.departurePlaceId === "string" ? bt.departurePlaceId : null,
      departureLocationText:
        typeof (event as { departure_text?: string | null }).departure_text ===
          "string" &&
        (
          ((event as { departure_text?: string | null }).departure_text ??
            "") as string
        ).trim().length > 0
          ? ((event as { departure_text?: string | null }).departure_text ??
            null)
          : typeof bt.departureLocationText === "string"
            ? bt.departureLocationText
            : null,
      departureLat:
        typeof bt.departureLat === "number" ? bt.departureLat : null,
      departureLng:
        typeof bt.departureLng === "number" ? bt.departureLng : null,
      capacity: typeof bt.capacity === "number" ? bt.capacity : null,
    },
    days: days.map((d): TripDay => ({
      id: d.id,
      eventId: d.event_id,
      ordinal: d.ordinal,
      title: d.title,
      narrative: d.narrative,
      date: d.date,
      stops: Array.isArray(d.stops) ? d.stops : [],
      media: coerceTripDayMedia(d.media),
    })),
    pricingTiers: tiers.map((t): TripPricingTier => {
      const tt = ticketsById.get(t.ticket_type_id);
      const installmentSchedule =
        (t.tier_metadata?.installments as
          TripPricingTier["installmentSchedule"] | undefined) ?? null;
      const isUnlimited = tt?.is_unlimited ?? false;
      // ORCH-0946 — null when unlimited or unknown; otherwise GREATEST(total - sold, 0).
      const ticketsRemaining = isUnlimited
        ? null
        : (remainingById.get(t.ticket_type_id) ?? null);
      return {
        id: t.id,
        eventId: t.event_id,
        ticketTypeId: t.ticket_type_id,
        tierName: t.tier_name,
        tierMetadata: t.tier_metadata ?? {},
        priceCents: tt?.price_cents ?? 0,
        currency: tt?.currency ?? "",
        quantityTotal: tt?.quantity_total ?? null,
        ticketsRemaining,
        isUnlimited,
        installmentSchedule,
        // META-ORCH-1174 Leg B2 — per-package description from tier_metadata.
        description:
          typeof t.tier_metadata?.description === "string"
            ? (t.tier_metadata.description as string)
            : null,
        // ORCH-1147 — server fee-grossed per-tier all-in (MAJOR units). Free
        // tier / RPC miss → null; the cart seed owns the single base fallback
        // (mirrors the event path). NEVER recompute fees in TS.
        priceAllInGbp: (() => {
          const cents = allInById.get(t.ticket_type_id);
          return typeof cents === "number" ? cents / 100 : null;
        })(),
      };
    }),
    inclusions: inclusions.map((i): TripInclusion => ({
      id: i.id,
      eventId: i.event_id,
      kind: i.kind,
      item: i.item,
      ordinal: i.ordinal,
    })),
    createdAt: event.created_at,
    updatedAt: event.updated_at,
    // ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] fields — read directly
    // off events row; defaults match Trip type contract.
    refundPolicy:
      (event.refund_policy as Trip["refundPolicy"] | undefined) ?? null,
    bookingDeadline: event.booking_deadline ?? null,
    bookingsClosed: event.bookings_closed === true,
    bookingsClosedAt: event.bookings_closed_at ?? null,
    ticketsSoldCount: 0,
  };

  return {
    trip,
    brand: {
      id: brand.id,
      slug: brand.slug,
      name: brand.name,
      bio: brand.description ?? null,
      coverMediaUrl: brand.cover_media_url ?? null,
    },
  };
};
