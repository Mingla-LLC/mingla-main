-- Issue #3355 Wave A (A2 + A5) — Ari flow runs can be parked, and runs end.
--
-- Production 2026-11-10: a host's typed request inside an open event setup
-- got "I didn't catch that" twice (the flow jail), and all 7 flow runs ever
-- created were still open, with nothing to end them.
--
--   A2  `parked`: the host asked for something else while a card was open.
--       The run is set aside (not live, so typed turns go to the agent loop)
--       and only the host's Resume choice (ari_flow_run_resume) brings it back
--       to the status it had.
--   A5  Runs end: a run idle for 24 hours becomes `expired`
--       (ari_flow_runs_expire_idle, called by the Ari turn sweep); a chat holds
--       at most one open (live or parked) run; a new flow in a chat closes the
--       chat's parked run; resume works only in the run's own chat.
--       Data: every run already idle for 24 hours is expired (idempotent).
--
-- Why a new status rather than an existing one: every non-terminal status is
-- live (the runner answers typed turns for it), and every terminal one is
-- final (a run cannot come back). Parking needs "not live, but resumable".
--
-- Static SQL only. Conflicts raise PT409, never 40001. Service-role only.
-- Invariants are declared in
-- supabase/migrations/__tests__/issue_3355_flow_runs_park_and_expire.implementor.pg17.test.sql.

BEGIN;

SET LOCAL lock_timeout = '10s';

-- ── Status: + parked ───────────────────────────────────────────────────────
ALTER TABLE public.ari_flow_runs
  ADD COLUMN IF NOT EXISTS parked_from_status text NULL
    CHECK (parked_from_status IS NULL OR parked_from_status IN (
      'active','awaiting_owner','awaiting_approval','awaiting_handoff','blocked'
    )),
  ADD COLUMN IF NOT EXISTS parked_at timestamptz NULL;

ALTER TABLE public.ari_flow_runs
  DROP CONSTRAINT IF EXISTS ari_flow_runs_status_check;
ALTER TABLE public.ari_flow_runs
  ADD CONSTRAINT ari_flow_runs_status_check CHECK (status IN (
    'active','awaiting_owner','awaiting_approval','awaiting_handoff',
    'blocked','completed','cancelled','expired','parked'
  ));

-- A5: one open (live or parked) run per chat.
CREATE UNIQUE INDEX IF NOT EXISTS ari_flow_runs_one_open_per_conversation
  ON public.ari_flow_runs(conversation_id)
  WHERE conversation_id IS NOT NULL
    AND status IN ('active','awaiting_owner','awaiting_approval','awaiting_handoff','blocked','parked');

COMMENT ON COLUMN public.ari_flow_runs.parked_from_status IS
  '#3355 Wave A: the live status a parked run returns to on Resume.';

-- ── The expiry rule (one place) ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ari_flow_run_expire_after()
RETURNS interval
LANGUAGE sql IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT interval '24 hours';
$function$;
REVOKE ALL ON FUNCTION public.ari_flow_run_expire_after() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ari_flow_run_expire_after() TO service_role;

-- ── Advance: same signature; + parked (from a live status) ─────────────────
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
  v_prior text;
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
    'blocked','completed','cancelled','expired','parked'
  ) THEN
    RAISE EXCEPTION 'flow_status_invalid' USING ERRCODE = '22023';
  END IF;
  v_prior := CASE WHEN v_status = 'parked' THEN v_run.status END;

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
      parked_from_status = CASE WHEN v_status = 'parked' THEN v_prior ELSE parked_from_status END,
      parked_at = CASE WHEN v_status = 'parked' THEN now() ELSE parked_at END,
      revision = revision + 1,
      updated_at = now(),
      completed_at = CASE WHEN v_status = 'completed' THEN now() ELSE completed_at END,
      lease_owner = CASE WHEN v_status IN ('completed','cancelled','expired','parked') THEN NULL ELSE lease_owner END,
      lease_token = CASE WHEN v_status IN ('completed','cancelled','expired','parked') THEN NULL ELSE lease_token END,
      lease_expires_at = CASE WHEN v_status IN ('completed','cancelled','expired','parked') THEN NULL ELSE lease_expires_at END
  WHERE id = v_run.id
  RETURNING * INTO v_run;
  RETURN public.ari_flow_run_json(v_run, v_run.started_by);
