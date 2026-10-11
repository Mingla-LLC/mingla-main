\set ON_ERROR_STOP on
-- Issue #3660 — INDEPENDENT TESTER (tester2). KNOWN DEFECTS, NOT REGISTERED IN CI.
--
-- This file FAILS on the branch on purpose. It holds the reproductions for two
-- findings in the tester's report on issue #3660 and is deliberately left out
-- of every CI lane. Register it beside the other issue_3660 lines in
-- `.github/workflows/supabase-migrations-and-stripe-deno.yml` in the change
-- that resolves the findings (or delete a case if Seth accepts it as intended).
--
-- Both cases run, then the file raises once with every case that failed.
-- Run as supabase_admin (session_replication_role for the money fixtures).
--
--   KD-1  "Deletion is final" is not enforced by the database. After a
--         completed Host deletion the kept login can bring its own brand back
--         with one direct table write (UPDATE brands SET deleted_at = NULL):
--         the owner's UPDATE policy on public.brands has no deleted_at
--         condition and no trigger refuses the un-delete. The brand is live
--         again with its payout bank detached; with a past public event under
--         it the tester saw its page resolve again (state public_noindex).
--         No screen in the Host app issues that write; it takes a hand-made
--         API call with the Host's own token.
--         Fails today with: KD-1 the deleted brand came back (rows updated 1,
--         brand search state draft).
--
--   KD-2  A Host with a PAID order on an event that has just ENDED, and no
--         payout release row yet, is deleted and has the bank detached.
--         `tickets_sold` only looks at live or upcoming events and
--         `money_in_motion` only looks at rows in brand_payout_releases, which
--         a 30-minute sweep creates after the payment. The SPEC names this
--         gap; this case shows it is reachable.
--         Fails today with: KD-2 a Host owed money for a paid order was
--         deleted and the payout account detached.
BEGIN;
CREATE TEMP TABLE t2_kd(failure text);
GRANT ALL ON t2_kd TO PUBLIC;

-- KD-1 -----------------------------------------------------------------------
DO $$
DECLARE
  v_a uuid := gen_random_uuid();
  v_b uuid := gen_random_uuid();
  v_sfx text := replace(gen_random_uuid()::text, '-', '');
  v_slug text;
  v_rows integer := 0;
  v_state text;
BEGIN
  v_slug := 't2-3660-kd1-' || v_sfx;
  INSERT INTO auth.users(id) VALUES (v_a);
  INSERT INTO public.creator_accounts(id, email) VALUES (v_a, 't2-3660-kd1@example.test');
  INSERT INTO public.brands(id, account_id, name, slug, default_currency)
  VALUES (v_b, v_a, 'T2 KD1', v_slug, 'USD');

  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  IF public.biz_delete_host_account(v_a)->>'status' IS DISTINCT FROM 'deleted' THEN
    RAISE EXCEPTION 't2 3660 KD-1 fixture: the deletion did not complete';
  END IF;

  -- The kept login, through row level security, with its own token.
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_a::text, true);
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('role', 'authenticated', 'sub', v_a)::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE public.brands SET deleted_at = NULL WHERE id = v_b;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    v_rows := 0;
  END;
  RESET ROLE;

  v_state := public.resolve_public_search_document('/b/' || v_slug)->>'state';
  IF v_rows <> 0
     OR EXISTS (SELECT 1 FROM public.brands WHERE id = v_b AND deleted_at IS NULL) THEN
    INSERT INTO t2_kd VALUES (format(
      'KD-1 the deleted brand came back (rows updated %s, brand search state %s)',
      v_rows, v_state));
  END IF;
END;
$$;

-- KD-2 -----------------------------------------------------------------------
DO $$
DECLARE
  v_a uuid := gen_random_uuid();
  v_b uuid := gen_random_uuid();
  v_e uuid := gen_random_uuid();
  v_sfx text := replace(gen_random_uuid()::text, '-', '');
  v_result jsonb;
BEGIN
  INSERT INTO auth.users(id) VALUES (v_a);
  INSERT INTO public.creator_accounts(id, email) VALUES (v_a, 't2-3660-kd2@example.test');
  INSERT INTO public.brands(id, account_id, name, slug, default_currency)
  VALUES (v_b, v_a, 'T2 KD2', 't2-3660-kd2-' || v_sfx, 'USD');
  INSERT INTO public.stripe_connect_accounts(brand_id, stripe_account_id, country, default_currency)
  VALUES (v_b, 'acct_t2kd2_' || left(v_sfx, 10), 'US', 'USD');
  INSERT INTO public.events(id, brand_id, created_by, title, slug, status)
  VALUES (v_e, v_b, v_a, 'T2 Just Ended', 't2-3660-kd2-e-' || v_sfx, 'scheduled');
  INSERT INTO public.event_dates(event_id, start_at, end_at)
  VALUES (v_e, now() - interval '5 hours', now() - interval '1 hour');

  SET LOCAL session_replication_role = replica;
  INSERT INTO public.orders
    (id, event_id, buyer_email, buyer_name, total_cents, currency, payment_status, source)
  VALUES (gen_random_uuid(), v_e, 't2-buyer@example.test', 'T2 Buyer', 5000, 'USD', 'paid', 'legacy');
  SET LOCAL session_replication_role = origin;

  IF EXISTS (SELECT 1 FROM public.brand_payout_releases WHERE brand_id = v_b) THEN
    RAISE EXCEPTION 't2 3660 KD-2 fixture: a payout release row exists already';
  END IF;

  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  v_result := public.biz_delete_host_account(v_a);

  IF v_result->>'status' = 'deleted'
     AND EXISTS (SELECT 1 FROM public.stripe_connect_accounts
                 WHERE brand_id = v_b AND detached_at IS NOT NULL) THEN
    INSERT INTO t2_kd VALUES (
      'KD-2 a Host owed money for a paid order was deleted and the payout account detached');
  END IF;
END;
$$;

DO $$
DECLARE
  v_failures text;
BEGIN
  SELECT string_agg(failure, ' || ') INTO v_failures FROM t2_kd;
  IF v_failures IS NOT NULL THEN
    RAISE EXCEPTION 'issue_3660 tester2 known defects: %', v_failures;
  END IF;
  RAISE NOTICE 'issue_3660 host account deletion tester2 known defects: none reproduce';
END;
$$;
ROLLBACK;
