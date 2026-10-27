-- #2829 A20 — a receipt that SUCCEEDED carries no error code.
--
-- When brand-site-control stops waiting for Studio (15 s) it marks the
-- operation ambiguous with SERVICE_TEMPORARILY_UNAVAILABLE. Studio then
-- finishes and Core records the operation as succeeded (and the publication as
-- published), but every success path only set status, so the stale code stayed
-- next to "succeeded" / "published" and read like a failure.
--
-- One BEFORE UPDATE trigger per table clears it on the transition INTO
-- success, whichever function makes that transition. Rows already terminal are
-- untouched (the transition guards still refuse any change to them), so this
-- needs no backfill and changes nothing else.

CREATE OR REPLACE FUNCTION public.brand_site_receipt_clear_stale_error()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.status = 'succeeded' AND OLD.status IS DISTINCT FROM 'succeeded' THEN
    NEW.error_code := NULL;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.brand_site_publication_clear_stale_failure()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.status = 'published' AND OLD.status IS DISTINCT FROM 'published' THEN
    NEW.failure_code := NULL;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.brand_site_receipt_clear_stale_error() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.brand_site_publication_clear_stale_failure() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS brand_site_receipt_clear_stale_error ON public.brand_site_operation_receipts;
CREATE TRIGGER brand_site_receipt_clear_stale_error
BEFORE UPDATE ON public.brand_site_operation_receipts
FOR EACH ROW EXECUTE FUNCTION public.brand_site_receipt_clear_stale_error();

DROP TRIGGER IF EXISTS brand_site_publication_clear_stale_failure ON public.brand_site_publications;
CREATE TRIGGER brand_site_publication_clear_stale_failure
BEFORE UPDATE ON public.brand_site_publications
FOR EACH ROW EXECUTE FUNCTION public.brand_site_publication_clear_stale_failure();
