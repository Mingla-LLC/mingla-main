/**
 * Enhanced Favorites Service
 * Provides advanced favorites management with categorization and organization
 */

import { supabase } from './supabase';
import { RecommendationCard } from '../types';

export interface FavoriteCollection {
  id: string;
  user_id: string;
  name: string;
  description?: string;
  color: string;
  icon: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
  item_count: number;
}

export interface FavoriteItem {
  id: string;
  collection_id: string;
  recommendation_id: string;
  recommendation_data: RecommendationCard;
  added_at: string;
  notes?: string;
  tags?: string[];
  priority: 'low' | 'medium' | 'high';
  visit_count: number;
  last_visited?: string;
}

export interface FavoritesAnalytics {
  totalFavorites: number;
  totalCollections: number;
  mostFavoritedCategories: Array<{
    category: string;
    count: number;
    percentage: number;
  }>;
  collectionStats: Array<{
    collection: string;
    count: number;
    lastAdded: string;
  }>;
  recentFavorites: FavoriteItem[];
  topLocations: Array<{
    location: string;
    count: number;
  }>;
}

export interface FavoritesFilters {
  collectionId?: string;
  categories?: string[];
  tags?: string[];
  priority?: string[];
  dateRange?: {
    start: string;
    end: string;
  };
  searchQuery?: string;
  limit?: number;
  offset?: number;
}

class EnhancedFavoritesService {
  /**
   * Create a new favorites collection
   */
  async createCollection(
    userId: string,
    name: string,
    description?: string,
    color: string = '#007AFF',
    icon: string = 'heart'
  ): Promise<FavoriteCollection | null> {
    try {
      const collection: Omit<FavoriteCollection, 'id' | 'created_at' | 'updated_at' | 'item_count'> = {
        user_id: userId,
        name,
        description,
        color,
        icon,
        is_default: false
      };

      const { data, error } = await supabase
        .from('favorite_collections')
        .insert(collection)
        .select()
        .single();

      if (error) {
        console.error('Error creating favorites collection:', error);
        return null;
      }

      console.log(`📁 Created favorites collection: ${name}`);
      return { ...data, item_count: 0 };
    } catch (error) {
      console.error('Error in createCollection:', error);
      return null;
    }
  }

  /**
   * Get user's favorites collections
   */
  async getCollections(userId: string): Promise<FavoriteCollection[]> {
    try {
      const { data, error } = await supabase
        .from('favorite_collections')
        .select(`
          *,
          favorite_items(count)
        `)
        .eq('user_id', userId)
        .order('is_default', { ascending: false })
        .order('created_at', { ascending: true });

      if (error) {
        console.error('Error fetching favorites collections:', error);
        return [];
      }

      return (data || []).map(collection => ({
        ...collection,
        item_count: collection.favorite_items?.[0]?.count || 0
      }));
    } catch (error) {
      console.error('Error in getCollections:', error);
      return [];
    }
  }

  /**
   * Add recommendation to favorites
   */
  async addToFavorites(
    userId: string,
    recommendation: RecommendationCard,
    collectionId?: string,
    options?: {
      notes?: string;
      tags?: string[];
      priority?: 'low' | 'medium' | 'high';
    }
  ): Promise<boolean> {
    try {
      // Get or create default collection if no collection specified
      let targetCollectionId = collectionId;
      if (!targetCollectionId) {
        const collections = await this.getCollections(userId);
        const defaultCollection = collections.find(c => c.is_default);
        
        if (defaultCollection) {
          targetCollectionId = defaultCollection.id;
        } else {
          // Create default collection
          const newCollection = await this.createCollection(userId, 'My Favorites', 'Default favorites collection', '#007AFF', 'heart');
          if (newCollection) {
            targetCollectionId = newCollection.id;
          } else {
            return false;
          }
        }
      }

      // Check if already in favorites
      const existing = await this.getFavoriteItem(userId, recommendation.id, targetCollectionId);
      if (existing) {
        console.log(`⭐ Recommendation already in favorites: ${recommendation.title}`);
        return true;
      }

      const favoriteItem: Omit<FavoriteItem, 'id' | 'added_at' | 'visit_count'> = {
        collection_id: targetCollectionId,
        recommendation_id: recommendation.id,
        recommendation_data: recommendation,
        notes: options?.notes,
        tags: options?.tags || [],
        priority: options?.priority || 'medium',
        last_visited: undefined
      };

      const { error } = await supabase
        .from('favorite_items')
        .insert(favoriteItem);

      if (error) {
        console.error('Error adding to favorites:', error);
        return false;
      }

      console.log(`⭐ Added to favorites: ${recommendation.title}`);
      return true;
    } catch (error) {
      console.error('Error in addToFavorites:', error);
      return false;
    }
  }

