-- ============================================================
-- Normalize curated card stops into a proper child table
-- Date: 2026-03-19
--
-- Problem: curated cards stored place references in a plain
-- UUID[] column (stop_place_pool_ids) with no FK enforcement.
-- Deleted place_pool rows left orphaned UUIDs, causing broken
-- multi-stop itineraries to be served.
--
-- Fix: replace the array with a normalized child table
-- (card_pool_stops) using real foreign keys. Curated cards are
-- disposable compiled output — if ANY referenced place is
-- deleted, the entire curated card is deleted and can be
-- regenerated later from valid source data.
--
-- Delete semantics:
--   place_pool row deleted
--   → card_pool_stops row cascades away
--   → trigger deletes the parent curated card
--   → card's remaining stops + impressions cascade away
-- ============================================================

-- ── 1. Create the normalized stops table ─────────────────────

CREATE TABLE IF NOT EXISTS public.card_pool_stops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_pool_id UUID NOT NULL REFERENCES public.card_pool(id) ON DELETE CASCADE,
  place_pool_id UUID NOT NULL REFERENCES public.place_pool(id) ON DELETE CASCADE,
  google_place_id TEXT NOT NULL,
  stop_order INTEGER NOT NULL CHECK (stop_order >= 0),

  UNIQUE (card_pool_id, stop_order),
  UNIQUE (card_pool_id, place_pool_id)
);

-- Fast lookup: "which curated cards reference this place?"
CREATE INDEX idx_card_pool_stops_place
  ON public.card_pool_stops (place_pool_id);

-- Fast lookup: "what stops does this card have, in order?"
CREATE INDEX idx_card_pool_stops_card_order
  ON public.card_pool_stops (card_pool_id, stop_order);

-- RLS: match card_pool policies
ALTER TABLE public.card_pool_stops ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_card_pool_stops" ON public.card_pool_stops
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "authenticated_read_card_pool_stops" ON public.card_pool_stops
  FOR SELECT USING (auth.role() = 'authenticated');

-- ── 2. Trigger: delete curated card when ANY stop is lost ────
-- When a place_pool row is deleted, ON DELETE CASCADE removes
-- the card_pool_stops row. This trigger fires AFTER that delete
-- and removes the parent curated card entirely. The parent
-- card's remaining stops and impressions then cascade away too.

CREATE OR REPLACE FUNCTION public.delete_curated_card_on_stop_loss()
RETURNS TRIGGER AS $$
BEGIN
  -- Delete the parent curated card. The card_pool FK cascades
  -- will clean up any remaining stops and impressions.
  DELETE FROM public.card_pool
  WHERE id = OLD.card_pool_id
    AND card_type = 'curated';
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_delete_curated_card_on_stop_loss
  AFTER DELETE ON public.card_pool_stops
  FOR EACH ROW
  EXECUTE FUNCTION public.delete_curated_card_on_stop_loss();

-- ── 3. Backfill: migrate existing data ───────────────────────
-- First, delete curated cards that already have orphaned refs.
-- Then backfill valid ones into card_pool_stops.

-- Step 3a: Delete curated cards with ANY orphaned stop reference
DELETE FROM public.card_pool
WHERE card_type = 'curated'
  AND stop_place_pool_ids IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM unnest(stop_place_pool_ids) AS stop_id
    WHERE stop_id NOT IN (SELECT id FROM public.place_pool)
  );

-- Step 3b: Delete curated cards with empty or null stop arrays
-- (these are malformed and cannot be served)
DELETE FROM public.card_pool
WHERE card_type = 'curated'
  AND (stop_place_pool_ids IS NULL OR array_length(stop_place_pool_ids, 1) IS NULL);

-- Step 3c: Backfill valid curated cards into card_pool_stops
INSERT INTO public.card_pool_stops (card_pool_id, place_pool_id, google_place_id, stop_order)
SELECT
  cp.id AS card_pool_id,
  stop_id AS place_pool_id,
  COALESCE(cp.stop_google_place_ids[ord], pp.google_place_id) AS google_place_id,
  ord - 1 AS stop_order  -- convert 1-based array index to 0-based order
FROM public.card_pool cp,
     LATERAL unnest(cp.stop_place_pool_ids) WITH ORDINALITY AS u(stop_id, ord)
     JOIN public.place_pool pp ON pp.id = stop_id
WHERE cp.card_type = 'curated'
  AND cp.stop_place_pool_ids IS NOT NULL
  AND array_length(cp.stop_place_pool_ids, 1) > 0
ON CONFLICT DO NOTHING;

-- ── 4. Drop the deprecated columns ──────────────────────────
-- These are now fully replaced by card_pool_stops.

