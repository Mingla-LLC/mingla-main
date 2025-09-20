import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Environment variables
const GOOGLE_API_KEY = Deno.env.get('GOOGLE_MAPS_API_KEY');
const EVENTBRITE_TOKEN = Deno.env.get('EVENTBRITE_TOKEN');
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');

// Category to Google Places types mapping
const CATEGORY_TO_PLACE_TYPES: Record<string, string[]> = {
  'stroll': ['park', 'tourist_attraction', 'point_of_interest', 'natural_feature', 'zoo'],
  'sip': ['bar', 'cafe', 'night_club', 'wine_bar', 'coffee_shop'],
  'casual_eats': ['restaurant', 'food_court', 'meal_takeaway', 'fast_food_restaurant'],
  'screen_relax': ['movie_theater', 'spa', 'beauty_salon'],
  'creative': ['art_gallery', 'museum', 'pottery_studio', 'craft_store'],
  'play_move': ['bowling_alley', 'gym', 'sports_complex', 'recreation_center'],
  'dining': ['restaurant', 'fine_dining_restaurant', 'steakhouse'],
  'freestyle': ['restaurant', 'bar', 'cafe', 'tourist_attraction', 'art_gallery']
};

// LLM cache for generated copy
const llmCache = new Map<string, { oneLiner: string; tip: string; expires: number }>();

interface RecommendationsRequest {
  budget: { min: number; max: number; perPerson: boolean };
  categories: string[];
  timeWindow: { kind: string; start?: string; end?: string; timeOfDay?: string };
  travel: { mode: string; constraint: { type: string; maxMinutes?: number; maxDistance?: number } };
  origin: { lat: number; lng: number };
  units: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  console.log('🎯 Recommendations endpoint called');

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
          llmUsed: false
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

    // Score and rank candidates
    const rankedCandidates = scoreAndRank(filteredCandidates, preferences);
    console.log('📈 Scored and ranked', rankedCandidates.length, 'candidates');

    // Apply diversity and take top results
    const diversifiedCandidates = applyDiversity(rankedCandidates, preferences.categories);
    const topCandidates = diversifiedCandidates.slice(0, 20);

    // Enrich with LLM-generated copy
    let llmUsed = false;
    if (OPENAI_API_KEY && topCandidates.length > 0) {
      try {
        await enrichWithLLM(topCandidates, preferences);
        llmUsed = true;
        console.log('🤖 LLM enrichment completed');
      } catch (error) {
        console.error('⚠️ LLM enrichment failed:', error);
        // Continue without LLM copy
        addFallbackCopy(topCandidates);
      }
    } else {
      addFallbackCopy(topCandidates);
    }

    // Convert to final card format
    const cards = await convertToCards(topCandidates, preferences);

    const response = {
      cards,
      meta: {
        totalResults: allCandidates.length,
        processingTimeMs: Date.now() - startTime,
        sources: {
          googlePlaces: places.status === 'fulfilled' ? places.value.length : 0,
          eventbrite: events.status === 'fulfilled' ? events.value.length : 0
        },
        llmUsed
      }
    };