  /**
   * Remove recommendation from favorites
   */
  async removeFromFavorites(
    userId: string,
    recommendationId: string,
    collectionId?: string
  ): Promise<boolean> {
    try {
      let query = supabase
        .from('favorite_items')
        .delete()
        .eq('recommendation_id', recommendationId);

      if (collectionId) {
        query = query.eq('collection_id', collectionId);
      } else {
        // Remove from all collections
        const collections = await this.getCollections(userId);
        const collectionIds = collections.map(c => c.id);
        query = query.in('collection_id', collectionIds);
      }

      const { error } = await query;

      if (error) {
        console.error('Error removing from favorites:', error);
        return false;
      }

      console.log(`🗑️ Removed from favorites: ${recommendationId}`);
      return true;
    } catch (error) {
      console.error('Error in removeFromFavorites:', error);
      return false;
    }
  }

  /**
   * Get favorite items with filters
   */
  async getFavoriteItems(
    userId: string,
    filters: FavoritesFilters = {}
  ): Promise<FavoriteItem[]> {
    try {
      let query = supabase
        .from('favorite_items')
        .select(`
          *,
          favorite_collections!inner(user_id, name, color, icon)
        `)
        .eq('favorite_collections.user_id', userId)
        .order('added_at', { ascending: false });

      // Apply filters
      if (filters.collectionId) {
        query = query.eq('collection_id', filters.collectionId);
      }

      if (filters.categories && filters.categories.length > 0) {
        query = query.contains('recommendation_data->category', filters.categories);
      }

      if (filters.tags && filters.tags.length > 0) {
        query = query.overlaps('tags', filters.tags);
      }

      if (filters.priority && filters.priority.length > 0) {
        query = query.in('priority', filters.priority);
      }

      if (filters.dateRange) {
        query = query
          .gte('added_at', filters.dateRange.start)
          .lte('added_at', filters.dateRange.end);
      }

      if (filters.searchQuery) {
        query = query.or(`recommendation_data->title.ilike.%${filters.searchQuery}%,recommendation_data->copy->oneLiner.ilike.%${filters.searchQuery}%,notes.ilike.%${filters.searchQuery}%`);
      }

      if (filters.limit) {
        query = query.limit(filters.limit);
      }

      if (filters.offset) {
        query = query.range(filters.offset, filters.offset + (filters.limit || 50) - 1);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error fetching favorite items:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('Error in getFavoriteItems:', error);
      return [];
    }
  }

  /**
   * Get a specific favorite item
   */
  async getFavoriteItem(
    userId: string,
    recommendationId: string,
    collectionId?: string
  ): Promise<FavoriteItem | null> {
    try {
      let query = supabase
        .from('favorite_items')
        .select(`
          *,
          favorite_collections!inner(user_id)
        `)
        .eq('favorite_collections.user_id', userId)
        .eq('recommendation_id', recommendationId);

      if (collectionId) {
        query = query.eq('collection_id', collectionId);
      }

      const { data, error } = await query.single();

      if (error) {
        if (error.code === 'PGRST116') {
          return null; // Not found
        }
        console.error('Error fetching favorite item:', error);
        return null;
      }

      return data;
    } catch (error) {
      console.error('Error in getFavoriteItem:', error);
      return null;
    }
  }

  /**
   * Update favorite item
   */
  async updateFavoriteItem(
    userId: string,
    itemId: string,
    updates: {
      notes?: string;
      tags?: string[];
      priority?: 'low' | 'medium' | 'high';
      collectionId?: string;
    }
  ): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('favorite_items')
        .update(updates)
        .eq('id', itemId);

      if (error) {
        console.error('Error updating favorite item:', error);
        return false;
      }

      console.log(`✏️ Updated favorite item: ${itemId}`);
      return true;
    } catch (error) {
      console.error('Error in updateFavoriteItem:', error);
      return false;
    }
  }

  /**
   * Record a visit to a favorite item
   */
  async recordVisit(userId: string, recommendationId: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('favorite_items')
        .update({
          visit_count: supabase.raw('visit_count + 1'),
          last_visited: new Date().toISOString()
        })
        .eq('recommendation_id', recommendationId);

      if (error) {
        console.error('Error recording visit:', error);
      }
    } catch (error) {
      console.error('Error in recordVisit:', error);
    }
  }

  /**
   * Get favorites analytics
   */
  async getFavoritesAnalytics(userId: string): Promise<FavoritesAnalytics | null> {
    try {
      const [collections, favoriteItems] = await Promise.all([
        this.getCollections(userId),
        this.getFavoriteItems(userId, { limit: 1000 })
      ]);

      if (favoriteItems.length === 0) {
        return this.getEmptyFavoritesAnalytics();
      }

      // Calculate analytics
      const totalFavorites = favoriteItems.length;
      const totalCollections = collections.length;

      // Category analytics
      const categoryCounts = new Map<string, number>();
      favoriteItems.forEach(item => {
        const category = item.recommendation_data.category;
        categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);
      });

      const mostFavoritedCategories = Array.from(categoryCounts.entries())
        .map(([category, count]) => ({
          category,
          count,
          percentage: (count / totalFavorites) * 100
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      // Collection stats
      const collectionStats = collections.map(collection => ({
        collection: collection.name,
        count: collection.item_count,
        lastAdded: favoriteItems
          .filter(item => item.collection_id === collection.id)
          .sort((a, b) => new Date(b.added_at).getTime() - new Date(a.added_at).getTime())[0]?.added_at || ''
      }));

      // Recent favorites
      const recentFavorites = favoriteItems
        .sort((a, b) => new Date(b.added_at).getTime() - new Date(a.added_at).getTime())
        .slice(0, 10);

      // Top locations
      const locationCounts = new Map<string, number>();
      favoriteItems.forEach(item => {
        const location = item.recommendation_data.location?.address || 'Unknown';
        locationCounts.set(location, (locationCounts.get(location) || 0) + 1);
      });

      const topLocations = Array.from(locationCounts.entries())
        .map(([location, count]) => ({ location, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

      return {
        totalFavorites,
        totalCollections,
        mostFavoritedCategories,
        collectionStats,
        recentFavorites,
        topLocations
      };
    } catch (error) {
      console.error('Error in getFavoritesAnalytics:', error);
      return null;
    }
  }

  /**
   * Search favorites
   */
  async searchFavorites(
    userId: string,
    query: string,
    filters: Omit<FavoritesFilters, 'searchQuery'> = {}
  ): Promise<FavoriteItem[]> {
    return this.getFavoriteItems(userId, {
      ...filters,
      searchQuery: query
    });
  }

  /**
   * Get recommendations similar to favorites
   */
  async getSimilarToFavorites(
    userId: string,
    currentRecommendation: RecommendationCard,
    limit: number = 5
  ): Promise<RecommendationCard[]> {
    try {
      const favoriteItems = await this.getFavoriteItems(userId, { limit: 100 });
      
      if (favoriteItems.length === 0) {
        return [];
      }

      // Find similar recommendations based on category, location, and price
      const similarRecommendations = favoriteItems
        .filter(item => {
          const rec = item.recommendation_data;
          return (
            rec.category === currentRecommendation.category ||
            this.isLocationSimilar(rec.location, currentRecommendation.location) ||
            this.isPriceSimilar(rec.estimatedCostPerPerson, currentRecommendation.estimatedCostPerPerson)
          );
        })
        .map(item => item.recommendation_data)
        .slice(0, limit);

      return similarRecommendations;
    } catch (error) {
      console.error('Error in getSimilarToFavorites:', error);
      return [];
    }
  }

  /**
   * Delete a collection
   */
  async deleteCollection(userId: string, collectionId: string): Promise<boolean> {
    try {
      // Don't allow deleting default collection
      const collections = await this.getCollections(userId);
      const collection = collections.find(c => c.id === collectionId);
      
      if (collection?.is_default) {
        console.error('Cannot delete default collection');
        return false;
      }

      const { error } = await supabase
        .from('favorite_collections')
        .delete()
        .eq('id', collectionId)
        .eq('user_id', userId);

      if (error) {
        console.error('Error deleting collection:', error);
        return false;
      }

      console.log(`🗑️ Deleted collection: ${collectionId}`);
      return true;
    } catch (error) {
      console.error('Error in deleteCollection:', error);
      return false;
    }
  }

  // Helper methods
  private isLocationSimilar(loc1: any, loc2: any): boolean {
    if (!loc1 || !loc2 || !loc1.lat || !loc1.lng || !loc2.lat || !loc2.lng) {
      return false;
    }

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

  private getEmptyFavoritesAnalytics(): FavoritesAnalytics {
    return {
      totalFavorites: 0,
      totalCollections: 0,
      mostFavoritedCategories: [],
      collectionStats: [],
      recentFavorites: [],
      topLocations: []
    };
  }
}

export const enhancedFavoritesService = new EnhancedFavoritesService();
