\set ON_ERROR_STOP on

-- Issue #3859 slice-1 implementor proof.
-- Fails on revert: removing the capability helper/reader patch/authoring or
-- publish trigger makes T-01, T-02, T-03, or T-04 fail. Every fixture rolls back.

CREATE OR REPLACE FUNCTION pg_temp.issue_3859_schedule(p_deposit integer)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT jsonb_build_object(
    'deposit_pct', p_deposit,
    'installments', jsonb_build_array(
      jsonb_build_object(
        'ordinal', 1,
        'pct', 100 - p_deposit,
        'days_after_booking', 30
      )
    )
  )
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.issue_3859_fixture(
  p_tag text,
  p_status text DEFAULT 'draft'
)
RETURNS TABLE(
  v_brand uuid,
  v_event uuid,
  v_ticket uuid,
  v_brand_slug text,
  v_trip_slug text
)
LANGUAGE plpgsql
AS $fixture$
DECLARE
  v_owner uuid := gen_random_uuid();
BEGIN
  v_brand := gen_random_uuid();
  v_event := gen_random_uuid();
  v_ticket := gen_random_uuid();
  v_brand_slug := 'issue-3859-' || p_tag || '-' || v_brand;
  v_trip_slug := 'issue-3859-trip-' || p_tag || '-' || v_event;

  INSERT INTO auth.users(id, email)
  VALUES (v_owner, 'issue-3859-' || p_tag || '-' || v_owner || '@example.test');
  INSERT INTO public.creator_accounts(id, email)
  VALUES (v_owner, 'issue-3859-' || p_tag || '-' || v_owner || '@example.test');
  INSERT INTO public.brands(
    id, account_id, name, slug, default_currency,
    payment_provider, payment_country, pricing_region, pricing_currency,
    paystack_subaccount_code
  ) VALUES (
    v_brand, v_owner, 'Issue 3859 ' || p_tag, v_brand_slug, 'USD',
    'stripe', 'US', 'US', 'USD', 'ACCT_issue3859'
  );
  INSERT INTO public.stripe_connect_accounts(
    brand_id, stripe_account_id, charges_enabled, payouts_enabled,
    country, default_currency
  ) VALUES (
    v_brand, 'acct_issue3859_' || replace(v_brand::text, '-', ''), true, true,
    'US', 'usd'
  );
  INSERT INTO public.events(
    id, brand_id, created_by, title, slug, event_type, status, visibility,
    timezone, currency
  ) VALUES (
    v_event, v_brand, v_owner, 'Issue 3859 trip', v_trip_slug, 'trip',
    p_status, 'public', 'UTC', 'USD'
  );
  INSERT INTO public.event_dates(
    event_id, start_at, end_at, timezone, is_master
  ) VALUES (
    v_event, '2030-01-10T10:00:00Z', '2030-01-12T18:00:00Z', 'UTC', true
  );
  INSERT INTO public.ticket_types(
    id, event_id, name, price_cents, currency, is_free, quantity_total,
    min_purchase_qty, available_online, available_in_person
  ) VALUES (
    v_ticket, v_event, 'Standard', 100000, 'USD', false, 20, 1, true, false
  );
  INSERT INTO public.trip_pricing_tiers(
    event_id, ticket_type_id, tier_name, tier_metadata
  ) VALUES (
    v_event, v_ticket, 'Standard',
    jsonb_build_object('installments', pg_temp.issue_3859_schedule(25))
  );
  RETURN NEXT;
END
$fixture$;

-- T-01: supported is explicit; unavailable and unknown fail closed.
BEGIN;
DO $t01$
DECLARE f record;
BEGIN
  SELECT * INTO f FROM pg_temp.issue_3859_fixture('t01');
  IF public.pg_trip_installments_supported(f.v_event) IS NOT TRUE THEN
    RAISE EXCEPTION 'T-01 FAIL: supported effective setup refused';
  END IF;
  UPDATE public.brands SET payment_provider = 'paystack' WHERE id = f.v_brand;
  IF public.pg_trip_installments_supported(f.v_event) IS DISTINCT FROM false
     OR public.pg_trip_installments_supported(gen_random_uuid()) IS DISTINCT FROM false
     OR public.pg_trip_installments_supported(NULL) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'T-01 FAIL: unavailable/unknown capability did not fail closed';
  END IF;
  RAISE NOTICE 'T-01 PASS: capability is explicit and unknown fails closed';
END
$t01$;
ROLLBACK;

