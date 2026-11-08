-- #4334 — address search, geocoding and map images move to Google Maps
-- Platform; the retired map vendor is removed.
--
-- What this migration does (spec v2 §6, §8, A1–A3; Seth's decisions D1–D10):
--   1. Per-pin Google place id + refresh bookkeeping on events (location and the
--      trip departure/destination JSON), experience_stops, venue_listings,
--      brands, preferences (custom location + discover city) and chat_plans.
--      Audit columns keep the pre-#4334 pin, written once by the re-pin.
--   2. A stamp trigger per table: a new place id stamps `geo_refreshed_at`; new
--      coordinates WITHOUT a new id drop the id (never refresh a pin from a
--      place it did not come from). Writer-managed bookkeeping (the refresh job,
--      the re-pin) is trusted.
--   3. Every Host save path writes the picked place id in the SAME statement as
--      the coordinates (A-2 section at the end of this file).
--   4. Chat plans: mapbox_id → provider_place_id; plan RPCs accept
--      `providerPlaceId` and refuse the retired `mapboxId` key loudly; identity
--      key 'google:<id>'.
--   5. places_refresh_* (Branch B: Google coordinates are kept at most 30 days)
--      and places_repin_* (D2) service-role functions used by the
--      places-coordinate-refresh edge function and scripts/issue-4334.
--      Live, upcoming and draft offerings are NEVER auto-cleared (A1);
--      preference anchors are NEVER cleared (A2).
--   6. api-health: the retired map vendor's tile is removed; four Google tiles
--      are registered.
--   7. pg_cron job `places-coordinate-refresh-daily` at 03:20 UTC.
--
-- Static SQL only (no dynamic EXECUTE). Conflicts raise PT409, never 40001.
-- Host-entered text (location_text, address, trip *LocationText, custom_location,
-- discover_city_name) is never written here (D9, #1363).
-- Pinned by supabase/migrations/__tests__/issue_4334_google_places.implementor.pg17.test.sql.

BEGIN;

-- ── 1. columns ──────────────────────────────────────────────────────────────
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS location_provider_place_id text NULL,
  ADD COLUMN IF NOT EXISTS location_geo_refreshed_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS location_geo_refresh_state text NULL,
  ADD COLUMN IF NOT EXISTS location_geo_refresh_failures smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS location_mapbox_lat double precision NULL,
  ADD COLUMN IF NOT EXISTS location_mapbox_lng double precision NULL;

ALTER TABLE public.experience_stops
  ADD COLUMN IF NOT EXISTS geo_refreshed_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS geo_refresh_state text NULL,
  ADD COLUMN IF NOT EXISTS geo_refresh_failures smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS mapbox_lat double precision NULL,
  ADD COLUMN IF NOT EXISTS mapbox_lng double precision NULL;

ALTER TABLE public.venue_listings
  ADD COLUMN IF NOT EXISTS location_provider_place_id text NULL,
  ADD COLUMN IF NOT EXISTS location_geo_refreshed_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS location_geo_refresh_state text NULL,
  ADD COLUMN IF NOT EXISTS location_geo_refresh_failures smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS location_mapbox_lat double precision NULL,
  ADD COLUMN IF NOT EXISTS location_mapbox_lng double precision NULL;

ALTER TABLE public.brands
  ADD COLUMN IF NOT EXISTS location_provider_place_id text NULL,
  ADD COLUMN IF NOT EXISTS location_geo_refreshed_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS location_geo_refresh_state text NULL,
  ADD COLUMN IF NOT EXISTS location_geo_refresh_failures smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS location_mapbox_lat double precision NULL,
  ADD COLUMN IF NOT EXISTS location_mapbox_lng double precision NULL;

-- Preference anchors are one user's own saved location (A2). Not re-pinned, so
-- no audit columns.
ALTER TABLE public.preferences
  ADD COLUMN IF NOT EXISTS custom_location_place_id text NULL,
  ADD COLUMN IF NOT EXISTS custom_location_geo_refreshed_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS custom_location_geo_refresh_state text NULL,
  ADD COLUMN IF NOT EXISTS custom_location_geo_refresh_failures smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discover_city_place_id text NULL,
  ADD COLUMN IF NOT EXISTS discover_city_geo_refreshed_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS discover_city_geo_refresh_state text NULL,
  ADD COLUMN IF NOT EXISTS discover_city_geo_refresh_failures smallint NOT NULL DEFAULT 0;

-- Chat plans: 0 ids stored in production, so the rename carries no data.
DO $rename$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'chat_plans'
                AND column_name = 'mapbox_id') THEN
    ALTER TABLE public.chat_plans RENAME COLUMN mapbox_id TO provider_place_id;
    ALTER TABLE public.chat_plans
      RENAME CONSTRAINT chat_plans_mapbox_id_length TO chat_plans_provider_place_id_length;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'chat_plan_place_options'
                AND column_name = 'mapbox_id') THEN
    ALTER TABLE public.chat_plan_place_options RENAME COLUMN mapbox_id TO provider_place_id;
    ALTER TABLE public.chat_plan_place_options
      RENAME CONSTRAINT chat_plan_place_options_mapbox_id_length
      TO chat_plan_place_options_provider_place_id_length;
  END IF;
END;
$rename$;

ALTER TABLE public.chat_plans
  ADD COLUMN IF NOT EXISTS place_geo_refreshed_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS place_geo_refresh_state text NULL,
  ADD COLUMN IF NOT EXISTS place_geo_refresh_failures smallint NOT NULL DEFAULT 0;

-- CHECKs (idempotent: drop then add).
ALTER TABLE public.events DROP CONSTRAINT IF EXISTS events_location_provider_place_id_length;
ALTER TABLE public.events ADD CONSTRAINT events_location_provider_place_id_length
  CHECK (location_provider_place_id IS NULL OR char_length(location_provider_place_id) BETWEEN 1 AND 256);
ALTER TABLE public.events DROP CONSTRAINT IF EXISTS events_location_geo_refresh_state_check;
ALTER TABLE public.events ADD CONSTRAINT events_location_geo_refresh_state_check
  CHECK (location_geo_refresh_state IN ('ok', 'failing', 'place_gone', 'expired'));

ALTER TABLE public.experience_stops DROP CONSTRAINT IF EXISTS experience_stops_geo_refresh_state_check;
ALTER TABLE public.experience_stops ADD CONSTRAINT experience_stops_geo_refresh_state_check
  CHECK (geo_refresh_state IN ('ok', 'failing', 'place_gone', 'expired'));

ALTER TABLE public.venue_listings DROP CONSTRAINT IF EXISTS venue_listings_location_provider_place_id_length;
ALTER TABLE public.venue_listings ADD CONSTRAINT venue_listings_location_provider_place_id_length
  CHECK (location_provider_place_id IS NULL OR char_length(location_provider_place_id) BETWEEN 1 AND 256);
ALTER TABLE public.venue_listings DROP CONSTRAINT IF EXISTS venue_listings_location_geo_refresh_state_check;
ALTER TABLE public.venue_listings ADD CONSTRAINT venue_listings_location_geo_refresh_state_check
  CHECK (location_geo_refresh_state IN ('ok', 'failing', 'place_gone', 'expired'));

ALTER TABLE public.brands DROP CONSTRAINT IF EXISTS brands_location_provider_place_id_length;
ALTER TABLE public.brands ADD CONSTRAINT brands_location_provider_place_id_length
  CHECK (location_provider_place_id IS NULL OR char_length(location_provider_place_id) BETWEEN 1 AND 256);
ALTER TABLE public.brands DROP CONSTRAINT IF EXISTS brands_location_geo_refresh_state_check;
ALTER TABLE public.brands ADD CONSTRAINT brands_location_geo_refresh_state_check
  CHECK (location_geo_refresh_state IN ('ok', 'failing', 'place_gone', 'expired'));

-- Preference anchors never expire (A2): 'expired' is not a legal state there.
ALTER TABLE public.preferences DROP CONSTRAINT IF EXISTS preferences_custom_location_place_id_length;
ALTER TABLE public.preferences ADD CONSTRAINT preferences_custom_location_place_id_length
  CHECK (custom_location_place_id IS NULL OR char_length(custom_location_place_id) BETWEEN 1 AND 256);
ALTER TABLE public.preferences DROP CONSTRAINT IF EXISTS preferences_discover_city_place_id_length;
ALTER TABLE public.preferences ADD CONSTRAINT preferences_discover_city_place_id_length
  CHECK (discover_city_place_id IS NULL OR char_length(discover_city_place_id) BETWEEN 1 AND 256);
ALTER TABLE public.preferences DROP CONSTRAINT IF EXISTS preferences_custom_location_geo_refresh_state_check;
ALTER TABLE public.preferences ADD CONSTRAINT preferences_custom_location_geo_refresh_state_check
  CHECK (custom_location_geo_refresh_state IN ('ok', 'failing', 'place_gone'));
ALTER TABLE public.preferences DROP CONSTRAINT IF EXISTS preferences_discover_city_geo_refresh_state_check;
ALTER TABLE public.preferences ADD CONSTRAINT preferences_discover_city_geo_refresh_state_check
  CHECK (discover_city_geo_refresh_state IN ('ok', 'failing', 'place_gone'));

ALTER TABLE public.chat_plans DROP CONSTRAINT IF EXISTS chat_plans_place_geo_refresh_state_check;
ALTER TABLE public.chat_plans ADD CONSTRAINT chat_plans_place_geo_refresh_state_check
  CHECK (place_geo_refresh_state IN ('ok', 'failing', 'place_gone', 'expired'));

-- Partial indexes for the refresh job's selection.
CREATE INDEX IF NOT EXISTS events_location_geo_refreshed_at_idx
  ON public.events (location_geo_refreshed_at) WHERE location_provider_place_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS experience_stops_geo_refreshed_at_idx
  ON public.experience_stops (geo_refreshed_at) WHERE place_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS venue_listings_location_geo_refreshed_at_idx
  ON public.venue_listings (location_geo_refreshed_at) WHERE location_provider_place_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS brands_location_geo_refreshed_at_idx
  ON public.brands (location_geo_refreshed_at) WHERE location_provider_place_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS preferences_custom_location_geo_refreshed_at_idx
  ON public.preferences (custom_location_geo_refreshed_at) WHERE custom_location_place_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS preferences_discover_city_geo_refreshed_at_idx
  ON public.preferences (discover_city_geo_refreshed_at) WHERE discover_city_place_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS chat_plans_place_geo_refreshed_at_idx
  ON public.chat_plans (place_geo_refreshed_at) WHERE provider_place_id IS NOT NULL;

COMMENT ON COLUMN public.events.location_provider_place_id IS
  '#4334 — Google place id of the picked location. Kept indefinitely (Google terms allow place ids); coordinates follow the 30-day refresh (places-coordinate-refresh).';
COMMENT ON COLUMN public.events.location_mapbox_lat IS
  '#4334 D2 — the pre-#4334 pin, written once by scripts/issue-4334/repin-to-google.ts for audit and rollback. Never updated after.';
COMMENT ON COLUMN public.experience_stops.place_id IS
  'The picked place id. A Google place id since #4334; ids starting dXJuOm are retired pre-#4334 ids, replaced by the re-pin.';

