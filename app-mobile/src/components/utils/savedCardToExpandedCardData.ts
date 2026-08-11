// ORCH-1054 [matches-expanded-card-parity]
// Single producer of ExpandedCardData for the collab "Matches" sheet
// (SavedToSessionCardsSheet) and the "Plans" sheet (ScheduleSheet), both in
// chat/CollabSessionChatBanners.tsx. Replaces the pre-1054 bespoke lossy
// `toExpandedCard` mapper that:
//   1. FORCED `category: "night_out"` — which broke ExpandedCardModal's
//      stroll/picnic discriminator (`card.category === "Take a Stroll" / "Picnic
//      Date"`, ExpandedCardModal.tsx:1752/1757) so stroll/picnic itineraries fell
//      through to the generic single-place layout;
//   2. dropped `openingHours`, `website`, `phone`, `tip`, `strollData`,
//      `picnicData`, `pairingKey`, `experienceType`, `shoppingList`,
//      `selectedDateTime` and other modal-read fields;
//   3. rebuilt curated cards field-by-field instead of passing them through, so
//      they lost fidelity vs. the deck.
//
// ── #1669 [expanded-card-one-producer] — this is now THE canonical producer ──
//
// Before #1669 the same pool card reached ExpandedCardModal through ELEVEN
// different producers (eight hand-written object literals + three named
// adapters) that disagreed about which fields survived, so the same place
// showed different facts depending on which screen it was opened from:
//   D1 the price pill was dropped by every producer that did not spread
//      `canonicalDiscoveryPriceFields` (CardInfoSection renders the pill ONLY
//      from `canonicalDiscoveryPriceDetail(card)`);
//   D2 the Open-now / Closed badge was computed against the VIEWER's clock on
//      five of six surfaces because only SavedTab passed `utcOffsetMinutes`
//      (`isPlaceOpenAt` silently falls back to device-local time when the
//      offset is null — a London viewer was told the wrong thing about a Lagos
//      venue, and those are two of three live markets);
//   D3 both deck literals substituted the VIEWER's own GPS for a card with no
//      coordinates, so the modal then fetched weather + busyness for wherever
//      the user was standing and rendered it under the venue's name;
//   D4 curated plans were rebuilt field-by-field on Likes, Calendar and the
//      collab session view (the unfixed half of ORCH-1054);
//   D5 three producers fabricated `rating: … || 4.5` for unrated places
//      (Constitution #9 — missing data is HIDDEN, never faked). The first
//      repair pass swapped that for `?? 0`, which is not a fix: `0` is not
//      `undefined`, so the chip still rendered and an unrated place read
//      `★ 0.0` — an invented zero looks like a real, terrible score. Absence
//      is now carried as absence all the way to the renderer, and the renderer
//      gates the chip on a POSITIVE value so a stored `0` cannot print either
//      (one servable place in the pool has exactly that).
//
// Every pool-card surface now calls THIS function. It is the only place a
// single-place ExpandedCardData is minted, so a field either survives for all
// of them or for none of them. The registry gate
// `app-mobile/scripts/ci/orch-1054-matches-expanded-card-parity-check.mjs`
// fails the build if a new producer mints one anywhere else.
//
// If a surface needs a field this mapper does not carry: EXTEND THIS MAPPER.
// Do not fork it — forking it is the bug.
//
// The saved payload it consumes is `board_saved_cards.card_data`, which
// `buildCardDataPayload` (helpers/collabSaveCard.ts) persists as the full
// ~27-key Recommendation client-shape — i.e. the same shape the deck mapper
// reads — so a faithful mirror renders deck-identically.
//
// Returning the value TYPED as ExpandedCardData makes any future field-name
// drift a compile error (regression-prevention; same precedent as ORCH-0997
// holidayCardToExpandedCardData).

import type { ExpandedCardData } from "../../types/expandedCardTypes";
import type { PriceTierSlug } from "../../constants/priceTiers";
import { canonicalDiscoveryPriceFields } from "../../utils/priceTiers";

const PRICE_TIER_SLUGS: readonly string[] = [
  "any",
  "chill",
  "comfy",
  "bougie",
  "lavish",
];

/**
 * Per-call context the SOURCE RECORD cannot carry.
 *
 * Everything a pool card knows about itself belongs in the record passed as the
 * first argument. These are viewer-relative facts owned by the mounting screen:
 * which datetime the modal should reason about, and which travel mode the
 * viewer picked. They are options precisely so no producer is tempted to fork
 * the mapper to inject them.
 */
