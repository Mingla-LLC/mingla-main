// INVARIANT: This hook must be instantiated EXACTLY ONCE in the app (in index.tsx).
// A duplicate in AppStateManager was removed in ORCH-0236. Do not add another.
// Adding a second instance causes double auth refresh, double query invalidation,
// and double Realtime reconnect attempts.

import { useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { onlineManager, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../services/supabase';
import { resetAuth401Counter, enterAuth401GracePeriod } from '../config/queryClient';
import { toastManager } from '../components/ui/Toast';
import { friendsKeys } from './useFriendsQuery';
import { boardKeys } from './useBoardQueries';
import { savedCardKeys } from './queryKeys';
import { pairingKeys } from './usePairings';
import { phoneInviteKeys } from './usePhoneInvite';
import { subscriptionKeys } from './useSubscription';
import { logger } from '../utils/logger';

// Query key prefixes for critical queries that should refresh on resume.
// Deck/curated/session-deck EXCLUDED — active swipe sessions that only refresh on
// explicit preference change (query key changes). Force-invalidating them on resume
// causes mid-session deck resets.
// Decision: user 2026-04-08, historical context: commits bb815916 → 6bb8b670.
// Discover/map content IS included — these are passive browsing views, not swipe sessions.
const CRITICAL_QUERY_KEYS = [
  friendsKeys.all,                // friends list, requests, blocked, muted
  boardKeys.all,                  // collaboration boards
  savedCardKeys.all,              // saved cards + saves + paired saves
  pairingKeys.prefix,             // pairings and pair requests
  phoneInviteKeys.all,            // pending phone invites
  subscriptionKeys.all,           // subscription status
  ['calendarEntries'],            // calendar entries
  ['userPreferences'],            // user preferences
  ['discover-experiences'],       // discover grid experiences
  ['map-cards-singles'],          // map view single cards
  ['map-cards-curated'],          // map view curated cards
  ['nearby-people'],              // nearby people on discover map (ORCH-0385)
  ['map-settings'],               // map visibility & activity status (ORCH-0385)
] as const;

const DEBOUNCE_MS = 500;
const AUTH_TIMEOUT_MS = 8000;
const AUTH_RETRY_DELAY_MS = 3000;
const AUTH_MAX_ATTEMPTS = 3;
const GRACE_PERIOD_MS = 15000;
const MIN_BACKGROUND_FOR_INVALIDATION_MS = 5000;
const SHORT_BACKGROUND_THRESHOLD_MS = 30000;

/**
 * Centralized foreground resume handler.
 *
 * Works in tandem with focusManager (wired to AppState in queryClient.ts).
 * focusManager handles automatic stale-query refetch on every resume.
 * This hook orchestrates the auth-first resume sequence for long backgrounds:
 *
 *   Trivial background (< 5s):
 *     - Fires onResume callback only
 *     - Skips all query invalidation (real-time handles live updates)
 *
 *   Short background (5-30s):
 *     - Invalidates all CRITICAL_QUERY_KEYS (forces background refetch)
 *     - Fires onResume callback
 *     - Skips auth refresh + Realtime remount (token valid, socket alive)
 *
 *   Long background (≥ 30s):
 *     - AUTH-FIRST: refreshes Supabase session with 3-attempt retry
 *     - REALTIME: increments realtimeEpoch to force channel hook remount
 *     - INVALIDATE: marks all CRITICAL_QUERY_KEYS as stale (fresh JWT)
 *     - CALLBACK: fires onResume for non-RQ work (refreshAllSessions)
 *
 * INVARIANT I-RT-BIND-01: NEVER call supabase.realtime.disconnect() + connect().
 * This clears channel.bindings (RealtimeChannel.js:313 teardown). Use realtimeEpoch
 * remount instead. See INV-010 Track 2 for SDK proof.
 *
 * @param userId - Current authenticated user ID. Hook is inert when null/undefined.
 * @param onResume - Optional callback for non-React-Query work (e.g., refreshAllSessions).
 * @returns Object with resumeCount (increments each resume) and realtimeEpoch
 *          (increments on long-background to trigger channel remount).
 */
export function useForegroundRefresh(
  userId: string | undefined,
  onResume?: () => void,
): { resumeCount: number; realtimeEpoch: number } {
  const queryClient = useQueryClient();
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const backgroundTimestampRef = useRef<number | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [resumeCount, setResumeCount] = useState(0);
  const [realtimeEpoch, setRealtimeEpoch] = useState(0);

  const onResumeRef = useRef(onResume);
  onResumeRef.current = onResume;

  useEffect(() => {
    if (!userId) return;

    const handleAppStateChange = (nextState: AppStateStatus) => {
      const prevState = appStateRef.current;

      // Track when we enter background (for duration logging + skip logic)
      if (nextState === 'background') {
        backgroundTimestampRef.current = Date.now();
        // Stop the Supabase auto-refresh ticker to save battery while backgrounded.
        // iOS freezes timers anyway, but this ensures a clean restart on resume.
        // Constraint S8: isBrowser()=false means ticker runs unconditionally without this.
        supabase.auth.stopAutoRefresh();
      }

      // Only background → active is a genuine resume. iOS inactive → active
      // (Control Center, notification shade, Siri) must NOT trigger refresh.
      const wasBackground = prevState === 'background';
      const isNowActive = nextState === 'active';

      appStateRef.current = nextState;

      if (!wasBackground || !isNowActive) return;

      // Restart the auto-refresh ticker immediately on foreground.
      supabase.auth.startAutoRefresh();

      // Enter grace period BEFORE debounce — focusManager fires refetches
      // immediately on resume (before the 500ms debounce). With an expired JWT,
      // those refetches return 401. The grace period prevents these burst 401s
      // from triggering a false forced sign-out.
      enterAuth401GracePeriod(GRACE_PERIOD_MS);

      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      debounceTimerRef.current = setTimeout(async () => {
        const bgTimestamp = backgroundTimestampRef.current;
        const bgDurationMs = bgTimestamp ? Date.now() - bgTimestamp : null;
        const bgLabel = bgDurationMs !== null ? `${Math.round(bgDurationMs / 1000)}s` : 'unknown';
        const isShortBackground = bgDurationMs !== null && bgDurationMs < SHORT_BACKGROUND_THRESHOLD_MS;
        const isTrivialBackground = bgDurationMs !== null && bgDurationMs < MIN_BACKGROUND_FOR_INVALIDATION_MS;

        resetAuth401Counter();
        setResumeCount(c => c + 1);

        if (__DEV__) {
          logger.lifecycle(
            `[RESUME] Foreground refresh | backgroundDuration=${bgLabel} | queries=${CRITICAL_QUERY_KEYS.length} families | longBackground=${!isShortBackground} | trivial=${isTrivialBackground}`,
          );
        }

        // ── Trivial background (< 5s): skip invalidation entirely ──
        if (isTrivialBackground) {
          if (__DEV__) {
            logger.lifecycle(`[RESUME] Trivial background (${bgLabel}) — skipping query invalidation`);
          }
          onResumeRef.current?.();
          return;
        }

        // ── Short background (5-30s): invalidate queries only ──
        if (isShortBackground) {
          for (const key of CRITICAL_QUERY_KEYS) {
            queryClient.invalidateQueries({ queryKey: key });
          }
          onResumeRef.current?.();
          return;
        }

        // ══════════════════════════════════════════════════════════
        // LONG BACKGROUND (≥ 30s) — Auth-first resume sequence
        // ══════════════════════════════════════════════════════════

        // Step 1: AUTH-FIRST — refresh before anything else.
        // If device is confirmed offline, skip the entire auth retry loop.
        // No point making 3 × 8s timeout attempts against a dead network.
        // INVARIANT I-NEVER-SIGNOUT: NEVER auto-sign-out. User directive 2026-04-08. See ORCH-0340.
        let authOk = false;

        if (!onlineManager.isOnline()) {
          // Offline: skip auth retry. Keep user signed in with cached data.
          // refetchOnReconnect: 'always' will refresh queries when network returns.
          if (__DEV__) logger.lifecycle('[RESUME] Device offline — skipping auth retry, using cached data');
        } else {
          // Online: attempt auth refresh with retry.
          // 3 attempts with 8s timeout each, 3s sleep between attempts.
          for (let attempt = 1; attempt <= AUTH_MAX_ATTEMPTS; attempt++) {
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
                  console.warn(`[RESUME] Auth refresh attempt ${attempt} failed:`, error.message);
                } else {
                  authOk = true;
                  if (__DEV__) logger.lifecycle(`[RESUME] Auth refresh succeeded on attempt ${attempt}`);
                  break;
                }
              } finally {
                clearTimeout(authTimeoutId!);
              }
            } catch (e: any) {
              console.warn(`[RESUME] Auth refresh attempt ${attempt} error:`, e?.message ?? e);
            }

            if (!authOk && attempt < AUTH_MAX_ATTEMPTS) {
              await new Promise(resolve => setTimeout(resolve, AUTH_RETRY_DELAY_MS));
            }
          }

          // Check for ghost recovery if all explicit attempts failed.
          if (!authOk) {
            try {
              const { data } = await supabase.auth.getSession();
              if (data?.session?.expires_at) {
                const expiresMs = data.session.expires_at * 1000;
                if (expiresMs > Date.now()) {
                  authOk = true;
                  if (__DEV__) logger.lifecycle('[RESUME] Ghost recovery detected — session is valid');
                }
              }
            } catch {
              // Session read failed
            }
          }

          // Auth failed while online: show non-destructive toast, NOT sign-out.
          // The Supabase auto-refresh ticker (30s) will keep trying in the background.
          if (!authOk) {
            console.warn('[RESUME] Auth refresh failed while online — showing toast');
            toastManager.warning('Having trouble connecting. Your data may be stale.', 4000);
          }
        }
        // In ALL cases (offline, auth failed, auth succeeded): proceed to
        // Realtime remount + query invalidation. Cached data stays visible.

        // Step 4: REALTIME — aggressive remount (user decision 2026-04-08).
        // Increment realtimeEpoch to force React to unmount/remount
        // RealtimeSubscriptions component, creating fresh channels with fresh bindings.
        // DO NOT call supabase.realtime.disconnect() + connect() — this clears
        // channel.bindings (RealtimeChannel.js:313 teardown). I-RT-BIND-01.
        setRealtimeEpoch(e => e + 1);
        if (__DEV__) logger.lifecycle('[RESUME] Realtime epoch incremented — channels will remount');

        // Warm edge functions before query invalidations trigger refetches
        supabase.functions.invoke('keep-warm').catch(() => {});

        // Step 5: INVALIDATE queries (now with fresh JWT).
        for (const key of CRITICAL_QUERY_KEYS) {
          queryClient.invalidateQueries({ queryKey: key });
        }

        // Pre-warm preferences cache
        queryClient.prefetchQuery({
          queryKey: ['userPreferences', userId],
          staleTime: 60_000,
        });

        if (__DEV__) {
          logger.lifecycle(
            `[RESUME] Invalidated ${CRITICAL_QUERY_KEYS.length} query families after auth-first sequence`,
          );
        }

        // Step 6: Fire the callback for non-React-Query refreshes.
        // refreshAllSessions() now fires AFTER auth is confirmed valid.
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

  return { resumeCount, realtimeEpoch };
}
