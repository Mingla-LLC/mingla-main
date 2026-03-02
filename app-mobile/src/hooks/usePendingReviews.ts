import { useEffect, useRef, useState, useCallback } from "react";
import { AppState, AppStateStatus } from "react-native";
import { experienceFeedbackService } from "../services/experienceFeedbackService";
import { useAppStore } from "../store/appStore";

interface PendingReview {
  cardId: string;
  experienceTitle: string;
}

/**
 * Hook that checks for past-due scheduled experiences that haven't been reviewed.
 * When the user returns to the app (foreground) or logs in, it waits 10 seconds
 * then surfaces the oldest un-reviewed experience for feedback.
 */
export function usePendingReviews() {
  const { user } = useAppStore();
  const [pendingReview, setPendingReview] = useState<PendingReview | null>(null);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasCheckedRef = useRef(false);

  const checkForPendingReviews = useCallback(async () => {
    if (!user?.id) return;

    try {
      const entries = await experienceFeedbackService.getPendingReviewEntries(user.id);

      if (entries.length > 0) {
        const oldest = entries[entries.length - 1]; // oldest first
        const title =
          oldest.card_data?.title ||
          oldest.card_data?.experience_title ||
          "your experience";

        setPendingReview({
          cardId: oldest.card_id,
          experienceTitle: title,
        });

        // Wait 10 seconds before showing the modal so users can settle in
        timerRef.current = setTimeout(() => {
          setShowReviewModal(true);
        }, 10_000);
      }
    } catch (err) {
      console.error("[usePendingReviews] Error checking pending reviews:", err);
    }
  }, [user?.id]);

  // Check on mount (login) — once
  useEffect(() => {
    if (user?.id && !hasCheckedRef.current) {
      hasCheckedRef.current = true;
      checkForPendingReviews();
    }
  }, [user?.id, checkForPendingReviews]);

  // Check when app comes to foreground
  useEffect(() => {
    const handleAppStateChange = (next: AppStateStatus) => {
      if (next === "active" && user?.id) {
        // Clear any existing timer
        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
        checkForPendingReviews();
      }
    };

    const subscription = AppState.addEventListener("change", handleAppStateChange);
    return () => {
      subscription.remove();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [user?.id, checkForPendingReviews]);

  const dismissReview = useCallback(() => {
    setShowReviewModal(false);
    setPendingReview(null);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  return {
    pendingReview,
    showReviewModal,
    dismissReview,
  };
}
