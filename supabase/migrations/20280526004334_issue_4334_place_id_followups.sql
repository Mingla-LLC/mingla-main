-- #4334 follow-ups (after 20280525004334) — a re-pick of the SAME place onto
-- refined coordinates keeps its Google place id on the three writers that
-- 20280525004334 left on clear-on-move: the brand profile pin, trip
-- departure/destination pins and experience stops.
--
-- (1) Brand profile pin. The host app wrote brands.lat/lng with a PostgREST
--     table update, which can never assert an id, so the brands place-stamp
--     trigger cleared the id on every pin move. public.biz_update_brand_pin
--     writes the pin and its id in ONE statement and validates the id through
--     public.places_checked_place_id (which asserts it for that write, the
--     20280525004334 mechanism). It is SECURITY INVOKER on purpose: the brands
--     UPDATE policies (account owner, brand admin+, Mingla admin) apply exactly
--     as they do to the direct table write it replaces, so it grants nothing
--     the caller did not already have. A pin with no id stores NULL; a pin
--     cleared (NULL lat or lng) stores no id.
--
-- (2) Trip pins (theme.business_trip <side>PlaceId / Lat / Lng) and experience
--     stops (experience_stops.place_id / lat / lng). Both can carry several
--     pins in ONE row write (departure + destination) or several rows in one
--     RPC (stops), so the single-valued mingla.place_id_confirmed cannot carry
--     them. A second transaction-local record, mingla.place_pins_confirmed,
--     holds KEYED assertions — `trip:<event id>:<side>=<place id>` and
--     `stop:<event id>:<stop order>=<place id>` — so an assertion matches only
--     the one pin of the one row it was made for and can never reach another
--     row. The place-stamp triggers keep the id (and stamp the fresh pin) only
--     when that pin's key=id is recorded; every other move still clears.
--
--     The record is written only by three SECURITY DEFINER commands that wrap
--     the existing owners unchanged — biz_apply_trip_draft_graph_repick,
--     biz_update_trip_live_command_repick and biz_update_live_experience_repick
--     — from the place ids THIS call's payload sends, and cleared before they
--     return. The wrapped owners (and their grants, guards, PT409 conflicts and
--     receipts) are untouched, so installed apps that still call them keep the
--     old clear-on-move behaviour. A non-Google id is never recorded (the
--     trigger never clears one anyway), so no payload that saves today is
--     refused by the wrappers.
--
-- Static SQL only. Signatures of existing functions are unchanged.
--
-- Test: supabase/migrations/__tests__/issue_4334_place_id_followups.implementor.pg17.test.sql

-- ── keyed pin assertions ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.places_confirm_pin(p_key text, p_place_id text)
 RETURNS void
 LANGUAGE plpgsql
 VOLATILE
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_id text := btrim(COALESCE(p_place_id, ''));
BEGIN
  -- Only a Google place id is recorded; the key never carries a space or '='.
  IF NULLIF(btrim(COALESCE(p_key, '')), '') IS NULL OR p_key ~ '[[:space:]=]'
     OR NOT public.places_is_google_place_id(v_id) THEN
    RETURN;
  END IF;
  PERFORM set_config('mingla.place_pins_confirmed',
    COALESCE(current_setting('mingla.place_pins_confirmed', true), '') || ' ' || p_key || '=' || v_id || ' ',
    true);
