import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../services/supabase';
import { useEffectiveTier } from './useSubscription';
import { getSessionLimit } from '../constants/tierLimits';
import { useAppStore } from '../store/appStore';

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Checks whether the current user is allowed to create a new collaboration
 * session, based on their tier's session limit.
 *
 * Calls the `check_session_creation_allowed` RPC which returns the current
 * count, max allowed, and a boolean `allowed` flag.
 */
export function useSessionCreationGate() {
  const { user } = useAppStore();
  const { tier, isLoading: tierLoading } = useEffectiveTier(user?.id);
  const maxSessions = getSessionLimit(tier);
  const queryClient = useQueryClient();

  // Issue #4265: the key no longer carries `tier`. The RPC reads the tier on
  // the server, so the result never depended on the client's guess — but with
  // tier in the key, every mount fetched twice (once for the 'free' fallback,
  // again when the server tier resolved). A real tier change (upgrade,
  // downgrade) after it has settled refreshes the gate below.
  const queryKey = ['session-creation-gate', user?.id] as const;
  const { data } = useQuery({
    queryKey,
    queryFn: async (): Promise<{ allowed: boolean; current: number; max: number | null }> => {
      if (!user?.id) return { allowed: false, current: 0, max: 0 };

      const { data: rows, error } = await supabase
        .rpc('check_session_creation_allowed', { p_user_id: user.id });

      if (error || !rows?.[0]) {
        // max null: fall back to the tier limit at render time.
        return { allowed: false, current: 0, max: null };
      }

      return {
        allowed: rows[0].allowed as boolean,
        current: rows[0].current_count as number,
        max: rows[0].max_allowed as number,
      };
    },
    enabled: !!user?.id,
    staleTime: 30_000,
  });

  const settledTierRef = useRef<string | null>(null);
  useEffect(() => {
    if (tierLoading || !user?.id) return;
    const previous = settledTierRef.current;
    settledTierRef.current = tier;
    if (previous !== null && previous !== tier) {
      void queryClient.invalidateQueries({ queryKey: ['session-creation-gate', user.id] });
    }
  }, [queryClient, tier, tierLoading, user?.id]);

  return {
    canCreateSession: data?.allowed ?? true,
    currentSessionCount: data?.current ?? 0,
    maxSessions: data?.max ?? maxSessions,
    tier,
    isUnlimited: maxSessions === -1,
  };
}
