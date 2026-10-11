\set ON_ERROR_STOP on
-- Issue #3660 — Host account deletion completes or changes nothing.
-- IMPLEMENTOR rework suite: one group per finding of the independent tester's
-- report that was fixed in the database (F-1, F-2, F-5, F-7), plus the runtime
-- evidence for F-6.
--
--   F-1  A paid, non-zero, not fully refunded order on ANY event of an owned
--        brand blocks (money_in_motion) until an item under a `released`
--        payout release covers it. A free order and a fully refunded order do
--        not block.
--   F-2  A signed-in, non-admin user cannot clear brands.deleted_at. The
--        service role and an admin still can. Soft-DELETING is unaffected.
--   F-5  A second call on an already-deleted account returns the provider
--        targets of the deletion that happened, and writes nothing.
--   F-6  A checkout session past its expiry does not block, and after the
--        deletion it can no longer be finalised into an order: the finalize
--        entry point refuses it. (Evidence that no change was needed.)
--   F-7  Pending team invitations on the deleted brands are revoked and
--        never-accepted partner links on them are closed, in the same
--        transaction. Accepted rows and other brands are untouched.
--
-- Runs as supabase_admin: money fixtures need session_replication_role =
-- replica, and F-2 switches to the real `authenticated` role. The replica role
-- is back to origin before any function or guard under test runs.
--
-- No row in auth.users is deleted here.
BEGIN;

-- A released (or other-status) payout release with one item per order on an event.
CREATE FUNCTION pg_temp.i3660r_cover(p_brand uuid, p_event uuid, p_status text)
RETURNS void
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_release uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.brand_payout_releases
    (id, brand_id, occurrence_key, surface, provider, currency, anchor_end_at,
     releasable_at, gross_cents, net_release_cents, status)
  VALUES (v_release, p_brand, 'i3660r-' || v_release::text, 'order', 'stripe', 'usd',
          date_trunc('second', now()) - interval '2 days',
          date_trunc('second', now()) - interval '1 day', 5000, 5000, p_status);
  INSERT INTO public.payout_release_items
    (id, release_id, source_type, source_id, gross_cents, refunded_cents,
     disputed_cents, mingla_fee_cents, partner_share_cents, provider_fee_cents,
     net_cents, source_finalized_at)
  SELECT gen_random_uuid(), v_release, 'order', o.id, o.total_cents, 0, 0, 0, 0, 0,
         o.total_cents, now()
  FROM public.orders o
  WHERE o.event_id = p_event;
END;
$fn$;

CREATE FUNCTION pg_temp.i3660r_codes(p_result jsonb)
RETURNS text
LANGUAGE sql
AS $fn$
  SELECT COALESCE(string_agg(x->>'code', ',' ORDER BY x->>'code'), '')
  FROM jsonb_array_elements(COALESCE(p_result->'blockers', '[]'::jsonb)) x;
$fn$;

-- One F-1 case in its own always-rolled-back subtransaction.
CREATE FUNCTION pg_temp.i3660r_case(
  p_name text, p_setup text, p_user uuid, p_expect text
)
RETURNS void
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_result jsonb;
BEGIN
  BEGIN
    PERFORM set_config('session_replication_role', 'replica', true);
    EXECUTE p_setup;
    PERFORM set_config('session_replication_role', 'origin', true);
    IF current_setting('session_replication_role') <> 'origin' THEN
      RAISE EXCEPTION 'issue_3660 rework [%]: triggers are not live', p_name;
    END IF;
    v_result := public.biz_delete_host_account(p_user);
    IF p_expect = 'deleted' THEN
      IF v_result->>'status' IS DISTINCT FROM 'deleted' THEN
        RAISE EXCEPTION 'issue_3660 rework [%]: expected deleted, got %', p_name, v_result;
      END IF;
    ELSIF v_result->>'status' IS DISTINCT FROM 'blocked'
          OR pg_temp.i3660r_codes(v_result) IS DISTINCT FROM p_expect THEN
      RAISE EXCEPTION 'issue_3660 rework [%]: expected blocked (%), got %', p_name, p_expect, v_result;
    END IF;
    RAISE EXCEPTION 'i3660r_rollback' USING ERRCODE = 'I3661';
  EXCEPTION WHEN SQLSTATE 'I3661' THEN
    NULL;
  END;
END;
$fn$;

-- ============================================================================
-- F-1 — money the organiser has not been paid yet.
-- ============================================================================
DO $$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_ended uuid := gen_random_uuid();      -- status scheduled, last date passed
  v_cancelled uuid := gen_random_uuid();  -- status cancelled, future date
  v_draft uuid := gen_random_uuid();      -- draft, no dates
  v_upcoming uuid := gen_random_uuid();   -- scheduled, future date
  v_sfx text := replace(gen_random_uuid()::text, '-', '');
  f_order text;
