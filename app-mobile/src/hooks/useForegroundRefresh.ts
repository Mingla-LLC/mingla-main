import { useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../services/supabase';
import { friendsKeys } from './useFriendsQuery';
import { boardKeys } from './useBoardQueries';
import { saveKeys } from './useSaveQueries';
import { pairingKeys } from './usePairings';
import { phoneInviteKeys } from './usePhoneInvite';
import { subscriptionKeys } from './useSubscription';
import { logger } from '../utils/logger';

// Query key prefixes for lightweight/critical queries that should refresh on resume.
// Expensive queries (deck-cards, curated-experiences, discover-experiences) are
// intentionally EXCLUDED — they involve paid API calls and use their own staleTime.
const CRITICAL_QUERY_KEYS = [
  friendsKeys.all,                // friends list, requests, blocked, muted
  boardKeys.all,                  // collaboration boards
  saveKeys.all,                   // saved experiences
  pairingKeys.prefix,              // pairings and pair requests
  phoneInviteKeys.all,            // pending phone invites
  subscriptionKeys.all,           // subscription status
  ['savedCards'],                  // saved cards
  ['calendarEntries'],            // calendar entries
  ['userPreferences'],            // user preferences
] as const;

const DEBOUNCE_MS = 500;
const AUTH_TIMEOUT_MS = 8000;
const SHORT_BACKGROUND_THRESHOLD_MS = 30000;

/**
 * Centralized foreground resume handler.
 *
 * This is the SINGLE AUTHORITY for resume-triggered query work. React Query's
 * focusManager is explicitly disabled (see queryClient.ts). All resume logic
 * flows through this hook:
 *
 *   1. (Skip if background < 30s) Validates the Supabase auth session with 8s timeout
 *   2. Forces Supabase Realtime WebSocket reconnection (channels re-subscribe automatically)
 *   3. Invalidates all critical React Query caches (triggers background refetch)
 *   4. Calls the provided onResume callback (for non-React-Query refreshes)
 *
 * Cached data remains visible during the refresh — no loading flash.
 *
 * @param userId - Current authenticated user ID. Hook is inert when null/undefined.
 * @param onResume - Optional callback for non-React-Query work (e.g., refreshAllSessions).
 * @returns resumeCount - Increments on each resume. Consumers can observe this to
 *          re-arm safety timeouts.
 */
export function useForegroundRefresh(
  userId: string | undefined,
  onResume?: () => void,
): number {
  const queryClient = useQueryClient();
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const backgroundTimestampRef = useRef<number | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // useState (not useRef) because the parent must re-render to pass the new
  // value as a prop to RecommendationsProvider.
  const [resumeCount, setResumeCount] = useState(0);

  // Use refs for callback to avoid re-subscribing on every render
  const onResumeRef = useRef(onResume);
  onResumeRef.current = onResume;

  useEffect(() => {
    if (!userId) return;

    const handleAppStateChange = (nextState: AppStateStatus) => {
      const prevState = appStateRef.current;

      // Track when we enter background (for duration logging + skip logic)
      if (nextState === 'background') {
        backgroundTimestampRef.current = Date.now();
      }

      // Only background → active is a genuine resume. iOS inactive → active
      // (Control Center, notification shade, Siri) must NOT trigger refresh.
      const wasBackground = prevState === 'background';
      const isNowActive = nextState === 'active';

      // Update ref BEFORE async work (prevents double-fire if state changes during debounce)
      appStateRef.current = nextState;

      if (!wasBackground || !isNowActive) return;
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      debounceTimerRef.current = setTimeout(async () => {
        const bgTimestamp = backgroundTimestampRef.current;
        const bgDurationMs = bgTimestamp ? Date.now() - bgTimestamp : null;
        const bgLabel = bgDurationMs !== null ? `${Math.round(bgDurationMs / 1000)}s` : 'unknown';
        const isShortBackground = bgDurationMs !== null && bgDurationMs < SHORT_BACKGROUND_THRESHOLD_MS;

        // Increment resume counter so consumers (RecommendationsContext) can
        // detect resume events and re-arm safety timeouts.
        setResumeCount(c => c + 1);

        if (__DEV__) {
          logger.lifecycle(
            `[RESUME] Foreground refresh | backgroundDuration=${bgLabel} | queries=${CRITICAL_QUERY_KEYS.length} families | shortSkip=${isShortBackground}`,
          );
        }

        if (isShortBackground) {
          // Short background (< 30s): skip auth refresh and query invalidation.
          // Data is still within staleTime (5min), sockets are alive, JWT is valid.
          // Only fire the onResume callback for collaboration state catch-up.
          onResumeRef.current?.();
          return;
        }

        // Step 1: Validate/refresh auth session with hard timeout.
        // supabase.auth.getSession() reads stored session and triggers JWT refresh
        // if expired. Cap at 8 seconds — if it hangs (dead socket after long background),
        // proceed with the existing token. Supabase's auto-retry on 401 handles renewal
        // transparently when individual queries fire.
        try {
          let authTimeoutId: ReturnType<typeof setTimeout>;
          const sessionPromise = supabase.auth.getSession();
          const timeoutPromise = new Promise<never>((_, reject) => {
            authTimeoutId = setTimeout(
              () => reject(new Error('Auth session refresh timed out')),
              AUTH_TIMEOUT_MS,
            );
          });
          try {
            const { error } = await Promise.race([sessionPromise, timeoutPromise]);
            if (error) {
              console.warn('[RESUME] Session refresh failed:', error.message);
            }
          } finally {
            // Always clear the timer — prevents a dangling 8s timer when
            // getSession() resolves before the timeout fires.
            clearTimeout(authTimeoutId!);
          }
        } catch (e: any) {
          // Timeout or network error — proceed with existing token
          console.warn('[RESUME] Session refresh unavailable:', e?.message ?? e);
        }

        // Step 2: Force Realtime WebSocket reconnection after long background.
        // After ≥30s backgrounded, the OS may have killed the TCP connection.
        // Supabase's internal reconnect uses exponential backoff that may not fire
        // immediately on resume. disconnect() + connect() forces an immediate
        // reconnection. The SDK automatically re-subscribes all existing channels.
        try {
          supabase.realtime.disconnect();
          supabase.realtime.connect();
          if (__DEV__) logger.lifecycle('[RESUME] Realtime WebSocket reconnected');
        } catch (e) {
          console.warn('[RESUME] Realtime reconnect failed:', e);
        }

        // Step 3: Invalidate all critical queries.
        // invalidateQueries() marks them as stale AND triggers background refetch.
        // Cached data stays visible — isLoading stays false when data exists in cache.
        for (const key of CRITICAL_QUERY_KEYS) {
          queryClient.invalidateQueries({ queryKey: key });
        }

        // Step 4: Fire the callback for non-React-Query refreshes
        onResumeRef.current?.();
      }, DEBOUNCE_MS);
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);

    return () => {
      subscription.remove();
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [userId, queryClient]);

  return resumeCount;
}
