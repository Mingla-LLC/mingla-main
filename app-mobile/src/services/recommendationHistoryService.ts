/**
 * Recommendation History Service
 * Tracks user's recommendation viewing history and provides analytics
 */

import { supabase } from './supabase';
import { RecommendationCard } from '../types';

export interface RecommendationHistoryEntry {
  id: string;
  user_id: string;
  recommendation_id: string;
  recommendation_data: RecommendationCard;
  viewed_at: string;
  session_id?: string;
  interaction_type: 'view' | 'like' | 'dislike' | 'save' | 'share' | 'invite';
  location_context?: {
    lat: number;
    lng: number;
    address?: string;
  };
  time_context?: {
    time_of_day: string;
    day_of_week: string;
    season?: string;
  };
  device_context?: {
    platform: string;
    app_version: string;
  };
}

export interface HistoryAnalytics {
  totalViews: number;
  totalLikes: number;
  totalSaves: number;
  mostViewedCategories: Array<{
    category: string;
    count: number;
    percentage: number;
  }>;
  mostLikedCategories: Array<{
    category: string;
    count: number;
    percentage: number;
  }>;
  viewingPatterns: {
    timeOfDay: Record<string, number>;
    dayOfWeek: Record<string, number>;
    locationPatterns: Array<{
      location: string;
      count: number;
    }>;
  };
  recentActivity: RecommendationHistoryEntry[];
  favoriteLocations: Array<{
    location: string;
    lat: number;
    lng: number;
    visitCount: number;
    lastVisited: string;
  }>;
}

export interface HistoryFilters {
  dateRange?: {
    start: string;
    end: string;
  };
  categories?: string[];
  interactionTypes?: string[];
  locations?: string[];
  limit?: number;
  offset?: number;
}

class RecommendationHistoryService {
  /**
   * Record a recommendation interaction
   */
  async recordInteraction(
    userId: string,
    recommendation: RecommendationCard,
    interactionType: RecommendationHistoryEntry['interaction_type'],
    context?: {
      sessionId?: string;
      location?: { lat: number; lng: number; address?: string };
      timeOfDay?: string;
      dayOfWeek?: string;
    }
  ): Promise<void> {
    try {
      const now = new Date();
      const dayOfWeek = now.toLocaleDateString('en-US', { weekday: 'long' });
      const timeOfDay = this.getTimeOfDay(now.getHours());
      
      const historyEntry: Omit<RecommendationHistoryEntry, 'id'> = {
        user_id: userId,
        recommendation_id: recommendation.id,
        recommendation_data: recommendation,
        viewed_at: now.toISOString(),
        session_id: context?.sessionId,
        interaction_type: interactionType,
        location_context: context?.location,
        time_context: {
          time_of_day: context?.timeOfDay || timeOfDay,
          day_of_week: context?.dayOfWeek || dayOfWeek,
          season: this.getSeason(now.getMonth())
        },
        device_context: {
          platform: 'mobile',
          app_version: '1.0.0' // This could be dynamic
        }
      };

      const { error } = await supabase
        .from('recommendation_history')
        .insert(historyEntry);

      if (error) {
        console.error('Error recording recommendation interaction:', error);
      } else {
      }
    } catch (error) {
      console.error('Error in recordInteraction:', error);
    }
  }

