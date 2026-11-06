-- Issue #4283 — tester adversarial suite for the one-active-row rule in
-- accept_invite_and_transfer_brand_ownership. Different angles from the
-- implementor's sibling (*.implementor.pg17.test.sql):
--
-- T1 'leave' owner handover. The acceptor has a REMOVED brand_owner row from
--    long ago AND a more recent REMOVED brand_admin row. The recent admin row
--    is revived as owner; the ancient owner row stays removed with its
--    role / accepted_at / removed_at byte-identical. The prior owner's active
--    row is retired, the prior owner's own old removed row is untouched.
--    Invitation flips to accepted; both audit rows are written.
-- T2 'stay' owner handover. The acceptor has two removed rows with the SAME
--    accepted_at (tie): the id DESC tie-break picks one, the other is
--    untouched. The prior owner stays as brand_admin on the SAME row id; the
--    prior owner's old removed row stays removed. Demotion audit row written.
-- T3 the acceptor is ALREADY the brand's active brand_owner and also has an
--    old removed brand_admin row. Accepting an owner invite leaves the owner
--    row exactly as it was (same id, same accepted_at, no demotion) and does
--    NOT revive the removed row. No handover audit row (no other owner).
-- T4 refusals keep their codes and change nothing: P0002 already-used,
--    P0003 expired, P0005 revoked, P0007 declined, P0004 email mismatch.
--    The acceptor's removed history row is untouched after every refusal.
-- G  after all cases: every tester brand has exactly ONE active brand_owner
--    and it belongs to brands.account_id; no stray rows were inserted.
--
-- Fails on the pre-#4283 body (20270822003259): T1 and T3 raise 23505 on
-- idx_brand_team_members_brand_user_active; T2 revives both tied rows (23505).
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
VALUES
  ('00000000-4283-4000-8000-000000007001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'issue4283t-o1@example.test', now(), now()),
  ('00000000-4283-4000-8000-000000007002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'issue4283t-x1@example.test', now(), now()),
  ('00000000-4283-4000-8000-000000007003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'issue4283t-o2@example.test', now(), now()),
  ('00000000-4283-4000-8000-000000007004', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'issue4283t-x2@example.test', now(), now()),
  ('00000000-4283-4000-8000-000000007005', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'issue4283t-s@example.test', now(), now()),
  ('00000000-4283-4000-8000-000000007006', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'issue4283t-e@example.test', now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.creator_accounts (id, created_at)
VALUES
  ('00000000-4283-4000-8000-000000007001', now()),
  ('00000000-4283-4000-8000-000000007002', now()),
  ('00000000-4283-4000-8000-000000007003', now()),
  ('00000000-4283-4000-8000-000000007004', now()),
  ('00000000-4283-4000-8000-000000007005', now()),
  ('00000000-4283-4000-8000-000000007006', now())
ON CONFLICT (id) DO NOTHING;

-- The brands insert trigger gives each account_id an active brand_owner row.
INSERT INTO public.brands (id, account_id, name, slug, created_at, updated_at)
VALUES
  ('00000000-4283-4000-8000-000000007101', '00000000-4283-4000-8000-000000007001',
   'Issue 4283 T1', 'issue4283t1', now(), now()),
  ('00000000-4283-4000-8000-000000007102', '00000000-4283-4000-8000-000000007003',
   'Issue 4283 T2', 'issue4283t2', now(), now()),
  ('00000000-4283-4000-8000-000000007103', '00000000-4283-4000-8000-000000007005',
   'Issue 4283 T3', 'issue4283t3', now(), now()),
  ('00000000-4283-4000-8000-000000007104', '00000000-4283-4000-8000-000000007001',
   'Issue 4283 T4', 'issue4283t4', now(), now());

INSERT INTO public.brand_team_members
  (id, brand_id, user_id, role, invited_at, accepted_at, removed_at)
VALUES
  -- T1 acceptor X1: an ancient owner stint, then a recent admin stint.
  ('00000000-4283-4000-8000-0000000071a1', '00000000-4283-4000-8000-000000007101',
   '00000000-4283-4000-8000-000000007002', 'brand_owner',
   '2025-01-01 00:00:00+00', '2025-01-01 00:00:00+00', '2025-02-01 00:00:00+00'),
  ('00000000-4283-4000-8000-0000000071a2', '00000000-4283-4000-8000-000000007101',
   '00000000-4283-4000-8000-000000007002', 'brand_admin',
   now() - interval '3 hours', now() - interval '3 hours', now() - interval '2 hours'),
  -- T1 prior owner O1: an old removed stint that must stay untouched.
  ('00000000-4283-4000-8000-0000000071a3', '00000000-4283-4000-8000-000000007101',
   '00000000-4283-4000-8000-000000007001', 'scanner',
   '2025-03-01 00:00:00+00', '2025-03-01 00:00:00+00', '2025-04-01 00:00:00+00'),
  -- T2 acceptor X2: two removed rows with the SAME accepted_at (tie).
  ('00000000-4283-4000-8000-0000000071b1', '00000000-4283-4000-8000-000000007102',
   '00000000-4283-4000-8000-000000007004', 'scanner',
   '2026-06-01 00:00:00+00', '2026-06-01 00:00:00+00', '2026-06-02 00:00:00+00'),
  ('00000000-4283-4000-8000-0000000071b2', '00000000-4283-4000-8000-000000007102',
   '00000000-4283-4000-8000-000000007004', 'event_manager',
   '2026-06-01 00:00:00+00', '2026-06-01 00:00:00+00', '2026-06-03 00:00:00+00'),
  -- T2 prior owner O2: an old removed stint.
  ('00000000-4283-4000-8000-0000000071b3', '00000000-4283-4000-8000-000000007102',
   '00000000-4283-4000-8000-000000007003', 'event_manager',
   '2025-05-01 00:00:00+00', '2025-05-01 00:00:00+00', '2025-05-02 00:00:00+00'),
  -- T3 current owner S: an old removed admin stint.
  ('00000000-4283-4000-8000-0000000071c1', '00000000-4283-4000-8000-000000007103',
   '00000000-4283-4000-8000-000000007005', 'brand_admin',
   now() - interval '30 days', now() - interval '30 days', now() - interval '20 days'),
  -- T4 acceptor E: a removed stint that refusals must not touch.
  ('00000000-4283-4000-8000-0000000071d1', '00000000-4283-4000-8000-000000007104',
   '00000000-4283-4000-8000-000000007006', 'brand_admin',
   '2026-01-01 00:00:00+00', '2026-01-01 00:00:00+00', '2026-01-02 00:00:00+00');

INSERT INTO public.brand_invitations (
  brand_id, email, role, invited_by, token_hash, expires_at, status, outgoing_disposition
)
VALUES
  ('00000000-4283-4000-8000-000000007101', 'issue4283t-x1@example.test', 'brand_owner',
   '00000000-4283-4000-8000-000000007001', '4283tester-T1', now() + interval '7 days', 'pending', 'leave'),
  ('00000000-4283-4000-8000-000000007102', 'ISSUE4283T-X2@example.test', 'brand_owner',
   '00000000-4283-4000-8000-000000007003', '4283tester-T2', now() + interval '7 days', 'pending', 'stay'),
  ('00000000-4283-4000-8000-000000007103', 'issue4283t-s@example.test', 'brand_owner',
   '00000000-4283-4000-8000-000000007005', '4283tester-T3', now() + interval '7 days', 'pending', 'leave'),
  ('00000000-4283-4000-8000-000000007104', 'issue4283t-e@example.test', 'brand_admin',
   '00000000-4283-4000-8000-000000007001', '4283tester-T4-used', now() + interval '7 days', 'accepted', 'leave'),
  ('00000000-4283-4000-8000-000000007104', 'issue4283t-e@example.test', 'brand_admin',
   '00000000-4283-4000-8000-000000007001', '4283tester-T4-expired', now() - interval '1 minute', 'pending', 'leave'),
  ('00000000-4283-4000-8000-000000007104', 'issue4283t-e@example.test', 'brand_admin',
   '00000000-4283-4000-8000-000000007001', '4283tester-T4-revoked', now() + interval '7 days', 'revoked', 'leave'),
  ('00000000-4283-4000-8000-000000007104', 'issue4283t-e@example.test', 'brand_admin',
   '00000000-4283-4000-8000-000000007001', '4283tester-T4-declined', now() + interval '7 days', 'declined', 'leave'),
  ('00000000-4283-4000-8000-000000007104', 'someone-else-4283t@example.test', 'brand_owner',
   '00000000-4283-4000-8000-000000007001', '4283tester-T4-mismatch', now() + interval '7 days', 'pending', 'leave');

-- Snapshot every tester row before any accept, to prove history is untouched.
CREATE TEMP TABLE t4283_before ON COMMIT DROP AS
  SELECT m.id, m.brand_id, m.user_id, m.role, m.invited_at, m.accepted_at, m.removed_at
  FROM public.brand_team_members m
  WHERE m.brand_id IN ('00000000-4283-4000-8000-000000007101', '00000000-4283-4000-8000-000000007102',
                       '00000000-4283-4000-8000-000000007103', '00000000-4283-4000-8000-000000007104');

-- T1 -----------------------------------------------------------------------
DO $$
DECLARE
  v_result jsonb;
  v_brand constant uuid := '00000000-4283-4000-8000-000000007101';
  v_x1 constant uuid := '00000000-4283-4000-8000-000000007002';
  v_o1 constant uuid := '00000000-4283-4000-8000-000000007001';
  v_n integer;
  v_id uuid;
  v_role text;
  v_inv record;
BEGIN
  BEGIN
    v_result := public.accept_invite_and_transfer_brand_ownership('4283tester-T1', v_x1);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'ISSUE-4283-T T1 FAIL: leave handover to an acceptor with a removed owner + removed admin row hit 23505 (%)', SQLERRM;
  END;
  IF v_result->>'transferred' IS DISTINCT FROM 'true' OR v_result->>'outgoing_disposition' IS DISTINCT FROM 'leave' THEN
    RAISE EXCEPTION 'ISSUE-4283-T T1 FAIL: result % want transferred=true disposition=leave', v_result;
  END IF;

  SELECT count(*) INTO v_n FROM public.brand_team_members
    WHERE brand_id = v_brand AND user_id = v_x1 AND removed_at IS NULL;
  IF v_n <> 1 THEN RAISE EXCEPTION 'ISSUE-4283-T T1 FAIL: acceptor has % active rows want 1', v_n; END IF;
  SELECT id, role INTO v_id, v_role FROM public.brand_team_members
    WHERE brand_id = v_brand AND user_id = v_x1 AND removed_at IS NULL;
  IF v_id <> '00000000-4283-4000-8000-0000000071a2' OR v_role <> 'brand_owner' THEN
    RAISE EXCEPTION 'ISSUE-4283-T T1 FAIL: active row %/% want the RECENT admin row 71a2 as brand_owner (not the ancient owner row)', v_id, v_role;
  END IF;
  SELECT count(*) INTO v_n FROM public.brand_team_members WHERE brand_id = v_brand AND user_id = v_x1;
  IF v_n <> 2 THEN RAISE EXCEPTION 'ISSUE-4283-T T1 FAIL: acceptor has % rows want 2 (nothing inserted)', v_n; END IF;

  -- Ancient owner row: byte-identical history.
  IF NOT EXISTS (
    SELECT 1 FROM public.brand_team_members m JOIN t4283_before b USING (id)
    WHERE m.id = '00000000-4283-4000-8000-0000000071a1'
      AND m.role = b.role AND m.accepted_at = b.accepted_at AND m.removed_at = b.removed_at
      AND m.invited_at = b.invited_at
  ) THEN
    RAISE EXCEPTION 'ISSUE-4283-T T1 FAIL: the ancient removed brand_owner row 71a1 was modified';
  END IF;

  -- Prior owner left: no active row; their old stint untouched.
  SELECT count(*) INTO v_n FROM public.brand_team_members
    WHERE brand_id = v_brand AND user_id = v_o1 AND removed_at IS NULL;
  IF v_n <> 0 THEN RAISE EXCEPTION 'ISSUE-4283-T T1 FAIL: prior owner still has % active rows under leave', v_n; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.brand_team_members m JOIN t4283_before b USING (id)
    WHERE m.id = '00000000-4283-4000-8000-0000000071a3'
      AND m.role = b.role AND m.accepted_at = b.accepted_at AND m.removed_at = b.removed_at
  ) THEN
    RAISE EXCEPTION 'ISSUE-4283-T T1 FAIL: the prior owner''s old removed row 71a3 was modified';
  END IF;

  SELECT * INTO v_inv FROM public.brand_invitations WHERE token_hash = '4283tester-T1';
  IF v_inv.status <> 'accepted' OR v_inv.accepted_by_account_id IS DISTINCT FROM v_x1 OR v_inv.accepted_at IS NULL THEN
    RAISE EXCEPTION 'ISSUE-4283-T T1 FAIL: invitation status=% accepted_by=% want accepted by acceptor', v_inv.status, v_inv.accepted_by_account_id;
  END IF;
  IF (SELECT account_id FROM public.brands WHERE id = v_brand) IS DISTINCT FROM v_x1 THEN
    RAISE EXCEPTION 'ISSUE-4283-T T1 FAIL: brands.account_id did not move to the acceptor';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.audit_log WHERE brand_id = v_brand AND action = 'brand_ownership_transferred'
                   AND target_id = v_inv.id::text AND user_id = v_x1) THEN
    RAISE EXCEPTION 'ISSUE-4283-T T1 FAIL: no brand_ownership_transferred audit row (swallowed by the audit EXCEPTION block?)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.audit_log WHERE brand_id = v_brand AND action = 'brand_owner_removed_on_handover'
                   AND target_id = v_o1::text) THEN
    RAISE EXCEPTION 'ISSUE-4283-T T1 FAIL: no brand_owner_removed_on_handover audit row for the prior owner';
  END IF;
  RAISE NOTICE 'ISSUE-4283-T T1 OK: leave handover revived the most recent row only; history and audit intact';
END $$;

-- T2 -----------------------------------------------------------------------
DO $$
DECLARE
  v_result jsonb;
  v_brand constant uuid := '00000000-4283-4000-8000-000000007102';
  v_x2 constant uuid := '00000000-4283-4000-8000-000000007004';
  v_o2 constant uuid := '00000000-4283-4000-8000-000000007003';
  v_o2_row_before uuid;
  v_n integer;
  v_id uuid;
  v_role text;
BEGIN
  SELECT id INTO v_o2_row_before FROM public.brand_team_members
    WHERE brand_id = v_brand AND user_id = v_o2 AND removed_at IS NULL;
  BEGIN
    v_result := public.accept_invite_and_transfer_brand_ownership('4283tester-T2', v_x2);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'ISSUE-4283-T T2 FAIL: stay handover to an acceptor with two tied removed rows hit 23505 (%)', SQLERRM;
  END;
  IF v_result->>'outgoing_disposition' IS DISTINCT FROM 'stay' THEN
    RAISE EXCEPTION 'ISSUE-4283-T T2 FAIL: disposition % want stay', v_result->>'outgoing_disposition';
  END IF;

  SELECT count(*) INTO v_n FROM public.brand_team_members
    WHERE brand_id = v_brand AND user_id = v_x2 AND removed_at IS NULL;
  IF v_n <> 1 THEN RAISE EXCEPTION 'ISSUE-4283-T T2 FAIL: acceptor has % active rows want 1', v_n; END IF;
  SELECT id, role INTO v_id, v_role FROM public.brand_team_members
    WHERE brand_id = v_brand AND user_id = v_x2 AND removed_at IS NULL;
  IF v_id <> '00000000-4283-4000-8000-0000000071b2' OR v_role <> 'brand_owner' THEN
    RAISE EXCEPTION 'ISSUE-4283-T T2 FAIL: active row %/% want 71b2 (id DESC tie-break) as brand_owner', v_id, v_role;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.brand_team_members m JOIN t4283_before b USING (id)
    WHERE m.id = '00000000-4283-4000-8000-0000000071b1'
      AND m.role = b.role AND m.accepted_at = b.accepted_at AND m.removed_at = b.removed_at
  ) THEN
    RAISE EXCEPTION 'ISSUE-4283-T T2 FAIL: the tie-losing removed row 71b1 was modified';
  END IF;

  -- Prior owner stays as admin on the SAME row; old stint untouched.
  SELECT id, role INTO v_id, v_role FROM public.brand_team_members
    WHERE brand_id = v_brand AND user_id = v_o2 AND removed_at IS NULL;
  IF v_id IS DISTINCT FROM v_o2_row_before OR v_role IS DISTINCT FROM 'brand_admin' THEN
    RAISE EXCEPTION 'ISSUE-4283-T T2 FAIL: prior owner active row %/% want % as brand_admin', v_id, v_role, v_o2_row_before;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.brand_team_members m JOIN t4283_before b USING (id)
    WHERE m.id = '00000000-4283-4000-8000-0000000071b3'
      AND m.role = b.role AND m.removed_at = b.removed_at
  ) THEN
    RAISE EXCEPTION 'ISSUE-4283-T T2 FAIL: the prior owner''s old removed row 71b3 was modified';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.audit_log WHERE brand_id = v_brand AND action = 'brand_owner_demoted_on_handover'
                   AND target_id = v_o2::text) THEN
    RAISE EXCEPTION 'ISSUE-4283-T T2 FAIL: no brand_owner_demoted_on_handover audit row';
  END IF;
  IF (SELECT status FROM public.brand_invitations WHERE token_hash = '4283tester-T2') <> 'accepted' THEN
    RAISE EXCEPTION 'ISSUE-4283-T T2 FAIL: invitation not accepted';
  END IF;
  RAISE NOTICE 'ISSUE-4283-T T2 OK: stay handover; tie broken by id DESC; prior owner kept as admin';