-- ── 2. helpers ──────────────────────────────────────────────────────────────
-- A retired pre-#4334 id is base64 of "urn:..." (prefix dXJuOm).
CREATE OR REPLACE FUNCTION public.places_is_google_place_id(p_id text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path = public, pg_temp
AS $function$
  SELECT p_id IS NOT NULL
     AND length(p_id) BETWEEN 10 AND 256
     AND p_id ~ '^[A-Za-z0-9_-]+$'
     AND p_id !~ '^dXJuOm';
$function$;

-- In scope = still needs a pin (spec v2 §6.3): not deleted, not ended or
-- cancelled, and a draft, a date ending within the last day or later, or a
-- scheduled/live offering with no dates.
CREATE OR REPLACE FUNCTION public.places_refresh_event_in_scope(p_event_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path = public, pg_temp
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.events e
     WHERE e.id = p_event_id
       AND e.deleted_at IS NULL
       AND e.status IN ('draft', 'scheduled', 'live')
       AND (
         e.status = 'draft'
         OR EXISTS (SELECT 1 FROM public.event_dates d
                     WHERE d.event_id = e.id AND d.end_at >= now() - interval '1 day')
         OR NOT EXISTS (SELECT 1 FROM public.event_dates d WHERE d.event_id = e.id)
       )
  );
$function$;

CREATE OR REPLACE FUNCTION public.places_refresh_chat_plan_in_scope(
  p_status text, p_scheduled_at timestamptz, p_created_at timestamptz)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path = public, pg_temp
AS $function$
  SELECT p_status <> 'cancelled'
     AND (
       (p_scheduled_at IS NOT NULL AND p_scheduled_at >= now() - interval '1 day')
       OR (p_scheduled_at IS NULL AND p_created_at >= now() - interval '90 days')
     );
$function$;

-- ── 3. stamp triggers ───────────────────────────────────────────────────────
-- Rules for one pin (I-4334-GOOGLE-COORDS-UNDER-30-DAYS):
--   * writer-managed: refreshed_at or refresh_state changed by the writer → keep.
--   * a new Google id → stamp now, state ok, failures 0.
--   * new coordinates with the SAME id → drop the id (the pin no longer comes
--     from that place) and clear the bookkeeping.
--   * no id → no bookkeeping.

CREATE OR REPLACE FUNCTION public.tg_4334_events_place_stamp()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_side text;
  v_new jsonb;
  v_old jsonb;
BEGIN
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

DROP TRIGGER IF EXISTS tg_4334_events_place_stamp ON public.events;
CREATE TRIGGER tg_4334_events_place_stamp
  BEFORE INSERT OR UPDATE ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.tg_4334_events_place_stamp();

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
        AND public.places_is_google_place_id(NEW.place_id) THEN
    NEW.place_id := NULL;
    NEW.geo_refreshed_at := NULL;
    NEW.geo_refresh_state := NULL;
    NEW.geo_refresh_failures := 0;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS tg_4334_experience_stops_place_stamp ON public.experience_stops;
CREATE TRIGGER tg_4334_experience_stops_place_stamp
  BEFORE INSERT OR UPDATE ON public.experience_stops
  FOR EACH ROW EXECUTE FUNCTION public.tg_4334_experience_stops_place_stamp();

-- venue_listings and brands share one body (same column names).
CREATE OR REPLACE FUNCTION public.tg_4334_lat_lng_place_stamp()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = public, pg_temp
AS $function$
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
        AND NEW.location_provider_place_id IS NOT NULL THEN
    NEW.location_provider_place_id := NULL;
    NEW.location_geo_refreshed_at := NULL;
    NEW.location_geo_refresh_state := NULL;
    NEW.location_geo_refresh_failures := 0;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS tg_4334_venue_listings_place_stamp ON public.venue_listings;
CREATE TRIGGER tg_4334_venue_listings_place_stamp
  BEFORE INSERT OR UPDATE ON public.venue_listings
  FOR EACH ROW EXECUTE FUNCTION public.tg_4334_lat_lng_place_stamp();
DROP TRIGGER IF EXISTS tg_4334_brands_place_stamp ON public.brands;
CREATE TRIGGER tg_4334_brands_place_stamp
  BEFORE INSERT OR UPDATE ON public.brands
  FOR EACH ROW EXECUTE FUNCTION public.tg_4334_lat_lng_place_stamp();

CREATE OR REPLACE FUNCTION public.tg_4334_preferences_place_stamp()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = public, pg_temp
AS $function$
BEGIN
  -- custom location
  IF TG_OP = 'INSERT' THEN
    IF public.places_is_google_place_id(NEW.custom_location_place_id)
       AND NEW.custom_location_geo_refreshed_at IS NULL THEN
      NEW.custom_location_geo_refreshed_at := now();
      NEW.custom_location_geo_refresh_state := 'ok';
    END IF;
    IF public.places_is_google_place_id(NEW.discover_city_place_id)
       AND NEW.discover_city_geo_refreshed_at IS NULL THEN
      NEW.discover_city_geo_refreshed_at := now();
      NEW.discover_city_geo_refresh_state := 'ok';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.custom_location_geo_refreshed_at IS NOT DISTINCT FROM OLD.custom_location_geo_refreshed_at
     AND NEW.custom_location_geo_refresh_state IS NOT DISTINCT FROM OLD.custom_location_geo_refresh_state THEN
    IF NEW.custom_location_place_id IS DISTINCT FROM OLD.custom_location_place_id THEN
      IF public.places_is_google_place_id(NEW.custom_location_place_id) THEN
        NEW.custom_location_geo_refreshed_at := now();
        NEW.custom_location_geo_refresh_state := 'ok';
      ELSE
        NEW.custom_location_geo_refreshed_at := NULL;
        NEW.custom_location_geo_refresh_state := NULL;
      END IF;
      NEW.custom_location_geo_refresh_failures := 0;
    ELSIF (NEW.custom_lat IS DISTINCT FROM OLD.custom_lat OR NEW.custom_lng IS DISTINCT FROM OLD.custom_lng)
          AND NEW.custom_location_place_id IS NOT NULL THEN
      NEW.custom_location_place_id := NULL;
      NEW.custom_location_geo_refreshed_at := NULL;
      NEW.custom_location_geo_refresh_state := NULL;
      NEW.custom_location_geo_refresh_failures := 0;
    END IF;
  END IF;

  IF NEW.discover_city_geo_refreshed_at IS NOT DISTINCT FROM OLD.discover_city_geo_refreshed_at
     AND NEW.discover_city_geo_refresh_state IS NOT DISTINCT FROM OLD.discover_city_geo_refresh_state THEN
    IF NEW.discover_city_place_id IS DISTINCT FROM OLD.discover_city_place_id THEN
      IF public.places_is_google_place_id(NEW.discover_city_place_id) THEN
        NEW.discover_city_geo_refreshed_at := now();
        NEW.discover_city_geo_refresh_state := 'ok';
      ELSE
        NEW.discover_city_geo_refreshed_at := NULL;
        NEW.discover_city_geo_refresh_state := NULL;
      END IF;
      NEW.discover_city_geo_refresh_failures := 0;
    ELSIF (NEW.discover_city_lat IS DISTINCT FROM OLD.discover_city_lat
           OR NEW.discover_city_lng IS DISTINCT FROM OLD.discover_city_lng)
          AND NEW.discover_city_place_id IS NOT NULL THEN
      NEW.discover_city_place_id := NULL;
      NEW.discover_city_geo_refreshed_at := NULL;
      NEW.discover_city_geo_refresh_state := NULL;
      NEW.discover_city_geo_refresh_failures := 0;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS tg_4334_preferences_place_stamp ON public.preferences;
CREATE TRIGGER tg_4334_preferences_place_stamp
  BEFORE INSERT OR UPDATE ON public.preferences
  FOR EACH ROW EXECUTE FUNCTION public.tg_4334_preferences_place_stamp();

CREATE OR REPLACE FUNCTION public.tg_4334_chat_plans_place_stamp()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = public, pg_temp
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF public.places_is_google_place_id(NEW.provider_place_id) AND NEW.place_geo_refreshed_at IS NULL THEN
      NEW.place_geo_refreshed_at := now();
      NEW.place_geo_refresh_state := 'ok';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.place_geo_refreshed_at IS DISTINCT FROM OLD.place_geo_refreshed_at
     OR NEW.place_geo_refresh_state IS DISTINCT FROM OLD.place_geo_refresh_state THEN
    RETURN NEW;
  END IF;
  IF NEW.provider_place_id IS DISTINCT FROM OLD.provider_place_id THEN
    IF public.places_is_google_place_id(NEW.provider_place_id) THEN
      NEW.place_geo_refreshed_at := now();
      NEW.place_geo_refresh_state := 'ok';
    ELSE
      NEW.place_geo_refreshed_at := NULL;
      NEW.place_geo_refresh_state := NULL;
    END IF;
    NEW.place_geo_refresh_failures := 0;
  END IF;
  -- A plan's place id and coordinates are one parsed value (chat_plan_parse_where),
  -- so coordinates never change without the id.
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS tg_4334_chat_plans_place_stamp ON public.chat_plans;
CREATE TRIGGER tg_4334_chat_plans_place_stamp
  BEFORE INSERT OR UPDATE ON public.chat_plans
  FOR EACH ROW EXECUTE FUNCTION public.tg_4334_chat_plans_place_stamp();

REVOKE ALL ON FUNCTION public.tg_4334_events_place_stamp() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_4334_experience_stops_place_stamp() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_4334_lat_lng_place_stamp() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_4334_preferences_place_stamp() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_4334_chat_plans_place_stamp() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.places_refresh_event_in_scope(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.places_refresh_chat_plan_in_scope(text, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.places_refresh_event_in_scope(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.places_refresh_chat_plan_in_scope(text, timestamptz, timestamptz) TO service_role;

-- ── 4. Host saves write the picked place id in the same statement as the pin ──
-- (orchestrator review A-2): see the A-2 section at the end of this file. There
-- is no separate attach call; a pin and its id are never written apart.


-- ── 4b. chat plans: providerPlaceId; the retired mapboxId key fails loudly ──
DROP FUNCTION IF EXISTS public.chat_plan_place_identity_key(text, uuid, text, text, text, text);
CREATE FUNCTION public.chat_plan_place_identity_key(
  p_kind text, p_pool_id uuid, p_provider_place_id text, p_name text, p_address text, p_link_url text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path = public, extensions, pg_temp
AS $function$
  SELECT CASE
    WHEN p_kind = 'link' THEN 'link:' || lower(regexp_replace(p_link_url, '/+$', ''))
    WHEN p_pool_id IS NOT NULL THEN 'pool:' || p_pool_id::text
    WHEN p_provider_place_id IS NOT NULL THEN 'google:' || p_provider_place_id
    ELSE 'addr:' || public.mingla_normalize_place_name(p_name) || '|' || lower(btrim(COALESCE(p_address, '')))
  END;
$function$;
REVOKE ALL ON FUNCTION public.chat_plan_place_identity_key(text, uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_plan_place_identity_key(text, uuid, text, text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.chat_plan_parse_where(p_where_kind text, p_place jsonb, p_link_url text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_where text := COALESCE(p_where_kind, 'none');
  v_place public.place_pool%ROWTYPE;
  v_pool_id uuid;
  v_provider_place_id text;
  v_name text;
  v_address text;
  v_lat double precision;
  v_lng double precision;
  v_photo text;
  v_link text;
  v_domain text;
BEGIN
  IF v_where NOT IN ('place', 'address', 'link', 'none') THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_where_kind';
  END IF;
  IF v_where IN ('place', 'address') AND (p_place IS NULL OR jsonb_typeof(p_place) <> 'object') THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_place';
  END IF;

  IF v_where = 'place' AND p_place ? 'poolId' AND p_place ->> 'poolId' IS NOT NULL THEN
    IF (p_place ->> 'poolId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_place.poolId';
    END IF;
    SELECT * INTO v_place FROM public.place_pool
     WHERE id = (p_place ->> 'poolId')::uuid AND is_active IS TRUE AND is_servable IS TRUE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_place.poolId';
    END IF;
    v_pool_id := v_place.id;
    v_name := left(btrim(v_place.name), 120);
    v_address := left(COALESCE(NULLIF(btrim(v_place.address), ''), NULLIF(btrim(v_place.city), '')), 240);
    v_lat := v_place.lat;
    v_lng := v_place.lng;
    v_photo := v_place.stored_photo_urls[1];
    IF v_photo IS NOT NULL AND (v_photo !~ '^https://' OR char_length(v_photo) > 1024) THEN
      v_photo := NULL;
    END IF;
  ELSIF v_where = 'place' THEN
    -- #4334: Google-era ids are retired; a client still sending one fails loudly.
    IF p_place ? 'mapboxId' THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_place.mapboxId_retired';
    END IF;
    v_provider_place_id := NULLIF(btrim(COALESCE(p_place ->> 'providerPlaceId', '')), '');
    v_name := NULLIF(btrim(COALESCE(p_place ->> 'name', '')), '');
    v_address := NULLIF(btrim(COALESCE(p_place ->> 'address', '')), '');
    IF v_provider_place_id IS NULL OR char_length(v_provider_place_id) > 256 THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_place.providerPlaceId';
    END IF;
    IF v_name IS NULL OR char_length(v_name) > 120 THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_place.name';
    END IF;
    IF char_length(v_address) > 240 THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_place.address';
    END IF;
    IF jsonb_typeof(p_place -> 'lat') <> 'number' OR jsonb_typeof(p_place -> 'lng') <> 'number' THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_place.lat';
    END IF;
    v_lat := (p_place ->> 'lat')::double precision;
    v_lng := (p_place ->> 'lng')::double precision;
    IF v_lat NOT BETWEEN -90 AND 90 OR v_lng NOT BETWEEN -180 AND 180 THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_place.lat';
    END IF;
  ELSIF v_where = 'address' THEN
    v_name := NULLIF(btrim(COALESCE(p_place ->> 'name', '')), '');
    v_address := NULLIF(btrim(COALESCE(p_place ->> 'address', '')), '');
    IF v_name IS NULL OR char_length(v_name) > 120 THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_place.name';
    END IF;
    IF char_length(v_address) > 240 THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_place.address';
    END IF;
    IF jsonb_typeof(p_place -> 'lat') = 'number' AND jsonb_typeof(p_place -> 'lng') = 'number' THEN
      v_lat := (p_place ->> 'lat')::double precision;
      v_lng := (p_place ->> 'lng')::double precision;
      IF v_lat NOT BETWEEN -90 AND 90 OR v_lng NOT BETWEEN -180 AND 180 THEN
        RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_place.lat';
      END IF;
    END IF;
  END IF;

  -- The link: required for a link plan; optional on a searched (Google) or typed place;
  -- refused on a Mingla pool place (the Mingla card has the venue's links).
  IF v_where = 'link' THEN
    v_link := btrim(COALESCE(p_link_url, ''));
  ELSIF v_where IN ('place', 'address') THEN
    v_link := NULLIF(btrim(COALESCE(p_link_url, '')), '');
    IF v_link IS NOT NULL AND v_pool_id IS NOT NULL THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_link_url';
    END IF;
  END IF;
  IF v_link IS NOT NULL THEN
    IF char_length(v_link) > 2048 OR v_link !~* '^https?://[^\s/]+\.[^\s/]+' THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_link_url';
    END IF;
    v_domain := lower(substring(v_link from '^[A-Za-z]+://(?:[^/?#@]*@)?([^/?#:]+)'));
    v_domain := regexp_replace(COALESCE(v_domain, ''), '^www\.', '');
    IF v_domain = '' OR position('.' in v_domain) = 0 THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_link_url';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'kind', v_where,
    'poolId', v_pool_id,
    'providerPlaceId', v_provider_place_id,
    'name', v_name,
    'address', v_address,
    'lat', v_lat,
    'lng', v_lng,
    'photoUrl', v_photo,
    'linkUrl', v_link,
    'linkDomain', v_domain,
    'identityKey', CASE WHEN v_where = 'none' THEN NULL
                        ELSE public.chat_plan_place_identity_key(v_where, v_pool_id, v_provider_place_id, v_name, v_address, v_link) END
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.chat_plan_parse_where(text, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_plan_parse_where(text, jsonb, text) TO service_role;

CREATE OR REPLACE FUNCTION public.chat_plan_seed_original_place(p_plan public.chat_plans)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_option_id uuid;
BEGIN
  IF p_plan.where_kind = 'none'
     OR EXISTS (SELECT 1 FROM public.chat_plan_place_options WHERE plan_id = p_plan.id) THEN
    RETURN;
  END IF;

  INSERT INTO public.chat_plan_place_options (
    plan_id, kind, place_pool_id, provider_place_id, place_name, place_address, place_lat, place_lng,
    place_photo_url, link_url, link_domain, identity_key, is_original, added_by, created_at
  ) VALUES (
    p_plan.id, p_plan.where_kind, p_plan.place_pool_id, p_plan.provider_place_id, p_plan.place_name,
    p_plan.place_address, p_plan.place_lat, p_plan.place_lng,
    CASE WHEN p_plan.place_pool_id IS NOT NULL THEN p_plan.place_photo_url END,
    p_plan.link_url, p_plan.link_domain,
    public.chat_plan_place_identity_key(p_plan.where_kind, p_plan.place_pool_id, p_plan.provider_place_id,
                                        p_plan.place_name, p_plan.place_address, p_plan.link_url),
    true, p_plan.created_by, p_plan.created_at
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_option_id;

  IF v_option_id IS NOT NULL AND p_plan.created_by IS NOT NULL
     AND public.is_conversation_participant(p_plan.conversation_id, p_plan.created_by) THEN
    INSERT INTO public.chat_plan_place_votes (option_id, plan_id, user_id)
    VALUES (v_option_id, p_plan.id, p_plan.created_by)
    ON CONFLICT DO NOTHING;
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.chat_plan_seed_original_place(public.chat_plans) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_plan_seed_original_place(public.chat_plans) TO service_role;

CREATE OR REPLACE FUNCTION public.plan_create(
  p_conversation_id uuid,
  p_client_id uuid,
  p_title text,
  p_where_kind text,
  p_place jsonb,
  p_link_url text,
  p_when_mode text,
  p_scheduled_at timestamptz,
  p_options timestamptz[],
  p_open_times boolean,
  p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_existing public.chat_plans%ROWTYPE;
  v_parsed jsonb;
  v_where text;
  v_when text := p_when_mode;
  v_title text := NULLIF(btrim(COALESCE(p_title, '')), '');
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_open boolean := COALESCE(p_open_times, true);
  v_name text;
  v_domain text;
  v_options timestamptz[] := COALESCE(p_options, ARRAY[]::timestamptz[]);
  v_opt timestamptz;
  v_status text;
  v_plan_id uuid;
  v_message_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  PERFORM public.chat_plan_require_member(p_conversation_id, v_uid);

  -- Idempotency.
  IF p_client_id IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.chat_plans
     WHERE created_by = v_uid AND client_id = p_client_id;
    IF FOUND THEN
      RETURN jsonb_build_object('planId', v_existing.id, 'messageId', v_existing.message_id, 'created', false);
    END IF;
  END IF;

  -- Rate.
  IF (SELECT count(*) FROM public.chat_plans
       WHERE created_by = v_uid AND source = 'chat' AND created_at > now() - interval '24 hours') >= 30 THEN
    RAISE EXCEPTION 'conflict_rate_limited' USING ERRCODE = 'PT409';
  END IF;

  -- Where.
  v_parsed := public.chat_plan_parse_where(COALESCE(p_where_kind, 'none'), p_place, p_link_url);
  v_where := v_parsed ->> 'kind';
  v_name := v_parsed ->> 'name';
  v_domain := v_parsed ->> 'linkDomain';

  -- Title.
  IF v_title IS NOT NULL AND char_length(v_title) > 80 THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_title';
  END IF;
  v_title := left(btrim(COALESCE(v_title, v_name, v_domain, 'New plan')), 80);

  IF v_note IS NOT NULL AND char_length(v_note) > 280 THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_note';
  END IF;

  -- When.
  IF v_when IS NULL OR v_when NOT IN ('set', 'poll', 'none') THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_when_mode';
  END IF;
  IF v_when = 'set' THEN
    PERFORM public.chat_plan_check_time(p_scheduled_at, 'p_scheduled_at');
    v_status := 'scheduled';
  ELSIF v_when = 'poll' THEN
    IF cardinality(v_options) > 5
       OR (SELECT count(DISTINCT x) FROM unnest(v_options) x) <> cardinality(v_options)
       OR (NOT v_open AND cardinality(v_options) < 2) THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_options';
    END IF;
    FOREACH v_opt IN ARRAY v_options LOOP
      PERFORM public.chat_plan_check_time(v_opt, 'p_options');
    END LOOP;
    v_status := 'deciding';
  ELSE
    v_status := 'deciding';
  END IF;

  INSERT INTO public.chat_plans (
    conversation_id, source, created_by, client_id, title, where_kind,
    place_pool_id, provider_place_id, place_name, place_address, place_lat, place_lng, place_photo_url,
    link_url, link_domain, when_mode, open_times, status, scheduled_at, duration_minutes,
    locked_at, locked_by, note
  ) VALUES (
    p_conversation_id, 'chat', v_uid, p_client_id, v_title, v_where,
    (v_parsed ->> 'poolId')::uuid, v_parsed ->> 'providerPlaceId', v_name, v_parsed ->> 'address',
    (v_parsed ->> 'lat')::double precision, (v_parsed ->> 'lng')::double precision, v_parsed ->> 'photoUrl',
    v_parsed ->> 'linkUrl', NULLIF(v_domain, ''), v_when, v_open, v_status,
    CASE WHEN v_when = 'set' THEN p_scheduled_at END,
    CASE WHEN v_when = 'set' THEN 120 END,
    CASE WHEN v_when = 'set' THEN now() END,
    CASE WHEN v_when = 'set' THEN v_uid END,
    v_note
  )
  RETURNING id INTO v_plan_id;

  IF v_when = 'poll' THEN
    INSERT INTO public.chat_plan_time_options (plan_id, starts_at, added_by)
    SELECT v_plan_id, x, v_uid FROM unnest(v_options) x;
  END IF;

  INSERT INTO public.chat_plan_rsvps (plan_id, user_id, status) VALUES (v_plan_id, v_uid, 'going');

  PERFORM set_config('issue_4261.plan_write', 'on', true);
  INSERT INTO public.messages (conversation_id, sender_id, content, message_type, card_payload, plan_id)
  VALUES (
    p_conversation_id, v_uid,
    public.issue_4114_first_name(v_uid) || ' added a plan: ' || v_title,
    'plan', jsonb_build_object('kind', 'plan', 'planId', v_plan_id), v_plan_id
  )
  RETURNING id INTO v_message_id;
  PERFORM set_config('issue_4261.plan_write', 'off', true);

  UPDATE public.chat_plans SET message_id = v_message_id WHERE id = v_plan_id;

  IF v_when = 'set' THEN
    PERFORM public.chat_plan_sync_calendar(v_plan_id);
  END IF;

  RETURN jsonb_build_object('planId', v_plan_id, 'messageId', v_message_id, 'created', true);
END;
$function$;
REVOKE ALL ON FUNCTION public.plan_create(uuid, uuid, text, text, jsonb, text, text, timestamptz, timestamptz[], boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.plan_create(uuid, uuid, text, text, jsonb, text, text, timestamptz, timestamptz[], boolean, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.plan_add_place(
  p_plan_id uuid, p_where_kind text, p_place jsonb, p_link_url text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_plan public.chat_plans%ROWTYPE;
  v_parsed jsonb;
  v_option_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  SELECT * INTO v_plan FROM public.chat_plans WHERE id = p_plan_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.chat_plan_require_member(v_plan.conversation_id, v_uid);

  IF v_plan.source = 'deck' THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;
  IF public.chat_plan_effective_status(v_plan) <> 'deciding' THEN
    RAISE EXCEPTION 'conflict_plan_not_deciding' USING ERRCODE = 'PT409';
  END IF;
  IF NOT v_plan.open_times AND v_plan.created_by IS DISTINCT FROM v_uid
     AND NOT public.chat_plan_can_lock(v_plan, v_uid) THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;
  IF p_where_kind IS NULL OR p_where_kind NOT IN ('place', 'address') THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_where_kind';
  END IF;
  v_parsed := public.chat_plan_parse_where(p_where_kind, p_place, p_link_url);

  PERFORM public.chat_plan_seed_original_place(v_plan);

  SELECT id INTO v_option_id FROM public.chat_plan_place_options
   WHERE plan_id = v_plan.id AND identity_key = v_parsed ->> 'identityKey';
  IF v_option_id IS NOT NULL THEN
    INSERT INTO public.chat_plan_place_votes (option_id, plan_id, user_id)
    VALUES (v_option_id, v_plan.id, v_uid)
    ON CONFLICT (option_id, user_id) DO NOTHING;
    UPDATE public.chat_plans SET updated_at = now() WHERE id = v_plan.id;
    RETURN jsonb_build_object('optionId', v_option_id, 'existed', true);
  END IF;

  IF (SELECT count(*) FROM public.chat_plan_place_options WHERE plan_id = v_plan.id) >= 6 THEN
    RAISE EXCEPTION 'conflict_too_many_places' USING ERRCODE = 'PT409';
  END IF;

  INSERT INTO public.chat_plan_place_options (
    plan_id, kind, place_pool_id, provider_place_id, place_name, place_address, place_lat, place_lng,
    place_photo_url, link_url, link_domain, identity_key, is_original, added_by
  ) VALUES (
    v_plan.id, v_parsed ->> 'kind', (v_parsed ->> 'poolId')::uuid, v_parsed ->> 'providerPlaceId',
    v_parsed ->> 'name', v_parsed ->> 'address',
    (v_parsed ->> 'lat')::double precision, (v_parsed ->> 'lng')::double precision,
    v_parsed ->> 'photoUrl', v_parsed ->> 'linkUrl', v_parsed ->> 'linkDomain',
    v_parsed ->> 'identityKey', false, v_uid
  )
  RETURNING id INTO v_option_id;
  INSERT INTO public.chat_plan_place_votes (option_id, plan_id, user_id)
  VALUES (v_option_id, v_plan.id, v_uid);

  UPDATE public.chat_plans SET updated_at = now() WHERE id = v_plan.id;

  PERFORM public.chat_plan_post_event(
    v_plan.conversation_id, v_plan.id, 'place_added', v_uid,
    jsonb_build_object('placeName', v_parsed ->> 'name', 'optionId', v_option_id),
    public.issue_4114_first_name(v_uid) || ' suggested ' || (v_parsed ->> 'name') || ' for ' || v_plan.title
  );

  RETURN jsonb_build_object('optionId', v_option_id, 'existed', false);
END;
$function$;
REVOKE ALL ON FUNCTION public.plan_add_place(uuid, text, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.plan_add_place(uuid, text, jsonb, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.plan_lock(
  p_plan_id uuid,
  p_option_id uuid DEFAULT NULL,
  p_scheduled_at timestamptz DEFAULT NULL,
  p_duration_minutes int DEFAULT 120,
  p_place_option_id uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_plan public.chat_plans%ROWTYPE;
  v_place public.chat_plan_place_options%ROWTYPE;
  v_place_id uuid;
  v_place_count int;
  v_extra jsonb;
  v_at timestamptz;
  v_duration int := COALESCE(p_duration_minutes, 120);
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  SELECT * INTO v_plan FROM public.chat_plans WHERE id = p_plan_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.chat_plan_require_member(v_plan.conversation_id, v_uid);
  IF NOT public.chat_plan_can_lock(v_plan, v_uid) THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;

  IF (p_option_id IS NULL) = (p_scheduled_at IS NULL) THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_option_id';
  END IF;
  IF p_option_id IS NOT NULL THEN
    SELECT starts_at INTO v_at FROM public.chat_plan_time_options
     WHERE id = p_option_id AND plan_id = v_plan.id;
    IF v_at IS NULL THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_option_id';
    END IF;
  ELSE
    v_at := p_scheduled_at;
  END IF;
  PERFORM public.chat_plan_check_time(v_at, 'p_scheduled_at');
  IF v_duration < 15 OR v_duration > 1440 THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_duration_minutes';
  END IF;

  IF v_plan.source = 'chat' THEN
    IF v_plan.status <> 'deciding' THEN
      RAISE EXCEPTION 'conflict_plan_not_deciding' USING ERRCODE = 'PT409';
    END IF;

    -- The winning place: the one named, else the leader.
    IF p_place_option_id IS NOT NULL THEN
      SELECT * INTO v_place FROM public.chat_plan_place_options
       WHERE id = p_place_option_id AND plan_id = v_plan.id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_place_option_id';
      END IF;
      v_place_id := v_place.id;
    ELSE
      v_place_id := public.chat_plan_place_leader(v_plan.id);
      IF v_place_id IS NOT NULL THEN
        SELECT * INTO v_place FROM public.chat_plan_place_options WHERE id = v_place_id;
      END IF;
    END IF;
    SELECT count(*) INTO v_place_count FROM public.chat_plan_place_options WHERE plan_id = v_plan.id;

    UPDATE public.chat_plans
       SET status = 'scheduled', scheduled_at = v_at, duration_minutes = v_duration,
           locked_at = now(), locked_by = v_uid, updated_at = now(),
           where_kind = CASE WHEN v_place_id IS NULL THEN where_kind ELSE v_place.kind END,
           place_pool_id = CASE WHEN v_place_id IS NULL THEN place_pool_id ELSE v_place.place_pool_id END,
           provider_place_id = CASE WHEN v_place_id IS NULL THEN provider_place_id ELSE v_place.provider_place_id END,
           place_name = CASE WHEN v_place_id IS NULL THEN place_name ELSE v_place.place_name END,
           place_address = CASE WHEN v_place_id IS NULL THEN place_address ELSE v_place.place_address END,
           place_lat = CASE WHEN v_place_id IS NULL THEN place_lat ELSE v_place.place_lat END,
           place_lng = CASE WHEN v_place_id IS NULL THEN place_lng ELSE v_place.place_lng END,
           place_photo_url = CASE WHEN v_place_id IS NULL THEN place_photo_url ELSE v_place.place_photo_url END,
           link_url = CASE WHEN v_place_id IS NULL THEN link_url ELSE v_place.link_url END,
           link_domain = CASE WHEN v_place_id IS NULL THEN link_domain ELSE v_place.link_domain END
     WHERE id = v_plan.id;
    PERFORM public.chat_plan_sync_calendar(v_plan.id);

    v_extra := jsonb_build_object('scheduledAt', v_at);
    IF v_place_id IS NOT NULL AND v_place_count >= 2 THEN
      v_extra := v_extra || jsonb_build_object(
        'placeName', COALESCE(v_place.place_name, v_place.link_domain), 'placeVoted', true);
    END IF;
    PERFORM public.chat_plan_post_event(
      v_plan.conversation_id, v_plan.id, 'locked', v_uid, v_extra,
      public.issue_4114_first_name(v_uid) || ' locked in ' || v_plan.title
    );
  ELSE
    IF p_place_option_id IS NOT NULL THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_place_option_id';
    END IF;
    IF public.chat_plan_effective_status(v_plan) <> 'deciding' THEN
      RAISE EXCEPTION 'conflict_plan_not_deciding' USING ERRCODE = 'PT409';
    END IF;
    PERFORM public.rpc_admin_lock_and_schedule_card(v_plan.session_id, v_plan.saved_card_id, v_at, v_duration);
    UPDATE public.chat_plans SET updated_at = now() WHERE id = v_plan.id;
  END IF;

  RETURN jsonb_build_object('planId', v_plan.id, 'scheduledAt', v_at);
END;
$function$;
REVOKE ALL ON FUNCTION public.plan_lock(uuid, uuid, timestamptz, int, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.plan_lock(uuid, uuid, timestamptz, int, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.chat_plans_for_conversation(p_conversation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_from timestamptz;
  v_plans jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  PERFORM public.chat_plan_require_member(p_conversation_id, v_uid);

  SELECT cp.history_visible_from INTO v_from
    FROM public.conversation_participants cp
   WHERE cp.conversation_id = p_conversation_id AND cp.user_id = v_uid;

  WITH base AS (
    SELECT p.*,
           bsc.card_data AS deck_card_data,
           bsc.locked_at AS deck_locked_at,
           public.chat_plan_effective_status(p) AS eff_status,
           CASE WHEN p.source = 'deck' THEN (
             SELECT min(ce.scheduled_at) FROM public.calendar_entries ce WHERE ce.board_card_id = p.saved_card_id
           ) ELSE p.scheduled_at END AS eff_scheduled_at,
           public.chat_plan_can_lock(p, v_uid) AS can_lock,
           (SELECT count(*) FROM public.chat_plan_time_options o WHERE o.plan_id = p.id) AS option_count,
           (SELECT count(*) FROM public.chat_plan_place_options o WHERE o.plan_id = p.id) AS place_option_count
      FROM public.chat_plans p
      LEFT JOIN public.board_saved_cards bsc ON bsc.id = p.saved_card_id
     WHERE p.conversation_id = p_conversation_id
       AND p.status <> 'cancelled'
  ), picked AS (
    SELECT * FROM base b
     WHERE b.eff_status = 'deciding'
        OR (b.eff_status = 'scheduled'
            AND COALESCE(b.eff_scheduled_at, b.deck_locked_at, b.locked_at, b.created_at) >= now() - interval '180 days')
     ORDER BY b.created_at DESC
     LIMIT 100
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', b.id,
      'source', b.source,
      'sessionId', b.session_id,
      'savedCardId', b.saved_card_id,
      'messageId', b.message_id,
      'messageVisible', EXISTS (
        SELECT 1 FROM public.messages m
         WHERE m.id = b.message_id AND m.deleted_at IS NULL
           AND (v_from IS NULL OR m.created_at >= v_from)
      ),
      'createdBy', b.created_by,
      'createdByName', CASE WHEN b.created_by IS NULL THEN NULL ELSE public.issue_4114_first_name(b.created_by) END,
      'title', b.title,
      'whereKind', b.where_kind,
      'place', CASE WHEN b.where_kind IN ('place', 'address') THEN jsonb_build_object(
        'poolId', b.place_pool_id, 'providerPlaceId', b.provider_place_id, 'name', b.place_name,
        'address', b.place_address, 'lat', b.place_lat, 'lng', b.place_lng, 'photoUrl', b.place_photo_url
      ) END,
      'link', public.chat_plan_link_json(b.link_url, b.link_domain),
      'places', CASE WHEN b.source = 'deck' THEN '[]'::jsonb ELSE COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', o.id, 'kind', o.kind, 'poolId', o.place_pool_id, 'providerPlaceId', o.provider_place_id,
          'name', o.place_name, 'address', o.place_address, 'lat', o.place_lat, 'lng', o.place_lng,
          'photoUrl', o.place_photo_url,
          'link', public.chat_plan_link_json(o.link_url, o.link_domain),
          'addedBy', o.added_by, 'isOriginal', o.is_original,
          'voterIds', COALESCE((
            SELECT jsonb_agg(v.user_id ORDER BY v.created_at, v.user_id)
              FROM public.chat_plan_place_votes v WHERE v.option_id = o.id
          ), '[]'::jsonb)
        ) ORDER BY o.is_original DESC, o.created_at, o.id)
        FROM public.chat_plan_place_options o WHERE o.plan_id = b.id
      ), '[]'::jsonb) END,
      'cardData', CASE WHEN b.source = 'deck' THEN b.deck_card_data END,
      'whenMode', b.when_mode,
      'openTimes', b.open_times,
      'status', b.eff_status,
      'scheduledAt', b.eff_scheduled_at,
      'durationMinutes', CASE WHEN b.source = 'deck' THEN (
        SELECT min(ce.duration_minutes) FROM public.calendar_entries ce WHERE ce.board_card_id = b.saved_card_id
      ) ELSE b.duration_minutes END,
      'lockedAt', CASE WHEN b.source = 'deck' THEN b.deck_locked_at ELSE b.locked_at END,
      'lockedBy', b.locked_by,
      'note', b.note,
      'createdAt', b.created_at,
      'updatedAt', b.updated_at,
      'options', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', o.id, 'startsAt', o.starts_at, 'addedBy', o.added_by,
          'voterIds', COALESCE((
            SELECT jsonb_agg(v.user_id ORDER BY v.created_at, v.user_id)
              FROM public.chat_plan_time_votes v WHERE v.option_id = o.id
          ), '[]'::jsonb)
        ) ORDER BY o.starts_at)
        FROM public.chat_plan_time_options o WHERE o.plan_id = b.id
      ), '[]'::jsonb),
      'rsvps', CASE WHEN b.source = 'chat' THEN jsonb_build_object(
        'going', COALESCE((SELECT jsonb_agg(r.user_id ORDER BY r.updated_at) FROM public.chat_plan_rsvps r WHERE r.plan_id = b.id AND r.status = 'going'), '[]'::jsonb),
        'maybe', COALESCE((SELECT jsonb_agg(r.user_id ORDER BY r.updated_at) FROM public.chat_plan_rsvps r WHERE r.plan_id = b.id AND r.status = 'maybe'), '[]'::jsonb),
        'cant', COALESCE((SELECT jsonb_agg(r.user_id ORDER BY r.updated_at) FROM public.chat_plan_rsvps r WHERE r.plan_id = b.id AND r.status = 'cant'), '[]'::jsonb)
      ) ELSE jsonb_build_object(
        'going', COALESCE((SELECT jsonb_agg(r.user_id ORDER BY r.updated_at) FROM public.board_card_rsvps r WHERE r.session_id = b.session_id AND r.saved_card_id = b.saved_card_id AND r.rsvp_status = 'attending'), '[]'::jsonb),
        'maybe', COALESCE((SELECT jsonb_agg(r.user_id ORDER BY r.updated_at) FROM public.board_card_rsvps r WHERE r.session_id = b.session_id AND r.saved_card_id = b.saved_card_id AND r.rsvp_status = 'maybe'), '[]'::jsonb),
        'cant', COALESCE((SELECT jsonb_agg(r.user_id ORDER BY r.updated_at) FROM public.board_card_rsvps r WHERE r.session_id = b.session_id AND r.saved_card_id = b.saved_card_id AND r.rsvp_status = 'not_attending'), '[]'::jsonb)
      ) END,
      'reactions', CASE WHEN b.source = 'chat' THEN jsonb_build_object(
        'up', COALESCE((SELECT jsonb_agg(x.user_id ORDER BY x.updated_at) FROM public.chat_plan_reactions x WHERE x.plan_id = b.id AND x.kind = 'up'), '[]'::jsonb),
        'down', COALESCE((SELECT jsonb_agg(x.user_id ORDER BY x.updated_at) FROM public.chat_plan_reactions x WHERE x.plan_id = b.id AND x.kind = 'down'), '[]'::jsonb)
      ) ELSE jsonb_build_object(
        'up', COALESCE((SELECT jsonb_agg(x.user_id ORDER BY x.updated_at) FROM public.board_votes x WHERE x.session_id = b.session_id AND x.saved_card_id = b.saved_card_id AND x.vote_type = 'up'), '[]'::jsonb),
        'down', COALESCE((SELECT jsonb_agg(x.user_id ORDER BY x.updated_at) FROM public.board_votes x WHERE x.session_id = b.session_id AND x.saved_card_id = b.saved_card_id AND x.vote_type = 'down'), '[]'::jsonb)
      ) END,
      'commentCount', (
        SELECT count(*) FROM public.messages m
         WHERE m.plan_id = b.id AND m.message_type NOT IN ('plan', 'system') AND m.deleted_at IS NULL
           AND (v_from IS NULL OR m.created_at >= v_from)
      ),
      'canLock', b.eff_status = 'deciding' AND b.can_lock,
      'canEdit', b.source = 'chat' AND b.created_by IS NOT DISTINCT FROM v_uid AND b.status IN ('deciding', 'scheduled'),
      'canCancel', b.source = 'chat' AND b.can_lock,
      'canAddTime', b.eff_status = 'deciding' AND (b.open_times OR b.can_lock OR b.created_by IS NOT DISTINCT FROM v_uid)
                    AND b.option_count < 8,
      'canAddPlace', b.source = 'chat' AND b.eff_status = 'deciding'
                     AND (b.open_times OR b.can_lock OR b.created_by IS NOT DISTINCT FROM v_uid)
                     AND b.place_option_count < 6
    ) ORDER BY b.created_at DESC
  ), '[]'::jsonb) INTO v_plans
  FROM picked b;

  RETURN jsonb_build_object(
    'viewerId', v_uid,
    'memberCount', (SELECT count(*) FROM public.conversation_participants WHERE conversation_id = p_conversation_id),
    'historyVisibleFrom', v_from,
    'plans', v_plans
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.chat_plans_for_conversation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_plans_for_conversation(uuid) TO authenticated;
-- ── 5. coordinate refresh (Branch B) ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.places_json_number(p_value jsonb)
 RETURNS double precision
 LANGUAGE sql
 IMMUTABLE
 SET search_path = public, pg_temp
AS $function$
  SELECT CASE WHEN jsonb_typeof(p_value) = 'number' THEN (p_value #>> '{}')::double precision END;
$function$;

CREATE OR REPLACE FUNCTION public.places_json_timestamptz(p_value jsonb)
 RETURNS timestamptz
 LANGUAGE plpgsql
 STABLE
 SET search_path = public, pg_temp
AS $function$
BEGIN
  IF jsonb_typeof(p_value) <> 'string' THEN RETURN NULL; END IF;
  RETURN (p_value #>> '{}')::timestamptz;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$function$;

-- Every pin with a Google id, its scope and its bookkeeping (one row per pin).
CREATE OR REPLACE FUNCTION public.places_refresh_pins()
 RETURNS TABLE (
   pin_kind text, row_id uuid, place_id text, lat double precision, lng double precision,
   refreshed_at timestamptz, refresh_state text, in_scope boolean)
 LANGUAGE sql
 STABLE
 SET search_path = public, pg_temp
AS $function$
  SELECT 'event_location', e.id, e.location_provider_place_id,
         e.location_geo[1], e.location_geo[0], e.location_geo_refreshed_at,
         e.location_geo_refresh_state, public.places_refresh_event_in_scope(e.id)
    FROM public.events e
   WHERE public.places_is_google_place_id(e.location_provider_place_id)
  UNION ALL
  SELECT 'trip_' || s.side, e.id, e.theme -> 'business_trip' ->> (s.side || 'PlaceId'),
         public.places_json_number(e.theme -> 'business_trip' -> (s.side || 'Lat')),
         public.places_json_number(e.theme -> 'business_trip' -> (s.side || 'Lng')),
         public.places_json_timestamptz(e.theme -> 'business_trip' -> (s.side || 'GeoRefreshedAt')),
         e.theme -> 'business_trip' ->> (s.side || 'GeoRefreshState'),
         public.places_refresh_event_in_scope(e.id)
    FROM public.events e
   CROSS JOIN (VALUES ('departure'), ('destination')) AS s(side)
   WHERE jsonb_typeof(e.theme -> 'business_trip') = 'object'
     AND public.places_is_google_place_id(e.theme -> 'business_trip' ->> (s.side || 'PlaceId'))
  UNION ALL
  SELECT 'experience_stop', st.id, st.place_id, st.lat, st.lng, st.geo_refreshed_at,
         st.geo_refresh_state, public.places_refresh_event_in_scope(st.event_id)
    FROM public.experience_stops st
   WHERE public.places_is_google_place_id(st.place_id)
  UNION ALL
  SELECT 'venue_listing', v.id, v.location_provider_place_id, v.lat, v.lng,
         v.location_geo_refreshed_at, v.location_geo_refresh_state, true
    FROM public.venue_listings v
   WHERE public.places_is_google_place_id(v.location_provider_place_id)
  UNION ALL
  SELECT 'brand', b.id, b.location_provider_place_id, b.lat, b.lng,
         b.location_geo_refreshed_at, b.location_geo_refresh_state, b.deleted_at IS NULL
    FROM public.brands b
   WHERE public.places_is_google_place_id(b.location_provider_place_id)
  UNION ALL
  SELECT 'pref_custom', p.profile_id, p.custom_location_place_id, p.custom_lat, p.custom_lng,
         p.custom_location_geo_refreshed_at, p.custom_location_geo_refresh_state, true
    FROM public.preferences p
   WHERE public.places_is_google_place_id(p.custom_location_place_id)
  UNION ALL
  SELECT 'pref_discover', p.profile_id, p.discover_city_place_id,
         p.discover_city_lat::double precision, p.discover_city_lng::double precision,
         p.discover_city_geo_refreshed_at, p.discover_city_geo_refresh_state, true
    FROM public.preferences p
   WHERE public.places_is_google_place_id(p.discover_city_place_id)
  UNION ALL
  SELECT 'chat_plan', c.id, c.provider_place_id, c.place_lat, c.place_lng,
         c.place_geo_refreshed_at, c.place_geo_refresh_state,
         public.places_refresh_chat_plan_in_scope(c.status, c.scheduled_at, c.created_at)
    FROM public.chat_plans c
   WHERE public.places_is_google_place_id(c.provider_place_id);
$function$;

-- The run's work list: in-scope pins older than p_stale (20 days leaves a
-- 10-day margin under Google's 30-day limit), oldest first, at most p_limit.
CREATE OR REPLACE FUNCTION public.places_refresh_due_pins(
  p_limit integer DEFAULT 500, p_stale interval DEFAULT interval '20 days')
 RETURNS TABLE (
   pin_kind text, row_id uuid, place_id text, lat double precision, lng double precision,
   refreshed_at timestamptz, refresh_state text)
 LANGUAGE sql
 STABLE
 SET search_path = public, pg_temp
AS $function$
  SELECT p.pin_kind, p.row_id, p.place_id, p.lat, p.lng, p.refreshed_at, p.refresh_state
    FROM public.places_refresh_pins() p
   WHERE p.in_scope
     AND (p.refreshed_at IS NULL OR p.refreshed_at < now() - p_stale)
   ORDER BY p.refreshed_at NULLS FIRST, p.pin_kind, p.row_id
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 500), 0), 500);
$function$;

CREATE OR REPLACE FUNCTION public.places_trip_patch(p_theme jsonb, p_side text, p_patch jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path = public, pg_temp
AS $function$
  SELECT jsonb_set(p_theme, '{business_trip}', (p_theme -> 'business_trip') || p_patch);
$function$;

-- Record one refresh outcome. Guarded by the place id the job READ, so a host
-- who re-picked in between wins (spec v2 §6.5). Text columns are never read
-- or written (D9). The stamp is clock_timestamp(), not now(): the stamp
-- triggers trust a write only when the stamp CHANGES, and now() would repeat
-- the insert-time stamp inside one transaction. p_result: 'ok' (p_lat/p_lng set only when the pin moved,
-- p_new_place_id only when Google re-ided the place), 'failing', 'place_gone'.
CREATE OR REPLACE FUNCTION public.places_refresh_record(
  p_kind text, p_row_id uuid, p_expected_place_id text, p_result text,
  p_new_place_id text DEFAULT NULL, p_lat double precision DEFAULT NULL,
  p_lng double precision DEFAULT NULL)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_ok boolean := p_result = 'ok';
  v_id text := COALESCE(NULLIF(p_new_place_id, ''), p_expected_place_id);
  v_move boolean := p_lat IS NOT NULL AND p_lng IS NOT NULL;
  v_side text;
  v_rows integer := 0;
BEGIN
  IF p_result NOT IN ('ok', 'failing', 'place_gone') THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_result';
  END IF;
  IF v_move AND (p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180
                 OR (p_lat = 0 AND p_lng = 0)) THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_lat';
  END IF;
  IF v_ok AND NOT public.places_is_google_place_id(v_id) THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_new_place_id';
  END IF;

  IF p_kind = 'event_location' THEN
    UPDATE public.events SET
      location_provider_place_id = CASE WHEN v_ok THEN v_id ELSE location_provider_place_id END,
      location_geo = CASE WHEN v_ok AND v_move THEN point(p_lng, p_lat) ELSE location_geo END,
      location_geo_refreshed_at = CASE WHEN v_ok THEN clock_timestamp() ELSE location_geo_refreshed_at END,
      location_geo_refresh_state = p_result,
      location_geo_refresh_failures = CASE WHEN v_ok THEN 0
        ELSE LEAST(location_geo_refresh_failures + 1, 32767) END
     WHERE id = p_row_id AND location_provider_place_id = p_expected_place_id;
  ELSIF p_kind IN ('trip_departure', 'trip_destination') THEN
    v_side := substring(p_kind from 6);
    UPDATE public.events SET theme = public.places_trip_patch(theme, v_side,
      CASE WHEN v_ok THEN
        jsonb_build_object(
          v_side || 'PlaceId', v_id,
          v_side || 'GeoRefreshedAt', to_jsonb(clock_timestamp()),
          v_side || 'GeoRefreshState', 'ok',
          v_side || 'GeoRefreshFailures', 0)
        || CASE WHEN v_move THEN jsonb_build_object(v_side || 'Lat', p_lat, v_side || 'Lng', p_lng)
                ELSE '{}'::jsonb END
      ELSE
        jsonb_build_object(
          v_side || 'GeoRefreshState', p_result,
          v_side || 'GeoRefreshFailures',
          COALESCE(public.places_json_number(theme -> 'business_trip' -> (v_side || 'GeoRefreshFailures')), 0) + 1)
      END)
     WHERE id = p_row_id
       AND jsonb_typeof(theme -> 'business_trip') = 'object'
       AND theme -> 'business_trip' ->> (v_side || 'PlaceId') = p_expected_place_id;
  ELSIF p_kind = 'experience_stop' THEN
    UPDATE public.experience_stops SET
      place_id = CASE WHEN v_ok THEN v_id ELSE place_id END,
      lat = CASE WHEN v_ok AND v_move THEN p_lat ELSE lat END,
      lng = CASE WHEN v_ok AND v_move THEN p_lng ELSE lng END,
      geo_refreshed_at = CASE WHEN v_ok THEN clock_timestamp() ELSE geo_refreshed_at END,
      geo_refresh_state = p_result,
      geo_refresh_failures = CASE WHEN v_ok THEN 0 ELSE LEAST(geo_refresh_failures + 1, 32767) END
     WHERE id = p_row_id AND place_id = p_expected_place_id;
  ELSIF p_kind = 'venue_listing' THEN
    UPDATE public.venue_listings SET
      location_provider_place_id = CASE WHEN v_ok THEN v_id ELSE location_provider_place_id END,
      lat = CASE WHEN v_ok AND v_move THEN p_lat ELSE lat END,
      lng = CASE WHEN v_ok AND v_move THEN p_lng ELSE lng END,
      location_geo_refreshed_at = CASE WHEN v_ok THEN clock_timestamp() ELSE location_geo_refreshed_at END,
      location_geo_refresh_state = p_result,
      location_geo_refresh_failures = CASE WHEN v_ok THEN 0
        ELSE LEAST(location_geo_refresh_failures + 1, 32767) END
     WHERE id = p_row_id AND location_provider_place_id = p_expected_place_id;
  ELSIF p_kind = 'brand' THEN
    UPDATE public.brands SET
      location_provider_place_id = CASE WHEN v_ok THEN v_id ELSE location_provider_place_id END,
      lat = CASE WHEN v_ok AND v_move THEN p_lat ELSE lat END,
      lng = CASE WHEN v_ok AND v_move THEN p_lng ELSE lng END,
      location_geo_refreshed_at = CASE WHEN v_ok THEN clock_timestamp() ELSE location_geo_refreshed_at END,
      location_geo_refresh_state = p_result,
      location_geo_refresh_failures = CASE WHEN v_ok THEN 0
        ELSE LEAST(location_geo_refresh_failures + 1, 32767) END
     WHERE id = p_row_id AND location_provider_place_id = p_expected_place_id;
  ELSIF p_kind = 'pref_custom' THEN
    UPDATE public.preferences SET
      custom_location_place_id = CASE WHEN v_ok THEN v_id ELSE custom_location_place_id END,
      custom_lat = CASE WHEN v_ok AND v_move THEN p_lat ELSE custom_lat END,
      custom_lng = CASE WHEN v_ok AND v_move THEN p_lng ELSE custom_lng END,
      custom_location_geo_refreshed_at = CASE WHEN v_ok THEN clock_timestamp() ELSE custom_location_geo_refreshed_at END,
      custom_location_geo_refresh_state = p_result,
      custom_location_geo_refresh_failures = CASE WHEN v_ok THEN 0
        ELSE LEAST(custom_location_geo_refresh_failures + 1, 32767) END
     WHERE profile_id = p_row_id AND custom_location_place_id = p_expected_place_id;
  ELSIF p_kind = 'pref_discover' THEN
    UPDATE public.preferences SET
      discover_city_place_id = CASE WHEN v_ok THEN v_id ELSE discover_city_place_id END,
      discover_city_lat = CASE WHEN v_ok AND v_move THEN p_lat::numeric ELSE discover_city_lat END,
      discover_city_lng = CASE WHEN v_ok AND v_move THEN p_lng::numeric ELSE discover_city_lng END,
      discover_city_geo_refreshed_at = CASE WHEN v_ok THEN clock_timestamp() ELSE discover_city_geo_refreshed_at END,
      discover_city_geo_refresh_state = p_result,
      discover_city_geo_refresh_failures = CASE WHEN v_ok THEN 0
        ELSE LEAST(discover_city_geo_refresh_failures + 1, 32767) END
     WHERE profile_id = p_row_id AND discover_city_place_id = p_expected_place_id;
  ELSIF p_kind = 'chat_plan' THEN
    UPDATE public.chat_plans SET
      provider_place_id = CASE WHEN v_ok THEN v_id ELSE provider_place_id END,
      place_lat = CASE WHEN v_ok AND v_move THEN p_lat ELSE place_lat END,
      place_lng = CASE WHEN v_ok AND v_move THEN p_lng ELSE place_lng END,
      place_geo_refreshed_at = CASE WHEN v_ok THEN clock_timestamp() ELSE place_geo_refreshed_at END,
      place_geo_refresh_state = p_result,
      place_geo_refresh_failures = CASE WHEN v_ok THEN 0
        ELSE LEAST(place_geo_refresh_failures + 1, 32767) END
     WHERE id = p_row_id AND provider_place_id = p_expected_place_id;
  ELSE
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_kind';
  END IF;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$function$;

-- A1: only PAST offerings lose coordinates, 29 days after their last refresh.
-- Live, upcoming and draft offerings are never cleared; preference anchors and
-- venue listings are never cleared (A2; a venue listing is always in scope).
-- The place id and the host text stay. Returns the number of pins expired.
CREATE OR REPLACE FUNCTION public.places_refresh_expire_past()
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_total integer := 0;
  v_n integer;
  v_side text;
BEGIN
  UPDATE public.events e SET location_geo = NULL, location_geo_refresh_state = 'expired'
   WHERE public.places_is_google_place_id(e.location_provider_place_id)
     AND e.location_geo IS NOT NULL
     AND e.location_geo_refreshed_at < now() - interval '29 days'
     AND NOT public.places_refresh_event_in_scope(e.id);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

  FOREACH v_side IN ARRAY ARRAY['departure', 'destination'] LOOP
    UPDATE public.events e SET theme = public.places_trip_patch(
        (e.theme #- ARRAY['business_trip', v_side || 'Lat']) #- ARRAY['business_trip', v_side || 'Lng'],
        v_side, jsonb_build_object(v_side || 'GeoRefreshState', 'expired'))
     WHERE jsonb_typeof(e.theme -> 'business_trip') = 'object'
       AND public.places_is_google_place_id(e.theme -> 'business_trip' ->> (v_side || 'PlaceId'))
       AND public.places_json_number(e.theme -> 'business_trip' -> (v_side || 'Lat')) IS NOT NULL
       AND public.places_json_timestamptz(e.theme -> 'business_trip' -> (v_side || 'GeoRefreshedAt'))
           < now() - interval '29 days'
       AND NOT public.places_refresh_event_in_scope(e.id);
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;
  END LOOP;

  UPDATE public.experience_stops st SET lat = NULL, lng = NULL, geo_refresh_state = 'expired'
   WHERE public.places_is_google_place_id(st.place_id)
     AND st.lat IS NOT NULL
     AND st.geo_refreshed_at < now() - interval '29 days'
     AND NOT public.places_refresh_event_in_scope(st.event_id);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

  UPDATE public.brands b SET lat = NULL, lng = NULL, location_geo_refresh_state = 'expired'
   WHERE public.places_is_google_place_id(b.location_provider_place_id)
     AND b.lat IS NOT NULL
     AND b.location_geo_refreshed_at < now() - interval '29 days'
     AND b.deleted_at IS NOT NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

  UPDATE public.chat_plans c SET place_lat = NULL, place_lng = NULL, place_geo_refresh_state = 'expired'
   WHERE public.places_is_google_place_id(c.provider_place_id)
     AND c.place_lat IS NOT NULL
     AND c.place_geo_refreshed_at < now() - interval '29 days'
     AND NOT public.places_refresh_chat_plan_in_scope(c.status, c.scheduled_at, c.created_at);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

  RETURN v_total;
END;
$function$;

-- The daily ops alert: in-scope pins past day 26 (loud from day 26, A1),
-- places Google no longer knows, and pins whose refresh is failing.
CREATE OR REPLACE FUNCTION public.places_refresh_alert_summary()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path = public, pg_temp
AS $function$
  SELECT jsonb_build_object(
    'stale_in_scope', count(*) FILTER (WHERE p.in_scope AND p.refreshed_at < now() - interval '26 days'),
    'stale_ids', COALESCE((
      SELECT jsonb_agg(x.k) FROM (
        SELECT q.pin_kind || ':' || q.row_id AS k
          FROM public.places_refresh_pins() q
         WHERE q.in_scope AND q.refreshed_at < now() - interval '26 days'
         ORDER BY q.refreshed_at LIMIT 50) x), '[]'::jsonb),
    'place_gone', count(*) FILTER (WHERE p.refresh_state = 'place_gone'),
    'failing', count(*) FILTER (WHERE p.refresh_state = 'failing'))
  FROM public.places_refresh_pins() p;
$function$;

-- ── 6. one-off re-pin (D2) — scripts/issue-4334/repin-to-google.ts ──────────
-- Rows that still need a pin and have no Google id yet, plus every event on the
-- retired provider's Lagos city-centre fallback (6.453928, 3.38975).
CREATE OR REPLACE FUNCTION public.places_repin_candidates()
 RETURNS TABLE (
   pin_kind text, row_id uuid, label text, lat double precision, lng double precision,
   country_code text, coordinate_precision text)
 LANGUAGE sql
 STABLE
 SET search_path = public, pg_temp
AS $function$
  SELECT 'event_location', e.id, e.location_text, e.location_geo[1], e.location_geo[0],
         NULL::text, e.coordinate_precision
    FROM public.events e
   WHERE e.deleted_at IS NULL
     AND e.location_geo IS NOT NULL
     AND NOT public.places_is_google_place_id(e.location_provider_place_id)
     AND NULLIF(btrim(COALESCE(e.location_text, '')), '') IS NOT NULL
     AND (public.places_refresh_event_in_scope(e.id)
          OR (abs(e.location_geo[1] - 6.453928) < 0.000001 AND abs(e.location_geo[0] - 3.38975) < 0.000001))
  UNION ALL
  SELECT 'trip_' || s.side, e.id, e.theme -> 'business_trip' ->> (s.side || 'LocationText'),
         public.places_json_number(e.theme -> 'business_trip' -> (s.side || 'Lat')),
         public.places_json_number(e.theme -> 'business_trip' -> (s.side || 'Lng')),
         upper(e.theme -> 'business_trip' ->> (s.side || 'CountryCode')),
         e.theme -> 'business_trip' ->> (s.side || 'CoordinatePrecision')
    FROM public.events e
   CROSS JOIN (VALUES ('departure'), ('destination')) AS s(side)
   WHERE e.deleted_at IS NULL
     AND jsonb_typeof(e.theme -> 'business_trip') = 'object'
     AND public.places_json_number(e.theme -> 'business_trip' -> (s.side || 'Lat')) IS NOT NULL
     AND NOT public.places_is_google_place_id(e.theme -> 'business_trip' ->> (s.side || 'PlaceId'))
     AND NULLIF(btrim(COALESCE(e.theme -> 'business_trip' ->> (s.side || 'LocationText'), '')), '') IS NOT NULL
     AND public.places_refresh_event_in_scope(e.id)
  UNION ALL
  SELECT 'experience_stop', st.id, st.address, st.lat, st.lng, upper(st.country_code), st.coordinate_precision
    FROM public.experience_stops st
   WHERE st.lat IS NOT NULL AND st.lng IS NOT NULL
     AND NOT public.places_is_google_place_id(st.place_id)
     AND public.places_refresh_event_in_scope(st.event_id)
  UNION ALL
  SELECT 'venue_listing', v.id, v.address, v.lat, v.lng, upper(v.country_code), v.coordinate_precision
    FROM public.venue_listings v
   WHERE NOT public.places_is_google_place_id(v.location_provider_place_id)
     AND NULLIF(btrim(COALESCE(v.address, '')), '') IS NOT NULL
  UNION ALL
  SELECT 'brand', b.id, b.address, b.lat, b.lng, upper(b.country_code), NULL::text
    FROM public.brands b
   WHERE b.deleted_at IS NULL AND b.lat IS NOT NULL AND b.lng IS NOT NULL
     AND NOT public.places_is_google_place_id(b.location_provider_place_id)
     AND NULLIF(btrim(COALESCE(b.address, '')), '') IS NOT NULL;
$function$;

CREATE OR REPLACE FUNCTION public.places_repin_precision(p_current text, p_new text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path = public, pg_temp
AS $function$
  -- may upgrade null/approximate → exact; never writes approximate over exact.
  SELECT CASE
    WHEN p_new = 'exact' OR p_current = 'exact' THEN 'exact'
    ELSE COALESCE(p_new, p_current)
  END;
$function$;

-- Apply one accepted re-pin. Idempotent: a pin that already has a Google id is
-- skipped (returns false). The old pin goes to the audit columns once; host
-- text is never touched (D9).
CREATE OR REPLACE FUNCTION public.places_repin_apply(
  p_kind text, p_row_id uuid, p_place_id text, p_lat double precision,
  p_lng double precision, p_precision text)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_side text;
  v_rows integer := 0;
BEGIN
  IF NOT public.places_is_google_place_id(p_place_id) THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_place_id';
  END IF;
  IF p_lat IS NULL OR p_lng IS NULL OR p_lat NOT BETWEEN -90 AND 90
     OR p_lng NOT BETWEEN -180 AND 180 OR (p_lat = 0 AND p_lng = 0) THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_lat';
  END IF;
  IF p_precision IS NOT NULL AND p_precision NOT IN ('exact', 'approximate') THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_precision';
  END IF;

  IF p_kind = 'event_location' THEN
    UPDATE public.events SET
      location_mapbox_lat = COALESCE(location_mapbox_lat, location_geo[1]),
      location_mapbox_lng = COALESCE(location_mapbox_lng, location_geo[0]),
      location_geo = point(p_lng, p_lat),
      location_provider_place_id = p_place_id,
      location_geo_refreshed_at = now(),
      location_geo_refresh_state = 'ok',
      location_geo_refresh_failures = 0,
      coordinate_precision = public.places_repin_precision(coordinate_precision, p_precision)
     WHERE id = p_row_id AND NOT public.places_is_google_place_id(location_provider_place_id);
  ELSIF p_kind IN ('trip_departure', 'trip_destination') THEN
    v_side := substring(p_kind from 6);
    UPDATE public.events SET theme = public.places_trip_patch(theme, v_side, jsonb_build_object(
        v_side || 'MapboxLat', COALESCE(theme -> 'business_trip' -> (v_side || 'MapboxLat'), theme -> 'business_trip' -> (v_side || 'Lat')),
        v_side || 'MapboxLng', COALESCE(theme -> 'business_trip' -> (v_side || 'MapboxLng'), theme -> 'business_trip' -> (v_side || 'Lng')),
        v_side || 'Lat', p_lat,
        v_side || 'Lng', p_lng,
        v_side || 'PlaceId', p_place_id,
        v_side || 'GeoRefreshedAt', to_jsonb(now()),
        v_side || 'GeoRefreshState', 'ok',
        v_side || 'GeoRefreshFailures', 0,
        v_side || 'CoordinatePrecision', public.places_repin_precision(
          theme -> 'business_trip' ->> (v_side || 'CoordinatePrecision'), p_precision)))
     WHERE id = p_row_id
       AND jsonb_typeof(theme -> 'business_trip') = 'object'
       AND NOT public.places_is_google_place_id(theme -> 'business_trip' ->> (v_side || 'PlaceId'));
  ELSIF p_kind = 'experience_stop' THEN
    UPDATE public.experience_stops SET
      mapbox_lat = COALESCE(mapbox_lat, lat),
      mapbox_lng = COALESCE(mapbox_lng, lng),
      lat = p_lat, lng = p_lng, place_id = p_place_id,
      geo_refreshed_at = now(), geo_refresh_state = 'ok', geo_refresh_failures = 0,
      coordinate_precision = public.places_repin_precision(coordinate_precision, p_precision)
     WHERE id = p_row_id AND NOT public.places_is_google_place_id(place_id);
  ELSIF p_kind = 'venue_listing' THEN
    UPDATE public.venue_listings SET
      location_mapbox_lat = COALESCE(location_mapbox_lat, lat),
      location_mapbox_lng = COALESCE(location_mapbox_lng, lng),
      lat = p_lat, lng = p_lng, location_provider_place_id = p_place_id,
      location_geo_refreshed_at = now(), location_geo_refresh_state = 'ok',
      location_geo_refresh_failures = 0,
      coordinate_precision = public.places_repin_precision(coordinate_precision, p_precision)
     WHERE id = p_row_id AND NOT public.places_is_google_place_id(location_provider_place_id);
  ELSIF p_kind = 'brand' THEN
    UPDATE public.brands SET
      location_mapbox_lat = COALESCE(location_mapbox_lat, lat),
      location_mapbox_lng = COALESCE(location_mapbox_lng, lng),
      lat = p_lat, lng = p_lng, location_provider_place_id = p_place_id,
      location_geo_refreshed_at = now(), location_geo_refresh_state = 'ok',
      location_geo_refresh_failures = 0
     WHERE id = p_row_id AND NOT public.places_is_google_place_id(location_provider_place_id);
  ELSE
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_kind';
  END IF;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$function$;

-- Rollback of one re-pin: the audited pin comes back, the Google fields go.
CREATE OR REPLACE FUNCTION public.places_repin_restore(p_kind text, p_row_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_side text;
  v_rows integer := 0;
BEGIN
  IF p_kind = 'event_location' THEN
    UPDATE public.events SET
      location_geo = point(location_mapbox_lng, location_mapbox_lat),
      location_provider_place_id = NULL, location_geo_refreshed_at = NULL,
      location_geo_refresh_state = NULL, location_geo_refresh_failures = 0
     WHERE id = p_row_id AND location_mapbox_lat IS NOT NULL AND location_mapbox_lng IS NOT NULL;
  ELSIF p_kind IN ('trip_departure', 'trip_destination') THEN
    v_side := substring(p_kind from 6);
    UPDATE public.events SET theme = public.places_trip_patch(
        theme #- ARRAY['business_trip', v_side || 'GeoRefreshedAt']
              #- ARRAY['business_trip', v_side || 'GeoRefreshState']
              #- ARRAY['business_trip', v_side || 'GeoRefreshFailures'],
        v_side, jsonb_build_object(
          v_side || 'Lat', theme -> 'business_trip' -> (v_side || 'MapboxLat'),
          v_side || 'Lng', theme -> 'business_trip' -> (v_side || 'MapboxLng'),
          v_side || 'PlaceId', NULL))
     WHERE id = p_row_id
       AND jsonb_typeof(theme -> 'business_trip' -> (v_side || 'MapboxLat')) = 'number';
  ELSIF p_kind = 'experience_stop' THEN
    UPDATE public.experience_stops SET lat = mapbox_lat, lng = mapbox_lng, place_id = NULL,
      geo_refreshed_at = NULL, geo_refresh_state = NULL, geo_refresh_failures = 0
     WHERE id = p_row_id AND mapbox_lat IS NOT NULL;
  ELSIF p_kind = 'venue_listing' THEN
    UPDATE public.venue_listings SET lat = location_mapbox_lat, lng = location_mapbox_lng,
      location_provider_place_id = NULL, location_geo_refreshed_at = NULL,
      location_geo_refresh_state = NULL, location_geo_refresh_failures = 0
     WHERE id = p_row_id AND location_mapbox_lat IS NOT NULL;
  ELSIF p_kind = 'brand' THEN
    UPDATE public.brands SET lat = location_mapbox_lat, lng = location_mapbox_lng,
      location_provider_place_id = NULL, location_geo_refreshed_at = NULL,
      location_geo_refresh_state = NULL, location_geo_refresh_failures = 0
     WHERE id = p_row_id AND location_mapbox_lat IS NOT NULL;
  ELSE
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_kind';
  END IF;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$function$;

-- Service-role only.
REVOKE ALL ON FUNCTION public.places_json_timestamptz(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.places_refresh_pins() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.places_refresh_due_pins(integer, interval) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.places_refresh_record(text, uuid, text, text, text, double precision, double precision) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.places_refresh_expire_past() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.places_refresh_alert_summary() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.places_repin_candidates() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.places_repin_apply(text, uuid, text, double precision, double precision, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.places_repin_restore(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.places_json_timestamptz(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.places_refresh_pins() TO service_role;
GRANT EXECUTE ON FUNCTION public.places_refresh_due_pins(integer, interval) TO service_role;
GRANT EXECUTE ON FUNCTION public.places_refresh_record(text, uuid, text, text, text, double precision, double precision) TO service_role;
GRANT EXECUTE ON FUNCTION public.places_refresh_expire_past() TO service_role;
GRANT EXECUTE ON FUNCTION public.places_refresh_alert_summary() TO service_role;
GRANT EXECUTE ON FUNCTION public.places_repin_candidates() TO service_role;
GRANT EXECUTE ON FUNCTION public.places_repin_apply(text, uuid, text, double precision, double precision, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.places_repin_restore(text, uuid) TO service_role;

-- ── 8. api-health tiles ─────────────────────────────────────────────────────
-- The retired map vendor's tile goes (its checks history is FK-bound to the
-- service row). Four Google tiles probe the exact endpoints we call; their
-- reactive matchers mirror CLASS_B_DEPLETION in api-health-probe/logic.ts.
DELETE FROM public.api_health_alert_state WHERE service_key = 'mapbox';
DELETE FROM public.api_health_checks WHERE service_key = 'mapbox';
DELETE FROM public.api_health_services WHERE service_key = 'mapbox';

UPDATE public.api_health_services
   SET display_name = 'Google Places Autocomplete',
       depletion_signal = jsonb_build_object(
         'status_feed', NULL,
         'reactive', jsonb_build_array(
           jsonb_build_object('http', jsonb_build_array(429), 'field', 'status_text', 'match', 'RESOURCE_EXHAUSTED', 'kind', 'depletion'),
           jsonb_build_object('http', jsonb_build_array(403), 'field', 'type', 'match', 'provider_denied', 'kind', 'refusal')))
 WHERE service_key = 'google_places';

INSERT INTO public.api_health_services
  (service_key, display_name, category, sort_order, monitoring_class, depletion_signal)
VALUES
  ('google_place_details', 'Google Place Details', 'maps', 32, 'B', jsonb_build_object(
     'status_feed', NULL,
     'reactive', jsonb_build_array(
       jsonb_build_object('http', jsonb_build_array(429), 'field', 'type', 'match', 'provider_quota', 'kind', 'depletion'),
       jsonb_build_object('http', jsonb_build_array(403), 'field', 'type', 'match', 'provider_denied', 'kind', 'refusal')))),
  ('google_geocoding', 'Google Geocoding', 'maps', 33, 'B', jsonb_build_object(
     'status_feed', NULL,
     'reactive', jsonb_build_array(
       jsonb_build_object('http', jsonb_build_array(200, 429), 'field', 'type', 'match', 'provider_quota', 'kind', 'depletion'),
       jsonb_build_object('http', jsonb_build_array(200, 403), 'field', 'type', 'match', 'provider_denied', 'kind', 'refusal')))),
  ('google_static_maps', 'Google Static Maps', 'maps', 34, 'B', jsonb_build_object(
     'status_feed', NULL,
     'reactive', jsonb_build_array(
       jsonb_build_object('http', jsonb_build_array(403), 'field', 'type', 'match', 'map_unavailable', 'kind', 'refusal'),
       jsonb_build_object('http', jsonb_build_array(429), 'field', 'type', 'match', 'map_unavailable', 'kind', 'depletion')))),
  ('google_place_refresh', 'Google place refresh job', 'maps', 35, 'B', jsonb_build_object(
     'status_feed', NULL,
     'reactive', jsonb_build_array(
       jsonb_build_object('http', jsonb_build_array(429), 'field', 'type', 'match', 'provider_quota', 'kind', 'depletion'),
       jsonb_build_object('http', jsonb_build_array(403), 'field', 'type', 'match', 'provider_denied', 'kind', 'refusal'))))
ON CONFLICT (service_key) DO UPDATE
  SET display_name     = EXCLUDED.display_name,
      category         = EXCLUDED.category,
      sort_order       = EXCLUDED.sort_order,
      monitoring_class = EXCLUDED.monitoring_class,
      depletion_signal = EXCLUDED.depletion_signal;

INSERT INTO public.api_health_alert_state (service_key)
  SELECT k FROM (VALUES ('google_place_details'), ('google_geocoding'),
                        ('google_static_maps'), ('google_place_refresh')) AS v(k)
ON CONFLICT (service_key) DO NOTHING;

-- ── 9. daily refresh at 03:20 UTC ──────────────────────────────────────────
DO $block$
BEGIN
  IF to_regnamespace('cron') IS NULL
     OR to_regnamespace('net') IS NULL
     OR to_regnamespace('vault') IS NULL THEN
    RAISE EXCEPTION 'issue_4334_refresh_cron_dependencies_missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'supabase_url') THEN
    RAISE NOTICE 'issue-4334 advisory: vault secret "supabase_url" missing; places-coordinate-refresh-daily will register but its calls will fail until it exists.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'service_role_key') THEN
    RAISE NOTICE 'issue-4334 advisory: vault secret "service_role_key" missing; places-coordinate-refresh-daily will register but its calls will fail until it exists.';
  END IF;
END;
$block$;

-- Unschedule by job id: pg_cron's by-name form only sees the caller's own
-- jobs, so a re-apply by a different superuser would fail.
SELECT cron.unschedule(jobid)
  FROM cron.job
 WHERE jobname = 'places-coordinate-refresh-daily';

SELECT cron.schedule(
  'places-coordinate-refresh-daily',
  '20 3 * * *',
  $cron$
    SELECT net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='supabase_url' LIMIT 1)
        || '/functions/v1/places-coordinate-refresh',
      headers := jsonb_build_object(
        'authorization','Bearer '||(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='service_role_key' LIMIT 1),
        'content-type','application/json'
      ),
      body := '{}'::jsonb
    );
  $cron$
);

NOTIFY pgrst, 'reload schema';






-- =====================================================================================
-- A-2 (orchestrator review of 5a80af8e2d): the picked Google place id travels in the
-- SAME write as the coordinates on every Host save path. Each function below is the
-- CURRENT PRODUCTION body (pg_get_functiondef, md5-matched against production on
-- 2026-11-08; production = main + the applied #1023 theme migration) with only the
-- place-id lines added. jsonb-payload RPCs take an optional payload key
-- `location_provider_place_id` (absent key = keep, so installed apps keep working);
-- scalar RPCs take `p_location_place_id text DEFAULT NULL`.
-- =====================================================================================

-- One validator for every write path: NULL/blank → NULL; a Google id → itself;
-- anything else (a retired Mapbox id, garbage) is refused loudly.
CREATE OR REPLACE FUNCTION public.places_checked_place_id(p_id text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NULLIF(btrim(COALESCE(p_id, '')), '') IS NULL THEN RETURN NULL; END IF;
  IF NOT public.places_is_google_place_id(btrim(p_id)) THEN
    RAISE EXCEPTION 'location_place_id_invalid' USING ERRCODE = '22023';
  END IF;
  RETURN btrim(p_id);
END;
$function$;
REVOKE ALL ON FUNCTION public.places_checked_place_id(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.places_checked_place_id(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.business_create_event_draft(p_brand_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_event public.events%ROWTYPE;
  v_title text;
  v_slug text;
  v_geo point;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF public.biz_brand_effective_rank(p_brand_id, v_uid) < public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'insufficient_event_permission';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.brands WHERE id=p_brand_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'brand_not_found';
  END IF;
  PERFORM public.business_assert_event_visibility(
    p_payload#>'{theme,business_draft,requestedVisibility}'
  );
  v_title := COALESCE(NULLIF(btrim(p_payload->>'title'), ''), 'Untitled draft');
  v_slug := 'draft-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);
  IF NULLIF(p_payload->>'location_geo','') IS NOT NULL THEN
    v_geo := (p_payload->>'location_geo')::point;
  END IF;
  PERFORM public.assert_cover_media_triplet(
    NULLIF(p_payload->>'cover_media_url',''), NULLIF(p_payload->>'cover_media_type',''),
    NULLIF(p_payload->>'cover_media_poster_url',''));

  INSERT INTO public.events(
    brand_id, created_by, event_type, title, slug, description, location_text,
    online_url, cover_media_url, cover_media_poster_url, cover_media_type,
    cover_media_provider, cover_media_source_url, cover_media_credit,
    cover_media_credit_url, cover_media_alt, cover_media_gallery, currency,
    is_online, is_recurring, is_multi_date, recurrence_rules, theme,
    visibility, status, timezone, party_types, vibe_tags, music_genres, city,
    location_geo, pass_tax, pass_mingla_fee, pass_service_fee,
    theme_color_override, theme_font_override, theme_animation_override,
    theme_gradient_override, location_provider_place_id
  ) VALUES (
    p_brand_id, v_uid, 'event', v_title, v_slug,
    NULLIF(p_payload->>'description',''), NULLIF(p_payload->>'location_text',''),
    NULLIF(p_payload->>'online_url',''), NULLIF(p_payload->>'cover_media_url',''),
    NULLIF(p_payload->>'cover_media_poster_url',''), NULLIF(p_payload->>'cover_media_type',''),
    NULLIF(p_payload->>'cover_media_provider',''), NULLIF(p_payload->>'cover_media_source_url',''),
    NULLIF(p_payload->>'cover_media_credit',''), NULLIF(p_payload->>'cover_media_credit_url',''),
    NULLIF(p_payload->>'cover_media_alt',''), COALESCE(p_payload->'cover_media_gallery','[]'::jsonb),
    NULLIF(p_payload->>'currency','')::character(3), COALESCE((p_payload->>'is_online')::boolean,false),
    COALESCE((p_payload->>'is_recurring')::boolean,false), COALESCE((p_payload->>'is_multi_date')::boolean,false),
    p_payload->'recurrence_rules', COALESCE(p_payload->'theme','{}'::jsonb), 'draft', 'draft',
    COALESCE(NULLIF(p_payload->>'timezone',''),'UTC'),
    COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_payload->'party_types','[]'::jsonb))),ARRAY[]::text[]),
    COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_payload->'vibe_tags','[]'::jsonb))),ARRAY[]::text[]),
    COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_payload->'music_genres','[]'::jsonb))),ARRAY[]::text[]),
    NULLIF(p_payload->>'city',''), v_geo,
    (p_payload->>'pass_tax')::boolean, (p_payload->>'pass_mingla_fee')::boolean,
    (p_payload->>'pass_service_fee')::boolean, NULLIF(p_payload->>'theme_color_override',''),
    NULLIF(p_payload->>'theme_font_override',''), NULLIF(p_payload->>'theme_animation_override',''),
    NULLIF(p_payload->>'theme_gradient_override',''),
    public.places_checked_place_id(NULLIF(btrim(p_payload->>'location_provider_place_id'),''))
  ) RETURNING * INTO v_event;
  RETURN jsonb_build_object('event', to_jsonb(v_event), 'client_revision',
    COALESCE((p_payload#>>'{theme,business_draft,clientRevision}')::integer,0));
END;
$function$;

CREATE OR REPLACE FUNCTION public.business_update_event_draft(p_event_id uuid, p_payload jsonb, p_client_revision integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_event public.events%ROWTYPE;
  v_stored_revision integer;
  v_geo point;
  v_keep_cover boolean;  -- applied-cover guard
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT * INTO v_event FROM public.events WHERE id=p_event_id FOR UPDATE;
  IF NOT FOUND OR v_event.deleted_at IS NOT NULL OR v_event.event_type <> 'event' THEN
    RAISE EXCEPTION 'event_draft_not_found';
  END IF;
  IF v_event.status <> 'draft' THEN RAISE EXCEPTION 'event_draft_not_editable'; END IF;
  IF public.biz_brand_effective_rank(v_event.brand_id,v_uid) < public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'insufficient_event_permission';
  END IF;
  v_stored_revision := COALESCE((v_event.theme#>>'{business_draft,clientRevision}')::integer,0);
  IF p_client_revision IS NULL OR p_client_revision < v_stored_revision THEN
    RAISE EXCEPTION 'stale_client_revision';
  END IF;
  PERFORM public.business_assert_event_visibility(
    p_payload#>'{theme,business_draft,requestedVisibility}'
  );
  IF NULLIF(p_payload->>'location_geo','') IS NOT NULL THEN v_geo := (p_payload->>'location_geo')::point; END IF;
  -- Applied-cover guard — a cover the server put on this row (a draft_auto
  -- cover-video job finishing after the host closed the sheet) must survive a
  -- save from a client that has not seen it. With `__coverBase` (the cover the
  -- client last received) it is a three-way merge: keep the stored cover when
  -- the client's cover is still its base and the server's has moved since. A
  -- client without the key falls back to: the stored cover is an applied
  -- draft_auto job's video and no save has landed since that job applied.
  v_keep_cover := (CASE WHEN p_payload ? '__coverBase' THEN
      NULLIF(p_payload->>'cover_media_url','') IS NOT DISTINCT FROM NULLIF(p_payload->>'__coverBase','')
      AND v_event.cover_media_url IS DISTINCT FROM NULLIF(p_payload->>'__coverBase','')
    ELSE
      v_event.cover_media_url IS NOT NULL
      AND NULLIF(p_payload->>'cover_media_url','') IS DISTINCT FROM v_event.cover_media_url
      AND EXISTS (SELECT 1 FROM public.event_cover_video_jobs j
        WHERE j.event_id = p_event_id AND j.target_kind = 'event'
          AND j.apply_mode = 'draft_auto' AND j.status = 'applied'
          AND j.processed_url = v_event.cover_media_url
          AND j.applied_at >= v_event.updated_at)
    END);
  PERFORM public.assert_cover_media_triplet(NULLIF(p_payload->>'cover_media_url',''),
    NULLIF(p_payload->>'cover_media_type',''),NULLIF(p_payload->>'cover_media_poster_url',''));

  -- issue #3281 — a client that predates day lists cannot widen a ticket.
  IF jsonb_typeof(p_payload#>'{theme,business_draft,tickets}') = 'array' THEN
    p_payload := jsonb_set(p_payload, '{theme,business_draft,tickets}',
      public.issue_3281_keep_draft_day_lists(
        p_payload#>'{theme,business_draft,tickets}', v_event.theme#>'{business_draft,tickets}'));
  END IF;

  UPDATE public.events SET
    title=COALESCE(NULLIF(btrim(p_payload->>'title'),''),'Untitled draft'),
    description=NULLIF(p_payload->>'description',''), location_text=NULLIF(p_payload->>'location_text',''),
    online_url=NULLIF(p_payload->>'online_url',''), cover_media_url=CASE WHEN v_keep_cover THEN v_event.cover_media_url ELSE NULLIF(p_payload->>'cover_media_url','') END,
    cover_media_poster_url=CASE WHEN v_keep_cover THEN v_event.cover_media_poster_url ELSE NULLIF(p_payload->>'cover_media_poster_url','') END, cover_media_type=CASE WHEN v_keep_cover THEN v_event.cover_media_type ELSE NULLIF(p_payload->>'cover_media_type','') END,
    cover_media_provider=CASE WHEN v_keep_cover THEN v_event.cover_media_provider ELSE NULLIF(p_payload->>'cover_media_provider','') END, cover_media_source_url=CASE WHEN v_keep_cover THEN v_event.cover_media_source_url ELSE NULLIF(p_payload->>'cover_media_source_url','') END,
    cover_media_credit=CASE WHEN v_keep_cover THEN v_event.cover_media_credit ELSE NULLIF(p_payload->>'cover_media_credit','') END, cover_media_credit_url=CASE WHEN v_keep_cover THEN v_event.cover_media_credit_url ELSE NULLIF(p_payload->>'cover_media_credit_url','') END,
    cover_media_alt=CASE WHEN v_keep_cover THEN v_event.cover_media_alt ELSE NULLIF(p_payload->>'cover_media_alt','') END, cover_media_gallery=CASE WHEN p_payload?'cover_media_gallery' THEN COALESCE(p_payload->'cover_media_gallery','[]'::jsonb) ELSE v_event.cover_media_gallery END,
    currency=NULLIF(p_payload->>'currency','')::character(3), is_online=COALESCE((p_payload->>'is_online')::boolean,false),
    is_recurring=COALESCE((p_payload->>'is_recurring')::boolean,false), is_multi_date=COALESCE((p_payload->>'is_multi_date')::boolean,false),
    recurrence_rules=p_payload->'recurrence_rules',
    theme=jsonb_set(COALESCE(p_payload->'theme','{}'::jsonb),
      '{business_draft,clientRevision}',to_jsonb(p_client_revision),true),
    visibility='draft', status='draft', timezone=COALESCE(NULLIF(p_payload->>'timezone',''),'UTC'),
    party_types=COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_payload->'party_types','[]'::jsonb))),ARRAY[]::text[]),
    vibe_tags=COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_payload->'vibe_tags','[]'::jsonb))),ARRAY[]::text[]),
    music_genres=COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_payload->'music_genres','[]'::jsonb))),ARRAY[]::text[]),
    city=NULLIF(p_payload->>'city',''), location_geo=v_geo,
    location_provider_place_id=CASE WHEN p_payload?'location_provider_place_id' THEN public.places_checked_place_id(NULLIF(btrim(p_payload->>'location_provider_place_id'),'')) ELSE location_provider_place_id END,
    pass_tax=(p_payload->>'pass_tax')::boolean, pass_mingla_fee=(p_payload->>'pass_mingla_fee')::boolean,
    pass_service_fee=(p_payload->>'pass_service_fee')::boolean,
    theme_color_override=NULLIF(p_payload->>'theme_color_override',''), theme_font_override=NULLIF(p_payload->>'theme_font_override',''),
    theme_animation_override=NULLIF(p_payload->>'theme_animation_override',''),
    theme_gradient_override=NULLIF(p_payload->>'theme_gradient_override',''), updated_at=now()
  WHERE id=p_event_id RETURNING * INTO v_event;
  RETURN jsonb_build_object('event',to_jsonb(v_event),'client_revision',
    p_client_revision);
END;
$function$;

CREATE OR REPLACE FUNCTION public.business_update_rsvp_graph(p_event_id uuid, p_payload jsonb, p_reason text DEFAULT NULL::text, p_client_request_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE v_actor uuid:=auth.uid(); v public.events%ROWTYPE; v_draft jsonb; v_patch jsonb; v_merged jsonb;
  v_theme jsonb; v_result jsonb; v_hash text; v_prior public.rsvp_domain_operation_receipts%ROWTYPE;
  v_live_payload jsonb; v_update_result jsonb; v_current_revision integer; v_expected_revision integer;
  v_suggested integer; v_minimum integer;
  v_keep_cover boolean;  -- applied-cover guard
BEGIN
  IF v_actor IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN
    RAISE EXCEPTION 'rsvp_payload_invalid' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v FROM public.events WHERE id=p_event_id AND event_type='rsvp' AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND OR public.biz_brand_effective_rank(v.brand_id,v_actor)<public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'rsvp_not_found_or_forbidden' USING ERRCODE='42501';
  END IF;
  v_hash:=encode(extensions.digest(convert_to(p_event_id::text||':'||p_payload::text||':'||COALESCE(p_reason,''),'UTF8'),'sha256'),'hex');
  IF p_client_request_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(v_actor::text||':rsvp_update:'||p_client_request_id::text,0));
    SELECT * INTO v_prior FROM public.rsvp_domain_operation_receipts
      WHERE actor_id=v_actor AND operation='update' AND client_request_id=p_client_request_id;
    IF FOUND THEN
      IF v_prior.request_hash<>v_hash THEN RAISE EXCEPTION 'rsvp_idempotency_hash_mismatch' USING ERRCODE='23505'; END IF;
      RETURN v_prior.result||jsonb_build_object('replayed',true);
    END IF;
  END IF;
  IF v.status='draft' AND v.visibility='draft' THEN
    IF EXISTS(SELECT 1 FROM public.event_dates d WHERE d.event_id=p_event_id)
       OR EXISTS(SELECT 1 FROM public.ticket_types t WHERE t.event_id=p_event_id AND t.deleted_at IS NULL) THEN
      RAISE EXCEPTION 'rsvp_draft_graph_invalid';
    END IF;
    v_draft:=COALESCE(v.theme#>'{business_draft}','{}'::jsonb);
    v_patch:=COALESCE(p_payload#>'{theme,business_draft}','{}'::jsonb)||p_payload;
    v_current_revision:=COALESCE((v_draft->>'clientRevision')::integer,0);
    v_expected_revision:=NULLIF(p_payload->>'__expectedClientRevision','')::integer;
    IF v_expected_revision IS NOT NULL AND v_expected_revision<v_current_revision THEN
      RAISE EXCEPTION 'rsvp_revision_conflict' USING ERRCODE='PT409';
    END IF;
    -- Applied-cover guard — a cover the server put on this row (a draft_auto
    -- cover-video job finishing after the host closed the sheet) must survive
    -- a save from a client that has not seen it. With `__coverBase` (the
    -- cover the client last received) it is a three-way merge: keep the
    -- stored cover when the client's cover is still its base and the server's
    -- has moved since. A client without the key falls back to: the stored
    -- cover is an applied draft_auto job's video and no save has landed since
    -- that job applied.
    v_keep_cover := (CASE WHEN p_payload ? '__coverBase' THEN
        NULLIF(p_payload->>'cover_media_url','') IS NOT DISTINCT FROM NULLIF(p_payload->>'__coverBase','')
        AND v.cover_media_url IS DISTINCT FROM NULLIF(p_payload->>'__coverBase','')
      ELSE
        v.cover_media_url IS NOT NULL
        AND NULLIF(p_payload->>'cover_media_url','') IS DISTINCT FROM v.cover_media_url
        AND EXISTS (SELECT 1 FROM public.event_cover_video_jobs j
          WHERE j.event_id = p_event_id AND j.target_kind = 'event'
            AND j.apply_mode = 'draft_auto' AND j.status = 'applied'
            AND j.processed_url = v.cover_media_url
            AND j.applied_at >= v.updated_at)
      END);
    v_patch:=v_patch-'__expectedClientRevision'-'__coverBase';
    v_merged:=jsonb_set(v_draft||v_patch,'{clientRevision}',to_jsonb(COALESCE(v_expected_revision,v_current_revision+1)),true);
    IF v_patch?'when' THEN v_merged:=jsonb_set(v_merged,'{when}',COALESCE(v_draft->'when','{}'::jsonb)||(v_patch->'when'),true); END IF;
    IF v_patch?'settings' THEN v_merged:=jsonb_set(v_merged,'{settings}',COALESCE(v_draft->'settings','{}'::jsonb)||(v_patch->'settings'),true); END IF;
    IF COALESCE(jsonb_array_length(COALESCE(v_merged->'tickets','[]'::jsonb)),0)<>0
       OR COALESCE((v_merged->>'isRsvp')::boolean,true)<>true THEN
      RAISE EXCEPTION 'rsvp_ticket_wall' USING ERRCODE='22023';
    END IF;
    v_suggested:=NULLIF(v_merged->>'rsvpContributionSuggestedCents','')::integer;
    v_minimum:=NULLIF(v_merged->>'rsvpContributionMinCents','')::integer;
    IF (v_suggested IS NOT NULL AND v_suggested<=0)
       OR (v_minimum IS NOT NULL AND v_minimum<=0)
       OR (v_suggested IS NOT NULL AND v_minimum IS NOT NULL AND v_suggested<v_minimum) THEN
      RAISE EXCEPTION 'rsvp_contribution_amount_invalid' USING ERRCODE='22023';
    END IF;
    v_theme:=jsonb_set(COALESCE(v.theme,'{}'::jsonb),'{business_draft}',v_merged,true);
    UPDATE public.events SET
      title=COALESCE(NULLIF(btrim(p_payload->>'title'),''),v.title),
      description=CASE WHEN p_payload?'description' THEN NULLIF(p_payload->>'description','') ELSE v.description END,
      location_text=CASE WHEN p_payload?'location_text' THEN NULLIF(p_payload->>'location_text','') ELSE v.location_text END,
      online_url=CASE WHEN p_payload?'online_url' THEN NULLIF(p_payload->>'online_url','') ELSE v.online_url END,
      cover_media_url=CASE WHEN v_keep_cover THEN v.cover_media_url WHEN p_payload?'cover_media_url' THEN NULLIF(p_payload->>'cover_media_url','') ELSE v.cover_media_url END,
      cover_media_poster_url=CASE WHEN v_keep_cover THEN v.cover_media_poster_url WHEN p_payload?'cover_media_poster_url' THEN NULLIF(p_payload->>'cover_media_poster_url','') ELSE v.cover_media_poster_url END,
      cover_media_type=CASE WHEN v_keep_cover THEN v.cover_media_type WHEN p_payload?'cover_media_type' THEN NULLIF(p_payload->>'cover_media_type','') ELSE v.cover_media_type END,
      cover_media_provider=CASE WHEN v_keep_cover THEN v.cover_media_provider WHEN p_payload?'cover_media_provider' THEN NULLIF(p_payload->>'cover_media_provider','') ELSE v.cover_media_provider END,
      cover_media_source_url=CASE WHEN v_keep_cover THEN v.cover_media_source_url WHEN p_payload?'cover_media_source_url' THEN NULLIF(p_payload->>'cover_media_source_url','') ELSE v.cover_media_source_url END,
      cover_media_credit=CASE WHEN v_keep_cover THEN v.cover_media_credit WHEN p_payload?'cover_media_credit' THEN NULLIF(p_payload->>'cover_media_credit','') ELSE v.cover_media_credit END,
      cover_media_credit_url=CASE WHEN v_keep_cover THEN v.cover_media_credit_url WHEN p_payload?'cover_media_credit_url' THEN NULLIF(p_payload->>'cover_media_credit_url','') ELSE v.cover_media_credit_url END,
      cover_media_alt=CASE WHEN v_keep_cover THEN v.cover_media_alt WHEN p_payload?'cover_media_alt' THEN NULLIF(p_payload->>'cover_media_alt','') ELSE v.cover_media_alt END,
      cover_media_gallery=CASE WHEN p_payload?'cover_media_gallery' THEN p_payload->'cover_media_gallery' ELSE v.cover_media_gallery END,
      timezone=COALESCE(NULLIF(p_payload->>'timezone',''),v.timezone),
      is_online=CASE WHEN v_patch?'format' THEN (v_patch->>'format') IN ('online','hybrid') ELSE v.is_online END,
      theme=v_theme,
      party_types=CASE WHEN v_patch?'partyTypes' THEN ARRAY(SELECT jsonb_array_elements_text(v_patch->'partyTypes')) ELSE v.party_types END,
      vibe_tags=CASE WHEN v_patch?'vibeTags' THEN ARRAY(SELECT jsonb_array_elements_text(v_patch->'vibeTags')) ELSE v.vibe_tags END,
      music_genres=CASE WHEN v_patch?'musicGenres' THEN ARRAY(SELECT jsonb_array_elements_text(v_patch->'musicGenres')) ELSE v.music_genres END,
      city=CASE WHEN v_patch?'city' THEN NULLIF(v_patch->>'city','') ELSE v.city END,
      -- Where-step pin: written when the save carries it (the wizard always does;
      -- an explicit null clears it with the address). Absent key keeps the row.
      location_geo=CASE WHEN p_payload?'location_geo' THEN NULLIF(p_payload->>'location_geo','')::point ELSE v.location_geo END,
      location_provider_place_id=CASE WHEN p_payload?'location_provider_place_id' THEN public.places_checked_place_id(NULLIF(btrim(p_payload->>'location_provider_place_id'),'')) ELSE v.location_provider_place_id END,
      theme_color_override=CASE WHEN p_payload?'theme_color_override' THEN NULLIF(p_payload->>'theme_color_override','') ELSE v.theme_color_override END,
      theme_font_override=CASE WHEN p_payload?'theme_font_override' THEN NULLIF(p_payload->>'theme_font_override','') ELSE v.theme_font_override END,
      theme_animation_override=CASE WHEN p_payload?'theme_animation_override' THEN NULLIF(p_payload->>'theme_animation_override','') ELSE v.theme_animation_override END,
      theme_gradient_override=CASE WHEN p_payload?'theme_gradient_override' THEN NULLIF(p_payload->>'theme_gradient_override','') ELSE v.theme_gradient_override END,
      currency=COALESCE(NULLIF(upper(COALESCE(p_payload->>'currency',v_patch->>'currency')),''),v.currency),updated_at=now()
    WHERE id=p_event_id;
  ELSE
    IF length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 10 AND 200 THEN
      RAISE EXCEPTION 'rsvp_edit_reason_invalid' USING ERRCODE='22023';
    END IF;
    v_live_payload:=p_payload||jsonb_build_object('title',COALESCE(NULLIF(p_payload->>'title',''),v.title));
    v_update_result:=public.biz_update_live_rsvp(p_event_id,v_live_payload,p_reason);
    UPDATE public.events SET
      party_types=CASE WHEN p_payload?'partyTypes' THEN ARRAY(SELECT jsonb_array_elements_text(p_payload->'partyTypes')) ELSE party_types END,
      vibe_tags=CASE WHEN p_payload?'vibeTags' THEN ARRAY(SELECT jsonb_array_elements_text(p_payload->'vibeTags')) ELSE vibe_tags END,
      music_genres=CASE WHEN p_payload?'musicGenres' THEN ARRAY(SELECT jsonb_array_elements_text(p_payload->'musicGenres')) ELSE music_genres END,
      city=CASE WHEN p_payload?'city' THEN NULLIF(p_payload->>'city','') ELSE city END,
      -- Where-step pin on a published RSVP: a re-picked address sends its
      -- coordinate and precision together; an unrelated edit sends neither.
      location_geo=CASE WHEN p_payload?'location_geo' THEN NULLIF(p_payload->>'location_geo','')::point ELSE location_geo END,
      location_provider_place_id=CASE WHEN p_payload?'location_provider_place_id' THEN public.places_checked_place_id(NULLIF(btrim(p_payload->>'location_provider_place_id'),'')) ELSE location_provider_place_id END,
      coordinate_precision=CASE WHEN p_payload?'location_geo' THEN
        CASE WHEN NULLIF(p_payload->>'location_geo','') IS NOT NULL
              AND p_payload->>'coordinate_precision' IN ('exact','approximate')
             THEN p_payload->>'coordinate_precision' END
        ELSE coordinate_precision END,
      cover_media_gallery=CASE WHEN p_payload?'cover_media_gallery' THEN p_payload->'cover_media_gallery' ELSE cover_media_gallery END
    WHERE id=p_event_id;
  END IF;
  v_result:=public.issue_1977_rsvp_graph(p_event_id);
  IF v_update_result IS NOT NULL THEN
    v_result:=v_result||jsonb_build_object('updateResult',v_update_result);
  END IF;
  IF p_client_request_id IS NOT NULL THEN
    INSERT INTO public.rsvp_domain_operation_receipts(actor_id,operation,client_request_id,event_id,request_hash,result)
    VALUES(v_actor,'update',p_client_request_id,p_event_id,v_hash,v_result);
  END IF;
  RETURN v_result||jsonb_build_object('replayed',false);
END;
$function$;

-- The live-venue change request carries the place id to the admin approval that
-- applies the new coordinates (same statement as lat/lng there).
ALTER TABLE public.venue_listings ADD COLUMN IF NOT EXISTS details_change_place_id text NULL;

-- business_patch_event_taxonomy keeps its signature: a sealed CI capability checks its
-- grants by exact signature, and an overload with one more defaulted argument would make
-- every installed app's named-argument call ambiguous. The live-edit owner
-- business_update_live_event_atomic calls the _with_place copy below (the production
-- body plus the place-id line); clients never call it directly.
-- [TRANSITIONAL] exit: once the minimum Host app version calls _with_place, retire the
-- old function (and its sealed grant check) in one change.
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
    location_provider_place_id = CASE WHEN p_location_lat IS NOT NULL AND p_location_lng IS NOT NULL
                                       AND NULLIF(btrim(COALESCE(p_location_place_id,'')),'') IS NOT NULL
                                  THEN public.places_checked_place_id(p_location_place_id)
                                  ELSE location_provider_place_id END,
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
COMMENT ON FUNCTION public.business_patch_event_taxonomy_with_place(uuid, text, text[], text[], text[], numeric, numeric, text, text, text) IS 'ORCH-0824 hotfix-5 + issue #1363 G2: post-publish event taxonomy/address patch. issue #1363 adds an optional trailing p_coordinate_precision (exact|approximate) written to events.coordinate_precision, tied to the conditional location_geo write (precision written only when a new coordinate is supplied; existing precision preserved otherwise). city_required + the location_geo write are unchanged. SECURITY DEFINER + event_manager+ role check. #4334: copy with p_location_place_id, the picked Google place id written in the same statement as the pin.';

DROP FUNCTION IF EXISTS public.biz_create_venue_listing(uuid, text, text, text, text, double precision, double precision, text, text, text, text, text, text, text, text, jsonb, uuid, text, text, text, text, text);
CREATE OR REPLACE FUNCTION public.biz_create_venue_listing(p_brand_id uuid, p_name text, p_slug text, p_description text, p_google_place_id text, p_lat double precision, p_lng double precision, p_city text, p_country_code text, p_address text, p_venue_category text, p_contact_email text, p_contact_phone text, p_cover_media_url text, p_cover_media_type text, p_hours jsonb, p_place_pool_id uuid DEFAULT NULL::uuid, p_coordinate_precision text DEFAULT ''::text, p_theme_color text DEFAULT ''::text, p_theme_font text DEFAULT ''::text, p_theme_animation text DEFAULT ''::text, p_cover_media_poster_url text DEFAULT ''::text, p_location_place_id text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid;
  v_venue_id uuid;
  v_idx int;
  v_hour jsonb;
  v_cover_url text;
  v_cover_type text;
  v_cover_poster text;
  v_google text;
  v_pool_google text;
  v_coordinate_precision text;
  v_stay_authoring_enabled boolean := false;
  v_theme_color text;
  v_theme_font text;
  v_theme_animation text;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.brands b
    WHERE b.id = p_brand_id AND b.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'brand_not_found';
  END IF;
  IF public.biz_brand_effective_rank_for_caller(p_brand_id)
       < public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF length(trim(coalesce(p_name, ''))) = 0 THEN
    RAISE EXCEPTION 'name_required';
  END IF;
  IF length(trim(coalesce(p_slug, ''))) = 0 THEN
    RAISE EXCEPTION 'slug_required';
  END IF;
  IF trim(p_slug) !~ '^[a-z0-9]{1,32}$' THEN
    RAISE EXCEPTION 'invalid_slug';
  END IF;
  IF p_lat IS NULL OR p_lng IS NULL THEN
    RAISE EXCEPTION 'location_required';
  END IF;
  IF p_hours IS NULL OR jsonb_typeof(p_hours) <> 'array'
     OR jsonb_array_length(p_hours) <> 7 THEN
    RAISE EXCEPTION 'hours_must_have_7_rows';
  END IF;
  IF p_venue_category IS NULL OR p_venue_category NOT IN (
    'restaurant',
    'play',
    'creative_and_arts',
    'stay'
  ) THEN
    RAISE EXCEPTION 'invalid_venue_category';
  END IF;
  IF p_venue_category = 'stay' THEN
    SELECT COALESCE(flag.is_enabled, false)
    INTO v_stay_authoring_enabled
    FROM public.feature_flags flag
    WHERE flag.flag_key = 'STAY_VENUE_AUTHORING';
    IF NOT COALESCE(v_stay_authoring_enabled, false) THEN
      RAISE EXCEPTION 'stay_authoring_disabled';
    END IF;
  END IF;
  v_coordinate_precision := nullif(
    trim(coalesce(p_coordinate_precision, '')),
    ''
  );
  IF v_coordinate_precision IS NOT NULL
     AND v_coordinate_precision NOT IN ('exact', 'approximate') THEN
    v_coordinate_precision := NULL;
  END IF;
  -- issue #1564 — normalise each theme axis INDEPENDENTLY. A bad font must not
  -- discard a good colour: the axes inherit separately by design.
  v_theme_color := nullif(trim(coalesce(p_theme_color, '')), '');
  IF v_theme_color IS NOT NULL AND v_theme_color !~* '^#[0-9a-f]{6}$' THEN
    v_theme_color := NULL;
  END IF;
  v_theme_font := nullif(trim(coalesce(p_theme_font, '')), '');
  IF v_theme_font IS NOT NULL AND NOT public.issue_1023_is_theme_font(v_theme_font) THEN
    v_theme_font := NULL;
  END IF;
  v_theme_animation := nullif(trim(coalesce(p_theme_animation, '')), '');
  IF v_theme_animation IS NOT NULL AND v_theme_animation NOT IN (
    'none','confetti','fireworks','balloons','sparkles',
    'glitter_shower','snowfall','falling_petals','hearts','shimmer_reveal',
    -- issue #1023: the 20 new theme motion slugs
    'streamers',
    'party_shapes',
    'bubbles',
    'champagne',
    'disco_glints',
    'bokeh',
    'golden_dust',
    'neon_pulse',
    'autumn_leaves',
    'fireflies',
    'rain',
    'sun_rays',
    'starry_sky',
    'aurora',
    'lanterns',
    'embers',
    'music_notes',
    'love_burst',
    'rose_petals',
    'love_balloons'
  ) THEN
    v_theme_animation := NULL;
  END IF;
  v_google := nullif(trim(coalesce(p_google_place_id, '')), '');
  IF p_place_pool_id IS NOT NULL THEN
    SELECT p.google_place_id
    INTO v_pool_google
    FROM public.place_pool p
    WHERE p.id = p_place_pool_id AND p.is_active = true;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'place_pool_not_found';
    END IF;
    IF v_google IS NULL OR trim(v_pool_google) IS DISTINCT FROM v_google THEN
      RAISE EXCEPTION 'place_pool_google_place_id_mismatch';
    END IF;
  END IF;
  v_cover_url := nullif(trim(coalesce(p_cover_media_url, '')), '');
  v_cover_type := nullif(trim(coalesce(p_cover_media_type, '')), '');
  IF v_cover_type IS NOT NULL
     AND v_cover_type NOT IN ('image', 'video', 'gif') THEN
    RAISE EXCEPTION 'invalid_cover_media_type';
  END IF;
  IF v_cover_url IS NOT NULL AND v_cover_type IS NULL THEN
    RAISE EXCEPTION 'cover_media_type_required';
  END IF;
  IF v_cover_url IS NULL THEN
    v_cover_type := NULL;
  END IF;
  v_cover_poster := COALESCE(
    nullif(trim(coalesce(p_cover_media_poster_url, '')), ''),
    CASE WHEN v_cover_type = 'image' THEN v_cover_url END
  );
  PERFORM public.assert_cover_media_triplet(
    v_cover_url,
    v_cover_type,
    v_cover_poster
  );

  INSERT INTO public.venue_listings (
    brand_id,
    name,
    slug,
    address,
    google_place_id,
    place_pool_id,
    lat,
    lng,
    city,
    country_code,
    venue_category,
    contact_email,
    contact_phone,
    cover_media_url,
    cover_media_poster_url,
    cover_media_type,
    coordinate_precision,
    theme_color_override,
    theme_font_override,
    theme_animation_override,
    claim_status,
    location_provider_place_id
  ) VALUES (
    p_brand_id,
    trim(p_name),
    trim(p_slug),
    nullif(trim(coalesce(p_address, '')), ''),
    v_google,
    p_place_pool_id,
    p_lat,
    p_lng,
    nullif(trim(coalesce(p_city, '')), ''),
    nullif(trim(coalesce(p_country_code, '')), ''),
    p_venue_category,
    nullif(trim(coalesce(p_contact_email, '')), ''),
    nullif(trim(coalesce(p_contact_phone, '')), ''),
    v_cover_url,
    v_cover_poster,
    v_cover_type,
    v_coordinate_precision,
    v_theme_color,
    v_theme_font,
    v_theme_animation,
    'pending_review',
    public.places_checked_place_id(p_location_place_id)
  )
  RETURNING id INTO v_venue_id;

  FOR v_idx IN 0 .. 6 LOOP
    v_hour := p_hours -> v_idx;
    IF v_hour IS NULL THEN
      RAISE EXCEPTION 'missing_hour_index_%', v_idx;
    END IF;
    INSERT INTO public.brand_hours (
      brand_id,
      venue_id,
      weekday,
      open_time,
      close_time,
      is_closed
    ) VALUES (
      p_brand_id,
      v_venue_id,
      (v_hour ->> 'weekday')::smallint,
      CASE
        WHEN coalesce((v_hour ->> 'is_closed')::boolean, false) THEN NULL
        WHEN v_hour ->> 'open_time' IS NULL
          OR (v_hour ->> 'open_time') = '' THEN NULL
        ELSE (v_hour ->> 'open_time')::time
      END,
      CASE
        WHEN coalesce((v_hour ->> 'is_closed')::boolean, false) THEN NULL
        WHEN v_hour ->> 'close_time' IS NULL
          OR (v_hour ->> 'close_time') = '' THEN NULL
        ELSE (v_hour ->> 'close_time')::time
      END,
      coalesce((v_hour ->> 'is_closed')::boolean, false)
    );
  END LOOP;
  INSERT INTO public.brand_place_pipeline_state (
    brand_id,
    venue_id,
    place_pool_id,
    status,
    stage_status,
    readiness,
    coaching
  ) VALUES (
    p_brand_id,
    v_venue_id,
    p_place_pool_id,
    'draft',
    jsonb_build_object('tier1', 'created'),
    '{}'::jsonb,
    '[]'::jsonb
  )
  ON CONFLICT (venue_id) DO UPDATE
  SET place_pool_id = excluded.place_pool_id,
      status = excluded.status,
      stage_status =
        brand_place_pipeline_state.stage_status || excluded.stage_status,
      updated_at = now();
  PERFORM public.biz_derive_service_periods_from_brand_hours(v_venue_id);
  RETURN v_venue_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.biz_create_venue_listing(uuid, text, text, text, text, double precision, double precision, text, text, text, text, text, text, text, text, jsonb, uuid, text, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.biz_create_venue_listing(uuid, text, text, text, text, double precision, double precision, text, text, text, text, text, text, text, text, jsonb, uuid, text, text, text, text, text, text) TO authenticated, service_role;
COMMENT ON FUNCTION public.biz_create_venue_listing(uuid, text, text, text, text, double precision, double precision, text, text, text, text, text, text, text, text, jsonb, uuid, text, text, text, text, text, text) IS 'Issue #1463: event_manager+ may create pending-review venue listings for their own brand; publication and approval remain separately gated. Issue #1564: + p_theme_color/p_theme_font/p_theme_animation — the venue''s OWN theme, normalised per axis and fail-soft to NULL (inherit the brand) so a stale client can never block a submission over a colour. Issue #1719: the appended poster is validated and inserted atomically with URL/type. #4334: + p_location_place_id (DEFAULT NULL, so installed apps keep working) — the picked Google place id, written in the same statement as the coordinates.';

DROP FUNCTION IF EXISTS public.biz_update_venue_identity_in_review(uuid, text, text, text, text, text, double precision, double precision, text);
CREATE OR REPLACE FUNCTION public.biz_update_venue_identity_in_review(p_venue_id uuid, p_name text DEFAULT NULL::text, p_venue_category text DEFAULT NULL::text, p_address text DEFAULT NULL::text, p_city text DEFAULT NULL::text, p_country_code text DEFAULT NULL::text, p_lat double precision DEFAULT NULL::double precision, p_lng double precision DEFAULT NULL::double precision, p_coordinate_precision text DEFAULT NULL::text, p_location_place_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_venue public.venue_listings%ROWTYPE;
  v_patch jsonb;
BEGIN
  v_venue := public.issue_3386_lock_managed_venue(p_venue_id);
  IF v_venue.claim_status <> 'pending_review' THEN
    RAISE EXCEPTION 'venue_not_in_review' USING ERRCODE = '55000';
  END IF;

  v_patch := public.issue_3386_identity_patch(
    v_venue, p_name, p_venue_category, p_address, p_city, p_country_code,
    p_lat, p_lng, p_coordinate_precision
  );
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
      location_provider_place_id = CASE WHEN v_patch ? 'address' THEN public.places_checked_place_id(p_location_place_id) ELSE location_provider_place_id END
  WHERE id = v_venue.id;

  PERFORM public.issue_3386_sync_business_authored_place(v_venue.id);

  RETURN jsonb_build_object('ok', true, 'venue_id', v_venue.id, 'changed', true, 'applied', v_patch);
END;
$function$;
REVOKE ALL ON FUNCTION public.biz_update_venue_identity_in_review(uuid, text, text, text, text, text, double precision, double precision, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.biz_update_venue_identity_in_review(uuid, text, text, text, text, text, double precision, double precision, text, text) TO authenticated, service_role;
COMMENT ON FUNCTION public.biz_update_venue_identity_in_review(uuid, text, text, text, text, text, double precision, double precision, text, text) IS '#3386 decision 2: event_manager+ edits name, category and address (with pin and precision) directly while the venue is pending_review. The slug never changes. #4334: + p_location_place_id (DEFAULT NULL, so installed apps keep working) — the picked Google place id, written in the same statement as the coordinates.';

DROP FUNCTION IF EXISTS public.biz_submit_venue_details_change_request(uuid, text, text, text, text, text, double precision, double precision, text);
CREATE OR REPLACE FUNCTION public.biz_submit_venue_details_change_request(p_venue_id uuid, p_name text DEFAULT NULL::text, p_venue_category text DEFAULT NULL::text, p_address text DEFAULT NULL::text, p_city text DEFAULT NULL::text, p_country_code text DEFAULT NULL::text, p_lat double precision DEFAULT NULL::double precision, p_lng double precision DEFAULT NULL::double precision, p_coordinate_precision text DEFAULT NULL::text, p_location_place_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_venue public.venue_listings%ROWTYPE;
  v_patch jsonb;
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
      details_change_place_id = CASE WHEN v_patch ? 'address' THEN public.places_checked_place_id(p_location_place_id) END,
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
COMMENT ON FUNCTION public.biz_submit_venue_details_change_request(uuid, text, text, text, text, text, double precision, double precision, text, text) IS '#3386 decision 3: event_manager+ asks Mingla to change a LIVE venue''s name, category or address. The live row is untouched; a new request replaces the previous one. #4334: + p_location_place_id (DEFAULT NULL, so installed apps keep working) — the picked Google place id, written in the same statement as the coordinates.';

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

-- The live-edit owner (the only Host path that writes a published event's pin) calls
-- the _with_place copy with the taxonomy patch's locationProviderPlaceId.

CREATE OR REPLACE FUNCTION public.business_update_live_event_atomic(p_event_id uuid, p_patch jsonb, p_reason text, p_client_revision integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_core jsonb:=COALESCE(p_patch->'core','{}'::jsonb);
  v_core_without_tickets jsonb:=COALESCE(p_patch->'core','{}'::jsonb)-'tickets';
  v_taxonomy jsonb:=p_patch->'taxonomy';
  v_when jsonb:=p_patch->'when';
  v_cover jsonb:=p_patch->'cover';
  v_selection public.event_cover_selections%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_tickets jsonb;
  v_item jsonb;
  v_mode text;
  v_timezone text;
  v_local_when jsonb;
  v_pricing_patch jsonb:='{}'::jsonb;
  v_reason text;   -- issue #3827
  v_notice jsonb;  -- issue #3827 buyer email
BEGIN
  -- issue #3827 — a reason is owed to BUYERS. With none, a blank reason is
  -- recorded as the stated constant; with one or more it is still refused.
  -- The core, tier and when leaves below are unchanged and still validate
  -- what they are handed, which is now the resolved reason.
  v_reason:=public.business_resolve_edit_reason(p_event_id,p_reason);
  IF v_reason IS NULL THEN RAISE EXCEPTION 'invalid_edit_reason';END IF;
  IF v_core ? 'visibility'
     AND COALESCE(v_core->>'visibility','') NOT IN('public','unlisted','private') THEN
    RAISE EXCEPTION 'event_visibility_invalid';
  END IF;
  PERFORM public.business_update_live_event(
    p_event_id,v_core_without_tickets,v_reason,p_client_revision   -- issue #3827
  );
  IF v_core ? 'tickets' THEN
    PERFORM public.business_patch_event_ticket_tiers(
      p_event_id,v_core->'tickets',NULL,NULL,NULL,v_reason   -- issue #3827
    );
  END IF;

  IF v_taxonomy IS NOT NULL THEN
    PERFORM public.business_patch_event_taxonomy_with_place(
      p_event_id,
      v_taxonomy->>'city',
      ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_taxonomy->'partyTypes','[]'::jsonb))),
      ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_taxonomy->'vibeTags','[]'::jsonb))),
      ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_taxonomy->'musicGenres','[]'::jsonb))),
      NULLIF(v_taxonomy#>>'{locationGeo,lat}','')::numeric,
      NULLIF(v_taxonomy#>>'{locationGeo,lng}','')::numeric,
      NULLIF(v_taxonomy->>'locationText',''),
      COALESCE(v_taxonomy->>'coordinatePrecision',''),
      NULLIF(btrim(COALESCE(v_taxonomy->>'locationProviderPlaceId','')),'')
    );
  END IF;

  IF v_when IS NOT NULL THEN
    v_mode:=COALESCE(NULLIF(v_when->>'whenMode',''),'single');
    v_timezone:=COALESCE(NULLIF(v_when->>'timezone',''),
      (SELECT timezone FROM public.events WHERE id=p_event_id),'UTC');
    IF v_mode IN('single','recurring') THEN
      v_local_when:=v_when->'when';
      PERFORM public.business_resolve_event_local_datetime(
        v_local_when->>'date',COALESCE(NULLIF(v_local_when->>'doorsOpen',''),'00:00'),v_timezone
      );
      PERFORM public.business_resolve_event_local_datetime(
        v_local_when->>'date',COALESCE(NULLIF(v_local_when->>'endsAt',''),
          COALESCE(NULLIF(v_local_when->>'doorsOpen',''),'00:00')),v_timezone
      );
    ELSIF v_mode='multi_date' THEN
      FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(v_when->'multiDates','[]'::jsonb)) LOOP
        PERFORM public.business_resolve_event_local_datetime(
          v_item->>'date',COALESCE(NULLIF(v_item->>'startTime',''),'00:00'),v_timezone
        );
        PERFORM public.business_resolve_event_local_datetime(
          v_item->>'date',COALESCE(NULLIF(v_item->>'endTime',''),
            COALESCE(NULLIF(v_item->>'startTime',''),'00:00')),v_timezone
        );
      END LOOP;
    END IF;
    PERFORM public.business_patch_event_when(
      p_event_id,v_when,v_reason,p_client_revision   -- issue #3827
    );
  END IF;

  IF p_patch ? 'theme' THEN
    UPDATE public.events SET
      theme_color_override=NULLIF(p_patch#>>'{theme,color}',''),
      theme_font_override=NULLIF(p_patch#>>'{theme,font}',''),
      theme_animation_override=NULLIF(p_patch#>>'{theme,animation}',''),
      theme_gradient_override=NULLIF(p_patch#>>'{theme,gradient}',''),
      updated_at=now()
    WHERE id=p_event_id;
  END IF;

  IF p_patch ? 'pricing' THEN
    IF p_patch->'pricing' ? 'passTax' THEN
      v_pricing_patch:=v_pricing_patch || jsonb_build_object('pass_tax',p_patch#>'{pricing,passTax}');
    END IF;
    IF p_patch->'pricing' ? 'passMinglaFee' THEN
      v_pricing_patch:=v_pricing_patch || jsonb_build_object('pass_mingla_fee',p_patch#>'{pricing,passMinglaFee}');
    END IF;
    IF p_patch->'pricing' ? 'passServiceFee' THEN
      v_pricing_patch:=v_pricing_patch || jsonb_build_object('pass_service_fee',p_patch#>'{pricing,passServiceFee}');
    END IF;
    PERFORM public.business_patch_pricing_switches(p_event_id,v_pricing_patch);
  END IF;

  IF v_cover IS NOT NULL THEN
    IF COALESCE((v_cover->>'clear')::boolean,false) THEN
      PERFORM public.business_clear_event_cover_media(p_event_id);
    ELSE
      SELECT * INTO v_selection FROM public.event_cover_selections
      WHERE selection_ref=v_cover->>'selectionRef'
        AND user_id=auth.uid() AND event_id=p_event_id
        AND consumed_at IS NULL AND expires_at>now() FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'cover_selection_unverified';END IF;
      PERFORM public.business_set_event_cover_media(
        p_event_id,v_selection.selection_ref,v_selection.media_url,
        v_selection.media_type,v_selection.poster_url,v_selection.provider,
        v_selection.source_url,v_selection.credit,v_selection.credit_url,
        v_selection.alt
      );
    END IF;
  END IF;

  -- issue #3288 — the additional photos. AFTER the cover block, so a save that
  -- removes the cover and edits the gallery keeps the new gallery. The caller
  -- is already authenticated, role-checked and revision-checked by
  -- business_update_live_event above; the column CHECK enforces the array shape.
  IF p_patch ? 'gallery' THEN
    UPDATE public.events SET
      cover_media_gallery=COALESCE(p_patch->'gallery','[]'::jsonb),
      updated_at=now()
    WHERE id=p_event_id;
  END IF;

  SELECT * INTO v_event FROM public.events WHERE id=p_event_id;
  -- issue #3281 — with each tier's extras, so the editor keeps them.
  SELECT COALESCE(jsonb_agg(to_jsonb(tt)||jsonb_build_object('extras',public.issue_3281_tier_extras_json(tt.id))
      ORDER BY tt.display_order,tt.created_at),'[]'::jsonb)
    INTO v_tickets FROM public.ticket_types tt
    WHERE tt.event_id=p_event_id AND tt.deleted_at IS NULL;
  -- issue #3827 buyer email — every write above is done. Record this edit
  -- (who, why, what changed) and decide whether buyers are emailed. A save
  -- made with "refund all and proceed" holds the email. Never raises.
  v_notice:=public.event_edit_notice_flush(
    p_event_id,v_reason,'event',
    COALESCE((v_when->>'acknowledgeSoldImpact')::boolean,false)
  );
  RETURN jsonb_build_object(
    'event',to_jsonb(v_event),'tickets',v_tickets,
    'client_revision',p_client_revision,
    'buyer_notice',v_notice   -- issue #3827 buyer email
  );
END;$function$;

-- Publishing promotes the draft's pin; the id is promoted in the same statement.
-- business_publish_event_draft's base is main's 20280428003645 body: production still
-- runs the pre-#3645 body because that migration is not yet applied there, and copying
-- production would revert #3645. business_publish_rsvp_draft matches production.

CREATE OR REPLACE FUNCTION public.business_publish_event_draft(p_event_id uuid, p_draft_payload jsonb, p_client_revision integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid;
  v_event public.events%ROWTYPE;
  v_brand record;
  v_theme jsonb;
  v_business_draft jsonb;
  v_tickets jsonb;
  v_ticket jsonb;
  v_ticket_type_id uuid; -- issue #3281
  v_title text;
  v_description text;
  v_location_text text;
  v_online_url text;
  v_cover_media_url text;
  v_cover_media_type text;
  v_cover_media_poster_url text;
  v_keep_cover boolean; -- #3439: resolve under the existing event row lock
  v_cover_media_provider text;
  v_cover_media_source_url text;
  v_cover_media_credit text;
  v_cover_media_credit_url text;
  v_cover_media_alt text;
  v_cover_media_gallery jsonb;  -- issue #868 (additive, independent)
  v_timezone text;
  v_visibility text;
  v_currency char(3);
  v_price numeric;
  v_base_slug text;
  v_final_slug text;
  v_suffix integer := 2;
  v_now timestamptz := now();
  v_ticket_rows jsonb;
  v_event_dates_rows jsonb;
  v_when_mode text;
  v_when jsonb;
  v_multi_dates jsonb;
  v_date_iso text;
  v_doors text;
  v_ends text;
  v_start timestamptz;
  v_end timestamptz;
  v_date_entry jsonb;
  v_min_start timestamptz;
  -- ORCH-0824: new locals for taxonomy + city.
  v_city text;
  v_format text;   -- issue #2333
  -- issue #1653 — the wizard's pin was collected and then discarded at publish.
  v_location_geo point;
  v_coordinate_precision text;
  v_location_place_id text;  -- #4334
  v_party_types text[];
  v_vibe_tags text[];
  v_music_genres text[];
  -- ORCH-1075: paid-publish guard locals.
  v_paid_online boolean;
  v_max_end timestamptz;
  -- issue #1014: money-bearing predicate (BROADER than v_paid_online — no
  -- availableAt filter, no isFree shortcut: a paid DOOR ticket has no Stripe
  -- requirement but DOES display money and therefore requires a currency).
  v_money_bearing boolean;
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
    RAISE EXCEPTION 'event_draft_not_found';
  END IF;

  IF v_event.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'event_draft_deleted';
  END IF;

  IF v_event.status <> 'draft' THEN
    RAISE EXCEPTION 'event_draft_not_publishable';
  END IF;

  IF public.biz_brand_effective_rank(v_event.brand_id, v_user_id) < public.biz_role_rank('event_manager'::text) THEN
    RAISE EXCEPTION 'insufficient_event_permission';
  END IF;

  SELECT id, slug, name, default_currency
  INTO v_brand
  FROM public.brands
  WHERE id = v_event.brand_id
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'brand_not_found';
  END IF;

  v_theme := COALESCE(p_draft_payload->'theme', '{}'::jsonb);
  v_business_draft := COALESCE(v_theme->'business_draft', '{}'::jsonb);
  v_tickets := COALESCE(v_business_draft->'tickets', '[]'::jsonb);
  -- issue #3281 — a client that predates day lists cannot widen a ticket.
  v_tickets := public.issue_3281_keep_draft_day_lists(v_tickets,
    (SELECT e.theme#>'{business_draft,tickets}' FROM public.events e WHERE e.id = p_event_id));
  -- issue #1014 delta (1): the 'GBP' fabrication is REMOVED — v_currency may
  -- now be NULL (currency-less brand, no draft override). Trigger (c) is
  -- authoritative: it stamps a resolvable brand currency or NULLs a free-only
  -- publish; the explicit gate below fail-closes money-bearing publishes.
  v_currency := upper(COALESCE(
    NULLIF(v_business_draft->>'currency', ''),
    NULLIF(p_draft_payload->>'currency', ''),
    v_brand.default_currency::text
  ))::char(3);

  -- issue #1014 delta (2): whitelist gains NGN (NG Paystack brands stamp
  -- brands.default_currency='NGN' at onboard) and runs only for a known
  -- currency — NULL means "no currency yet", not "unsupported currency".
  -- issue #3645: public.supported_brand_currencies owns the list; this
  -- function asks the shared helper and carries no list of its own.
  IF v_currency IS NOT NULL
     AND NOT public.is_supported_offering_currency(v_currency::text) THEN
    RAISE EXCEPTION 'event_currency_unsupported';
  END IF;

  v_title := NULLIF(btrim(COALESCE(p_draft_payload->>'title', '')), '');
  IF v_title IS NULL THEN
    RAISE EXCEPTION 'event_title_required';
  END IF;

  IF jsonb_typeof(v_tickets) IS DISTINCT FROM 'array' OR jsonb_array_length(v_tickets) = 0 THEN
    RAISE EXCEPTION 'event_ticket_required';
  END IF;

  FOR v_ticket IN SELECT value FROM jsonb_array_elements(v_tickets)
  LOOP
    IF NULLIF(btrim(COALESCE(v_ticket->>'name', '')), '') IS NULL THEN
      RAISE EXCEPTION 'ticket_name_required';
    END IF;

    v_price := COALESCE(
      NULLIF(v_ticket->>'priceMajor', '')::numeric,
      NULLIF(v_ticket->>'price', '')::numeric,
      NULLIF(v_ticket->>'priceGbp', '')::numeric,
      0
    );

    IF COALESCE((v_ticket->>'isFree')::boolean, false) = true THEN
      IF v_price <> 0 THEN
        RAISE EXCEPTION 'free_ticket_price_must_be_zero';
      END IF;
    ELSE
      IF v_price < 0 THEN
        RAISE EXCEPTION 'ticket_price_cannot_be_negative';
      END IF;
      -- issue #3645: a paid ticket with no price (or one that rounds to 0)
      -- would go live at 0. The wizard refuses it; the server now does too.
      IF round(v_price * 100) <= 0 THEN
        RAISE EXCEPTION 'paid_ticket_price_required' USING ERRCODE = '22023';
      END IF;
    END IF;
    IF COALESCE((v_ticket->>'isUnlimited')::boolean, false) = false
      AND COALESCE((v_ticket->>'capacity')::integer, 0) <= 0
    THEN
      RAISE EXCEPTION 'ticket_capacity_required';
    END IF;
    IF NULLIF(COALESCE(v_ticket->>'password', ''), '') IS NOT NULL THEN
      RAISE EXCEPTION 'ticket_plaintext_password_forbidden';
    END IF;
  END LOOP;

  -- ORCH-0824: read new taxonomy + city fields and validate.
  v_city := NULLIF(btrim(COALESCE(v_business_draft->>'city', '')), '');
  v_format := lower(NULLIF(btrim(COALESCE(v_business_draft->>'format', '')), ''));
  v_party_types := COALESCE(
    (SELECT array_agg(value::text)
     FROM jsonb_array_elements_text(COALESCE(v_business_draft->'partyTypes', '[]'::jsonb))),
    ARRAY[]::text[]
  );
  v_vibe_tags := COALESCE(
    (SELECT array_agg(value::text)
     FROM jsonb_array_elements_text(COALESCE(v_business_draft->'vibeTags', '[]'::jsonb))),
    ARRAY[]::text[]
  );
  v_music_genres := COALESCE(
    (SELECT array_agg(value::text)
     FROM jsonb_array_elements_text(COALESCE(v_business_draft->'musicGenres', '[]'::jsonb))),
    ARRAY[]::text[]
  );

  -- issue #2333 — an ONLINE-ONLY event has no city and the wizard renders no
  -- field that could set one (CreatorStep3Where.tsx:138-140 gates the ONLY
  -- writer of city behind in_person|hybrid), so demanding one here made every
  -- online publish impossible while the client said "Ready to publish".
  -- Keyed on business_draft.format, the SAME node v_city is read from, and NOT
  -- on p_draft_payload.is_online — is_online is TRUE for HYBRID too
  -- (serverDraftEventMapper.ts:708), and hybrid genuinely has a city that
  -- validateWhere:382-406 requires. Absent/unknown format FAILS CLOSED.
  IF v_city IS NULL AND v_format IS DISTINCT FROM 'online' THEN
    RAISE EXCEPTION 'city_required';
  END IF;

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
    'electronic-edm','house','hiphop-rap','pop','rock','latin','afrobeats',
    'afro-house','amapiano','gospel','rnb-soul','disco-funk','reggae-dancehall',
    'indie','country','jazz','classical','mixed-variety'
  ]::text[]) THEN
    RAISE EXCEPTION 'music_genres_not_canonical';
  END IF;

  v_visibility := CASE COALESCE(v_business_draft->>'requestedVisibility', 'public')
    WHEN 'private' THEN 'private'
    WHEN 'unlisted' THEN 'hidden'
    ELSE 'public'
  END;

  -- #1931 Amendment 1 §3 / Amendment 3 §5 released item 6 — the legacy-Private-draft
  -- publish block. This is the AUTHORITATIVE half: the client hook blocks too, but
  -- deleting the client block cannot admit a Private publish because this raises.
  --
  -- It is evaluated BEFORE any write, so a denied publish mutates nothing.
  --
  -- DELIBERATE, CONTRACT-MANDATED BEHAVIOUR CHANGE AT READINESS FALSE, and the only one
  -- in the released set. Today this function publishes visibility='private' UNGUARDED,
  -- which creates an offering no guest has a working access path to — the exact defect
  -- #1931 is named after. Amendment 1 §3 requires the server to "independently return
  -- typed private_access_not_ready", and Amendment 3 §5 frozen item 2 freezes anything
  -- that PERMITS Private publication. Non-private publishes are bit-identical.
  IF v_visibility = 'private' AND NOT public.issue_1931_private_event_access_ready() THEN
    RAISE EXCEPTION 'private_access_not_ready';
  END IF;

  v_base_slug := lower(regexp_replace(v_title, '[^a-zA-Z0-9]+', '-', 'g'));
  v_base_slug := regexp_replace(v_base_slug, '(^-+|-+$)', '', 'g');
  IF v_base_slug = '' OR v_base_slug LIKE 'draft-%' THEN
    v_base_slug := 'event';
  END IF;
  v_final_slug := v_base_slug;

  WHILE EXISTS (
    SELECT 1
    FROM public.events e
    WHERE e.brand_id = v_event.brand_id
      AND e.deleted_at IS NULL
      AND e.id <> p_event_id
      AND lower(e.slug) = lower(v_final_slug)
  ) LOOP
    v_final_slug := v_base_slug || '-' || v_suffix::text;
    v_suffix := v_suffix + 1;
  END LOOP;

  v_description := NULLIF(p_draft_payload->>'description', '');
  v_location_text := NULLIF(p_draft_payload->>'location_text', '');

  -- issue #1653 — promote the coordinate the wizard already captured. Mirrors
  -- business_patch_event_taxonomy exactly, including point(LNG, LAT) argument
  -- order. When the payload carries no coordinate we KEEP whatever the row
  -- already holds, so publishing can never erase a pin a later edit set.
  IF (p_draft_payload->'locationGeo'->>'lat') IS NOT NULL
     AND (p_draft_payload->'locationGeo'->>'lng') IS NOT NULL THEN
    v_location_geo := point(
      (p_draft_payload->'locationGeo'->>'lng')::double precision,
      (p_draft_payload->'locationGeo'->>'lat')::double precision
    );
    -- Normalise the token so the coordinate_precision CHECK only ever sees
    -- 'exact' | 'approximate' | NULL — a stale client cannot break publish.
    v_coordinate_precision := NULLIF(
      btrim(COALESCE(p_draft_payload->>'coordinatePrecision', '')), ''
    );
    IF v_coordinate_precision NOT IN ('exact', 'approximate') THEN
      v_coordinate_precision := NULL;
    END IF;
    -- #4334: the picked Google place id rides with the promoted pin.
    v_location_place_id := CASE WHEN p_draft_payload ? 'locationProviderPlaceId'
      THEN public.places_checked_place_id(p_draft_payload->>'locationProviderPlaceId') ELSE (SELECT e.location_provider_place_id FROM public.events e WHERE e.id = p_event_id) END;
  ELSE
    SELECT e.location_geo, e.coordinate_precision, e.location_provider_place_id
      INTO v_location_geo, v_coordinate_precision, v_location_place_id
      FROM public.events e WHERE e.id = p_event_id;
  END IF;
  v_online_url := NULLIF(p_draft_payload->>'online_url', '');
  v_cover_media_url := NULLIF(p_draft_payload->>'cover_media_url', '');
  v_cover_media_type := NULLIF(p_draft_payload->>'cover_media_type', '');
  v_cover_media_provider := NULLIF(p_draft_payload->>'cover_media_provider', '');
  v_cover_media_source_url := NULLIF(p_draft_payload->>'cover_media_source_url', '');
  v_cover_media_credit := NULLIF(p_draft_payload->>'cover_media_credit', '');
  v_cover_media_credit_url := NULLIF(p_draft_payload->>'cover_media_credit_url', '');
  v_cover_media_alt := NULLIF(p_draft_payload->>'cover_media_alt', '');
  -- #3439: validate explicit input exactly as the poster wrapper did, then
  -- resolve all cover fields together against the locked row. Validation must
  -- not disappear when a stale URL is protected.
  v_cover_media_poster_url := COALESCE(NULLIF(p_draft_payload->>'cover_media_poster_url', ''),
    CASE WHEN v_cover_media_type = 'image' THEN v_cover_media_url END);
  PERFORM public.assert_cover_media_triplet(
    v_cover_media_url, v_cover_media_type, v_cover_media_poster_url);
  v_keep_cover := (CASE WHEN p_draft_payload ? '__coverBase' THEN
      v_cover_media_url IS NOT DISTINCT FROM NULLIF(p_draft_payload->>'__coverBase','')
      AND v_event.cover_media_url IS DISTINCT FROM NULLIF(p_draft_payload->>'__coverBase','')
    ELSE
      v_event.cover_media_url IS NOT NULL
      AND v_cover_media_url IS DISTINCT FROM v_event.cover_media_url
      AND EXISTS (SELECT 1 FROM public.event_cover_video_jobs j
        WHERE j.event_id = p_event_id AND j.target_kind = 'event'
          AND j.apply_mode = 'draft_auto' AND j.status = 'applied'
          AND j.processed_url = v_event.cover_media_url
          AND j.applied_at >= v_event.updated_at)
    END);
  IF v_keep_cover THEN
    v_cover_media_url := v_event.cover_media_url;
    v_cover_media_type := v_event.cover_media_type;
    v_cover_media_poster_url := v_event.cover_media_poster_url;
    v_cover_media_provider := v_event.cover_media_provider;
    v_cover_media_source_url := v_event.cover_media_source_url;
    v_cover_media_credit := v_event.cover_media_credit;
    v_cover_media_credit_url := v_event.cover_media_credit_url;
    v_cover_media_alt := v_event.cover_media_alt;
  END IF;
  PERFORM public.assert_cover_media_triplet(
    v_cover_media_url, v_cover_media_type, v_cover_media_poster_url);
  -- issue #868 — ADDITIVE + INDEPENDENT: read the extra-photos gallery; it is
  -- NOT nulled when the cover url is absent (a photo gallery coexists with any
  -- cover, incl. a video cover). Default [] preserves single-cover behavior.
  -- issue #3288 — an ABSENT key keeps the stored gallery; a PRESENT key
  -- (including an explicit []) is written exactly as before.
  v_cover_media_gallery := CASE WHEN p_draft_payload ? 'cover_media_gallery'
    THEN COALESCE(p_draft_payload->'cover_media_gallery', '[]'::jsonb)
    ELSE COALESCE(v_event.cover_media_gallery, '[]'::jsonb) END;
  IF v_cover_media_url IS NULL THEN
    v_cover_media_type := NULL;
    v_cover_media_provider := NULL;
    v_cover_media_source_url := NULL;
    v_cover_media_credit := NULL;
    v_cover_media_credit_url := NULL;
    v_cover_media_alt := NULL;
  END IF;
  v_timezone := COALESCE(NULLIF(p_draft_payload->>'timezone', ''), v_event.timezone, 'UTC');

  v_when_mode := COALESCE(NULLIF(v_business_draft->>'whenMode', ''), 'single');
  v_when := v_business_draft->'when';
  v_multi_dates := v_business_draft->'multiDates';

  IF v_when_mode NOT IN ('single', 'multi_date', 'recurring') THEN
    RAISE EXCEPTION 'event_date_required';
  END IF;

  DELETE FROM public.event_dates WHERE event_id = p_event_id;

  IF v_when_mode IN ('single', 'recurring') THEN
    v_date_iso := NULLIF(v_when->>'date', '');
    IF v_date_iso IS NULL THEN
      RAISE EXCEPTION 'event_date_required';
    END IF;
    v_doors := COALESCE(NULLIF(v_when->>'doorsOpen', ''), '00:00');
    v_ends := COALESCE(NULLIF(v_when->>'endsAt', ''), v_doors);
    v_start := (v_date_iso || ' ' || v_doors || ':00')::timestamp AT TIME ZONE v_timezone;
    v_end := (v_date_iso || ' ' || v_ends || ':00')::timestamp AT TIME ZONE v_timezone;
    IF v_end <= v_start THEN
      v_end := v_end + INTERVAL '1 day';
    END IF;
    INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)
    VALUES (p_event_id, v_start, v_end, v_timezone, true);

    -- issue #3313 — A RECURRING EVENT GETS EVERY DATE ITS RULE DESCRIBES.
    -- This branch used to stop at the master row above, so "every Tuesday, 8
    -- times" published ONE Tuesday: the rule was only copied onto the event
    -- row. The #1138 expander (52-date cap, master = date #1, same local start
    -- time and length) has always been type-agnostic; experiences called it and
    -- events never did. The rule expanded is the SAME value written to
    -- events.recurrence_rules below, so the stored rule and the dates cannot
    -- disagree. DELETE THIS BLOCK and a recurring event sells one night only.
    IF v_when_mode = 'recurring'
       AND jsonb_typeof(p_draft_payload->'recurrence_rules') = 'object' THEN
      PERFORM public.pg_expand_experience_recurrence(
        p_event_id, v_start, v_end, p_draft_payload->'recurrence_rules', v_timezone
      );
    END IF;

  ELSIF v_when_mode = 'multi_date' THEN
    IF v_multi_dates IS NULL
      OR jsonb_typeof(v_multi_dates) IS DISTINCT FROM 'array'
      OR jsonb_array_length(v_multi_dates) = 0
    THEN
      RAISE EXCEPTION 'event_date_required';
    END IF;

    SELECT min(
      (entry->>'date' || ' ' || COALESCE(NULLIF(entry->>'startTime', ''), '00:00') || ':00')::timestamp AT TIME ZONE v_timezone
    )
    INTO v_min_start
    FROM jsonb_array_elements(v_multi_dates) entry
    WHERE NULLIF(entry->>'date', '') IS NOT NULL;

    IF v_min_start IS NULL THEN
      RAISE EXCEPTION 'event_date_required';
    END IF;

    FOR v_date_entry IN SELECT value FROM jsonb_array_elements(v_multi_dates)
    LOOP
      v_date_iso := NULLIF(v_date_entry->>'date', '');
      IF v_date_iso IS NULL THEN
        RAISE EXCEPTION 'event_date_required';
      END IF;
      v_doors := COALESCE(NULLIF(v_date_entry->>'startTime', ''), '00:00');
      v_ends := COALESCE(NULLIF(v_date_entry->>'endTime', ''), v_doors);
      v_start := (v_date_iso || ' ' || v_doors || ':00')::timestamp AT TIME ZONE v_timezone;
      v_end := (v_date_iso || ' ' || v_ends || ':00')::timestamp AT TIME ZONE v_timezone;
      IF v_end <= v_start THEN
        v_end := v_end + INTERVAL '1 day';
      END IF;
      INSERT INTO public.event_dates (
        event_id, start_at, end_at, timezone, is_master,
        override_title, override_location
      ) VALUES (
        p_event_id, v_start, v_end, v_timezone, v_start = v_min_start,
        NULLIF(left(btrim(COALESCE(
          v_date_entry #>> '{overrides,title}',
          v_date_entry->>'overrideTitle',
          ''
        )), 120), ''),
        NULLIF(left(btrim(COALESCE(
          v_date_entry #>> '{overrides,venueName}',
          v_date_entry->>'overrideLocation',
          ''
        )), 120), '')
      );
    END LOOP;
    -- issue #3281 — the organiser's day id is the stable key a ticket scopes to.
    PERFORM public.issue_3281_sync_occurrence_keys(p_event_id, v_multi_dates);
  END IF;

  -- ORCH-1075 paid-publish integrity guards (event publish path) ---------
  -- PAID = a ticket about to be written that is online-sellable
  -- (availableAt in ('online','both')) AND has price_cents > 0. In-person-only
  -- paid tickets (availableAt='door') and FREE tickets are exempt: they cannot
  -- reach the buyer-web/native checkout 409, so Guard A is N/A (operator-confirmed
  -- 2026-06-04). Mirror the checkout readiness predicate + reject past-dated paid
  -- publishes BEFORE the status flips to scheduled.
  --   Stripe charges_enabled: https://docs.stripe.com/api/accounts/object
  --   Finish onboarding:      https://docs.stripe.com/connect/onboarding.md
  SELECT bool_or(
           COALESCE((t->>'availableAt'), 'both') IN ('online', 'both')
           AND NOT COALESCE((t->>'isFree')::boolean, false)
           AND round(
                 COALESCE(
                   NULLIF(t->>'priceMajor', '')::numeric,
                   NULLIF(t->>'price', '')::numeric,
                   NULLIF(t->>'priceGbp', '')::numeric,
                   0
                 ) * 100
               ) > 0
         )
    INTO v_paid_online
    FROM jsonb_array_elements(v_tickets) t;

  IF COALESCE(v_paid_online, false) THEN
    -- Collection + past-date stay online-only (door money cannot hit checkout 409).
    IF NOT public.pg_brand_can_collect(v_event.brand_id) THEN
      -- TRANSITIONAL wire alias; remove only under cleanup issue #1922:
      -- https://github.com/Mingla-LLC/mingla-main/issues/1922
      RAISE EXCEPTION 'stripe_charges_disabled';
    END IF;
    SELECT max(ed.end_at) INTO v_max_end
      FROM public.event_dates ed
     WHERE ed.event_id = p_event_id;
    IF v_max_end IS NULL OR v_max_end <= v_now THEN
      RAISE EXCEPTION 'offering_date_past';
    END IF;
  END IF;

  -- issue #1014 deltas (3)+(4) — money-bearing predicate + explicit currency
  -- gate, grouped with the ORCH-1075 guards (before the events write). ANY
  -- ticket priced > 0 (online OR door, isFree flag irrelevant — price is
  -- truth) makes the publish money-bearing; money without a resolvable
  -- currency fails close HERE for error locality (the trigger remains the
  -- backstop for undeclared paths).
  SELECT bool_or(
           round(
             COALESCE(
               NULLIF(t->>'priceMajor', '')::numeric,
               NULLIF(t->>'price', '')::numeric,
               NULLIF(t->>'priceGbp', '')::numeric,
               0
             ) * 100
           ) > 0
         )
    INTO v_money_bearing
    FROM jsonb_array_elements(v_tickets) t;

  -- #3645 PR11d — Organiser Terms 1.0 on ANY money-bearing publish (door-only
  -- included). Matches the app gate (positive price, not online-only). Free
  -- path skips. Collection/date guards above stay online-only.
  IF COALESCE(v_money_bearing, false) THEN
    PERFORM public.biz_require_current_organiser_terms(v_event.brand_id);
  END IF;

  IF COALESCE(v_money_bearing, false) AND v_currency IS NULL THEN
    RAISE EXCEPTION 'event_currency_required';
  END IF;

  PERFORM set_config('mingla.business_publish_event_draft', 'on', true);
  -- issue #1014 delta (5): declare the moneyless transition to
  -- tg_require_event_brand_currency (transaction-scoped flag).
  IF NOT COALESCE(v_money_bearing, false) THEN
    PERFORM set_config('mingla.publish_free_only', 'on', true);
  END IF;

  -- ORCH-0824: write the four new top-level columns + strip taxonomy keys
  -- and deprecated 'category' from business_event JSONB so the same data
  -- is not stored in two places.
  UPDATE public.events
  SET
    title = v_title,
    description = v_description,
    slug = v_final_slug,
    location_text = v_location_text,
    online_url = v_online_url,
    cover_media_url = v_cover_media_url,
    cover_media_type = v_cover_media_type,
    cover_media_poster_url = v_cover_media_poster_url,
    cover_media_provider = v_cover_media_provider,
    cover_media_source_url = v_cover_media_source_url,
    cover_media_credit = v_cover_media_credit,
    cover_media_credit_url = v_cover_media_credit_url,
    cover_media_alt = v_cover_media_alt,
    cover_media_gallery = v_cover_media_gallery,
    is_online = COALESCE((p_draft_payload->>'is_online')::boolean, false),
    is_recurring = COALESCE((p_draft_payload->>'is_recurring')::boolean, false),
    is_multi_date = COALESCE((p_draft_payload->>'is_multi_date')::boolean, false),
    recurrence_rules = p_draft_payload->'recurrence_rules',
    theme = (v_theme - 'business_draft') || jsonb_build_object(
      'business_event',
      (v_business_draft
        - 'tickets'
        - 'category'      -- ORCH-0824: deprecated; promoted to party_types column
        - 'partyTypes'    -- ORCH-0824: promoted to party_types column
        - 'vibeTags'      -- ORCH-0824: promoted to vibe_tags column
        - 'musicGenres'   -- ORCH-0824: promoted to music_genres column
        - 'city'          -- ORCH-0824: promoted to city column
        - 'locationGeo'   -- ORCH-0824: cached client-side only
      ) || jsonb_build_object('currency', v_currency::text),
      'coverHue',
      COALESCE(v_business_draft->'coverHue', v_theme->'coverHue', '25'::jsonb)
    ),
    currency = v_currency,
    status = 'scheduled',
    visibility = v_visibility,
    published_at = v_now,
    timezone = v_timezone,
    -- ORCH-0824: new top-level columns
    city = v_city,
    location_geo = v_location_geo,              -- issue #1653
    coordinate_precision = v_coordinate_precision,  -- issue #1653
    location_provider_place_id = v_location_place_id,  -- #4334
    party_types = v_party_types,
    vibe_tags = v_vibe_tags,
    music_genres = v_music_genres,
    updated_at = v_now
  WHERE id = p_event_id
    AND status = 'draft'
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'event_draft_not_publishable';
  END IF;

  UPDATE public.ticket_types
  SET deleted_at = v_now, updated_at = v_now
  WHERE event_id = p_event_id
    AND deleted_at IS NULL;

  FOR v_ticket IN SELECT value FROM jsonb_array_elements(v_tickets)
  LOOP
    v_price := COALESCE(
      NULLIF(v_ticket->>'priceMajor', '')::numeric,
      NULLIF(v_ticket->>'price', '')::numeric,
      NULLIF(v_ticket->>'priceGbp', '')::numeric,
      0
    );

    INSERT INTO public.ticket_types (
      valid_occurrence_keys,
      event_id, name, description, price_cents, currency,
      quantity_total, is_unlimited, is_free,
      sale_start_at, sale_end_at,
      min_purchase_qty, max_purchase_qty,
      is_hidden, is_disabled, requires_approval, allow_transfers,
      password_protected, password_hash,
      available_online, available_in_person,
      waitlist_enabled, display_order, deleted_at
    ) VALUES (
      public.issue_3281_draft_ticket_scope(v_ticket, v_when_mode, v_multi_dates),
      p_event_id,
      btrim(v_ticket->>'name'),
      NULLIF(v_ticket->>'description', ''),
      CASE
        WHEN COALESCE((v_ticket->>'isFree')::boolean, false) THEN 0
        ELSE round(v_price * 100)::integer
      END,
      v_currency,
      CASE
        WHEN COALESCE((v_ticket->>'isUnlimited')::boolean, false) THEN NULL
        ELSE COALESCE((v_ticket->>'capacity')::integer, 0)
      END,
      COALESCE((v_ticket->>'isUnlimited')::boolean, false),
      COALESCE((v_ticket->>'isFree')::boolean, false),
      NULLIF(v_ticket->>'saleStartAt', '')::timestamptz,
      NULLIF(v_ticket->>'saleEndAt', '')::timestamptz,
      COALESCE((v_ticket->>'minPurchaseQty')::integer, 1),
      NULLIF(v_ticket->>'maxPurchaseQty', '')::integer,
      COALESCE(v_ticket->>'visibility', 'public') = 'hidden',
      COALESCE(v_ticket->>'visibility', 'public') = 'disabled',
      COALESCE((v_ticket->>'approvalRequired')::boolean, false),
      COALESCE((v_ticket->>'allowTransfers')::boolean, true),
      COALESCE((v_ticket->>'passwordProtected')::boolean, false),
      NULL,
      COALESCE(v_ticket->>'availableAt', 'both') IN ('online', 'both'),
      COALESCE(v_ticket->>'availableAt', 'both') IN ('door', 'both'),
      COALESCE((v_ticket->>'waitlistEnabled')::boolean, false),
      COALESCE((v_ticket->>'displayOrder')::integer, 0),
      NULL
    ) RETURNING id INTO v_ticket_type_id;
    -- issue #3281 — the tier's extras, inside its dates.
    PERFORM public.issue_3281_publish_tier_extras(
      v_ticket_type_id, v_ticket, v_when_mode, v_multi_dates,
      (SELECT tt.valid_occurrence_keys FROM public.ticket_types tt WHERE tt.id = v_ticket_type_id));
  END LOOP;

  SELECT COALESCE(jsonb_agg(to_jsonb(tt) ORDER BY tt.display_order), '[]'::jsonb)
  INTO v_ticket_rows
  FROM public.ticket_types tt
  WHERE tt.event_id = p_event_id
    AND tt.deleted_at IS NULL;

  SELECT *
  INTO v_event
  FROM public.events
  WHERE id = p_event_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(ed) ORDER BY ed.start_at), '[]'::jsonb)
  INTO v_event_dates_rows
  FROM public.event_dates ed
  WHERE ed.event_id = p_event_id;

  RETURN jsonb_build_object(
    'event', to_jsonb(v_event),
    'brand', jsonb_build_object(
      'id', v_brand.id,
      'slug', v_brand.slug,
      'name', v_brand.name
    ),
    'tickets', v_ticket_rows,
    'eventDates', v_event_dates_rows,
    'client_revision', p_client_revision
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.business_publish_rsvp_draft(p_event_id uuid, p_draft_payload jsonb, p_client_revision integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid;
  v_event public.events%ROWTYPE;
  v_brand record;
  v_theme jsonb;
  v_business_draft jsonb;
  v_title text;
  v_description text;
  v_location_text text;
  v_online_url text;
  v_cover_media_url text;
  v_cover_media_type text;
  v_cover_media_provider text;
  v_cover_media_source_url text;
  v_cover_media_credit text;
  v_cover_media_credit_url text;
  v_cover_media_alt text;
  v_cover_media_gallery jsonb;  -- issue #868 (additive, independent)
  v_timezone text;
  v_visibility text;
  v_base_slug text;
  v_final_slug text;
  v_suffix integer := 2;
  v_now timestamptz := now();
  v_event_dates_rows jsonb;
  v_when jsonb;
  v_date_iso text;
  v_doors text;
  v_ends text;
  v_start timestamptz;
  v_end timestamptz;
  v_city text;
  v_party_types text[];
  v_vibe_tags text[];
  v_music_genres text[];
  -- RSVP host-control locals.
  v_rsvp_capacity integer;
  v_rsvp_allow_plus_ones boolean;
  v_rsvp_plus_ones_max integer;
  v_rsvp_waitlist_enabled boolean;
  v_rsvp_approval_mode text;
  v_rsvp_discoverable boolean;
  -- ORCH-1291 — voluntary chip-in config.
  v_rsvp_contribution_enabled boolean;
  v_rsvp_contribution_suggested_cents integer;
  v_rsvp_contribution_min_cents integer;
  -- Where-step pin — the coordinate the organiser picked, and how it was captured.
  v_location_geo point;
  v_coordinate_precision text;
  v_location_place_id text;  -- #4334
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT * INTO v_event FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'event_draft_not_found';
  END IF;
  IF v_event.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'event_draft_deleted';
  END IF;
  IF v_event.status <> 'draft' THEN
    RAISE EXCEPTION 'event_draft_not_publishable';
  END IF;
  IF public.biz_brand_effective_rank(v_event.brand_id, v_user_id) < public.biz_role_rank('event_manager'::text) THEN
    RAISE EXCEPTION 'insufficient_event_permission';
  END IF;

  SELECT id, slug, name, default_currency INTO v_brand
    FROM public.brands WHERE id = v_event.brand_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'brand_not_found';
  END IF;

  v_theme := COALESCE(p_draft_payload->'theme', '{}'::jsonb);
  v_business_draft := COALESCE(v_theme->'business_draft', '{}'::jsonb);

  v_title := NULLIF(btrim(COALESCE(p_draft_payload->>'title', '')), '');
  IF v_title IS NULL THEN
    RAISE EXCEPTION 'event_title_required';
  END IF;

  -- Taxonomy (party-type gate KEPT — steering #2). City NOT required (freeform).
  v_city := NULLIF(btrim(COALESCE(v_business_draft->>'city', '')), '');
  v_party_types := COALESCE(
    (SELECT array_agg(value::text)
     FROM jsonb_array_elements_text(COALESCE(v_business_draft->'partyTypes', '[]'::jsonb))),
    ARRAY[]::text[]);
  v_vibe_tags := COALESCE(
    (SELECT array_agg(value::text)
     FROM jsonb_array_elements_text(COALESCE(v_business_draft->'vibeTags', '[]'::jsonb))),
    ARRAY[]::text[]);
  v_music_genres := COALESCE(
    (SELECT array_agg(value::text)
     FROM jsonb_array_elements_text(COALESCE(v_business_draft->'musicGenres', '[]'::jsonb))),
    ARRAY[]::text[]);

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
    'electronic-edm','house','hiphop-rap','pop','rock','latin','afrobeats',
    'afro-house','amapiano','gospel','rnb-soul','disco-funk','reggae-dancehall',
    'indie','country','jazz','classical','mixed-variety'
  ]::text[]) THEN
    RAISE EXCEPTION 'music_genres_not_canonical';
  END IF;

  -- RSVP host-control reads.
  v_rsvp_capacity := NULLIF(v_business_draft->>'rsvpCapacity', '')::integer;
  v_rsvp_allow_plus_ones := COALESCE((v_business_draft->>'rsvpAllowPlusOnes')::boolean, false);
  v_rsvp_plus_ones_max := COALESCE((v_business_draft->>'rsvpPlusOnesMax')::integer, 0);
  v_rsvp_waitlist_enabled := COALESCE((v_business_draft->>'rsvpWaitlistEnabled')::boolean, false);
  v_rsvp_approval_mode := COALESCE(NULLIF(v_business_draft->>'rsvpApprovalMode', ''), 'auto');
  IF v_rsvp_approval_mode NOT IN ('auto', 'manual') THEN
    RAISE EXCEPTION 'rsvp_approval_mode_invalid';
  END IF;
  v_rsvp_discoverable := COALESCE((v_business_draft->>'rsvpDiscoverable')::boolean, false);

  -- ORCH-1291 — voluntary chip-in config reads (nullable; absent → disabled/NULL).
  v_rsvp_contribution_enabled := COALESCE((v_business_draft->>'rsvpContributionEnabled')::boolean, false);
  v_rsvp_contribution_suggested_cents := NULLIF(v_business_draft->>'rsvpContributionSuggestedCents', '')::integer;
  v_rsvp_contribution_min_cents := NULLIF(v_business_draft->>'rsvpContributionMinCents', '')::integer;

  -- ORCH-1291 — CONDITIONAL provider-aware bank-gate. ONLY when chip-in is
  -- enabled does the RSVP become a money-collector requiring a connected payout
  -- rail. pg_brand_can_collect is PROVIDER-AWARE (Stripe charges_enabled OR
  -- Paystack subaccount) — reusing the Stripe-only pg_brand_can_charge here would
  -- wrongly block every NGN brand (investigation F-4/D-1). A FREE RSVP
  -- (enabled=false) is NEVER gated (SC-6). Raises the ORCH-1075-recognized
  -- 'stripe_charges_disabled' reason so paidPublishGuards routes to bank setup.
  IF v_rsvp_contribution_enabled AND NOT public.pg_brand_can_collect(v_event.brand_id) THEN
    RAISE EXCEPTION 'stripe_charges_disabled'
      USING HINT = 'RSVP chip-in is enabled but the brand cannot collect (no connected bank / subaccount).';
  END IF;

  v_visibility := CASE COALESCE(v_business_draft->>'requestedVisibility', 'public')
    WHEN 'private' THEN 'private'
    WHEN 'unlisted' THEN 'hidden'
    ELSE 'public'
  END;
  -- A private RSVP can never be on a public discovery feed.
  IF v_visibility = 'private' THEN
    v_rsvp_discoverable := false;
  END IF;

  -- Slug.
  v_base_slug := lower(regexp_replace(v_title, '[^a-zA-Z0-9]+', '-', 'g'));
  v_base_slug := regexp_replace(v_base_slug, '(^-+|-+$)', '', 'g');
  IF v_base_slug = '' OR v_base_slug LIKE 'draft-%' THEN
    v_base_slug := 'rsvp';
  END IF;
  v_final_slug := v_base_slug;
  WHILE EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.brand_id = v_event.brand_id AND e.deleted_at IS NULL
      AND e.id <> p_event_id AND lower(e.slug) = lower(v_final_slug)
  ) LOOP
    v_final_slug := v_base_slug || '-' || v_suffix::text;
    v_suffix := v_suffix + 1;
  END LOOP;

  v_description := NULLIF(p_draft_payload->>'description', '');
  v_location_text := NULLIF(p_draft_payload->>'location_text', '');

  -- Where-step pin — promote the coordinate the wizard captured, exactly as
  -- #1653 does for ticketed events (point(LNG, LAT) argument order). An RSVP
  -- publish reads the STORED draft blob (issue_1977_current_rsvp_publish_payload
  -- hands theme.business_draft through), so the pin lives at
  -- business_draft.locationGeo. When the blob carries no coordinate we KEEP what
  -- the row already holds, so publishing never erases a pin.
  IF (v_business_draft->'locationGeo'->>'lat') IS NOT NULL
     AND (v_business_draft->'locationGeo'->>'lng') IS NOT NULL THEN
    v_location_geo := point(
      (v_business_draft->'locationGeo'->>'lng')::double precision,
      (v_business_draft->'locationGeo'->>'lat')::double precision
    );
    -- Normalise so the coordinate_precision CHECK only ever sees
    -- 'exact' | 'approximate' | NULL — an older client cannot break publish.
    v_coordinate_precision := NULLIF(
      btrim(COALESCE(v_business_draft->>'coordinatePrecision', '')), ''
    );
    IF v_coordinate_precision NOT IN ('exact', 'approximate') THEN
      v_coordinate_precision := NULL;
    END IF;
    -- #4334: the picked Google place id rides with the promoted pin.
    v_location_place_id := CASE WHEN v_business_draft ? 'locationProviderPlaceId'
      THEN public.places_checked_place_id(v_business_draft->>'locationProviderPlaceId') ELSE v_event.location_provider_place_id END;
  ELSE
    v_location_geo := v_event.location_geo;
    v_location_place_id := v_event.location_provider_place_id;
    v_coordinate_precision := v_event.coordinate_precision;
  END IF;
  v_online_url := NULLIF(p_draft_payload->>'online_url', '');
  v_cover_media_url := NULLIF(p_draft_payload->>'cover_media_url', '');
  v_cover_media_type := NULLIF(p_draft_payload->>'cover_media_type', '');
  v_cover_media_provider := NULLIF(p_draft_payload->>'cover_media_provider', '');
  v_cover_media_source_url := NULLIF(p_draft_payload->>'cover_media_source_url', '');
  v_cover_media_credit := NULLIF(p_draft_payload->>'cover_media_credit', '');
  v_cover_media_credit_url := NULLIF(p_draft_payload->>'cover_media_credit_url', '');
  v_cover_media_alt := NULLIF(p_draft_payload->>'cover_media_alt', '');
  -- issue #868 — ADDITIVE + INDEPENDENT extra-photos gallery (never nulled by
  -- the cover-absent branch; default [] = single-cover behavior).
  -- issue #3288 — an ABSENT key keeps the stored gallery; a PRESENT key
  -- (including an explicit []) is written exactly as before.
  v_cover_media_gallery := CASE WHEN p_draft_payload ? 'cover_media_gallery'
    THEN COALESCE(p_draft_payload->'cover_media_gallery', '[]'::jsonb)
    ELSE COALESCE(v_event.cover_media_gallery, '[]'::jsonb) END;
  IF v_cover_media_url IS NULL THEN
    v_cover_media_type := NULL; v_cover_media_provider := NULL;
    v_cover_media_source_url := NULL; v_cover_media_credit := NULL;
    v_cover_media_credit_url := NULL; v_cover_media_alt := NULL;
  END IF;
  v_timezone := COALESCE(NULLIF(p_draft_payload->>'timezone', ''), v_event.timezone, 'UTC');

  -- Single-date only (steering #4).
  v_when := v_business_draft->'when';
  v_date_iso := NULLIF(v_when->>'date', '');
  IF v_date_iso IS NULL THEN
    RAISE EXCEPTION 'event_date_required';
  END IF;
  v_doors := COALESCE(NULLIF(v_when->>'doorsOpen', ''), '00:00');
  v_ends := COALESCE(NULLIF(v_when->>'endsAt', ''), v_doors);
  v_start := (v_date_iso || ' ' || v_doors || ':00')::timestamp AT TIME ZONE v_timezone;
  v_end := (v_date_iso || ' ' || v_ends || ':00')::timestamp AT TIME ZONE v_timezone;
  IF v_end <= v_start THEN
    v_end := v_end + INTERVAL '1 day';
  END IF;

  -- Discoverable RSVPs must be future-dated (no dead deck card). Link-only is
  -- allowed same-day. NO stripe gate for FREE RSVPs (moneyless).
  IF v_rsvp_discoverable AND v_end <= v_now THEN
    RAISE EXCEPTION 'offering_date_past';
  END IF;

  DELETE FROM public.event_dates WHERE event_id = p_event_id;
  INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)
  VALUES (p_event_id, v_start, v_end, v_timezone, true);

  -- Permit the draft->scheduled slug finalization (ORCH-0763 trigger).
  PERFORM set_config('mingla.business_publish_event_draft', 'on', true);
  -- issue #1014 — an RSVP is money-bearing ONLY when chip-in is enabled
  -- (RSVPs create ZERO ticket rows). Chip-in OFF → declare the moneyless
  -- transition so tg_require_event_brand_currency permits a NULL published
  -- currency for a currency-less brand. Chip-in ON on a can_collect brand
  -- whose currency still does not resolve hits the trigger's strict path →
  -- event_currency_required (actionable client copy).
  IF NOT v_rsvp_contribution_enabled THEN
    PERFORM set_config('mingla.publish_free_only', 'on', true);
  END IF;

  UPDATE public.events
  SET
    event_type = 'rsvp',
    title = v_title,
    description = v_description,
    slug = v_final_slug,
    location_text = v_location_text,
    online_url = v_online_url,
    cover_media_url = v_cover_media_url,
    cover_media_type = v_cover_media_type,
    cover_media_provider = v_cover_media_provider,
    cover_media_source_url = v_cover_media_source_url,
    cover_media_credit = v_cover_media_credit,
    cover_media_credit_url = v_cover_media_credit_url,
    cover_media_alt = v_cover_media_alt,
    cover_media_gallery = v_cover_media_gallery,
    is_online = COALESCE((p_draft_payload->>'is_online')::boolean, false),
    is_recurring = false,
    is_multi_date = false,
    recurrence_rules = NULL,
    theme = (v_theme - 'business_draft') || jsonb_build_object(
      'business_event',
      (v_business_draft
        - 'tickets' - 'category' - 'partyTypes' - 'vibeTags' - 'musicGenres'
        - 'city' - 'locationGeo'),
      'coverHue',
      COALESCE(v_business_draft->'coverHue', v_theme->'coverHue', '25'::jsonb)
    ),
    status = 'scheduled',
    visibility = v_visibility,
    published_at = v_now,
    timezone = v_timezone,
    city = v_city,
    location_geo = v_location_geo,                  -- Where-step pin
    coordinate_precision = v_coordinate_precision,  -- Where-step pin
    location_provider_place_id = v_location_place_id,  -- #4334
    party_types = v_party_types,
    vibe_tags = v_vibe_tags,
    music_genres = v_music_genres,
    rsvp_capacity = v_rsvp_capacity,
    rsvp_allow_plus_ones = v_rsvp_allow_plus_ones,
    rsvp_plus_ones_max = CASE WHEN v_rsvp_allow_plus_ones THEN GREATEST(v_rsvp_plus_ones_max, 0) ELSE 0 END,
    rsvp_waitlist_enabled = v_rsvp_waitlist_enabled,
    rsvp_approval_mode = v_rsvp_approval_mode,
    rsvp_discoverable = v_rsvp_discoverable,
    -- ORCH-1291 — persist the voluntary chip-in config.
    rsvp_contribution_enabled = v_rsvp_contribution_enabled,
    rsvp_contribution_suggested_cents = v_rsvp_contribution_suggested_cents,
    rsvp_contribution_min_cents = v_rsvp_contribution_min_cents,
    updated_at = v_now
  WHERE id = p_event_id AND status = 'draft' AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'event_draft_not_publishable';
  END IF;

  -- An RSVP creates ZERO ticket_types (I-PROPOSED-1150-RSVP-NO-TICKET-ROWS).
  -- Defensive: soft-delete any stray ticket rows from a mis-routed draft.
  UPDATE public.ticket_types
     SET deleted_at = v_now, updated_at = v_now
   WHERE event_id = p_event_id AND deleted_at IS NULL;

  SELECT * INTO v_event FROM public.events WHERE id = p_event_id;
  SELECT COALESCE(jsonb_agg(to_jsonb(ed) ORDER BY ed.start_at), '[]'::jsonb)
    INTO v_event_dates_rows
    FROM public.event_dates ed WHERE ed.event_id = p_event_id;

  RETURN jsonb_build_object(
    'event', to_jsonb(v_event),
    'brand', jsonb_build_object('id', v_brand.id, 'slug', v_brand.slug, 'name', v_brand.name),
    'tickets', '[]'::jsonb,
    'eventDates', v_event_dates_rows,
    'client_revision', p_client_revision
  );
END;
$function$;


-- =====================================================================================
-- A-1: pg_public_event_by_slug returns googlePlaceId. Current production body, plus the
-- column and one key. Withheld exactly when the street is (a place id IS the address).
-- The function stays a registered #2489 carrier (row restated below, append-only).
-- =====================================================================================

CREATE OR REPLACE FUNCTION public.pg_public_event_by_slug(p_brand_slug text, p_event_slug text)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$WITH issue_3281_original(payload) AS MATERIALIZED (
WITH issue_3872_original(payload) AS MATERIALIZED (

  WITH ev AS (
    SELECT
      e.id,
      e.brand_id,
      e.title,
      e.description,
      e.slug              AS event_slug,
      e.event_type,
      e.location_text,
      e.online_url,
      e.is_online,
      e.status,
      e.published_at,
      e.timezone,
      e.currency,
      e.cover_media_url,
      e.cover_media_type,
      e.cover_media_provider,
      e.cover_media_source_url,
      e.cover_media_credit,
      e.cover_media_credit_url,
      e.cover_media_alt,
      e.cover_media_gallery,
      e.party_types,
      e.vibe_tags,
      e.music_genres,
      e.city,
      e.location_geo,
      e.location_provider_place_id,
      e.city_geo,
      e.theme_color_override,
      e.theme_font_override,
      e.theme_animation_override,
      e.theme_gradient_override,
      public.issue_2489_public_theme(e.theme) AS public_theme,
      ed.start_at AS master_start_at,
      ed.end_at   AS master_end_at,
      ed.timezone AS master_timezone,
      -- hide_address_until_ticket lives in theme.business_event (jsonb), not a
      -- real column. Default TRUE when absent — mirrors the service mapper
      -- (publicEventViewRowToEvent: asBoolean(..., true)) so a legacy row never
      -- leaks the street.
      public.issue_2489_address_withheld(e.theme) AS hide_address_until_ticket,
      b.id            AS brand_id_b,
      b.slug          AS brand_slug,
      b.name          AS brand_name,
      b.profile_photo_url AS brand_profile_photo_url,
      b.theme_color   AS brand_theme_color,
      b.theme_font    AS brand_theme_font,
      b.theme_animation AS brand_theme_animation,
      b.theme_gradient AS brand_theme_gradient,
      COALESCE(e.pass_mingla_fee,  b.default_pass_mingla_fee)  AS pass_mingla_fee,
      COALESCE(e.pass_service_fee, b.default_pass_service_fee) AS pass_service_fee,
      b.pricing_currency AS pricing_currency
    FROM public.events e
    JOIN public.brands b ON b.id = e.brand_id
    LEFT JOIN public.event_dates ed
           ON ed.event_id = e.id AND ed.is_master = true
    WHERE b.slug = p_brand_slug
      AND e.slug = p_event_slug
      AND e.event_type = 'event'           -- standard ticketed ONLY (SPEC scope)
      AND e.visibility = 'public'::text
      AND e.deleted_at IS NULL
      AND b.deleted_at IS NULL
      AND e.status = ANY (ARRAY['scheduled'::text, 'live'::text, 'ended'::text, 'cancelled'::text])
      AND NOT public.issue_1931_event_ordinary_read_blocked(e.id)
    LIMIT 1
  ),
  tix AS (
    SELECT
      tt.id,
      tt.name,
      tt.description,
      tt.price_cents,
      tt.currency,
      tt.quantity_total,
      tt.is_unlimited,
      tt.is_free,
      tt.sale_start_at,
      tt.sale_end_at,
      tt.is_hidden,
      tt.is_disabled,
      tt.requires_approval,
      tt.password_protected,
      tt.available_online,
      tt.available_in_person,
      tt.waitlist_enabled,
      tt.display_order,
      -- server all-in (WYSIWYP) — SAME compute_all_in_cents single owner as
      -- pg_public_event_tier_allin. Free / zero-price tier → 0.
      CASE
        WHEN COALESCE(tt.is_free, false) OR COALESCE(tt.price_cents, 0) = 0 THEN 0
        ELSE public.compute_all_in_cents(
               tt.price_cents,
               ev.pass_mingla_fee,
               ev.pass_service_fee,
               (SELECT r.effective_take_rate_bps
                  FROM public.resolve_effective_take_rate_bps(ev.brand_id) AS r)
             )
      END AS all_in_cents,
      -- remaining capacity (GREATEST(total - sold, 0)); NULL for unlimited.
      -- Sold formula matches pg_public_ticket_types_remaining (ORCH-0946) EXACTLY:
      -- COUNT of tickets rows with status IN ('valid','used','transferred').
      CASE
        WHEN COALESCE(tt.is_unlimited, false) THEN NULL
        WHEN tt.quantity_total IS NULL THEN NULL
        ELSE GREATEST(
          0,
          tt.quantity_total - COALESCE((
            SELECT COUNT(*)::integer
            FROM public.tickets t
            WHERE t.ticket_type_id = tt.id
              AND t.status IN ('valid', 'used', 'transferred')
          ), 0)
        )
      END AS remaining
    FROM public.ticket_types tt
    JOIN ev ON ev.id = tt.event_id
    WHERE tt.deleted_at IS NULL
      AND tt.available_online = true
      AND COALESCE(tt.is_hidden, false) = false
  )
  SELECT
    CASE WHEN ev.id IS NULL THEN NULL ELSE json_build_object(
      'id', ev.id,
      'brandId', ev.brand_id,
      'brandSlug', ev.brand_slug,
      'eventSlug', ev.event_slug,
      'name', ev.title,
      'description', COALESCE(ev.description, ''),
      'masterStartAt', ev.master_start_at,
      'masterEndAt', ev.master_end_at,
      'timezone', COALESCE(ev.master_timezone, ev.timezone),
      'status', ev.status,
      'isOnline', ev.is_online,
      'onlineUrl', ev.online_url,
      'venueName', CASE
        WHEN ev.hide_address_until_ticket
          THEN NULLIF((ev.public_theme #>> '{business_event,location,venueName}'), '')
        ELSE COALESCE(NULLIF((ev.public_theme #>> '{business_event,location,venueName}'), ''), ev.location_text)
      END,
      -- PRIVACY: address + exact pin omitted (NULL) when the street is hidden.
      'address', CASE
        WHEN ev.hide_address_until_ticket THEN NULL
        ELSE COALESCE(NULLIF((ev.public_theme #>> '{business_event,location,address}'), ''), ev.location_text)
      END,
      'hideAddressUntilTicket', ev.hide_address_until_ticket,
      'format', (ev.public_theme #>> '{business_event,format}'),
      'city', ev.city,
      -- exact pin: NULL when hidden; else {lat,lng} from the point.
      'locationGeo', CASE
        WHEN ev.hide_address_until_ticket OR ev.location_geo IS NULL THEN NULL
        ELSE json_build_object(
          'lat', ST_Y(ev.location_geo::geometry),
          'lng', ST_X(ev.location_geo::geometry)
        )
      END,
      -- #4334: the picked Google place id, withheld with the street.
      'googlePlaceId', CASE
        WHEN ev.hide_address_until_ticket THEN NULL
        ELSE ev.location_provider_place_id
      END,
      -- city-level centroid: always returned when present (privacy-safe).
      'cityGeo', CASE
        WHEN ev.city_geo IS NULL THEN NULL
        ELSE json_build_object(
          'lat', ST_Y(ev.city_geo),
          'lng', ST_X(ev.city_geo)
        )
      END,
      'coverMediaUrl', ev.cover_media_url,
      'coverMediaType', ev.cover_media_type,
      'coverMediaAlt', ev.cover_media_alt,
      'coverGallery', COALESCE(ev.cover_media_gallery, '[]'::jsonb),
      'coverMediaProvider', ev.cover_media_provider,
      'coverMediaCredit', ev.cover_media_credit,
      'currency', COALESCE(ev.pricing_currency, ev.currency, 'usd'),
      'partyTypes', COALESCE(ev.party_types, ARRAY[]::text[]),
      'vibeTags', COALESCE(ev.vibe_tags, ARRAY[]::text[]),
      'musicGenres', COALESCE(ev.music_genres, ARRAY[]::text[]),
      'themeColorOverride', ev.theme_color_override,
      'themeFontOverride', ev.theme_font_override,
      'themeAnimationOverride', ev.theme_animation_override,
      'themeGradientOverride', ev.theme_gradient_override,
      'brand', json_build_object(
        'id', ev.brand_id_b,
        'slug', ev.brand_slug,
        'name', ev.brand_name,
        'profilePhotoUrl', ev.brand_profile_photo_url,
        'themeColor', ev.brand_theme_color,
        'themeFont', ev.brand_theme_font,
        'themeAnimation', ev.brand_theme_animation,
        'themeGradient', ev.brand_theme_gradient
      ),
      'tickets', COALESCE((
        SELECT json_agg(json_build_object(
          'id', tix.id,
          'name', tix.name,
          'description', tix.description,
          'priceCents', tix.price_cents,
          'allInCents', tix.all_in_cents,
          'currency', tix.currency,
          'capacity', tix.quantity_total,
          'remaining', tix.remaining,
          'isUnlimited', tix.is_unlimited,
          'isFree', tix.is_free,
          'saleStartAt', tix.sale_start_at,
          'saleEndAt', tix.sale_end_at,
          'isHidden', tix.is_hidden,
          'isDisabled', tix.is_disabled,
          'requiresApproval', tix.requires_approval,
          'passwordProtected', tix.password_protected,
          'availableOnline', tix.available_online,
          'availableInPerson', tix.available_in_person,
          'waitlistEnabled', tix.waitlist_enabled,
          'displayOrder', tix.display_order
        ) ORDER BY tix.display_order ASC)
        FROM tix
      ), '[]'::json)
    ) END
  FROM ev
)
SELECT public.issue_3872_enrich_public_ticket_payload(payload,'tickets','id',NULL) FROM issue_3872_original
)
SELECT public.issue_3281_attach_public_extras(payload) FROM issue_3281_original;$function$;

INSERT INTO public.issue_2489_gate_carriers (object_name, object_kind)
VALUES ('pg_public_event_by_slug', 'function') ON CONFLICT (object_name) DO NOTHING;

COMMIT;
