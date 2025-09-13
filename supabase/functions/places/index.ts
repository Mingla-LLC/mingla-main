import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Simple 5-minute cache
const cache = new Map<string, { data: any; expires: number }>();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

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

    const cacheKey = `${lat},${lng},${radiusMeters},${category_slug},${openAtIso || 'anytime'}`;
    const cached = cache.get(cacheKey);
    
    if (cached && cached.expires > Date.now()) {
      return new Response(JSON.stringify(cached.data), {
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

      cache.set(cacheKey, {
        data: nearbyExperiences,
        expires: Date.now() + CACHE_DURATION
      });

      return new Response(JSON.stringify(nearbyExperiences), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const placeTypes = categoryMapping[category_slug] || ['tourist_attraction'];

    let allPlaces: any[] = [];

    for (const placeType of placeTypes) {
      const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${radiusMeters}&type=${placeType}&key=${apiKey}`;
      
      const response = await fetch(url);
      if (!response.ok) {
        console.error(`Places API error for ${placeType}:`, response.status);
        continue;
      }

      const data = await response.json();
      
      if (data.results) {
        const normalizedPlaces = data.results.slice(0, 10).map((place: any) => ({
          id: crypto.randomUUID(),
          title: place.name,
          category_slug: category_slug,
          place_id: place.place_id,
          lat: place.geometry.location.lat,
          lng: place.geometry.location.lng,
          price_min: place.price_level ? place.price_level * 10 : 0,
          price_max: place.price_level ? (place.price_level + 1) * 20 : 50,
          duration_min: category_slug === 'stroll' ? 60 : category_slug === 'dining' ? 120 : 90,
          image_url: place.photos?.[0] 
            ? `https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photoreference=${place.photos[0].photo_reference}&key=${apiKey}`
            : `https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=400`,
          opening_hours: place.opening_hours?.periods ? 
            place.opening_hours.periods.reduce((acc: any, period: any) => {
              const day = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][period.open.day];
              acc[day] = `${period.open.time || '0000'}-${period.close?.time || '2359'}`;
              return acc;
            }, {}) : null,
          meta: {
            rating: place.rating || 4.0,
            reviews: place.user_ratings_total || 0,
            is_open: place.opening_hours?.open_now
          }
        }));

        // Filter by opening hours if requested
        const filteredPlaces = openAtIso ? 
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

        allPlaces.push(...filteredPlaces);

        // Upsert to database
        for (const place of filteredPlaces) {
          await supabase
            .from('experiences')
            .upsert(place, { onConflict: 'place_id' });
        }
      }
    }

    // Cache the result
    cache.set(cacheKey, {
      data: allPlaces,
      expires: Date.now() + CACHE_DURATION
    });

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