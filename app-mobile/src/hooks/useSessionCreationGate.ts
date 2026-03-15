import { useQuery } from '@tanstack/react-query';
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
  const tier = useEffectiveTier(user?.id);
  const maxSessions = getSessionLimit(tier);

  const { data } = useQuery({
    queryKey: ['session-creation-gate', user?.id, tier],
    queryFn: async () => {
      if (!user?.id) return { allowed: false, current: 0, max: 0 };

      const { data: rows, error } = await supabase
        .rpc('check_session_creation_allowed', { p_user_id: user.id });

      if (error || !rows?.[0]) {
        return { allowed: false, current: 0, max: maxSessions };
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

  return {
    canCreateSession: data?.allowed ?? true,
    currentSessionCount: data?.current ?? 0,
    maxSessions: data?.max ?? maxSessions,
    tier,
    isUnlimited: maxSessions === -1,
  };
}