-- T-02: a legacy published schedule remains stored for Host/support but the
-- canonical public reader removes both schedule-bearing fields.
BEGIN;
DO $t02$
DECLARE f record; v_tier jsonb; v_stored jsonb;
BEGIN
  SELECT * INTO f FROM pg_temp.issue_3859_fixture('t02');
  UPDATE public.events SET status = 'scheduled' WHERE id = f.v_event;
  UPDATE public.brands SET payment_provider = 'paystack' WHERE id = f.v_brand;

  SELECT tier_metadata -> 'installments' INTO v_stored
    FROM public.trip_pricing_tiers WHERE event_id = f.v_event;
  IF v_stored IS NULL THEN
    RAISE EXCEPTION 'T-02 FAIL: legacy schedule was deleted or rewritten';
  END IF;

  v_tier := (public.pg_public_trip_by_slug(f.v_brand_slug, f.v_trip_slug)
    -> 'tiers' -> 0)::jsonb;
  IF v_tier -> 'installments' <> 'null'::jsonb
     OR (v_tier -> 'tierMetadata') ? 'installments' THEN
    RAISE EXCEPTION 'T-02 FAIL: unsupported schedule remained public: %', v_tier;
  END IF;
  RAISE NOTICE 'T-02 PASS: legacy schedule retained privately and masked publicly';
END
$t02$;
ROLLBACK;

-- T-03: unsupported authoring cannot add/edit/remove a schedule, but an unchanged
-- legacy schedule can ride an unrelated metadata write without being deleted.
BEGIN;
DO $t03$
DECLARE
  f record;
  v_edit_raised boolean := false;
  v_remove_raised boolean := false;
  v_after jsonb;
BEGIN
  SELECT * INTO f FROM pg_temp.issue_3859_fixture('t03');
  UPDATE public.brands SET payment_provider = 'paystack' WHERE id = f.v_brand;

  BEGIN
    UPDATE public.trip_pricing_tiers
       SET tier_metadata = jsonb_set(
         tier_metadata,
         '{installments}',
         pg_temp.issue_3859_schedule(30)
       )
     WHERE event_id = f.v_event;
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM = 'installment_capability_unavailable' THEN
      v_edit_raised := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_edit_raised THEN
    RAISE EXCEPTION 'T-03 FAIL: unsupported schedule edit was accepted';
  END IF;

  BEGIN
    UPDATE public.trip_pricing_tiers
       SET tier_metadata = tier_metadata - 'installments'
     WHERE event_id = f.v_event;
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM = 'installment_capability_unavailable' THEN
      v_remove_raised := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_remove_raised THEN
    RAISE EXCEPTION 'T-03 FAIL: unsupported saved schedule was deleted';
  END IF;

  UPDATE public.trip_pricing_tiers
     SET tier_metadata = tier_metadata || jsonb_build_object('description', 'kept')
   WHERE event_id = f.v_event;
  SELECT tier_metadata INTO v_after
    FROM public.trip_pricing_tiers WHERE event_id = f.v_event;
  IF v_after -> 'installments' IS NULL OR v_after ->> 'description' <> 'kept' THEN
    RAISE EXCEPTION 'T-03 FAIL: unchanged legacy schedule was not retained';
  END IF;
  RAISE NOTICE 'T-03 PASS: unsupported edits/removal refuse; unchanged legacy metadata survives';
END
$t03$;
ROLLBACK;

-- T-04: an unsupported saved schedule cannot become effectively published.
BEGIN;
DO $t04$
DECLARE f record; v_raised boolean := false; v_status text;
BEGIN
  SELECT * INTO f FROM pg_temp.issue_3859_fixture('t04');
  UPDATE public.brands SET payment_provider = 'paystack' WHERE id = f.v_brand;
  BEGIN
    UPDATE public.events SET status = 'scheduled' WHERE id = f.v_event;
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM = 'installment_capability_unavailable' THEN
      v_raised := true;
    ELSE
      RAISE;
    END IF;
  END;
  SELECT status::text INTO v_status FROM public.events WHERE id = f.v_event;
  IF NOT v_raised OR v_status <> 'draft' THEN
    RAISE EXCEPTION 'T-04 FAIL: unsupported schedule published (raised %, status %)', v_raised, v_status;
  END IF;
  RAISE NOTICE 'T-04 PASS: publish refuses without rewriting the draft';
END
$t04$;
ROLLBACK;

-- T-05: aggregate census is service-only and exposes no identifier columns.
DO $t05$
DECLARE v_result text;
BEGIN
  IF has_function_privilege('anon', 'public.issue_3859_trip_installment_census()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.issue_3859_trip_installment_census()', 'EXECUTE') THEN
    RAISE EXCEPTION 'T-05 FAIL: aggregate census is exposed to app roles';
  END IF;
  SELECT pg_get_function_result('public.issue_3859_trip_installment_census()'::regprocedure)
    INTO v_result;
  IF v_result IS DISTINCT FROM
     'TABLE(capability_state text, offering_state text, trip_count bigint, schedule_count bigint)' THEN
    RAISE EXCEPTION 'T-05 FAIL: census output drifted: %', v_result;
  END IF;
  PERFORM * FROM public.issue_3859_trip_installment_census();
  RAISE NOTICE 'T-05 PASS: census is aggregate-only and service-only';
END
$t05$;

SELECT 'issue_3859_installment_capability_refusal: PASS' AS result;
