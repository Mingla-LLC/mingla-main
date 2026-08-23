/**
 * publicEventSeedService — ORCH-1342 [web-see-whos-going-funnel] (META-ORCH-1337
 * Leg 5, SPEC §4.7 — the D6 cold-route seed).
 *
 * Resolves a BusinessEventCard SEED by slug for the seedless /e/ cold route so
 * ConsumerEventDetailScreen renders the FULL event page (RSVP branch included)
 * from a cold start. NO new backend: this is a bounded anon client read of the
 * already-public `business_public_events_view` (`visibility='public'` enforced
 * in the view's WHERE) — the EXACT read path this screen family already uses
 * anon (fetchRsvpMomentum, useEventTheme).
 *
 * 🔒 COMMS-0009 — anon view ONLY; NEVER `.from('brands')`.
 *
 * The mapper is a PURE exported function (unit-tested against fixture rows in
 * __tests__/publicEventSeedService.orch1342.test.ts); the supabase client is
 * imported LAZILY inside the fetch (the oneLinkShare.ts testability precedent)
 * so the module loads cleanly under a headless test runner.
 *
 * Constitution #9 — every field the view cannot provide is null/empty, never
 * invented (venueName/doors/priceMin/priceMax degrade honestly).
 */

import type { BusinessEventCard } from "../types/mergedDiscover";
import type { OfferingGalleryImage } from "@mingla/offering-rendering";

/** The explicit column set selected off business_public_events_view. */
export const PUBLIC_EVENT_SEED_COLUMNS =
  "id, brand_id, brand_slug, brand_name, brand_profile_photo_url, slug, title, " +
  "description, event_type, cover_media_url, cover_media_type, cover_media_gallery, timezone, " +
  "master_start_at, master_end_at, master_timezone, city, location_text, " +
  "is_online, public_theme, theme_color_override, theme_font_override, " +
  "theme_animation_override, currency, pricing_currency, display_price_cents, " +
  "party_types, vibe_tags, music_genres, location_geo, brand_theme_color, " +
  "brand_theme_font, brand_theme_animation";

/** Structural row shape of the §4.7 column select (view column names verified
 * against the LATEST view recreation, 20261220000000_orch_1291:630-732). */
export type PublicEventSeedViewRow = {
  id: string;
  brand_id: string;
  brand_slug: string;
  brand_name: string | null;
  brand_profile_photo_url: string | null;
  slug: string;
  title: string | null;
  description: string | null;
  event_type: string | null;
  cover_media_url: string | null;
  cover_media_type: string | null;
  // issue #868 [cover-gallery] — additive; absent on legacy rows → mapped to [].
  cover_media_gallery?: OfferingGalleryImage[] | null;
  timezone: string | null;
  master_start_at: string | null;
  master_end_at: string | null;
  master_timezone: string | null;
  city: string | null;
  location_text: string | null;
  is_online: boolean | null;
  public_theme: unknown;
  theme_color_override: string | null;
  theme_font_override: string | null;
  theme_animation_override: string | null;
  currency: string | null;
  pricing_currency: string | null;
  display_price_cents: number | null;
  party_types: string[] | null;
  vibe_tags: string[] | null;
  music_genres: string[] | null;
  location_geo: string | { x: number; y: number } | null;
  brand_theme_color: string | null;
  brand_theme_font: string | null;
  brand_theme_animation: string | null;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};

const asBoolean = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;

/** MIRRORS the deck seed producer (discover-merged-events deriveSharedFormat)
 * + the buyer-web parse (publicEventsService asFormat): the theme's draft
 * `in_person|online|hybrid` maps to the shared hyphenated format; absent →
 * `is_online` fallback. */
const asSharedFormat = (
  themeFormat: unknown,
  isOnline: boolean,
): BusinessEventCard["format"] => {
  if (themeFormat === "in_person") return "in-person";
  if (themeFormat === "online") return "online";
  if (themeFormat === "hybrid") return "hybrid";
  return isOnline ? "online" : "in-person";
};

/** MIRRORS publicEventsService.parseLocationGeoPoint (the proven precedent):
 * the view's point comes as a "(lng,lat)" string or {x,y}; null/malformed →
 * null → the screen hides the map (rule 9). */
const parseLocationGeoPoint = (
  g: string | { x: number; y: number } | null | undefined,
): { lat: number; lng: number } | null => {
  if (g == null) return null;
  if (typeof g === "string") {
    const m = g.match(/^\(([-\d.]+),([-\d.]+)\)$/);
    return m ? { lng: Number(m[1]), lat: Number(m[2]) } : null;
  }
  if (typeof g === "object" && typeof g.x === "number" && typeof g.y === "number") {
    return { lng: g.x, lat: g.y };
  }
  return null;
};

