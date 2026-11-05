-- Issue #2830 — Website setup on one screen.
--
-- A stopped or active Ari setup can be continued or taken over, every plan part
-- has one display status, "doesn't apply" works from the by-hand form, and
-- Ari's public research for brand details has a server-side limit and cache.
--
-- Static SQL only. Conflicts raise PT409, never 40001 (PostgREST retries 40001
-- forever). Service-role only unless a function says otherwise.
--
-- MINGLA-INVARIANT: I-ARI-FLOW-TAKEOVER-AUDITED | issue #2830 | A run's owner changes only through ari_flow_run_take_over, which writes an audit row and requires rank 50.
-- MINGLA-INVARIANT: I-WEBSITE-SETUP-TICK-MEANS-NOTHING-OPEN | issue #2830 | setup_status part done implies empty open_fields, unless the site has been published.

-- ── Activity ───────────────────────────────────────────────────────────────
ALTER TABLE public.ari_flow_runs
  ADD COLUMN IF NOT EXISTS last_lease_at timestamptz NULL;

-- ── Takeover history ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ari_flow_run_takeovers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.ari_flow_runs(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  from_user uuid NOT NULL,
  to_user uuid NOT NULL,
  from_conversation_id uuid NULL,
  to_conversation_id uuid NULL,
  kind text NOT NULL CHECK (kind IN ('continued_stopped','took_over_active')),
  step_key text NULL,
  prior_status text NOT NULL,
  prior_revision integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  notified_at timestamptz NULL
);
CREATE INDEX IF NOT EXISTS ari_flow_run_takeovers_from_chat
  ON public.ari_flow_run_takeovers(from_conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ari_flow_run_takeovers_run
  ON public.ari_flow_run_takeovers(run_id, created_at DESC);
ALTER TABLE public.ari_flow_run_takeovers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ari_flow_run_takeovers FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.ari_flow_run_takeovers FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ari_flow_run_takeovers TO service_role;
COMMENT ON TABLE public.ari_flow_run_takeovers IS
  '#2830: who took a brand-wide Ari flow run over from whom. Written only by ari_flow_run_take_over.';

-- ── The stopped rule (one place) ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ari_flow_stopped_after()
RETURNS interval
LANGUAGE sql IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT interval '30 minutes';
$function$;
REVOKE ALL ON FUNCTION public.ari_flow_stopped_after() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ari_flow_stopped_after() TO service_role;

CREATE OR REPLACE FUNCTION public.ari_flow_run_last_activity(p_run public.ari_flow_runs)
RETURNS timestamptz
LANGUAGE sql IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT GREATEST(p_run.updated_at, COALESCE(p_run.last_lease_at, p_run.updated_at));
$function$;
REVOKE ALL ON FUNCTION public.ari_flow_run_last_activity(public.ari_flow_runs) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ari_flow_run_last_activity(public.ari_flow_runs) TO service_role;

CREATE OR REPLACE FUNCTION public.ari_flow_run_is_stopped(p_run public.ari_flow_runs)
RETURNS boolean
LANGUAGE sql STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT p_run.status IN ('active','awaiting_owner','awaiting_approval','awaiting_handoff','blocked')
    AND public.ari_flow_run_last_activity(p_run) < now() - public.ari_flow_stopped_after();
$function$;
REVOKE ALL ON FUNCTION public.ari_flow_run_is_stopped(public.ari_flow_runs) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ari_flow_run_is_stopped(public.ari_flow_runs) TO service_role;

-- Presentation-safe view of a run for one caller. No lease token, ever.
CREATE OR REPLACE FUNCTION public.ari_flow_run_json(
  p_run public.ari_flow_runs,
  p_user_id uuid
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT jsonb_build_object(
    'id', p_run.id,
    'brand_id', p_run.brand_id,
    'flow_key', p_run.flow_key,
    'flow_version', p_run.flow_version,
    'concurrency', p_run.concurrency,
    'subject_id', p_run.subject_id,
    'conversation_id', p_run.conversation_id,
    'status', p_run.status,
    'current_step_key', p_run.current_step_key,
    'current_question_id', p_run.current_question_id,
    'current_pending_action_id', p_run.current_pending_action_id,
    'current_artefact', p_run.current_artefact,
    'step_states', p_run.step_states,
    'answers', p_run.answers,
    'session_skips', to_jsonb(p_run.session_skips),
    'completion_evidence', p_run.completion_evidence,
    'revision', p_run.revision,
    'started_by_me', p_run.started_by = p_user_id,
    'started_by_name', public.ari_flow_member_name(p_run.started_by),
    'lease_held', p_run.lease_expires_at IS NOT NULL AND p_run.lease_expires_at > now(),
    'lease_held_by_me', p_run.lease_owner = p_user_id
      AND p_run.lease_expires_at IS NOT NULL AND p_run.lease_expires_at > now(),
    'lease_owner_name', CASE
      WHEN p_run.lease_expires_at IS NOT NULL AND p_run.lease_expires_at > now()
        THEN public.ari_flow_member_name(p_run.lease_owner) END,
    'created_at', p_run.created_at,
    'updated_at', p_run.updated_at,
    'completed_at', p_run.completed_at,
    'last_activity_at', public.ari_flow_run_last_activity(p_run),
    'stopped', public.ari_flow_run_is_stopped(p_run),
    'owner_since', COALESCE((
      SELECT max(t.created_at) FROM public.ari_flow_run_takeovers t WHERE t.run_id = p_run.id
    ), p_run.created_at)
  );
$function$;

-- ── Lease: same signature; records activity ────────────────────────────────
CREATE OR REPLACE FUNCTION public.ari_flow_run_lease(
  p_run_id uuid,
  p_user_id uuid,
  p_lease_token uuid,
  p_ttl_seconds integer DEFAULT 30
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_run public.ari_flow_runs%ROWTYPE;
  v_ttl integer := LEAST(GREATEST(COALESCE(p_ttl_seconds, 30), 5), 120);
BEGIN
  IF p_lease_token IS NULL THEN
    RAISE EXCEPTION 'flow_lease_token_required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_run FROM public.ari_flow_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'flow_run_not_found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.ari_flow_require_member(v_run.brand_id, p_user_id);

  IF v_run.status NOT IN ('active','awaiting_owner','awaiting_approval','awaiting_handoff','blocked') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'terminal',
      'run', public.ari_flow_run_json(v_run, p_user_id));
  END IF;
  -- A teammate can see a brand-wide run but only its starter works on it.
  IF v_run.started_by <> p_user_id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'owned_by_other',
      'owner_display_name', public.ari_flow_member_name(v_run.started_by),
      'run', public.ari_flow_run_json(v_run, p_user_id));
  END IF;
  IF v_run.lease_expires_at IS NOT NULL AND v_run.lease_expires_at > now()
     AND v_run.lease_token IS DISTINCT FROM p_lease_token THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'busy',
      'owner_display_name', public.ari_flow_member_name(v_run.lease_owner),
      'run', public.ari_flow_run_json(v_run, p_user_id));
  END IF;

  UPDATE public.ari_flow_runs
  SET lease_owner = p_user_id,
      lease_token = p_lease_token,
      lease_expires_at = now() + make_interval(secs => v_ttl),
      last_lease_at = now()
  WHERE id = v_run.id
  RETURNING * INTO v_run;
  RETURN jsonb_build_object('ok', true, 'run', public.ari_flow_run_json(v_run, p_user_id));
