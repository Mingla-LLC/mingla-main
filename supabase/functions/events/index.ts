import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Seeded Creative & Hands-On events for when Eventbrite token is not available
const seededEvents = [
  {
    id: "eventbrite:seed-pottery-1",
    title: "Pottery Wheel Workshop",
    category: "Creative & Hands-On",
    category_slug: "creative",
    place_id: "eventbrite:seed-pottery-1",
    lat: 47.6205,
    lng: -122.3493,
    price_min: 65,
    price_max: 85,
    duration_min: 180,
    image_url: "https://images.unsplash.com/photo-1578662996442-48f60103fc96?w=800",
    opening_hours: {
      saturday: "10:00-13:00",
      sunday: "14:00-17:00"
    },
    meta: {
      rating: 4.8,
      reviews: 156,
      difficulty: "beginner",
      materials_included: true,
      instructor: "Maria Santos",
      max_participants: 12
    },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  },
  {
    id: "eventbrite:seed-painting-1",
    title: "Watercolor Landscape Painting",
    category: "Creative & Hands-On",
    category_slug: "creative",
    place_id: "eventbrite:seed-painting-1",
    lat: 47.6097,
    lng: -122.3331,
    price_min: 45,
    price_max: 65,
    duration_min: 150,
    image_url: "https://images.unsplash.com/photo-1460661419201-fd4cecdf8a8b?w=800",
    opening_hours: {
      friday: "18:30-21:00",
      saturday: "10:00-12:30",
      sunday: "15:00-17:30"
    },
    meta: {
      rating: 4.6,
      reviews: 89,
      difficulty: "all-levels",
      materials_included: true,
      instructor: "David Chen",
      max_participants: 15
    },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  },
  {
    id: "eventbrite:seed-jewelry-1", 
    title: "Silver Jewelry Making Workshop",
    category: "Creative & Hands-On",
    category_slug: "creative",
    place_id: "eventbrite:seed-jewelry-1",
    lat: 47.6145,
    lng: -122.3241,
    price_min: 75,
    price_max: 95,
    duration_min: 240,
    image_url: "https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?w=800",
    opening_hours: {
      saturday: "09:00-13:00",
      sunday: "13:00-17:00"
    },
    meta: {
      rating: 4.9,
      reviews: 203,
      difficulty: "intermediate",
      materials_included: false,
      instructor: "Sarah Mitchell",
      max_participants: 8,
      bring_your_own: ["pliers", "files"]
    },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  },
  {
    id: "eventbrite:seed-cooking-1",
    title: "Italian Pasta Making Class",
    category: "Creative & Hands-On", 
    category_slug: "creative",
    place_id: "eventbrite:seed-cooking-1",
    lat: 47.6037,
    lng: -122.3300,
    price_min: 85,
    price_max: 110,
    duration_min: 210,
    image_url: "https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=800",
    opening_hours: {
      thursday: "18:00-21:30",
      saturday: "11:00-14:30",
      sunday: "15:00-18:30"
    },
    meta: {
      rating: 4.7,
      reviews: 342,
      difficulty: "beginner",
      materials_included: true,
      instructor: "Chef Antonio Rossi",
      max_participants: 16,
      includes_meal: true
    },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }
];

interface EventbriteEvent {
  id: string;
  name: {
    text: string;
  };
  description?: {
    text?: string;
  };
  start: {
    local: string;
  };
  end: {
    local: string;
  };
  venue?: {
    id: string;
    name: string;
    address?: {
      latitude?: string;
      longitude?: string;
    };
  };
  ticket_availability?: {
    minimum_ticket_price?: {
      major_value?: number;
      currency?: string;
    };
    maximum_ticket_price?: {
      major_value?: number;
      currency?: string;
    };
  };
  logo?: {
    url?: string;
  };
  category_id?: string;
  subcategory_id?: string;
}

const normalizeEventbriteEvent = (event: EventbriteEvent) => {
  const startTime = new Date(event.start.local);
  const endTime = new Date(event.end.local);
  const durationMinutes = Math.round((endTime.getTime() - startTime.getTime()) / 60000);

  return {
    id: `eventbrite:${event.id}`,
    title: event.name.text,
    category: "Creative & Hands-On",
    category_slug: "creative",
    place_id: `eventbrite:${event.id}`,
    lat: event.venue?.address?.latitude ? parseFloat(event.venue.address.latitude) : null,
    lng: event.venue?.address?.longitude ? parseFloat(event.venue.address.longitude) : null,
    price_min: event.ticket_availability?.minimum_ticket_price?.major_value || 0,
    price_max: event.ticket_availability?.maximum_ticket_price?.major_value || event.ticket_availability?.minimum_ticket_price?.major_value || 100,
    duration_min: durationMinutes > 0 ? durationMinutes : 120, // Default 2 hours if calculation fails
    image_url: event.logo?.url || "https://images.unsplash.com/photo-1578662996442-48f60103fc96?w=800",
    opening_hours: {
      [startTime.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase()]: 
        `${startTime.toTimeString().slice(0, 5)}-${endTime.toTimeString().slice(0, 5)}`
    },
    meta: {
      eventbrite_id: event.id,
      venue_name: event.venue?.name || "TBD",
      description: event.description?.text?.slice(0, 200) || "",
      start_time: event.start.local,
      end_time: event.end.local,
      source: "eventbrite"
    },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
};

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('Events endpoint called');

    // Check if Eventbrite token is available
    const eventbriteToken = Deno.env.get('EVENTBRITE_TOKEN');
    
    if (!eventbriteToken) {
      console.log('No Eventbrite token found, returning seeded events');
      
      return new Response(
        JSON.stringify({
          events: seededEvents,
          source: 'seeded',
          count: seededEvents.length
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        }
      );
    }

    console.log('Eventbrite token found, fetching from API');

    // Fetch events from Eventbrite API
    const eventbriteResponse = await fetch(
      'https://www.eventbriteapi.com/v3/events/search/?categories=103,104,105&location.address=Seattle,WA&expand=venue,ticket_availability&sort_by=date',
      {
        headers: {
          'Authorization': `Bearer ${eventbriteToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!eventbriteResponse.ok) {
      console.error('Eventbrite API error:', eventbriteResponse.status, eventbriteResponse.statusText);
      
      // Fallback to seeded events if API fails
      return new Response(
        JSON.stringify({
          events: seededEvents,
          source: 'seeded_fallback',
          count: seededEvents.length,
          error: `Eventbrite API failed: ${eventbriteResponse.status}`
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        }
      );
    }

    const eventbriteData = await eventbriteResponse.json();
    console.log(`Fetched ${eventbriteData.events?.length || 0} events from Eventbrite`);

    // Normalize Eventbrite events to our experiences shape
    const normalizedEvents = eventbriteData.events?.map(normalizeEventbriteEvent) || [];

    return new Response(
      JSON.stringify({
        events: normalizedEvents,
        source: 'eventbrite',
        count: normalizedEvents.length,
        pagination: eventbriteData.pagination || null
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      }
    );

  } catch (error: any) {
    console.error('Error in events function:', error);
    
    // Fallback to seeded events on any error
    return new Response(
      JSON.stringify({
        events: seededEvents,
        source: 'seeded_error_fallback',
        count: seededEvents.length,
        error: error.message
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      }
    );
  }
};

serve(handler);