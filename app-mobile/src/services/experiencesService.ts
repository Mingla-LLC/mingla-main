import { supabase } from './supabase';

export interface Experience {
  id: string;
  title: string;
  category: string;
  place_id?: string;
  lat?: number;
  lng?: number;
  price_min: number;
  price_max: number;
  duration_min: number;
  image_url?: string;
  opening_hours?: any;
  meta?: any;
  created_at: string;
  updated_at: string;
}

export interface UserPreferences {
  mode: string;
  budget_min: number;
  budget_max: number;
  people_count: number;
  categories: string[];
  travel_mode: string;
  travel_constraint_type: string;
  travel_constraint_value: number;
  datetime_pref: string;
}

export interface SaveData {
  profile_id: string;
  experience_id: string;
  status: 'liked' | 'disliked' | 'saved' | 'unsaved';
  scheduled_at?: string;
}

export class ExperiencesService {
  /**
   * Fetch all experiences from the database
   */
  static async getExperiences(): Promise<Experience[]> {
    try {
      const { data, error } = await supabase
        .from('experiences')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching experiences:', error);
        throw error;
      }

      return data || [];
    } catch (error) {
      console.error('Failed to fetch experiences:', error);
      return [];
    }
  }

  /**
   * Fetch experiences by category
   */
  static async getExperiencesByCategory(category: string): Promise<Experience[]> {
    try {
      const { data, error } = await supabase
        .from('experiences')
        .select('*')
        .eq('category', category)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching experiences by category:', error);
        throw error;
      }

      return data || [];
    } catch (error) {
      console.error('Failed to fetch experiences by category:', error);
      return [];
    }
  }

  /**
   * Get user's saved experiences
   */
  static async getSavedExperiences(userId: string): Promise<Experience[]> {
    try {
      const { data, error } = await supabase
        .from('saves')
        .select(`
          experience_id,
          experiences (*)
        `)
        .eq('profile_id', userId)
        .eq('status', 'liked');

      if (error) {
        console.error('Error fetching saved experiences:', error);
        throw error;
      }

      return data?.map(item => item.experiences).filter(Boolean) || [];
    } catch (error) {
      console.error('Failed to fetch saved experiences:', error);
      return [];
    }
  }

  /**
   * Save or unsave an experience
   */
  static async saveExperience(userId: string, experienceId: string, status: 'liked' | 'disliked' | 'saved' | 'unsaved'): Promise<boolean> {
    try {
      if (status === 'unsaved') {
        // Remove the save
        const { error } = await supabase
          .from('saves')
          .delete()
          .eq('profile_id', userId)
          .eq('experience_id', experienceId);

        if (error) {
          console.error('Error removing save:', error);
          throw error;
        }
      } else {
        // Upsert the save
        const { error } = await supabase
          .from('saves')
          .upsert({
            profile_id: userId,
            experience_id: experienceId,
            status: status,
            scheduled_at: status === 'saved' ? new Date().toISOString() : null
          });

        if (error) {
          console.error('Error saving experience:', error);
          throw error;
        }
      }

      return true;
    } catch (error) {
      console.error('Failed to save experience:', error);
      return false;
    }
  }

  /**
   * Get user preferences
   */
  static async getUserPreferences(userId: string): Promise<UserPreferences | null> {
    try {
      const { data, error } = await supabase
        .from('preferences')
        .select('*')
        .eq('profile_id', userId)
        .single();

      if (error) {
        // If no preferences exist, create default ones
        if (error.code === 'PGRST116') {
          console.log('No preferences found, creating default preferences for user:', userId);
          const defaultPreferences: UserPreferences = {
            mode: 'explore',
            budget_min: 0,
            budget_max: 1000,
            people_count: 1,
            categories: ['Stroll', 'Sip & Chill'],
            travel_mode: 'walking',
            travel_constraint_type: 'time',
            travel_constraint_value: 30,
            datetime_pref: new Date().toISOString()
          };

          // Try to create preferences, but don't fail if there are trigger issues
          try {
            const { error: insertError } = await supabase
              .from('preferences')
              .insert({
                profile_id: userId,
                mode: defaultPreferences.mode,
                budget_min: defaultPreferences.budget_min,
                budget_max: defaultPreferences.budget_max,
                people_count: defaultPreferences.people_count,
                categories: defaultPreferences.categories,
                travel_mode: defaultPreferences.travel_mode,
                travel_constraint_type: defaultPreferences.travel_constraint_type,
                travel_constraint_value: defaultPreferences.travel_constraint_value,
                datetime_pref: defaultPreferences.datetime_pref
              });

            if (insertError) {
              console.error('Error creating default preferences:', insertError);
              // If it's a trigger-related error, we can still return the defaults
              if (insertError.code === '42703') {
                console.log('Trigger error detected, but continuing with default preferences');
                console.log('This is likely due to a database trigger issue - preferences will work locally');
              }
              // Always return the default preferences even if database insert fails
              return defaultPreferences;
            }

            console.log('Successfully created default preferences in database');
            return defaultPreferences;
          } catch (insertError) {
            console.error('Exception creating default preferences:', insertError);
            console.log('Continuing with default preferences despite database error');
            return defaultPreferences; // Always return defaults
          }
        }
        
        console.error('Error fetching user preferences:', error);
        return null;
      }

      return data;
    } catch (error) {
      console.error('Failed to fetch user preferences:', error);
      return null;
    }
  }

  /**
   * Update user preferences
   */
  static async updateUserPreferences(userId: string, preferences: Partial<UserPreferences>): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('preferences')
        .upsert({
          profile_id: userId,
          ...preferences,
          updated_at: new Date().toISOString()
        });

      if (error) {
        console.error('Error updating user preferences:', error);
        throw error;
      }

      return true;
    } catch (error) {
      console.error('Failed to update user preferences:', error);
      return false;
    }
  }

  /**
   * Track user interaction
   */
  static async trackInteraction(
    userId: string,
    experienceId: string,
    interactionType: 'view' | 'like' | 'dislike' | 'save' | 'unsave' | 'share' | 'schedule' | 'unschedule' | 'click_details' | 'swipe_left' | 'swipe_right' | 'tap',
    interactionData: any = {},
    sessionId?: string
  ): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('user_interactions')
        .insert({
          user_id: userId,
          experience_id: experienceId,
          interaction_type: interactionType,
          interaction_data: interactionData,
          session_id: sessionId
        });

      if (error) {
        console.error('Error tracking interaction:', error);
        throw error;
      }

      return true;
    } catch (error) {
      console.error('Failed to track interaction:', error);
      return false;
    }
  }

  /**
   * Get recommendations using the Supabase function
   */
  static async getRecommendations(
    userId: string,
    preferences: UserPreferences,
    location?: { lat: number; lng: number }
  ): Promise<Experience[]> {
    try {
      const { data, error } = await supabase.functions.invoke('recommendations-enhanced', {
        body: {
          user_id: userId,
          preferences,
          location
        }
      });

      if (error) {
        console.error('Error getting recommendations:', error);
        // Fallback to basic query
        return this.getExperiences();
      }

      return data || [];
    } catch (error) {
      console.error('Failed to get recommendations:', error);
      // Fallback to basic query
      return this.getExperiences();
    }
  }

  /**
   * Transform database experience to app format
   */
  static transformExperience(exp: Experience): any {
    const meta = exp.meta || {};
    const rating = meta.rating || 4.0;
    const reviews = meta.reviews || 0;
    
    return {
      id: exp.id,
      title: exp.title,
      category: exp.category,
      categoryIcon: this.getCategoryIcon(exp.category),
      timeAway: this.calculateTimeAway(exp.lat, exp.lng),
      description: this.generateDescription(exp),
      budget: this.formatBudget(exp.price_min, exp.price_max),
      rating: rating,
      reviewCount: reviews,
      priceRange: this.formatPriceRange(exp.price_min, exp.price_max),
      distance: this.calculateDistance(exp.lat, exp.lng),
      travelTime: this.calculateTravelTime(exp.lat, exp.lng),
      experienceType: this.getExperienceType(exp.category),
      highlights: this.generateHighlights(exp),
      fullDescription: this.generateFullDescription(exp),
      address: this.generateAddress(exp),
      openingHours: this.formatOpeningHours(exp.opening_hours),
      tags: this.generateTags(exp),
      matchScore: this.calculateMatchScore(exp),
      image: exp.image_url || 'https://images.unsplash.com/photo-1441986300917-64674bd600d8',
      images: [exp.image_url || 'https://images.unsplash.com/photo-1441986300917-64674bd600d8'],
      socialStats: {
        views: Math.floor(Math.random() * 1000) + 100,
        likes: Math.floor(Math.random() * 100) + 10,
        saves: Math.floor(Math.random() * 50) + 5,
        shares: Math.floor(Math.random() * 20) + 2
      },
      matchFactors: {
        location: Math.floor(Math.random() * 20) + 80,
        budget: Math.floor(Math.random() * 20) + 80,
        category: Math.floor(Math.random() * 20) + 80,
        time: Math.floor(Math.random() * 20) + 80,
        popularity: Math.floor(Math.random() * 20) + 80
      }
    };
  }

  private static getCategoryIcon(category: string): string {
    const iconMap: { [key: string]: string } = {
      'Stroll': 'walk',
      'Sip & Chill': 'cafe',
      'Casual Eats': 'restaurant',
      'Screen & Relax': 'film',
      'Creative': 'brush',
      'Play & Move': 'basketball',
      'Dining experience': 'wine',
      'Freestyle': 'sparkles'
    };
    return iconMap[category] || 'location';
  }

  private static calculateTimeAway(lat?: number, lng?: number): string {
    if (!lat || !lng) return '5 min away';
    // This would normally calculate based on user's current location
    const times = ['5 min away', '12 min away', '18 min away', '25 min away', '35 min away'];
    return times[Math.floor(Math.random() * times.length)];
  }

  private static generateDescription(exp: Experience): string {
    const descriptions: { [key: string]: string[] } = {
      'Stroll': ['Scenic walking adventure for nature lovers', 'Peaceful walk through beautiful surroundings', 'Relaxing stroll in a serene environment'],
      'Sip & Chill': ['Perfect spot for coffee and conversation', 'Cozy atmosphere for relaxation', 'Great place to unwind and chat'],
      'Casual Eats': ['Delicious food in a relaxed setting', 'Comfortable dining experience', 'Tasty meals in a casual atmosphere'],
      'Screen & Relax': ['Entertaining movie experience', 'Great films in comfortable seating', 'Perfect for a relaxing evening'],
      'Creative': ['Inspiring artistic experience', 'Creative exploration and discovery', 'Artistic journey of self-expression'],
      'Play & Move': ['Active and fun experience', 'Energetic activity for all ages', 'Great way to stay active and have fun'],
      'Dining experience': ['Exceptional culinary journey', 'Fine dining with outstanding service', 'Memorable gastronomic experience'],
      'Freestyle': ['Unique and unexpected discovery', 'Spontaneous adventure awaits', 'One-of-a-kind experience']
    };
    
    const categoryDescriptions = descriptions[exp.category] || ['Amazing experience waiting for you'];
    return categoryDescriptions[Math.floor(Math.random() * categoryDescriptions.length)];
  }

  private static formatBudget(min: number, max: number): string {
    if (min === 0 && max === 0) return 'Free activity within your budget';
    if (min === max) return `$${min} per person`;
    return `$${min}-$${max} per person`;
  }

  private static formatPriceRange(min: number, max: number): string {
    if (min === 0 && max === 0) return 'Free';
    if (min === max) return `$${min}`;
    return `$${min}-$${max}`;
  }

  private static calculateDistance(lat?: number, lng?: number): string {
    if (!lat || !lng) return '2.1 km';
    const distances = ['0.8 km', '1.2 km', '2.1 km', '3.5 km', '4.2 km'];
    return distances[Math.floor(Math.random() * distances.length)];
  }

  private static calculateTravelTime(lat?: number, lng?: number): string {
    if (!lat || !lng) return '8m';
    const times = ['5m', '8m', '12m', '18m', '25m'];
    return times[Math.floor(Math.random() * times.length)];
  }

  private static getExperienceType(category: string): string {
    const typeMap: { [key: string]: string } = {
      'Stroll': 'Outdoor',
      'Sip & Chill': 'Indoor',
      'Casual Eats': 'Indoor',
      'Screen & Relax': 'Indoor',
      'Creative': 'Indoor',
      'Play & Move': 'Active',
      'Dining experience': 'Indoor',
      'Freestyle': 'Mixed'
    };
    return typeMap[category] || 'Mixed';
  }

  private static generateHighlights(exp: Experience): string[] {
    const highlights: { [key: string]: string[] } = {
      'Stroll': ['Scenic Views', 'Nature Trail', 'Peaceful Atmosphere'],
      'Sip & Chill': ['Great Coffee', 'Cozy Atmosphere', 'Free WiFi'],
      'Casual Eats': ['Fresh Ingredients', 'Friendly Service', 'Comfortable Seating'],
      'Screen & Relax': ['Comfortable Seating', 'Great Sound', 'Snack Bar'],
      'Creative': ['Inspiring Art', 'Interactive Exhibits', 'Educational'],
      'Play & Move': ['Fun Activities', 'Great Equipment', 'Friendly Staff'],
      'Dining experience': ['Fine Cuisine', 'Excellent Service', 'Elegant Atmosphere'],
      'Freestyle': ['Unique Experience', 'Unexpected Discoveries', 'Local Flavor']
    };
    
    return highlights[exp.category] || ['Amazing Experience', 'Great Atmosphere', 'Highly Recommended'];
  }

  private static generateFullDescription(exp: Experience): string {
    return `Discover ${exp.title}, a ${exp.category.toLowerCase()} experience that offers ${this.generateDescription(exp).toLowerCase()}. Perfect for those looking to explore and enjoy quality time.`;
  }

  private static generateAddress(exp: Experience): string {
    if (exp.lat && exp.lng) {
      // This would normally reverse geocode the coordinates
      return `${exp.title}, New York, NY`;
    }
    return `${exp.title}, New York, NY`;
  }

  private static formatOpeningHours(hours?: any): string {
    if (!hours) return 'Hours vary';
    if (typeof hours === 'object') {
      const days = Object.keys(hours);
      if (days.length > 0) {
        return `Open ${hours[days[0]]}`;
      }
    }
    return 'Hours vary';
  }

  private static generateTags(exp: Experience): string[] {
    const tags: { [key: string]: string[] } = {
      'Stroll': ['Outdoor', 'Nature', 'Walking'],
      'Sip & Chill': ['Coffee', 'Relax', 'WiFi'],
      'Casual Eats': ['Food', 'Casual', 'Friendly'],
      'Screen & Relax': ['Movies', 'Entertainment', 'Comfort'],
      'Creative': ['Art', 'Culture', 'Learning'],
      'Play & Move': ['Active', 'Fun', 'Sports'],
      'Dining experience': ['Fine Dining', 'Elegant', 'Cuisine'],
      'Freestyle': ['Unique', 'Local', 'Discovery']
    };
    
    return tags[exp.category] || ['Experience', 'Local', 'Fun'];
  }

  private static calculateMatchScore(exp: Experience): number {
    return Math.floor(Math.random() * 20) + 80; // 80-100
  }
}
