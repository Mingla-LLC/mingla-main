-- Issue #4130 (Wave 2a) — Mingla money: own-day FX, no cross-currency sums,
-- USD conversion, "never put into a payout", owes-back settlement, and
-- Paystack payment readiness.
--
-- Proves, against the replayed schema:
--   FX-1  fx_rate_on returns the latest rate on or before the moment; a moment
--         before the first snapshot is NULL (no forward extrapolation); a
--         rejected snapshot is ignored; expiry is ignored; USD is 1.
--   FX-2  fx_usd_minor_exact converts minor units at that rate.
--   SUM-1 admin_mingla_money_summary keeps NGN and USD apart (no row adds them).
--   SUM-2 every figure also has a USD value at its own day's rate, rounded per
--         currency and day; a currency with no rate for its day has NO USD
--         figure (NULL), never a guessed one.
--   SUM-3 pricing period per sale from fee / ticket price (4.5% vs older).
--   SUM-4 a paid sale with no payout item is "never put into a payout".
--   SUM-5 a period filter limits the period figures.
--   OWE-1 admin_settle_owes_back records who/when/reference, writes an audit
--         row, and the summary and payout list stop counting settled credit;
--         settling again finds nothing; a non-admin is refused.
--   PAY-1 admin_list_brand_payment_readiness reads Paystack recipients: a
--         Paystack brand with a bank on file, a Paystack brand with no setup
--         (listed), a Stripe brand with no setup (not listed), a deleted brand
--         (not listed); paid-out-to-date per currency; search by Paystack code.
--   ORD-1 admin_list_orders: host-paid state and the free / host-not-paid
--         filters.
--
-- FAILS-ON-REVERT: dropping the `s.provider_updated_at <= p_at` bound in
-- fx_rate_on makes FX-1 pick a later rate (fx_forward_extrapolated); removing
-- the NOT EXISTS settlement check in mingla_money_lines keeps owes-back after
-- settling (owes_back_still_counted).
-- MINGLA-INVARIANT: I-4130-FX-OWN-DAY | issue #4130 | proved by FX-1/SUM-2 here.
-- MINGLA-INVARIANT: I-4130-NO-CROSS-CURRENCY-SUM | issue #4130 | proved by SUM-1 here.
\set ON_ERROR_STOP on
BEGIN;

DO $test$
DECLARE
  v_owner     constant uuid := '41300000-0000-4000-8a00-000000000001';
  v_admin     constant uuid := '41300000-0000-4000-8a00-000000000002';
  v_member    constant uuid := '41300000-0000-4000-8a00-000000000003';
  v_brand_ng  constant uuid := '41300000-0000-4000-8b00-000000000001';
  v_brand_us  constant uuid := '41300000-0000-4000-8b00-000000000002';
  v_brand_ps0 constant uuid := '41300000-0000-4000-8b00-000000000003';
  v_brand_st0 constant uuid := '41300000-0000-4000-8b00-000000000004';
  v_brand_del constant uuid := '41300000-0000-4000-8b00-000000000005';
  v_ev_ng     constant uuid := '41300000-0000-4000-8c00-000000000001';
  v_ev_us     constant uuid := '41300000-0000-4000-8c00-000000000002';
  v_o1        constant uuid := '41300000-0000-4000-8d00-000000000001';
  v_o2        constant uuid := '41300000-0000-4000-8d00-000000000002';
  v_o3        constant uuid := '41300000-0000-4000-8d00-000000000003';
  v_o4        constant uuid := '41300000-0000-4000-8d00-000000000004';
  v_o5        constant uuid := '41300000-0000-4000-8d00-000000000005';
  v_o6        constant uuid := '41300000-0000-4000-8d00-000000000006';
  v_r1        constant uuid := '41300000-0000-4000-8e00-000000000001';
  v_r2        constant uuid := '41300000-0000-4000-8e00-000000000002';
  v_s1        constant uuid := '41300000-0000-4000-8f00-000000000001';
  v_s2        constant uuid := '41300000-0000-4000-8f00-000000000002';
  v_s3        constant uuid := '41300000-0000-4000-8f00-000000000003';
  v_day1      constant timestamptz := '2001-01-01 12:00:00+00';
  v_day2      constant timestamptz := '2001-01-02 12:00:00+00';
  v_rate      numeric;
  v_sum       jsonb;
  v_sum2      jsonb;
  v_res       jsonb;
  v_list      jsonb;
  v_err       text;
  v_n         int;