BEGIN
  INSERT INTO auth.users(id) VALUES (v_owner);
  INSERT INTO public.creator_accounts(id, email) VALUES (v_owner, 'i3660r-f1@example.test');
  INSERT INTO public.brands(id, account_id, name, slug, default_currency)
  VALUES (v_brand, v_owner, 'I3660R F1', 'i3660r-f1-' || v_sfx, 'USD');
  INSERT INTO public.stripe_connect_accounts(brand_id, stripe_account_id, country, default_currency)
  VALUES (v_brand, 'acct_i3660r_' || left(v_sfx, 10), 'US', 'USD');
  INSERT INTO public.events(id, brand_id, created_by, title, slug, status) VALUES
    (v_ended, v_brand, v_owner, 'I3660R Ended', 'i3660r-end-' || v_sfx, 'scheduled'),
    (v_cancelled, v_brand, v_owner, 'I3660R Cancelled', 'i3660r-can-' || v_sfx, 'cancelled'),
    (v_draft, v_brand, v_owner, 'I3660R Draft', 'i3660r-dra-' || v_sfx, 'draft'),
    (v_upcoming, v_brand, v_owner, 'I3660R Upcoming', 'i3660r-upc-' || v_sfx, 'scheduled');
  INSERT INTO public.event_dates(event_id, start_at, end_at) VALUES
    (v_ended, now() - interval '5 hours', now() - interval '1 hour'),
    (v_cancelled, now() + interval '9 days', now() + interval '10 days'),
    (v_upcoming, now() + interval '5 days', now() + interval '6 days');

  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);

  -- %1$L event, %2$L payment_status, %3$s total, %4$s refunded
  f_order := $f$INSERT INTO public.orders
      (id, event_id, buyer_email, buyer_name, total_cents, refunded_amount_cents,
       currency, payment_status, source)
    VALUES (gen_random_uuid(), %1$L, 'i3660r-buyer@example.test', 'I3660R Buyer',
            %3$s, %4$s, 'USD', %2$L, 'legacy')$f$;

  -- Baseline: with no order at all this owner IS deleted.
  PERFORM pg_temp.i3660r_case('baseline', 'SELECT 1', v_owner, 'deleted');

  -- The reported defect and its siblings: BLOCKED.
  PERFORM pg_temp.i3660r_case('paid order, event just ended, no release row',
    format(f_order, v_ended, 'paid', 5000, 0), v_owner, 'money_in_motion');
  PERFORM pg_temp.i3660r_case('partly refunded order, ended event, no release row',
    format(f_order, v_ended, 'partial_refund', 5000, 1000), v_owner, 'money_in_motion');
  PERFORM pg_temp.i3660r_case('paid order, CANCELLED event, no release row',
    format(f_order, v_cancelled, 'paid', 5000, 0), v_owner, 'money_in_motion');
  PERFORM pg_temp.i3660r_case('paid order, DRAFT event, no release row',
    format(f_order, v_draft, 'paid', 5000, 0), v_owner, 'money_in_motion');
  PERFORM pg_temp.i3660r_case('paid order, ended event, release still PENDING',
    format(f_order, v_ended, 'paid', 5000, 0) || ';' ||
    format('SELECT pg_temp.i3660r_cover(%L, %L, %L)', v_brand, v_ended, 'pending'),
    v_owner, 'money_in_motion');
  PERFORM pg_temp.i3660r_case('paid order, ended event, release IN FLIGHT',
    format(f_order, v_ended, 'paid', 5000, 0) || ';' ||
    format('SELECT pg_temp.i3660r_cover(%L, %L, %L)', v_brand, v_ended, 'in_flight'),
    v_owner, 'money_in_motion');
  -- Two orders, only one of them paid out: the other still blocks.
  PERFORM pg_temp.i3660r_case('one order released, a second paid after the release',
    format(f_order, v_ended, 'paid', 5000, 0) || ';' ||
    format('SELECT pg_temp.i3660r_cover(%L, %L, %L)', v_brand, v_ended, 'released') || ';' ||
    format(f_order, v_ended, 'paid', 2500, 0),
    v_owner, 'money_in_motion');
  -- An upcoming event's paid order stays reported as a sold ticket.
  PERFORM pg_temp.i3660r_case('paid order, upcoming event',
    format(f_order, v_upcoming, 'paid', 5000, 0), v_owner, 'tickets_sold');

  -- What must NOT block.
  PERFORM pg_temp.i3660r_case('paid order, ended event, RELEASED',
    format(f_order, v_ended, 'paid', 5000, 0) || ';' ||
    format('SELECT pg_temp.i3660r_cover(%L, %L, %L)', v_brand, v_ended, 'released'),
    v_owner, 'deleted');
  PERFORM pg_temp.i3660r_case('FREE order (paid, 0), ended event',
    format(f_order, v_ended, 'paid', 0, 0), v_owner, 'deleted');
  PERFORM pg_temp.i3660r_case('fully REFUNDED order, ended event',
    format(f_order, v_ended, 'refunded', 5000, 5000), v_owner, 'deleted');
  PERFORM pg_temp.i3660r_case('cancelled order, ended event',
    format(f_order, v_ended, 'cancelled', 5000, 0), v_owner, 'deleted');
  PERFORM pg_temp.i3660r_case('failed order, ended event',
    format(f_order, v_ended, 'failed', 5000, 0), v_owner, 'deleted');
  PERFORM pg_temp.i3660r_case('pending order, ended event',
    format(f_order, v_ended, 'pending', 5000, 0), v_owner, 'deleted');

  RAISE NOTICE 'issue_3660 rework F-1 PASS';
