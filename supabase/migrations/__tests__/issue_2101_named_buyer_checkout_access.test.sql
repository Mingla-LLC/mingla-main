-- issue #2101 [named-buyer checkout] — PostgreSQL 17 contract suite.
--
-- Runs against the REAL applied schema. Every check RAISEs on failure, so the
-- psql exit code is the verdict.
--
-- Amendment 2 §A2.1 requires a LIVE-CATALOG assertion that fails closed on
-- incompatible drift. The migration-apply base image ships the pre-GoTrue
-- `auth.users` stub, so this suite PROVISIONS the four GoTrue-managed columns
-- first (the same thing #873 and #1529 do) and then proves the eligible-identity
-- predicate agrees, row for row, with the literal-column form.

\set ON_ERROR_STOP on

-- The four GoTrue-managed columns are provisioned by the workflow step that
-- precedes this file, as `supabase_auth_admin` — `auth.users` is not owned by
-- the `postgres` role this suite connects as. Same shape as #873 / #1529.

DO $$
DECLARE v_missing text;
BEGIN
  -- T-01 live-catalog assertion — fail CLOSED on incompatible drift.
  SELECT string_agg(c.expected, ', ') INTO v_missing
  FROM (VALUES
    ('deleted_at','timestamp with time zone'),
    ('is_anonymous','boolean'),
    ('banned_until','timestamp with time zone'),
    ('confirmed_at','timestamp with time zone')
  ) AS c(expected, expected_type)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns col
    WHERE col.table_schema='auth' AND col.table_name='users'
      AND col.column_name=c.expected AND col.data_type=c.expected_type
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'T-01 FAILED: auth.users drift — missing/incompatible: %', v_missing;
  END IF;
  RAISE NOTICE 'T-01 PASS: auth.users carries the four GoTrue columns with expected types';
END $$;

-- ── Fixture. ────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_owner uuid := '00000000-0000-4000-8000-000000000001';
  v_buyer uuid := '00000000-0000-4000-8000-000000000002';
  v_other uuid := '00000000-0000-4000-8000-000000000003';
  v_account uuid;
  v_brand uuid;
  v_event uuid;
BEGIN
  INSERT INTO auth.users(id, email, confirmed_at)
  VALUES (v_owner,'owner@issue2101.test',now()),
         (v_buyer,'buyer@issue2101.test',now()),
         (v_other,'other@issue2101.test',now())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles(id, email, username, display_name, active, visibility_mode)
  VALUES (v_owner,'owner@issue2101.test','i2101owner','Owner',true,'public'),
         (v_buyer,'buyer@issue2101.test','i2101buyer','Buyer',true,'public'),
         (v_other,'other@issue2101.test','i2101other','Other',true,'public')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.creator_accounts(id, email, display_name)
  VALUES (v_owner,'owner@issue2101.test','Owner') ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.brands(id, account_id, name, slug, default_currency)
  VALUES (gen_random_uuid(), v_owner, 'Issue 2101 Brand', 'issue-2101-brand-'||substr(gen_random_uuid()::text,1,8), 'USD')
  RETURNING id INTO v_brand;

  INSERT INTO public.events(id, brand_id, title, slug, description, status, visibility, event_type, created_by)
  VALUES (gen_random_uuid(), v_brand, 'Issue 2101 Event', 'issue-2101-event-'||substr(gen_random_uuid()::text,1,8), 'fixture',
          'scheduled', 'public', 'event', v_owner)
  RETURNING id INTO v_event;

  CREATE TEMP TABLE issue_2101_fixture(owner uuid, buyer uuid, other uuid, brand uuid, event uuid);
  INSERT INTO issue_2101_fixture VALUES (v_owner, v_buyer, v_other, v_brand, v_event);
END $$;

-- ── T-02 default is unrestricted with NO policy row. ───────────────────────
DO $$
DECLARE f record; v text;
BEGIN
  SELECT * INTO f FROM issue_2101_fixture;
  v := public.issue_2101_ticket_checkout_access_decision(f.event, NULL);
  IF v <> 'allowed_unrestricted' THEN
    RAISE EXCEPTION 'T-02 FAILED: anonymous, no policy row -> % (expected allowed_unrestricted)', v;
  END IF;
  v := public.issue_2101_ticket_checkout_access_decision(f.event, f.buyer);
  IF v <> 'allowed_unrestricted' THEN
    RAISE EXCEPTION 'T-02 FAILED: authenticated, no policy row -> %', v;
  END IF;
  IF (public.pg_public_ticket_checkout_access_state(f.event)->>'state') <> 'unrestricted' THEN
    RAISE EXCEPTION 'T-02 FAILED: advisory state is not unrestricted with no policy row';
  END IF;
  RAISE NOTICE 'T-02 PASS: absent policy row is byte-compatible legacy behaviour';
END $$;

-- ── T-03 explicit unrestricted parity. ─────────────────────────────────────
DO $$
DECLARE f record; v text;
BEGIN
  SELECT * INTO f FROM issue_2101_fixture;
  INSERT INTO public.event_ticket_checkout_access(event_id,brand_id,mode)
  VALUES (f.event, f.brand, 'unrestricted');
  v := public.issue_2101_ticket_checkout_access_decision(f.event, NULL);
  IF v <> 'allowed_unrestricted' THEN
    RAISE EXCEPTION 'T-03 FAILED: explicit unrestricted -> %', v;
  END IF;
  RAISE NOTICE 'T-03 PASS: explicit unrestricted matches the absent-row default';
END $$;

-- ── T-04 named mode: anonymous, member, non-member. ────────────────────────
DO $$
DECLARE f record; v text;
BEGIN
  SELECT * INTO f FROM issue_2101_fixture;
  UPDATE public.event_ticket_checkout_access
    SET mode='named_buyers', restrictive_epoch=restrictive_epoch+1,
        config_revision=config_revision+1
    WHERE event_id=f.event;

  v := public.issue_2101_ticket_checkout_access_decision(f.event, NULL);
  IF v <> 'sign_in_required' THEN
    RAISE EXCEPTION 'T-04 FAILED: anonymous under named_buyers -> % (expected sign_in_required)', v;
  END IF;

  v := public.issue_2101_ticket_checkout_access_decision(f.event, f.other);
  IF v <> 'checkout_restricted' THEN
    RAISE EXCEPTION 'T-04 FAILED: non-member -> % (expected checkout_restricted)', v;
  END IF;

  INSERT INTO public.event_ticket_checkout_allowed_buyers(event_id, buyer_user_id, added_by)
  VALUES (f.event, f.buyer, f.owner);

  v := public.issue_2101_ticket_checkout_access_decision(f.event, f.buyer);
  IF v <> 'allowed_named' THEN
    RAISE EXCEPTION 'T-04 FAILED: allowed member -> % (expected allowed_named)', v;
  END IF;
  RAISE NOTICE 'T-04 PASS: anonymous / non-member / member all resolve exactly';
END $$;

-- ── T-05 identity truth: soft delete, hard delete, ban, anonymity,
--        unconfirmed, inactive profile. Each must deny, and the answer must be
--        the SAME bounded code as a plain non-member. ─────────────────────────
DO $$
DECLARE f record; v text;
BEGIN
  SELECT * INTO f FROM issue_2101_fixture;

  UPDATE auth.users SET deleted_at=now() WHERE id=f.buyer;
  v := public.issue_2101_ticket_checkout_access_decision(f.event, f.buyer);
  IF v <> 'checkout_restricted' THEN RAISE EXCEPTION 'T-05 FAILED: soft-deleted -> %', v; END IF;
  UPDATE auth.users SET deleted_at=NULL WHERE id=f.buyer;

  UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id=f.buyer;
  v := public.issue_2101_ticket_checkout_access_decision(f.event, f.buyer);
  IF v <> 'checkout_restricted' THEN RAISE EXCEPTION 'T-05 FAILED: banned -> %', v; END IF;
  UPDATE auth.users SET banned_until=NULL WHERE id=f.buyer;

  UPDATE auth.users SET is_anonymous=true WHERE id=f.buyer;
  v := public.issue_2101_ticket_checkout_access_decision(f.event, f.buyer);
  IF v <> 'checkout_restricted' THEN RAISE EXCEPTION 'T-05 FAILED: anonymous identity -> %', v; END IF;
  UPDATE auth.users SET is_anonymous=false WHERE id=f.buyer;

  UPDATE auth.users SET confirmed_at=NULL WHERE id=f.buyer;
  v := public.issue_2101_ticket_checkout_access_decision(f.event, f.buyer);
  IF v <> 'checkout_restricted' THEN RAISE EXCEPTION 'T-05 FAILED: unconfirmed -> %', v; END IF;
  UPDATE auth.users SET confirmed_at=now() WHERE id=f.buyer;

  UPDATE public.profiles SET active=false WHERE id=f.buyer;
  v := public.issue_2101_ticket_checkout_access_decision(f.event, f.buyer);
  IF v <> 'checkout_restricted' THEN RAISE EXCEPTION 'T-05 FAILED: inactive profile -> %', v; END IF;
  UPDATE public.profiles SET active=true WHERE id=f.buyer;

  -- and the owner counterparty must be eligible too
  UPDATE auth.users SET deleted_at=now() WHERE id=f.owner;
  v := public.issue_2101_ticket_checkout_access_decision(f.event, f.buyer);
  IF v <> 'checkout_restricted' THEN RAISE EXCEPTION 'T-05 FAILED: deleted owner -> %', v; END IF;
  UPDATE auth.users SET deleted_at=NULL WHERE id=f.owner;

  IF public.issue_2101_ticket_checkout_access_decision(f.event, f.buyer) <> 'allowed_named' THEN
    RAISE EXCEPTION 'T-05 FAILED: restore did not return to allowed_named';
  END IF;
  RAISE NOTICE 'T-05 PASS: every identity failure denies, and restore re-allows';
END $$;

-- ── T-06 the to_jsonb access path agrees with the literal-column form. ─────
DO $$
DECLARE f record; v_json boolean; v_literal boolean;
BEGIN
  SELECT * INTO f FROM issue_2101_fixture;
  FOR v_json IN SELECT true LOOP EXIT; END LOOP;
  SELECT public.issue_2101_eligible_identity(f.buyer) INTO v_json;
  SELECT EXISTS (
    SELECT 1 FROM auth.users u JOIN public.profiles p ON p.id=u.id
    WHERE u.id=f.buyer AND u.deleted_at IS NULL
      AND COALESCE(u.is_anonymous,false)=false
      AND (u.banned_until IS NULL OR u.banned_until<=now())
      AND u.confirmed_at IS NOT NULL AND p.active IS TRUE
  ) INTO v_literal;
  IF v_json IS DISTINCT FROM v_literal THEN
    RAISE EXCEPTION 'T-06 FAILED: to_jsonb path % vs literal-column path %', v_json, v_literal;
  END IF;
  UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id=f.buyer;
  SELECT public.issue_2101_eligible_identity(f.buyer) INTO v_json;
  SELECT EXISTS (
    SELECT 1 FROM auth.users u JOIN public.profiles p ON p.id=u.id
    WHERE u.id=f.buyer AND u.deleted_at IS NULL
      AND COALESCE(u.is_anonymous,false)=false
      AND (u.banned_until IS NULL OR u.banned_until<=now())
      AND u.confirmed_at IS NOT NULL AND p.active IS TRUE
  ) INTO v_literal;
  IF v_json IS DISTINCT FROM v_literal OR v_json THEN
    RAISE EXCEPTION 'T-06 FAILED (banned): % vs %', v_json, v_literal;
  END IF;
  UPDATE auth.users SET banned_until=NULL WHERE id=f.buyer;
  RAISE NOTICE 'T-06 PASS: the catalog-tolerant access path is byte-equivalent';
END $$;

-- ── T-07 bidirectional block against the CURRENT brand owner. ──────────────
DO $$
DECLARE f record; v text;
BEGIN
  SELECT * INTO f FROM issue_2101_fixture;
  INSERT INTO public.blocked_users(blocker_id, blocked_id) VALUES (f.owner, f.buyer);
  v := public.issue_2101_ticket_checkout_access_decision(f.event, f.buyer);
  IF v <> 'checkout_restricted' THEN RAISE EXCEPTION 'T-07 FAILED: owner-blocks-buyer -> %', v; END IF;
  DELETE FROM public.blocked_users WHERE blocker_id=f.owner AND blocked_id=f.buyer;

  INSERT INTO public.blocked_users(blocker_id, blocked_id) VALUES (f.buyer, f.owner);
  v := public.issue_2101_ticket_checkout_access_decision(f.event, f.buyer);
  IF v <> 'checkout_restricted' THEN RAISE EXCEPTION 'T-07 FAILED: buyer-blocks-owner -> %', v; END IF;
  DELETE FROM public.blocked_users WHERE blocker_id=f.buyer AND blocked_id=f.owner;

  IF public.issue_2101_ticket_checkout_access_decision(f.event, f.buyer) <> 'allowed_named' THEN
    RAISE EXCEPTION 'T-07 FAILED: unblocking did not restore eligibility';
  END IF;
  RAISE NOTICE 'T-07 PASS: both block directions deny; unblock restores';
END $$;

-- ── T-08 snapshot continuation and the restrictive epoch. ──────────────────
DO $$
DECLARE f record; snap jsonb; v text; v_epoch bigint;
BEGIN
  SELECT * INTO f FROM issue_2101_fixture;
  snap := public.issue_2101_current_access_snapshot(f.event, f.buyer);
  v := public.issue_2101_ticket_checkout_access_decision(
    f.event, f.buyer, snap->>'mode', (snap->>'restrictiveEpoch')::bigint,
    (snap->>'membershipId')::uuid, (snap->>'membershipEpoch')::bigint);
  IF v <> 'allowed_named' THEN RAISE EXCEPTION 'T-08 FAILED: fresh snapshot -> %', v; END IF;

  -- a stale UNRESTRICTED snapshot must not survive the restrictive transition
  v := public.issue_2101_ticket_checkout_access_decision(
    f.event, f.buyer, 'unrestricted', 0, NULL, NULL);
  IF v <> 'snapshot_stale' THEN RAISE EXCEPTION 'T-08 FAILED: stale unrestricted snapshot -> %', v; END IF;

  -- removing the buyer advances ONLY that membership epoch
  UPDATE public.event_ticket_checkout_allowed_buyers
    SET membership_epoch=membership_epoch+1 WHERE event_id=f.event AND buyer_user_id=f.buyer;
  v := public.issue_2101_ticket_checkout_access_decision(
    f.event, f.buyer, snap->>'mode', (snap->>'restrictiveEpoch')::bigint,
    (snap->>'membershipId')::uuid, (snap->>'membershipEpoch')::bigint);
  IF v <> 'snapshot_stale' THEN RAISE EXCEPTION 'T-08 FAILED: advanced membership epoch -> %', v; END IF;
  RAISE NOTICE 'T-08 PASS: continuation CAS is exact on both counters';
END $$;

-- ── T-09 removal makes the buyer ineligible; re-add restores. ──────────────
DO $$
DECLARE f record; v text;
BEGIN
  SELECT * INTO f FROM issue_2101_fixture;
  UPDATE public.event_ticket_checkout_allowed_buyers
    SET removed_at=now(), removed_by=f.owner WHERE event_id=f.event AND buyer_user_id=f.buyer;
  v := public.issue_2101_ticket_checkout_access_decision(f.event, f.buyer);
  IF v <> 'checkout_restricted' THEN RAISE EXCEPTION 'T-09 FAILED: removed member -> %', v; END IF;
  UPDATE public.event_ticket_checkout_allowed_buyers
    SET removed_at=NULL, removed_by=NULL WHERE event_id=f.event AND buyer_user_id=f.buyer;
  IF public.issue_2101_ticket_checkout_access_decision(f.event, f.buyer) <> 'allowed_named' THEN
    RAISE EXCEPTION 'T-09 FAILED: re-add did not restore';
  END IF;
  RAISE NOTICE 'T-09 PASS: soft removal denies, re-add restores';
END $$;

-- ── T-10 the public advisory read is bounded and leaks nothing. ────────────
DO $$
DECLARE f record; payload jsonb;
BEGIN
  SELECT * INTO f FROM issue_2101_fixture;
  payload := public.pg_public_ticket_checkout_access_state(f.event);
  IF payload IS NULL THEN RAISE EXCEPTION 'T-10 FAILED: advisory returned NULL for a public event'; END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(payload)) <> 3 THEN
    RAISE EXCEPTION 'T-10 FAILED: advisory payload has % keys, expected exactly 3', (SELECT count(*) FROM jsonb_object_keys(payload));
  END IF;
  IF payload ? 'members' OR payload ? 'configRevision' OR payload ? 'restrictiveEpoch'
     OR payload ? 'membershipId' OR payload ? 'count' THEN
    RAISE EXCEPTION 'T-10 FAILED: advisory leaks a membership fact: %', payload;
  END IF;
  IF public.pg_public_ticket_checkout_access_state(gen_random_uuid()) IS NOT NULL THEN
    RAISE EXCEPTION 'T-10 FAILED: advisory returned a payload for an unreachable event';
  END IF;
  RAISE NOTICE 'T-10 PASS: advisory is bounded to schemaVersion/mode/state';