END;
$function$;

-- ── Start: same signature; attaches the owner's own chat-less run ──────────
CREATE OR REPLACE FUNCTION public.ari_flow_run_start(
  p_user_id uuid,
  p_brand_id uuid,
  p_flow_key text,
  p_flow_version integer,
  p_concurrency text,
  p_conversation_id uuid DEFAULT NULL,
  p_subject_id uuid DEFAULT NULL,
  p_answers jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_run public.ari_flow_runs%ROWTYPE;
  v_live text[] := ARRAY['active','awaiting_owner','awaiting_approval','awaiting_handoff','blocked'];
BEGIN
  PERFORM public.ari_flow_require_member(p_brand_id, p_user_id);
  IF p_concurrency NOT IN ('one_per_brand','one_per_subject') THEN
    RAISE EXCEPTION 'flow_concurrency_invalid' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(jsonb_typeof(p_answers), '') <> 'object' THEN
    RAISE EXCEPTION 'flow_answers_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_conversation_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.agent_conversations c
    WHERE c.id = p_conversation_id AND c.user_id = p_user_id
      AND c.brand_id IS NOT DISTINCT FROM p_brand_id
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- The same flow already live in this chat: resume it.
  IF p_conversation_id IS NOT NULL THEN
    SELECT * INTO v_run FROM public.ari_flow_runs
    WHERE conversation_id = p_conversation_id AND status = ANY(v_live)
    FOR UPDATE;
    IF FOUND AND v_run.flow_key = p_flow_key THEN
      RETURN jsonb_build_object('created', false, 'owned_by_other', false,
        'run', public.ari_flow_run_json(v_run, p_user_id));
    END IF;
  END IF;

  -- A brand-wide flow somebody else is already running: report it, never fork.
  IF p_concurrency = 'one_per_brand' THEN
    SELECT * INTO v_run FROM public.ari_flow_runs
    WHERE brand_id = p_brand_id AND flow_key = p_flow_key
      AND concurrency = 'one_per_brand' AND status = ANY(v_live)
    FOR UPDATE;
    IF FOUND THEN
      -- #2830: the caller's own run with no chat (its chat was deleted, or it
      -- was taken over by hand) attaches to the chat that is asking now.
      IF v_run.started_by = p_user_id AND v_run.conversation_id IS NULL
        AND p_conversation_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM public.ari_flow_runs other
          WHERE other.conversation_id = p_conversation_id AND other.status = ANY(v_live)
        ) THEN
        UPDATE public.ari_flow_runs
        SET conversation_id = p_conversation_id, revision = revision + 1, updated_at = now()
        WHERE id = v_run.id
        RETURNING * INTO v_run;
      END IF;
      RETURN jsonb_build_object('created', false,
        'owned_by_other', v_run.started_by <> p_user_id,
        'owner_display_name', public.ari_flow_member_name(v_run.started_by),
        'run', public.ari_flow_run_json(v_run, p_user_id));
    END IF;
  END IF;

  -- One live run per chat: a new flow replaces the chat's older one.
  IF p_conversation_id IS NOT NULL THEN
    UPDATE public.ari_flow_runs
    SET status = 'cancelled', lease_owner = NULL, lease_token = NULL,
        lease_expires_at = NULL, revision = revision + 1, updated_at = now()
    WHERE conversation_id = p_conversation_id AND status = ANY(v_live);
  END IF;

  BEGIN
    INSERT INTO public.ari_flow_runs(
      brand_id, flow_key, flow_version, concurrency, subject_id, started_by,
      conversation_id, answers
    ) VALUES (
      p_brand_id, p_flow_key, p_flow_version, p_concurrency, p_subject_id,
      p_user_id, p_conversation_id, p_answers
    ) RETURNING * INTO v_run;
  EXCEPTION WHEN unique_violation THEN
    SELECT * INTO v_run FROM public.ari_flow_runs
    WHERE brand_id = p_brand_id AND flow_key = p_flow_key
      AND concurrency = 'one_per_brand' AND status = ANY(v_live);
    IF NOT FOUND THEN
      RAISE EXCEPTION 'flow_run_conflict' USING ERRCODE = 'PT409';
    END IF;
    RETURN jsonb_build_object('created', false,
      'owned_by_other', v_run.started_by <> p_user_id,
      'owner_display_name', public.ari_flow_member_name(v_run.started_by),
      'run', public.ari_flow_run_json(v_run, p_user_id));
  END;
  RETURN jsonb_build_object('created', true, 'owned_by_other', false,
    'run', public.ari_flow_run_json(v_run, p_user_id));
