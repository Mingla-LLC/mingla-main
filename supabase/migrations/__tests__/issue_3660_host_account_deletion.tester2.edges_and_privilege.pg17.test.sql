\set ON_ERROR_STOP on
-- Issue #3660 — Host account deletion completes or changes nothing.
-- INDEPENDENT TESTER (tester2) suite: ownership edges, real-role privilege,
-- cross-account leakage, partner dual-stamp parity, and what is left behind.
--
-- This file was written by the tester, not the implementor. It attacks axes
-- the two implementor suites do not:
--
--   P  Privilege through REAL database roles (SET ROLE), not a spoofed claim
--      on a superuser session: the grant table, the private schema, and the
--      SECURITY DEFINER hop are what is exercised.
--   L  The delete-screen preview RPC never reports another Host's events to a
--      co-owner, a team member or anon.
--   O  Ownership edges: an owner of TWO brands where only one is blocked
--      (nothing may change on either); a brand that was already soft-deleted;
--      an `ended` and a `cancelled` event with paid orders (must NOT block,
--      and their order and ticket rows must survive byte for byte); a
--      multi-date event whose first date has passed and last has not; a
--      co-owner who is not the brand's account; a team member whose brand
--      owner was deleted first.
--   D  Partner dual-stamp parity: what the deletion writes for a partner is
--      compared, column by column, with what the real
--      public.partner_disconnect_link writes for another partner in the same
--      transaction.
--   C  Consistency after commit: every public reader, no orphan active rows,
--      one timestamp for every stamp, exactly one audit row.
--   G  The two pre-existing guards still refuse a signed-in owner going
--      through row level security.
--
-- Fixtures for tables with deep foreign key graphs are inserted under
-- session_replication_role = replica (needs supabase_admin, like the sibling
-- adversarial suite); the role is back to origin before any call under test.
-- No row in auth.users is deleted. Everything is rolled back.
BEGIN;

-- md5 over every row a Host deletion could write, plus the money records that
-- must never be touched, for the given users / brands.
CREATE FUNCTION pg_temp.t2_snap(p_users uuid[], p_brands uuid[])
RETURNS text
LANGUAGE sql
AS $fn$
  SELECT md5(concat_ws('|',
    (SELECT string_agg(to_jsonb(t)::text, ',' ORDER BY t.id)
       FROM public.creator_accounts t WHERE t.id = ANY (p_users)),
    (SELECT string_agg(to_jsonb(t)::text, ',' ORDER BY t.id)
       FROM public.brands t WHERE t.id = ANY (p_brands)),
    (SELECT string_agg(to_jsonb(t)::text, ',' ORDER BY t.id)
       FROM public.events t WHERE t.brand_id = ANY (p_brands)),
    (SELECT string_agg(to_jsonb(t)::text, ',' ORDER BY t.id)
       FROM public.brand_team_members t
      WHERE t.brand_id = ANY (p_brands) OR t.user_id = ANY (p_users)),
    (SELECT string_agg(to_jsonb(t)::text, ',' ORDER BY t.brand_id)
       FROM public.stripe_connect_accounts t WHERE t.brand_id = ANY (p_brands)),
    (SELECT string_agg(to_jsonb(t)::text, ',' ORDER BY t.brand_id)
       FROM public.brand_paystack_recipients t WHERE t.brand_id = ANY (p_brands)),
    (SELECT string_agg(to_jsonb(t)::text, ',' ORDER BY t.id)
       FROM public.partner_brand_links t
      WHERE t.brand_id = ANY (p_brands) OR t.partner_account_id = ANY (p_users)),
    (SELECT string_agg(to_jsonb(t)::text, ',' ORDER BY t.id)
       FROM public.orders t
      WHERE t.event_id IN (SELECT e.id FROM public.events e WHERE e.brand_id = ANY (p_brands))),
    (SELECT string_agg(to_jsonb(t)::text, ',' ORDER BY t.id)
       FROM public.tickets t
      WHERE t.event_id IN (SELECT e.id FROM public.events e WHERE e.brand_id = ANY (p_brands))),
    (SELECT count(*)::text FROM public.audit_log t
      WHERE t.user_id = ANY (p_users) OR t.brand_id = ANY (p_brands))
  ));
$fn$;

CREATE FUNCTION pg_temp.t2_codes(p_result jsonb)
RETURNS text
LANGUAGE sql
AS $fn$
  SELECT COALESCE(string_agg(b->>'code', ',' ORDER BY b->>'code'), '')
  FROM jsonb_array_elements(COALESCE(p_result->'blockers', p_result)) b;
$fn$;

-- Become a signed-in Host / anon / the service role through the REAL role.
CREATE FUNCTION pg_temp.t2_claims(p_role text, p_sub uuid)
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

