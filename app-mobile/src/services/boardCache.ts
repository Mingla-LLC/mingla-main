import AsyncStorage from '@react-native-async-storage/async-storage';

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  expiresAt: number;
}

export class BoardCache {
  private static readonly CACHE_PREFIX = 'board_cache_';
  private static readonly DEFAULT_TTL = 5 * 60 * 1000; // 5 minutes

  /**
   * Get cached data
   */
  static async get<T>(key: string): Promise<T | null> {
    try {
      const cached = await AsyncStorage.getItem(`${this.CACHE_PREFIX}${key}`);
      if (!cached) return null;

      const entry: CacheEntry<T> = JSON.parse(cached);
      
      // Check if expired
      if (Date.now() > entry.expiresAt) {
        await this.remove(key);
        return null;
      }

      return entry.data;
    } catch (error) {
      console.error('Error reading from cache:', error);
      return null;
    }
  }

  /**
   * Set cached data
   */
  static async set<T>(key: string, data: T, ttl: number = this.DEFAULT_TTL): Promise<void> {
    try {
      const entry: CacheEntry<T> = {
        data,
        timestamp: Date.now(),
        expiresAt: Date.now() + ttl,
      };

      await AsyncStorage.setItem(
        `${this.CACHE_PREFIX}${key}`,
        JSON.stringify(entry)
      );
    } catch (error) {
      console.error('Error writing to cache:', error);
    }
  }

  /**
   * Remove cached data
   */
  static async remove(key: string): Promise<void> {
    try {
      await AsyncStorage.removeItem(`${this.CACHE_PREFIX}${key}`);
    } catch (error) {
      console.error('Error removing from cache:', error);
    }
  }

  /**
   * Clear all board cache
   */
  static async clear(): Promise<void> {
    try {
      const keys = await AsyncStorage.getAllKeys();
      const cacheKeys = keys.filter(key => key.startsWith(this.CACHE_PREFIX));
      await AsyncStorage.multiRemove(cacheKeys);
    } catch (error) {
      console.error('Error clearing cache:', error);
    }
  }

  /**
   * Get cache key for session data
   */
  static getSessionKey(sessionId: string): string {
    return `session_${sessionId}`;
  }

  /**
   * Get cache key for saved cards
   */
  static getSavedCardsKey(sessionId: string, page: number = 0): string {
    return `saved_cards_${sessionId}_${page}`;
  }

  /**
   * Get cache key for participants
   */
  static getParticipantsKey(sessionId: string): string {
    return `participants_${sessionId}`;
  }

  /**
   * Get cache key for messages
   */
  static getMessagesKey(sessionId: string, page: number = 0): string {
    return `messages_${sessionId}_${page}`;
  }
}

