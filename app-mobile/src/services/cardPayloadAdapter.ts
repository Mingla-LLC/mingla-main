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
 *   - strollData, picnicData, nightOutData: undefined (chat-share doesn't carry these)
 *   - cardType + stops: passed through when present (ORCH-0910 — unlocks the modal's
 *     isCuratedCard branch for chat-shared intent cards)
 */
import type { CardPayload } from './messagingService';
import type { ExpandedCardData } from '../types/expandedCardTypes';

export function cardPayloadToExpandedCardData(p: CardPayload): ExpandedCardData {
  // ORCH-0908: defensive legacy-payload normalizer. The first cut of the
  // combined lock-and-schedule RPC nested the card under card_payload.card_data;
  // migration 20260630000000 flattens it + backfills existing rows, but if any
  // nested row slips through we still render correctly by reading from
  // .card_data as a fallback. Also normalizes the snake_case lock-in keys
  // (scheduled_at, locker_user_id, etc.) to camelCase.
  const raw = p as any;
  const legacy = raw.card_data && typeof raw.card_data === 'object' ? raw.card_data : {};
  const f = <T,>(key: string, fallback?: T): T => (raw[key] ?? legacy[key] ?? fallback) as T;
  const scheduledAt = raw.scheduledAt ?? raw.scheduled_at ?? undefined;
  const cardType = (raw.cardType ?? legacy.cardType) === 'curated' ? 'curated' : undefined;
  return {
    id: f('id', ''),
    title: f('title', 'Saved experience'),
    category: f('category', '') ?? '',
    categoryIcon: f('categoryIcon', '') ?? '',
    description: f('description', '') ?? '',
    fullDescription: f('description', '') ?? '',
    image: f('image', '') ?? '',
    images: (raw.images ?? legacy.images) ?? (() => {
      const img = f<string | null>('image', null);
      return img ? [img] : [];
    })(),
    rating: f('rating', 0) ?? 0,
    reviewCount: f('reviewCount', 0) ?? 0,
    priceRange: f('priceRange', undefined),
    distance: null,
    travelTime: null,
    travelMode: undefined,
    address: f('address', '') ?? '',
    openingHours: (raw.openingHours ?? legacy.openingHours) ?? null,
    phone: f('phone', undefined),
    website: f('website', undefined),
    highlights: f('highlights', []) ?? [],
    tags: f('tags', []) ?? [],
    matchScore: f('matchScore', 0) ?? 0,
    matchFactors: f('matchFactors', { location: 0, budget: 0, category: 0, time: 0, popularity: 0 }),
    socialStats: (raw.socialStats ?? legacy.socialStats)
      ? { ...(raw.socialStats ?? legacy.socialStats), shares: 0 }
      : { views: 0, likes: 0, saves: 0, shares: 0 },
    location: raw.location ?? (legacy.lat != null && legacy.lng != null ? { lat: legacy.lat, lng: legacy.lng } : legacy.location),
    selectedDateTime: p.selectedDateTime
      ? new Date(p.selectedDateTime)
      : scheduledAt
        ? new Date(scheduledAt)
        : undefined,
    placeId: f('placeId', undefined),
    // ORCH-0908: pass lock-in metadata through so ExpandedCardModal renders
    // the LockedInBanner + Add-to-Calendar CTA when present.
    lockInEvent: raw.lockInEvent
      ?? (raw.event === 'card_locked_and_scheduled' ? 'card_locked_and_scheduled' : undefined),
    scheduledAt,
    durationMinutes: raw.durationMinutes ?? raw.duration_minutes,
    lockerUserId: raw.lockerUserId ?? raw.locker_user_id,
    savedCardId: raw.savedCardId ?? raw.saved_card_id,
    sessionId: raw.sessionId ?? raw.session_id,
    // ORCH-0910: pass curated/intent fields through so ExpandedCardModal's
    // isCuratedCard branch fires for chat-mounted intent cards.
    cardType,
    stops: raw.stops ?? legacy.stops,
    tagline: raw.tagline ?? legacy.tagline,
    totalPriceMin: raw.totalPriceMin ?? legacy.totalPriceMin,
    totalPriceMax: raw.totalPriceMax ?? legacy.totalPriceMax,
    estimatedDurationMinutes: raw.estimatedDurationMinutes ?? legacy.estimatedDurationMinutes,
  };
}
