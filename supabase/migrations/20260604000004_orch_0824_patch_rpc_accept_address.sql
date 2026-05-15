-- ORCH-0824 HOTFIX-5 — Extend business_patch_event_taxonomy to also
-- accept + write `location_text` (the formatted address from Google
-- Places autocomplete).
--
-- Background: when a brand re-picks the address on the Where section of
-- EditPublishedScreen, the autocomplete onPick handler sets three draft
-- fields atomically: address (formatted text), city (locality), and
-- locationGeo (lat/lng). The original ORCH-0824 patch RPC only accepted
-- city + locationGeo + the three taxonomy arrays — `address` had no
-- server destination. So even though the diff detected the change, the
-- Save button stayed disabled because the patch contained a key
-- (`address`) outside the SERVER_EDITABLE_PATCH_KEYS set.
--
-- Fix: add `p_location_text text` parameter to the RPC. When non-null,
-- writes to `events.location_text`. When null, leaves it unchanged.
-- The client-side helper (SERVER_EDITABLE_PATCH_KEYS in
-- EditPublishedScreen.tsx) is extended in parallel to include "address".
--
-- This is a CREATE OR REPLACE — the prior signature is replaced. Callers
-- on the old signature will get a "function not found" error until they
-- update; the only caller today is `patchPublishedEventTaxonomy` in
-- mingla-business which ships in the same hotfix-5 OTA.

BEGIN;

-- Drop the old signature so PostgREST doesn't keep two overloads.
DROP FUNCTION IF EXISTS public.business_patch_event_taxonomy(
  uuid, text, text[], text[], text[], numeric, numeric
);

CREATE OR REPLACE FUNCTION public.business_patch_event_taxonomy(
  p_event_id uuid,
  p_city text,
  p_party_types text[],
  p_vibe_tags text[],
  p_music_genres text[],
  p_location_lat numeric DEFAULT NULL,
  p_location_lng numeric DEFAULT NULL,
  p_location_text text DEFAULT NULL
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
  ELSE
    v_location_geo := v_event.location_geo;
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
  uuid, text, text[], text[], text[], numeric, numeric, text
) IS
  'ORCH-0824 hotfix-5: extends hotfix-3 RPC with p_location_text param so post-publish address re-picks via Google Places autocomplete propagate to events.location_text. Other fields unchanged. SECURITY DEFINER + event_manager+ role check.';

GRANT EXECUTE ON FUNCTION public.business_patch_event_taxonomy(
  uuid, text, text[], text[], text[], numeric, numeric, text
) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