DO $$
DECLARE
  -- users
  v_a uuid := gen_random_uuid();   -- owns A1, A2 and the already-deleted A3
  v_b uuid := gen_random_uuid();   -- owns B1
  v_c uuid := gen_random_uuid();   -- co-owner ROLE on B1, not B1's account
  v_m uuid := gen_random_uuid();   -- plain team member on B1
  v_p uuid := gen_random_uuid();   -- partner on B1 and Q1; also owns PB
  v_q uuid := gen_random_uuid();   -- owns Q1 and Q2
  v_p2 uuid := gen_random_uuid();  -- partner on Q2, ended by the REAL disconnect
  -- brands
  v_a1 uuid := gen_random_uuid();
  v_a2 uuid := gen_random_uuid();
  v_a3 uuid := gen_random_uuid();
  v_b1 uuid := gen_random_uuid();
  v_q1 uuid := gen_random_uuid();
  v_q2 uuid := gen_random_uuid();
  v_pb uuid := gen_random_uuid();
  -- events
  v_e_up uuid := gen_random_uuid();        -- A1: published, upcoming, zero-sale
  v_e_ended uuid := gen_random_uuid();     -- A1: status ended, paid order + ticket
  v_e_cancelled uuid := gen_random_uuid(); -- A1: status cancelled, FUTURE date, paid order
  v_e_multi uuid := gen_random_uuid();     -- A2: first date passed, last date ahead, paid order
  v_e_a3 uuid := gen_random_uuid();        -- A3 (already deleted brand): upcoming + paid order
  v_e_b1 uuid := gen_random_uuid();        -- B1: upcoming, sold ticket
  v_e_q1 uuid := gen_random_uuid();        -- Q1: upcoming, zero-sale
  -- rows
  v_o_multi uuid := gen_random_uuid();
  v_o_b1 uuid := gen_random_uuid();
  v_split uuid := gen_random_uuid();
  v_l_b1 uuid := gen_random_uuid();
  v_l_q1 uuid := gen_random_uuid();
  v_l_q2 uuid := gen_random_uuid();
  v_l_pb uuid := gen_random_uuid();
  v_sfx text := replace(gen_random_uuid()::text, '-', '');
  v_a1_slug text;
  v_up_slug text;
  v_secret_title text;
  v_a_users uuid[];
  v_a_brands uuid[];
  v_before text;
  v_after text;
  v_money_before text;
  v_money_after text;
  v_result jsonb;
  v_preview jsonb;
  v_json json;
  v_doc jsonb;
  v_count integer;
  v_raised boolean;
  v_ts timestamptz;
  v_ref_link_before jsonb;
  v_ref_link_after jsonb;
  v_ref_member_before jsonb;
  v_ref_member_after jsonb;
  v_del_link_before jsonb;
  v_del_link_after jsonb;
  v_del_member_before jsonb;
  v_del_member_after jsonb;
  v_ref_changed text;
  v_del_changed text;