  /**
   * Get user's recommendation history with filters
   */
  async getRecommendationHistory(
    userId: string,
    filters: HistoryFilters = {}
  ): Promise<RecommendationHistoryEntry[]> {
    try {
      let query = supabase
        .from('recommendation_history')
        .select('*')
        .eq('user_id', userId)
        .order('viewed_at', { ascending: false });

      // Apply filters
      if (filters.dateRange) {
        query = query
          .gte('viewed_at', filters.dateRange.start)
          .lte('viewed_at', filters.dateRange.end);
      }

      if (filters.categories && filters.categories.length > 0) {
        query = query.contains('recommendation_data->category', filters.categories);
      }

      if (filters.interactionTypes && filters.interactionTypes.length > 0) {
        query = query.in('interaction_type', filters.interactionTypes);
      }

      if (filters.limit) {
        query = query.limit(filters.limit);
      }

      if (filters.offset) {
        query = query.range(filters.offset, filters.offset + (filters.limit || 50) - 1);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error fetching recommendation history:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('Error in getRecommendationHistory:', error);
      return [];
    }
  }

  /**
   * Get analytics from user's recommendation history
   */
  async getHistoryAnalytics(userId: string, period: 'week' | 'month' | 'year' = 'month'): Promise<HistoryAnalytics | null> {
    try {
      const dateRange = this.getDateRange(period);
      const history = await this.getRecommendationHistory(userId, { dateRange });

      if (history.length === 0) {
        return this.getEmptyAnalytics();
      }

      // Calculate analytics
      const totalViews = history.filter(h => h.interaction_type === 'view').length;
      const totalLikes = history.filter(h => h.interaction_type === 'like').length;
      const totalSaves = history.filter(h => h.interaction_type === 'save').length;

      // Category analytics
      const categoryCounts = this.getCategoryCounts(history);
      const mostViewedCategories = this.getTopCategories(categoryCounts.views);
      const mostLikedCategories = this.getTopCategories(categoryCounts.likes);

      // Viewing patterns
      const viewingPatterns = this.getViewingPatterns(history);

      // Recent activity
      const recentActivity = history.slice(0, 10);

      // Favorite locations
      const favoriteLocations = this.getFavoriteLocations(history);

      return {
        totalViews,
        totalLikes,
        totalSaves,
        mostViewedCategories,
        mostLikedCategories,
        viewingPatterns,
        recentActivity,
        favoriteLocations
      };
    } catch (error) {
      console.error('Error in getHistoryAnalytics:', error);
      return null;
    }
  }

  /**
   * Get recommendations similar to user's history
   */
  async getSimilarRecommendations(
    userId: string,
    currentRecommendation: RecommendationCard,
    limit: number = 5
  ): Promise<RecommendationCard[]> {
    try {
      const history = await this.getRecommendationHistory(userId, { limit: 100 });
      
      if (history.length === 0) {
        return [];
      }

      // Find similar recommendations based on category, location, and price
      const similarRecommendations = history
        .filter(entry => {
          const rec = entry.recommendation_data;
          return (
            rec.category === currentRecommendation.category ||
            this.isLocationSimilar(rec.location, currentRecommendation.location) ||
            this.isPriceSimilar(rec.estimatedCostPerPerson, currentRecommendation.estimatedCostPerPerson)
          );
        })
        .map(entry => entry.recommendation_data)
        .slice(0, limit);

      return similarRecommendations;
    } catch (error) {
      console.error('Error in getSimilarRecommendations:', error);
      return [];
    }
  }

  /**
   * Get user's favorite categories based on history
   */
  async getFavoriteCategories(userId: string): Promise<Array<{ category: string; score: number }>> {
    try {
      const history = await this.getRecommendationHistory(userId, { limit: 200 });
      
      if (history.length === 0) {
        return [];
      }

      const categoryScores = new Map<string, number>();

      history.forEach(entry => {
        const category = entry.recommendation_data.category;
        const currentScore = categoryScores.get(category) || 0;
        
        // Weight different interaction types
        let weight = 1;
        switch (entry.interaction_type) {
          case 'like': weight = 3; break;
          case 'save': weight = 4; break;
          case 'share': weight = 5; break;
          case 'dislike': weight = -2; break;
          default: weight = 1;
        }

        categoryScores.set(category, currentScore + weight);
      });

      return Array.from(categoryScores.entries())
        .map(([category, score]) => ({ category, score }))
        .sort((a, b) => b.score - a.score);
    } catch (error) {
      console.error('Error in getFavoriteCategories:', error);
      return [];
    }
  }

  /**
   * Clear user's recommendation history
   */
  async clearHistory(userId: string, olderThan?: string): Promise<boolean> {
    try {
      let query = supabase
        .from('recommendation_history')
        .delete()
        .eq('user_id', userId);

      if (olderThan) {
        query = query.lt('viewed_at', olderThan);
      }

      const { error } = await query;

      if (error) {
        console.error('Error clearing recommendation history:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error in clearHistory:', error);
      return false;
    }
  }

  // Helper methods
  private getTimeOfDay(hour: number): string {
    if (hour >= 6 && hour < 12) return 'morning';
    if (hour >= 12 && hour < 17) return 'afternoon';
    if (hour >= 17 && hour < 21) return 'evening';
    return 'night';
  }

  private getSeason(month: number): string {
    if (month >= 2 && month <= 4) return 'spring';
    if (month >= 5 && month <= 7) return 'summer';
    if (month >= 8 && month <= 10) return 'fall';
    return 'winter';
  }

  private getDateRange(period: 'week' | 'month' | 'year'): { start: string; end: string } {
    const now = new Date();
    const start = new Date();

    switch (period) {
      case 'week':
        start.setDate(now.getDate() - 7);
        break;
      case 'month':
        start.setMonth(now.getMonth() - 1);
        break;
      case 'year':
        start.setFullYear(now.getFullYear() - 1);
        break;
    }

    return {
      start: start.toISOString(),
      end: now.toISOString()
    };
  }

  private getCategoryCounts(history: RecommendationHistoryEntry[]): { views: Map<string, number>; likes: Map<string, number> } {
    const views = new Map<string, number>();
    const likes = new Map<string, number>();

    history.forEach(entry => {
      const category = entry.recommendation_data.category;
      
      if (entry.interaction_type === 'view') {
        views.set(category, (views.get(category) || 0) + 1);
      } else if (entry.interaction_type === 'like') {
        likes.set(category, (likes.get(category) || 0) + 1);
      }
    });

    return { views, likes };
  }

  private getTopCategories(categoryMap: Map<string, number>): Array<{ category: string; count: number; percentage: number }> {
    const total = Array.from(categoryMap.values()).reduce((sum, count) => sum + count, 0);
    
    return Array.from(categoryMap.entries())
      .map(([category, count]) => ({
        category,
        count,
        percentage: total > 0 ? (count / total) * 100 : 0
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }

  private getViewingPatterns(history: RecommendationHistoryEntry[]): HistoryAnalytics['viewingPatterns'] {
    const timeOfDay: Record<string, number> = {};
    const dayOfWeek: Record<string, number> = {};
    const locationPatterns: Array<{ location: string; count: number }> = [];

    history.forEach(entry => {
      // Time of day patterns
      if (entry.time_context?.time_of_day) {
        timeOfDay[entry.time_context.time_of_day] = (timeOfDay[entry.time_context.time_of_day] || 0) + 1;
      }

      // Day of week patterns
      if (entry.time_context?.day_of_week) {
        dayOfWeek[entry.time_context.day_of_week] = (dayOfWeek[entry.time_context.day_of_week] || 0) + 1;
      }

      // Location patterns
      if (entry.location_context?.address) {
        const existing = locationPatterns.find(l => l.location === entry.location_context!.address);
        if (existing) {
          existing.count++;
        } else {
          locationPatterns.push({
            location: entry.location_context.address,
            count: 1
          });
        }
      }
    });

    return {
      timeOfDay,
      dayOfWeek,
      locationPatterns: locationPatterns.sort((a, b) => b.count - a.count).slice(0, 10)
    };
  }

  private getFavoriteLocations(history: RecommendationHistoryEntry[]): Array<{ location: string; lat: number; lng: number; visitCount: number; lastVisited: string }> {
    const locationMap = new Map<string, { lat: number; lng: number; visitCount: number; lastVisited: string }>();

    history.forEach(entry => {
      if (entry.location_context?.address && entry.location_context.lat && entry.location_context.lng) {
        const key = entry.location_context.address;
        const existing = locationMap.get(key);
        
        if (existing) {
          existing.visitCount++;
          if (entry.viewed_at > existing.lastVisited) {
            existing.lastVisited = entry.viewed_at;
          }
        } else {
          locationMap.set(key, {
            lat: entry.location_context.lat,
            lng: entry.location_context.lng,
            visitCount: 1,
            lastVisited: entry.viewed_at
          });
        }
      }
    });

    return Array.from(locationMap.entries())
      .map(([location, data]) => ({ location, ...data }))
      .sort((a, b) => b.visitCount - a.visitCount)
      .slice(0, 10);
  }

  private isLocationSimilar(loc1: any, loc2: any): boolean {
    if (!loc1 || !loc2 || !loc1.lat || !loc1.lng || !loc2.lat || !loc2.lng) {
      return false;
    }

    // Calculate distance (simplified)
    const distance = Math.sqrt(
      Math.pow(loc1.lat - loc2.lat, 2) + Math.pow(loc1.lng - loc2.lng, 2)
    );

    return distance < 0.01; // Approximately 1km
  }

  private isPriceSimilar(price1: any, price2: any): boolean {
    const p1 = typeof price1 === 'number' ? price1 : parseFloat(price1) || 0;
    const p2 = typeof price2 === 'number' ? price2 : parseFloat(price2) || 0;

    if (p1 === 0 || p2 === 0) return false;

    const difference = Math.abs(p1 - p2);
    const average = (p1 + p2) / 2;

    return (difference / average) < 0.3; // Within 30%
  }

  private getEmptyAnalytics(): HistoryAnalytics {
    return {
      totalViews: 0,
      totalLikes: 0,
      totalSaves: 0,
      mostViewedCategories: [],
      mostLikedCategories: [],
      viewingPatterns: {
        timeOfDay: {},
        dayOfWeek: {},
        locationPatterns: []
      },
      recentActivity: [],
      favoriteLocations: []
    };
  }
}

export const recommendationHistoryService = new RecommendationHistoryService();
