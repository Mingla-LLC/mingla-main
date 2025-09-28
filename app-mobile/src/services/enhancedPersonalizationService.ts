/**
 * Enhanced Personalization Service
 * Uses profile data, gamified history, and privacy settings for better recommendations
 */

import { supabase } from './supabase';
import { enhancedProfileService } from './enhancedProfileService';
import { User, ProfileGamifiedData } from '../types';

export interface PersonalizedRecommendationContext {
  userProfile: User;
  gamifiedData: ProfileGamifiedData | null;
  privacySettings: {
    show_preferences: boolean;
    show_location: boolean;
    show_activity: boolean;
  };
  userPreferences: {
    favoriteCategories: string[];
    activityPatterns: Record<string, number>;
    timePreferences: string[];
    locationPatterns: {
      home: { lat: number; lng: number } | null;
      work: { lat: number; lng: number } | null;
      frequent: Array<{ lat: number; lng: number; count: number }>;
    };
  };
}

export class EnhancedPersonalizationService {
  private static instance: EnhancedPersonalizationService;

  public static getInstance(): EnhancedPersonalizationService {
    if (!EnhancedPersonalizationService.instance) {
      EnhancedPersonalizationService.instance = new EnhancedPersonalizationService();
    }
    return EnhancedPersonalizationService.instance;
  }

  // Get personalized recommendation context
  async getPersonalizedContext(userId: string): Promise<PersonalizedRecommendationContext | null> {
    try {
      // Get user profile
      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (!profile) return null;

      // Get gamified data
      const gamifiedData = await enhancedProfileService.getGamifiedProfileData(userId);

      // Get user preferences
      const { data: preferences } = await supabase
        .from('preferences')
        .select('*')
        .eq('profile_id', userId)
        .single();

      // Get user activity patterns
      const activityPatterns = await this.getUserActivityPatterns(userId);
      const locationPatterns = await this.getUserLocationPatterns(userId);

      // Extract favorite categories from gamified data
      const favoriteCategories = gamifiedData?.vibes
        .sort((a, b) => b.percentage - a.percentage)
        .slice(0, 5)
        .map(vibe => vibe.category) || [];

      return {
        userProfile: profile,
        gamifiedData,
        privacySettings: {
          show_preferences: profile.show_preferences ?? true,
          show_location: profile.show_location ?? true,
          show_activity: profile.show_activity ?? true,
        },
        userPreferences: {
          favoriteCategories,
          activityPatterns,
          timePreferences: this.extractTimePreferences(activityPatterns),
          locationPatterns,
        },
      };
    } catch (error) {
      console.error('Error getting personalized context:', error);
      return null;
    }
  }

  // Get user activity patterns
  private async getUserActivityPatterns(userId: string): Promise<Record<string, number>> {
    try {
      const { data: activities } = await supabase
        .from('user_activity_history')
        .select('activity_type, category, created_at')
        .eq('user_id', userId)
        .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
        .order('created_at', { ascending: false });

      if (!activities) return {};

      const patterns: Record<string, number> = {};
      
      activities.forEach(activity => {
        const key = `${activity.activity_type}_${activity.category || 'general'}`;
        patterns[key] = (patterns[key] || 0) + 1;
      });

      return patterns;
    } catch (error) {
      console.error('Error getting activity patterns:', error);
      return {};
    }
  }

  // Get user location patterns
  private async getUserLocationPatterns(userId: string): Promise<{
    home: { lat: number; lng: number } | null;
    work: { lat: number; lng: number } | null;
    frequent: Array<{ lat: number; lng: number; count: number }>;
  }> {
    try {
      const { data: locations } = await supabase
        .from('user_location_history')
        .select('latitude, longitude, location_type, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (!locations) {
        return { home: null, work: null, frequent: [] };
      }

      // Find home location (most frequent location at night)
      const nightLocations = locations.filter(loc => {
        const hour = new Date(loc.created_at).getHours();
        return hour >= 22 || hour <= 6;
      });

      const homeLocation = this.findMostFrequentLocation(nightLocations);

      // Find work location (most frequent location during work hours)
      const workLocations = locations.filter(loc => {
        const hour = new Date(loc.created_at).getHours();
        return hour >= 9 && hour <= 17;
      });

      const workLocation = this.findMostFrequentLocation(workLocations);

      // Find frequent locations
      const locationCounts: Record<string, { lat: number; lng: number; count: number }> = {};
      
      locations.forEach(loc => {
        const key = `${loc.latitude.toFixed(4)},${loc.longitude.toFixed(4)}`;
        if (locationCounts[key]) {
          locationCounts[key].count++;
        } else {
          locationCounts[key] = {
            lat: loc.latitude,
            lng: loc.longitude,
            count: 1
          };
        }
      });

      const frequent = Object.values(locationCounts)
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      return {
        home: homeLocation,
        work: workLocation,
        frequent
      };
    } catch (error) {
      console.error('Error getting location patterns:', error);
      return { home: null, work: null, frequent: [] };
    }
  }

  // Find most frequent location from a list
  private findMostFrequentLocation(locations: Array<{ latitude: number; longitude: number }>): { lat: number; lng: number } | null {
    if (locations.length === 0) return null;

    const locationCounts: Record<string, { lat: number; lng: number; count: number }> = {};
    
    locations.forEach(loc => {
      const key = `${loc.latitude.toFixed(4)},${loc.longitude.toFixed(4)}`;
      if (locationCounts[key]) {
        locationCounts[key].count++;
      } else {
        locationCounts[key] = {
          lat: loc.latitude,
          lng: loc.longitude,
          count: 1
        };
      }
    });

    const mostFrequent = Object.values(locationCounts)
      .sort((a, b) => b.count - a.count)[0];

    return mostFrequent ? { lat: mostFrequent.lat, lng: mostFrequent.lng } : null;
  }