END $$;

-- ── T-11 ACL: the decision is service-only, the advisory is public,
--        the tables have NO direct grants, and RLS is enabled. ──────────────
DO $$
DECLARE v_bad text;
BEGIN
  SELECT string_agg(format('%s->%s', p.proname, r.rolname), ', ') INTO v_bad
  FROM pg_proc p
  CROSS JOIN (VALUES ('anon'),('authenticated')) AS r(rolname)
  WHERE p.proname='issue_2101_ticket_checkout_access_decision'
    AND has_function_privilege(r.rolname, p.oid, 'EXECUTE');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'T-11 FAILED: the sole decision owner is executable by %', v_bad;
  END IF;

  IF NOT has_function_privilege('anon',
    'public.pg_public_ticket_checkout_access_state(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'T-11 FAILED: the public advisory is not executable by anon';
  END IF;

  SELECT string_agg(format('%s/%s', t.tbl, r.rolname), ', ') INTO v_bad
  FROM (VALUES ('event_ticket_checkout_access'),
               ('event_ticket_checkout_allowed_buyers'),
               ('event_ticket_checkout_access_audit')) AS t(tbl)
  CROSS JOIN (VALUES ('anon'),('authenticated'),('service_role')) AS r(rolname)
  WHERE has_table_privilege(r.rolname, 'public.'||t.tbl, 'SELECT')
     OR has_table_privilege(r.rolname, 'public.'||t.tbl, 'INSERT')
     OR has_table_privilege(r.rolname, 'public.'||t.tbl, 'UPDATE')
     OR has_table_privilege(r.rolname, 'public.'||t.tbl, 'DELETE');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'T-11 FAILED: direct table privilege granted: %', v_bad;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_class
    WHERE relname IN ('event_ticket_checkout_access',
                      'event_ticket_checkout_allowed_buyers',
                      'event_ticket_checkout_access_audit')
      AND relkind='r' AND NOT relrowsecurity
  ) THEN
    RAISE EXCEPTION 'T-11 FAILED: RLS is not enabled on all three tables';
  END IF;
  RAISE NOTICE 'T-11 PASS: ACLs and RLS are exactly as the contract binds them';
