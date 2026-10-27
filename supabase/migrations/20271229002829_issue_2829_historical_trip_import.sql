-- #2829 W5 (amendment A1.3) — a brand's trips from before Mingla become real
-- Mingla trips: ended, public, with their real past dates, never bookable.
--
-- Why a separate path: every normal way to create a trip (the Business trip
-- creator, then `business_publish_trip_draft`) refuses dates that have passed,
-- and must keep refusing them. A brand moving its history onto Mingla has
-- trips that ran years ago. This migration adds ONE narrow import path for
-- those records and changes nothing about normal trip creation:
--
--   * `brand_site_import_historical_trip(...)` — SECURITY DEFINER, executable
--     by service_role ONLY (no anon, no authenticated, no Studio, no Ari). It
--     creates an `ended` trip whose dates are strictly in the past in the
--     trip's own timezone (Constitution 12). It writes no ticket types, no
--     prices and no packages, so the trip can never be sold, and it never
--     touches a draft or the publish RPC.
--   * `brand_site_historical_trip_imports` — provenance: which trips were
--     imported, from what record (`import_key`), with the operator's source
--     note. Re-running an import with the same key returns the trip it created
--     the first time (idempotent, never a duplicate). RLS-forced, no grants.
--
-- The trips appear in Mingla's public readers like any other ended trip
-- (pg_public_trips_by_brand, the brand page, the trip page) and in the site
-- offerings feed (brand_site_offerings_feed), which is how a site's
-- "Trips we've run" ledger reads them — Mingla stays the one source of truth.
--
-- Forward-only.

BEGIN;

SET LOCAL lock_timeout = '10s';

