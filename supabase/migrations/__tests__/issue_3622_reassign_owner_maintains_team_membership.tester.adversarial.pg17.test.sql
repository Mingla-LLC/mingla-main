-- ===========================================================================
-- Issue #3622 — INDEPENDENT TESTER suite. A different axis from the
-- implementor's A–G/R groups (PostgreSQL 17).
--
-- The implementor proved the HAPPY SHAPE of the handover: after
-- admin_reassign_brand_owner, the outgoing owner reads 0 and the incoming
-- owner reads 60 on both arms of biz_brand_effective_rank, promotion is
-- idempotent, a never-accepted OUTGOING row is deleted rather than
-- soft-closed, a replay to the incumbent is a no-op, and four guards still
-- refuse.
--
-- This suite attacks what that leaves open. The contract chosen for #3622 is
-- REMOVAL rather than demotion, and removal was chosen BECAUSE a demoted owner
-- can restore themselves. That argument is only worth the paper it is written
-- on if removal is genuinely unreachable in the other direction — so the
-- first and largest group here is not "is the rank 0" but "can the person at
-- rank 0 get back to 60 by ANY door the database leaves open to them".
--
--   T1  ESCALATION REACHABILITY. The removed owner, acting only as
--       themselves under SET ROLE authenticated with their own
--       request.jwt.claim.sub — exactly as PostgREST would present them —
--       cannot climb back by any route: clearing their own removed_at,
--       rewriting their own role, rewriting the NEW owner's row, inserting a
--       fresh owner row, deleting their own row, deleting the new owner's row,
--       or calling any of the three admin team RPCs. Read access to their own
--       historical row is expected and asserted to be read-ONLY.
--   T2  THE WRITE SURFACE THAT KEEPS REMOVAL HOLDING. Removal only holds while
--       every write door into brand_team_members is gated on rank >= 50, so the
--       policy shape is pinned by exact predicate from the catalog — the day a
--       self-addressed "a member may update their own row" policy appears, the
--       contract silently stops being enforceable. Plus the re-invitation door:
--       the ex-owner holds EXECUTE on the sibling transfer RPC, so it is proved
--       BEHAVIOURALLY that they can neither guess nor mint the token it needs.
--   T2b THE SIBLING TRANSFER PATH, DRIVEN FOR REAL, reported and NOT pinned.
--       accept_invite_and_transfer_brand_ownership is the OTHER live path that
--       changes brands.account_id, and it still ships the brand_admin demotion
--       this issue implemented, tested and rejected — so the registry's "ANY
--       path" rule holds on admin_reassign_brand_owner alone.
--   T3  THE GUARD THE IMPLEMENTOR DID NOT TEST. Group G covers
--       not_authorized / reason_required / not_found / invalid_new_owner. It
--       does NOT cover the issue_2101 active-named-checkout refusal, which is
--       the one guard that fires from a BEFORE UPDATE OF account_id trigger —
--       i.e. from INSIDE the statement that the membership block was
--       deliberately placed after. That is the only refusal whose failure mode
--       is a PARTIAL application, which would be worse than the original bug.
--   T4  EVERY refusal is compared against a FULL byte-level snapshot of the
--       brand's membership (ids, roles, timestamps) plus brands.account_id —
--       not a spot-check of one rank. Adds an inactive (revoked) admin, a
--       SOFT-DELETED creator_account and a NULL new owner, none of which the
--       implementor exercises.
--   T5  CONSTRAINT-STATE MATRIX for the INCOMING owner (the implementor only
--       probes the outgoing never-accepted row): active-but-never-accepted at
--       brand_owner, active-but-never-accepted at a LOWER role, an
--       already-removed row only, and no row at all. After every case both
--       brand_team_members_accepted_removed_excl AND the UNIQUE partial index
--       idx_brand_team_members_brand_user_active are re-proved over the whole
--       fixture.
--   T6  REPLAY AND CYCLE. A->B->A->B->A through the real RPC, asserting after
--       every hop that the brand has exactly ONE active accepted brand_owner
--       row, that it belongs to brands.account_id, and that every prior owner
--       reads 0 — the property a soft-close plus insert could break by
--       accumulating active rows.
--   T7  SOFT-DELETED BRANDS. Both arms of biz_brand_effective_rank are gated
--       on b.deleted_at IS NULL, so a soft-deleted brand reads 0 for everyone
--       and hides a wrong membership write completely. Reassign while
--       soft-deleted, then undelete; and soft-delete after a reassignment,
--       then undelete. The membership write must be correct on the far side of
--       the gate, not merely invisible behind it.
--   T8  ATOMICITY. A failure after the membership block must take the
--       account_id change with it. Proved by forcing a raise in the same
--       subtransaction and reading both back.
--   T9  THE SCHEMA FACT THE MIGRATION HEADER GETS WRONG. The header says
--       "there is no unique constraint preventing" two active rows for one
--       (brand_id, user_id). There is: idx_brand_team_members_brand_user_active.
--       Pinned here so the next reader trusts the index and not the comment.
--   T10 THE PREDICATE'S BLIND SPOT, reported and NOT pinned. The fix closes
--       the row belonging to the PRE-UPDATE brands.account_id. Any OTHER
--       active accepted brand_owner row on the same brand survives the
--       handover at rank 60 — and one is reachable through the ordinary,
--       audited admin_set_team_member_role RPC. The in-scope guarantee is
--       asserted hard; the wider hole RAISEs WARNING rather than being frozen
--       into an assertion, so that fixing it does not turn this suite red.
--   T11 TWO CONCURRENT REASSIGNMENTS OF THE SAME BRAND, through dblink, fully
--       ASSERTED. Without `FOR UPDATE` on the SELECT that captures the outgoing
--       owner, a second caller reads that owner from a snapshot taken before it
--       takes the row lock, so it revokes a STALE owner and leaves the real one
--       active at rank 60 — this issue's own defect, reintroduced by a race,
--       with the stale value written into the audit row too. Six properties are
--       asserted: the calls serialize, the last committed writer owns the brand,
--       nobody holds two active rows, the accepted/removed CHECK survives, the
--       owner is never left with no membership row at all, and — the one that
--       carries the defect itself — no brand_owner row outlives the handover.
--       The last of those was a WARNING while the race was live and became an
--       assertion when the lock landed; see the comment at the assertion.
--
-- Every group CALLS the shipped RPC and reads the server authority
-- (biz_brand_effective_rank, the real RLS policies, the real constraints).
-- Nothing is decided from source text. One transaction, ROLLBACK at the end.
-- Never production.
-- ===========================================================================
\set ON_ERROR_STOP on
BEGIN;

-- ---------------------------------------------------------------------------
-- Fixtures. brand_team_members.user_id is FK -> auth.users(id);
-- brands.account_id is FK -> creator_accounts(id) and is NOT NULL, so every
-- principal needs both rows.
--   ...01 active admin        ...05 co-owner (T10)
--   ...02 original owner      ...06 revoked admin (T4)
--   ...03 incoming owner      ...07 soft-deleted account (T4)
--   ...04 third owner (T6)
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
VALUES
  ('3622a000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','issue3622-tester-admin@example.test',now(),now()),
  ('3622a000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','issue3622-tester-owner-a@example.test',now(),now()),
  ('3622a000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','issue3622-tester-owner-b@example.test',now(),now()),
  ('3622a000-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','issue3622-tester-owner-c@example.test',now(),now()),
  ('3622a000-0000-4000-8000-000000000005','00000000-0000-0000-0000-000000000000','authenticated','authenticated','issue3622-tester-coowner@example.test',now(),now()),
  ('3622a000-0000-4000-8000-000000000006','00000000-0000-0000-0000-000000000000','authenticated','authenticated','issue3622-tester-revoked@example.test',now(),now()),
  ('3622a000-0000-4000-8000-000000000007','00000000-0000-0000-0000-000000000000','authenticated','authenticated','issue3622-tester-deleted@example.test',now(),now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.admin_users (email, role, status) VALUES
  ('issue3622-tester-admin@example.test','admin','active'),
  ('issue3622-tester-revoked@example.test','admin','revoked')
ON CONFLICT (email) DO UPDATE SET role = excluded.role, status = excluded.status;

INSERT INTO public.creator_accounts (id) VALUES
  ('3622a000-0000-4000-8000-000000000002'),
  ('3622a000-0000-4000-8000-000000000003'),
  ('3622a000-0000-4000-8000-000000000004'),
  ('3622a000-0000-4000-8000-000000000005'),
  ('3622a000-0000-4000-8000-000000000006')
ON CONFLICT (id) DO NOTHING;

-- A soft-deleted creator_account: invalid_new_owner must reject it (the
-- implementor only tests an account that does not exist at all).
INSERT INTO public.creator_accounts (id, deleted_at)
VALUES ('3622a000-0000-4000-8000-000000000007', now())
ON CONFLICT (id) DO UPDATE SET deleted_at = excluded.deleted_at;

-- Brands, one per axis so no group can be polluted by another's writes.
INSERT INTO public.brands (id, account_id, name, slug) VALUES
  ('3622a100-0000-4000-8000-000000000001','3622a000-0000-4000-8000-000000000002','I3622T Escalation','i3622tescalation'),
  ('3622a100-0000-4000-8000-000000000002','3622a000-0000-4000-8000-000000000002','I3622T Guard 2101','i3622tguard2101'),
  ('3622a100-0000-4000-8000-000000000003','3622a000-0000-4000-8000-000000000002','I3622T Refusals','i3622trefusals'),
  ('3622a100-0000-4000-8000-000000000004','3622a000-0000-4000-8000-000000000002','I3622T Unaccepted Owner','i3622tunacceptedowner'),
  ('3622a100-0000-4000-8000-000000000005','3622a000-0000-4000-8000-000000000002','I3622T Unaccepted Lower','i3622tunacceptedlower'),
  ('3622a100-0000-4000-8000-000000000006','3622a000-0000-4000-8000-000000000002','I3622T Removed Only','i3622tremovedonly'),
  ('3622a100-0000-4000-8000-000000000007','3622a000-0000-4000-8000-000000000002','I3622T Cycle','i3622tcycle'),
  ('3622a100-0000-4000-8000-000000000008','3622a000-0000-4000-8000-000000000002','I3622T Soft Deleted','i3622tsoftdeleted'),
  ('3622a100-0000-4000-8000-000000000009','3622a000-0000-4000-8000-000000000002','I3622T Delete After','i3622tdeleteafter'),
  ('3622a100-0000-4000-8000-00000000000a','3622a000-0000-4000-8000-000000000002','I3622T Atomicity','i3622tatomicity'),
  ('3622a100-0000-4000-8000-00000000000b','3622a000-0000-4000-8000-000000000002','I3622T Co Owner','i3622tcoowner'),
  ('3622a100-0000-4000-8000-00000000000c','3622a000-0000-4000-8000-000000000002','I3622T Sibling Path','i3622tsiblingpath');

-- The two arms of biz_brand_effective_rank, computed separately, so "is the
-- membership row really there" is never answered by the account_id arm.
-- Bodies mirror the live definition (20260819000000 §5).
CREATE OR REPLACE FUNCTION pg_temp.i3622t_arm_account(p_brand uuid, p_user uuid)
RETURNS integer LANGUAGE sql STABLE AS $fn$
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM public.brands b
     WHERE b.id = p_brand AND b.account_id = p_user AND b.deleted_at IS NULL
  ) THEN public.biz_role_rank('brand_owner') ELSE 0 END;
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.i3622t_arm_membership(p_brand uuid, p_user uuid)
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