END $$;

-- ── T-12 the audit table is append-only by TRIGGER, not only by grants. ────
DO $$
DECLARE f record; v_ok boolean := false;
BEGIN
  SELECT * INTO f FROM issue_2101_fixture;
  INSERT INTO public.event_ticket_checkout_access_audit(
    request_id,event_id,brand_id,actor_user_id,action,outcome,payload_fingerprint,result_snapshot)
  VALUES (gen_random_uuid(), f.event, f.brand, f.owner, 'set_mode', 'changed', 'fp', '{}'::jsonb);
  BEGIN
    UPDATE public.event_ticket_checkout_access_audit SET outcome='noop' WHERE event_id=f.event;
  EXCEPTION WHEN OTHERS THEN v_ok := true;
  END;
  IF NOT v_ok THEN RAISE EXCEPTION 'T-12 FAILED: audit UPDATE was permitted'; END IF;
  v_ok := false;
  BEGIN
    DELETE FROM public.event_ticket_checkout_access_audit WHERE event_id=f.event;
  EXCEPTION WHEN OTHERS THEN v_ok := true;
  END;
  IF NOT v_ok THEN RAISE EXCEPTION 'T-12 FAILED: audit DELETE was permitted'; END IF;
  RAISE NOTICE 'T-12 PASS: audit rejects UPDATE and DELETE by trigger';
