-- ORCH-0408 Phase 2: Wire card_pool save_count and skip_count to actual swipes.
--
-- New RPC called fire-and-forget by the mobile client on every swipe.
-- Increments save_count on swipe right, skip_count on swipe left.
-- Handles all card ID formats:
--   - Google Place ID for single cards (matched by google_place_id)
--   - card_pool UUID for pool curated cards (matched by id::TEXT)
--   - Synthetic curated_... IDs for fresh-gen curated (matches 0 rows — silent no-op)

CREATE OR REPLACE FUNCTION public.record_card_swipe(
  p_card_id TEXT,
  p_direction TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Require authenticated user
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Validate direction
  IF p_direction NOT IN ('left', 'right') THEN
    RAISE EXCEPTION 'Invalid direction: %. Must be left or right.', p_direction;
  END IF;

  -- Increment the appropriate counter.
  -- Try google_place_id first (most common — covers 100% of singles),
  -- then fall back to id::text match (covers pool curated).
  -- Fresh-gen curated cards (curated_...) will match 0 rows — silent no-op, acceptable.
  IF p_direction = 'right' THEN
    UPDATE public.card_pool
    SET save_count = save_count + 1
    WHERE google_place_id = p_card_id
       OR id::TEXT = p_card_id;
  ELSE
    UPDATE public.card_pool
    SET skip_count = skip_count + 1
    WHERE google_place_id = p_card_id
       OR id::TEXT = p_card_id;
  END IF;
END;
$$;
