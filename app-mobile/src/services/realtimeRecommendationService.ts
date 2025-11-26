/**
 * Real-time Recommendation Update Service
 * Provides live updates to recommendations based on user behavior and external factors
 */

import { supabase } from './supabase';
import { RecommendationCard } from '../types';

export interface RealtimeUpdateTrigger {
  type: 'location_change' | 'time_change' | 'preference_update' | 'interaction_pattern' | 'external_event';
  data: any;
  timestamp: string;
}

export interface RealtimeRecommendationUpdate {
  id: string;
  userId: string;
  trigger: RealtimeUpdateTrigger;
  updatedCards: RecommendationCard[];
  removedCards: string[];
  addedCards: RecommendationCard[];
  reason: string;
  confidence: number;
  createdAt: string;
}

export interface RealtimeConfig {
  enableLocationUpdates: boolean;
  enableTimeUpdates: boolean;
  enablePreferenceUpdates: boolean;
  enableInteractionUpdates: boolean;
  locationThreshold: number; // meters
  timeThreshold: number; // minutes
  updateCooldown: number; // seconds
}

class RealtimeRecommendationService {
  private readonly DEFAULT_CONFIG: RealtimeConfig = {
    enableLocationUpdates: true,
    enableTimeUpdates: true,
    enablePreferenceUpdates: true,
    enableInteractionUpdates: true,
    locationThreshold: 1000, // 1km
    timeThreshold: 30, // 30 minutes
    updateCooldown: 60 // 1 minute
  };

  private userConfigs: Map<string, RealtimeConfig> = new Map();
  private lastUpdateTimes: Map<string, number> = new Map();
  private locationSubscriptions: Map<string, any> = new Map();
  private timeSubscriptions: Map<string, any> = new Map();
  private interactionSubscriptions: Map<string, any> = new Map();

  /**
   * Initialize real-time updates for a user
   */
  async initializeRealtimeUpdates(userId: string, config?: Partial<RealtimeConfig>): Promise<void> {
    try {
      const userConfig = { ...this.DEFAULT_CONFIG, ...config };
      this.userConfigs.set(userId, userConfig);


      // Set up location-based updates
      if (userConfig.enableLocationUpdates) {
        await this.setupLocationUpdates(userId);
      }

      // Set up time-based updates
      if (userConfig.enableTimeUpdates) {
        await this.setupTimeUpdates(userId);
      }

      // Set up interaction-based updates
      if (userConfig.enableInteractionUpdates) {
        await this.setupInteractionUpdates(userId);
      }

    } catch (error) {
      console.error('Error initializing real-time updates:', error);
    }
  }

  /**
   * Stop real-time updates for a user
   */
  async stopRealtimeUpdates(userId: string): Promise<void> {
    try {
      // Remove location subscription
      const locationSub = this.locationSubscriptions.get(userId);
      if (locationSub) {
        await supabase.removeChannel(locationSub);
        this.locationSubscriptions.delete(userId);
      }

      // Remove time subscription (this is a setInterval, not a channel)
      const timeSub = this.timeSubscriptions.get(userId);
      if (timeSub) {
        clearInterval(timeSub);
        this.timeSubscriptions.delete(userId);
      }

      // Remove interaction subscription
      const interactionSub = this.interactionSubscriptions.get(userId);
      if (interactionSub) {
        await supabase.removeChannel(interactionSub);
        this.interactionSubscriptions.delete(userId);
      }

      // Clean up configs and timestamps
      this.userConfigs.delete(userId);
      this.lastUpdateTimes.delete(userId);

    } catch (error) {
      console.error('Error stopping real-time updates:', error);
    }
  }

  /**
   * Check if recommendations should be updated based on triggers
   */
  async shouldUpdateRecommendations(
    userId: string,
    trigger: RealtimeUpdateTrigger
  ): Promise<boolean> {
    try {
      const config = this.userConfigs.get(userId);
      if (!config) {
        return false;
      }

      // Check cooldown period
      const lastUpdate = this.lastUpdateTimes.get(userId) || 0;
      const now = Date.now();
      if (now - lastUpdate < config.updateCooldown * 1000) {
        return false;
      }

      // Check trigger-specific conditions
      switch (trigger.type) {
        case 'location_change':
          return config.enableLocationUpdates && this.checkLocationThreshold(trigger.data, config);
        case 'time_change':
          return config.enableTimeUpdates && this.checkTimeThreshold(trigger.data, config);
        case 'preference_update':
          return config.enablePreferenceUpdates;
        case 'interaction_pattern':
          return config.enableInteractionUpdates && this.checkInteractionPattern(trigger.data);
        case 'external_event':
          return true; // Always update for external events
        default:
          return false;
      }
    } catch (error) {
      console.error('Error checking update conditions:', error);
      return false;
    }
  }

