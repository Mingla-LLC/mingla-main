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
--   3. biz_set_location_place_id: a Host save attaches the picked place id after
--      its normal save RPC (no surgery on the large publish/edit RPCs).
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
     AND p_id ~ '^[A-Za-z0-9_-]{10,256}$'
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

-- ── 4. Host saves attach the picked place id ────────────────────────────────
-- Called by the Host app right after its normal save RPC, so the large
-- publish/edit RPCs stay untouched. A null id clears it (free-text address).
-- The stamp trigger does the bookkeeping.
CREATE OR REPLACE FUNCTION public.biz_set_location_place_id(
  p_target text, p_row_id uuid, p_place_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_brand uuid;
  v_place text := NULLIF(btrim(COALESCE(p_place_id, '')), '');
  v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;
  IF p_target NOT IN ('event', 'venue_listing', 'brand') OR p_row_id IS NULL THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_target';
  END IF;
  IF v_place IS NOT NULL AND NOT public.places_is_google_place_id(v_place) THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_place_id';
  END IF;

  IF p_target = 'event' THEN
    SELECT brand_id INTO v_brand FROM public.events WHERE id = p_row_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
    IF public.biz_brand_effective_rank(v_brand, v_user) < public.biz_role_rank('event_manager'::text) THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
    UPDATE public.events SET location_provider_place_id = v_place WHERE id = p_row_id;
  ELSIF p_target = 'venue_listing' THEN
    SELECT brand_id INTO v_brand FROM public.venue_listings WHERE id = p_row_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
    IF public.biz_brand_effective_rank(v_brand, v_user) < public.biz_role_rank('brand_admin'::text) THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
    UPDATE public.venue_listings SET location_provider_place_id = v_place WHERE id = p_row_id;
  ELSE
    SELECT id INTO v_brand FROM public.brands WHERE id = p_row_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
    IF public.biz_brand_effective_rank(v_brand, v_user) < public.biz_role_rank('brand_admin'::text) THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
    UPDATE public.brands SET location_provider_place_id = v_place WHERE id = p_row_id;
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.biz_set_location_place_id(text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.biz_set_location_place_id(text, uuid, text) TO authenticated, service_role;

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
-- or written (D9). p_result: 'ok' (p_lat/p_lng set only when the pin moved,
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
      location_geo_refreshed_at = CASE WHEN v_ok THEN now() ELSE location_geo_refreshed_at END,
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
          v_side || 'GeoRefreshedAt', to_jsonb(now()),
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
      geo_refreshed_at = CASE WHEN v_ok THEN now() ELSE geo_refreshed_at END,
      geo_refresh_state = p_result,
      geo_refresh_failures = CASE WHEN v_ok THEN 0 ELSE LEAST(geo_refresh_failures + 1, 32767) END
     WHERE id = p_row_id AND place_id = p_expected_place_id;
  ELSIF p_kind = 'venue_listing' THEN
    UPDATE public.venue_listings SET
      location_provider_place_id = CASE WHEN v_ok THEN v_id ELSE location_provider_place_id END,
      lat = CASE WHEN v_ok AND v_move THEN p_lat ELSE lat END,
      lng = CASE WHEN v_ok AND v_move THEN p_lng ELSE lng END,
      location_geo_refreshed_at = CASE WHEN v_ok THEN now() ELSE location_geo_refreshed_at END,
      location_geo_refresh_state = p_result,
      location_geo_refresh_failures = CASE WHEN v_ok THEN 0
        ELSE LEAST(location_geo_refresh_failures + 1, 32767) END
     WHERE id = p_row_id AND location_provider_place_id = p_expected_place_id;
  ELSIF p_kind = 'brand' THEN
    UPDATE public.brands SET
      location_provider_place_id = CASE WHEN v_ok THEN v_id ELSE location_provider_place_id END,
      lat = CASE WHEN v_ok AND v_move THEN p_lat ELSE lat END,
      lng = CASE WHEN v_ok AND v_move THEN p_lng ELSE lng END,
      location_geo_refreshed_at = CASE WHEN v_ok THEN now() ELSE location_geo_refreshed_at END,
      location_geo_refresh_state = p_result,
      location_geo_refresh_failures = CASE WHEN v_ok THEN 0
        ELSE LEAST(location_geo_refresh_failures + 1, 32767) END
     WHERE id = p_row_id AND location_provider_place_id = p_expected_place_id;
  ELSIF p_kind = 'pref_custom' THEN
    UPDATE public.preferences SET
      custom_location_place_id = CASE WHEN v_ok THEN v_id ELSE custom_location_place_id END,
      custom_lat = CASE WHEN v_ok AND v_move THEN p_lat ELSE custom_lat END,
      custom_lng = CASE WHEN v_ok AND v_move THEN p_lng ELSE custom_lng END,
      custom_location_geo_refreshed_at = CASE WHEN v_ok THEN now() ELSE custom_location_geo_refreshed_at END,
      custom_location_geo_refresh_state = p_result,
      custom_location_geo_refresh_failures = CASE WHEN v_ok THEN 0
        ELSE LEAST(custom_location_geo_refresh_failures + 1, 32767) END
     WHERE profile_id = p_row_id AND custom_location_place_id = p_expected_place_id;
  ELSIF p_kind = 'pref_discover' THEN
    UPDATE public.preferences SET
      discover_city_place_id = CASE WHEN v_ok THEN v_id ELSE discover_city_place_id END,
      discover_city_lat = CASE WHEN v_ok AND v_move THEN p_lat::numeric ELSE discover_city_lat END,
      discover_city_lng = CASE WHEN v_ok AND v_move THEN p_lng::numeric ELSE discover_city_lng END,
      discover_city_geo_refreshed_at = CASE WHEN v_ok THEN now() ELSE discover_city_geo_refreshed_at END,
      discover_city_geo_refresh_state = p_result,
      discover_city_geo_refresh_failures = CASE WHEN v_ok THEN 0
        ELSE LEAST(discover_city_geo_refresh_failures + 1, 32767) END
     WHERE profile_id = p_row_id AND discover_city_place_id = p_expected_place_id;
  ELSIF p_kind = 'chat_plan' THEN
    UPDATE public.chat_plans SET
      provider_place_id = CASE WHEN v_ok THEN v_id ELSE provider_place_id END,
      place_lat = CASE WHEN v_ok AND v_move THEN p_lat ELSE place_lat END,
      place_lng = CASE WHEN v_ok AND v_move THEN p_lng ELSE place_lng END,
      place_geo_refreshed_at = CASE WHEN v_ok THEN now() ELSE place_geo_refreshed_at END,
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

SELECT cron.unschedule('places-coordinate-refresh-daily')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'places-coordinate-refresh-daily');

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

COMMIT;
