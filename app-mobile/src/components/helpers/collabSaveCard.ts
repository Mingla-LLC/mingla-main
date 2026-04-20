import { BoardCardService } from '../../services/boardCardService';
import { notifyMatch } from '../../services/boardNotificationService';
import { mixpanelService } from '../../services/mixpanelService';
import { toastManager } from '../ui/Toast';
import type { Recommendation } from '../../types/recommendation';

/**
 * ORCH-0558 v3: Build the card_data JSONB payload persisted on
 * board_user_swipe_states.card_data when a user right-swipes. The
 * check_mutual_like trigger reads this to populate
 * board_saved_cards.card_data when quorum (≥2 right-swipes) is reached.
 *
 * Payload matches the ~27-key CLIENT-SHAPE the SessionViewModal's Cards tab
 * expects (same historical direct-save fingerprint), so Cards tab
 * rendering works unchanged. Curated experiences add extra fields.
 *
 * Undefined values are stripped from JSONB automatically by Supabase.
 */
function buildCardDataPayload(card: Recommendation): Record<string, unknown> {
  // Cast to any only for optional fields not in Recommendation type but
  // commonly present on cards in practice (priceTier, website, placeId,
  // curated-specific fields). These are the same optional fields the
  // legacy direct-save path used to read.
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
  reason?: string;
}

/**
 * ORCH-0558: Single authoritative client-side collab right-swipe path.
 *
 * Calls `rpc_record_swipe_and_check_match` which ATOMICALLY:
 *   1. Upserts board_user_swipe_states (fires check_mutual_like v3 trigger)
 *   2. Trigger acquires advisory lock on (session_id, experience_id) — serializes
 *      concurrent triggers and closes the READ COMMITTED race
 *   3. Trigger inserts to board_saved_cards with ON CONFLICT safety net
 *   4. RPC returns {matched, saved_card_id, card_title, matched_user_ids, reason}
 *
 * Replaces the legacy (trackSwipeState + checkForMatch) two-query pattern
 * that produced silent match-misses when the ghost-row class was present
 * and/or when quorum-reaching swipes happened concurrently.
 *
 * Toast semantics (unchanged from ORCH-0557):
 *   - Provisional "Liked — waiting for others" (2s, success/green) on entry
 *   - "It's a match!" (4s, success/green) when RPC returns matched:true
 *   - "Couldn't save — tap to retry" (3s, error) on RPC error
 *
 * In-app notification: NOT written here. The `notifications` DB row is
 * inserted by `notify-dispatch` (via `notifyMatch` → `notify-session-match`)
 * for every matched participant BEFORE push is attempted. The
 * `useNotifications` hook subscribes to that table via Supabase Realtime
 * and surfaces the notification in the sheet. This removes the old
 * `inAppNotificationService.add` call (AsyncStorage-only) per
 * SPEC_ORCH-0558 SC-12 — single source of truth is the DB table.
 *
 * Telemetry: Mixpanel events mirror the server-side match_telemetry_events:
 *   - "Collab Match Attempt"        — every right-swipe
 *   - "Collab Match Promotion Success" — RPC returns matched=true
 *   - "Collab Match Promotion Skipped" — RPC returns matched=false with reason
 *   - "Collab Match RPC Error"       — RPC returned an error
 *
 * Toast calls are wrapped in try/catch — toast unavailability cannot
 * block the save flow.
 */
export async function collabSaveCard({
  card,
  sessionId,
  userId,
  t,
}: CollabSaveCardParams): Promise<CollabSaveCardResult> {
  // 1. Provisional toast — fire-and-forget, must not throw.
  try {
    toastManager.show(
      t('swipeable.liked_waiting', { defaultValue: 'Liked — waiting for others' }),
      'success',
      2000
    );
  } catch (toastErr) {
    console.warn('[collabSaveCard] toast show failed (provisional):', toastErr);
  }

  // 2. Atomic RPC — swipe + match detection in one round-trip.
  const result = await BoardCardService.recordSwipeAndCheckMatch({
    sessionId,
    experienceId: card.id,
    userId,
    cardData: buildCardDataPayload(card),
    swipeDirection: 'right',
  });

  if (result.error) {
    console.error('[collabSaveCard] RPC failed:', result.error);
    try {
      toastManager.show(
        t('swipeable.save_failed', { defaultValue: "Couldn't save — tap to retry" }),
        'error',
        3000
      );
    } catch (toastErr) {
      console.warn('[collabSaveCard] toast show failed (error path):', toastErr);
    }
    try {
      mixpanelService.track('Collab Match RPC Error', {
        session_id: sessionId,
        experience_id: card.id,
        reason: result.reason ?? 'unknown',
        error_message: result.error.message,
      });
    } catch (telErr) {
      console.warn('[collabSaveCard] telemetry failed (error path):', telErr);
    }
    return { tracked: false, matched: false, error: result.error, reason: result.reason };
  }

  // 3. Telemetry: attempt recorded by server; client mirrors the outcome.
  try {
    mixpanelService.track('Collab Match Attempt', {
      session_id: sessionId,
      experience_id: card.id,
      swipe_direction: 'right',
    });
  } catch (telErr) {
    console.warn('[collabSaveCard] telemetry failed (attempt):', telErr);
  }

  // 4. On match: fire notifyMatch (writes in-app row via notify-dispatch +
  //    push). Match toast upgrade for the matcher's own device.
  if (result.matched && result.savedCardId && result.matchedUserIds) {
    const cardTitle = result.cardTitle || card.title || 'a spot';

    notifyMatch({
      sessionId,
      savedCardId: result.savedCardId,
      experienceId: card.id,
      cardTitle,
      matchedUserIds: result.matchedUserIds,
    });

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

    try {
      mixpanelService.track('Collab Match Promotion Success', {
        session_id: sessionId,
        experience_id: card.id,
        saved_card_id: result.savedCardId,
        matched_user_ids_count: result.matchedUserIds.length,
      });
    } catch (telErr) {
      console.warn('[collabSaveCard] telemetry failed (match):', telErr);
    }
  } else {
    try {
      mixpanelService.track('Collab Match Promotion Skipped', {
        session_id: sessionId,
        experience_id: card.id,
        reason: result.reason ?? 'unknown',
      });
    } catch (telErr) {
      console.warn('[collabSaveCard] telemetry failed (skipped):', telErr);
    }
  }

  return {
    tracked: true,
    matched: !!result.matched,
    matchedUserIds: result.matchedUserIds,
    savedCardId: result.savedCardId,
    cardTitle: result.cardTitle,
    reason: result.reason,
  };
}
