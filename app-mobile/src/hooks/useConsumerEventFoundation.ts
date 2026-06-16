// ORCH-1138 Leg 2 — consumer EVENT → Direction-A foundation data-adapter.
//
// Pure mapping of a `BusinessEventCard` (the deck seed) + the resolved tier list
// (PublicTicketProps[]) + a resolved `ThemePalette` onto the inputs the consumer
// event detail screen renders, so the consumer event detail converges on the
// business/web event page (PublicEventPage FOUNDATION mode) by REUSING the same
// shared @mingla/offering-rendering primitives + the SAME resolveOfferingCta CTA
// machine (NOT by importing the business PublicEventPage — it is app-local).
// Render only real fields (Constitution rule 9): every derived value returns
// null/[] when its source is absent so the screen omits that section entirely.
//
// 🔒 COMMS-0009 / I-ANON-BRANDS-VIA-DEFINER-VIEW: this adapter touches NO Supabase
// table — it is a pure projection of data the deck card + useEventTheme +
// usePublicEventTickets already resolved (the theme via the anon-safe
// business_public_events_view). It never queries the brands table, no fetch.
//
// 🔒 I-MOR-0827-PACKAGE-ISOLATION: no import from mingla-business/src.

import { normalizeCityCountry } from "@mingla/offering-rendering";
import type { ThemePalette, PublicTicketProps } from "@mingla/event-rendering";

import type { BusinessEventCard } from "../types/mergedDiscover";
import { formatEventDateLine } from "../utils/eventDateDisplay";

/** The mapped foundation render inputs for the consumer event body. */
export interface ConsumerEventFoundationModel {
  coverMediaUrl: string | null;
  coverMediaType: "image" | "video" | "gif" | null;
  coverHue: number;
  title: string;
  /** Date eyebrow ("Sat 18 May · 10 PM") — null → omit (rule 9). */
  dateLine: string | null;
  /** Recurring/multi-date subline ("+ 3 more dates") — null → omit. */
  dateSubline: string | null;
  /** "N tickets left" / "Sold out" — null → omit (hideRemaining or no finite cap). */
  capacityLabel: string | null;
  /** "City, Country" normalized — null → omit (rule 9). */
  cityCountry: string | null;
  /** Venue name (null → no venue card on in-person; "online" handled separately). */
  venueName: string | null;
  /** Address honoring hideAddressUntilTicket is resolved at render time. */
  address: string | null;
  hideAddressUntilTicket: boolean;
  format: "in-person" | "online" | "hybrid";
  /**
   * Venue lat/lng. PRESENT on the consumer card (BusinessEventCard.locationGeo),
   * BUT the consumer map is OMITTED this leg (OQ-5): app-mobile has no Mapbox
   * token in app.config extra (only the static process.env fallback, which does
   * NOT survive standalone/OTA per COMMS-0028) and no buildStaticMapUrl util —
   * threading a token + util is outside the §11 allowlist. Surfaced here so a
   * future read-path/config ORCH can light up the map with no adapter change.
   */
  lat: number | null;
  lng: number | null;
  description: string | null;
  brandName: string;
  brandSlug: string;
  brandCoverMediaUrl: string | null;
  /** The selectable tiers (PublicTicketProps — same shape the cart consumes). */
  tickets: PublicTicketProps[];
  currency: string;
}

/**
 * Map a BusinessEventCard (+ tiers + resolved palette) onto the foundation render
 * inputs. Pure + deterministic (memoize at the call site). The palette is passed
 * for caller convenience/parity; chip variants are palette-agnostic.
 */
export function mapConsumerEventToFoundation(
  card: BusinessEventCard,
  tickets: PublicTicketProps[],
  _palette: ThemePalette,
): ConsumerEventFoundationModel {
  void _palette; // palette is applied at render time via offeringSurfaceStyles.

  const dateLine = formatEventDateLine({
    masterDateUtc: card.masterDateUtc,
    masterEndAtUtc: card.masterEndAtUtc,
    timezone: card.timezone,
  });

  // City,Country normalized from city → venue → address (rule 9: null → omit).
  const cityCountry =
    normalizeCityCountry(card.city) ??
    normalizeCityCountry(card.venueName) ??
    normalizeCityCountry(card.address);

  // Capacity chip — total remaining across sellable tiers; suppressed when no tier
  // carries a finite capacity (rule 9 — never fabricate a count).
  let total = 0;
  let anyFinite = false;
  for (const t of tickets) {
    if (t.isUnlimited) continue;
    if (t.capacity !== null) {
      total += t.capacity;
      anyFinite = true;
    }
  }
  const capacityLabel = anyFinite
    ? total <= 0
      ? "Sold out"
      : `${total} tickets left`
    : null;

  const description =
    card.description !== null && card.description.trim().length > 0
      ? card.description
      : null;

  return {
    coverMediaUrl: card.coverMediaUrl,
    coverMediaType: coerceCoverType(card.coverMediaType),
    coverHue: card.coverHue,
    title: card.title,
    dateLine: dateLine.length > 0 ? dateLine : null,
    dateSubline: null,
    capacityLabel,
    cityCountry,
    venueName: card.venueName,
    address: card.address,
    hideAddressUntilTicket: card.hideAddressUntilTicket,
    format: card.format,
    lat: card.locationGeo?.lat ?? null,
    lng: card.locationGeo?.lng ?? null,
    description,
    brandName: card.brandName,
    brandSlug: card.brandSlug,
    brandCoverMediaUrl: card.brandProfilePhotoUrl,
    tickets,
    currency: card.currency,
  };
}

function coerceCoverType(
  raw: "image" | "video" | "gif" | null,
): "image" | "video" | "gif" | null {
  return raw === "image" || raw === "video" || raw === "gif" ? raw : null;
}
