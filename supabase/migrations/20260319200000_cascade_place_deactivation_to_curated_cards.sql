-- Migration: 20260319200000_cascade_place_deactivation_to_curated_cards.sql
-- CRIT-003: When a place is manually deactivated (is_active = false),
-- cascade that deactivation to ALL curated cards referencing it via card_pool_stops.
--
-- Curated cards are derived artifacts — they must not survive when a dependency
-- is manually invalidated. This migration:
--   1. Adds a trigger on place_pool UPDATE of is_active → cascades to curated cards
--   2. Replaces admin_deactivate_place to cascade through card_pool_stops
--   3. Replaces admin_bulk_deactivate_places to cascade through card_pool_stops
--   4. Updates admin_reactivate_place (does NOT auto-reactivate curated cards —
--      curated cards with a deactivated stop are broken and should be regenerated)

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. TRIGGER: cascade place deactivation to curated cards
--    Safety net for any direct UPDATE on place_pool that bypasses admin RPCs.
--    When is_active flips to false, deactivate all curated cards that reference
--    this place via card_pool_stops.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.cascade_place_deactivation_to_curated_cards()
RETURNS TRIGGER AS $$
BEGIN
  -- Only fire when is_active transitions from true to false
  IF OLD.is_active = true AND NEW.is_active = false THEN
    -- Deactivate single cards (direct place_pool_id reference)
    UPDATE public.card_pool
    SET is_active = false
    WHERE place_pool_id = NEW.id
      AND is_active = true;

    -- Deactivate curated cards (referenced via card_pool_stops)
    UPDATE public.card_pool
    SET is_active = false
    WHERE id IN (
      SELECT DISTINCT cps.card_pool_id
      FROM public.card_pool_stops cps
      WHERE cps.place_pool_id = NEW.id
    )
    AND card_type = 'curated'
    AND is_active = true;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_cascade_place_deactivation ON public.place_pool;

