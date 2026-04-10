import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { insertCardToPool } from '../_shared/cardPoolService.ts';
import { ALL_CATEGORY_NAMES, isChildVenueName } from '../_shared/categoryPlaceTypes.ts';
import { googleLevelToTierSlug } from '../_shared/priceTiers.ts';
import { SEEDING_CATEGORIES } from '../_shared/seedingCategories.ts';

/* ─────────────────────────────────────────────────────────────────────────────
 * generate-single-cards  –  Admin batch card generator (v3 — fire-and-forget)
 *
 * Actions:
 *   generate_all  — Creates a run record, returns runId IMMEDIATELY, then
 *                   processes all categories in background. UI polls via RPC.
 *   cancel_run    — Marks a running job as cancelled (checked between categories).
 *
 * Key design:
 *   - Response returned in <1s (just a DB insert).
 *   - Background processing via EdgeRuntime.waitUntil().
 *   - Concurrency guard: rejects if city already has a running job.
 *   - No per-category limit — processes ALL eligible places.
 *   - No Google API. No OpenAI. No cost.
 * ──────────────────────────────────────────────────────────────────────────── */

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ── Display name → slug mapping ─────────────────────────────────────────────

const DISPLAY_NAME_TO_SLUG: Record<string, string> = {};
for (const cat of SEEDING_CATEGORIES) {
  DISPLAY_NAME_TO_SLUG[cat.label] = cat.id;
}

function categoryToSlug(displayName: string): string {
  return DISPLAY_NAME_TO_SLUG[displayName] || displayName.toLowerCase().replace(/[^a-z0-9]+/g, '_');
}

// ── Category Fallback Descriptions ──────────────────────────────────────────

const CATEGORY_FALLBACK_DESCRIPTIONS: Record<string, string> = {
  'Nature & Views': 'A beautiful [placeType] perfect for outdoor exploration.',
  'Drink': 'A popular [placeType] spot with great ambiance for drinks.',
  'Casual Eats': 'A well-loved [placeType] serving delicious casual fare.',
  'Fine Dining': 'An upscale [placeType] offering a refined dining experience.',
  'First Meet': 'A welcoming [placeType] ideal for a first meeting.',
  'Picnic Park': 'A lovely [placeType] perfect for a relaxing picnic outing.',
  'Watch': 'An exciting [placeType] for a fun movie experience.',
  'Live Performance': 'An exciting [placeType] for live entertainment.',
  'Creative & Arts': 'An inspiring [placeType] for creative exploration.',
  'Play': 'A thrilling [placeType] for fun and adventure.',
  'Wellness': 'A serene [placeType] for relaxation and wellness.',
  'Flowers': 'A lovely [placeType] for fresh flowers and bouquets.',
  'Groceries': 'A convenient [placeType] for all your essentials.',
};

