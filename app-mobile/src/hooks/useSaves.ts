import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../services/supabase';

export interface SavedExperience {
  id: string;
  user_id: string;
  card_id: string;
  title: string;
  subtitle?: string;
  category: string;
  price_level: number;
  estimated_cost_per_person: number;
  start_time?: string;
  duration_minutes?: number;
  image_url?: string;
  address?: string;
  location_lat?: number;
  location_lng?: number;
  route_mode?: string;
  eta_minutes?: number;
  distance_text?: string;
  maps_deep_link?: string;
  source_provider?: string;
  place_id?: string;
  event_id?: string;
  one_liner?: string;
  tip?: string;
  rating?: number;
  review_count?: number;
  status: string;
  scheduled_date?: string;
  save_type: 'experience' | 'recommendation';
  created_at: string;
  updated_at: string;
}

export const useSaves = () => {
  const [saves, setSaves] = useState<SavedExperience[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSaves = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      // Fetch saved experiences for the current user
      const { data, error } = await supabase
        .from('saved_experiences')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      setSaves(data || []);
    } catch (err: any) {
      setError(err.message);
      console.error('Error fetching saves:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const addSave = useCallback(async (experienceId: string, status: string = 'saved', scheduledAt?: string) => {
    setLoading(true);
    setError(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      // For traditional experiences, we need to get the experience details first
      const { data: experience } = await supabase
        .from('experiences')
        .select('*')
        .eq('id', experienceId)
        .single();

      if (!experience) {
        throw new Error('Experience not found');
      }

      const { data, error } = await supabase
        .from('saved_experiences')
        .insert({
          user_id: user.id,
          card_id: experienceId,
          title: experience.title,
          category: experience.category,
          price_level: 1,
          estimated_cost_per_person: experience.price_min || 0,
          duration_minutes: experience.duration_min || 60,
          image_url: experience.image_url,
          location_lat: experience.lat,
          location_lng: experience.lng,
          place_id: experience.place_id,
          status,
          scheduled_date: scheduledAt,
          save_type: 'experience'
        })
        .select()
        .single();

      if (error) throw error;

      // Reload saves
      await fetchSaves();

      return { data, error: null };
    } catch (err: any) {
      setError(err.message);
      return { data: null, error: err };
    } finally {
      setLoading(false);
    }
  }, [fetchSaves]);

  const updateSave = useCallback(async (cardId: string, updates: Partial<SavedExperience>) => {
    setLoading(true);
    setError(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      const { data, error } = await supabase
        .from('saved_experiences')
        .update(updates)
        .eq('user_id', user.id)
        .eq('card_id', cardId)
        .select()
        .single();

      if (error) throw error;

      // Reload saves
      await fetchSaves();

      return { data, error: null };
    } catch (err: any) {
      setError(err.message);
      return { data: null, error: err };
    } finally {
      setLoading(false);
    }
  }, [fetchSaves]);

  const removeSave = useCallback(async (cardId: string) => {
    setLoading(true);
    setError(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      const { error } = await supabase
        .from('saved_experiences')
        .delete()
        .eq('user_id', user.id)
        .eq('card_id', cardId);

      if (error) throw error;

      // Reload saves
      await fetchSaves();

      return { error: null };
    } catch (err: any) {
      setError(err.message);
      return { error: err };
    } finally {
      setLoading(false);
    }
  }, [fetchSaves]);

  // Set up real-time subscriptions
  useEffect(() => {
    const savesChannel = supabase
      .channel('saved_experiences_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'saved_experiences',
        },
        () => {
          fetchSaves();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(savesChannel);
    };
  }, [fetchSaves]);

  // Load saves on mount
  useEffect(() => {
    fetchSaves();
  }, [fetchSaves]);

  return {
    saves,
    loading,
    error,
    fetchSaves,
    addSave,
    updateSave,
    removeSave,
  };
};