  /**
   * Generate real-time recommendation updates
   */
  async generateRealtimeUpdate(
    userId: string,
    trigger: RealtimeUpdateTrigger,
    currentRecommendations: RecommendationCard[]
  ): Promise<RealtimeRecommendationUpdate | null> {
    try {
      const shouldUpdate = await this.shouldUpdateRecommendations(userId, trigger);
      if (!shouldUpdate) {
        return null;
      }


      // Get updated recommendations based on trigger
      const updatedRecommendations = await this.getUpdatedRecommendations(userId, trigger);
      
      // Compare with current recommendations
      const comparison = this.compareRecommendations(currentRecommendations, updatedRecommendations);
      
      if (comparison.hasChanges) {
        const update: RealtimeRecommendationUpdate = {
          id: `update_${Date.now()}_${userId}`,
          userId,
          trigger,
          updatedCards: comparison.updatedCards,
          removedCards: comparison.removedCards,
          addedCards: comparison.addedCards,
          reason: this.generateUpdateReason(trigger),
          confidence: this.calculateUpdateConfidence(trigger, comparison),
          createdAt: new Date().toISOString()
        };

        // Update last update time
        this.lastUpdateTimes.set(userId, Date.now());

        // Store the update
        await this.storeRealtimeUpdate(update);

        return update;
      }

      return null;
    } catch (error) {
      console.error('Error generating real-time update:', error);
      return null;
    }
  }

