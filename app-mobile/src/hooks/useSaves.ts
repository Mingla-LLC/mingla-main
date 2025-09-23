import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../services/supabase';
import { Save } from '../types';

export const useSaves = () => {
  const [saves, setSaves] = useState<Save[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSaves = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      // Fetch saves for the current user
      const { data, error } = await supabase
        .from('saves')
        .select('*')
        .eq('profile_id', user.id)
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

      const { data, error } = await supabase
        .from('saves')
        .insert({
          profile_id: user.id,
          experience_id: experienceId,
          status,
          scheduled_at: scheduledAt,
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

  const updateSave = useCallback(async (experienceId: string, updates: Partial<Save>) => {
    setLoading(true);
    setError(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      const { data, error } = await supabase
        .from('saves')
        .update(updates)
        .eq('profile_id', user.id)
        .eq('experience_id', experienceId)
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

  const removeSave = useCallback(async (experienceId: string) => {
    setLoading(true);
    setError(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      const { error } = await supabase
        .from('saves')
        .delete()
        .eq('profile_id', user.id)
        .eq('experience_id', experienceId);

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
      .channel('saves_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'saves',
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
