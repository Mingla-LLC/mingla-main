/**
 * #4226 phase 2B — Host app tracking that must NOT live in AuthContext.tsx
 * (a byte-pin guard owns that file, #1881) or in the root JSX (the #4271 test
 * pins the Stack / Tap to Pay host adjacency). Both hooks are called from
 * RootLayoutInner, render nothing, never throw.
 */
import { useEffect } from "react";
import { useSegments } from "expo-router";
import { Platform } from "react-native";
import { useAuth } from "../context/AuthContext";
import { postHogService } from "../services/postHogService";
import { recordHostSignupSourceOnce } from "../services/peopleJourneyService";
import { screenNameForRoute } from "../services/screenTracking";
import { useAnalyticsPrefsStore } from "../store/analyticsPrefsStore";

/** A host whose account is younger than this is treated as signing up now. */
export const NEW_HOST_WINDOW_MS = 10 * 60 * 1000;

/** One PostHog `$screen` per route change, named from route segments (no ids). */
export function useRouteScreenTracking(): void {
  const segments = useSegments();
  const key = segments.join("/");
  useEffect(() => {
    try {
      postHogService.screen(screenNameForRoute(segments));
    } catch (e) {
      console.warn("[peopleJourney] screen view failed:", e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

/**
 * How a newly created host found Mingla: recorded once, first write wins on the
 * server, when the signed-in user's account was created moments ago.
 */
export function useHostSignupSourceTracking(): void {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const createdAt = user?.created_at ? Date.parse(user.created_at) : NaN;
  useEffect(() => {
    if (!userId || Number.isNaN(createdAt)) return;
    if (Date.now() - createdAt > NEW_HOST_WINDOW_MS) return;
    void recordHostSignupSourceOnce({
      userId,
      platform: Platform.OS,
      optedOut: useAnalyticsPrefsStore.getState().analyticsOptOut === true,
    });
  }, [userId, createdAt]);
}