BEGIN
  v_a1_slug := 't2-3660-a1-' || v_sfx;
  v_up_slug := 't2-3660-up-' || v_sfx;
  v_secret_title := 'T2 B1 Private Title ' || v_sfx;
  v_a_users := ARRAY[v_a];
  v_a_brands := ARRAY[v_a1, v_a2, v_a3];

  -- --------------------------------------------------------------------------
  -- Fixtures
  -- --------------------------------------------------------------------------
  INSERT INTO auth.users(id) VALUES (v_a), (v_b), (v_c), (v_m), (v_p), (v_q), (v_p2);
  INSERT INTO public.creator_accounts(id, email) VALUES
    (v_a, 't2-3660-a@example.test'), (v_b, 't2-3660-b@example.test'),
    (v_c, 't2-3660-c@example.test'), (v_m, 't2-3660-m@example.test'),
    (v_p, 't2-3660-p@example.test'), (v_q, 't2-3660-q@example.test'),
    (v_p2, 't2-3660-p2@example.test');

  INSERT INTO public.brands(id, account_id, name, slug, default_currency) VALUES
    (v_a1, v_a, 'T2 A1', v_a1_slug, 'USD'),
    (v_a2, v_a, 'T2 A2', 't2-3660-a2-' || v_sfx, 'USD'),
    (v_b1, v_b, 'T2 B1', 't2-3660-b1-' || v_sfx, 'USD'),
    (v_q1, v_q, 'T2 Q1', 't2-3660-q1-' || v_sfx, 'USD'),
    (v_q2, v_q, 'T2 Q2', 't2-3660-q2-' || v_sfx, 'USD'),
    (v_pb, v_p, 'T2 PB', 't2-3660-pb-' || v_sfx, 'USD');
  -- A3 is soft-deleted further down (with triggers off), once its event exists.
  INSERT INTO public.brands(id, account_id, name, slug, default_currency)
  VALUES (v_a3, v_a, 'T2 A3', 't2-3660-a3-' || v_sfx, 'USD');

  UPDATE public.brands SET paystack_subaccount_code = 'ACCT_t2_' || left(v_sfx, 10)
   WHERE id = v_a2;
  INSERT INTO public.stripe_connect_accounts
    (brand_id, stripe_account_id, country, default_currency)
  VALUES (v_a1, 'acct_t2a1_' || left(v_sfx, 10), 'US', 'USD'),
         (v_a2, 'acct_t2a2_' || left(v_sfx, 10), 'US', 'USD');
  INSERT INTO public.brand_paystack_recipients
    (brand_id, recipient_code, bank_code, account_fingerprint,
     account_number_masked, account_name)
  VALUES (v_a2, 'RCP_t2_' || left(v_sfx, 10), '000', 'hmac-sha256:' || repeat('b', 64),
          '••••0000', 'T2 Fixture');

  INSERT INTO public.events(
    id, brand_id, created_by, title, description, slug, event_type, visibility,
    status, timezone, location_text, is_online, city, cover_media_url,
    cover_media_type, cover_media_alt, theme, published_at)
  VALUES
    (v_e_up, v_a1, v_a, 'T2 Upcoming',
     'A published upcoming event with no tickets sold, used by the tester suite.',
     v_up_slug, 'event', 'public', 'scheduled', 'America/New_York',
     'Downtown Durham', false, 'Durham',
     'https://images.example.test/t2-3660.jpg', 'image', 'People at the event',
     '{}', now());
  INSERT INTO public.events(id, brand_id, created_by, title, slug, status) VALUES
    (v_e_ended, v_a1, v_a, 'T2 Ended', 't2-3660-end-' || v_sfx, 'ended'),
    (v_e_cancelled, v_a1, v_a, 'T2 Cancelled', 't2-3660-can-' || v_sfx, 'cancelled'),
    (v_e_multi, v_a2, v_a, 'T2 Multi Date', 't2-3660-mul-' || v_sfx, 'scheduled'),
    (v_e_a3, v_a3, v_a, 'T2 On Deleted Brand', 't2-3660-a3e-' || v_sfx, 'scheduled'),
    (v_e_b1, v_b1, v_b, v_secret_title, 't2-3660-b1e-' || v_sfx, 'scheduled'),
    (v_e_q1, v_q1, v_q, 'T2 Q1 Upcoming', 't2-3660-q1e-' || v_sfx, 'scheduled');
  INSERT INTO public.event_dates(event_id, start_at, end_at) VALUES
    (v_e_up, now() + interval '5 days', now() + interval '6 days'),
    (v_e_ended, now() - interval '6 days', now() - interval '5 days'),
    (v_e_cancelled, now() + interval '9 days', now() + interval '10 days'),
    -- multi-date: the first date is over, the last is still ahead.
    (v_e_multi, now() - interval '3 days', now() - interval '2 days'),
    (v_e_multi, now() + interval '4 days', now() + interval '5 days'),
    (v_e_a3, now() + interval '5 days', now() + interval '6 days'),
    (v_e_b1, now() + interval '5 days', now() + interval '6 days'),
    (v_e_q1, now() + interval '5 days', now() + interval '6 days');

  INSERT INTO public.brand_team_members
    (brand_id, user_id, role, invited_at, accepted_at)
  VALUES
    (v_b1, v_c, 'brand_owner', now(), now()),
    (v_b1, v_m, 'event_manager', now(), now()),
    (v_b1, v_p, 'finance_manager', now(), now()),
    (v_q1, v_p, 'finance_manager', now(), now()),
    (v_q2, v_p2, 'finance_manager', now(), now());
  INSERT INTO public.partner_brand_links
    (id, partner_account_id, brand_id, invited_owner_email, accepted_at)
  VALUES
    (v_l_b1, v_p, v_b1, 't2-3660-b@example.test', now()),
    (v_l_q1, v_p, v_q1, 't2-3660-q@example.test', now()),
    (v_l_q2, v_p2, v_q2, 't2-3660-q@example.test', now()),
    -- invited, never accepted: P still owns PB.
    (v_l_pb, v_p, v_pb, 't2-3660-nobody@example.test', NULL);

  -- Money rows: deep foreign key graphs, so triggers are off for the inserts.
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.orders
    (id, event_id, buyer_email, buyer_name, total_cents, currency, payment_status, source)
  VALUES
    (gen_random_uuid(), v_e_ended, 't2-buyer@example.test', 'T2 Buyer', 2500, 'USD', 'paid', 'legacy'),
    (gen_random_uuid(), v_e_cancelled, 't2-buyer@example.test', 'T2 Buyer', 2500, 'USD', 'paid', 'legacy'),
    (v_o_multi, v_e_multi, 't2-buyer@example.test', 'T2 Buyer', 2500, 'USD', 'paid', 'legacy'),
    (gen_random_uuid(), v_e_a3, 't2-buyer@example.test', 'T2 Buyer', 2500, 'USD', 'paid', 'legacy'),
    (v_o_b1, v_e_b1, 't2-buyer@example.test', 'T2 Buyer', 2500, 'USD', 'paid', 'legacy');
  INSERT INTO public.tickets
    (id, order_id, ticket_type_id, event_id, qr_code, status, approval_status)
  VALUES
    (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), v_e_ended,
     't2-qr-' || gen_random_uuid()::text, 'valid', 'auto'),
    (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), v_e_ended,
     't2-qr-' || gen_random_uuid()::text, 'used', 'auto');
  INSERT INTO public.partner_splits
    (id, order_id, brand_id, partner_account_id, mingla_fee_cents, partner_share_cents,
     transfer_currency, stripe_application_fee_id, status)
  VALUES (v_split, gen_random_uuid(), v_q1, v_p, 100, 50, 'USD',
          'fee_t2_' || gen_random_uuid()::text, 'held');
  -- A3 was soft-deleted long before this deletion, with an event and a paid
  -- order still under it.
  UPDATE public.brands SET deleted_at = now() - interval '40 days' WHERE id = v_a3;
  -- [TEST-MOD-APPROVED #3660] rework F-1 (added by the implementor; no line of
  -- the tester's suite is removed or changed). Since the F-1 fix, a paid order
  -- with no RELEASED payout blocks on any event. The ended and the cancelled
  -- event in this fixture exist to prove that a FINISHED event's sales do not
  -- hold a Host hostage, so their orders are now marked paid out: one released
  -- payout whose items cover them. Every assertion below is unchanged.
  WITH r AS (
    INSERT INTO public.brand_payout_releases
      (id, brand_id, occurrence_key, surface, provider, currency, anchor_end_at,
       releasable_at, gross_cents, net_release_cents, status)
    VALUES (gen_random_uuid(), v_a1, 't2-3660-rel-' || gen_random_uuid()::text, 'order',
            'stripe', 'usd', date_trunc('second', now()) - interval '2 days',
            date_trunc('second', now()) - interval '1 day', 5000, 5000, 'released')
    RETURNING id)
  INSERT INTO public.payout_release_items
    (id, release_id, source_type, source_id, gross_cents, refunded_cents,
     disputed_cents, mingla_fee_cents, partner_share_cents, provider_fee_cents,
     net_cents, source_finalized_at)
  SELECT gen_random_uuid(), r.id, 'order', o.id, o.total_cents, 0, 0, 0, 0, 0,
         o.total_cents, now()
  FROM r, public.orders o
  WHERE o.event_id IN (v_e_ended, v_e_cancelled);
  SET LOCAL session_replication_role = origin;
  IF current_setting('session_replication_role') <> 'origin' THEN
    RAISE EXCEPTION 't2 3660: triggers are not live for the calls under test';
  END IF;

  -- ==========================================================================
  -- P — privilege, through real roles.
  -- ==========================================================================
  -- PUBLIC holds nothing on any of the three functions.
  IF EXISTS (
    SELECT 1
    FROM pg_proc p, aclexplode(p.proacl) a
    WHERE p.oid IN (
        'private.host_account_deletion_blockers(uuid, uuid[])'::regprocedure,
        'public.biz_delete_host_account(uuid)'::regprocedure,
        'public.biz_my_host_account_deletion_blockers()'::regprocedure)
      AND a.grantee = 0
  ) THEN
    RAISE EXCEPTION 't2 3660 P: PUBLIC holds a privilege on a host-deletion function';
  END IF;
  -- The private schema is not reachable by any API role.
  IF has_schema_privilege('anon', 'private', 'USAGE')
     OR has_schema_privilege('authenticated', 'private', 'USAGE')
     OR has_schema_privilege('service_role', 'private', 'USAGE') THEN
    RAISE EXCEPTION 't2 3660 P: an API role has USAGE on schema private';
  END IF;

  -- A signed-in Host, as the real `authenticated` role, cannot delete anybody
  -- (themselves included), and cannot call the private helper.
  PERFORM pg_temp.t2_claims('authenticated', v_a);
  SET LOCAL ROLE authenticated;
  v_raised := false;
  BEGIN
    PERFORM public.biz_delete_host_account(v_b);
  EXCEPTION WHEN insufficient_privilege THEN v_raised := true;
  END;
  IF NOT v_raised THEN
    RESET ROLE;
    RAISE EXCEPTION 't2 3660 P: authenticated ran biz_delete_host_account on another user';
  END IF;
  v_raised := false;
  BEGIN
    PERFORM public.biz_delete_host_account(v_a);
  EXCEPTION WHEN insufficient_privilege THEN v_raised := true;
  END;
  IF NOT v_raised THEN
    RESET ROLE;
    RAISE EXCEPTION 't2 3660 P: authenticated ran biz_delete_host_account on itself';
  END IF;
  v_raised := false;
  BEGIN
    PERFORM private.host_account_deletion_blockers(v_b, ARRAY[v_b1]);
  EXCEPTION WHEN insufficient_privilege THEN v_raised := true;
  END;
  IF NOT v_raised THEN
    RESET ROLE;
    RAISE EXCEPTION 't2 3660 P: authenticated reached private.host_account_deletion_blockers';
  END IF;
  RESET ROLE;

  -- anon: neither public function, nor the private helper.
  PERFORM pg_temp.t2_claims('anon', NULL);
  SET LOCAL ROLE anon;
  v_count := 0;
  BEGIN
    PERFORM public.biz_delete_host_account(v_a);
  EXCEPTION WHEN insufficient_privilege THEN v_count := v_count + 1;
  END;
  BEGIN
    PERFORM public.biz_my_host_account_deletion_blockers();
  EXCEPTION WHEN insufficient_privilege THEN v_count := v_count + 1;
  END;
  BEGIN
    PERFORM private.host_account_deletion_blockers(v_a, ARRAY[v_a1]);
  EXCEPTION WHEN insufficient_privilege THEN v_count := v_count + 1;
  END;
  RESET ROLE;
  IF v_count <> 3 THEN
    RAISE EXCEPTION 't2 3660 P: anon was refused on only % of 3 calls', v_count;
  END IF;

  -- The service role itself cannot call the private helper directly, and a
  -- service-role GRANT with a non-service claim is still refused in-function.
  PERFORM pg_temp.t2_claims('service_role', NULL);
  SET LOCAL ROLE service_role;
  v_raised := false;
  BEGIN
    PERFORM private.host_account_deletion_blockers(v_a, ARRAY[v_a1]);
  EXCEPTION WHEN insufficient_privilege THEN v_raised := true;
  END;
  RESET ROLE;
  IF NOT v_raised THEN
    RAISE EXCEPTION 't2 3660 P: service_role reached the private helper directly';
  END IF;
  PERFORM pg_temp.t2_claims('authenticated', v_a);
  SET LOCAL ROLE service_role;
  v_raised := false;
  BEGIN
    PERFORM public.biz_delete_host_account(v_a);
  EXCEPTION WHEN insufficient_privilege THEN v_raised := true;
  END;
  RESET ROLE;
  IF NOT v_raised THEN
    RAISE EXCEPTION 't2 3660 P: a non-service claim passed the in-function role check';
  END IF;
  IF EXISTS (SELECT 1 FROM public.creator_accounts
             WHERE id IN (v_a, v_b) AND deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 't2 3660 P: a refused call stamped an account';
  END IF;

  -- ==========================================================================
  -- O1 — owner of two brands, only A2 is blocked: nothing changes on either.
  --      The blocking event is multi-date (first date over, last date ahead).
  --      The ended event, the cancelled event and the already-deleted brand's
  --      event all hold paid orders and must NOT be reported.
  -- ==========================================================================
  v_before := pg_temp.t2_snap(v_a_users, v_a_brands);
  PERFORM pg_temp.t2_claims('service_role', NULL);
  SET LOCAL ROLE service_role;
  v_result := public.biz_delete_host_account(v_a);
  RESET ROLE;
  v_after := pg_temp.t2_snap(v_a_users, v_a_brands);
  IF v_result->>'status' IS DISTINCT FROM 'blocked'
     OR pg_temp.t2_codes(v_result) <> 'tickets_sold' THEN
    RAISE EXCEPTION 't2 3660 O1: expected blocked(tickets_sold), got %', v_result;
  END IF;
  IF (v_result->'blockers'->0->>'count')::integer <> 1
     OR jsonb_array_length(v_result->'blockers'->0->'items') <> 1
     OR v_result->'blockers'->0->'items'->0->>'id' <> v_e_multi::text THEN
    RAISE EXCEPTION 't2 3660 O1: the blocker must name only the multi-date event: %', v_result;
  END IF;
  IF v_before IS DISTINCT FROM v_after THEN
    RAISE EXCEPTION 't2 3660 O1: a BLOCKED deletion changed a row on one of the two brands';
  END IF;

  -- ==========================================================================
  -- L — the preview RPC answers only for the caller's own account.
  -- ==========================================================================
  -- A sees exactly what the deletion said.
  PERFORM pg_temp.t2_claims('authenticated', v_a);
  SET LOCAL ROLE authenticated;
  v_preview := public.biz_my_host_account_deletion_blockers();
  RESET ROLE;
  IF v_preview IS DISTINCT FROM v_result->'blockers' THEN
    RAISE EXCEPTION 't2 3660 L: preview (%) differs from the deletion''s answer (%)',
      v_preview, v_result->'blockers';
  END IF;
  -- B1 has a sold ticket on an upcoming event. Its co-owner and its team
  -- member are not B1's account: the preview must say nothing to them.
  PERFORM pg_temp.t2_claims('authenticated', v_c);
  SET LOCAL ROLE authenticated;
  v_preview := public.biz_my_host_account_deletion_blockers();
  RESET ROLE;
  IF v_preview <> '[]'::jsonb OR v_preview::text LIKE '%' || v_secret_title || '%' THEN
    RAISE EXCEPTION 't2 3660 L: a co-owner was shown another account''s blockers: %', v_preview;
  END IF;
  PERFORM pg_temp.t2_claims('authenticated', v_m);
  SET LOCAL ROLE authenticated;
  v_preview := public.biz_my_host_account_deletion_blockers();
  RESET ROLE;
  IF v_preview <> '[]'::jsonb THEN
    RAISE EXCEPTION 't2 3660 L: a team member was shown another account''s blockers: %', v_preview;
  END IF;
  -- and B, whose brand it is, does see it (so the two [] above mean something).
  PERFORM pg_temp.t2_claims('authenticated', v_b);
  SET LOCAL ROLE authenticated;
  v_preview := public.biz_my_host_account_deletion_blockers();
  RESET ROLE;
  IF pg_temp.t2_codes(v_preview) <> 'tickets_sold'
     OR v_preview::text NOT LIKE '%' || v_secret_title || '%' THEN
    RAISE EXCEPTION 't2 3660 L: the owner''s own preview is wrong: %', v_preview;
  END IF;

  -- ==========================================================================
  -- O2 — the buyer is refunded in full; the same owner is now deleted.
  -- ==========================================================================
  SET LOCAL session_replication_role = replica;
  UPDATE public.orders SET payment_status = 'refunded' WHERE id = v_o_multi;
  SET LOCAL session_replication_role = origin;

  SELECT md5(concat_ws('|',
    (SELECT string_agg(to_jsonb(o)::text, ',' ORDER BY o.id) FROM public.orders o
      WHERE o.event_id IN (v_e_ended, v_e_cancelled, v_e_multi, v_e_a3)),
    (SELECT string_agg(to_jsonb(t)::text, ',' ORDER BY t.id) FROM public.tickets t
      WHERE t.event_id IN (v_e_ended, v_e_cancelled, v_e_multi, v_e_a3)),
    (SELECT to_jsonb(b)::text FROM public.brands b WHERE b.id = v_a3),
    (SELECT string_agg(to_jsonb(e)::text, ',' ORDER BY e.id) FROM public.events e
      WHERE e.id IN (v_e_ended, v_e_cancelled, v_e_a3))
  )) INTO v_money_before;

  -- Falsifiability: the public readers resolve the event BEFORE the deletion.
  v_json := public.pg_public_event_by_slug(v_a1_slug, v_up_slug);
  IF v_json IS NULL OR v_json::text IN ('null', '{}', '[]') THEN
    RAISE EXCEPTION 't2 3660 fixture: event does not resolve publicly before deletion';
  END IF;
  SELECT count(*) INTO v_count FROM public.events_public_view v WHERE v.id = v_e_up;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 't2 3660 fixture: events_public_view does not list the event before deletion';
  END IF;
  PERFORM pg_temp.t2_claims('anon', NULL);
  SET LOCAL ROLE anon;
  SELECT (SELECT count(*) FROM public.brands b WHERE b.id = v_a1)
       + (SELECT count(*) FROM public.events e WHERE e.id = v_e_up) INTO v_count;
  RESET ROLE;
  IF v_count <> 2 THEN
    RAISE EXCEPTION 't2 3660 fixture: anon cannot read the brand and event before deletion (%)', v_count;
  END IF;

  PERFORM pg_temp.t2_claims('service_role', NULL);
  SET LOCAL ROLE service_role;
  v_result := public.biz_delete_host_account(v_a);
  RESET ROLE;
  IF v_result->>'status' IS DISTINCT FROM 'deleted'
     OR (v_result->>'already_deleted')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 't2 3660 O2: expected deleted, got %', v_result;
  END IF;
  -- Exactly the two LIVE brands; the long-deleted A3 is not part of it.
  IF jsonb_array_length(v_result->'brand_ids') <> 2
     OR NOT (v_result->'brand_ids' @> to_jsonb(ARRAY[v_a1, v_a2]))
     OR v_result->'brand_ids' @> to_jsonb(ARRAY[v_a3]) THEN
    RAISE EXCEPTION 't2 3660 O2: brand_ids is not exactly {A1, A2}: %', v_result;
  END IF;
  -- Exactly the two live-or-upcoming events: the zero-sale one and the
  -- multi-date one. Not the ended, cancelled or deleted-brand events.
  IF (v_result->>'events_taken_down')::integer <> 2 THEN
    RAISE EXCEPTION 't2 3660 O2: expected 2 events taken down, got %', v_result;
  END IF;
  IF (SELECT count(*) FROM public.events
       WHERE id IN (v_e_up, v_e_multi) AND deleted_at IS NOT NULL) <> 2 THEN
    RAISE EXCEPTION 't2 3660 O2: the two upcoming events were not both taken down';
  END IF;
  IF jsonb_array_length(v_result->'stripe_accounts') <> 2
     OR jsonb_array_length(v_result->'paystack_subaccounts') <> 1
     OR v_result->'paystack_subaccounts'->0->>'brand_id' <> v_a2::text THEN
    RAISE EXCEPTION 't2 3660 O2: provider lists are wrong: %', v_result;
  END IF;

  -- Ended / cancelled events, the deleted brand, and every order and ticket
  -- under them are byte-identical.
  SELECT md5(concat_ws('|',
    (SELECT string_agg(to_jsonb(o)::text, ',' ORDER BY o.id) FROM public.orders o
      WHERE o.event_id IN (v_e_ended, v_e_cancelled, v_e_multi, v_e_a3)),
    (SELECT string_agg(to_jsonb(t)::text, ',' ORDER BY t.id) FROM public.tickets t
      WHERE t.event_id IN (v_e_ended, v_e_cancelled, v_e_multi, v_e_a3)),
    (SELECT to_jsonb(b)::text FROM public.brands b WHERE b.id = v_a3),
    (SELECT string_agg(to_jsonb(e)::text, ',' ORDER BY e.id) FROM public.events e
      WHERE e.id IN (v_e_ended, v_e_cancelled, v_e_a3))
  )) INTO v_money_after;
  IF v_money_before IS DISTINCT FROM v_money_after THEN
    RAISE EXCEPTION 't2 3660 O2: an order, a ticket, a finished event or the already-deleted brand was modified';
  END IF;

  -- ==========================================================================
  -- C — consistency after the commit point.
  -- ==========================================================================
  -- One timestamp on every stamp the deletion made.
  SELECT deleted_at INTO v_ts FROM public.creator_accounts WHERE id = v_a;
  IF v_ts IS NULL
     OR EXISTS (SELECT 1 FROM public.brands WHERE id IN (v_a1, v_a2) AND deleted_at IS DISTINCT FROM v_ts)
     OR EXISTS (SELECT 1 FROM public.events WHERE id IN (v_e_up, v_e_multi) AND deleted_at IS DISTINCT FROM v_ts)
     OR EXISTS (SELECT 1 FROM public.stripe_connect_accounts
                 WHERE brand_id IN (v_a1, v_a2) AND detached_at IS DISTINCT FROM v_ts) THEN
    RAISE EXCEPTION 't2 3660 C: the deletion did not use one timestamp for every stamp';
  END IF;
  -- No orphan active rows.
  IF EXISTS (SELECT 1 FROM public.brand_paystack_recipients WHERE brand_id = v_a2 AND is_active)
     OR EXISTS (SELECT 1 FROM public.brands WHERE id = v_a2 AND paystack_subaccount_code IS NOT NULL)
     OR EXISTS (SELECT 1 FROM public.stripe_connect_accounts
                 WHERE brand_id IN (v_a1, v_a2) AND detached_at IS NULL) THEN
    RAISE EXCEPTION 't2 3660 C: an active payout row survived the deletion';
  END IF;
  IF (SELECT count(*) FROM public.audit_log
       WHERE user_id = v_a AND action = 'host_account.deleted') <> 1 THEN
    RAISE EXCEPTION 't2 3660 C: expected exactly one host_account.deleted audit row';
  END IF;
  -- The detection query for the half-deleted class returns nothing.
  IF EXISTS (
    SELECT 1 FROM public.creator_accounts ca
    WHERE ca.id = v_a AND ca.deleted_at IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.brands b
                  WHERE b.account_id = ca.id AND b.deleted_at IS NULL)
  ) THEN
    RAISE EXCEPTION 't2 3660 C: deleted account still owns a live brand';
  END IF;

  -- Public readers, beyond the two the implementor suite checks.
  v_json := public.pg_public_event_by_slug(v_a1_slug, v_up_slug);
  IF v_json IS NOT NULL AND v_json::text NOT IN ('null', '{}', '[]') THEN
    RAISE EXCEPTION 't2 3660 C: pg_public_event_by_slug still resolves: %', v_json;
  END IF;
  v_json := public.pg_public_rsvp_by_slug(v_a1_slug, v_up_slug);
  IF v_json IS NOT NULL AND v_json::text NOT IN ('null', '{}', '[]') THEN
    RAISE EXCEPTION 't2 3660 C: pg_public_rsvp_by_slug still resolves: %', v_json;
  END IF;
  SELECT (SELECT count(*) FROM public.events_public_view v WHERE v.id IN (v_e_up, v_e_multi))
       + (SELECT count(*) FROM public.business_public_events_view v
           WHERE v.brand_id IN (v_a1, v_a2))
    INTO v_count;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 't2 3660 C: a public events view still lists the deleted Host (% rows)', v_count;
  END IF;
  v_doc := public.resolve_public_search_document('/b/' || v_a1_slug);
  IF v_doc->>'state' IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 't2 3660 C: brand search document state is %, expected draft', v_doc;
  END IF;
  -- anon, through row level security on the tables themselves.
  PERFORM pg_temp.t2_claims('anon', NULL);
  SET LOCAL ROLE anon;
  SELECT (SELECT count(*) FROM public.brands b WHERE b.id IN (v_a1, v_a2))
       + (SELECT count(*) FROM public.events e WHERE e.id IN (v_e_up, v_e_multi))
    INTO v_count;
  RESET ROLE;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 't2 3660 C: anon can still read the deleted brands or their taken-down events (% rows)', v_count;
  END IF;

  -- The app's recover-on-sign-in write, made by the user through RLS, brings
  -- nothing back: zero live brands, and the public page still does not resolve.
  PERFORM pg_temp.t2_claims('authenticated', v_a);
  SET LOCAL ROLE authenticated;
  UPDATE public.creator_accounts SET deleted_at = NULL WHERE id = v_a;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 1 THEN
    RESET ROLE;
    RAISE EXCEPTION 't2 3660 C: the recover write did not apply (rows %)', v_count;
  END IF;
  SELECT count(*) INTO v_count FROM public.brands
   WHERE account_id = v_a AND deleted_at IS NULL;
  RESET ROLE;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 't2 3660 C: recover-on-sign-in brought a brand back';
  END IF;
  v_json := public.pg_public_event_by_slug(v_a1_slug, v_up_slug);
  IF v_json IS NOT NULL AND v_json::text NOT IN ('null', '{}', '[]') THEN
    RAISE EXCEPTION 't2 3660 C: the event resolves again after recover-on-sign-in';
  END IF;
  IF public.resolve_public_search_document('/b/' || v_a1_slug)->>'state' IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 't2 3660 C: the brand page resolves again after recover-on-sign-in';
  END IF;

  -- ==========================================================================
  -- O3 — a co-owner (brand_owner ROLE, not the brand's account) leaves; the
  --      brand, its account and its sold-ticket event are untouched.
  -- ==========================================================================
  v_before := pg_temp.t2_snap(ARRAY[v_b], ARRAY[v_b1]);
  SELECT to_jsonb(m)::text INTO v_money_before
  FROM public.brand_team_members m WHERE m.brand_id = v_b1 AND m.user_id = v_b;
  PERFORM pg_temp.t2_claims('service_role', NULL);
  SET LOCAL ROLE service_role;
  v_result := public.biz_delete_host_account(v_c);
  RESET ROLE;
  IF v_result->>'status' IS DISTINCT FROM 'deleted'
     OR (v_result->>'memberships_removed')::integer <> 1
     OR jsonb_array_length(v_result->'brand_ids') <> 0 THEN
    RAISE EXCEPTION 't2 3660 O3: co-owner deletion wrong: %', v_result;
  END IF;
  IF EXISTS (SELECT 1 FROM public.brand_team_members
             WHERE brand_id = v_b1 AND user_id = v_c AND removed_at IS NULL) THEN
    RAISE EXCEPTION 't2 3660 O3: the co-owner still has a live row';
  END IF;
  SELECT to_jsonb(m)::text INTO v_money_after
  FROM public.brand_team_members m WHERE m.brand_id = v_b1 AND m.user_id = v_b;
  IF v_money_before IS DISTINCT FROM v_money_after
     OR EXISTS (SELECT 1 FROM public.brands WHERE id = v_b1 AND deleted_at IS NOT NULL)
     OR EXISTS (SELECT 1 FROM public.creator_accounts WHERE id = v_b AND deleted_at IS NOT NULL)
     OR EXISTS (SELECT 1 FROM public.events WHERE id = v_e_b1 AND deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 't2 3660 O3: a co-owner''s deletion touched the brand, its account or its event';
  END IF;

  -- ==========================================================================
  -- D — partner with links on TWO brands and an unsettled split on ONE.
  -- ==========================================================================
  v_before := pg_temp.t2_snap(ARRAY[v_p], ARRAY[v_b1, v_q1, v_pb]);
  PERFORM pg_temp.t2_claims('service_role', NULL);
  SET LOCAL ROLE service_role;
  v_result := public.biz_delete_host_account(v_p);
  RESET ROLE;
  v_after := pg_temp.t2_snap(ARRAY[v_p], ARRAY[v_b1, v_q1, v_pb]);
  IF v_result->>'status' IS DISTINCT FROM 'blocked'
     OR pg_temp.t2_codes(v_result) <> 'partner_payment_in_progress' THEN
    RAISE EXCEPTION 't2 3660 D: expected blocked(partner_payment_in_progress), got %', v_result;
  END IF;
  IF v_before IS DISTINCT FROM v_after THEN
    RAISE EXCEPTION 't2 3660 D: a BLOCKED partner deletion changed a link, a membership or the partner''s own brand';
  END IF;

  -- Reference: the REAL partner_disconnect_link, called by another partner.
  SELECT to_jsonb(l) INTO v_ref_link_before FROM public.partner_brand_links l WHERE l.id = v_l_q2;
  SELECT to_jsonb(m) INTO v_ref_member_before FROM public.brand_team_members m
   WHERE m.brand_id = v_q2 AND m.user_id = v_p2;
  PERFORM pg_temp.t2_claims('authenticated', v_p2);
  SET LOCAL ROLE authenticated;
  PERFORM public.partner_disconnect_link(v_l_q2);
  RESET ROLE;
  SELECT to_jsonb(l) INTO v_ref_link_after FROM public.partner_brand_links l WHERE l.id = v_l_q2;
  SELECT to_jsonb(m) INTO v_ref_member_after FROM public.brand_team_members m
   WHERE m.brand_id = v_q2 AND m.user_id = v_p2;

  -- The split settles; the partner is deleted.
  SET LOCAL session_replication_role = replica;
  UPDATE public.partner_splits SET status = 'transferred' WHERE id = v_split;
  SET LOCAL session_replication_role = origin;
  SELECT to_jsonb(l) INTO v_del_link_before FROM public.partner_brand_links l WHERE l.id = v_l_q1;
  SELECT to_jsonb(m) INTO v_del_member_before FROM public.brand_team_members m
   WHERE m.brand_id = v_q1 AND m.user_id = v_p;
  PERFORM pg_temp.t2_claims('service_role', NULL);
  SET LOCAL ROLE service_role;
  v_result := public.biz_delete_host_account(v_p);
  RESET ROLE;
  IF v_result->>'status' IS DISTINCT FROM 'deleted'
     OR (v_result->>'partner_links_ended')::integer <> 2
     OR (v_result->>'memberships_removed')::integer <> 2 THEN
    RAISE EXCEPTION 't2 3660 D: partner deletion wrong (expected 2 links ended, 2 memberships removed): %', v_result;
  END IF;
  SELECT to_jsonb(l) INTO v_del_link_after FROM public.partner_brand_links l WHERE l.id = v_l_q1;
  SELECT to_jsonb(m) INTO v_del_member_after FROM public.brand_team_members m
   WHERE m.brand_id = v_q1 AND m.user_id = v_p;

  -- Same columns change on the link, with the same reason.
  SELECT string_agg(k, ',' ORDER BY k) INTO v_ref_changed
  FROM jsonb_object_keys(v_ref_link_after) k
  WHERE v_ref_link_after->k IS DISTINCT FROM v_ref_link_before->k;
  SELECT string_agg(k, ',' ORDER BY k) INTO v_del_changed
  FROM jsonb_object_keys(v_del_link_after) k
  WHERE v_del_link_after->k IS DISTINCT FROM v_del_link_before->k;
  IF v_ref_changed IS DISTINCT FROM v_del_changed
     OR v_ref_changed IS DISTINCT FROM 'cancelled_at,cancelled_reason' THEN
    RAISE EXCEPTION 't2 3660 D: link columns stamped differ: disconnect=(%) deletion=(%)',
      v_ref_changed, v_del_changed;
  END IF;
  IF v_del_link_after->>'cancelled_reason' IS DISTINCT FROM v_ref_link_after->>'cancelled_reason' THEN
    RAISE EXCEPTION 't2 3660 D: cancelled_reason differs: disconnect=% deletion=%',
      v_ref_link_after->>'cancelled_reason', v_del_link_after->>'cancelled_reason';
  END IF;
  -- Same columns change on the membership row.
  SELECT string_agg(k, ',' ORDER BY k) INTO v_ref_changed
  FROM jsonb_object_keys(v_ref_member_after) k
  WHERE v_ref_member_after->k IS DISTINCT FROM v_ref_member_before->k;
  SELECT string_agg(k, ',' ORDER BY k) INTO v_del_changed
  FROM jsonb_object_keys(v_del_member_after) k
  WHERE v_del_member_after->k IS DISTINCT FROM v_del_member_before->k;
  IF v_ref_changed IS DISTINCT FROM v_del_changed OR v_ref_changed IS NULL THEN
    RAISE EXCEPTION 't2 3660 D: membership columns stamped differ: disconnect=(%) deletion=(%)',
      v_ref_changed, v_del_changed;
  END IF;
  -- Atomic dual-stamp: link and membership carry the SAME instant, on both links.
  IF (SELECT count(*) FROM public.partner_brand_links l
       JOIN public.brand_team_members m
         ON m.brand_id = l.brand_id AND m.user_id = l.partner_account_id
      WHERE l.id IN (v_l_b1, v_l_q1)
        AND l.cancelled_at IS NOT NULL
        AND l.cancelled_at = m.removed_at) <> 2 THEN
    RAISE EXCEPTION 't2 3660 D: link and membership are not stamped with one instant on both brands';
  END IF;
  -- Same audit row shape as the real disconnect, one per link.
  IF (SELECT count(*) FROM public.audit_log a
       WHERE a.action = 'partner_link_disconnected'
         AND a.target_type = 'partner_brand_link'
         AND a.user_id = v_p
         AND a.after->>'reason' = 'partner_disconnected'
         AND ((a.target_id = v_l_b1::text AND a.brand_id = v_b1)
           OR (a.target_id = v_l_q1::text AND a.brand_id = v_q1))) <> 2 THEN
    RAISE EXCEPTION 't2 3660 D: the deletion did not write one disconnect audit row per link';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.audit_log a
    WHERE a.action = 'partner_link_disconnected'
      AND a.target_type = 'partner_brand_link'
      AND a.user_id = v_p2 AND a.brand_id = v_q2
      AND a.target_id = v_l_q2::text
      AND a.after->>'reason' = 'partner_disconnected'
  ) THEN
    RAISE EXCEPTION 't2 3660 D: reference disconnect audit row not found (the comparison would be empty)';
  END IF;
  -- The brand the partner still owned (PB) went with the account.
  IF NOT EXISTS (SELECT 1 FROM public.brands WHERE id = v_pb AND deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 't2 3660 D: the partner''s own brand was not deleted';
  END IF;
  -- Q1 and B1 themselves are untouched by a partner leaving.
  IF EXISTS (SELECT 1 FROM public.brands WHERE id IN (v_q1, v_b1) AND deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 't2 3660 D: a partner''s deletion deleted somebody else''s brand';
  END IF;

  -- ==========================================================================
  -- O4 — the owner goes first, then a member of the (now deleted) brand.
  -- ==========================================================================
  SET LOCAL session_replication_role = replica;
  UPDATE public.orders SET payment_status = 'refunded' WHERE id = v_o_b1;
  SET LOCAL session_replication_role = origin;
  PERFORM pg_temp.t2_claims('service_role', NULL);
  SET LOCAL ROLE service_role;
  v_result := public.biz_delete_host_account(v_b);
  RESET ROLE;
  IF v_result->>'status' IS DISTINCT FROM 'deleted' THEN
    RAISE EXCEPTION 't2 3660 O4: owner deletion wrong: %', v_result;
  END IF;
  -- The owner's own row stays (the guard's rule), and so does the member's.
  IF NOT EXISTS (SELECT 1 FROM public.brand_team_members
                 WHERE brand_id = v_b1 AND user_id = v_m AND removed_at IS NULL) THEN
    RAISE EXCEPTION 't2 3660 O4: an owner''s deletion removed somebody else''s membership row';
  END IF;
  -- The member can still delete their own account afterwards.
  SET LOCAL ROLE service_role;
  v_result := public.biz_delete_host_account(v_m);
  RESET ROLE;
  IF v_result->>'status' IS DISTINCT FROM 'deleted'
     OR (v_result->>'memberships_removed')::integer <> 1 THEN
    RAISE EXCEPTION 't2 3660 O4: member of a deleted brand could not be deleted: %', v_result;
  END IF;

  -- ==========================================================================
  -- G — the two pre-existing guards still refuse a signed-in owner (RLS path).
  -- ==========================================================================
  PERFORM pg_temp.t2_claims('authenticated', v_q);
  SET LOCAL ROLE authenticated;
  v_raised := false;
  BEGIN
    UPDATE public.brands SET deleted_at = now() WHERE id = v_q1;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'brand_delete_blocked_by_events:%' THEN
      RESET ROLE;
      RAISE EXCEPTION 't2 3660 G: wrong error deleting a brand with an upcoming event: %', SQLERRM;
    END IF;
    v_raised := true;
  END;
  RESET ROLE;
  IF NOT v_raised
     OR EXISTS (SELECT 1 FROM public.brands WHERE id = v_q1 AND deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 't2 3660 G: issue_2063_guard_brand_soft_delete no longer refuses the owner';
  END IF;
  PERFORM pg_temp.t2_claims('authenticated', v_q);
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE public.brand_team_members SET removed_at = now()
     WHERE brand_id = v_q1 AND user_id = v_q;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'cannot_remove_brand_account' THEN
      RESET ROLE;
      RAISE EXCEPTION 't2 3660 G: wrong error removing the brand account''s own row: %', SQLERRM;
    END IF;
  END;
  RESET ROLE;
  IF NOT EXISTS (SELECT 1 FROM public.brand_team_members
                 WHERE brand_id = v_q1 AND user_id = v_q AND removed_at IS NULL) THEN
    RAISE EXCEPTION 't2 3660 G: the brand account''s own team row was removed';
  END IF;

  IF current_setting('app.allow_brand_owner_transfer', true) = 'on' THEN
    RAISE EXCEPTION 't2 3660 G: app.allow_brand_owner_transfer is armed after the deletions';
  END IF;

  RAISE NOTICE 'issue_3660 host account deletion tester2 edges and privilege PASS';
END;
$$;

ROLLBACK;