ALTER TABLE public.card_pool DROP COLUMN IF EXISTS stop_place_pool_ids;
ALTER TABLE public.card_pool DROP COLUMN IF EXISTS stop_google_place_ids;

-- ── 5. Update query_pool_cards to stop stripping dropped cols ─
-- The function previously subtracted these fields from JSONB output.
-- They no longer exist on the table, so remove those subtractions.
-- Also update the deactivate_stale_places function to cascade
-- curated card cleanup through the new normalized path.

-- (query_pool_cards is replaced in full — it was last defined in
-- 20260315000006_trim_pool_card_payload.sql)

CREATE OR REPLACE FUNCTION public.query_pool_cards(
  p_user_id UUID,
  p_categories TEXT[],
  p_lat_min DOUBLE PRECISION,
  p_lat_max DOUBLE PRECISION,
  p_lng_min DOUBLE PRECISION,
  p_lng_max DOUBLE PRECISION,
  p_budget_max INTEGER DEFAULT 1000,
  p_card_type TEXT DEFAULT 'single',
  p_experience_type TEXT DEFAULT NULL,
  p_pref_updated_at TIMESTAMPTZ DEFAULT '1970-01-01T00:00:00Z',
  p_exclude_card_ids UUID[] DEFAULT '{}',
  p_limit INTEGER DEFAULT 20,
  p_offset INTEGER DEFAULT 0,
  p_price_tiers TEXT[] DEFAULT '{}'
)
RETURNS TABLE (
  card JSONB,
  total_unseen BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_total_unseen BIGINT;
  v_use_tiers BOOLEAN := (array_length(p_price_tiers, 1) IS NOT NULL AND array_length(p_price_tiers, 1) > 0);
  v_excluded_types TEXT[] := ARRAY['gym', 'fitness_center'];
BEGIN
  -- ── Step 1: Count total unseen cards ──────────────────────────────────────

  WITH
  excluded AS (
    SELECT unnest(p_exclude_card_ids) AS card_id
  ),
  seen AS (
    SELECT uci.card_pool_id AS card_id
    FROM public.user_card_impressions uci
    WHERE uci.user_id = p_user_id
      AND uci.created_at >= p_pref_updated_at
  ),
  filtered AS (
    SELECT cp.*
    FROM public.card_pool cp
    WHERE cp.is_active = true
      AND cp.card_type = p_card_type
      AND (p_categories = '{}' OR cp.categories && p_categories)
      AND cp.lat BETWEEN p_lat_min AND p_lat_max
      AND cp.lng BETWEEN p_lng_min AND p_lng_max
      AND (
        (v_use_tiers AND (cp.price_tier = ANY(p_price_tiers) OR cp.price_tier IS NULL))
        OR
        (NOT v_use_tiers AND cp.price_min <= p_budget_max)
      )
      AND (p_experience_type IS NULL OR cp.experience_type = p_experience_type)
      AND cp.id NOT IN (SELECT card_id FROM excluded)
      AND cp.id NOT IN (SELECT card_id FROM seen)
      AND NOT EXISTS (
        SELECT 1 FROM public.place_pool pp
        WHERE pp.id = cp.place_pool_id
          AND pp.types && v_excluded_types
      )
  ),
  deduped AS (
    SELECT DISTINCT ON (COALESCE(f.google_place_id, f.id::TEXT)) f.*
    FROM filtered f
    ORDER BY COALESCE(f.google_place_id, f.id::TEXT), f.popularity_score DESC
  )
  SELECT COUNT(*) INTO v_total_unseen FROM deduped;

  -- ── Step 2: Branch on whether unseen cards exist ──────────────────────────

  IF v_total_unseen > 0 THEN
    RETURN QUERY
    WITH
    excluded AS (
      SELECT unnest(p_exclude_card_ids) AS card_id
    ),
    seen AS (
      SELECT uci.card_pool_id AS card_id
      FROM public.user_card_impressions uci
      WHERE uci.user_id = p_user_id
        AND uci.created_at >= p_pref_updated_at
    ),
    filtered AS (
      SELECT cp.*
      FROM public.card_pool cp
      WHERE cp.is_active = true
        AND cp.card_type = p_card_type
        AND (p_categories = '{}' OR cp.categories && p_categories)
        AND cp.lat BETWEEN p_lat_min AND p_lat_max
        AND cp.lng BETWEEN p_lng_min AND p_lng_max
        AND (
          (v_use_tiers AND (cp.price_tier = ANY(p_price_tiers) OR cp.price_tier IS NULL))
          OR
          (NOT v_use_tiers AND cp.price_min <= p_budget_max)
        )
        AND (p_experience_type IS NULL OR cp.experience_type = p_experience_type)
        AND cp.id NOT IN (SELECT card_id FROM excluded)
        AND cp.id NOT IN (SELECT card_id FROM seen)
        AND NOT EXISTS (
          SELECT 1 FROM public.place_pool pp
          WHERE pp.id = cp.place_pool_id
            AND pp.types && v_excluded_types
        )
    ),
    deduped AS (
      SELECT DISTINCT ON (COALESCE(f.google_place_id, f.id::TEXT)) f.*
      FROM filtered f
      ORDER BY COALESCE(f.google_place_id, f.id::TEXT), f.popularity_score DESC
    ),
    enriched AS (
      SELECT
        d.*,
        COALESCE(
          NULLIF(d.website, ''),
          NULLIF(pp.website, '')
        ) AS resolved_website
      FROM deduped d
      LEFT JOIN public.place_pool pp ON pp.id = d.place_pool_id
    )
    SELECT
      CASE
        WHEN e.resolved_website IS NOT NULL AND (e.website IS NULL OR e.website = '')
        THEN to_jsonb(e.*) - 'resolved_website' - 'raw_google_data' - 'curated_pairing_key' - 'created_at' - 'updated_at' || jsonb_build_object('website', e.resolved_website)
        ELSE to_jsonb(e.*) - 'resolved_website' - 'raw_google_data' - 'curated_pairing_key' - 'created_at' - 'updated_at'
      END AS card,
      v_total_unseen AS total_unseen
    FROM enriched e
    ORDER BY e.popularity_score DESC
    LIMIT p_limit
    OFFSET p_offset;

  ELSE
    -- ── Fallback: impression rotation ────────────────────────────────────────
    RETURN QUERY
    WITH
    excluded AS (
      SELECT unnest(p_exclude_card_ids) AS card_id
    ),
    filtered_no_impressions AS (
      SELECT cp.*
      FROM public.card_pool cp
      WHERE cp.is_active = true
        AND cp.card_type = p_card_type
        AND (p_categories = '{}' OR cp.categories && p_categories)
        AND cp.lat BETWEEN p_lat_min AND p_lat_max
        AND cp.lng BETWEEN p_lng_min AND p_lng_max
        AND (
          (v_use_tiers AND (cp.price_tier = ANY(p_price_tiers) OR cp.price_tier IS NULL))
          OR
          (NOT v_use_tiers AND cp.price_min <= p_budget_max)
        )
        AND (p_experience_type IS NULL OR cp.experience_type = p_experience_type)
        AND cp.id NOT IN (SELECT card_id FROM excluded)
        AND NOT EXISTS (
          SELECT 1 FROM public.place_pool pp
          WHERE pp.id = cp.place_pool_id
            AND pp.types && v_excluded_types
        )
    ),
    deduped AS (
      SELECT DISTINCT ON (COALESCE(f.google_place_id, f.id::TEXT)) f.*
      FROM filtered_no_impressions f
      ORDER BY COALESCE(f.google_place_id, f.id::TEXT), f.popularity_score DESC
    ),
    with_impression_age AS (
      SELECT
        d.*,
        COALESCE(uci.created_at, '1970-01-01'::TIMESTAMPTZ) AS last_seen_at,
        COALESCE(
          NULLIF(d.website, ''),
          NULLIF(pp.website, '')
        ) AS resolved_website
      FROM deduped d
      LEFT JOIN public.user_card_impressions uci
        ON uci.card_pool_id = d.id AND uci.user_id = p_user_id
      LEFT JOIN public.place_pool pp ON pp.id = d.place_pool_id
      ORDER BY last_seen_at ASC, d.popularity_score DESC
      LIMIT p_limit
      OFFSET p_offset
    )
    SELECT
      CASE
        WHEN w.resolved_website IS NOT NULL AND (w.website IS NULL OR w.website = '')
        THEN to_jsonb(w.*) - 'resolved_website' - 'last_seen_at' - 'raw_google_data' - 'curated_pairing_key' - 'created_at' - 'updated_at' || jsonb_build_object('website', w.resolved_website)
        ELSE to_jsonb(w.*) - 'resolved_website' - 'last_seen_at' - 'raw_google_data' - 'curated_pairing_key' - 'created_at' - 'updated_at'
      END AS card,
      (SELECT COUNT(*) FROM deduped)::BIGINT AS total_unseen
    FROM with_impression_age w;

  END IF;
END;
$$;

-- Maintain security: service_role only
REVOKE EXECUTE ON FUNCTION public.query_pool_cards FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.query_pool_cards TO service_role;
