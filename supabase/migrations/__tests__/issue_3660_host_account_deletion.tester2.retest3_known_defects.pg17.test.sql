\set ON_ERROR_STOP on
-- Issue #3660 — INDEPENDENT TESTER (tester2) FINAL RETEST. KNOWN DEFECTS, NOT
-- REGISTERED IN CI.
--
-- This file FAILS on the branch on purpose. It holds the reproductions for two
-- findings in the tester's final retest report on issue #3660 and is left out
-- of every CI lane. Register it beside the other issue_3660 lines of the
-- migrations job in the change that resolves them. Both cases run, then the
-- file raises once with every case that failed. Run as supabase_admin.
--
--   FK-1  A deletion hands out a payout account that now belongs to SOMEBODY
--         ELSE. Earlier provider targets are read from the audit trail and
--         returned as they were written; nothing checks them against today.
--         Sequence: Host H is deleted (target: brand B's Stripe account).
--         Support restores brand B and reassigns it to owner N with the real
--         admin_set_brand_deleted and admin_reassign_brand_owner. N reconnects
--         payouts; brand-stripe-onboard's same-country branch REUSES the same
--         Stripe account id and clears the soft detach, so that account is now
--         N's live payout account. H then retries, or reopens the app and
--         deletes again. The answer lists that account, and delete-user calls
--         stripe.accounts.del on every account it is given.
--         Fails today with: FK-1 … returned a Stripe account that is live on a
--         brand owned by another account (retry and fresh deletion both).
--
--   FK-2  A lost chargeback blocks the Host for good. The rule leaves the
--         sweep's dispute term out so that an OPEN dispute counts as money in
--         motion. A LOST dispute is not in motion: the money went back to the
--         cardholder. The dispute handler does not change the order's
--         payment_status, so the order stays `paid`; the sweep never ledgers
--         it (nothing is left after the dispute), so no payout can ever be
--         released for it, and the rule keeps counting it.
--         Fails today with: FK-2 … still blocked (money_in_motion) after the
--         real sweep ran 60 days later; payout items for the brand: 0.
BEGIN;
CREATE TEMP TABLE t2s_kd(failure text);
GRANT ALL ON t2s_kd TO PUBLIC;

CREATE FUNCTION pg_temp.t2s_service() RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
END;
$fn$;
CREATE FUNCTION pg_temp.t2s_user(p_sub uuid) RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_sub::text, true);
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('role', 'authenticated', 'sub', p_sub)::text, true);
END;
$fn$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO PUBLIC;

-- FK-1 -----------------------------------------------------------------------
DO $$
DECLARE
  v_h uuid := gen_random_uuid();
  v_n uuid := gen_random_uuid();
  v_adm uuid := gen_random_uuid();
  v_b uuid := gen_random_uuid();
  v_sfx text := replace(gen_random_uuid()::text, '-', '');
  v_acct text;
  v_retry jsonb;
  v_fresh jsonb;
  v_bad text := '';
BEGIN
  v_acct := 'acct_t2sfk1_' || left(v_sfx, 10);
  INSERT INTO auth.users(id, email) VALUES
    (v_h, 't2s-fk1-h-' || v_sfx || '@example.test'),
    (v_n, 't2s-fk1-n-' || v_sfx || '@example.test'),
    (v_adm, 't2s-fk1-adm-' || v_sfx || '@example.test');
  INSERT INTO public.creator_accounts(id, email)
  SELECT u.id, u.email FROM auth.users u WHERE u.id IN (v_h, v_n, v_adm);
  INSERT INTO public.admin_users(email, status)
  VALUES ('t2s-fk1-adm-' || v_sfx || '@example.test', 'active');
  INSERT INTO public.brands(id, account_id, name, slug, default_currency)
  VALUES (v_b, v_h, 'T2S FK1', 't2s-fk1-' || v_sfx, 'USD');
  INSERT INTO public.stripe_connect_accounts(brand_id, stripe_account_id, country, default_currency)
  VALUES (v_b, v_acct, 'US', 'USD');

  -- 1. H is deleted.
  PERFORM pg_temp.t2s_service();
  IF public.biz_delete_host_account(v_h)->>'status' IS DISTINCT FROM 'deleted' THEN
    RAISE EXCEPTION 't2s 3660 FK-1 fixture: first deletion did not complete';
  END IF;

  -- 2. Support restores the brand and hands it to N (the real functions).
  PERFORM pg_temp.t2s_user(v_adm);
  SET LOCAL ROLE authenticated;
  PERFORM public.admin_set_brand_deleted(v_b, false, 't2s support restore');
  PERFORM public.admin_reassign_brand_owner(v_b, v_n, 't2s reassign to the new owner');
  RESET ROLE;

  -- 3. N reconnects payouts. This is the one write brand-stripe-onboard makes
  --    in its same-country branch: same Stripe account id, soft detach cleared.
  UPDATE public.stripe_connect_accounts
     SET detached_at = NULL, updated_at = now()
   WHERE brand_id = v_b;
  IF NOT EXISTS (
    SELECT 1 FROM public.brands b
    JOIN public.stripe_connect_accounts s ON s.brand_id = b.id
    WHERE b.id = v_b AND b.account_id = v_n AND b.deleted_at IS NULL
      AND s.detached_at IS NULL AND s.stripe_account_id = v_acct
  ) THEN
    RAISE EXCEPTION 't2s 3660 FK-1 fixture: the brand is not live under the new owner with the same Stripe account';
  END IF;

  -- 4a. H retries while still marked deleted.
  PERFORM pg_temp.t2s_service();
  v_retry := public.biz_delete_host_account(v_h);
  IF v_retry->'stripe_accounts' @> jsonb_build_array(jsonb_build_object('stripe_account_id', v_acct)) THEN
    v_bad := v_bad || ' a retry';
  END IF;

  -- 4b. H reopens the app (sign-in recovery) and deletes again.
  PERFORM pg_temp.t2s_user(v_h);
  SET LOCAL ROLE authenticated;
  UPDATE public.creator_accounts SET deleted_at = NULL WHERE id = v_h;
  RESET ROLE;
  PERFORM pg_temp.t2s_service();
  v_fresh := public.biz_delete_host_account(v_h);
  IF v_fresh->'stripe_accounts' @> jsonb_build_array(jsonb_build_object('stripe_account_id', v_acct)) THEN
    v_bad := v_bad || CASE WHEN v_bad = '' THEN '' ELSE ' and' END || ' a fresh deletion';
  END IF;

  IF v_bad <> '' THEN
    INSERT INTO t2s_kd VALUES (format(
      'FK-1%s by the old owner returned a Stripe account that is live on a brand owned by another account (retry: %s)',
      v_bad, v_retry->'stripe_accounts'));
  END IF;