-- A full, ordered, byte-comparable snapshot of one brand's membership. Used by
-- T3/T4/T8 so "membership was not touched" means every column of every row,
-- not one rank that happens to agree.
CREATE OR REPLACE FUNCTION pg_temp.i3622t_snapshot(p_brand uuid)
RETURNS jsonb LANGUAGE sql STABLE AS $fn$
  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.id), '[]'::jsonb)
    FROM (
      SELECT m.id, m.brand_id, m.user_id, m.role, m.invited_at, m.accepted_at,
             m.removed_at, m.permissions_override
        FROM public.brand_team_members m
       WHERE m.brand_id = p_brand
    ) t;
$fn$;

-- The exclusion CHECK and the UNIQUE partial index, re-proved over the whole
-- fixture after every mutating group. A silent violation of either would mean
-- the RPC had corrupted the table rather than maintained it.
CREATE OR REPLACE FUNCTION pg_temp.i3622t_assert_constraints(p_label text)
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE v_bad integer;
BEGIN
  SELECT count(*) INTO v_bad FROM public.brand_team_members m
   WHERE m.removed_at IS NOT NULL AND m.accepted_at IS NULL;
  IF v_bad <> 0 THEN
    RAISE EXCEPTION 'ISSUE-3622 % FAIL: % row(s) violate brand_team_members_accepted_removed_excl (removed_at set on a never-accepted row)', p_label, v_bad;
  END IF;

  SELECT count(*) INTO v_bad FROM (
    SELECT m.brand_id, m.user_id FROM public.brand_team_members m
     WHERE m.removed_at IS NULL
     GROUP BY m.brand_id, m.user_id HAVING count(*) > 1
  ) d;
  IF v_bad <> 0 THEN
    RAISE EXCEPTION 'ISSUE-3622 % FAIL: % (brand_id,user_id) pair(s) hold more than one ACTIVE row — idx_brand_team_members_brand_user_active should make this impossible', p_label, v_bad;
  END IF;
END;
$fn$;

-- ===========================================================================
-- T1 — ESCALATION REACHABILITY. Removal is only a real control if the person
-- it removed cannot undo it. Every attempt below is made BY THE REMOVED OWNER,
-- under SET ROLE authenticated with their own request.jwt.claim.sub — the
-- posture PostgREST gives a signed-in user, with RLS in force.
-- ===========================================================================
DO $t1$
DECLARE v_rank integer;
BEGIN
  PERFORM set_config('request.jwt.claim.sub','3622a000-0000-4000-8000-000000000001', true);
  PERFORM public.admin_reassign_brand_owner(
    '3622a100-0000-4000-8000-000000000001','3622a000-0000-4000-8000-000000000003',
    'issue 3622 tester T1 handover');

  v_rank := public.biz_brand_effective_rank(
    '3622a100-0000-4000-8000-000000000001','3622a000-0000-4000-8000-000000000002');
  IF v_rank <> 0 THEN
    RAISE EXCEPTION 'ISSUE-3622 T1 FAIL: precondition — removed owner starts at rank % not 0', v_rank;
  END IF;
  PERFORM pg_temp.i3622t_assert_constraints('T1 setup');
END
$t1$;

-- Become the removed owner. Role switch at statement level so the attacks run
-- under the real RLS identity rather than a definer's.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','3622a000-0000-4000-8000-000000000002', true);

DO $t1attack$
DECLARE
  v_brand    uuid := '3622a100-0000-4000-8000-000000000001';
  v_me       uuid := '3622a000-0000-4000-8000-000000000002';
  v_new      uuid := '3622a000-0000-4000-8000-000000000003';
  v_rows     integer;
  v_visible  integer;
  v_refusals integer := 0;
  v_attempts integer := 0;
