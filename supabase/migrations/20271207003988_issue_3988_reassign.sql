-- #3988 — reassign staff tickets and product signals so handed-to-me alerts can fire.
-- Triggers issue_3988_staff_ticket_assigned_alert / product_signal_assigned already exist;
-- they need a write path that changes assigned_staff_id / owner_user_id.

CREATE OR REPLACE FUNCTION public.issue_3988_reassign_internal_thread(
  p_thread_id uuid,
  p_expected_revision integer,
  p_assigned_staff_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_before jsonb;
  v_revision integer;
BEGIN
  PERFORM public.issue_3720_support_operator_required();
  IF p_assigned_staff_id IS NULL THEN
    RAISE EXCEPTION 'assignee_required' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.support_staff
     WHERE user_id = p_assigned_staff_id AND enabled IS TRUE
  ) THEN
    RAISE EXCEPTION 'assignee_not_support_staff' USING ERRCODE = '22023';
  END IF;

  SELECT jsonb_build_object(
    'assigned_staff_id', assigned_staff_id,
    'revision', revision
  ) INTO v_before
    FROM public.support_internal_threads
   WHERE id = p_thread_id;

  UPDATE public.support_internal_threads
     SET assigned_staff_id = p_assigned_staff_id,
         updated_at = now(),
         revision = revision + 1
   WHERE id = p_thread_id AND revision = p_expected_revision
  RETURNING revision INTO v_revision;

  IF v_revision IS NULL THEN
    IF v_before IS NULL THEN
      RAISE EXCEPTION 'thread_not_found' USING ERRCODE = 'P0002';
    END IF;
    RAISE EXCEPTION 'stale_revision' USING ERRCODE = '40001';
  END IF;

  INSERT INTO public.support_product_workflow_audit(
    actor_user_id, action, entity_kind, entity_id, before_snapshot, after_snapshot
  ) VALUES (
    v_actor, 'internal_thread_reassigned', 'internal_thread', p_thread_id, v_before,
    jsonb_build_object(
      'assigned_staff_id', p_assigned_staff_id,
      'revision', v_revision
    )
  );

  RETURN v_revision;
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_3988_reassign_product_signal(
  p_signal_id uuid,
  p_expected_revision integer,
  p_owner_user_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_before jsonb;
  v_revision integer;
BEGIN
  PERFORM public.issue_3720_support_operator_required();
  IF p_owner_user_id IS NULL THEN
    RAISE EXCEPTION 'owner_required' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.support_staff
     WHERE user_id = p_owner_user_id AND enabled IS TRUE
  ) THEN
    RAISE EXCEPTION 'owner_not_support_staff' USING ERRCODE = '22023';
  END IF;

  SELECT jsonb_build_object(
    'owner_user_id', owner_user_id,
    'revision', revision
  ) INTO v_before
    FROM public.support_product_signals
   WHERE id = p_signal_id;

  UPDATE public.support_product_signals
     SET owner_user_id = p_owner_user_id,
         updated_at = now(),
         revision = revision + 1
   WHERE id = p_signal_id AND revision = p_expected_revision
  RETURNING revision INTO v_revision;

  IF v_revision IS NULL THEN
    IF v_before IS NULL THEN
      RAISE EXCEPTION 'signal_not_found' USING ERRCODE = 'P0002';
    END IF;
    RAISE EXCEPTION 'stale_revision' USING ERRCODE = '40001';
  END IF;

  INSERT INTO public.support_product_workflow_audit(
    actor_user_id, action, entity_kind, entity_id, before_snapshot, after_snapshot
  ) VALUES (
    v_actor, 'product_signal_reassigned', 'product_signal', p_signal_id, v_before,
    jsonb_build_object(
      'owner_user_id', p_owner_user_id,
      'revision', v_revision
    )
  );

  RETURN v_revision;
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_3988_reassign_internal_thread(uuid, integer, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_3988_reassign_product_signal(uuid, integer, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3988_reassign_internal_thread(uuid, integer, uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.issue_3988_reassign_product_signal(uuid, integer, uuid)
  TO authenticated, service_role;
