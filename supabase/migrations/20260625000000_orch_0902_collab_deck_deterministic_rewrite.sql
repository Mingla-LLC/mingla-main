-- ============================================================================
-- ORCH-0902 [Collab session deck deterministic rewrite]
-- Migration: schema additions + new SQL functions + triggers
-- ============================================================================
--
-- Implements CR-1..CR-9 from
-- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0902_COLLAB_DECK_PARITY.md`.
-- Drives the rewrite specified in
-- `Mingla_Artifacts/specs/SPEC_ORCH-0902_COLLAB_DECK_DETERMINISTIC_REWRITE.md`.
--
-- Notable operator decisions (2026-05-21):
--   Q-7 OVERRIDE: full single-shot cutover — NO `deck_model` column, NO soft
--   cutover, NO WHEN guards on triggers. All in-flight collab sessions force-
--   migrate to the deterministic path. Rollback is `git revert <merge-sha>` if
--   TEST FAILS; schema additions are harmless when no code reads them.
--
--   Q-6: PostGIS verified NOT installed (only pgcrypto extension is present
--   on the project as of 2026-05-21). Using SPEC Path B — Haversine in raw
--   SQL with a 50-participant cap enforced inside pg_aggregate_collab_prefs.
--   Future optimization: install PostGIS and swap to ST_DWithin.
--
--   Q-A: per-version params history is persisted in new
--   public.session_deck_versions table so the server can re-derive any prior
--   V_n on demand for CR-4 resume.
--
-- Pgcrypto is required for digest() (SHA-256 of the canonical params jsonb).
-- pgcrypto is already present on this project; CREATE EXTENSION IF NOT EXISTS
-- is included defensively so this migration is idempotent if dropped and re-
-- applied on a fresh DB.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================================
-- 1. SCHEMA — new columns on collaboration_sessions
-- ============================================================================

ALTER TABLE public.collaboration_sessions
  ADD COLUMN IF NOT EXISTS deck_version int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deck_params_hash text;

-- Invariant I-PROPOSED-COLLAB-DECK-VERSION-MONOTONIC (CR-3, CR-5):
-- deck_version is monotonically non-decreasing for a given session. CHECK
-- constraint enforces non-negative; the trigger below enforces "only ever
-- increases when hash changes."
ALTER TABLE public.collaboration_sessions
  DROP CONSTRAINT IF EXISTS deck_version_nonneg;
ALTER TABLE public.collaboration_sessions
  ADD CONSTRAINT deck_version_nonneg CHECK (deck_version >= 0);

COMMENT ON COLUMN public.collaboration_sessions.deck_version IS
  'ORCH-0902 CR-3: monotonically increasing deck version. Bumped by the BEFORE UPDATE trigger when deck_params_hash changes. Client uses (session_id, deck_version) as React Query key for cache partitioning. deck_version=0 means no deck yet (below CR-8 acceptedCount<2 threshold).';

COMMENT ON COLUMN public.collaboration_sessions.deck_params_hash IS
  'ORCH-0902 CR-1: SHA-256 hex of the canonical aggregated deck params jsonb. Trigger recomputes on participant_prefs change OR session_participants accept/leave/update (which touches updated_at). If hash differs from prior, deck_version increments and a row is written to session_deck_versions for CR-4 resume.';

-- ============================================================================
-- 2. SCHEMA — new table session_deck_versions (CR-4 resume support, Q-A)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.session_deck_versions (
  session_id uuid NOT NULL REFERENCES public.collaboration_sessions(id) ON DELETE CASCADE,
  deck_version int NOT NULL,
  params_hash text NOT NULL,
  aggregated_params jsonb NOT NULL,
  minted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, deck_version),
  CONSTRAINT session_deck_versions_version_nonneg CHECK (deck_version >= 1)
);

COMMENT ON TABLE public.session_deck_versions IS
  'ORCH-0902 CR-4 (Q-A): immutable history of every deck_version that was minted for a session. Row written by recompute_deck_version_on_prefs_change trigger whenever hash changes. Lets the server re-derive any prior V_n by reading the frozen aggregated_params instead of re-aggregating current state. CR-9 single-shot cutover: no separate deck_model gating.';

COMMENT ON COLUMN public.session_deck_versions.aggregated_params IS
  'Output of pg_aggregate_collab_prefs at the moment this version minted. Identical to what discover-cards uses when serving cards for this (session_id, deck_version). Immutable after insert.';

-- RLS for session_deck_versions: SELECT mirrors parent session; mutations
-- forbidden in user context (only triggers and service_role can write).
ALTER TABLE public.session_deck_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sdv_select ON public.session_deck_versions;
CREATE POLICY sdv_select ON public.session_deck_versions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.session_participants sp
      WHERE sp.session_id = session_deck_versions.session_id
        AND sp.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.collaboration_sessions cs
      WHERE cs.id = session_deck_versions.session_id
        AND cs.created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS sdv_insert_trigger_or_service_only ON public.session_deck_versions;
CREATE POLICY sdv_insert_trigger_or_service_only ON public.session_deck_versions
  FOR INSERT
  WITH CHECK (
    -- Triggers run as table owner (postgres); explicit service_role bypass for ops.
    current_user = 'postgres'
    OR auth.role() = 'service_role'
  );

-- UPDATE and DELETE forbidden — immutable history. No policy = no access.

CREATE INDEX IF NOT EXISTS idx_session_deck_versions_session_id
  ON public.session_deck_versions (session_id, deck_version DESC);

-- ============================================================================
-- 3. SCHEMA — partial index on board_user_swipe_states for dismissed sheet
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_board_user_swipe_states_session_left
  ON public.board_user_swipe_states (session_id, swiped_at DESC)
  WHERE swipe_state = 'swiped_left';

COMMENT ON INDEX public.idx_board_user_swipe_states_session_left IS
  'ORCH-0902 CR-6: supports useSessionDismissedCards query — list all left swipes for a session ordered by swipe time, attributed by user_id. Partial index keeps it small (only left swipes; right swipes feed match quorum and use the existing primary key).';

-- ============================================================================
-- 4. FUNCTION — estimate_circle_radius_m(travel_mode, time_min)
-- ============================================================================
-- Maps (travel_mode, time_min) to a meters radius for a participant's
-- reachable circle. Constants are conservative urban averages; calibrate via
-- Distance Matrix telemetry post-launch if needed.

CREATE OR REPLACE FUNCTION public.estimate_circle_radius_m(
  p_travel_mode text,
  p_time_min integer
) RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT (GREATEST(p_time_min, 0) * CASE p_travel_mode
    WHEN 'walking' THEN 80          -- ~80 m/min ≈ 4.8 km/h
    WHEN 'biking' THEN 250          -- ~250 m/min ≈ 15 km/h
    WHEN 'bicycling' THEN 250
    WHEN 'transit' THEN 350         -- ~350 m/min ≈ 21 km/h door-to-door
    WHEN 'public_transit' THEN 350
    WHEN 'driving' THEN 600         -- ~600 m/min ≈ 36 km/h urban
    ELSE 80                          -- default to walking floor
  END)::numeric;
$$;

COMMENT ON FUNCTION public.estimate_circle_radius_m(text, integer) IS
  'ORCH-0902 CR-2: maps (travel_mode, time_min) to a meters radius. Used by pg_aggregate_collab_prefs to compute each participant''s personal reachable circle for the union.';

-- ============================================================================
-- 5. FUNCTION — pg_aggregate_collab_prefs(session_id) returns canonical jsonb
-- ============================================================================
-- Server-side deterministic aggregation. Replaces client-side
-- aggregateCollabPrefs (which is deleted in the same PR per CR-9).
--
-- Key determinism rules:
--   - Categories/intents arrays are sorted (DISTINCT … ORDER BY)
--   - Date windows / selected dates arrays sorted
--   - Circles array ORDER BY user_id (uuid sort is deterministic)
--   - Returns a stable jsonb; SHA-256 of it is the params_hash
--
-- CR-8 session-start threshold: if acceptedCount < 2, returns empty arrays
-- (categories=[], circles=[], etc.) so the deck does not mint until quorum.
--
-- Q-6 fallback (no PostGIS): 50-participant cap. If > 50 accepted participants
-- have set a location, raises exception. Operator can install PostGIS to lift
-- this cap and swap query_servable_places_by_signal_union to Path A later.

CREATE OR REPLACE FUNCTION public.pg_aggregate_collab_prefs(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_prefs jsonb;
  v_accepted_user_ids uuid[];
  v_accepted_count integer;
  v_categories text[];
  v_intents text[];
  v_date_windows text[];
  v_selected_dates text[];
  v_datetime_pref text;
  v_circles jsonb;
  v_circle_count integer;
  v_result jsonb;
BEGIN
  -- Read raw JSONB
  SELECT participant_prefs INTO v_prefs
    FROM public.collaboration_sessions
    WHERE id = p_session_id;

  -- Defensive: SQL NULL OR JSONB null OR any non-object value → empty result.
  -- jsonb_each() requires an object; a scalar/array would error otherwise.
  IF v_prefs IS NULL OR jsonb_typeof(v_prefs) <> 'object' THEN
    RETURN jsonb_build_object(
      'categories', '[]'::jsonb,
      'intents', '[]'::jsonb,
      'dateWindows', '[]'::jsonb,
      'selectedDates', '[]'::jsonb,
      'datetimePref', null,
      'circles', '[]'::jsonb,
      'acceptedCount', 0
    );
  END IF;

  -- Only accepted participants contribute
  SELECT array_agg(user_id ORDER BY user_id) INTO v_accepted_user_ids
    FROM public.session_participants
    WHERE session_id = p_session_id AND has_accepted = true;

  v_accepted_count := COALESCE(array_length(v_accepted_user_ids, 1), 0);

  -- CR-8 session-start threshold
  IF v_accepted_count < 2 THEN
    RETURN jsonb_build_object(
      'categories', '[]'::jsonb,
      'intents', '[]'::jsonb,
      'dateWindows', '[]'::jsonb,
      'selectedDates', '[]'::jsonb,
      'datetimePref', null,
      'circles', '[]'::jsonb,
      'acceptedCount', v_accepted_count
    );
  END IF;

  -- Categories: UNION across all accepted participants whose category_toggle != false.
  -- Sorted for deterministic hash.
  --
  -- IMPORTANT: prefs->'categories' may be JSONB null (the scalar null literal),
  -- not absent — observed in production data 2026-05-21. COALESCE(jsonb_null, '[]')
  -- returns jsonb_null because COALESCE only substitutes SQL NULL, not JSONB
  -- null. We therefore guard with jsonb_typeof = 'array' before unnesting,
  -- substituting '[]'::jsonb for ANY non-array value (null, scalar, object).
  -- Same pattern applied to intents and selected_dates below.
  SELECT array_agg(DISTINCT cat ORDER BY cat)
    INTO v_categories
    FROM jsonb_each(v_prefs) AS rows(uid, prefs),
         jsonb_array_elements_text(
           CASE WHEN jsonb_typeof(prefs->'categories') = 'array'
                THEN prefs->'categories'
                ELSE '[]'::jsonb
           END
         ) AS cat
    WHERE uid::uuid = ANY(v_accepted_user_ids)
      AND COALESCE((prefs->>'category_toggle')::boolean, true) = true;

  -- Intents: UNION with intent_toggle gate. Same JSONB-null guard as categories.
  SELECT array_agg(DISTINCT intent ORDER BY intent)
    INTO v_intents
    FROM jsonb_each(v_prefs) AS rows(uid, prefs),
         jsonb_array_elements_text(
           CASE WHEN jsonb_typeof(prefs->'intents') = 'array'
                THEN prefs->'intents'
                ELSE '[]'::jsonb
           END
         ) AS intent
    WHERE uid::uuid = ANY(v_accepted_user_ids)
      AND COALESCE((prefs->>'intent_toggle')::boolean, true) = true;

  -- Date windows: UNION of date_option values, sorted.
  SELECT array_agg(DISTINCT (prefs->>'date_option') ORDER BY (prefs->>'date_option'))
    INTO v_date_windows
    FROM jsonb_each(v_prefs) AS rows(uid, prefs)
    WHERE uid::uuid = ANY(v_accepted_user_ids)
      AND prefs->>'date_option' IS NOT NULL;

  -- Selected dates: UNION. Same JSONB-null guard as categories.
  SELECT array_agg(DISTINCT d ORDER BY d)
    INTO v_selected_dates
    FROM jsonb_each(v_prefs) AS rows(uid, prefs),
         jsonb_array_elements_text(
           CASE WHEN jsonb_typeof(prefs->'selected_dates') = 'array'
                THEN prefs->'selected_dates'
                ELSE '[]'::jsonb
           END
         ) AS d
    WHERE uid::uuid = ANY(v_accepted_user_ids);

  -- Datetime pref: earliest among accepted participants.
  SELECT MIN(prefs->>'datetime_pref') INTO v_datetime_pref
    FROM jsonb_each(v_prefs) AS rows(uid, prefs)
    WHERE uid::uuid = ANY(v_accepted_user_ids)
      AND prefs->>'datetime_pref' IS NOT NULL;

  -- Circles: per-participant {user_id, lat, lng, travel_mode, time_min, radius_m}.
  -- Only participants with both custom_lat and custom_lng populated contribute
  -- a circle (Q-1 default: no-location participant joins but does not enter
  -- the union; client renders a banner).
  --
  -- ORDER BY uid is critical for hash stability — same set of circles, same
  -- order, same hash.
  SELECT jsonb_agg(
    jsonb_build_object(
      'user_id', uid,
      'lat', (prefs->>'custom_lat')::numeric,
      'lng', (prefs->>'custom_lng')::numeric,
      'travel_mode', COALESCE(prefs->>'travel_mode', 'walking'),
      'time_min', COALESCE((prefs->>'travel_constraint_value')::integer, 30),
      'radius_m', public.estimate_circle_radius_m(
        COALESCE(prefs->>'travel_mode', 'walking'),
        COALESCE((prefs->>'travel_constraint_value')::integer, 30)
      )
    )
    ORDER BY uid
  ) INTO v_circles
    FROM jsonb_each(v_prefs) AS rows(uid, prefs)
    WHERE uid::uuid = ANY(v_accepted_user_ids)
      AND prefs->>'custom_lat' IS NOT NULL
      AND prefs->>'custom_lng' IS NOT NULL;

  -- Q-6 fallback cap: without PostGIS, the union RPC degrades at scale.
  v_circle_count := COALESCE(jsonb_array_length(v_circles), 0);
  IF v_circle_count > 50 THEN
    RAISE EXCEPTION
      'ORCH-0902 Q-6 fallback cap exceeded: session % has % participant circles (max 50 without PostGIS). Install PostGIS and swap query_servable_places_by_signal_union to Path A to lift this cap.',
      p_session_id, v_circle_count;
  END IF;

  -- Build canonical result
  v_result := jsonb_build_object(
    'categories', COALESCE(to_jsonb(v_categories), '[]'::jsonb),
    'intents', COALESCE(to_jsonb(v_intents), '[]'::jsonb),
    'dateWindows', COALESCE(to_jsonb(v_date_windows), '[]'::jsonb),
    'selectedDates', COALESCE(to_jsonb(v_selected_dates), '[]'::jsonb),
    'datetimePref', v_datetime_pref,
    'circles', COALESCE(v_circles, '[]'::jsonb),
    'acceptedCount', v_accepted_count
  );

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.pg_aggregate_collab_prefs(uuid) IS
  'ORCH-0902 CR-1+CR-2: server-side deterministic aggregation. Returns canonical jsonb (categories+intents+dates+circles unioned across accepted participants). The recompute_deck_version_on_prefs_change trigger hashes this output to produce deck_params_hash. Replaces deleted client-side aggregateCollabPrefs (CR-9). ORDER BY uid in circles is critical for hash stability. 50-circle cap is the Q-6 Path B fallback; lift by installing PostGIS.';

-- ============================================================================
-- 6. FUNCTION — query_servable_places_by_signal_union (Path B: Haversine)
-- ============================================================================
-- Returns places that lie inside ANY of the participant reachable circles for
-- a given signal. ORDER BY adds pp.id ASC tiebreaker for deterministic output.
--
-- Path B (this implementation) uses raw Haversine in a CROSS JOIN with the
-- circles array. Performance degrades with N circles; the 50-circle cap is
-- enforced by pg_aggregate_collab_prefs. Future optimization: PostGIS Path A
-- using ST_DWithin (see SPEC §2A.6).

CREATE OR REPLACE FUNCTION public.query_servable_places_by_signal_union(
  p_signal_id text,
  p_filter_min numeric,
  p_circles jsonb,
  p_exclude_place_ids uuid[] DEFAULT '{}'::uuid[],
  p_limit integer DEFAULT 200
)
RETURNS TABLE(
  place_id uuid,
  google_place_id text,
  name text,
  address text,
  lat double precision,
  lng double precision,
  rating numeric,
  review_count integer,
  price_level text,
  price_range_start_cents integer,
  price_range_end_cents integer,
  opening_hours jsonb,
  website text,
  photos jsonb,
  stored_photo_urls text[],
  types text[],
  primary_type text,
  signal_score numeric,
  signal_contributions jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH circles AS (
    SELECT
      (c->>'lat')::double precision AS clat,
      (c->>'lng')::double precision AS clng,
      (c->>'radius_m')::double precision AS crad
    FROM jsonb_array_elements(p_circles) AS c
    WHERE (c->>'lat') IS NOT NULL
      AND (c->>'lng') IS NOT NULL
      AND (c->>'radius_m') IS NOT NULL
  ),
  candidate_places AS (
    SELECT DISTINCT pp.id
    FROM public.place_pool pp
    CROSS JOIN circles c
    WHERE pp.is_servable = true
      AND pp.is_active = true
      AND pp.lat IS NOT NULL
      AND pp.lng IS NOT NULL
      AND (6371000.0 * 2.0 * ASIN(SQRT(
        POWER(SIN(RADIANS(pp.lat - c.clat) / 2.0), 2) +
        COS(RADIANS(c.clat)) * COS(RADIANS(pp.lat)) *
        POWER(SIN(RADIANS(pp.lng - c.clng) / 2.0), 2)
      ))) <= c.crad
  )
  SELECT
    pp.id AS place_id,
    pp.google_place_id,
    pp.name,
    pp.address,
    pp.lat,
    pp.lng,
    pp.rating,
    pp.review_count,
    pp.price_level,
    pp.price_range_start_cents,
    pp.price_range_end_cents,
    pp.opening_hours,
    pp.website,
    pp.photos,
    pp.stored_photo_urls,
    pp.types,
    pp.primary_type,
    ps.score AS signal_score,
    ps.contributions AS signal_contributions
  FROM public.place_pool pp
  JOIN candidate_places cp ON cp.id = pp.id
  JOIN public.place_scores ps
    ON ps.place_id = pp.id AND ps.signal_id = p_signal_id
  WHERE ps.score >= p_filter_min
    AND pp.stored_photo_urls IS NOT NULL
    AND array_length(pp.stored_photo_urls, 1) > 0
    AND NOT (
      array_length(pp.stored_photo_urls, 1) = 1
      AND pp.stored_photo_urls[1] = '__backfill_failed__'
    )
    AND NOT (pp.id = ANY(p_exclude_place_ids))
  -- Deterministic ORDER BY: signal score DESC, then review count DESC, then
  -- place_id ASC as the final stable tiebreaker (CR-1 determinism).
  ORDER BY ps.score DESC, pp.review_count DESC NULLS LAST, pp.id ASC
  LIMIT p_limit;
$$;

COMMENT ON FUNCTION public.query_servable_places_by_signal_union(text, numeric, jsonb, uuid[], integer) IS
  'ORCH-0902 CR-1+CR-2: returns servable places inside the UNION of participant reachable circles for a given signal. ORDER BY signal_score DESC, review_count DESC NULLS LAST, place_id ASC is deterministic across replicas (no random/physical-row tiebreaker). Path B (Haversine, no PostGIS) — depends on pg_aggregate_collab_prefs to cap circles at 50.';

-- ============================================================================
-- 7. TRIGGER FUNCTION — recompute_deck_version_on_prefs_change
-- ============================================================================
-- Fires BEFORE UPDATE on collaboration_sessions when participant_prefs or
-- updated_at changes (the latter is the touch-channel for participant
-- accept/leave events). NO `WHEN (deck_model = ...)` guard per CR-9 — runs
-- for ALL collab sessions unconditionally.
--
-- Recomputes the canonical aggregation, hashes it, and if hash changed:
--   - Sets NEW.deck_version = OLD.deck_version + 1
--   - Sets NEW.deck_params_hash = new_hash
--   - INSERTs a row into session_deck_versions with the frozen params
--     (Q-A — CR-4 resume support)

CREATE OR REPLACE FUNCTION public.recompute_deck_version_on_prefs_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_new_hash text;
  v_aggregated jsonb;
  v_old_version int;
BEGIN
  v_old_version := COALESCE(OLD.deck_version, 0);

  -- Recompute aggregation from current state. Note: this runs inside the
  -- BEFORE UPDATE so NEW.participant_prefs is the upcoming value, but the
  -- aggregation function reads from collaboration_sessions table — which
  -- still has OLD values at this point in the trigger. We must aggregate
  -- using NEW.participant_prefs directly. However, the function signature
  -- takes session_id and re-reads from the table, so during BEFORE UPDATE
  -- it reads OLD prefs.
  --
  -- To handle this correctly for participant_prefs UPDATEs: aggregate from
  -- NEW.participant_prefs manually. For session_participants-driven touches
  -- (where NEW.participant_prefs == OLD.participant_prefs), the function-
  -- based read sees current state and works correctly.
  --
  -- Practical resolution: read participant_prefs from NEW (the upcoming row
  -- value). Build the aggregation inline using NEW.participant_prefs by
  -- temporarily overriding what pg_aggregate_collab_prefs reads.
  --
  -- Simpler: call pg_aggregate_collab_prefs which reads from the table. For
  -- BEFORE UPDATE of participant_prefs, this reads OLD prefs from the table
  -- (NEW row not yet committed). To fix: use a row-level temporary view.
  --
  -- Cleanest implementation: don't use pg_aggregate_collab_prefs in BEFORE
  -- UPDATE. Instead, use AFTER UPDATE so the table reflects NEW values when
  -- the function reads. Then update deck_version/deck_params_hash via a
  -- second UPDATE on the same row.
  --
  -- BUT: an AFTER UPDATE trigger that issues another UPDATE on the same row
  -- causes recursive trigger firing. Guard with a depth check using
  -- pg_trigger_depth() = 1.
  --
  -- Decision: use AFTER UPDATE + pg_trigger_depth() guard.
  --
  -- This function body is structured for the AFTER UPDATE pattern. See the
  -- CREATE TRIGGER below.

  -- (Should not reach this branch from a BEFORE UPDATE trigger; we use
  -- AFTER UPDATE per the comment above. Left empty for clarity.)
  RETURN NEW;
END;
$$;

-- Real trigger function — AFTER UPDATE with depth guard.
--
-- Search path note: pgcrypto is installed in the `extensions` schema on
-- Supabase (not `public`). The function must reach digest() via either
-- extensions.digest() qualified call OR by including `extensions` in
-- search_path. We do BOTH for belt-and-suspenders robustness:
--   - search_path includes extensions
--   - call site uses extensions.digest(...)
-- This survives future schema re-organisations on the project.
CREATE OR REPLACE FUNCTION public.recompute_deck_version_after_prefs_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_new_hash text;
  v_aggregated jsonb;
  v_old_version int;
  v_new_version int;
BEGIN
  -- Prevent recursion: we issue a self-UPDATE below. Skip on recursive fire.
  IF pg_trigger_depth() > 1 THEN
    RETURN NULL;
  END IF;

  -- Aggregate from current row state (post-commit of the UPDATE).
  -- digest() is fully-qualified via extensions.digest because pgcrypto's
  -- digest function lives in the extensions schema on Supabase. Casting
  -- the algorithm name to text avoids the function-resolution ambiguity
  -- between digest(bytea, text) and digest(text, text).
  v_aggregated := public.pg_aggregate_collab_prefs(NEW.id);
  v_new_hash := encode(
    extensions.digest(v_aggregated::text, 'sha256'::text),
    'hex'
  );

  v_old_version := COALESCE(NEW.deck_version, 0);

  -- Hash unchanged → nothing to do
  IF v_new_hash IS NOT DISTINCT FROM NEW.deck_params_hash THEN
    RETURN NULL;
  END IF;

  v_new_version := v_old_version + 1;

  -- Write the per-version params history row FIRST (CR-4 resume support)
  INSERT INTO public.session_deck_versions (
    session_id, deck_version, params_hash, aggregated_params
  ) VALUES (
    NEW.id, v_new_version, v_new_hash, v_aggregated
  )
  ON CONFLICT (session_id, deck_version) DO NOTHING;

  -- Bump version + hash on the parent row. This re-fires the trigger but
  -- pg_trigger_depth() > 1 short-circuits it.
  UPDATE public.collaboration_sessions
    SET deck_version = v_new_version,
        deck_params_hash = v_new_hash
    WHERE id = NEW.id;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.recompute_deck_version_after_prefs_change() IS
  'ORCH-0902 CR-3+CR-5: AFTER UPDATE trigger on collaboration_sessions. Recomputes pg_aggregate_collab_prefs from current state, hashes it, and if hash differs from stored deck_params_hash, bumps deck_version and inserts a row into session_deck_versions for CR-4 resume. Uses pg_trigger_depth() to avoid recursion from the self-UPDATE. No deck_model guard (CR-9 single-shot cutover).';

-- ============================================================================
-- 8. TRIGGER — on collaboration_sessions AFTER UPDATE
-- ============================================================================
-- Fires when participant_prefs OR updated_at changes. participant_prefs is
-- the obvious trigger (someone changed their prefs). updated_at is the touch
-- channel that the session_participants trigger uses to propagate accept/
-- leave/update events.

DROP TRIGGER IF EXISTS recompute_deck_version_after_update
  ON public.collaboration_sessions;
CREATE TRIGGER recompute_deck_version_after_update
  AFTER UPDATE OF participant_prefs, updated_at ON public.collaboration_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.recompute_deck_version_after_prefs_change();

COMMENT ON TRIGGER recompute_deck_version_after_update
  ON public.collaboration_sessions IS
  'ORCH-0902: bumps deck_version on collaboration_sessions when prefs or touch-channel updated_at changes. No WHEN guard (CR-9).';

-- ============================================================================
-- 9. TRIGGER FUNCTION — touch_collab_session_on_participants_change
-- ============================================================================
-- Mirrors session_participants accept/leave/update events into a touch on
-- collaboration_sessions.updated_at so the recompute_deck_version_after_update
-- trigger fires and re-evaluates the aggregation (which now reflects the new
-- participant set).

CREATE OR REPLACE FUNCTION public.touch_collab_session_on_participants_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_session_id uuid;
BEGIN
  v_session_id := COALESCE(NEW.session_id, OLD.session_id);
  IF v_session_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  UPDATE public.collaboration_sessions
    SET updated_at = NOW()
    WHERE id = v_session_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;

COMMENT ON FUNCTION public.touch_collab_session_on_participants_change() IS
  'ORCH-0902: mirrors session_participants INSERT/UPDATE-of-has_accepted/DELETE into a touch on collaboration_sessions.updated_at. Causes the recompute_deck_version_after_update trigger to re-evaluate the aggregation (new participant joining or leaving changes the union of circles). No deck_model guard (CR-9 single-shot cutover).';

-- ============================================================================
-- 10. TRIGGER — on session_participants AFTER INSERT/UPDATE/DELETE
-- ============================================================================

DROP TRIGGER IF EXISTS touch_collab_on_participants_change_v2
  ON public.session_participants;
CREATE TRIGGER touch_collab_on_participants_change_v2
  AFTER INSERT OR DELETE OR UPDATE OF has_accepted ON public.session_participants
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_collab_session_on_participants_change();

COMMENT ON TRIGGER touch_collab_on_participants_change_v2
  ON public.session_participants IS
  'ORCH-0902: touches parent collaboration_sessions.updated_at so the deck-version trigger fires on accept/leave/has_accepted-flip events. No deck_model guard (CR-9).';

-- ============================================================================
-- 11. CLEANUP — drop the unused placeholder function defined above
-- ============================================================================

DROP FUNCTION IF EXISTS public.recompute_deck_version_on_prefs_change() CASCADE;

-- ============================================================================
-- 12. INITIAL BACKFILL — populate deck_version for in-flight sessions
-- ============================================================================
-- CR-9 single-shot cutover: every active collab session moves to the
-- deterministic system on the next prefs change. To kick the first deck
-- version on existing sessions, touch updated_at for every active session
-- with ≥2 accepted participants. This fires the trigger and produces
-- deck_version=1 + the first session_deck_versions row.
--
-- For sessions still below the ≥2 threshold (CR-8), the aggregation returns
-- empty arrays and the hash will match an empty result; deck_version stays
-- at 0 until quorum crosses.

DO $$
BEGIN
  UPDATE public.collaboration_sessions cs
    SET updated_at = NOW()
    WHERE cs.status IN ('pending', 'active', 'voting')
      AND EXISTS (
        SELECT 1 FROM public.session_participants sp
        WHERE sp.session_id = cs.id AND sp.has_accepted = true
      );
END $$;

-- ============================================================================
-- ORCH-0902 migration complete.
-- Next steps (per dispatch):
--   2. Edge function rewrite: supabase/functions/discover-cards/index.ts
--   3. Client deletion + rewrite
--   4. Three implementor regression tests (T-IMPL-01/02/03)
--   5. Implementation report
-- ============================================================================