END;
$function$;
REVOKE ALL ON FUNCTION public.ari_flow_run_advance(uuid,uuid,integer,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ari_flow_run_advance(uuid,uuid,integer,jsonb)
  TO service_role;

-- ── Resume: a parked run is live again, in its own chat only ───────────────
CREATE OR REPLACE FUNCTION public.ari_flow_run_resume(
  p_user_id uuid,
  p_run_id uuid,
  p_conversation_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_run public.ari_flow_runs%ROWTYPE;
BEGIN
  SELECT * INTO v_run FROM public.ari_flow_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'flow_run_not_found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.ari_flow_require_member(v_run.brand_id, p_user_id);
  IF v_run.started_by <> p_user_id
     OR v_run.conversation_id IS DISTINCT FROM p_conversation_id
     OR p_conversation_id IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_run.status <> 'parked' THEN
    RAISE EXCEPTION 'flow_run_not_parked' USING ERRCODE = 'PT409';
  END IF;
  -- An idle parked run ends instead of coming back (A5); the caller reads
  -- the expired run and says so.
  IF public.ari_flow_run_last_activity(v_run) < now() - public.ari_flow_run_expire_after() THEN
    UPDATE public.ari_flow_runs
    SET status = 'expired', revision = revision + 1, updated_at = now()
    WHERE id = v_run.id
    RETURNING * INTO v_run;
    RETURN public.ari_flow_run_json(v_run, p_user_id);
  END IF;
  -- The brand-wide flow somebody started meanwhile wins; never two live.
  IF v_run.concurrency = 'one_per_brand' AND EXISTS (
    SELECT 1 FROM public.ari_flow_runs other
    WHERE other.brand_id = v_run.brand_id AND other.flow_key = v_run.flow_key
      AND other.concurrency = 'one_per_brand' AND other.id <> v_run.id
      AND other.status IN ('active','awaiting_owner','awaiting_approval','awaiting_handoff','blocked')
  ) THEN
    RAISE EXCEPTION 'flow_run_active' USING ERRCODE = 'PT409';
  END IF;

  UPDATE public.ari_flow_runs
  SET status = COALESCE(parked_from_status, 'active'),
      parked_from_status = NULL,
      revision = revision + 1,
      updated_at = now()
  WHERE id = v_run.id
  RETURNING * INTO v_run;
  RETURN public.ari_flow_run_json(v_run, p_user_id);
END;
$function$;
REVOKE ALL ON FUNCTION public.ari_flow_run_resume(uuid,uuid,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ari_flow_run_resume(uuid,uuid,uuid) TO service_role;

-- ── Expire: one person's runs idle past the rule (the Ari turn sweep) ──────
CREATE OR REPLACE FUNCTION public.ari_flow_runs_expire_idle(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_count integer;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'flow_user_required' USING ERRCODE = '22023';
  END IF;
  UPDATE public.ari_flow_runs r
  SET status = 'expired', lease_owner = NULL, lease_token = NULL,
      lease_expires_at = NULL, revision = r.revision + 1, updated_at = now()
  WHERE r.started_by = p_user_id
    AND r.status IN ('active','awaiting_owner','awaiting_approval','awaiting_handoff','blocked','parked')
    AND (r.lease_expires_at IS NULL OR r.lease_expires_at <= now())
    AND public.ari_flow_run_last_activity(r) < now() - public.ari_flow_run_expire_after();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;
REVOKE ALL ON FUNCTION public.ari_flow_runs_expire_idle(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ari_flow_runs_expire_idle(uuid) TO service_role;

-- ── Expire: every idle run, whoever started it (#3355 rework 1, P2-12) ────
-- A host who never comes back would otherwise keep an open run forever. Same
-- rule as above (24 h idle, never a run with a live lease); a run another
-- writer holds right now is skipped and caught by the next sweep. Bounded
-- per call so one sweep stays short.
CREATE OR REPLACE FUNCTION public.ari_flow_runs_expire_idle_all(
  p_limit integer DEFAULT 500
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_count integer;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 5000 THEN
    RAISE EXCEPTION 'flow_sweep_limit_invalid' USING ERRCODE = '22023';
  END IF;
  WITH idle AS (
    SELECT r.id FROM public.ari_flow_runs r
     WHERE r.status IN ('active','awaiting_owner','awaiting_approval','awaiting_handoff','blocked','parked')
       AND (r.lease_expires_at IS NULL OR r.lease_expires_at <= now())
       AND public.ari_flow_run_last_activity(r) < now() - public.ari_flow_run_expire_after()
     ORDER BY r.updated_at
     LIMIT p_limit
     FOR UPDATE SKIP LOCKED
  )
  UPDATE public.ari_flow_runs r
  SET status = 'expired', lease_owner = NULL, lease_token = NULL,
      lease_expires_at = NULL, revision = r.revision + 1, updated_at = now()
  FROM idle
  WHERE r.id = idle.id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;
REVOKE ALL ON FUNCTION public.ari_flow_runs_expire_idle_all(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ari_flow_runs_expire_idle_all(integer) TO service_role;

-- ── Start: same signature; a new flow closes the chat's parked run too ─────
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
  v_open text[] := ARRAY['active','awaiting_owner','awaiting_approval','awaiting_handoff','blocked','parked'];
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
          WHERE other.conversation_id = p_conversation_id AND other.status = ANY(v_open)
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

  -- One open run per chat: a new flow replaces the chat's older one, live
  -- or parked (#3355 Wave A).
  IF p_conversation_id IS NOT NULL THEN
    UPDATE public.ari_flow_runs
    SET status = 'cancelled', lease_owner = NULL, lease_token = NULL,
        lease_expires_at = NULL, revision = revision + 1, updated_at = now()
    WHERE conversation_id = p_conversation_id AND status = ANY(v_open);
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

-- ── Get: same signature; a live run first, then a parked one ───────────────
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
      (status = 'parked') DESC,
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

-- ── Data (A5): every run already idle past the rule ends now ───────────────
-- Idempotent: a second run finds nothing open and idle.
UPDATE public.ari_flow_runs r
SET status = 'expired', lease_owner = NULL, lease_token = NULL,
    lease_expires_at = NULL, revision = r.revision + 1, updated_at = now()
WHERE r.status IN ('active','awaiting_owner','awaiting_approval','awaiting_handoff','blocked','parked')
  AND public.ari_flow_run_last_activity(r) < now() - interval '24 hours';

-- The hourly global sweep (#3355 rework 1, P2-12). Static SQL in the job;
-- re-running this migration replaces it.
DO $cron$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'Issue #3355: pg_cron unavailable; idle Ari flow runs expire only on their starter''s next turn.';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'issue_3355_ari_flow_runs_expire_idle') THEN
    PERFORM cron.unschedule('issue_3355_ari_flow_runs_expire_idle');
  END IF;
  PERFORM cron.schedule('issue_3355_ari_flow_runs_expire_idle', '17 * * * *',
    $job$SELECT public.ari_flow_runs_expire_idle_all(500);$job$);
END
$cron$;

COMMIT;
