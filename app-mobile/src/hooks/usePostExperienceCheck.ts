import { useEffect, useRef, useState, useCallback } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { useAppStore } from '../store/appStore';
import { supabase } from '../services/supabase';

// ── Types ───────────────────────────────────────────────────────────────────

export interface PendingExperienceReview {
  calendarEntryId: string;
  cardId: string;
  placeName: string;
  placeAddress?: string;
  placeCategory?: string;
  placeImage?: string;
  placePoolId?: string;
  googlePlaceId?: string;
  scheduledAt: string;
  cardData: any;
}

// ── Constants ───────────────────────────────────────────────────────────────

const MODAL_DELAY_MS = 3_000;
const INTERVAL_CHECK_MS = 60_000;

// ── Hook ────────────────────────────────────────────────────────────────────

export function usePostExperienceCheck() {
  const { user } = useAppStore();

  const [pendingReview, setPendingReview] = useState<PendingExperienceReview | null>(null);
  const [showReviewModal, setShowReviewModal] = useState(false);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isCheckingRef = useRef(false);
  const hasCheckedRef = useRef(false);

  // ── Core check function ─────────────────────────────────────────────────
  const checkForPendingReviews = useCallback(async () => {
    if (!user?.id) return;
    if (isCheckingRef.current) return;

    isCheckingRef.current = true;

    try {
      const now = new Date().toISOString();

      const { data: entries, error } = await supabase
        .from('calendar_entries')
        .select('id, card_id, card_data, scheduled_at, status, feedback_status')
        .eq('user_id', user.id)
        .in('status', ['pending', 'confirmed'])
        .lt('scheduled_at', now)
        .is('feedback_status', null)
        .is('archived_at', null)
        .order('scheduled_at', { ascending: true })
        .limit(1);

      if (error) {
        console.error('[usePostExperienceCheck] Query error:', error.message);
        return;
      }

      if (!entries || entries.length === 0) {
        setPendingReview(null);
        return;
      }

      const oldest = entries[0];
      const cardData = oldest.card_data || {};

      setPendingReview({
        calendarEntryId: oldest.id,
        cardId: oldest.card_id || '',
        placeName: cardData.title || cardData.experience_title || 'your experience',
        placeAddress: cardData.address || undefined,
        placeCategory: cardData.category || undefined,
        placeImage: cardData.image || (Array.isArray(cardData.images) ? cardData.images[0] : undefined),
        placePoolId: cardData.place_pool_id || undefined,
        googlePlaceId: cardData.placeId || cardData.id || cardData.googlePlaceId || undefined,
        scheduledAt: oldest.scheduled_at,
        cardData,
      });

      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }

      timerRef.current = setTimeout(() => {
        setShowReviewModal(true);
      }, MODAL_DELAY_MS);

    } catch (err) {
      console.error('[usePostExperienceCheck] Error checking pending reviews:', err);
    } finally {
      isCheckingRef.current = false;
    }
  }, [user?.id]);

  // ── Check on mount (login) — once ───────────────────────────────────────
  useEffect(() => {
    if (user?.id && !hasCheckedRef.current) {
      hasCheckedRef.current = true;
      checkForPendingReviews();
    }
  }, [user?.id, checkForPendingReviews]);

  // ── Check when app comes to foreground ──────────────────────────────────
  useEffect(() => {
    const handleAppStateChange = (next: AppStateStatus) => {
      if (next === 'active' && user?.id) {
        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
        checkForPendingReviews();
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);

    return () => {
      subscription.remove();
    };
  }, [user?.id, checkForPendingReviews]);

  // ── Periodic check every 60 seconds ─────────────────────────────────────
  useEffect(() => {
    if (!user?.id) return;

    intervalRef.current = setInterval(() => {
      if (!pendingReview && !showReviewModal) {
        checkForPendingReviews();
      }
    }, INTERVAL_CHECK_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [user?.id, pendingReview, showReviewModal, checkForPendingReviews]);

  // ── Cleanup timer on unmount ────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  // ── Dismiss ─────────────────────────────────────────────────────────────
  const dismissReview = useCallback(() => {
    setShowReviewModal(false);
    setPendingReview(null);

    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // ── Recheck (called after a review is submitted) ────────────────────────
  const recheckPending = useCallback(async () => {
    setPendingReview(null);
    setShowReviewModal(false);
    hasCheckedRef.current = false;

    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    // Small delay to let the DB update propagate
    await new Promise((resolve) => setTimeout(resolve, 500));

    await checkForPendingReviews();
  }, [checkForPendingReviews]);

  // ── Return ──────────────────────────────────────────────────────────────
  return {
    pendingReview,
    showReviewModal,
    dismissReview,
    recheckPending,
  };
}
