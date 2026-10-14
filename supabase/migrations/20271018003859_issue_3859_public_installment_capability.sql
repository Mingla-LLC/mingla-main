-- Issue #3859 rework: expose the existing provider-neutral installment
-- capability through the one canonical public trip reader. New clients treat a
-- missing value from an older server as false, so rolling deploys fail closed.

BEGIN;

DO $patch_public_trip_capability$
DECLARE
  v_oid oid := 'public.pg_public_trip_by_slug(text,text)'::regprocedure;
  v_def text := pg_get_functiondef(v_oid);
  v_anchor_old text := $$'bookingsClosed', COALESCE(tr.bookings_closed, false),$$;
  v_anchor_new text := $$'bookingsClosed', COALESCE(tr.bookings_closed, false),
      'installmentCapabilityAvailable', public.pg_trip_installments_supported(tr.id),$$;
BEGIN
  IF (length(v_def) - length(replace(v_def, v_anchor_old, ''))) <> length(v_anchor_old) THEN
    RAISE EXCEPTION 'issue_3859_public_trip_capability_anchor_drift';
  END IF;
  v_def := replace(v_def, v_anchor_old, v_anchor_new);
  EXECUTE v_def;
END
$patch_public_trip_capability$;

COMMENT ON FUNCTION public.pg_public_trip_by_slug(text, text) IS
  'Canonical public trip reader; issue #3859 exposes only a provider-neutral installment capability boolean.';

DO $verify$
DECLARE
  v_oid oid := 'public.pg_public_trip_by_slug(text,text)'::regprocedure;
  v_src text;
BEGIN
  SELECT p.prosrc INTO v_src FROM pg_proc p WHERE p.oid = v_oid;
  IF position('''installmentCapabilityAvailable'', public.pg_trip_installments_supported(tr.id)' IN v_src) = 0 THEN
    RAISE EXCEPTION 'issue_3859_public_trip_capability_missing';
  END IF;
  IF NOT has_function_privilege('anon', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'issue_3859_public_trip_reader_execute_drift';
  END IF;
END
$verify$;

COMMIT;
