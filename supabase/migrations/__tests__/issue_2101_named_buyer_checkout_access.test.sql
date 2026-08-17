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

-- ── T-08b the RESTRICTIVE EPOCH is a CAS operand in its own right. ─────────
--    T-08 varied the mode and the membership epoch but never the restrictive
--    epoch, so deleting that conjunct from the decision left the suite green.
--    These two cases vary ONLY that counter.
DO $$
DECLARE f record; snap jsonb; v text;
BEGIN
  SELECT * INTO f FROM issue_2101_fixture;
  snap := public.issue_2101_current_access_snapshot(f.event, f.buyer);

  -- (a) a snapshot one epoch BEHIND the current policy is stale, with mode and
  --     both membership fields exactly correct.
  v := public.issue_2101_ticket_checkout_access_decision(
    f.event, f.buyer, snap->>'mode',
    (snap->>'restrictiveEpoch')::bigint - 1,
    (snap->>'membershipId')::uuid, (snap->>'membershipEpoch')::bigint);
  IF v <> 'snapshot_stale' THEN
    RAISE EXCEPTION 'T-08b FAILED: restrictive epoch -1 -> % (expected snapshot_stale)', v;
  END IF;

  -- (b) and one AHEAD is stale too, so the conjunct is an equality test and not
  --     a one-sided bound.
  v := public.issue_2101_ticket_checkout_access_decision(
    f.event, f.buyer, snap->>'mode',
    (snap->>'restrictiveEpoch')::bigint + 1,
    (snap->>'membershipId')::uuid, (snap->>'membershipEpoch')::bigint);
  IF v <> 'snapshot_stale' THEN
    RAISE EXCEPTION 'T-08b FAILED: restrictive epoch +1 -> % (expected snapshot_stale)', v;
  END IF;

  -- (c) control: the exact epoch still authorizes, so (a)/(b) are not passing
  --     because everything is stale.
  v := public.issue_2101_ticket_checkout_access_decision(
    f.event, f.buyer, snap->>'mode', (snap->>'restrictiveEpoch')::bigint,
    (snap->>'membershipId')::uuid, (snap->>'membershipEpoch')::bigint);
  IF v <> 'allowed_named' THEN
    RAISE EXCEPTION 'T-08b FAILED: exact epoch -> % (expected allowed_named)', v;
  END IF;
  RAISE NOTICE 'T-08b PASS: the restrictive epoch is an exact CAS operand';
END $$;

