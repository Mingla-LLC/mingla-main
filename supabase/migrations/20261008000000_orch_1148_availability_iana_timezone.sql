-- ===========================================================================
-- META-ORCH-1148 sub-ORCH 2.1a — engine defect fix P3-3 (DST): IANA timezone
-- ---------------------------------------------------------------------------
-- The 2.1a engine converted venue-local slot times to UTC via a single static
-- `place_pool.utc_offset_minutes` (e.g. EST = -300). A static offset cannot be
-- right on both sides of a DST boundary: a US-Eastern venue is UTC-5 in winter
-- (EST) but UTC-4 in summer (EDT). Tester B-8 proved a July (EDT) 18:00-local
-- slot materialised at 23:00Z (UTC-5) instead of the true 22:00Z (UTC-4) — a
-- 1-hour error for half the year. The engine must convert with a proper IANA
-- timezone so Postgres `AT TIME ZONE '<iana>'` resolves DST for the actual date.
--
-- DECISION (tz-column placement): add `iana_timezone text` to
-- `venue_availability_config` (the engine's OWN config table, one row per
-- brand), NOT to `place_pool`. Rationale:
--   * place_pool is the Google-seeded discovery pool; it carries NO IANA tz
--     (only the numeric utc_offset_minutes) and is owned by the seeding
--     pipeline — adding a tz there would be cross-domain scope creep and there
--     is no SQL-pure lat/lng→IANA resolver in PG.
--   * the Availability config is exactly where the operator already tunes the
--     reservation clock (service periods, turn times, granularity). Keeping the
--     tz with it makes the engine self-sufficient (no place_pool dependency for
--     the time math) and lets the Availability module edit it.
--   * the events/trips precedent stores an IANA `timezone text` per offering
--     (event_dates.timezone, used via `AT TIME ZONE v_timezone`) — same model.
--
-- DEFAULT SOURCING: backfill each existing config row's tz from the venue's
-- location. We map the venue's `place_pool.country` (+ a small set of known
-- US/Canada offsets) to a representative IANA zone, falling back to 'UTC' when
-- unknown. The Availability UI surfaces an explicit picker so an operator can
-- correct it. NOT NULL with a 'UTC' default so the engine never sees a NULL tz.
--
-- Additive-only. ADD COLUMN IF NOT EXISTS. No data loss. MONOTONIC VERSION
-- 20261008000000 (strictly above the current max across this worktree + every
-- sibling worktree: ORCH-1138 …07*, ORCH-1150 …04*, origin/main …04*). Apply
-- via the Supabase Management API; never `supabase db push`.
-- ===========================================================================

BEGIN;

ALTER TABLE public.venue_availability_config
  ADD COLUMN IF NOT EXISTS iana_timezone text NOT NULL DEFAULT 'UTC';

-- Validate the value is a real IANA zone Postgres recognises (rejects typos /
-- legacy numeric offsets at write time). pg_timezone_names is the authoritative
-- set the server's `AT TIME ZONE` resolves against. A CHECK constraint cannot
-- contain a subquery, so validation is enforced by a BEFORE INSERT/UPDATE
-- trigger (also normalises NULL/'' → 'UTC' defensively).
CREATE OR REPLACE FUNCTION public.tg_venue_availability_config_validate_tz()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $tz$
BEGIN
  IF NEW.iana_timezone IS NULL OR btrim(NEW.iana_timezone) = '' THEN
    NEW.iana_timezone := 'UTC';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = NEW.iana_timezone) THEN
    RAISE EXCEPTION 'venue_availability_config.iana_timezone "%" is not a recognised IANA timezone', NEW.iana_timezone
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$tz$;

DROP TRIGGER IF EXISTS venue_availability_config_validate_tz ON public.venue_availability_config;
CREATE TRIGGER venue_availability_config_validate_tz
  BEFORE INSERT OR UPDATE OF iana_timezone ON public.venue_availability_config
  FOR EACH ROW EXECUTE FUNCTION public.tg_venue_availability_config_validate_tz();

-- Backfill the tz for existing rows from the venue's location. Best-effort
-- mapping from country (+ a few well-known US offsets) to a representative IANA
-- zone; default 'UTC' when unknown. The operator can override in the UI.
WITH resolved AS (
  SELECT
    c.id AS cfg_id,
    CASE
      WHEN pp.country IS NULL THEN 'UTC'
      WHEN upper(pp.country) IN ('US','USA','UNITED STATES') THEN
        CASE pp.utc_offset_minutes
          WHEN -300 THEN 'America/New_York'     -- EST
          WHEN -240 THEN 'America/New_York'     -- EDT (summer-fetched)
          WHEN -360 THEN 'America/Chicago'      -- CST
          WHEN -420 THEN 'America/Denver'       -- MST
          WHEN -480 THEN 'America/Los_Angeles'  -- PST
          WHEN -540 THEN 'America/Anchorage'
          WHEN -600 THEN 'Pacific/Honolulu'
          ELSE 'America/New_York'
        END
      WHEN upper(pp.country) IN ('CA','CANADA') THEN
        CASE pp.utc_offset_minutes
          WHEN -300 THEN 'America/Toronto'
          WHEN -240 THEN 'America/Toronto'
          WHEN -360 THEN 'America/Winnipeg'
          WHEN -420 THEN 'America/Edmonton'
          WHEN -480 THEN 'America/Vancouver'
          ELSE 'America/Toronto'
        END
      WHEN upper(pp.country) IN ('NG','NIGERIA') THEN 'Africa/Lagos'
      WHEN upper(pp.country) IN ('GH','GHANA') THEN 'Africa/Accra'
      WHEN upper(pp.country) IN ('GB','UK','UNITED KINGDOM') THEN 'Europe/London'
      ELSE 'UTC'
    END AS tz
  FROM public.venue_availability_config c
  LEFT JOIN public.place_pool pp ON pp.id = c.place_pool_id
)
UPDATE public.venue_availability_config c
SET iana_timezone = r.tz
FROM resolved r
WHERE c.id = r.cfg_id
  AND r.tz IN (SELECT name FROM pg_timezone_names)
  AND c.iana_timezone = 'UTC';  -- only touch rows still at the default

COMMENT ON COLUMN public.venue_availability_config.iana_timezone IS
  'META-ORCH-1148 2.1a P3-3 fix: the venue''s IANA timezone (e.g. America/New_York). '
  'The availability engine converts venue-local service-period times to UTC via '
  '`AT TIME ZONE iana_timezone`, resolving DST for the actual date. Replaces the '
  'static place_pool.utc_offset_minutes for the slot time math (which was 1h off '
  'across a DST boundary). NOT NULL, default UTC.';

COMMIT;
