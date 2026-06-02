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
// This mapper mirrors the CANONICAL deck mapper `recommendationToExpanded`
// (SwipeableCards.tsx:1828) exactly:
//   - curated cards (`cardType === 'curated'`) pass through AS-IS (deck line
//     1830 `return card as unknown as ExpandedCardData`), preserving every
//     curated field (stops, tagline, totalPriceMin/Max, estimatedDurationMinutes,
//     experienceType, shoppingList, pairingKey, synthesized image/images);
//   - single-place cards get the full field map (deck lines 1832-1867).
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

/**
 * Map a saved collab card payload (`board_saved_cards.card_data`) onto a complete
 * ExpandedCardData so the Matches/Plans sheets open ExpandedCardModal with the
 * exact same fidelity as the swipeable deck.
 *
 * Honesty (Constitution #9): the deck mapper preserves the card's REAL category
 * (never fabricating "night_out"); missing image → `image:''` + `images:[]` (the
 * modal renders its own honest empty state); missing rating → `0` (modal hides
 * the chip); missing coords → `location:undefined` (no fake distance).
 */
export function savedCardToExpandedCardData(
  cardData: Record<string, unknown> | null | undefined,
): ExpandedCardData | null {
  if (!cardData) return null;
  const c = cardData as Record<string, unknown>;

  // Curated pass-through — identical to the deck (SwipeableCards.tsx:1829-1831).
  // The full curated shape (stops + itinerary metadata) is preserved verbatim.
  if (c.cardType === "curated") {
    return cardData as unknown as ExpandedCardData;
  }

  const str = (v: unknown): string | undefined =>
    typeof v === "string" ? v : undefined;
  const num = (v: unknown): number | undefined =>
    typeof v === "number" ? v : undefined;
  const strArr = (v: unknown): string[] | undefined =>
    Array.isArray(v)
      ? (v.filter((x) => typeof x === "string") as string[])
      : undefined;

  const image = str(c.image) ?? "";
  const images = strArr(c.images);
  const lat = num(c.lat);
  const lng = num(c.lng);
  const savedLocation = c.location as ExpandedCardData["location"] | undefined;

  // Single-place field map — mirrors the deck mapper (SwipeableCards.tsx:1832-1867).
  // No deck-only userLocation/userPreferences injection: the saved payload
  // already carries location/lat/lng, and the modal recomputes viewer-relative
  // travel from GPS at open time for cards lacking distance (ORCH-0910 T-11).
  return {
    id: String(c.id ?? c.experience_id ?? str(c.title) ?? ""),
    placeId: str(c.placeId) ?? (typeof c.id === "string" ? c.id : undefined),
    title: str(c.title) ?? "Untitled card",
    category: str(c.category) ?? "",
    categoryIcon: str(c.categoryIcon) ?? "location-outline",
    description: str(c.description) ?? "",
    fullDescription: str(c.fullDescription) ?? str(c.description) ?? "",
    image,
    images: images && images.length ? images : image ? [image] : [],
    rating: num(c.rating) ?? 0,
    reviewCount: num(c.reviewCount) ?? 0,
    priceRange: str(c.priceRange),
    priceTier: c.priceTier as ExpandedCardData["priceTier"],
    distance: str(c.distance) ?? null,
    travelTime: str(c.travelTime) ?? null,
    travelMode: str(c.travelMode),
    address: str(c.address) ?? "",
    openingHours: c.openingHours as ExpandedCardData["openingHours"],
    website: str(c.website) ?? str(c.websiteUri),
    phone: str(c.phone),
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
    tip: (c.tip as ExpandedCardData["tip"]) ?? undefined,
    strollData: c.strollData as ExpandedCardData["strollData"],
    picnicData: c.picnicData as ExpandedCardData["picnicData"],
    tagline: str(c.tagline),
    shoppingList: strArr(c.shoppingList),
  };
}