// ===========================================================================
// issue #2469 [explorer-venue-name-duplicated] — the ONE place the explorer
// splits a public event's location into its two display halves.
//
// IT LIVES HERE, not in src/utils/, for a hard reason: this module is loaded
// DIRECTLY by `deno test` (publicEventSeedService.orch1342.test.ts, wired into
// meta-orch-1337-social-proof-tests.yml). Deno cannot resolve an extensionless
// relative specifier, and app-mobile's tsconfig has no
// `allowImportingTsExtensions`, so there is no import form that satisfies both
// Metro/tsc and Deno. Keeping the function in this already-Deno-loadable pure
// module is what lets ONE owner serve both explorer mappers.
// `ConnectionsPage.tsx` imports it from here.
//
// THE BUG THIS CLOSES
// -------------------
// `events.location_text` is a COMBINED string:
//
//   "Didi Museum  · Akin Adesola Street 175, Lagos 10, Lagos, Nigeria"
//
// The business/web read path (`publicEventsService`) has always taken the
// PARSED halves from `public_theme -> business_event -> location`
// (`{ venueName, address }`) and shown the name once. Two explorer mappers
// instead assigned the WHOLE combined string to the card's `address` while
// separately rendering `venueName`, so the explorer printed the venue name
// twice — and then fed that doubled string to the maps deep link
// ("Didi Museum, Didi Museum  · Akin Adesola Street 175, …"), which is why
// #2468 reproduced most reliably on the explorer.
// ===========================================================================

export interface PublicEventLocationParts {
  /** The venue's own name, e.g. "Didi Museum". Never the combined string. */
  venueName: string | null;
  /**
   * The STREET address only, e.g. "Akin Adesola Street 175, Lagos 10, Lagos,
   * Nigeria". Never carries the venue name when `venueName` is non-null.
   */
  address: string | null;
}

const asTrimmedString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

/**
 * Split a public-event row's location into `{ venueName, address }`, reading
 * the SAME source the business/web path reads:
 * `public_theme -> business_event -> location`.
 *
 * `locationText` (the combined `events.location_text`) is used ONLY as the
 * fallback when the parsed object is absent — and then it is assigned to
 * exactly ONE of the two halves, never both:
 *
 *   parsed venueName + parsed address → both, as stored (the normal case)
 *   parsed venueName only             → venueName; address null
 *   parsed address only               → address; venueName null
 *   neither                           → the whole locationText lands on
 *                                       `venueName` ALONE and `address` stays
 *                                       null, so nothing can render it twice
 *
 * That last rule is the invariant: the combined string is NEVER returned in
 * BOTH halves, and never in `address` while `venueName` is also non-null.
 *
 * It lands on `venueName` rather than `address` for a concrete reason: every
 * shared renderer gates the whole "Where you'll be" card on
 * `event.venueName !== null` (EventOfferingBody:740, PublicEventPage:753,
 * RsvpOfferingBody:1713). Putting the fallback on `address` would hide the
 * card outright — which is exactly the second half of #2469 (this mapper
 * hard-coded `venueName: null`, so the cold /e/ route showed no location card
 * at all until the canonical read landed).
 *
 * Never fabricates: a half the row cannot supply comes back null
 * (Constitution #9).
 */
export function extractPublicEventLocation(
  publicTheme: unknown,
  locationText: string | null | undefined,
): PublicEventLocationParts {
  const businessEvent = asRecord(asRecord(publicTheme).business_event);
  const location = asRecord(businessEvent.location);

  const parsedVenueName =
    asTrimmedString(location.venueName) ??
    asTrimmedString(businessEvent.venueName);
  const parsedAddress = asTrimmedString(location.address);
  const combined = asTrimmedString(locationText);

  if (parsedVenueName !== null || parsedAddress !== null) {
    return { venueName: parsedVenueName, address: parsedAddress };
  }

  // No parsed halves at all. The combined string is the only honest thing we
  // hold, and it goes to ONE slot — assigning it to both is the #2469 defect.
  return { venueName: combined, address: null };
}

const asCoverMediaType = (
  value: string | null,
): BusinessEventCard["coverMediaType"] =>
  value === "image" || value === "video" || value === "gif" ? value : null;

/**
 * PURE row → BusinessEventCard mapper (SPEC §4.7 field table). Returns null
 * for trips/experiences — they own /t|/exp; an /e/ link to them is an
 * unknown-slug case (the screen shows the graceful cap).
 */
