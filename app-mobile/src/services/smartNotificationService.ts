/**
 * Smart Notification Service
 * Provides intelligent, context-aware notifications for recommendations
 */

import { supabase } from './supabase';
import { RecommendationCard } from '../types';
import { recommendationHistoryService } from './recommendationHistoryService';
import { enhancedFavoritesService } from './enhancedFavoritesService';

export interface NotificationPreferences {
  id: string;
  user_id: string;
  enabled: boolean;
  types: {
    newRecommendations: boolean;
    locationBased: boolean;
    timeBased: boolean;
    favoriteUpdates: boolean;
    socialActivity: boolean;
    personalizedInsights: boolean;
  };
  timing: {
    quietHours: {
      enabled: boolean;
      start: string; // HH:MM format
      end: string; // HH:MM format
    };
    maxPerDay: number;
    minIntervalMinutes: number;
  };
  categories: {
    enabled: string[];
    disabled: string[];
  };
  locations: {
    enabled: boolean;
    radiusKm: number;
    favoriteLocations: boolean;
  };
  frequency: 'low' | 'medium' | 'high' | 'custom';
  customFrequency?: {
    weekdays: boolean;
    weekends: boolean;
    morning: boolean;
    afternoon: boolean;
    evening: boolean;
  };
}

export interface SmartNotification {
  id: string;
  user_id: string;
  type: 'new_recommendation' | 'location_based' | 'time_based' | 'favorite_update' | 'social_activity' | 'personalized_insight';
  title: string;
  message: string;
  data?: {
    recommendationId?: string;
    recommendationData?: RecommendationCard;
    location?: {
      lat: number;
      lng: number;
      address: string;
    };
    category?: string;
    priority: 'low' | 'medium' | 'high';
  };
  scheduled_for: string;
  sent_at?: string;
  delivered_at?: string;
  opened_at?: string;
  dismissed_at?: string;
  created_at: string;
  updated_at: string;
}

export interface NotificationAnalytics {
  totalSent: number;
  totalDelivered: number;
  totalOpened: number;
  totalDismissed: number;
  openRate: number;
  dismissalRate: number;
  engagementByType: Record<string, {
    sent: number;
    opened: number;
    dismissed: number;
    openRate: number;
  }>;
  engagementByTime: Record<string, number>;
  topCategories: Array<{
    category: string;
    openRate: number;
    count: number;
  }>;
  userEngagementScore: number;
}

export interface NotificationTrigger {
  type: 'location' | 'time' | 'behavior' | 'preference' | 'social';
  conditions: any;
  priority: 'low' | 'medium' | 'high';
  cooldownMinutes: number;
}

class SmartNotificationService {
  private notificationQueue: Map<string, SmartNotification[]> = new Map();
  private userPreferences: Map<string, NotificationPreferences> = new Map();
  private lastNotificationTimes: Map<string, Date> = new Map();

  /**
   * Initialize notification service for a user
   */
  async initializeUser(userId: string): Promise<void> {
    try {
      const preferences = await this.getUserPreferences(userId);
      if (!preferences) {
        await this.createDefaultPreferences(userId);
      }
      
      // Load user preferences into memory
      const userPrefs = await this.getUserPreferences(userId);
      if (userPrefs) {
        this.userPreferences.set(userId, userPrefs);
      }

      // Schedule initial notifications
      await this.scheduleSmartNotifications(userId);
    } catch (error) {
      console.error('Error initializing notification service:', error);
    }
  }

  /**
   * Get user notification preferences
   */
  async getUserPreferences(userId: string): Promise<NotificationPreferences | null> {
    try {
      const { data, error } = await supabase
        .from('notification_preferences')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (error) {
        if (error.code === 'PGRST116' || error.code === 'PGRST205') {
          // PGRST116: Not found, PGRST205: Table doesn't exist
          return null;
        }
        console.warn('Error fetching notification preferences:', error.message);
        return null;
      }

      return data;
    } catch (error) {
      console.error('Error in getUserPreferences:', error);
      return null;
    }
  }