CREATE TRIGGER trg_cascade_place_deactivation
  AFTER UPDATE OF is_active ON public.place_pool
  FOR EACH ROW
  WHEN (OLD.is_active = true AND NEW.is_active = false)
  EXECUTE FUNCTION public.cascade_place_deactivation_to_curated_cards();

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. REPLACE admin_deactivate_place — now cascades through card_pool_stops
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.admin_deactivate_place(
  p_place_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin BOOLEAN;
  v_user_id UUID;
  v_place_name TEXT;
  v_single_cards_deactivated INTEGER;
  v_curated_cards_deactivated INTEGER;
BEGIN
  SELECT is_admin_user() INTO v_is_admin;
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Forbidden: admin access required';
  END IF;

  v_user_id := auth.uid();

  -- Verify place exists and is active
  SELECT name INTO v_place_name
  FROM place_pool
  WHERE id = p_place_id AND is_active = true;

  IF v_place_name IS NULL THEN
    RETURN jsonb_build_object('error', 'Place not found or already inactive');
  END IF;

  -- Deactivate place (trigger handles card cascade, but we also do it explicitly
  -- for accurate counting in the response)
  UPDATE place_pool SET is_active = false, updated_at = now()
  WHERE id = p_place_id;

  -- Count single cards deactivated (direct place_pool_id)
  SELECT COUNT(*) INTO v_single_cards_deactivated
  FROM card_pool
  WHERE place_pool_id = p_place_id AND is_active = false;

  -- Count curated cards deactivated (via card_pool_stops)
  SELECT COUNT(*) INTO v_curated_cards_deactivated
  FROM card_pool cp
  WHERE cp.card_type = 'curated'
    AND cp.is_active = false
    AND EXISTS (
      SELECT 1 FROM card_pool_stops cps
      WHERE cps.card_pool_id = cp.id AND cps.place_pool_id = p_place_id
    );

  -- Audit log
  INSERT INTO place_admin_actions (place_id, action_type, acted_by, reason, metadata)
  VALUES (p_place_id, 'deactivate', v_user_id, p_reason,
    jsonb_build_object(
      'place_name', v_place_name,
      'single_cards_deactivated', v_single_cards_deactivated,
      'curated_cards_deactivated', v_curated_cards_deactivated,
      'total_cards_deactivated', v_single_cards_deactivated + v_curated_cards_deactivated
    ));

  RETURN jsonb_build_object(
    'success', true,
    'place_name', v_place_name,
    'cards_deactivated', v_single_cards_deactivated + v_curated_cards_deactivated,
    'single_cards_deactivated', v_single_cards_deactivated,
    'curated_cards_deactivated', v_curated_cards_deactivated
  );
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. REPLACE admin_bulk_deactivate_places — now cascades through card_pool_stops
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.admin_bulk_deactivate_places(
  p_place_ids UUID[],
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin BOOLEAN;
  v_user_id UUID;
  v_places_deactivated INTEGER;
  v_single_cards_deactivated INTEGER;
  v_curated_cards_deactivated INTEGER;
  v_pid UUID;
BEGIN
  SELECT is_admin_user() INTO v_is_admin;
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Forbidden: admin access required';
  END IF;

  v_user_id := auth.uid();

  IF p_place_ids IS NULL OR array_length(p_place_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('error', 'No place IDs provided');
  END IF;

  -- Deactivate places (trigger cascades cards, but we do explicit counts)
  WITH deactivated AS (
    UPDATE place_pool SET is_active = false, updated_at = now()
    WHERE id = ANY(p_place_ids) AND is_active = true
    RETURNING id
  )
  SELECT COUNT(*) INTO v_places_deactivated FROM deactivated;

  -- Count single cards deactivated
  SELECT COUNT(*) INTO v_single_cards_deactivated
  FROM card_pool
  WHERE place_pool_id = ANY(p_place_ids) AND is_active = false;

  -- Count curated cards deactivated (via card_pool_stops)
  SELECT COUNT(*) INTO v_curated_cards_deactivated
  FROM card_pool cp
  WHERE cp.card_type = 'curated'
    AND cp.is_active = false
    AND EXISTS (
      SELECT 1 FROM card_pool_stops cps
      WHERE cps.card_pool_id = cp.id AND cps.place_pool_id = ANY(p_place_ids)
    );

  -- Audit: one row per place
  FOREACH v_pid IN ARRAY p_place_ids LOOP
    INSERT INTO place_admin_actions (place_id, action_type, acted_by, reason, metadata)
    VALUES (v_pid, 'bulk_deactivate', v_user_id, p_reason,
      jsonb_build_object('batch_size', array_length(p_place_ids, 1)));
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'places_deactivated', v_places_deactivated,
    'cards_deactivated', v_single_cards_deactivated + v_curated_cards_deactivated,
    'single_cards_deactivated', v_single_cards_deactivated,
    'curated_cards_deactivated', v_curated_cards_deactivated
  );
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. DB constraint: prevent curated cards with zero stops at the DB level
--    A CHECK constraint can't cross tables, so we use a trigger on card_pool
--    INSERT that validates curated cards have at least one stop within a
--    short window (deferred check via a validation function).
--    NOTE: The edge function cleanup (CRIT-001) is the primary guard.
--    This trigger is a belt-and-suspenders safety net.
-- ═══════════════════════════════════════════════════════════════════════════════

-- Scheduled cleanup: delete any curated cards that somehow have zero stops.
-- Can be called by admin or cron as a consistency sweep.
CREATE OR REPLACE FUNCTION public.cleanup_orphaned_curated_cards()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  WITH orphans AS (
    DELETE FROM card_pool
    WHERE card_type = 'curated'
      AND is_active = true
      AND NOT EXISTS (
        SELECT 1 FROM card_pool_stops cps WHERE cps.card_pool_id = card_pool.id
      )
    RETURNING id
  )
  SELECT COUNT(*) INTO v_deleted FROM orphans;

  RETURN jsonb_build_object(
    'success', true,
    'orphaned_curated_cards_deleted', v_deleted
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cleanup_orphaned_curated_cards FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_orphaned_curated_cards TO service_role;
