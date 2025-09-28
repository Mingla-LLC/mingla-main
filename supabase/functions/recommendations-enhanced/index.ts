import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Environment variables
const GOOGLE_API_KEY = Deno.env.get('GOOGLE_MAPS_API_KEY');
const EVENTBRITE_TOKEN = Deno.env.get('EVENTBRITE_TOKEN');
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Initialize Supabase client with service role key for database access
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Enhanced Category Mappings with Activity Keywords
const CATEGORY_MAPPINGS = {
  'play_move': {
    places: ['bowling_alley', 'gym', 'sports_complex', 'recreation_center', 'tennis_court', 'basketball_court', 'golf_course', 'mini_golf', 'climbing_gym', 'skating_rink', 'amusement_park'],
    keywords: ['bowling', 'climbing', 'bouldering', 'dance', 'skating', 'kayak', 'hike', 'pickleball', 'arcade', 'trampoline', 'mini golf', 'go kart', 'axe throwing', 'laser tag', 'escape room', 'basketball', 'tennis', 'badminton', 'rock climbing', 'indoor climbing'],
    activities: ['bowling', 'climbing', 'bouldering', 'dance', 'skating', 'kayak', 'hikes', 'pickleball', 'arcades', 'trampoline', 'mini golf', 'go kart', 'axe throwing', 'laser tag', 'escape room', 'basketball', 'tennis', 'badminton']
  },
  'dining': {
    places: ['restaurant', 'fine_dining_restaurant', 'steakhouse', 'seafood_restaurant', 'italian_restaurant', 'french_restaurant', 'sushi_restaurant'],
    keywords: ['tasting menu', 'prix fixe', 'chef counter', 'omakase', 'wine pairing', 'fine dining', 'michelin', 'chef\'s table', 'degustation'],
    activities: ['tasting menu', 'prix fixe', 'chef counter', 'omakase', 'wine pairing']
  },
  'screen_relax': {
    places: ['movie_theater', 'spa', 'beauty_salon', 'massage_therapist'],
    keywords: ['cinema', 'movie', 'indie film', 'drive in', 'theater', 'screening', 'film festival', 'documentary'],
    activities: ['cinema', 'movie', 'indie film', 'drive in', 'theater', 'screening']
  },
  'creative': {
    places: ['art_gallery', 'museum', 'pottery_studio', 'painting_studio', 'craft_center', 'workshop'],
    keywords: ['pottery', 'painting', 'workshop', 'art', 'gallery', 'museum', 'craft', 'sculpture', 'photography', 'ceramics'],
    activities: ['pottery', 'painting', 'workshop', 'art', 'gallery', 'museum', 'craft']
  },
  'sip': {
    places: ['bar', 'cocktail_lounge', 'wine_bar', 'brewery', 'coffee_shop', 'tea_house'],
    keywords: ['cocktail', 'wine', 'brewery', 'bar', 'coffee', 'tea', 'speakeasy', 'rooftop', 'happy hour'],
    activities: ['cocktail', 'wine', 'brewery', 'bar', 'coffee', 'tea']
  },
  'stroll': {
    places: ['park', 'garden', 'trail', 'scenic_viewpoint', 'botanical_garden', 'nature_reserve'],
    keywords: ['park', 'garden', 'trail', 'scenic', 'walk', 'botanical', 'nature', 'hiking', 'outdoor'],
    activities: ['park', 'garden', 'trail', 'scenic', 'walk', 'botanical']
  },
  'casual_eats': {
    places: ['restaurant', 'food_truck', 'cafe', 'deli', 'pizza_place', 'burger_restaurant'],
    keywords: ['pizza', 'burger', 'taco', 'food truck', 'deli', 'cafe', 'casual', 'quick bite'],
    activities: ['pizza', 'burger', 'taco', 'food truck', 'deli', 'cafe']
  }
};

interface RecommendationsRequest {
  budget: { min: number; max: number; perPerson: boolean };
  categories: string[];
  experienceTypes?: string[];
  timeWindow: { kind: string; start?: string; end?: string; timeOfDay?: string };
  travel: { mode: string; constraint: { type: string; maxMinutes?: number; maxDistance?: number } };
  origin: { lat: number; lng: number };
  units?: string;
  userId?: string; // New field for user-specific recommendations
  groupSize?: number; // New group size field
}

interface UserPreferenceData {
  learnedPreferences: Array<{
    preference_type: string;
    preference_key: string;
    preference_value: number;
    confidence: number;
    interaction_count: number;
  }>;
  interactionHistory: Array<{
    interaction_type: string;
    experience_id: string;
    interaction_data: any;
    created_at: string;
  }>;
  locationContext: {
    frequentLocations: Array<{
      latitude: number;
      longitude: number;
      visitCount: number;
    }>;
    isAtHome: boolean;
    isAtWork: boolean;
  };
}

// Enhanced Experience Type System with Structured Attributes (same as recommendations/index.ts)
const EXPERIENCE_TYPE_ATTRIBUTES = {
  atmosphere: {
    noise_level: ['quiet', 'moderate', 'loud', 'very_loud'],
    lighting: ['dim', 'soft', 'bright', 'natural'],
    privacy: ['intimate', 'semi_private', 'open', 'public'],
    ambience: ['romantic', 'casual', 'upscale', 'cozy', 'energetic', 'relaxed']
  },
  practicalities: {
    price_tier: ['budget', 'moderate', 'upscale', 'luxury'],
    parking: ['free', 'paid', 'valet', 'street', 'none'],
    wifi: ['free', 'paid', 'none'],
    reservation_required: ['required', 'recommended', 'not_needed']
  },
  activity_style: {
    team_based: ['yes', 'no', 'optional'],
    competitive: ['yes', 'no', 'optional'],
    kid_friendly: ['yes', 'no', 'adults_only'],
    solo_safe: ['yes', 'no', 'group_recommended']
  },
  special_vibes: {
    scenic_view: ['yes', 'no'],
    candlelight: ['yes', 'no'],
    live_music: ['yes', 'no', 'occasional'],
    novelty: ['high', 'medium', 'low', 'none']
  }
};