END;
$function$;
REVOKE ALL ON FUNCTION public.places_confirm_pin(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.places_confirm_pin(text, text) TO service_role;
COMMENT ON FUNCTION public.places_confirm_pin(text, text) IS '#4334 (20280526004334): records, for this transaction only, that the writer asserted place id p_place_id for the pin named by p_key (trip:<event id>:<side> or stop:<event id>:<stop order>). Called only by the *_repick commands, which clear the record before they return.';

-- Pure: is key=id recorded in this transaction?
CREATE OR REPLACE FUNCTION public.places_pin_confirmed(p_key text, p_place_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path = public, pg_temp
AS $function$
  SELECT p_key IS NOT NULL AND p_place_id IS NOT NULL
     AND position(' ' || p_key || '=' || p_place_id || ' '
                  IN ' ' || COALESCE(current_setting('mingla.place_pins_confirmed', true), '') || ' ') > 0;
$function$;
-- The place-stamp triggers run as whoever writes the row (a direct table
-- update included), so every writer role must be able to read the record.
GRANT EXECUTE ON FUNCTION public.places_pin_confirmed(text, text) TO PUBLIC;

-- The trip pins this payload sends: <side>PlaceId under event.business_trip
-- (draft graph / Ari) or theme.business_trip (the live patch).
CREATE OR REPLACE FUNCTION public.places_confirm_trip_pins(p_event_id uuid, p_patch jsonb)
 RETURNS void
 LANGUAGE plpgsql
 VOLATILE
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_side text;
  v_trip jsonb;
BEGIN
  IF p_event_id IS NULL OR jsonb_typeof(p_patch) IS DISTINCT FROM 'object' THEN RETURN; END IF;
  FOREACH v_side IN ARRAY ARRAY['departure', 'destination'] LOOP
    FOREACH v_trip IN ARRAY ARRAY[p_patch #> '{event,business_trip}', p_patch #> '{theme,business_trip}'] LOOP
      IF jsonb_typeof(v_trip) = 'object' AND jsonb_typeof(v_trip -> (v_side || 'PlaceId')) = 'string' THEN
        PERFORM public.places_confirm_pin('trip:' || p_event_id || ':' || v_side, v_trip ->> (v_side || 'PlaceId'));
      END IF;
    END LOOP;
  END LOOP;
END;
$function$;
REVOKE ALL ON FUNCTION public.places_confirm_trip_pins(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.places_confirm_trip_pins(uuid, jsonb) TO service_role;

-- The stop pins this payload sends, read exactly as biz_update_live_experience
-- reads them: stop_order (or the position), and in single-location mode every
-- stop takes the first stop's place.
CREATE OR REPLACE FUNCTION public.places_confirm_experience_pins(p_event_id uuid, p_payload jsonb)
 RETURNS void
 LANGUAGE plpgsql
 VOLATILE
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_stops jsonb;
  v_single boolean;
  v_stop jsonb;
  v_idx bigint;
  v_order integer;
BEGIN
  IF p_event_id IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN RETURN; END IF;
  v_stops := p_payload -> 'stops';
  IF jsonb_typeof(v_stops) IS DISTINCT FROM 'array' THEN RETURN; END IF;
  v_single := COALESCE(NULLIF(p_payload ->> 'location_mode', ''), 'single') = 'single';
  FOR v_stop, v_idx IN SELECT value, ordinality FROM jsonb_array_elements(v_stops) WITH ORDINALITY LOOP
    IF jsonb_typeof(v_stop) <> 'object' THEN CONTINUE; END IF;
    BEGIN
      v_order := COALESCE((v_stop ->> 'stop_order')::integer, (v_idx - 1)::integer);
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      CONTINUE;   -- the owner refuses this payload itself; assert nothing for it
    END;
    PERFORM public.places_confirm_pin('stop:' || p_event_id || ':' || v_order,
      CASE WHEN v_single THEN v_stops -> 0 ->> 'place_id' ELSE v_stop ->> 'place_id' END);
  END LOOP;
END;
$function$;
REVOKE ALL ON FUNCTION public.places_confirm_experience_pins(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.places_confirm_experience_pins(uuid, jsonb) TO service_role;

-- ── the place-stamp triggers read the keyed record ───────────────────────────

-- Copied from 20280525004334; the only change is in the trip section: a
-- recorded trip:<id>:<side>=<place id> keeps that pin's id on a move.
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
  -- in this transaction, consumed by EVERY row write (insert or update) so it
  -- never carries to a later write.
  v_confirmed := NULLIF(current_setting('mingla.place_id_confirmed', true), '');
  IF v_confirmed IS NOT NULL THEN
    PERFORM set_config('mingla.place_id_confirmed', '', true);
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
        IF public.places_pin_confirmed('trip:' || NEW.id || ':' || v_side, v_new ->> (v_side || 'PlaceId')) THEN
          -- 20280526004334: the same place re-picked onto refined coordinates,
          -- asserted for THIS pin of THIS trip: keep the id, stamp the fresh pin.
          v_new := v_new || jsonb_build_object(
            v_side || 'GeoRefreshedAt', to_jsonb(now()),
            v_side || 'GeoRefreshState', 'ok',
            v_side || 'GeoRefreshFailures', 0);
        ELSE
          v_new := (v_new - (v_side || 'GeoRefreshedAt') - (v_side || 'GeoRefreshState')
                          - (v_side || 'GeoRefreshFailures'))
                   || jsonb_build_object(v_side || 'PlaceId', NULL);
        END IF;
      ELSE
        CONTINUE;
      END IF;
      NEW.theme := jsonb_set(NEW.theme, '{business_trip}', v_new);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$function$;

-- Copied from 20280521004334; the only change: a recorded
-- stop:<event id>:<stop order>=<place id> keeps that stop's id on a move.
CREATE OR REPLACE FUNCTION public.tg_4334_experience_stops_place_stamp()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = public, pg_temp
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF public.places_is_google_place_id(NEW.place_id) AND NEW.geo_refreshed_at IS NULL THEN
      NEW.geo_refreshed_at := now();
      NEW.geo_refresh_state := 'ok';
      NEW.geo_refresh_failures := 0;
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.geo_refreshed_at IS DISTINCT FROM OLD.geo_refreshed_at
     OR NEW.geo_refresh_state IS DISTINCT FROM OLD.geo_refresh_state THEN
    RETURN NEW;
  END IF;
  IF NEW.place_id IS DISTINCT FROM OLD.place_id THEN
    IF public.places_is_google_place_id(NEW.place_id) THEN
      NEW.geo_refreshed_at := now();
      NEW.geo_refresh_state := 'ok';
    ELSE
      NEW.geo_refreshed_at := NULL;
      NEW.geo_refresh_state := NULL;
    END IF;
    NEW.geo_refresh_failures := 0;
  ELSIF (NEW.lat IS DISTINCT FROM OLD.lat OR NEW.lng IS DISTINCT FROM OLD.lng)
        AND public.places_is_google_place_id(NEW.place_id)
        AND public.places_pin_confirmed('stop:' || NEW.event_id || ':' || NEW.stop_order, NEW.place_id) THEN
    -- 20280526004334: the same place re-picked onto refined coordinates,
    -- asserted for THIS stop: keep the id, stamp the fresh pin.
    NEW.geo_refreshed_at := now();
    NEW.geo_refresh_state := 'ok';
    NEW.geo_refresh_failures := 0;
  ELSIF (NEW.lat IS DISTINCT FROM OLD.lat OR NEW.lng IS DISTINCT FROM OLD.lng)
        AND public.places_is_google_place_id(NEW.place_id) THEN
    NEW.place_id := NULL;
    NEW.geo_refreshed_at := NULL;
    NEW.geo_refresh_state := NULL;
    NEW.geo_refresh_failures := 0;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.tg_4334_events_place_stamp() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_4334_experience_stops_place_stamp() FROM PUBLIC, anon, authenticated;

-- ── the commands that assert ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.biz_apply_trip_draft_graph_repick(p_event_id uuid, p_patch jsonb, p_expected_updated_at timestamp with time zone, p_operation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM set_config('mingla.place_pins_confirmed', '', true);
  PERFORM public.places_confirm_trip_pins(p_event_id, p_patch);
  v_result := public.biz_apply_trip_draft_graph(p_event_id, p_patch, p_expected_updated_at, p_operation_id);
  PERFORM set_config('mingla.place_pins_confirmed', '', true);
  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION public.biz_apply_trip_draft_graph_repick(uuid, jsonb, timestamp with time zone, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.biz_apply_trip_draft_graph_repick(uuid, jsonb, timestamp with time zone, uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.biz_apply_trip_draft_graph_repick(uuid, jsonb, timestamp with time zone, uuid) IS '#4334 (20280526004334): biz_apply_trip_draft_graph, unchanged, with the trip pins this patch sends asserted for this trip only — a re-pick of the same place onto refined coordinates keeps its place id. A pin moved with no id still clears it.';

CREATE OR REPLACE FUNCTION public.biz_update_trip_live_command_repick(p_event_id uuid, p_patch jsonb, p_reason text, p_expected_updated_at timestamp with time zone, p_operation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM set_config('mingla.place_pins_confirmed', '', true);
  PERFORM public.places_confirm_trip_pins(p_event_id, p_patch);
  v_result := public.biz_update_trip_live_command(p_event_id, p_patch, p_reason, p_expected_updated_at, p_operation_id);
  PERFORM set_config('mingla.place_pins_confirmed', '', true);
  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION public.biz_update_trip_live_command_repick(uuid, jsonb, text, timestamp with time zone, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.biz_update_trip_live_command_repick(uuid, jsonb, text, timestamp with time zone, uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.biz_update_trip_live_command_repick(uuid, jsonb, text, timestamp with time zone, uuid) IS '#4334 (20280526004334): biz_update_trip_live_command, unchanged, with the trip pins this patch sends asserted for this trip only — a re-pick of the same place onto refined coordinates keeps its place id. A pin moved with no id still clears it.';

CREATE OR REPLACE FUNCTION public.biz_update_live_experience_repick(p_event_id uuid, p_payload jsonb, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM set_config('mingla.place_pins_confirmed', '', true);
  PERFORM public.places_confirm_experience_pins(p_event_id, p_payload);
  v_result := public.biz_update_live_experience(p_event_id, p_payload, p_reason);
  PERFORM set_config('mingla.place_pins_confirmed', '', true);
  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION public.biz_update_live_experience_repick(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.biz_update_live_experience_repick(uuid, jsonb, text) TO authenticated, service_role;
COMMENT ON FUNCTION public.biz_update_live_experience_repick(uuid, jsonb, text) IS '#4334 (20280526004334): biz_update_live_experience, unchanged, with the stop pins this payload sends asserted for this experience''s stops only — a re-pick of the same place onto refined coordinates keeps its place id. A stop moved with no id still clears it.';

-- ── the brand profile pin ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.biz_update_brand_pin(p_brand_id uuid, p_lat double precision, p_lng double precision, p_location_place_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row public.brands%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  -- The brands UPDATE policies decide who may write (this runs as the caller).
  -- The id is validated and asserted for this one write; a pin with no id, or
  -- no pin, stores none.
  UPDATE public.brands
     SET lat = p_lat,
         lng = p_lng,
         location_provider_place_id = CASE
           WHEN p_lat IS NULL OR p_lng IS NULL THEN NULL
           ELSE public.places_checked_place_id(p_location_place_id) END
   WHERE id = p_brand_id
     AND deleted_at IS NULL
  RETURNING * INTO v_row;
  IF NOT FOUND THEN
    -- Nothing written: the id validated above asserts nothing.
    PERFORM set_config('mingla.place_id_confirmed', '', true);
    RAISE EXCEPTION 'brand_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN to_jsonb(v_row);
END;
$function$;
REVOKE ALL ON FUNCTION public.biz_update_brand_pin(uuid, double precision, double precision, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.biz_update_brand_pin(uuid, double precision, double precision, text) TO authenticated, service_role;
COMMENT ON FUNCTION public.biz_update_brand_pin(uuid, double precision, double precision, text) IS '#4334 (20280526004334): the brand profile pin and its Google place id in one statement. SECURITY INVOKER: the brands UPDATE policies apply exactly as to a direct table write. The id is validated by places_checked_place_id, which asserts it for this write, so the same place re-picked onto refined coordinates keeps its id; a pin with no id stores NULL.';