  /**
   * Set up location-based updates
   */
  private async setupLocationUpdates(userId: string): Promise<void> {
    try {
      const channel = supabase
        .channel(`location_updates_${userId}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'user_location_history',
            filter: `user_id=eq.${userId}`
          },
          async (payload) => {
            
            const trigger: RealtimeUpdateTrigger = {
              type: 'location_change',
              data: payload.new,
              timestamp: new Date().toISOString()
            };

            // Emit location change event
            this.emitUpdateTrigger(userId, trigger);
          }
        )
        .subscribe();

      this.locationSubscriptions.set(userId, channel);
    } catch (error) {
      console.error('Error setting up location updates:', error);
    }
  }

  /**
   * Set up time-based updates
   */
  private async setupTimeUpdates(userId: string): Promise<void> {
    try {
      // Set up periodic time checks
      const interval = setInterval(async () => {
        const now = new Date();
        const hour = now.getHours();
        const dayOfWeek = now.getDay();

        // Check if we've crossed significant time boundaries
        const trigger: RealtimeUpdateTrigger = {
          type: 'time_change',
          data: { hour, dayOfWeek, timestamp: now.toISOString() },
          timestamp: now.toISOString()
        };

        this.emitUpdateTrigger(userId, trigger);
      }, 30 * 60 * 1000); // Check every 30 minutes

      this.timeSubscriptions.set(userId, interval);
    } catch (error) {
      console.error('Error setting up time updates:', error);
    }
  }

  /**
   * Set up interaction-based updates
   */
  private async setupInteractionUpdates(userId: string): Promise<void> {
    try {
      const channel = supabase
        .channel(`interaction_updates_${userId}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'user_interactions',
            filter: `user_id=eq.${userId}`
          },
          async (payload) => {
            
            // Analyze interaction pattern
            const pattern = await this.analyzeInteractionPattern(userId, payload.new);
            
            if (pattern.shouldUpdate) {
              const trigger: RealtimeUpdateTrigger = {
                type: 'interaction_pattern',
                data: { interaction: payload.new, pattern },
                timestamp: new Date().toISOString()
              };

              this.emitUpdateTrigger(userId, trigger);
            }
          }
        )
        .subscribe();

      // Store channel reference in the correct map
      this.interactionSubscriptions.set(userId, channel);
    } catch (error) {
      console.error('Error setting up interaction updates:', error);
    }
  }

  /**
   * Get updated recommendations based on trigger
   */
  private async getUpdatedRecommendations(
    userId: string,
    trigger: RealtimeUpdateTrigger
  ): Promise<RecommendationCard[]> {
    try {
      // This would call the appropriate recommendation function
      // with updated parameters based on the trigger
      
      switch (trigger.type) {
        case 'location_change':
          return await this.getLocationBasedRecommendations(userId, trigger.data);
        case 'time_change':
          return await this.getTimeBasedRecommendations(userId, trigger.data);
        case 'preference_update':
          return await this.getPreferenceBasedRecommendations(userId, trigger.data);
        case 'interaction_pattern':
          return await this.getInteractionBasedRecommendations(userId, trigger.data);
        default:
          return [];
      }
    } catch (error) {
      console.error('Error getting updated recommendations:', error);
      return [];
    }
  }

  /**
   * Compare current and updated recommendations
   */
  private compareRecommendations(
    current: RecommendationCard[],
    updated: RecommendationCard[]
  ): {
    hasChanges: boolean;
    updatedCards: RecommendationCard[];
    removedCards: string[];
    addedCards: RecommendationCard[];
  } {
    const currentIds = new Set(current.map(c => c.id));
    const updatedIds = new Set(updated.map(c => c.id));

    const removedCards = current.filter(c => !updatedIds.has(c.id)).map(c => c.id);
    const addedCards = updated.filter(c => !currentIds.has(c.id));
    
    // Find updated cards (same ID but different content)
    const updatedCards = updated.filter(updatedCard => {
      const currentCard = current.find(c => c.id === updatedCard.id);
      return currentCard && this.hasCardChanged(currentCard, updatedCard);
    });

    const hasChanges = removedCards.length > 0 || addedCards.length > 0 || updatedCards.length > 0;

    return {
      hasChanges,
      updatedCards,
      removedCards,
      addedCards
    };
  }

  /**
   * Check if a card has changed
   */
  private hasCardChanged(current: RecommendationCard, updated: RecommendationCard): boolean {
    // Compare key fields that might change in real-time
    return (
      current.rating !== updated.rating ||
      current.reviewCount !== updated.reviewCount ||
      current.route?.etaMinutes !== updated.route?.etaMinutes ||
      current.route?.distanceText !== updated.route?.distanceText ||
      current.openingHours?.isOpen !== updated.openingHours?.isOpen
    );
  }

  /**
   * Generate human-readable update reason
   */
  private generateUpdateReason(trigger: RealtimeUpdateTrigger): string {
    switch (trigger.type) {
      case 'location_change':
        return 'Updated based on your new location';
      case 'time_change':
        return 'Updated for current time and day';
      case 'preference_update':
        return 'Updated based on your preference changes';
      case 'interaction_pattern':
        return 'Updated based on your recent activity';
      case 'external_event':
        return 'Updated due to external changes';
      default:
        return 'Updated recommendations';
    }
  }

  /**
   * Calculate confidence score for the update
   */
  private calculateUpdateConfidence(
    trigger: RealtimeUpdateTrigger,
    comparison: any
  ): number {
    let confidence = 0.5; // Base confidence

    // Adjust based on trigger type
    switch (trigger.type) {
      case 'location_change':
        confidence = 0.8; // High confidence for location changes
        break;
      case 'time_change':
        confidence = 0.6; // Medium confidence for time changes
        break;
      case 'preference_update':
        confidence = 0.9; // Very high confidence for preference changes
        break;
      case 'interaction_pattern':
        confidence = 0.7; // High confidence for interaction patterns
        break;
      case 'external_event':
        confidence = 0.8; // High confidence for external events
        break;
    }

    // Adjust based on number of changes
    const totalChanges = comparison.removedCards.length + comparison.addedCards.length + comparison.updatedCards.length;
    if (totalChanges > 5) {
      confidence *= 0.9; // Slightly lower confidence for many changes
    }

    return Math.min(0.95, Math.max(0.1, confidence));
  }

  /**
   * Store real-time update
   */
  private async storeRealtimeUpdate(update: RealtimeRecommendationUpdate): Promise<void> {
    try {
      const { error } = await supabase
        .from('realtime_recommendation_updates')
        .insert([update]);

      if (error) {
        console.error('Error storing real-time update:', error);
      }
    } catch (error) {
      console.error('Error in storeRealtimeUpdate:', error);
    }
  }

  /**
   * Emit update trigger event
   */
  private emitUpdateTrigger(userId: string, trigger: RealtimeUpdateTrigger): void {
    // This would emit an event that the UI can listen to
    // For now, we'll just log it
  }

  /**
   * Check location threshold
   */
  private checkLocationThreshold(locationData: any, config: RealtimeConfig): boolean {
    // Implement location threshold logic
    return true; // Simplified for now
  }

  /**
   * Check time threshold
   */
  private checkTimeThreshold(timeData: any, config: RealtimeConfig): boolean {
    // Implement time threshold logic
    return true; // Simplified for now
  }

  /**
   * Check interaction pattern
   */
  private checkInteractionPattern(interactionData: any): boolean {
    // Implement interaction pattern logic
    return true; // Simplified for now
  }

  /**
   * Analyze interaction pattern
   */
  private async analyzeInteractionPattern(userId: string, interaction: any): Promise<any> {
    // Implement interaction pattern analysis
    return { shouldUpdate: false }; // Simplified for now
  }

  /**
   * Get location-based recommendations
   */
  private async getLocationBasedRecommendations(userId: string, locationData: any): Promise<RecommendationCard[]> {
    // Implement location-based recommendation logic
    return []; // Simplified for now
  }

  /**
   * Get time-based recommendations
   */
  private async getTimeBasedRecommendations(userId: string, timeData: any): Promise<RecommendationCard[]> {
    // Implement time-based recommendation logic
    return []; // Simplified for now
  }

  /**
   * Get preference-based recommendations
   */
  private async getPreferenceBasedRecommendations(userId: string, preferenceData: any): Promise<RecommendationCard[]> {
    // Implement preference-based recommendation logic
    return []; // Simplified for now
  }

  /**
   * Get interaction-based recommendations
   */
  private async getInteractionBasedRecommendations(userId: string, interactionData: any): Promise<RecommendationCard[]> {
    // Implement interaction-based recommendation logic
    return []; // Simplified for now
  }
}

export const realtimeRecommendationService = new RealtimeRecommendationService();
