-- Issue #4276 wave 2, T1 to T9 and B2: a search record that can prove a city is
-- covered, and that outlives any change to the city's tiles.
--
-- T1. Tiles are retired, never deleted. generate_tiles used to delete every tile,
-- and seeding_batches.tile_id cascaded, so New York, Paris, Brussels and Durham lost
-- their search history. The foreign key now sets NULL, each search keeps a snapshot
-- of its centre and radius, and a trigger refuses a direct tile delete. Deleting a
-- whole city still cascades, as it always has.
--
-- THE REPEATED-SEARCH BUG. create_run writes one batch per search config but stores
-- only the app category, and run_next_batch resolved that category to the FIRST
-- config. So a category with several configs ran the first one repeatedly:
-- casual_eats 3 times, nature_views and watch twice. casual_eats_world,
-- casual_eats_extended, picnic_park and live_performance were never searched in
-- those runs. Measured 2026-11-05 on every completed batch since 2026-04-16 (Cary,
-- Durham, Washington, Lagos, London), comparing repeats within a run and tile:
--   brunch_lunch_casual  494 groups of 3   494 identical counts   0 new places
--   nature               495 groups of 2   495 identical counts   0 new places
--   movies_theatre       495 groups of 2   495 identical counts   0 new places
-- Runs through 2026-04-15 are different: their second search differs in count and
-- found about 5,900 new places, because those rows ran per config and were only
-- rewritten to slugs afterwards. The cutoff below is that boundary.
--
-- search_config_id is now stored on every search and is what the worker runs. The
-- backfill records what each old row really did, and config_attribution says how we
-- know, so the never-searched configs show up as unfinished searches in T3:
--   recorded        written at search time (new rows)
--   batch_order     before the cutoff: position within its run, tile and category
--   first_config    on or after the cutoff: the bug always ran the first config
--   planned         never called Google, so it should run the config at its position
--   unknown         can't be identified: a split repeats every config in the category
--
-- capped is generated, so it can never disagree with places_returned. 20 is Google's
-- cap for one Nearby Search (SEARCH_RESULT_CAP in _shared/seedingGeometry.ts).
--
-- #2099 PIN. No new table has a place_pool_id or venue_id column or a foreign key to
-- place_pool, so #2099's fingerprinted list doesn't move. Filtered results are keyed
-- by google_place_id because they are, by definition, not in the pool.
--
-- Rollback: drop the new functions, tables and columns, and restore NOT NULL plus
-- ON DELETE CASCADE on seeding_batches.tile_id once no tile_id is NULL. Retired tiles
-- would then need deleting by hand, and that erases their history again.

BEGIN;

-- ── T1: tiles ───────────────────────────────────────────────────────────────
ALTER TABLE public.seeding_tiles
  ADD COLUMN parent_tile_id uuid REFERENCES public.seeding_tiles (id) ON DELETE SET NULL,
  ADD COLUMN level integer NOT NULL DEFAULT 0 CHECK (level >= 0),
  ADD COLUMN kind text NOT NULL DEFAULT 'grid' CHECK (kind IN ('grid', 'fill', 'split')),
  ADD COLUMN retired_at timestamptz;

COMMENT ON COLUMN public.seeding_tiles.retired_at IS
  'Issue #4276: set when a box or radius change replaces this tile. Retired tiles '
  'keep their search history and are never searched again.';

CREATE UNIQUE INDEX uniq_seeding_tiles_split_child
  ON public.seeding_tiles (parent_tile_id, row_idx, col_idx)
  WHERE parent_tile_id IS NOT NULL;

CREATE INDEX idx_seeding_tiles_city_active
  ON public.seeding_tiles (city_id)
  WHERE retired_at IS NULL;