BEGIN
  -- ── FX fixtures: two kept daily snapshots and one rejected later one ──────
  INSERT INTO public.fx_rate_snapshots (id, provider, base_currency_code,
    provider_updated_at, provider_next_update_at, provider_eol_at, fetched_at,
    stale_after, expires_at, payload_sha256, status)
  VALUES
    (v_s1, 'exchange_rate_api_open_v6', 'USD', '2001-01-01 00:02+00', '2001-01-02 00:02+00',
      '2001-01-03 00:02+00', '2001-01-01 01:15+00', '2001-01-02 00:02+00', '2001-01-03 00:02+00',
      'issue-4130-s1', 'superseded'),
    (v_s2, 'exchange_rate_api_open_v6', 'USD', '2001-01-02 00:02+00', '2001-01-03 00:02+00',
      '2001-01-04 00:02+00', '2001-01-02 01:15+00', '2001-01-03 00:02+00', '2001-01-04 00:02+00',
      'issue-4130-s2', 'superseded'),
    (v_s3, 'exchange_rate_api_open_v6', 'USD', '2001-01-03 00:02+00', '2001-01-04 00:02+00',
      '2001-01-05 00:02+00', '2001-01-03 01:15+00', '2001-01-04 00:02+00', '2001-01-05 00:02+00',
      'issue-4130-s3', 'rejected');
  INSERT INTO public.fx_rates (snapshot_id, currency_code, rate_per_base) VALUES
    (v_s1, 'NGN', 1000), (v_s2, 'NGN', 2100), (v_s3, 'NGN', 5000),
    (v_s1, 'USD', 1), (v_s2, 'USD', 1), (v_s3, 'USD', 1);

  -- FX-1
  IF public.fx_rate_on('NGN', v_day1) IS DISTINCT FROM 1000 THEN
    RAISE EXCEPTION 'fx_day1_wrong: %', public.fx_rate_on('NGN', v_day1);
  END IF;
  IF public.fx_rate_on('ngn', v_day2) IS DISTINCT FROM 2100 THEN
    RAISE EXCEPTION 'fx_day2_wrong: %', public.fx_rate_on('ngn', v_day2);
  END IF;
  -- Before the first snapshot: nothing earlier exists, so NULL. A lookup that
  -- reached forward would return 1000 here.
  v_rate := public.fx_rate_on('NGN', '2000-12-31 23:00+00');
  IF v_rate IS NOT NULL THEN RAISE EXCEPTION 'fx_forward_extrapolated: %', v_rate; END IF;
  -- After the rejected snapshot: the rejected 5000 is ignored; long-expired
  -- snapshots still serve history.
  IF public.fx_rate_on('NGN', '2001-02-01 00:00+00') IS DISTINCT FROM 2100 THEN
    RAISE EXCEPTION 'fx_rejected_or_expired_wrong: %', public.fx_rate_on('NGN', '2001-02-01 00:00+00');
  END IF;
  IF public.fx_rate_on('USD', '1990-01-01 00:00+00') IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'fx_usd_not_one';
  END IF;
  IF public.fx_rate_on('GBP', v_day1) IS NOT NULL THEN RAISE EXCEPTION 'fx_unknown_rate_invented'; END IF;

  -- FX-2: 150,000 kobo at 1,000 NGN per USD is 150 US cents.
  IF public.fx_usd_minor_exact(150000, 'NGN', v_day1) IS DISTINCT FROM 150 THEN
    RAISE EXCEPTION 'fx_convert_wrong: %', public.fx_usd_minor_exact(150000, 'NGN', v_day1);
  END IF;
  IF public.fx_usd_minor_exact(150000, 'NGN', '2000-01-01+00') IS NOT NULL THEN
    RAISE EXCEPTION 'fx_convert_without_rate';
  END IF;

  -- ── People and brands ─────────────────────────────────────────────────────
  INSERT INTO auth.users(id, email) VALUES
    (v_owner, 'owner-4130@example.test'),
    (v_admin, 'admin-4130@example.test'),
    (v_member, 'member-4130@example.test');
  INSERT INTO public.creator_accounts(id, email) VALUES (v_owner, 'owner-4130@example.test');
  INSERT INTO public.admin_users(email, role, status)
  VALUES ('admin-4130@example.test', 'admin', 'active')
  ON CONFLICT (email) DO UPDATE SET role = EXCLUDED.role, status = EXCLUDED.status;

  INSERT INTO public.brands (id, account_id, name, slug, default_currency, payment_provider,
    payment_country, pricing_region, pricing_currency, paystack_subaccount_code, deleted_at)
  VALUES
    (v_brand_ng, v_owner, 'W2a Naira Club', 'w2a-4130-naira', 'NGN', 'paystack', 'NG', 'NG', 'NGN', 'ACCT_w2a4130', NULL),
    (v_brand_us, v_owner, 'W2a Dollar Room', 'w2a-4130-dollar', 'USD', 'stripe', 'US', 'US', 'USD', NULL, NULL),
    (v_brand_ps0, v_owner, 'W2a Paystack Nothing', 'w2a-4130-ps-none', 'NGN', 'paystack', 'NG', 'NG', 'NGN', NULL, NULL),
    (v_brand_st0, v_owner, 'W2a Stripe Nothing', 'w2a-4130-st-none', 'USD', 'stripe', 'US', 'US', 'USD', NULL, NULL),
    (v_brand_del, v_owner, 'W2a Deleted Paystack', 'w2a-4130-deleted', 'NGN', 'paystack', 'NG', 'NG', 'NGN', NULL, now());

  INSERT INTO public.brand_paystack_recipients (brand_id, recipient_code, bank_code,
    account_fingerprint, account_number_masked, account_name, is_active)
  VALUES (v_brand_ng, 'RCP_w2a4130find', '058', 'hmac-sha256:' || repeat('d', 64),
    '••••4130', 'W2a Account', true);

  INSERT INTO public.stripe_connect_accounts (brand_id, stripe_account_id, charges_enabled,
    payouts_enabled, country, default_currency)
  VALUES (v_brand_us, 'acct_w2a4130', true, true, 'US', 'usd');

  INSERT INTO public.events(id, brand_id, title, slug, status, currency) VALUES
    (v_ev_ng, v_brand_ng, 'W2a Naira Night', 'w2a-4130-naira-night', 'draft', 'NGN'),
    (v_ev_us, v_brand_us, 'W2a Dollar Night', 'w2a-4130-dollar-night', 'draft', 'USD');

  -- ── Orders ────────────────────────────────────────────────────────────────
  -- O1 NGN day 1, 4.5% pricing: ticket 100,000 kobo, fee 4,500, processing 2,000.
  -- O2 NGN day 2, older pricing: ticket 100,000, fee 1,500, processing 2,500.
  -- O3 USD day 1: ticket 985, fee 15, processing 60; its payout is late.
  -- O4 NGN day 1, paid, never put into a payout.
  -- O5 NGN free order.
  -- O6 GBP before any GBP rate: buyers paid has no USD figure.
  INSERT INTO public.orders(id, event_id, total_cents, buyer_total_cents, net_subtotal_cents,
    currency, payment_status, payment_method, source, created_at, confirmed_at,
    list_subtotal_cents, discount_cents, buyer_fees_cents, tax_cents, pricing_source)
  SELECT id, event_id, total_cents, buyer_total_cents, net_subtotal_cents, currency,
    payment_status, payment_method, source, created_at, confirmed_at,
    net_subtotal_cents, 0, buyer_total_cents - net_subtotal_cents, 0, 'computed_at_checkout'
  FROM (VALUES
    (v_o1, v_ev_ng, 104500, 104500, 100000, 'NGN', 'paid', 'online_card', 'legacy', v_day1, v_day1),
    (v_o2, v_ev_ng, 101500, 101500, 100000, 'NGN', 'paid', 'online_card', 'legacy', v_day2, v_day2),
    (v_o3, v_ev_us, 1000, 1000, 985, 'USD', 'paid', 'online_card', 'legacy', v_day1, v_day1),
    (v_o4, v_ev_ng, 50000, 50000, 48000, 'NGN', 'paid', 'online_card', 'legacy', v_day1, v_day1),
    (v_o5, v_ev_ng, 0, 0, 0, 'NGN', 'paid', 'free', 'legacy', v_day1, v_day1),
    (v_o6, v_ev_us, 2100, 2100, 2100, 'GBP', 'paid', 'online_card', 'legacy', '2000-06-01+00'::timestamptz, '2000-06-01+00'::timestamptz)
  ) AS v(id, event_id, total_cents, buyer_total_cents, net_subtotal_cents, currency,
         payment_status, payment_method, source, created_at, confirmed_at);

  -- ── Payout ledger ─────────────────────────────────────────────────────────
  INSERT INTO public.brand_payout_releases (id, brand_id, occurrence_key, surface, provider,
    currency, anchor_end_at, releasable_at, gross_cents, mingla_fee_cents, provider_fee_cents,
    net_release_cents, organiser_cash_delivered_cents, status, released_at, created_at)
  VALUES
    (v_r1, v_brand_ng, 'w2a-4130-r1', 'order', 'paystack', 'ngn', v_day1, v_day1 + interval '1 day',
      206000, 6000, 4500, 200000, 198500, 'released', v_day2, v_day1),
    (v_r2, v_brand_us, 'w2a-4130-r2', 'order', 'stripe', 'usd', v_day1, v_day1 + interval '1 day',
      1000, 15, 60, 985, 0, 'blocked_balance', NULL, v_day1);

  INSERT INTO public.payout_release_items (release_id, source_type, source_id, gross_cents,
    mingla_fee_cents, provider_fee_cents, net_cents, source_finalized_at)
  VALUES
    (v_r1, 'order', v_o1, 104500, 4500, 1900, 100000, v_day1),
    (v_r1, 'order', v_o2, 101500, 1500, 2600, 100000, v_day2),
    (v_r2, 'order', v_o3, 1000, 15, 60, 985, v_day1);

  INSERT INTO public.payout_ledger_adjustments (release_id, brand_id, currency, kind,
    amount_cents, idempotency_key)
  VALUES
    (v_r1, v_brand_ng, 'ngn', 'transfer_fee_credit', 1000, 'w2a-4130-credit-1'),
    (v_r1, v_brand_ng, 'ngn', 'transfer_fee_credit', 500, 'w2a-4130-credit-2');

  -- ── Summary as the admin ──────────────────────────────────────────────────
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  v_sum := public.admin_mingla_money_summary(NULL, NULL);
  v_sum2 := public.admin_mingla_money_summary('2001-01-02 00:00+00', '2001-01-03 00:00+00');
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);

  -- SUM-1: fee per currency, never added together.
  IF (SELECT (l->>'cents')::bigint FROM jsonb_array_elements(v_sum->'lines') l
      WHERE l->>'kind' = 'fee' AND l->>'currency' = 'NGN') IS DISTINCT FROM 6000 THEN
    RAISE EXCEPTION 'sum_ngn_fee_wrong: %', v_sum->'lines';
  END IF;
  IF (SELECT (l->>'cents')::bigint FROM jsonb_array_elements(v_sum->'lines') l
      WHERE l->>'kind' = 'fee' AND l->>'currency' = 'USD') IS DISTINCT FROM 15 THEN
    RAISE EXCEPTION 'sum_usd_fee_wrong: %', v_sum->'lines';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_sum->'lines') l
             WHERE l->>'currency' IS NULL OR (l->>'cents')::bigint = 6015) THEN
    RAISE EXCEPTION 'sum_crossed_currencies: %', v_sum->'lines';
  END IF;
  SELECT count(*) INTO v_n FROM jsonb_array_elements(v_sum->'lines') l WHERE l->>'kind' = 'fee';
  IF v_n <> 2 THEN RAISE EXCEPTION 'sum_fee_rows_not_per_currency: %', v_n; END IF;

  -- SUM-2: USD at own-day rate, rounded per currency and day.
  --   NGN fee: day 1 4,500/1,000 = 4.5 -> 5; day 2 1,500/2,100 = 0.71 -> 1; total 6.
  --   NGN profit: day 1 2.6 -> 3; day 2 -0.52 -> -1; total 2.
  --   NGN buyers paid: day 1 (104,500 + 50,000)/1,000 = 154.5 -> 155; day 2 48.33 -> 48.
  IF (SELECT (l->>'usd_cents')::bigint FROM jsonb_array_elements(v_sum->'lines') l
      WHERE l->>'kind' = 'fee' AND l->>'currency' = 'NGN') IS DISTINCT FROM 6 THEN
    RAISE EXCEPTION 'sum_ngn_fee_usd_wrong: %', v_sum->'lines';
  END IF;
  IF (SELECT (l->>'usd_cents')::bigint FROM jsonb_array_elements(v_sum->'lines') l
      WHERE l->>'kind' = 'profit' AND l->>'currency' = 'NGN') IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'sum_ngn_profit_usd_wrong: %', v_sum->'lines';
  END IF;
  IF (SELECT (l->>'usd_cents')::bigint FROM jsonb_array_elements(v_sum->'lines') l
      WHERE l->>'kind' = 'buyers_paid' AND l->>'currency' = 'NGN') IS DISTINCT FROM 203 THEN
    RAISE EXCEPTION 'sum_ngn_paid_usd_wrong: %', v_sum->'lines';
  END IF;
  IF (SELECT (l->>'usd_cents')::bigint FROM jsonb_array_elements(v_sum->'lines') l
      WHERE l->>'kind' = 'profit' AND l->>'currency' = 'USD') IS DISTINCT FROM -45 THEN
    RAISE EXCEPTION 'sum_usd_profit_wrong: %', v_sum->'lines';
  END IF;
  -- GBP buyers paid exists natively but has no USD figure (no rate that old).
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_sum->'lines') l
      WHERE l->>'kind' = 'buyers_paid' AND l->>'currency' = 'GBP'
        AND (l->>'cents')::bigint = 2100 AND l->'usd_cents' = 'null'::jsonb) THEN
    RAISE EXCEPTION 'sum_gbp_usd_guessed: %', v_sum->'lines';
  END IF;

  -- SUM-3: pricing period by fee / ticket price.
  IF (SELECT (p->>'cents')::bigint FROM jsonb_array_elements(v_sum->'pricing'->'rows') p
      WHERE p->>'kind' = 'fee' AND p->>'currency' = 'NGN' AND p->>'period' = 'current') IS DISTINCT FROM 4500
     OR (SELECT (p->>'cents')::bigint FROM jsonb_array_elements(v_sum->'pricing'->'rows') p
      WHERE p->>'kind' = 'fee' AND p->>'currency' = 'NGN' AND p->>'period' = 'older') IS DISTINCT FROM 1500
     OR (SELECT (p->>'cents')::bigint FROM jsonb_array_elements(v_sum->'pricing'->'rows') p
      WHERE p->>'kind' = 'fee' AND p->>'currency' = 'USD' AND p->>'period' = 'older') IS DISTINCT FROM 15 THEN
    RAISE EXCEPTION 'sum_pricing_period_wrong: %', v_sum->'pricing';
  END IF;

  -- SUM-4: O4 is the one paid sale never put into a payout; free O5 is not.
  IF (v_sum->'exceptions'->'never_in_payout'->>'count')::int <> 2
     OR NOT (v_sum->'exceptions'->'never_in_payout'->'ids') @> to_jsonb(ARRAY[v_o4])
     OR (v_sum->'exceptions'->'never_in_payout'->'ids') @> to_jsonb(ARRAY[v_o5])
     OR (v_sum->'exceptions'->'never_in_payout'->'by_currency'->>'NGN')::bigint <> 50000 THEN
    RAISE EXCEPTION 'sum_never_in_payout_wrong: %', v_sum->'exceptions'->'never_in_payout';
  END IF;
  IF (v_sum->'exceptions'->'late_on_mingla'->>'count')::int <> 1
     OR (v_sum->'exceptions'->'processing_over_fee'->>'count')::int <> 2 THEN
    RAISE EXCEPTION 'sum_exceptions_wrong: %', v_sum->'exceptions';
  END IF;
  IF (SELECT (l->>'cents')::bigint FROM jsonb_array_elements(v_sum->'lines') l
      WHERE l->>'kind' = 'host_late_on_mingla' AND l->>'currency' = 'USD') IS DISTINCT FROM 985
     OR (SELECT (l->>'cents')::bigint FROM jsonb_array_elements(v_sum->'lines') l
      WHERE l->>'kind' = 'host_paid_all_time' AND l->>'currency' = 'NGN') IS DISTINCT FROM 198500 THEN
    RAISE EXCEPTION 'sum_host_money_wrong: %', v_sum->'lines';
  END IF;

  -- SUM-5: period from day 2 only sees O2's fee.
  IF (SELECT (l->>'cents')::bigint FROM jsonb_array_elements(v_sum2->'lines') l
      WHERE l->>'kind' = 'fee' AND l->>'currency' = 'NGN') IS DISTINCT FROM 1500
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_sum2->'lines') l
      WHERE l->>'kind' = 'fee' AND l->>'currency' = 'USD') THEN
    RAISE EXCEPTION 'sum_period_filter_wrong: %', v_sum2->'lines';
  END IF;

  -- OWE-1: owes back before settling.
  IF (SELECT (l->>'cents')::bigint FROM jsonb_array_elements(v_sum->'lines') l
      WHERE l->>'kind' = 'host_owes_back' AND l->>'currency' = 'NGN') IS DISTINCT FROM 1500 THEN
    RAISE EXCEPTION 'owes_back_before_wrong: %', v_sum->'lines';
  END IF;

  -- A signed-in non-admin is refused.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_member::text, true);
  BEGIN
    PERFORM public.admin_settle_owes_back('ngn', 'TRF_w2a4130', 'repaid the held transfer fees');
    RAISE EXCEPTION 'owes_back_non_admin_allowed';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err <> 'not_authorized' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.admin_mingla_money_summary(NULL, NULL);
    RAISE EXCEPTION 'summary_non_admin_allowed';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err <> 'not_authorized' THEN RAISE; END IF;
  END;

  -- The admin settles; who, when and the reference are recorded.
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  v_res := public.admin_settle_owes_back('NGN', 'TRF_w2a4130', 'repaid the held transfer fees');
  IF (v_res->>'settled_count')::int <> 2 OR (v_res->>'settled_cents')::bigint <> 1500 THEN
    RAISE EXCEPTION 'owes_back_settle_result_wrong: %', v_res;
  END IF;
  BEGIN
    PERFORM public.admin_settle_owes_back('NGN', 'TRF_w2a4130', 'again');
    RAISE EXCEPTION 'owes_back_double_settle_allowed';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err <> 'nothing_to_settle' THEN RAISE; END IF;
  END;
  v_sum := public.admin_mingla_money_summary(NULL, NULL);
  v_list := public.admin_list_payouts(NULL, NULL, v_brand_ng, 25, 0);
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);

  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_sum->'lines') l WHERE l->>'kind' = 'host_owes_back') THEN
    RAISE EXCEPTION 'owes_back_still_counted: %', v_sum->'lines';
  END IF;
  IF (v_list->'summary'->'transfer_fee_credits_owed_by_currency') <> '{}'::jsonb
     OR (v_list->'rows'->0->>'transfer_fee_credit_owed_cents')::bigint <> 0
     OR (v_list->'rows'->0->>'transfer_fee_credit_settled_cents')::bigint <> 1500 THEN
    RAISE EXCEPTION 'owes_back_payout_list_wrong: %', v_list;
  END IF;
  -- Fee as a share of the ticket price: 6,000 / 200,000 = 3% (older pricing).
  IF (v_list->'rows'->0->>'ticket_cents')::bigint <> 200000 THEN
    RAISE EXCEPTION 'payout_ticket_price_wrong: %', v_list->'rows'->0;
  END IF;
  SELECT count(*) INTO v_n FROM public.payout_owes_back_settlements s
  JOIN public.payout_ledger_adjustments a ON a.id = s.adjustment_id
  WHERE a.release_id = v_r1 AND s.settled_by = v_admin AND s.reference = 'TRF_w2a4130'
    AND s.settled_at IS NOT NULL;
  IF v_n <> 2 THEN RAISE EXCEPTION 'owes_back_record_wrong: %', v_n; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.admin_audit_log WHERE action = 'payout.owes_back_settle') THEN
    RAISE EXCEPTION 'owes_back_not_audited';
  END IF;

  -- PAY-1: payment readiness facts.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  v_list := public.admin_list_brand_payment_readiness(NULL);
  v_res := public.admin_list_brand_payment_readiness('RCP_w2a4130find');
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);

  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_list->'rows') r
      WHERE (r->>'brand_id')::uuid = v_brand_ng AND (r->>'paystack_recipient_active')::boolean
        AND r->>'paystack_bank_mask' = '••••4130'
        AND (r->'paid_out_by_currency'->>'NGN')::bigint = 198500) THEN
    RAISE EXCEPTION 'pay_paystack_ready_brand_wrong: %', v_list;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_list->'rows') r
      WHERE (r->>'brand_id')::uuid = v_brand_ps0 AND NOT (r->>'paystack_recipient_active')::boolean) THEN
    RAISE EXCEPTION 'pay_paystack_no_setup_missing';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_list->'rows') r
      WHERE (r->>'brand_id')::uuid IN (v_brand_st0, v_brand_del)) THEN
    RAISE EXCEPTION 'pay_listed_brand_without_setup_or_deleted';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_list->'rows') r
      WHERE (r->>'brand_id')::uuid = v_brand_us AND (r->>'stripe_payouts_enabled')::boolean
        AND (r->'held_by_currency'->>'USD')::bigint = 985
        AND (r->>'blocked_on_mingla_balance')::boolean) THEN
    RAISE EXCEPTION 'pay_stripe_brand_wrong: %', v_list;
  END IF;
  IF (v_res->>'total')::int <> 1 OR (v_res->'rows'->0->>'brand_id')::uuid <> v_brand_ng THEN
    RAISE EXCEPTION 'pay_search_by_paystack_code_wrong: %', v_res;
  END IF;

  -- ORD-1: host-paid state and the new filters.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  v_list := public.admin_list_orders(NULL, 'host_not_paid', NULL, 100, 0);
  v_res := public.admin_list_orders(NULL, 'free', NULL, 100, 0);
  v_sum := public.admin_list_orders(v_o1::text, NULL, NULL, 5, 0);
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);

  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_list->'rows') r
      WHERE (r->>'order_id')::uuid = v_o4 AND r->>'host_paid' = 'not_in_payout')
     OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_list->'rows') r
      WHERE (r->>'order_id')::uuid = v_o3 AND r->>'host_paid' = 'late')
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_list->'rows') r
      WHERE (r->>'order_id')::uuid IN (v_o1, v_o5)) THEN
    RAISE EXCEPTION 'ord_host_not_paid_wrong: %', v_list;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_res->'rows') r
      WHERE (r->>'order_id')::uuid = v_o5 AND r->>'host_paid' = 'free') THEN
    RAISE EXCEPTION 'ord_free_filter_wrong: %', v_res;
  END IF;
  IF v_sum->'rows'->0->>'host_paid' <> 'paid_out'
     OR (v_sum->'rows'->0->>'mingla_fee_cents')::bigint <> 4500
     OR (v_sum->'rows'->0->>'ticket_cents')::bigint <> 100000
     OR v_sum->'rows'->0->>'provider' <> 'paystack' THEN
    RAISE EXCEPTION 'ord_row_money_wrong: %', v_sum->'rows'->0;
  END IF;
END
$test$;

ROLLBACK;
