import { supabase, trackedInvoke } from './supabase';
import { priceTierFromAmount } from '../constants/priceTiers';

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
  intents?: string[];
  travel_mode: string;
  travel_constraint_type: 'time';
  travel_constraint_value: number;
  datetime_pref: string | null;
  date_option?: string | null;
  time_slot?: string | null;
  exact_time?: string | null;
  custom_location?: string | null;
  use_gps_location?: boolean;
  experience_types?: string[];
}

export interface SaveData {
  profile_id: string;
  experience_id: string;
  status: 'liked' | 'disliked' | 'saved' | 'unsaved';
  scheduled_at?: string;
}

export interface ExperienceSeedData {
  title?: string;
  category?: string;
  place_id?: string;
  lat?: number;
  lng?: number;
  image_url?: string;
  opening_hours?: any;
  meta?: any;
}

export class ExperiencesService {
  private static readonly UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  private static isUuid(value: string): boolean {
    return this.UUID_REGEX.test(value);
  }

  private static async resolveExperienceId(
    experienceIdentifier: string,
    experienceData?: ExperienceSeedData
  ): Promise<string | null> {
    if (!experienceIdentifier) {
      return null;
    }

    if (this.isUuid(experienceIdentifier)) {
      return experienceIdentifier;
    }

    const placeId = experienceData?.place_id || experienceIdentifier;

    const { data: existingByPlace, error: existingByPlaceError } = await supabase
      .from('experiences')
      .select('id')
      .eq('place_id', placeId)
      .maybeSingle();

    if (existingByPlaceError) {
      console.error('Error resolving experience by place_id:', existingByPlaceError);
      return null;
    }

    if (existingByPlace?.id) {
      return existingByPlace.id;
    }

    if (!experienceData) {
      return null;
    }

    const experiencePayload = {
      title: experienceData.title || 'Untitled Experience',
      category: experienceData.category || 'Freestyle',
      place_id: placeId,
      lat: experienceData.lat ?? null,
      lng: experienceData.lng ?? null,
      price_min: 0,
      price_max: 0,
      duration_min: 60,
      image_url: experienceData.image_url ?? null,
      opening_hours: experienceData.opening_hours ?? null,
      meta: experienceData.meta || {},
    };

    const { data: insertedExperience, error: insertError } = await supabase
      .from('experiences')
      .upsert(experiencePayload, { onConflict: 'place_id' })
      .select('id')
      .single();

    if (insertError) {
      console.error('Error creating experience for save operation:', insertError);
      return null;
    }

    return insertedExperience?.id || null;
  }

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

      const savedExperiences = (data || [])
        .flatMap((item: any) =>
          Array.isArray(item.experiences) ? item.experiences : [item.experiences]
        )
        .filter(Boolean) as Experience[];

