/**
 * adEventSourceUrl.ts — #4238 W1-5 (D16). The page URL a server ad event
 * reports as event_source_url (Meta, Snap) / page.url (TikTok). Pure: no I/O,
 * no env. Buyer pages live on the production Host web origin.
 *
 *   event / rsvp → /e/<brandSlug>/<eventSlug>
 *   trip         → /t/<brandSlug>/<eventSlug>
 *   experience   → /exp/<brandSlug>/<eventSlug>
 *   checkout     → /<checkout surface>/<eventId> (buyerWebSurfacePath)
 *   venue / stay → /b/<brandSlug> (no public venue URL is resolvable here)
 *
 * Returns null when a slug is missing, so a sender omits the field rather
 * than reporting a wrong page.
 */
import { PRODUCTION_BUSINESS_WEB_ORIGIN } from "./businessWebOrigin.ts";
import { buyerWebSurfacePath } from "./buyerWebSurfacePath.ts";

const cleanSlug = (value: unknown): string | null =>
  typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/.test(value.trim())
    ? value.trim()
    : null;

/** The public page path segment for an event_type (shared links use these). */
export function publicEventPathSegment(eventType: unknown): "e" | "t" | "exp" {
  if (eventType === "trip") return "t";
  if (eventType === "experience") return "exp";
  return "e";
}

export function eventPageUrl(input: {
  brandSlug: unknown;
  eventSlug: unknown;
  eventType: unknown;
}): string | null {
  const brand = cleanSlug(input.brandSlug);
  const slug = cleanSlug(input.eventSlug);
  if (!brand || !slug) return null;
  return `${PRODUCTION_BUSINESS_WEB_ORIGIN}/${
    publicEventPathSegment(input.eventType)
  }/${brand}/${slug}`;
}

export function brandPageUrl(brandSlug: unknown): string | null {
  const brand = cleanSlug(brandSlug);
  return brand ? `${PRODUCTION_BUSINESS_WEB_ORIGIN}/b/${brand}` : null;
}

export function checkoutStartUrl(
  eventId: unknown,
  eventType: unknown,
): string | null {
  if (typeof eventId !== "string" || !/^[0-9a-fA-F-]{8,64}$/.test(eventId)) {
    return null;
  }
  return `${PRODUCTION_BUSINESS_WEB_ORIGIN}/${
    buyerWebSurfacePath(eventType)
  }/${eventId}`;
}