CREATE OR REPLACE FUNCTION public.tg_seeding_tiles_never_deleted()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Depth above 1 means a foreign key is cascading from a deleted city.
  IF pg_trigger_depth() <= 1 THEN
    RAISE EXCEPTION 'seeding tiles are retired, never deleted (tile %)', OLD.id
      USING ERRCODE = 'PT409';
  END IF;
  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_seeding_tiles_never_deleted() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER seeding_tiles_never_deleted
  BEFORE DELETE ON public.seeding_tiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_seeding_tiles_never_deleted();

-- ── T1: searches ────────────────────────────────────────────────────────────
ALTER TABLE public.seeding_batches
  ALTER COLUMN tile_id DROP NOT NULL,
  DROP CONSTRAINT seeding_batches_tile_id_fkey,
  ADD CONSTRAINT seeding_batches_tile_id_fkey
    FOREIGN KEY (tile_id) REFERENCES public.seeding_tiles (id) ON DELETE SET NULL,
  ADD COLUMN center_lat double precision,
  ADD COLUMN center_lng double precision,
  ADD COLUMN radius_m integer,
  ADD COLUMN search_config_id text,
  ADD COLUMN config_attribution text NOT NULL DEFAULT 'recorded'
    CHECK (config_attribution IN ('recorded', 'batch_order', 'first_config', 'planned', 'unknown')),
  ADD COLUMN included_types_override text[],
  ADD COLUMN level integer NOT NULL DEFAULT 0 CHECK (level >= 0),
  ADD COLUMN capped boolean GENERATED ALWAYS AS (places_returned >= 20) STORED,
  ADD COLUMN split_state text CHECK (split_state IN ('split', 'unresolved')),
  ADD COLUMN split_run_id uuid REFERENCES public.seeding_runs (id) ON DELETE SET NULL;

COMMENT ON COLUMN public.seeding_batches.search_config_id IS
  'Issue #4276: the seeding config this search runs (SEEDING_CATEGORIES id). '
  'seeding_category holds only the app category, which several configs can share.';
COMMENT ON COLUMN public.seeding_batches.capped IS
  'Issue #4276: the search returned Google''s 20-result limit, so more may exist.';
COMMENT ON COLUMN public.seeding_batches.split_state IS
  'Issue #4276: split = child searches were created. unresolved = capped at the '
  'minimum radius on a single type, so nothing further can be searched; shown, '
  'never silently dropped. NULL on a capped search means it still needs a decision.';

CREATE INDEX idx_seeding_batches_tile_config
  ON public.seeding_batches (tile_id, search_config_id)
  WHERE tile_id IS NOT NULL;

CREATE INDEX idx_seeding_batches_capped_open
  ON public.seeding_batches (city_id)
  WHERE capped AND split_state IS NULL;

UPDATE public.seeding_batches b
   SET center_lat = t.center_lat,
       center_lng = t.center_lng,
       radius_m = t.radius_m
  FROM public.seeding_tiles t
 WHERE t.id = b.tile_id;

