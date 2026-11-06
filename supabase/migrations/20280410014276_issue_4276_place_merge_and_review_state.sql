-- Issue #4276 wave 1, S3, S4 and U4.
--
-- S3. Seed and refresh updates become a merge. The admin edit path left no record
-- of what an admin changed, so a re-seed overwrote edited names and a refresh
-- overwrote edited price tiers. place_pool_admin_edits is that marker: stamped by
-- admin_edit_place only when a value actually changes, since the edit form always
-- sends every field. Values: 'name', 'price_tiers'.
--
-- #2099 PIN. #2099 fingerprints every table with a place_pool_id or venue_id column
-- or a foreign key to place_pool, and refuses venue corrections if that list moves.
-- These two tables are deliberately outside it: the marker is keyed by
-- google_place_id, which is what seed and refresh hold anyway, and the review state
-- by a plain place_id with no foreign key, so #4274's re-pin isn't disturbed. A
-- hard-deleted place leaves one harmless row behind.
--
-- Existing edits can only be recovered where they contradict Google. Measured
-- 2026-11-05: no name differs from raw_google_data; a tier set with more than one
-- tier, or a tier that doesn't match the place's Google price level, can only have
-- come from an admin, and those are backfilled. Earlier edits that happen to match
-- Google need no protection.
--
-- S4. place_review_fetch_state tells "Google has no reviews for this place" apart
-- from "the fetch failed", which previously both left zero rows. Runs get a
-- 'paused' status, for a depleted provider, and an option to redo reviews even
-- when they look fresh. 'paused' is deliberately outside
-- uniq_one_running_run_per_city, so a paused run can't block the city; a resume
-- that finds the city busy gets a clean 409.
--
-- U4. place_pool_derived_category lets the admin's list queries read and filter on
-- the canonical category through a PostgREST computed column. ai_categories and
-- seeding_category no longer exist, so those queries returned nothing.
--
-- Rollback: drop the new function, tables and column, and re-run the previous
-- admin_edit_place body from the baseline. No place value is changed by this file.

BEGIN;

