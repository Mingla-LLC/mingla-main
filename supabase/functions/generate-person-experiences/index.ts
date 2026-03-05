import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getPlaceTypesForCategory } from '../_shared/categoryPlaceTypes.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const ALL_CATEGORIES = [
  'Nature', 'First Meet', 'Picnic', 'Drink', 'Casual Eats', 'Fine Dining',
  'Watch', 'Creative & Arts', 'Play', 'Wellness', 'Groceries & Flowers', 'Work & Business',
];

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    // Parse request
    const { personId, description, location, occasions } = await req.json();

    // Validation
    if (!personId || typeof personId !== 'string') {
      return new Response(JSON.stringify({ error: 'personId is required' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      });
    }
    if (!description || typeof description !== 'string' || description.length < 10) {
      return new Response(JSON.stringify({ error: 'description must be at least 10 characters' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      });
    }
    if (!location || typeof location.lat !== 'number' || typeof location.lng !== 'number') {
      return new Response(JSON.stringify({ error: 'location is required' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      });
    }
    if (!occasions || !Array.isArray(occasions) || occasions.length === 0) {
      return new Response(JSON.stringify({ error: 'at least one occasion is required' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      });
    }

    // Auth
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 401,
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 401,
      });
    }

    // Verify person belongs to user
    const { data: person, error: personError } = await supabase
      .from('saved_people')
      .select('id')
      .eq('id', personId)
      .eq('user_id', user.id)
      .single();

    if (personError || !person) {
      return new Response(JSON.stringify({ error: 'Person not found' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 404,
      });
    }

    // Call OpenAI to extract interests
    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    if (!OPENAI_API_KEY) {
      return new Response(JSON.stringify({ error: 'AI processing not configured' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      });
    }

    let parsedInterests: string[] = [];
    let experienceIdeas: Array<{ title: string; description: string; category: string; occasion: string }> = [];

    try {
      const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content: `You are an experience recommender. Extract interests from a person description and map them to these categories: ${ALL_CATEGORIES.join(', ')}. Return JSON: { "interests": ["keyword1", "keyword2"], "categories": ["Fine Dining", "Drink"], "experienceIdeas": [{ "title": "string", "description": "string", "category": "string", "occasion": "string" }] }. Generate 1-3 experience ideas per occasion provided. Be specific — use the person's interests to create personalized suggestions.`,
            },
            {
              role: 'user',
              content: `Person description: "${description}". Occasions: ${JSON.stringify(occasions.map((o: any) => o.name))}`,
            },
          ],
          temperature: 0.7,
          max_tokens: 1000,
        }),
      });

      if (!openaiResponse.ok) {
        throw new Error('OpenAI request failed');
      }

      const openaiData = await openaiResponse.json();
      const parsed = JSON.parse(openaiData.choices[0].message.content);
      parsedInterests = parsed.interests || [];
      experienceIdeas = parsed.experienceIdeas || [];
    } catch (aiError) {
      console.error('OpenAI error:', aiError);
      return new Response(JSON.stringify({ error: 'AI processing failed. Please try again.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      });
    }

    // For each experience idea, search Google Places
    const GOOGLE_MAPS_API_KEY = Deno.env.get('GOOGLE_PLACES_API_KEY') || Deno.env.get('GOOGLE_MAPS_API_KEY');
    const experiencesByOccasion: Record<string, any[]> = {};

    for (const idea of experienceIdeas) {
      const placeTypes = getPlaceTypesForCategory(idea.category);

      try {
        const placesResponse = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY!,
            'X-Goog-FieldMask': 'places.id,places.displayName,places.location,places.rating,places.userRatingCount,places.priceLevel,places.formattedAddress,places.photos,places.websiteUri',
          },
          body: JSON.stringify({
            includedTypes: placeTypes,
            maxResultCount: 5,
            locationRestriction: {
              circle: {
                center: { latitude: location.lat, longitude: location.lng },
                radius: 15000.0,
              },
            },
          }),
        });

        if (placesResponse.ok) {
          const placesData = await placesResponse.json();
          const places = placesData.places || [];

          if (places.length > 0) {
            // Pick the best-rated place
            const bestPlace = places.sort((a: any, b: any) => (b.rating || 0) - (a.rating || 0))[0];

            const photoUrl = bestPlace.photos?.[0]?.name
              ? `https://places.googleapis.com/v1/${bestPlace.photos[0].name}/media?maxWidthPx=800&key=${GOOGLE_MAPS_API_KEY}`
              : '';

            const card = {
              id: `person-exp-${personId}-${bestPlace.id}`,
              placeId: bestPlace.id,
              title: idea.title,
              description: idea.description,
              category: idea.category,
              occasion: idea.occasion,
              image: photoUrl,
              images: [photoUrl],
              rating: bestPlace.rating || 0,
              reviewCount: bestPlace.userRatingCount || 0,
              address: bestPlace.formattedAddress || '',
              lat: bestPlace.location?.latitude || 0,
              lng: bestPlace.location?.longitude || 0,
              website: bestPlace.websiteUri || null,
              venueName: bestPlace.displayName?.text || '',
              matchScore: 85,
            };

            if (!experiencesByOccasion[idea.occasion]) {
              experiencesByOccasion[idea.occasion] = [];
            }
            experiencesByOccasion[idea.occasion].push(card);
          }
        }
      } catch (placesError) {
        console.error(`Places search failed for "${idea.title}":`, placesError);
        // Continue with other ideas
      }
    }

    // Store experiences in DB
    const experienceRows: any[] = [];
    for (const [occasion, cards] of Object.entries(experiencesByOccasion)) {
      for (const card of cards) {
        experienceRows.push({
          user_id: user.id,
          person_id: personId,
          occasion,
          occasion_date: occasions.find((o: any) => o.name === occasion)?.date ?? null,
          experience_data: card,
          generated_from_description: description,
        });
      }
    }

    if (experienceRows.length > 0) {
      const { error: insertError } = await supabase.from('person_experiences').insert(experienceRows);
      if (insertError) {
        console.error('DB insert error:', insertError);
        return new Response(JSON.stringify({ error: 'Failed to save experiences' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 500,
        });
      }
    }

    // Update person's description_processed_at
    await supabase.from('saved_people').update({
      description,
      description_processed_at: new Date().toISOString(),
    }).eq('id', personId);

    return new Response(JSON.stringify({
      personId,
      experiencesByOccasion,
      parsedInterests,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error) {
    console.error('Error in generate-person-experiences:', error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
