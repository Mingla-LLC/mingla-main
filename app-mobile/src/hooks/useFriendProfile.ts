import { useQuery } from '@tanstack/react-query';
import { supabase } from '../services/supabase';
import { useAppStore } from '../store/appStore';
import type { SubscriptionTier } from '../types/subscription';

/** Fields a friend may see on ViewFriendProfileScreen (limited surface). */
export interface FriendProfileData {
  id: string;
  first_name: string | null;
  last_name: string | null;
  username: string | null;
  avatar_url: string | null;
  bio: string | null;
  location: string | null;
  country: string | null;
  tier: SubscriptionTier;
  intents: string[];
  categories: string[];
  friendCount: number;
  isFriend: boolean;
}

export const friendProfileKeys = {
  all: ['friend-profile'] as const,
  detail: (userId: string) => [...friendProfileKeys.all, userId] as const,
};

export function useFriendProfile(userId: string | null) {
  const currentUserId = useAppStore((s) => s.user?.id);

  return useQuery({
    queryKey: friendProfileKeys.detail(userId ?? ''),
    queryFn: async (): Promise<FriendProfileData | null> => {
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('id, first_name, last_name, username, avatar_url, country, bio, location')
        .eq('id', userId!)
        .maybeSingle();
      if (profileError) throw new Error(profileError.message);
      if (!profile) return null;

      const [{ data: prefs }, { data: tierRaw, error: tierError }, { count: friendCount }, { count: isFriendCount }] = await Promise.all([
        supabase.from('preferences').select('display_intents, display_categories').eq('profile_id', userId!).maybeSingle(),
        supabase.rpc('get_effective_tier', { p_user_id: userId! }),
        supabase.from('friends').select('*', { count: 'exact', head: true }).or(`user_id.eq.${userId!},friend_user_id.eq.${userId!}`).eq('status', 'accepted'),
        currentUserId
          ? supabase.from('friends').select('*', { count: 'exact', head: true }).or(`and(user_id.eq.${currentUserId},friend_user_id.eq.${userId!}),and(friend_user_id.eq.${currentUserId},user_id.eq.${userId!})`).eq('status', 'accepted')
          : Promise.resolve({ count: 0 } as { count: number }),
      ]);

      const tier: SubscriptionTier =
        !tierError && tierRaw && ['free', 'mingla_plus'].includes(tierRaw as string)
          ? (tierRaw as SubscriptionTier)
          : 'free';

      return {
        id: profile.id,
        first_name: profile.first_name,
        last_name: profile.last_name,
        username: profile.username,
        avatar_url: profile.avatar_url ?? null,
        bio: profile.bio ?? null,
        location: profile.location ?? null,
        country: profile.country ?? null,
        tier,
        intents: prefs?.display_intents ?? [],
        categories: prefs?.display_categories ?? [],
        friendCount: friendCount ?? 0,
        isFriend: (isFriendCount ?? 0) > 0,
      };
    },
    enabled: !!userId,
    staleTime: 2 * 60 * 1000,
  });
}
