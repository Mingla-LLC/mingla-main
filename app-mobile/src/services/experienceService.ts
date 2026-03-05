import { supabase } from './supabase';
import { Experience } from '../types';
import { PriceTierSlug, TIER_BY_SLUG } from '../constants/priceTiers';

export interface ExperienceFilters {
  categories?: string[];
  priceTiers?: PriceTierSlug[];
  /** @deprecated Use priceTiers instead */
  budgetRange?: [number, number];
  groupSize?: number;
}

class ExperienceService {
  private static instance: ExperienceService;

  private constructor() {}

  public static getInstance(): ExperienceService {
    if (!ExperienceService.instance) {
      ExperienceService.instance = new ExperienceService();
    }
    return ExperienceService.instance;
  }

  async fetchAllExperiences(filters?: ExperienceFilters): Promise<Experience[]> {
    try {
      let query = supabase
        .from('experiences')
        .select('*')
        .order('created_at', { ascending: false });

      if (filters?.categories && filters.categories.length > 0) {
        query = query.in('category_slug', filters.categories);
      }

      if (filters?.priceTiers && filters.priceTiers.length > 0) {
        // Compute a budget range from the selected tiers for DB filtering
        const mins = filters.priceTiers.map(s => TIER_BY_SLUG[s]?.min ?? 0);
        const maxes = filters.priceTiers.map(s => TIER_BY_SLUG[s]?.max ?? 10000);
        const minBudget = Math.min(...mins);
        const maxBudget = Math.max(...maxes);
        if (minBudget > 0 || maxBudget < 10000) {
          query = query
            .gte('price_min', minBudget)
            .lte('price_max', maxBudget);
        }
      } else if (filters?.budgetRange && filters.budgetRange.length === 2) {
        // Legacy fallback
        const [minBudget, maxBudget] = filters.budgetRange;
        if (minBudget > 0 || maxBudget < 10000) {
          query = query
            .gte('price_min', minBudget)
            .lte('price_max', maxBudget);
        }
      }

      const { data: experiences, error } = await query;

      if (error) {
        console.error('Error fetching experiences:', error);
        // Return mock data as fallback
        return this.getMockExperiences();
      }

      const dbExperiences = experiences || [];
      
      // If we have fewer than 18 experiences from database, supplement with mock data
      if (dbExperiences.length < 18) {
        const mockData = this.getMockExperiences();
        // Combine database experiences with mock data, avoiding duplicates
        const combined = [...dbExperiences];
        const existingIds = new Set(dbExperiences.map(exp => exp.id));
        
        for (const mockExp of mockData) {
          if (!existingIds.has(mockExp.id) && combined.length < 25) {
            combined.push(mockExp);
          }
        }
        
        return combined;
      }

      return dbExperiences;
    } catch (error) {
      console.error('Unexpected error fetching experiences:', error);
      return this.getMockExperiences();
    }
  }

  async searchExperiences(query: string, filters?: ExperienceFilters): Promise<Experience[]> {
    try {
      let supabaseQuery = supabase
        .from('experiences')
        .select('*')
        .or(`title.ilike.%${query}%, category.ilike.%${query}%`)
        .order('created_at', { ascending: false });

      if (filters?.categories && filters.categories.length > 0) {
        supabaseQuery = supabaseQuery.in('category_slug', filters.categories);
      }

      if (filters?.priceTiers && filters.priceTiers.length > 0) {
        const mins = filters.priceTiers.map(s => TIER_BY_SLUG[s]?.min ?? 0);
        const maxes = filters.priceTiers.map(s => TIER_BY_SLUG[s]?.max ?? 10000);
        const minBudget = Math.min(...mins);
        const maxBudget = Math.max(...maxes);
        if (minBudget > 0 || maxBudget < 10000) {
          supabaseQuery = supabaseQuery
            .gte('price_min', minBudget)
            .lte('price_max', maxBudget);
        }
      } else if (filters?.budgetRange && filters.budgetRange.length === 2) {
        // Legacy fallback
        const [minBudget, maxBudget] = filters.budgetRange;
        if (minBudget > 0 || maxBudget < 10000) {
          supabaseQuery = supabaseQuery
            .gte('price_min', minBudget)
            .lte('price_max', maxBudget);
        }
      }

      const { data: experiences, error } = await supabaseQuery;

      if (error) {
        console.error('Error searching experiences:', error);
        return [];
      }

      return experiences || [];
    } catch (error) {
      console.error('Error searching experiences:', error);
      return [];
    }
  }