END $$;

-- ── T-13 the brand-owner transfer guard blocks while a named checkout is
--        active, and permits the transfer once nothing is active. ───────────
DO $$
DECLARE f record; v_blocked boolean := false; v_session uuid;
BEGIN
  SELECT * INTO f FROM issue_2101_fixture;
  INSERT INTO public.creator_accounts(id, email, display_name)
  VALUES (f.other,'other@issue2101.test','Other') ON CONFLICT (id) DO NOTHING;

  -- ORCH-1081's immutability trigger owns the ordinary path; the sanctioned
  -- transfer writers set this GUC. #2101's guard sits BESIDE it and is NOT
  -- bypassed by it — that separation is what T-13 proves.
  PERFORM set_config('app.allow_brand_owner_transfer', 'on', true);

  -- no active checkout -> the transfer succeeds
  UPDATE public.brands SET account_id=f.other WHERE id=f.brand;
  UPDATE public.brands SET account_id=f.owner WHERE id=f.brand;

  INSERT INTO public.ticket_checkout_sessions(
    id,event_id,brand_id,buyer_user_id,buyer_name,buyer_email,buyer_phone_e164,
    total_cents,currency,status,idempotency_key,expires_at)
  VALUES (gen_random_uuid(), f.event, f.brand, f.buyer, 'Buyer','buyer@issue2101.test',
    '+15551234567', 2500, 'USD', 'requires_payment', 'issue-2101-t13-'||substr(gen_random_uuid()::text,1,8), now()+interval '10 minutes')
  RETURNING id INTO v_session;

  BEGIN
    UPDATE public.brands SET account_id=f.other WHERE id=f.brand;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%ACTIVE_CHECKOUTS_BLOCK_OWNER_TRANSFER%' THEN RAISE; END IF;
    v_blocked := true;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'T-13 FAILED: owner transfer succeeded while a named checkout was active';
  END IF;

  UPDATE public.ticket_checkout_sessions SET status='failed', expires_at=now()-interval '1 minute'
    WHERE id=v_session;
  PERFORM set_config('app.allow_brand_owner_transfer', 'on', true);
  UPDATE public.brands SET account_id=f.other WHERE id=f.brand;
  UPDATE public.brands SET account_id=f.owner WHERE id=f.brand;
  DELETE FROM public.ticket_checkout_sessions WHERE id=v_session;
  RAISE NOTICE 'T-13 PASS: transfer blocked while active, permitted once terminal';