    console.log(`✅ Returning ${cards.length} cards in ${Date.now() - startTime}ms`);
    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('❌ Error in recommendations:', error);
    return new Response(JSON.stringify({
      error: error.message,
      cards: [],
      meta: {
        totalResults: 0,
        processingTimeMs: Date.now() - startTime,
        sources: { googlePlaces: 0, eventbrite: 0 },
        llmUsed: false
      }
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

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
    const placeTypes = CATEGORY_TO_PLACE_TYPES[category] || ['tourist_attraction'];
    
    for (const placeType of placeTypes.slice(0, 2)) { // Limit to 2 types per category
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
            source: 'google_places'
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
  if (!EVENTBRITE_TOKEN) {
    console.warn('⚠️ Eventbrite token not available');
    return [];
  }

  try {
    const { lat, lng } = preferences.origin;
    const radius = preferences.travel.constraint.type === 'DISTANCE' 
      ? Math.min((preferences.travel.constraint.maxDistance || 5), 50)
      : 25; // Default 25km radius

    // Map time window to date range
    let startDate = new Date();
    let endDate = new Date();
    
    switch (preferences.timeWindow.kind) {
      case 'Now':
        endDate.setHours(23, 59, 59);
        break;
      case 'Tonight':
        startDate.setHours(17, 0, 0);
        endDate.setHours(23, 59, 59);
        break;
      case 'ThisWeekend':
        const today = new Date();
        const dayOfWeek = today.getDay();
        const daysUntilFriday = (5 - dayOfWeek + 7) % 7;
        startDate = new Date(today);
        startDate.setDate(today.getDate() + daysUntilFriday);
        endDate = new Date(startDate);
        endDate.setDate(startDate.getDate() + 2);
        break;
      case 'Custom':
        if (preferences.timeWindow.start) startDate = new Date(preferences.timeWindow.start);
        if (preferences.timeWindow.end) endDate = new Date(preferences.timeWindow.end);
        break;
    }

    const eventbriteUrl = `https://www.eventbriteapi.com/v3/events/search/?location.latitude=${lat}&location.longitude=${lng}&location.within=${radius}km&start_date.range_start=${startDate.toISOString()}&start_date.range_end=${endDate.toISOString()}&expand=venue,ticket_availability&sort_by=date`;
    
    const response = await fetch(eventbriteUrl, {
      headers: {
        'Authorization': `Bearer ${EVENTBRITE_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      console.error('Eventbrite API error:', response.status);
      return [];
    }

    const data = await response.json();
    
    return (data.events || []).slice(0, 15).map((event: any) => ({
      id: event.id,
      name: event.name.text,
      category: 'freestyle', // Default category for events
      location: {
        lat: parseFloat(event.venue?.latitude || lat),
        lng: parseFloat(event.venue?.longitude || lng)
      },
      address: event.venue?.address?.localized_address_display || 'Address not available',
      startTime: event.start.utc,
      endTime: event.end.utc,
      price: event.ticket_availability?.minimum_ticket_price?.major_value || 0,
      imageUrl: event.logo?.url || null,
      eventId: event.id,
      source: 'eventbrite'
    }));
    
  } catch (error) {
    console.error('Error fetching Eventbrite events:', error);
    return [];
  }
}

async function annotateWithTravel(candidates: any[], preferences: RecommendationsRequest): Promise<any[]> {
  if (!GOOGLE_API_KEY || candidates.length === 0) return candidates;

  const origin = `${preferences.origin.lat},${preferences.origin.lng}`;
  const destinations = candidates.slice(0, 25).map(c => `${c.location.lat},${c.location.lng}`).join('|');
  
  const travelMode = preferences.travel.mode.toLowerCase();
  const mode = travelMode === 'walking' ? 'walking' : travelMode === 'transit' ? 'transit' : 'driving';
  
  try {
    const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(origin)}&destinations=${encodeURIComponent(destinations)}&mode=${mode}&units=${preferences.units}&key=${GOOGLE_API_KEY}`;
    
    const response = await fetch(url);
    if (!response.ok) return candidates;
    
    const data = await response.json();
    
    if (data.rows?.[0]?.elements) {
      data.rows[0].elements.forEach((element: any, index: number) => {
        if (index < candidates.length && element.status === 'OK') {
          candidates[index].travel = {
            durationMinutes: Math.ceil(element.duration.value / 60),
            distanceText: element.distance.text,
            mode: preferences.travel.mode
          };
        }
      });
    }
  } catch (error) {
    console.error('Error fetching travel data:', error);
  }

  return candidates;
}

function filterByConstraints(candidates: any[], preferences: RecommendationsRequest): any[] {
  return candidates.filter(candidate => {
    // Travel constraint filter
    if (candidate.travel) {
      if (preferences.travel.constraint.type === 'TIME') {
        const maxMinutes = preferences.travel.constraint.maxMinutes || 30;
        if (candidate.travel.durationMinutes > maxMinutes) return false;
      } else if (preferences.travel.constraint.type === 'DISTANCE') {
        // Distance already filtered in API calls
      }
    }

    // Budget filter
    const budget = preferences.budget;
    let estimatedCost = 0;
    
    if (candidate.source === 'google_places') {
      // Estimate cost based on price level
      const baseCosts = [5, 15, 35, 65, 120]; // $ to $$$$$
      estimatedCost = baseCosts[candidate.priceLevel || 1] || 25;
    } else if (candidate.source === 'eventbrite') {
      estimatedCost = candidate.price || 0;
    }

    const perPersonCost = budget.perPerson ? estimatedCost : estimatedCost / 2;
    if (perPersonCost < budget.min || perPersonCost > budget.max) return false;

    // Store estimated cost for later use
    candidate.estimatedCost = Math.round(perPersonCost);

    return true;
  });
}

function scoreAndRank(candidates: any[], preferences: RecommendationsRequest): any[] {
  const weights = {
    rating: 0.25,
    reviewCount: 0.15,
    eta: 0.20,
    budget: 0.15,
    time: 0.10,
    photo: 0.15
  };

  candidates.forEach(candidate => {
    let score = 0;

    // Rating score (0-1)
    if (candidate.rating) {
      score += weights.rating * (candidate.rating / 5.0);
    }

    // Review count score (logarithmic, 0-1)
    if (candidate.reviewCount && candidate.reviewCount > 0) {
      score += weights.reviewCount * Math.min(Math.log10(candidate.reviewCount) / 4, 1);
    }

    // ETA score (closer is better, 0-1)
    if (candidate.travel?.durationMinutes) {
      const maxTime = preferences.travel.constraint.maxMinutes || 30;
      score += weights.eta * Math.max(0, 1 - (candidate.travel.durationMinutes / maxTime));
    }

    // Budget fit score (0-1)
    if (candidate.estimatedCost) {
      const budgetRange = preferences.budget.max - preferences.budget.min;
      const costFromMin = candidate.estimatedCost - preferences.budget.min;
      score += weights.budget * Math.max(0, 1 - Math.abs(costFromMin - budgetRange / 2) / (budgetRange / 2));
    }

    // Photo quality score
    if (candidate.imageUrl) {
      score += weights.photo;
    }

    candidate.score = score;
  });

  return candidates.sort((a, b) => (b.score || 0) - (a.score || 0));
}

function applyDiversity(candidates: any[], selectedCategories: string[]): any[] {
  const diversified: any[] = [];
  const categoryCount: Record<string, number> = {};
  const priceCount: Record<number, number> = {};

  // Initialize counts
  selectedCategories.forEach(cat => categoryCount[cat] = 0);

  for (const candidate of candidates) {
    const category = candidate.category;
    const priceLevel = candidate.priceLevel || 1;

    // Ensure we have at least one from each selected category (if available)
    const categoryUnderRep = categoryCount[category] < 1;
    const priceDiverse = (priceCount[priceLevel] || 0) < 3;

    if (diversified.length < 20 && (categoryUnderRep || priceDiverse || diversified.length < 12)) {
      diversified.push(candidate);
      categoryCount[category] = (categoryCount[category] || 0) + 1;
      priceCount[priceLevel] = (priceCount[priceLevel] || 0) + 1;
    }
  }

  return diversified;
}

async function enrichWithLLM(candidates: any[], preferences: RecommendationsRequest): Promise<void> {
  if (!OPENAI_API_KEY) return;

  const budget = 0.02; // $0.02 cap per request
  const timeout = 4000; // 4 second timeout
  
  const enrichPromises = candidates.slice(0, 10).map(async (candidate) => {
    const cacheKey = `${candidate.id}_${JSON.stringify(preferences.categories)}_${preferences.budget.min}_${preferences.budget.max}`;
    
    // Check cache first
    const cached = llmCache.get(cacheKey);
    if (cached && cached.expires > Date.now()) {
      candidate.copy = { oneLiner: cached.oneLiner, tip: cached.tip };
      return;
    }

    try {
      const prompt = `Generate engaging copy for this ${candidate.source === 'eventbrite' ? 'event' : 'place'}:

Name: ${candidate.name}
Category: ${candidate.category}
Location: ${candidate.address}
${candidate.rating ? `Rating: ${candidate.rating}/5` : ''}
${candidate.estimatedCost ? `Cost: $${candidate.estimatedCost}` : ''}
${candidate.source === 'eventbrite' ? `Event Time: ${candidate.startTime}` : ''}

User preferences: ${preferences.categories.join(', ')}, Budget: $${preferences.budget.min}-${preferences.budget.max}

Respond with JSON only:
{
  "oneLiner": "engaging description (max 14 words)",
  "tip": "helpful tip for visitors (max 18 words)"
}

Guidelines:
- No hallucinated facts about hours, prices, or availability
- No promises about what will be available
- Focus on atmosphere and experience
- Be concise and compelling`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 100,
          temperature: 0.7
        }),
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        const content = data.choices[0].message.content;
        
        try {
          const parsed = JSON.parse(content);
          candidate.copy = {
            oneLiner: parsed.oneLiner || `Great ${candidate.category} spot`,
            tip: parsed.tip || 'Check ahead for current hours'
          };

          // Cache the result for 7 days
          llmCache.set(cacheKey, {
            oneLiner: candidate.copy.oneLiner,
            tip: candidate.copy.tip,
            expires: Date.now() + (7 * 24 * 60 * 60 * 1000)
          });
        } catch {
          // Fallback if JSON parsing fails
          addFallbackCopyForCandidate(candidate);
        }
      } else {
        addFallbackCopyForCandidate(candidate);
      }
    } catch (error) {
      console.error('LLM enrichment error for candidate:', candidate.id, error);
      addFallbackCopyForCandidate(candidate);
    }
  });

  await Promise.all(enrichPromises);
}

function addFallbackCopy(candidates: any[]): void {
  candidates.forEach(addFallbackCopyForCandidate);
}

function addFallbackCopyForCandidate(candidate: any): void {
  const categoryDescriptions: Record<string, { oneLiner: string; tip: string }> = {
    'stroll': { oneLiner: 'Perfect spot for a leisurely walk', tip: 'Best visited during golden hour' },
    'sip': { oneLiner: 'Cozy atmosphere for drinks and conversation', tip: 'Check their happy hour specials' },
    'casual_eats': { oneLiner: 'Delicious casual dining experience', tip: 'Try their most popular dish' },
    'screen_relax': { oneLiner: 'Great place to unwind and relax', tip: 'Book ahead for peak times' },
    'creative': { oneLiner: 'Inspiring space for creative exploration', tip: 'Perfect for art enthusiasts' },
    'play_move': { oneLiner: 'Active fun for all skill levels', tip: 'Wear comfortable clothing' },
    'dining': { oneLiner: 'Memorable fine dining experience', tip: 'Make reservations in advance' },
    'freestyle': { oneLiner: 'Highly rated local favorite', tip: 'Check their current offerings' }
  };

  const defaults = categoryDescriptions[candidate.category] || {
    oneLiner: 'Popular local destination',
    tip: 'Check ahead for hours and availability'
  };

  candidate.copy = defaults;
}

async function convertToCards(candidates: any[], preferences: RecommendationsRequest): Promise<any[]> {
  return candidates.map(candidate => {
    const travelMode = preferences.travel.mode;
    const mapsMode = travelMode === 'WALKING' ? 'walking' : 
                    travelMode === 'TRANSIT' ? 'transit' : 'driving';
    
    const mapsDeepLink = `https://www.google.com/maps/dir/?api=1&origin=${preferences.origin.lat},${preferences.origin.lng}&destination=${candidate.location.lat},${candidate.location.lng}&travelmode=${mapsMode}`;

    // Generate subtitle
    const priceSymbols = ['$', '$$', '$$$', '$$$$', '$$$$$'];
    const priceDisplay = candidate.priceLevel ? priceSymbols[candidate.priceLevel - 1] : '$';
    const categoryName = candidate.category.charAt(0).toUpperCase() + candidate.category.slice(1).replace('_', ' & ');
    const etaText = candidate.travel ? `${candidate.travel.durationMinutes} min ${mapsMode}` : 'Route available';
    
    const subtitle = `${categoryName} · ${priceDisplay} · ${etaText}`;

    // Determine duration and start time
    let startTime = new Date().toISOString();
    let durationMinutes = 90; // Default duration

    if (candidate.source === 'eventbrite') {
      startTime = candidate.startTime;
      if (candidate.endTime) {
        const start = new Date(candidate.startTime);
        const end = new Date(candidate.endTime);
        durationMinutes = Math.max(30, (end.getTime() - start.getTime()) / (1000 * 60));
      }
    } else {
      // For places, set start time based on preferences
      if (preferences.timeWindow.timeOfDay) {
        const today = new Date();
        const [hours, minutes] = preferences.timeWindow.timeOfDay.split(':');
        today.setHours(parseInt(hours), parseInt(minutes), 0, 0);
        startTime = today.toISOString();
      }
    }

    return {
      id: candidate.id,
      title: candidate.name,
      subtitle,
      category: candidate.category,
      priceLevel: candidate.priceLevel || 1,
      estimatedCostPerPerson: candidate.estimatedCost || 25,
      startTime,
      durationMinutes: Math.round(durationMinutes),
      imageUrl: candidate.imageUrl || '/api/placeholder/400/225',
      address: candidate.address,
      location: candidate.location,
      route: {
        mode: travelMode,
        etaMinutes: candidate.travel?.durationMinutes || 15,
        distanceText: candidate.travel?.distanceText || 'Distance available',
        mapsDeepLink
      },
      source: {
        provider: candidate.source,
        placeId: candidate.placeId,
        eventId: candidate.eventId
      },
      copy: candidate.copy || {
        oneLiner: 'Great local experience',
        tip: 'Check ahead for current details'
      },
      actions: {
        invite: true,
        save: true,
        share: true
      },
      rating: candidate.rating,
      reviewCount: candidate.reviewCount,
      openingHours: candidate.openingHours
    };
  });
}