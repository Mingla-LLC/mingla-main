-- #4389 S-9 — Bulgaria pays out in EUR, so BGN has no bank country any more.
-- Seth (2026-11-11): switch BGN off for NEW use, with a safety stop.
--
-- supported_brand_currencies is the one allow-list behind
-- is_supported_offering_currency; switching BGN off stops new BGN brands and
-- new BGN prices. Existing BGN data would then fail its next publish or
-- edit, so this refuses to run while any live data still uses BGN:
--   - a brand that is not deleted with default_currency or pricing_currency BGN;
--   - an event or experience that is not deleted, scheduled or live, priced in BGN;
--   - a ticket type that is not deleted, on such an event, priced in BGN.
-- When any exist it raises PT409 with the counts and changes nothing, so the
-- migration stops for review. Re-running after the data moves is safe.

CREATE OR REPLACE FUNCTION public.issue_4389_retire_bgn()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_brands bigint;
  v_events bigint;
  v_tickets bigint;
BEGIN
  SELECT count(*) INTO v_brands
  FROM public.brands b
  WHERE b.deleted_at IS NULL
    AND (upper(btrim(b.default_currency::text)) = 'BGN'
      OR upper(btrim(COALESCE(b.pricing_currency, ''))) = 'BGN');

  SELECT count(*) INTO v_events
  FROM public.events e
  WHERE e.deleted_at IS NULL
    AND e.status IN ('scheduled', 'live')
    AND upper(btrim(COALESCE(e.currency::text, ''))) = 'BGN';

  SELECT count(*) INTO v_tickets
  FROM public.ticket_types t
  JOIN public.events e ON e.id = t.event_id
  WHERE t.deleted_at IS NULL
    AND e.deleted_at IS NULL
    AND e.status IN ('scheduled', 'live')
    AND upper(btrim(COALESCE(t.currency::text, ''))) = 'BGN';

  IF v_brands > 0 OR v_events > 0 OR v_tickets > 0 THEN
    RAISE EXCEPTION 'bgn_still_in_use: % brand(s), % live event(s), % live ticket type(s) still use BGN; move them to EUR, then re-run',
      v_brands, v_events, v_tickets
      USING ERRCODE = 'PT409';
  END IF;

  UPDATE public.supported_brand_currencies SET active = false WHERE code = 'BGN';
  RETURN 'bgn_retired';
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_4389_retire_bgn() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.issue_4389_retire_bgn() FROM anon, authenticated;

SELECT public.issue_4389_retire_bgn();
