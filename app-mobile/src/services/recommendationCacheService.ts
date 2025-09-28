/**
 * Recommendation Caching and Optimization Service
 * Provides intelligent caching, prefetching, and performance optimization for recommendations
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { RecommendationCard, RecommendationsRequest } from '../types';
import { formatDecimal } from '../utils/numberFormatter';

export interface CacheEntry<T> {
  data: T;
  timestamp: number;
  expiresAt: number;
  accessCount: number;
  lastAccessed: number;
  metadata: {
    userId?: string;
    algorithm?: string;
    location?: { lat: number; lng: number };
    preferences?: any;
  };
}

export interface CacheStats {
  totalEntries: number;
  hitRate: number;
  missRate: number;
  averageAccessTime: number;
  memoryUsage: number;
  lastCleanup: number;
}

export interface PrefetchStrategy {
  enabled: boolean;
  maxPrefetchDistance: number; // km
  prefetchTimeWindow: number; // minutes
  userMovementThreshold: number; // meters
  timeBasedPrefetch: boolean;
  locationBasedPrefetch: boolean;
  preferenceBasedPrefetch: boolean;
}

export interface CacheConfig {
  maxCacheSize: number; // MB
  defaultTTL: number; // seconds
  cleanupInterval: number; // seconds
  prefetchStrategy: PrefetchStrategy;
  compressionEnabled: boolean;
  encryptionEnabled: boolean;
}

class RecommendationCacheService {
  private readonly DEFAULT_CONFIG: CacheConfig = {
    maxCacheSize: 50, // 50MB
    defaultTTL: 30 * 60, // 30 minutes
    cleanupInterval: 5 * 60, // 5 minutes
    prefetchStrategy: {
      enabled: true,
      maxPrefetchDistance: 5, // 5km
      prefetchTimeWindow: 60, // 1 hour
      userMovementThreshold: 500, // 500m
      timeBasedPrefetch: true,
      locationBasedPrefetch: true,
      preferenceBasedPrefetch: true
    },
    compressionEnabled: true,
    encryptionEnabled: false
  };

  private cache: Map<string, CacheEntry<any>> = new Map();
  private config: CacheConfig;
  private stats: CacheStats = {
    totalEntries: 0,
    hitRate: 0,
    missRate: 0,
    averageAccessTime: 0,
    memoryUsage: 0,
    lastCleanup: Date.now()
  };
  private cleanupTimer: NodeJS.Timeout | null = null;
  private prefetchQueue: Set<string> = new Set();
  private isPrefetching = false;

  constructor(config?: Partial<CacheConfig>) {
    this.config = { ...this.DEFAULT_CONFIG, ...config };
    this.initializeCache();
  }

  /**
   * Initialize cache and start cleanup timer
   */
  private async initializeCache(): Promise<void> {
    try {
      // Load cache from AsyncStorage
      await this.loadCacheFromStorage();
      
      // Start cleanup timer
      this.startCleanupTimer();
      
      console.log('✅ Recommendation cache initialized');
    } catch (error) {
      console.error('Error initializing cache:', error);
    }
  }

  /**
   * Get recommendations from cache or return null if not found/expired
   */
  async getRecommendations(
    cacheKey: string,
    userId?: string
  ): Promise<RecommendationCard[] | null> {
    const startTime = Date.now();
    
    try {
      const entry = this.cache.get(cacheKey);
      
      if (!entry) {
        this.updateStats(false, Date.now() - startTime);
        return null;
      }

      // Check if expired
      if (Date.now() > entry.expiresAt) {
        this.cache.delete(cacheKey);
        this.updateStats(false, Date.now() - startTime);
        return null;
      }

      // Update access statistics
      entry.accessCount++;
      entry.lastAccessed = Date.now();
      
      this.updateStats(true, Date.now() - startTime);
      
      console.log(`📦 Cache hit for key: ${cacheKey} (${entry.accessCount} accesses)`);
      return entry.data;
    } catch (error) {
      console.error('Error getting from cache:', error);
      this.updateStats(false, Date.now() - startTime);
      return null;
    }
  }

  /**
   * Store recommendations in cache
   */
  async setRecommendations(
    cacheKey: string,
    recommendations: RecommendationCard[],
    ttl?: number,
    metadata?: any
  ): Promise<void> {
    try {
      const now = Date.now();
      const expiresAt = now + (ttl || this.config.defaultTTL) * 1000;

      const entry: CacheEntry<RecommendationCard[]> = {
        data: recommendations,
        timestamp: now,
        expiresAt,
        accessCount: 0,
        lastAccessed: now,
        metadata: metadata || {}
      };

      this.cache.set(cacheKey, entry);
      
      // Check cache size and cleanup if necessary
      await this.checkCacheSize();
      
      // Save to AsyncStorage
      await this.saveCacheToStorage();
      
      console.log(`💾 Cached ${recommendations.length} recommendations with key: ${cacheKey}`);
    } catch (error) {
      console.error('Error setting cache:', error);
    }
  }

  /**
   * Generate cache key from request parameters
   */
  generateCacheKey(
    request: RecommendationsRequest,
    userId?: string,
    algorithm?: string
  ): string {
    const keyComponents = [
      'rec',
      userId || 'anonymous',
      algorithm || 'default',
      formatDecimal(request.origin.lat, 4),
      formatDecimal(request.origin.lng, 4),
      request.categories?.sort().join(',') || '',
      request.budget ? `${request.budget.min},${request.budget.max}` : '0,0',
      request.timeWindow?.kind || 'any',
      request.travel?.mode || 'WALKING',
      request.units || 'metric'
    ];

    return keyComponents.join('|');
  }

  /**
   * Prefetch recommendations based on user behavior and location
   */
  async prefetchRecommendations(
    userId: string,
    currentLocation: { lat: number; lng: number },
    preferences: any,
    algorithm: string = 'enhanced'
  ): Promise<void> {
    if (!this.config.prefetchStrategy.enabled || this.isPrefetching) {
      return;
    }

    this.isPrefetching = true;
    
    try {
      console.log('🔄 Starting recommendation prefetch...');
      
      const prefetchTasks: Promise<void>[] = [];

      // Location-based prefetching
      if (this.config.prefetchStrategy.locationBasedPrefetch) {
        prefetchTasks.push(
          this.prefetchByLocation(userId, currentLocation, preferences, algorithm)
        );
      }

      // Time-based prefetching
      if (this.config.prefetchStrategy.timeBasedPrefetch) {
        prefetchTasks.push(
          this.prefetchByTime(userId, currentLocation, preferences, algorithm)
        );
      }

      // Preference-based prefetching
      if (this.config.prefetchStrategy.preferenceBasedPrefetch) {
        prefetchTasks.push(
          this.prefetchByPreferences(userId, currentLocation, preferences, algorithm)
        );
      }

      await Promise.allSettled(prefetchTasks);
      
      console.log('✅ Prefetch completed');
    } catch (error) {
      console.error('Error during prefetch:', error);
    } finally {
      this.isPrefetching = false;
    }
  }

  /**
   * Invalidate cache entries based on criteria
   */
  async invalidateCache(
    criteria: {
      userId?: string;
      algorithm?: string;
      location?: { lat: number; lng: number; radius?: number };
      categories?: string[];
      maxAge?: number; // seconds
    }
  ): Promise<number> {
    let invalidatedCount = 0;
    const now = Date.now();

    for (const [key, entry] of this.cache.entries()) {
      let shouldInvalidate = false;

      // Check user ID
      if (criteria.userId && entry.metadata.userId !== criteria.userId) {
        continue;
      }

      // Check algorithm
      if (criteria.algorithm && entry.metadata.algorithm !== criteria.algorithm) {
        continue;
      }

      // Check location
      if (criteria.location && entry.metadata.location) {
        const distance = this.calculateDistance(
          entry.metadata.location,
          criteria.location
        );
        if (distance > (criteria.location.radius || 1000)) {
          continue;
        }
      }

      // Check categories
      if (criteria.categories && entry.metadata.preferences?.categories) {
        const hasMatchingCategory = criteria.categories.some(cat =>
          entry.metadata.preferences.categories.includes(cat)
        );
        if (!hasMatchingCategory) {
          continue;
        }
      }

      // Check age
      if (criteria.maxAge && (now - entry.timestamp) > criteria.maxAge * 1000) {
        shouldInvalidate = true;
      }

      if (shouldInvalidate) {
        this.cache.delete(key);
        invalidatedCount++;
      }
    }

    if (invalidatedCount > 0) {
      await this.saveCacheToStorage();
      console.log(`🗑️ Invalidated ${invalidatedCount} cache entries`);
    }

    return invalidatedCount;
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): CacheStats {
    return { ...this.stats };
  }

  /**
   * Clear all cache entries
   */
  async clearCache(): Promise<void> {
    try {
      this.cache.clear();
      await AsyncStorage.removeItem('recommendation_cache');
      this.stats = {
        totalEntries: 0,
        hitRate: 0,
        missRate: 0,
        averageAccessTime: 0,
        memoryUsage: 0,
        lastCleanup: Date.now()
      };
      console.log('🧹 Cache cleared');
    } catch (error) {
      console.error('Error clearing cache:', error);
    }
  }

  /**
   * Optimize cache by removing least used entries
   */
  async optimizeCache(): Promise<void> {
    try {
      const entries = Array.from(this.cache.entries());
      
      // Sort by access count and last accessed time
      entries.sort((a, b) => {
        const scoreA = a[1].accessCount * 0.7 + (Date.now() - a[1].lastAccessed) * 0.3;
        const scoreB = b[1].accessCount * 0.7 + (Date.now() - b[1].lastAccessed) * 0.3;
        return scoreA - scoreB;
      });

      // Remove bottom 20% of entries
      const removeCount = Math.floor(entries.length * 0.2);
      for (let i = 0; i < removeCount; i++) {
        this.cache.delete(entries[i][0]);
      }

      await this.saveCacheToStorage();
      console.log(`⚡ Cache optimized: removed ${removeCount} entries`);
    } catch (error) {
      console.error('Error optimizing cache:', error);
    }
  }

  /**
   * Private helper methods
   */
  private async loadCacheFromStorage(): Promise<void> {
    try {
      const cached = await AsyncStorage.getItem('recommendation_cache');
      if (cached) {
        const data = JSON.parse(cached);
        this.cache = new Map(data);
        this.stats.totalEntries = this.cache.size;
        console.log(`📥 Loaded ${this.cache.size} cache entries from storage`);
      }
    } catch (error) {
      console.error('Error loading cache from storage:', error);
    }
  }

  private async saveCacheToStorage(): Promise<void> {
    try {
      const data = Array.from(this.cache.entries());
      await AsyncStorage.setItem('recommendation_cache', JSON.stringify(data));
    } catch (error) {
      console.error('Error saving cache to storage:', error);
    }
  }

  private startCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }

    this.cleanupTimer = setInterval(async () => {
      await this.cleanupExpiredEntries();
    }, this.config.cleanupInterval * 1000);
  }

  private async cleanupExpiredEntries(): Promise<void> {
    const now = Date.now();
    let removedCount = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        removedCount++;
      }
    }

    if (removedCount > 0) {
      await this.saveCacheToStorage();
      this.stats.lastCleanup = now;
      console.log(`🧹 Cleaned up ${removedCount} expired cache entries`);
    }
  }

  private async checkCacheSize(): Promise<void> {
    const estimatedSize = this.estimateCacheSize();
    const maxSizeBytes = this.config.maxCacheSize * 1024 * 1024;

    if (estimatedSize > maxSizeBytes) {
      await this.optimizeCache();
    }
  }

  private estimateCacheSize(): number {
    let size = 0;
    for (const [key, entry] of this.cache.entries()) {
      size += key.length * 2; // UTF-16 encoding
      size += JSON.stringify(entry).length * 2;
    }
    return size;
  }

  private updateStats(hit: boolean, accessTime: number): void {
    const totalRequests = this.stats.totalEntries;
    
    if (hit) {
      this.stats.hitRate = (this.stats.hitRate * totalRequests + 1) / (totalRequests + 1);
    } else {
      this.stats.missRate = (this.stats.missRate * totalRequests + 1) / (totalRequests + 1);
    }
    
    this.stats.averageAccessTime = (this.stats.averageAccessTime * totalRequests + accessTime) / (totalRequests + 1);
    this.stats.memoryUsage = this.estimateCacheSize();
  }

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

  private async prefetchByLocation(
    userId: string,
    currentLocation: { lat: number; lng: number },
    preferences: any,
    algorithm: string
  ): Promise<void> {
    // Prefetch for nearby locations
    const nearbyLocations = this.generateNearbyLocations(currentLocation);
    
    for (const location of nearbyLocations) {
      const request: RecommendationsRequest = {
        origin: location,
        categories: preferences.categories || [],
        budget: preferences.budget || { min: 0, max: 1000, perPerson: true },
        timeWindow: preferences.timeWindow || { kind: 'Now' },
        travel: preferences.travel || { mode: 'WALKING', constraint: { type: 'TIME', maxMinutes: 30 } },
        units: preferences.units || 'metric'
      };

      const cacheKey = this.generateCacheKey(request, userId, algorithm);
      
      if (!this.cache.has(cacheKey)) {
        this.prefetchQueue.add(cacheKey);
      }
    }
  }

  private async prefetchByTime(
    userId: string,
    currentLocation: { lat: number; lng: number },
    preferences: any,
    algorithm: string
  ): Promise<void> {
    // Prefetch for different time windows
    const timeWindows = ['morning', 'afternoon', 'evening', 'night'];
    
    for (const timeWindow of timeWindows) {
      const request: RecommendationsRequest = {
        origin: currentLocation,
        categories: preferences.categories || [],
        budget: preferences.budget || { min: 0, max: 1000, perPerson: true },
        timeWindow: { kind: timeWindow as any },
        travel: preferences.travel || { mode: 'WALKING', constraint: { type: 'TIME', maxMinutes: 30 } },
        units: preferences.units || 'metric'
      };

      const cacheKey = this.generateCacheKey(request, userId, algorithm);
      
      if (!this.cache.has(cacheKey)) {
        this.prefetchQueue.add(cacheKey);
      }
    }
  }

  private async prefetchByPreferences(
    userId: string,
    currentLocation: { lat: number; lng: number },
    preferences: any,
    algorithm: string
  ): Promise<void> {
    // Prefetch for similar preference combinations
    const similarPreferences = this.generateSimilarPreferences(preferences);
    
    for (const pref of similarPreferences) {
      const request: RecommendationsRequest = {
        origin: currentLocation,
        categories: pref.categories || [],
        budget: pref.budget || { min: 0, max: 1000, perPerson: true },
        timeWindow: pref.timeWindow || { kind: 'Now' },
        travel: preferences.travel || { mode: 'WALKING', constraint: { type: 'TIME', maxMinutes: 30 } },
        units: preferences.units || 'metric'
      };

      const cacheKey = this.generateCacheKey(request, userId, algorithm);
      
      if (!this.cache.has(cacheKey)) {
        this.prefetchQueue.add(cacheKey);
      }
    }
  }

  private generateNearbyLocations(
    center: { lat: number; lng: number }
  ): Array<{ lat: number; lng: number }> {
    const locations = [];
    const radius = 0.01; // ~1km
    
    for (let i = 0; i < 4; i++) {
      const angle = (i * Math.PI) / 2;
      locations.push({
        lat: center.lat + radius * Math.cos(angle),
        lng: center.lng + radius * Math.sin(angle)
      });
    }
    
    return locations;
  }

  private generateSimilarPreferences(preferences: any): any[] {
    const similar = [];
    
    // Generate variations of categories
    if (preferences.categories && preferences.categories.length > 0) {
      for (let i = 0; i < preferences.categories.length; i++) {
        const modified = [...preferences.categories];
        modified.splice(i, 1);
        similar.push({
          ...preferences,
          categories: modified
        });
      }
    }
    
    // Generate variations of budget
    if (preferences.budget) {
      const { min, max } = preferences.budget;
      similar.push({
        ...preferences,
        budget: { min: min * 0.8, max: max * 1.2, perPerson: preferences.budget.perPerson }
      });
    }
    
    return similar;
  }

  /**
   * Cleanup on service destruction
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }
}

export const recommendationCacheService = new RecommendationCacheService();
