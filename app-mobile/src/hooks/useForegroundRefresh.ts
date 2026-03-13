import { useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../services/supabase';
import { friendsKeys } from './useFriendsQuery';
import { boardKeys } from './useBoardQueries';
import { saveKeys } from './useSaveQueries';
import { savedPeopleKeys } from './useSavedPeople';
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
  savedPeopleKeys.all,            // saved people
  phoneInviteKeys.all,            // pending phone invites
  subscriptionKeys.all,           // subscription status
  ['savedCards'],                  // saved cards
  ['calendarEntries'],            // calendar entries
  ['userPreferences'],            // user preferences
] as const;

const DEBOUNCE_MS = 500;

/**
 * Centralized foreground resume handler.
 *
 * On every background → active transition:
 *   1. Validates the Supabase auth session (forces JWT refresh if expired)
 *   2. Invalidates all critical React Query caches (triggers background refetch)
 *   3. Calls the provided onResume callback (for non-React-Query refreshes)
 *
 * Cached data remains visible during the refresh — no loading flash.
 *
 * @param userId - Current authenticated user ID. Hook is inert when null/undefined.
 * @param onResume - Optional callback for non-React-Query work (e.g., refreshAllSessions).
 */
export function useForegroundRefresh(
  userId: string | undefined,
  onResume?: () => void,
) {
  const queryClient = useQueryClient();
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const backgroundTimestampRef = useRef<number | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Use refs for callback to avoid re-subscribing on every render
  const onResumeRef = useRef(onResume);
  onResumeRef.current = onResume;

  useEffect(() => {
    if (!userId) return;

    const handleAppStateChange = (nextState: AppStateStatus) => {
      const prevState = appStateRef.current;

      // Track when we enter background (for duration logging)
      if (nextState === 'background') {
        backgroundTimestampRef.current = Date.now();
      }

      // Only background → active is a genuine resume. iOS inactive → active
      // (Control Center, notification shade, Siri) must NOT trigger refresh.
      // All real resume paths (home button, app switcher, lock screen) transition
      // through 'background' on both iOS and Android.
      const wasBackground = prevState === 'background';
      const isNowActive = nextState === 'active';

      // Update ref BEFORE async work (prevents double-fire if state changes during debounce)
      appStateRef.current = nextState;

      if (!wasBackground || !isNowActive) return;
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      debounceTimerRef.current = setTimeout(async () => {
        const bgDuration = backgroundTimestampRef.current
          ? Math.round((Date.now() - backgroundTimestampRef.current) / 1000)
          : null;
        const bgLabel = bgDuration !== null ? `${bgDuration}s` : 'unknown';

        if (__DEV__) {
          logger.lifecycle(
            `[RESUME] Foreground refresh | backgroundDuration=${bgLabel} | queries=${CRITICAL_QUERY_KEYS.length} families`,
          );
        }

        // Step 1: Validate/refresh auth session BEFORE any query work.
        // supabase.auth.getSession() reads the stored session and triggers a
        // token refresh if the JWT is expired. This is a local-first check —
        // fast when the token is still valid, network call only when expired.
        try {
          const { error } = await supabase.auth.getSession();
          if (error) {
            console.warn('[RESUME] Session refresh failed:', error.message);
            // Don't bail — stale token might still work for some queries,
            // and the Supabase client will auto-retry token refresh on next call.
          }
        } catch (e) {
          console.warn('[RESUME] Session refresh threw:', e);
        }

        // Step 2: Invalidate all critical queries.
        // invalidateQueries() marks them as stale AND triggers a background refetch
        // if any component is currently subscribed. Cached data stays visible —
        // no loading flash. Components using useQuery see isFetching=true briefly,
        // but isLoading stays false (data is still in cache).
        for (const key of CRITICAL_QUERY_KEYS) {
          queryClient.invalidateQueries({ queryKey: key });
        }

        // Step 3: Fire the callback for non-React-Query refreshes
        // (e.g., refreshAllSessions which updates Zustand state)
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
}