END $$;

-- ── T-14 the active-checkout predicate and its restrictive gate. ───────────
DO $$
DECLARE f record; v_session uuid;
BEGIN
  SELECT * INTO f FROM issue_2101_fixture;
  IF public.issue_2101_event_has_active_ticket_checkout(f.event) THEN
    RAISE EXCEPTION 'T-14 FAILED: a clean event reports an active checkout';
  END IF;
  INSERT INTO public.ticket_checkout_sessions(
    id,event_id,brand_id,buyer_user_id,buyer_name,buyer_email,buyer_phone_e164,
    total_cents,currency,status,idempotency_key,expires_at)
  VALUES (gen_random_uuid(), f.event, f.brand, f.buyer, 'Buyer','buyer@issue2101.test',
    '+15551234567', 2500, 'USD', 'processing_payment', 'issue-2101-t14-'||substr(gen_random_uuid()::text,1,8), now()+interval '10 minutes')
  RETURNING id INTO v_session;
  IF NOT public.issue_2101_event_has_active_ticket_checkout(f.event) THEN
    RAISE EXCEPTION 'T-14 FAILED: a nonterminal session is not reported active';
  END IF;
  UPDATE public.ticket_checkout_sessions SET status='failed' WHERE id=v_session;
  IF public.issue_2101_event_has_active_ticket_checkout(f.event) THEN
    RAISE EXCEPTION 'T-14 FAILED: a terminal session still reports active';
  END IF;
  DELETE FROM public.ticket_checkout_sessions WHERE id=v_session;
  RAISE NOTICE 'T-14 PASS: the exact nonterminal set drives the restrictive gate';
