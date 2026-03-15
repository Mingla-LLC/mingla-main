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
  const tier = useEffectiveTier(user?.id);
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

  // Hydrate from local storage on mount / tier change
  useEffect(() => {
    if (!user?.id || isUnlimited) return;

    const today = new Date().toISOString().split('T')[0];
    const key = `${STORAGE_KEY_PREFIX}${user.id}_${today}`;

    AsyncStorage.getItem(key).then((val) => {
      const used = val ? parseInt(val, 10) : 0;
      countRef.current = used;
      setState({
        remaining: Math.max(limit - used, 0),
        limit,
        used,
        isLimited: used >= limit,
        isUnlimited: false,
        resetsAt: getNextMidnight(),
      });
    });
  }, [user?.id, limit, isUnlimited]);

  const recordSwipe = useCallback(async () => {
    if (!user?.id || isUnlimited) return { allowed: true };

    countRef.current += 1;
    const newCount = countRef.current;
    const today = new Date().toISOString().split('T')[0];

    const key = `${STORAGE_KEY_PREFIX}${user.id}_${today}`;
    AsyncStorage.setItem(key, String(newCount)).catch(() => {});

    // Best-effort server sync — don't block on it
    supabase.rpc('increment_daily_swipe_count', { p_user_id: user.id }).catch(() => {});

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
