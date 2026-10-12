\set ON_ERROR_STOP on
-- STATUS (implementor, third rework, #3660): ALL THREE CASES NOW PASS AND THIS
-- FILE IS REGISTERED IN CI, in the migrations job of the Supabase migrations
-- workflow. RK-1 and RK-2 were fixed by making the money rule mirror every arm
-- of the payout sweep, fee snapshot included
-- (private.host_account_unreleased_held_money); RK-3 by returning the provider
-- targets of earlier deletions of the same account. No line of the tester's
-- cases was removed or changed; RK-2's fixture gained one insert, noted in
-- place. The header underneath is kept as written and describes the state
-- BEFORE the fixes. The implementor's own guards are in
-- issue_3660_host_account_deletion.rework.implementor.pg17.test.sql.
--
-- Issue #3660 — INDEPENDENT TESTER (tester2) RETEST. KNOWN DEFECTS, NOT
-- REGISTERED IN CI.
--
-- This file FAILS on the branch on purpose. It holds the reproductions for
-- three findings in the tester's RETEST report on issue #3660 and is left out
-- of every CI lane. Register it beside the other issue_3660 lines of the
-- migrations job in the change that resolves them (or delete a case Seth
-- accepts as intended). All three cases run, then the file raises once with
-- every case that failed. Run as supabase_admin.
--
-- The narrowed money rule ("blocks only when Mingla holds the money") copies
-- two of the payout sweep's conditions (brand on the hold rail, sale after the
-- cutover). The sweep has more, and it has more than one source of money.
--
--   RK-1  A CASH door sale on a hold-rail brand blocks the Host FOR GOOD.
--         Mingla never held that money. The sweep only ledgers a sale that has
--         a fee snapshot (an online payment); a cash sale has none, so no
--         payout item is ever opened and no `released` item can ever cover it.
--         The case runs the real sweep 30 days later and deletes again.
--         Fails today with: RK-1 … still blocked (money_in_motion) after the
--         real sweep ran 30 days later; payout items for the brand: 0.
--
--   RK-2  Money Mingla IS holding that is not a ticket order does not block.
--         A paid RSVP contribution on an event that has ended, on a hold-rail
--         brand, after the cutover, not yet released (the sweep ledgers
--         contributions, venue reservations and menu orders too): the Host is
--         deleted and the payout account detached. This is the original F-1
--         for every money source except ticket orders and instalments.
--         Fails today with: RK-2 a Host owed a paid RSVP contribution was
--         deleted and the payout account detached.
--
--   RK-3  The retry loses the provider targets if the Host app was reopened
--         first. A lost response leaves the Host signed in; on the next cold
--         start the app's sign-in recovery clears creator_accounts.deleted_at.
--         The next "delete" is then a fresh deletion of an account with no
--         brands: it returns EMPTY provider lists and writes a new audit row
--         with empty lists, so the Stripe account of the first deletion is
--         never deactivated at the provider and nothing records that.
--         Fails today with: RK-3 after sign-in recovery the next deletion
--         returned no Stripe target.
BEGIN;
CREATE TEMP TABLE t2r_kd(failure text);
GRANT ALL ON t2r_kd TO PUBLIC;

CREATE FUNCTION pg_temp.t2r_service() RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
END;
$fn$;

-- RK-1 -----------------------------------------------------------------------
DO $$
DECLARE
  v_a uuid := gen_random_uuid();
  v_b uuid := gen_random_uuid();
  v_e uuid := gen_random_uuid();
  v_sfx text := replace(gen_random_uuid()::text, '-', '');
  v_first jsonb;
  v_after jsonb;
  v_items integer;
BEGIN
  INSERT INTO auth.users(id) VALUES (v_a);
  INSERT INTO public.creator_accounts(id, email) VALUES (v_a, 't2r-3660-rk1@example.test');
  INSERT INTO public.brands(id, account_id, name, slug, default_currency)
  VALUES (v_b, v_a, 'T2R RK1', 't2r-3660-rk1-' || v_sfx, 'USD');
  UPDATE public.brands SET payout_hold_cutover_at = now() - interval '30 days' WHERE id = v_b;
  INSERT INTO public.events(id, brand_id, created_by, title, slug, status)
  VALUES (v_e, v_b, v_a, 'T2R Ended', 't2r-3660-rk1-e-' || v_sfx, 'scheduled');
  INSERT INTO public.event_dates(event_id, start_at, end_at)
  VALUES (v_e, now() - interval '9 days', now() - interval '8 days');
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.orders
    (id, event_id, buyer_email, buyer_name, total_cents, currency, payment_status,
     source, payment_method, created_at)
  VALUES (gen_random_uuid(), v_e, 't2r-buyer@example.test', 'T2R Buyer', 5000, 'USD',
          'paid', 'door_sale', 'cash', now() - interval '9 days');
  SET LOCAL session_replication_role = origin;

  PERFORM pg_temp.t2r_service();
  v_first := public.biz_delete_host_account(v_a);
  -- Give the payout machinery every chance: the real sweep, a month from now.
  PERFORM public.run_payout_release_dark_sweep(now() + interval '30 days');
  SELECT count(*) INTO v_items
  FROM public.payout_release_items i
  JOIN public.brand_payout_releases pr ON pr.id = i.release_id
  WHERE pr.brand_id = v_b;
  v_after := public.biz_delete_host_account(v_a);

  IF v_after->>'status' IS DISTINCT FROM 'deleted' THEN
    INSERT INTO t2r_kd VALUES (format(
      'RK-1 a Host whose only sale was CASH at the door is %s (%s) before, and still %s (%s) after the real sweep ran 30 days later; payout items for the brand: %s',
      v_first->>'status', v_first->'blockers'->0->>'code',
      v_after->>'status', v_after->'blockers'->0->>'code', v_items));
  END IF;