END;
$function$;

-- ── The brand's live run, for the setup screen ─────────────────────────────
CREATE OR REPLACE FUNCTION public.ari_flow_brand_run_get(
  p_user_id uuid,
  p_brand_id uuid,
  p_flow_key text
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_run public.ari_flow_runs%ROWTYPE;
  v_takeover public.ari_flow_run_takeovers%ROWTYPE;
BEGIN
  PERFORM public.ari_flow_require_member(p_brand_id, p_user_id);
  SELECT * INTO v_run FROM public.ari_flow_runs
  WHERE brand_id = p_brand_id AND flow_key = p_flow_key
    AND concurrency = 'one_per_brand'
    AND status IN ('active','awaiting_owner','awaiting_approval','awaiting_handoff','blocked')
  LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO v_takeover FROM public.ari_flow_run_takeovers
  WHERE run_id = v_run.id ORDER BY created_at DESC LIMIT 1;
  RETURN jsonb_build_object(
    'run', public.ari_flow_run_json(v_run, p_user_id),
    'can_take_over', COALESCE(public.biz_brand_effective_rank(p_brand_id, p_user_id), 0) >= 50,
    'last_takeover', CASE WHEN v_takeover.id IS NULL THEN NULL ELSE jsonb_build_object(
      'to_name', public.ari_flow_member_name(v_takeover.to_user),
      'from_name', public.ari_flow_member_name(v_takeover.from_user),
      'kind', v_takeover.kind,
      'created_at', v_takeover.created_at
    ) END
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.ari_flow_brand_run_get(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ari_flow_brand_run_get(uuid,uuid,text) TO service_role;

-- ── Take over ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ari_flow_run_take_over(
  p_user_id uuid,
  p_run_id uuid,
  p_conversation_id uuid,
  p_expected_revision integer,
  p_mode text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_run public.ari_flow_runs%ROWTYPE;
  v_live text[] := ARRAY['active','awaiting_owner','awaiting_approval','awaiting_handoff','blocked'];
  v_from uuid;
  v_from_chat uuid;
  v_kind text;
  v_prior_status text;
  v_prior_revision integer;
  v_step jsonb;
  v_steps jsonb;
  v_status text;
  v_site_id uuid;
BEGIN
  IF p_mode NOT IN ('continue','take_over') THEN
    RAISE EXCEPTION 'flow_takeover_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_run FROM public.ari_flow_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'flow_run_not_found' USING ERRCODE = 'P0002'; END IF;
  IF COALESCE(public.biz_brand_effective_rank(v_run.brand_id, p_user_id), 0) < 50 THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_run.concurrency <> 'one_per_brand' THEN
    RAISE EXCEPTION 'flow_takeover_invalid' USING ERRCODE = '22023';
  END IF;
  IF v_run.flow_key = 'website_setup' AND EXISTS (
    SELECT 1 FROM public.brand_sites s
    WHERE s.brand_id = v_run.brand_id AND s.status = 'suspended'
  ) THEN
    RAISE EXCEPTION 'flow_brand_paused' USING ERRCODE = 'PT409';
  END IF;
  IF NOT (v_run.status = ANY(v_live)) THEN
    RAISE EXCEPTION 'flow_run_terminal' USING ERRCODE = 'PT409';
  END IF;
  IF p_expected_revision IS DISTINCT FROM v_run.revision THEN
    RAISE EXCEPTION 'flow_revision_conflict' USING ERRCODE = 'PT409';
  END IF;
  -- A double tap, or the caller's own run on another device.
  IF v_run.started_by = p_user_id THEN
    RETURN jsonb_build_object('changed', false, 'run', public.ari_flow_run_json(v_run, p_user_id));
  END IF;
  -- Nobody skips the warning through a stale screen.
  IF p_mode = 'continue' AND NOT public.ari_flow_run_is_stopped(v_run) THEN
    RAISE EXCEPTION 'flow_run_active' USING ERRCODE = 'PT409';
  END IF;
  -- Mid-request: a lease lasts at most 120 s, so the client says try again.
  IF (v_run.lease_expires_at IS NOT NULL AND v_run.lease_expires_at > now())
    OR (v_run.conversation_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.agent_pending_actions a
      WHERE a.conversation_id = v_run.conversation_id
        AND a.user_id = v_run.started_by
        AND a.status = 'executing'
        -- The #3355 rule: an executing row past its 2-minute lease blocks nothing.
        AND COALESCE(a.executing_started_at, a.execution_attested_at, a.created_at)
          > now() - interval '2 minutes'
    )) THEN
    RAISE EXCEPTION 'flow_run_busy' USING ERRCODE = 'PT409';
  END IF;
  -- "Continue" carries no warning, so it can't take a third person's live form.
  -- "Take over" warned them first.
  IF p_mode = 'continue' AND EXISTS (
    SELECT 1 FROM public.brand_site_plans plan
    WHERE plan.brand_id = v_run.brand_id
      AND plan.lock_holder IS NOT NULL
      AND plan.lock_holder NOT IN (p_user_id, v_run.started_by)
      AND plan.lock_expires_at > now()
  ) THEN
    RAISE EXCEPTION 'flow_form_locked' USING ERRCODE = 'PT409';
  END IF;
  IF p_conversation_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.agent_conversations c
      WHERE c.id = p_conversation_id AND c.user_id = p_user_id AND c.brand_id = v_run.brand_id
    ) THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
    -- One live run per chat: the same rule as start.
    UPDATE public.ari_flow_runs
    SET status = 'cancelled', lease_owner = NULL, lease_token = NULL,
        lease_expires_at = NULL, revision = revision + 1, updated_at = now()
    WHERE conversation_id = p_conversation_id AND id <> v_run.id AND status = ANY(v_live);
  END IF;

  v_from := v_run.started_by;
  v_from_chat := v_run.conversation_id;
  v_prior_status := v_run.status;
  v_prior_revision := v_run.revision;
  v_kind := CASE WHEN public.ari_flow_run_is_stopped(v_run)
    THEN 'continued_stopped' ELSE 'took_over_active' END;

  -- The old chat's unanswered proposals can never save for the new owner.
  IF v_from_chat IS NOT NULL THEN
    UPDATE public.agent_pending_actions
    SET status = 'superseded', failure_reason = 'flow_taken_over'
    WHERE user_id = v_from AND conversation_id = v_from_chat
      AND source = 'ari' AND status = 'pending';
  END IF;

  -- Parked on a lane that ran in the old person's chat: the current step goes
  -- back to pending. Takeover never marks anything done and writes no evidence.
  v_steps := v_run.step_states;
  IF v_run.current_step_key IS NOT NULL THEN
    v_step := v_steps->v_run.current_step_key;
    IF v_step IS NOT NULL AND v_step->>'state' IN ('delegated','awaiting_approval') THEN
      v_steps := jsonb_set(
        v_steps,
        ARRAY[v_run.current_step_key],
        (v_step - 'data') || jsonb_build_object(
          'state','pending',
          'data', COALESCE(v_step->'data','{}'::jsonb) - 'request'
        )
      );
    END IF;
  END IF;
  v_status := CASE WHEN v_run.status IN ('awaiting_approval','active')
    THEN 'active' ELSE v_run.status END;

  UPDATE public.ari_flow_runs
  SET started_by = p_user_id,
      conversation_id = p_conversation_id,
      lease_owner = NULL,
      lease_token = NULL,
      lease_expires_at = NULL,
      current_pending_action_id = NULL,
      status = v_status,
      step_states = v_steps,
      revision = revision + 1,
      updated_at = now()
  WHERE id = v_run.id
  RETURNING * INTO v_run;

  -- Ari's writes run under the caller's JWT and refuse with sites_plan_locked
  -- otherwise: the same effect as brand_site_plan_take_over.
  IF v_run.flow_key = 'website_setup' THEN
    INSERT INTO public.brand_site_plans(brand_id, started_by, updated_by, offerings_selected)
    VALUES (v_run.brand_id, p_user_id, p_user_id,
      public.brand_site_plan_prefill_offerings(v_run.brand_id))
    ON CONFLICT (brand_id) DO NOTHING;
    UPDATE public.brand_site_plans
    SET lock_holder = p_user_id, lock_expires_at = now() + interval '10 minutes',
      updated_at = now(), updated_by = p_user_id
    WHERE brand_id = v_run.brand_id;
  END IF;

  INSERT INTO public.ari_flow_run_takeovers(
    run_id, brand_id, from_user, to_user, from_conversation_id, to_conversation_id,
    kind, step_key, prior_status, prior_revision
  ) VALUES (
    v_run.id, v_run.brand_id, v_from, p_user_id, v_from_chat, p_conversation_id,
    v_kind, v_run.current_step_key, v_prior_status, v_prior_revision
  );

  SELECT id INTO v_site_id FROM public.brand_sites WHERE brand_id = v_run.brand_id;
  INSERT INTO public.brand_site_audit_log(site_id, brand_id, actor_user_id, actor_kind,
    action, resource_kind, resource_id, metadata)
  VALUES (v_site_id, v_run.brand_id, p_user_id, 'user', 'plan.taken_over',
    'brand_site_plan', v_run.brand_id::text,
    jsonb_build_object(
      'previous_holder', true,
      'part', v_run.current_step_key,
      'status', v_prior_status,
      'reason_code', CASE WHEN v_kind = 'continued_stopped'
        THEN 'ari_flow_continued' ELSE 'ari_flow_took_over' END
    ));

  RETURN jsonb_build_object('changed', true, 'kind', v_kind,
    'run', public.ari_flow_run_json(v_run, p_user_id));
END;
$function$;
REVOKE ALL ON FUNCTION public.ari_flow_run_take_over(uuid,uuid,uuid,integer,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ari_flow_run_take_over(uuid,uuid,uuid,integer,text) TO service_role;

-- ── "Someone took this chat's run" ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ari_flow_run_displacement_get(
  p_user_id uuid,
  p_conversation_id uuid
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT jsonb_build_object(
    'id', t.id,
    'run_id', t.run_id,
    'to_name', public.ari_flow_member_name(t.to_user),
    'created_at', t.created_at,
    'notified_at', t.notified_at
  )
  FROM public.ari_flow_run_takeovers t
  WHERE t.from_conversation_id = p_conversation_id AND t.from_user = p_user_id
  ORDER BY t.created_at DESC
  LIMIT 1;
$function$;
REVOKE ALL ON FUNCTION public.ari_flow_run_displacement_get(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ari_flow_run_displacement_get(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.ari_flow_run_displacement_mark(p_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH marked AS (
    UPDATE public.ari_flow_run_takeovers
    SET notified_at = COALESCE(notified_at, now())
    WHERE id = p_id AND from_user = p_user_id
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM marked);
$function$;
REVOKE ALL ON FUNCTION public.ari_flow_run_displacement_mark(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ari_flow_run_displacement_mark(uuid,uuid) TO service_role;

-- ── One display status ─────────────────────────────────────────────────────
-- The field lists must equal the Ari steps in _shared/ariFlows/websiteSetup.ts
-- (parity test: __tests__/issue_2830_setup_status.test.ts).
CREATE OR REPLACE FUNCTION public.brand_site_setup_status_internal(p_brand_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_status jsonb := public.brand_site_plan_status_internal(p_brand_id);
  v_audit jsonb := public.brand_context_completeness_internal(p_brand_id);
  v_live boolean;
  v_plan public.brand_site_plans%ROWTYPE;
  v_part jsonb;
  v_key text;
  v_fields text[];
  v_open text[];
  v_count integer;
  v_done boolean;
  v_skipped boolean;
  v_kinds text[];
  v_kind text;
  v_real_offering boolean;
  v_parts jsonb := '[]'::jsonb;
  v_done_count integer := 0;
  v_next text;
BEGIN
  v_live := EXISTS (
    SELECT 1 FROM public.brand_sites s
    WHERE s.brand_id = p_brand_id AND s.last_successful_publication_id IS NOT NULL
  );
  SELECT * INTO v_plan FROM public.brand_site_plans WHERE brand_id = p_brand_id;
  FOR v_part IN SELECT value FROM jsonb_array_elements(COALESCE(v_status->'parts','[]'::jsonb)) LOOP
    v_key := v_part->>'key';
    v_fields := CASE v_key
      WHEN 'offer' THEN ARRAY['offerings_selected','venue_descriptor']
      WHEN 'brand' THEN ARRAY['name','description','city_country','contact_email',
        'contact_phone','address','social_links','profile_photo','cover_media','theme']
      WHEN 'look' THEN ARRAY['design_key']
      WHEN 'story' THEN ARRAY['story.who','story.why','story.main_action']
      WHEN 'approve' THEN ARRAY['approved_plan']
      ELSE ARRAY[]::text[]
    END;
    SELECT count(*)::integer,
      COALESCE(array_agg(f->>'key') FILTER (
        WHERE f->>'state' NOT IN ('verified','not_applicable')
      ), ARRAY[]::text[])
    INTO v_count, v_open
    FROM jsonb_array_elements(COALESCE(v_audit->'fields','[]'::jsonb)) f
    WHERE f->>'key' = ANY(v_fields) AND f->>'requirement' <> 'optional';

    v_skipped := false;
    IF v_key = 'first_offering' AND (v_part->>'skipped')::boolean IS TRUE THEN
      -- A skip counts as skipped only while nothing real answers the part.
      v_kinds := ARRAY(SELECT unnest(COALESCE(v_plan.offerings_selected, ARRAY[]::text[]))
        INTERSECT SELECT unnest(ARRAY['trips','events','experiences']));
      v_real_offering := cardinality(v_kinds) > 0;
      FOREACH v_kind IN ARRAY v_kinds LOOP
        IF public.brand_site_plan_offering_count(p_brand_id, v_kind, false) = 0 THEN
          v_real_offering := false;
        END IF;
      END LOOP;
      v_skipped := NOT v_real_offering;
    END IF;

    IF v_live THEN
      v_open := ARRAY[]::text[];
      v_done := true;
      v_skipped := false;
    ELSE
      v_done := (v_part->>'done')::boolean IS TRUE
        AND cardinality(v_open) = 0 AND NOT v_skipped;
    END IF;

    v_parts := v_parts || jsonb_build_object(
      'key', v_key,
      'done', v_done,
      'skipped', v_skipped,
      'field_count', v_count,
      'open_fields', to_jsonb(v_open)
    );
    IF v_done OR v_skipped THEN
      v_done_count := v_done_count + 1;
    ELSIF v_next IS NULL THEN
      v_next := v_key;
    END IF;
  END LOOP;
  RETURN jsonb_build_object(
    'parts', v_parts,
    'done_count', v_done_count,
    'next_part', v_next,
    'total', jsonb_array_length(v_parts)
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.brand_site_setup_status_internal(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_setup_status_internal(uuid) TO service_role;

-- Re-issued from 20280119092829; the only change is `setup_status`.
CREATE OR REPLACE FUNCTION public.brand_site_plan_get(p_brand_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_rank integer;
  v_plan public.brand_site_plans%ROWTYPE;
  v_site public.brand_sites%ROWTYPE;
  v_lock_active boolean;
BEGIN
  v_rank := public.biz_brand_effective_rank(p_brand_id, v_actor);
  IF v_actor IS NULL OR v_rank < 20 THEN
    RAISE EXCEPTION 'sites_forbidden';
  END IF;
  IF NOT public.brand_site_entitled(p_brand_id) THEN
    RETURN jsonb_build_object('brand_id', p_brand_id, 'entitled', false, 'rank', v_rank);
  END IF;
  SELECT * INTO v_plan FROM public.brand_site_plans WHERE brand_id = p_brand_id;
  SELECT * INTO v_site FROM public.brand_sites WHERE brand_id = p_brand_id;
  v_lock_active := v_plan.lock_holder IS NOT NULL AND v_plan.lock_expires_at > now();

  RETURN jsonb_build_object(
    'brand_id', p_brand_id,
    'entitled', true,
    'rank', v_rank,
    'can_manage', v_rank >= 50,
    'site', CASE WHEN v_site.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', v_site.id,
      'status', v_site.status,
      'design_key', v_site.design_key,
      'published', v_site.last_successful_publication_id IS NOT NULL,
      'paused', v_site.status = 'suspended'
    ) END,
    'plan', CASE WHEN v_plan.brand_id IS NULL THEN NULL ELSE jsonb_build_object(
      'revision', v_plan.revision,
      'offerings_selected', to_jsonb(v_plan.offerings_selected),
      'venue_descriptor', v_plan.venue_descriptor,
      'story', v_plan.story,
      'approved_plan', v_plan.approved_plan,
      'approved_at', v_plan.approved_at,
      'skipped_parts', to_jsonb(v_plan.skipped_parts),
      'active_part', v_plan.active_part,
      'built_pages', to_jsonb(v_plan.built_pages),
      'built_at', v_plan.built_at,
      'started_at', v_plan.started_at,
      'started_by_me', v_plan.started_by = v_actor,
      'started_by_name', CASE WHEN v_plan.started_by IS NULL THEN NULL
        ELSE public.brand_site_plan_person_name(v_plan.started_by) END,
      'updated_at', v_plan.updated_at
    ) END,
    'status', public.brand_site_plan_status_internal(p_brand_id),
    'setup_status', public.brand_site_setup_status_internal(p_brand_id),
    'prefill_offerings', to_jsonb(public.brand_site_plan_prefill_offerings(p_brand_id)),
    'live_counts', jsonb_build_object(
      'trips', public.brand_site_plan_offering_count(p_brand_id, 'trips', true),
      'events', public.brand_site_plan_offering_count(p_brand_id, 'events', true),
      'experiences', public.brand_site_plan_offering_count(p_brand_id, 'experiences', true)
    ),
    'lock', jsonb_build_object(
      'active', v_lock_active,
      'held_by_me', v_lock_active AND v_plan.lock_holder = v_actor,
      'holder_name', CASE WHEN v_lock_active
        THEN public.brand_site_plan_person_name(v_plan.lock_holder) ELSE NULL END,
      'expires_at', CASE WHEN v_lock_active THEN v_plan.lock_expires_at ELSE NULL END
    )
  );
END;
$function$;

-- ── "Doesn't apply to my brand", from the by-hand form ─────────────────────
-- ari_update_brand_context binds every call to a confirmed proposal, which a
-- form does not have. This writes the same row with the same disposition and
-- fingerprint; there is no new state.
CREATE OR REPLACE FUNCTION public.brand_context_mark_not_applicable(
  p_brand_id uuid,
  p_field_key text,
  p_expected_context_revision text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_plan public.brand_site_plans%ROWTYPE;
BEGIN
  IF v_actor IS NULL OR NOT public.biz_is_brand_admin_plus_for_caller(p_brand_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  PERFORM public.brand_site_plan_gate(p_brand_id, 50);
  IF p_field_key NOT IN (
    'venue_descriptor','contact_email','contact_phone','address','city_country',
    'social_links','profile_photo','cover_media','theme') THEN
    RAISE EXCEPTION 'invalid_exception' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_plan FROM public.brand_site_plans WHERE brand_id = p_brand_id FOR UPDATE;
  IF v_plan.lock_holder IS NOT NULL AND v_plan.lock_expires_at > now()
    AND v_plan.lock_holder <> v_actor THEN
    RAISE EXCEPTION 'sites_plan_locked';
  END IF;
  PERFORM 1 FROM public.brand_context_field_evidence
  WHERE brand_id = p_brand_id FOR UPDATE;
  IF p_expected_context_revision IS DISTINCT FROM public.brand_context_revision(p_brand_id) THEN
    RAISE EXCEPTION 'sites_revision_conflict' USING ERRCODE = 'PT409';
  END IF;
  INSERT INTO public.brand_context_field_evidence(
    brand_id,field_key,disposition,source_type,source_ref,source_url,
    observed_at,owner_confirmed_at,exception_reason,recheck_fingerprint,
    updated_at,updated_by
  ) VALUES (
    p_brand_id,p_field_key,'not_applicable','owner',NULL,NULL,
    now(),now(),'Owner said this doesn''t apply',
    public.brand_context_recheck_fingerprint(p_brand_id,p_field_key),
    now(),v_actor
  ) ON CONFLICT (brand_id,field_key) DO UPDATE SET
    disposition='not_applicable',source_type='owner',source_ref=NULL,source_url=NULL,
    observed_at=now(),owner_confirmed_at=now(),exception_reason=EXCLUDED.exception_reason,
    evidence_candidates='[]'::jsonb,
    recheck_fingerprint=EXCLUDED.recheck_fingerprint,
    updated_at=now(),updated_by=v_actor;
  INSERT INTO public.brand_site_audit_log(site_id, brand_id, actor_user_id, actor_kind,
    action, resource_kind, resource_id, metadata)
  VALUES ((SELECT id FROM public.brand_sites WHERE brand_id = p_brand_id), p_brand_id,
    v_actor, 'user', 'plan.saved', 'brand_site_plan', p_brand_id::text,
    jsonb_build_object('fields', jsonb_build_array(p_field_key)));
  RETURN public.brand_context_completeness_internal(p_brand_id);
END;
$function$;
REVOKE ALL ON FUNCTION public.brand_context_mark_not_applicable(uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_context_mark_not_applicable(uuid,text,text)
  TO authenticated, service_role;

-- ── Ari's public research for brand details ────────────────────────────────
-- One search per brand plus one retry. Candidates wait here and become
-- evidence (ari_record_brand_context_finding) only at the moment Ari asks that
-- field, so a background result can never move the context revision under a
-- proposal the owner is looking at. Nothing here touches `brands`.
CREATE TABLE IF NOT EXISTS public.ari_brand_setup_research (
  brand_id uuid PRIMARY KEY REFERENCES public.brands(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('running','found','nothing','unavailable')),
  attempts smallint NOT NULL DEFAULT 1 CHECK (attempts BETWEEN 1 AND 2),
  candidates jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(candidates) = 'object' AND octet_length(candidates::text) <= 20000
  ),
  -- Who the search was for. A rename or a move makes the result someone else's.
  identity text NULL CHECK (identity IS NULL OR length(identity) <= 400),
  identity_resets smallint NOT NULL DEFAULT 0 CHECK (identity_resets BETWEEN 0 AND 3),
  started_by uuid NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ari_brand_setup_research ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ari_brand_setup_research FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.ari_brand_setup_research FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ari_brand_setup_research TO service_role;
COMMENT ON TABLE public.ari_brand_setup_research IS
  '#2830: the one public search (plus one retry) Ari runs for a brand''s setup, and its same-brand candidates, cached so re-entering setup does not pay again.';

-- allowed=true means the caller may spend one search now. Anything else is the
-- cached answer, or "not again". Cached results never expire, but they belong to
-- the identity they were found for: a rename clears them and any unconfirmed
-- finding, and may search again, at most 3 times per brand. One person can start
-- at most 25 searches a day across brands.
CREATE OR REPLACE FUNCTION public.ari_brand_research_claim(
  p_user_id uuid,
  p_brand_id uuid,
  p_identity text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row public.ari_brand_setup_research%ROWTYPE;
  v_cleared boolean := false;
  v_over_cap boolean;
BEGIN
  IF p_user_id IS NULL OR COALESCE(public.biz_brand_effective_rank(p_brand_id, p_user_id), 0) < 50 THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  v_over_cap := (
    SELECT count(*) FROM public.ari_brand_setup_research r
    WHERE r.started_by = p_user_id AND r.brand_id <> p_brand_id
      AND r.started_at > now() - interval '1 day'
  ) >= 25;
  SELECT * INTO v_row FROM public.ari_brand_setup_research WHERE brand_id = p_brand_id FOR UPDATE;
  IF NOT FOUND THEN
    IF v_over_cap THEN
      RETURN jsonb_build_object('allowed', false, 'status', 'capped', 'attempts', 0, 'candidates', '{}'::jsonb);
    END IF;
    INSERT INTO public.ari_brand_setup_research(brand_id, status, attempts, started_by, identity)
    VALUES (p_brand_id, 'running', 1, p_user_id, p_identity)
    ON CONFLICT (brand_id) DO NOTHING
    RETURNING * INTO v_row;
    IF FOUND THEN
      RETURN jsonb_build_object('allowed', true, 'status', 'running', 'attempts', 1, 'candidates', '{}'::jsonb);
    END IF;
    SELECT * INTO v_row FROM public.ari_brand_setup_research WHERE brand_id = p_brand_id FOR UPDATE;
  END IF;

  IF p_identity IS NOT NULL AND p_identity IS DISTINCT FROM v_row.identity THEN
    IF v_row.identity IS NOT NULL THEN
      v_cleared := true;
      DELETE FROM public.brand_context_field_evidence e
      WHERE e.brand_id = p_brand_id
        AND e.field_key IN ('city_country','contact_email','contact_phone','address','social_links')
        AND e.source_type = 'public_research'
        AND e.disposition = 'stale'
        AND e.owner_confirmed_at IS NULL;
      IF v_row.identity_resets >= 3 OR v_over_cap THEN
        UPDATE public.ari_brand_setup_research
        SET identity = p_identity, candidates = '{}'::jsonb, status = 'nothing',
          finished_at = now(), updated_at = now()
        WHERE brand_id = p_brand_id;
        RETURN jsonb_build_object('allowed', false, 'status', 'nothing',
          'attempts', v_row.attempts, 'candidates', '{}'::jsonb, 'cleared', true);
      END IF;
      UPDATE public.ari_brand_setup_research
      SET identity = p_identity, candidates = '{}'::jsonb, status = 'running', attempts = 1,
        identity_resets = identity_resets + 1, started_by = p_user_id,
        started_at = now(), finished_at = NULL, updated_at = now()
      WHERE brand_id = p_brand_id;
      RETURN jsonb_build_object('allowed', true, 'status', 'running',
        'attempts', 1, 'candidates', '{}'::jsonb, 'cleared', true);
    END IF;
    UPDATE public.ari_brand_setup_research SET identity = p_identity WHERE brand_id = p_brand_id;
  END IF;

  IF v_row.status IN ('found','nothing')
    OR (v_row.status = 'running' AND v_row.started_at > now() - interval '2 minutes') THEN
    RETURN jsonb_build_object('allowed', false, 'status', v_row.status,
      'attempts', v_row.attempts, 'candidates', v_row.candidates);
  END IF;
  -- Unavailable, or a search that died: one retry, then never again.
  IF v_row.attempts >= 2 OR v_over_cap THEN
    IF v_row.status = 'running' THEN
      UPDATE public.ari_brand_setup_research
      SET status = 'unavailable', finished_at = now(), updated_at = now()
      WHERE brand_id = p_brand_id
      RETURNING * INTO v_row;
    END IF;
    RETURN jsonb_build_object('allowed', false, 'status', v_row.status,
      'attempts', v_row.attempts, 'candidates', v_row.candidates);
  END IF;
  UPDATE public.ari_brand_setup_research
  SET status = 'running', attempts = attempts + 1, started_by = p_user_id,
    started_at = now(), finished_at = NULL, updated_at = now()
  WHERE brand_id = p_brand_id
  RETURNING * INTO v_row;
  RETURN jsonb_build_object('allowed', true, 'status', 'running',
    'attempts', v_row.attempts, 'candidates', '{}'::jsonb);
END;
$function$;
REVOKE ALL ON FUNCTION public.ari_brand_research_claim(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ari_brand_research_claim(uuid,uuid,text) TO service_role;

-- A search that finishes after a rename belongs to the old identity: dropped.
CREATE OR REPLACE FUNCTION public.ari_brand_research_finish(
  p_brand_id uuid,
  p_status text,
  p_candidates jsonb DEFAULT '{}'::jsonb,
  p_identity text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF p_status NOT IN ('found','nothing','unavailable')
    OR COALESCE(jsonb_typeof(p_candidates),'') <> 'object' THEN
    RAISE EXCEPTION 'invalid_research_result' USING ERRCODE = '22023';
  END IF;
  UPDATE public.ari_brand_setup_research
  SET status = p_status, candidates = p_candidates, finished_at = now(), updated_at = now()
  WHERE brand_id = p_brand_id AND status = 'running'
    AND (p_identity IS NULL OR identity IS NOT DISTINCT FROM p_identity);
  RETURN FOUND;
END;
$function$;
REVOKE ALL ON FUNCTION public.ari_brand_research_finish(uuid,text,jsonb,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ari_brand_research_finish(uuid,text,jsonb,text) TO service_role;
