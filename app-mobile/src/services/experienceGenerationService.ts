import { supabase } from "./supabase";
import { UserPreferences } from "./experiencesService";

export interface GeneratedExperience {
  id: string;
  title: string;
  category: string;
  categoryIcon: string;
  matchScore: number;
  heroImage: string;
  images: string[];
  rating: number;
  reviewCount: number;
  travelTime: string;
  distance: string;
  priceRange: string;
  description: string;
  highlights: string[];
  address: string;
  lat?: number;
  lng?: number;
  placeId?: string;
  matchFactors: {
    location: number;
    budget: number;
    category: number;
    time: number;
    popularity: number;
  };
  strollData?: {
    anchor: {
      id: string;
      name: string;
      location: { lat: number; lng: number };
      address: string;
    };
    companionStops: Array<{
      id: string;
      name: string;
      location: { lat: number; lng: number };
      address: string;
      rating?: number;
      reviewCount?: number;
      imageUrl?: string | null;
      placeId: string;
      type: string;
    }>;
    route: {
      duration: number;
      startLocation: { lat: number; lng: number };
      endLocation: { lat: number; lng: number };
    };
    timeline: Array<{
      step: number;
      type: string;
      title: string;
      location: any;
      description: string;
      duration: number;
    }>;
  };
}

export interface ExperienceGenerationRequest {
  userId: string;
  preferences: UserPreferences;
  location?: { lat: number; lng: number };
}

export interface SessionExperienceGenerationRequest {
  sessionId: string;
  userId?: string; // Optional: for auth
}

export class ExperienceGenerationService {
  /**
   * Generate experiences using AI and Google Places
   */
  static async generateExperiences(
    request: ExperienceGenerationRequest
  ): Promise<GeneratedExperience[]> {
    try {
      // Filter out experience types from categories array
      // Experience types are: "solo-adventure", "first-dates", "romantic", "friendly", "group-fun", "business"
      const experienceTypeIds = new Set([
        "solo-adventure",
        "first-dates",
        "romantic",
        "friendly",
        "group-fun",
        "business",
      ]);

      const filteredCategories = request.preferences.categories
        ? request.preferences.categories.filter(
            (category) => !experienceTypeIds.has(category)
          )
        : request.preferences.categories;

      // Create filtered preferences object
      const filteredPreferences = {
        ...request.preferences,
        categories: filteredCategories,
      };

      // Call Supabase edge function to generate experiences
      const { data, error } = await supabase.functions.invoke(
        "new-generate-experience-",
        {
          body: {
            user_id: request.userId,
            preferences: filteredPreferences,
            location: request.location,
          },
        }
      );

      if (error) {
        console.error("Error generating experiences:", error);
        console.error("Error details:", JSON.stringify(error, null, 2));

        // Check if it's a function error with a message
        if (error.message) {
          throw new Error(`Failed to generate experiences: ${error.message}`);
        }
        throw error;
      }

      // Check if response contains an error
      if (data?.error) {
        console.error("Function returned error:", data.error);
        throw new Error(data.error);
      }

      if (!data || !data.cards || data.cards.length === 0) {
        return [];
      }

      // Transform the response to our format
      return data.cards.map((card: any) =>
        this.transformToGeneratedExperience(card)
      );
    } catch (error) {
      console.error("Failed to generate experiences:", error);
      throw error;
    }
  }

  /**
   * Transform edge function response to GeneratedExperience format
   */
  private static transformToGeneratedExperience(
    card: any
  ): GeneratedExperience {
    return {
      id: card.id || card.place_id || `exp_${Date.now()}_${Math.random()}`,
      title: card.title || card.name || "Experience",
      category: card.category || "Freestyle",
      categoryIcon: this.getCategoryIcon(card.category),
      matchScore: card.matchScore || 85,
      heroImage:
        card.image ||
        card.imageUrl ||
        card.heroImage ||
        "https://images.unsplash.com/photo-1441986300917-64674bd600d8",
      images: card.images || (card.image ? [card.image] : []),
      rating: card.rating || 4.0,
      reviewCount: card.reviewCount || card.reviews || 0,
      travelTime: card.travelTime || "15 min",
      distance: card.distance || "3 km",
      priceRange: card.priceRange || "$25-75",
      description:
        card.description ||
        card.briefDescription ||
        "An amazing experience waiting for you.",
      highlights: card.highlights || card.topHighlights || [],
      address: card.address || "",
      lat: card.lat || card.location?.lat,
      lng: card.lng || card.location?.lng,
      placeId: card.place_id || card.placeId,
      matchFactors: card.matchFactors || {
        location: 85,
        budget: 85,
        category: 85,
        time: 85,
        popularity: 85,
      },
      // Preserve strollData if available
      strollData: card.strollData,
    };
  }