END $$;

-- T3 -----------------------------------------------------------------------
DO $$
DECLARE
  v_result jsonb;
  v_brand constant uuid := '00000000-4283-4000-8000-000000007103';
  v_s constant uuid := '00000000-4283-4000-8000-000000007005';
  v_before record;
  v_after record;
  v_n integer;
BEGIN
  SELECT id, role, accepted_at INTO v_before FROM public.brand_team_members
    WHERE brand_id = v_brand AND user_id = v_s AND removed_at IS NULL;
  IF v_before.role IS DISTINCT FROM 'brand_owner' THEN
    RAISE EXCEPTION 'ISSUE-4283-T T3 SETUP: the brands insert trigger did not create an owner row (%)', v_before.role;
  END IF;
  BEGIN
    v_result := public.accept_invite_and_transfer_brand_ownership('4283tester-T3', v_s);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'ISSUE-4283-T T3 FAIL: active owner with a removed admin row re-accepting hit 23505 (%)', SQLERRM;
  END;

  SELECT count(*) INTO v_n FROM public.brand_team_members
    WHERE brand_id = v_brand AND user_id = v_s AND removed_at IS NULL;
  IF v_n <> 1 THEN RAISE EXCEPTION 'ISSUE-4283-T T3 FAIL: % active rows want 1', v_n; END IF;
  SELECT id, role, accepted_at INTO v_after FROM public.brand_team_members
    WHERE brand_id = v_brand AND user_id = v_s AND removed_at IS NULL;
  IF v_after.id <> v_before.id OR v_after.role <> 'brand_owner'
     OR v_after.accepted_at IS DISTINCT FROM v_before.accepted_at THEN
    RAISE EXCEPTION 'ISSUE-4283-T T3 FAIL: owner row changed (% % %) -> (% % %); want left exactly as it was',
      v_before.id, v_before.role, v_before.accepted_at, v_after.id, v_after.role, v_after.accepted_at;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.brand_team_members m JOIN t4283_before b USING (id)
    WHERE m.id = '00000000-4283-4000-8000-0000000071c1'
      AND m.role = b.role AND m.removed_at = b.removed_at AND m.accepted_at = b.accepted_at
  ) THEN
    RAISE EXCEPTION 'ISSUE-4283-T T3 FAIL: the removed admin row 71c1 was revived or modified';
  END IF;
  IF (SELECT account_id FROM public.brands WHERE id = v_brand) IS DISTINCT FROM v_s THEN
    RAISE EXCEPTION 'ISSUE-4283-T T3 FAIL: brands.account_id moved';
  END IF;
  IF EXISTS (SELECT 1 FROM public.audit_log WHERE brand_id = v_brand
               AND action IN ('brand_owner_removed_on_handover', 'brand_owner_demoted_on_handover')) THEN
    RAISE EXCEPTION 'ISSUE-4283-T T3 FAIL: a handover audit row was written for a self-handover';
  END IF;
  RAISE NOTICE 'ISSUE-4283-T T3 OK: current owner re-accepting left the owner row alone';
