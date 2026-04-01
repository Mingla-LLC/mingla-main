import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { batchSearchPlaces } from '../_shared/placesCache.ts';
import { priceLevelToRange, googleLevelToTierSlug } from '../_shared/priceTiers.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Category slug to Google Places types mapping
const categoryMapping: Record<string, string[]> = {
  'stroll': ['park', 'tourist_attraction'],
  'sip': ['cafe', 'bar'],
  'casual_eats': ['restaurant', 'meal_takeaway'],
  'dining': ['restaurant'],
  'screen_relax': ['movie_theater'],
  'creative': ['art_gallery', 'museum'],
  'play_move': ['bowling_alley', 'gym', 'tourist_attraction'],
  'freestyle': ['tourist_attraction', 'point_of_interest']
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { lat, lng, radiusMeters = 1000, category_slug, openAtIso } = await req.json();
    
    if (!lat || !lng || !category_slug) {
      return new Response(JSON.stringify({ error: 'Missing required parameters' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const apiKey = Deno.env.get('GOOGLE_MAPS_API_KEY');
    if (!apiKey) {
      // Fallback to seed data when no API key
      console.log('No Google Maps API key, using seed data');
      
      const { data: seedExperiences, error } = await supabase
        .from('experiences')
        .select('*')
        .eq('category_slug', category_slug);

      if (error) {
        console.error('Error fetching seed experiences:', error);
        return new Response(JSON.stringify({ error: 'Failed to fetch experiences' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Add fake distance to make them appear nearby
      const nearbyExperiences = (seedExperiences || []).map(exp => ({
        ...exp,
        distance: Math.floor(Math.random() * radiusMeters) // Fake distance within radius
      }));

      return new Response(JSON.stringify(nearbyExperiences), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const placeTypes = categoryMapping[category_slug] || ['tourist_attraction'];

    const { results: typeResults } = await batchSearchPlaces(
      supabase,
      apiKey,
      placeTypes,
      lat,
      lng,
      radiusMeters,
      { maxResultsPerType: 10, ttlHours: 24 }
    );

    // Merge all results from all types
    const rawPlaces: any[] = [];
    for (const places of Object.values(typeResults)) {
      rawPlaces.push(...places);
    }

    // Transform from new Places API format to our experience format
    const normalizedPlaces = rawPlaces.slice(0, 20).map((place: any) => {
      const primaryPhoto = place.photos?.[0];
      const imageUrl = 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=800&q=80';

      // Map priceLevel to range using shared tier system
      const priceRange = priceLevelToRange(place.priceLevel);

      // Convert regularOpeningHours to our format
      const openingHours = place.regularOpeningHours?.periods ?
        place.regularOpeningHours.periods.reduce((acc: any, period: any) => {
          const dayIndex = period.open?.day ?? 0;
          const day = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][dayIndex];
          const openH = String(period.open?.hour ?? 0).padStart(2, '0');
          const openM = String(period.open?.minute ?? 0).padStart(2, '0');
          const closeH = String(period.close?.hour ?? 23).padStart(2, '0');
          const closeM = String(period.close?.minute ?? 59).padStart(2, '0');
          acc[day] = `${openH}${openM}-${closeH}${closeM}`;
          return acc;
        }, {}) : null;

      return {
        id: crypto.randomUUID(),
        title: place.displayName?.text || 'Unknown Place',
        category_slug: category_slug,
        place_id: place.id,
        lat: place.location?.latitude,
        lng: place.location?.longitude,
        price_min: priceRange.min,
        price_max: priceRange.max,
        price_tier: googleLevelToTierSlug(place.priceLevel),
        price_tiers: googleLevelToTierSlug(place.priceLevel) ? [googleLevelToTierSlug(place.priceLevel)] : [],
        duration_min: category_slug === 'stroll' ? 60 : category_slug === 'dining' ? 120 : 90,
        image_url: imageUrl,
        opening_hours: openingHours,
        meta: {
          rating: place.rating || 4.0,
          reviews: place.userRatingCount || 0,
          is_open: place.regularOpeningHours?.openNow
        }
      };
    });

    // Filter by opening hours if requested
    const allPlaces = openAtIso ?
      normalizedPlaces.filter(place => {
        if (!place.opening_hours) return place.meta.is_open !== false;

        const requestedTime = new Date(openAtIso);
        const dayName = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][requestedTime.getDay()];
        const hours = place.opening_hours[dayName];

        if (!hours || hours === 'closed') return false;

        const [openTime, closeTime] = hours.split('-');
        const requestedHour = requestedTime.getHours() * 100 + requestedTime.getMinutes();

        return requestedHour >= parseInt(openTime) && requestedHour <= parseInt(closeTime);
      }) : normalizedPlaces;

    // Upsert to database
    for (const place of allPlaces) {
      await supabase
        .from('experiences')
        .upsert(place, { onConflict: 'place_id' });
    }

    return new Response(JSON.stringify(allPlaces), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Places API error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});