// Deterministic Rules - Hard Gates
const EXPERIENCE_TYPE_RULES = {
  'romantic': {
    required: ['romantic_ambience', 'intimate_seating', 'scenic_view', 'candlelight', 'date_spot'],
    forbidden: ['kid_party_only', 'sports_bar_only', 'frat_vibe', 'loud_music', 'family_restaurant', 'strip_club'],
    min_score: 0.65
  },
  'first_date': {
    required: ['conversation_friendly', 'comfortable_seating', 'moderate_noise', 'easy_parking'],
    forbidden: ['explicitly_loud_only', 'overly_logistical', 'long_lines', 'complex_gear', 'high_energy_only'],
    min_score: 0.60
  },
  'business': {
    required: ['wifi', 'quiet', 'reservation_possible', 'work_friendly', 'professional_setting'],
    forbidden: ['strip_club', 'loud_party_only', 'nightclub', 'dance_club', 'sports_bar_only'],
    min_score: 0.70
  },
  'group_fun': {
    required: ['team_based', 'capacity_group_friendly', 'multiplayer', 'group_activity', 'social'],
    forbidden: ['intimate_only', 'quiet_only', 'solo_activity', 'couples_only'],
    min_score: 0.65
  },
  'solo_adventure': {
    required: ['safe_solo', 'individual_activity', 'self_guided', 'solo_friendly'],
    forbidden: ['requires_pairing_only', 'team_only', 'group_required', 'unsafe_solo'],
    min_score: 0.60
  },
  'friendly': {
    required: ['casual', 'budget_friendly', 'easy_meetup'],
    forbidden: ['date_only', 'couples_only', 'members_only', 'exclusive', 'upscale_only'],
    min_score: 0.50
  }
};