  /**
   * Fetch companion stop + stroll timeline for a given anchor (on-demand)
   */
  static async fetchCompanionStrollData(anchor: {
    id: string;
    name: string;
    location: { lat: number; lng: number };
    address?: string;
  }): Promise<GeneratedExperience["strollData"] | null> {
    try {
      const { data, error } = await supabase.functions.invoke(
        "get-companion-stops",
        {
          body: { anchor },
        }
      );

      if (error) {
        console.error("Error fetching companion stroll data:", error);
        return null;
      }

      if (data?.strollData) {
        return data.strollData;
      }

      return null;
    } catch (err) {
      console.error("Failed to fetch companion stroll data:", err);
      return null;
    }
  }

  static async fetchPicnicGroceryData(picnic: {
    id: string;
    name: string;
    location: { lat: number; lng: number };
    address?: string;
    title?: string;
  }): Promise<any | null> {
    try {
      const { data, error } = await supabase.functions.invoke(
        "get-picnic-grocery",
        {
          body: { picnic },
        }
      );

      if (error) {
        console.error("Error fetching picnic grocery data:", error);
        return null;
      }

      if (data?.picnicData) {
        return data.picnicData;
      }

      return null;
    } catch (err) {
      console.error("Failed to fetch picnic grocery data:", err);
      return null;
    }
  }

  /**
   * Calculate match score based on 5 factors
   */
  static calculateMatchScore(
    experience: any,
    preferences: UserPreferences,
    userLocation?: { lat: number; lng: number }
  ): number {
    const locationScore = this.calculateLocationScore(
      experience,
      preferences,
      userLocation
    );
    const budgetScore = this.calculateBudgetScore(experience, preferences);
    const categoryScore = this.calculateCategoryScore(experience, preferences);
    const timeScore = this.calculateTimeScore(experience, preferences);
    const popularityScore = this.calculatePopularityScore(experience);

    // Weighted combination
    const matchScore =
      (locationScore * 0.25 +
        budgetScore * 0.2 +
        categoryScore * 0.2 +
        timeScore * 0.2 +
        popularityScore * 0.15) *
      100;

    return Math.round(Math.max(0, Math.min(100, matchScore)));
  }

  /**
   * Calculate location score (0-1)
   */
  private static calculateLocationScore(
    experience: any,
    preferences: UserPreferences,
    userLocation?: { lat: number; lng: number }
  ): number {
    if (!userLocation || !experience.lat || !experience.lng) {
      return 0.5; // Neutral score if location data missing
    }

    // Calculate distance in km using Haversine formula
    const distance = this.calculateHaversineDistance(
      userLocation.lat,
      userLocation.lng,
      experience.lat,
      experience.lng
    );

    // Get travel time from experience data or estimate
    const travelTime =
      this.parseTravelTime(experience.travelTime) ||
      this.estimateTravelTime(distance, preferences.travel_mode);

    let locationScore = 0;

    if (preferences.travel_constraint_type === "time") {
      const constraintValue = preferences.travel_constraint_value || 30;

      if (travelTime <= 5) {
        locationScore = 1.0;
      } else if (travelTime >= constraintValue) {
        locationScore = 0.0;
      } else {
        const range = constraintValue - 5;
        const excess = travelTime - 5;
        locationScore = 1.0 - excess / range;
      }
    } else if (preferences.travel_constraint_type === "distance") {
      const maxDistance = preferences.travel_constraint_value || 5;

      if (distance <= 0.5) {
        locationScore = 1.0;
      } else if (distance >= maxDistance) {
        locationScore = 0.0;
      } else {
        const range = maxDistance - 0.5;
        const excess = distance - 0.5;
        locationScore = 1.0 - excess / range;
      }
    }

    // Bonus for very close locations
    if (distance < 1.0 && travelTime < 10) {
      locationScore = Math.min(1.0, locationScore * 1.1);
    }

    return Math.max(0, Math.min(1, locationScore));
  }

