import { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '../store/appStore';
import { authService, UserProfile } from '../services/authService';
import { supabase } from '../services/supabase';

export const useUserProfile = () => {
  const { user, profile, setProfile, setAuth } = useAppStore();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load user profile from Supabase
  const loadProfile = useCallback(async (userId: string) => {
    setLoading(true);
    setError(null);
    
    try {
      const profileData = await authService.loadUserProfile(userId);
      if (profileData) {
        setProfile(profileData);
      }
    } catch (err) {
      console.error('Error loading profile:', err);
      setError('Failed to load profile');
    } finally {
      setLoading(false);
    }
  }, [setProfile]);

  // Update user profile
  const updateProfile = useCallback(async (updates: Partial<UserProfile>) => {
    if (!user?.id) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const updatedProfile = await authService.updateUserProfile(user.id, updates);
      setProfile(updatedProfile);
      return updatedProfile;
    } catch (err) {
      console.error('Error updating profile:', err);
      setError('Failed to update profile');
      throw err;
    } finally {
      setLoading(false);
    }
  }, [user?.id, setProfile]);

  // Upload avatar
  const uploadAvatar = useCallback(async (file: File) => {
    if (!user?.id) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const result = await authService.uploadAvatar(user.id, file);
      if (result.error) {
        throw result.error;
      }
      return result.url;
    } catch (err) {
      console.error('Error uploading avatar:', err);
      setError('Failed to upload avatar');
      throw err;
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  // Refresh profile data
  const refreshProfile = useCallback(async () => {
    if (user?.id) {
      await loadProfile(user.id);
    }
  }, [user?.id, loadProfile]);

  // Load profile when user changes
  useEffect(() => {
    if (user?.id && !profile) {
      loadProfile(user.id);
    }
  }, [user?.id, profile, loadProfile]);

  // Listen for profile changes in real-time
  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel('profile-changes')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'profiles',
          filter: `id=eq.${user.id}`,
        },
        (payload) => {
          setProfile(payload.new as UserProfile);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, setProfile]);

  return {
    user,
    profile,
    loading,
    error,
    loadProfile,
    updateProfile,
    uploadAvatar,
    refreshProfile,
  };
};
