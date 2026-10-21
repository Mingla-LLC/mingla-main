-- Issue #3697 — keep an ad plan's lifecycle aligned with provider campaigns
-- after an automatic or manual pause.
--
-- The state guard deliberately forbids live -> paused. This service-only RPC
-- serializes on the plan, derives the result from the current immutable plan
-- version's campaign rows, and takes only guard-legal transitions. It also
-- writes a plan-scoped status event in the same transaction. The campaign row
-- keeps the machine-readable automatic reason so Admin can explain a pause
-- without downloading an unbounded status-event history.
--
-- Additive and idempotent. Apply to production before deploying either caller.

BEGIN;

ALTER TABLE public.ad_campaigns
  ADD COLUMN IF NOT EXISTS auto_pause_reason text NULL;

COMMENT ON COLUMN public.ad_campaigns.auto_pause_reason IS
  'Issue #3697: machine-readable reason set only by admin-ad-spend-sync; cleared by a manual pause or successful relaunch.';

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.ad_campaigns'::regclass
      AND conname = 'ad_campaigns_auto_pause_reason_length'
  ) THEN
    ALTER TABLE public.ad_campaigns
      ADD CONSTRAINT ad_campaigns_auto_pause_reason_length
      CHECK (
        auto_pause_reason IS NULL
        OR char_length(btrim(auto_pause_reason)) BETWEEN 1 AND 64
      );
  END IF;
END;
$migration$;

-- MINGLA-INVARIANT: I-3697-PLAN-PAUSE-FOLLOWS-CAMPAIGNS | issue #3697 | A plan with provider campaigns paused through Admin or spend sync reaches paused only through pause_requested; a plan with any ACTIVE provider campaign is partially_live.
CREATE OR REPLACE FUNCTION public.ad_plan_mark_paused(
  p_plan_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_plan public.ad_plans%ROWTYPE;
  v_version public.ad_plan_versions%ROWTYPE;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_from_state text;
  v_target_state text;
  v_total integer;
  v_paused integer;
  v_active integer;
  v_other integer;
  v_path jsonb;
BEGIN
  IF v_reason = '' OR char_length(v_reason) > 120 THEN
    RAISE EXCEPTION 'ad_plan_pause_reason_invalid' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_plan
  FROM public.ad_plans
  WHERE id = p_plan_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ad_plan_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_plan.current_version_id IS NULL THEN
    RAISE EXCEPTION 'ad_plan_current_version_missing' USING ERRCODE = '55000';
  END IF;

  SELECT * INTO v_version
  FROM public.ad_plan_versions
  WHERE id = v_plan.current_version_id
    AND plan_id = v_plan.id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ad_plan_current_version_missing' USING ERRCODE = '55000';
  END IF;

  SELECT
    count(*)::integer,
    count(*) FILTER (WHERE c.status = 'PAUSED')::integer,
    count(*) FILTER (WHERE c.status = 'ACTIVE')::integer,
    count(*) FILTER (WHERE c.status NOT IN ('PAUSED', 'ACTIVE'))::integer
  INTO v_total, v_paused, v_active, v_other
  FROM public.ad_campaigns c
  WHERE c.plan_version_id = v_version.id
    AND c.plan_hash = v_version.plan_hash;

  IF v_total = 0 THEN
    RAISE EXCEPTION 'ad_plan_campaigns_missing' USING ERRCODE = '55000';
  END IF;
  IF v_other > 0 THEN
    RAISE EXCEPTION 'ad_plan_pause_campaign_state_invalid' USING ERRCODE = '55000';
  END IF;

  v_from_state := v_plan.state;
  v_path := jsonb_build_array(v_from_state);

  IF v_paused = v_total THEN
    v_target_state := 'paused';
    IF v_plan.state IN ('live', 'partially_live') THEN
      UPDATE public.ad_plans
      SET state = 'pause_requested'
      WHERE id = v_plan.id;
      v_plan.state := 'pause_requested';
      v_path := v_path || jsonb_build_array('pause_requested');
    END IF;
    IF v_plan.state = 'pause_requested' THEN
      UPDATE public.ad_plans
      SET state = 'paused'
      WHERE id = v_plan.id;
      v_plan.state := 'paused';
      v_path := v_path || jsonb_build_array('paused');
    ELSIF v_plan.state <> 'paused' THEN
      RAISE EXCEPTION 'ad_plan_pause_state_invalid:%', v_plan.state
        USING ERRCODE = '55000';
    END IF;
  ELSIF v_active > 0 THEN
    v_target_state := 'partially_live';
    IF v_plan.state IN ('live', 'pause_requested', 'paused') THEN
      UPDATE public.ad_plans
      SET state = 'partially_live'
      WHERE id = v_plan.id;
      v_plan.state := 'partially_live';
      v_path := v_path || jsonb_build_array('partially_live');
    ELSIF v_plan.state <> 'partially_live' THEN
      RAISE EXCEPTION 'ad_plan_pause_state_invalid:%', v_plan.state
        USING ERRCODE = '55000';
    END IF;
  ELSE
    RAISE EXCEPTION 'ad_plan_pause_campaign_state_invalid' USING ERRCODE = '55000';
  END IF;

  INSERT INTO public.ad_status_events (
    campaign_id, platform, entity, action, actor, from_status, to_status,
    external_ids, provider_response
  ) VALUES (
    NULL, NULL, NULL, 'pause', NULL, v_from_state, v_target_state,
    jsonb_build_object(
      'plan_id', v_plan.id,
      'plan_version_id', v_version.id,
      'plan_hash', v_version.plan_hash
    ),
    jsonb_build_object(
      'reason', v_reason,
      'source', 'ad_plan_mark_paused',
      'total_campaigns', v_total,
      'paused_campaigns', v_paused,
      'active_campaigns', v_active,
      'transition_path', v_path
    )
  );

  RETURN jsonb_build_object(
    'plan_id', v_plan.id,
    'plan_version_id', v_version.id,
    'plan_hash', v_version.plan_hash,
    'from_state', v_from_state,
    'state', v_target_state,
    'reason', v_reason,
    'total_campaigns', v_total,
    'paused_campaigns', v_paused,
    'active_campaigns', v_active,
    'transition_path', v_path
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.ad_plan_mark_paused(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ad_plan_mark_paused(uuid, text)
  TO service_role;

DO $acl$
DECLARE
  v_signature constant text := 'public.ad_plan_mark_paused(uuid,text)';
  v_oid oid := to_regprocedure(v_signature);
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'issue3697: ad_plan_mark_paused missing';
  END IF;
  IF has_function_privilege('anon', v_signature, 'EXECUTE')
     OR has_function_privilege('authenticated', v_signature, 'EXECUTE') THEN
    RAISE EXCEPTION 'issue3697: ad_plan_mark_paused leaked to an app role';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_proc p,
      aclexplode(coalesce(p.proacl, acldefault('f'::"char", p.proowner))) a
    WHERE p.oid = v_oid
      AND a.grantee = 0
      AND a.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'issue3697: ad_plan_mark_paused leaked to PUBLIC';
  END IF;
  IF NOT has_function_privilege('service_role', v_signature, 'EXECUTE') THEN
    RAISE EXCEPTION 'issue3697: ad_plan_mark_paused missing service_role grant';
  END IF;
END;
$acl$;

COMMIT;