export function mapPublicEventSeedRow(
  row: PublicEventSeedViewRow,
): BusinessEventCard | null {
  if (row.event_type !== "event" && row.event_type !== "rsvp") return null;

  const publicTheme = asRecord(row.public_theme);
  const businessEvent = asRecord(publicTheme.business_event);
  // issue #2469 — the parsed venueName/address halves (never the combined
  // `location_text` in both slots). One owner, shared with ConnectionsPage.
  const seedLocation = extractPublicEventLocation(
    row.public_theme,
    row.location_text,
  );

  return {
    eventId: row.id,
    brandId: row.brand_id,
    brandSlug: row.brand_slug,
    brandName: row.brand_name ?? "",
    brandProfilePhotoUrl: row.brand_profile_photo_url ?? null,
    eventSlug: row.slug,
    title: row.title ?? "",
    description: row.description ?? null,
    coverMediaUrl: row.cover_media_url ?? null,
    coverMediaType: asCoverMediaType(row.cover_media_type),
    // issue #868 [cover-gallery] — additive; [] on legacy/absent (rule 9).
    coverGallery: Array.isArray(row.cover_media_gallery) ? row.cover_media_gallery : [],
    // coverHue 0 — the SAME neutral default the screen's own seedless
    // placeholder uses; hue is ONLY a no-media fallback tint (the real cover
    // renders whenever cover_media_url is present). PROTECTIVE: do not derive
    // a fake hue — Constitution #9 (SPEC §4.7 binds the 0).
    coverHue: 0,
    masterDateUtc: row.master_start_at ?? null,
    masterEndAtUtc: row.master_end_at ?? null,
    // The view carries no doors-local strings — null degrades the doors labels
    // honestly (rule 9); never derived client-side.
    doorsOpenLocal: null,
    endsAtLocal: null,
    timezone: row.master_timezone ?? row.timezone ?? "UTC",
    /*
      issue #2469 — was `venueName: null` + `address: row.location_text`.

      TWO defects in three lines. `location_text` is the COMBINED
      "<venueName>  · <address>" string, so assigning it to `address` printed
      the venue name a second time under the name line AND sent the doubled
      string to the maps deep link. And the hard-coded `venueName: null`
      suppressed the entire "Where you'll be" card on the cold /e/ route,
      because every shared renderer gates that section on `venueName !== null`.

      Both are closed by reading the PARSED halves out of
      `public_theme -> business_event -> location` — the same source the
      business/web mapper (`publicEventsService`) has always used.
    */
    venueName: seedLocation.venueName,
    city: row.city ?? null,
    address: seedLocation.address,
    // MIRRORS the authoritative parses (publicEventsService:1034 AND the deck
    // seed producer extractHideAddressUntilTicket): fail-CLOSED to true — an
    // absent theme value must HIDE the street, never leak it (the 1157
    // address-privacy invariant family). [SPEC §4.7 wrote `false`; both cited
    // mirror targets use `true` — deviation recorded in the report.]
    hideAddressUntilTicket: asBoolean(businessEvent.hideAddressUntilTicket, true),
    format: asSharedFormat(businessEvent.format, row.is_online === true),
    locationGeo: parseLocationGeoPoint(row.location_geo),
    partyTypes: row.party_types ?? [],
    vibeTags: row.vibe_tags ?? [],
    musicGenres: row.music_genres ?? [],
    // No per-tier price aggregation on this read — the screen re-fetches real
    // tickets via usePublicEventTickets(eventId); the display price is the
    // server-computed all-in column (rule 9: never client-derived).
    priceMin: null,
    priceMax: null,
    displayPriceCents: row.display_price_cents ?? null,
    displayCurrency: row.pricing_currency ?? row.currency ?? null,
    currency: row.currency ?? "USD",
    publicBuyerUrl: `https://host.usemingla.com/e/${encodeURIComponent(
      row.brand_slug,
    )}/${encodeURIComponent(row.slug)}`,
    eventType: row.event_type,
    brandTheme: {
      color: row.brand_theme_color ?? null,
      font: row.brand_theme_font ?? null,
      animation: row.brand_theme_animation ?? null,
      color_override: row.theme_color_override ?? null,
      font_override: row.theme_font_override ?? null,
      animation_override: row.theme_animation_override ?? null,
    },
  };
}

/**
 * Fetch the cold-route seed by slug (anon-safe view read). Row missing →
 * null (the screen's graceful cap is the terminal state for unknown/private/
 * deleted slugs). Trips/experiences → null (see mapper). Errors THROW —
 * React Query owns retry (never a silent []/null-on-failure).
 */
export async function fetchPublicEventSeedBySlug(
  brandSlug: string,
  eventSlug: string,
): Promise<BusinessEventCard | null> {
  // Lazy import (oneLinkShare precedent) — keeps this module loadable by a
  // headless unit runner that exercises ONLY the pure mapper above.
  const { supabase } = await import("./supabase");
  const { data, error } = await supabase
    .from("business_public_events_view")
    .select(PUBLIC_EVENT_SEED_COLUMNS)
    .eq("brand_slug", brandSlug)
    .eq("slug", eventSlug)
    .maybeSingle();
  if (error !== null) {
    throw new Error(error.message);
  }
  if (data === null || data === undefined) return null;
  return mapPublicEventSeedRow(data as unknown as PublicEventSeedViewRow);
}
