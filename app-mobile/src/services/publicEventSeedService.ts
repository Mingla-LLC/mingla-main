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

/** The explicit column set selected off business_public_events_view. */
export const PUBLIC_EVENT_SEED_COLUMNS =
  "id, brand_id, brand_slug, brand_name, brand_profile_photo_url, slug, title, " +
  "description, event_type, cover_media_url, cover_media_type, timezone, " +
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
    // The view has no venueName column — location_text is the ADDRESS line
    // (matching the deck mapper's address source); venueName stays null.
    venueName: null,
    city: row.city ?? null,
    address: row.location_text ?? null,
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
    publicBuyerUrl: `https://business.usemingla.com/e/${encodeURIComponent(
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
