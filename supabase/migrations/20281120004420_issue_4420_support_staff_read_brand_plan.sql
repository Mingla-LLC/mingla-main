-- #4420 (decision 3, approved by Seth 19 Nov): Mingla support staff see a
-- brand's Plan READ-ONLY in the Host app (the Messages thread's Plan rail and
-- panel). Re-creates brand_plan_can_read from its latest writer
-- (20280427024270_issue_4270_w3_brand_plan.sql) with one added read path:
-- an active support staff member (public.is_support_staff) or an active admin
-- (public.is_admin_user, only for the signed-in caller themself).
--
-- Writing stays rank-based: brand_plan_can_write still needs
-- biz_brand_effective_rank >= marketing_manager, and that rank never counts
-- support staff or admins, so they get can_add = false, can_edit = false and
-- 'read_only' from brand_plan_host_add.
--
-- Callers of brand_plan_can_read (all SECURITY DEFINER, all pass auth.uid()):
--   brand_plan_can_write      unchanged for staff (rank check still false)
--   brand_plan_for_host       staff now read the host view of the plan: posts,
--                             cards and only PUBLIC events (v_team is false for
--                             non-members), with can_add false
--   brand_plan_host_add       staff now get 'read_only' instead of 'not_found'
--   brand_plan_host_update /
--   brand_plan_host_remove    only the caller's own items; then can_write
--                             refuses staff
--
-- INVARIANT issue-4420-plan-staff-read-only: support staff and admins may read
-- a brand plan in the Host app and never write it (write = team rank only).
-- Static SQL, no data change, no backfill.

CREATE OR REPLACE FUNCTION public.brand_plan_can_read(p_brand_id uuid, p_uid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
  SELECT p_uid IS NOT NULL AND p_brand_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.brands b WHERE b.id = p_brand_id AND b.deleted_at IS NULL)
     AND (public.biz_is_brand_member_for_read(p_brand_id, p_uid)
          OR EXISTS (SELECT 1 FROM public.brand_team_members m
                      WHERE m.brand_id = p_brand_id AND m.user_id = p_uid
                        AND m.accepted_at IS NOT NULL AND m.removed_at IS NULL)
          -- #4420: Mingla support staff and admins read (never write).
          OR public.is_support_staff(p_uid)
          OR (p_uid = auth.uid() AND public.is_admin_user()))
$$;

REVOKE ALL ON FUNCTION public.brand_plan_can_read(uuid, uuid) FROM PUBLIC, anon, authenticated;

DO $self_check$
DECLARE r record;
BEGIN
  SELECT p.prosecdef, p.proconfig, p.prosrc INTO r FROM pg_catalog.pg_proc p
   WHERE p.oid = 'public.brand_plan_can_read(uuid,uuid)'::regprocedure;
  IF NOT r.prosecdef OR NOT (r.proconfig @> ARRAY['search_path=pg_catalog, pg_temp']) THEN
    RAISE EXCEPTION 'issue 4420 self-check: brand_plan_can_read is not pinned';
  END IF;
  IF r.prosrc NOT LIKE '%p_uid IS NOT NULL%b.deleted_at IS NULL%biz_is_brand_member_for_read(p_brand_id, p_uid)%m.accepted_at IS NOT NULL AND m.removed_at IS NULL%public.is_support_staff(p_uid)%p_uid = auth.uid() AND public.is_admin_user()%' THEN
    RAISE EXCEPTION 'issue 4420 self-check: the read rule is not as stated';
  END IF;
  IF has_function_privilege('anon', 'public.brand_plan_can_read(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.brand_plan_can_read(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue 4420 self-check: brand_plan_can_read is callable by clients';
  END IF;
  -- Writing stays rank-based.
  IF (SELECT p.prosrc FROM pg_catalog.pg_proc p WHERE p.oid = 'public.brand_plan_can_write(uuid,uuid)'::regprocedure)
       NOT LIKE '%biz_brand_effective_rank(p_brand_id, p_uid) >= public.biz_role_rank(''marketing_manager'')%' THEN
    RAISE EXCEPTION 'issue 4420 self-check: the write rule is no longer rank-based';
  END IF;
END
$self_check$;
