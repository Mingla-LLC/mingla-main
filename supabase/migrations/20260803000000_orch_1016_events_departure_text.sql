BEGIN;
-- ORCH-1016 [Consumer Discover Trips tab] — DEPARTURE CITY field.
-- Additive, nullable. No backfill (operator decision #4: no demo data;
-- existing trips simply have NULL departure until a planner sets it).
-- Drift-safe: ADD COLUMN ... IF NOT EXISTS; no data migration; safe-migration
-- protocol needs no backfill guard.
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS departure_text text DEFAULT NULL;

-- Optional geo, native `point` (mirrors events.location_geo convention; NOT
-- PostGIS geography — SPEC A-3). Populated from the Google-Places pick lat/lng so
-- a future departure-proximity sort/filter has data. Nullable; never required.
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS departure_geo point DEFAULT NULL;

COMMENT ON COLUMN public.events.departure_text IS
  'ORCH-1016: trip DEPARTURE/origin city (where travelers leave from), e.g. "Washington, DC, USA". Mirrors destination_text (where the trip goes). NULL = not set. Trip-only field; events leave it NULL.';
COMMENT ON COLUMN public.events.departure_geo IS
  'ORCH-1016: optional native point(lng,lat) for the departure city, from the Google-Places pick. Mirrors events.location_geo. Nullable; future proximity sort.';

-- ───────────────────────────────────────────────────────────────────────────
-- Canonical sync: keep events.departure_text + departure_geo in lock-step with
-- the authoring JSONB theme.business_trip.{departureLocationText,departureLat,
-- departureLng}.
--
-- WHY a trigger (vs editing biz_update_live_trip): destination_text is written by
-- a bespoke block inside the ~250-line biz_update_live_trip RPC (migration
-- 20260725000002 §4b2) which STRIPS the destination keys from the patch before
-- the generic theme merge. Re-creating that whole function to add a parallel
-- departure block risks silent drift. Instead, departure flows through the RPC's
-- generic theme.business_trip merge (it is NOT stripped) so it lands in
-- theme.business_trip; this trigger mirrors that into the canonical column for
-- BOTH the live-edit path (biz_update_live_trip) AND the draft-create/edit path
-- (tripsService.updateTripBasics merges into theme.business_trip too). Additive,
-- idempotent, single code path, no RPC surgery. Trip-only (event rows untouched).
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_events_sync_departure_from_theme()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_bt        jsonb;
  v_dep_text  text;
  v_dep_lat   double precision;
  v_dep_lng   double precision;
BEGIN
  -- Only trips carry a departure; never touch event_type='event' rows.
  IF NEW.event_type IS DISTINCT FROM 'trip' THEN
    RETURN NEW;
  END IF;

  v_bt := COALESCE(NEW.theme->'business_trip', '{}'::jsonb);

  -- departure_text mirrors theme.business_trip.departureLocationText (trimmed,
  -- empty → NULL). Only sync when the authoring key is present so a direct
  -- column write (e.g. a future admin tool) is not clobbered by a stale theme.
  IF v_bt ? 'departureLocationText' THEN
    v_dep_text := NULLIF(btrim(v_bt->>'departureLocationText'), '');
    NEW.departure_text := v_dep_text;

    -- departure_geo := point(lng, lat) — longitude first, matching the native
    -- events.location_geo convention. Only when BOTH coordinates are real
    -- numbers; otherwise NULL (text-only departure is valid — C1 filters on
    -- text, geo is for a future proximity sort).
    v_dep_lat := NULLIF(v_bt->>'departureLat', '')::double precision;
    v_dep_lng := NULLIF(v_bt->>'departureLng', '')::double precision;
    IF v_dep_text IS NOT NULL AND v_dep_lat IS NOT NULL AND v_dep_lng IS NOT NULL THEN
      NEW.departure_geo := point(v_dep_lng, v_dep_lat);
    ELSE
      NEW.departure_geo := NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_events_sync_departure ON public.events;
CREATE TRIGGER trg_events_sync_departure
  BEFORE INSERT OR UPDATE OF theme ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_events_sync_departure_from_theme();

COMMENT ON FUNCTION public.tg_events_sync_departure_from_theme() IS
  'ORCH-1016: mirrors theme.business_trip.departureLocationText/Lat/Lng into the canonical events.departure_text + departure_geo(point(lng,lat)) columns on trip rows. Mirror of the destination_text canonical-write pattern (ORCH-0950-expanded), implemented as a BEFORE trigger so both the live-edit RPC and the draft updateTripBasics paths converge without RPC surgery.';

COMMIT;