-- Frozen copy of SEEDING_CATEGORIES order. A deno test pins it to the TypeScript.
-- A function rather than a bare UPDATE only so the pg test can exercise it on rows
-- it inserts. It touches rows with no config yet, and new rows always have one.
CREATE OR REPLACE FUNCTION public.seeding_attribute_legacy_batches()
RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_updated integer;
BEGIN
  WITH config_map (slug, config_id, ord) AS (
    VALUES
      ('nature', 'nature_views', 1), ('nature', 'picnic_park', 2),
      ('icebreakers', 'first_meet', 1),
      ('drinks_and_music', 'drink', 1),
      ('brunch_lunch_casual', 'casual_eats', 1), ('brunch_lunch_casual', 'casual_eats_world', 2),
      ('brunch_lunch_casual', 'casual_eats_extended', 3),
      ('upscale_fine_dining', 'fine_dining', 1),
      ('movies_theatre', 'watch', 1), ('movies_theatre', 'live_performance', 2),
      ('creative_arts', 'creative_arts', 1),
      ('play', 'play', 1),
      ('flowers', 'flowers', 1),
      ('groceries', 'groceries', 1)
  ),
  ranked AS (
    SELECT b.id, b.seeding_category, b.created_at, b.google_api_calls,
           row_number() OVER (
             PARTITION BY b.run_id, b.tile_id, b.seeding_category ORDER BY b.batch_index
           ) AS ord
    FROM public.seeding_batches b
    WHERE b.search_config_id IS NULL
  ),
  attributed AS (
    SELECT r.id,
           CASE
             WHEN r.google_api_calls > 0 AND r.created_at >= TIMESTAMPTZ '2026-04-16 00:00:00+00'
               THEN first_cfg.config_id
             ELSE at_position.config_id
           END AS config_id,
           CASE
             WHEN r.google_api_calls = 0 THEN 'planned'
             WHEN r.created_at >= TIMESTAMPTZ '2026-04-16 00:00:00+00' THEN 'first_config'
             ELSE 'batch_order'
           END AS attribution
    FROM ranked r
    LEFT JOIN config_map first_cfg ON first_cfg.slug = r.seeding_category AND first_cfg.ord = 1
    LEFT JOIN config_map at_position ON at_position.slug = r.seeding_category AND at_position.ord = r.ord
  )
  UPDATE public.seeding_batches b
     SET search_config_id = a.config_id,
         config_attribution = CASE WHEN a.config_id IS NULL THEN 'unknown' ELSE a.attribution END
    FROM attributed a
   WHERE a.id = b.id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

SELECT public.seeding_attribute_legacy_batches();

-- ── Runs ────────────────────────────────────────────────────────────────────
ALTER TABLE public.seeding_runs
  ADD COLUMN kind text NOT NULL DEFAULT 'seed' CHECK (kind IN ('seed', 'fill', 'split')),
  ADD COLUMN level integer NOT NULL DEFAULT 0 CHECK (level >= 0),
  ADD COLUMN estimated_cost_usd double precision;

-- ── T7: results dropped at seed ─────────────────────────────────────────────
CREATE TABLE public.seeding_filtered_results (
  city_id uuid NOT NULL REFERENCES public.seeding_cities (id) ON DELETE CASCADE,
  google_place_id text NOT NULL,
  reason text NOT NULL CHECK (reason IN ('no_photos', 'closed_permanently')),
  name text,
  primary_type text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (city_id, google_place_id, reason)
);

COMMENT ON TABLE public.seeding_filtered_results IS
  'Issue #4276 T7: places Google returned that seeding dropped, per city. Only ids '
  'and a label; decision D2 chooses what happens to them.';

ALTER TABLE public.seeding_filtered_results ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.seeding_filtered_results FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.seeding_filtered_results TO authenticated;
GRANT ALL ON TABLE public.seeding_filtered_results TO service_role;

CREATE POLICY seeding_filtered_results_admin_read
  ON public.seeding_filtered_results
  FOR SELECT TO authenticated
  USING (public.is_admin_user());

-- ── T8: completeness checks ─────────────────────────────────────────────────
CREATE TABLE public.seeding_completeness_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id uuid NOT NULL REFERENCES public.seeding_cities (id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('completed', 'failed')),
  searches_planned integer NOT NULL,
  searches_failed integer NOT NULL DEFAULT 0,
  searches_capped integer NOT NULL DEFAULT 0,
  radius_m integer NOT NULL,
  results_in_box integer NOT NULL DEFAULT 0,
  results_outside_box integer NOT NULL DEFAULT 0,
  results_in_pool integer NOT NULL DEFAULT 0,
  results_missing integer NOT NULL DEFAULT 0,
  results_dropped_at_seed integer NOT NULL DEFAULT 0,
  missing_share double precision,
  missing_by_type jsonb NOT NULL DEFAULT '[]'::jsonb,
  unknown_types jsonb NOT NULL DEFAULT '[]'::jsonb,
  points jsonb NOT NULL DEFAULT '[]'::jsonb,
  error_message text,
  cost_usd double precision NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_seeding_completeness_checks_city
  ON public.seeding_completeness_checks (city_id, created_at DESC);

