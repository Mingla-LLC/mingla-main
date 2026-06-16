/**
 * ORCH-1072 — pure mappers for the venue-card experiences section. Kept free of
 * React-Native imports so they unit-test in isolation (no component mount).
 */
import { hueFromId } from "./hueFromId";
import { isVideoUrl } from "./videoUrl";
import type { VenueExperienceRow } from "../hooks/useVenueExperiences";
import type { BusinessEventCard } from "../types/mergedDiscover";

/**
 * Cloudinary video → first-frame still (`so_0` jpg). Image/gif covers render
 * their URL directly; non-Cloudinary videos return null (caller shows a
 * gradient placeholder). The row thumbnails are intentionally static — a list
 * of autoplaying videos is a scroll-perf hazard; the video plays in the sheet.
 */
export function posterFor(row: VenueExperienceRow): string | null {
  const url = row.cover_media_url;
  if (typeof url !== "string" || url.length === 0) return null;
  const isVideo = row.cover_media_type === "video" || isVideoUrl(url);
  if (!isVideo) return url;
  if (/\/video\/upload\//.test(url)) {
    return url
      .replace(/\/video\/upload\//, "/video/upload/so_0/")
      .replace(/\.(mp4|mov|webm|m4v)(\?.*)?$/i, ".jpg");
  }
  return null;
}

/** "Free" | "From $70" | "" (no priced tier). */
export function formatExperiencePrice(
  row: VenueExperienceRow,
  fallbackCurrency?: string | null,
): string {
  if (row.is_free) return "Free";
  if (row.price_from_cents === null) return "";
  const code = row.currency ?? fallbackCurrency ?? "USD";
  const major = row.price_from_cents / 100;
  try {
    const formatted = new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: code,
      maximumFractionDigits: major % 1 === 0 ? 0 : 2,
    }).format(major);
    return `From ${formatted}`;
  } catch {
    return `From ${major.toFixed(0)} ${code}`;
  }
}

/**
 * Map an experience summary row onto the BusinessEventCard shape that
 * ExpandedBusinessEventSheet consumes. Experiences ARE rows of the `events`
 * table (event_type='experience'), so the sheet self-fetches ticket tiers via
 * usePublicEventTickets(eventId) and drives the proven native checkout — the
 * exact pattern ConsumerTripDetailScreen uses for trips.
 */
/** START HERE / THEN / END WITH from index + count (mirrors deckService). */
function venueStopLabel(
  index: number,
  total: number,
): "Start Here" | "Then" | "End With" {
  if (index === 0) return "Start Here";
  if (index === total - 1) return "End With";
  return "Then";
}

export function experienceToBusinessEventCard(
  row: VenueExperienceRow,
): BusinessEventCard {
  const coverMediaType =
    row.cover_media_type === "image" ||
    row.cover_media_type === "video" ||
    row.cover_media_type === "gif"
      ? row.cover_media_type
      : null;
  // ORCH-1138 rework (§4.C.4) — the venue→detail seed now carries the full
  // itinerary (was empty: no stops/intents/occurrences → a bare detail page).
  const rawStops = Array.isArray(row.stops) ? row.stops : [];
  const total = rawStops.length;
  const experienceStops = rawStops.map((s, idx) => {
    const imageUrls = Array.isArray(s.image_urls)
      ? s.image_urls.filter(
          (u): u is string => typeof u === "string" && u.length > 0,
        )
      : [];
    return {
      stopNumber: typeof s.stop_order === "number" ? s.stop_order + 1 : idx + 1,
      placeName:
        typeof s.place_name === "string" && s.place_name.length > 0
          ? s.place_name
          : null,
      address:
        typeof s.address === "string" && s.address.length > 0
          ? s.address
          : null,
      imageUrl: imageUrls.length > 0 ? imageUrls[0] : null,
      aiDescription:
        typeof s.ai_description === "string" && s.ai_description.length > 0
          ? s.ai_description
          : null,
      imageUrls,
      lat: typeof s.lat === "number" ? s.lat : null,
      lng: typeof s.lng === "number" ? s.lng : null,
      startTime:
        typeof s.start_time === "string" && s.start_time.length > 0
          ? s.start_time
          : null,
      stopLabel: venueStopLabel(idx, total),
    };
  });
  const upcomingOccurrences = Array.isArray(row.upcoming_occurrences)
    ? row.upcoming_occurrences.map((o) => ({
        eventDateId: typeof o.event_date_id === "string" ? o.event_date_id : "",
        startAt: typeof o.start_at === "string" ? o.start_at : "",
        endAt: typeof o.end_at === "string" ? o.end_at : "",
        capacity: typeof o.capacity === "number" ? o.capacity : null,
        sold: typeof o.sold === "number" ? o.sold : 0,
        remaining: typeof o.remaining === "number" ? o.remaining : null,
      }))
    : undefined;
  const experienceIntents = Array.isArray(row.experience_intents)
    ? row.experience_intents.filter(
        (x): x is string => typeof x === "string" && x.length > 0,
      )
    : undefined;
  // The first stop's city → the consumer City,Country chip (rule 9: null when
  // no stop carries a city; fall back to the venue text).
  const firstCity = rawStops.find(
    (s) => typeof s.city === "string" && s.city.trim().length > 0,
  )?.city;
  return {
    eventId: row.experience_id,
    brandId: row.brand_id,
    brandSlug: row.brand_slug,
    brandName: row.brand_name,
    brandProfilePhotoUrl: null,
    eventSlug: row.experience_slug,
    title: row.title,
    description: row.description,
    coverMediaUrl: row.cover_media_url,
    coverMediaType,
    coverHue: hueFromId(row.experience_id),
    masterDateUtc: row.next_occurrence_at,
    masterEndAtUtc: null,
    doorsOpenLocal: null,
    endsAtLocal: null,
    timezone: "UTC",
    venueName: row.venue_text,
    city: firstCity ?? row.venue_text,
    address: null,
    hideAddressUntilTicket: false,
    format: "in-person",
    locationGeo:
      experienceStops[0]?.lat != null && experienceStops[0]?.lng != null
        ? { lat: experienceStops[0].lat, lng: experienceStops[0].lng }
        : null,
    partyTypes: [],
    vibeTags: [],
    musicGenres: [],
    priceMin: row.price_from_cents !== null ? row.price_from_cents / 100 : null,
    priceMax: row.price_from_cents !== null ? row.price_from_cents / 100 : null,
    currency: row.currency ?? "USD",
    // ORCH-1138 rework (§4.C.4) — the itinerary + vibes + occurrences the seed
    // was missing. brandTheme stays null here (events.theme is not the
    // resolveTheme input shape); useEventTheme(seed) resolves the real palette
    // from the anon-safe view by eventId (COMMS-0009) — honest, no fabrication.
    experienceStops: experienceStops.length > 0 ? experienceStops : undefined,
    experienceIntents,
    upcomingOccurrences,
    brandTheme: null,
  } as unknown as BusinessEventCard;
}
