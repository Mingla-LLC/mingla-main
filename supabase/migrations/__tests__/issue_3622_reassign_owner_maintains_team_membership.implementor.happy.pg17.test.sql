-- ===========================================================================
-- Issue #3622 — reassigning a brand owner must not leave the previous owner
-- with access (PostgreSQL 17).
--
-- The contract: on reassignment the outgoing owner loses brand access entirely.
-- Demoting them to brand_admin instead was implemented, executed and rejected —
-- the demoted user restores rank 60 with one write of their own. The migration
-- header records that result; issue #3632 owns the escalation itself.
--
-- Every group CALLS admin_reassign_brand_owner and then asks the SERVER
-- AUTHORITY — public.biz_brand_effective_rank — what each party can do.
-- Nothing here decides "it works" by reading source text, and nothing asserts
-- only that brands.account_id changed: a test shaped that way passed
-- throughout the entire life of this defect.
--
--   A  setup sanity: the insert trigger really did give the original owner an
--      active, accepted brand_owner row, so the defect's precondition is real
--      and the later assertions are not vacuous.
--   B  after reassignment the OUTGOING owner's effective rank is 0.
--   C  after reassignment the INCOMING owner's effective rank is 60 AND BOTH
--      ARMS of biz_brand_effective_rank independently say 60 — the membership
--      arm is not being silently covered for by the account_id arm.
--   D  idempotent promotion: an existing active brand_admin who is made owner
--      ends with exactly ONE active row, at brand_owner — not a duplicate.
--   E  a never-accepted active brand_owner row is removed rather than
--      soft-closed, because brand_team_members_accepted_removed_excl forbids
--      removed_at on a row with a NULL accepted_at.
--   F  re-running the reassignment to the SAME account is a no-op: the
--      incumbent is not revoked by the block that revokes the outgoing owner.
--   G  the preserved guards still fire, in order: not_authorized before
--      anything, then reason_required, not_found and invalid_new_owner — and
--      none of them mutates membership.
--   R  fails on revert: the invariant the old function violated — no user may
--      hold an active accepted brand_owner row on a brand whose account_id is
--      somebody else.
--
-- One transaction, rolled back at the end. Never production.
-- ===========================================================================
\set ON_ERROR_STOP on
BEGIN;

