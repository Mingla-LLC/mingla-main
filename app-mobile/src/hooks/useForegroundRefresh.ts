import { useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../services/supabase';
import { resetAuth401Counter, enterAuth401GracePeriod } from '../config/queryClient';
import { friendsKeys } from './useFriendsQuery';
import { boardKeys } from './useBoardQueries';
import { savedCardKeys } from './queryKeys';
import { pairingKeys } from './usePairings';
import { phoneInviteKeys } from './usePhoneInvite';
import { subscriptionKeys } from './useSubscription';
import { logger } from '../utils/logger';

// Query key prefixes for critical queries that should refresh on resume.
// Content queries are included — they read from card_pool/place_pool (our DB), not
// external APIs. personCardKeys intentionally excluded — uses staleTime: Infinity.
const CRITICAL_QUERY_KEYS = [
  friendsKeys.all,                // friends list, requests, blocked, muted
  boardKeys.all,                  // collaboration boards
  savedCardKeys.all,              // saved cards + saves + paired saves
  pairingKeys.prefix,              // pairings and pair requests
  phoneInviteKeys.all,            // pending phone invites
  subscriptionKeys.all,           // subscription status
  ['calendarEntries'],            // calendar entries
  ['userPreferences'],            // user preferences
  ['deck-cards'],                 // swipe deck cards
  ['curated-experiences'],        // curated multi-stop experiences
  ['discover-experiences'],       // discover grid experiences
  ['session-deck'],               // collaboration session deck
  ['map-cards-singles'],          // map view single cards
  ['map-cards-curated'],          // map view curated cards
] as const;

const DEBOUNCE_MS = 500;
const AUTH_TIMEOUT_MS = 8000;
const MIN_BACKGROUND_FOR_INVALIDATION_MS = 5000;
const SHORT_BACKGROUND_THRESHOLD_MS = 30000;

/**
 * Centralized foreground resume handler.
 *
 * Works in tandem with focusManager (wired to AppState in queryClient.ts).
 * focusManager handles automatic stale-query refetch on every resume.
 * This hook adds force-invalidation of all critical queries, plus auth
 * refresh and WebSocket reconnection for long backgrounds (≥ 30s):
 *
 *   Trivial background (< 5s):
 *     - Fires onResume callback only
 *     - Skips all query invalidation (real-time handles live updates)
 *     - Avoids wasting bandwidth on quick notification checks / app switcher
 *
 *   Short background (5-30s):
 *     - Invalidates all CRITICAL_QUERY_KEYS (forces background refetch)
 *     - Fires onResume callback
 *     - Skips auth refresh + WebSocket reconnect (token valid, socket alive)
 *
 *   Long background (≥ 30s):
 *     - Validates/refreshes Supabase auth session (8s timeout)
 *     - Forces Realtime WebSocket reconnection
 *     - Invalidates all CRITICAL_QUERY_KEYS
 *     - Fires onResume callback
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

      // Enter grace period BEFORE debounce — focusManager fires refetches
      // immediately on resume (before the 500ms debounce). With an expired JWT,
      // those refetches return 401. The grace period prevents these burst 401s
      // from triggering a false forced sign-out.
      enterAuth401GracePeriod(3000);

      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      debounceTimerRef.current = setTimeout(async () => {
        const bgTimestamp = backgroundTimestampRef.current;
        const bgDurationMs = bgTimestamp ? Date.now() - bgTimestamp : null;
        const bgLabel = bgDurationMs !== null ? `${Math.round(bgDurationMs / 1000)}s` : 'unknown';
        const isShortBackground = bgDurationMs !== null && bgDurationMs < SHORT_BACKGROUND_THRESHOLD_MS;
        const isTrivialBackground = bgDurationMs !== null && bgDurationMs < MIN_BACKGROUND_FOR_INVALIDATION_MS;

        // Reset the 401 counter BEFORE any queries fire. focusManager triggers
        // refetches immediately on resume (before this debounced handler). After
        // a long background with expired JWT, those refetches hit 401. Without
        // this reset, 3+ simultaneous 401s would trigger forced sign-out before
        // auth refresh below has a chance to run.
        resetAuth401Counter();

        // Increment resume counter so consumers (RecommendationsContext) can
        // detect resume events and re-arm safety timeouts.
        setResumeCount(c => c + 1);

        if (__DEV__) {
          logger.lifecycle(
            `[RESUME] Foreground refresh | backgroundDuration=${bgLabel} | queries=${CRITICAL_QUERY_KEYS.length} families | longBackground=${!isShortBackground} | trivial=${isTrivialBackground}`,
          );
        }

        // ── Trivial background (< 5s): skip invalidation entirely ──
        // Quick notification check, screenshot, app switcher peek — nothing
        // meaningful changed. Real-time subscriptions handle live updates.
        // Still fire onResume callback (collaboration sessions may need it).
        if (isTrivialBackground) {
          if (__DEV__) {
            logger.lifecycle(`[RESUME] Trivial background (${bgLabel}) — skipping query invalidation`);
          }
          onResumeRef.current?.();
          return;
        }

        if (!isShortBackground) {
          // ── Long background (≥ 30s): auth may have expired, sockets may be dead ──

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
          // Warm edge functions before query invalidations trigger refetches
          supabase.functions.invoke('keep-warm').catch(() => {});
        }

        // ── 5-30s and ≥30s backgrounds: invalidate critical queries + fire callback ──
        // invalidateQueries() marks caches as stale AND triggers background refetch.
        // Cached data stays visible — isLoading stays false when data exists in cache.
        // For short backgrounds (5-30s) this is the only refresh mechanism; for long
        // backgrounds it runs after auth + WebSocket reconnection above.
        for (const key of CRITICAL_QUERY_KEYS) {
          queryClient.invalidateQueries({ queryKey: key });
        }

        // Pre-warm preferences cache — uses staleTime: Infinity so won't
        // auto-refetch on focus without explicit invalidation above.
        queryClient.prefetchQuery({
          queryKey: ['userPreferences', userId],
          staleTime: 60_000,
        });

        if (__DEV__) {
          logger.lifecycle(
            `[RESUME] Invalidated ${CRITICAL_QUERY_KEYS.length} query families | longBackground=${!isShortBackground}`,
          );
        }

        // Fire the callback for non-React-Query refreshes (collaboration sessions, notifications)
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
