-- ORCH-0824 HOTFIX (Option B) — Post-publish patch RPC for the new
-- ORCH-0824 fields.
--
-- Background: mingla-business's EditPublishedScreen mutates the local
-- Zustand LiveEvent cache but has no server-update path for most fields
-- (only cover_media_* has a dedicated service). To let brands edit
-- pre-ORCH-0824 published events into Discover-eligibility, we need a
-- minimal server endpoint that writes the 5 new fields atomically.
--
-- Scope is INTENTIONALLY NARROW: this RPC ONLY accepts the 5 ORCH-0824
-- fields. It does NOT replicate the full publish RPC validation
-- (currency, tickets, dates, slug) because those fields are unchanged
-- post-publish in this flow and have their own dedicated paths if
-- they need server-side mutation later.
--
-- Auth: SECURITY DEFINER + brand-role check (event_manager+) so the
-- caller proves they're authorized to edit this brand's events. Same
-- check as business_publish_event_draft.
--
-- Validation mirrors the publish RPC's ORCH-0824 block:
--   - city required (not null, not empty)
--   - party_types: at least one element, all canonical
--   - vibe_tags: canonical subset (empty OK)
--   - music_genres: canonical subset (empty OK)
--   - location_geo: optional; if both lat+lng provided, written as point
--
-- Returns the updated events row as JSONB so the client can re-hydrate
-- the LiveEvent without an extra round-trip.

BEGIN;

CREATE OR REPLACE FUNCTION public.business_patch_event_taxonomy(
  p_event_id uuid,
  p_city text,
  p_party_types text[],
  p_vibe_tags text[],
  p_music_genres text[],
  p_location_lat numeric DEFAULT NULL,
  p_location_lng numeric DEFAULT NULL
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
  v_updated public.events%ROWTYPE;
BEGIN
  -- Auth
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- Event exists, alive, published
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

  -- This RPC is for POST-publish edits only. Drafts use the publish RPC.
  IF v_event.status NOT IN ('scheduled', 'live') THEN
    RAISE EXCEPTION 'event_not_editable_status';
  END IF;

  -- Brand-role check (mirrors publish RPC)
  IF public.biz_brand_effective_rank(v_event.brand_id, v_user_id)
       < public.biz_role_rank('event_manager'::text) THEN
    RAISE EXCEPTION 'insufficient_event_permission';
  END IF;

  -- Validate city
  v_city := NULLIF(btrim(COALESCE(p_city, '')), '');
  IF v_city IS NULL THEN
    RAISE EXCEPTION 'city_required';
  END IF;

  -- Coalesce nulls to empty arrays (defensive — clients may send null)
  v_party_types  := COALESCE(p_party_types,  ARRAY[]::text[]);
  v_vibe_tags    := COALESCE(p_vibe_tags,    ARRAY[]::text[]);
  v_music_genres := COALESCE(p_music_genres, ARRAY[]::text[]);

  -- Validate party_types: at least one, all canonical
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

  -- Optional location_geo. If lat+lng both provided as finite numbers,
  -- write a point(lng, lat). Postgres `point` constructor takes (x,y) =
  -- (lng, lat) — matches the existing column convention in the publish
  -- RPC and the consumer-side parsePoint helper.
  IF p_location_lat IS NOT NULL AND p_location_lng IS NOT NULL THEN
    v_location_geo := point(p_location_lng, p_location_lat);
  ELSE
    v_location_geo := v_event.location_geo;
  END IF;

  -- Apply patch
  UPDATE public.events
  SET
    city = v_city,
    party_types = v_party_types,
    vibe_tags = v_vibe_tags,
    music_genres = v_music_genres,
    location_geo = v_location_geo,
    updated_at = v_now
  WHERE id = p_event_id
    AND status IN ('scheduled', 'live')
    AND deleted_at IS NULL
  RETURNING * INTO v_updated;

  IF NOT FOUND THEN
    -- Race: row changed between FOR UPDATE select and update (e.g.,
    -- soft-deleted concurrently). Surface as a distinct error.
    RAISE EXCEPTION 'event_not_editable_race';
  END IF;

  RETURN jsonb_build_object(
    'event', to_jsonb(v_updated),
    'updated_at', v_now
  );
END;
$$;

COMMENT ON FUNCTION public.business_patch_event_taxonomy(
  uuid, text, text[], text[], text[], numeric, numeric
) IS
  'ORCH-0824 hotfix: post-publish patch path for the 5 new ORCH-0824 fields (city, party_types, vibe_tags, music_genres, location_geo). Used by EditPublishedScreen Save flow to propagate brand edits to the events row so legacy events become Discover-eligible. SECURITY DEFINER with event_manager+ role check. Same canonical-slug validation as business_publish_event_draft.';

-- Grant execute to authenticated users — RLS effectively granted via the
-- biz_brand_effective_rank check inside the function body.
GRANT EXECUTE ON FUNCTION public.business_patch_event_taxonomy(
  uuid, text, text[], text[], text[], numeric, numeric
) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
