import { supabase } from './supabase';
import { enhancedLocationService } from './enhancedLocationService';

export interface WeatherData {
  temperature: number;
  condition: string;
  humidity: number;
  windSpeed: number;
  description: string;
}

export interface AIRecommendation {
  experience: {
    id: string;
    title: string;
    category: string;
    description: string;
    price_min: number;
    price_max: number;
    duration_min: number;
    image_url?: string;
    lat?: number;
    lng?: number;
  };
  reasoning: string;
  confidence: number;
  weather_consideration?: string;
  personalization_score: number;
}

export interface RecommendationRequest {
  userPreferences?: {
    categories?: string[];
    budget_min?: number;
    budget_max?: number;
    people_count?: number;
    travel_mode?: string;
    travel_constraint_type?: string;
    travel_constraint_value?: number;
  };
  currentLocation?: {
    latitude: number;
    longitude: number;
  };
  timeOfDay?: 'morning' | 'afternoon' | 'evening' | 'night';
  dayOfWeek?: string;
  weatherData?: WeatherData;
  context?: string;
}

class AIReasoningService {
  private cache: Map<string, { data: AIRecommendation[]; timestamp: number }> = new Map();
  private readonly CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

  async getAIRecommendations(request: RecommendationRequest): Promise<AIRecommendation[]> {
    try {
      // Create cache key
      const cacheKey = this.createCacheKey(request);
      
      // Check cache first
      const cached = this.cache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < this.CACHE_DURATION) {
        console.log('Returning cached AI recommendations');
        return cached.data;
      }

      // Get current location if not provided
      let location = request.currentLocation;
      if (!location) {
        const currentLocation = await enhancedLocationService.getCurrentLocation();
        if (currentLocation) {
          location = {
            latitude: currentLocation.latitude,
            longitude: currentLocation.longitude,
          };
        }
      }

      // Get weather data if not provided
      let weatherData = request.weatherData;
      if (!weatherData && location) {
        const fetchedWeatherData = await this.getWeatherData(location.latitude, location.longitude);
        weatherData = fetchedWeatherData || undefined;
      }

      // For now, skip the AI reasoning Edge Function since it's designed for weather advice
      // and use the fallback recommendations directly
      console.log('Using fallback recommendations (AI Edge Function not configured for experience recommendations)');
      
      const fallbackRecommendations = await this.getFallbackRecommendations(request);
      
      // Cache the results
      this.cache.set(cacheKey, {
        data: fallbackRecommendations,
        timestamp: Date.now(),
      });

      return fallbackRecommendations;
    } catch (error) {
      console.error('Error getting AI recommendations:', error);
      return this.getFallbackRecommendations(request);
    }
  }

  async getWeatherAwareRecommendations(
    latitude: number,
    longitude: number,
    preferences?: Record<string, unknown>
  ): Promise<AIRecommendation[]> {
    try {
      const weatherData = await this.getWeatherData(latitude, longitude);
      
      return this.getAIRecommendations({
        currentLocation: { latitude, longitude },
        weatherData: weatherData || undefined,
        userPreferences: preferences,
        context: 'weather_aware',
      });
    } catch (error) {
      console.error('Error getting weather-aware recommendations:', error);
      return [];
    }
  }

  async getPersonalizedRecommendations(
    userId: string,
    preferences?: Record<string, unknown>
  ): Promise<AIRecommendation[]> {
    try {
      // Get user's saved experiences and preferences
      const { data: userData, error } = await supabase
        .from('profiles')
        .select(`
          *,
          saves(experience_id, status),
          preferences(*)
        `)
        .eq('id', userId)
        .single();

      if (error) {
        console.error('Error fetching user data:', error);
        return [];
      }

      // Get current location
      const location = await enhancedLocationService.getCurrentLocation();
      
      return this.getAIRecommendations({
        currentLocation: location ? {
          latitude: location.latitude,
          longitude: location.longitude,
        } : undefined,
        userPreferences: {
          ...preferences,
          ...userData.preferences,
        },
        context: 'personalized',
      });
    } catch (error) {
      console.error('Error getting personalized recommendations:', error);
      return [];
    }
  }

  async getContextualRecommendations(
    context: string,
    additionalData?: Record<string, unknown>
  ): Promise<AIRecommendation[]> {
    try {
      const location = await enhancedLocationService.getCurrentLocation();
      
      return this.getAIRecommendations({
        currentLocation: location ? {
          latitude: location.latitude,
          longitude: location.longitude,
        } : undefined,
        context,
        ...additionalData,
      });
    } catch (error) {
      console.error('Error getting contextual recommendations:', error);
      return [];
    }
  }

  private async getWeatherData(latitude: number, longitude: number): Promise<WeatherData | null> {
    try {
      // Call weather API (you would integrate with a real weather service)
      const response = await fetch(
        `https://api.openweathermap.org/data/2.5/weather?lat=${latitude}&lon=${longitude}&appid=YOUR_API_KEY&units=metric`
      );
      
      if (!response.ok) {
        console.warn('Weather API not available, using mock data');
        return this.getMockWeatherData();
      }

      const weather = await response.json();
      
      return {
        temperature: weather.main.temp,
        condition: weather.weather[0].main,
        humidity: weather.main.humidity,
        windSpeed: weather.wind.speed,
        description: weather.weather[0].description,
      };
    } catch (error) {
      console.error('Error fetching weather data:', error);
      return this.getMockWeatherData();
    }
  }

  private getMockWeatherData(): WeatherData {
    return {
      temperature: 22,
      condition: 'Clear',
      humidity: 60,
      windSpeed: 5,
      description: 'clear sky',
    };
  }

  private getTimeOfDay(): 'morning' | 'afternoon' | 'evening' | 'night' {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) return 'morning';
    if (hour >= 12 && hour < 17) return 'afternoon';
    if (hour >= 17 && hour < 21) return 'evening';
    return 'night';
  }

  private getDayOfWeek(): string {
    return new Date().toLocaleDateString('en-US', { weekday: 'long' });
  }

  private createCacheKey(request: RecommendationRequest): string {
    return JSON.stringify({
      preferences: request.userPreferences,
      location: request.currentLocation,
      timeOfDay: request.timeOfDay,
      dayOfWeek: request.dayOfWeek,
      context: request.context,
    });
  }

  private async getFallbackRecommendations(request: RecommendationRequest): Promise<AIRecommendation[]> {
    try {
      // Fallback to basic experience fetching - fetch more experiences like the web app
      let query = supabase
        .from('experiences')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(40); // Fetch up to 40 experiences

      // Apply filters if available
      if (request.userPreferences?.categories && request.userPreferences.categories.length > 0) {
        query = query.in('category_slug', request.userPreferences.categories);
      }

      if (request.userPreferences?.budget_min && request.userPreferences?.budget_max) {
        query = query
          .gte('price_min', request.userPreferences.budget_min)
          .lte('price_max', request.userPreferences.budget_max);
      }

      const { data: experiences, error } = await query;

      if (error) {
        console.error('Error fetching fallback experiences:', error);
        // Use hardcoded fallback recommendations
        return this.getHardcodedRecommendations();
      }

      const dbExperiences = experiences || [];
      console.log(`Fetched ${dbExperiences.length} experiences from database`);
      
      // If we have fewer than 18 experiences from database, supplement with hardcoded data
      if (dbExperiences.length < 18) {
        console.log(`Database has ${dbExperiences.length} experiences, supplementing with hardcoded data`);
        const hardcodedData = this.getHardcodedRecommendations();
        // Combine database experiences with hardcoded data, avoiding duplicates
        const combined = [...dbExperiences];
        const existingIds = new Set(dbExperiences.map(exp => exp.id));
        
        for (const hardcodedExp of hardcodedData) {
          if (!existingIds.has(hardcodedExp.experience.id) && combined.length < 25) {
            combined.push(hardcodedExp.experience);
          }
        }
        
        return combined.slice(0, 25).map(experience => ({
          experience: {
            ...experience,
            description: experience.description || `Enjoy a great ${experience.category} experience in the city.`,
          },
          reasoning: 'Based on popular experiences in your area',
          confidence: 0.7,
          personalization_score: 0.5,
        }));
      }

      // Return more experiences like the web app (up to 25)
      return dbExperiences.slice(0, 25).map(experience => ({
        experience: {
          ...experience,
          description: experience.description || `Enjoy a great ${experience.category} experience in the city.`,
        },
        reasoning: 'Based on popular experiences in your area',
        confidence: 0.7,
        personalization_score: 0.5,
      }));
    } catch (error) {
      console.error('Error getting fallback recommendations:', error);
      return this.getHardcodedRecommendations();
    }
  }

  private getHardcodedRecommendations(): AIRecommendation[] {
    return [
      {
        experience: {
          id: 'hardcoded-1',
          title: 'Central Park Walk',
          description: 'Take a peaceful stroll through the iconic Central Park, enjoying the beautiful landscapes and fresh air.',
          category: 'Stroll',
          price_min: 0,
          price_max: 0,
          duration_min: 60,
          image_url: 'https://images.unsplash.com/photo-1566073771259-6a8506099945',
        },
        reasoning: 'Perfect for a relaxing outdoor experience',
        confidence: 0.8,
        personalization_score: 0.6,
      },
      {
        experience: {
          id: 'hardcoded-2',
          title: 'Blue Bottle Coffee',
          description: 'Sip on expertly crafted coffee in a modern, minimalist café setting.',
          category: 'Sip & Chill',
          price_min: 5,
          price_max: 15,
          duration_min: 90,
          image_url: 'https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb',
        },
        reasoning: 'Great for any time of day and weather',
        confidence: 0.7,
        personalization_score: 0.5,
      },
      {
        experience: {
          id: 'hardcoded-3',
          title: 'Modern Art Gallery',
          description: 'Explore contemporary art exhibitions in this stunning modern gallery.',
          category: 'Creative',
          price_min: 20,
          price_max: 25,
          duration_min: 90,
          image_url: 'https://images.unsplash.com/photo-1544967882-6abcd0847e50',
        },
        reasoning: 'Cultural enrichment and indoor activity',
        confidence: 0.6,
        personalization_score: 0.4,
      },
      {
        experience: {
          id: 'hardcoded-4',
          title: 'Rooftop Bar Views',
          description: 'Enjoy cocktails with stunning city views at this trendy rooftop bar.',
          category: 'Sip & Chill',
          price_min: 12,
          price_max: 25,
          duration_min: 120,
          image_url: 'https://images.unsplash.com/photo-1514933651103-005eec06c04b',
        },
        reasoning: 'Perfect for evening relaxation with great views',
        confidence: 0.7,
        personalization_score: 0.5,
      },
      {
        experience: {
          id: 'hardcoded-5',
          title: 'Corner Bistro',
          description: 'Enjoy delicious casual dining in a cozy neighborhood bistro.',
          category: 'Casual Eats',
          price_min: 15,
          price_max: 35,
          duration_min: 75,
          image_url: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4',
        },
        reasoning: 'Great for a casual meal with friends',
        confidence: 0.6,
        personalization_score: 0.4,
      },
      {
        experience: {
          id: 'hardcoded-6',
          title: 'AMC Theater',
          description: 'Catch the latest movies in comfortable, modern theater seating.',
          category: 'Screen & Relax',
          price_min: 12,
          price_max: 18,
          duration_min: 150,
          image_url: 'https://images.unsplash.com/photo-1489185078525-20980c5859d8',
        },
        reasoning: 'Perfect for entertainment and relaxation',
        confidence: 0.5,
        personalization_score: 0.3,
      },
      {
        experience: {
          id: 'hardcoded-7',
          title: 'Bowling Alley',
          description: 'Strike up some fun with friends at this modern bowling alley.',
          category: 'Play & Move',
          price_min: 20,
          price_max: 40,
          duration_min: 120,
          image_url: 'https://images.unsplash.com/photo-1578662996442-48f60103fc96',
        },
        reasoning: 'Fun group activity for all skill levels',
        confidence: 0.6,
        personalization_score: 0.4,
      },
      {
        experience: {
          id: 'hardcoded-8',
          title: 'Fine Dining Restaurant',
          description: 'Indulge in an exquisite fine dining experience with exceptional service.',
          category: 'Dining',
          price_min: 60,
          price_max: 120,
          duration_min: 120,
          image_url: 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0',
        },
        reasoning: 'Special occasion dining experience',
        confidence: 0.8,
        personalization_score: 0.7,
      },
    ];
  }

  // Clear cache
  clearCache(): void {
    this.cache.clear();
  }

  // Get cache stats
  getCacheStats(): { size: number; keys: string[] } {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys()),
    };
  }
}

export const aiReasoningService = new AIReasoningService();
