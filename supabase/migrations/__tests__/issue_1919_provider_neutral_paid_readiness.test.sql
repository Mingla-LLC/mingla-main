-- Issue #1919 implementor behavioral regression.
-- Every synthetic row lives inside one transaction and is rolled back.
\set ON_ERROR_STOP on

BEGIN;

DO $test$
DECLARE
  v_account uuid := gen_random_uuid();
  v_stripe uuid := gen_random_uuid();
  v_paystack uuid := gen_random_uuid();
  v_unready uuid := gen_random_uuid();
  v_pending uuid := gen_random_uuid();
  v_missing uuid := gen_random_uuid();
  v_ids uuid[];
  v_suffix text := replace(gen_random_uuid()::text, '-', '');
  v_def text;
  v_sig text;
BEGIN
  INSERT INTO auth.users (id) VALUES (v_account);
  INSERT INTO public.creator_accounts (id) VALUES (v_account);

  INSERT INTO public.brands (
    id, account_id, slug, name, default_currency, paystack_subaccount_code,
    created_at, updated_at
  ) VALUES
    (v_stripe, v_account, 'i1919-stripe-' || v_suffix, 'I1919 Stripe', 'USD', NULL, now(), now()),
    (v_paystack, v_account, 'i1919-paystack-' || v_suffix, 'I1919 Paystack', 'NGN', 'ACCT_i1919_paystack', now(), now()),
    (v_unready, v_account, 'i1919-unready-' || v_suffix, 'I1919 Unready', 'USD', NULL, now(), now()),
    (v_pending, v_account, 'i1919-pending-' || v_suffix, 'I1919 Pending', 'NGN', 'ACCT_i1919_pending', now(), now());

  INSERT INTO public.stripe_connect_accounts (
    brand_id, stripe_account_id, charges_enabled, detached_at,
    created_at, updated_at
  ) VALUES (
    v_stripe, 'acct_i1919_ready', true, NULL, now(), now()
  );

  INSERT INTO public.brand_currency_reconciliations (
    brand_id, from_currency_code, to_currency_code, reason, status
  ) VALUES (
    v_pending, 'USD', 'NGN', 'bank_changed', 'pending'
  );

  IF public.pg_brand_can_collect(v_stripe) IS NOT TRUE THEN
    RAISE EXCEPTION 'I1919-B01: Stripe-ready brand must collect';
  END IF;
  IF public.pg_brand_can_collect(v_paystack) IS NOT TRUE THEN
    RAISE EXCEPTION 'I1919-B02: Paystack-ready brand must collect';
  END IF;
  IF public.pg_brand_can_collect(v_unready) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'I1919-B03: rail-unready brand must fail closed';
  END IF;
  IF public.pg_brand_can_collect(v_pending) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'I1919-B04: pending reconciliation must fail closed';
  END IF;
  IF public.pg_brand_can_collect(v_missing) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'I1919-B05: nonexistent brand must fail closed';
  END IF;
  IF public.pg_brand_can_collect(NULL) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'I1919-B06: null brand must fail closed';
  END IF;

  SET LOCAL ROLE anon;
  SELECT array_agg(brand_id ORDER BY brand_id)
    INTO v_ids
    FROM public.pg_brands_can_collect(
      ARRAY[v_stripe, v_paystack, v_unready, v_pending, v_missing, v_paystack]
    );
  RESET ROLE;

  IF v_ids IS DISTINCT FROM ARRAY[
    LEAST(v_stripe, v_paystack), GREATEST(v_stripe, v_paystack)
  ] THEN
    RAISE EXCEPTION 'I1919-B07: batch returned %, expected exactly two distinct ready IDs', v_ids;
  END IF;

  SET LOCAL ROLE authenticated;
  SELECT array_agg(brand_id ORDER BY brand_id)
    INTO v_ids
    FROM public.pg_brands_can_collect(ARRAY[v_paystack, v_unready]);
  RESET ROLE;
  IF v_ids IS DISTINCT FROM ARRAY[v_paystack] THEN
    RAISE EXCEPTION 'I1919-B08: authenticated batch returned %', v_ids;
  END IF;

  IF EXISTS (SELECT 1 FROM public.pg_brands_can_collect(NULL)) THEN
    RAISE EXCEPTION 'I1919-B09: null batch input must be empty';
  END IF;

  FOREACH v_sig IN ARRAY ARRAY[
    'public.business_publish_event_draft(uuid,jsonb,integer)',
    'public.business_publish_trip_draft(uuid,jsonb,integer)',
    'public.biz_create_experience(uuid,jsonb,boolean)',
    'public.biz_publish_experience(uuid,jsonb,boolean)',
    'public.biz_update_live_trip(uuid,jsonb,text)',
    'public.biz_update_live_experience(uuid,jsonb,text)'
  ] LOOP
    v_def := pg_get_functiondef(v_sig::regprocedure);
    IF position('pg_brand_can_collect(' IN v_def) = 0
       OR position('pg_brand_can_charge(' IN v_def) > 0 THEN
      RAISE EXCEPTION 'I1919-B10: % has wrong readiness authority', v_sig;
    END IF;
    IF position('stripe_charges_disabled' IN v_def) = 0
       OR position('payment_collection_unavailable' IN v_def) > 0 THEN
      RAISE EXCEPTION 'I1919-B11: % broke transitional wire contract (#1922)', v_sig;
    END IF;
  END LOOP;

  FOREACH v_sig IN ARRAY ARRAY[
    'public.pg_public_brand_upcoming(text,timestamptz,integer)',
    'public.pg_discover_business_events(text[],timestamptz,timestamptz,text[],text[],text[],integer,integer,double precision,double precision,double precision)',
    'public.pg_eligible_experiences_for_deck(double precision,double precision,double precision,text[],timestamptz,uuid[],integer)',
    'public.pg_brand_experiences_for_place(uuid)',
    'public.pg_public_experience_by_slug(text,text)',
    'public.pg_public_experiences_by_brand(text)',
    'public.pg_public_trips_by_brand(text)'
  ] LOOP
    v_def := pg_get_functiondef(v_sig::regprocedure);
    IF position('pg_brand_can_collect(' IN v_def) = 0
       OR position('pg_brand_can_charge(' IN v_def) > 0 THEN
      RAISE EXCEPTION 'I1919-B12: % has wrong buyer-read authority', v_sig;
    END IF;
  END LOOP;
END
$test$;

ROLLBACK;

\echo 'issue #1919 provider-neutral readiness behavior PASS'
