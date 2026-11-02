-- Issue #3355 P3 — Ari flow engine core: durable per-brand flow runs.
--
-- One server step runner owns progress for every Ari flow (readiness preamble
-- before an offering, money gate, later Website setup and offerings). Each run
-- is pinned to a versioned flow definition that lives in edge code
-- (supabase/functions/_shared/ariFlows/). This table holds only the run:
-- per-step state, the owner's typed answers, the one current artefact (the
-- question, handoff or summary the owner is looking at) and a lease so only one
-- request works on a run at a time.
--
-- Invariants (enforced here, pinned by
-- supabase/migrations/__tests__/issue_3355_ari_flow_runs.implementor.pg17.test.sql):
--   I-ARI-FLOW-ENGINE-OWNS-PROGRESS — a step becomes `done`, and a run becomes
--     `completed`, only through ari_flow_run_advance with an evidence object
--     (probe + observed). No model-facing tool writes runs.
--   I-ARI-BOUND-ANSWERS — the run's current_question_id is the only question
--     an answer may bind to (the edge rejects any other as QUESTION_STALE).
--   Leases and revisions are decided on the database clock.
--
-- D-31: ari_manage_agent_job no longer lets a caller mark a durable job
-- completed without evidence references.
--
-- Access: RLS on, no client grants. Every function is SECURITY DEFINER and
-- service-role only; the edge runner passes the authenticated user id and the
-- functions check brand membership themselves.

-- ── Runs ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ari_flow_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  flow_key text NOT NULL CHECK (flow_key ~ '^[a-z][a-z_]{2,40}$'),
  flow_version integer NOT NULL CHECK (flow_version >= 1),
  concurrency text NOT NULL CHECK (concurrency IN ('one_per_brand','one_per_subject')),
  subject_id uuid NULL,
  started_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id uuid NULL REFERENCES public.agent_conversations(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN (
    'active','awaiting_owner','awaiting_approval','awaiting_handoff',
    'blocked','completed','cancelled','expired'
  )),
  current_step_key text NULL CHECK (current_step_key IS NULL OR current_step_key ~ '^[a-z][a-z_]{1,40}$'),
  current_question_id uuid NULL,
  current_pending_action_id uuid NULL,
  current_artefact jsonb NULL CHECK (
    current_artefact IS NULL OR jsonb_typeof(current_artefact) = 'object'
  ),
  step_states jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(step_states) = 'object'),
  answers jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(answers) = 'object'),
  session_skips text[] NOT NULL DEFAULT ARRAY[]::text[],
  completion_evidence jsonb NULL CHECK (
    completion_evidence IS NULL OR jsonb_typeof(completion_evidence) = 'object'
  ),
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  lease_owner uuid NULL,
  lease_token uuid NULL,
  lease_expires_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL,
  CONSTRAINT ari_flow_runs_completed_has_evidence CHECK (
    status <> 'completed' OR completion_evidence IS NOT NULL
  )
);

-- One live run per brand for brand-wide flows (Website setup, money setup).
CREATE UNIQUE INDEX IF NOT EXISTS ari_flow_runs_one_live_per_brand
  ON public.ari_flow_runs(brand_id, flow_key)
  WHERE concurrency = 'one_per_brand'
    AND status IN ('active','awaiting_owner','awaiting_approval','awaiting_handoff','blocked');
-- One live run per conversation (the per-conversation guard): starting a new
-- flow in a chat cancels the chat's older live run first.
CREATE UNIQUE INDEX IF NOT EXISTS ari_flow_runs_one_live_per_conversation
  ON public.ari_flow_runs(conversation_id)
  WHERE conversation_id IS NOT NULL
    AND status IN ('active','awaiting_owner','awaiting_approval','awaiting_handoff','blocked');
CREATE INDEX IF NOT EXISTS ari_flow_runs_brand_updated
  ON public.ari_flow_runs(brand_id, updated_at DESC);

ALTER TABLE public.ari_flow_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ari_flow_runs FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.ari_flow_runs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ari_flow_runs TO service_role;

COMMENT ON TABLE public.ari_flow_runs IS
  '#3355 P3: one durable Ari flow run per brand flow. Only ari_flow_run_advance (edge runner, service role, under a lease) changes progress; done steps and completed runs carry evidence.';

