\set ON_ERROR_STOP on

-- Issue #3645 payout-screen read model — executable happy-path proof.
-- Fails on revert: the canonical state helper, organiser bundle, unified admin
-- list, ledger reconciliation, or provider-fee exclusion disappears.

BEGIN;

DO $test$
DECLARE
  v_owner constant uuid := '3645f100-0000-4000-8000-000000000001';
  v_admin constant uuid := '3645f100-0000-4000-8000-000000000002';
  v_brand constant uuid := '3645f100-0000-4000-8000-000000000003';
  v_paid constant uuid := '3645f100-0000-4000-8000-000000000004';
  v_due constant uuid := '3645f100-0000-4000-8000-000000000005';
  v_blocked constant uuid := '3645f100-0000-4000-8000-000000000006';
  v_screen jsonb;
  v_admin_screen jsonb;
  v_row jsonb;
BEGIN
  INSERT INTO auth.users(id, email) VALUES
    (v_owner, 'issue-3645-payout-owner@example.test'),
    (v_admin, 'issue-3645-payout-admin@example.test');
  INSERT INTO public.creator_accounts(id, email)
  VALUES (v_owner, 'issue-3645-payout-owner@example.test');
  INSERT INTO public.admin_users(email, role, status)
  VALUES ('issue-3645-payout-admin@example.test', 'admin', 'active');
  INSERT INTO public.brands(
    id, account_id, name, slug, default_currency, payment_provider,
    payment_country, pricing_region, pricing_currency, payout_hold_cutover_at
  ) VALUES (
    v_brand, v_owner, 'Issue 3645 payout screens', 'issue-3645-payout-screens',
    'NGN', 'paystack', 'NG', 'NG', 'NGN', now() - interval '60 days'
  );

  INSERT INTO public.brand_payout_releases(
    id, brand_id, occurrence_key, surface, provider, currency,
    anchor_end_at, releasable_at, gross_cents, mingla_fee_cents,
    provider_fee_cents, net_release_cents, organiser_cash_delivered_cents,
    status, released_at
  ) VALUES
    (v_paid, v_brand, 'issue-3645-paid', 'order', 'paystack', 'ngn',
      now() - interval '25 hours', now() - interval '1 hour',
      10000, 450, 200, 9550, 9450, 'released', now()),
    (v_due, v_brand, 'issue-3645-due', 'order', 'paystack', 'ngn',
      now() - interval '23 hours', now() + interval '1 hour',
      20000, 900, 350, 19100, 0, 'pending', NULL),
    (v_blocked, v_brand, 'issue-3645-blocked', 'order', 'stripe', 'ngn',
      now() - interval '33 hours', now() - interval '9 hours',
      30000, 1350, 500, 28650, 0, 'blocked_balance', NULL);

  INSERT INTO public.payout_release_items(
    release_id, source_type, source_id, gross_cents, mingla_fee_cents,
    provider_fee_cents, net_cents, source_finalized_at
  ) VALUES
    -- Keep the fixture inside the current ISO week, including Monday 00:00-00:59 UTC.
    (v_paid, 'order', gen_random_uuid(), 10000, 450, 200, 9550,
      greatest(now() - interval '1 hour', date_trunc('week', now()))),
    (v_due, 'order', gen_random_uuid(), 20000, 900, 350, 19100,
      greatest(now() - interval '1 hour', date_trunc('week', now()))),
    (v_blocked, 'order', gen_random_uuid(), 30000, 1350, 500, 28650,
      greatest(now() - interval '1 hour', date_trunc('week', now())));
  INSERT INTO public.payout_transfer_legs(
    release_id, kind, chunk_index, principal_cents, estimated_fee_cents,
    stamp_duty_cents, actual_fee_cents, actual_stamp_duty_cents,
    fee_schedule_version, status
  ) VALUES (
    v_paid, 'organiser', 0, 9550, 100, 0, 0, 0,
    'issue-3645-test', 'succeeded'
  );
  INSERT INTO public.payout_ledger_adjustments(
    release_id, brand_id, currency, kind, amount_cents, idempotency_key
  ) VALUES (
    v_paid, v_brand, 'ngn', 'transfer_fee_credit', 100,
    'issue-3645-payout-screen-credit'
  );

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  v_screen := public.brand_get_payout_screen(v_brand);
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);

  IF v_screen->>'currency' <> 'ngn'
     OR (v_screen->>'coming_to_you_cents')::bigint <> 47750
     OR (v_screen->>'paid_this_month_cents')::bigint <> 9450
     OR (v_screen->>'sales_this_week_cents')::bigint <> 60000 THEN
    RAISE EXCEPTION 'organiser totals did not reconcile from stored ledger rows: %', v_screen;
  END IF;
  SELECT item INTO v_row
    FROM jsonb_array_elements(v_screen->'releases') item
   WHERE item->>'id' = v_paid::text;
  IF v_row->>'host_state' <> 'paid'
     OR (v_row->>'gross_cents')::bigint <> 10000
     OR (v_row->>'mingla_fee_cents')::bigint <> 450
     OR (v_row->>'net_release_cents')::bigint <> 9550
     OR (v_row->>'cash_to_bank_cents')::bigint <> 9450
     OR (v_row->>'transfer_fee_cents')::bigint <> 100
     OR (v_row->>'transfer_fee_credit_cents')::bigint <> 100
     OR v_row ? 'provider_fee_cents' THEN
    RAISE EXCEPTION 'paid waterfall is not the host ledger truth: %', v_row;
  END IF;
  SELECT item INTO v_row
    FROM jsonb_array_elements(v_screen->'releases') item
   WHERE item->>'id' = v_due::text;
  IF v_row->>'host_state' <> 'scheduled' THEN
    RAISE EXCEPTION 'future release was not scheduled: %', v_row;
  END IF;
  SELECT item INTO v_row
    FROM jsonb_array_elements(v_screen->'releases') item
   WHERE item->>'id' = v_blocked::text;
  IF v_row->>'host_state' <> 'late_on_us' THEN
    RAISE EXCEPTION 'past-due blocked balance was not late on Mingla: %', v_row;
  END IF;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  v_admin_screen := public.admin_list_payouts(NULL, NULL, v_brand, 25, 0);
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  IF (v_admin_screen->>'total')::int <> 3
     OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_admin_screen->'rows') r WHERE r->>'provider' = 'stripe')
     OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_admin_screen->'rows') r WHERE r->>'provider' = 'paystack')
     OR (v_admin_screen#>>'{summary,late_count}')::int <> 1
     OR (v_admin_screen#>>'{summary,waiting_for_bank_count}')::int <> 0
     OR (v_admin_screen#>>'{summary,transfer_fee_credits_owed_by_currency,ngn}')::bigint <> 100 THEN
    RAISE EXCEPTION 'unified admin payout console did not reconcile both rails: %', v_admin_screen;
  END IF;
  SELECT item INTO v_row
    FROM jsonb_array_elements(v_admin_screen->'rows') item
   WHERE item->>'id' = v_blocked::text;
  IF v_row->>'why' <> 'The connected balance is short. Mingla must cover the shortfall before sending.' THEN
    RAISE EXCEPTION 'admin blocker reason was missing or exposed raw provider detail: %', v_row;
  END IF;

  RAISE NOTICE 'issue_3645_payout_screen_reads_happy_pass';
END;
$test$;

ROLLBACK;
