/**
 * ORCH-0685 §7.4: typed converter from CardPayload (chat-share snapshot)
 * to ExpandedCardData (the modal's expected input).
 *
 * Replaces the unsafe `useState<any>` typing (and the latent `as unknown as`
 * cast it permitted) at MessageInterface.tsx:187 + :943 — Constitution #12 fix.
 *
 * Fields not carried in CardPayload are filled with null-safe defaults that
 * let ExpandedCardModal render its sections honestly:
 *   - distance, travelTime: null (Constitution #9 — never fabricate from sender;
 *     these are recipient-relative per ORCH-0659/0660 lesson)
 *   - tags: [] (CardInfoSection renders empty tag row gracefully)
 *   - matchFactors, socialStats: zero-valued objects (modal does not render
 *     today; forward-positioned per ORCH-0685.D-5 deferral)
 *   - fullDescription: falls back to description (CardPayload only carries one)
 *   - strollData, picnicData, nightOutData, cardType: undefined
 *     (modal's regular layout is reached for chat-shared cards)
 */
import type { CardPayload } from './messagingService';
import type { ExpandedCardData } from '../types/expandedCardTypes';

export function cardPayloadToExpandedCardData(p: CardPayload): ExpandedCardData {
  return {
    id: p.id,
    title: p.title,
    category: p.category ?? '',
    categoryIcon: p.categoryIcon ?? '',
    description: p.description ?? '',
    fullDescription: p.description ?? '',
    image: p.image ?? '',
    images: p.images ?? (p.image ? [p.image] : []),
    rating: p.rating ?? 0,
    reviewCount: p.reviewCount ?? 0,
    priceRange: p.priceRange,
    distance: null,
    travelTime: null,
    travelMode: undefined,
    address: p.address ?? '',
    openingHours: p.openingHours ?? null,
    phone: p.phone,
    website: p.website,
    highlights: p.highlights ?? [],
    tags: p.tags ?? [],
    matchScore: p.matchScore ?? 0,
    matchFactors: p.matchFactors ?? { location: 0, budget: 0, category: 0, time: 0, popularity: 0 },
    socialStats: p.socialStats
      ? { ...p.socialStats, shares: 0 }
      : { views: 0, likes: 0, saves: 0, shares: 0 },
    location: p.location,
    selectedDateTime: p.selectedDateTime ? new Date(p.selectedDateTime) : undefined,
    placeId: p.placeId,
  };
}
