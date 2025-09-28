import { supabase } from './supabase';
import { enhancedLocationTrackingService, LocationData } from './enhancedLocationTrackingService';
import { enhancedProfileService } from './enhancedProfileService';

export type InteractionType = 
  | 'view' 
  | 'like' 
  | 'dislike' 
  | 'save' 
  | 'unsave' 
  | 'share' 
  | 'schedule' 
  | 'unschedule' 
  | 'click_details' 
  | 'swipe_left' 
  | 'swipe_right' 
  | 'tap';

export interface InteractionData {
  // Card/Experience data
  category?: string;
  priceLevel?: number;
  estimatedCost?: number;
  rating?: number;
  reviewCount?: number;
  duration?: number;
  
  // Context data
  timeOfDay?: string;
  dayOfWeek?: string;
  weather?: string;
  groupSize?: number;
  occasion?: string;
  
  // UI interaction data
  timeSpent?: number; // Time spent viewing the card
  swipeDirection?: 'left' | 'right';
  tapCount?: number;
  scrollDepth?: number;
  
  // Recommendation context
  recommendationSource?: string;
  recommendationRank?: number;
  totalRecommendations?: number;
  
  // Additional metadata
  [key: string]: any;
}

export interface LocationContext {
  currentLocation?: LocationData | null;
  isAtHome?: boolean;
  isAtWork?: boolean;
  frequentLocation?: boolean;
  locationAccuracy?: number;
}

export interface RecommendationContext {
  sessionId?: string;
  preferences?: any;
  filters?: any;
  searchQuery?: string;
  recommendationEngine?: string;
}

export interface UserSession {
  id: string;
  sessionType: 'recommendation' | 'exploration' | 'planning' | 'social';
  sessionContext: any;
  startedAt: string;
  endedAt?: string;
  interactionCount: number;
  isActive: boolean;
}

class UserInteractionService {
  private currentSession: UserSession | null = null;
  private sessionStartTime: number = 0;

  // Start a new user session
  async startSession(
    sessionType: UserSession['sessionType'] = 'recommendation',
    sessionContext: any = {}
  ): Promise<UserSession | null> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;

      // End any existing active session
      if (this.currentSession) {
        await this.endSession();
      }

      const { data, error } = await supabase
        .from('user_sessions')
        .insert({
          user_id: user.id,
          session_type: sessionType,
          session_context: sessionContext,
        })
        .select()
        .single();

      if (error) {
        console.error('Error starting session:', error);
        return null;
      }

