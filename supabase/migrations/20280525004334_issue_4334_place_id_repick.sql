-- #4334 — a re-pick onto the same pin with a new Google place id is saved,
-- and a moved event pin never keeps the old place's id.
--
-- (1) Venue details. public.issue_3386_identity_patch compares a venue's
--     address text, city, country, pin and precision, but not the place id, so
--     re-picking the same address onto the same pin with a new Google place id
--     produced an empty patch: biz_update_venue_identity_in_review answered
--     changed:false without writing, and biz_submit_venue_details_change_request
--     raised nothing_to_change. Both RPCs now add the (re-validated) address to
--     the patch when a non-blank place id, normalised by places_checked_place_id,
--     differs from the stored one, so the existing address branch writes it
--     (live row, or details_change_place_id for the request). Signatures,
--     grants, SECURITY DEFINER, search_path and every existing guard are copied
--     unchanged from 20280521004334_issue_4334_google_places.sql. The helper
--     issue_3386_identity_patch itself is unchanged.
--
-- (2) business_patch_event_taxonomy_with_place. A pin sent with a blank place
--     id kept the stored id. A moved pin now writes NULL, matching the RSVP
--     path (business_update_rsvp_graph writes the id it is sent, NULL included);
--     the stored pin resent unchanged by an unrelated taxonomy save (#3827)
--     still keeps its id. (The events place-stamp trigger already cleared the
--     id when the pin moved; this makes the RPC say so itself.)
--
-- Test: supabase/migrations/__tests__/issue_4334_place_id_repick.implementor.pg17.test.sql

CREATE OR REPLACE FUNCTION public.biz_update_venue_identity_in_review(p_venue_id uuid, p_name text DEFAULT NULL::text, p_venue_category text DEFAULT NULL::text, p_address text DEFAULT NULL::text, p_city text DEFAULT NULL::text, p_country_code text DEFAULT NULL::text, p_lat double precision DEFAULT NULL::double precision, p_lng double precision DEFAULT NULL::double precision, p_coordinate_precision text DEFAULT NULL::text, p_location_place_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_venue public.venue_listings%ROWTYPE;
  v_patch jsonb;
  v_place_id text;                         -- #4334
  v_probe public.venue_listings%ROWTYPE;   -- #4334
BEGIN
  v_venue := public.issue_3386_lock_managed_venue(p_venue_id);
  IF v_venue.claim_status <> 'pending_review' THEN
    RAISE EXCEPTION 'venue_not_in_review' USING ERRCODE = '55000';
  END IF;

  v_patch := public.issue_3386_identity_patch(
    v_venue, p_name, p_venue_category, p_address, p_city, p_country_code,
    p_lat, p_lng, p_coordinate_precision
  );
  -- #4334 — an address re-picked onto the same pin with a NEW Google place id
  -- is a change: the identity patch above compares text, city, country, pin
  -- and precision only, so add the (re-validated) address with the new id.
  -- Only a non-blank id that differs from the stored one counts; a resent
  -- address without an id still changes nothing.
  v_place_id := public.places_checked_place_id(p_location_place_id);
  IF p_address IS NOT NULL AND NOT (v_patch ? 'address')
     AND v_place_id IS NOT NULL
     AND v_place_id IS DISTINCT FROM v_venue.location_provider_place_id THEN
    v_probe := v_venue;
    v_probe.address := NULL;   -- forces the helper to return the normalised address
    v_patch := v_patch || jsonb_build_object('address', public.issue_3386_identity_patch(
      v_probe, NULL, NULL, p_address, p_city, p_country_code,
      p_lat, p_lng, p_coordinate_precision
    ) -> 'address');
  END IF;
  IF v_patch = '{}'::jsonb THEN
    RETURN jsonb_build_object('ok', true, 'venue_id', v_venue.id, 'changed', false, 'applied', v_patch);
  END IF;

  UPDATE public.venue_listings
  SET name = COALESCE(v_patch ->> 'name', name),
      venue_category = COALESCE(v_patch ->> 'venue_category', venue_category),
      address = CASE WHEN v_patch ? 'address' THEN v_patch #>> '{address,address}' ELSE address END,
      city = CASE WHEN v_patch ? 'address' THEN v_patch #>> '{address,city}' ELSE city END,
      country_code = CASE WHEN v_patch ? 'address' THEN v_patch #>> '{address,country_code}' ELSE country_code END,
      lat = CASE WHEN v_patch ? 'address' THEN (v_patch #>> '{address,lat}')::double precision ELSE lat END,
      lng = CASE WHEN v_patch ? 'address' THEN (v_patch #>> '{address,lng}')::double precision ELSE lng END,
      coordinate_precision = CASE WHEN v_patch ? 'address' THEN v_patch #>> '{address,coordinate_precision}' ELSE coordinate_precision END,
      location_provider_place_id = CASE WHEN v_patch ? 'address' THEN v_place_id ELSE location_provider_place_id END
  WHERE id = v_venue.id;

  PERFORM public.issue_3386_sync_business_authored_place(v_venue.id);

  RETURN jsonb_build_object('ok', true, 'venue_id', v_venue.id, 'changed', true, 'applied', v_patch);
END;
$function$;
REVOKE ALL ON FUNCTION public.biz_update_venue_identity_in_review(uuid, text, text, text, text, text, double precision, double precision, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.biz_update_venue_identity_in_review(uuid, text, text, text, text, text, double precision, double precision, text, text) TO authenticated, service_role;
COMMENT ON FUNCTION public.biz_update_venue_identity_in_review(uuid, text, text, text, text, text, double precision, double precision, text, text) IS '#3386 decision 2: event_manager+ edits name, category and address (with pin and precision) directly while the venue is pending_review. The slug never changes. #4334: + p_location_place_id (DEFAULT NULL, so installed apps keep working) — the picked Google place id, written in the same statement as the coordinates. #4334 (20280525004334): an address re-picked onto the same pin with a new place id counts as a change.';

CREATE OR REPLACE FUNCTION public.biz_submit_venue_details_change_request(p_venue_id uuid, p_name text DEFAULT NULL::text, p_venue_category text DEFAULT NULL::text, p_address text DEFAULT NULL::text, p_city text DEFAULT NULL::text, p_country_code text DEFAULT NULL::text, p_lat double precision DEFAULT NULL::double precision, p_lng double precision DEFAULT NULL::double precision, p_coordinate_precision text DEFAULT NULL::text, p_location_place_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_venue public.venue_listings%ROWTYPE;
  v_patch jsonb;
  v_place_id text;                         -- #4334
  v_probe public.venue_listings%ROWTYPE;   -- #4334
  v_request_id uuid := gen_random_uuid();
  v_replaced boolean;
BEGIN
  v_venue := public.issue_3386_lock_managed_venue(p_venue_id);
  IF v_venue.claim_status <> 'verified' THEN
    RAISE EXCEPTION 'venue_not_live' USING ERRCODE = '55000';
  END IF;

  v_patch := public.issue_3386_identity_patch(
    v_venue, p_name, p_venue_category, p_address, p_city, p_country_code,
    p_lat, p_lng, p_coordinate_precision
  );
  -- #4334 — an address re-picked onto the same pin with a NEW Google place id
  -- is a change: the identity patch above compares text, city, country, pin
  -- and precision only, so add the (re-validated) address with the new id.
  -- Only a non-blank id that differs from the stored one counts; a resent
  -- address without an id still changes nothing.
  v_place_id := public.places_checked_place_id(p_location_place_id);
  IF p_address IS NOT NULL AND NOT (v_patch ? 'address')
     AND v_place_id IS NOT NULL
     AND v_place_id IS DISTINCT FROM v_venue.location_provider_place_id THEN
    v_probe := v_venue;
    v_probe.address := NULL;   -- forces the helper to return the normalised address
    v_patch := v_patch || jsonb_build_object('address', public.issue_3386_identity_patch(
      v_probe, NULL, NULL, p_address, p_city, p_country_code,
      p_lat, p_lng, p_coordinate_precision
    ) -> 'address');
  END IF;
  IF v_patch = '{}'::jsonb THEN
    RAISE EXCEPTION 'nothing_to_change' USING ERRCODE = '22023';
  END IF;
  v_replaced := v_venue.details_change_status = 'pending';

  UPDATE public.venue_listings
  SET details_change_request_id = v_request_id,
      details_change_status = 'pending',
      details_change_name = v_patch ->> 'name',
      details_change_venue_category = v_patch ->> 'venue_category',
      details_change_address = v_patch #>> '{address,address}',
      details_change_city = v_patch #>> '{address,city}',
      details_change_country_code = v_patch #>> '{address,country_code}',
      details_change_lat = (v_patch #>> '{address,lat}')::double precision,
      details_change_lng = (v_patch #>> '{address,lng}')::double precision,
      details_change_coordinate_precision = v_patch #>> '{address,coordinate_precision}',
      details_change_place_id = CASE WHEN v_patch ? 'address' THEN v_place_id END,
      details_change_requested_by = auth.uid(),
      details_change_requested_at = now(),
      details_change_reviewed_by = NULL,
      details_change_reviewed_at = NULL,
      details_change_rejection_reason = NULL
  WHERE id = v_venue.id;

  RETURN jsonb_build_object(
    'ok', true,
    'venue_id', v_venue.id,
    'request_id', v_request_id,
    'replaced', coalesce(v_replaced, false),
    'proposed', v_patch
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.biz_submit_venue_details_change_request(uuid, text, text, text, text, text, double precision, double precision, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.biz_submit_venue_details_change_request(uuid, text, text, text, text, text, double precision, double precision, text, text) TO authenticated, service_role;
COMMENT ON FUNCTION public.biz_submit_venue_details_change_request(uuid, text, text, text, text, text, double precision, double precision, text, text) IS '#3386 decision 3: event_manager+ asks Mingla to change a LIVE venue''s name, category or address. The live row is untouched; a new request replaces the previous one. #4334: + p_location_place_id (DEFAULT NULL, so installed apps keep working) — the picked Google place id, written in the same statement as the coordinates. #4334 (20280525004334): an address re-picked onto the same pin with a new place id counts as a change.';

CREATE OR REPLACE FUNCTION public.business_patch_event_taxonomy_with_place(p_event_id uuid, p_city text, p_party_types text[], p_vibe_tags text[], p_music_genres text[], p_location_lat numeric DEFAULT NULL::numeric, p_location_lng numeric DEFAULT NULL::numeric, p_location_text text DEFAULT NULL::text, p_coordinate_precision text DEFAULT ''::text, p_location_place_id text DEFAULT NULL::text)
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
  v_theme jsonb;                 -- issue #3827
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
    -- issue #3827 — the editor sends the STORED pin on every taxonomy save and
    -- (before this fix) never a precision, so the branch above wiped the
    -- stored precision on a save that moved nothing. The same pin with no
    -- valid token keeps what is stored; a valid token still wins, and a pin
    -- that actually moved behaves exactly as before.
    IF v_coordinate_precision IS NULL
       AND v_event.location_geo IS NOT NULL
       AND v_event.location_geo ~= v_location_geo THEN
      v_coordinate_precision := v_event.coordinate_precision;
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
  -- issue #3827 — "blank" has ONE definition, the label composer's: nothing
  -- left once spaces, tabs, line breaks and no-break spaces are stripped from
  -- both ends. The NULL test this replaces only knew ordinary spaces, so an
  -- address of a single tab or no-break space counted as an address and then
  -- CLEARED the stored one (the composer, correctly, saw nothing in it).
  -- This argument cannot say "clear": blank means "no address sent".
  IF public.business_event_location_label(NULL, v_location_text) IS NULL THEN
    v_location_text := v_event.location_text;
    v_theme := v_event.theme;   -- issue #3827: blank leaves both copies untouched
  ELSE
    -- issue #3827 — p_location_text is the STRUCTURED ADDRESS, not the label.
    -- It used to be written straight into location_text, which dropped the
    -- venue from the label and left theme.business_event.location.address
    -- (what the editor and the public page read first) holding the old
    -- address. Set the address half, then derive the label from both halves.
    v_theme := public.business_event_theme_with_location(
      v_event.theme, v_event.location_text, false, NULL, true, v_location_text);
    v_location_text := public.business_event_location_label(
      v_theme #>> '{business_event,location,venueName}',
      v_theme #>> '{business_event,location,address}');
  END IF;

  UPDATE public.events
  SET
    city = v_city,
    party_types = v_party_types,
    vibe_tags = v_vibe_tags,
    music_genres = v_music_genres,
    location_geo = v_location_geo,
    -- #4334: a re-picked pin carries its Google place id in this same write.
    -- 20280525004334: a pin that MOVED without an id writes NULL (like the RSVP
    -- path), never the old place's id; the stored pin resent unchanged by an
    -- unrelated taxonomy save (#3827) keeps its id.
    location_provider_place_id = CASE
      WHEN p_location_lat IS NULL OR p_location_lng IS NULL THEN location_provider_place_id
      WHEN NULLIF(btrim(COALESCE(p_location_place_id,'')),'') IS NOT NULL
        THEN public.places_checked_place_id(p_location_place_id)
      WHEN v_event.location_geo IS NOT NULL AND v_event.location_geo ~= v_location_geo
        THEN location_provider_place_id
      ELSE NULL END,
    location_text = v_location_text,
    theme = v_theme,                                 -- issue #3827
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
REVOKE ALL ON FUNCTION public.business_patch_event_taxonomy_with_place(uuid, text, text[], text[], text[], numeric, numeric, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.business_patch_event_taxonomy_with_place(uuid, text, text[], text[], text[], numeric, numeric, text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.business_patch_event_taxonomy_with_place(uuid, text, text[], text[], text[], numeric, numeric, text, text, text) TO service_role;
COMMENT ON FUNCTION public.business_patch_event_taxonomy_with_place(uuid, text, text[], text[], text[], numeric, numeric, text, text, text) IS 'ORCH-0824 hotfix-5 + issue #1363 G2: post-publish event taxonomy/address patch. issue #1363 adds an optional trailing p_coordinate_precision (exact|approximate) written to events.coordinate_precision, tied to the conditional location_geo write (precision written only when a new coordinate is supplied; existing precision preserved otherwise). city_required + the location_geo write are unchanged. SECURITY DEFINER + event_manager+ role check. #4334: copy with p_location_place_id, the picked Google place id written in the same statement as the pin. 20280525004334: a moved pin without an id clears the old id; the same pin resent keeps it.';

-- =====================================================================================
-- (3) A re-pick of the SAME place onto refined coordinates keeps its id.
--
-- The place-stamp triggers (tg_4334_lat_lng_place_stamp on venue_listings and
-- brands, tg_4334_events_place_stamp on events) cleared the id whenever the
-- coordinates moved and the id did not, so "the writer re-sent the same id"
-- read as "stale": approximate → exact with the same place id stored NULL.
--
-- Mechanism: every write path that is sent a place id validates it through
-- public.places_checked_place_id, which now also records it in the
-- transaction-local setting mingla.place_id_confirmed. A trigger keeps the id
-- (and stamps the fresh pin) only when the row's id equals the asserted one,
-- and consumes the setting so it never carries to a later write. Everything
-- else is unchanged: a moved pin with no id asserted, including a direct
-- UPDATE, still clears. places_checked_place_id becomes VOLATILE (it now has
-- an effect); it is used by no index, constraint or generated column.
-- admin_review_venue_details_change asserts the request's own id before it
-- applies the request. Writers that never send an id through the validator
-- (the brand profile's direct table write, trip pins inside theme) keep the
-- old clear-on-move behaviour.
-- =====================================================================================

CREATE OR REPLACE FUNCTION public.places_checked_place_id(p_id text)
 RETURNS text
 LANGUAGE plpgsql
 VOLATILE
 SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NULLIF(btrim(COALESCE(p_id, '')), '') IS NULL THEN RETURN NULL; END IF;
  IF NOT public.places_is_google_place_id(btrim(p_id)) THEN
    RAISE EXCEPTION 'location_place_id_invalid' USING ERRCODE = '22023';
  END IF;
  -- 20280525004334: the writer asserts this id for the row it is writing, so
  -- the place-stamp triggers keep it even when the coordinates move (a
  -- re-pick of the same place onto refined coordinates). Transaction-local,
  -- and consumed by the next place-stamp trigger that fires.
  PERFORM set_config('mingla.place_id_confirmed', btrim(p_id), true);
  RETURN btrim(p_id);
END;
$function$;
REVOKE ALL ON FUNCTION public.places_checked_place_id(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.places_checked_place_id(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.tg_4334_lat_lng_place_stamp()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_confirmed text;   -- 20280525004334
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF public.places_is_google_place_id(NEW.location_provider_place_id)
       AND NEW.location_geo_refreshed_at IS NULL THEN
      NEW.location_geo_refreshed_at := now();
      NEW.location_geo_refresh_state := 'ok';
      NEW.location_geo_refresh_failures := 0;
    END IF;
    RETURN NEW;
  END IF;
  -- 20280525004334: the id the writer asserted through places_checked_place_id
  -- in this transaction, consumed here so it never carries to a later write.
  v_confirmed := NULLIF(current_setting('mingla.place_id_confirmed', true), '');
  IF v_confirmed IS NOT NULL THEN
    PERFORM set_config('mingla.place_id_confirmed', '', true);
  END IF;
  IF NEW.location_geo_refreshed_at IS DISTINCT FROM OLD.location_geo_refreshed_at
     OR NEW.location_geo_refresh_state IS DISTINCT FROM OLD.location_geo_refresh_state THEN
    RETURN NEW;
  END IF;
  IF NEW.location_provider_place_id IS DISTINCT FROM OLD.location_provider_place_id THEN
    IF public.places_is_google_place_id(NEW.location_provider_place_id) THEN
      NEW.location_geo_refreshed_at := now();
      NEW.location_geo_refresh_state := 'ok';
    ELSE
      NEW.location_geo_refreshed_at := NULL;
      NEW.location_geo_refresh_state := NULL;
    END IF;
    NEW.location_geo_refresh_failures := 0;
  ELSIF (NEW.lat IS DISTINCT FROM OLD.lat OR NEW.lng IS DISTINCT FROM OLD.lng)
        AND NEW.location_provider_place_id IS NOT NULL
        AND v_confirmed IS NOT DISTINCT FROM NEW.location_provider_place_id THEN
    -- 20280525004334: the same place re-picked onto refined coordinates: the
    -- writer asserted this id, so keep it and stamp the fresh pin.
    NEW.location_geo_refreshed_at := now();
    NEW.location_geo_refresh_state := 'ok';
    NEW.location_geo_refresh_failures := 0;
  ELSIF (NEW.lat IS DISTINCT FROM OLD.lat OR NEW.lng IS DISTINCT FROM OLD.lng)
        AND NEW.location_provider_place_id IS NOT NULL THEN
    NEW.location_provider_place_id := NULL;
    NEW.location_geo_refreshed_at := NULL;
    NEW.location_geo_refresh_state := NULL;
    NEW.location_geo_refresh_failures := 0;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tg_4334_events_place_stamp()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_side text;
  v_new jsonb;
  v_old jsonb;
  v_confirmed text;   -- 20280525004334
BEGIN
  -- 20280525004334: the id the writer asserted through places_checked_place_id
  -- in this transaction, consumed here so it never carries to a later write.
  IF TG_OP = 'UPDATE' THEN
    v_confirmed := NULLIF(current_setting('mingla.place_id_confirmed', true), '');
    IF v_confirmed IS NOT NULL THEN
      PERFORM set_config('mingla.place_id_confirmed', '', true);
    END IF;
  END IF;
  -- event location pin
  IF TG_OP = 'INSERT' THEN
    IF public.places_is_google_place_id(NEW.location_provider_place_id)
       AND NEW.location_geo_refreshed_at IS NULL THEN
      NEW.location_geo_refreshed_at := now();
      NEW.location_geo_refresh_state := 'ok';
      NEW.location_geo_refresh_failures := 0;
    END IF;
  ELSIF NEW.location_geo_refreshed_at IS NOT DISTINCT FROM OLD.location_geo_refreshed_at
        AND NEW.location_geo_refresh_state IS NOT DISTINCT FROM OLD.location_geo_refresh_state THEN
    IF NEW.location_provider_place_id IS DISTINCT FROM OLD.location_provider_place_id THEN
      IF public.places_is_google_place_id(NEW.location_provider_place_id) THEN
        NEW.location_geo_refreshed_at := now();
        NEW.location_geo_refresh_state := 'ok';
      ELSE
        NEW.location_geo_refreshed_at := NULL;
        NEW.location_geo_refresh_state := NULL;
      END IF;
      NEW.location_geo_refresh_failures := 0;
    ELSIF NEW.location_geo::text IS DISTINCT FROM OLD.location_geo::text
          AND NEW.location_provider_place_id IS NOT NULL
          AND v_confirmed IS NOT DISTINCT FROM NEW.location_provider_place_id THEN
      -- 20280525004334: the same place re-picked onto refined coordinates:
      -- the writer asserted this id, so keep it and stamp the fresh pin.
      NEW.location_geo_refreshed_at := now();
      NEW.location_geo_refresh_state := 'ok';
      NEW.location_geo_refresh_failures := 0;
    ELSIF NEW.location_geo::text IS DISTINCT FROM OLD.location_geo::text
          AND NEW.location_provider_place_id IS NOT NULL THEN
      NEW.location_provider_place_id := NULL;
      NEW.location_geo_refreshed_at := NULL;
      NEW.location_geo_refresh_state := NULL;
      NEW.location_geo_refresh_failures := 0;
    END IF;
  END IF;

  -- trip departure / destination pins in theme.business_trip
  IF jsonb_typeof(NEW.theme -> 'business_trip') = 'object' THEN
    FOREACH v_side IN ARRAY ARRAY['departure', 'destination'] LOOP
      v_new := NEW.theme -> 'business_trip';
      v_old := CASE WHEN TG_OP = 'UPDATE' AND jsonb_typeof(OLD.theme -> 'business_trip') = 'object'
                    THEN OLD.theme -> 'business_trip' ELSE '{}'::jsonb END;
      -- writer-managed
      CONTINUE WHEN TG_OP = 'UPDATE'
        AND ((v_new -> (v_side || 'GeoRefreshedAt')) IS DISTINCT FROM (v_old -> (v_side || 'GeoRefreshedAt'))
          OR (v_new -> (v_side || 'GeoRefreshState')) IS DISTINCT FROM (v_old -> (v_side || 'GeoRefreshState')));
      IF (v_new ->> (v_side || 'PlaceId')) IS DISTINCT FROM (v_old ->> (v_side || 'PlaceId')) THEN
        IF public.places_is_google_place_id(v_new ->> (v_side || 'PlaceId')) THEN
          v_new := v_new || jsonb_build_object(
            v_side || 'GeoRefreshedAt', to_jsonb(now()),
            v_side || 'GeoRefreshState', 'ok',
            v_side || 'GeoRefreshFailures', 0);
        ELSE
          v_new := v_new - (v_side || 'GeoRefreshedAt') - (v_side || 'GeoRefreshState')
                         - (v_side || 'GeoRefreshFailures');
        END IF;
      ELSIF TG_OP = 'UPDATE'
        AND public.places_is_google_place_id(v_new ->> (v_side || 'PlaceId'))
        AND ((v_new -> (v_side || 'Lat')) IS DISTINCT FROM (v_old -> (v_side || 'Lat'))
          OR (v_new -> (v_side || 'Lng')) IS DISTINCT FROM (v_old -> (v_side || 'Lng'))) THEN
        v_new := (v_new - (v_side || 'GeoRefreshedAt') - (v_side || 'GeoRefreshState')
                        - (v_side || 'GeoRefreshFailures'))
                 || jsonb_build_object(v_side || 'PlaceId', NULL);
      ELSE
        CONTINUE;
      END IF;
      NEW.theme := jsonb_set(NEW.theme, '{business_trip}', v_new);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_review_venue_details_change(p_venue_id uuid, p_request_id uuid, p_decision text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_venue public.venue_listings%ROWTYPE;
  v_after public.venue_listings%ROWTYPE;
  v_decision text := lower(btrim(coalesce(p_decision, '')));
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_before jsonb;
  v_proposed jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_decision NOT IN ('approve', 'reject') THEN
    RAISE EXCEPTION 'invalid_decision' USING ERRCODE = '22023';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'request_id_required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_venue FROM public.venue_listings WHERE id = p_venue_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'venue_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Withdrawn, replaced by a newer request, or already approved: never apply a
  -- request the admin is not looking at.
  IF v_venue.details_change_request_id IS DISTINCT FROM p_request_id THEN
    RETURN jsonb_build_object('ok', false, 'code', 'request_not_current', 'venue_id', v_venue.id);
  END IF;
  IF v_venue.details_change_status = 'rejected' THEN
    IF v_decision = 'reject' THEN
      RETURN jsonb_build_object(
        'ok', true, 'noop', true, 'decision', 'rejected',
        'venue_id', v_venue.id, 'brand_id', v_venue.brand_id,
        'request_id', p_request_id, 'venue_name', v_venue.name
      );
    END IF;
    RETURN jsonb_build_object('ok', false, 'code', 'request_not_pending', 'venue_id', v_venue.id);
  END IF;

  v_before := jsonb_build_object(
    'name', v_venue.name,
    'venue_category', v_venue.venue_category,
    'address', v_venue.address,
    'city', v_venue.city,
    'country_code', v_venue.country_code,
    'lat', v_venue.lat,
    'lng', v_venue.lng,
    'coordinate_precision', v_venue.coordinate_precision
  );
  v_proposed := jsonb_strip_nulls(jsonb_build_object(
    'name', v_venue.details_change_name,
    'venue_category', v_venue.details_change_venue_category,
    'address', v_venue.details_change_address,
    'city', v_venue.details_change_city,
    'country_code', v_venue.details_change_country_code,
    'lat', v_venue.details_change_lat,
    'lng', v_venue.details_change_lng,
    'coordinate_precision', v_venue.details_change_coordinate_precision
  ));

  IF v_decision = 'approve' THEN
    IF v_venue.claim_status <> 'verified' THEN
      RAISE EXCEPTION 'venue_not_live' USING ERRCODE = '55000';
    END IF;
    IF v_venue.details_change_venue_category IS NOT NULL
       AND v_venue.details_change_venue_category IS DISTINCT FROM v_venue.venue_category
       AND (v_venue.details_change_venue_category = 'stay' OR v_venue.venue_category = 'stay') THEN
      RAISE EXCEPTION 'category_stay_change_not_supported' USING ERRCODE = '22023';
    END IF;

    -- 20280525004334: the request's place id is asserted for this write, so a
    -- request that refines the same place's coordinates keeps the id.
    IF v_venue.details_change_address IS NOT NULL THEN
      PERFORM public.places_checked_place_id(v_venue.details_change_place_id);
    END IF;

    -- One statement: the right-hand side reads the pre-update row, so the new
    -- values land and the request clears atomically.
    UPDATE public.venue_listings
    SET name = COALESCE(details_change_name, name),
        venue_category = COALESCE(details_change_venue_category, venue_category),
        address = CASE WHEN details_change_address IS NOT NULL THEN details_change_address ELSE address END,
        city = CASE WHEN details_change_address IS NOT NULL THEN details_change_city ELSE city END,
        country_code = CASE WHEN details_change_address IS NOT NULL THEN details_change_country_code ELSE country_code END,
        lat = CASE WHEN details_change_address IS NOT NULL THEN details_change_lat ELSE lat END,
        lng = CASE WHEN details_change_address IS NOT NULL THEN details_change_lng ELSE lng END,
        coordinate_precision = CASE WHEN details_change_address IS NOT NULL THEN details_change_coordinate_precision ELSE coordinate_precision END,
        location_provider_place_id = CASE WHEN details_change_address IS NOT NULL THEN details_change_place_id ELSE location_provider_place_id END,
        details_change_request_id = NULL,
        details_change_status = NULL,
        details_change_name = NULL,
        details_change_venue_category = NULL,
        details_change_address = NULL,
        details_change_city = NULL,
        details_change_country_code = NULL,
        details_change_lat = NULL,
        details_change_lng = NULL,
        details_change_coordinate_precision = NULL,
        details_change_place_id = NULL,
        details_change_requested_by = NULL,
        details_change_requested_at = NULL,
        details_change_reviewed_by = NULL,
        details_change_reviewed_at = NULL,
        details_change_rejection_reason = NULL
    WHERE id = v_venue.id
    RETURNING * INTO v_after;

    PERFORM public.issue_3386_sync_business_authored_place(v_venue.id);

    PERFORM public.admin_write_audit(
      'venue_details_change.approve',
      'venue_listing',
      v_venue.id::text,
      'Approved the host''s venue details change request',
      jsonb_build_object(
        'request_id', p_request_id,
        'requested_by', v_venue.details_change_requested_by,
        'before', v_before,
        'proposed', v_proposed
      ),
      false
    );

    RETURN jsonb_build_object(
      'ok', true,
      'noop', false,
      'decision', 'approved',
      'venue_id', v_venue.id,
      'brand_id', v_venue.brand_id,
      'request_id', p_request_id,
      'requested_by', v_venue.details_change_requested_by,
      'venue_name', v_after.name,
      'before', v_before,
      'proposed', v_proposed
    );
  END IF;

  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'rejection_reason_required' USING ERRCODE = '22023';
  END IF;
  IF length(v_reason) > 1000 THEN
    RAISE EXCEPTION 'rejection_reason_too_long' USING ERRCODE = '22023';
  END IF;

  UPDATE public.venue_listings
  SET details_change_status = 'rejected',
      details_change_reviewed_by = auth.uid(),
      details_change_reviewed_at = now(),
      details_change_rejection_reason = v_reason
  WHERE id = v_venue.id;

  PERFORM public.admin_write_audit(
    'venue_details_change.reject',
    'venue_listing',
    v_venue.id::text,
    v_reason,
    jsonb_build_object(
      'request_id', p_request_id,
      'requested_by', v_venue.details_change_requested_by,
      'before', v_before,
      'proposed', v_proposed
    ),
    true
  );

  RETURN jsonb_build_object(
    'ok', true,
    'noop', false,
    'decision', 'rejected',
    'venue_id', v_venue.id,
    'brand_id', v_venue.brand_id,
    'request_id', p_request_id,
    'requested_by', v_venue.details_change_requested_by,
    'venue_name', v_venue.name,
    'rejection_reason', v_reason,
    'before', v_before,
    'proposed', v_proposed
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_review_venue_details_change(uuid,uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_review_venue_details_change(uuid,uuid,text,text) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.tg_4334_events_place_stamp() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_4334_lat_lng_place_stamp() FROM PUBLIC, anon, authenticated;