COMMENT ON TABLE public.seeding_completeness_checks IS
  'Issue #4276 T8: what is still missing after a city''s searches. unknown_types are '
  'place types no search config asks for, for human review.';

ALTER TABLE public.seeding_completeness_checks ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.seeding_completeness_checks FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.seeding_completeness_checks TO authenticated;
GRANT ALL ON TABLE public.seeding_completeness_checks TO service_role;

CREATE POLICY seeding_completeness_checks_admin_read
  ON public.seeding_completeness_checks
  FOR SELECT TO authenticated
  USING (public.is_admin_user());

-- ── T9: replacing tiles ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.seeding_replace_tiles(
  p_city_id uuid,
  p_retire_ids uuid[],
  p_tiles jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_next integer;
  v_retired integer;
  v_inserted integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('seeding_run_city'), hashtext(p_city_id::text));

  IF EXISTS (
    SELECT 1 FROM public.seeding_runs
     WHERE city_id = p_city_id
       AND status IN ('preparing', 'ready', 'running', 'paused')
  ) THEN
    RAISE EXCEPTION 'city % has an active seeding run; finish or cancel it first', p_city_id
      USING ERRCODE = 'PT409';
  END IF;

  -- A retired tile takes every split below it along.
  WITH RECURSIVE doomed AS (
    SELECT t.id FROM public.seeding_tiles t
     WHERE t.city_id = p_city_id AND t.id = ANY (p_retire_ids)
    UNION
    SELECT c.id FROM public.seeding_tiles c JOIN doomed d ON c.parent_tile_id = d.id
  )
  UPDATE public.seeding_tiles t
     SET retired_at = now()
    FROM doomed d
   WHERE t.id = d.id AND t.retired_at IS NULL;
  GET DIAGNOSTICS v_retired = ROW_COUNT;

  SELECT COALESCE(max(tile_index), -1) INTO v_next
    FROM public.seeding_tiles WHERE city_id = p_city_id;

  INSERT INTO public.seeding_tiles (
    city_id, tile_index, center_lat, center_lng, radius_m, row_idx, col_idx, kind, level
  )
  SELECT p_city_id, v_next + n.ord, n.center_lat, n.center_lng, n.radius_m, n.row_idx, n.col_idx, 'grid', 0
  FROM ROWS FROM (
    jsonb_to_recordset(COALESCE(p_tiles, '[]'::jsonb)) AS (
      center_lat double precision, center_lng double precision, radius_m integer,
      row_idx integer, col_idx integer
    )
  ) WITH ORDINALITY AS n (center_lat, center_lng, radius_m, row_idx, col_idx, ord);
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  RETURN jsonb_build_object('retired', v_retired, 'inserted', v_inserted);
END;
$$;

