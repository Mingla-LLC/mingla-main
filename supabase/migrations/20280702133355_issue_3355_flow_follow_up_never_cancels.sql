-- Issue #3355 rework 3 (R3-7) — "Yes" on an old completion card never
-- cancels a paused setup.
--
-- Tester retest 3: a host parks a trip setup, then taps "Get it ready" on the
-- older completed event card. The follow-up start (answers.follow_up_of) went
-- through the "one open run per chat" rule and cancelled the parked trip.
-- A follow-up run now only touches its own draft: with another setup open in
-- the chat (live or parked) the start is refused with flow_run_open (PT409);
-- the edge says the open setup is there and offers Resume. Every other start
-- keeps the Wave A rule (a new setup replaces the chat's older one).
--
-- Same signature, grants re-stated. Static SQL. Forward-only.

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

  -- #3355 rework 3 (R3-7): a follow-up run ("Yes" on a completed setup's
  -- card) only touches its own draft. With another setup open in this chat,
  -- live or parked, it is refused; it never cancels that setup.
  IF p_conversation_id IS NOT NULL AND p_answers ? 'follow_up_of' AND EXISTS (
    SELECT 1 FROM public.ari_flow_runs open_run
    WHERE open_run.conversation_id = p_conversation_id
      AND open_run.status = ANY(v_open)
  ) THEN
    RAISE EXCEPTION 'flow_run_open' USING ERRCODE = 'PT409';
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