  /**
   * Create default notification preferences
   */
  async createDefaultPreferences(userId: string): Promise<NotificationPreferences | null> {
    try {
      const defaultPreferences: Omit<NotificationPreferences, 'id'> = {
        user_id: userId,
        enabled: true,
        types: {
          newRecommendations: true,
          locationBased: true,
          timeBased: true,
          favoriteUpdates: true,
          socialActivity: false,
          personalizedInsights: true,
        },
        timing: {
          quietHours: {
            enabled: true,
            start: '22:00',
            end: '08:00',
          },
          maxPerDay: 5,
          minIntervalMinutes: 30,
        },
        categories: {
          enabled: [],
          disabled: [],
        },
        locations: {
          enabled: true,
          radiusKm: 5,
          favoriteLocations: true,
        },
        frequency: 'medium',
        // customFrequency removed - column doesn't exist in notification_preferences table
      };

      const { data, error } = await supabase
        .from('notification_preferences')
        .insert(defaultPreferences)
        .select()
        .single();

      if (error) {
        // Silently fail if notification_preferences table doesn't exist or has schema issues
        // This is optional functionality and shouldn't break the app
        console.warn('Could not create notification preferences (table may not exist):', error.message);
        return null;
      }

      return data;
    } catch (error) {
      console.warn('Error in createDefaultPreferences:', error);
      return null;
    }
  }

  /**
   * Update user notification preferences
   */
  async updateUserPreferences(
    userId: string,
    updates: Partial<NotificationPreferences>
  ): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('notification_preferences')
        .update(updates)
        .eq('user_id', userId);

      if (error) {
        // PGRST205 means table doesn't exist - silently handle this
        if (error.code === 'PGRST205') {
          console.warn('Notification preferences table does not exist');
          return false;
        }
        console.warn('Error updating notification preferences:', error.message);
        return false;
      }

      // Update in-memory cache
      const currentPrefs = this.userPreferences.get(userId);
      if (currentPrefs) {
        this.userPreferences.set(userId, { ...currentPrefs, ...updates });
      }

