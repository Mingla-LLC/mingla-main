import { useQuery } from '@tanstack/react-query';
import { supabase } from '../services/supabase';

export interface FriendProfileData {
  id: string;
  first_name: string | null;
  last_name: string | null;
  username: string | null;
  avatar_url: string | null;
  bio: string | null;
  photos: string[];
  visibility_mode: 'public' | 'friends' | 'private';
  active: boolean;
  created_at: string;
  intents: string[];
  categories: string[];
  savedCount: number;
  connectionsCount: number;
  boardsCount: number;
}

export const friendProfileKeys = {
  all: ['friend-profile'] as const,
  detail: (userId: string) => [...friendProfileKeys.all, userId] as const,
};

export function useFriendProfile(userId: string | null) {
  return useQuery({
    queryKey: friendProfileKeys.detail(userId ?? ''),
    queryFn: async (): Promise<FriendProfileData> => {
      // 1. Fetch profile (RLS handles visibility check)
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('id, first_name, last_name, username, avatar_url, bio, photos, visibility_mode, active, created_at')
        .eq('id', userId!)
        .single();
      if (profileError) throw new Error(profileError.message);

      // 2. Fetch preferences (RLS handles visibility check — may fail silently if not friend)
      const { data: prefs } = await supabase
        .from('preferences')
        .select('intents, categories')
        .eq('profile_id', userId!)
        .single();

      // 3. Fetch stats counts in parallel
      const [savedRes, friendsRes, boardsRes] = await Promise.all([
        supabase
          .from('saves')
          .select('experience_id', { count: 'exact', head: true })
          .eq('profile_id', userId!),
        supabase
          .from('friends')
          .select('id', { count: 'exact', head: true })
          .or(`user_id.eq.${userId!},friend_user_id.eq.${userId!}`)
          .eq('status', 'accepted'),
        supabase
          .from('board_sessions')
          .select('id', { count: 'exact', head: true })
          .contains('participant_ids', [userId!]),
      ]);

      return {
        ...profile,
        photos: (profile.photos ?? []).filter((url: string) => url && url.length > 0),
        intents: prefs?.intents ?? [],
        categories: prefs?.categories ?? [],
        savedCount: savedRes.count ?? 0,
        connectionsCount: friendsRes.count ?? 0,
        boardsCount: boardsRes.count ?? 0,
      };
    },
    enabled: !!userId,
    staleTime: 2 * 60 * 1000,
  });
}