-- ── T3, T4, T5: starting a level of searches ───────────────────────────────
CREATE OR REPLACE FUNCTION public.seeding_start_search_level(
  p_city_id uuid,
  p_kind text,
  p_level integer,
  p_estimated_cost_usd double precision,
  p_tiles jsonb,
  p_batches jsonb,
  p_split_batch_ids uuid[],
  p_unresolved_batch_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_run_id uuid;
  v_next integer;
  v_expected integer := jsonb_array_length(COALESCE(p_batches, '[]'::jsonb));
  v_inserted integer := 0;
  v_unresolved integer := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('seeding_run_city'), hashtext(p_city_id::text));

  IF EXISTS (
    SELECT 1 FROM public.seeding_runs
     WHERE city_id = p_city_id
       AND status IN ('preparing', 'ready', 'running', 'paused')
  ) THEN
    RAISE EXCEPTION 'city % has an active seeding run; finish or cancel it first', p_city_id
      USING ERRCODE = 'PT409';
  END IF;

  UPDATE public.seeding_batches
     SET split_state = 'unresolved'
   WHERE city_id = p_city_id AND id = ANY (COALESCE(p_unresolved_batch_ids, ARRAY[]::uuid[]));
  GET DIAGNOSTICS v_unresolved = ROW_COUNT;

  -- Nothing to search: logging what can't be resolved costs nothing and needs no run.
  IF v_expected = 0 THEN
    RETURN jsonb_build_object('run_id', NULL, 'batches', 0, 'unresolved', v_unresolved);
  END IF;

  SELECT COALESCE(max(tile_index), -1) INTO v_next
    FROM public.seeding_tiles WHERE city_id = p_city_id;

  INSERT INTO public.seeding_tiles (
    id, city_id, tile_index, center_lat, center_lng, radius_m, row_idx, col_idx,
    parent_tile_id, level, kind
  )
  SELECT n.id, p_city_id, v_next + n.ord, n.center_lat, n.center_lng, n.radius_m, n.row_idx, n.col_idx,
         n.parent_tile_id, n.level, n.kind
  FROM ROWS FROM (
    jsonb_to_recordset(COALESCE(p_tiles, '[]'::jsonb)) AS (
      id uuid, center_lat double precision, center_lng double precision, radius_m integer,
      row_idx integer, col_idx integer, parent_tile_id uuid, level integer, kind text
    )
  ) WITH ORDINALITY AS n (id, center_lat, center_lng, radius_m, row_idx, col_idx, parent_tile_id, level, kind, ord);

  INSERT INTO public.seeding_runs (
    city_id, selected_categories, total_tiles, total_batches, status, kind, level, estimated_cost_usd
  )
  SELECT p_city_id,
         ARRAY(SELECT DISTINCT x ->> 'seeding_category' FROM jsonb_array_elements(p_batches) x ORDER BY 1),
         (SELECT count(DISTINCT x ->> 'tile_id') FROM jsonb_array_elements(p_batches) x),
         v_expected, 'ready', p_kind, p_level, p_estimated_cost_usd
  RETURNING id INTO v_run_id;

  INSERT INTO public.seeding_batches (
    run_id, city_id, tile_id, tile_index, seeding_category, app_category, batch_index, status,
    center_lat, center_lng, radius_m, search_config_id, included_types_override, level
  )
  SELECT v_run_id, p_city_id, t.id, t.tile_index, b.seeding_category, b.app_category, b.ord - 1, 'pending',
         t.center_lat, t.center_lng, t.radius_m, b.search_config_id,
         CASE WHEN b.included_types_override IS NULL THEN NULL
              ELSE ARRAY(SELECT jsonb_array_elements_text(b.included_types_override)) END,
         b.level
  FROM ROWS FROM (
    jsonb_to_recordset(p_batches) AS (
      tile_id uuid, seeding_category text, app_category text, search_config_id text,
      included_types_override jsonb, level integer
    )
  ) WITH ORDINALITY AS b (tile_id, seeding_category, app_category, search_config_id, included_types_override, level, ord)
  JOIN public.seeding_tiles t
    ON t.id = b.tile_id AND t.city_id = p_city_id AND t.retired_at IS NULL;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  IF v_inserted <> v_expected THEN
    RAISE EXCEPTION 'search plan names a tile that is retired or in another city (% of % valid)',
      v_inserted, v_expected;
  END IF;

  UPDATE public.seeding_batches
     SET split_state = 'split', split_run_id = v_run_id
   WHERE city_id = p_city_id AND id = ANY (COALESCE(p_split_batch_ids, ARRAY[]::uuid[]));

  RETURN jsonb_build_object('run_id', v_run_id, 'batches', v_inserted, 'unresolved', v_unresolved);
END;
$$;