  // Extract time preferences from activity patterns
  private extractTimePreferences(activityPatterns: Record<string, number>): string[] {
    const timePreferences: string[] = [];
    
    // Analyze patterns to determine preferred times
    // This is a simplified version - in reality, you'd analyze timestamps
    const morningActivities = Object.keys(activityPatterns).filter(key => 
      key.includes('morning') || key.includes('breakfast')
    ).length;
    
    const eveningActivities = Object.keys(activityPatterns).filter(key => 
      key.includes('evening') || key.includes('dinner')
    ).length;
    
    const nightActivities = Object.keys(activityPatterns).filter(key => 
      key.includes('night') || key.includes('late')
    ).length;

    if (morningActivities > eveningActivities && morningActivities > nightActivities) {
      timePreferences.push('morning');
    }
    if (eveningActivities > morningActivities && eveningActivities > nightActivities) {
      timePreferences.push('evening');
    }
    if (nightActivities > morningActivities && nightActivities > eveningActivities) {
      timePreferences.push('night');
    }

    return timePreferences;
  }

  // Generate personalized recommendation filters
  async generatePersonalizedFilters(userId: string): Promise<{
    categories: string[];
    timeWindow: string;
    location: { lat: number; lng: number };
    budget: { min: number; max: number };
    preferences: Record<string, any>;
  }> {
    try {
      const context = await this.getPersonalizedContext(userId);
      if (!context) {
        return this.getDefaultFilters();
      }

      // Use favorite categories from gamified data
      const categories = context.userPreferences.favoriteCategories.length > 0
        ? context.userPreferences.favoriteCategories
        : ['stroll', 'sip_chill', 'casual_eats'];

      // Determine time window based on current time and preferences
      const currentHour = new Date().getHours();
      let timeWindow = 'tonight';
      
      if (currentHour < 12) {
        timeWindow = 'today';
      } else if (currentHour < 18) {
        timeWindow = 'tonight';
      } else {
        timeWindow = 'this_weekend';
      }

      // Use location patterns for better recommendations
      let location = { lat: 0, lng: 0 };
      if (context.userPreferences.locationPatterns.home) {
        location = context.userPreferences.locationPatterns.home;
      } else if (context.userPreferences.locationPatterns.work) {
        location = context.userPreferences.locationPatterns.work;
      }

      // Determine budget based on activity patterns
      const budget = this.calculatePersonalizedBudget(context);

      return {
        categories,
        timeWindow,
        location,
        budget,
        preferences: {
          favoriteCategories: context.userPreferences.favoriteCategories,
          activityPatterns: context.userPreferences.activityPatterns,
          timePreferences: context.userPreferences.timePreferences,
        }
      };
    } catch (error) {
      console.error('Error generating personalized filters:', error);
      return this.getDefaultFilters();
    }
  }

  // Calculate personalized budget based on activity patterns
  private calculatePersonalizedBudget(context: PersonalizedRecommendationContext): { min: number; max: number } {
    // Analyze past activity patterns to determine budget preferences
    const activityPatterns = context.userPreferences.activityPatterns;
    
    // Count high-value vs low-value activities
    const highValueActivities = Object.keys(activityPatterns).filter(key => 
      key.includes('dining') || key.includes('premium')
    ).length;
    
    const lowValueActivities = Object.keys(activityPatterns).filter(key => 
      key.includes('stroll') || key.includes('free')
    ).length;

    if (highValueActivities > lowValueActivities) {
      return { min: 50, max: 200 };
    } else if (lowValueActivities > highValueActivities) {
      return { min: 10, max: 50 };
    } else {
      return { min: 25, max: 100 };
    }
  }

  // Get default filters when personalization data is not available
  private getDefaultFilters() {
    return {
      categories: ['stroll', 'sip_chill', 'casual_eats'],
      timeWindow: 'tonight',
      location: { lat: 0, lng: 0 },
      budget: { min: 25, max: 100 },
      preferences: {}
    };
  }

  // Enhance recommendation scoring with personalization
  enhanceRecommendationScore(
    recommendation: any,
    context: PersonalizedRecommendationContext
  ): number {
    let score = 0;

    // Category preference scoring
    if (context.userPreferences.favoriteCategories.includes(recommendation.category)) {
      score += 3.0;
    }

    // Time preference scoring
    const currentHour = new Date().getHours();
    if (context.userPreferences.timePreferences.includes('morning') && currentHour < 12) {
      score += 1.5;
    } else if (context.userPreferences.timePreferences.includes('evening') && currentHour >= 18) {
      score += 1.5;
    }

    // Location preference scoring
    if (context.userPreferences.locationPatterns.home) {
      const distance = this.calculateDistance(
        recommendation.location,
        context.userPreferences.locationPatterns.home
      );
      if (distance < 5) { // Within 5km of home
        score += 1.0;
      }
    }

    // Activity pattern scoring
    const activityKey = `like_${recommendation.category}`;
    if (context.userPreferences.activityPatterns[activityKey]) {
      score += Math.min(context.userPreferences.activityPatterns[activityKey] * 0.1, 2.0);
    }

    return Math.min(score, 10.0); // Cap at 10
  }

  // Calculate distance between two points
  private calculateDistance(
    point1: { lat: number; lng: number },
    point2: { lat: number; lng: number }
  ): number {
    const R = 6371; // Earth's radius in km
    const dLat = (point2.lat - point1.lat) * Math.PI / 180;
    const dLng = (point2.lng - point1.lng) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(point1.lat * Math.PI / 180) * Math.cos(point2.lat * Math.PI / 180) *
      Math.sin(dLng/2) * Math.sin(dLng/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }
}

export const enhancedPersonalizationService = EnhancedPersonalizationService.getInstance();