export interface PoolCardMapOptions {
  /**
   * The datetime the modal should use for time-aware weather + the timeline.
   * Constitution #9: this mapper NEVER invents one. A caller that wants "now"
   * passes `new Date()` explicitly; a caller with no meaningful datetime passes
   * nothing and the modal renders without time-of-day awareness.
   */
  selectedDateTime?: Date;
  /** The viewer's selected travel mode, when the screen knows it. */
  travelMode?: string;
}

/**
 * Map a pool-card payload (the ~27-key Recommendation client shape — the deck's
 * `Recommendation`, `saved_card.card_data`, `board_saved_cards.card_data`, a
 * calendar entry's `experience`, or a chat card payload normalised onto it)
 * onto a complete ExpandedCardData, so every surface opens ExpandedCardModal
 * with identical fidelity.
 *
 * Honesty (Constitution #9): the mapper preserves the card's REAL category
 * (never fabricating "night_out"); missing image → `image:''` + `images:[]` (the
 * modal renders its own honest empty state); missing rating → `undefined`, so
 * `CardInfoSection` renders NO star chip at all — not a 4.5, and not a `0.0`
 * either; missing coords → `location:undefined` (no fake distance, and NEVER
 * the viewer's own GPS).
 */
export function savedCardToExpandedCardData(
  cardData: Record<string, unknown> | null | undefined,
  options?: PoolCardMapOptions,
): ExpandedCardData | null {
  if (!cardData) return null;
  const c = cardData as Record<string, unknown>;

  const str = (v: unknown): string | undefined =>
    typeof v === "string" && v.length > 0 ? v : undefined;
  const explicitSourceScope = str(c.sourceScope);
  const legacySourceScope = str(c.source);
  const sourceScope: ExpandedCardData["sourceScope"] =
    explicitSourceScope === "solo" || explicitSourceScope === "collaboration"
      ? explicitSourceScope
      : legacySourceScope === "solo" || legacySourceScope === "collaboration"
      ? legacySourceScope
      : undefined;
  const normalizedProvenance = {
    placePoolId: str(c.placePoolId) ?? str(c.place_pool_id),
    googlePlaceId:
      str(c.googlePlaceId) ?? str(c.google_place_id) ?? str(c.placeId),
    sourceScope,
    sourceRecordId: str(c.sourceRecordId) ?? str(c.source_record_id),
    savedCardId: str(c.savedCardId) ?? str(c.saved_card_id),
  };

  // Curated pass-through — identical to the deck (SwipeableCards.tsx:1829-1831).
  // The full curated shape (stops + itinerary metadata) is preserved verbatim.
  if (c.cardType === "curated") {
    return {
      ...cardData,
      ...normalizedProvenance,
    } as unknown as ExpandedCardData;
  }

  // #1669: rows persisted before `cardType` was written carry only `stops`.
  // SavedTab (`Array.isArray(card.stops) && length > 0`) and CalendarTab
  // discriminated on that array, so honouring it here is what keeps those two
  // surfaces rendering curated now that they route through this mapper. The
  // pass-through is still verbatim; only the discriminator is stamped on.
  if (Array.isArray(c.stops) && c.stops.length > 0) {
    return {
      ...(cardData as object),
      ...normalizedProvenance,
      cardType: "curated",
    } as unknown as ExpandedCardData;
  }

  const num = (v: unknown): number | undefined =>
    typeof v === "number" ? v : undefined;
  const strArr = (v: unknown): string[] | undefined =>
    Array.isArray(v)
      ? (v.filter((x) => typeof x === "string") as string[])
      : undefined;
  const date = (v: unknown): Date | undefined => {
    if (v instanceof Date) return Number.isNaN(v.getTime()) ? undefined : v;
    if (typeof v === "string" || typeof v === "number") {
      const parsed = new Date(v);
      return Number.isNaN(parsed.getTime()) ? undefined : parsed;
    }
    return undefined;
  };

  const image = str(c.image) ?? "";
  const images = strArr(c.images);
  const lat = num(c.lat);
  const lng = num(c.lng);
  const savedLocation = c.location as ExpandedCardData["location"] | undefined;
  const priceTier = str(c.priceTier);

  // Single-place field map. This is the ONLY field-survival decision in the
  // app for a pool card — every surface inherits exactly this list.
  //
  // No viewer-GPS injection (D3): a card with no coordinates gets
  // `location: undefined` and the modal honestly renders no weather/busyness
  // block, rather than the viewer's own weather under the venue's name.
  return {
    id: String(c.id ?? c.experience_id ?? str(c.title) ?? ""),
    placeId: str(c.placeId) ?? (typeof c.id === "string" ? c.id : undefined),
    ...normalizedProvenance,
    title: str(c.title) ?? "Untitled card",
    category: str(c.category) ?? "",
    // #1669: empty, not a placeholder pin. ExpandedCardModal resolves
    // `card.categoryIcon || getCategoryIcon(card.category)`, so an empty string
    // lets the category-derived icon win — stamping "location-outline" here
    // would have suppressed it on every surface that has no explicit icon.
    categoryIcon: str(c.categoryIcon) ?? "",
    description: str(c.description) ?? "",
    fullDescription: str(c.fullDescription) ?? str(c.description) ?? "",
    image,
    images: images && images.length ? images : image ? [image] : [],
    // D5 — an unrated place has NO rating. Not 4.5, and not 0 either: the first
    // repair pass coerced to `0` and CardInfoSection printed `★ 0.0`, which
    // reads as a real, terrible score. `num()` already yields undefined for a
    // missing/non-numeric value, so absence simply survives.
    rating: num(c.rating),
    reviewCount: num(c.reviewCount) ?? 0,
    priceRange: str(c.priceRange),
    // D1 — the price pill renders ONLY from these. Spread once, here, for
    // every surface.
    ...canonicalDiscoveryPriceFields(c),
    distance: str(c.distance) ?? null,
    travelTime: str(c.travelTime) ?? null,
    travelMode: options?.travelMode ?? str(c.travelMode),
    address: str(c.address) ?? "",
    openingHours: c.openingHours as ExpandedCardData["openingHours"],
    // D2 — the Open-now / Closed badge. Without this `isPlaceOpenAt` falls back
    // to the VIEWER's clock, which is wrong for every cross-timezone venue.
    utcOffsetMinutes:
      num(c.utcOffsetMinutes) ?? num(c.utc_offset_minutes) ?? null,
    website: str(c.website) ?? str(c.websiteUri),
    phone: str(c.phone),
    // #1703 — the country the number dials from. Carried through the ONE mapper
    // (#1669) so every producer gets it, not just the deck.
    countryCode: str(c.countryCode) ?? str(c.country_code) ?? null,
    highlights: strArr(c.highlights) ?? [],
    tags: strArr(c.tags) ?? [],
    matchScore: num(c.matchScore) ?? 0,
    matchFactors: (c.matchFactors as ExpandedCardData["matchFactors"]) ?? {
      location: 0,
      budget: 0,
      category: 0,
      time: 0,
      popularity: 0,
    },
    socialStats: (c.socialStats as ExpandedCardData["socialStats"]) ?? {
      views: 0,
      likes: 0,
      saves: 0,
      shares: 0,
    },
    location:
      savedLocation ??
      (lat != null && lng != null ? { lat, lng } : undefined),
    selectedDateTime: options?.selectedDateTime ?? date(c.selectedDateTime),
    tip: (c.tip as ExpandedCardData["tip"]) ?? undefined,
    strollData: c.strollData as ExpandedCardData["strollData"],
    picnicData: c.picnicData as ExpandedCardData["picnicData"],
    tagline: str(c.tagline),
    shoppingList: strArr(c.shoppingList),
    priceTier:
      priceTier && PRICE_TIER_SLUGS.includes(priceTier)
        ? (priceTier as PriceTierSlug)
        : undefined,
    // ORCH-0908 lock-in metadata — the modal renders LockedInBanner +
    // Add-to-Calendar from these. Carried here (rather than in a chat-only
    // fork) so a locked-in card looks the same wherever it is opened.
    lockInEvent:
      c.lockInEvent === "card_locked_and_scheduled"
        ? "card_locked_and_scheduled"
        : undefined,
    scheduledAt: str(c.scheduledAt),
    durationMinutes: num(c.durationMinutes),
    lockerUserId: str(c.lockerUserId),
    sessionId: str(c.sessionId),
  };
}
