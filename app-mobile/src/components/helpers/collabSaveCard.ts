import { BoardCardService } from '../../services/boardCardService';
import { notifyMatch } from '../../services/boardNotificationService';
import { inAppNotificationService } from '../../services/inAppNotificationService';
import { toastManager } from '../ui/Toast';
import type { Recommendation } from '../../types/recommendation';

/**
 * ORCH-0556: Build the card_data JSONB payload persisted on
 * board_user_swipe_states.card_data when a user right-swipes. The
 * check_mutual_like trigger reads this to populate
 * board_saved_cards.card_data when quorum (≥2 right-swipes) is reached.
 *
 * The payload shape MUST match what SessionViewModal's Cards tab expects
 * (same ~27-key CLIENT-SHAPE the V2 investigation identified as the
 * historical direct-save fingerprint), so Cards tab rendering works
 * unchanged. Curated experiences add extra fields (stops, tagline, etc.).
 *
 * Undefined values are stripped from JSONB automatically by Supabase.
 */
function buildCardDataPayload(card: Recommendation): Record<string, unknown> {
  // Cast to any only for the optional fields that aren't in the Recommendation
  // type but are commonly present on cards in practice (priceTier, website,
  // placeId, curated-specific fields, etc.). These are the same optional
  // fields AppHandlers.handleSaveCard used to read for the old direct-save path.
  const c = card as Recommendation & Record<string, unknown>;
  return {
    id: card.id,
    experience_id: card.id,
    title: card.title,
    category: card.category,
    categoryIcon: card.categoryIcon,
    image: card.image,
    images: card.images,
    rating: card.rating,
    reviewCount: card.reviewCount,
    travelTime: card.travelTime,
    priceRange: card.priceRange,
    priceTier: c.priceTier,
    description: card.description,
    fullDescription: card.fullDescription,
    address: card.address,
    openingHours: card.openingHours,
    highlights: card.highlights,
    matchScore: card.matchScore,
    socialStats: card.socialStats,
    matchFactors: card.matchFactors,
    lat: card.lat,
    lng: card.lng,
    website: c.website ?? c.websiteUri,
    websiteUri: c.websiteUri ?? c.website,
    phone: c.phone,
    placeId: c.placeId,
    googleMapsUri: c.googleMapsUri,
    location: c.location,
    distance: c.distance,
    tags: c.tags,
    strollData: c.strollData,
    picnicData: c.picnicData,
    // Curated-experience extras (only present when cardType === 'curated')
    ...(c.cardType === 'curated'
      ? {
          cardType: c.cardType,
          stops: c.stops,
          tagline: c.tagline,
          totalPriceMin: c.totalPriceMin,
          totalPriceMax: c.totalPriceMax,
          estimatedDurationMinutes: c.estimatedDurationMinutes,
          pairingKey: c.pairingKey,
          experienceType: c.experienceType,
          shoppingList: c.shoppingList,
        }
      : {}),
  };
}

export interface CollabSaveCardParams {
  card: Recommendation;
  sessionId: string;
  userId: string;
  t: (key: string, opts?: Record<string, unknown>) => string;
}

export interface CollabSaveCardResult {
  tracked: boolean;
  matched: boolean;
  matchedUserIds?: string[];
  savedCardId?: string;
  cardTitle?: string;
  error?: Error;
}

/**
 * ORCH-0532: THE ONLY path client-side collab right-swipe/save logic should take.
 *
 * Writes to `board_user_swipe_states` via `trackSwipeState`. The
 * `check_mutual_like` trigger (SECURITY DEFINER, enforced by RLS policy
 * `bsc_insert_trigger_or_service_only`) decides whether to promote to
 * `board_saved_cards` based on ≥2-participant quorum.
 *
 * DO NOT call `BoardCardService.saveCardToBoard` from this helper or anywhere
 * else in user-auth context. Direct INSERTs into `board_saved_cards` are
 * rejected by RLS policy (migration 20260420000006), AND they would bypass
 * quorum logic even if RLS were weaker.
 *
 * Toast semantics (Q1 Option B):
 *   - On successful swipe-right: show "Liked — waiting for others" (2s, info)
 *   - If checkForMatch returns matched: true: replace with "It's a match!"
 *     (4s, success) + fire notifyMatch + local in-app notification
 *   - On trackSwipeState error: show "Couldn't save — tap to retry" (3s, error)
 *
 * All toast calls are wrapped in try/catch — toast system unavailability
 * must never propagate and block the save flow.
 */
