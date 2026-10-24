-- issue #3827 — keep manual name-based Admit on the same current-authority
-- gate as QR scanning.
--
CREATE OR REPLACE FUNCTION public.issue_3827_can_door_scan(
  p_event_id uuid,
  p_user_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    EXISTS (
      SELECT 1
        FROM public.event_scanners es
       WHERE es.event_id = p_event_id
         AND es.user_id = p_user_id
         AND es.removed_at IS NULL
         AND COALESCE((es.permissions ->> 'scan')::boolean, true)
    )
    OR EXISTS (
      SELECT 1
        FROM public.events e
        INNER JOIN public.brand_team_members m ON m.brand_id = e.brand_id
       WHERE e.id = p_event_id
         AND m.user_id = p_user_id
         AND m.role = 'scanner'
         AND m.removed_at IS NULL
         AND m.accepted_at IS NOT NULL
    )
    OR EXISTS (
      SELECT 1
        FROM public.events e
       WHERE e.id = p_event_id
         AND public.biz_brand_effective_rank(e.brand_id, p_user_id)
               >= public.biz_role_rank('event_manager'::text)
    );
$$;

REVOKE ALL ON FUNCTION public.issue_3827_can_door_scan(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.issue_3827_can_door_scan(uuid, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3827_can_door_scan(uuid, uuid) TO service_role;

COMMENT ON FUNCTION public.issue_3827_can_door_scan(uuid, uuid) IS
  'issue #3827: shared door permission for manual search/admit and QR scan; accepts explicit event scanners, accepted brand scanners, and current event-manager-or-higher brand authority.';

DO $probe$
DECLARE
  v_gate text := pg_get_functiondef(
    'public.issue_3827_can_door_scan(uuid,uuid)'::regprocedure
  );
  v_admit text := pg_get_functiondef(
    'public.biz_ticket_admit_by_id(uuid,uuid,uuid,text)'::regprocedure
  );
BEGIN
  IF position('event_scanners' IN v_gate) = 0
     OR position('m.role = ''scanner''' IN v_gate) = 0
     OR position('biz_brand_effective_rank' IN v_gate) = 0
     OR position('biz_role_rank(''event_manager''::text)' IN v_gate) = 0 THEN
    RAISE EXCEPTION 'issue #3827 probe: manual door authority paths drifted';
  END IF;
  IF position('issue_3827_can_door_scan' IN v_admit) = 0
     OR position('public.biz_ticket_scan(' IN v_admit) = 0 THEN
    RAISE EXCEPTION 'issue #3827 probe: manual admit no longer shares both gates';
  END IF;
  IF has_function_privilege(
       'anon', 'public.issue_3827_can_door_scan(uuid,uuid)', 'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated', 'public.issue_3827_can_door_scan(uuid,uuid)', 'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role', 'public.issue_3827_can_door_scan(uuid,uuid)', 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'issue #3827 probe: manual door authority ACL drift';
  END IF;
END
$probe$;
