/**
 * Enhanced Profile Hook
 * Manages gamified history, privacy controls, and enhanced personalization
 */

import { useState, useEffect, useCallback } from 'react';
import { enhancedProfileService } from '../services/enhancedProfileService';
import { ProfileGamifiedData, SavedExperiencePrivacy } from '../types';

export const useEnhancedProfile = () => {
  const [gamifiedData, setGamifiedData] = useState<ProfileGamifiedData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load gamified profile data
  const loadGamifiedData = useCallback(async (userId: string) => {
    setLoading(true);
    setError(null);
    
    try {
      const data = await enhancedProfileService.getGamifiedProfileData(userId);
      setGamifiedData(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Track activity
  const trackActivity = useCallback(async (
    activityType: string,
    activityData: Record<string, any> = {},
    category?: string,
    locationContext: Record<string, any> = {}
  ) => {
    try {
      await enhancedProfileService.trackActivity(activityType, activityData, category, locationContext);
    } catch (err: any) {
      console.error('Error tracking activity:', err);
    }
  }, []);

  const backfillActivityHistory = useCallback(async (userId: string) => {
    try {
      await enhancedProfileService.backfillUserActivityHistory(userId);
      // Reload gamified data after backfilling
      await loadGamifiedData(userId);
    } catch (err: any) {
      console.error('Error backfilling activity history:', err);
    }
  }, [loadGamifiedData]);

  // Set experience privacy
  const setExperiencePrivacy = useCallback(async (
    experienceId: string,
    privacySettings: {
      is_public?: boolean;
      visible_to_friends?: boolean;
      show_in_activity?: boolean;
    }
  ) => {
    try {
      return await enhancedProfileService.setExperiencePrivacy(experienceId, privacySettings);
    } catch (err: any) {
      console.error('Error setting experience privacy:', err);
      return false;
    }
  }, []);

  // Get experience privacy
  const getExperiencePrivacy = useCallback(async (experienceId: string): Promise<SavedExperiencePrivacy | null> => {
    try {
      return await enhancedProfileService.getExperiencePrivacy(experienceId);
    } catch (err: any) {
      console.error('Error getting experience privacy:', err);
      return null;
    }
  }, []);

  // Update profile privacy
  const updateProfilePrivacy = useCallback(async (privacySettings: {
    visibility_mode?: 'public' | 'friends' | 'private';
    show_activity?: boolean;
    show_saved_experiences?: boolean;
    show_location?: boolean;
    show_preferences?: boolean;
  }) => {
    try {
      return await enhancedProfileService.updateProfilePrivacy(privacySettings);
    } catch (err: any) {
      console.error('Error updating profile privacy:', err);
      return false;
    }
  }, []);

  // Check milestones
  const checkMilestones = useCallback(async (userId: string) => {
    try {
      await enhancedProfileService.checkMilestones(userId);
    } catch (err: any) {
      console.error('Error checking milestones:', err);
    }
  }, []);

  return {
    gamifiedData,
    loading,
    error,
    loadGamifiedData,
    trackActivity,
    backfillActivityHistory,
    setExperiencePrivacy,
    getExperiencePrivacy,
    updateProfilePrivacy,
    checkMilestones
  };
};
