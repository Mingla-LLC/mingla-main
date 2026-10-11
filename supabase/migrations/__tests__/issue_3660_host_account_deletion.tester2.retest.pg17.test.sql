\set ON_ERROR_STOP on
-- Issue #3660 — Host account deletion completes or changes nothing.
-- INDEPENDENT TESTER (tester2) RETEST suite, written by the tester after the
-- two rework passes. It attacks what the rework ADDED, through real database
-- roles, on axes the implementor's rework suite does not take:
--
--   U  "Deletion is final": every route the tester could think of for a
--      signed-in user to clear brands.deleted_at is refused, including an
--      update that also changes other columns, SET deleted_at = DEFAULT, an
--      upsert, the owner after sign-in recovery cleared the account marker, a
--      co-owner, and anon. And the guard is NARROW: support (an admin through
--      admin_set_brand_deleted, and the service role) can still restore; a
--      signed-in owner can still edit and soft-delete a LIVE brand; a brand
--      that was never deleted is never refused.
--   I  The loose ends the deletion closes cannot be re-opened: a revoked team
--      invitation and a revoked owner-handover invitation are both refused by
--      the REAL accept function, nobody gains a membership, the brand keeps
--      its account, and invitations on a brand the deleted Host only worked on
--      are untouched.
--   T  The retry answer: same provider targets as the first call, nothing
--      written by the retry; an already-deleted account with NO audit row (an
--      account deleted by an earlier build) answers `deleted` with empty lists
--      rather than failing.
--   X  Expired checkouts: one whose payment is still processing blocks; an
--      abandoned one does not.
--
--   M  Restores a proof the rework's fixture edit made vacuous. The tester's
--      edges suite proved that paid orders on an ENDED and on a CANCELLED
--      event do not hold a Host; the rework then marked those orders as paid
--      out, so that suite can no longer tell a rule that ignores a
--      direct-charge Host from one that blocks them. Here the same two orders
--      sit on a brand that is NOT on the hold rail, with no payout row at
--      all: the Host must be deleted and the orders left byte for byte. And
--      the same Host on the hold rail must be refused, so the first half is
--      not a rule that never blocks.
--
-- Runs as supabase_admin (session_replication_role for the checkout fixture).
-- No row in auth.users is deleted. Everything is rolled back.
BEGIN;

CREATE FUNCTION pg_temp.t2r_claims(p_role text, p_sub uuid)
RETURNS void
LANGUAGE plpgsql
AS $fn$
BEGIN
  PERFORM set_config('request.jwt.claim.role', p_role, true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_sub::text, ''), true);
  PERFORM set_config(
    'request.jwt.claims',
    CASE WHEN p_sub IS NULL
      THEN jsonb_build_object('role', p_role)::text
      ELSE jsonb_build_object('role', p_role, 'sub', p_sub)::text
    END,
    true);
END;
$fn$;

-- Runs one statement and reports what happened to it, without aborting.
--   'ok:<rows>'  or  'refused:<message>'
CREATE FUNCTION pg_temp.t2r_try(p_sql text)
RETURNS text
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_rows integer;
BEGIN
  EXECUTE p_sql;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN 'ok:' || v_rows;
EXCEPTION WHEN OTHERS THEN
  RETURN 'refused:' || SQLERRM;
END;
$fn$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO PUBLIC;

DO $$
DECLARE
  v_a uuid := gen_random_uuid();     -- Host that gets deleted; owns B1, B2
  v_co uuid := gen_random_uuid();    -- co-owner ROLE on B1
  v_adm uuid := gen_random_uuid();   -- support (is_admin_user)
  v_inv uuid := gen_random_uuid();   -- invitee
  v_p uuid := gen_random_uuid();     -- partner who still owns PB, gets deleted
  v_o uuid := gen_random_uuid();     -- bystander owner of OB (v_a is a member)
  v_live uuid := gen_random_uuid();  -- owner of LB, never deleted
  v_b1 uuid := gen_random_uuid();
  v_b2 uuid := gen_random_uuid();
  v_pb uuid := gen_random_uuid();
  v_ob uuid := gen_random_uuid();
  v_lb uuid := gen_random_uuid();
  v_e_x uuid := gen_random_uuid();   -- upcoming event on B2 for the checkout cases
  v_sess uuid := gen_random_uuid();
  v_sfx text := replace(gen_random_uuid()::text, '-', '');
  v_first jsonb;
  v_retry jsonb;
  v_result jsonb;
  v_out text;
  v_audit_before integer;
  v_snap_before text;
  v_snap_after text;
  v_route text;
  v_routes text[];
