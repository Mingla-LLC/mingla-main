import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { downloadAndStorePhotos } from '../_shared/photoStorageService.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const batchSize = Math.min(body.batchSize || 50, 200);
    const dryRun = body.dryRun === true;

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const apiKey = Deno.env.get('GOOGLE_MAPS_API_KEY') ?? '';

    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'GOOGLE_MAPS_API_KEY not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseKey);

    // Find places with photo metadata but no stored photos
    const { data: places, error: queryError } = await supabaseAdmin
      .from('place_pool')
      .select('id, google_place_id, photos')
      .or('stored_photo_urls.is.null,stored_photo_urls.cd.{}')
      .not('photos', 'is', null)
      .neq('photos', '[]')
      .eq('is_active', true)
      .order('created_at', { ascending: true })
      .limit(batchSize);

    if (queryError) {
      console.error('[backfill-place-photos] Query error:', queryError);
      return new Response(JSON.stringify({ error: queryError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Count total remaining
    const { count: totalRemaining } = await supabaseAdmin
      .from('place_pool')
      .select('id', { count: 'exact', head: true })
      .or('stored_photo_urls.is.null,stored_photo_urls.cd.{}')
      .not('photos', 'is', null)
      .neq('photos', '[]')
      .eq('is_active', true);

    if (dryRun) {
      return new Response(JSON.stringify({
        success: true, dryRun: true,
        batchSize,
        candidatesInBatch: places?.length ?? 0,
        totalRemaining: totalRemaining ?? 0,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    let succeeded = 0;
    let failed = 0;
    let skipped = 0;

    for (const place of (places ?? [])) {
      try {
        // Parse photo metadata from JSONB
        const photoMeta = Array.isArray(place.photos) ? place.photos : [];
        if (photoMeta.length === 0) { skipped++; continue; }

        // Download and store photos
        const storedUrls = await downloadAndStorePhotos(
          supabaseAdmin, place.google_place_id, photoMeta, apiKey
        );

        if (storedUrls && storedUrls.length > 0) {
          // Also update card_pool rows that reference this place
          try {
            const { error: cardErr } = await supabaseAdmin
              .from('card_pool')
              .update({
                image_url: storedUrls[0],
                images: storedUrls.slice(0, 5),
              })
              .eq('place_pool_id', place.id);

            if (cardErr) {
              console.error(`[backfill-place-photos] card_pool update failed for ${place.google_place_id}:`, cardErr.message);
            }
          } catch (cardUpdateErr) {
            console.error(`[backfill-place-photos] card_pool update error for ${place.google_place_id}:`,
              cardUpdateErr instanceof Error ? cardUpdateErr.message : String(cardUpdateErr));
          }

          succeeded++;
        } else {
          // All photos failed for this place — mark it so we skip it next round
          // instead of blocking the queue forever
          await supabaseAdmin
            .from('place_pool')
            .update({ stored_photo_urls: ['__backfill_failed__'] })
            .eq('google_place_id', place.google_place_id);

          failed++;
        }
      } catch (err) {
        console.error(`[backfill-place-photos] Error processing ${place.google_place_id}:`,
          err instanceof Error ? err.message : String(err));

        // Mark as failed so it doesn't block the queue
        await supabaseAdmin
          .from('place_pool')
          .update({ stored_photo_urls: ['__backfill_failed__'] })
          .eq('google_place_id', place.google_place_id);

        failed++;
      }

      // Rate limit: 500ms between places to avoid Google throttling
      await new Promise(r => setTimeout(r, 500));
    }

    return new Response(JSON.stringify({
      success: true,
      processed: (places?.length ?? 0),
      succeeded,
      failed,
      skipped,
      remaining: (totalRemaining ?? 0) - succeeded,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    console.error('[backfill-place-photos] Error:', err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Internal error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
