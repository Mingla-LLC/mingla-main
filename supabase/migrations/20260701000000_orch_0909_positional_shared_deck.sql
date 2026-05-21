-- ============================================================================
-- ORCH-0909 [Collab positional shared deck + intersection geography]
-- ============================================================================
--
-- NOTE ON FILENAME: the binding spec named 20260628000000, but this checkout
-- already contains 20260628000000_orch_0908_hotfix_calendar_trigger_dead_ref.sql
-- and later local migrations through 20260630000000. This migration therefore
-- uses the next monotonic local prefix to avoid duplicate-version db-push risk.
--
-- Pre-flight completed by implementor via mcp__supabase__list_extensions:
-- postgis is available on the project (default_version 3.3.7).
-- Operator still owns `supabase db push --linked`; do not apply via MCP.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS postgis;

-- ============================================================================
-- 1. Positional shared deck table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.session_deck_cards (
  session_id uuid NOT NULL REFERENCES public.collaboration_sessions(id) ON DELETE CASCADE,
  position int NOT NULL,
  card_id uuid NOT NULL REFERENCES public.place_pool(id) ON DELETE RESTRICT,
  generated_at_version int NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, position),
  CONSTRAINT session_deck_cards_position_pos CHECK (position >= 1),
  CONSTRAINT session_deck_cards_version_pos CHECK (generated_at_version >= 1)
);

COMMENT ON TABLE public.session_deck_cards IS
  'ORCH-0909 LCD-1: positional shared deck. Card at (session_id, position) is immutable identity for that session position. Generated lazily once; slower participants read the same row.';

CREATE INDEX IF NOT EXISTS idx_session_deck_cards_session_pos
  ON public.session_deck_cards (session_id, position DESC);

COMMENT ON INDEX public.idx_session_deck_cards_session_pos IS
  'ORCH-0909: supports frontier and next-card lookups by session/position.';

ALTER TABLE public.session_deck_cards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sdc_select ON public.session_deck_cards;
CREATE POLICY sdc_select ON public.session_deck_cards
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.session_participants sp
      WHERE sp.session_id = session_deck_cards.session_id
        AND sp.user_id = auth.uid()
        AND sp.has_accepted = true
    )
  );

DROP POLICY IF EXISTS sdc_insert_service_only ON public.session_deck_cards;
CREATE POLICY sdc_insert_service_only ON public.session_deck_cards
  FOR INSERT
  WITH CHECK (
    current_user = 'postgres'
    OR auth.role() = 'service_role'
  );

-- No UPDATE/DELETE policies: positional deck history is immutable in user context.

-- ============================================================================
-- 2. Participant cursor
-- ============================================================================

ALTER TABLE public.session_participants
  ADD COLUMN IF NOT EXISTS current_position int NOT NULL DEFAULT 0;

ALTER TABLE public.session_participants
  DROP CONSTRAINT IF EXISTS sp_current_position_nonneg;
ALTER TABLE public.session_participants
  ADD CONSTRAINT sp_current_position_nonneg CHECK (current_position >= 0);

COMMENT ON COLUMN public.session_participants.current_position IS
  'ORCH-0909 LCD-6: participant cursor in the positional shared session deck. Frontier is MAX(current_position) across accepted participants.';

-- ============================================================================
-- 3. Aggregation: intersection geography + no-GPS handling
-- ============================================================================

