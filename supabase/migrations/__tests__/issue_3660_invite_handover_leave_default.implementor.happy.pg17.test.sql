-- #3660 Phase 4 — owner invite handover leave-default + stay path.
-- Behavioral: 2-arg accept reads invitation.outgoing_disposition; dual audit;
-- co-owner cleanup; leave rank 0 / stay admin.
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
VALUES
  ('00000000-3660-4000-8000-000000000201', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'issue3660h-out@example.test', now(), now()),
  ('00000000-3660-4000-8000-000000000202', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'issue3660h-in@example.test', now(), now()),
  ('00000000-3660-4000-8000-000000000203', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'issue3660h-in2@example.test', now(), now()),
  ('00000000-3660-4000-8000-000000000204', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'issue3660h-co@example.test', now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.creator_accounts (id, created_at)
VALUES
  ('00000000-3660-4000-8000-000000000201', now()),
  ('00000000-3660-4000-8000-000000000202', now()),
  ('00000000-3660-4000-8000-000000000203', now()),
  ('00000000-3660-4000-8000-000000000204', now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.brands (id, account_id, name, slug, created_at, updated_at)
VALUES
  ('00000000-3660-4000-8000-000000000210', '00000000-3660-4000-8000-000000000201',
   'Issue 3660 Leave', 'issue3660leave', now(), now()),
  ('00000000-3660-4000-8000-000000000211', '00000000-3660-4000-8000-000000000201',
   'Issue 3660 Stay', 'issue3660stay', now(), now());

-- Extra active co-owner on the leave brand (must be removed on handover).
INSERT INTO public.brand_team_members
  (brand_id, user_id, role, invited_at, accepted_at, removed_at)
VALUES
  ('00000000-3660-4000-8000-000000000210',
   '00000000-3660-4000-8000-000000000204',
   'brand_owner', now(), now(), NULL);

INSERT INTO public.brand_invitations (
  brand_id, email, role, token_hash, expires_at, status, outgoing_disposition
)
VALUES
  ('00000000-3660-4000-8000-000000000210',
   'issue3660h-in@example.test', 'brand_owner',
   '3660leavehash000000000000000000000000000000000000000000000000',
   now() + interval '7 days', 'pending', 'leave'),
  ('00000000-3660-4000-8000-000000000211',
   'issue3660h-in2@example.test', 'brand_owner',
   '3660stayhash0000000000000000000000000000000000000000000000000',
   now() + interval '7 days', 'pending', 'stay');

-- Leave default via 2-arg RPC (disposition from invitation row).
SELECT public.accept_invite_and_transfer_brand_ownership(
  '3660leavehash000000000000000000000000000000000000000000000000',
  '00000000-3660-4000-8000-000000000202'
);

DO $$
DECLARE
  v_out_rank integer;
  v_in_rank integer;
  v_owners integer;
  v_co_rank integer;
  v_xfer integer;
  v_removed integer;
BEGIN
  v_out_rank := public.biz_brand_effective_rank(
    '00000000-3660-4000-8000-000000000210',
    '00000000-3660-4000-8000-000000000201'
  );
  v_in_rank := public.biz_brand_effective_rank(
    '00000000-3660-4000-8000-000000000210',
    '00000000-3660-4000-8000-000000000202'
  );
  v_co_rank := public.biz_brand_effective_rank(
    '00000000-3660-4000-8000-000000000210',
    '00000000-3660-4000-8000-000000000204'
  );
  SELECT count(*) INTO v_owners
  FROM public.brand_team_members
  WHERE brand_id = '00000000-3660-4000-8000-000000000210'
    AND role = 'brand_owner'
    AND removed_at IS NULL
    AND accepted_at IS NOT NULL;
  SELECT count(*) INTO v_xfer
  FROM public.audit_log
  WHERE brand_id = '00000000-3660-4000-8000-000000000210'
    AND action = 'brand_ownership_transferred';
  SELECT count(*) INTO v_removed
  FROM public.audit_log
  WHERE brand_id = '00000000-3660-4000-8000-000000000210'
    AND action = 'brand_owner_removed_on_handover';
  IF v_out_rank <> 0 THEN
    RAISE EXCEPTION 'ISSUE-3660 leave: outgoing rank % want 0', v_out_rank;
  END IF;
  IF v_co_rank <> 0 THEN
    RAISE EXCEPTION 'ISSUE-3660 leave: co-owner rank % want 0', v_co_rank;
  END IF;
  IF v_in_rank <> 60 THEN
    RAISE EXCEPTION 'ISSUE-3660 leave: incoming rank % want 60', v_in_rank;
  END IF;
  IF v_owners <> 1 THEN
    RAISE EXCEPTION 'ISSUE-3660 leave: % active brand_owner rows', v_owners;
  END IF;
  IF v_xfer < 1 THEN
    RAISE EXCEPTION 'ISSUE-3660 leave: missing brand_ownership_transferred audit';
  END IF;
  IF v_removed < 1 THEN
    RAISE EXCEPTION 'ISSUE-3660 leave: missing brand_owner_removed_on_handover audit';
  END IF;
END $$;

-- Stay: outgoing becomes admin (rank 50).
SELECT public.accept_invite_and_transfer_brand_ownership(
  '3660stayhash0000000000000000000000000000000000000000000000000',
  '00000000-3660-4000-8000-000000000203'
);

DO $$
DECLARE
  v_out_rank integer;
  v_role text;
  v_demoted integer;
BEGIN
  v_out_rank := public.biz_brand_effective_rank(
    '00000000-3660-4000-8000-000000000211',
    '00000000-3660-4000-8000-000000000201'
  );
  SELECT role INTO v_role
  FROM public.brand_team_members
  WHERE brand_id = '00000000-3660-4000-8000-000000000211'
    AND user_id = '00000000-3660-4000-8000-000000000201'
    AND removed_at IS NULL
  LIMIT 1;
  SELECT count(*) INTO v_demoted
  FROM public.audit_log
  WHERE brand_id = '00000000-3660-4000-8000-000000000211'
    AND action = 'brand_owner_demoted_on_handover';
  IF v_out_rank <> 50 THEN
    RAISE EXCEPTION 'ISSUE-3660 stay: outgoing rank % want 50', v_out_rank;
  END IF;
  IF v_role IS DISTINCT FROM 'brand_admin' THEN
    RAISE EXCEPTION 'ISSUE-3660 stay: outgoing role % want brand_admin', v_role;
  END IF;
  IF v_demoted < 1 THEN
    RAISE EXCEPTION 'ISSUE-3660 stay: missing brand_owner_demoted_on_handover audit';
  END IF;
  RAISE NOTICE 'ISSUE-3660 invite handover happy OK';
END $$;

ROLLBACK;