      this.currentSession = data;
      this.sessionStartTime = Date.now();
      console.log('Started new session:', data.id);
      return data;
    } catch (error) {
      console.error('Error starting session:', error);
      return null;
    }
  }

  // End the current session
  async endSession(): Promise<void> {
    if (!this.currentSession) {
      console.log('No active session to end');
      return;
    }

    try {
      const sessionId = this.currentSession.id;
      const { error } = await supabase
        .from('user_sessions')
        .update({
          ended_at: new Date().toISOString(),
          is_active: false,
        })
        .eq('id', sessionId);

      if (error) {
        console.error('Error ending session:', error);
      } else {
        console.log('Ended session:', sessionId);
        this.currentSession = null;
        this.sessionStartTime = 0;
      }
    } catch (error) {
      console.error('Error ending session:', error);
    }
  }

  // Track a user interaction
  async trackInteraction(
    experienceId: string,
    interactionType: InteractionType,
    interactionData: InteractionData = {},
    locationContext?: LocationContext,
    recommendationContext?: RecommendationContext
  ): Promise<void> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        console.log('No authenticated user, skipping interaction tracking');
        return;
      }

      // Get current location if not provided
      let currentLocation = locationContext?.currentLocation;
      if (!currentLocation) {
        currentLocation = await enhancedLocationTrackingService.getCurrentLocation();
      }

      // Get location context
      const locationContextData = {
        currentLocation: currentLocation ? {
          latitude: currentLocation.latitude,
          longitude: currentLocation.longitude,
          accuracy: currentLocation.accuracy,
        } : undefined,
        isAtHome: locationContext?.isAtHome,
        isAtWork: locationContext?.isAtWork,
        frequentLocation: locationContext?.frequentLocation,
        locationAccuracy: currentLocation?.accuracy,
      };

      // Prepare interaction data with additional context
      const enrichedInteractionData = {
        ...interactionData,
        timestamp: new Date().toISOString(),
        sessionDuration: this.currentSession ? Date.now() - this.sessionStartTime : 0,
      };

      // Insert interaction record
      const { error } = await supabase
        .from('user_interactions')
        .insert({
          user_id: user.id,
          experience_id: experienceId,
          interaction_type: interactionType,
          interaction_data: enrichedInteractionData,
          location_context: locationContextData,
          session_id: this.currentSession?.id,
          recommendation_context: recommendationContext || {},
        });

      if (error) {
        console.error('Error tracking interaction:', error);
        return;
      } else {
        // Also track in enhanced profile service for gamified features
        enhancedProfileService.trackActivity(
          interactionType as any,
          enrichedInteractionData,
          interactionData.category,
          locationContextData
        );
      }

      // Update session interaction count
      if (this.currentSession) {
        await this.updateSessionInteractionCount();
      } else {
        console.log('No active session, skipping interaction count update');
      }

      console.log('Tracked interaction:', interactionType, 'for experience:', experienceId);
    } catch (error) {
      console.error('Error tracking interaction:', error);
    }
  }

  // Track card view with timing
  async trackCardView(
    experienceId: string,
    cardData: any,
    startTime: number = Date.now()
  ): Promise<() => void> {
    const viewStartTime = startTime;
    
    // Track the initial view
    await this.trackInteraction(experienceId, 'view', {
      category: cardData.category,
      priceLevel: cardData.priceLevel,
      estimatedCost: cardData.estimatedCostPerPerson,
      rating: cardData.rating,
      reviewCount: cardData.reviewCount,
      duration: cardData.durationMinutes,
      timeOfDay: this.getTimeOfDay(),
      dayOfWeek: this.getDayOfWeek(),
      recommendationSource: cardData.source,
    });

    // Return a function to track when the user stops viewing
    return async () => {
      const timeSpent = Date.now() - viewStartTime;
      await this.trackInteraction(experienceId, 'view', {
        timeSpent,
        category: cardData.category,
        priceLevel: cardData.priceLevel,
        estimatedCost: cardData.estimatedCostPerPerson,
        rating: cardData.rating,
        reviewCount: cardData.reviewCount,
        duration: cardData.durationMinutes,
        timeOfDay: this.getTimeOfDay(),
        dayOfWeek: this.getDayOfWeek(),
        recommendationSource: cardData.source,
      });
    };
  }

  // Track swipe interactions
  async trackSwipe(
    experienceId: string,
    direction: 'left' | 'right',
    cardData: any,
    swipeData: { velocity?: number; distance?: number } = {}
  ): Promise<void> {
    const interactionType = direction === 'left' ? 'swipe_left' : 'swipe_right';
    
    await this.trackInteraction(experienceId, interactionType, {
      category: cardData.category,
      priceLevel: cardData.priceLevel,
      estimatedCost: cardData.estimatedCostPerPerson,
      rating: cardData.rating,
      reviewCount: cardData.reviewCount,
      duration: cardData.durationMinutes,
      timeOfDay: this.getTimeOfDay(),
      dayOfWeek: this.getDayOfWeek(),
      swipeDirection: direction,
      swipeVelocity: swipeData.velocity,
      swipeDistance: swipeData.distance,
      recommendationSource: cardData.source,
    });
  }

  // Track like/dislike interactions
  async trackLike(experienceId: string, cardData: any): Promise<void> {
    await this.trackInteraction(experienceId, 'like', {
      category: cardData.category,
      priceLevel: cardData.priceLevel,
      estimatedCost: cardData.estimatedCostPerPerson,
      rating: cardData.rating,
      reviewCount: cardData.reviewCount,
      duration: cardData.durationMinutes,
      timeOfDay: this.getTimeOfDay(),
      dayOfWeek: this.getDayOfWeek(),
      recommendationSource: cardData.source,
    });
  }

  async trackDislike(experienceId: string, cardData: any): Promise<void> {
    await this.trackInteraction(experienceId, 'dislike', {
      category: cardData.category,
      priceLevel: cardData.priceLevel,
      estimatedCost: cardData.estimatedCostPerPerson,
      rating: cardData.rating,
      reviewCount: cardData.reviewCount,
      duration: cardData.durationMinutes,
      timeOfDay: this.getTimeOfDay(),
      dayOfWeek: this.getDayOfWeek(),
      recommendationSource: cardData.source,
    });
  }

  // Track save/unsave interactions
  async trackSave(experienceId: string, cardData: any): Promise<void> {
    await this.trackInteraction(experienceId, 'save', {
      category: cardData.category,
      priceLevel: cardData.priceLevel,
      estimatedCost: cardData.estimatedCostPerPerson,
      rating: cardData.rating,
      reviewCount: cardData.reviewCount,
      duration: cardData.durationMinutes,
      timeOfDay: this.getTimeOfDay(),
      dayOfWeek: this.getDayOfWeek(),
      recommendationSource: cardData.source,
    });
  }

  async trackUnsave(experienceId: string, cardData: any): Promise<void> {
    await this.trackInteraction(experienceId, 'unsave', {
      category: cardData.category,
      priceLevel: cardData.priceLevel,
      estimatedCost: cardData.estimatedCostPerPerson,
      rating: cardData.rating,
      reviewCount: cardData.reviewCount,
      duration: cardData.durationMinutes,
      timeOfDay: this.getTimeOfDay(),
      dayOfWeek: this.getDayOfWeek(),
      recommendationSource: cardData.source,
    });
  }

  // Track scheduling interactions
  async trackSchedule(experienceId: string, cardData: any, scheduledDate?: string): Promise<void> {
    await this.trackInteraction(experienceId, 'schedule', {
      category: cardData.category,
      priceLevel: cardData.priceLevel,
      estimatedCost: cardData.estimatedCostPerPerson,
      rating: cardData.rating,
      reviewCount: cardData.reviewCount,
      duration: cardData.durationMinutes,
      timeOfDay: this.getTimeOfDay(),
      dayOfWeek: this.getDayOfWeek(),
      scheduledDate,
      recommendationSource: cardData.source,
    });
  }

  // Track sharing interactions
  async trackShare(experienceId: string, cardData: any, shareMethod: string): Promise<void> {
    await this.trackInteraction(experienceId, 'share', {
      category: cardData.category,
      priceLevel: cardData.priceLevel,
      estimatedCost: cardData.estimatedCostPerPerson,
      rating: cardData.rating,
      reviewCount: cardData.reviewCount,
      duration: cardData.durationMinutes,
      timeOfDay: this.getTimeOfDay(),
      dayOfWeek: this.getDayOfWeek(),
      shareMethod,
      recommendationSource: cardData.source,
    });
  }

  // Get user interaction history
  async getInteractionHistory(limit: number = 50): Promise<any[]> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];

      const { data, error } = await supabase
        .from('user_interactions')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) {
        console.error('Error getting interaction history:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('Error getting interaction history:', error);
      return [];
    }
  }

  // Get user preferences learned from interactions
  async getLearnedPreferences(): Promise<any[]> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];

      const { data, error } = await supabase
        .from('user_preference_learning')
        .select('*')
        .eq('user_id', user.id)
        .order('preference_value', { ascending: false });

      if (error) {
        console.error('Error getting learned preferences:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('Error getting learned preferences:', error);
      return [];
    }
  }

  // Get interaction analytics
  async getInteractionAnalytics(days: number = 30): Promise<{
    totalInteractions: number;
    interactionsByType: Record<string, number>;
    topCategories: Array<{ category: string; count: number }>;
    averageTimeSpent: number;
    mostActiveTimeOfDay: string;
  }> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return {
        totalInteractions: 0,
        interactionsByType: {},
        topCategories: [],
        averageTimeSpent: 0,
        mostActiveTimeOfDay: 'unknown',
      };

      const since = new Date();
      since.setDate(since.getDate() - days);

      const { data, error } = await supabase
        .from('user_interactions')
        .select('*')
        .eq('user_id', user.id)
        .gte('created_at', since.toISOString());

      if (error) {
        console.error('Error getting interaction analytics:', error);
        return {
          totalInteractions: 0,
          interactionsByType: {},
          topCategories: [],
          averageTimeSpent: 0,
          mostActiveTimeOfDay: 'unknown',
        };
      }

      const interactions = data || [];
      const totalInteractions = interactions.length;

      // Count interactions by type
      const interactionsByType: Record<string, number> = {};
      interactions.forEach(interaction => {
        interactionsByType[interaction.interaction_type] = 
          (interactionsByType[interaction.interaction_type] || 0) + 1;
      });

      // Get top categories
      const categoryCounts: Record<string, number> = {};
      interactions.forEach(interaction => {
        const category = interaction.interaction_data?.category;
        if (category) {
          categoryCounts[category] = (categoryCounts[category] || 0) + 1;
        }
      });

      const topCategories = Object.entries(categoryCounts)
        .map(([category, count]) => ({ category, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      // Calculate average time spent
      const timeSpentInteractions = interactions.filter(i => i.interaction_data?.timeSpent);
      const averageTimeSpent = timeSpentInteractions.length > 0
        ? timeSpentInteractions.reduce((sum, i) => sum + (i.interaction_data.timeSpent || 0), 0) / timeSpentInteractions.length
        : 0;

      // Get most active time of day
      const timeOfDayCounts: Record<string, number> = {};
      interactions.forEach(interaction => {
        const timeOfDay = interaction.interaction_data?.timeOfDay;
        if (timeOfDay) {
          timeOfDayCounts[timeOfDay] = (timeOfDayCounts[timeOfDay] || 0) + 1;
        }
      });

      const mostActiveTimeOfDay = Object.entries(timeOfDayCounts)
        .sort((a, b) => b[1] - a[1])[0]?.[0] || 'unknown';

      return {
        totalInteractions,
        interactionsByType,
        topCategories,
        averageTimeSpent,
        mostActiveTimeOfDay,
      };
    } catch (error) {
      console.error('Error getting interaction analytics:', error);
      return {
        totalInteractions: 0,
        interactionsByType: {},
        topCategories: [],
        averageTimeSpent: 0,
        mostActiveTimeOfDay: 'unknown',
      };
    }
  }

  private async updateSessionInteractionCount(): Promise<void> {
    if (!this.currentSession) {
      console.log('No active session to update interaction count');
      return;
    }

    try {
      // Store session reference to prevent race conditions
      const session = this.currentSession;
      const sessionId = session.id;
      const newCount = session.interactionCount + 1;
      
      const { error } = await supabase
        .from('user_sessions')
        .update({
          interaction_count: newCount,
        })
        .eq('id', sessionId);

      if (!error && this.currentSession && this.currentSession.id === sessionId) {
        this.currentSession.interactionCount = newCount;
      } else if (error) {
        console.error('Database error updating session interaction count:', error);
      } else if (!this.currentSession) {
        console.log('Session ended while updating interaction count');
      } else if (this.currentSession.id !== sessionId) {
        console.log('Session changed while updating interaction count');
      }
    } catch (error) {
      console.error('Error updating session interaction count:', error);
    }
  }

  private getTimeOfDay(): string {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) return 'morning';
    if (hour >= 12 && hour < 17) return 'afternoon';
    if (hour >= 17 && hour < 21) return 'evening';
    return 'night';
  }

  private getDayOfWeek(): string {
    const day = new Date().getDay();
    return day >= 1 && day <= 5 ? 'weekday' : 'weekend';
  }

  // Get current session
  getCurrentSession(): UserSession | null {
    return this.currentSession;
  }

  // Safely get current session with validation
  private getValidCurrentSession(): UserSession | null {
    if (!this.currentSession) {
      return null;
    }
    
    // Additional validation could be added here if needed
    return this.currentSession;
  }
}

export const userInteractionService = new UserInteractionService();