CREATE OR REPLACE FUNCTION public.pg_aggregate_collab_prefs(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
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
  v_pending_gps_user_ids uuid[];
  v_gps_circle_count integer;
  v_intersection_has_place boolean;
  v_intersection_empty boolean := false;
BEGIN
  SELECT participant_prefs INTO v_prefs
    FROM public.collaboration_sessions
    WHERE id = p_session_id;

  IF v_prefs IS NULL OR jsonb_typeof(v_prefs) <> 'object' THEN
    RETURN jsonb_build_object(
      'categories', '[]'::jsonb,
      'intents', '[]'::jsonb,
      'dateWindows', '[]'::jsonb,
      'selectedDates', '[]'::jsonb,
      'datetimePref', null,
      'circles', '[]'::jsonb,
      'acceptedCount', 0,
      'pending_gps_user_ids', '[]'::jsonb,
      'intersection_empty', false
    );
  END IF;

  SELECT array_agg(user_id ORDER BY user_id) INTO v_accepted_user_ids
    FROM public.session_participants
    WHERE session_id = p_session_id
      AND has_accepted = true;

  v_accepted_count := COALESCE(array_length(v_accepted_user_ids, 1), 0);

  IF v_accepted_count < 2 THEN
    RETURN jsonb_build_object(
      'categories', '[]'::jsonb,
      'intents', '[]'::jsonb,
      'dateWindows', '[]'::jsonb,
      'selectedDates', '[]'::jsonb,
      'datetimePref', null,
      'circles', '[]'::jsonb,
      'acceptedCount', v_accepted_count,
      'pending_gps_user_ids', '[]'::jsonb,
      'intersection_empty', false
    );
  END IF;

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

  SELECT array_agg(DISTINCT (prefs->>'date_option') ORDER BY (prefs->>'date_option'))
    INTO v_date_windows
    FROM jsonb_each(v_prefs) AS rows(uid, prefs)
    WHERE uid::uuid = ANY(v_accepted_user_ids)
      AND prefs->>'date_option' IS NOT NULL;

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

  SELECT MIN(prefs->>'datetime_pref') INTO v_datetime_pref
    FROM jsonb_each(v_prefs) AS rows(uid, prefs)
    WHERE uid::uuid = ANY(v_accepted_user_ids)
      AND prefs->>'datetime_pref' IS NOT NULL;

  SELECT jsonb_agg(
    jsonb_build_object(
      'user_id', uid,
      'lat', ROUND((prefs->>'custom_lat')::numeric, 4),
      'lng', ROUND((prefs->>'custom_lng')::numeric, 4),
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

  SELECT array_agg(uid::uuid ORDER BY uid) INTO v_pending_gps_user_ids
    FROM jsonb_each(v_prefs) AS rows(uid, prefs)
    WHERE uid::uuid = ANY(v_accepted_user_ids)
      AND (prefs->>'custom_lat' IS NULL OR prefs->>'custom_lng' IS NULL);

  v_gps_circle_count := COALESCE(jsonb_array_length(v_circles), 0);

  -- Operational interpretation of intersection_empty: there is no active,
  -- servable place row inside every GPS-bearing circle. Missing-GPS users are
  -- admitted and excluded from the geographic intersection until location lands.
  IF v_gps_circle_count >= 2 THEN
    WITH circles AS (
      SELECT
        ST_SetSRID(ST_MakePoint((c->>'lng')::double precision, (c->>'lat')::double precision), 4326)::geography AS center,
        (c->>'radius_m')::double precision AS rad_m
      FROM jsonb_array_elements(COALESCE(v_circles, '[]'::jsonb)) AS c
      WHERE c->>'lat' IS NOT NULL
        AND c->>'lng' IS NOT NULL
        AND c->>'radius_m' IS NOT NULL
    )
    SELECT EXISTS (
      SELECT 1
      FROM public.place_pool pp
      WHERE pp.is_servable = true
        AND pp.is_active = true
        AND pp.lat IS NOT NULL
        AND pp.lng IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM circles c
          WHERE NOT ST_DWithin(
            c.center,
            ST_SetSRID(ST_MakePoint(pp.lng, pp.lat), 4326)::geography,
            c.rad_m
          )
        )
      LIMIT 1
    ) INTO v_intersection_has_place;

    v_intersection_empty := NOT COALESCE(v_intersection_has_place, false);
  END IF;

  RETURN jsonb_build_object(
    'categories', COALESCE(to_jsonb(v_categories), '[]'::jsonb),
    'intents', COALESCE(to_jsonb(v_intents), '[]'::jsonb),
    'dateWindows', COALESCE(to_jsonb(v_date_windows), '[]'::jsonb),
    'selectedDates', COALESCE(to_jsonb(v_selected_dates), '[]'::jsonb),
    'datetimePref', v_datetime_pref,
    'circles', COALESCE(v_circles, '[]'::jsonb),
    'acceptedCount', v_accepted_count,
    'pending_gps_user_ids', COALESCE(to_jsonb(v_pending_gps_user_ids), '[]'::jsonb),
    'intersection_empty', v_intersection_empty
  );
END;
$$;

COMMENT ON FUNCTION public.pg_aggregate_collab_prefs(uuid) IS
  'ORCH-0909 LCD-2: canonical collab prefs. Categories/intents/dates are unioned; cards must be inside every GPS-bearing participant circle. Missing GPS users are admitted, listed in pending_gps_user_ids, and excluded from intersection until GPS arrives. 50-circle cap retired by PostGIS.';

-- ============================================================================
-- 4. Intersection servable-place query
-- ============================================================================

CREATE OR REPLACE FUNCTION public.query_servable_places_by_signal_intersection(
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
SET search_path = public, extensions, pg_temp
AS $$
  WITH circles AS (
    SELECT
      ST_SetSRID(ST_MakePoint((c->>'lng')::double precision, (c->>'lat')::double precision), 4326)::geography AS center,
      (c->>'radius_m')::double precision AS rad_m
    FROM jsonb_array_elements(p_circles) AS c
    WHERE (c->>'lat') IS NOT NULL
      AND (c->>'lng') IS NOT NULL
      AND (c->>'radius_m') IS NOT NULL
  ),
  candidate_places AS (
    SELECT pp.id
    FROM public.place_pool pp
    WHERE pp.is_servable = true
      AND pp.is_active = true
      AND pp.lat IS NOT NULL
      AND pp.lng IS NOT NULL
      AND (
        NOT EXISTS (SELECT 1 FROM circles)
        OR NOT EXISTS (
          SELECT 1
          FROM circles c
          WHERE NOT ST_DWithin(
            c.center,
            ST_SetSRID(ST_MakePoint(pp.lng, pp.lat), 4326)::geography,
            c.rad_m
          )
        )
      )
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
  JOIN public.place_scores ps ON ps.place_id = pp.id AND ps.signal_id = p_signal_id
  WHERE ps.score >= p_filter_min
    AND pp.stored_photo_urls IS NOT NULL
    AND array_length(pp.stored_photo_urls, 1) > 0
    AND NOT (
      array_length(pp.stored_photo_urls, 1) = 1
      AND pp.stored_photo_urls[1] = '__backfill_failed__'
    )
    AND NOT (pp.id = ANY(p_exclude_place_ids))
  ORDER BY ps.score DESC, pp.review_count DESC NULLS LAST, pp.id ASC
  LIMIT p_limit;
$$;

COMMENT ON FUNCTION public.query_servable_places_by_signal_intersection(text, numeric, jsonb, uuid[], integer) IS
  'ORCH-0909 LCD-2: returns servable places inside the INTERSECTION of all GPS-bearing participant reachable circles using PostGIS ST_DWithin geography. Replaces query_servable_places_by_signal_union.';

DROP FUNCTION IF EXISTS public.query_servable_places_by_signal_union(text, numeric, jsonb, uuid[], integer);

-- ============================================================================
-- 5. Atomic accept + prefs + GPS RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.accept_session_with_prefs(
  p_session_id uuid,
  p_invite_id uuid,
  p_lat numeric,
  p_lng numeric,
  p_categories text[],
  p_intents text[],
  p_travel_mode text,
  p_travel_constraint_value int,
  p_date_option text DEFAULT NULL,
  p_datetime_pref text DEFAULT NULL,
  p_selected_dates text[] DEFAULT NULL,
  p_use_gps_location boolean DEFAULT true,
  p_custom_location text DEFAULT NULL,
  p_intent_toggle boolean DEFAULT true,
  p_category_toggle boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_invited_user_id uuid;
  v_frontier int;
  v_prefs_merge jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'ORCH-0909: authentication required';
  END IF;

  SELECT invited_user_id INTO v_invited_user_id
    FROM public.collaboration_invites
    WHERE id = p_invite_id
      AND session_id = p_session_id;

  IF v_invited_user_id IS NULL OR v_invited_user_id <> v_user_id THEN
    RAISE EXCEPTION 'ORCH-0909: invite_not_found_or_not_owner';
  END IF;

  -- Suppress the legacy session_participants touch trigger while this RPC
  -- upserts the participant row. The final participant_prefs UPDATE below
  -- fires recompute_deck_version_after_prefs_change exactly once with the
  -- complete accept+prefs+GPS picture.
  PERFORM set_config('orch_0909.accept_with_prefs', 'true', true);

  SELECT COALESCE(MAX(current_position), 0) INTO v_frontier
    FROM public.session_participants
    WHERE session_id = p_session_id
      AND has_accepted = true
      AND user_id <> v_user_id;

  UPDATE public.collaboration_invites
    SET status = 'accepted',
        updated_at = now()
    WHERE id = p_invite_id
      AND invited_user_id = v_user_id;

  INSERT INTO public.session_participants (
    session_id,
    user_id,
    has_accepted,
    joined_at,
    current_position
  ) VALUES (
    p_session_id,
    v_user_id,
    true,
    now(),
    v_frontier
  )
  ON CONFLICT (session_id, user_id) DO UPDATE
    SET has_accepted = true,
        joined_at = COALESCE(public.session_participants.joined_at, now()),
        current_position = GREATEST(public.session_participants.current_position, v_frontier);

  v_prefs_merge := jsonb_strip_nulls(jsonb_build_object(
    'categories', COALESCE(to_jsonb(p_categories), '[]'::jsonb),
    'intents', COALESCE(to_jsonb(p_intents), '[]'::jsonb),
    'travel_mode', COALESCE(p_travel_mode, 'walking'),
    'travel_constraint_type', 'time',
    'travel_constraint_value', COALESCE(p_travel_constraint_value, 30),
    'date_option', p_date_option,
    'datetime_pref', p_datetime_pref,
    'selected_dates', to_jsonb(p_selected_dates),
    'use_gps_location', COALESCE(p_use_gps_location, true),
    'custom_location', p_custom_location,
    'custom_lat', p_lat,
    'custom_lng', p_lng,
    'intent_toggle', COALESCE(p_intent_toggle, true),
    'category_toggle', COALESCE(p_category_toggle, true)
  ));

  UPDATE public.collaboration_sessions
    SET participant_prefs = COALESCE(participant_prefs, '{}'::jsonb)
          || jsonb_build_object(v_user_id::text, v_prefs_merge),
        updated_at = now()
    WHERE id = p_session_id;

  RETURN jsonb_build_object(
    'success', true,
    'session_id', p_session_id,
    'user_id', v_user_id,
    'current_position', v_frontier,
    'has_gps', (p_lat IS NOT NULL AND p_lng IS NOT NULL)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_session_with_prefs(uuid, uuid, numeric, numeric, text[], text[], text, int, text, text, text[], boolean, text, boolean, boolean) TO authenticated;

COMMENT ON FUNCTION public.accept_session_with_prefs(uuid, uuid, numeric, numeric, text[], text[], text, int, text, text, text[], boolean, text, boolean, boolean) IS
  'ORCH-0909: atomic accept + participant frontier cursor + full participant_prefs including GPS. Replaces accept-then-async-GPS-write lag window.';

-- ============================================================================
-- 6. Trigger behavior
-- ============================================================================

CREATE OR REPLACE FUNCTION public.touch_collab_session_on_participants_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_session_id uuid;
BEGIN
  IF current_setting('orch_0909.accept_with_prefs', true) = 'true' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

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
  'ORCH-0909: mirrors session_participants changes into collaboration_sessions.updated_at except during accept_session_with_prefs, where the atomic participant_prefs UPDATE fires the full recompute exactly once.';

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
  IF current_setting('orch_0908.force_recycle', true) = 'true' THEN
    RETURN NULL;
  END IF;

  IF pg_trigger_depth() > 1 THEN
    RETURN NULL;
  END IF;

  v_aggregated := public.pg_aggregate_collab_prefs(NEW.id);
  v_new_hash := encode(
    extensions.digest(v_aggregated::text, 'sha256'::text),
    'hex'
  );

  v_old_version := COALESCE(NEW.deck_version, 0);

  IF v_new_hash IS NOT DISTINCT FROM NEW.deck_params_hash THEN
    RETURN NULL;
  END IF;

  v_new_version := v_old_version + 1;

  INSERT INTO public.session_deck_versions (
    session_id,
    deck_version,
    params_hash,
    aggregated_params
  ) VALUES (
    NEW.id,
    v_new_version,
    v_new_hash,
    v_aggregated
  )
  ON CONFLICT (session_id, deck_version) DO NOTHING;

  UPDATE public.collaboration_sessions
    SET deck_version = v_new_version,
        deck_params_hash = v_new_hash
    WHERE id = NEW.id;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.recompute_deck_version_after_prefs_change() IS
  'ORCH-0909: recomputes intersection-based pg_aggregate_collab_prefs and preserves ORCH-0908 orch_0908.force_recycle GUC guard.';

-- ============================================================================
-- 7. Single-shot cutover
-- ============================================================================

DO $$
DECLARE
  v_count int;
BEGIN
  UPDATE public.session_participants
    SET current_position = 0
    WHERE has_accepted = true;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'ORCH-0909 single-shot reset: % session_participants reset to current_position=0', v_count;
END $$;

NOTIFY pgrst, 'reload schema';