-- ── T4: what needs splitting ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.seeding_capped_searches_to_split(p_city_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'batch_id', b.id,
    'tile_id', t.id,
    'tile_index', t.tile_index,
    'center_lat', t.center_lat,
    'center_lng', t.center_lng,
    'radius_m', t.radius_m,
    'row_idx', t.row_idx,
    'col_idx', t.col_idx,
    'level', b.level,
    'seeding_category', b.seeding_category,
    'search_config_id', b.search_config_id,
    'config_attribution', b.config_attribution,
    'included_types_override', b.included_types_override
  ) ORDER BY b.level, t.tile_index, b.batch_index), '[]'::jsonb)
  FROM public.seeding_batches b
  JOIN public.seeding_tiles t ON t.id = b.tile_id AND t.retired_at IS NULL
  WHERE b.city_id = p_city_id
    AND b.status = 'completed'
    AND b.capped
    AND b.split_state IS NULL;
$$;

CREATE OR REPLACE FUNCTION public.seeding_existing_split_children(p_city_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', t.id, 'parent_tile_id', t.parent_tile_id, 'row_idx', t.row_idx, 'col_idx', t.col_idx
  )), '[]'::jsonb)
  FROM public.seeding_tiles t
  WHERE t.city_id = p_city_id AND t.parent_tile_id IS NOT NULL AND t.retired_at IS NULL;
$$;

-- ── T3: what never finished ─────────────────────────────────────────────────
-- p_configs is [{id, slug}] from SEEDING_CATEGORIES. A skipped batch counts: it was
-- never searched, and cancelling a run marks its remainder skipped.
CREATE OR REPLACE FUNCTION public.seeding_unfinished_searches(p_city_id uuid, p_configs jsonb)
RETURNS TABLE (
  tile_id uuid,
  search_config_id text,
  included_types_override text[],
  level integer,
  reason text
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH configs AS (
    SELECT c.id, c.slug FROM jsonb_to_recordset(p_configs) AS c (id text, slug text)
  ),
  active AS (
    SELECT t.id, t.kind FROM public.seeding_tiles t
     WHERE t.city_id = p_city_id AND t.retired_at IS NULL
  )
  -- Every grid and fill tile owes every config one finished search.
  SELECT a.id, c.id, NULL::text[], 0,
         CASE WHEN EXISTS (
           SELECT 1 FROM public.seeding_batches b
            WHERE b.tile_id = a.id AND b.search_config_id = c.id AND b.level = 0
              AND b.google_api_calls > 0
         ) THEN 'failed' ELSE 'never_searched' END
  FROM active a CROSS JOIN configs c
  WHERE a.kind IN ('grid', 'fill')
    AND NOT EXISTS (
      SELECT 1 FROM public.seeding_batches b
       WHERE b.tile_id = a.id
         AND b.status = 'completed'
         AND b.included_types_override IS NULL
         AND (b.search_config_id = c.id
              OR (b.search_config_id IS NULL AND b.seeding_category = c.slug))
    )
  UNION ALL
  -- A split search owes what was asked of it, and nothing more.
  SELECT DISTINCT b.tile_id, b.search_config_id, b.included_types_override, b.level,
         CASE WHEN b.status = 'failed' THEN 'failed' ELSE 'never_searched' END
  FROM public.seeding_batches b
  JOIN active a ON a.id = b.tile_id
  WHERE b.city_id = p_city_id
    AND b.level > 0
    AND b.status <> 'completed'
    AND NOT EXISTS (
      SELECT 1 FROM public.seeding_batches done
       WHERE done.tile_id = b.tile_id
         AND done.search_config_id IS NOT DISTINCT FROM b.search_config_id
         AND done.included_types_override IS NOT DISTINCT FROM b.included_types_override
         AND done.status = 'completed'
    );
$$;

CREATE OR REPLACE FUNCTION public.seeding_unfinished_searches_json(p_city_id uuid, p_configs jsonb)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(u)), '[]'::jsonb)
  FROM public.seeding_unfinished_searches(p_city_id, p_configs) u;
$$;