END $$;

-- T4 -----------------------------------------------------------------------
DO $$
DECLARE
  v_e constant uuid := '00000000-4283-4000-8000-000000007006';
  v_case record;
  v_state text;
BEGIN
  FOR v_case IN
    SELECT * FROM (VALUES
      ('4283tester-T4-used', 'P0002'),
      ('4283tester-T4-expired', 'P0003'),
      ('4283tester-T4-revoked', 'P0005'),
      ('4283tester-T4-declined', 'P0007'),
      ('4283tester-T4-mismatch', 'P0004')
    ) AS c(token, want)
  LOOP
    v_state := NULL;
    BEGIN
      PERFORM public.accept_invite_and_transfer_brand_ownership(v_case.token, v_e);
    -- P0004 is the SQLSTATE of assert_failure, which WHEN OTHERS does NOT
    -- catch; it must be named explicitly.
    EXCEPTION
      WHEN assert_failure THEN v_state := SQLSTATE;
      WHEN OTHERS THEN v_state := SQLSTATE;
    END;
    IF v_state IS DISTINCT FROM v_case.want THEN
      RAISE EXCEPTION 'ISSUE-4283-T T4 FAIL: % raised % want %', v_case.token, coalesce(v_state, 'no error'), v_case.want;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.brand_team_members m JOIN t4283_before b USING (id)
      WHERE m.id = '00000000-4283-4000-8000-0000000071d1'
        AND m.role = b.role AND m.removed_at = b.removed_at AND m.accepted_at = b.accepted_at
    ) OR EXISTS (
      SELECT 1 FROM public.brand_team_members
      WHERE brand_id = '00000000-4283-4000-8000-000000007104' AND user_id = v_e AND removed_at IS NULL
    ) THEN
      RAISE EXCEPTION 'ISSUE-4283-T T4 FAIL: refusal % changed the acceptor''s membership', v_case.token;
    END IF;
  END LOOP;
  IF (SELECT account_id FROM public.brands WHERE id = '00000000-4283-4000-8000-000000007104')
       IS DISTINCT FROM '00000000-4283-4000-8000-000000007001' THEN
    RAISE EXCEPTION 'ISSUE-4283-T T4 FAIL: a refused owner invite moved brands.account_id';
  END IF;
  RAISE NOTICE 'ISSUE-4283-T T4 OK: P0002/P0003/P0005/P0007/P0004 unchanged and side-effect free';