// Feature-Based Scoring Recipes
const EXPERIENCE_TYPE_SCORING = {
  'romantic': {
    ambience: 0.25,
    privacy: 0.20,
    photo_moments: 0.15,
    service_quality: 0.15,
    scenic_view: 0.10,
    candlelight: 0.10,
    intimate_seating: 0.05
  },
  'first_date': {
    conversation_friendly: 0.30,
    moderate_price: 0.20,
    no_heavy_logistics: 0.15,
    comfortable_seating: 0.15,
    easy_parking: 0.10,
    moderate_noise: 0.10
  },
  'business': {
    quiet_clarity: 0.25,
    wifi: 0.20,
    professional_setting: 0.20,
    reservations: 0.15,
    work_friendly: 0.10,
    meeting_space: 0.10
  },
  'group_fun': {
    capacity: 0.25,
    team_based: 0.20,
    celebratory_energy: 0.15,
    multiplayer: 0.15,
    social: 0.10,
    group_activity: 0.10,
    easy_multiplayer: 0.05
  },
  'friendly': {
    casual: 0.30,
    budget_friendly: 0.25,
    easy_meetup: 0.20,
    social: 0.15,
    accessible: 0.10
  },
  'solo_adventure': {
    safe: 0.30,
    individual_activity: 0.25,
    introspective_value: 0.20,
    self_guided: 0.15,
    solo_friendly: 0.10
  }
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  console.log('🎯 Enhanced Recommendations endpoint called');

  try {
    const preferences: RecommendationsRequest = await req.json();
    console.log('📝 Received preferences:', JSON.stringify(preferences, null, 2));

    // Validate required fields
    if (!preferences.origin?.lat || !preferences.origin?.lng) {
      throw new Error('Origin coordinates are required');
    }

    if (!preferences.categories?.length) {
      throw new Error('At least one category must be selected');
    }

    // Get user-specific data if userId is provided
    let userPreferenceData: UserPreferenceData | null = null;
    if (preferences.userId) {
      userPreferenceData = await getUserPreferenceData(preferences.userId);
      console.log('👤 Loaded user preference data:', {
        learnedPreferences: userPreferenceData.learnedPreferences.length,
        interactionHistory: userPreferenceData.interactionHistory.length,
        frequentLocations: userPreferenceData.locationContext.frequentLocations.length
      });
    }

    // Fetch data from multiple sources in parallel
    const [places, events] = await Promise.allSettled([
      fetchGooglePlaces(preferences),
      fetchEventbriteEvents(preferences)
    ]);

    console.log('📊 Data fetching results:', {
      places: places.status === 'fulfilled' ? places.value.length : `Error: ${places.reason}`,
      events: events.status === 'fulfilled' ? events.value.length : `Error: ${events.reason}`
    });

    // Combine and normalize candidates
    const allCandidates = [
      ...(places.status === 'fulfilled' ? places.value : []),
      ...(events.status === 'fulfilled' ? events.value : [])
    ];

    if (allCandidates.length === 0) {
      return new Response(JSON.stringify({
        cards: [],
        meta: {
          totalResults: 0,
          processingTimeMs: Date.now() - startTime,
          sources: { googlePlaces: 0, eventbrite: 0 },
          llmUsed: false,
          userPersonalization: false
        }
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Add travel information using Distance Matrix API
    const candidatesWithTravel = await annotateWithTravel(allCandidates, preferences);
    console.log('🚗 Travel annotation completed for', candidatesWithTravel.length, 'candidates');

    // Filter by constraints
    const filteredCandidates = filterByConstraints(candidatesWithTravel, preferences);
    console.log('🔍 Filtered down to', filteredCandidates.length, 'candidates');

    if (filteredCandidates.length === 0) {
      return new Response(JSON.stringify({
        cards: [],
        meta: {
          totalResults: 0,
          processingTimeMs: Date.now() - startTime,
          sources: { googlePlaces: places.status === 'fulfilled' ? places.value.length : 0, eventbrite: events.status === 'fulfilled' ? events.value.length : 0 },
          llmUsed: false,
          userPersonalization: !!userPreferenceData
        }
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Enhanced scoring and ranking with user preferences
    const scoredCandidates = scoreAndRankWithUserData(filteredCandidates, preferences, userPreferenceData);
    console.log('📈 Enhanced scoring completed');

    // Phase 2: Advanced ML Personalization
    let mlEnhancedCandidates = scoredCandidates;
    if (userId) {
      try {
        console.log('🤖 Applying Phase 2 ML enhancements...');
        
        // Apply advanced ML personalization
        mlEnhancedCandidates = await applyAdvancedMLPersonalization(
          scoredCandidates, 
          userId, 
          preferences
        );
        
        console.log('✅ Phase 2 ML enhancements applied');
      } catch (mlError) {
        console.error('⚠️ ML enhancement failed, using base recommendations:', mlError);
        // Continue with base recommendations if ML fails
      }
    }

    // Select top candidates
    const topCandidates = mlEnhancedCandidates.slice(0, 20);
    console.log('🏆 Selected top', topCandidates.length, 'candidates');

    // Enhance with LLM-generated copy
    const enhancedCandidates = await enhanceWithLLM(topCandidates, preferences);
    console.log('🤖 LLM enhancement completed');

    // Convert to recommendation cards
    const cards = enhancedCandidates.map(candidate => ({
      id: candidate.id,
      title: candidate.name,
      subtitle: candidate.subtitle || `${candidate.category.replace('_', ' & ')} • ${candidate.route?.etaMinutes || 0} min away`,
      category: candidate.category,
      priceLevel: candidate.priceLevel || 1,
      estimatedCostPerPerson: candidate.estimatedCostPerPerson || 30,
      durationMinutes: candidate.durationMinutes || 90,
      rating: candidate.rating,
      reviewCount: candidate.reviewCount,
      imageUrl: candidate.imageUrl,
      address: candidate.address,
      location: candidate.location,
      route: candidate.route,
      copy: candidate.copy || {
        oneLiner: `Perfect ${candidate.category.replace('_', ' ')} spot you'll absolutely love`,
        tip: `Curated just for you - matches your style and budget perfectly`
      },
      source: candidate.source,
      placeId: candidate.placeId,
      startTime: candidate.startTime,
      // Add personalization metadata
      personalizationScore: candidate.personalizationScore,
      personalizationReasons: candidate.personalizationReasons || []
    }));

    return new Response(JSON.stringify({
      cards,
      meta: {
        totalResults: cards.length,
        processingTimeMs: Date.now() - startTime,
        sources: { 
          googlePlaces: places.status === 'fulfilled' ? places.value.length : 0, 
          eventbrite: events.status === 'fulfilled' ? events.value.length : 0 
        },
        llmUsed: true,
        userPersonalization: !!userPreferenceData,
        personalizationFactors: userPreferenceData ? {
          learnedPreferences: userPreferenceData.learnedPreferences.length,
          interactionHistory: userPreferenceData.interactionHistory.length,
          frequentLocations: userPreferenceData.locationContext.frequentLocations.length
        } : null
      }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('❌ Error in enhanced recommendations:', error);
    return new Response(JSON.stringify({
      error: error.message,
      meta: {
        processingTimeMs: Date.now() - startTime,
        userPersonalization: false
      }
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

// Get user preference data from database
async function getUserPreferenceData(userId: string): Promise<UserPreferenceData> {
  try {
    // Get learned preferences
    const { data: learnedPreferences, error: prefError } = await supabase
      .from('user_preference_learning')
      .select('*')
      .eq('user_id', userId)
      .order('preference_value', { ascending: false });

    if (prefError) {
      console.error('Error fetching learned preferences:', prefError);
    }

    // Get recent interaction history
    const { data: interactionHistory, error: interactionError } = await supabase
      .from('user_interactions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(100);

    if (interactionError) {
      console.error('Error fetching interaction history:', interactionError);
    }

    // Get frequent locations
    const { data: frequentLocations, error: locationError } = await supabase
      .rpc('get_user_frequent_locations', {
        user_uuid: userId,
        limit_count: 10
      });

    if (locationError) {
      console.error('Error fetching frequent locations:', locationError);
    }

    // Get location context
    const { data: locationHistory, error: locationHistoryError } = await supabase
      .from('user_location_history')
      .select('*')
      .eq('user_id', userId)
      .eq('location_type', 'current')
      .order('created_at', { ascending: false })
      .limit(1);

    let isAtHome = false;
    let isAtWork = false;

    if (locationHistory && locationHistory.length > 0) {
      const currentLocation = locationHistory[0];
      
      // Check if user is at home or work (simplified logic)
      const { data: homeLocation } = await supabase
        .from('user_location_history')
        .select('*')
        .eq('user_id', userId)
        .eq('location_type', 'home')
        .order('created_at', { ascending: false })
        .limit(1);

      const { data: workLocation } = await supabase
        .from('user_location_history')
        .select('*')
        .eq('user_id', userId)
        .eq('location_type', 'work')
        .order('created_at', { ascending: false })
        .limit(1);

      if (homeLocation && homeLocation.length > 0) {
        const distance = calculateDistance(
          currentLocation.latitude,
          currentLocation.longitude,
          homeLocation[0].latitude,
          homeLocation[0].longitude
        );
        isAtHome = distance <= 200; // Within 200 meters
      }

      if (workLocation && workLocation.length > 0) {
        const distance = calculateDistance(
          currentLocation.latitude,
          currentLocation.longitude,
          workLocation[0].latitude,
          workLocation[0].longitude
        );
        isAtWork = distance <= 200; // Within 200 meters
      }
    }

    return {
      learnedPreferences: learnedPreferences || [],
      interactionHistory: interactionHistory || [],
      locationContext: {
        frequentLocations: frequentLocations || [],
        isAtHome,
        isAtWork
      }
    };
  } catch (error) {
    console.error('Error getting user preference data:', error);
    return {
      learnedPreferences: [],
      interactionHistory: [],
      locationContext: {
        frequentLocations: [],
        isAtHome: false,
        isAtWork: false
      }
    };
  }
}

// Enhanced scoring function that incorporates user data
function scoreAndRankWithUserData(
  candidates: any[], 
  preferences: RecommendationsRequest, 
  userData: UserPreferenceData | null
): any[] {
  console.log('📈 Starting enhanced scoring for', candidates.length, 'candidates');
  
  // Category synonyms for tag overlap scoring
  const categoryKeywords = {
    'play_move': ['bowling', 'climbing', 'dance', 'skating', 'kayak', 'hike', 'pickleball', 'arcade', 'trampoline', 'mini golf', 'go kart', 'axe throwing', 'laser tag', 'escape room', 'basketball', 'tennis', 'badminton', 'gym', 'sports', 'recreation'],
    'dining': ['tasting menu', 'prix fixe', 'chef counter', 'omakase', 'wine pairing', 'fine dining', 'restaurant', 'steakhouse', 'seafood'],
    'sip': ['cocktail', 'wine', 'brewery', 'bar', 'coffee', 'tea', 'speakeasy'],
    'creative': ['pottery', 'painting', 'workshop', 'art', 'gallery', 'museum', 'craft'],
    'screen_relax': ['cinema', 'movie', 'theater', 'spa', 'massage'],
    'stroll': ['park', 'garden', 'trail', 'scenic', 'walk', 'botanical'],
    'casual_eats': ['pizza', 'burger', 'taco', 'food truck', 'deli', 'cafe']
  };

  candidates.forEach(candidate => {
    let score = 0;
    let personalizationScore = 0;
    const personalizationReasons: string[] = [];
    
    const candidateName = candidate.name.toLowerCase();
    const candidateAddress = (candidate.address || '').toLowerCase();
    const candidateTypes = candidate.placeTypes || [];

    // 1. CATEGORY MATCH (3.0 weight)
    const categoryMatch = preferences.categories.includes(candidate.category) ? 1 : 0;
    score += 3.0 * categoryMatch;

    // 2. EXPERIENCE TYPE BADGE MATCH (2.5 weight) - Enhanced badge system
    let experienceMatch = 0;
    if (preferences.experienceTypes?.length) {
      // Calculate badges for this candidate
      const { badges, reasonCodes } = calculateExperienceTypeBadges(candidate);
      candidate.badges = badges;
      candidate.reasonCodes = reasonCodes;
      
      // Check if any of the user's preferred experience types match the candidate's badges
      experienceMatch = preferences.experienceTypes.some(expType => 
        badges.includes(expType.toLowerCase())
      ) ? 1 : 0;
      
      // Bonus for multiple matching badges
      const matchingBadges = preferences.experienceTypes.filter(expType => 
        badges.includes(expType.toLowerCase())
      ).length;
      if (matchingBadges > 1) {
        experienceMatch += 0.2; // Bonus for multiple badge matches
      }
    }
    score += 2.5 * experienceMatch;

    // 3. TAG OVERLAP (1.6 weight)
    const keywords = categoryKeywords[candidate.category] || [];
    const tagOverlap = keywords.filter(keyword => 
      candidateName.includes(keyword) || 
      candidateAddress.includes(keyword) ||
      candidateTypes.some(type => type.includes(keyword.replace(' ', '_')))
    ).length / Math.max(keywords.length, 1);
    score += 1.6 * tagOverlap;

    // 4. EMBEDDING SIMILARITY (1.3 weight)
    const queryTerms = [...preferences.categories, ...(preferences.experienceTypes || [])];
    const textSimilarity = queryTerms.filter(term => 
      candidateName.includes(term) || candidateAddress.includes(term)
    ).length / Math.max(queryTerms.length, 1);
    score += 1.3 * textSimilarity;

    // 5. GROUP SIZE MATCH (1.2 weight) - venue suitability for group size
    let groupSizeScore = 0;
    if (preferences.groupSize) {
      groupSizeScore = calculateGroupSizeScore(candidate, preferences.groupSize);
    }
    score += 1.2 * groupSizeScore;

    // 6. POPULARITY (0.6 weight)
    let popularity = 0;
    if (candidate.rating && candidate.reviewCount) {
      const ratingScore = candidate.rating / 5.0;
      const reviewScore = Math.min(Math.log10(candidate.reviewCount + 1) / 4, 1);
      popularity = (ratingScore + reviewScore) / 2;
    }
    score += 0.6 * popularity;

    // 6. QUALITY (0.4 weight)
    let quality = 0;
    const hasImage = candidate.imageUrl ? 0.25 : 0;
    const hasRating = candidate.rating ? 0.25 : 0;
    const hasAddress = candidate.address ? 0.25 : 0;
    const hasHours = candidate.openingHours ? 0.25 : 0;
    quality = hasImage + hasRating + hasAddress + hasHours;
    score += 0.4 * quality;

    // 7. USER PERSONALIZATION (NEW - 2.0 weight)
    if (userData) {
      // Category preference boost
      const categoryPreference = userData.learnedPreferences.find(
        p => p.preference_type === 'category' && p.preference_key === candidate.category
      );
      if (categoryPreference && categoryPreference.preference_value > 0) {
        const categoryBoost = categoryPreference.preference_value * categoryPreference.confidence;
        personalizationScore += categoryBoost * 1.5;
        personalizationReasons.push(`Matches your ${candidate.category} preference`);
      }

      // Time preference boost
      const timeOfDay = getTimeOfDay();
      const timePreference = userData.learnedPreferences.find(
        p => p.preference_type === 'time' && p.preference_key === timeOfDay
      );
      if (timePreference && timePreference.preference_value > 0) {
        const timeBoost = timePreference.preference_value * timePreference.confidence;
        personalizationScore += timeBoost * 0.5;
        personalizationReasons.push(`Matches your ${timeOfDay} activity preference`);
      }

      // Location preference boost
      if (userData.locationContext.frequentLocations.length > 0) {
        const candidateLocation = { lat: candidate.location.lat, lng: candidate.location.lng };
        for (const frequentLocation of userData.locationContext.frequentLocations) {
          const distance = calculateDistance(
            candidateLocation.lat,
            candidateLocation.lng,
            frequentLocation.latitude,
            frequentLocation.longitude
          );
          
          // Boost if near frequent locations
          if (distance <= 1000) { // Within 1km
            const locationBoost = Math.max(0, (1000 - distance) / 1000) * 0.3;
            personalizationScore += locationBoost;
            personalizationReasons.push(`Near your frequent location`);
            break;
          }
        }
      }

      // Interaction history boost
      const similarInteractions = userData.interactionHistory.filter(
        interaction => interaction.interaction_data?.category === candidate.category
      );
      if (similarInteractions.length > 0) {
        const positiveInteractions = similarInteractions.filter(
          interaction => ['like', 'save', 'schedule'].includes(interaction.interaction_type)
        ).length;
        const totalInteractions = similarInteractions.length;
        
        if (totalInteractions > 0) {
          const interactionBoost = (positiveInteractions / totalInteractions) * 0.8;
          personalizationScore += interactionBoost;
          personalizationReasons.push(`Based on your ${candidate.category} activity history`);
        }
      }

      // Context-aware boosts
      if (userData.locationContext.isAtHome) {
        // Boost activities that are good for going out from home
        if (['dining', 'sip', 'screen_relax'].includes(candidate.category)) {
          personalizationScore += 0.2;
          personalizationReasons.push(`Great for going out from home`);
        }
      }

      if (userData.locationContext.isAtWork) {
        // Boost activities that are good for after work
        if (['sip', 'casual_eats', 'screen_relax'].includes(candidate.category)) {
          personalizationScore += 0.2;
          personalizationReasons.push(`Perfect for after work`);
        }
      }
    }

    // Add personalization score to main score
    score += personalizationScore * 2.0;

    // Store scores and reasons
    candidate.score = score;
    candidate.personalizationScore = personalizationScore;
    candidate.personalizationReasons = personalizationReasons;
  });

  // Sort by score (highest first)
  return candidates.sort((a, b) => b.score - a.score);
}

// Helper function to get time of day
function getTimeOfDay(): string {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night';
}

// Helper function to calculate distance between two points
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3; // Earth's radius in meters
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

  return R * c; // Distance in meters
}

// Helper function to check experience type matching
function matchesExperienceTypeForScoring(candidate: any, expType: string): boolean {
  // Simplified experience type matching
  const experienceTypeMappings: Record<string, string[]> = {
    'business': ['restaurant', 'cafe', 'coffee_shop'],
    'romantic': ['restaurant', 'bar', 'cocktail_lounge', 'park', 'garden'],
    'group_fun': ['bowling_alley', 'arcade', 'amusement_park', 'sports_complex'],
    'solo_adventure': ['park', 'garden', 'museum', 'art_gallery'],
    'first_date': ['restaurant', 'bar', 'coffee_shop', 'park', 'museum'],
    'friendly': ['restaurant', 'bar', 'cafe', 'park', 'sports_complex']
  };

  const candidateTypes = candidate.placeTypes || [];
  const relevantTypes = experienceTypeMappings[expType] || [];
  
  return relevantTypes.some(type => candidateTypes.includes(type));
}

// Include the existing helper functions from the original recommendations function
async function fetchGooglePlaces(preferences: RecommendationsRequest): Promise<any[]> {
  if (!GOOGLE_API_KEY) {
    console.warn('⚠️ Google API key not available');
    return [];
  }

  const allPlaces: any[] = [];
  const { lat, lng } = preferences.origin;
  const radius = preferences.travel.constraint.type === 'DISTANCE' 
    ? Math.min((preferences.travel.constraint.maxDistance || 5) * 1000, 50000)
    : 10000; // Default 10km radius

  for (const category of preferences.categories) {
    const categoryMapping = CATEGORY_MAPPINGS[category];
    if (!categoryMapping) continue;
    
    const placeTypes = categoryMapping.places || ['tourist_attraction'];
    
    for (const placeType of placeTypes.slice(0, 3)) {
      try {
        const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${radius}&type=${placeType}&key=${GOOGLE_API_KEY}`;
        
        const response = await fetch(url);
        if (!response.ok) continue;
        
        const data = await response.json();
        if (data.results?.length) {
          const places = data.results.slice(0, 10).map((place: any) => ({
            id: place.place_id,
            name: place.name,
            category,
            location: {
              lat: place.geometry.location.lat,
              lng: place.geometry.location.lng
            },
            address: place.vicinity || place.formatted_address,
            priceLevel: place.price_level,
            rating: place.rating,
            reviewCount: place.user_ratings_total,
            imageUrl: place.photos?.[0] ? 
              `https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photoreference=${place.photos[0].photo_reference}&key=${GOOGLE_API_KEY}` 
              : null,
            placeId: place.place_id,
            openingHours: place.opening_hours,
            source: 'google_places',
            description: '',
            placeTypes: place.types || []
          }));
          
          allPlaces.push(...places);
        }
      } catch (error) {
        console.error(`Error fetching ${placeType}:`, error);
      }
    }
  }

  return allPlaces;
}

async function fetchEventbriteEvents(preferences: RecommendationsRequest): Promise<any[]> {
  // Simplified Eventbrite integration - you can expand this
  return [];
}

async function annotateWithTravel(candidates: any[], preferences: RecommendationsRequest): Promise<any[]> {
  // Simplified travel annotation - you can expand this
  return candidates.map(candidate => ({
    ...candidate,
    route: {
      etaMinutes: Math.floor(Math.random() * 30) + 5,
      distanceText: `${Math.floor(Math.random() * 10) + 1} km`,
      mode: preferences.travel.mode.toLowerCase(),
      mapsDeepLink: `https://maps.google.com/?daddr=${candidate.location.lat},${candidate.location.lng}`
    }
  }));
}

function filterByConstraints(candidates: any[], preferences: RecommendationsRequest): any[] {
  // Simplified filtering - you can expand this
  return candidates.filter(candidate => {
    // Basic budget filtering
    if (candidate.priceLevel && preferences.budget) {
      const maxPriceLevel = Math.ceil(preferences.budget.max / 50);
      return candidate.priceLevel <= maxPriceLevel;
    }
    return true;
  });
}

async function enhanceWithLLM(candidates: any[], preferences: RecommendationsRequest): Promise<any[]> {
  // Enhanced LLM personalization with OpenAI
  const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
  if (!OPENAI_API_KEY) {
    console.warn('⚠️ OpenAI API key not available, using fallback copy');
    return candidates.map(candidate => ({
      ...candidate,
      copy: {
        oneLiner: `Discover ${candidate.name} - a perfect ${candidate.category.replace('_', ' ')} experience.`,
        tip: `Great for ${candidate.category.replace('_', ' ')} enthusiasts looking for something new.`
      }
    }));
  }

  const enhancedCandidates = await Promise.all(candidates.slice(0, 10).map(async (candidate) => {
    try {
      const prompt = `Generate personalized, engaging copy for this ${candidate.source === 'eventbrite' ? 'event' : 'place'}:

Name: ${candidate.name}
Category: ${candidate.category}
Location: ${candidate.address}
${candidate.rating ? `Rating: ${candidate.rating}/5` : ''}
${candidate.estimatedCost ? `Cost: $${candidate.estimatedCost}` : ''}
${candidate.source === 'eventbrite' ? `Event Time: ${candidate.startTime}` : ''}
${candidate.budgetNearMiss ? `Budget Note: Slightly above your $${preferences.budget.min}-${preferences.budget.max} range ($${candidate.estimatedCost} per person)` : ''}

User preferences: ${preferences.categories.join(', ')}, Budget: $${preferences.budget.min}-${preferences.budget.max}
Group Size: ${preferences.groupSize || 2} ${preferences.groupSize === 1 ? 'person (solo)' : preferences.groupSize === 2 ? 'people (couple)' : preferences.groupSize >= 3 && preferences.groupSize <= 6 ? 'people (small group)' : 'people (large group)'}

Respond with JSON only:
{
  "oneLiner": "personalized description that speaks directly to the user (max 14 words)",
  "tip": "specific, actionable tip tailored to this place and user preferences (max 18 words)"
}

Guidelines:
- Write as if speaking directly to the user
- Use "you" and "your" to make it personal
- Reference the specific place name and location
- Consider group size: ${preferences.groupSize === 1 ? 'perfect for solo exploration' : preferences.groupSize === 2 ? 'ideal for a romantic couple' : preferences.groupSize >= 3 && preferences.groupSize <= 6 ? 'great for a small group of friends' : 'perfect for a large group gathering'}
${candidate.budgetNearMiss ? '- If slightly above budget, frame it as "worth the stretch" or "slightly above your budget but highly rated"' : ''}
- No hallucinated facts about hours, prices, or availability
- No promises about what will be available
- Focus on atmosphere, experience, and why this place is perfect for their group size
- Be concise and compelling`;

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 100,
          temperature: 0.7
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const content = data.choices[0].message.content;
        const parsed = JSON.parse(content);
        return {
          ...candidate,
          copy: {
            oneLiner: parsed.oneLiner || `Discover ${candidate.name} - a perfect ${candidate.category.replace('_', ' ')} experience.`,
            tip: parsed.tip || `Great for ${candidate.category.replace('_', ' ')} enthusiasts looking for something new.`
          }
        };
      }
    } catch (error) {
      console.error('LLM enhancement error for candidate:', candidate.id, error);
    }
    
    return {
      ...candidate,
      copy: {
        oneLiner: `Discover ${candidate.name} - a perfect ${candidate.category.replace('_', ' ')} experience.`,
        tip: `Great for ${candidate.category.replace('_', ' ')} enthusiasts looking for something new.`
      }
    };
  }));

  return enhancedCandidates;
}

// Group Size Scoring Function
function calculateGroupSizeScore(candidate: any, groupSize: number): number {
  const candidateName = candidate.name.toLowerCase();
  const candidateTypes = candidate.placeTypes || [];
  const candidateAddress = (candidate.address || '').toLowerCase();
  
  // Solo activities (groupSize = 1)
  if (groupSize === 1) {
    const soloKeywords = ['museum', 'library', 'gallery', 'exhibit', 'workshop', 'class', 'trail', 'hiking', 'walking', 'solo', 'individual'];
    const soloTypes = ['museum', 'library', 'art_gallery', 'park', 'hiking_area'];
    
    const soloMatch = soloKeywords.some(keyword => 
      candidateName.includes(keyword) || candidateAddress.includes(keyword)
    ) || soloTypes.some(type => candidateTypes.includes(type));
    
    return soloMatch ? 1.0 : 0.3;
  }
  
  // Couple activities (groupSize = 2)
  if (groupSize === 2) {
    const coupleKeywords = ['romantic', 'intimate', 'cozy', 'date', 'couple', 'dinner', 'wine', 'rooftop', 'lounge', 'candlelit'];
    const coupleTypes = ['restaurant', 'bar', 'lounge', 'wine_bar', 'rooftop_bar', 'romantic_spot'];
    
    const coupleMatch = coupleKeywords.some(keyword => 
      candidateName.includes(keyword) || candidateAddress.includes(keyword)
    ) || coupleTypes.some(type => candidateTypes.includes(type));
    
    return coupleMatch ? 1.0 : 0.5;
  }
  
  // Small group activities (3-6 people)
  if (groupSize >= 3 && groupSize <= 6) {
    const smallGroupKeywords = ['karaoke', 'escape', 'trivia', 'game', 'arcade', 'bowling', 'mini_golf', 'group', 'team', 'social'];
    const smallGroupTypes = ['entertainment', 'recreation', 'game_center', 'bowling_alley', 'karaoke_bar', 'arcade'];
    
    const smallGroupMatch = smallGroupKeywords.some(keyword => 
      candidateName.includes(keyword) || candidateAddress.includes(keyword)
    ) || smallGroupTypes.some(type => candidateTypes.includes(type));
    
    return smallGroupMatch ? 1.0 : 0.6;
  }
  
  // Large group activities (7+ people)
  if (groupSize >= 7) {
    const largeGroupKeywords = ['brewery', 'festival', 'event', 'venue', 'hall', 'convention', 'party', 'celebration', 'group_friendly'];
    const largeGroupTypes = ['brewery', 'event_venue', 'convention_center', 'festival_grounds', 'large_venue', 'group_venue'];
    
    const largeGroupMatch = largeGroupKeywords.some(keyword => 
      candidateName.includes(keyword) || candidateAddress.includes(keyword)
    ) || largeGroupTypes.some(type => candidateTypes.includes(type));
    
    return largeGroupMatch ? 1.0 : 0.4;
  }
  
  return 0.5; // Default score
}

// Enhanced Experience Type Badge System (same as in recommendations/index.ts)
function calculateExperienceTypeBadges(candidate: any): { badges: string[], reasonCodes: Record<string, string> } {
  const badges: string[] = [];
  const reasonCodes: Record<string, string> = {};
  
  const candidateName = candidate.name.toLowerCase();
  const candidateTypes = candidate.placeTypes || [];
  const candidateAddress = (candidate.address || '').toLowerCase();
  
  // Check each experience type
  for (const [type, rules] of Object.entries(EXPERIENCE_TYPE_RULES)) {
    const score = calculateExperienceTypeScore(candidate, type);
    const hasRequired = checkRequiredAttributes(candidate, rules.required);
    const hasForbidden = checkForbiddenAttributes(candidate, rules.forbidden);
    
    if (score >= rules.min_score && hasRequired && !hasForbidden) {
      badges.push(type);
      reasonCodes[type] = generateReasonCode(candidate, type, score);
    }
  }
  
  return { badges, reasonCodes };
}

function calculateExperienceTypeScore(candidate: any, type: string): number {
  const scoring = EXPERIENCE_TYPE_SCORING[type];
  if (!scoring) return 0;
  
  let totalScore = 0;
  const candidateName = candidate.name.toLowerCase();
  const candidateTypes = candidate.placeTypes || [];
  const candidateAddress = (candidate.address || '').toLowerCase();
  
  // Calculate weighted score based on features
  for (const [feature, weight] of Object.entries(scoring)) {
    const featureScore = calculateFeatureScore(candidate, feature, type);
    totalScore += featureScore * weight;
  }
  
  return Math.min(1.0, totalScore);
}

function calculateFeatureScore(candidate: any, feature: string, type: string): number {
  const candidateName = candidate.name.toLowerCase();
  const candidateTypes = candidate.placeTypes || [];
  const candidateAddress = (candidate.address || '').toLowerCase();
  
  // Feature-specific scoring logic
  switch (feature) {
    case 'ambience':
      return checkAmbienceFeatures(candidate, type);
    case 'privacy':
      return checkPrivacyFeatures(candidate, type);
    case 'conversation_friendly':
      return checkConversationFeatures(candidate);
    case 'wifi':
      return checkWifiFeatures(candidate);
    case 'capacity':
      return checkCapacityFeatures(candidate);
    case 'safe':
      return checkSafetyFeatures(candidate);
    default:
      return 0.5; // Default score
  }
}

function checkAmbienceFeatures(candidate: any, type: string): number {
  const candidateName = candidate.name.toLowerCase();
  const candidateTypes = candidate.placeTypes || [];
  
  if (type === 'romantic') {
    const romanticKeywords = ['romantic', 'intimate', 'cozy', 'candlelit', 'scenic', 'sunset', 'rooftop', 'wine'];
    const romanticTypes = ['restaurant', 'bar', 'lounge', 'wine_bar', 'rooftop_bar'];
    
    const keywordMatch = romanticKeywords.some(keyword => candidateName.includes(keyword));
    const typeMatch = romanticTypes.some(type => candidateTypes.includes(type));
    
    return (keywordMatch ? 0.7 : 0.3) + (typeMatch ? 0.3 : 0);
  }
  
  return 0.5;
}

function checkPrivacyFeatures(candidate: any, type: string): number {
  const candidateName = candidate.name.toLowerCase();
  const candidateTypes = candidate.placeTypes || [];
  
  if (type === 'romantic') {
    const intimateKeywords = ['booth', 'private', 'intimate', 'corner', 'quiet'];
    const intimateTypes = ['restaurant', 'lounge', 'wine_bar'];
    
    const keywordMatch = intimateKeywords.some(keyword => candidateName.includes(keyword));
    const typeMatch = intimateTypes.some(type => candidateTypes.includes(type));
    
    return (keywordMatch ? 0.8 : 0.4) + (typeMatch ? 0.2 : 0);
  }
  
  return 0.5;
}

function checkConversationFeatures(candidate: any): number {
  const candidateName = candidate.name.toLowerCase();
  const candidateTypes = candidate.placeTypes || [];
  
  const conversationKeywords = ['quiet', 'cozy', 'intimate', 'conversation', 'table'];
  const conversationTypes = ['restaurant', 'cafe', 'lounge', 'bar'];
  
  const keywordMatch = conversationKeywords.some(keyword => candidateName.includes(keyword));
  const typeMatch = conversationTypes.some(type => candidateTypes.includes(type));
  
  return (keywordMatch ? 0.7 : 0.3) + (typeMatch ? 0.3 : 0);
}

function checkWifiFeatures(candidate: any): number {
  const candidateName = candidate.name.toLowerCase();
  const candidateTypes = candidate.placeTypes || [];
  
  const wifiKeywords = ['wifi', 'internet', 'coworking', 'laptop', 'work'];
  const wifiTypes = ['cafe', 'restaurant', 'coworking_space', 'library'];
  
  const keywordMatch = wifiKeywords.some(keyword => candidateName.includes(keyword));
  const typeMatch = wifiTypes.some(type => candidateTypes.includes(type));
  
  return (keywordMatch ? 0.9 : 0.1) + (typeMatch ? 0.1 : 0);
}

function checkCapacityFeatures(candidate: any): number {
  const candidateName = candidate.name.toLowerCase();
  const candidateTypes = candidate.placeTypes || [];
  
  const capacityKeywords = ['group', 'party', 'large', 'venue', 'hall', 'space'];
  const capacityTypes = ['entertainment', 'recreation', 'event_venue', 'convention_center'];
  
  const keywordMatch = capacityKeywords.some(keyword => candidateName.includes(keyword));
  const typeMatch = capacityTypes.some(type => candidateTypes.includes(type));
  
  return (keywordMatch ? 0.8 : 0.2) + (typeMatch ? 0.2 : 0);
}

function checkSafetyFeatures(candidate: any): number {
  const candidateName = candidate.name.toLowerCase();
  const candidateTypes = candidate.placeTypes || [];
  
  const safeKeywords = ['safe', 'secure', 'well_lit', 'public', 'monitored'];
  const safeTypes = ['museum', 'library', 'park', 'gallery', 'cafe'];
  
  const keywordMatch = safeKeywords.some(keyword => candidateName.includes(keyword));
  const typeMatch = safeTypes.some(type => candidateTypes.includes(type));
  
  return (keywordMatch ? 0.8 : 0.2) + (typeMatch ? 0.2 : 0);
}

function checkRequiredAttributes(candidate: any, required: string[]): boolean {
  const candidateName = candidate.name.toLowerCase();
  const candidateTypes = candidate.placeTypes || [];
  const candidateAddress = (candidate.address || '').toLowerCase();
  
  return required.some(attr => {
    const attrKeywords = getAttributeKeywords(attr);
    return attrKeywords.some(keyword => 
      candidateName.includes(keyword) || 
      candidateAddress.includes(keyword) ||
      candidateTypes.some(type => type.includes(keyword))
    );
  });
}

function checkForbiddenAttributes(candidate: any, forbidden: string[]): boolean {
  const candidateName = candidate.name.toLowerCase();
  const candidateTypes = candidate.placeTypes || [];
  const candidateAddress = (candidate.address || '').toLowerCase();
  
  return forbidden.some(attr => {
    const attrKeywords = getAttributeKeywords(attr);
    return attrKeywords.some(keyword => 
      candidateName.includes(keyword) || 
      candidateAddress.includes(keyword) ||
      candidateTypes.some(type => type.includes(keyword))
    );
  });
}

function getAttributeKeywords(attribute: string): string[] {
  const attributeMap: Record<string, string[]> = {
    'romantic_ambience': ['romantic', 'intimate', 'cozy', 'candlelit'],
    'intimate_seating': ['booth', 'corner', 'private', 'intimate'],
    'scenic_view': ['view', 'scenic', 'sunset', 'rooftop', 'terrace'],
    'candlelight': ['candle', 'candlelit', 'dim', 'soft'],
    'date_spot': ['date', 'romantic', 'couple'],
    'conversation_friendly': ['quiet', 'cozy', 'intimate', 'table'],
    'comfortable_seating': ['comfortable', 'seating', 'chair', 'booth'],
    'moderate_noise': ['quiet', 'moderate', 'calm'],
    'easy_parking': ['parking', 'valet', 'street'],
    'wifi': ['wifi', 'internet', 'wireless'],
    'quiet': ['quiet', 'silent', 'peaceful'],
    'reservation_possible': ['reservation', 'booking', 'reserve'],
    'work_friendly': ['work', 'laptop', 'business', 'meeting'],
    'professional_setting': ['professional', 'business', 'corporate'],
    'team_based': ['team', 'group', 'multiplayer', 'collaborative'],
    'capacity_group_friendly': ['group', 'party', 'large', 'venue'],
    'multiplayer': ['multiplayer', 'multi', 'group', 'team'],
    'group_activity': ['group', 'team', 'social', 'activity'],
    'social': ['social', 'party', 'group', 'community'],
    'safe_solo': ['safe', 'secure', 'public', 'monitored'],
    'individual_activity': ['individual', 'solo', 'personal', 'self'],
    'self_guided': ['self', 'guided', 'tour', 'walk'],
    'solo_friendly': ['solo', 'individual', 'personal'],
    'casual': ['casual', 'relaxed', 'informal', 'easy'],
    'budget_friendly': ['budget', 'affordable', 'cheap', 'inexpensive'],
    'easy_meetup': ['easy', 'meetup', 'accessible', 'convenient']
  };
  
  return attributeMap[attribute] || [attribute];
}

function generateReasonCode(candidate: any, type: string, score: number): string {
  const candidateName = candidate.name.toLowerCase();
  const candidateTypes = candidate.placeTypes || [];
  const candidateAddress = (candidate.address || '').toLowerCase();
  
  const reasons: string[] = [];
  
  // Generate specific reason codes based on type and features
  switch (type) {
    case 'romantic':
      if (candidateName.includes('candle') || candidateName.includes('candlelit')) {
        reasons.push('candlelit atmosphere');
      }
      if (candidateName.includes('rooftop') || candidateName.includes('view')) {
        reasons.push('scenic view');
      }
      if (candidateTypes.includes('restaurant') || candidateTypes.includes('wine_bar')) {
        reasons.push('intimate dining');
      }
      if (candidateName.includes('booth') || candidateName.includes('private')) {
        reasons.push('private seating');
      }
      break;
      
    case 'first_date':
      if (candidateName.includes('quiet') || candidateName.includes('cozy')) {
        reasons.push('quiet conversation-friendly');
      }
      if (candidate.rating && candidate.rating >= 4.0) {
        reasons.push('highly rated');
      }
      if (candidateName.includes('parking') || candidateAddress.includes('parking')) {
        reasons.push('easy parking');
      }
      break;
      
    case 'business':
      if (candidateName.includes('wifi') || candidateName.includes('internet')) {
        reasons.push('Wi-Fi available');
      }
      if (candidateName.includes('quiet') || candidateName.includes('private')) {
        reasons.push('quiet professional setting');
      }
      if (candidateName.includes('meeting') || candidateName.includes('conference')) {
        reasons.push('meeting space');
      }
      break;
      
    case 'group_fun':
      if (candidateName.includes('bowling') || candidateName.includes('arcade')) {
        reasons.push('multiplayer activities');
      }
      if (candidateName.includes('karaoke') || candidateName.includes('trivia')) {
        reasons.push('group entertainment');
      }
      if (candidateName.includes('party') || candidateName.includes('celebration')) {
        reasons.push('celebratory vibe');
      }
      break;
      
    case 'solo_adventure':
      if (candidateTypes.includes('museum') || candidateTypes.includes('gallery')) {
        reasons.push('self-paced exploration');
      }
      if (candidateName.includes('trail') || candidateName.includes('hiking')) {
        reasons.push('safe solo activity');
      }
      if (candidateName.includes('library') || candidateName.includes('quiet')) {
        reasons.push('introspective space');
      }
      break;
      
    case 'friendly':
      if (candidateName.includes('casual') || candidateName.includes('relaxed')) {
        reasons.push('casual atmosphere');
      }
      if (candidate.rating && candidate.rating >= 4.0) {
        reasons.push('highly rated');
      }
      if (candidateName.includes('budget') || candidateName.includes('affordable')) {
        reasons.push('budget-friendly');
      }
      break;
  }
  
  return reasons.length > 0 ? reasons.join(', ') : `${type} suitable venue`;
}

/**
 * Phase 2: Apply advanced ML personalization
 */
async function applyAdvancedMLPersonalization(
  candidates: any[],
  userId: string,
  preferences: any
): Promise<any[]> {
  try {
    console.log('🧠 Applying advanced ML personalization...');

    // Get user's interaction history for ML analysis
    const { data: interactions, error: interactionsError } = await supabase
      .from('user_interactions')
      .select('*')
      .eq('user_id', userId)
      .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
      .order('created_at', { ascending: false });

    if (interactionsError) {
      console.error('Error fetching interactions for ML:', interactionsError);
      return candidates;
    }

    // Get user's learned preferences
    const { data: learnedPrefs, error: learnedError } = await supabase
      .from('user_preference_learning')
      .select('*')
      .eq('user_id', userId);

    if (learnedError) {
      console.error('Error fetching learned preferences:', learnedError);
      return candidates;
    }

    // Apply ML enhancements to each candidate
    const mlEnhancedCandidates = candidates.map(candidate => {
      const mlScore = calculateMLScore(candidate, interactions || [], learnedPrefs || []);
      const timeScore = calculateTimeBasedScore(candidate, interactions || []);
      const socialScore = calculateSocialScore(candidate, userId);
      
      // Combine scores with weights
      const finalScore = (
        candidate.personalizationScore * 0.4 +
        mlScore * 0.3 +
        timeScore * 0.2 +
        socialScore * 0.1
      );

      return {
        ...candidate,
        personalizationScore: Math.min(100, finalScore),
        mlFactors: {
          mlScore,
          timeScore,
          socialScore,
          interactionCount: interactions?.length || 0,
          learnedPreferenceCount: learnedPrefs?.length || 0
        }
      };
    });

    // Sort by enhanced score
    mlEnhancedCandidates.sort((a, b) => b.personalizationScore - a.personalizationScore);

    console.log('✅ ML personalization applied to', mlEnhancedCandidates.length, 'candidates');
    return mlEnhancedCandidates;
  } catch (error) {
    console.error('Error in ML personalization:', error);
    return candidates;
  }
}

/**
 * Calculate ML-based score for a candidate
 */
function calculateMLScore(candidate: any, interactions: any[], learnedPrefs: any[]): number {
  let score = 50; // Base score

  // Analyze category preferences
  const categoryInteractions = interactions.filter(i => 
    i.interaction_data?.category === candidate.category
  );
  
  if (categoryInteractions.length > 0) {
    const positiveInteractions = categoryInteractions.filter(i => 
      ['like', 'save', 'share'].includes(i.interaction_type)
    ).length;
    const categoryScore = (positiveInteractions / categoryInteractions.length) * 100;
    score += (categoryScore - 50) * 0.3;
  }

  // Apply learned preferences
  const relevantPrefs = learnedPrefs.filter(p => 
    (p.preference_type === 'category' && p.preference_key === candidate.category) ||
    (p.preference_type === 'price' && Math.abs(p.preference_value - candidate.estimatedCostPerPerson) < 20)
  );

  if (relevantPrefs.length > 0) {
    const avgPreference = relevantPrefs.reduce((sum, p) => sum + p.preference_value, 0) / relevantPrefs.length;
    score += (avgPreference * 50) * 0.4; // Convert -1 to 1 range to score impact
  }

  return Math.max(0, Math.min(100, score));
}

/**
 * Calculate time-based score for a candidate
 */
function calculateTimeBasedScore(candidate: any, interactions: any[]): number {
  const now = new Date();
  const currentHour = now.getHours();
  const currentDay = now.getDay(); // 0 = Sunday, 6 = Saturday

  // Analyze time patterns from interactions
  const timeInteractions = interactions.filter(i => {
    const interactionTime = new Date(i.created_at);
    const interactionHour = interactionTime.getHours();
    const interactionDay = interactionTime.getDay();
    
    // Check if interaction was at similar time/day
    return Math.abs(interactionHour - currentHour) <= 2 && interactionDay === currentDay;
  });

  if (timeInteractions.length > 0) {
    const positiveTimeInteractions = timeInteractions.filter(i => 
      ['like', 'save', 'share'].includes(i.interaction_type)
    ).length;
    
    return (positiveTimeInteractions / timeInteractions.length) * 100;
  }

  // Default time-based scoring
  const hour = parseInt(candidate.startTime.split(':')[0]);
  if (currentHour >= 6 && currentHour <= 10 && hour >= 6 && hour <= 10) return 80; // Morning
  if (currentHour >= 11 && currentHour <= 16 && hour >= 11 && hour <= 16) return 75; // Afternoon
  if (currentHour >= 17 && currentHour <= 21 && hour >= 17 && hour <= 21) return 85; // Evening
  if (currentHour >= 22 || currentHour <= 5) return 60; // Night

  return 50; // Neutral
}

/**
 * Calculate social score for a candidate
 */
function calculateSocialScore(candidate: any, userId: string): number {
  // This would integrate with collaborative filtering
  // For now, return a base score with some variation
  const baseScore = 50;
  const variation = Math.random() * 20 - 10; // -10 to +10
  return Math.max(0, Math.min(100, baseScore + variation));
}