-- ── The city panel's record ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.seeding_city_search_status(p_city_id uuid, p_configs jsonb)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'tiles', (
      SELECT jsonb_build_object(
        'active', count(*) FILTER (WHERE retired_at IS NULL),
        'retired', count(*) FILTER (WHERE retired_at IS NOT NULL),
        'grid', count(*) FILTER (WHERE retired_at IS NULL AND kind = 'grid'),
        'fill', count(*) FILTER (WHERE retired_at IS NULL AND kind = 'fill'),
        'split', count(*) FILTER (WHERE retired_at IS NULL AND kind = 'split')
      ) FROM public.seeding_tiles WHERE city_id = p_city_id
    ),
    'unfinished', (
      SELECT jsonb_build_object(
        'total', count(*),
        'never_searched', count(*) FILTER (WHERE u.reason = 'never_searched'),
        'failed', count(*) FILTER (WHERE u.reason = 'failed')
      ) FROM public.seeding_unfinished_searches(p_city_id, p_configs) u
    ),
    'capped_open', (
      SELECT count(*) FROM public.seeding_batches b
        JOIN public.seeding_tiles t ON t.id = b.tile_id AND t.retired_at IS NULL
       WHERE b.city_id = p_city_id AND b.status = 'completed' AND b.capped AND b.split_state IS NULL
    ),
    'unresolved', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'batch_id', b.id, 'tile_id', b.tile_id, 'center_lat', b.center_lat, 'center_lng', b.center_lng,
        'radius_m', b.radius_m, 'search_config_id', b.search_config_id,
        'types', b.included_types_override
      ) ORDER BY b.created_at), '[]'::jsonb)
      FROM public.seeding_batches b
      WHERE b.city_id = p_city_id AND b.split_state = 'unresolved'
    ),
    'dropped_at_seed', (
      SELECT jsonb_build_object(
        'no_photos', count(*) FILTER (WHERE f.reason = 'no_photos'),
        'closed_permanently', count(*) FILTER (WHERE f.reason = 'closed_permanently')
      ) FROM public.seeding_filtered_results f WHERE f.city_id = p_city_id
    ),
    'levels', (
      SELECT COALESCE(jsonb_agg(l ORDER BY l.created_at), '[]'::jsonb) FROM (
        SELECT r.id AS run_id, r.kind, r.level, r.status, r.created_at,
               r.total_batches, r.completed_batches, r.failed_batches, r.skipped_batches,
               r.total_places_new, r.total_cost_usd, r.estimated_cost_usd,
               (SELECT count(*) FROM public.seeding_batches b WHERE b.run_id = r.id AND b.capped) AS capped_searches
        FROM public.seeding_runs r
        WHERE r.city_id = p_city_id AND r.kind IN ('fill', 'split')
      ) l
    ),
    'active_run', (
      SELECT jsonb_build_object('id', r.id, 'status', r.status, 'kind', r.kind)
      FROM public.seeding_runs r
      WHERE r.city_id = p_city_id AND r.status IN ('preparing', 'ready', 'running', 'paused')
      ORDER BY r.created_at DESC LIMIT 1
    ),
    'last_completeness_check', (
      SELECT to_jsonb(c) FROM public.seeding_completeness_checks c
       WHERE c.city_id = p_city_id ORDER BY c.created_at DESC LIMIT 1
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.seeding_active_tiles(p_city_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', t.id, 'center_lat', t.center_lat, 'center_lng', t.center_lng, 'radius_m', t.radius_m,
    'kind', t.kind, 'tile_index', t.tile_index, 'row_idx', t.row_idx, 'col_idx', t.col_idx,
    'level', t.level
  ) ORDER BY t.tile_index), '[]'::jsonb)
  FROM public.seeding_tiles t
  WHERE t.city_id = p_city_id AND t.retired_at IS NULL;
$$;