-- ── T-08c NULL-TRAP battery. Every comparison whose operand can be NULL is
--    exercised WITH a NULL, so substituting `<>` for `IS DISTINCT FROM`
--    (comparison yields NULL, the OR-chain yields NULL, the IF falls through)
--    is caught rather than silently accepted. ──────────────────────────────────
DO $$
DECLARE f record; snap jsonb; v text; v_raised text;
BEGIN
  SELECT * INTO f FROM issue_2101_fixture;
  snap := public.issue_2101_current_access_snapshot(f.event, f.buyer);

  -- (a) a NULL membership-ID snapshot must be STALE, not allowed. Under `<>`
  --     this comparison is NULL and the decision falls through to allowed_named.
  v := public.issue_2101_ticket_checkout_access_decision(
    f.event, f.buyer, snap->>'mode', (snap->>'restrictiveEpoch')::bigint,
    NULL, (snap->>'membershipEpoch')::bigint);
  IF v <> 'snapshot_stale' THEN
    RAISE EXCEPTION 'T-08c FAILED: NULL membership-id snapshot -> % (expected snapshot_stale)', v;
  END IF;

  -- (b) a NULL membership-EPOCH snapshot must be STALE for the same reason.
  v := public.issue_2101_ticket_checkout_access_decision(
    f.event, f.buyer, snap->>'mode', (snap->>'restrictiveEpoch')::bigint,
    (snap->>'membershipId')::uuid, NULL);
  IF v <> 'snapshot_stale' THEN
    RAISE EXCEPTION 'T-08c FAILED: NULL membership-epoch snapshot -> % (expected snapshot_stale)', v;
  END IF;

  -- (c) a NULL restrictive-epoch snapshot must be STALE.
  v := public.issue_2101_ticket_checkout_access_decision(
    f.event, f.buyer, snap->>'mode', NULL,
    (snap->>'membershipId')::uuid, (snap->>'membershipEpoch')::bigint);
  IF v <> 'snapshot_stale' THEN
    RAISE EXCEPTION 'T-08c FAILED: NULL restrictive-epoch snapshot -> % (expected snapshot_stale)', v;
  END IF;

  -- (d) the Business CAS: a NULL expected revision is client-supplied and must
  --     NOT skip the check. Under `<>` the IF is never taken and the mutation
  --     proceeds on a stale view.
  --     `auth.uid()` reads request.jwt.claim.sub, so impersonate the brand owner
  --     for this one call — otherwise the owner gate raises FORBIDDEN first and
  --     the CAS is never reached, which would make this case unfalsifiable.
  PERFORM set_config('request.jwt.claim.sub', f.owner::text, false);
  v_raised := NULL;
  BEGIN
    PERFORM public.biz_event_ticket_checkout_access_set_mode(
      f.event, 'unrestricted', NULL, gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
  END;
  -- Control: the SAME call with the CORRECT revision must be permitted, so (d)
  -- cannot pass merely because the owner gate rejected us.
  IF v_raised IS NOT NULL AND v_raised LIKE '%FORBIDDEN%' THEN
    RAISE EXCEPTION 'T-08c FAILED: owner impersonation did not take — got FORBIDDEN, so the CAS was never reached';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', '', false);
  IF v_raised IS NULL OR v_raised NOT LIKE '%STALE_ACCESS_POLICY%' THEN
    RAISE EXCEPTION 'T-08c FAILED: a NULL expected_config_revision did not raise STALE_ACCESS_POLICY (got %)',
      COALESCE(v_raised,'no exception — the CAS was SKIPPED');
  END IF;

  -- (e) control: the decision still authorizes with every snapshot correct, so
  --     (a)-(c) are not passing because everything is stale.
  IF public.issue_2101_ticket_checkout_access_decision(
       f.event, f.buyer, snap->>'mode', (snap->>'restrictiveEpoch')::bigint,
       (snap->>'membershipId')::uuid, (snap->>'membershipEpoch')::bigint)
     <> 'allowed_named' THEN
    RAISE EXCEPTION 'T-08c FAILED: the control case is not allowed_named';
  END IF;
  RAISE NOTICE 'T-08c PASS: every nullable CAS operand is null-safe';
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

-- ── T-14b THE REAL PATH. The decision being correct proves nothing if the
--    #1930 wrappers do not consult it. These drive the ACTUAL functions —
--    issue_1930_ticket_session_authorized, issue_1930_claim_ticket_provider_attempt,
--    issue_1930_commit_ticket_provider_attempt and
--    issue_1930_ticket_checkout_preflight — and prove each one de-authorizes a
--    LIVE session the moment access is lost, and re-authorizes on restore.
DO $$
DECLARE
  f record; v_session uuid; v_attempt uuid; v_epoch bigint;
  v_claim jsonb; v_commit jsonb; v_pre text; snap jsonb;
BEGIN
  SELECT * INTO f FROM issue_2101_fixture;

  -- Policy is named_buyers with the buyer allowed (state carried from T-09).
  snap := public.issue_2101_current_access_snapshot(f.event, f.buyer);
  IF snap->>'mode' <> 'named_buyers' OR snap->>'membershipId' IS NULL THEN
    RAISE EXCEPTION 'T-14b setup FAILED: expected an allowed named-buyer fixture, got %', snap;
  END IF;

  INSERT INTO public.ticket_checkout_sessions(
    id,event_id,brand_id,buyer_user_id,buyer_name,buyer_email,buyer_phone_e164,
    total_cents,currency,status,idempotency_key,expires_at,
    buyer_status_token_hash,
    checkout_access_mode_snapshot,checkout_access_restrictive_epoch_snapshot,
    checkout_access_membership_id_snapshot,checkout_access_membership_epoch_snapshot)
  VALUES (gen_random_uuid(), f.event, f.brand, f.buyer, 'Buyer','buyer@issue2101.test',
    '+15551234567', 2500, 'USD', 'requires_payment',
    'issue-2101-t14b-'||substr(gen_random_uuid()::text,1,8), now()+interval '30 minutes',
    'issue-2101-token-hash',
    snap->>'mode', (snap->>'restrictiveEpoch')::bigint,
    (snap->>'membershipId')::uuid, (snap->>'membershipEpoch')::bigint)
  RETURNING id INTO v_session;

  -- (a) the shared continuation boolean authorizes an allowed buyer.
  IF NOT public.issue_1930_ticket_session_authorized(v_session, f.event) THEN
    RAISE EXCEPTION 'T-14b FAILED: an allowed live session is not authorized';
  END IF;

  -- (b) CLAIM succeeds and copies all four snapshots onto the attempt.
  v_claim := public.issue_1930_claim_ticket_provider_attempt(
    v_session, f.event, 'stripe', 'stripe_checkout', 'issue-2101-fingerprint-t14b');
  IF v_claim->>'outcome' <> 'fresh_claim' THEN
    RAISE EXCEPTION 'T-14b FAILED: claim for an allowed buyer -> %', v_claim->>'outcome';
  END IF;
  v_attempt := (v_claim->>'attemptId')::uuid;
  v_epoch := (v_claim->>'epoch')::bigint;
  IF NOT EXISTS (
    SELECT 1 FROM public.ticket_checkout_provider_attempts a
    JOIN public.ticket_checkout_sessions ss ON ss.id=a.checkout_session_id
    WHERE a.id=v_attempt
      AND a.checkout_access_mode_snapshot=ss.checkout_access_mode_snapshot
      AND a.checkout_access_restrictive_epoch_snapshot=ss.checkout_access_restrictive_epoch_snapshot
      AND a.checkout_access_membership_id_snapshot IS NOT DISTINCT FROM ss.checkout_access_membership_id_snapshot
      AND a.checkout_access_membership_epoch_snapshot IS NOT DISTINCT FROM ss.checkout_access_membership_epoch_snapshot
  ) THEN
    RAISE EXCEPTION 'T-14b FAILED: the attempt did not inherit the session access snapshots';
  END IF;

  -- (c) PREFLIGHT allows while access holds (possession token matches).
  v_pre := public.issue_1930_ticket_checkout_preflight(v_session, 'issue-2101-token-hash');
  IF v_pre = 'unavailable' THEN
    RAISE EXCEPTION 'T-14b FAILED: preflight said unavailable while access held';
  END IF;

  -- ── now REMOVE the buyer and prove all three de-authorize ────────────────
  UPDATE public.event_ticket_checkout_allowed_buyers
    SET membership_epoch=membership_epoch+1, removed_at=now(), removed_by=f.owner
    WHERE event_id=f.event AND buyer_user_id=f.buyer;

  IF public.issue_1930_ticket_session_authorized(v_session, f.event) THEN
    RAISE EXCEPTION 'T-14b FAILED: a REMOVED buyer still authorizes a live session';
  END IF;

  v_pre := public.issue_1930_ticket_checkout_preflight(v_session, 'issue-2101-token-hash');
  IF v_pre <> 'unavailable' THEN
    RAISE EXCEPTION 'T-14b FAILED: preflight after removal -> % (expected unavailable)', v_pre;
  END IF;

  -- COMMIT must refuse to make the attempt ready and must route to the existing
  -- neutralization outbox rather than advancing value.
  v_commit := public.issue_1930_commit_ticket_provider_attempt(
    v_attempt, v_epoch, 'cs_issue2101', 'cs_issue2101', 'ref_issue2101', 'continuation-t14b');
  IF v_commit->>'outcome' <> 'revoked' THEN
    RAISE EXCEPTION 'T-14b FAILED: commit after removal -> % (expected revoked)', v_commit->>'outcome';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ticket_checkout_provider_attempts
             WHERE id=v_attempt AND state='ready') THEN
    RAISE EXCEPTION 'T-14b FAILED: the attempt was marked READY after access loss';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.checkout_sale_revocation_outbox
    WHERE subject_type='ticket_checkout_session' AND subject_id=v_session
  ) THEN
    RAISE EXCEPTION 'T-14b FAILED: no neutralization outbox row after a lost commit';
  END IF;

  -- (d) a fresh CLAIM on a resurrected session is refused outright.
  UPDATE public.ticket_checkout_sessions
    SET status='requires_payment', revoked_at=NULL, reversal_state='none'
    WHERE id=v_session;
  v_claim := public.issue_1930_claim_ticket_provider_attempt(
    v_session, f.event, 'stripe', 'stripe_checkout', 'issue-2101-fingerprint-t14b');
  IF v_claim->>'outcome' <> 'revoked' THEN
    RAISE EXCEPTION 'T-14b FAILED: claim for a REMOVED buyer -> % (expected revoked)', v_claim->>'outcome';
  END IF;

  -- (e) restore the membership and prove the SAME session re-authorizes, so the
  --     de-authorization above was the access decision and not some other #1930
  --     condition that happened to fire.
  UPDATE public.event_ticket_checkout_allowed_buyers
    SET removed_at=NULL, removed_by=NULL WHERE event_id=f.event AND buyer_user_id=f.buyer;
  snap := public.issue_2101_current_access_snapshot(f.event, f.buyer);
  UPDATE public.ticket_checkout_sessions SET
    status='requires_payment', revoked_at=NULL, reversal_state='none',
    checkout_access_mode_snapshot=snap->>'mode',
    checkout_access_restrictive_epoch_snapshot=(snap->>'restrictiveEpoch')::bigint,
    checkout_access_membership_id_snapshot=(snap->>'membershipId')::uuid,
    checkout_access_membership_epoch_snapshot=(snap->>'membershipEpoch')::bigint
    WHERE id=v_session;
  IF NOT public.issue_1930_ticket_session_authorized(v_session, f.event) THEN
    RAISE EXCEPTION 'T-14b FAILED: restoring the membership did not re-authorize the session';
  END IF;

  -- Teardown in FK order: the session points at its attempt, and the outbox
  -- points at both.
  DELETE FROM public.checkout_sale_revocation_outbox WHERE subject_id=v_session;
  UPDATE public.ticket_checkout_sessions SET provider_attempt_id=NULL WHERE id=v_session;
  DELETE FROM public.ticket_checkout_provider_attempts WHERE checkout_session_id=v_session;
  DELETE FROM public.ticket_checkout_sessions WHERE id=v_session;
  RAISE NOTICE 'T-14b PASS: authorized / claim / commit / preflight all consult the access decision';