  /**
   * Calculate budget score (0-1)
   */
  private static calculateBudgetScore(
    experience: any,
    preferences: UserPreferences
  ): number {
    // Parse price range from experience
    const expPrice = this.parsePriceRange(
      experience.priceRange || experience.price
    );
    const userBudget = {
      min: preferences.budget_min || 0,
      max: preferences.budget_max || 1000,
    };

    if (!expPrice.min && !expPrice.max) {
      return 0.5; // Neutral if no price info
    }

    // Perfect match if experience price is entirely within user budget
    if (expPrice.min >= userBudget.min && expPrice.max <= userBudget.max) {
      return 1.0;
    }

    // Calculate overlap
    const overlapStart = Math.max(userBudget.min, expPrice.min);
    const overlapEnd = Math.min(userBudget.max, expPrice.max);
    const overlap = Math.max(0, overlapEnd - overlapStart);

    if (overlap > 0) {
      const experienceRange = expPrice.max - expPrice.min;
      const overlapRatio = overlap / experienceRange;

      if (expPrice.min < userBudget.min) {
        return overlapRatio * 0.7;
      } else if (expPrice.max > userBudget.max) {
        return overlapRatio * 0.8;
      }
      return overlapRatio;
    }

    // No overlap: check proximity
    if (expPrice.max < userBudget.min) {
      const gap = userBudget.min - expPrice.max;
      const budgetRange = userBudget.max - userBudget.min;
      return Math.max(0, 0.3 - (gap / budgetRange) * 0.3);
    } else {
      const gap = expPrice.min - userBudget.max;
      const budgetRange = userBudget.max - userBudget.min;
      return Math.max(0, 0.2 - (gap / budgetRange) * 0.2);
    }
  }

  /**
   * Calculate category score (0-1)
   */
  private static calculateCategoryScore(
    experience: any,
    preferences: UserPreferences
  ): number {
    const userCategories = preferences.categories || [];
    const experienceCategory = experience.category;

    if (userCategories.includes(experienceCategory)) {
      return 1.0;
    }

    // Check for related categories
    const categoryRelations: { [key: string]: string[] } = {
      "Sip & Chill": ["bar", "cafe", "coffee_shop", "wine_bar", "brewery"],
      Stroll: ["park", "tourist_attraction", "point_of_interest"],
      Dining: ["restaurant", "fine_dining_restaurant"],
    };

    const experienceTypes = experience.placeTypes || [];
    for (const userCategory of userCategories) {
      const relatedTypes = categoryRelations[userCategory] || [];
      if (relatedTypes.some((type) => experienceTypes.includes(type))) {
        return 0.7;
      }
    }

    return 0.0;
  }

  /**
   * Calculate time score (0-1)
   */
  private static calculateTimeScore(
    experience: any,
    preferences: UserPreferences
  ): number {
    let timeScore = 0;
    const now = new Date();
    const currentHour = now.getHours();

    // Check if place is open now
    const isOpenNow = experience.openingHours?.open_now || false;

    // Time slot ranges
    const timeSlotRanges: { [key: string]: { start: number; end: number } } = {
      brunch: { start: 10, end: 14 },
      afternoon: { start: 12, end: 17 },
      dinner: { start: 17, end: 22 },
      lateNight: { start: 22, end: 2 },
    };

    // Check time slot match (40% of score)
    // Note: This is simplified - in production, parse datetime_pref properly
    if (isOpenNow) {
      timeScore += 0.3;
    }

    // Duration alignment (30% of score)
    const duration = experience.duration_min || 60;
    if (duration <= 120) {
      timeScore += 0.3;
    } else if (duration <= 180) {
      timeScore += 0.2;
    } else {
      timeScore += 0.1;
    }

    // Date preference (30% of score)
    // Simplified - in production, check actual date/time preferences
    if (isOpenNow) {
      timeScore += 0.3;
    }

    return Math.max(0, Math.min(1, timeScore));
  }

  /**
   * Calculate popularity score (0-1)
   */
  private static calculatePopularityScore(experience: any): number {
    const rating = experience.rating || 0;
    const reviewCount = experience.reviewCount || experience.reviews || 0;

    // Rating component (60%)
    let ratingScore = 0;
    if (rating >= 4.5) {
      ratingScore = 1.0;
    } else if (rating >= 4.0) {
      ratingScore = 0.8;
    } else if (rating >= 3.5) {
      ratingScore = 0.6;
    } else if (rating >= 3.0) {
      ratingScore = 0.4;
    } else {
      ratingScore = rating / 5.0;
    }

    // Review count component (40%)
    let reviewScore = 0;
    if (reviewCount >= 1000) {
      reviewScore = 1.0;
    } else if (reviewCount >= 500) {
      reviewScore = 0.9;
    } else if (reviewCount >= 100) {
      reviewScore = 0.7;
    } else if (reviewCount >= 50) {
      reviewScore = 0.5;
    } else if (reviewCount >= 10) {
      reviewScore = 0.3;
    } else if (reviewCount > 0) {
      reviewScore = 0.1;
    }

    const popularityScore = ratingScore * 0.6 + reviewScore * 0.4;

    // Bonus for high rating + high review count
    if (rating >= 4.5 && reviewCount >= 500) {
      return Math.min(1.0, popularityScore * 1.1);
    }

    return popularityScore;
  }

