-- Issue #3355 Wave A (A4, Seth D5a) — a brand's time zone is set from its
-- country when that country has one time zone.
--
-- Production 2026-11-10: a Lagos host was handed off to Brand profile to add
-- a time zone. Brand profile had no time zone field, and `default_timezone`
-- was NULL, so "It's done, check now" could never pass. Nigeria has one time
-- zone, so the value was knowable all along.
--
--   * public.brand_single_zone_timezone(country) — the one zone of a
--     single-zone country, else NULL. A static list: it mirrors
--     MARKET_DEFAULT_TIMEZONES in supabase/functions/_shared/payoutCountries.ts
--     (the edge's own single-zone list), pinned equal by
--     supabase/functions/_shared/__tests__/issue_3355_wave_a_handoff_fixable.implementor.test.ts.
--     Countries with several zones (US, CA, ES, PT…) are absent: the host
--     picks (Brand profile now has a Time zone field) or Ari asks.
--   * Trigger brands_default_timezone_from_country (BEFORE INSERT / UPDATE OF
--     country_code): fills a NULL time zone, and when the country changes it
--     replaces a zone that was only the old country's automatic one. A zone
--     the host chose is never overwritten. It fires before
--     brands_default_timezone_guard (name order) and only writes zones the
--     database knows (pg_timezone_names).
--   * The readiness catalogue's Time zone item now opens Brand profile's new
--     Time zone section (/brand/{brand_id}/edit?section=timezone).
--   * Backfill: every brand with a NULL time zone and a single-zone country
--     (the Lagos host's brand becomes Africa/Lagos). Idempotent.
--
-- Static SQL only (no EXECUTE). Invariants are declared in
-- supabase/migrations/__tests__/issue_3355_brand_timezone_from_country.implementor.pg17.test.sql.

BEGIN;

SET LOCAL lock_timeout = '10s';

CREATE OR REPLACE FUNCTION public.brand_single_zone_timezone(p_country text)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT z.tz FROM (VALUES
    ('AT','Europe/Vienna'),
    ('BE','Europe/Brussels'),
    ('BG','Europe/Sofia'),
    ('CH','Europe/Zurich'),
    ('CY','Asia/Nicosia'),
    ('CZ','Europe/Prague'),
    ('DE','Europe/Berlin'),
    ('DK','Europe/Copenhagen'),
    ('EE','Europe/Tallinn'),
    ('FI','Europe/Helsinki'),
    ('FR','Europe/Paris'),
    ('GB','Europe/London'),
    ('GR','Europe/Athens'),
    ('HR','Europe/Zagreb'),
    ('HU','Europe/Budapest'),
    ('IE','Europe/Dublin'),
    ('IS','Atlantic/Reykjavik'),
    ('IT','Europe/Rome'),
    ('LI','Europe/Vaduz'),
    ('LT','Europe/Vilnius'),
    ('LU','Europe/Luxembourg'),
    ('LV','Europe/Riga'),
    ('MT','Europe/Malta'),
    ('NG','Africa/Lagos'),
    ('NL','Europe/Amsterdam'),
    ('NO','Europe/Oslo'),
    ('PL','Europe/Warsaw'),
    ('RO','Europe/Bucharest'),
    ('SE','Europe/Stockholm'),
    ('SI','Europe/Ljubljana'),
    ('SK','Europe/Bratislava')
  ) AS z(code, tz)
  WHERE z.code = upper(btrim(p_country));
$function$;
REVOKE ALL ON FUNCTION public.brand_single_zone_timezone(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_single_zone_timezone(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.brands_default_timezone_from_country()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_zone text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.country_code IS NOT DISTINCT FROM OLD.country_code THEN
      RETURN NEW;
    END IF;
    -- The old country's automatic zone follows the country; a chosen one stays.
    IF NEW.default_timezone IS NOT DISTINCT FROM OLD.default_timezone
       AND OLD.default_timezone IS NOT NULL
       AND OLD.default_timezone IS NOT DISTINCT FROM public.brand_single_zone_timezone(OLD.country_code) THEN
      NEW.default_timezone := NULL;
    END IF;
  END IF;
  IF NEW.default_timezone IS NULL AND NEW.country_code IS NOT NULL THEN
    v_zone := public.brand_single_zone_timezone(NEW.country_code);
    IF v_zone IS NOT NULL AND EXISTS (
      SELECT 1 FROM pg_catalog.pg_timezone_names z WHERE z.name = v_zone
    ) THEN
      NEW.default_timezone := v_zone;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.brands_default_timezone_from_country()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS brands_default_timezone_from_country ON public.brands;
CREATE TRIGGER brands_default_timezone_from_country
  BEFORE INSERT OR UPDATE OF country_code ON public.brands
  FOR EACH ROW
  EXECUTE FUNCTION public.brands_default_timezone_from_country();

-- ── The Time zone handoff lands on the field (I-ARI-HANDOFF-FIXABLE) ──────
-- Brand profile now has a Time zone section; Ari's handoff opens it.
UPDATE public.brand_readiness_catalog
SET route_template = '/brand/{brand_id}/edit?section=timezone'
WHERE key = 'timezone'
  AND route_template IS DISTINCT FROM '/brand/{brand_id}/edit?section=timezone';

-- ── Backfill (idempotent) ──────────────────────────────────────────────────
UPDATE public.brands b
SET default_timezone = public.brand_single_zone_timezone(b.country_code)
WHERE b.default_timezone IS NULL
  AND public.brand_single_zone_timezone(b.country_code) IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM pg_catalog.pg_timezone_names z
    WHERE z.name = public.brand_single_zone_timezone(b.country_code)
  );

COMMIT;