CREATE TABLE IF NOT EXISTS public.brand_site_historical_trip_imports (
  event_id uuid PRIMARY KEY REFERENCES public.events(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  import_key text NOT NULL CHECK (import_key ~ '^[a-z0-9][a-z0-9._:-]{0,79}$'),
  source_note text NOT NULL CHECK (char_length(btrim(source_note)) BETWEEN 1 AND 500),
  imported_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT brand_site_historical_trip_imports_key_uq UNIQUE (brand_id, import_key)
);

ALTER TABLE public.brand_site_historical_trip_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_site_historical_trip_imports FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.brand_site_historical_trip_imports FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.brand_site_historical_trip_imports TO service_role;

COMMENT ON TABLE public.brand_site_historical_trip_imports IS
  '#2829 W5 — provenance of trips imported as historical (ended) Mingla trips: the import record key and the operator''s source note. Written only by brand_site_import_historical_trip (service role). No direct grants.';

CREATE OR REPLACE FUNCTION public.brand_site_import_historical_trip(
  p_brand_id uuid,
  p_import_key text,
  p_title text,
  p_start_date date,
  p_end_date date,
  p_timezone text,
  p_location text,
  p_description text,
  p_source_note text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_brand public.brands%ROWTYPE;
  v_existing uuid;
  v_title text := NULLIF(btrim(COALESCE(p_title, '')), '');
  v_location text := NULLIF(btrim(COALESCE(p_location, '')), '');
  v_description text := NULLIF(btrim(COALESCE(p_description, '')), '');
  v_note text := NULLIF(btrim(COALESCE(p_source_note, '')), '');
  v_key text := lower(btrim(COALESCE(p_import_key, '')));
  v_end_date date := COALESCE(p_end_date, p_start_date);
  v_today date;
  v_start timestamptz;
  v_end timestamptz;
  v_base_slug text;
  v_slug text;
  v_suffix integer := 2;
  v_event_id uuid := gen_random_uuid();
BEGIN
  -- Input shape. Every refusal names its reason; nothing is guessed or filled in.
  IF v_key !~ '^[a-z0-9][a-z0-9._:-]{0,79}$' THEN
    RAISE EXCEPTION 'historical_trip_invalid' USING DETAIL = 'import_key';
  END IF;
  IF v_title IS NULL OR char_length(v_title) > 200 THEN
    RAISE EXCEPTION 'historical_trip_invalid' USING DETAIL = 'title';
  END IF;
  IF v_location IS NOT NULL AND char_length(v_location) > 200 THEN
    RAISE EXCEPTION 'historical_trip_invalid' USING DETAIL = 'location';
  END IF;
  IF v_description IS NOT NULL AND char_length(v_description) > 4000 THEN
    RAISE EXCEPTION 'historical_trip_invalid' USING DETAIL = 'description';
  END IF;
  IF v_note IS NULL OR char_length(v_note) > 500 THEN
    RAISE EXCEPTION 'historical_trip_invalid' USING DETAIL = 'source_note';
  END IF;
  IF p_start_date IS NULL OR v_end_date < p_start_date THEN
    RAISE EXCEPTION 'historical_trip_invalid' USING DETAIL = 'dates';
  END IF;
  IF p_timezone IS NULL OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = p_timezone) THEN
    RAISE EXCEPTION 'historical_trip_invalid' USING DETAIL = 'timezone';
  END IF;

  SELECT * INTO v_brand FROM public.brands WHERE id = p_brand_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'brand_not_found';
  END IF;

  -- Idempotent: the same record imported again returns the same trip.
  SELECT i.event_id INTO v_existing
  FROM public.brand_site_historical_trip_imports i
  WHERE i.brand_id = p_brand_id AND i.import_key = v_key;
  IF FOUND THEN
    RETURN jsonb_build_object('status', 'existing', 'event_id', v_existing);
  END IF;

  -- #2829 — ONLY trips that have finished, in the trip's own timezone. A trip
  -- that ends today or later is not history and goes through the normal
  -- creator, which keeps every one of its checks.
  v_today := (now() AT TIME ZONE p_timezone)::date;
  IF v_end_date >= v_today THEN
    RAISE EXCEPTION 'historical_trip_not_ended';
  END IF;

  -- The trip spans its local calendar days. A source that records only the
  -- departure day yields a one-day trip (the site shows the date alone).
  v_start := (p_start_date::timestamp) AT TIME ZONE p_timezone;
  v_end := ((v_end_date + 1)::timestamp - interval '1 minute') AT TIME ZONE p_timezone;

  v_base_slug := btrim(regexp_replace(lower(v_title), '[^a-z0-9]+', '-', 'g'), '-');
  IF v_base_slug = '' THEN v_base_slug := 'trip'; END IF;
  v_base_slug := btrim(left(v_base_slug || '-' || to_char(p_start_date, 'YYYY'), 72), '-');
  v_slug := v_base_slug;
  WHILE EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.brand_id = p_brand_id AND lower(e.slug) = v_slug AND e.deleted_at IS NULL
  ) LOOP
    v_slug := v_base_slug || '-' || v_suffix;
    v_suffix := v_suffix + 1;
  END LOOP;

  -- No money moves in a historical trip: no currency is required of the brand.
  PERFORM set_config('mingla.publish_free_only', 'on', true);

  INSERT INTO public.events(
    id, brand_id, title, slug, event_type, visibility, status, timezone, description,
    destination_text, theme, bookings_closed, published_at
  ) VALUES (
    v_event_id, p_brand_id, v_title, v_slug, 'trip', 'public', 'ended', p_timezone, v_description,
    v_location,
    jsonb_build_object('business_trip', jsonb_strip_nulls(jsonb_build_object(
      'destinationLocationText', v_location,
      'startAt', to_char(v_start AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'endAt', to_char(v_end AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    ))),
    true,
    v_start
  );

  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
  VALUES (v_event_id, v_start, v_end, p_timezone, true);

  PERFORM set_config('mingla.publish_free_only', 'off', true);

  INSERT INTO public.brand_site_historical_trip_imports(event_id, brand_id, import_key, source_note)
  VALUES (v_event_id, p_brand_id, v_key, v_note);

  RETURN jsonb_build_object('status', 'created', 'event_id', v_event_id, 'slug', v_slug);
END;
$fn$;

REVOKE ALL ON FUNCTION public.brand_site_import_historical_trip(uuid, text, text, date, date, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_import_historical_trip(uuid, text, text, date, date, text, text, text, text)
  TO service_role;

COMMENT ON FUNCTION public.brand_site_import_historical_trip(uuid, text, text, date, date, text, text, text, text) IS
  '#2829 W5 (A1.3) — import one pre-Mingla trip as an ENDED public Mingla trip with its real past dates (local calendar days in the trip timezone). Refuses any trip ending today or later (historical_trip_not_ended). No ticket types, prices or packages: never bookable. Idempotent by (brand, import_key). Service role only; normal trip creation and business_publish_trip_draft are unchanged.';

COMMIT;
