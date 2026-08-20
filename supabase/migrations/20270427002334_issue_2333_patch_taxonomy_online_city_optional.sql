-- =====================================================================================
-- Issue #2333 — S2. Keep an ONLINE event EDITABLE after 20270427002333 publishes it.
--
-- `business_patch_event_taxonomy` raises the SAME unconditional `city_required`. The
-- business client fires this RPC on any change to city / partyTypes / vibeTags /
-- musicGenres / locationGeo / address (EditPublishedScreen.tsx:1121-1128) and coerces
-- a missing city to "" at :1162, which `NULLIF(btrim(''),'')` turns straight back to
-- NULL. Ship S1 alone and every online event publishes once and can then NEVER have
-- its party types, vibes, genres, cover or pin changed again — and the toast at
-- :1180-1181 tells the host to "Pick the venue address from the suggestions", a field
-- the online Where step never renders. S1 without S2 trades a loud bug for a silent one.
--
-- WHY THE TEST IS DIFFERENT FROM S1's: this RPC has NO format parameter and no draft
-- payload (signature: p_event_id, p_city, p_party_types, p_vibe_tags, p_music_genres,
-- p_location_lat, p_location_lng, p_location_text, p_coordinate_precision). It cannot
-- make the test the publish RPC makes, so it reads the durable signal off the row it
-- has already locked in `v_event`. `business_draft.format` survives publish into
-- `theme.business_event.format` — the publish theme rewrite strips exactly tickets,
-- category, partyTypes, vibeTags, musicGenres, city and locationGeo, and `format` is
-- NOT in that list — and the only post-publish theme writer for a standard event,
-- `biz_set_event_guest_privacy`, deep-merges with jsonb_set. Verified live: the one
-- published online event in prod carries theme.business_event.format = 'online'.
-- Pinned by DRAFT invariant I-2333-ONLINE-FORMAT-IS-DURABLE.
--
-- SAME TRAP AS S1: `events.is_online` is TRUE for HYBRID as well
-- (serverDraftEventMapper.ts:708). It is deliberately NOT the key here either. An
-- absent or unknown format FAILS CLOSED and still demands a city.
-- Pinned by DRAFT invariant I-2333-CITY-GUARDS-ARE-FORMAT-AWARE-NOT-ONLINE-AWARE.
--
-- METHOD: idempotent CREATE OR REPLACE of the FULL function body, reproduced
-- byte-for-byte from the LIVE production definition (`pg_get_functiondef`, read-only).
-- The repo copy in 20270121001364_orch_1363_event_precision_persist.sql was diffed
-- against prod and found IDENTICAL (no drift). The candidate below diffs against prod
-- in exactly ONE hunk: the guard + its comment.
--
-- NO `DROP FUNCTION`. The 9-argument signature, defaults, RETURNS jsonb, LANGUAGE
-- plpgsql, SECURITY DEFINER and SET search_path TO 'public','pg_temp' are unchanged, so
-- the existing ACL (REVOKE from PUBLIC/anon, GRANT EXECUTE to authenticated) and the
-- ORCH-0824/#1363 COMMENT survive CREATE OR REPLACE untouched. `UPDATE ... SET
-- city = v_city` already accepts NULL. Nothing else moves.
--
-- Ordering floor: strictly greater than 20270427002333 (this issue's S1), than
-- 20270424002267 (origin/main head) and than 20270426002305 (highest across every
-- sibling worktree). No historical migration is edited.
-- =====================================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.business_patch_event_taxonomy(p_event_id uuid, p_city text, p_party_types text[], p_vibe_tags text[], p_music_genres text[], p_location_lat numeric DEFAULT NULL::numeric, p_location_lng numeric DEFAULT NULL::numeric, p_location_text text DEFAULT NULL::text, p_coordinate_precision text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  -- issue #2333 — this RPC has no format argument, so the online test reads the
  -- durable signal off the row already locked in v_event. publish writes
  -- business_draft.format through to theme.business_event.format (it is NOT in
  -- the strip list) and the only post-publish theme writer for a standard event,
  -- biz_set_event_guest_privacy, deep-merges via jsonb_set. Without this the
  -- relax in 20270427002333 soft-bricks editing: EditPublishedScreen.tsx:1162
  -- sends city as "", this NULLIFs it back to NULL, and an online event could
  -- never have its party types, vibes, genres or cover changed again.
  -- is_online is deliberately NOT the test — it is TRUE for hybrid.
  IF v_city IS NULL
     AND lower(btrim(
       COALESCE(v_event.theme->'business_event'->>'format', ''),
       E' \t\n\r\f\v' || chr(160)
     )) <> 'online' THEN
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
$function$;

COMMIT;

NOTIFY pgrst, 'reload schema';