END;
$$;

-- ============================================================================
-- F-5 and F-7 — one deletion, then the retry.
-- ============================================================================
DO $$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_partner uuid := gen_random_uuid();
  v_member uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_other_brand uuid := gen_random_uuid();
  v_inv_pending uuid := gen_random_uuid();
  v_inv_owner uuid := gen_random_uuid();     -- pending brand_owner handover
  v_inv_accepted uuid := gen_random_uuid();
  v_inv_elsewhere uuid := gen_random_uuid(); -- pending, on a brand NOT deleted
  v_link_handover uuid := gen_random_uuid(); -- waits on v_inv_owner
  v_link_pending uuid := gen_random_uuid();  -- invited, never accepted
  v_link_accepted uuid := gen_random_uuid(); -- accepted partner on the deleted brand
  v_link_elsewhere uuid := gen_random_uuid();-- pending, on a brand NOT deleted
  v_sfx text := replace(gen_random_uuid()::text, '-', '');
  v_first jsonb;
  v_second jsonb;
  v_snap_before text;
  v_snap_after text;
  v_count integer;
BEGIN
  INSERT INTO auth.users(id) VALUES (v_owner), (v_other), (v_partner), (v_member);
  INSERT INTO public.creator_accounts(id, email) VALUES
    (v_owner, 'i3660r-own@example.test'), (v_other, 'i3660r-oth@example.test'),
    (v_partner, 'i3660r-par@example.test'), (v_member, 'i3660r-mem@example.test');
  INSERT INTO public.brands(id, account_id, name, slug, default_currency) VALUES
    (v_brand, v_owner, 'I3660R Main', 'i3660r-main-' || v_sfx, 'USD'),
    (v_other_brand, v_other, 'I3660R Other', 'i3660r-oth-' || v_sfx, 'USD');
  UPDATE public.brands SET paystack_subaccount_code = 'ACCT_i3660r_' || left(v_sfx, 10)
   WHERE id = v_brand;
  INSERT INTO public.stripe_connect_accounts(brand_id, stripe_account_id, country, default_currency)
  VALUES (v_brand, 'acct_i3660r5_' || left(v_sfx, 10), 'US', 'USD');
  INSERT INTO public.brand_team_members(brand_id, user_id, role, invited_at, accepted_at)
  VALUES (v_brand, v_member, 'event_manager', now(), now()),
         (v_brand, v_partner, 'finance_manager', now(), now());

  INSERT INTO public.brand_invitations
    (id, brand_id, email, role, invited_by, token_hash, expires_at, status, accepted_at)
  VALUES
    (v_inv_pending, v_brand, 'i3660r-inv1@example.test', 'event_manager', v_owner,
     'i3660r-' || gen_random_uuid()::text, now() + interval '7 days', 'pending', NULL),
    (v_inv_owner, v_brand, 'i3660r-handover@example.test', 'brand_owner', v_owner,
     'i3660r-' || gen_random_uuid()::text, now() + interval '7 days', 'pending', NULL),
    (v_inv_accepted, v_brand, 'i3660r-mem@example.test', 'event_manager', v_owner,
     'i3660r-' || gen_random_uuid()::text, now() + interval '7 days', 'accepted', now()),
    (v_inv_elsewhere, v_other_brand, 'i3660r-inv2@example.test', 'event_manager', v_other,
     'i3660r-' || gen_random_uuid()::text, now() + interval '7 days', 'pending', NULL);
  INSERT INTO public.partner_brand_links
    (id, partner_account_id, brand_id, invited_owner_email, accepted_at)
  VALUES
    (v_link_handover, v_other, v_brand, 'i3660r-handover@example.test', NULL),
    (v_link_pending, v_member, v_brand, 'i3660r-nobody@example.test', NULL),
    (v_link_accepted, v_partner, v_brand, 'i3660r-own@example.test', now()),
    (v_link_elsewhere, v_partner, v_other_brand, 'i3660r-nobody2@example.test', NULL);

  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);

  v_first := public.biz_delete_host_account(v_owner);
  IF v_first->>'status' IS DISTINCT FROM 'deleted'
     OR (v_first->>'already_deleted')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'issue_3660 rework fixture: the deletion did not complete: %', v_first;
  END IF;

  -- F-7 — invitations --------------------------------------------------------
  IF (v_first->>'invitations_revoked')::integer <> 2 THEN
    RAISE EXCEPTION 'issue_3660 rework F-7: expected 2 invitations revoked, got %', v_first;
  END IF;
  IF EXISTS (SELECT 1 FROM public.brand_invitations
             WHERE brand_id = v_brand AND status = 'pending') THEN
    RAISE EXCEPTION 'issue_3660 rework F-7: a pending invitation is left on a deleted brand';
  END IF;
  IF (SELECT count(*) FROM public.brand_invitations
       WHERE id IN (v_inv_pending, v_inv_owner)
         AND status = 'revoked' AND revoked_at IS NOT NULL) <> 2 THEN
    RAISE EXCEPTION 'issue_3660 rework F-7: revoked invitations do not carry status revoked + revoked_at';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.brand_invitations
                 WHERE id = v_inv_accepted AND status = 'accepted' AND revoked_at IS NULL) THEN
    RAISE EXCEPTION 'issue_3660 rework F-7: an ACCEPTED invitation was rewritten';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.brand_invitations
                 WHERE id = v_inv_elsewhere AND status = 'pending') THEN
    RAISE EXCEPTION 'issue_3660 rework F-7: an invitation on a brand that was NOT deleted was revoked';
  END IF;

  -- F-7 — never-accepted partner links ---------------------------------------
  IF EXISTS (SELECT 1 FROM public.partner_brand_links
             WHERE brand_id = v_brand AND accepted_at IS NULL AND cancelled_at IS NULL) THEN
    RAISE EXCEPTION 'issue_3660 rework F-7: a never-accepted partner link is still open on a deleted brand';
  END IF;
  IF (SELECT count(*) FROM public.partner_brand_links
       WHERE id IN (v_link_handover, v_link_pending)
         AND cancelled_at IS NOT NULL AND cancelled_reason = 'invitation_revoked') <> 2 THEN
    RAISE EXCEPTION 'issue_3660 rework F-7: closed pending links do not carry invitation_revoked';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.partner_brand_links
                 WHERE id = v_link_accepted AND cancelled_at IS NULL) THEN
    RAISE EXCEPTION 'issue_3660 rework F-7: an ACCEPTED partner link on the deleted brand was cancelled';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.partner_brand_links
                 WHERE id = v_link_elsewhere AND cancelled_at IS NULL) THEN
    RAISE EXCEPTION 'issue_3660 rework F-7: a pending link on a brand that was NOT deleted was closed';
  END IF;
  -- Other members' rows on the deleted brand stay as they are.
  IF (SELECT count(*) FROM public.brand_team_members
       WHERE brand_id = v_brand AND user_id IN (v_member, v_partner)
         AND removed_at IS NULL) <> 2 THEN
    RAISE EXCEPTION 'issue_3660 rework F-7: another member''s row on the deleted brand was changed';
  END IF;

  -- F-5 — the retry returns the provider targets and writes nothing ----------
  IF jsonb_array_length(v_first->'stripe_accounts') <> 1
     OR jsonb_array_length(v_first->'paystack_subaccounts') <> 1 THEN
    RAISE EXCEPTION 'issue_3660 rework F-5 fixture: first call returned no provider targets: %', v_first;
  END IF;
  SELECT md5(concat_ws('|',
    (SELECT string_agg(to_jsonb(t)::text, ',' ORDER BY t.id) FROM public.brands t WHERE t.id IN (v_brand, v_other_brand)),
    (SELECT string_agg(to_jsonb(t)::text, ',' ORDER BY t.id) FROM public.creator_accounts t WHERE t.id = v_owner),
    (SELECT string_agg(to_jsonb(t)::text, ',' ORDER BY t.id) FROM public.stripe_connect_accounts t WHERE t.brand_id = v_brand),
    (SELECT string_agg(to_jsonb(t)::text, ',' ORDER BY t.id) FROM public.brand_team_members t WHERE t.brand_id IN (v_brand, v_other_brand)),
    (SELECT string_agg(to_jsonb(t)::text, ',' ORDER BY t.id) FROM public.brand_invitations t WHERE t.brand_id IN (v_brand, v_other_brand)),
    (SELECT string_agg(to_jsonb(t)::text, ',' ORDER BY t.id) FROM public.partner_brand_links t WHERE t.brand_id IN (v_brand, v_other_brand)),
    (SELECT count(*)::text FROM public.audit_log)
  )) INTO v_snap_before;

  v_second := public.biz_delete_host_account(v_owner);

  SELECT md5(concat_ws('|',
    (SELECT string_agg(to_jsonb(t)::text, ',' ORDER BY t.id) FROM public.brands t WHERE t.id IN (v_brand, v_other_brand)),
    (SELECT string_agg(to_jsonb(t)::text, ',' ORDER BY t.id) FROM public.creator_accounts t WHERE t.id = v_owner),
    (SELECT string_agg(to_jsonb(t)::text, ',' ORDER BY t.id) FROM public.stripe_connect_accounts t WHERE t.brand_id = v_brand),
    (SELECT string_agg(to_jsonb(t)::text, ',' ORDER BY t.id) FROM public.brand_team_members t WHERE t.brand_id IN (v_brand, v_other_brand)),
    (SELECT string_agg(to_jsonb(t)::text, ',' ORDER BY t.id) FROM public.brand_invitations t WHERE t.brand_id IN (v_brand, v_other_brand)),
    (SELECT string_agg(to_jsonb(t)::text, ',' ORDER BY t.id) FROM public.partner_brand_links t WHERE t.brand_id IN (v_brand, v_other_brand)),
    (SELECT count(*)::text FROM public.audit_log)
  )) INTO v_snap_after;

  IF v_second->>'status' IS DISTINCT FROM 'deleted'
     OR (v_second->>'already_deleted')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'issue_3660 rework F-5: the retry was not reported as already deleted: %', v_second;
  END IF;
  IF v_second->'stripe_accounts' IS DISTINCT FROM v_first->'stripe_accounts' THEN
    RAISE EXCEPTION 'issue_3660 rework F-5: the retry did not return the Stripe targets again: first % / retry %',
      v_first->'stripe_accounts', v_second->'stripe_accounts';
  END IF;
  IF v_second->'paystack_subaccounts' IS DISTINCT FROM v_first->'paystack_subaccounts' THEN
    RAISE EXCEPTION 'issue_3660 rework F-5: the retry did not return the Paystack targets again: first % / retry %',
      v_first->'paystack_subaccounts', v_second->'paystack_subaccounts';
  END IF;
  IF v_second->'stripe_accounts'->0->>'stripe_account_id' NOT LIKE 'acct_i3660r5_%'
     OR v_second->'paystack_subaccounts'->0->>'subaccount_code' NOT LIKE 'ACCT_i3660r_%' THEN
    RAISE EXCEPTION 'issue_3660 rework F-5: the retry returned the wrong targets: %', v_second;
  END IF;
  IF v_snap_before IS DISTINCT FROM v_snap_after THEN
    RAISE EXCEPTION 'issue_3660 rework F-5: the retry wrote something';
  END IF;
  SELECT count(*) INTO v_count FROM public.audit_log
   WHERE action = 'host_account.deleted' AND target_id = v_owner::text;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'issue_3660 rework F-5: expected one host_account.deleted audit row, found %', v_count;
  END IF;

  -- A deleted account with NO provider rows returns empty lists on the retry,
  -- not somebody else's targets.
  v_first := public.biz_delete_host_account(v_member);
  v_second := public.biz_delete_host_account(v_member);
  IF (v_second->>'already_deleted')::boolean IS NOT TRUE
     OR jsonb_array_length(v_second->'stripe_accounts') <> 0
     OR jsonb_array_length(v_second->'paystack_subaccounts') <> 0 THEN
    RAISE EXCEPTION 'issue_3660 rework F-5: a member-only retry returned provider targets: %', v_second;
  END IF;

  RAISE NOTICE 'issue_3660 rework F-5 F-7 PASS';