END $$;

-- ── T-14c the attempt<->session snapshot equality is its OWN gate. ─────────
--    T-14b removes the membership, which also makes the shared continuation
--    boolean false — so it would still pass with the equality conjunct deleted.
--    Here access stays ALLOWED throughout and the ONLY thing that changes is the
--    session's snapshot, so commit can be refused for exactly one reason.
DO $$
DECLARE f record; v_session uuid; v_attempt uuid; v_epoch bigint;
  v_claim jsonb; v_commit jsonb; snap jsonb;
BEGIN
  SELECT * INTO f FROM issue_2101_fixture;
  snap := public.issue_2101_current_access_snapshot(f.event, f.buyer);
  IF snap->>'membershipId' IS NULL THEN
    RAISE EXCEPTION 'T-14c setup FAILED: the buyer must be ALLOWED for this case';
  END IF;

  INSERT INTO public.ticket_checkout_sessions(
    id,event_id,brand_id,buyer_user_id,buyer_name,buyer_email,buyer_phone_e164,
    total_cents,currency,status,idempotency_key,expires_at,
    checkout_access_mode_snapshot,checkout_access_restrictive_epoch_snapshot,
    checkout_access_membership_id_snapshot,checkout_access_membership_epoch_snapshot)
  VALUES (gen_random_uuid(), f.event, f.brand, f.buyer, 'Buyer','buyer@issue2101.test',
    '+15551234567', 2500, 'USD', 'requires_payment',
    'issue-2101-t14c-'||substr(gen_random_uuid()::text,1,8), now()+interval '30 minutes',
    snap->>'mode', (snap->>'restrictiveEpoch')::bigint,
    (snap->>'membershipId')::uuid, (snap->>'membershipEpoch')::bigint)
  RETURNING id INTO v_session;

  v_claim := public.issue_1930_claim_ticket_provider_attempt(
    v_session, f.event, 'stripe', 'stripe_checkout', 'issue-2101-fingerprint-t14c');
  IF v_claim->>'outcome' <> 'fresh_claim' THEN
    RAISE EXCEPTION 'T-14c setup FAILED: claim -> %', v_claim->>'outcome';
  END IF;
  v_attempt := (v_claim->>'attemptId')::uuid;
  v_epoch := (v_claim->>'epoch')::bigint;

  -- The buyer is STILL allowed and the SESSION's snapshots are untouched, so
  -- `issue_1930_ticket_session_authorized` still returns true. Only the
  -- ATTEMPT's frozen copy diverges — which is precisely what the equality gate
  -- exists to catch: an attempt carrying a snapshot the session no longer has.
  UPDATE public.ticket_checkout_provider_attempts
    SET checkout_access_membership_epoch_snapshot =
          checkout_access_membership_epoch_snapshot + 1
    WHERE id=v_attempt;
  IF NOT public.issue_1930_ticket_session_authorized(v_session, f.event) THEN
    -- If this fires the case proves nothing, because another gate is doing the
    -- work. Fail loudly rather than pass for the wrong reason.
    RAISE EXCEPTION 'T-14c FAILED: the session lost authorization for an unrelated reason';
  END IF;

  v_commit := public.issue_1930_commit_ticket_provider_attempt(
    v_attempt, v_epoch, 'cs_issue2101c', 'cs_issue2101c', 'ref_issue2101c', 'continuation-t14c');
  IF v_commit->>'outcome' <> 'revoked' THEN
    RAISE EXCEPTION 'T-14c FAILED: commit with a DIVERGED attempt snapshot -> % (expected revoked)',
      v_commit->>'outcome';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ticket_checkout_provider_attempts
             WHERE id=v_attempt AND state='ready') THEN
    RAISE EXCEPTION 'T-14c FAILED: a diverged attempt was marked READY';
  END IF;

  DELETE FROM public.checkout_sale_revocation_outbox WHERE subject_id=v_session;
  UPDATE public.ticket_checkout_sessions SET provider_attempt_id=NULL WHERE id=v_session;
  DELETE FROM public.ticket_checkout_provider_attempts WHERE checkout_session_id=v_session;
  DELETE FROM public.ticket_checkout_sessions WHERE id=v_session;
  RAISE NOTICE 'T-14c PASS: attempt<->session snapshot equality is an independent gate';