  private getMockExperiences(): Experience[] {
    return [
      // Stroll experiences
      {
        id: 'mock-1',
        title: 'Central Park Walk',
        description: 'Take a peaceful stroll through the iconic Central Park, enjoying the beautiful landscapes and fresh air.',
        category: 'Stroll',
        category_slug: 'stroll',
        place_id: 'park_001',
        lat: 40.7829,
        lng: -73.9654,
        price_min: 0,
        price_max: 0,
        duration_min: 60,
        image_url: 'https://images.unsplash.com/photo-1566073771259-6a8506099945',
        opening_hours: {},
        meta: { rating: 4.7, reviews: 12500 },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: 'mock-2',
        title: 'Riverside Promenade',
        description: 'Enjoy a scenic walk along the Hudson River with stunning waterfront views.',
        category: 'Stroll',
        category_slug: 'stroll',
        place_id: 'walk_002',
        lat: 40.7505,
        lng: -73.9934,
        price_min: 0,
        price_max: 0,
        duration_min: 45,
        image_url: 'https://images.unsplash.com/photo-1449824913935-59a10b8d2000',
        opening_hours: {},
        meta: { rating: 4.3, reviews: 890 },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: 'mock-3',
        title: 'Historic District Tour',
        description: 'Explore the rich history and architecture of the historic district.',
        category: 'Stroll',
        category_slug: 'stroll',
        place_id: 'walk_003',
        lat: 40.7614,
        lng: -73.9776,
        price_min: 0,
        price_max: 10,
        duration_min: 90,
        image_url: 'https://images.unsplash.com/photo-1551632811-561732d1e306',
        opening_hours: {},
        meta: { rating: 4.5, reviews: 1200 },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: 'mock-4',
        title: 'Fred G. Bond Metro Park',
        description: 'Discover this beautiful metro park with walking trails and scenic views.',
        category: 'Stroll',
        category_slug: 'stroll',
        place_id: 'bond_park',
        lat: 40.7589,
        lng: -73.9851,
        price_min: 0,
        price_max: 0,
        duration_min: 60,
        image_url: 'https://images.unsplash.com/photo-1544966503-7cc5ac882d5b',
        opening_hours: {},
        meta: { rating: 4.8, reviews: 2100 },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },

      // Sip & Chill experiences
      {
        id: 'mock-5',
        title: 'Blue Bottle Coffee',
        description: 'Sip on expertly crafted coffee in a modern, minimalist café setting.',
        category: 'Sip & Chill',
        category_slug: 'sip',
        place_id: 'cafe_001',
        lat: 40.7614,
        lng: -73.9776,
        price_min: 5,
        price_max: 15,
        duration_min: 90,
        image_url: 'https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb',
        opening_hours: {},
        meta: { rating: 4.4, reviews: 2340 },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: 'mock-6',
        title: 'Rooftop Bar Views',
        description: 'Enjoy cocktails with stunning city views at this trendy rooftop bar.',
        category: 'Sip & Chill',
        category_slug: 'sip',
        place_id: 'bar_001',
        lat: 40.7505,
        lng: -73.9857,
        price_min: 12,
        price_max: 25,
        duration_min: 120,
        image_url: 'https://images.unsplash.com/photo-1514933651103-005eec06c04b',
        opening_hours: {},
        meta: { rating: 4.6, reviews: 1560 },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: 'mock-7',
        title: 'Cozy Bookstore Café',
        description: 'Relax with a book and coffee in this charming bookstore café.',
        category: 'Sip & Chill',
        category_slug: 'sip',
        place_id: 'cafe_002',
        lat: 40.7357,
        lng: -74.0036,
        price_min: 8,
        price_max: 18,
        duration_min: 75,
        image_url: 'https://images.unsplash.com/photo-1481627834876-b7833e8f5570',
        opening_hours: {},
        meta: { rating: 4.2, reviews: 890 },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },

      // Casual Eats experiences
      {
        id: 'mock-8',
        title: 'Corner Bistro',
        description: 'Enjoy delicious casual dining in a cozy neighborhood bistro.',
        category: 'Casual Eats',
        category_slug: 'casual_eats',
        place_id: 'restaurant_001',
        lat: 40.7357,
        lng: -74.0036,
        price_min: 15,
        price_max: 35,
        duration_min: 75,
        image_url: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4',
        opening_hours: {},
        meta: { rating: 4.2, reviews: 980 },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: 'mock-9',
        title: 'Food Truck Plaza',
        description: 'Sample diverse cuisines from local food trucks in this vibrant plaza.',
        category: 'Casual Eats',
        category_slug: 'casual_eats',
        place_id: 'food_001',
        lat: 40.7549,
        lng: -73.9840,
        price_min: 8,
        price_max: 18,
        duration_min: 30,
        image_url: 'https://images.unsplash.com/photo-1565299624946-b28f40a0ca4b',
        opening_hours: {},
        meta: { rating: 4.0, reviews: 456 },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },

      // Screen & Relax experiences
      {
        id: 'mock-10',
        title: 'AMC Theater',
        description: 'Catch the latest movies in comfortable, modern theater seating.',
        category: 'Screen & Relax',
        category_slug: 'screen_relax',
        place_id: 'cinema_001',
        lat: 40.7580,
        lng: -73.9855,
        price_min: 12,
        price_max: 18,
        duration_min: 150,
        image_url: 'https://images.unsplash.com/photo-1489185078525-20980c5859d8',
        opening_hours: {},
        meta: { rating: 4.1, reviews: 3200 },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: 'mock-11',
        title: 'Indie Cinema House',
        description: 'Discover independent films and documentaries in this intimate cinema.',
        category: 'Screen & Relax',
        category_slug: 'screen_relax',
        place_id: 'cinema_002',
        lat: 40.7505,
        lng: -73.9934,
        price_min: 10,
        price_max: 15,
        duration_min: 120,
        image_url: 'https://images.unsplash.com/photo-1489599808421-5b6b2b4b4b4b',
        opening_hours: {},
        meta: { rating: 4.4, reviews: 890 },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },

      // Creative experiences
      {
        id: 'mock-12',
        title: 'Modern Art Gallery',
        description: 'Explore contemporary art exhibitions in this stunning modern gallery.',
        category: 'Creative',
        category_slug: 'creative',
        place_id: 'gallery_001',
        lat: 40.7614,
        lng: -73.9776,
        price_min: 20,
        price_max: 25,
        duration_min: 90,
        image_url: 'https://images.unsplash.com/photo-1544967882-6abcd0847e50',
        opening_hours: {},
        meta: { rating: 4.5, reviews: 1890 },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: 'mock-13',
        title: 'Interactive Museum',
        description: 'Engage with hands-on exhibits and interactive displays.',
        category: 'Creative',
        category_slug: 'creative',
        place_id: 'museum_001',
        lat: 40.7829,
        lng: -73.9654,
        price_min: 15,
        price_max: 30,
        duration_min: 120,
        image_url: 'https://images.unsplash.com/photo-1578662996442-48f60103fc96',
        opening_hours: {},
        meta: { rating: 4.3, reviews: 2760 },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: 'mock-14',
        title: 'Pottery Workshop',
        description: 'Get your hands dirty and create beautiful pottery pieces.',
        category: 'Creative',
        category_slug: 'creative',
        place_id: 'workshop_001',
        lat: 40.7357,
        lng: -74.0036,
        price_min: 45,
        price_max: 75,
        duration_min: 180,
        image_url: 'https://images.unsplash.com/photo-1578662996442-48f60103fc96',
        opening_hours: {},
        meta: { rating: 4.6, reviews: 1200 },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },

      // Play & Move experiences
      {
        id: 'mock-15',
        title: 'Bowling Alley',
        description: 'Strike up some fun with friends at this modern bowling alley.',
        category: 'Play & Move',
        category_slug: 'play_move',
        place_id: 'bowling_001',
        lat: 40.7505,
        lng: -73.9934,
        price_min: 20,
        price_max: 40,
        duration_min: 120,
        image_url: 'https://images.unsplash.com/photo-1578662996442-48f60103fc96',
        opening_hours: {},
        meta: { rating: 4.2, reviews: 1340 },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: 'mock-16',
        title: 'Fitness Studio',
        description: 'Join a high-energy fitness class in this modern studio.',
        category: 'Play & Move',
        category_slug: 'play_move',
        place_id: 'gym_001',
        lat: 40.7357,
        lng: -74.0036,
        price_min: 25,
        price_max: 35,
        duration_min: 60,
        image_url: 'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b',
        opening_hours: {},
        meta: { rating: 4.4, reviews: 890 },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },

      // Dining experiences
      {
        id: 'mock-17',
        title: 'Fine Dining Restaurant',
        description: 'Indulge in an exquisite fine dining experience with exceptional service.',
        category: 'Dining',
        category_slug: 'dining',
        place_id: 'fine_dining_001',
        lat: 40.7549,
        lng: -73.9840,
        price_min: 60,
        price_max: 120,
        duration_min: 120,
        image_url: 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0',
        opening_hours: {},
        meta: { rating: 4.7, reviews: 2890 },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: 'mock-18',
        title: 'Wine Tasting Experience',
        description: 'Discover new flavors with expert-guided wine tastings.',
        category: 'Dining',
        category_slug: 'dining',
        place_id: 'wine_001',
        lat: 40.7580,
        lng: -73.9855,
        price_min: 45,
        price_max: 75,
        duration_min: 90,
        image_url: 'https://images.unsplash.com/photo-1510812431401-41d2bd2722f3',
        opening_hours: {},
        meta: { rating: 4.4, reviews: 1560 },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];
  }
}

export const experienceService = ExperienceService.getInstance();