END;
$$;

-- ============================================================================
-- F-2 — a signed-in user cannot un-delete a brand.
-- ============================================================================
DO $$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_coadmin uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();   -- deleted through the Host deletion
  v_brand2 uuid := gen_random_uuid();  -- soft-deleted on its own, account stays
  v_live uuid := gen_random_uuid();    -- never deleted
  v_sfx text := replace(gen_random_uuid()::text, '-', '');
  v_rows integer;
  v_raised boolean;
BEGIN
  INSERT INTO auth.users(id, email) VALUES
    (v_owner, 'i3660r-f2-own-' || v_sfx || '@example.test'),
    (v_coadmin, 'i3660r-f2-co-' || v_sfx || '@example.test'),
    (v_admin, 'i3660r-f2-adm-' || v_sfx || '@example.test');
  INSERT INTO public.admin_users(email, status)
  VALUES ('i3660r-f2-adm-' || v_sfx || '@example.test', 'active');
  INSERT INTO public.creator_accounts(id, email) VALUES
    (v_owner, 'i3660r-f2-own@example.test'), (v_coadmin, 'i3660r-f2-co@example.test');
  INSERT INTO public.brands(id, account_id, name, slug, default_currency) VALUES
    (v_brand, v_owner, 'I3660R F2', 'i3660r-f2-' || v_sfx, 'USD'),
    (v_brand2, v_coadmin, 'I3660R F2b', 'i3660r-f2b-' || v_sfx, 'USD'),
    (v_live, v_coadmin, 'I3660R F2c', 'i3660r-f2c-' || v_sfx, 'USD');
  INSERT INTO public.brand_team_members(brand_id, user_id, role, invited_at, accepted_at)
  VALUES (v_brand, v_coadmin, 'brand_admin', now(), now());

  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  IF public.biz_delete_host_account(v_owner)->>'status' IS DISTINCT FROM 'deleted' THEN
    RAISE EXCEPTION 'issue_3660 rework F-2 fixture: the deletion did not complete';
  END IF;

  -- (a) the kept login, on its own deleted brand, through RLS ----------------
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('role', 'authenticated', 'sub', v_owner)::text, true);
  SET LOCAL ROLE authenticated;
  v_raised := false;
  BEGIN
    UPDATE public.brands SET deleted_at = NULL WHERE id = v_brand;
  EXCEPTION WHEN insufficient_privilege THEN
    v_raised := SQLERRM LIKE '%brand_restore_forbidden%';
  END;
  RESET ROLE;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'issue_3660 rework F-2(a): the owner''s un-delete was not refused with brand_restore_forbidden';
  END IF;
  IF EXISTS (SELECT 1 FROM public.brands WHERE id = v_brand AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'issue_3660 rework F-2(a): the deleted brand came back';
  END IF;

  -- (b) a brand admin who is not the account ---------------------------------
  PERFORM set_config('request.jwt.claim.sub', v_coadmin::text, true);
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('role', 'authenticated', 'sub', v_coadmin)::text, true);
  SET LOCAL ROLE authenticated;
  v_raised := false;
  v_rows := 0;
  BEGIN
    UPDATE public.brands SET deleted_at = NULL WHERE id = v_brand;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
  EXCEPTION WHEN insufficient_privilege THEN
    v_raised := true;
  END;
  RESET ROLE;
  IF EXISTS (SELECT 1 FROM public.brands WHERE id = v_brand AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'issue_3660 rework F-2(b): a brand admin un-deleted the brand (raised %, rows %)', v_raised, v_rows;
  END IF;

  -- (c) the same rule for an ORDINARY brand deletion, and soft-DELETING still
  --     works for the owner (the guard is one direction only) -----------------
  SET LOCAL ROLE authenticated;
  UPDATE public.brands SET deleted_at = now() WHERE id = v_brand2;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RESET ROLE;
    RAISE EXCEPTION 'issue_3660 rework F-2(c): the owner can no longer soft-delete their own brand';
  END IF;
  v_raised := false;
  BEGIN
    UPDATE public.brands SET deleted_at = NULL WHERE id = v_brand2;
  EXCEPTION WHEN insufficient_privilege THEN
    v_raised := SQLERRM LIKE '%brand_restore_forbidden%';
  END;
  -- Any other write to a live brand is untouched by the guard.
  UPDATE public.brands SET name = 'I3660R F2c renamed' WHERE id = v_live;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RESET ROLE;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'issue_3660 rework F-2(c): an ordinary deleted brand was un-deleted by its owner';
  END IF;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'issue_3660 rework F-2(c): an unrelated update of a live brand was refused';
  END IF;

  -- (d) an ADMIN, signed in, can still restore (support) ----------------------
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('role', 'authenticated', 'sub', v_admin)::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.brands SET deleted_at = NULL WHERE id = v_brand2;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RESET ROLE;
  IF v_rows <> 1
     OR EXISTS (SELECT 1 FROM public.brands WHERE id = v_brand2 AND deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'issue_3660 rework F-2(d): an admin could not restore a brand (rows %)', v_rows;
  END IF;

  -- (e) the SERVICE ROLE can still restore ------------------------------------
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  SET LOCAL ROLE service_role;
  UPDATE public.brands SET deleted_at = NULL WHERE id = v_brand;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RESET ROLE;
  IF v_rows <> 1
     OR EXISTS (SELECT 1 FROM public.brands WHERE id = v_brand AND deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'issue_3660 rework F-2(e): the service role could not restore a brand (rows %)', v_rows;
  END IF;

  -- (f) the guard function cannot be called by an API role, and the older
  --     guard it sits beside is still there -----------------------------------
  IF has_function_privilege('authenticated', 'public.issue_3660_guard_brand_undelete()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.issue_3660_guard_brand_undelete()', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue_3660 rework F-2(f): the guard function is callable by an API role';
  END IF;
  IF (SELECT count(*) FROM pg_trigger
       WHERE tgrelid = 'public.brands'::regclass AND NOT tgisinternal AND tgenabled <> 'D'
         AND tgname IN ('issue_2063_guard_brand_soft_delete', 'issue_3660_guard_brand_undelete')) <> 2 THEN
    RAISE EXCEPTION 'issue_3660 rework F-2(f): one of the two brand guards is missing or disabled';
  END IF;

  RAISE NOTICE 'issue_3660 rework F-2 PASS';
END;
$$;

-- ============================================================================
-- F-6 — a checkout session past its expiry time.
--
-- Runtime evidence, three parts:
--   (1) BEFORE a deletion, an expired session that is still in a payable
--       status and holds a valid admission epoch DOES finalise into a paid
--       order (the finalize path never reads expires_at). The suspicion in the
--       tester's report is correct on that point.
--   (2) AFTER a deletion, the same kind of session does NOT: the take-down
--       revokes it, biz_ticket_checkout_finalize refuses and mints a reversal,
--       and no order or ticket is created.
--   (3) An expired session whose payment is being PROCESSED blocks the
--       deletion (checkout_in_progress); an expired abandoned cart does not.
-- ============================================================================
DO $$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_tier uuid := gen_random_uuid();
  v_abandoned uuid := gen_random_uuid();
  v_sfx text := replace(gen_random_uuid()::text, '-', '');
  v_epoch bigint;
  v_result jsonb;
  v_blockers jsonb;
  f_session text;
BEGIN
  INSERT INTO auth.users(id) VALUES (v_owner);
  INSERT INTO public.creator_accounts(id, email) VALUES (v_owner, 'i3660r-f6@example.test');
  INSERT INTO public.brands(id, account_id, name, slug, default_currency)
  VALUES (v_brand, v_owner, 'I3660R F6', 'i3660r-f6-' || v_sfx, 'USD');
  INSERT INTO public.events(
    id, brand_id, created_by, title, description, slug, event_type, visibility,
    status, timezone, location_text, is_online, city, cover_media_url,
    cover_media_type, cover_media_alt, theme, published_at)
  VALUES (v_event, v_brand, v_owner, 'I3660R F6 Event',
    'A published upcoming event used to prove what an expired checkout can still do.',
    'i3660r-f6-e-' || v_sfx, 'event', 'public', 'scheduled', 'America/New_York',
    'Downtown Durham', false, 'Durham', 'https://images.example.test/i3660r-f6.jpg',
    'image', 'People at the event', '{}', now());
  INSERT INTO public.event_dates(event_id, start_at, end_at)
  VALUES (v_event, now() + interval '5 days', now() + interval '6 days');
  INSERT INTO public.ticket_types(id, event_id, name, price_cents, currency, quantity_total)
  VALUES (v_tier, v_event, 'General', 1000, 'USD', 100);
  INSERT INTO public.event_checkout_admission_state(event_id, epoch, sellable, reason)
  VALUES (v_event, 1, true, 'sellable')
  ON CONFLICT (event_id) DO UPDATE SET sellable = true, reason = 'sellable';
  SELECT epoch INTO v_epoch FROM public.event_checkout_admission_state WHERE event_id = v_event;

  -- %1$L id, %2$L status, %3$L revoked_at (or NULL)
  f_session := format($f$INSERT INTO public.ticket_checkout_sessions
      (id, event_id, brand_id, buyer_name, buyer_email, buyer_phone_e164, currency,
       subtotal_cents, total_cents, status, idempotency_key, expires_at,
       application_fee_amount_cents, admission_epoch, revoked_at)
    VALUES (%%1$L, %1$L, %2$L, 'I3660R Buyer', 'i3660r-f6b@example.test',
            '+12015550199', 'USD', 1000, 1000, %%2$L,
            'i3660r-' || gen_random_uuid()::text, now() - interval '20 minutes',
            100, %3$s, %%3$s)$f$, v_event, v_brand, v_epoch);

  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);

  -- (1) An expired, payable session finalises BEFORE any deletion. ------------
  BEGIN
    PERFORM set_config('session_replication_role', 'replica', true);
    EXECUTE format(f_session, v_abandoned, 'requires_payment', 'NULL');
    PERFORM set_config('session_replication_role', 'origin', true);
    v_result := public.biz_ticket_checkout_finalize(
      v_abandoned, 'pi_i3660rF6a', 'ch_i3660rF6a', 'card', repeat('p', 64));
    IF v_result->>'outcome' IS DISTINCT FROM 'finalized'
       OR NOT EXISTS (SELECT 1 FROM public.orders
                      WHERE event_id = v_event AND payment_status = 'paid') THEN
      RAISE EXCEPTION 'issue_3660 rework F-6(1): the premise changed — an expired payable session no longer finalises (%). Re-read the F-6 decision.', v_result;
    END IF;
    -- ...and once it has, the paid order blocks the deletion like any other.
    v_result := public.biz_delete_host_account(v_owner);
    IF v_result->>'status' IS DISTINCT FROM 'blocked'
       OR pg_temp.i3660r_codes(v_result) NOT LIKE '%tickets_sold%' THEN
      RAISE EXCEPTION 'issue_3660 rework F-6(1): a late-finalised order did not block: %', v_result;
    END IF;
    RAISE EXCEPTION 'i3660r_rollback' USING ERRCODE = 'I3661';
  EXCEPTION WHEN SQLSTATE 'I3661' THEN
    NULL;
  END;

  -- (3) An expired session with a payment IN PROCESS blocks. ------------------
  BEGIN
    PERFORM set_config('session_replication_role', 'replica', true);
    EXECUTE format(f_session, gen_random_uuid(), 'processing_payment', 'NULL');
    PERFORM set_config('session_replication_role', 'origin', true);
    v_result := public.biz_delete_host_account(v_owner);
    IF v_result->>'status' IS DISTINCT FROM 'blocked'
       OR pg_temp.i3660r_codes(v_result) IS DISTINCT FROM 'checkout_in_progress' THEN
      RAISE EXCEPTION 'issue_3660 rework F-6(3): an expired session with a payment in process did not block: %', v_result;
    END IF;
    RAISE EXCEPTION 'i3660r_rollback' USING ERRCODE = 'I3661';
  EXCEPTION WHEN SQLSTATE 'I3661' THEN
    NULL;
  END;
  -- ...unless it was revoked.
  BEGIN
    PERFORM set_config('session_replication_role', 'replica', true);
    EXECUTE format(f_session, gen_random_uuid(), 'processing_payment', 'now()');
    PERFORM set_config('session_replication_role', 'origin', true);
    v_result := public.biz_delete_host_account(v_owner);
    IF v_result->>'status' IS DISTINCT FROM 'deleted' THEN
      RAISE EXCEPTION 'issue_3660 rework F-6(3): a REVOKED expired session blocked: %', v_result;
    END IF;
    RAISE EXCEPTION 'i3660r_rollback' USING ERRCODE = 'I3661';
  EXCEPTION WHEN SQLSTATE 'I3661' THEN
    NULL;
  END;

  -- (2) An expired abandoned cart does not block, and AFTER the deletion it
  --     cannot be turned into an order. ----------------------------------------
  PERFORM set_config('session_replication_role', 'replica', true);
  EXECUTE format(f_session, v_abandoned, 'requires_payment', 'NULL');
  PERFORM set_config('session_replication_role', 'origin', true);

  v_blockers := private.host_account_deletion_blockers(v_owner, ARRAY[v_brand]);
  IF v_blockers <> '[]'::jsonb THEN
    RAISE EXCEPTION 'issue_3660 rework F-6(2): an expired abandoned cart blocked: %', v_blockers;
  END IF;
  v_result := public.biz_delete_host_account(v_owner);
  IF v_result->>'status' IS DISTINCT FROM 'deleted' THEN
    RAISE EXCEPTION 'issue_3660 rework F-6(2) fixture: the deletion did not complete: %', v_result;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ticket_checkout_sessions
                 WHERE id = v_abandoned AND revoked_at IS NOT NULL) THEN
    RAISE EXCEPTION 'issue_3660 rework F-6(2): the take-down did not revoke the open session';
  END IF;

  v_result := public.biz_ticket_checkout_finalize(
    v_abandoned, 'pi_i3660rF6b', 'ch_i3660rF6b', 'card', repeat('p', 64));
  IF v_result->>'outcome' = 'finalized' THEN
    RAISE EXCEPTION 'issue_3660 rework F-6(2): a late payment was finalised on a taken-down event: %', v_result;
  END IF;
  IF EXISTS (SELECT 1 FROM public.orders WHERE event_id = v_event)
     OR EXISTS (SELECT 1 FROM public.tickets WHERE event_id = v_event) THEN
    RAISE EXCEPTION 'issue_3660 rework F-6(2): an order or ticket landed on a taken-down event';
  END IF;
  IF v_result->>'outcome' IS DISTINCT FROM 'paid_reversal_pending' THEN
    RAISE EXCEPTION 'issue_3660 rework F-6(2): the late payment was not routed to a reversal: %', v_result;
  END IF;

  RAISE NOTICE 'issue_3660 rework F-6 PASS';
END;
$$;

ROLLBACK;
