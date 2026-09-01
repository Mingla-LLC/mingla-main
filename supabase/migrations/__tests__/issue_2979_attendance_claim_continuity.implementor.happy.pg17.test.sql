BEGIN;

DO $test$
DECLARE
  v_definition text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'orders'
       AND column_name = 'attendance_claim_legacy_token_digest'
  ) THEN RAISE EXCEPTION 'missing legacy digest column'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name = 'attendance_claim_recovery_items'
  ) THEN RAISE EXCEPTION 'missing recovery ledger'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'attendance_claim_deliveries'
       AND column_name = 'provider_attempt_started_at'
  ) THEN RAISE EXCEPTION 'missing durable provider boundary'; END IF;
  SELECT pg_get_functiondef('public.claim_attendance_internal_v2(uuid,text,uuid,uuid,bytea,bytea)'::regprocedure)
    INTO v_definition;
  IF position('FOR UPDATE' IN v_definition) = 0
     OR position('attendance_claim_legacy_token_digest = NULL' IN v_definition) = 0
     OR position('attendance_claim_token_generation = NULL' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'dual proof claim is not atomic';
  END IF;
  SELECT pg_get_functiondef('public.finalize_issue_2979_attendance_claim_recovery()'::regprocedure)
    INTO v_definition;
  IF position('72 hours' IN v_definition) = 0
     OR position('issue_2979_delivery_work_remaining' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'finalizer lacks grace/reconciliation gates';
  END IF;
  SELECT pg_get_functiondef('public.claim_issue_2979_attendance_claim_recovery_batch(integer,integer)'::regprocedure)
    INTO v_definition;
  IF position('provider_attempt_started_at IS NOT NULL' IN v_definition) = 0
     OR position('lease_expired_before_provider' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'ambiguous acceptance is not provider-bound';
  END IF;
  SELECT pg_get_functiondef('public.complete_issue_2979_attendance_claim_delivery(uuid,uuid,uuid,text,text)'::regprocedure)
    INTO v_definition;
  IF position('provider_boundary_missing' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'completion accepts unmarked provider outcomes';
  END IF;
END;
$test$;

ROLLBACK;