  /**
   * Helper: Calculate Haversine distance between two points
   */
  private static calculateHaversineDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
  ): number {
    const R = 6371; // Earth's radius in km
    const dLat = this.toRad(lat2 - lat1);
    const dLon = this.toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(lat1)) *
        Math.cos(this.toRad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private static toRad(degrees: number): number {
    return degrees * (Math.PI / 180);
  }

  /**
   * Helper: Parse travel time string to minutes
   */
  private static parseTravelTime(travelTime?: string): number | null {
    if (!travelTime) return null;
    const match = travelTime.match(/(\d+)\s*(min|m|minutes?)/i);
    return match ? parseInt(match[1], 10) : null;
  }

  /**
   * Helper: Estimate travel time based on distance and mode
   */
  private static estimateTravelTime(distanceKm: number, mode: string): number {
    const speeds: { [key: string]: number } = {
      walking: 5, // km/h
      driving: 50,
      transit: 30,
      bicycling: 15,
    };
    const speed = speeds[mode] || 5;
    return (distanceKm / speed) * 60; // minutes
  }

  /**
   * Helper: Parse price range string to min/max
   */
  private static parsePriceRange(priceRange?: string): {
    min: number;
    max: number;
  } {
    if (!priceRange) return { min: 0, max: 0 };

    // Handle formats like "$25-75", "$25-$75", "$25", "Free"
    if (priceRange.toLowerCase().includes("free")) {
      return { min: 0, max: 0 };
    }

    const match = priceRange.match(/\$?(\d+)(?:-|\s*-\s*)\$?(\d+)/);
    if (match) {
      return { min: parseInt(match[1], 10), max: parseInt(match[2], 10) };
    }

    const singleMatch = priceRange.match(/\$?(\d+)/);
    if (singleMatch) {
      const price = parseInt(singleMatch[1], 10);
      return { min: price, max: price };
    }

    return { min: 0, max: 0 };
  }

  /**
   * Generate experiences for a collaboration session
   * Aggregates all user preferences in the session and generates unified cards
   */
  static async generateSessionExperiences(
    request: SessionExperienceGenerationRequest
  ): Promise<GeneratedExperience[]> {
    try {
      // Call Supabase edge function to generate session experiences
      const { data, error } = await supabase.functions.invoke(
        "generate-session-experiences",
        {
          body: {
            session_id: request.sessionId,
            user_id: request.userId,
          },
        }
      );

      if (error) {
        console.error("Error generating session experiences:", error);
        console.error("Error details:", JSON.stringify(error, null, 2));

        if (error.message) {
          throw new Error(
            `Failed to generate session experiences: ${error.message}`
          );
        }
        throw error;
      }

      // Check if response contains an error
      if (data?.error) {
        console.error("Function returned error:", data.error);
        throw new Error(data.error);
      }

      if (!data || !data.cards || data.cards.length === 0) {
        console.log("⚠️ No cards returned from session experience generation");
        return [];
      }

      // Transform the response to our format
      return data.cards.map((card: any) =>
        this.transformToGeneratedExperience(card)
      );
    } catch (error) {
      console.error("Failed to generate session experiences:", error);
      throw error;
    }
  }

  /**
   * Helper: Get category icon
   * Handles variations like "stroll", "Stroll", "take-a-stroll", "Take a Stroll"
   */
  private static getCategoryIcon(category: string): string {
    if (!category) return "walk";

    // Normalize the category string: lowercase, replace hyphens with spaces, trim, remove extra spaces
    const normalized = category
      .toLowerCase()
      .replace(/-/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    // Core category keywords that map to icons
    const categoryKeywords: { [key: string]: string } = {
      stroll: "walk",
      sip: "cafe",
      chill: "cafe",
      casual: "restaurant",
      eats: "restaurant",
      screen: "film",
      relax: "film",
      creative: "brush",
      play: "basketball",
      move: "basketball",
      dining: "wine",
      experience: "wine",
      freestyle: "sparkles",
      picnic: "basket",
      picnics: "basket",
    };

    // Check for exact normalized matches first
    if (categoryKeywords[normalized]) {
      return categoryKeywords[normalized];
    }

    // Check if normalized string contains any keyword
    for (const [keyword, icon] of Object.entries(categoryKeywords)) {
      if (normalized.includes(keyword)) {
        return icon;
      }
    }

    // Fallback to original exact match (case-sensitive) for backward compatibility
    const exactMap: { [key: string]: string } = {
      Stroll: "walk",
      "Sip & Chill": "cafe",
      "Casual Eats": "restaurant",
      "Screen & Relax": "film",
      Creative: "brush",
      "Play & Move": "basketball",
      "Dining experience": "wine",
      Freestyle: "sparkles",
      Picnic: "basket",
      Picnics: "basket",
    };

    return exactMap[category] || "location";
  }
}