END $$;

-- G ------------------------------------------------------------------------
DO $$
DECLARE
  v_bad text;
  v_n integer;
BEGIN
  -- Every tester brand: exactly one active brand_owner, and it is account_id.
  SELECT string_agg(b.id::text, ', ') INTO v_bad
  FROM public.brands b
  WHERE b.id IN ('00000000-4283-4000-8000-000000007101', '00000000-4283-4000-8000-000000007102',
                 '00000000-4283-4000-8000-000000007103', '00000000-4283-4000-8000-000000007104')
    AND (
      (SELECT count(*) FROM public.brand_team_members m
        WHERE m.brand_id = b.id AND m.role = 'brand_owner' AND m.removed_at IS NULL) <> 1
      OR NOT EXISTS (SELECT 1 FROM public.brand_team_members m
        WHERE m.brand_id = b.id AND m.user_id = b.account_id
          AND m.role = 'brand_owner' AND m.removed_at IS NULL)
    );
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'ISSUE-4283-G FAIL: brands without exactly one active owner matching account_id: %', v_bad;
  END IF;
  -- No (brand, user) pair anywhere in the table holds more than one active row.
  SELECT count(*) INTO v_n FROM (
    SELECT 1 FROM public.brand_team_members WHERE removed_at IS NULL
    GROUP BY brand_id, user_id HAVING count(*) > 1
  ) d;
  IF v_n <> 0 THEN RAISE EXCEPTION 'ISSUE-4283-G FAIL: % (brand,user) pairs hold >1 active row', v_n; END IF;
  -- Nothing inserted: the tester brands hold exactly the rows they started with.
  SELECT count(*) INTO v_n FROM public.brand_team_members m
  WHERE m.brand_id IN ('00000000-4283-4000-8000-000000007101', '00000000-4283-4000-8000-000000007102',
                       '00000000-4283-4000-8000-000000007103', '00000000-4283-4000-8000-000000007104')
    AND NOT EXISTS (SELECT 1 FROM t4283_before b WHERE b.id = m.id);
  IF v_n <> 0 THEN RAISE EXCEPTION 'ISSUE-4283-G FAIL: % rows inserted where a history row should have been revived', v_n; END IF;
  RAISE NOTICE 'ISSUE-4283-G OK: one active owner per brand, one active row per member, no stray inserts';
END $$;

ROLLBACK;
