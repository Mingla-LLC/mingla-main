import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../services/supabase';
import { useAppStore } from '../store/appStore';
import { toastManager } from '../components/ui/Toast';
import i18n from '../i18n';

export interface MapSettings {
  visibility_level: 'off' | 'paired' | 'friends' | 'friends_of_friends' | 'everyone';
  show_saved_places: boolean;
  show_scheduled_places: boolean;
  activity_status: string | null;
  discovery_radius_km: number;
  time_delay_enabled: boolean;
  go_dark_until: string | null;
  activity_status_expires_at: string | null;
  // ORCH-0437: Leaderboard settings (persisted source of truth)
  is_discoverable: boolean;
  available_seats: number;
}

export function useMapSettings() {
  const user = useAppStore(s => s.user);
  const queryClient = useQueryClient();

  const query = useQuery<MapSettings>({
    queryKey: ['map-settings', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_map_settings')
        .select('visibility_level, show_saved_places, show_scheduled_places, activity_status, discovery_radius_km, time_delay_enabled, go_dark_until, activity_status_expires_at, is_discoverable, available_seats')
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
        is_discoverable: false,
        available_seats: 1,
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
    onMutate: async (updates) => {
      await queryClient.cancelQueries({ queryKey: ['map-settings', user?.id] });
      const previous = queryClient.getQueryData<MapSettings>(['map-settings', user?.id]);
      queryClient.setQueryData<MapSettings>(['map-settings', user?.id], (old) => {
        const defaults: MapSettings = {
          visibility_level: 'friends',
          show_saved_places: false,
          show_scheduled_places: false,
          activity_status: null,
          discovery_radius_km: 5,
          time_delay_enabled: false,
          go_dark_until: null,
          activity_status_expires_at: null,
          is_discoverable: false,
          available_seats: 1,
        };
        return { ...(old || defaults), ...updates };
      });
      return { previous };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['map-settings', user?.id] });
    },
    onError: (err: Error, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['map-settings', user?.id], context.previous);
      }
      console.warn('[useMapSettings] Update failed:', err.message);
      toastManager.error(i18n.t('common:error_update_setting'), 3000);
    },
  });

  return { settings: query.data, isLoading: query.isLoading, updateSettings: mutation.mutateAsync };
}
