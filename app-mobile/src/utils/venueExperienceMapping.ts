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
export function experienceToBusinessEventCard(
  row: VenueExperienceRow,
): BusinessEventCard {
  const coverMediaType =
    row.cover_media_type === "image" ||
    row.cover_media_type === "video" ||
    row.cover_media_type === "gif"
      ? row.cover_media_type
      : null;
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
    city: row.venue_text,
    address: null,
    hideAddressUntilTicket: false,
    format: "in-person",
    locationGeo: null,
    partyTypes: [],
    vibeTags: [],
    musicGenres: [],
    priceMin: row.price_from_cents !== null ? row.price_from_cents / 100 : null,
    priceMax: row.price_from_cents !== null ? row.price_from_cents / 100 : null,
    currency: row.currency ?? "USD",
  } as unknown as BusinessEventCard;
}