BEGIN
  INSERT INTO auth.users(id, email) VALUES
    (v_a, 't2r-a-' || v_sfx || '@example.test'),
    (v_co, 't2r-co-' || v_sfx || '@example.test'),
    (v_adm, 't2r-adm-' || v_sfx || '@example.test'),
    (v_inv, 't2r-inv-' || v_sfx || '@example.test'),
    (v_p, 't2r-p-' || v_sfx || '@example.test'),
    (v_o, 't2r-o-' || v_sfx || '@example.test'),
    (v_live, 't2r-live-' || v_sfx || '@example.test');
  INSERT INTO public.creator_accounts(id, email)
  SELECT u.id, u.email FROM auth.users u
  WHERE u.id IN (v_a, v_co, v_adm, v_inv, v_p, v_o, v_live);
  INSERT INTO public.admin_users(email, status)
  VALUES ('t2r-adm-' || v_sfx || '@example.test', 'active');

  INSERT INTO public.brands(id, account_id, name, slug, default_currency) VALUES
    (v_b1, v_a, 'T2R B1', 't2r-b1-' || v_sfx, 'USD'),
    (v_b2, v_a, 'T2R B2', 't2r-b2-' || v_sfx, 'USD'),
    (v_pb, v_p, 'T2R PB', 't2r-pb-' || v_sfx, 'USD'),
    (v_ob, v_o, 'T2R OB', 't2r-ob-' || v_sfx, 'USD'),
    (v_lb, v_live, 'T2R LB', 't2r-lb-' || v_sfx, 'USD');
  UPDATE public.brands SET paystack_subaccount_code = 'ACCT_t2r_' || left(v_sfx, 10)
   WHERE id = v_b2;
  INSERT INTO public.stripe_connect_accounts
    (brand_id, stripe_account_id, country, default_currency)
  VALUES (v_b1, 'acct_t2r1_' || left(v_sfx, 10), 'US', 'USD'),
         (v_b2, 'acct_t2r2_' || left(v_sfx, 10), 'US', 'USD');
  INSERT INTO public.brand_team_members(brand_id, user_id, role, invited_at, accepted_at)
  VALUES (v_b1, v_co, 'brand_owner', now(), now()),
         (v_ob, v_a, 'brand_admin', now(), now());
  INSERT INTO public.events(id, brand_id, created_by, title, slug, status)
  VALUES (v_e_x, v_b2, v_a, 'T2R Upcoming', 't2r-ex-' || v_sfx, 'scheduled');
  INSERT INTO public.event_dates(event_id, start_at, end_at)
  VALUES (v_e_x, now() + interval '5 days', now() + interval '6 days');

  -- Invitations: a team invite on B1, an owner-handover invite on PB (with the
  -- partner link waiting on it), and one on OB, which v_a only works on.
  INSERT INTO public.brand_invitations(brand_id, email, role, invited_by, token_hash, expires_at)
  VALUES
    (v_b1, 't2r-inv-' || v_sfx || '@example.test', 'event_manager', v_a,
     't2r-tok-b1-' || v_sfx, now() + interval '7 days'),
    (v_pb, 't2r-inv-' || v_sfx || '@example.test', 'brand_owner', v_p,
     't2r-tok-pb-' || v_sfx, now() + interval '7 days'),
    (v_ob, 't2r-inv-' || v_sfx || '@example.test', 'event_manager', v_a,
     't2r-tok-ob-' || v_sfx, now() + interval '7 days');
  INSERT INTO public.partner_brand_links
    (id, partner_account_id, brand_id, invited_owner_email, accepted_at)
  VALUES (gen_random_uuid(), v_p, v_pb, 't2r-inv-' || v_sfx || '@example.test', NULL);

  -- ==========================================================================
  -- X — expired checkouts on an upcoming event.
  -- ==========================================================================
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.ticket_checkout_sessions
    (id, event_id, brand_id, buyer_name, buyer_email, buyer_phone_e164, currency,
     subtotal_cents, total_cents, status, idempotency_key, expires_at,
     application_fee_amount_cents)
  VALUES (v_sess, v_e_x, v_b2, 'T2R Buyer', 't2r-buyer@example.test', '+12015550199',
          'USD', 1000, 1000, 'processing_payment', 't2r-' || v_sfx,
          now() - interval '20 minutes', 100);
  SET LOCAL session_replication_role = origin;

  PERFORM pg_temp.t2r_claims('service_role', NULL);
  SET LOCAL ROLE service_role;
  v_result := public.biz_delete_host_account(v_a);
  RESET ROLE;
  IF v_result->>'status' IS DISTINCT FROM 'blocked'
     OR v_result->'blockers'->0->>'code' IS DISTINCT FROM 'checkout_in_progress'
     OR jsonb_array_length(v_result->'blockers') <> 1 THEN
    RAISE EXCEPTION 't2r 3660 X: an expired checkout whose payment is still processing must block alone: %', v_result;
  END IF;
  -- The same session, abandoned before paying: it must NOT hold the Host.
  SET LOCAL session_replication_role = replica;
  UPDATE public.ticket_checkout_sessions SET status = 'requires_payment' WHERE id = v_sess;
  SET LOCAL session_replication_role = origin;

  -- ==========================================================================
  -- The deletions under test.
  -- ==========================================================================
  SELECT count(*) INTO v_audit_before FROM public.audit_log;
  PERFORM pg_temp.t2r_claims('service_role', NULL);
  SET LOCAL ROLE service_role;
  v_first := public.biz_delete_host_account(v_a);
  RESET ROLE;
  IF v_first->>'status' IS DISTINCT FROM 'deleted'
     OR (v_first->>'already_deleted')::boolean IS NOT FALSE
     OR jsonb_array_length(v_first->'stripe_accounts') <> 2
     OR jsonb_array_length(v_first->'paystack_subaccounts') <> 1 THEN
    RAISE EXCEPTION 't2r 3660: first deletion wrong (an abandoned expired checkout must not block): %', v_first;
  END IF;

  -- ==========================================================================
  -- T — the retry answer.
  -- ==========================================================================
  SELECT md5(concat_ws('|',
    (SELECT string_agg(to_jsonb(b)::text, ',' ORDER BY b.id) FROM public.brands b
      WHERE b.id IN (v_b1, v_b2)),
    (SELECT to_jsonb(c)::text FROM public.creator_accounts c WHERE c.id = v_a),
    (SELECT string_agg(to_jsonb(s)::text, ',' ORDER BY s.brand_id)
       FROM public.stripe_connect_accounts s WHERE s.brand_id IN (v_b1, v_b2)),
    (SELECT count(*)::text FROM public.audit_log)
  )) INTO v_snap_before;
  PERFORM pg_temp.t2r_claims('service_role', NULL);
  SET LOCAL ROLE service_role;
  v_retry := public.biz_delete_host_account(v_a);
  RESET ROLE;
  SELECT md5(concat_ws('|',
    (SELECT string_agg(to_jsonb(b)::text, ',' ORDER BY b.id) FROM public.brands b
      WHERE b.id IN (v_b1, v_b2)),
    (SELECT to_jsonb(c)::text FROM public.creator_accounts c WHERE c.id = v_a),
    (SELECT string_agg(to_jsonb(s)::text, ',' ORDER BY s.brand_id)
       FROM public.stripe_connect_accounts s WHERE s.brand_id IN (v_b1, v_b2)),
    (SELECT count(*)::text FROM public.audit_log)
  )) INTO v_snap_after;
  IF v_retry->>'status' IS DISTINCT FROM 'deleted'
     OR (v_retry->>'already_deleted')::boolean IS NOT TRUE
     OR v_retry->'stripe_accounts' IS DISTINCT FROM v_first->'stripe_accounts'
     OR v_retry->'paystack_subaccounts' IS DISTINCT FROM v_first->'paystack_subaccounts' THEN
    RAISE EXCEPTION 't2r 3660 T: a retry must return the first call''s provider targets. first=% retry=%', v_first, v_retry;
  END IF;
  IF v_snap_before IS DISTINCT FROM v_snap_after THEN
    RAISE EXCEPTION 't2r 3660 T: a retry on an already-deleted account wrote something';
  END IF;

  -- ==========================================================================
  -- I — invitations revoked on the deleted brands only; nothing can be accepted.
  -- ==========================================================================
  IF EXISTS (SELECT 1 FROM public.brand_invitations
             WHERE brand_id = v_b1 AND (status <> 'revoked' OR revoked_at IS NULL)) THEN
    RAISE EXCEPTION 't2r 3660 I: the pending invitation on the deleted brand was not revoked';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.brand_invitations
                 WHERE brand_id = v_ob AND status = 'pending' AND revoked_at IS NULL) THEN
    RAISE EXCEPTION 't2r 3660 I: an invitation on a brand the Host only worked on was touched';
  END IF;
  IF (v_first->>'invitations_revoked')::integer <> 1 THEN
    RAISE EXCEPTION 't2r 3660 I: expected exactly 1 invitation revoked for this Host: %', v_first;
  END IF;

  -- The partner, who still owns PB with a handover invitation out.
  PERFORM pg_temp.t2r_claims('service_role', NULL);
  SET LOCAL ROLE service_role;
  v_result := public.biz_delete_host_account(v_p);
  RESET ROLE;
  IF v_result->>'status' IS DISTINCT FROM 'deleted' THEN
    RAISE EXCEPTION 't2r 3660 I: partner deletion wrong: %', v_result;
  END IF;
  IF EXISTS (SELECT 1 FROM public.partner_brand_links
             WHERE brand_id = v_pb AND cancelled_at IS NULL) THEN
    RAISE EXCEPTION 't2r 3660 I: the never-accepted partner link on the deleted brand is still open';
  END IF;

  -- The REAL accept function, called the way the edge function calls it.
  PERFORM pg_temp.t2r_claims('service_role', NULL);
  v_out := pg_temp.t2r_try(format(
    'SELECT public.accept_invite_and_transfer_brand_ownership(%L, %L)',
    't2r-tok-b1-' || v_sfx, v_inv));
  IF v_out NOT LIKE 'refused:invite_revoked%' THEN
    RAISE EXCEPTION 't2r 3660 I: a revoked team invitation was not refused as revoked: %', v_out;
  END IF;
  v_out := pg_temp.t2r_try(format(
    'SELECT public.accept_invite_and_transfer_brand_ownership(%L, %L)',
    't2r-tok-pb-' || v_sfx, v_inv));
  IF v_out NOT LIKE 'refused:invite_revoked%' THEN
    RAISE EXCEPTION 't2r 3660 I: a revoked owner-handover invitation was not refused as revoked: %', v_out;
  END IF;
  IF EXISTS (SELECT 1 FROM public.brand_team_members
             WHERE user_id = v_inv AND removed_at IS NULL)
     OR EXISTS (SELECT 1 FROM public.brands WHERE id = v_pb AND account_id <> v_p)
     OR EXISTS (SELECT 1 FROM public.partner_brand_links
                WHERE brand_id = v_pb AND accepted_at IS NOT NULL) THEN
    RAISE EXCEPTION 't2r 3660 I: somebody got into a deleted brand through a revoked invitation';
  END IF;

  -- ==========================================================================
  -- U — "deletion is final", through row level security.
  -- ==========================================================================
  v_routes := ARRAY[
    format('UPDATE public.brands SET deleted_at = NULL WHERE id = %L', v_b1),
    format('UPDATE public.brands SET name = %L, deleted_at = NULL WHERE id = %L', 'T2R back', v_b1),
    format('UPDATE public.brands SET deleted_at = DEFAULT WHERE id = %L', v_b1),
    format('UPDATE public.brands SET (name, deleted_at) = (%L, NULL) WHERE id = %L', 'T2R back', v_b1),
    format('INSERT INTO public.brands(id, account_id, name, slug, default_currency)
            VALUES (%L, %L, %L, %L, %L)
            ON CONFLICT (id) DO UPDATE SET deleted_at = NULL',
           v_b1, v_a, 'T2R B1', 't2r-b1-' || v_sfx, 'USD'),
    format('SELECT public.admin_set_brand_deleted(%L, false, %L)', v_b1, 't2r')
  ];
  -- (1) the owner, with the account still marked deleted
  PERFORM pg_temp.t2r_claims('authenticated', v_a);
  SET LOCAL ROLE authenticated;
  FOREACH v_route IN ARRAY v_routes LOOP
    v_out := pg_temp.t2r_try(v_route);
    IF v_out NOT LIKE 'refused:%' THEN
      RESET ROLE;
      RAISE EXCEPTION 't2r 3660 U: the owner was not refused (%): %', v_out, v_route;
    END IF;
  END LOOP;
  -- (2) the owner after sign-in recovery cleared the account marker
  UPDATE public.creator_accounts SET deleted_at = NULL WHERE id = v_a;
  FOREACH v_route IN ARRAY v_routes LOOP
    v_out := pg_temp.t2r_try(v_route);
    IF v_out NOT LIKE 'refused:%' THEN
      RESET ROLE;
      RAISE EXCEPTION 't2r 3660 U: the recovered owner was not refused (%): %', v_out, v_route;
    END IF;
  END LOOP;
  RESET ROLE;
  -- (3) the co-owner, (4) anon: refused, or no row reachable. Never a restore.
  PERFORM pg_temp.t2r_claims('authenticated', v_co);
  SET LOCAL ROLE authenticated;
  FOREACH v_route IN ARRAY v_routes[1:4] LOOP
    v_out := pg_temp.t2r_try(v_route);
    IF v_out NOT LIKE 'refused:%' AND v_out <> 'ok:0' THEN
      RESET ROLE;
      RAISE EXCEPTION 't2r 3660 U: the co-owner restored the brand (%): %', v_out, v_route;
    END IF;
  END LOOP;
  RESET ROLE;
  PERFORM pg_temp.t2r_claims('anon', NULL);
  SET LOCAL ROLE anon;
  v_out := pg_temp.t2r_try(v_routes[1]);
  RESET ROLE;
  IF v_out NOT LIKE 'refused:%' AND v_out <> 'ok:0' THEN
    RAISE EXCEPTION 't2r 3660 U: anon restored the brand: %', v_out;
  END IF;
  IF (SELECT count(*) FROM public.brands
       WHERE id IN (v_b1, v_b2) AND deleted_at IS NOT NULL) <> 2 THEN
    RAISE EXCEPTION 't2r 3660 U: a deleted brand is live again after the attempts';
  END IF;
  IF (SELECT name FROM public.brands WHERE id = v_b1) <> 'T2R B1' THEN
    RAISE EXCEPTION 't2r 3660 U: a refused restore still changed another column';
  END IF;

  -- The guard is narrow. (5) A signed-in owner still edits and soft-deletes a
  -- LIVE brand, and a brand that was never deleted is never refused.
  PERFORM pg_temp.t2r_claims('authenticated', v_live);
  SET LOCAL ROLE authenticated;
  v_out := pg_temp.t2r_try(format(
    'UPDATE public.brands SET name = %L, deleted_at = NULL WHERE id = %L', 'T2R LB edited', v_lb));
  IF v_out <> 'ok:1' THEN
    RESET ROLE;
    RAISE EXCEPTION 't2r 3660 U: an ordinary edit of a live brand was refused: %', v_out;
  END IF;
  v_out := pg_temp.t2r_try(format(
    'UPDATE public.brands SET deleted_at = now() WHERE id = %L', v_lb));
  IF v_out <> 'ok:1' THEN
    RESET ROLE;
    RAISE EXCEPTION 't2r 3660 U: an owner could not delete their own live brand: %', v_out;
  END IF;
  -- ... and an ordinary brand deletion is final for the owner too.
  v_out := pg_temp.t2r_try(format(
    'UPDATE public.brands SET deleted_at = NULL WHERE id = %L', v_lb));
  RESET ROLE;
  IF v_out NOT LIKE 'refused:brand_restore_forbidden%' THEN
    RAISE EXCEPTION 't2r 3660 U: an owner un-deleted an ordinarily deleted brand: %', v_out;
  END IF;

  -- (6) Support can still restore: an admin through the shipped function ...
  PERFORM pg_temp.t2r_claims('authenticated', v_adm);
  SET LOCAL ROLE authenticated;
  v_out := pg_temp.t2r_try(format(
    'SELECT public.admin_set_brand_deleted(%L, false, %L)', v_lb, 't2r support restore'));
  RESET ROLE;
  IF v_out NOT LIKE 'ok:%'
     OR EXISTS (SELECT 1 FROM public.brands WHERE id = v_lb AND deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 't2r 3660 U: an admin can no longer restore a brand: %', v_out;
  END IF;
  -- ... and the service role directly.
  PERFORM pg_temp.t2r_claims('service_role', NULL);
  SET LOCAL ROLE service_role;
  v_out := pg_temp.t2r_try(format(
    'UPDATE public.brands SET deleted_at = NULL WHERE id = %L', v_b1));
  RESET ROLE;
  IF v_out <> 'ok:1' THEN
    RAISE EXCEPTION 't2r 3660 U: the service role can no longer restore a brand: %', v_out;
  END IF;

  -- ==========================================================================
  -- T — an already-deleted account with NO audit row (deleted by an earlier
  --     build): the retry answers `deleted` with empty lists; it does not fail.
  -- ==========================================================================
  SET LOCAL session_replication_role = replica;
  UPDATE public.brands SET deleted_at = now() WHERE id = v_b1;
  UPDATE public.creator_accounts SET deleted_at = now() WHERE id = v_a;
  DELETE FROM public.audit_log
   WHERE action = 'host_account.deleted' AND target_id = v_a::text;
  SET LOCAL session_replication_role = origin;
  PERFORM pg_temp.t2r_claims('service_role', NULL);
  SET LOCAL ROLE service_role;
  v_result := public.biz_delete_host_account(v_a);
  RESET ROLE;
  IF v_result->>'status' IS DISTINCT FROM 'deleted'
     OR (v_result->>'already_deleted')::boolean IS NOT TRUE
     OR v_result->'stripe_accounts' IS DISTINCT FROM '[]'::jsonb
     OR v_result->'paystack_subaccounts' IS DISTINCT FROM '[]'::jsonb THEN
    RAISE EXCEPTION 't2r 3660 T: an already-deleted account with no audit row must answer deleted with empty lists: %', v_result;
  END IF;

  RAISE NOTICE 'issue_3660 host account deletion tester2 retest U/I/T/X PASS';
END;
$$;

-- M ---------------------------------------------------------------------------
DO $$
DECLARE
  v_a uuid := gen_random_uuid();
  v_b uuid := gen_random_uuid();
  v_e_ended uuid := gen_random_uuid();
  v_e_cancelled uuid := gen_random_uuid();
  v_sfx text := replace(gen_random_uuid()::text, '-', '');
  v_orders_before text;
  v_orders_after text;
  v_result jsonb;
BEGIN
  INSERT INTO auth.users(id) VALUES (v_a);
  INSERT INTO public.creator_accounts(id, email) VALUES (v_a, 't2r-m-' || v_sfx || '@example.test');
  INSERT INTO public.brands(id, account_id, name, slug, default_currency)
  VALUES (v_b, v_a, 'T2R M', 't2r-m-' || v_sfx, 'USD');
  INSERT INTO public.events(id, brand_id, created_by, title, slug, status) VALUES
    (v_e_ended, v_b, v_a, 'T2R M Ended', 't2r-m-end-' || v_sfx, 'ended'),
    (v_e_cancelled, v_b, v_a, 'T2R M Cancelled', 't2r-m-can-' || v_sfx, 'cancelled');
  INSERT INTO public.event_dates(event_id, start_at, end_at) VALUES
    (v_e_ended, now() - interval '6 days', now() - interval '5 days'),
    (v_e_cancelled, now() + interval '9 days', now() + interval '10 days');
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.orders
    (id, event_id, buyer_email, buyer_name, total_cents, currency, payment_status,
     source, payment_method, created_at)
  VALUES
    (gen_random_uuid(), v_e_ended, 't2r-buyer@example.test', 'T2R Buyer', 2500, 'USD',
     'paid', 'legacy', 'online_card', now() - interval '7 days'),
    (gen_random_uuid(), v_e_cancelled, 't2r-buyer@example.test', 'T2R Buyer', 2500, 'USD',
     'paid', 'legacy', 'online_card', now() - interval '2 days');
  SET LOCAL session_replication_role = origin;
  IF EXISTS (SELECT 1 FROM public.brand_payout_releases WHERE brand_id = v_b) THEN
    RAISE EXCEPTION 't2r 3660 M fixture: a payout row exists';
  END IF;
  SELECT md5(string_agg(to_jsonb(o)::text, ',' ORDER BY o.id)) INTO v_orders_before
  FROM public.orders o WHERE o.event_id IN (v_e_ended, v_e_cancelled);

  PERFORM pg_temp.t2r_claims('service_role', NULL);

  -- On the hold rail (Mingla holds this money): refused, nothing written.
  BEGIN
    UPDATE public.brands SET payout_hold_cutover_at = now() - interval '30 days' WHERE id = v_b;
    v_result := public.biz_delete_host_account(v_a);
    IF v_result->>'status' IS DISTINCT FROM 'blocked'
       OR v_result->'blockers'->0->>'code' IS DISTINCT FROM 'money_in_motion' THEN
      RAISE EXCEPTION 't2r 3660 M: a hold-rail Host with unpaid-out orders must be refused (money_in_motion): %', v_result;
    END IF;
    RAISE EXCEPTION 't2r_m_rollback' USING ERRCODE = 'T2RM1';
  EXCEPTION WHEN SQLSTATE 'T2RM1' THEN
    NULL;
  END;

  -- NOT on the hold rail (a direct charge, paid straight to the Host): deleted.
  v_result := public.biz_delete_host_account(v_a);
  IF v_result->>'status' IS DISTINCT FROM 'deleted' THEN
    RAISE EXCEPTION 't2r 3660 M: paid orders on an ended and a cancelled event held a direct-charge Host: %', v_result;
  END IF;
  SELECT md5(string_agg(to_jsonb(o)::text, ',' ORDER BY o.id)) INTO v_orders_after
  FROM public.orders o WHERE o.event_id IN (v_e_ended, v_e_cancelled);
  IF v_orders_before IS DISTINCT FROM v_orders_after
     OR EXISTS (SELECT 1 FROM public.events
                WHERE id IN (v_e_ended, v_e_cancelled) AND deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 't2r 3660 M: the deletion modified a finished event or its orders';
  END IF;

  RAISE NOTICE 'issue_3660 host account deletion tester2 retest PASS';
END;
$$;

ROLLBACK;