END;
$$;

-- RK-2 -----------------------------------------------------------------------
DO $$
DECLARE
  v_a uuid := gen_random_uuid();
  v_b uuid := gen_random_uuid();
  v_e uuid := gen_random_uuid();
  v_sfx text := replace(gen_random_uuid()::text, '-', '');
  v_result jsonb;
BEGIN
  INSERT INTO auth.users(id) VALUES (v_a);
  INSERT INTO public.creator_accounts(id, email) VALUES (v_a, 't2r-3660-rk2@example.test');
  INSERT INTO public.brands(id, account_id, name, slug, default_currency)
  VALUES (v_b, v_a, 'T2R RK2', 't2r-3660-rk2-' || v_sfx, 'USD');
  UPDATE public.brands SET payout_hold_cutover_at = now() - interval '30 days' WHERE id = v_b;
  INSERT INTO public.stripe_connect_accounts(brand_id, stripe_account_id, country, default_currency)
  VALUES (v_b, 'acct_t2rrk2_' || left(v_sfx, 10), 'US', 'USD');
  INSERT INTO public.events(id, brand_id, created_by, title, slug, status)
  VALUES (v_e, v_b, v_a, 'T2R Ended', 't2r-3660-rk2-e-' || v_sfx, 'scheduled');
  INSERT INTO public.event_dates(event_id, start_at, end_at)
  VALUES (v_e, now() - interval '3 hours', now() - interval '1 hour');
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.event_rsvp_contributions
    (id, event_id, brand_id, provider, currency, amount_cents, buyer_total_cents,
     pricing_breakdown, status, paid_at, created_at)
  VALUES (gen_random_uuid(), v_e, v_b, 'stripe', 'USD', 2500, 2500, '{}'::jsonb, 'paid',
          now() - interval '2 hours', now() - interval '2 hours');
  -- [TEST-MOD-APPROVED #3660] third rework, on the coordinator's ruling (added by
  -- the implementor; no line of the tester's case is removed or changed). The
  -- money rule now mirrors the payout sweep in full, and the sweep only ledgers
  -- a sale that has a fee snapshot (an online payment); a sale without one is
  -- cash and is not money Mingla holds. So that this case still describes a
  -- Host who IS owed money, the contribution's fee snapshot is recorded here.
  INSERT INTO public.payout_source_fee_snapshots
    (id, source_type, source_id, provider_fee_cents, captured_at)
  SELECT gen_random_uuid(), 'rsvp_contribution', x.id, 0, now()
  FROM public.event_rsvp_contributions x WHERE x.event_id = v_e;
  SET LOCAL session_replication_role = origin;

  PERFORM pg_temp.t2r_service();
  v_result := public.biz_delete_host_account(v_a);
  IF v_result->>'status' = 'deleted'
     AND EXISTS (SELECT 1 FROM public.stripe_connect_accounts
                 WHERE brand_id = v_b AND detached_at IS NOT NULL) THEN
    INSERT INTO t2r_kd VALUES (
      'RK-2 a Host owed a paid RSVP contribution was deleted and the payout account detached');
  END IF;
END;
$$;

-- RK-3 -----------------------------------------------------------------------
DO $$
DECLARE
  v_a uuid := gen_random_uuid();
  v_b uuid := gen_random_uuid();
  v_sfx text := replace(gen_random_uuid()::text, '-', '');
  v_first jsonb;
  v_second jsonb;
BEGIN
  INSERT INTO auth.users(id) VALUES (v_a);
  INSERT INTO public.creator_accounts(id, email) VALUES (v_a, 't2r-3660-rk3@example.test');
  INSERT INTO public.brands(id, account_id, name, slug, default_currency)
  VALUES (v_b, v_a, 'T2R RK3', 't2r-3660-rk3-' || v_sfx, 'USD');
  INSERT INTO public.stripe_connect_accounts(brand_id, stripe_account_id, country, default_currency)
  VALUES (v_b, 'acct_t2rrk3_' || left(v_sfx, 10), 'US', 'USD');

  PERFORM pg_temp.t2r_service();
  v_first := public.biz_delete_host_account(v_a);   -- commits; response is lost
  IF jsonb_array_length(v_first->'stripe_accounts') <> 1 THEN
    RAISE EXCEPTION 't2r 3660 RK-3 fixture: first deletion returned no Stripe target: %', v_first;
  END IF;

  -- The Host reopens the app: sign-in recovery, through RLS, as the app does it.
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_a::text, true);
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('role', 'authenticated', 'sub', v_a)::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.creator_accounts SET deleted_at = NULL WHERE id = v_a;
  RESET ROLE;

  -- ... and deletes again.
  PERFORM pg_temp.t2r_service();
  v_second := public.biz_delete_host_account(v_a);
  IF v_second->'stripe_accounts' IS DISTINCT FROM v_first->'stripe_accounts' THEN
    INSERT INTO t2r_kd VALUES (format(
      'RK-3 after sign-in recovery the next deletion returned no Stripe target (first %s, next %s)',
      v_first->'stripe_accounts', v_second->'stripe_accounts'));
  END IF;
END;
$$;

DO $$
DECLARE
  v_failures text;
BEGIN
  SELECT string_agg(failure, ' || ') INTO v_failures FROM t2r_kd;
  IF v_failures IS NOT NULL THEN
    RAISE EXCEPTION 'issue_3660 tester2 retest known defects: %', v_failures;
  END IF;
  RAISE NOTICE 'issue_3660 host account deletion tester2 retest known defects: none reproduce';
END;
$$;
ROLLBACK;