      return savedExperiences;
    } catch (error) {
      console.error('Failed to fetch saved experiences:', error);
      return [];
    }
  }

  /**
   * Save or unsave an experience
   */
  static async saveExperience(
    userId: string,
    experienceId: string,
    status: 'liked' | 'disliked' | 'saved' | 'unsaved',
    experienceData?: ExperienceSeedData
  ): Promise<boolean> {
    try {
      const resolvedExperienceId = await this.resolveExperienceId(experienceId, experienceData);

      if (!resolvedExperienceId) {
        console.warn('Unable to resolve experience ID for save operation', {
          experienceId,
          status,
        });
        return false;
      }

      if (status === 'unsaved') {
        // Remove the save
        const { error } = await supabase
          .from('saves')
          .delete()
          .eq('profile_id', userId)
          .eq('experience_id', resolvedExperienceId);

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
            experience_id: resolvedExperienceId,
            status: status,
            scheduled_at: status === 'saved' ? new Date().toISOString() : null
          }, { onConflict: 'profile_id,experience_id' });

        if (error) {
          if (error.code === '23505') {
            console.warn('Save already exists, ignoring duplicate insert');
          } else {
            console.error('Error saving experience:', error);
            throw error;
          }
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
          const defaultPreferences: UserPreferences = {
            mode: 'explore',
            budget_min: 0,
            budget_max: 1000,
            people_count: 1,
            categories: ['nature', 'casual_eats', 'drink'],
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
                // Trigger error detected - preferences will work locally
              }
              // Always return the default preferences even if database insert fails
              return defaultPreferences;
            }

            return defaultPreferences;
          } catch (insertError) {
            console.error('Exception creating default preferences:', insertError);
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
      const {
        data: { user: authUser },
        error: authError,
      } = await supabase.auth.getUser();

      if (authError || !authUser) {
        return false;
      }

      const effectiveUserId = authUser.id;

      if (userId && userId !== effectiveUserId) {
        console.warn("trackInteraction userId mismatch; using authenticated user id", {
          providedUserId: userId,
          authenticatedUserId: effectiveUserId,
        });
      }

      const { error } = await supabase
        .from('user_interactions')
        .insert({
          user_id: effectiveUserId,
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
      const { data, error } = await trackedInvoke('recommendations-enhanced', {
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
      priceTier: priceTierFromAmount(exp.price_min, exp.price_max),
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
      // v2 categories
      'Nature': 'leaf-outline',
      'First Meet': 'chatbubbles-outline',
      'Drink': 'wine-outline',
      'Casual Eats': 'fast-food-outline',
      'Fine Dining': 'restaurant-outline',
      'Watch': 'film-outline',
      'Creative & Arts': 'color-palette-outline',
      'Play': 'game-controller-outline',
      'Wellness': 'body-outline',
      'Picnic': 'basket-outline',
      // v1 backwards compat
      'Stroll': 'walk-outline',
      'Sip & Chill': 'cafe',
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
      // v2 categories
      'Nature': ['Scenic outdoor adventure for nature lovers', 'Peaceful time in beautiful surroundings', 'Relaxing experience in a serene environment'],
      'First Meet': ['Perfect spot for a first meeting', 'Casual atmosphere for getting to know someone', 'Great place for a relaxed introduction'],
      'Drink': ['Perfect spot for drinks and conversation', 'Cozy atmosphere for relaxation', 'Great place to unwind and chat'],
      'Casual Eats': ['Delicious food in a relaxed setting', 'Comfortable dining experience', 'Tasty meals in a casual atmosphere'],
      'Fine Dining': ['Exceptional culinary journey', 'Fine dining with outstanding service', 'Memorable gastronomic experience'],
      'Watch': ['Entertaining viewing experience', 'Great entertainment in comfortable seating', 'Perfect for a relaxing evening'],
      'Creative & Arts': ['Inspiring artistic experience', 'Creative exploration and discovery', 'Artistic journey of self-expression'],
      'Play': ['Active and fun experience', 'Energetic activity for all ages', 'Great way to stay active and have fun'],
      'Wellness': ['Rejuvenating wellness experience', 'Perfect for mind and body relaxation', 'Restore your energy and find balance'],
      'Picnic': ['Delightful outdoor dining experience', 'Perfect for a sunny afternoon', 'Relaxed picnic in a beautiful setting'],
      // v1 backwards compat
      'Stroll': ['Scenic walking adventure for nature lovers', 'Peaceful walk through beautiful surroundings', 'Relaxing stroll in a serene environment'],
      'Sip & Chill': ['Perfect spot for coffee and conversation', 'Cozy atmosphere for relaxation', 'Great place to unwind and chat'],
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
      // v2 categories
      'Nature': 'Outdoor',
      'First Meet': 'Indoor',
      'Drink': 'Indoor',
      'Casual Eats': 'Indoor',
      'Fine Dining': 'Indoor',
      'Watch': 'Indoor',
      'Creative & Arts': 'Indoor',
      'Play': 'Active',
      'Wellness': 'Indoor',
      'Picnic': 'Outdoor',
      // v1 backwards compat
      'Stroll': 'Outdoor',
      'Sip & Chill': 'Indoor',
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
      // v2 categories
      'Nature': ['Scenic Views', 'Nature Trail', 'Peaceful Atmosphere'],
      'First Meet': ['Relaxed Vibe', 'Easy Conversation', 'Comfortable Setting'],
      'Drink': ['Great Drinks', 'Cozy Atmosphere', 'Social Vibe'],
      'Casual Eats': ['Fresh Ingredients', 'Friendly Service', 'Comfortable Seating'],
      'Fine Dining': ['Fine Cuisine', 'Excellent Service', 'Elegant Atmosphere'],
      'Watch': ['Comfortable Seating', 'Great Sound', 'Snack Bar'],
      'Creative & Arts': ['Inspiring Art', 'Interactive Exhibits', 'Educational'],
      'Play': ['Fun Activities', 'Great Equipment', 'Friendly Staff'],
      'Wellness': ['Relaxation', 'Professional Service', 'Rejuvenating'],
      'Picnic': ['Outdoor Setting', 'Fresh Air', 'Scenic Views'],
      // v1 backwards compat
      'Stroll': ['Scenic Views', 'Nature Trail', 'Peaceful Atmosphere'],
      'Sip & Chill': ['Great Coffee', 'Cozy Atmosphere', 'Free WiFi'],
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
      // v2 categories
      'Nature': ['Outdoor', 'Nature', 'Scenic'],
      'First Meet': ['Social', 'Casual', 'Relaxed'],
      'Drink': ['Drinks', 'Social', 'Relaxed'],
      'Casual Eats': ['Food', 'Casual', 'Friendly'],
      'Fine Dining': ['Fine Dining', 'Elegant', 'Cuisine'],
      'Watch': ['Movies', 'Entertainment', 'Comfort'],
      'Creative & Arts': ['Art', 'Culture', 'Learning'],
      'Play': ['Active', 'Fun', 'Games'],
      'Wellness': ['Wellness', 'Relaxation', 'Health'],
      'Picnic': ['Outdoor', 'Picnic', 'Nature'],
      // v1 backwards compat
      'Stroll': ['Outdoor', 'Nature', 'Walking'],
      'Sip & Chill': ['Coffee', 'Relax', 'WiFi'],
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