END $$;

-- ── T-15 snapshot columns exist on both truth tables. ──────────────────────
DO $$
DECLARE v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM information_schema.columns
  WHERE table_schema='public'
    AND table_name IN ('ticket_checkout_sessions','ticket_checkout_provider_attempts')
    AND column_name IN ('checkout_access_mode_snapshot',
                        'checkout_access_restrictive_epoch_snapshot',
                        'checkout_access_membership_id_snapshot',
                        'checkout_access_membership_epoch_snapshot');
  IF v_count <> 8 THEN
    RAISE EXCEPTION 'T-15 FAILED: expected 8 snapshot columns, found %', v_count;
  END IF;
  RAISE NOTICE 'T-15 PASS: session and attempt both carry the four snapshots';
END $$;

-- ── T-16 the sole decision owner is VOLATILE (it takes row locks). ─────────
DO $$
BEGIN
  IF (SELECT provolatile FROM pg_proc
      WHERE proname='issue_2101_ticket_checkout_access_decision') <> 'v' THEN
    RAISE EXCEPTION 'T-16 FAILED: the decision owner is not VOLATILE';
  END IF;
  IF (SELECT provolatile FROM pg_proc
      WHERE proname='issue_1930_ticket_session_authorized') <> 'v' THEN
    RAISE EXCEPTION 'T-16 FAILED: issue_1930_ticket_session_authorized is not VOLATILE';
  END IF;
  IF (SELECT provolatile FROM pg_proc
      WHERE proname='pg_public_ticket_checkout_access_state') <> 's' THEN
    RAISE EXCEPTION 'T-16 FAILED: the public advisory is not STABLE/nonlocking';
  END IF;
  RAISE NOTICE 'T-16 PASS: volatility matches the locking contract';
END $$;

-- ── T-17 #2079's five-argument late-reversal authority is preserved. ───────
DO $$
DECLARE v_args text;
BEGIN
  SELECT pg_get_function_identity_arguments(oid) INTO v_args
  FROM pg_proc WHERE proname='issue_1930_mint_ticket_late_reversal';
  IF v_args <> 'p_checkout_session_id uuid, p_provider text, p_payment_reference text, p_paystack_transaction_id text, p_stripe_charge_id text' THEN
    RAISE EXCEPTION 'T-17 FAILED: the #2079 reversal signature changed: %', v_args;
  END IF;
  IF (SELECT count(*) FROM pg_proc WHERE proname='issue_1930_mint_ticket_late_reversal') <> 1 THEN
    RAISE EXCEPTION 'T-17 FAILED: a second late-reversal overload exists';
  END IF;
  RAISE NOTICE 'T-17 PASS: #2079 remains the sole late-reversal authority';
END $$;

SELECT 'issue #2101 PostgreSQL contract suite: ALL CHECKS PASSED' AS verdict;
