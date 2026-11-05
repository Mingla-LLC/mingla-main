-- Issue #4283 — accepting a brand invite leaves the acceptor with ONE active
-- brand_team_members row, even when they have removed rows from before.
--
-- Fails on the pre-#4283 body (20270822003259): case A and case B raise 23505
-- on idx_brand_team_members_brand_user_active and roll back.
--
-- A  removed brand_admin → owner handover accepted → one active brand_owner
--    row, and it is the revived old row (no second row inserted).
-- B  removed twice → re-invited as brand_admin → one active row, the most
--    recent removed row is the one revived, the older one stays removed.
-- B2 one active + one removed row → re-invited as event_manager → one active
--    row (the active one), the removed one stays removed.
-- C  currently active brand_admin → owner handover → one active brand_owner
--    row (no duplicate).
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
VALUES
  ('00000000-4283-4000-8000-000000000301', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'issue4283-owner@example.test', now(), now()),
  ('00000000-4283-4000-8000-000000000302', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'issue4283-a@example.test', now(), now()),
  ('00000000-4283-4000-8000-000000000303', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'issue4283-b@example.test', now(), now()),
  ('00000000-4283-4000-8000-000000000304', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'issue4283-c@example.test', now(), now()),
  ('00000000-4283-4000-8000-000000000305', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'issue4283-b2@example.test', now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.creator_accounts (id, created_at)
VALUES
  ('00000000-4283-4000-8000-000000000301', now()),
  ('00000000-4283-4000-8000-000000000302', now()),
  ('00000000-4283-4000-8000-000000000303', now()),
  ('00000000-4283-4000-8000-000000000304', now()),
  ('00000000-4283-4000-8000-000000000305', now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.brands (id, account_id, name, slug, created_at, updated_at)
VALUES
  ('00000000-4283-4000-8000-000000000310', '00000000-4283-4000-8000-000000000301',
   'Issue 4283 A', 'issue4283a', now(), now()),
  ('00000000-4283-4000-8000-000000000311', '00000000-4283-4000-8000-000000000301',
   'Issue 4283 B', 'issue4283b', now(), now()),
  ('00000000-4283-4000-8000-000000000312', '00000000-4283-4000-8000-000000000301',
   'Issue 4283 C', 'issue4283c', now(), now()),
  ('00000000-4283-4000-8000-000000000313', '00000000-4283-4000-8000-000000000301',
   'Issue 4283 B2', 'issue4283b2', now(), now());

-- History. Fixed row ids so the test can name which row was revived.
INSERT INTO public.brand_team_members
  (id, brand_id, user_id, role, invited_at, accepted_at, removed_at)
VALUES
  -- A: added as admin, then removed (the production shape).
  ('00000000-4283-4000-8000-0000000003a1', '00000000-4283-4000-8000-000000000310',
   '00000000-4283-4000-8000-000000000302', 'brand_admin',
   now() - interval '2 hours', now() - interval '2 hours', now() - interval '1 hour'),
  -- B: removed twice; b2 is the more recent stint.
  ('00000000-4283-4000-8000-0000000003b1', '00000000-4283-4000-8000-000000000311',
   '00000000-4283-4000-8000-000000000303', 'event_manager',
   now() - interval '10 days', now() - interval '10 days', now() - interval '9 days'),
  ('00000000-4283-4000-8000-0000000003b2', '00000000-4283-4000-8000-000000000311',
   '00000000-4283-4000-8000-000000000303', 'scanner',
   now() - interval '5 days', now() - interval '5 days', now() - interval '4 days'),
  -- C: currently an active admin.
  ('00000000-4283-4000-8000-0000000003c1', '00000000-4283-4000-8000-000000000312',
   '00000000-4283-4000-8000-000000000304', 'brand_admin',
   now() - interval '3 days', now() - interval '3 days', NULL),
  -- B2: an old removed row, then a current active row.
  ('00000000-4283-4000-8000-0000000003d1', '00000000-4283-4000-8000-000000000313',
   '00000000-4283-4000-8000-000000000305', 'brand_admin',
   now() - interval '8 days', now() - interval '8 days', now() - interval '7 days'),
  ('00000000-4283-4000-8000-0000000003d2', '00000000-4283-4000-8000-000000000313',
   '00000000-4283-4000-8000-000000000305', 'scanner',
   now() - interval '2 days', now() - interval '2 days', NULL);

INSERT INTO public.brand_invitations (
  brand_id, email, role, token_hash, expires_at, status, outgoing_disposition
)
VALUES
  ('00000000-4283-4000-8000-000000000310', 'issue4283-a@example.test', 'brand_owner',
   '4283hashA00000000000000000000000000000000000000000000000000000',
   now() + interval '7 days', 'pending', 'leave'),
  ('00000000-4283-4000-8000-000000000311', 'issue4283-b@example.test', 'brand_admin',
   '4283hashB00000000000000000000000000000000000000000000000000000',
   now() + interval '7 days', 'pending', 'leave'),
  ('00000000-4283-4000-8000-000000000312', 'issue4283-c@example.test', 'brand_owner',
   '4283hashC00000000000000000000000000000000000000000000000000000',
   now() + interval '7 days', 'pending', 'stay'),
  ('00000000-4283-4000-8000-000000000313', 'issue4283-b2@example.test', 'event_manager',
   '4283hashD00000000000000000000000000000000000000000000000000000',
   now() + interval '7 days', 'pending', 'leave');

-- A ------------------------------------------------------------------------
DO $$
DECLARE
  v_result jsonb;
  v_active integer;
  v_total integer;
  v_role text;
  v_id uuid;
  v_account uuid;
BEGIN
  BEGIN
    v_result := public.accept_invite_and_transfer_brand_ownership(
      '4283hashA00000000000000000000000000000000000000000000000000000',
      '00000000-4283-4000-8000-000000000302'
    );
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'ISSUE-4283 A FAIL: removed admin accepting an owner handover hit 23505 (%)', SQLERRM;
  END;
  IF (v_result->>'transferred') IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'ISSUE-4283 A FAIL: transferred=% want true', v_result->>'transferred';
  END IF;

  SELECT count(*) FILTER (WHERE removed_at IS NULL), count(*)
    INTO v_active, v_total
  FROM public.brand_team_members
  WHERE brand_id = '00000000-4283-4000-8000-000000000310'
    AND user_id = '00000000-4283-4000-8000-000000000302';
  SELECT id, role INTO v_id, v_role
  FROM public.brand_team_members
  WHERE brand_id = '00000000-4283-4000-8000-000000000310'
    AND user_id = '00000000-4283-4000-8000-000000000302'
    AND removed_at IS NULL;
  SELECT account_id INTO v_account FROM public.brands
  WHERE id = '00000000-4283-4000-8000-000000000310';

  IF v_active <> 1 THEN
    RAISE EXCEPTION 'ISSUE-4283 A FAIL: % active rows want 1', v_active;
  END IF;
  IF v_total <> 1 THEN
    RAISE EXCEPTION 'ISSUE-4283 A FAIL: % rows want 1 (the old row revived, nothing inserted)', v_total;
  END IF;
  IF v_role <> 'brand_owner' THEN
    RAISE EXCEPTION 'ISSUE-4283 A FAIL: active role % want brand_owner', v_role;
  END IF;
  IF v_id <> '00000000-4283-4000-8000-0000000003a1' THEN
    RAISE EXCEPTION 'ISSUE-4283 A FAIL: active row % is not the revived history row', v_id;
  END IF;
  IF v_account <> '00000000-4283-4000-8000-000000000302' THEN
    RAISE EXCEPTION 'ISSUE-4283 A FAIL: brand account_id % not moved to the acceptor', v_account;
  END IF;
  -- The outgoing owner left (leave disposition), so exactly one active owner.
  IF (SELECT count(*) FROM public.brand_team_members
      WHERE brand_id = '00000000-4283-4000-8000-000000000310'
        AND role = 'brand_owner' AND removed_at IS NULL) <> 1 THEN
    RAISE EXCEPTION 'ISSUE-4283 A FAIL: active brand_owner count is not 1';
  END IF;
  RAISE NOTICE 'ISSUE-4283 A OK: removed admin accepted the owner handover with one active row';
END $$;

-- B ------------------------------------------------------------------------
DO $$
DECLARE
  v_active integer;
  v_total integer;
  v_role text;
  v_id uuid;
BEGIN
  BEGIN
    PERFORM public.accept_invite_and_transfer_brand_ownership(
      '4283hashB00000000000000000000000000000000000000000000000000000',
      '00000000-4283-4000-8000-000000000303'
    );
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'ISSUE-4283 B FAIL: twice-removed member re-accepting hit 23505 (%)', SQLERRM;
  END;

  SELECT count(*) FILTER (WHERE removed_at IS NULL), count(*)
    INTO v_active, v_total
  FROM public.brand_team_members
  WHERE brand_id = '00000000-4283-4000-8000-000000000311'
    AND user_id = '00000000-4283-4000-8000-000000000303';
  SELECT id, role INTO v_id, v_role
  FROM public.brand_team_members
  WHERE brand_id = '00000000-4283-4000-8000-000000000311'
    AND user_id = '00000000-4283-4000-8000-000000000303'
    AND removed_at IS NULL;

  IF v_active <> 1 THEN
    RAISE EXCEPTION 'ISSUE-4283 B FAIL: % active rows want 1', v_active;
  END IF;
  IF v_total <> 2 THEN
    RAISE EXCEPTION 'ISSUE-4283 B FAIL: % rows want 2 (history kept, nothing inserted)', v_total;
  END IF;
  IF v_role <> 'brand_admin' THEN
    RAISE EXCEPTION 'ISSUE-4283 B FAIL: active role % want brand_admin', v_role;
  END IF;
  IF v_id <> '00000000-4283-4000-8000-0000000003b2' THEN
    RAISE EXCEPTION 'ISSUE-4283 B FAIL: revived row % is not the most recent one', v_id;
  END IF;
  IF (SELECT removed_at FROM public.brand_team_members
      WHERE id = '00000000-4283-4000-8000-0000000003b1') IS NULL THEN
    RAISE EXCEPTION 'ISSUE-4283 B FAIL: the older removed row was revived too';
  END IF;
  RAISE NOTICE 'ISSUE-4283 B OK: twice-removed member re-accepted with one active row';
END $$;

-- B2 -----------------------------------------------------------------------
DO $$
DECLARE
  v_active integer;
  v_role text;
  v_id uuid;
BEGIN
  BEGIN
    PERFORM public.accept_invite_and_transfer_brand_ownership(
      '4283hashD00000000000000000000000000000000000000000000000000000',
      '00000000-4283-4000-8000-000000000305'
    );
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'ISSUE-4283 B2 FAIL: active+removed member accepting hit 23505 (%)', SQLERRM;
  END;

  SELECT count(*) INTO v_active
  FROM public.brand_team_members
  WHERE brand_id = '00000000-4283-4000-8000-000000000313'
    AND user_id = '00000000-4283-4000-8000-000000000305'
    AND removed_at IS NULL;
  SELECT id, role INTO v_id, v_role
  FROM public.brand_team_members
  WHERE brand_id = '00000000-4283-4000-8000-000000000313'
    AND user_id = '00000000-4283-4000-8000-000000000305'
    AND removed_at IS NULL;
  IF v_active <> 1 THEN
    RAISE EXCEPTION 'ISSUE-4283 B2 FAIL: % active rows want 1', v_active;
  END IF;
  IF v_id <> '00000000-4283-4000-8000-0000000003d2' OR v_role <> 'event_manager' THEN
    RAISE EXCEPTION 'ISSUE-4283 B2 FAIL: active row %/% want the current row as event_manager', v_id, v_role;
  END IF;
  RAISE NOTICE 'ISSUE-4283 B2 OK: the active row was updated, history untouched';
END $$;

-- C ------------------------------------------------------------------------
DO $$
DECLARE
  v_active integer;
  v_total integer;
  v_role text;
BEGIN
  PERFORM public.accept_invite_and_transfer_brand_ownership(
    '4283hashC00000000000000000000000000000000000000000000000000000',
    '00000000-4283-4000-8000-000000000304'
  );

  SELECT count(*) FILTER (WHERE removed_at IS NULL), count(*)
    INTO v_active, v_total
  FROM public.brand_team_members
  WHERE brand_id = '00000000-4283-4000-8000-000000000312'
    AND user_id = '00000000-4283-4000-8000-000000000304';
  SELECT role INTO v_role
  FROM public.brand_team_members
  WHERE brand_id = '00000000-4283-4000-8000-000000000312'
    AND user_id = '00000000-4283-4000-8000-000000000304'
    AND removed_at IS NULL;
  IF v_active <> 1 OR v_total <> 1 THEN
    RAISE EXCEPTION 'ISSUE-4283 C FAIL: active=% total=% want 1/1', v_active, v_total;
  END IF;
  IF v_role <> 'brand_owner' THEN
    RAISE EXCEPTION 'ISSUE-4283 C FAIL: active role % want brand_owner', v_role;
  END IF;
  RAISE NOTICE 'ISSUE-4283 C OK: active admin became owner with one row';
END $$;

ROLLBACK;