-- ── Helpers ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ari_flow_member_name(p_user_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(
    NULLIF(btrim(COALESCE(u.raw_user_meta_data->>'full_name','')),''),
    NULLIF(btrim(COALESCE(u.raw_user_meta_data->>'name','')),''),
    'A teammate')
  FROM (SELECT 1) one
  LEFT JOIN auth.users u ON u.id = p_user_id;
$function$;
REVOKE ALL ON FUNCTION public.ari_flow_member_name(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ari_flow_member_name(uuid) TO service_role;

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
    'completed_at', p_run.completed_at
  );
$function$;
REVOKE ALL ON FUNCTION public.ari_flow_run_json(public.ari_flow_runs, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ari_flow_run_json(public.ari_flow_runs, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.ari_flow_require_member(p_brand_id uuid, p_user_id uuid)
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF p_user_id IS NULL OR p_brand_id IS NULL
    OR COALESCE(public.biz_brand_effective_rank(p_brand_id, p_user_id), 0) < 10 THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.ari_flow_require_member(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ari_flow_require_member(uuid, uuid) TO service_role;

-- ── Start (or join the live run) ───────────────────────────────────────────
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
REVOKE ALL ON FUNCTION public.ari_flow_run_start(uuid,uuid,text,integer,text,uuid,uuid,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ari_flow_run_start(uuid,uuid,text,integer,text,uuid,uuid,jsonb)
  TO service_role;

-- ── Lease (one actor at a time; database clock) ────────────────────────────
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
      lease_expires_at = now() + make_interval(secs => v_ttl)
  WHERE id = v_run.id
  RETURNING * INTO v_run;
  RETURN jsonb_build_object('ok', true, 'run', public.ari_flow_run_json(v_run, p_user_id));
END;
$function$;
REVOKE ALL ON FUNCTION public.ari_flow_run_lease(uuid,uuid,uuid,integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ari_flow_run_lease(uuid,uuid,uuid,integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.ari_flow_run_release(
  p_run_id uuid,
  p_lease_token uuid
) RETURNS boolean
LANGUAGE sql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH released AS (
    UPDATE public.ari_flow_runs
    SET lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL
    WHERE id = p_run_id AND lease_token = p_lease_token
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM released);
$function$;
REVOKE ALL ON FUNCTION public.ari_flow_run_release(uuid,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ari_flow_run_release(uuid,uuid) TO service_role;

-- ── Advance (CAS, lease-bound, evidence for done/completed) ────────────────
CREATE OR REPLACE FUNCTION public.ari_flow_run_advance(
  p_run_id uuid,
  p_lease_token uuid,
  p_expected_revision integer,
  p_patch jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_run public.ari_flow_runs%ROWTYPE;
  v_key text;
  v_step jsonb;
  v_evidence jsonb;
  v_status text;
  v_states jsonb;
BEGIN
  IF COALESCE(jsonb_typeof(p_patch), '') <> 'object' THEN
    RAISE EXCEPTION 'flow_patch_invalid' USING ERRCODE = '22023';
  END IF;
  FOR v_key IN SELECT jsonb_object_keys(p_patch) LOOP
    IF v_key NOT IN (
      'status','current_step_key','current_question_id','current_pending_action_id',
      'current_artefact','step_states','answers','session_skips','subject_id',
      'completion_evidence'
    ) THEN
      RAISE EXCEPTION 'flow_patch_invalid' USING ERRCODE = '22023', DETAIL = v_key;
    END IF;
  END LOOP;

  SELECT * INTO v_run FROM public.ari_flow_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'flow_run_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_run.lease_token IS DISTINCT FROM p_lease_token
     OR v_run.lease_expires_at IS NULL OR v_run.lease_expires_at <= now() THEN
    RAISE EXCEPTION 'flow_lease_not_held' USING ERRCODE = 'PT409';
  END IF;
  IF p_expected_revision IS DISTINCT FROM v_run.revision THEN
    RAISE EXCEPTION 'flow_revision_conflict' USING ERRCODE = 'PT409';
  END IF;
  IF v_run.status NOT IN ('active','awaiting_owner','awaiting_approval','awaiting_handoff','blocked') THEN
    RAISE EXCEPTION 'flow_run_terminal' USING ERRCODE = 'PT409';
  END IF;

  v_status := COALESCE(p_patch->>'status', v_run.status);
  IF v_status NOT IN (
    'active','awaiting_owner','awaiting_approval','awaiting_handoff',
    'blocked','completed','cancelled','expired'
  ) THEN
    RAISE EXCEPTION 'flow_status_invalid' USING ERRCODE = '22023';
  END IF;

  -- I-ARI-FLOW-ENGINE-OWNS-PROGRESS: done needs evidence (probe + observed).
  v_states := COALESCE(p_patch->'step_states', '{}'::jsonb);
  IF jsonb_typeof(v_states) <> 'object' THEN
    RAISE EXCEPTION 'flow_patch_invalid' USING ERRCODE = '22023', DETAIL = 'step_states';
  END IF;
  FOR v_key, v_step IN SELECT key, value FROM jsonb_each(v_states) LOOP
    IF v_key !~ '^[a-z][a-z_]{1,40}$' OR jsonb_typeof(v_step) <> 'object'
       OR COALESCE(v_step->>'state','') NOT IN (
         'pending','asked','proposed','awaiting_approval','done','skipped',
         'deferred','blocked','human_action','delegated'
       ) THEN
      RAISE EXCEPTION 'flow_step_state_invalid' USING ERRCODE = '22023', DETAIL = v_key;
    END IF;
    IF v_step->>'state' = 'done' THEN
      v_evidence := v_step->'evidence';
      IF v_evidence IS NULL OR jsonb_typeof(v_evidence) <> 'object'
         OR NULLIF(btrim(COALESCE(v_evidence->>'probe','')),'') IS NULL
         OR NOT (v_evidence ? 'observed') THEN
        RAISE EXCEPTION 'flow_evidence_required' USING ERRCODE = '22023', DETAIL = v_key;
      END IF;
    END IF;
  END LOOP;
  IF v_status = 'completed' THEN
    v_evidence := p_patch->'completion_evidence';
    IF v_evidence IS NULL OR jsonb_typeof(v_evidence) <> 'object'
       OR NULLIF(btrim(COALESCE(v_evidence->>'probe','')),'') IS NULL
       OR NOT (v_evidence ? 'observed') THEN
      RAISE EXCEPTION 'flow_evidence_required' USING ERRCODE = '22023', DETAIL = 'completion';
    END IF;
  END IF;
  IF p_patch ? 'answers' AND jsonb_typeof(p_patch->'answers') <> 'object' THEN
    RAISE EXCEPTION 'flow_patch_invalid' USING ERRCODE = '22023', DETAIL = 'answers';
  END IF;
  IF p_patch ? 'current_artefact' AND jsonb_typeof(p_patch->'current_artefact') NOT IN ('object','null') THEN
    RAISE EXCEPTION 'flow_patch_invalid' USING ERRCODE = '22023', DETAIL = 'current_artefact';
  END IF;
  IF p_patch ? 'session_skips' AND jsonb_typeof(p_patch->'session_skips') <> 'array' THEN
    RAISE EXCEPTION 'flow_patch_invalid' USING ERRCODE = '22023', DETAIL = 'session_skips';
  END IF;

  UPDATE public.ari_flow_runs
  SET status = v_status,
      current_step_key = CASE WHEN p_patch ? 'current_step_key'
        THEN p_patch->>'current_step_key' ELSE current_step_key END,
      current_question_id = CASE WHEN p_patch ? 'current_question_id'
        THEN (p_patch->>'current_question_id')::uuid ELSE current_question_id END,
      current_pending_action_id = CASE WHEN p_patch ? 'current_pending_action_id'
        THEN (p_patch->>'current_pending_action_id')::uuid ELSE current_pending_action_id END,
      current_artefact = CASE WHEN p_patch ? 'current_artefact'
        THEN NULLIF(p_patch->'current_artefact', 'null'::jsonb) ELSE current_artefact END,
      step_states = step_states || v_states,
      answers = answers || COALESCE(p_patch->'answers', '{}'::jsonb),
      session_skips = CASE WHEN p_patch ? 'session_skips'
        THEN ARRAY(SELECT DISTINCT jsonb_array_elements_text(p_patch->'session_skips'))
        ELSE session_skips END,
      subject_id = CASE WHEN p_patch ? 'subject_id'
        THEN (p_patch->>'subject_id')::uuid ELSE subject_id END,
      completion_evidence = CASE WHEN p_patch ? 'completion_evidence'
        THEN p_patch->'completion_evidence' ELSE completion_evidence END,
      revision = revision + 1,
      updated_at = now(),
      completed_at = CASE WHEN v_status = 'completed' THEN now() ELSE completed_at END,
      lease_owner = CASE WHEN v_status IN ('completed','cancelled','expired') THEN NULL ELSE lease_owner END,
      lease_token = CASE WHEN v_status IN ('completed','cancelled','expired') THEN NULL ELSE lease_token END,
      lease_expires_at = CASE WHEN v_status IN ('completed','cancelled','expired') THEN NULL ELSE lease_expires_at END
  WHERE id = v_run.id
  RETURNING * INTO v_run;
  RETURN public.ari_flow_run_json(v_run, v_run.started_by);
END;
$function$;
REVOKE ALL ON FUNCTION public.ari_flow_run_advance(uuid,uuid,integer,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ari_flow_run_advance(uuid,uuid,integer,jsonb)
  TO service_role;

-- ── Read for resume (Host mount / reload / reconnect / handoff return) ─────
CREATE OR REPLACE FUNCTION public.ari_flow_run_get(
  p_user_id uuid,
  p_run_id uuid DEFAULT NULL,
  p_conversation_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_run public.ari_flow_runs%ROWTYPE;
BEGIN
  IF p_run_id IS NULL AND p_conversation_id IS NULL THEN
    RAISE EXCEPTION 'flow_run_target_required' USING ERRCODE = '22023';
  END IF;
  IF p_run_id IS NOT NULL THEN
    SELECT * INTO v_run FROM public.ari_flow_runs WHERE id = p_run_id;
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM public.agent_conversations c
      WHERE c.id = p_conversation_id AND c.user_id = p_user_id
    ) THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO v_run FROM public.ari_flow_runs
    WHERE conversation_id = p_conversation_id
    ORDER BY (status IN ('active','awaiting_owner','awaiting_approval','awaiting_handoff','blocked')) DESC,
      updated_at DESC
    LIMIT 1;
  END IF;
  IF NOT FOUND THEN RETURN NULL; END IF;
  PERFORM public.ari_flow_require_member(v_run.brand_id, p_user_id);
  RETURN public.ari_flow_run_json(v_run, p_user_id);
END;
$function$;
REVOKE ALL ON FUNCTION public.ari_flow_run_get(uuid,uuid,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ari_flow_run_get(uuid,uuid,uuid) TO service_role;

-- ── D-31: no evidence-free "completed" on model-driven durable jobs ────────
CREATE OR REPLACE FUNCTION public.ari_manage_agent_job(
  p_action text,
  p_job_id uuid DEFAULT NULL,
  p_brand_id uuid DEFAULT NULL,
  p_conversation_id uuid DEFAULT NULL,
  p_idempotency_key uuid DEFAULT NULL,
  p_expected_revision integer DEFAULT NULL,
  p_patch jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_job public.ari_agent_jobs%ROWTYPE;
  v_status text;
  v_evidence jsonb;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF p_action NOT IN ('create', 'get', 'list', 'checkpoint', 'pause', 'resume', 'cancel') THEN
    RAISE EXCEPTION 'invalid_job_action';
  END IF;
  IF COALESCE(jsonb_typeof(p_patch), '') <> 'object' THEN RAISE EXCEPTION 'invalid_job_patch'; END IF;
  IF p_brand_id IS NOT NULL AND NOT public.biz_is_brand_member_for_read(p_brand_id, v_actor) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF p_conversation_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.agent_conversations c
    WHERE c.id = p_conversation_id AND c.user_id = v_actor
  ) THEN RAISE EXCEPTION 'not_authorized'; END IF;

  IF p_action = 'list' THEN
    RETURN COALESCE((
      SELECT jsonb_agg(to_jsonb(j) - 'user_id' - 'lease_owner' ORDER BY j.updated_at DESC)
      FROM (SELECT * FROM public.ari_agent_jobs WHERE user_id = v_actor ORDER BY updated_at DESC LIMIT 30) j
    ), '[]'::jsonb);
  END IF;

  IF p_action = 'create' THEN
    IF p_idempotency_key IS NULL THEN RAISE EXCEPTION 'idempotency_key_required'; END IF;
    IF char_length(btrim(COALESCE(p_patch ->> 'goal_summary', ''))) NOT BETWEEN 1 AND 1000 THEN
      RAISE EXCEPTION 'goal_summary_required';
    END IF;
    INSERT INTO public.ari_agent_jobs(
      user_id, brand_id, conversation_id, idempotency_key, goal_summary,
      checkpoint, pending_step_keys, budget
    ) VALUES (
      v_actor, p_brand_id, p_conversation_id, p_idempotency_key,
      btrim(p_patch ->> 'goal_summary'),
      COALESCE(p_patch -> 'checkpoint', '{}'::jsonb),
      COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_patch -> 'pending_step_keys', '[]'::jsonb))), ARRAY[]::text[]),
      COALESCE(p_patch -> 'budget', '{"max_steps":24,"max_browser_reads":12,"max_retries":3,"max_wall_minutes":30}'::jsonb)
    )
    ON CONFLICT (user_id, idempotency_key) DO UPDATE
      SET updated_at = public.ari_agent_jobs.updated_at
    RETURNING * INTO v_job;
    RETURN to_jsonb(v_job) - 'user_id' - 'lease_owner';
  END IF;

  SELECT * INTO v_job FROM public.ari_agent_jobs
  WHERE id = p_job_id AND user_id = v_actor FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF p_action = 'get' THEN RETURN to_jsonb(v_job) - 'user_id' - 'lease_owner'; END IF;
  IF p_expected_revision IS NULL OR p_expected_revision <> v_job.revision THEN
    RAISE EXCEPTION 'revision_conflict';
  END IF;

  v_status := CASE p_action
    WHEN 'pause' THEN 'paused'
    WHEN 'resume' THEN 'queued'
    WHEN 'cancel' THEN 'cancelled'
    ELSE COALESCE(NULLIF(p_patch ->> 'status', ''), v_job.status)
  END;
  IF v_status NOT IN ('queued', 'running', 'paused', 'awaiting_approval', 'completed', 'failed', 'cancelled') THEN
    RAISE EXCEPTION 'invalid_job_status';
  END IF;
  IF v_job.status IN ('completed', 'cancelled') AND v_status <> v_job.status THEN
    RAISE EXCEPTION 'terminal_job';
  END IF;
  -- #3355 P3 (D-31): completing a job needs at least one evidence reference,
  -- either in this checkpoint or already saved on the job.
  IF v_status = 'completed' AND v_job.status <> 'completed' THEN
    v_evidence := COALESCE(p_patch -> 'checkpoint' -> 'evidence_refs', v_job.checkpoint -> 'evidence_refs');
    IF v_evidence IS NULL OR jsonb_typeof(v_evidence) <> 'array'
       OR jsonb_array_length(v_evidence) = 0 THEN
      RAISE EXCEPTION 'completion_evidence_required';
    END IF;
  END IF;
  UPDATE public.ari_agent_jobs
  SET status = v_status,
      checkpoint = checkpoint || COALESCE(p_patch -> 'checkpoint', '{}'::jsonb),
      completed_step_keys = CASE WHEN p_patch ? 'completed_step_keys'
        THEN ARRAY(SELECT jsonb_array_elements_text(p_patch -> 'completed_step_keys'))
        ELSE completed_step_keys END,
      pending_step_keys = CASE WHEN p_patch ? 'pending_step_keys'
        THEN ARRAY(SELECT jsonb_array_elements_text(p_patch -> 'pending_step_keys'))
        ELSE pending_step_keys END,
      last_error_code = CASE WHEN p_patch ? 'last_error_code' THEN NULLIF(p_patch ->> 'last_error_code', '') ELSE last_error_code END,
      lease_owner = NULL,
      lease_expires_at = NULL,
      revision = revision + 1,
      completed_at = CASE WHEN v_status = 'completed' THEN now() ELSE completed_at END,
      updated_at = now()
  WHERE id = v_job.id
  RETURNING * INTO v_job;
  RETURN to_jsonb(v_job) - 'user_id' - 'lease_owner';
END;
$$;
REVOKE ALL ON FUNCTION public.ari_manage_agent_job(text, uuid, uuid, uuid, uuid, integer, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ari_manage_agent_job(text, uuid, uuid, uuid, uuid, integer, jsonb) TO authenticated, service_role;