      return true;
    } catch (error) {
      console.warn('Error in updateUserPreferences:', error);
      return false;
    }
  }

  /**
   * Schedule smart notifications based on user behavior and preferences
   */
  async scheduleSmartNotifications(userId: string): Promise<void> {
    try {
      const preferences = await this.getUserPreferences(userId);
      if (!preferences || !preferences.enabled) {
        return;
      }

      // Check if we should send notifications based on timing rules
      if (!this.shouldSendNotification(userId, preferences)) {
        return;
      }

      // Generate different types of notifications
      const notifications: SmartNotification[] = [];

      // Location-based notifications
      if (preferences.types.locationBased) {
        const locationNotifications = await this.generateLocationBasedNotifications(userId, preferences);
        notifications.push(...locationNotifications);
      }

      // Time-based notifications
      if (preferences.types.timeBased) {
        const timeNotifications = await this.generateTimeBasedNotifications(userId, preferences);
        notifications.push(...timeNotifications);
      }

      // Personalized insights
      if (preferences.types.personalizedInsights) {
        const insightNotifications = await this.generatePersonalizedInsights(userId, preferences);
        notifications.push(...insightNotifications);
      }

      // Favorite updates
      if (preferences.types.favoriteUpdates) {
        const favoriteNotifications = await this.generateFavoriteUpdateNotifications(userId, preferences);
        notifications.push(...favoriteNotifications);
      }

      // Schedule notifications
      for (const notification of notifications) {
        await this.scheduleNotification(notification);
      }

      // Update last notification time
      this.lastNotificationTimes.set(userId, new Date());

    } catch (error) {
      console.error('Error scheduling smart notifications:', error);
    }
  }

  /**
   * Generate location-based notifications
   */
  private async generateLocationBasedNotifications(
    userId: string,
    preferences: NotificationPreferences
  ): Promise<SmartNotification[]> {
    const notifications: SmartNotification[] = [];

    try {
      // Get user's recent location history
      const history = await recommendationHistoryService.getRecommendationHistory(userId, {
        limit: 50,
        interactionTypes: ['view', 'like']
      });

      if (history.length === 0) {
        return notifications;
      }

      // Find new locations or areas with good recommendations
      const locationGroups = this.groupByLocation(history);
      const topLocations = Array.from(locationGroups.entries())
        .sort(([,a], [,b]) => b.length - a.length)
        .slice(0, 3);

      for (const [location, interactions] of topLocations) {
        if (this.shouldNotifyAboutLocation(userId, location, interactions)) {
          const notification: Omit<SmartNotification, 'id' | 'created_at' | 'updated_at'> = {
            user_id: userId,
            type: 'location_based',
            title: 'New Recommendations Nearby',
            message: `Discover new experiences in ${location}`,
            data: {
              location: this.extractLocationData(location),
              priority: 'medium'
            },
            scheduled_for: new Date(Date.now() + 5 * 60 * 1000).toISOString(), // 5 minutes from now
          };

          notifications.push(notification as SmartNotification);
        }
      }
    } catch (error) {
      console.error('Error generating location-based notifications:', error);
    }

    return notifications;
  }

  /**
   * Generate time-based notifications
   */
  private async generateTimeBasedNotifications(
    userId: string,
    preferences: NotificationPreferences
  ): Promise<SmartNotification[]> {
    const notifications: SmartNotification[] = [];

    try {
      const now = new Date();
      const hour = now.getHours();
      const dayOfWeek = now.getDay();

      // Check if it's a good time to send notifications
      if (!this.isGoodTimeForNotification(hour, dayOfWeek, preferences)) {
        return notifications;
      }

      // Get user's activity patterns
      const analytics = await recommendationHistoryService.getHistoryAnalytics(userId, 'week');
      if (!analytics) {
        return notifications;
      }

      // Generate time-appropriate notifications
      if (hour >= 6 && hour < 12) {
        // Morning notifications
        notifications.push({
          user_id: userId,
          type: 'time_based',
          title: 'Good Morning!',
          message: 'Start your day with some great recommendations',
          data: { priority: 'low' },
          scheduled_for: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
        } as SmartNotification);
      } else if (hour >= 17 && hour < 21) {
        // Evening notifications
        notifications.push({
          user_id: userId,
          type: 'time_based',
          title: 'Evening Plans?',
          message: 'Discover something new for tonight',
          data: { priority: 'medium' },
          scheduled_for: new Date(Date.now() + 3 * 60 * 1000).toISOString(),
        } as SmartNotification);
      }
    } catch (error) {
      console.error('Error generating time-based notifications:', error);
    }

    return notifications;
  }

  /**
   * Generate personalized insights notifications
   */
  private async generatePersonalizedInsights(
    userId: string,
    preferences: NotificationPreferences
  ): Promise<SmartNotification[]> {
    const notifications: SmartNotification[] = [];

    try {
      const analytics = await recommendationHistoryService.getHistoryAnalytics(userId, 'month');
      if (!analytics || analytics.totalViews < 10) {
        return notifications; // Need more data for insights
      }

      // Generate insights based on user behavior
      const topCategory = analytics.mostViewedCategories[0];
      if (topCategory && topCategory.percentage > 30) {
        notifications.push({
          user_id: userId,
          type: 'personalized_insight',
          title: 'Your Favorite Category',
          message: `You love ${topCategory.category} experiences! Here are some new ones to try.`,
          data: {
            category: topCategory.category,
            priority: 'low'
          },
          scheduled_for: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        } as SmartNotification);
      }

      // Location insights
      if (analytics.favoriteLocations.length > 0) {
        const topLocation = analytics.favoriteLocations[0];
        notifications.push({
          user_id: userId,
          type: 'personalized_insight',
          title: 'Your Go-To Spot',
          message: `You've visited ${topLocation.location} ${topLocation.visitCount} times. Discover similar places!`,
          data: {
            location: {
              lat: topLocation.lat,
              lng: topLocation.lng,
              address: topLocation.location
            },
            priority: 'low'
          },
          scheduled_for: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        } as SmartNotification);
      }
    } catch (error) {
      console.error('Error generating personalized insights:', error);
    }

    return notifications;
  }

  /**
   * Generate favorite update notifications
   */
  private async generateFavoriteUpdateNotifications(
    userId: string,
    preferences: NotificationPreferences
  ): Promise<SmartNotification[]> {
    const notifications: SmartNotification[] = [];

    try {
      const favorites = await enhancedFavoritesService.getFavoriteItems(userId, { limit: 20 });
      
      // Check for new recommendations similar to favorites
      if (favorites.length > 0) {
        const randomFavorite = favorites[Math.floor(Math.random() * favorites.length)];
        notifications.push({
          user_id: userId,
          type: 'favorite_update',
          title: 'Similar to Your Favorites',
          message: `We found something similar to "${randomFavorite.recommendation_data.title}"`,
          data: {
            recommendationId: randomFavorite.recommendation_id,
            recommendationData: randomFavorite.recommendation_data,
            priority: 'medium'
          },
          scheduled_for: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
        } as SmartNotification);
      }
    } catch (error) {
      console.error('Error generating favorite update notifications:', error);
    }

    return notifications;
  }

  /**
   * Schedule a notification
   */
  private async scheduleNotification(notification: SmartNotification): Promise<void> {
    try {
      const { error } = await supabase
        .from('smart_notifications')
        .insert(notification);

      if (error) {
        console.error('Error scheduling notification:', error);
      } else {
      }
    } catch (error) {
      console.error('Error in scheduleNotification:', error);
    }
  }

  /**
   * Mark notification as sent
   */
  async markNotificationSent(notificationId: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('smart_notifications')
        .update({ sent_at: new Date().toISOString() })
        .eq('id', notificationId);

      if (error) {
        console.error('Error marking notification as sent:', error);
      }
    } catch (error) {
      console.error('Error in markNotificationSent:', error);
    }
  }

  /**
   * Mark notification as delivered
   */
  async markNotificationDelivered(notificationId: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('smart_notifications')
        .update({ delivered_at: new Date().toISOString() })
        .eq('id', notificationId);

      if (error) {
        console.error('Error marking notification as delivered:', error);
      }
    } catch (error) {
      console.error('Error in markNotificationDelivered:', error);
    }
  }

  /**
   * Mark notification as opened
   */
  async markNotificationOpened(notificationId: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('smart_notifications')
        .update({ opened_at: new Date().toISOString() })
        .eq('id', notificationId);

      if (error) {
        console.error('Error marking notification as opened:', error);
      }
    } catch (error) {
      console.error('Error in markNotificationOpened:', error);
    }
  }

  /**
   * Mark notification as dismissed
   */
  async markNotificationDismissed(notificationId: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('smart_notifications')
        .update({ dismissed_at: new Date().toISOString() })
        .eq('id', notificationId);

      if (error) {
        console.error('Error marking notification as dismissed:', error);
      }
    } catch (error) {
      console.error('Error in markNotificationDismissed:', error);
    }
  }

  /**
   * Get notification analytics
   */
  async getNotificationAnalytics(userId: string, period: 'week' | 'month' | 'year' = 'month'): Promise<NotificationAnalytics | null> {
    try {
      const dateRange = this.getDateRange(period);
      
      const { data, error } = await supabase
        .from('smart_notifications')
        .select('*')
        .eq('user_id', userId)
        .gte('created_at', dateRange.start)
        .lte('created_at', dateRange.end);

      if (error) {
        console.error('Error fetching notification analytics:', error);
        return null;
      }

      const notifications = data || [];
      
      if (notifications.length === 0) {
        return this.getEmptyAnalytics();
      }

      // Calculate analytics
      const totalSent = notifications.filter(n => n.sent_at).length;
      const totalDelivered = notifications.filter(n => n.delivered_at).length;
      const totalOpened = notifications.filter(n => n.opened_at).length;
      const totalDismissed = notifications.filter(n => n.dismissed_at).length;

      const openRate = totalDelivered > 0 ? (totalOpened / totalDelivered) * 100 : 0;
      const dismissalRate = totalDelivered > 0 ? (totalDismissed / totalDelivered) * 100 : 0;

      // Engagement by type
      const engagementByType: Record<string, any> = {};
      notifications.forEach(notification => {
        if (!engagementByType[notification.type]) {
          engagementByType[notification.type] = { sent: 0, opened: 0, dismissed: 0 };
        }
        if (notification.sent_at) engagementByType[notification.type].sent++;
        if (notification.opened_at) engagementByType[notification.type].opened++;
        if (notification.dismissed_at) engagementByType[notification.type].dismissed++;
      });

      // Calculate open rates for each type
      Object.keys(engagementByType).forEach(type => {
        const stats = engagementByType[type];
        stats.openRate = stats.sent > 0 ? (stats.opened / stats.sent) * 100 : 0;
      });

      // Engagement by time
      const engagementByTime: Record<string, number> = {};
      notifications.forEach(notification => {
        if (notification.opened_at) {
          const hour = new Date(notification.opened_at).getHours();
          const timeSlot = this.getTimeSlot(hour);
          engagementByTime[timeSlot] = (engagementByTime[timeSlot] || 0) + 1;
        }
      });

      // Top categories
      const categoryCounts = new Map<string, { count: number; opened: number }>();
      notifications.forEach(notification => {
        if (notification.data?.category) {
          const category = notification.data.category;
          const current = categoryCounts.get(category) || { count: 0, opened: 0 };
          current.count++;
          if (notification.opened_at) current.opened++;
          categoryCounts.set(category, current);
        }
      });

      const topCategories = Array.from(categoryCounts.entries())
        .map(([category, stats]) => ({
          category,
          openRate: stats.count > 0 ? (stats.opened / stats.count) * 100 : 0,
          count: stats.count
        }))
        .sort((a, b) => b.openRate - a.openRate)
        .slice(0, 5);

      // User engagement score (0-100)
      const userEngagementScore = Math.min(100, Math.max(0, 
        (openRate * 0.4) + 
        ((100 - dismissalRate) * 0.3) + 
        (Math.min(100, (totalOpened / 10) * 100) * 0.3)
      ));

      return {
        totalSent,
        totalDelivered,
        totalOpened,
        totalDismissed,
        openRate,
        dismissalRate,
        engagementByType,
        engagementByTime,
        topCategories,
        userEngagementScore
      };
    } catch (error) {
      console.error('Error in getNotificationAnalytics:', error);
      return null;
    }
  }

  // Helper methods
  private shouldSendNotification(userId: string, preferences: NotificationPreferences): boolean {
    const now = new Date();
    const lastNotification = this.lastNotificationTimes.get(userId);
    
    if (lastNotification) {
      const timeSinceLastNotification = now.getTime() - lastNotification.getTime();
      const minIntervalMs = preferences.timing.minIntervalMinutes * 60 * 1000;
      
      if (timeSinceLastNotification < minIntervalMs) {
        return false;
      }
    }

    // Check quiet hours
    if (preferences.timing.quietHours.enabled) {
      const currentTime = now.toTimeString().slice(0, 5);
      const startTime = preferences.timing.quietHours.start;
      const endTime = preferences.timing.quietHours.end;
      
      if (this.isTimeInRange(currentTime, startTime, endTime)) {
        return false;
      }
    }

    return true;
  }

  private isGoodTimeForNotification(hour: number, dayOfWeek: number, preferences: NotificationPreferences): boolean {
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const isWeekday = !isWeekend;
    
    const isMorning = hour >= 6 && hour < 12;
    const isAfternoon = hour >= 12 && hour < 17;
    const isEvening = hour >= 17 && hour < 21;

    if (preferences.frequency === 'low') {
      return isWeekday && isEvening;
    } else if (preferences.frequency === 'high') {
      return (isWeekday && (isMorning || isAfternoon || isEvening)) || (isWeekend && (isMorning || isEvening));
    } else {
      // medium frequency
      return (isWeekday && (isMorning || isEvening)) || (isWeekend && isEvening);
    }
  }

  private groupByLocation(history: any[]): Map<string, any[]> {
    const groups = new Map<string, any[]>();
    
    history.forEach(entry => {
      if (entry.location_context?.address) {
        const location = entry.location_context.address;
        if (!groups.has(location)) {
          groups.set(location, []);
        }
        groups.get(location)!.push(entry);
      }
    });
    
    return groups;
  }

  private shouldNotifyAboutLocation(userId: string, location: string, interactions: any[]): boolean {
    // Don't notify about locations user has already been to recently
    const recentInteractions = interactions.filter(i => {
      const interactionTime = new Date(i.viewed_at);
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      return interactionTime > oneDayAgo;
    });
    
    return recentInteractions.length < 3; // Notify if less than 3 recent interactions
  }

  private extractLocationData(location: string): { lat: number; lng: number; address: string } {
    // This would typically extract coordinates from location string
    // For now, return a placeholder
    return {
      lat: 0,
      lng: 0,
      address: location
    };
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

  private getTimeSlot(hour: number): string {
    if (hour >= 6 && hour < 12) return 'morning';
    if (hour >= 12 && hour < 17) return 'afternoon';
    if (hour >= 17 && hour < 21) return 'evening';
    return 'night';
  }

  private isTimeInRange(currentTime: string, startTime: string, endTime: string): boolean {
    if (startTime <= endTime) {
      return currentTime >= startTime && currentTime <= endTime;
    } else {
      // Overnight range (e.g., 22:00 to 08:00)
      return currentTime >= startTime || currentTime <= endTime;
    }
  }

  private getEmptyAnalytics(): NotificationAnalytics {
    return {
      totalSent: 0,
      totalDelivered: 0,
      totalOpened: 0,
      totalDismissed: 0,
      openRate: 0,
      dismissalRate: 0,
      engagementByType: {},
      engagementByTime: {},
      topCategories: [],
      userEngagementScore: 0
    };
  }
}

export const smartNotificationService = new SmartNotificationService();
