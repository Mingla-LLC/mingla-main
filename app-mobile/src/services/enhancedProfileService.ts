/**
 * Enhanced Profile Service
 * Manages gamified history, privacy controls, and enhanced personalization
 */

import { supabase } from './supabase';
import { 
  UserActivityHistory, 
  UserStats, 
  UserVibes, 
  SavedExperiencePrivacy, 
  UserTimeline,
  ProfileGamifiedData 
} from '../types';

export class EnhancedProfileService {
  private static instance: EnhancedProfileService;

  public static getInstance(): EnhancedProfileService {
    if (!EnhancedProfileService.instance) {
      EnhancedProfileService.instance = new EnhancedProfileService();
    }
    return EnhancedProfileService.instance;
  }

  // Track user activity for gamified features
  async trackActivity(
    activityType: string,
    activityData: Record<string, any> = {},
    category?: string,
    locationContext: Record<string, any> = {}
  ): Promise<void> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { error } = await supabase
        .from('user_activity_history')
        .insert({
          user_id: user.id,
          activity_type: activityType,
          activity_data: activityData,
          category,
          location_context: locationContext,
        });

      if (error) {
        console.error('Error tracking activity:', error);
      } else {
        // Update user vibes and stats asynchronously
        this.updateUserVibes(user.id);
        this.updateUserStats(user.id);
      }
    } catch (error) {
      console.error('Error in trackActivity:', error);
    }
  }

  // Backfill activity history from existing user data
  async backfillUserActivityHistory(userId: string): Promise<void> {
    try {
      const { error } = await supabase.rpc('backfill_user_activity_history', {
        p_user_id: userId
      });

      if (error) {
        console.error('Error backfilling activity history:', error);
      }
    } catch (error) {
      console.error('Error in backfillUserActivityHistory:', error);
    }
  }

  // Get user's gamified profile data
  async getGamifiedProfileData(userId: string): Promise<ProfileGamifiedData | null> {
    try {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

      // First, try to backfill activity history if needed
      await this.backfillUserActivityHistory(userId);

      // Get monthly stats
      const { data: monthlyStats } = await supabase.rpc('get_user_monthly_stats', {
        p_user_id: userId,
        p_month_start: monthStart.toISOString()
      });

      // Get user vibes for current month
      const { data: vibes } = await supabase
        .from('user_vibes')
        .select('*')
        .eq('user_id', userId)
        .gte('period_start', monthStart.toISOString())
        .lte('period_end', monthEnd.toISOString())
        .order('percentage', { ascending: false });

      // Get user timeline
      const { data: timeline } = await supabase.rpc('get_user_timeline', {
        p_user_id: userId,
        p_limit: 20
      });

      // Get recent activity
      const { data: recentActivity } = await supabase
        .from('user_activity_history')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(10);

      // Get user achievements
      const achievements = await this.calculateUserAchievements(userId);

      // Get badges
      const badges = await this.getUserBadges(userId);

      return {
        monthlyStats: monthlyStats?.[0] || {
          totalExperiences: 0,
          categoryBreakdown: {},
          placesVisited: 0,
          collaborationsJoined: 0
        },
        vibes: vibes || [],
        timeline: timeline || [],
        recentActivity: recentActivity || [],
        badges: badges || [],
        achievements
      };
    } catch (error) {
      console.error('Error getting gamified profile data:', error);
      return null;
    }
  }

  // Update user vibes based on activity
  private async updateUserVibes(userId: string): Promise<void> {
    try {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

      const { data: vibesData } = await supabase.rpc('calculate_user_vibes', {
        p_user_id: userId,
        p_period_start: monthStart.toISOString(),
        p_period_end: monthEnd.toISOString()
      });

      if (vibesData && vibesData.length > 0) {
        // Clear existing vibes for this period
        await supabase
          .from('user_vibes')
          .delete()
          .eq('user_id', userId)
          .gte('period_start', monthStart.toISOString())
          .lte('period_end', monthEnd.toISOString());

        // Insert new vibes
        const vibesToInsert = vibesData.map((vibe: any) => ({
          user_id: userId,
          category: vibe.category,
          percentage: vibe.percentage,
          activity_count: vibe.activity_count,
          period_start: monthStart.toISOString(),
          period_end: monthEnd.toISOString()
        }));

        await supabase
          .from('user_vibes')
          .insert(vibesToInsert);
      }
    } catch (error) {
      console.error('Error updating user vibes:', error);
    }
  }

  // Update user stats
  private async updateUserStats(userId: string): Promise<void> {
    try {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

      // Get monthly stats
      const { data: monthlyStats } = await supabase.rpc('get_user_monthly_stats', {
        p_user_id: userId,
        p_month_start: monthStart.toISOString()
      });

      if (monthlyStats && monthlyStats.length > 0) {
        const stats = monthlyStats[0];
        
        // Upsert monthly stats
        await supabase
          .from('user_stats')
          .upsert({
            user_id: userId,
            stat_type: 'monthly_experiences',
            stat_value: stats,
            period_start: monthStart.toISOString(),
            period_end: monthEnd.toISOString()
          }, {
            onConflict: 'user_id,stat_type,period_start'
          });
      }
    } catch (error) {
      console.error('Error updating user stats:', error);
    }
  }

  // Calculate user achievements
  private async calculateUserAchievements(userId: string): Promise<{
    totalExperiences: number;
    totalPlaces: number;
    totalCollaborations: number;
    streakDays: number;
    favoriteCategory: string;
  }> {
    try {
      // Get total experiences
      const { count: totalExperiences } = await supabase
        .from('user_activity_history')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .in('activity_type', ['experience_saved', 'experience_liked']);

      // Get total places visited
      const { count: totalPlaces } = await supabase
        .from('user_activity_history')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('activity_type', 'place_visited');

      // Get total collaborations
      const { count: totalCollaborations } = await supabase
        .from('user_activity_history')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('activity_type', 'collaboration_joined');

      // Get favorite category
      const { data: categoryData } = await supabase
        .from('user_activity_history')
        .select('category')
        .eq('user_id', userId)
        .not('category', 'is', null);

      const categoryCounts: Record<string, number> = {};
      categoryData?.forEach(item => {
        if (item.category) {
          categoryCounts[item.category] = (categoryCounts[item.category] || 0) + 1;
        }
      });

      const favoriteCategory = Object.keys(categoryCounts).reduce((a, b) => 
        categoryCounts[a] > categoryCounts[b] ? a : b, '') || '';

      // Calculate streak (simplified - consecutive days with activity)
      const { data: recentActivity } = await supabase
        .from('user_activity_history')
        .select('created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(30);

      let streakDays = 0;
      if (recentActivity && recentActivity.length > 0) {
        const today = new Date();
        let currentDate = new Date(today);
        
        for (let i = 0; i < 30; i++) {
          const dayStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate());
          const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
          
          const hasActivity = recentActivity.some(activity => {
            const activityDate = new Date(activity.created_at);
            return activityDate >= dayStart && activityDate < dayEnd;
          });
          
          if (hasActivity) {
            streakDays++;
            currentDate.setDate(currentDate.getDate() - 1);
          } else {
            break;
          }
        }
      }

      return {
        totalExperiences: totalExperiences || 0,
        totalPlaces: totalPlaces || 0,
        totalCollaborations: totalCollaborations || 0,
        streakDays,
        favoriteCategory
      };
    } catch (error) {
      console.error('Error calculating achievements:', error);
      return {
        totalExperiences: 0,
        totalPlaces: 0,
        totalCollaborations: 0,
        streakDays: 0,
        favoriteCategory: ''
      };
    }
  }

  // Get user badges
  private async getUserBadges(userId: string): Promise<string[]> {
    try {
      const { data: timeline } = await supabase
        .from('user_timeline')
        .select('badge_earned')
        .eq('user_id', userId)
        .not('badge_earned', 'is', null);

      return timeline?.map(item => item.badge_earned).filter(Boolean) || [];
    } catch (error) {
      console.error('Error getting user badges:', error);
      return [];
    }
  }

  // Privacy controls for saved experiences
  async setExperiencePrivacy(
    experienceId: string,
    privacySettings: {
      is_public?: boolean;
      visible_to_friends?: boolean;
      show_in_activity?: boolean;
    }
  ): Promise<boolean> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return false;

      const { error } = await supabase
        .from('saved_experience_privacy')
        .upsert({
          user_id: user.id,
          experience_id: experienceId,
          ...privacySettings
        }, {
          onConflict: 'user_id,experience_id'
        });

      return !error;
    } catch (error) {
      console.error('Error setting experience privacy:', error);
      return false;
    }
  }

  // Get experience privacy settings
  async getExperiencePrivacy(experienceId: string): Promise<SavedExperiencePrivacy | null> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;

      const { data, error } = await supabase
        .from('saved_experience_privacy')
        .select('*')
        .eq('user_id', user.id)
        .eq('experience_id', experienceId)
        .single();

      return error ? null : data;
    } catch (error) {
      console.error('Error getting experience privacy:', error);
      return null;
    }
  }

  // Update profile privacy settings
  async updateProfilePrivacy(privacySettings: {
    visibility_mode?: 'public' | 'friends' | 'private';
    show_activity?: boolean;
    show_saved_experiences?: boolean;
    show_location?: boolean;
    show_preferences?: boolean;
  }): Promise<boolean> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return false;

      const { error } = await supabase
        .from('profiles')
        .update(privacySettings)
        .eq('id', user.id);

      return !error;
    } catch (error) {
      console.error('Error updating profile privacy:', error);
      return false;
    }
  }

  // Add timeline event (for achievements)
  async addTimelineEvent(
    eventType: UserTimeline['event_type'],
    eventData: Record<string, any> = {},
    badgeEarned?: string
  ): Promise<boolean> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return false;

      const { error } = await supabase
        .from('user_timeline')
        .insert({
          user_id: user.id,
          event_type: eventType,
          event_data: eventData,
          badge_earned: badgeEarned
        });

      return !error;
    } catch (error) {
      console.error('Error adding timeline event:', error);
      return false;
    }
  }

  // Check for milestone achievements
  async checkMilestones(userId: string): Promise<void> {
    try {
      const achievements = await this.calculateUserAchievements(userId);
      
      // Check for first experience milestone
      if (achievements.totalExperiences === 1) {
        await this.addTimelineEvent('first_experience', {
          totalExperiences: achievements.totalExperiences
        }, 'first_explorer');
      }
      
      // Check for category mastery (5+ experiences in one category)
      const { data: categoryStats } = await supabase
        .from('user_activity_history')
        .select('category')
        .eq('user_id', userId)
        .in('activity_type', ['experience_saved', 'experience_liked']);

      const categoryCounts: Record<string, number> = {};
      categoryStats?.forEach(item => {
        if (item.category) {
          categoryCounts[item.category] = (categoryCounts[item.category] || 0) + 1;
        }
      });

      Object.entries(categoryCounts).forEach(([category, count]) => {
        if (count >= 5) {
          this.addTimelineEvent('category_master', {
            category,
            count
          }, `${category}_master`);
        }
      });

      // Check for social butterfly (3+ collaborations)
      if (achievements.totalCollaborations >= 3) {
        await this.addTimelineEvent('social_butterfly', {
          totalCollaborations: achievements.totalCollaborations
        }, 'social_butterfly');
      }

      // Check for local expert (10+ places visited)
      if (achievements.totalPlaces >= 10) {
        await this.addTimelineEvent('local_expert', {
          totalPlaces: achievements.totalPlaces
        }, 'local_expert');
      }
    } catch (error) {
      console.error('Error checking milestones:', error);
    }
  }
}

export const enhancedProfileService = EnhancedProfileService.getInstance();
