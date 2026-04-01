import { useQuery } from '@tanstack/react-query';
import { supabase } from '../services/supabase';
import type { SubscriptionTier } from '../types/subscription';

/** Fields a friend may see on ViewFriendProfileScreen (limited surface). */
export interface FriendProfileData {
  id: string;
  first_name: string | null;
  last_name: string | null;
  username: string | null;
  phone: string | null;
  country: string | null;
  tier: SubscriptionTier;
  intents: string[];
  categories: string[];
}

export const friendProfileKeys = {
  all: ['friend-profile'] as const,
  detail: (userId: string) => [...friendProfileKeys.all, userId] as const,
};

export function useFriendProfile(userId: string | null) {
  return useQuery({
    queryKey: friendProfileKeys.detail(userId ?? ''),
    queryFn: async (): Promise<FriendProfileData> => {
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('id, first_name, last_name, username, phone, country')
        .eq('id', userId!)
        .single();
      if (profileError) throw new Error(profileError.message);

      const [{ data: prefs }, { data: tierRaw, error: tierError }] = await Promise.all([
        supabase.from('preferences').select('intents, categories').eq('profile_id', userId!).maybeSingle(),
        supabase.rpc('get_effective_tier', { p_user_id: userId! }),
      ]);

      const tier: SubscriptionTier =
        !tierError && tierRaw && ['free', 'pro', 'elite'].includes(tierRaw as string)
          ? (tierRaw as SubscriptionTier)
          : 'free';

      return {
        id: profile.id,
        first_name: profile.first_name,
        last_name: profile.last_name,
        username: profile.username,
        phone: profile.phone ?? null,
        country: profile.country ?? null,
        tier,
        intents: prefs?.intents ?? [],
        categories: prefs?.categories ?? [],
      };
    },
    enabled: !!userId,
    staleTime: 2 * 60 * 1000,
  });
}