export async function collabSaveCard({
  card,
  sessionId,
  userId,
  t,
}: CollabSaveCardParams): Promise<CollabSaveCardResult> {
  // 1. Provisional toast — fire-and-forget, must not throw.
  // ORCH-0557: 'success' (green) instead of 'info' (blue) — user feedback
  // that blue looked wrong; green communicates "your action registered"
  // while the "waiting for others" copy clarifies the pending quorum state.
  // Color stays continuous (success → success) across the provisional→match
  // transition if quorum is reached, avoiding a jarring color swap.
  try {
    toastManager.show(
      t('swipeable.liked_waiting', { defaultValue: 'Liked — waiting for others' }),
      'success',
      2000
    );
  } catch (toastErr) {
    // Toast system unavailable — non-fatal. Log and continue.
    console.warn('[collabSaveCard] toast show failed (provisional):', toastErr);
  }

  // 2. Write swipe-state row — the ONE authoritative client write for collab.
  //    trackSwipeState catches internally and returns { data, error }.
  //    ORCH-0556: pass cardData payload so check_mutual_like trigger can
  //    populate board_saved_cards.card_data when quorum is reached
  //    (session_decks was dropped — trigger now reads from swipe-state rows).
  const { error: trackErr } = await BoardCardService.trackSwipeState({
    sessionId,
    experienceId: card.id,
    userId,
    swipeDirection: 'right',
    cardData: buildCardDataPayload(card),
  });

  if (trackErr) {
    console.error('[collabSaveCard] trackSwipeState failed:', trackErr);
    try {
      toastManager.show(
        t('swipeable.save_failed', { defaultValue: "Couldn't save — tap to retry" }),
        'error',
        3000
      );
    } catch (toastErr) {
      console.warn('[collabSaveCard] toast show failed (error path):', toastErr);
    }
    return { tracked: false, matched: false, error: trackErr as Error };
  }

  // 3. Check if the trigger promoted to a match (quorum reached).
  const matchResult = await BoardCardService.checkForMatch(sessionId, card.id);

  if (matchResult.matched && matchResult.savedCardId && matchResult.matchedUserIds) {
    const cardTitle = matchResult.cardTitle || card.title || 'a spot';

    // Fire match push/analytics — fire-and-forget, must not block toast.
    notifyMatch({
      sessionId,
      savedCardId: matchResult.savedCardId,
      experienceId: card.id,
      cardTitle,
      matchedUserIds: matchResult.matchedUserIds,
    });

    // Local in-app notification for the current user.
    inAppNotificationService.add(
      'board_card_matched',
      t('swipeable.match_title', { defaultValue: "It's a match!" }),
      t('swipeable.match_body', {
        defaultValue: `You and others liked ${cardTitle}`,
        cardTitle,
      }),
      { page: 'home', sessionId }
    );

    // Upgrade the provisional toast to the match toast.
    try {
      toastManager.show(
        t('swipeable.match_toast', {
          defaultValue: `It's a match! 🎉 ${cardTitle}`,
          cardTitle,
        }),
        'success',
        4000
      );
    } catch (toastErr) {
      console.warn('[collabSaveCard] toast show failed (match):', toastErr);
    }
  }

  return {
    tracked: true,
    matched: !!matchResult.matched,
    matchedUserIds: matchResult.matchedUserIds,
    savedCardId: matchResult.savedCardId,
    cardTitle: matchResult.cardTitle,
  };
}
