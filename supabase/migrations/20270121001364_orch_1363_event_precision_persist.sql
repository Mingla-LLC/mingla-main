-- ============================================================================
-- Issue #1363 (amendment G2) — Event location: persist coordinate_precision.
--
-- Re-publishes public.business_patch_event_taxonomy VERBATIM from its latest
-- definition (20260604000004_orch_0824_patch_rpc_accept_address.sql) with EXACTLY
-- these additive deltas — nothing else changes:
--
--   (a) A trailing param `p_coordinate_precision text DEFAULT ''` (empty / blank
--       / unrecognised → NULL; the CHECK on events.coordinate_precision only ever
--       sees 'exact' | 'approximate' | NULL).
--   (b) The value is written to events.coordinate_precision, TIED TO the existing
--       CONDITIONAL location_geo write: when a new coordinate is supplied
--       (p_location_lat + p_location_lng both non-null) the precision is written
--       alongside it; when no new coordinate is supplied the existing precision is
--       preserved unchanged (exactly mirroring how location_geo keeps its prior
--       value). This means an unrelated taxonomy edit NEVER wipes a previously
--       stored precision, and precision is never set without its coordinate.
--
-- PRESERVED byte-for-behavior: the city_required guard, every taxonomy canonical
-- check, the ownership / status guards, and the conditional location_geo write.
-- The events.coordinate_precision column was added additively in
-- 20270120001363_orch_1363_coordinate_precision.sql.
--
-- Adding a parameter changes the function signature, so the prior 8-arg overload
-- is DROPped first (a bare CREATE OR REPLACE would leave a stale overload →
-- PostgREST ambiguity, since the new 9th arg has a DEFAULT and is callable with
-- 8 args). Same DROP-then-recreate pattern the source migration used.
--
-- DO NOT auto-apply — the orchestrator applies 20270120001363 + the G1 migration
-- + this together under the safe-migration protocol.
-- ============================================================================

BEGIN;

-- Drop the prior 8-arg signature so PostgREST doesn't keep two overloads.
DROP FUNCTION IF EXISTS public.business_patch_event_taxonomy(
  uuid, text, text[], text[], text[], numeric, numeric, text
);

