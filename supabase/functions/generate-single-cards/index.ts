import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { insertCardToPool } from '../_shared/cardPoolService.ts';
import { resolveCategories, ALL_CATEGORY_NAMES, getPlaceTypesForCategory, isChildVenueName } from '../_shared/categoryPlaceTypes.ts';
import { googleLevelToTierSlug } from '../_shared/priceTiers.ts';
import { SEEDING_CATEGORIES } from '../_shared/seedingCategories.ts';

// Display name → slug reverse map for category normalization
const DISPLAY_NAME_TO_SLUG: Record<string, string> = {};
for (const cat of SEEDING_CATEGORIES) {
  DISPLAY_NAME_TO_SLUG[cat.label] = cat.id;
}

function categoryToSlug(displayName: string): string {
  return DISPLAY_NAME_TO_SLUG[displayName] || displayName.toLowerCase().replace(/[^a-z0-9]+/g, '_');
}

/* ─────────────────────────────────────────────────────────────────────────────
 * generate-single-cards  –  Admin-only batch card generator
 *
 * Reads active places from place_pool, creates card_type = 'single' rows
 * in card_pool with stored photos. No Google API, no OpenAI, no scoring.
 *
 * Extracted from discover-cards Path B (place_pool fallback).
 * Scoring is a serve-time concern — this function writes raw card data only.
 * ──────────────────────────────────────────────────────────────────────────── */

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ── Category Fallback Descriptions (copied from discover-cards) ──────────────
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

// ── Request / Response interfaces ────────────────────────────────────────────

interface RequestBody {
  location: { lat: number; lng: number };
  radiusMeters?: number;
  categories?: string[];
  limitPerCategory?: number;
  dryRun?: boolean;
}

interface CategoryResult {
  generated: number;
  skipped: number;
  total: number;
}

// ── Main Handler ─────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const t0 = Date.now();

  try {
    // ── Validate env vars ──────────────────────────────────────────────
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      return new Response(
        JSON.stringify({ error: 'Missing required environment variables' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body: RequestBody = await req.json();

    // ── Validate request ───────────────────────────────────────────────
    if (!body.location?.lat || !body.location?.lng) {
      return new Response(
        JSON.stringify({ error: 'location.lat and location.lng are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const location = body.location;
    const radiusMeters = body.radiusMeters ?? 10000;
    const limitPerCategory = body.limitPerCategory ?? 20;
    const dryRun = body.dryRun ?? false;

    // ── Resolve categories ─────────────────────────────────────────────
    const categories = body.categories
      ? resolveCategories(body.categories)
      : ALL_CATEGORY_NAMES;

    if (categories.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No recognized categories provided' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[generate-single-cards] Start: categories=[${categories}], radius=${radiusMeters}m, limit=${limitPerCategory}/cat, dryRun=${dryRun}`);

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // ── Compute bounding box ───────────────────────────────────────────
    const latDelta = radiusMeters / 111320;
    const lngDelta = radiusMeters / (111320 * Math.cos(location.lat * Math.PI / 180));

    // ── Process each category in parallel ──────────────────────────────
    let totalGenerated = 0;
    let totalSkippedDuplicate = 0;
    let totalSkippedNoPhotos = 0;
    let totalSkippedChildVenue = 0;
    const categoryResults: Record<string, CategoryResult> = {};

    await Promise.all(categories.map(async (category) => {
      let catGenerated = 0;
      let catSkipped = 0;

      try {
        // ── Query place_pool for this category (AI-approved, AI-categorized) ──
        const categorySlugForQuery = categoryToSlug(category);
        const { data: places, error: queryError } = await supabaseAdmin
          .from('place_pool')
          .select('id, google_place_id, name, address, lat, lng, types, primary_type, rating, review_count, price_level, price_min, price_max, price_tier, price_tiers, opening_hours, website, stored_photo_urls, city_id, city, country, utc_offset_minutes, ai_categories, ai_approved')
          .eq('is_active', true)
          .eq('ai_approved', true)
          .contains('ai_categories', [categorySlugForQuery])
          .gte('lat', location.lat - latDelta)
          .lte('lat', location.lat + latDelta)
          .gte('lng', location.lng - lngDelta)
          .lte('lng', location.lng + lngDelta)
          .order('rating', { ascending: false })
          .limit(limitPerCategory);

        if (queryError) {
          console.error(`[generate-single-cards] Query error for ${category}:`, queryError.message);
          categoryResults[category] = { generated: 0, skipped: 0, total: 0 };
          return;
        }

        if (!places || places.length === 0) {
          categoryResults[category] = { generated: 0, skipped: 0, total: 0 };
          return;
        }

        // ── Batch dedup check — 1 query per category, not per place ──
        const googlePlaceIds = places
          .map((p: any) => p.google_place_id)
          .filter(Boolean);

        const { data: existingCards } = await supabaseAdmin
          .from('card_pool')
          .select('google_place_id')
          .in('google_place_id', googlePlaceIds)
          .eq('is_active', true);

        const existingSet = new Set(
          (existingCards || []).map((c: any) => c.google_place_id)
        );

        // ── For each place: skip or insert ───────────────────────────
        for (const place of places) {
          // Skip if no photos
          if (!place.stored_photo_urls || place.stored_photo_urls.length === 0) {
            catSkipped++;
            totalSkippedNoPhotos++;
            continue;
          }

          // Skip children's venues (name-based heuristic)
          if (isChildVenueName(place.name || '')) {
            catSkipped++;
            totalSkippedChildVenue++;
            continue;
          }

          // Skip if already in card_pool
          if (existingSet.has(place.google_place_id)) {
            catSkipped++;
            totalSkippedDuplicate++;
            continue;
          }

          if (dryRun) {
            catGenerated++;
            totalGenerated++;
            continue;
          }

          // ── Build and insert card ────────────────────────────────
          try {
            const aiCategory = place.ai_categories?.[0] || categoryToSlug(category);
            const aiCategories = place.ai_categories?.length > 0 ? place.ai_categories : [categoryToSlug(category)];
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
              catGenerated++;
              totalGenerated++;
            } else {
              // Insert failed (likely duplicate caught by DB constraint)
              catSkipped++;
              totalSkippedDuplicate++;
            }
          } catch (insertErr) {
            console.warn(`[generate-single-cards] Insert failed for ${place.google_place_id}:`, insertErr);
            catSkipped++;
          }
        }

        categoryResults[category] = {
          generated: catGenerated,
          skipped: catSkipped,
          total: places.length,
        };
      } catch (catErr) {
        console.error(`[generate-single-cards] Category ${category} failed:`, catErr);
        categoryResults[category] = { generated: catGenerated, skipped: catSkipped, total: 0 };
      }
    }));

    const elapsed = Date.now() - t0;
    console.log(`[generate-single-cards] Done in ${elapsed}ms: generated=${totalGenerated}, skippedDuplicate=${totalSkippedDuplicate}, skippedNoPhotos=${totalSkippedNoPhotos}, skippedChildVenue=${totalSkippedChildVenue}`);

    return new Response(JSON.stringify({
      success: true,
      generated: totalGenerated,
      skippedDuplicate: totalSkippedDuplicate,
      skippedNoPhotos: totalSkippedNoPhotos,
      skippedChildVenue: totalSkippedChildVenue,
      categories: categoryResults,
      dryRun,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    console.error('[generate-single-cards] Unhandled error:', err);
    return new Response(
      JSON.stringify({ error: (err as any)?.message || 'Internal error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
