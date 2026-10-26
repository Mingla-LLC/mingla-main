BEGIN;

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS destination_place_key text,
  ADD COLUMN IF NOT EXISTS destination_city text,
  ADD COLUMN IF NOT EXISTS destination_country_code char(2),
  ADD COLUMN IF NOT EXISTS departure_place_key text,
  ADD COLUMN IF NOT EXISTS departure_city text,
  ADD COLUMN IF NOT EXISTS departure_country_code char(2);

ALTER TABLE public.events DROP CONSTRAINT IF EXISTS events_trip_place_trip_only;
ALTER TABLE public.events ADD CONSTRAINT events_trip_place_trip_only CHECK (
  event_type = 'trip' OR (
    destination_place_key IS NULL AND destination_city IS NULL AND destination_country_code IS NULL
    AND departure_place_key IS NULL AND departure_city IS NULL AND departure_country_code IS NULL
  )
);
ALTER TABLE public.events DROP CONSTRAINT IF EXISTS events_trip_place_country_codes;
ALTER TABLE public.events ADD CONSTRAINT events_trip_place_country_codes CHECK (
  (destination_country_code IS NULL OR destination_country_code ~ '^[A-Z]{2}$')
  AND (departure_country_code IS NULL OR departure_country_code ~ '^[A-Z]{2}$')
);

CREATE INDEX IF NOT EXISTS idx_events_trip_destination_place
  ON public.events (destination_place_key)
  WHERE event_type = 'trip' AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_events_trip_departure_place
  ON public.events (departure_place_key)
  WHERE event_type = 'trip' AND deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.issue_4073_trip_place_from_theme()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  v_trip jsonb;
  v_city text;
  v_country text;
BEGIN
  IF NEW.event_type IS DISTINCT FROM 'trip' THEN
    NEW.destination_place_key := NULL;
    NEW.destination_city := NULL;
    NEW.destination_country_code := NULL;
    NEW.departure_place_key := NULL;
    NEW.departure_city := NULL;
    NEW.departure_country_code := NULL;
    RETURN NEW;
  END IF;

  v_trip := COALESCE(NEW.theme->'business_trip', '{}'::jsonb);
  v_city := NULLIF(pg_catalog.btrim(v_trip->>'destinationCity'), '');
  v_country := pg_catalog.upper(NULLIF(pg_catalog.btrim(v_trip->>'destinationCountryCode'), ''));
  IF v_city IS NULL OR v_country IS NULL OR v_country !~ '^[A-Z]{2}$' THEN
    NEW.destination_place_key := NULL;
    NEW.destination_city := NULL;
    NEW.destination_country_code := NULL;
  ELSE
    NEW.destination_city := v_city;
    NEW.destination_country_code := v_country;
    NEW.destination_place_key := public.mingla_normalize_place_name(v_city) || '|' || v_country;
  END IF;

  v_city := NULLIF(pg_catalog.btrim(v_trip->>'departureCity'), '');
  v_country := pg_catalog.upper(NULLIF(pg_catalog.btrim(v_trip->>'departureCountryCode'), ''));
  IF v_city IS NULL OR v_country IS NULL OR v_country !~ '^[A-Z]{2}$' THEN
    NEW.departure_place_key := NULL;
    NEW.departure_city := NULL;
    NEW.departure_country_code := NULL;
  ELSE
    NEW.departure_city := v_city;
    NEW.departure_country_code := v_country;
    NEW.departure_place_key := public.mingla_normalize_place_name(v_city) || '|' || v_country;
  END IF;
  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.issue_4073_trip_place_from_theme() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.issue_4073_trip_place_from_theme() FROM PUBLIC;

DROP TRIGGER IF EXISTS issue_4073_trip_place_from_theme ON public.events;
CREATE TRIGGER issue_4073_trip_place_from_theme
  BEFORE INSERT OR UPDATE OF theme, event_type ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.issue_4073_trip_place_from_theme();

UPDATE public.events SET theme = theme
WHERE event_type = 'trip' AND deleted_at IS NULL;

COMMIT;