CREATE TABLE public.place_pool_admin_edits (
  google_place_id text PRIMARY KEY,
  edited_fields text[] NOT NULL DEFAULT '{}'
    CHECK (edited_fields <@ ARRAY['name', 'price_tiers']::text[]),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.place_pool_admin_edits IS
  'Issue #4276: fields an admin has changed on a place. Seed and refresh must not '
  'overwrite these. Written only by admin_edit_place.';

ALTER TABLE public.place_pool_admin_edits ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.place_pool_admin_edits FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.place_pool_admin_edits TO authenticated;
GRANT ALL ON TABLE public.place_pool_admin_edits TO service_role;

CREATE POLICY place_pool_admin_edits_admin_read
  ON public.place_pool_admin_edits
  FOR SELECT TO authenticated
  USING (public.is_admin_user());

INSERT INTO public.place_pool_admin_edits (google_place_id, edited_fields)
SELECT google_place_id, ARRAY['price_tiers']
FROM public.place_pool
WHERE google_place_id IS NOT NULL
  AND price_level IS NOT NULL
  AND (
    cardinality(price_tiers) > 1
    OR price_tier IS DISTINCT FROM CASE price_level
      WHEN 'PRICE_LEVEL_FREE' THEN 'chill'
      WHEN 'PRICE_LEVEL_INEXPENSIVE' THEN 'chill'
      WHEN 'PRICE_LEVEL_MODERATE' THEN 'comfy'
      WHEN 'PRICE_LEVEL_EXPENSIVE' THEN 'bougie'
      WHEN 'PRICE_LEVEL_VERY_EXPENSIVE' THEN 'lavish'
    END
  );

CREATE OR REPLACE FUNCTION public.admin_edit_place(
  p_place_id uuid,
  p_name text DEFAULT NULL::text,
  p_price_tier text DEFAULT NULL::text,
  p_is_active boolean DEFAULT NULL::boolean,
  p_price_tiers text[] DEFAULT NULL::text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
  v_effective_tiers TEXT[];
  v_tiers_provided BOOLEAN := (p_price_tiers IS NOT NULL);
  v_old public.place_pool%ROWTYPE;
  v_edited TEXT[] := ARRAY[]::text[];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_users WHERE email = auth.email() AND status = 'active') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF v_tiers_provided THEN
    v_effective_tiers := p_price_tiers;
  ELSIF p_price_tier IS NOT NULL THEN
    v_effective_tiers := ARRAY[p_price_tier];
  ELSE
    v_effective_tiers := NULL;
  END IF;

  -- #4276 S3: compare what the admin sent with what is stored. The form shows
  -- price_tier when price_tiers is empty and sends that back, so that shape isn't
  -- an edit either.
  SELECT * INTO v_old FROM public.place_pool WHERE id = p_place_id FOR UPDATE;
  IF p_name IS NOT NULL AND p_name IS DISTINCT FROM v_old.name THEN
    v_edited := v_edited || 'name'::text;
  END IF;
  IF v_effective_tiers IS NOT NULL
     AND v_effective_tiers IS DISTINCT FROM COALESCE(
       NULLIF(v_old.price_tiers, ARRAY[]::text[]),
       CASE WHEN v_old.price_tier IS NOT NULL THEN ARRAY[v_old.price_tier] END,
       ARRAY[]::text[]
     ) THEN
    v_edited := v_edited || 'price_tiers'::text;
  END IF;

  -- ORCH-0700: category-override capability removed (admin can no longer override
  -- a place's Mingla category — categories are derived from Google's raw type
  -- data via pg_map_primary_type_to_mingla_category). If override is needed in
  -- future, a separate place_pool_overrides table will be added.
  UPDATE public.place_pool
  SET
    name = COALESCE(p_name, name),
    price_tier = CASE
      WHEN v_effective_tiers IS NOT NULL AND array_length(v_effective_tiers, 1) > 0 THEN v_effective_tiers[1]
      WHEN v_effective_tiers IS NOT NULL THEN NULL
      ELSE price_tier
    END,
    price_tiers = COALESCE(v_effective_tiers, price_tiers),
    is_active = COALESCE(p_is_active, is_active),
    updated_at = now()
  WHERE id = p_place_id
  RETURNING jsonb_build_object(
    'id', id, 'name', name, 'price_tier', price_tier, 'price_tiers', price_tiers,
    'is_active', is_active
  )
  INTO v_result;

  IF v_result IS NULL THEN RAISE EXCEPTION 'Place not found: %', p_place_id; END IF;

  -- A place with no Google id can't be touched by seed or refresh.
  IF cardinality(v_edited) > 0 AND v_old.google_place_id IS NOT NULL THEN
    INSERT INTO public.place_pool_admin_edits AS e (google_place_id, edited_fields)
    VALUES (v_old.google_place_id, v_edited)
    ON CONFLICT (google_place_id) DO UPDATE
      SET edited_fields = ARRAY(
            SELECT DISTINCT f FROM unnest(e.edited_fields || EXCLUDED.edited_fields) AS f ORDER BY f
          ),
          updated_at = now();
  END IF;

  RETURN v_result;
END;
$$;

CREATE TABLE public.place_review_fetch_state (
  place_id uuid PRIMARY KEY,
  outcome text NOT NULL CHECK (outcome IN ('fetched', 'none_on_google', 'failed')),
  review_count integer NOT NULL DEFAULT 0,
  last_checked_at timestamptz NOT NULL DEFAULT now(),
  last_error text
);

COMMENT ON TABLE public.place_review_fetch_state IS
  'Issue #4276: the last review fetch per place. Only outcome=none_on_google means '
  'Google has no reviews; a failed fetch is never treated as fresh.';

ALTER TABLE public.place_review_fetch_state ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.place_review_fetch_state FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.place_review_fetch_state TO authenticated;
GRANT ALL ON TABLE public.place_review_fetch_state TO service_role;

CREATE POLICY place_review_fetch_state_admin_read
  ON public.place_review_fetch_state
  FOR SELECT TO authenticated
  USING (public.is_admin_user());

ALTER TABLE public.place_intelligence_runs
  ADD COLUMN force_refresh_reviews boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.place_intelligence_runs.force_refresh_reviews IS
  'Issue #4276: prep re-fetches reviews for this run even when they look fresh.';

ALTER TABLE public.place_intelligence_runs
  DROP CONSTRAINT IF EXISTS place_intelligence_runs_status_check;

ALTER TABLE public.place_intelligence_runs
  ADD CONSTRAINT place_intelligence_runs_status_check
  CHECK (status IN (
    'pending', 'queued', 'running', 'paused', 'cancelling', 'cancelled',
    'complete', 'failed'
  ));

COMMENT ON COLUMN public.place_intelligence_trial_runs.prep_status IS
  'ORCH-0737 v4 two-pass worker: NULL needs prep, ready can be scored. '
  'Issue #4276: review_failed means the review fetch failed, so the place was not '
  'sent to Gemini.';

CREATE OR REPLACE FUNCTION public.place_pool_derived_category(p_place public.place_pool)
RETURNS text
LANGUAGE sql
STABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT public.pg_map_primary_type_to_mingla_category(p_place.primary_type, p_place.types);
$$;

REVOKE ALL ON FUNCTION public.place_pool_derived_category(public.place_pool) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.place_pool_derived_category(public.place_pool) TO authenticated, service_role;

COMMENT ON FUNCTION public.place_pool_derived_category(public.place_pool) IS
  'Issue #4276: PostgREST computed column over the canonical category helper, so '
  'admin lists read and filter by category without re-implementing the mapping.';

-- PostgREST learns about the computed column when its schema cache reloads.
NOTIFY pgrst, 'reload schema';

COMMIT;
