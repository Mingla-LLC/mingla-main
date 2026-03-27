import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../services/supabase';
import { useAppStore } from '../store/appStore';

export const profileInterestsKeys = {
  all: ['profile-interests'] as const,
  user: (userId: string) => [...profileInterestsKeys.all, userId] as const,
};

export interface ProfileInterests {
  intents: string[];
  categories: string[];
}

export function useProfileInterests(userId?: string) {
  const currentUser = useAppStore((s) => s.user);
  const targetId = userId ?? currentUser?.id ?? '';

  return useQuery({
    queryKey: profileInterestsKeys.user(targetId),
    queryFn: async (): Promise<ProfileInterests> => {
      const { data, error } = await supabase
        .from('preferences')
        .select('intents, categories')
        .eq('profile_id', targetId)
        .single();
      if (error) throw new Error(error.message);
      return {
        intents: data?.intents ?? [],
        categories: data?.categories ?? [],
      };
    },
    enabled: !!targetId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useUpdateProfileInterests() {
  const queryClient = useQueryClient();
  const user = useAppStore((s) => s.user);

  return useMutation({
    mutationFn: async (interests: ProfileInterests) => {
      if (useAppStore.getState().tourMode) return;
      const { error } = await supabase
        .from('preferences')
        .update({
          intents: interests.intents,
          categories: interests.categories,
        })
        .eq('profile_id', user!.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: profileInterestsKeys.user(user!.id) });
    },
    onError: (error: Error) => {
      console.error('[UpdateProfileInterests] Error:', error.message);
    },
  });
}
