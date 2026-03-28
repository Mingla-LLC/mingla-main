import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../services/supabase';
import { useAppStore } from '../store/appStore';

export interface MapSettings {
  visibility_level: 'off' | 'paired' | 'friends' | 'friends_of_friends' | 'everyone';
  show_saved_places: boolean;
  show_scheduled_places: boolean;
  activity_status: string | null;
  discovery_radius_km: number;
  time_delay_enabled: boolean;
  go_dark_until: string | null;
  activity_status_expires_at: string | null;
}

export function useMapSettings() {
  const user = useAppStore(s => s.user);
  const queryClient = useQueryClient();

  const query = useQuery<MapSettings>({
    queryKey: ['map-settings', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_map_settings')
        .select('visibility_level, show_saved_places, show_scheduled_places, activity_status, discovery_radius_km, time_delay_enabled, go_dark_until, activity_status_expires_at')
        .eq('user_id', user!.id)
        .maybeSingle();
      if (error) throw error;
      return data || {
        visibility_level: 'friends' as const,
        show_saved_places: false,
        show_scheduled_places: false,
        activity_status: null,
        discovery_radius_km: 5,
        time_delay_enabled: false,
        go_dark_until: null,
        activity_status_expires_at: null,
      };
    },
    enabled: !!user?.id,
    staleTime: 5 * 60_000,
  });

  const mutation = useMutation({
    mutationFn: async (updates: Partial<MapSettings>) => {
      const { error } = await supabase
        .from('user_map_settings')
        .upsert({ user_id: user!.id, ...updates, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['map-settings', user?.id] });
    },
    onError: (err: Error) => {
      console.warn('[useMapSettings] Update failed:', err.message);
    },
  });

  return { settings: query.data, isLoading: query.isLoading, updateSettings: mutation.mutateAsync };
}
