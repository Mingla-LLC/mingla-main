-- Issue #3645 option b (2026-10-22) — the Stripe processing-fee make-good ledger.
--
-- Legacy Connect accounts (fees_collector=stripe) lose Stripe's processing fee
-- from the connected balance, so the ledger release (gross − refunds − disputes
-- − Mingla fee, #4044) cannot fit: Salsa4Life 3a4fa269… owes 3,090 while the
-- account holds at most 2,969. 20271213003645_issue_3645_stripe_fee_make_good.sql
-- plans a platform → connected-account Transfer equal to the release's stored
-- item provider fee and records Stripe's answer.
--
-- Fails on revert of that migration: the census / plan / record functions and
-- the stripe_fee_make_goods table do not exist.
--
-- Cases:
--   A. The Salsa4Life shape (121-cent fee): census owes 121; a wrong expected
--      amount is refused; the plan writes one row with a deterministic key; a
--      second plan resumes the same row (never a second Transfer); recording
--      the Transfer settles it; afterwards nothing is owed and a replayed
--      record is a no-op while a different Transfer id is refused.
--   B. A release whose items grow after a make-good owes only the difference.
--   C. A definitive Stripe refusal marks the row failed; the retry gets a new
--      key for the same amount.
--   D. Paid, Paystack and unknown releases are refused.
--   E. A sale charged on a different account than the brand's current one is
--      refused and shown as ineligible in the census.
--   F. A detached account is refused.
--   G. A wrong amount or malformed Transfer id cannot be recorded as sent.
--   H. anon / authenticated cannot call the functions or read the table.

BEGIN;

CREATE FUNCTION pg_temp.i3645m_brand(
  p_tag text, p_owner uuid, p_brand uuid, p_event uuid, p_acct text
) RETURNS void LANGUAGE plpgsql AS $fx$
BEGIN
  INSERT INTO auth.users(id) VALUES (p_owner);
  INSERT INTO public.creator_accounts(id, email)
  VALUES (p_owner, 'owner-3645m-' || p_tag || '@example.test');
  INSERT INTO public.brands(
    id, account_id, name, slug, payment_provider, pricing_region,
    pricing_currency, default_currency, payout_hold_cutover_at
  ) VALUES (
    p_brand, p_owner, 'Issue 3645m ' || p_tag, 'issue-3645m-' || p_tag,
    'stripe', 'US', 'USD', 'USD', timestamptz '2026-09-01 00:00:00+00'
  );
  INSERT INTO public.events(id, brand_id, title, slug, status, currency, visibility)
  VALUES (p_event, p_brand, 'Issue 3645m ' || p_tag, 'issue-3645m-ev-' || p_tag,
          'scheduled', 'USD', 'private');
  INSERT INTO public.stripe_connect_accounts(
    brand_id, stripe_account_id, country, default_currency, payouts_enabled
  ) VALUES (p_brand, p_acct, 'US', 'USD', true);
END $fx$;

CREATE FUNCTION pg_temp.i3645m_order(
  p_order uuid, p_event uuid, p_charge text, p_acct text
) RETURNS void LANGUAGE plpgsql AS $fx$
BEGIN
  INSERT INTO public.orders(
    id, event_id, total_cents, currency, payment_status, stripe_payment_intent_id,
    stripe_charge_id, buyer_phone_e164, stripe_transfer_destination
  ) VALUES (
    p_order, p_event, 3135, 'USD', 'paid', 'pi_' || p_charge, p_charge,
    '+15555553645', p_acct
  );
END $fx$;

-- One release with one order item: gross 3135, Mingla fee 45, stored provider
-- fee p_fee (the Salsa4Life numbers when p_fee = 121).
CREATE FUNCTION pg_temp.i3645m_release(
  p_release uuid, p_brand uuid, p_event uuid, p_key text, p_order uuid,
  p_fee integer, p_status text, p_provider text DEFAULT 'stripe'
) RETURNS void LANGUAGE plpgsql AS $fx$
BEGIN
  INSERT INTO public.brand_payout_releases(
    id, brand_id, event_id, occurrence_key, surface, provider, currency,
    anchor_end_at, releasable_at, gross_cents, mingla_fee_cents,
    partner_share_cents, provider_fee_cents, net_release_cents, status
  ) VALUES (
    p_release, p_brand, p_event, p_key, 'order', p_provider, 'usd',
    timestamptz '2026-10-17 00:00:00+00', timestamptz '2026-10-18 00:00:00+00',
    3135, 45, 0, p_fee, 3090, p_status
  );
  INSERT INTO public.payout_release_items(
    release_id, source_type, source_id, gross_cents, mingla_fee_cents,
    partner_share_cents, provider_fee_cents, net_cents, source_finalized_at
  ) VALUES (
    p_release, 'order', p_order, 3135, 45, 0, p_fee, 3090,
    timestamptz '2026-10-16 00:00:00+00'
  );
END $fx$;

-- Runs p_sql and asserts it raises an error whose message contains p_code.
CREATE FUNCTION pg_temp.i3645m_refused(p_case text, p_sql text, p_code text)
RETURNS void LANGUAGE plpgsql AS $fx$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF position(p_code IN SQLERRM) = 0 THEN
      RAISE EXCEPTION '%: expected %, got %', p_case, p_code, SQLERRM;
    END IF;
    RETURN;
  END;
  RAISE EXCEPTION '%: expected % but the call succeeded', p_case, p_code;
END $fx$;

DO $cases$
DECLARE
  v_owner constant uuid := '36450000-0000-4000-8000-0000000d0001';
  v_brand constant uuid := '36450000-0000-4000-8000-0000000d0002';
  v_event constant uuid := '36450000-0000-4000-8000-0000000d0003';
  v_owner_x constant uuid := '36450000-0000-4000-8000-0000000d0011';
  v_brand_x constant uuid := '36450000-0000-4000-8000-0000000d0012';
  v_event_x constant uuid := '36450000-0000-4000-8000-0000000d0013';
  v_acct constant text := 'acct_3645mSalsa';
  v_acct_x constant text := 'acct_3645mDetached';
  v_o_a constant uuid := '36450000-0000-4000-8000-0000000d00a1';
  v_o_b2 constant uuid := '36450000-0000-4000-8000-0000000d00b2';
  v_o_c constant uuid := '36450000-0000-4000-8000-0000000d00c1';
  v_o_paid constant uuid := '36450000-0000-4000-8000-0000000d00d1';
  v_o_ps constant uuid := '36450000-0000-4000-8000-0000000d00d2';
  v_o_e constant uuid := '36450000-0000-4000-8000-0000000d00e1';
  v_o_f constant uuid := '36450000-0000-4000-8000-0000000d00f1';
  v_rel_a constant uuid := '36450000-0000-4000-8000-0000000d0a00';
  v_rel_c constant uuid := '36450000-0000-4000-8000-0000000d0c00';
  v_rel_paid constant uuid := '36450000-0000-4000-8000-0000000d0d01';
  v_rel_ps constant uuid := '36450000-0000-4000-8000-0000000d0d02';
  v_rel_e constant uuid := '36450000-0000-4000-8000-0000000d0e00';
  v_rel_f constant uuid := '36450000-0000-4000-8000-0000000d0f00';
  v_plan jsonb;
  v_again jsonb;
  v_census record;
  v_count integer;
  v_status text;
  v_first_key text;
BEGIN
  PERFORM pg_temp.i3645m_brand('salsa', v_owner, v_brand, v_event, v_acct);
  PERFORM pg_temp.i3645m_brand('gone', v_owner_x, v_brand_x, v_event_x, v_acct_x);

  PERFORM pg_temp.i3645m_order(v_o_a, v_event, 'ch_3645m_a', v_acct);
  PERFORM pg_temp.i3645m_order(v_o_b2, v_event, 'ch_3645m_b2', v_acct);
  PERFORM pg_temp.i3645m_order(v_o_c, v_event, 'ch_3645m_c', v_acct);
  PERFORM pg_temp.i3645m_order(v_o_paid, v_event, 'ch_3645m_paid', v_acct);
  PERFORM pg_temp.i3645m_order(v_o_ps, v_event, 'ch_3645m_ps', v_acct);
  PERFORM pg_temp.i3645m_order(v_o_e, v_event, 'ch_3645m_e', 'acct_3645mOther');
  PERFORM pg_temp.i3645m_order(v_o_f, v_event_x, 'ch_3645m_f', v_acct_x);

  PERFORM pg_temp.i3645m_release(v_rel_a, v_brand, v_event, '3645m-a', v_o_a, 121, 'blocked_balance');
  PERFORM pg_temp.i3645m_release(v_rel_c, v_brand, v_event, '3645m-c', v_o_c, 39, 'pending');
  PERFORM pg_temp.i3645m_release(v_rel_paid, v_brand, v_event, '3645m-paid', v_o_paid, 121, 'released');
  PERFORM pg_temp.i3645m_release(v_rel_ps, v_brand, v_event, '3645m-ps', v_o_ps, 121, 'pending', 'paystack');
  PERFORM pg_temp.i3645m_release(v_rel_e, v_brand, v_event, '3645m-e', v_o_e, 121, 'pending');
  PERFORM pg_temp.i3645m_release(v_rel_f, v_brand_x, v_event_x, '3645m-f', v_o_f, 121, 'pending');
  UPDATE public.stripe_connect_accounts SET detached_at = now() WHERE brand_id = v_brand_x;

  -- ── A ──────────────────────────────────────────────────────────────────
  SELECT * INTO v_census FROM public.stripe_fee_make_good_census() WHERE release_id = v_rel_a;
  IF NOT FOUND OR v_census.provider_fee_cents <> 121 OR v_census.owed_cents <> 121
     OR NOT v_census.eligible OR v_census.made_good_cents <> 0
     OR v_census.stripe_account_id <> v_acct THEN
    RAISE EXCEPTION 'case_a census: %', row_to_json(v_census);
  END IF;

  PERFORM pg_temp.i3645m_refused('case_a wrong amount',
    format('SELECT public.plan_stripe_fee_make_good(%L, 120, %L, %L)', v_rel_a, 'ops@example.test', 'make good'),
    'make_good_amount_mismatch');
  PERFORM pg_temp.i3645m_refused('case_a no reason',
    format('SELECT public.plan_stripe_fee_make_good(%L, 121, %L, %L)', v_rel_a, 'ops@example.test', '  '),
    'reason_required');

  v_plan := public.plan_stripe_fee_make_good(v_rel_a, 121, 'ops@example.test', 'Salsa4Life make good');
  IF v_plan->>'outcome' <> 'planned' OR (v_plan->>'amount_cents')::int <> 121
     OR v_plan->>'stripe_account_id' <> v_acct OR v_plan->>'currency' <> 'usd'
     OR v_plan->>'idempotency_key' <> format('mingla_fee_make_good_%s_121_a0', v_rel_a) THEN
    RAISE EXCEPTION 'case_a plan: %', v_plan;
  END IF;

  v_again := public.plan_stripe_fee_make_good(v_rel_a, 121, 'ops@example.test', 'retry');
  IF v_again->>'outcome' <> 'resumed' OR v_again->>'make_good_id' <> v_plan->>'make_good_id'
     OR v_again->>'idempotency_key' <> v_plan->>'idempotency_key' THEN
    RAISE EXCEPTION 'case_a resume: %', v_again;
  END IF;
  SELECT count(*) INTO v_count FROM public.stripe_fee_make_goods WHERE release_id = v_rel_a;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'case_a: a resumed plan must not add a row, got %', v_count;
  END IF;

  v_status := public.record_stripe_fee_make_good(
    (v_plan->>'make_good_id')::uuid, 'sent', 'tr_3645mSalsa', 121, NULL);
  IF v_status <> 'sent' THEN RAISE EXCEPTION 'case_a record: %', v_status; END IF;

  SELECT * INTO v_census FROM public.stripe_fee_make_good_census() WHERE release_id = v_rel_a;
  IF v_census.owed_cents <> 0 OR v_census.made_good_cents <> 121 OR v_census.eligible
     OR v_census.ineligible_reason <> 'nothing_owed' THEN
    RAISE EXCEPTION 'case_a census after: %', row_to_json(v_census);
  END IF;
  v_again := public.plan_stripe_fee_make_good(v_rel_a, 0, 'ops@example.test', 'again');
  IF v_again->>'outcome' <> 'nothing_owed' THEN
    RAISE EXCEPTION 'case_a nothing owed: %', v_again;
  END IF;
  PERFORM pg_temp.i3645m_refused('case_a paid twice',
    format('SELECT public.plan_stripe_fee_make_good(%L, 121, %L, %L)', v_rel_a, 'ops@example.test', 'again'),
    'make_good_amount_mismatch');
  IF public.record_stripe_fee_make_good((v_plan->>'make_good_id')::uuid, 'sent', 'tr_3645mSalsa', 121, NULL) <> 'sent' THEN
    RAISE EXCEPTION 'case_a: replayed record must be a no-op';
  END IF;
  PERFORM pg_temp.i3645m_refused('case_a other transfer',
    format('SELECT public.record_stripe_fee_make_good(%L, %L, %L, 121, NULL)', v_plan->>'make_good_id', 'sent', 'tr_3645mOther'),
    'make_good_already_sent');
  -- The make-good never touches the release itself.
  IF (SELECT net_release_cents FROM public.brand_payout_releases WHERE id = v_rel_a) <> 3090 THEN
    RAISE EXCEPTION 'case_a: the release ledger must be unchanged';
  END IF;

  -- ── B: items grow after a make-good ───────────────────────────────────
  INSERT INTO public.payout_release_items(
    release_id, source_type, source_id, gross_cents, mingla_fee_cents,
    partner_share_cents, provider_fee_cents, net_cents, source_finalized_at
  ) VALUES (v_rel_a, 'order', v_o_b2, 1000, 15, 0, 30, 985, timestamptz '2026-10-16 01:00:00+00');
  v_plan := public.plan_stripe_fee_make_good(v_rel_a, 30, 'ops@example.test', 'second sale');
  IF v_plan->>'outcome' <> 'planned' OR (v_plan->>'amount_cents')::int <> 30
     OR v_plan->>'idempotency_key' <> format('mingla_fee_make_good_%s_151_a0', v_rel_a) THEN
    RAISE EXCEPTION 'case_b plan: %', v_plan;
  END IF;

  -- ── C: definitive refusal, then retry with a fresh key ────────────────
  v_plan := public.plan_stripe_fee_make_good(v_rel_c, 39, 'ops@example.test', 'Lantern make good');
  v_first_key := v_plan->>'idempotency_key';
  IF public.record_stripe_fee_make_good((v_plan->>'make_good_id')::uuid, 'failed', NULL, 39,
       'balance_insufficient') <> 'failed' THEN
    RAISE EXCEPTION 'case_c: failed not recorded';
  END IF;
  v_again := public.plan_stripe_fee_make_good(v_rel_c, 39, 'ops@example.test', 'retry after top-up');
  IF v_again->>'outcome' <> 'planned' OR (v_again->>'amount_cents')::int <> 39
     OR v_again->>'idempotency_key' = v_first_key
     OR v_again->>'idempotency_key' <> format('mingla_fee_make_good_%s_39_a1', v_rel_c) THEN
    RAISE EXCEPTION 'case_c retry: %', v_again;
  END IF;
  PERFORM pg_temp.i3645m_refused('case_c failed is final',
    format('SELECT public.record_stripe_fee_make_good(%L, %L, %L, 39, NULL)', v_plan->>'make_good_id', 'sent', 'tr_3645mLate'),
    'make_good_already_failed');

  -- ── D: paid / Paystack / unknown ──────────────────────────────────────
  PERFORM pg_temp.i3645m_refused('case_d paid',
    format('SELECT public.plan_stripe_fee_make_good(%L, 121, %L, %L)', v_rel_paid, 'ops@example.test', 'x'),
    'release_not_unpaid');
  PERFORM pg_temp.i3645m_refused('case_d paystack',
    format('SELECT public.plan_stripe_fee_make_good(%L, 121, %L, %L)', v_rel_ps, 'ops@example.test', 'x'),
    'release_not_stripe');
  PERFORM pg_temp.i3645m_refused('case_d unknown',
    format('SELECT public.plan_stripe_fee_make_good(%L, 121, %L, %L)', gen_random_uuid(), 'ops@example.test', 'x'),
    'release_not_found');
  IF EXISTS (SELECT 1 FROM public.stripe_fee_make_good_census() WHERE release_id = v_rel_ps) THEN
    RAISE EXCEPTION 'case_d: Paystack releases are not in the Stripe census';
  END IF;

  -- ── E: sale on another account ─────────────────────────────────────────
  PERFORM pg_temp.i3645m_refused('case_e',
    format('SELECT public.plan_stripe_fee_make_good(%L, 121, %L, %L)', v_rel_e, 'ops@example.test', 'x'),
    'sale_not_on_current_account');
  SELECT * INTO v_census FROM public.stripe_fee_make_good_census() WHERE release_id = v_rel_e;
  IF v_census.eligible OR v_census.ineligible_reason <> 'sale_not_on_current_account' THEN
    RAISE EXCEPTION 'case_e census: %', row_to_json(v_census);
  END IF;

  -- ── F: detached account ────────────────────────────────────────────────
  PERFORM pg_temp.i3645m_refused('case_f',
    format('SELECT public.plan_stripe_fee_make_good(%L, 121, %L, %L)', v_rel_f, 'ops@example.test', 'x'),
    'no_active_connect_account');

  -- ── G: record guards ───────────────────────────────────────────────────
  v_plan := public.plan_stripe_fee_make_good(v_rel_c, 39, 'ops@example.test', 'resume');
  PERFORM pg_temp.i3645m_refused('case_g amount',
    format('SELECT public.record_stripe_fee_make_good(%L, %L, %L, 40, NULL)', v_plan->>'make_good_id', 'sent', 'tr_3645mC'),
    'make_good_amount_not_ledger_exact');
  PERFORM pg_temp.i3645m_refused('case_g transfer id',
    format('SELECT public.record_stripe_fee_make_good(%L, %L, %L, 39, NULL)', v_plan->>'make_good_id', 'sent', 'po_3645mC'),
    'stripe_transfer_id_required');
  PERFORM pg_temp.i3645m_refused('case_g outcome',
    format('SELECT public.record_stripe_fee_make_good(%L, %L, NULL, 39, NULL)', v_plan->>'make_good_id', 'pending'),
    'invalid_make_good_outcome');
  PERFORM pg_temp.i3645m_refused('case_g unknown',
    format('SELECT public.record_stripe_fee_make_good(%L, %L, %L, 39, NULL)', gen_random_uuid(), 'sent', 'tr_x'),
    'make_good_not_found');

  -- ── H: privileges ──────────────────────────────────────────────────────
  IF has_function_privilege('anon', 'public.plan_stripe_fee_make_good(uuid,integer,text,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.plan_stripe_fee_make_good(uuid,integer,text,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.record_stripe_fee_make_good(uuid,text,text,integer,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.stripe_fee_make_good_census()', 'EXECUTE')
     OR has_table_privilege('authenticated', 'public.stripe_fee_make_goods', 'SELECT')
     OR has_table_privilege('anon', 'public.stripe_fee_make_goods', 'SELECT') THEN
    RAISE EXCEPTION 'case_h: anon/authenticated must not reach the make-good ledger';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.plan_stripe_fee_make_good(uuid,integer,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'case_h: service_role must be able to plan';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.stripe_fee_make_goods'::regclass) THEN
    RAISE EXCEPTION 'case_h: RLS must be enabled';
  END IF;

  RAISE NOTICE 'issue_3645 stripe fee make-good pass';
END $cases$;

ROLLBACK;