CREATE OR REPLACE FUNCTION public.business_patch_event_taxonomy(
  p_event_id uuid,
  p_city text,
  p_party_types text[],
  p_vibe_tags text[],
  p_music_genres text[],
  p_location_lat numeric DEFAULT NULL,
  p_location_lng numeric DEFAULT NULL,
  p_location_text text DEFAULT NULL,
  p_coordinate_precision text DEFAULT ''   -- issue #1363 G2
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id uuid;
  v_event public.events%ROWTYPE;
  v_now timestamptz := now();
  v_city text;
  v_party_types text[];
  v_vibe_tags text[];
  v_music_genres text[];
  v_location_geo point;
  v_location_text text;
  v_coordinate_precision text;   -- issue #1363 G2
  v_updated public.events%ROWTYPE;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT *
  INTO v_event
  FROM public.events
  WHERE id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'event_not_found';
  END IF;

  IF v_event.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'event_deleted';
  END IF;

  IF v_event.status NOT IN ('scheduled', 'live') THEN
    RAISE EXCEPTION 'event_not_editable_status';
  END IF;

  IF public.biz_brand_effective_rank(v_event.brand_id, v_user_id)
       < public.biz_role_rank('event_manager'::text) THEN
    RAISE EXCEPTION 'insufficient_event_permission';
  END IF;

  v_city := NULLIF(btrim(COALESCE(p_city, '')), '');
  IF v_city IS NULL THEN
    RAISE EXCEPTION 'city_required';
  END IF;

  v_party_types  := COALESCE(p_party_types,  ARRAY[]::text[]);
  v_vibe_tags    := COALESCE(p_vibe_tags,    ARRAY[]::text[]);
  v_music_genres := COALESCE(p_music_genres, ARRAY[]::text[]);

  IF array_length(v_party_types, 1) IS NULL THEN
    RAISE EXCEPTION 'party_types_required';
  END IF;

  IF NOT (v_party_types <@ ARRAY[
    'birthday-party','rooftop-party','club-night','house-party','warehouse-party',
    'beach-party','pool-party','boat-party','themed-party','corporate-event',
    'graduation-party','holiday-party','networking-event','rave','festival'
  ]::text[]) THEN
    RAISE EXCEPTION 'party_types_not_canonical';
  END IF;

  IF NOT (v_vibe_tags <@ ARRAY[
    'energetic','chill','intimate','wild','classy','casual','upscale','underground',
    'mainstream','artsy','social','exclusive','laid-back','vibrant','retro','futuristic'
  ]::text[]) THEN
    RAISE EXCEPTION 'vibe_tags_not_canonical';
  END IF;

  IF NOT (v_music_genres <@ ARRAY[
    'electronic-edm','hiphop-rap','pop','rock','latin','afrobeats','rnb-soul',
    'disco-funk','reggae-dancehall','indie','country','jazz','classical','mixed-variety'
  ]::text[]) THEN
    RAISE EXCEPTION 'music_genres_not_canonical';
  END IF;

  IF p_location_lat IS NOT NULL AND p_location_lng IS NOT NULL THEN
    v_location_geo := point(p_location_lng, p_location_lat);
    -- issue #1363 G2: a NEW coordinate carries its precision. Normalize the
    -- token: empty/blank/unrecognised → NULL so the coordinate_precision CHECK
    -- only ever sees 'exact' | 'approximate' | NULL (a stale client can never
    -- break the patch).
    v_coordinate_precision := NULLIF(btrim(COALESCE(p_coordinate_precision, '')), '');
    IF v_coordinate_precision IS NOT NULL
       AND v_coordinate_precision NOT IN ('exact', 'approximate') THEN
      v_coordinate_precision := NULL;
    END IF;
  ELSE
    v_location_geo := v_event.location_geo;
    -- issue #1363 G2: no new coordinate → preserve the existing precision
    -- unchanged (mirrors location_geo above). An unrelated taxonomy edit never
    -- wipes a previously stored precision.
    v_coordinate_precision := v_event.coordinate_precision;
  END IF;

  -- ORCH-0824 hotfix-5: accept + write location_text (formatted address
  -- from Google Places). When null, leave the existing value unchanged.
  v_location_text := NULLIF(btrim(COALESCE(p_location_text, '')), '');
  IF v_location_text IS NULL THEN
    v_location_text := v_event.location_text;
  END IF;

  UPDATE public.events
  SET
    city = v_city,
    party_types = v_party_types,
    vibe_tags = v_vibe_tags,
    music_genres = v_music_genres,
    location_geo = v_location_geo,
    location_text = v_location_text,
    coordinate_precision = v_coordinate_precision,   -- issue #1363 G2
    updated_at = v_now
  WHERE id = p_event_id
    AND status IN ('scheduled', 'live')
    AND deleted_at IS NULL
  RETURNING * INTO v_updated;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'event_not_editable_race';
  END IF;

  RETURN jsonb_build_object(
    'event', to_jsonb(v_updated),
    'updated_at', v_now
  );
END;
$$;

COMMENT ON FUNCTION public.business_patch_event_taxonomy(
  uuid, text, text[], text[], text[], numeric, numeric, text, text
) IS
  'ORCH-0824 hotfix-5 + issue #1363 G2: post-publish event taxonomy/address patch. '
  'issue #1363 adds an optional trailing p_coordinate_precision (exact|approximate) '
  'written to events.coordinate_precision, tied to the conditional location_geo '
  'write (precision written only when a new coordinate is supplied; existing '
  'precision preserved otherwise). city_required + the location_geo write are '
  'unchanged. SECURITY DEFINER + event_manager+ role check.';

REVOKE ALL ON FUNCTION public.business_patch_event_taxonomy(
  uuid, text, text[], text[], text[], numeric, numeric, text, text
) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.business_patch_event_taxonomy(
  uuid, text, text[], text[], text[], numeric, numeric, text, text
) FROM anon;
GRANT EXECUTE ON FUNCTION public.business_patch_event_taxonomy(
  uuid, text, text[], text[], text[], numeric, numeric, text, text
) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