END;
$$;

-- FK-2 -----------------------------------------------------------------------
DO $$
DECLARE
  v_a uuid := gen_random_uuid();
  v_b uuid := gen_random_uuid();
  v_e uuid := gen_random_uuid();
  v_o uuid := gen_random_uuid();
  v_sfx text := replace(gen_random_uuid()::text, '-', '');
  v_first jsonb;
  v_after jsonb;
  v_items integer;
BEGIN
  INSERT INTO auth.users(id) VALUES (v_a);
  INSERT INTO public.creator_accounts(id, email) VALUES (v_a, 't2s-fk2-' || v_sfx || '@example.test');
  INSERT INTO public.brands(id, account_id, name, slug, default_currency)
  VALUES (v_b, v_a, 'T2S FK2', 't2s-fk2-' || v_sfx, 'USD');
  UPDATE public.brands SET payout_hold_cutover_at = now() - interval '30 days' WHERE id = v_b;
  INSERT INTO public.events(id, brand_id, created_by, title, slug, status)
  VALUES (v_e, v_b, v_a, 'T2S Ended', 't2s-fk2-e-' || v_sfx, 'scheduled');
  INSERT INTO public.event_dates(event_id, start_at, end_at)
  VALUES (v_e, now() - interval '9 days', now() - interval '8 days');
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.orders
    (id, event_id, buyer_email, buyer_name, total_cents, currency, payment_status,
     source, payment_method, stripe_payment_intent_id, created_at)
  VALUES (v_o, v_e, 't2s-buyer@example.test', 'T2S Buyer', 5000, 'USD', 'paid',
          'legacy', 'online_card', 'pi_t2sfk2_' || left(v_sfx, 12), now() - interval '9 days');
  INSERT INTO public.payout_source_fee_snapshots
    (id, source_type, source_id, provider_fee_cents, captured_at)
  VALUES (gen_random_uuid(), 'order', v_o, 0, now());
  -- The cardholder's bank took the whole amount back, and the dispute is closed.
  INSERT INTO public.stripe_disputes
    (stripe_dispute_id, stripe_charge_id, stripe_account_id, order_id, amount, currency,
     status, reason, raw_event)
  VALUES ('dp_t2sfk2_' || left(v_sfx, 12), 'ch_t2sfk2_' || left(v_sfx, 12), 'acct_t2sfk2',
          v_o, 5000, 'usd', 'lost', 'fraudulent', '{}'::jsonb);
  SET LOCAL session_replication_role = origin;

  PERFORM pg_temp.t2s_service();
  v_first := public.biz_delete_host_account(v_a);
  PERFORM public.run_payout_release_dark_sweep(now() + interval '60 days');
  SELECT count(*) INTO v_items
  FROM public.payout_release_items i
  JOIN public.brand_payout_releases pr ON pr.id = i.release_id
  WHERE pr.brand_id = v_b;
  v_after := public.biz_delete_host_account(v_a);

  IF v_after->>'status' IS DISTINCT FROM 'deleted' THEN
    INSERT INTO t2s_kd VALUES (format(
      'FK-2 a Host whose only sale was charged back and LOST is %s (%s) before, and still %s (%s) after the real sweep ran 60 days later; payout items for the brand: %s',
      v_first->>'status', v_first->'blockers'->0->>'code',
      v_after->>'status', v_after->'blockers'->0->>'code', v_items));
  END IF;
END;
$$;

DO $$
DECLARE
  v_failures text;
BEGIN
  SELECT string_agg(failure, ' || ') INTO v_failures FROM t2s_kd;
  IF v_failures IS NOT NULL THEN
    RAISE EXCEPTION 'issue_3660 tester2 retest3 known defects: %', v_failures;
  END IF;
  RAISE NOTICE 'issue_3660 host account deletion tester2 retest3 known defects: none reproduce';
END;
$$;
ROLLBACK;