BEGIN
  -- Read access to their OWN history is by design ("Members and admins read
  -- brand_team_members": user_id = auth.uid() OR admin_plus). Assert it is
  -- exactly that and nothing more — one row, their own, and the new owner's
  -- row invisible to them.
  SELECT count(*) INTO v_visible FROM public.brand_team_members WHERE brand_id = v_brand;
  IF v_visible <> 1 THEN
    RAISE EXCEPTION 'ISSUE-3622 T1 FAIL: removed owner sees % membership row(s) on the brand, expected exactly their own 1', v_visible;
  END IF;
  SELECT count(*) INTO v_visible FROM public.brand_team_members
   WHERE brand_id = v_brand AND user_id = v_new;
  IF v_visible <> 0 THEN
    RAISE EXCEPTION 'ISSUE-3622 T1 FAIL: removed owner can read the NEW owner''s membership row';
  END IF;

  -- T1.1 clear their own removed_at — the single write that would restore 60.
  v_attempts := v_attempts + 1;
  BEGIN
    UPDATE public.brand_team_members SET removed_at = NULL
     WHERE brand_id = v_brand AND user_id = v_me;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 0 THEN
      RAISE EXCEPTION 'ISSUE-3622 T1.1 FAIL: removed owner cleared removed_at on % of their own row(s) — removal is self-reversible and the #3622 contract does not hold', v_rows;
    END IF;
    v_refusals := v_refusals + 1;
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN v_refusals := v_refusals + 1;
  END;

  -- T1.2 rewrite their own role (in case a policy gates removed_at but not role).
  v_attempts := v_attempts + 1;
  BEGIN
    UPDATE public.brand_team_members SET role = 'brand_owner', removed_at = NULL, accepted_at = now()
     WHERE brand_id = v_brand AND user_id = v_me;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 0 THEN
      RAISE EXCEPTION 'ISSUE-3622 T1.2 FAIL: removed owner rewrote % of their own row(s) back to an active brand_owner', v_rows;
    END IF;
    v_refusals := v_refusals + 1;
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN v_refusals := v_refusals + 1;
  END;

  -- T1.3 rewrite the NEW owner's row (demote them, or point it at themselves).
  v_attempts := v_attempts + 1;
  BEGIN
    UPDATE public.brand_team_members SET user_id = v_me
     WHERE brand_id = v_brand AND user_id = v_new;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 0 THEN
      RAISE EXCEPTION 'ISSUE-3622 T1.3 FAIL: removed owner rewrote % of the NEW owner''s row(s)', v_rows;
    END IF;
    v_refusals := v_refusals + 1;
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN v_refusals := v_refusals + 1;
  END;

  -- T1.4 insert a brand new active owner row for themselves.
  v_attempts := v_attempts + 1;
  BEGIN
    INSERT INTO public.brand_team_members (brand_id, user_id, role, invited_at, accepted_at)
    VALUES (v_brand, v_me, 'brand_owner', now(), now());
    RAISE EXCEPTION 'ISSUE-3622 T1.4 FAIL: removed owner INSERTed a fresh active brand_owner row for themselves';
  EXCEPTION WHEN insufficient_privilege OR check_violation OR unique_violation THEN
    v_refusals := v_refusals + 1;
  END;

  -- T1.5 delete their own removed row (a clean slate, then re-invite/insert).
  v_attempts := v_attempts + 1;
  BEGIN
    DELETE FROM public.brand_team_members WHERE brand_id = v_brand AND user_id = v_me;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 0 THEN
      RAISE EXCEPTION 'ISSUE-3622 T1.5 FAIL: removed owner DELETEd % of their own row(s), erasing the revocation record', v_rows;
    END IF;
    v_refusals := v_refusals + 1;
  EXCEPTION WHEN insufficient_privilege THEN v_refusals := v_refusals + 1;
  END;

  -- T1.6 delete the NEW owner's row — does not restore them, but it would
  -- strip the incoming owner's membership arm and is a denial-of-service.
  v_attempts := v_attempts + 1;
  BEGIN
    DELETE FROM public.brand_team_members WHERE brand_id = v_brand AND user_id = v_new;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 0 THEN
      RAISE EXCEPTION 'ISSUE-3622 T1.6 FAIL: removed owner DELETEd % of the NEW owner''s row(s)', v_rows;
    END IF;
    v_refusals := v_refusals + 1;
  EXCEPTION WHEN insufficient_privilege THEN v_refusals := v_refusals + 1;
  END;

  -- T1.7 the three admin team RPCs. The implementor proves the reassign RPC
  -- refuses a non-admin; these two are a different surface with the same
  -- is_admin_user() gate, and either would hand the ex-owner their row back.
  v_attempts := v_attempts + 1;
  BEGIN
    PERFORM public.admin_reassign_brand_owner(v_brand, v_me, 'ex-owner takes it back');
    RAISE EXCEPTION 'ISSUE-3622 T1.7 FAIL: removed owner reassigned the brand to themselves';
  EXCEPTION WHEN others THEN
    IF sqlerrm LIKE '%ISSUE-3622%' THEN RAISE; END IF;
    IF sqlerrm NOT LIKE '%not_authorized%' AND sqlerrm NOT LIKE '%permission denied%' THEN
      RAISE EXCEPTION 'ISSUE-3622 T1.7 FAIL: admin_reassign_brand_owner refused a non-admin with the wrong error: %', sqlerrm;
    END IF;
    v_refusals := v_refusals + 1;
  END;

  v_attempts := v_attempts + 1;
  BEGIN
    PERFORM public.admin_set_team_member_role(
      (SELECT m.id FROM public.brand_team_members m WHERE m.brand_id = v_brand AND m.user_id = v_me),
      'brand_owner', 'ex-owner promotes themselves');
    RAISE EXCEPTION 'ISSUE-3622 T1.7 FAIL: removed owner called admin_set_team_member_role on their own row';
  EXCEPTION WHEN others THEN
    IF sqlerrm LIKE '%ISSUE-3622%' THEN RAISE; END IF;
    IF sqlerrm NOT LIKE '%not_authorized%' AND sqlerrm NOT LIKE '%permission denied%' THEN
      RAISE EXCEPTION 'ISSUE-3622 T1.7 FAIL: admin_set_team_member_role refused with the wrong error: %', sqlerrm;
    END IF;
    v_refusals := v_refusals + 1;
  END;

  v_attempts := v_attempts + 1;
  BEGIN
    PERFORM public.admin_remove_team_member(
      (SELECT m.id FROM public.brand_team_members m WHERE m.brand_id = v_brand AND m.user_id = v_me),
      'ex-owner erases the revocation');
    RAISE EXCEPTION 'ISSUE-3622 T1.7 FAIL: removed owner called admin_remove_team_member';
  EXCEPTION WHEN others THEN
    IF sqlerrm LIKE '%ISSUE-3622%' THEN RAISE; END IF;
    IF sqlerrm NOT LIKE '%not_authorized%' AND sqlerrm NOT LIKE '%permission denied%' THEN
      RAISE EXCEPTION 'ISSUE-3622 T1.7 FAIL: admin_remove_team_member refused with the wrong error: %', sqlerrm;
    END IF;
    v_refusals := v_refusals + 1;
  END;

  IF v_refusals <> v_attempts THEN
    RAISE EXCEPTION 'ISSUE-3622 T1 FAIL: only % of % escalation attempts were refused', v_refusals, v_attempts;
  END IF;
  RAISE NOTICE 'ISSUE-3622 T1: all % escalation routes refused for the removed owner', v_attempts;
END
$t1attack$;

RESET ROLE;

DO $t1after$
DECLARE v_rank integer; v_arm_a integer; v_arm_b integer;
BEGIN
  v_rank  := public.biz_brand_effective_rank('3622a100-0000-4000-8000-000000000001','3622a000-0000-4000-8000-000000000002');
  v_arm_a := pg_temp.i3622t_arm_account('3622a100-0000-4000-8000-000000000001','3622a000-0000-4000-8000-000000000002');
  v_arm_b := pg_temp.i3622t_arm_membership('3622a100-0000-4000-8000-000000000001','3622a000-0000-4000-8000-000000000002');
  IF v_rank <> 0 OR v_arm_a <> 0 OR v_arm_b <> 0 THEN
    RAISE EXCEPTION 'ISSUE-3622 T1 FAIL: after every attack the removed owner reads effective=%, account_id arm=%, membership arm=%',
      v_rank, v_arm_a, v_arm_b;
  END IF;
  -- The incoming owner must be undamaged by the attacks too.
  IF public.biz_brand_effective_rank('3622a100-0000-4000-8000-000000000001','3622a000-0000-4000-8000-000000000003') <> 60
     OR pg_temp.i3622t_arm_membership('3622a100-0000-4000-8000-000000000001','3622a000-0000-4000-8000-000000000003') <> 60 THEN
    RAISE EXCEPTION 'ISSUE-3622 T1 FAIL: the attacks damaged the NEW owner''s access';
  END IF;
  PERFORM pg_temp.i3622t_assert_constraints('T1');
END
$t1after$;

-- ===========================================================================
-- T2 — THE WRITE SURFACE THAT KEEPS REMOVAL HOLDING. Removal only holds while
-- EVERY write door into brand_team_members is gated on rank >= 50, which a
-- rank-0 ex-owner fails. The day a self-addressed write policy is added
-- ("a member may update their own row"), the #3622 contract silently stops
-- being enforceable and T1 above would be the only thing that noticed. So the
-- policy shape is pinned by exact predicate, from the catalog rather than from
-- reading the GRANT and CREATE POLICY statements.
--
-- NOTE, deliberately NOT asserted: `authenticated` DOES hold EXECUTE on
-- accept_invite_and_transfer_brand_ownership. That is intentional (granted by
-- 20270104000000's definer-grant sweep, "client accept"), pre-dates this issue
-- and is out of scope — so it is proved harmless BEHAVIOURALLY below instead
-- of being turned into a red assertion about somebody else's design.
-- ===========================================================================
DO $t2$
DECLARE v_writes integer; v_gated integer;
BEGIN
  IF has_function_privilege('anon', 'public.admin_reassign_brand_owner(uuid,uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ISSUE-3622 T2 FAIL: anon can EXECUTE admin_reassign_brand_owner';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.admin_reassign_brand_owner(uuid,uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ISSUE-3622 T2 FAIL: authenticated lost EXECUTE on admin_reassign_brand_owner — the admin UI cannot call it';
  END IF;

  SELECT count(*) INTO v_writes FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'brand_team_members'
     AND cmd IN ('INSERT','UPDATE','DELETE');
  SELECT count(*) INTO v_gated FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'brand_team_members'
     AND cmd IN ('INSERT','UPDATE','DELETE')
     AND COALESCE(qual, with_check) = 'biz_is_brand_admin_plus_for_caller(brand_id)'
     AND COALESCE(with_check, qual) = 'biz_is_brand_admin_plus_for_caller(brand_id)';
  IF v_writes = 0 THEN
    RAISE EXCEPTION 'ISSUE-3622 T2 FAIL: no write policies found on brand_team_members — the comparison below is vacuous';
  END IF;
  IF v_gated <> v_writes THEN
    RAISE EXCEPTION 'ISSUE-3622 T2 FAIL: % of % write policies on brand_team_members are gated on something other than biz_is_brand_admin_plus_for_caller(brand_id). A self-addressed write policy would let a removed owner restore themselves and the #3622 removal contract would stop holding — re-run T1 and re-derive the contract.',
      v_writes - v_gated, v_writes;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.brand_team_members'::regclass AND relrowsecurity) THEN
    RAISE EXCEPTION 'ISSUE-3622 T2 FAIL: RLS is not enabled on brand_team_members';
  END IF;

  -- The owner-membership trigger function carries a default PUBLIC EXECUTE, but
  -- a RETURNS trigger function cannot be invoked outside a trigger — proved,
  -- not assumed, because "it has EXECUTE" is exactly the kind of grant reading
  -- that looks like a hole and is not one.
  BEGIN
    PERFORM public.biz_create_brand_owner_team_member();
    RAISE EXCEPTION 'ISSUE-3622 T2 FAIL: the owner-membership trigger function was invoked directly';
  EXCEPTION WHEN others THEN
    IF sqlerrm LIKE '%ISSUE-3622%' THEN RAISE; END IF;
    IF sqlerrm NOT LIKE '%trigger%' THEN
      RAISE EXCEPTION 'ISSUE-3622 T2 FAIL: direct call to the trigger fn failed for an unexpected reason: %', sqlerrm;
    END IF;
  END;
  RAISE NOTICE 'ISSUE-3622 T2: every write door into brand_team_members is gated on rank >= 50, which a removed owner fails';
END
$t2$;

-- The re-invitation door, probed as the removed ex-owner under their own
-- identity. They hold EXECUTE, so the only thing standing between them and a
-- transfer is an invitation token they cannot mint.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','3622a000-0000-4000-8000-000000000002', true);

DO $t2door$
DECLARE v_msg text := '';
BEGIN
  BEGIN
    PERFORM public.accept_invite_and_transfer_brand_ownership(
      'issue-3622-tester-fabricated-token-hash', '3622a000-0000-4000-8000-000000000002');
    RAISE EXCEPTION 'ISSUE-3622 T2 FAIL: a removed owner transferred a brand to themselves with a fabricated invitation token';
  EXCEPTION WHEN others THEN
    IF sqlerrm LIKE '%ISSUE-3622%' THEN RAISE; END IF;
    v_msg := sqlerrm;
  END;
  IF v_msg NOT LIKE '%invite_not_found%' AND v_msg NOT LIKE '%permission denied%' THEN
    RAISE EXCEPTION 'ISSUE-3622 T2 FAIL: the invite door refused with an unexpected error: %', v_msg;
  END IF;
  -- They also cannot mint one: brand_invitations is not writable by them.
  BEGIN
    INSERT INTO public.brand_invitations (brand_id, email, role, token_hash, expires_at, status)
    VALUES ('3622a100-0000-4000-8000-000000000001','issue3622-tester-owner-a@example.test',
            'brand_owner','issue-3622-tester-self-minted', now() + interval '1 day','pending');
    RAISE EXCEPTION 'ISSUE-3622 T2 FAIL: a removed owner MINTED a brand_owner invitation for the brand they lost';
  EXCEPTION WHEN others THEN
    IF sqlerrm LIKE '%ISSUE-3622%' THEN RAISE; END IF;
    IF sqlerrm NOT LIKE '%row-level security%' AND sqlerrm NOT LIKE '%permission denied%' THEN
      RAISE EXCEPTION 'ISSUE-3622 T2 FAIL: the invitation INSERT was refused for an unexpected reason: %', sqlerrm;
    END IF;
  END;
  RAISE NOTICE 'ISSUE-3622 T2: the invite door needs a token the removed owner can neither guess nor mint';
END
$t2door$;

RESET ROLE;

DO $t2rank$
BEGIN
  IF public.biz_brand_effective_rank('3622a100-0000-4000-8000-000000000001','3622a000-0000-4000-8000-000000000002') <> 0 THEN
    RAISE EXCEPTION 'ISSUE-3622 T2 FAIL: the invite-door attempts moved the removed owner off rank 0';
  END IF;
  PERFORM pg_temp.i3622t_assert_constraints('T2');
END
$t2rank$;

-- ===========================================================================
-- T2b — THE SIBLING TRANSFER PATH, DRIVEN FOR REAL. #3622's registry entry
-- states the rule as "ANY path that changes public.brands.account_id maintains
-- public.brand_team_members in the SAME transaction ... The contract is
-- REMOVAL, not demotion". There is a SECOND live path that changes
-- brands.account_id — accept_invite_and_transfer_brand_ownership — and it ships
-- the demotion that #3622 implemented, tested and rejected:
--
--   UPDATE public.brand_team_members SET role = 'brand_admin'
--    WHERE brand_id = ... AND role = 'brand_owner' AND removed_at IS NULL;
--
-- So the outgoing owner of an invite-based handover lands at rank 50, which by
-- the implementor's own analysis keeps biz_can_manage_payments_for_brand and is
-- self-restorable to 60 (issue #3632). This group DRIVES that path rather than
-- reading it, and reports what it observes.
--
-- REPORTED, NOT PINNED — fixing the sibling path is out of #3622's scope, and
-- an assertion here would go red the day somebody does fix it.
-- ===========================================================================
DO $t2b$
DECLARE
  v_brand uuid := '3622a100-0000-4000-8000-00000000000c';
  v_out   uuid := '3622a000-0000-4000-8000-000000000002';
  v_in    uuid := '3622a000-0000-4000-8000-000000000004';
  v_out_rank integer;
  v_role  text;
BEGIN
  INSERT INTO public.brand_invitations (brand_id, email, role, token_hash, expires_at, status)
  VALUES (v_brand, 'issue3622-tester-owner-c@example.test', 'brand_owner',
          'issue-3622-tester-sibling-path-token', now() + interval '7 days', 'pending');

  PERFORM public.accept_invite_and_transfer_brand_ownership(
    'issue-3622-tester-sibling-path-token', v_in);

  IF (SELECT b.account_id FROM public.brands b WHERE b.id = v_brand) <> v_in THEN
    RAISE EXCEPTION 'ISSUE-3622 T2b FAIL: the sibling path did not move brands.account_id — this group proves nothing';
  END IF;
  IF public.biz_brand_effective_rank(v_brand, v_in) <> 60 THEN
    RAISE EXCEPTION 'ISSUE-3622 T2b FAIL: the sibling path did not install the incoming owner at 60';
  END IF;

  v_out_rank := public.biz_brand_effective_rank(v_brand, v_out);
  SELECT m.role INTO v_role FROM public.brand_team_members m
   WHERE m.brand_id = v_brand AND m.user_id = v_out AND m.removed_at IS NULL;

  IF v_out_rank >= 50 THEN
    RAISE WARNING 'ISSUE-3622 T2b DIVERGENCE OBSERVED: the sibling ownership-transfer path (accept_invite_and_transfer_brand_ownership) leaves the outgoing owner at role % / rank % instead of removing them. #3622 chose REMOVAL precisely because demotion is self-reversible (#3632) and rank 50 retains biz_can_manage_payments_for_brand, yet that is what this live path still does — so the registry rule "ANY path that changes brands.account_id" holds on admin_reassign_brand_owner only. Reported on issue #3622, NOT asserted.',
      v_role, v_out_rank;
  ELSIF v_out_rank = 0 THEN
    RAISE NOTICE 'ISSUE-3622 T2b: the sibling transfer path now REMOVES the outgoing owner too — the registry rule holds on both paths';
  ELSE
    RAISE WARNING 'ISSUE-3622 T2b: the sibling transfer path leaves the outgoing owner at role % / rank % — neither removal nor the historical brand_admin demotion', v_role, v_out_rank;
  END IF;
  PERFORM pg_temp.i3622t_assert_constraints('T2b');
END
$t2b$;

-- ===========================================================================
-- T3 — THE ONE GUARD THE IMPLEMENTOR DID NOT TEST.
-- issue_2101_guard_brand_owner_transfer is a BEFORE UPDATE OF account_id
-- trigger on brands, so it raises from INSIDE the UPDATE that the #3622
-- membership block was deliberately placed AFTER. If the statement ordering
-- were wrong, this is the refusal that would leave a half-applied handover —
-- membership moved, ownership not. Compared against a FULL snapshot.
-- ===========================================================================
DO $t3$
DECLARE
  v_brand    uuid := '3622a100-0000-4000-8000-000000000002';
  v_event    uuid := '3622a200-0000-4000-8000-000000000001';
  v_before   jsonb;
  v_after    jsonb;
  v_acct_before uuid;
  v_acct_after  uuid;
  v_raised   text := '';
BEGIN
  INSERT INTO public.events (id, brand_id, title, slug) VALUES (v_event, v_brand, 'I3622T Guard Event', 'i3622tguardevent');
  INSERT INTO public.event_ticket_checkout_access (event_id, brand_id, mode)
  VALUES (v_event, v_brand, 'named_buyers');
  INSERT INTO public.checkout_sale_revocation_outbox
    (subject_type, subject_id, event_id, target_epoch, reason, state)
  VALUES ('ticket_checkout_session','3622a200-0000-4000-8000-0000000000ff', v_event, 1, 'issue 3622 tester', 'queued');

  IF NOT public.issue_2101_brand_has_active_named_ticket_checkout(v_brand) THEN
    RAISE EXCEPTION 'ISSUE-3622 T3 FAIL: fixture did not arm the 2101 guard — the refusal below would prove nothing';
  END IF;

  SELECT b.account_id INTO v_acct_before FROM public.brands b WHERE b.id = v_brand;
  v_before := pg_temp.i3622t_snapshot(v_brand);
  IF v_before = '[]'::jsonb THEN
    RAISE EXCEPTION 'ISSUE-3622 T3 FAIL: no membership rows to protect — the snapshot comparison would be vacuous';
  END IF;

  PERFORM set_config('request.jwt.claim.sub','3622a000-0000-4000-8000-000000000001', true);
  BEGIN
    PERFORM public.admin_reassign_brand_owner(v_brand, '3622a000-0000-4000-8000-000000000003',
      'issue 3622 tester T3 blocked by active checkout');
    RAISE EXCEPTION 'ISSUE-3622 T3 FAIL: the 2101 active-checkout guard did not refuse the reassignment';
  EXCEPTION WHEN others THEN
    IF sqlerrm LIKE '%ISSUE-3622%' THEN RAISE; END IF;
    v_raised := sqlerrm;
  END;

  IF v_raised NOT LIKE '%ACTIVE_CHECKOUTS_BLOCK_OWNER_TRANSFER%' THEN
    RAISE EXCEPTION 'ISSUE-3622 T3 FAIL: expected ACTIVE_CHECKOUTS_BLOCK_OWNER_TRANSFER, got %', v_raised;
  END IF;

  SELECT b.account_id INTO v_acct_after FROM public.brands b WHERE b.id = v_brand;
  v_after := pg_temp.i3622t_snapshot(v_brand);
  IF v_acct_after IS DISTINCT FROM v_acct_before THEN
    RAISE EXCEPTION 'ISSUE-3622 T3 FAIL: a refused reassignment still moved brands.account_id from % to %', v_acct_before, v_acct_after;
  END IF;
  IF v_after IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'ISSUE-3622 T3 FAIL: a refused reassignment MUTATED membership. before=% after=%', v_before, v_after;
  END IF;
  IF public.biz_brand_effective_rank(v_brand,'3622a000-0000-4000-8000-000000000002') <> 60 THEN
    RAISE EXCEPTION 'ISSUE-3622 T3 FAIL: the incumbent owner lost rank to a refused reassignment';
  END IF;
  IF public.biz_brand_effective_rank(v_brand,'3622a000-0000-4000-8000-000000000003') <> 0 THEN
    RAISE EXCEPTION 'ISSUE-3622 T3 FAIL: the would-be incoming owner gained rank from a refused reassignment';
  END IF;
  PERFORM pg_temp.i3622t_assert_constraints('T3');
  RAISE NOTICE 'ISSUE-3622 T3: the 2101 refusal left membership and ownership byte-identical';
END
$t3$;

-- ===========================================================================
-- T4 — EVERY refusal, snapshot-compared. Adds three inputs the implementor
-- does not exercise: a REVOKED admin, a SOFT-DELETED creator_account, and a
-- NULL new owner. A refusal that mutates membership is worse than the defect
-- this issue fixed, because it is silent in both directions.
-- ===========================================================================
DO $t4$
DECLARE
  v_brand  uuid := '3622a100-0000-4000-8000-000000000003';
  v_admin  uuid := '3622a000-0000-4000-8000-000000000001';
  v_before jsonb;
  v_acct   uuid;
  v_case   record;
  v_msg    text;
BEGIN
  SELECT b.account_id INTO v_acct FROM public.brands b WHERE b.id = v_brand;
  v_before := pg_temp.i3622t_snapshot(v_brand);

  FOR v_case IN
    SELECT * FROM (VALUES
      ('revoked admin',     '3622a000-0000-4000-8000-000000000006'::uuid, '3622a000-0000-4000-8000-000000000003'::uuid, 'revoked admin tries',  'not_authorized'),
      ('soft-deleted account', v_admin, '3622a000-0000-4000-8000-000000000007'::uuid, 'soft-deleted new owner', 'invalid_new_owner'),
      ('null new owner',    v_admin, NULL::uuid,                                      'null new owner',       'invalid_new_owner'),
      ('blank reason',      v_admin, '3622a000-0000-4000-8000-000000000003'::uuid, '',                     'reason_required'),
      ('null reason',       v_admin, '3622a000-0000-4000-8000-000000000003'::uuid, NULL,                   'reason_required')
    ) AS c(label, caller, new_owner, reason, expected)
  LOOP
    PERFORM set_config('request.jwt.claim.sub', v_case.caller::text, true);
    v_msg := '';
    BEGIN
      PERFORM public.admin_reassign_brand_owner(v_brand, v_case.new_owner, v_case.reason);
      RAISE EXCEPTION 'ISSUE-3622 T4 FAIL: case "%" was ACCEPTED — expected %', v_case.label, v_case.expected;
    EXCEPTION WHEN others THEN
      IF sqlerrm LIKE '%ISSUE-3622%' THEN RAISE; END IF;
      v_msg := sqlerrm;
    END;
    IF v_msg NOT LIKE '%' || v_case.expected || '%' THEN
      RAISE EXCEPTION 'ISSUE-3622 T4 FAIL: case "%" expected % but raised %', v_case.label, v_case.expected, v_msg;
    END IF;
    IF pg_temp.i3622t_snapshot(v_brand) IS DISTINCT FROM v_before THEN
      RAISE EXCEPTION 'ISSUE-3622 T4 FAIL: case "%" (%) MUTATED membership on its way out', v_case.label, v_case.expected;
    END IF;
    IF (SELECT b.account_id FROM public.brands b WHERE b.id = v_brand) IS DISTINCT FROM v_acct THEN
      RAISE EXCEPTION 'ISSUE-3622 T4 FAIL: case "%" still moved brands.account_id', v_case.label;
    END IF;
  END LOOP;

  PERFORM pg_temp.i3622t_assert_constraints('T4');
  RAISE NOTICE 'ISSUE-3622 T4: 5 refusal inputs, membership byte-identical after every one';
END
$t4$;

-- ===========================================================================
-- T5 — CONSTRAINT-STATE MATRIX for the INCOMING owner. The implementor covers
-- the outgoing never-accepted row (their group E). These are the incoming
-- states, where the risk is the opposite: a row that is promoted but left
-- UNACCEPTED reads 0 on the membership arm, so the two arms silently disagree
-- again and the consistency half of the fix is not delivered.
-- ===========================================================================
DO $t5$
DECLARE
  v_admin uuid := '3622a000-0000-4000-8000-000000000001';
  v_out   uuid := '3622a000-0000-4000-8000-000000000002';
  v_in    uuid := '3622a000-0000-4000-8000-000000000003';
  v_b_ua  uuid := '3622a100-0000-4000-8000-000000000004';  -- incoming: active, never-accepted brand_owner
  v_b_ul  uuid := '3622a100-0000-4000-8000-000000000005';  -- incoming: active, never-accepted LOWER role
  v_b_rm  uuid := '3622a100-0000-4000-8000-000000000006';  -- incoming: only an already-removed row
  v_count integer;
  v_role  text;
  v_acc   timestamptz;
  v_removed integer;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);

  -- (a) the incoming owner already holds an ACTIVE but NEVER-ACCEPTED
  -- brand_owner row. The EXISTS branch must accept it, or arm (b) stays 0.
  INSERT INTO public.brand_team_members (brand_id, user_id, role, invited_at, accepted_at)
  VALUES (v_b_ua, v_in, 'brand_owner', now(), NULL);
  PERFORM public.admin_reassign_brand_owner(v_b_ua, v_in, 'T5a unaccepted owner row');

  SELECT count(*) INTO v_count FROM public.brand_team_members
   WHERE brand_id = v_b_ua AND user_id = v_in AND removed_at IS NULL;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'ISSUE-3622 T5a FAIL: incoming owner holds % active rows, expected 1', v_count;
  END IF;
  SELECT accepted_at INTO v_acc FROM public.brand_team_members
   WHERE brand_id = v_b_ua AND user_id = v_in AND removed_at IS NULL;
  IF v_acc IS NULL THEN
    RAISE EXCEPTION 'ISSUE-3622 T5a FAIL: the incoming owner''s pre-existing owner row was left UNACCEPTED — the membership arm reads 0 and the two arms disagree exactly as before the fix';
  END IF;
  IF pg_temp.i3622t_arm_membership(v_b_ua, v_in) <> 60
     OR pg_temp.i3622t_arm_account(v_b_ua, v_in) <> 60 THEN
    RAISE EXCEPTION 'ISSUE-3622 T5a FAIL: arms disagree — account=%, membership=%',
      pg_temp.i3622t_arm_account(v_b_ua, v_in), pg_temp.i3622t_arm_membership(v_b_ua, v_in);
  END IF;
  IF public.biz_brand_effective_rank(v_b_ua, v_out) <> 0 THEN
    RAISE EXCEPTION 'ISSUE-3622 T5a FAIL: outgoing owner retained rank';
  END IF;

  -- (b) the incoming owner holds an ACTIVE but NEVER-ACCEPTED row at a LOWER
  -- role. The promote branch must both raise the role AND stamp accepted_at.
  INSERT INTO public.brand_team_members (brand_id, user_id, role, invited_at, accepted_at)
  VALUES (v_b_ul, v_in, 'scanner', now(), NULL);
  PERFORM public.admin_reassign_brand_owner(v_b_ul, v_in, 'T5b unaccepted lower role');

  SELECT count(*) INTO v_count FROM public.brand_team_members
   WHERE brand_id = v_b_ul AND user_id = v_in AND removed_at IS NULL;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'ISSUE-3622 T5b FAIL: incoming owner holds % active rows, expected 1', v_count;
  END IF;
  SELECT role, accepted_at INTO v_role, v_acc FROM public.brand_team_members
   WHERE brand_id = v_b_ul AND user_id = v_in AND removed_at IS NULL;
  IF v_role <> 'brand_owner' THEN
    RAISE EXCEPTION 'ISSUE-3622 T5b FAIL: promoted row left at role %', v_role;
  END IF;
  IF v_acc IS NULL THEN
    RAISE EXCEPTION 'ISSUE-3622 T5b FAIL: promoted row was left UNACCEPTED — membership arm reads 0';
  END IF;
  IF pg_temp.i3622t_arm_membership(v_b_ul, v_in) <> 60 THEN
    RAISE EXCEPTION 'ISSUE-3622 T5b FAIL: membership arm is % not 60', pg_temp.i3622t_arm_membership(v_b_ul, v_in);
  END IF;

  -- (c) the incoming owner holds ONLY an already-REMOVED row. A fresh active
  -- row must be inserted; the historical row must be left exactly as it was
  -- (the revocation record is evidence and must not be resurrected in place).
  INSERT INTO public.brand_team_members (brand_id, user_id, role, invited_at, accepted_at, removed_at)
  VALUES (v_b_rm, v_in, 'brand_admin', now() - interval '2 days', now() - interval '2 days', now() - interval '1 day');
  PERFORM public.admin_reassign_brand_owner(v_b_rm, v_in, 'T5c removed row only');

  SELECT count(*) INTO v_count FROM public.brand_team_members
   WHERE brand_id = v_b_rm AND user_id = v_in AND removed_at IS NULL AND role = 'brand_owner'
     AND accepted_at IS NOT NULL;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'ISSUE-3622 T5c FAIL: expected exactly 1 fresh active accepted owner row, found %', v_count;
  END IF;
  SELECT count(*) INTO v_removed FROM public.brand_team_members
   WHERE brand_id = v_b_rm AND user_id = v_in AND removed_at IS NOT NULL AND role = 'brand_admin';
  IF v_removed <> 1 THEN
    RAISE EXCEPTION 'ISSUE-3622 T5c FAIL: the historical removed row was altered or erased (% remain)', v_removed;
  END IF;
  IF pg_temp.i3622t_arm_membership(v_b_rm, v_in) <> 60 THEN
    RAISE EXCEPTION 'ISSUE-3622 T5c FAIL: membership arm is % not 60', pg_temp.i3622t_arm_membership(v_b_rm, v_in);
  END IF;

  PERFORM pg_temp.i3622t_assert_constraints('T5');
  RAISE NOTICE 'ISSUE-3622 T5: incoming-owner states (never-accepted owner, never-accepted lower role, removed-only) all end accepted at rank 60';
END
$t5$;

-- ===========================================================================
-- T6 — REPLAY AND CYCLE. Five hops through the real RPC, including handing the
-- brand BACK to a previous owner. A soft-close-plus-insert design can quietly
-- accumulate active rows or resurrect a closed one; this asserts the whole
-- invariant after every hop rather than at the end.
-- ===========================================================================
DO $t6$
DECLARE
  v_admin uuid := '3622a000-0000-4000-8000-000000000001';
  v_brand uuid := '3622a100-0000-4000-8000-000000000007';
  v_chain uuid[] := ARRAY[
    '3622a000-0000-4000-8000-000000000003',
    '3622a000-0000-4000-8000-000000000002',
    '3622a000-0000-4000-8000-000000000004',
    '3622a000-0000-4000-8000-000000000002',
    '3622a000-0000-4000-8000-000000000003'
  ]::uuid[];
  v_all   uuid[] := ARRAY[
    '3622a000-0000-4000-8000-000000000002',
    '3622a000-0000-4000-8000-000000000003',
    '3622a000-0000-4000-8000-000000000004'
  ]::uuid[];
  v_i     integer;
  v_j     integer;
  v_new   uuid;
  v_who   uuid;
  v_count integer;
  v_rank  integer;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  FOR v_i IN 1 .. array_length(v_chain, 1) LOOP
    v_new := v_chain[v_i];
    PERFORM public.admin_reassign_brand_owner(v_brand, v_new, format('T6 hop %s', v_i));

    IF (SELECT b.account_id FROM public.brands b WHERE b.id = v_brand) <> v_new THEN
      RAISE EXCEPTION 'ISSUE-3622 T6 FAIL: hop % did not move brands.account_id to %', v_i, v_new;
    END IF;

    SELECT count(*) INTO v_count FROM public.brand_team_members
     WHERE brand_id = v_brand AND removed_at IS NULL AND role = 'brand_owner' AND accepted_at IS NOT NULL;
    IF v_count <> 1 THEN
      RAISE EXCEPTION 'ISSUE-3622 T6 FAIL: after hop % the brand has % active accepted brand_owner row(s), expected exactly 1', v_i, v_count;
    END IF;

    SELECT user_id INTO v_who FROM public.brand_team_members
     WHERE brand_id = v_brand AND removed_at IS NULL AND role = 'brand_owner' AND accepted_at IS NOT NULL;
    IF v_who <> v_new THEN
      RAISE EXCEPTION 'ISSUE-3622 T6 FAIL: after hop % the sole active owner row belongs to % but the brand belongs to %', v_i, v_who, v_new;
    END IF;

    FOR v_j IN 1 .. array_length(v_all, 1) LOOP
      v_rank := public.biz_brand_effective_rank(v_brand, v_all[v_j]);
      IF v_all[v_j] = v_new THEN
        IF v_rank <> 60 OR pg_temp.i3622t_arm_membership(v_brand, v_all[v_j]) <> 60 THEN
          RAISE EXCEPTION 'ISSUE-3622 T6 FAIL: after hop % the current owner % reads effective=%, membership arm=%',
            v_i, v_all[v_j], v_rank, pg_temp.i3622t_arm_membership(v_brand, v_all[v_j]);
        END IF;
      ELSIF v_rank <> 0 THEN
        RAISE EXCEPTION 'ISSUE-3622 T6 FAIL: after hop % the former owner % still reads rank %', v_i, v_all[v_j], v_rank;
      END IF;
    END LOOP;

    PERFORM pg_temp.i3622t_assert_constraints(format('T6 hop %s', v_i));
  END LOOP;
  RAISE NOTICE 'ISSUE-3622 T6: 5 hops including two hand-backs, exactly one active owner row throughout';
END
$t6$;

-- ===========================================================================
-- T7 — SOFT-DELETED BRANDS. Both arms of biz_brand_effective_rank require
-- b.deleted_at IS NULL, so while a brand is soft-deleted EVERY rank is 0 and
-- a wrong membership write is completely invisible. The question is whether
-- the write is CORRECT on the far side of that gate — after an undelete,
-- which support performs — not whether it looks fine while hidden.
-- ===========================================================================
DO $t7$
DECLARE
  v_admin uuid := '3622a000-0000-4000-8000-000000000001';
  v_out   uuid := '3622a000-0000-4000-8000-000000000002';
  v_in    uuid := '3622a000-0000-4000-8000-000000000003';
  v_b1    uuid := '3622a100-0000-4000-8000-000000000008';  -- reassigned WHILE soft-deleted
  v_b2    uuid := '3622a100-0000-4000-8000-000000000009';  -- soft-deleted AFTER reassignment
  v_count integer;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);

  -- (a) reassign a brand that is already soft-deleted.
  UPDATE public.brands SET deleted_at = now() WHERE id = v_b1;
  IF public.biz_brand_effective_rank(v_b1, v_out) <> 0 THEN
    RAISE EXCEPTION 'ISSUE-3622 T7a FAIL: a soft-deleted brand still reports rank for its owner — the premise of this group is wrong';
  END IF;
  PERFORM public.admin_reassign_brand_owner(v_b1, v_in, 'T7a reassign a soft-deleted brand');

  -- everyone reads 0 while deleted; that hides the write, so undelete and look.
  IF public.biz_brand_effective_rank(v_b1, v_in) <> 0 THEN
    RAISE EXCEPTION 'ISSUE-3622 T7a FAIL: a soft-deleted brand reports a non-zero rank';
  END IF;
  UPDATE public.brands SET deleted_at = NULL WHERE id = v_b1;
  IF public.biz_brand_effective_rank(v_b1, v_out) <> 0 THEN
    RAISE EXCEPTION 'ISSUE-3622 T7a FAIL: after undelete the OUTGOING owner reads % — the soft-delete gate was hiding a retained grant',
      public.biz_brand_effective_rank(v_b1, v_out);
  END IF;
  IF public.biz_brand_effective_rank(v_b1, v_in) <> 60
     OR pg_temp.i3622t_arm_membership(v_b1, v_in) <> 60
     OR pg_temp.i3622t_arm_account(v_b1, v_in) <> 60 THEN
    RAISE EXCEPTION 'ISSUE-3622 T7a FAIL: after undelete the INCOMING owner reads effective=%, account=%, membership=%',
      public.biz_brand_effective_rank(v_b1, v_in),
      pg_temp.i3622t_arm_account(v_b1, v_in),
      pg_temp.i3622t_arm_membership(v_b1, v_in);
  END IF;
  SELECT count(*) INTO v_count FROM public.brand_team_members
   WHERE brand_id = v_b1 AND removed_at IS NULL AND role = 'brand_owner' AND accepted_at IS NOT NULL;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'ISSUE-3622 T7a FAIL: % active accepted owner row(s) after undelete, expected 1', v_count;
  END IF;

  -- (b) soft-delete AFTER a clean reassignment, then undelete.
  PERFORM public.admin_reassign_brand_owner(v_b2, v_in, 'T7b reassign then soft-delete');
  UPDATE public.brands SET deleted_at = now() WHERE id = v_b2;
  IF public.biz_brand_effective_rank(v_b2, v_in) <> 0
     OR public.biz_brand_effective_rank(v_b2, v_out) <> 0 THEN
    RAISE EXCEPTION 'ISSUE-3622 T7b FAIL: a soft-deleted brand grants rank to somebody';
  END IF;
  UPDATE public.brands SET deleted_at = NULL WHERE id = v_b2;
  IF public.biz_brand_effective_rank(v_b2, v_out) <> 0 THEN
    RAISE EXCEPTION 'ISSUE-3622 T7b FAIL: after undelete the outgoing owner reads %', public.biz_brand_effective_rank(v_b2, v_out);
  END IF;
  IF public.biz_brand_effective_rank(v_b2, v_in) <> 60
     OR pg_temp.i3622t_arm_membership(v_b2, v_in) <> 60 THEN
    RAISE EXCEPTION 'ISSUE-3622 T7b FAIL: after undelete the incoming owner is not 60 on both arms';
  END IF;

  PERFORM pg_temp.i3622t_assert_constraints('T7');
  RAISE NOTICE 'ISSUE-3622 T7: the membership write survives the deleted_at gate in both directions';
END
$t7$;

-- ===========================================================================
-- T8 — ATOMICITY. The membership block and the brands.account_id update must
-- live or die together. A partial application would be worse than the defect:
-- the ownership would move without the revocation, or the revocation would
-- land without the ownership.
-- ===========================================================================
DO $t8$
DECLARE
  v_admin  uuid := '3622a000-0000-4000-8000-000000000001';
  v_brand  uuid := '3622a100-0000-4000-8000-00000000000a';
  v_out    uuid := '3622a000-0000-4000-8000-000000000002';
  v_in     uuid := '3622a000-0000-4000-8000-000000000003';
  v_before jsonb;
  v_acct   uuid;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  SELECT b.account_id INTO v_acct FROM public.brands b WHERE b.id = v_brand;
  v_before := pg_temp.i3622t_snapshot(v_brand);

  -- The BEGIN/EXCEPTION block is an implicit subtransaction: the RPC's writes
  -- and the forced raise share it, so rolling it back must undo BOTH halves.
  BEGIN
    PERFORM public.admin_reassign_brand_owner(v_brand, v_in, 'T8 atomicity probe');
    -- sanity: the write really happened before we abort it
    IF public.biz_brand_effective_rank(v_brand, v_out) <> 0 THEN
      RAISE EXCEPTION 'ISSUE-3622 T8 FAIL: the reassignment did not take effect, so the rollback below proves nothing';
    END IF;
    RAISE EXCEPTION 'issue3622_tester_forced_abort';
  EXCEPTION WHEN others THEN
    IF sqlerrm LIKE '%ISSUE-3622%' THEN RAISE; END IF;
    IF sqlerrm <> 'issue3622_tester_forced_abort' THEN
      RAISE EXCEPTION 'ISSUE-3622 T8 FAIL: unexpected error during the atomicity probe: %', sqlerrm;
    END IF;
  END;

  IF (SELECT b.account_id FROM public.brands b WHERE b.id = v_brand) IS DISTINCT FROM v_acct THEN
    RAISE EXCEPTION 'ISSUE-3622 T8 FAIL: brands.account_id survived a rolled-back reassignment';
  END IF;
  IF pg_temp.i3622t_snapshot(v_brand) IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'ISSUE-3622 T8 FAIL: the membership change survived a rolled-back reassignment — a HALF-APPLIED handover. before=% after=%',
      v_before, pg_temp.i3622t_snapshot(v_brand);
  END IF;
  IF public.biz_brand_effective_rank(v_brand, v_out) <> 60
     OR public.biz_brand_effective_rank(v_brand, v_in) <> 0 THEN
    RAISE EXCEPTION 'ISSUE-3622 T8 FAIL: ranks did not return to the pre-call state';
  END IF;
  PERFORM pg_temp.i3622t_assert_constraints('T8');
  RAISE NOTICE 'ISSUE-3622 T8: ownership and membership roll back together';
END
$t8$;

-- ===========================================================================
-- T9 — the schema fact the migration header states BACKWARDS. The header says
-- "there is no unique constraint preventing" two active rows for one
-- (brand_id, user_id). There is one, and it has been there since the baseline:
-- idx_brand_team_members_brand_user_active. Pinned here from the catalog and
-- from an executed write, so the next reader trusts the index over the prose.
-- ===========================================================================
DO $t9$
DECLARE v_unique boolean; v_pred text; v_raised text := '';
BEGIN
  SELECT i.indisunique, pg_get_expr(i.indpred, i.indrelid)
    INTO v_unique, v_pred
    FROM pg_index i
   WHERE i.indexrelid = 'public.idx_brand_team_members_brand_user_active'::regclass;
  IF NOT COALESCE(v_unique, false) THEN
    RAISE EXCEPTION 'ISSUE-3622 T9 FAIL: idx_brand_team_members_brand_user_active is not UNIQUE';
  END IF;
  IF v_pred IS NULL OR v_pred NOT LIKE '%removed_at IS NULL%' THEN
    RAISE EXCEPTION 'ISSUE-3622 T9 FAIL: the index predicate is % — a change here changes what "one active row" means', v_pred;
  END IF;

  BEGIN
    INSERT INTO public.brand_team_members (brand_id, user_id, role, invited_at, accepted_at)
    VALUES ('3622a100-0000-4000-8000-000000000007','3622a000-0000-4000-8000-000000000003','brand_admin', now(), now());
    RAISE EXCEPTION 'ISSUE-3622 T9 FAIL: a SECOND active row for one (brand_id,user_id) was accepted';
  EXCEPTION WHEN unique_violation THEN v_raised := 'unique_violation';
            WHEN others THEN IF sqlerrm LIKE '%ISSUE-3622%' THEN RAISE; END IF; v_raised := sqlerrm;
  END;
  IF v_raised <> 'unique_violation' THEN
    RAISE EXCEPTION 'ISSUE-3622 T9 FAIL: expected unique_violation, got %', v_raised;
  END IF;
  RAISE NOTICE 'ISSUE-3622 T9: idx_brand_team_members_brand_user_active IS unique and DOES bar a second active row (the migration header says otherwise)';
END
$t9$;

-- ===========================================================================
-- T10 — THE PREDICATE'S BLIND SPOT. The fix closes only the row whose user_id
-- equals the PRE-UPDATE brands.account_id. A brand can carry a SECOND active
-- accepted brand_owner row for a different user — the ordinary, audited
-- admin_set_team_member_role RPC creates one, and the unique index does not
-- bar it because it constrains (brand_id, user_id), not (brand_id, role).
-- That row survives the handover at rank 60 on a brand it does not own, which
-- is the exact invariant the fix is documented as establishing.
--
-- REPORTED, NOT PINNED. The in-scope guarantee is asserted hard; the wider
-- hole is a WARNING so that widening the predicate later does not turn this
-- suite red. The sibling transfer path
-- (accept_invite_and_transfer_brand_ownership) uses the wider predicate
-- (role = 'brand_owner' AND removed_at IS NULL, no user_id filter).
-- ===========================================================================
DO $t10$
DECLARE
  v_admin uuid := '3622a000-0000-4000-8000-000000000001';
  v_out   uuid := '3622a000-0000-4000-8000-000000000002';
  v_in    uuid := '3622a000-0000-4000-8000-000000000003';
  v_co    uuid := '3622a000-0000-4000-8000-000000000005';
  v_brand uuid := '3622a100-0000-4000-8000-00000000000b';
  v_member uuid;
  v_co_rank integer;
  v_orphans integer;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);

  INSERT INTO public.brand_team_members (brand_id, user_id, role, invited_at, accepted_at)
  VALUES (v_brand, v_co, 'brand_admin', now(), now())
  RETURNING id INTO v_member;
  -- promoted through the real admin RPC, so this is not a hand-built row
  PERFORM public.admin_set_team_member_role(v_member, 'brand_owner', 'T10 second owner via the admin RPC');

  IF pg_temp.i3622t_arm_membership(v_brand, v_co) <> 60 THEN
    RAISE EXCEPTION 'ISSUE-3622 T10 FAIL: the co-owner fixture did not reach rank 60, so the group below proves nothing';
  END IF;

  PERFORM public.admin_reassign_brand_owner(v_brand, v_in, 'T10 handover with a co-owner present');

  -- IN SCOPE and asserted hard: the pre-update account_id holder is gone, and
  -- the incoming owner is whole on both arms.
  IF public.biz_brand_effective_rank(v_brand, v_out) <> 0 THEN
    RAISE EXCEPTION 'ISSUE-3622 T10 FAIL: the outgoing account owner retained rank % even with a co-owner present',
      public.biz_brand_effective_rank(v_brand, v_out);
  END IF;
  IF public.biz_brand_effective_rank(v_brand, v_in) <> 60
     OR pg_temp.i3622t_arm_membership(v_brand, v_in) <> 60 THEN
    RAISE EXCEPTION 'ISSUE-3622 T10 FAIL: the incoming owner is not 60 on both arms';
  END IF;
  PERFORM pg_temp.i3622t_assert_constraints('T10');

  -- OUT OF SCOPE, observed and reported rather than frozen.
  v_co_rank := public.biz_brand_effective_rank(v_brand, v_co);
  SELECT count(*) INTO v_orphans
    FROM public.brand_team_members m
    JOIN public.brands b ON b.id = m.brand_id
   WHERE m.brand_id = v_brand AND m.role = 'brand_owner'
     AND m.removed_at IS NULL AND m.accepted_at IS NOT NULL
     AND m.user_id <> b.account_id;
  IF v_co_rank = 60 OR v_orphans > 0 THEN
    RAISE WARNING 'ISSUE-3622 T10 DEFECT OBSERVED: a co-owner (% ) keeps rank % and % brand_owner row(s) outlive the handover on a brand they do not own. The fix closes only the row belonging to the PRE-UPDATE brands.account_id; the sibling accept_invite_and_transfer_brand_ownership uses the wider predicate with no user_id filter. Reachable today through admin_set_team_member_role. Reported on issue #3622, NOT asserted, so widening the predicate will not turn this suite red.',
      v_co, v_co_rank, v_orphans;
  ELSE
    RAISE NOTICE 'ISSUE-3622 T10: the co-owner hole is CLOSED — no brand_owner row outlives the handover (predicate has been widened since this suite was written)';
  END IF;
END
$t10$;

ROLLBACK;

-- ===========================================================================
-- T11 — TWO CONCURRENT REASSIGNMENTS OF THE SAME BRAND. Real sessions, real
-- lock contention, via dblink; nothing here can be reached from a single
-- session because the whole point is what the SECOND caller read before the
-- FIRST one committed.
--
-- WHY THIS IS THE ANGLE. admin_reassign_brand_owner captures the outgoing
-- owner from a snapshot taken BEFORE it locks anything:
--
--   SELECT to_jsonb(b) INTO v_before FROM public.brands b WHERE b.id = p_brand_id;
--   ...
--   UPDATE public.brands SET account_id = p_new_account_id ... ;
--   v_old_owner := (v_before->>'account_id')::uuid;
--
-- Without FOR UPDATE on that SELECT, a second session under READ COMMITTED can
-- read `v_before` while the first handover is still uncommitted, then block on
-- the UPDATE, then proceed once the first commits — carrying a v_old_owner that
-- is no longer the owner. It revokes a ghost and leaves the real outgoing owner
-- active at rank 60. The sibling transfer path has always taken that lock
-- (`SELECT * INTO v_brand_record FROM public.brands WHERE id = ... FOR UPDATE`),
-- which is why this was worth measuring rather than theorising about. The lock
-- is now on the reassign RPC too, so all SIX properties below are asserted.
--
-- DO NOT re-express the last of them as a check on the function's source. The
-- explanatory comment the rework put INSIDE the function body contains the
-- literal `FOR UPDATE`, so `position('FOR UPDATE' in prosrc)` answers TRUE over
-- a version with no lock at all. The lock is a property of the statement, not
-- of a phrase appearing somewhere in the text; this group races two real
-- sessions and reads the resulting rows, which is the only thing that cannot be
-- satisfied by a comment.
--
-- Fixtures are created and destroyed through a dblink session, so they are
-- committed (both workers must see the same rows) yet nothing is left behind
-- even when an assertion fires: the cleanup runs in the remote session, whose
-- writes are not rolled back by this one. Namespace 3622c*, used nowhere else.
-- ===========================================================================
\set ON_ERROR_STOP on
\getenv issue_3622_dblink_password PGPASSWORD
SET issue_3622.dblink_password TO :'issue_3622_dblink_password';
CREATE EXTENSION IF NOT EXISTS dblink;

DO $t11$
DECLARE
  v_conn text := pg_catalog.format(
    'dbname=%L user=%L password=%L host=%L port=%L',
    pg_catalog.current_database(),
    'supabase_admin',
    pg_catalog.current_setting('issue_3622.dblink_password'),
    pg_catalog.current_setting('unix_socket_directories'),
    pg_catalog.current_setting('port')
  );
  v_admin  text := '3622c000-0000-4000-8000-000000000001';
  v_own_a  text := '3622c000-0000-4000-8000-000000000002';
  v_own_b  text := '3622c000-0000-4000-8000-000000000003';
  v_own_c  text := '3622c000-0000-4000-8000-000000000004';
  v_brand  text := '3622c100-0000-4000-8000-000000000001';
  v_setup  text;
  v_clean  text;
  v_pid_b  integer;
  v_blocked boolean := false;
  v_i      integer;
  v_owner  uuid;
  v_stale  integer;
  v_active integer;
  v_dupes  integer;
  v_bad    integer;
  v_stale_rank integer;
  v_err    text := '';
BEGIN
  v_setup := format($sql$
    INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at) VALUES
      (%1$L,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','issue3622-race-admin@example.test',now(),now()),
      (%2$L,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','issue3622-race-a@example.test',now(),now()),
      (%3$L,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','issue3622-race-b@example.test',now(),now()),
      (%4$L,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','issue3622-race-c@example.test',now(),now())
      ON CONFLICT (id) DO NOTHING;
    INSERT INTO public.admin_users (email, role, status)
      VALUES ('issue3622-race-admin@example.test','admin','active')
      ON CONFLICT (email) DO UPDATE SET status='active';
    INSERT INTO public.creator_accounts (id) VALUES (%2$L),(%3$L),(%4$L) ON CONFLICT (id) DO NOTHING;
    INSERT INTO public.brands (id, account_id, name, slug)
      VALUES (%5$L, %2$L, 'I3622T Race', 'i3622trace') ON CONFLICT (id) DO NOTHING;
  $sql$, v_admin, v_own_a, v_own_b, v_own_c, v_brand);

  v_clean := format($sql$
    DELETE FROM public.admin_audit_log WHERE target_id = %5$L;
    DELETE FROM public.audit_log WHERE brand_id = %5$L;
    DELETE FROM public.brand_team_members WHERE brand_id = %5$L;
    DELETE FROM public.brands WHERE id = %5$L;
    DELETE FROM public.creator_accounts WHERE id IN (%2$L,%3$L,%4$L);
    DELETE FROM public.admin_users WHERE email = 'issue3622-race-admin@example.test';
    DELETE FROM auth.users WHERE id IN (%1$L,%2$L,%3$L,%4$L);
  $sql$, v_admin, v_own_a, v_own_b, v_own_c, v_brand);

  PERFORM dblink_connect('issue3622_race_setup', v_conn);
  BEGIN
    PERFORM dblink_exec('issue3622_race_setup', v_clean);   -- a previous aborted run
    PERFORM dblink_exec('issue3622_race_setup', v_setup);

    PERFORM dblink_connect('issue3622_race_a', v_conn);
    PERFORM dblink_connect('issue3622_race_b', v_conn);
    PERFORM dblink_exec('issue3622_race_a', 'BEGIN');
    PERFORM dblink_exec('issue3622_race_b', 'BEGIN');
    PERFORM * FROM dblink('issue3622_race_a',
      format('SELECT set_config(''request.jwt.claim.sub'',%L,false)', v_admin)) AS c(v text);
    PERFORM * FROM dblink('issue3622_race_b',
      format('SELECT set_config(''request.jwt.claim.sub'',%L,false)', v_admin)) AS c(v text);
    SELECT pid INTO v_pid_b FROM dblink('issue3622_race_b','SELECT pg_backend_pid()') AS w(pid integer);

    -- A performs the handover A -> B and holds it open, uncommitted.
    PERFORM * FROM dblink('issue3622_race_a',
      format('SELECT public.admin_reassign_brand_owner(%L,%L,''T11 race first'')', v_brand, v_own_b)
    ) AS r(v jsonb);

    -- B starts the handover A -> C asynchronously. Its snapshot of brands is
    -- taken now, while A is uncommitted, and it then blocks on A's row lock.
    PERFORM dblink_send_query('issue3622_race_b',
      format('SELECT public.admin_reassign_brand_owner(%L,%L,''T11 race second'')', v_brand, v_own_c));

    FOR v_i IN 1 .. 100 LOOP
      PERFORM pg_sleep(0.05);
      SELECT true INTO v_blocked FROM pg_stat_activity
       WHERE pid = v_pid_b AND wait_event_type = 'Lock';
      EXIT WHEN v_blocked;
    END LOOP;
    IF NOT COALESCE(v_blocked, false) THEN
      RAISE EXCEPTION 'ISSUE-3622 T11 FAIL: the second reassignment never blocked on the first — the two calls do not serialize on the brand row, so nothing stops them interleaving arbitrarily';
    END IF;

    PERFORM dblink_exec('issue3622_race_a', 'COMMIT');
    PERFORM * FROM dblink_get_result('issue3622_race_b') AS r(v jsonb);
    PERFORM * FROM dblink_get_result('issue3622_race_b') AS r(v jsonb);
    PERFORM dblink_exec('issue3622_race_b', 'COMMIT');

    -- ---- what MUST hold, whichever way the race resolves ----
    SELECT owner, active, dupes, bad, stale, stale_rank
      INTO v_owner, v_active, v_dupes, v_bad, v_stale, v_stale_rank
      FROM dblink('issue3622_race_setup', format($q$
        SELECT
          (SELECT b.account_id FROM public.brands b WHERE b.id = %1$L),
          (SELECT count(*) FROM public.brand_team_members m
            WHERE m.brand_id = %1$L AND m.removed_at IS NULL
              AND m.role = 'brand_owner' AND m.accepted_at IS NOT NULL),
          (SELECT count(*) FROM (SELECT 1 FROM public.brand_team_members m
             WHERE m.brand_id = %1$L AND m.removed_at IS NULL
             GROUP BY m.user_id HAVING count(*) > 1) d),
          (SELECT count(*) FROM public.brand_team_members m
            WHERE m.brand_id = %1$L AND m.removed_at IS NOT NULL AND m.accepted_at IS NULL),
          (SELECT count(*) FROM public.brand_team_members m
             JOIN public.brands b ON b.id = m.brand_id
            WHERE m.brand_id = %1$L AND m.role = 'brand_owner'
              AND m.removed_at IS NULL AND m.accepted_at IS NOT NULL
              AND m.user_id <> b.account_id),
          public.biz_brand_effective_rank(%1$L, %2$L)
      $q$, v_brand, v_own_b)) AS t(owner uuid, active bigint, dupes bigint,
                                   bad bigint, stale bigint, stale_rank integer);

    IF v_owner IS DISTINCT FROM v_own_c::uuid THEN
      RAISE EXCEPTION 'ISSUE-3622 T11 FAIL: after the race brands.account_id is % — the LAST committed writer should own the brand (%)', v_owner, v_own_c;
    END IF;
    IF v_dupes <> 0 THEN
      RAISE EXCEPTION 'ISSUE-3622 T11 FAIL: % user(s) hold more than one ACTIVE membership row after the race', v_dupes;
    END IF;
    IF v_bad <> 0 THEN
      RAISE EXCEPTION 'ISSUE-3622 T11 FAIL: % row(s) violate brand_team_members_accepted_removed_excl after the race', v_bad;
    END IF;
    IF v_active < 1 THEN
      RAISE EXCEPTION 'ISSUE-3622 T11 FAIL: the race left the brand with NO active accepted brand_owner row — the owner has no membership record at all';
    END IF;

    -- ---- the headline property, ASSERTED ----
    -- This was a RAISE WARNING while the race was live: failing a suite over a
    -- defect in code the branch had not yet fixed would only have made the lane
    -- red without telling anybody anything new. The lock landed, so the premise
    -- is gone — the condition no longer occurs, an assertion passes today, and
    -- it goes red the moment the lock is removed. That is the fails-on-revert
    -- property this group exists to provide, and it is the ONE assertion here
    -- that carries the exact condition #3622 exists to prevent.
    IF v_stale > 0 OR v_stale_rank >= 60 THEN
      RAISE EXCEPTION 'ISSUE-3622 T11 FAIL: two concurrent reassignments left % brand_owner row(s) active on a brand owned by somebody else, and the interleaved owner still reads rank % — the exact condition #3622 exists to prevent, reintroduced by a race. Cause: admin_reassign_brand_owner read `SELECT to_jsonb(b) INTO v_before FROM public.brands` WITHOUT `FOR UPDATE` before it took the row lock, so the second caller revoked a STALE v_old_owner and left the real outgoing owner untouched; the audit row it writes records the stale `before` too. The sibling accept_invite_and_transfer_brand_ownership takes the same lock. Restore `FOR UPDATE` on that SELECT. NOTE: do not check for the fix by matching the function source — the explanatory comment now inside the function body contains the literal `FOR UPDATE`, so `position(''FOR UPDATE'' in prosrc)` is TRUE over an unlocked version. This group measures the behaviour instead.',
        v_stale, v_stale_rank;
    END IF;
    RAISE NOTICE 'ISSUE-3622 T11: concurrent reassignments serialize AND leave no stale owner row (active=%, interleaved owner rank=%)', v_active, v_stale_rank;
  EXCEPTION WHEN others THEN
    v_err := sqlerrm;
  END;

  -- Cleanup happens in the REMOTE session, so it survives this block aborting.
  BEGIN PERFORM dblink_exec('issue3622_race_setup', v_clean); EXCEPTION WHEN others THEN NULL; END;
  FOREACH v_setup IN ARRAY ARRAY['issue3622_race_a','issue3622_race_b','issue3622_race_setup'] LOOP
    BEGIN PERFORM dblink_disconnect(v_setup); EXCEPTION WHEN others THEN NULL; END;
  END LOOP;
  IF v_err <> '' THEN RAISE EXCEPTION '%', v_err; END IF;
END
$t11$;
