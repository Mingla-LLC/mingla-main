import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GOOGLE_API_KEY = Deno.env.get('GOOGLE_MAPS_API_KEY') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    if (!GOOGLE_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      throw new Error('Missing required environment variables');
    }

    const body = await req.json().catch(() => ({}));
    const batchSize = Math.min(body.batchSize || 200, 500);
    const dryRun = !!body.dryRun;

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Step 1: Get place_pool entries with NULL website
    const { data: places, error: fetchError } = await supabaseAdmin
      .from('place_pool')
      .select('id, google_place_id, name')
      .is('website', null)
      .eq('is_active', true)
      .order('created_at', { ascending: true })
      .limit(batchSize);

    if (fetchError) throw new Error(`Fetch error: ${fetchError.message}`);

    if (!places || places.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        processed: 0,
        updated: 0,
        noWebsite: 0,
        errors: 0,
        remaining: 0,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    console.log(`[backfill-websites] Processing ${places.length} places (dryRun=${dryRun})`);

    let updated = 0;
    let noWebsite = 0;
    let deactivated = 0;
    let errors = 0;

    // Step 2: Fetch websiteUri for each place
    for (const place of places) {
      try {
        const url = `https://places.googleapis.com/v1/places/${place.google_place_id}`;
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'X-Goog-Api-Key': GOOGLE_API_KEY,
            'X-Goog-FieldMask': 'websiteUri',
          },
        });

        if (response.status === 404 || response.status === 410) {
          if (!dryRun) {
            await supabaseAdmin
              .from('place_pool')
              .update({ is_active: false })
              .eq('id', place.id);
            await supabaseAdmin
              .from('card_pool')
              .update({ is_active: false })
              .eq('place_pool_id', place.id);
          }
          deactivated++;
          console.log(`[backfill-websites] Deactivated: ${place.name}`);
          continue;
        }

        if (!response.ok) {
          errors++;
          console.warn(`[backfill-websites] Error ${response.status} for ${place.google_place_id}`);
          continue;
        }

        const data = await response.json();
        const websiteUri = data.websiteUri || null;

        if (websiteUri) {
          if (!dryRun) {
            // Update place_pool
            await supabaseAdmin
              .from('place_pool')
              .update({ website: websiteUri })
              .eq('id', place.id);
            // Update card_pool (trigger will also fire, but this is explicit)
            await supabaseAdmin
              .from('card_pool')
              .update({ website: websiteUri })
              .eq('place_pool_id', place.id)
              .is('website', null);
          }
          updated++;
          console.log(`[backfill-websites] Updated: ${place.name} → ${websiteUri}`);
        } else {
          if (!dryRun) {
            // Mark as checked (empty string = no website) to avoid re-processing
            await supabaseAdmin
              .from('place_pool')
              .update({ website: '' })
              .eq('id', place.id);
          }
          noWebsite++;
        }

        // Rate limit: 50ms between calls
        await new Promise(resolve => setTimeout(resolve, 50));
      } catch (err) {
        errors++;
        console.warn(`[backfill-websites] Error for ${place.google_place_id}:`, err);
      }
    }

    // Step 3: Count remaining
    const { count: remaining } = await supabaseAdmin
      .from('place_pool')
      .select('id', { count: 'exact', head: true })
      .is('website', null)
      .eq('is_active', true);

    const result = {
      success: true,
      processed: places.length,
      updated,
      noWebsite,
      deactivated,
      errors,
      remaining: remaining ?? 0,
    };

    console.log(`[backfill-websites] Done:`, result);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[backfill-websites] Unhandled error:', err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Internal error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
