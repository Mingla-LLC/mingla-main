-- Issue #2830 — preserve the manifest's dependency order in Ari's durable
-- Website-completeness job and make owner approval the final step.

BEGIN;

CREATE OR REPLACE FUNCTION public.ari_has_active_brand_completeness_job(
  p_brand_id uuid
)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL OR NOT public.biz_is_brand_member_for_read(p_brand_id,v_actor) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.ari_agent_jobs
    WHERE user_id=v_actor AND brand_id=p_brand_id
      AND checkpoint->>'kind'='brand_completeness'
      AND status IN ('queued','running','paused','awaiting_approval')
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.ari_has_active_brand_completeness_job(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ari_has_active_brand_completeness_job(uuid)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ari_start_brand_completeness_job(
  p_brand_id uuid,
  p_takeover boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_manifest jsonb;
  v_job public.ari_agent_jobs%ROWTYPE;
  v_other_job public.ari_agent_jobs%ROWTYPE;
  v_pending text[];
  v_verified text[];
  v_blocked text[];
  v_human_actions text[];
  v_evidence jsonb;
  v_next_field jsonb;
  v_checkpoint jsonb;
  v_resumed boolean := false;
BEGIN
  IF v_actor IS NULL OR NOT public.biz_is_brand_member_for_read(p_brand_id,v_actor) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  PERFORM 1 FROM public.brands
  WHERE id=p_brand_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_authorized'; END IF;
  v_manifest := public.brand_context_completeness_internal(p_brand_id);

  -- WITH ORDINALITY retains the manifest's canonical dependency order. The
  -- approval field is explicitly last even if a future manifest moves it.
  v_pending := ARRAY(
    SELECT item->>'key'
    FROM jsonb_array_elements(v_manifest->'fields')
      WITH ORDINALITY AS field(item, ordinal)
    WHERE item->>'requirement' <> 'optional'
      AND item->>'state' NOT IN ('verified','not_applicable')
    ORDER BY CASE WHEN item->>'key'='approved_plan' THEN 1 ELSE 0 END, ordinal
  );
  v_verified := ARRAY(
    SELECT item->>'key'
    FROM jsonb_array_elements(v_manifest->'fields')
      WITH ORDINALITY AS field(item, ordinal)
    WHERE item->>'requirement' <> 'optional'
      AND item->>'state' IN ('verified','not_applicable')
    ORDER BY CASE WHEN item->>'key'='approved_plan' THEN 1 ELSE 0 END, ordinal
  );
  v_blocked := ARRAY(
    SELECT item->>'key'
    FROM jsonb_array_elements(v_manifest->'fields')
      WITH ORDINALITY AS field(item, ordinal)
    WHERE item->>'requirement' <> 'optional'
      AND (item->>'state' = 'conflict'
        OR COALESCE((item->>'human_action_required')::boolean,false))
    ORDER BY CASE WHEN item->>'key'='approved_plan' THEN 1 ELSE 0 END, ordinal
  );
  v_human_actions := ARRAY(
    SELECT item->>'key'
    FROM jsonb_array_elements(v_manifest->'fields')
      WITH ORDINALITY AS field(item, ordinal)
    WHERE item->>'requirement' <> 'optional'
      AND COALESCE((item->>'human_action_required')::boolean,false)
    ORDER BY CASE WHEN item->>'key'='approved_plan' THEN 1 ELSE 0 END, ordinal
  );
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'field_key',item->>'key','state',item->>'state',
    'source_type',item->'source_type','source_ref',item->'source_ref',
    'source_url',item->'source_url','observed_at',item->'observed_at',
    'owner_confirmed_at',item->'owner_confirmed_at',
    'candidates',item->'evidence_candidates'
  ) ORDER BY CASE WHEN item->>'key'='approved_plan' THEN 1 ELSE 0 END, ordinal),'[]'::jsonb)
  INTO v_evidence
  FROM jsonb_array_elements(v_manifest->'fields')
    WITH ORDINALITY AS field(item, ordinal)
  WHERE item->>'requirement' <> 'optional';
  SELECT item INTO v_next_field
  FROM jsonb_array_elements(v_manifest->'fields') item
  WHERE item->>'key' = v_pending[1]
  LIMIT 1;
  v_checkpoint := jsonb_build_object(
    'kind','brand_completeness',
    'context_revision',v_manifest->'context_revision',
    'checked_at',v_manifest->'checked_at',
    'current_step',v_pending[1],
    'verified_step_keys',to_jsonb(v_verified),
    'blocked_step_keys',to_jsonb(v_blocked),
    'human_action_step_keys',to_jsonb(v_human_actions),
    'evidence',v_evidence,
    'next_action',CASE
      WHEN v_next_field IS NULL THEN jsonb_build_object(
        'kind','fresh_terminal_read','requires_fresh_read',true)
      ELSE jsonb_build_object(
        'field_key',v_next_field->>'key',
        'kind',CASE
          WHEN COALESCE((v_next_field->>'human_action_required')::boolean,false)
            THEN 'human_handoff'
          WHEN v_next_field->>'state' = 'conflict' THEN 'resolve_conflict'
          WHEN v_next_field->>'state' = 'stale' THEN 'refresh_evidence'
          WHEN v_next_field->>'state' = 'invalid' THEN 'propose_correction'
          ELSE 'research_or_ask'
        END,
        'requires_owner_input',
          COALESCE((v_next_field->>'human_action_required')::boolean,false)
          OR v_next_field->>'state' = 'conflict',
        'recheck_triggers',v_next_field->'recheck_triggers')
    END
  );
  SELECT * INTO v_other_job FROM public.ari_agent_jobs
  WHERE user_id<>v_actor AND brand_id=p_brand_id
    AND checkpoint->>'kind'='brand_completeness'
    AND status IN ('queued','running','paused','awaiting_approval')
  ORDER BY updated_at DESC LIMIT 1 FOR UPDATE;
  IF v_other_job.id IS NOT NULL AND NOT COALESCE(p_takeover,false) THEN
    RETURN jsonb_build_object(
      'job',to_jsonb(v_other_job)-'user_id'-'lease_owner'-'conversation_id',
      'completeness',v_manifest,
      'resumed',false,
      'blocked_by_other_job',true,
      'takeover_available',public.biz_is_brand_admin_plus_for_caller(p_brand_id));
  END IF;
  IF COALESCE(p_takeover,false) THEN
    IF NOT public.biz_is_brand_admin_plus_for_caller(p_brand_id) THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
    END IF;
    UPDATE public.ari_agent_jobs SET
      status='cancelled',last_error_code='taken_over',
      checkpoint=checkpoint || jsonb_build_object('taken_over_at',now()),
      completed_at=now(),lease_owner=NULL,lease_expires_at=NULL,
      revision=revision+1,updated_at=now()
    WHERE brand_id=p_brand_id AND user_id<>v_actor
      AND checkpoint->>'kind'='brand_completeness'
      AND status IN ('queued','running','paused','awaiting_approval');
  END IF;
  SELECT * INTO v_job FROM public.ari_agent_jobs
  WHERE user_id=v_actor AND brand_id=p_brand_id
    AND checkpoint->>'kind'='brand_completeness'
    AND status <> 'cancelled'
  ORDER BY updated_at DESC LIMIT 1;
  IF v_job.id IS NULL THEN
    INSERT INTO public.ari_agent_jobs(
      user_id,brand_id,idempotency_key,goal_summary,status,checkpoint,
      pending_step_keys,completed_step_keys,completed_at
    ) VALUES (
      v_actor,p_brand_id,gen_random_uuid(),
      'Complete Website brand context with verified values or explicit owner exceptions',
      CASE WHEN cardinality(v_pending)=0 THEN 'completed' ELSE 'queued' END,
      v_checkpoint,v_pending,v_verified,
      CASE WHEN cardinality(v_pending)=0 THEN now() ELSE NULL END
    ) RETURNING * INTO v_job;
  ELSE
    v_resumed := true;
    UPDATE public.ari_agent_jobs SET
      status = CASE
        WHEN cardinality(v_pending)=0 THEN 'completed'
        WHEN status IN ('completed','failed','paused') THEN 'queued'
        ELSE status
      END,
      checkpoint = v_checkpoint,
      pending_step_keys = v_pending,
      completed_step_keys = v_verified,
      completed_at = CASE WHEN cardinality(v_pending)=0 THEN now() ELSE NULL END,
      last_error_code = NULL,
      revision = revision + 1,
      updated_at = now()
    WHERE id = v_job.id
    RETURNING * INTO v_job;
  END IF;
  RETURN jsonb_build_object(
    'job',to_jsonb(v_job)-'user_id'-'lease_owner',
    'completeness',v_manifest,
    'resumed',v_resumed
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.ari_start_brand_completeness_job(uuid,boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ari_start_brand_completeness_job(uuid,boolean)
  TO authenticated, service_role;

COMMIT;