function formatPlaceType(type: string): string {
  return type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

function getFallbackDescription(category: string, placeType: string): string {
  const template = CATEGORY_FALLBACK_DESCRIPTIONS[category]
    ?? 'A great [placeType] worth exploring.';
  return template.replace('[placeType]', formatPlaceType(placeType).toLowerCase());
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// ── Process one category: fetch ALL eligible places (no limit) ──────────────

const BATCH_SIZE = 500;

async function processCategory(
  supabaseAdmin: any,
  category: string,
  cityId: string,
  existingSet: Set<string>,
  existingCategoryMap: Map<string, string[]>,
): Promise<{ created: number; skipped: number; eligible: number; skippedNoPhotos: number; skippedDuplicate: number; skippedChildVenue: number; updatedCategories: number }> {
  const slug = categoryToSlug(category);
  let created = 0, skipped = 0, skippedNoPhotos = 0, skippedDuplicate = 0, skippedChildVenue = 0, eligible = 0, updatedCategories = 0;
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const { data: places, error } = await supabaseAdmin
      .from('place_pool')
      .select('id, google_place_id, name, address, lat, lng, types, primary_type, rating, review_count, price_level, price_min, price_max, price_tier, price_tiers, opening_hours, website, stored_photo_urls, city_id, city, country, utc_offset_minutes, ai_categories, ai_approved')
      .eq('is_active', true)
      .eq('ai_approved', true)
      .eq('city_id', cityId)
      .contains('ai_categories', [slug])
      .order('rating', { ascending: false })
      .range(offset, offset + BATCH_SIZE - 1);

    if (error) {
      console.error(`[generate-single-cards] Query error for ${category} offset=${offset}:`, error.message);
      break;
    }

    if (!places || places.length === 0) break;

    eligible += places.length;

    for (const place of places) {
      if (!place.stored_photo_urls || place.stored_photo_urls.length === 0) {
        skipped++; skippedNoPhotos++; continue;
      }
      if (isChildVenueName(place.name || '')) {
        skipped++; skippedChildVenue++; continue;
      }
      if (existingSet.has(place.google_place_id)) {
        // Card already exists — but check if categories need updating
        const aiCategories = place.ai_categories?.length > 0 ? place.ai_categories : [slug];
        const existingCategories = existingCategoryMap.get(place.google_place_id);
        if (existingCategories && JSON.stringify(existingCategories.sort()) !== JSON.stringify(aiCategories.sort())) {
          // Categories changed since card was generated — sync them
          const { error: updateErr } = await supabaseAdmin
            .from('card_pool')
            .update({ categories: aiCategories, category: aiCategories[0], updated_at: new Date().toISOString() })
            .eq('google_place_id', place.google_place_id)
            .eq('card_type', 'single')
            .eq('is_active', true);
          if (!updateErr) {
            updatedCategories++;
            existingCategoryMap.set(place.google_place_id, aiCategories);
          } else {
            console.warn(`[generate-single-cards] Category update failed for ${place.google_place_id}:`, updateErr.message);
          }
        }
        skipped++; skippedDuplicate++; continue;
      }

      try {
        const aiCategory = place.ai_categories?.[0] || slug;
        const aiCategories = place.ai_categories?.length > 0 ? place.ai_categories : [slug];
        const cardId = await insertCardToPool(supabaseAdmin, {
          placePoolId: place.id,
          googlePlaceId: place.google_place_id,
          cardType: 'single',
          title: place.name,
          category: aiCategory,
          categories: aiCategories,
          description: getFallbackDescription(category, place.primary_type || 'place'),
          imageUrl: place.stored_photo_urls[0],
          images: place.stored_photo_urls.slice(0, 5),
          address: place.address || '',
          lat: place.lat,
          lng: place.lng,
          rating: place.rating || 0,
          reviewCount: place.review_count || 0,
          priceMin: place.price_min ?? 0,
          priceMax: place.price_max ?? 0,
          priceTier: place.price_tiers?.[0] || place.price_tier || googleLevelToTierSlug(place.price_level),
          priceTiers: place.price_tiers?.length ? place.price_tiers : [place.price_tier || 'chill'],
          openingHours: place.opening_hours,
          website: place.website,
          cityId: place.city_id,
          city: place.city,
          country: place.country,
          utcOffsetMinutes: place.utc_offset_minutes,
        });

        if (cardId) {
          created++;
          existingSet.add(place.google_place_id);
        } else {
          skipped++; skippedDuplicate++;
        }
      } catch (insertErr) {
        console.warn(`[generate-single-cards] Insert failed for ${place.google_place_id}:`, insertErr);
        skipped++;
      }
    }

    hasMore = places.length >= BATCH_SIZE;
    offset += BATCH_SIZE;
  }

  return { created, skipped, eligible, skippedNoPhotos, skippedDuplicate, skippedChildVenue, updatedCategories };
}

// ── Background processor (runs after response is sent) ──────────────────────

async function runGenerationInBackground(supabaseAdmin: any, runId: string, cityId: string, city: string, country: string) {
  const categories = ALL_CATEGORY_NAMES;

  try {
    // Pre-fetch existing card IDs + categories for this city (needed for category sync)
    const { data: existingCards } = await supabaseAdmin
      .from('card_pool')
      .select('google_place_id, categories')
      .eq('city_id', cityId)
      .eq('card_type', 'single')
      .eq('is_active', true);

    const existingSet = new Set(
      (existingCards || []).map((c: any) => c.google_place_id).filter(Boolean)
    );
    const existingCategoryMap = new Map<string, string[]>(
      (existingCards || []).filter((c: any) => c.google_place_id).map((c: any) => [c.google_place_id, c.categories || []])
    );

    let totalCreated = 0, totalSkipped = 0, totalSkippedNoPhotos = 0;
    let totalSkippedDuplicate = 0, totalSkippedChildVenue = 0, totalEligible = 0;
    let totalUpdatedCategories = 0;
    const categoryResults: Record<string, any> = {};

    for (let i = 0; i < categories.length; i++) {
      const category = categories[i];
      const slug = categoryToSlug(category);

      // Check if cancelled
      const { data: runCheck } = await supabaseAdmin
        .from('card_generation_runs')
        .select('status')
        .eq('id', runId)
        .single();

      if (runCheck?.status === 'cancelled') {
        console.log(`[generate-single-cards] Run ${runId} cancelled at category ${i + 1}/${categories.length}`);
        break;
      }

      // Update current category
      await supabaseAdmin
        .from('card_generation_runs')
        .update({ current_category: slug })
        .eq('id', runId);

      try {
        const result = await processCategory(supabaseAdmin, category, cityId, existingSet, existingCategoryMap);

        categoryResults[slug] = {
          created: result.created,
          skipped: result.skipped,
          eligible: result.eligible,
          updatedCategories: result.updatedCategories,
        };

        totalCreated += result.created;
        totalSkipped += result.skipped;
        totalSkippedNoPhotos += result.skippedNoPhotos;
        totalSkippedDuplicate += result.skippedDuplicate;
        totalSkippedChildVenue += result.skippedChildVenue;
        totalEligible += result.eligible;
        totalUpdatedCategories += result.updatedCategories;

        // Update progress
        await supabaseAdmin
          .from('card_generation_runs')
          .update({
            completed_categories: i + 1,
            total_created: totalCreated,
            total_skipped: totalSkipped,
            skipped_no_photos: totalSkippedNoPhotos,
            skipped_duplicate: totalSkippedDuplicate,
            skipped_child_venue: totalSkippedChildVenue,
            total_eligible: totalEligible,
            category_results: categoryResults,
          })
          .eq('id', runId);

        console.log(`[generate-single-cards] Run ${runId}: ${slug} done — created=${result.created}, skipped=${result.skipped}`);
      } catch (catErr) {
        console.error(`[generate-single-cards] Run ${runId}: ${slug} FAILED:`, catErr);
        categoryResults[slug] = { created: 0, skipped: 0, eligible: 0, error: (catErr as any)?.message };
      }
    }

    // Final status
    const { data: finalCheck } = await supabaseAdmin
      .from('card_generation_runs')
      .select('status')
      .eq('id', runId)
      .single();

    const finalStatus = finalCheck?.status === 'cancelled' ? 'cancelled' : 'completed';

    await supabaseAdmin
      .from('card_generation_runs')
      .update({
        status: finalStatus,
        completed_at: new Date().toISOString(),
        current_category: null,
      })
      .eq('id', runId);

    console.log(`[generate-single-cards] Run ${runId} ${finalStatus}: created=${totalCreated}, skipped=${totalSkipped}, categoriesUpdated=${totalUpdatedCategories}`);
  } catch (err) {
    console.error(`[generate-single-cards] Run ${runId} FATAL:`, err);
    await supabaseAdmin
      .from('card_generation_runs')
      .update({
        status: 'failed',
        error_message: (err as any)?.message || 'Unknown error',
        completed_at: new Date().toISOString(),
        current_category: null,
      })
      .eq('id', runId);
  }
}

// ── Main Handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      return jsonResponse({ error: 'Missing required environment variables' }, 500);
    }

    const body = await req.json();
    const action = body.action || 'generate_all';
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // ── generate_all: create run → return immediately → process in background
    if (action === 'generate_all') {
      const { cityId, city, country } = body;
      if (!cityId || !city || !country) {
        return jsonResponse({ error: 'cityId, city and country are required' }, 400);
      }

      // P0-02: Concurrency guard — reject if city already has a running job
      const { data: activeRuns } = await supabaseAdmin
        .from('card_generation_runs')
        .select('id')
        .eq('city', city)
        .eq('status', 'running')
        .limit(1);

      if (activeRuns && activeRuns.length > 0) {
        return jsonResponse({
          error: 'A generation job is already running for this city',
          existingRunId: activeRuns[0].id,
        }, 409);
      }

      // Create run record
      const { data: run, error: runErr } = await supabaseAdmin
        .from('card_generation_runs')
        .insert({
          city,
          country,
          status: 'running',
          total_categories: ALL_CATEGORY_NAMES.length,
          triggered_by: body.triggered_by || 'admin',
        })
        .select('id')
        .single();

      if (runErr || !run) {
        return jsonResponse({ error: 'Failed to create generation run' }, 500);
      }

      console.log(`[generate-single-cards] Run ${run.id} created for ${city} — returning immediately, processing in background`);

      // P0-01: Fire-and-forget — process in background, return runId now
      // @ts-ignore — EdgeRuntime.waitUntil is available in Supabase Edge Functions
      EdgeRuntime.waitUntil(runGenerationInBackground(supabaseAdmin, run.id, cityId, city, country));

      return jsonResponse({ success: true, runId: run.id });
    }

    // ── cancel_run
    if (action === 'cancel_run') {
      const { runId } = body;
      if (!runId) return jsonResponse({ error: 'runId is required' }, 400);

      const { error } = await supabaseAdmin
        .from('card_generation_runs')
        .update({ status: 'cancelled' })
        .eq('id', runId)
        .eq('status', 'running');

      if (error) return jsonResponse({ error: 'Failed to cancel run' }, 500);
      return jsonResponse({ success: true, cancelled: true });
    }

    return jsonResponse({ error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    console.error('[generate-single-cards] Unhandled error:', err);
    return jsonResponse({ error: (err as any)?.message || 'Internal error' }, 500);
  }
});