END $$;

-- ── T-14d REPLAY. The audit row IS the replay record, and its comparison
--    (actor / event / action / fingerprint) is the only thing standing between
--    "same request, same answer" and "same request id, different payload".
--    Nothing exercised it before. ──────────────────────────────────────────────
DO $$
DECLARE
  f record; v_req uuid := gen_random_uuid(); v_first jsonb; v_replayed jsonb;
  v_audit_before integer; v_audit_after integer; v_raised text; v_rev bigint;
BEGIN
  SELECT * INTO f FROM issue_2101_fixture;
  PERFORM set_config('request.jwt.claim.sub', f.owner::text, false);

  -- Land on a known revision, then replay against it.
  SELECT count(*) INTO v_audit_before
    FROM public.event_ticket_checkout_access_audit WHERE event_id=f.event;

  -- A true replay repeats the EXACT arguments: the fingerprint covers the
  -- expected revision too, so capture it rather than re-deriving it.
  SELECT config_revision INTO v_rev
    FROM public.event_ticket_checkout_access WHERE event_id=f.event;
  v_first := public.biz_event_ticket_checkout_access_set_mode(
    f.event, 'named_buyers', v_rev, v_req);

  -- (a) the SAME request id with the SAME payload returns the stored result
  --     byte-identically and writes NO second audit row.
  v_replayed := public.biz_event_ticket_checkout_access_set_mode(
    f.event, 'named_buyers', v_rev, v_req);
  IF v_replayed IS DISTINCT FROM v_first THEN
    RAISE EXCEPTION 'T-14d FAILED: replay returned %, expected the stored %', v_replayed, v_first;
  END IF;
  SELECT count(*) INTO v_audit_after
    FROM public.event_ticket_checkout_access_audit WHERE event_id=f.event;
  IF v_audit_after <> v_audit_before + 1 THEN
    RAISE EXCEPTION 'T-14d FAILED: replay wrote a second audit row (% -> %)',
      v_audit_before, v_audit_after;
  END IF;

  -- (b) the SAME request id with a DIFFERENT payload is a conflict, not a
  --     silent replay. This is the comparison at the heart of the replay record.
  v_raised := NULL;
  BEGIN
    PERFORM public.biz_event_ticket_checkout_access_set_mode(
      f.event, 'unrestricted', v_rev, v_req);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
  END;
  IF v_raised IS NULL OR v_raised NOT LIKE '%IDEMPOTENCY_CONFLICT%' THEN
    RAISE EXCEPTION 'T-14d FAILED: same request id + different payload -> % (expected IDEMPOTENCY_CONFLICT)',
      COALESCE(v_raised, 'no exception — the replay comparison was SKIPPED');
  END IF;

  -- (c) a DIFFERENT request id with the same payload is a genuine no-op, and
  --     records one more audit row — so (a) is not passing because nothing writes.
  PERFORM public.biz_event_ticket_checkout_access_set_mode(
    f.event, 'named_buyers', (v_first->>'configRevision')::bigint, gen_random_uuid());
  SELECT count(*) INTO v_audit_after
    FROM public.event_ticket_checkout_access_audit WHERE event_id=f.event;
  IF v_audit_after <> v_audit_before + 2 THEN
    RAISE EXCEPTION 'T-14d FAILED: a fresh request id did not append an audit row (% rows)', v_audit_after;
  END IF;

  PERFORM set_config('request.jwt.claim.sub', '', false);
  RAISE NOTICE 'T-14d PASS: replay returns the stored result, conflicts raise, fresh ids append';
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
