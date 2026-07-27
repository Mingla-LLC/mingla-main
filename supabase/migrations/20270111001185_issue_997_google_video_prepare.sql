-- ISSUE-997 D1 [Campaign Builder video — Google prepare] — admit 'google' to the
-- video-preparation RPC platform guard so a Google (YouTube) video can be prepared
-- through admin-ad-creative-prepare. ADDITIVE + IDEMPOTENT: CREATE OR REPLACE of
-- public.ad_creative_prepare_begin, byte-identical to
-- 20270111001184_issue_1184_video_prepare_lifecycle.sql (lines 67-269) EXCEPT the
-- platform guard now also lists 'google'. No table/column/constraint/index change:
-- ad_creative_platform_refs already allows platform='google' + external_kind='video'
-- (issue-866 migration). Google video CREATE remains FAIL-CLOSED (that is 997-D2).
-- This migration creates NO ad object and moves NO money.

CREATE OR REPLACE FUNCTION public.ad_creative_prepare_begin(
  p_creative_id uuid,
  p_platform text,
  p_lane text,
  p_external_account_id text,
  p_external_kind text,
  p_content_hash text,
  p_action text,
  p_trace_id uuid,
  p_now timestamptz DEFAULT clock_timestamp()
)
RETURNS TABLE (
  ref_id uuid, won boolean, decision text,
  current_attempt_id uuid, current_attempt_count integer,
  current_status text, current_external_ref text,
  current_external_ref_extra jsonb, current_content_hash text,
  current_attempt_started_at timestamptz,
  current_provider_ref_recorded_at timestamptz,
  current_last_checked_at timestamptz, current_deadline_at timestamptz,
  current_error_code text, current_retryable boolean,
  current_provider_terminal_attempt_id uuid,
  current_provider_terminal_at timestamptz,
  current_provider_terminal_code text, current_trace_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_ref public.ad_creative_platform_refs%ROWTYPE;
  v_inserted integer := 0;
  v_elapsed interval;
  v_replace boolean := false;
BEGIN
  IF p_creative_id IS NULL OR p_trace_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'creative_id_and_trace_id_required';
  END IF;
  IF p_platform NOT IN ('meta','snapchat','tiktok','google') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'platform_invalid';
  END IF;
  IF p_lane <> 'consumer' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'lane_invalid';
  END IF;
  IF p_external_kind <> 'video' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'external_kind_invalid';
  END IF;
  IF p_action NOT IN ('start','status','retry') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'action_invalid';
  END IF;
  IF btrim(coalesce(p_external_account_id, '')) = '' OR btrim(coalesce(p_content_hash, '')) = '' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'account_and_hash_required';
  END IF;

  INSERT INTO public.ad_creative_platform_refs (
    creative_id, platform, lane, external_account_id, external_kind,
    content_hash, status, trace_id
  )
  VALUES (
    p_creative_id, p_platform, p_lane, p_external_account_id, p_external_kind,
    p_content_hash, 'pending', p_trace_id
  )
  ON CONFLICT ON CONSTRAINT ad_creative_platform_refs_uniq DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  SELECT *
  INTO STRICT v_ref
  FROM public.ad_creative_platform_refs
  WHERE creative_id = p_creative_id
    AND platform = p_platform
    AND lane = p_lane
    AND external_account_id = p_external_account_id
  FOR UPDATE;

  IF v_ref.external_kind <> p_external_kind OR v_ref.content_hash <> p_content_hash THEN
    RETURN QUERY SELECT
      v_ref.id, false, 'identity_conflict'::text,
      v_ref.attempt_id, v_ref.attempt_count, v_ref.status, v_ref.external_ref,
      v_ref.external_ref_extra, v_ref.content_hash, v_ref.attempt_started_at,
      v_ref.provider_ref_recorded_at, v_ref.last_checked_at, v_ref.deadline_at,
      v_ref.error_code, v_ref.retryable, v_ref.provider_terminal_attempt_id,
      v_ref.provider_terminal_at, v_ref.provider_terminal_code, v_ref.trace_id;
    RETURN;
  END IF;

  IF v_ref.status IN ('uploading','processing')
     AND v_ref.deadline_at IS NOT NULL
     AND p_now >= v_ref.deadline_at THEN
    UPDATE public.ad_creative_platform_refs
    SET status = 'timed_out',
        last_checked_at = p_now,
        error = 'Preparation exceeded its server deadline. Check status before retrying.',
        error_code = 'preparation_deadline_exceeded',
        retryable = true,
        provider_terminal_attempt_id = NULL,
        provider_terminal_at = NULL,
        provider_terminal_code = NULL
    WHERE id = v_ref.id
    RETURNING * INTO v_ref;
  END IF;

  v_elapsed := p_now - coalesce(v_ref.attempt_started_at, p_now);

  IF v_ref.status = 'pending' THEN
    IF p_action = 'start' THEN
      v_replace := true;
    ELSIF p_action = 'status' THEN
      decision := 'return_not_started';
    ELSE
      decision := 'action_not_applicable';
    END IF;
  ELSIF v_ref.status = 'ready' THEN
    decision := 'return_ready';
  ELSIF v_ref.status = 'uploading' AND v_ref.external_ref IS NULL THEN
    IF p_action = 'retry' AND v_elapsed >= interval '15 minutes' THEN
      v_replace := true;
    ELSE
      IF v_elapsed >= interval '15 minutes' AND NOT v_ref.retryable THEN
        UPDATE public.ad_creative_platform_refs
        SET retryable = true,
            error_code = 'provider_ref_not_recorded',
            error = 'The provider did not return a stable media id. Retry is available.'
        WHERE id = v_ref.id
        RETURNING * INTO v_ref;
      END IF;
      decision := 'return_active';
    END IF;
  ELSIF v_ref.status IN ('uploading','processing') AND v_ref.external_ref IS NOT NULL THEN
    decision := CASE WHEN p_action = 'start' THEN 'return_active' ELSE 'check_existing' END;
  ELSIF v_ref.status = 'processing' AND v_ref.external_ref IS NULL THEN
    decision := 'action_not_applicable';
  ELSIF v_ref.status = 'failed' THEN
    IF p_action = 'retry' AND (
      v_ref.external_ref IS NULL OR (
        v_ref.provider_terminal_attempt_id IS NOT NULL
        AND v_ref.provider_terminal_attempt_id = v_ref.attempt_id
      )
    ) THEN
      v_replace := true;
    ELSIF p_action IN ('status','retry') AND v_ref.external_ref IS NOT NULL
      AND v_ref.provider_terminal_attempt_id IS NULL THEN
      decision := 'check_existing';
    ELSE
      decision := 'return_terminal';
    END IF;
  ELSIF v_ref.status = 'timed_out' THEN
    IF p_action = 'retry' AND v_ref.external_ref IS NULL THEN
      v_replace := true;
    ELSIF p_action IN ('status','retry') AND v_ref.external_ref IS NOT NULL THEN
      decision := 'check_existing';
    ELSE
      decision := 'return_terminal';
    END IF;
  ELSE
    decision := 'action_not_applicable';
  END IF;

  IF v_replace THEN
    UPDATE public.ad_creative_platform_refs
    SET attempt_id = gen_random_uuid(),
        attempt_count = attempt_count + 1,
        attempt_started_at = p_now,
        deadline_at = p_now + interval '60 minutes',
        last_checked_at = NULL,
        trace_id = p_trace_id,
        status = 'uploading',
        retryable = false,
        error = NULL,
        error_code = NULL,
        provider_terminal_attempt_id = NULL,
        provider_terminal_at = NULL,
        provider_terminal_code = NULL,
        external_ref = CASE
          WHEN external_ref IS NULL
            OR (v_ref.status = 'failed' AND v_ref.provider_terminal_attempt_id = v_ref.attempt_id)
            OR (v_ref.status IN ('failed','timed_out') AND external_ref IS NULL)
          THEN NULL ELSE external_ref END,
        external_ref_extra = CASE
          WHEN external_ref IS NULL
            OR (v_ref.status = 'failed' AND v_ref.provider_terminal_attempt_id = v_ref.attempt_id)
            OR (v_ref.status IN ('failed','timed_out') AND external_ref IS NULL)
          THEN '{}'::jsonb ELSE external_ref_extra END,
        provider_ref_recorded_at = CASE
          WHEN external_ref IS NULL
            OR (v_ref.status = 'failed' AND v_ref.provider_terminal_attempt_id = v_ref.attempt_id)
            OR (v_ref.status IN ('failed','timed_out') AND external_ref IS NULL)
          THEN NULL ELSE provider_ref_recorded_at END
    WHERE id = v_ref.id
    RETURNING * INTO v_ref;
    won := true;
    decision := 'initiate';
  ELSE
    won := false;
  END IF;

  RETURN QUERY SELECT
    v_ref.id, won, decision,
    v_ref.attempt_id, v_ref.attempt_count, v_ref.status, v_ref.external_ref,
    v_ref.external_ref_extra, v_ref.content_hash, v_ref.attempt_started_at,
    v_ref.provider_ref_recorded_at, v_ref.last_checked_at, v_ref.deadline_at,
    v_ref.error_code, v_ref.retryable, v_ref.provider_terminal_attempt_id,
    v_ref.provider_terminal_at, v_ref.provider_terminal_code, v_ref.trace_id;
END;
$function$;

ALTER FUNCTION public.ad_creative_prepare_begin(
  uuid, text, text, text, text, text, text, uuid, timestamptz
) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.ad_creative_prepare_begin(
  uuid, text, text, text, text, text, text, uuid, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ad_creative_prepare_begin(
  uuid, text, text, text, text, text, text, uuid, timestamptz
) TO service_role;

-- ISSUE-997 D1 self-verify — READ-ONLY, non-destructive: zero rows written, safe
-- on the live tables. Asserts the guard now admits 'google' while still admitting
-- meta/snapchat/tiktok, the RPC's SECURITY DEFINER + owner + search_path + service-
-- role-only privilege contract is intact, and the issue-866 base table already lists
-- google (platform CHECK) and video (external_kind CHECK). It never opens Google
-- CREATE — the create-branch 422 seam is unchanged (that is 997-D2).
DO $verify$
DECLARE
  v_def text := pg_get_functiondef(
    'public.ad_creative_prepare_begin(uuid,text,text,text,text,text,text,uuid,timestamptz)'::regprocedure
  );
BEGIN
  IF position('''google''' IN v_def) = 0 THEN
    RAISE EXCEPTION 'issue997 d1: google not present in ad_creative_prepare_begin platform guard';
  END IF;
  IF position('''meta''' IN v_def) = 0
     OR position('''snapchat''' IN v_def) = 0
     OR position('''tiktok''' IN v_def) = 0 THEN
    RAISE EXCEPTION 'issue997 d1: platform guard wholesale-rewritten (meta/snapchat/tiktok missing) — refuse';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'ad_creative_prepare_begin'
      AND p.prosecdef
      AND pg_get_userbyid(p.proowner) = 'postgres'
      AND p.proconfig @> ARRAY['search_path=public, pg_temp']
  ) THEN
    RAISE EXCEPTION 'issue997 d1: prepare RPC security contract regressed';
  END IF;
  IF has_function_privilege('anon', 'public.ad_creative_prepare_begin(uuid,text,text,text,text,text,text,uuid,timestamptz)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.ad_creative_prepare_begin(uuid,text,text,text,text,text,text,uuid,timestamptz)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.ad_creative_prepare_begin(uuid,text,text,text,text,text,text,uuid,timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue997 d1: prepare RPC privileges regressed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.ad_creative_platform_refs'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%platform%'
      AND pg_get_constraintdef(oid) LIKE '%google%'
  ) THEN
    RAISE EXCEPTION 'issue997 d1: ad_creative_platform_refs platform CHECK missing google (866 should list it)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.ad_creative_platform_refs'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%external_kind%'
      AND pg_get_constraintdef(oid) LIKE '%video%'
  ) THEN
    RAISE EXCEPTION 'issue997 d1: ad_creative_platform_refs external_kind CHECK missing video (866 should list it)';
  END IF;
END;
$verify$;
