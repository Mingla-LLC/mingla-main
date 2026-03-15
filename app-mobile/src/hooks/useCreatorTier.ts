import { useQuery } from '@tanstack/react-query';
import { supabase } from '../services/supabase';
import type { SubscriptionTier } from '../types/subscription';

/**
 * Fetches another user's effective tier via server-side RPC.
 *
 * Unlike useEffectiveTier (which reads the current device's RevenueCat data),
 * this hook calls the DB function `get_effective_tier` which reads the
 * subscriptions table directly — including the `tier` column that
 * syncSubscriptionFromRC writes to after purchases.
 *
 * Used for collab tier inheritance: the session creator's tier determines
 * feature access for all participants in the session.
 */
export function useCreatorTier(userId: string | undefined): SubscriptionTier {
  const { data } = useQuery({
    queryKey: ['creator-tier', userId],
    queryFn: async () => {
      if (!userId) return 'free';
      const { data: tier, error } = await supabase.rpc('get_effective_tier', { p_user_id: userId });
      if (error) return 'free';
      return (tier as SubscriptionTier) ?? 'free';
    },
    enabled: !!userId,
    staleTime: 5 * 60_000,
  });

  return (data as SubscriptionTier) ?? 'free';
}
