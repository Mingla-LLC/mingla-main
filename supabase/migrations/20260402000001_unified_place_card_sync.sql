-- ============================================================================
-- Unified place_pool → card_pool sync trigger
-- ============================================================================
-- Replaces: trg_propagate_place_website (website-only, NULL→non-NULL only)
-- Keeps:    trg_cascade_place_deactivation (intentional one-way behavior)
--
-- Problem: 13+ denormalized fields are copied once at card creation and
-- never updated again. If a place's rating, price, categories, AI approval,
-- or hours change in place_pool, card_pool still shows stale data.
--
-- Fix: one trigger that syncs all denormalized fields from place_pool to
-- card_pool whenever place_pool changes. Uses IS DISTINCT FROM checks to
-- avoid no-op writes.
--
-- Note: user_visits has a similar partial index pattern — no action needed
-- here, but flagged for awareness.
-- ============================================================================

-- ── Part 1: Sync trigger function ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.sync_place_to_cards()
RETURNS TRIGGER AS $$
DECLARE
  v_curated_card RECORD;
  v_avg_rating DOUBLE PRECISION;
  v_sum_price_min INTEGER;
  v_sum_price_max INTEGER;
  v_first_price_tier TEXT;
  v_first_price_tiers TEXT[];
  v_all_categories TEXT[];
BEGIN
  -- ── Single cards: direct field sync ────────────────────────────────────
  -- Only run the UPDATE if at least one synced field actually changed.
  IF OLD.rating IS DISTINCT FROM NEW.rating
     OR OLD.review_count IS DISTINCT FROM NEW.review_count
     OR OLD.price_min IS DISTINCT FROM NEW.price_min
     OR OLD.price_max IS DISTINCT FROM NEW.price_max
     OR OLD.price_tier IS DISTINCT FROM NEW.price_tier
     OR OLD.price_tiers IS DISTINCT FROM NEW.price_tiers
     OR OLD.opening_hours IS DISTINCT FROM NEW.opening_hours
     OR OLD.website IS DISTINCT FROM NEW.website
     OR OLD.ai_categories IS DISTINCT FROM NEW.ai_categories
     OR OLD.ai_approved IS DISTINCT FROM NEW.ai_approved
     OR OLD.city IS DISTINCT FROM NEW.city
     OR OLD.country IS DISTINCT FROM NEW.country
     OR OLD.utc_offset_minutes IS DISTINCT FROM NEW.utc_offset_minutes
     OR OLD.lat IS DISTINCT FROM NEW.lat
     OR OLD.lng IS DISTINCT FROM NEW.lng
     OR OLD.is_active IS DISTINCT FROM NEW.is_active
  THEN
    UPDATE public.card_pool SET
      rating = NEW.rating,
      review_count = NEW.review_count,
      price_min = NEW.price_min,
      price_max = NEW.price_max,
      price_tier = NEW.price_tier,
      price_tiers = NEW.price_tiers,
      opening_hours = NEW.opening_hours,
      website = NEW.website,
      ai_categories = NEW.ai_categories,
      ai_approved = NEW.ai_approved,
      city = NEW.city,
      country = NEW.country,
      utc_offset_minutes = NEW.utc_offset_minutes,
      lat = NEW.lat,
      lng = NEW.lng,
      is_active = NEW.is_active,
      -- categories on card_pool = ai_categories on place_pool
      -- (matching the generate-single-cards pipeline)
      categories = COALESCE(NEW.ai_categories, '{}'),
      updated_at = now()
    WHERE place_pool_id = NEW.id
      AND card_type = 'single';
  END IF;

  -- ── Curated cards: recalculate composite fields ────────────────────────
  -- Only recalculate if fields that affect composites changed.
  IF OLD.price_min IS DISTINCT FROM NEW.price_min
     OR OLD.price_max IS DISTINCT FROM NEW.price_max
     OR OLD.price_tier IS DISTINCT FROM NEW.price_tier
     OR OLD.price_tiers IS DISTINCT FROM NEW.price_tiers
     OR OLD.ai_categories IS DISTINCT FROM NEW.ai_categories
  THEN
    -- For each curated card that uses this place as a stop:
    FOR v_curated_card IN
      SELECT DISTINCT cps.card_pool_id
      FROM public.card_pool_stops cps
      WHERE cps.place_pool_id = NEW.id
    LOOP
      -- Recalculate composites from ALL stops' current place_pool data.
      -- price_min = SUM of all stops' price_min
      -- price_max = SUM of all stops' price_max
      -- price_tier = first stop's price_tier (by stop_order)
      -- price_tiers = first stop's price_tiers (by stop_order)
      -- categories = UNION of all stops' ai_categories
      -- Rating is NOT recalculated — it's a synthetic matchScore, not averaged.
      -- is_active is NOT synced — deactivation trigger handles that one-way.
      SELECT
        COALESCE(SUM(pp.price_min), 0),
        COALESCE(SUM(pp.price_max), 0)
      INTO v_sum_price_min, v_sum_price_max
      FROM public.card_pool_stops cps
      JOIN public.place_pool pp ON pp.id = cps.place_pool_id
      WHERE cps.card_pool_id = v_curated_card.card_pool_id;

      -- First stop's price tier (stop_order = 0)
      SELECT
        COALESCE(pp.price_tier, 'comfy'),
        COALESCE(pp.price_tiers, ARRAY[COALESCE(pp.price_tier, 'comfy')])
      INTO v_first_price_tier, v_first_price_tiers
      FROM public.card_pool_stops cps
      JOIN public.place_pool pp ON pp.id = cps.place_pool_id
      WHERE cps.card_pool_id = v_curated_card.card_pool_id
      ORDER BY cps.stop_order ASC
      LIMIT 1;

      -- Union of all stops' ai_categories (deduplicated)
      SELECT COALESCE(array_agg(DISTINCT cat), '{}')
      INTO v_all_categories
      FROM public.card_pool_stops cps
      JOIN public.place_pool pp ON pp.id = cps.place_pool_id,
      LATERAL unnest(COALESCE(pp.ai_categories, '{}')) AS cat
      WHERE cps.card_pool_id = v_curated_card.card_pool_id;

      UPDATE public.card_pool SET
        price_min = v_sum_price_min,
        price_max = v_sum_price_max,
        price_tier = v_first_price_tier,
        price_tiers = v_first_price_tiers,
        categories = v_all_categories,
        updated_at = now()
      WHERE id = v_curated_card.card_pool_id
        AND card_type = 'curated';
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── Part 2: Drop old website-only trigger ──────────────────────────────────
-- The new unified trigger subsumes this — it syncs website along with
-- everything else, and does it for all changes (not just NULL → non-NULL).

DROP TRIGGER IF EXISTS trg_propagate_place_website ON public.place_pool;
DROP FUNCTION IF EXISTS propagate_place_website();

-- ── Part 3: Create the unified trigger ─────────────────────────────────────
-- Plain AFTER UPDATE (no column list) so all column changes are caught.
-- The IS DISTINCT FROM checks inside the function handle the no-op case.

DROP TRIGGER IF EXISTS trg_sync_place_to_cards ON public.place_pool;

CREATE TRIGGER trg_sync_place_to_cards
  AFTER UPDATE ON public.place_pool
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_place_to_cards();
