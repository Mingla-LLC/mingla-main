import { useState, useCallback, useEffect, useRef } from 'react';
import { useEffectiveTier } from './useSubscription';
import { getSwipeLimit } from '../constants/tierLimits';
import { supabase } from '../services/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAppStore } from '../store/appStore';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface SwipeLimitState {
  remaining: number;
  limit: number;
  used: number;
  isLimited: boolean;
  isUnlimited: boolean;
  resetsAt: Date | null;
}

const STORAGE_KEY_PREFIX = '@mingla/swipe_count_';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function getNextMidnight(): Date {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  return midnight;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tracks the daily swipe count for free-tier users.
 *
 * - Persists counts locally via AsyncStorage (keyed by user + date).
 * - Fires a best-effort RPC to increment the server counter.
 * - Pro/Elite users are unlimited — `recordSwipe` always returns `{ allowed: true }`.
 */
export function useSwipeLimit() {
  const { user } = useAppStore();
  const { tier } = useEffectiveTier(user?.id);
  const limit = getSwipeLimit(tier);
  const isUnlimited = limit === -1;

  const [state, setState] = useState<SwipeLimitState>({
    remaining: isUnlimited ? -1 : limit,
    limit,
    used: 0,
    isLimited: false,
    isUnlimited,
    resetsAt: null,
  });

  const countRef = useRef(0);

  // Sync state when tier changes (e.g. subscription loads async and flips free → elite)
  useEffect(() => {
    if (isUnlimited && !state.isUnlimited) {
      countRef.current = 0;
      setState({
        remaining: -1,
        limit: -1,
        used: 0,
        isLimited: false,
        isUnlimited: true,
        resetsAt: null,
      });
    } else if (!isUnlimited && state.isUnlimited) {
      // Downgrade: elite → free — re-hydrate will run via the effect below
      setState({
        remaining: limit,
        limit,
        used: 0,
        isLimited: false,
        isUnlimited: false,
        resetsAt: getNextMidnight(),
      });
    }
  }, [isUnlimited, limit, state.isUnlimited]);

  // Hydrate from local storage, then reconcile with server
  useEffect(() => {
    if (!user?.id || isUnlimited) return;

    const today = new Date().toISOString().split('T')[0];
    const key = `${STORAGE_KEY_PREFIX}${user.id}_${today}`;

    // Step 1: Read from local storage (instant)
    AsyncStorage.getItem(key).then((val) => {
      const localUsed = val ? parseInt(val, 10) : 0;
      countRef.current = localUsed;
      setState({
        remaining: Math.max(limit - localUsed, 0),
        limit,
        used: localUsed,
        isLimited: localUsed >= limit,
        isUnlimited: false,
        resetsAt: getNextMidnight(),
      });
    });

    // Step 2: Reconcile with server (takes Math.max of local vs server)
    Promise.resolve(supabase.rpc('get_remaining_swipes', { p_user_id: user.id }))
      .then(({ data }) => {
        if (!data?.[0] || data[0].remaining < 0) return; // unlimited or error
        const serverUsed = data[0].used as number;
        const effectiveUsed = Math.max(countRef.current, serverUsed);
        if (effectiveUsed !== countRef.current) {
          countRef.current = effectiveUsed;
          // Persist the reconciled count to local storage
          const todayKey = `${STORAGE_KEY_PREFIX}${user.id}_${new Date().toISOString().split('T')[0]}`;
          AsyncStorage.setItem(todayKey, String(effectiveUsed)).catch(() => {});
          setState({
            remaining: Math.max(limit - effectiveUsed, 0),
            limit,
            used: effectiveUsed,
            isLimited: effectiveUsed >= limit,
            isUnlimited: false,
            resetsAt: getNextMidnight(),
          });
        }
      })
      .catch(() => {}); // best-effort reconciliation
  }, [user?.id, limit, isUnlimited]);

  const recordSwipe = useCallback(async () => {
    if (!user?.id || isUnlimited) return { allowed: true };

    countRef.current += 1;
    const newCount = countRef.current;
    const today = new Date().toISOString().split('T')[0];

    const key = `${STORAGE_KEY_PREFIX}${user.id}_${today}`;
    AsyncStorage.setItem(key, String(newCount)).catch(() => {});

    // Best-effort server sync — don't block on it
    // Supabase .rpc() returns a thenable (not a full Promise), so .catch() is unavailable.
    // Wrap in Promise.resolve() to get a real Promise with .catch().
    Promise.resolve(supabase.rpc('increment_daily_swipe_count', { p_user_id: user.id })).catch(() => {});

    const hitLimit = newCount >= limit;
    setState({
      remaining: Math.max(limit - newCount, 0),
      limit,
      used: newCount,
      isLimited: hitLimit,
      isUnlimited: false,
      resetsAt: getNextMidnight(),
    });

    return { allowed: !hitLimit };
  }, [user?.id, limit, isUnlimited]);

  return { ...state, recordSwipe };
}
