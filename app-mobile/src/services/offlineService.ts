/**
 * Offline Service
 * Provides comprehensive offline support for recommendations and app functionality
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { RecommendationCard, RecommendationsRequest } from '../types';
import type { UserPreferences } from './experiencesService';
import { supabase } from './supabase';

import NetInfo, { NetInfoState } from '@react-native-community/netinfo';

export interface OfflineData {
  recommendations: RecommendationCard[];
  userPreferences: UserPreferences | null;
  savedExperiences: any[];
  socialPosts: any[];
  lastSyncTime: string;
  syncStatus: 'synced' | 'pending' | 'failed';
}

export interface OfflineConfig {
  maxOfflineRecommendations: number;
  maxOfflineSavedExperiences: number;
  maxOfflineSocialPosts: number;
  syncInterval: number; // minutes
  retryAttempts: number;
  compressionEnabled: boolean;
}

export interface SyncStatus {
  isOnline: boolean;
  lastSyncTime: string | null;
  pendingSyncs: number;
  syncInProgress: boolean;
  lastError: string | null;
}

class OfflineService {
  private readonly DEFAULT_CONFIG: OfflineConfig = {
    maxOfflineRecommendations: 100,
    maxOfflineSavedExperiences: 200,
    maxOfflineSocialPosts: 50,
    syncInterval: 30, // 30 minutes
    retryAttempts: 3,
    compressionEnabled: true
  };

  private config: OfflineConfig;
  private isOnline: boolean = true;
  private syncTimer: NodeJS.Timeout | null = null;
  private syncInProgress: boolean = false;
  private listeners: Array<(status: SyncStatus) => void> = [];
  private netInfoUnsubscribe?: () => void;

  constructor(config?: Partial<OfflineConfig>) {
    this.config = { ...this.DEFAULT_CONFIG, ...config };
    this.initializeOfflineService();
  }

  /**
   * Initialize offline service
   */
  private async initializeOfflineService(): Promise<void> {
    try {
      // Set up network monitoring
      this.setupNetworkMonitoring();
      
      // Start periodic sync
      this.startPeriodicSync();
      
    } catch (error) {
      console.error('Error initializing offline service:', error);
    }
  }

  /**
   * Set up network monitoring
   */
  private setupNetworkMonitoring(): void {
    this.netInfoUnsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
      const wasOnline = this.isOnline;
      this.isOnline = state.isConnected === true && state.isInternetReachable !== false;

      if (!wasOnline && this.isOnline) {
        this.syncOfflineData();
      }

      this.notifyListeners();
    });
  }

  /**
   * Start periodic sync
   */
  private startPeriodicSync(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
    }

    this.syncTimer = setInterval(() => {
      if (this.isOnline && !this.syncInProgress) {
        this.syncOfflineData();
      }
    }, this.config.syncInterval * 60 * 1000);
  }

  /**
   * Get offline data
   */
  async getOfflineData(): Promise<OfflineData | null> {
    try {
      const data = await AsyncStorage.getItem('offline_data');
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error('Error getting offline data:', error);
      return null;
    }
  }

  /**
   * Save offline data
   */
  async saveOfflineData(data: Partial<OfflineData>): Promise<void> {
    try {
      const existingData = await this.getOfflineData() || {
        recommendations: [],
        userPreferences: null,
        savedExperiences: [],
        socialPosts: [],
        lastSyncTime: new Date().toISOString(),
        syncStatus: 'synced' as const
      };

      const updatedData = {
        ...existingData,
        ...data,
        lastSyncTime: new Date().toISOString()
      };

      await AsyncStorage.setItem('offline_data', JSON.stringify(updatedData));
    } catch (error) {
      console.error('Error saving offline data:', error);
    }
  }

  /**
   * Cache recommendations for offline use
   */
  async cacheRecommendations(recommendations: RecommendationCard[]): Promise<void> {
    try {
      const existingData = await this.getOfflineData();
      const currentRecommendations = existingData?.recommendations || [];
      
      // Merge with existing recommendations, avoiding duplicates
      const mergedRecommendations = [...currentRecommendations];
      recommendations.forEach(rec => {
        if (!mergedRecommendations.find(existing => existing.id === rec.id)) {
          mergedRecommendations.push(rec);
        }
      });

      // Limit to max offline recommendations
      const limitedRecommendations = mergedRecommendations.slice(0, this.config.maxOfflineRecommendations);

      await this.saveOfflineData({
        recommendations: limitedRecommendations,
        syncStatus: 'synced'
      });

    } catch (error) {
      console.error('Error caching recommendations:', error);
    }
  }

  /**
   * Get offline recommendations
   */
  async getOfflineRecommendations(
    request: RecommendationsRequest,
    limit: number = 20
  ): Promise<RecommendationCard[]> {
    try {
      const offlineData = await this.getOfflineData();
      if (!offlineData?.recommendations) {
        return [];
      }

      // Filter recommendations based on request criteria
      let filteredRecommendations = offlineData.recommendations;

      // Filter by categories
      if (request.categories && request.categories.length > 0) {
        filteredRecommendations = filteredRecommendations.filter(rec =>
          request.categories.includes(rec.category)
        );
      }

      // Filter by price tiers (budget)
      if (request.priceTiers && request.priceTiers.length > 0) {
        filteredRecommendations = filteredRecommendations.filter(rec => {
          return rec.priceTier ? (request.priceTiers as string[]).includes(rec.priceTier) : true;
        });
      }

      // Filter by location (if available)
      if (request.origin) {
        filteredRecommendations = filteredRecommendations.filter(rec => {
          if (!rec.location) return true;

          const distance = this.calculateDistance(
            request.origin,
            rec.location
          );
          
          const maxMinutes = request.travel?.constraint?.maxMinutes || 30;
          const speedKmh = ({ WALKING: 4.5, DRIVING: 35, TRANSIT: 25 } as Record<string, number>)[request.travel?.mode || 'WALKING'] || 4.5;
          const maxDistanceKm = (maxMinutes / 60) * speedKmh * 1.3;
          return distance <= maxDistanceKm;
        });
      }

      // Sort by rating and return limited results
      return filteredRecommendations
        .sort((a, b) => (b.rating || 0) - (a.rating || 0))
        .slice(0, limit);
    } catch (error) {
      console.error('Error getting offline recommendations:', error);
      return [];
    }
  }

  /**
   * Cache user preferences
   */
  async cacheUserPreferences(preferences: UserPreferences): Promise<void> {
    try {
      await this.saveOfflineData({
        userPreferences: preferences,
        syncStatus: 'synced'
      });
    } catch (error) {
      console.error('Error caching user preferences:', error);
    }
  }

  /**
   * Get offline user preferences
   */
  async getOfflineUserPreferences(): Promise<UserPreferences | null> {
    try {
      const offlineData = await this.getOfflineData();
      return offlineData?.userPreferences || null;
    } catch (error) {
      console.error('Error getting offline user preferences:', error);
      return null;
    }
  }

  /**
   * Cache saved experiences
   */
  async cacheSavedExperiences(experiences: any[]): Promise<void> {
    try {
      const existingData = await this.getOfflineData();
      const currentExperiences = existingData?.savedExperiences || [];
      
      // Merge with existing experiences
      const mergedExperiences = [...currentExperiences];
      experiences.forEach(exp => {
        if (!mergedExperiences.find(existing => existing.id === exp.id)) {
          mergedExperiences.push(exp);
        }
      });

      // Limit to max offline saved experiences
      const limitedExperiences = mergedExperiences.slice(0, this.config.maxOfflineSavedExperiences);

      await this.saveOfflineData({
        savedExperiences: limitedExperiences,
        syncStatus: 'synced'
      });

    } catch (error) {
      console.error('Error caching saved experiences:', error);
    }
  }

  /**
   * Get offline saved experiences
   */
  async getOfflineSavedExperiences(): Promise<any[]> {
    try {
      const offlineData = await this.getOfflineData();
      return offlineData?.savedExperiences || [];
    } catch (error) {
      console.error('Error getting offline saved experiences:', error);
      return [];
    }
  }

  /**
   * Queue action for sync when online
   */
  async queueActionForSync(action: {
    type: string;
    data: any;
    timestamp: string;
  }): Promise<void> {
    try {
      const queue = await this.getPendingActions();
      queue.push(action);
      
      // Limit queue size
      if (queue.length > 100) {
        queue.splice(0, queue.length - 100);
      }
      
      await AsyncStorage.setItem('pending_actions', JSON.stringify(queue));
    } catch (error) {
      console.error('Error queueing action for sync:', error);
    }
  }

  /**
   * Get pending actions
   */
  async getPendingActions(): Promise<any[]> {
    try {
      const data = await AsyncStorage.getItem('pending_actions');
      return data ? JSON.parse(data) : [];
    } catch (error) {
      console.error('Error getting pending actions:', error);
      return [];
    }
  }

  /**
   * Clear pending actions
   */
  async clearPendingActions(): Promise<void> {
    try {
      await AsyncStorage.removeItem('pending_actions');
    } catch (error) {
      console.error('Error clearing pending actions:', error);
    }
  }

  /**
   * Sync offline data with server
   */
  async syncOfflineData(): Promise<boolean> {
    if (!this.isOnline || this.syncInProgress) {
      return false;
    }

    this.syncInProgress = true;
    this.notifyListeners();

    try {
      
      // Sync pending actions
      await this.syncPendingActions();
      
      // Update sync status
      await this.saveOfflineData({
        syncStatus: 'synced'
      });

      return true;
    } catch (error) {
      console.error('Error syncing offline data:', error);
      await this.saveOfflineData({
        syncStatus: 'failed'
      });
      return false;
    } finally {
      this.syncInProgress = false;
      this.notifyListeners();
    }
  }

  /**
   * Sync pending actions
   */
  private async syncPendingActions(): Promise<void> {
    try {
      const pendingActions = await this.getPendingActions();
      
      for (const action of pendingActions) {
        try {
          await this.executeAction(action);
        } catch (error) {
          console.error(`Error executing action ${action.type}:`, error);
          // Continue with other actions
        }
      }
      
      // Clear successfully synced actions
      await this.clearPendingActions();
    } catch (error) {
      console.error('Error syncing pending actions:', error);
    }
  }

  /**
   * Execute a queued action
   */
  private async executeAction(action: any): Promise<void> {
    switch (action.type) {
      case 'save_experience':
        await supabase
          .from('saved_experiences')
          .insert([action.data]);
        break;
      case 'like_recommendation':
        await supabase
          .from('user_interactions')
          .insert([action.data]);
        break;
      case 'create_social_post':
        await supabase
          .from('social_posts')
          .insert([action.data]);
        break;
      case 'share_recommendation':
        await supabase
          .from('share_history')
          .insert([action.data]);
        break;
      default:
        console.warn(`Unknown action type: ${action.type}`);
    }
  }

  /**
   * Get sync status
   */
  getSyncStatus(): SyncStatus {
    return {
      isOnline: this.isOnline,
      lastSyncTime: null, // Will be updated from offline data
      pendingSyncs: 0, // Will be updated from pending actions
      syncInProgress: this.syncInProgress,
      lastError: null
    };
  }

  /**
   * Add sync status listener
   */
  addSyncStatusListener(listener: (status: SyncStatus) => void): void {
    this.listeners.push(listener);
  }

  /**
   * Remove sync status listener
   */
  removeSyncStatusListener(listener: (status: SyncStatus) => void): void {
    this.listeners = this.listeners.filter(l => l !== listener);
  }

  /**
   * Notify listeners of sync status changes
   */
  private notifyListeners(): void {
    const status = this.getSyncStatus();
    this.listeners.forEach(listener => listener(status));
  }

  /**
   * Check if app is online
   */
  isAppOnline(): boolean {
    return this.isOnline;
  }

  /**
   * Force sync
   */
  async forceSync(): Promise<boolean> {
    if (!this.isOnline) {
      return false;
    }
    
    return await this.syncOfflineData();
  }

  /**
   * Clear all offline data
   */
  async clearOfflineData(): Promise<void> {
    try {
      await AsyncStorage.removeItem('offline_data');
      await AsyncStorage.removeItem('pending_actions');
    } catch (error) {
      console.error('Error clearing offline data:', error);
    }
  }

  /**
   * Get offline data size
   */
  async getOfflineDataSize(): Promise<{
    recommendations: number;
    savedExperiences: number;
    socialPosts: number;
    pendingActions: number;
    totalSize: string;
  }> {
    try {
      const offlineData = await this.getOfflineData();
      const pendingActions = await this.getPendingActions();
      
      const recommendations = offlineData?.recommendations?.length || 0;
      const savedExperiences = offlineData?.savedExperiences?.length || 0;
      const socialPosts = offlineData?.socialPosts?.length || 0;
      const pendingActionsCount = pendingActions.length;
      
      // Estimate total size
      const totalSizeBytes = JSON.stringify(offlineData).length + JSON.stringify(pendingActions).length;
      const totalSize = this.formatBytes(totalSizeBytes);
      
      return {
        recommendations,
        savedExperiences,
        socialPosts,
        pendingActions: pendingActionsCount,
        totalSize
      };
    } catch (error) {
      console.error('Error getting offline data size:', error);
      return {
        recommendations: 0,
        savedExperiences: 0,
        socialPosts: 0,
        pendingActions: 0,
        totalSize: '0 B'
      };
    }
  }

  /**
   * Private helper methods
   */
  private calculateDistance(
    point1: { lat: number; lng: number },
    point2: { lat: number; lng: number }
  ): number {
    const R = 6371e3; // Earth's radius in meters
    const φ1 = point1.lat * Math.PI / 180;
    const φ2 = point2.lat * Math.PI / 180;
    const Δφ = (point2.lat - point1.lat) * Math.PI / 180;
    const Δλ = (point2.lng - point1.lng) * Math.PI / 180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    return R * c;
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  }

  /**
   * Cleanup on service destruction
   */
  destroy(): void {
    this.netInfoUnsubscribe?.();
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
    this.listeners = [];
  }
}

export const offlineService = new OfflineService();