-- ── T9: history of retired tiles ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.seeding_retired_tile_history(p_city_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'retired_at', h.retired_at, 'tiles', h.tiles, 'searches', h.searches,
    'places_new', h.places_new, 'cost_usd', h.cost_usd
  ) ORDER BY h.retired_at DESC), '[]'::jsonb)
  FROM (
    SELECT t.retired_at,
           count(DISTINCT t.id) AS tiles,
           count(b.id) AS searches,
           COALESCE(sum(b.places_new_inserted), 0) AS places_new,
           COALESCE(sum(b.estimated_cost_usd), 0) AS cost_usd
    FROM public.seeding_tiles t
    LEFT JOIN public.seeding_batches b ON b.tile_id = t.id
    WHERE t.city_id = p_city_id AND t.retired_at IS NOT NULL
    GROUP BY t.retired_at
  ) h;
$$;

-- ── B2, T9: places outside a box ────────────────────────────────────────────
-- With no city, every city against its stored box. With a city and a box, that city
-- against the proposed box, for the warning before a change. Read only: nothing is
-- ever deleted from this report.
CREATE OR REPLACE FUNCTION public.seeding_places_outside_box(
  p_city_id uuid DEFAULT NULL,
  p_sw_lat double precision DEFAULT NULL,
  p_sw_lng double precision DEFAULT NULL,
  p_ne_lat double precision DEFAULT NULL,
  p_ne_lng double precision DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'city_id', r.id, 'name', r.name, 'status', r.status,
    'outside_total', r.outside_total, 'outside_active', r.outside_active,
    'outside_servable', r.outside_servable, 'places_total', r.places_total
  ) ORDER BY r.outside_active DESC, r.name), '[]'::jsonb)
  FROM (
    SELECT c.id, c.name, c.status,
           count(pp.id) AS places_total,
           count(pp.id) FILTER (WHERE outside) AS outside_total,
           count(pp.id) FILTER (WHERE outside AND pp.is_active) AS outside_active,
           count(pp.id) FILTER (WHERE outside AND pp.is_servable) AS outside_servable
    FROM public.seeding_cities c
    JOIN public.place_pool pp ON pp.city_id = c.id
    CROSS JOIN LATERAL (
      SELECT (
        pp.lat < COALESCE(p_sw_lat, c.bbox_sw_lat) OR pp.lat > COALESCE(p_ne_lat, c.bbox_ne_lat)
        OR pp.lng < COALESCE(p_sw_lng, c.bbox_sw_lng) OR pp.lng > COALESCE(p_ne_lng, c.bbox_ne_lng)
      ) AS outside
    ) o
    WHERE p_city_id IS NULL OR c.id = p_city_id
    GROUP BY c.id, c.name, c.status
  ) r;
$$;

-- All service-role only: the admin reaches these through admin-seed-places, which
-- checks the admin first.
REVOKE ALL ON FUNCTION public.seeding_attribute_legacy_batches() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.seeding_replace_tiles(uuid, uuid[], jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.seeding_start_search_level(uuid, text, integer, double precision, jsonb, jsonb, uuid[], uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.seeding_capped_searches_to_split(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.seeding_existing_split_children(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.seeding_unfinished_searches(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.seeding_unfinished_searches_json(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.seeding_city_search_status(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.seeding_active_tiles(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.seeding_retired_tile_history(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.seeding_places_outside_box(uuid, double precision, double precision, double precision, double precision) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.seeding_attribute_legacy_batches() TO service_role;
GRANT EXECUTE ON FUNCTION public.seeding_replace_tiles(uuid, uuid[], jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.seeding_start_search_level(uuid, text, integer, double precision, jsonb, jsonb, uuid[], uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.seeding_capped_searches_to_split(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.seeding_existing_split_children(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.seeding_unfinished_searches(uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.seeding_unfinished_searches_json(uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.seeding_city_search_status(uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.seeding_active_tiles(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.seeding_retired_tile_history(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.seeding_places_outside_box(uuid, double precision, double precision, double precision, double precision) TO service_role;

COMMIT;