-- ---------------------------------------------------------------------------
-- Fixtures. brand_team_members.user_id is FK -> auth.users(id) and
-- brands.account_id is FK -> creator_accounts(id), so both are seeded for
-- every principal.
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
VALUES
  ('00000000-3622-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'issue3622-admin@example.test', now(), now()),
  ('00000000-3622-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'issue3622-outgoing@example.test', now(), now()),
  ('00000000-3622-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'issue3622-incoming@example.test', now(), now()),
  ('00000000-3622-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'issue3622-promoted@example.test', now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.admin_users (email, role, status)
VALUES ('issue3622-admin@example.test', 'admin', 'active')
ON CONFLICT (email) DO UPDATE SET role = excluded.role, status = excluded.status;

INSERT INTO public.creator_accounts (id, created_at)
VALUES
  ('00000000-3622-4000-8000-000000000002', now()),
  ('00000000-3622-4000-8000-000000000003', now()),
  ('00000000-3622-4000-8000-000000000004', now())
ON CONFLICT (id) DO NOTHING;

-- Three brands: the main handover, the promotion case, the never-accepted case.
INSERT INTO public.brands (id, account_id, name, slug, created_at, updated_at)
VALUES
  ('00000000-3622-4000-8000-000000000010', '00000000-3622-4000-8000-000000000002',
   'Issue 3622 Handover', 'issue3622handover', now(), now()),
  ('00000000-3622-4000-8000-000000000011', '00000000-3622-4000-8000-000000000002',
   'Issue 3622 Promotion', 'issue3622promotion', now(), now()),
  ('00000000-3622-4000-8000-000000000012', '00000000-3622-4000-8000-000000000002',
   'Issue 3622 Unaccepted', 'issue3622unaccepted', now(), now());

-- Arm (a) and arm (b) of biz_brand_effective_rank, computed SEPARATELY so group
-- C can prove they agree instead of one masking the other. Bodies mirror the
-- live function (20260819000000, section 5) exactly.
CREATE OR REPLACE FUNCTION pg_temp.issue3622_arm_account_id(p_brand uuid, p_user uuid)
RETURNS integer LANGUAGE sql STABLE AS $fn$
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM public.brands b
     WHERE b.id = p_brand AND b.account_id = p_user AND b.deleted_at IS NULL
  ) THEN public.biz_role_rank('brand_owner') ELSE 0 END;
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.issue3622_arm_membership(p_brand uuid, p_user uuid)
RETURNS integer LANGUAGE sql STABLE AS $fn$
  SELECT COALESCE((
    SELECT max(public.biz_role_rank(m.role))
      FROM public.brand_team_members m
      JOIN public.brands b ON b.id = m.brand_id
     WHERE m.brand_id = p_brand AND m.user_id = p_user
       AND m.removed_at IS NULL AND m.accepted_at IS NOT NULL
       AND b.deleted_at IS NULL
  ), 0);
$fn$;

DO $test$
DECLARE
  v_admin    uuid := '00000000-3622-4000-8000-000000000001';
  v_out      uuid := '00000000-3622-4000-8000-000000000002';
  v_in       uuid := '00000000-3622-4000-8000-000000000003';
  v_promoted uuid := '00000000-3622-4000-8000-000000000004';
  v_brand    uuid := '00000000-3622-4000-8000-000000000010';
  v_brand_p  uuid := '00000000-3622-4000-8000-000000000011';
  v_brand_u  uuid := '00000000-3622-4000-8000-000000000012';
  v_rank     integer;
  v_arm_a    integer;
  v_arm_b    integer;
  v_count    integer;
  v_role     text;
BEGIN
  ---------------------------------------------------------------------------
  -- A — the precondition is real: the AFTER INSERT trigger gave the original
  -- owner an active, accepted brand_owner row. Without this the later
  -- assertions would pass over an empty table and prove nothing.
  ---------------------------------------------------------------------------
  SELECT count(*) INTO v_count
    FROM public.brand_team_members
   WHERE brand_id = v_brand AND user_id = v_out
     AND role = 'brand_owner' AND removed_at IS NULL AND accepted_at IS NOT NULL;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'ISSUE-3622 A FAIL: expected exactly 1 active accepted brand_owner row for the original owner, found %', v_count;
  END IF;

  IF public.biz_brand_effective_rank(v_brand, v_out) <> 60 THEN
    RAISE EXCEPTION 'ISSUE-3622 A FAIL: original owner does not start at rank 60';
  END IF;

  ---------------------------------------------------------------------------
  -- Perform the handover as an active admin.
  ---------------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM public.admin_reassign_brand_owner(v_brand, v_in, 'issue 3622 handover');

  ---------------------------------------------------------------------------
  -- B — the OUTGOING owner's effective rank is 0. This is the assertion the
  -- defect failed: the old function left arm (b) returning 60 forever.
  ---------------------------------------------------------------------------
  v_rank  := public.biz_brand_effective_rank(v_brand, v_out);
  v_arm_a := pg_temp.issue3622_arm_account_id(v_brand, v_out);
  v_arm_b := pg_temp.issue3622_arm_membership(v_brand, v_out);
  IF v_rank <> 0 OR v_arm_a <> 0 OR v_arm_b <> 0 THEN
    RAISE EXCEPTION 'ISSUE-3622 B FAIL: outgoing owner retains access — effective=%, account_id arm=%, membership arm=%',
      v_rank, v_arm_a, v_arm_b;
  END IF;

  SELECT count(*) INTO v_count
    FROM public.brand_team_members
   WHERE brand_id = v_brand AND user_id = v_out
     AND removed_at IS NULL AND accepted_at IS NOT NULL;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'ISSUE-3622 B FAIL: outgoing owner still has % active accepted row(s)', v_count;
  END IF;

  ---------------------------------------------------------------------------
  -- C — the INCOMING owner is at 60 and BOTH arms independently say so. The
  -- consistency half: a membership row really exists, rather than arm (a)
  -- quietly carrying a brand with no membership record behind it.
  ---------------------------------------------------------------------------
  v_rank  := public.biz_brand_effective_rank(v_brand, v_in);
  v_arm_a := pg_temp.issue3622_arm_account_id(v_brand, v_in);
  v_arm_b := pg_temp.issue3622_arm_membership(v_brand, v_in);
  IF v_rank <> 60 OR v_arm_a <> 60 OR v_arm_b <> 60 THEN
    RAISE EXCEPTION 'ISSUE-3622 C FAIL: arms disagree for the incoming owner — effective=%, account_id arm=%, membership arm=%',
      v_rank, v_arm_a, v_arm_b;
  END IF;

  SELECT count(*) INTO v_count
    FROM public.brand_team_members
   WHERE brand_id = v_brand AND user_id = v_in
     AND role = 'brand_owner' AND removed_at IS NULL AND accepted_at IS NOT NULL;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'ISSUE-3622 C FAIL: expected exactly 1 active accepted brand_owner row for the incoming owner, found %', v_count;
  END IF;

  ---------------------------------------------------------------------------
  -- D — idempotent promotion. The incoming owner is ALREADY an active
  -- brand_admin on this brand. They must end with ONE active row at
  -- brand_owner, not a second row alongside the first.
  ---------------------------------------------------------------------------
  INSERT INTO public.brand_team_members
    (brand_id, user_id, role, invited_at, accepted_at, removed_at)
  VALUES (v_brand_p, v_promoted, 'brand_admin', now(), now(), NULL);

  PERFORM public.admin_reassign_brand_owner(v_brand_p, v_promoted, 'issue 3622 promotion');

  SELECT count(*) INTO v_count
    FROM public.brand_team_members
   WHERE brand_id = v_brand_p AND user_id = v_promoted AND removed_at IS NULL;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'ISSUE-3622 D FAIL: promotion duplicated membership — % active rows', v_count;
  END IF;

  SELECT role INTO v_role
    FROM public.brand_team_members
   WHERE brand_id = v_brand_p AND user_id = v_promoted AND removed_at IS NULL;
  IF v_role <> 'brand_owner' THEN
    RAISE EXCEPTION 'ISSUE-3622 D FAIL: promoted member left at role %', v_role;
  END IF;

  IF public.biz_brand_effective_rank(v_brand_p, v_promoted) <> 60
     OR pg_temp.issue3622_arm_membership(v_brand_p, v_promoted) <> 60 THEN
    RAISE EXCEPTION 'ISSUE-3622 D FAIL: promoted member is not rank 60 on both arms';
  END IF;

  ---------------------------------------------------------------------------
  -- E — a never-accepted active brand_owner row. removed_at cannot be set on
  -- it (brand_team_members_accepted_removed_excl), so it must be deleted. If
  -- the implementation tried to soft-close it the RPC would raise here.
  ---------------------------------------------------------------------------
  UPDATE public.brand_team_members SET accepted_at = NULL
   WHERE brand_id = v_brand_u AND user_id = v_out AND role = 'brand_owner';

  PERFORM public.admin_reassign_brand_owner(v_brand_u, v_in, 'issue 3622 unaccepted row');

  SELECT count(*) INTO v_count
    FROM public.brand_team_members
   WHERE brand_id = v_brand_u AND user_id = v_out AND removed_at IS NULL;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'ISSUE-3622 E FAIL: never-accepted outgoing row survived — % active row(s)', v_count;
  END IF;

  IF public.biz_brand_effective_rank(v_brand_u, v_out) <> 0 THEN
    RAISE EXCEPTION 'ISSUE-3622 E FAIL: outgoing owner retains rank on the unaccepted-row brand';
  END IF;

  ---------------------------------------------------------------------------
  -- F — re-running the handover to the SAME account is a no-op. The block that
  -- revokes the outgoing owner must not revoke the incumbent it just installed.
  ---------------------------------------------------------------------------
  PERFORM public.admin_reassign_brand_owner(v_brand, v_in, 'issue 3622 replay');

  IF public.biz_brand_effective_rank(v_brand, v_in) <> 60
     OR pg_temp.issue3622_arm_membership(v_brand, v_in) <> 60 THEN
    RAISE EXCEPTION 'ISSUE-3622 F FAIL: replaying the handover revoked the incumbent';
  END IF;

  SELECT count(*) INTO v_count
    FROM public.brand_team_members
   WHERE brand_id = v_brand AND user_id = v_in AND removed_at IS NULL;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'ISSUE-3622 F FAIL: replay left % active rows for the incumbent', v_count;
  END IF;

  ---------------------------------------------------------------------------
  -- G — the preserved guards. Each must still refuse, and none may mutate
  -- membership on its way out.
  ---------------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', v_out::text, true);
  BEGIN
    PERFORM public.admin_reassign_brand_owner(v_brand, v_out, 'non-admin attempt');
    RAISE EXCEPTION 'ISSUE-3622 G FAIL: a non-admin reassigned a brand';
  EXCEPTION WHEN others THEN
    IF sqlerrm NOT LIKE '%not_authorized%' THEN
      RAISE EXCEPTION 'ISSUE-3622 G FAIL: expected not_authorized, got %', sqlerrm;
    END IF;
  END;

  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);

  BEGIN
    PERFORM public.admin_reassign_brand_owner(v_brand, v_in, '   ');
    RAISE EXCEPTION 'ISSUE-3622 G FAIL: a blank reason was accepted';
  EXCEPTION WHEN others THEN
    IF sqlerrm NOT LIKE '%reason_required%' THEN
      RAISE EXCEPTION 'ISSUE-3622 G FAIL: expected reason_required, got %', sqlerrm;
    END IF;
  END;

  BEGIN
    PERFORM public.admin_reassign_brand_owner(
      '00000000-3622-4000-8000-0000000000ff', v_in, 'missing brand');
    RAISE EXCEPTION 'ISSUE-3622 G FAIL: a missing brand was accepted';
  EXCEPTION WHEN others THEN
    IF sqlerrm NOT LIKE '%not_found%' THEN
      RAISE EXCEPTION 'ISSUE-3622 G FAIL: expected not_found, got %', sqlerrm;
    END IF;
  END;

  BEGIN
    PERFORM public.admin_reassign_brand_owner(
      v_brand, '00000000-3622-4000-8000-0000000000fe', 'unknown account');
    RAISE EXCEPTION 'ISSUE-3622 G FAIL: an unknown account became the owner';
  EXCEPTION WHEN others THEN
    IF sqlerrm NOT LIKE '%invalid_new_owner%' THEN
      RAISE EXCEPTION 'ISSUE-3622 G FAIL: expected invalid_new_owner, got %', sqlerrm;
    END IF;
  END;

  IF public.biz_brand_effective_rank(v_brand, v_out) <> 0
     OR public.biz_brand_effective_rank(v_brand, v_in) <> 60 THEN
    RAISE EXCEPTION 'ISSUE-3622 G FAIL: a refused call still moved access';
  END IF;

  ---------------------------------------------------------------------------
  -- R — fails on revert. The invariant the old function violated, stated over
  -- the whole fixture set rather than one row: nobody may hold an active
  -- accepted brand_owner membership on a brand owned by somebody else.
  -- Deleting the membership-maintenance block from the RPC leaves the outgoing
  -- owner's row open on all three fixture brands and this count becomes 3.
  ---------------------------------------------------------------------------
  SELECT count(*) INTO v_count
    FROM public.brand_team_members m
    JOIN public.brands b ON b.id = m.brand_id
   WHERE m.role = 'brand_owner'
     AND m.removed_at IS NULL
     AND m.accepted_at IS NOT NULL
     AND m.user_id <> b.account_id
     AND b.id IN (
       '00000000-3622-4000-8000-000000000010',
       '00000000-3622-4000-8000-000000000011',
       '00000000-3622-4000-8000-000000000012'
     );
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'ISSUE-3622 R FAIL: % brand_owner membership row(s) outlived the handover that removed their ownership', v_count;
  END IF;

  RAISE NOTICE 'ISSUE-3622: all groups passed';
END
$test$;

ROLLBACK;
