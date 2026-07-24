-- ISSUE-1184 [Campaign Builder video Phase A] — resumable, account-scoped
-- creative preparation. Additive lifecycle metadata; no existing creative is
-- backfilled and no ad object is created by this migration.

ALTER TABLE public.ad_creatives
  ADD COLUMN IF NOT EXISTS poster_content_hash text NULL;

ALTER TABLE public.ad_creative_platform_refs
  DROP CONSTRAINT IF EXISTS ad_creative_platform_refs_status_check;
ALTER TABLE public.ad_creative_platform_refs
  ADD CONSTRAINT ad_creative_platform_refs_status_check
  CHECK (status IN ('pending','uploading','processing','ready','failed','timed_out'));

ALTER TABLE public.ad_creative_platform_refs
  ADD COLUMN IF NOT EXISTS attempt_id uuid NULL,
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS attempt_started_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS provider_ref_recorded_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS last_checked_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS deadline_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS error_code text NULL,
  ADD COLUMN IF NOT EXISTS retryable boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS trace_id uuid NULL,
  ADD COLUMN IF NOT EXISTS provider_terminal_attempt_id uuid NULL,
  ADD COLUMN IF NOT EXISTS provider_terminal_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS provider_terminal_code text NULL;

ALTER TABLE public.ad_creative_platform_refs
  DROP CONSTRAINT IF EXISTS ad_creative_platform_refs_attempt_count_check;
ALTER TABLE public.ad_creative_platform_refs
  ADD CONSTRAINT ad_creative_platform_refs_attempt_count_check
  CHECK (attempt_count >= 0);

ALTER TABLE public.ad_creative_platform_refs
  DROP CONSTRAINT IF EXISTS ad_creative_platform_refs_terminal_proof_check;
ALTER TABLE public.ad_creative_platform_refs
  ADD CONSTRAINT ad_creative_platform_refs_terminal_proof_check
  CHECK (
    (provider_terminal_attempt_id IS NULL AND provider_terminal_at IS NULL AND provider_terminal_code IS NULL)
    OR
    (provider_terminal_attempt_id IS NOT NULL AND provider_terminal_at IS NOT NULL AND provider_terminal_code IS NOT NULL)
  );

ALTER TABLE public.ad_status_events
  ADD COLUMN IF NOT EXISTS creative_ref_id uuid NULL
  REFERENCES public.ad_creative_platform_refs(id) ON DELETE SET NULL;

ALTER TABLE public.ad_status_events
  DROP CONSTRAINT IF EXISTS ad_status_events_entity_check;
ALTER TABLE public.ad_status_events
  ADD CONSTRAINT ad_status_events_entity_check
  CHECK (entity IS NULL OR entity IN ('campaign','ad_set','ad','creative_ref'));

ALTER TABLE public.ad_status_events
  DROP CONSTRAINT IF EXISTS ad_status_events_action_check;
ALTER TABLE public.ad_status_events
  ADD CONSTRAINT ad_status_events_action_check
  CHECK (action IN (
    'create','launch','pause','sync','create_failed','rollback',
    'prepare_begin','prepare_ref_saved','prepare_check','prepare_ready',
    'prepare_failed','prepare_timeout','preview_request','preview_ready','preview_failed'
  ));

CREATE INDEX IF NOT EXISTS idx_ad_status_events_creative_ref
  ON public.ad_status_events (creative_ref_id, created_at DESC);

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
  IF p_platform NOT IN ('meta','snapchat','tiktok') THEN
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

DO $migration$
DECLARE
  v_bad_action_rejected boolean := false;
  v_good_action_accepted boolean := false;
  v_column_count integer;
BEGIN
  SELECT count(*)
  INTO v_column_count
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND (
      (table_name = 'ad_creatives' AND column_name = 'poster_content_hash')
      OR (
        table_name = 'ad_creative_platform_refs'
        AND column_name IN (
          'attempt_id','attempt_count','attempt_started_at','provider_ref_recorded_at',
          'last_checked_at','deadline_at','error_code','retryable','trace_id',
          'provider_terminal_attempt_id','provider_terminal_at','provider_terminal_code'
        )
      )
      OR (table_name = 'ad_status_events' AND column_name = 'creative_ref_id')
    );
  IF v_column_count <> 14 THEN
    RAISE EXCEPTION 'issue1184 lifecycle columns missing';
  END IF;
  IF (
    SELECT count(*) FROM pg_constraint
    WHERE conname IN (
      'ad_creative_platform_refs_status_check',
      'ad_creative_platform_refs_attempt_count_check',
      'ad_creative_platform_refs_terminal_proof_check',
      'ad_status_events_entity_check',
      'ad_status_events_action_check'
    )
  ) <> 5 THEN
    RAISE EXCEPTION 'issue1184 named constraints missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'idx_ad_status_events_creative_ref'
  ) THEN
    RAISE EXCEPTION 'issue1184 creative-ref audit index missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'ad_creative_prepare_begin'
      AND p.prosecdef
      AND pg_get_userbyid(p.proowner) = 'postgres'
      AND p.proconfig @> ARRAY['search_path=public, pg_temp']
  ) THEN
    RAISE EXCEPTION 'issue1184 prepare RPC security contract missing';
  END IF;
  IF has_function_privilege('anon', 'public.ad_creative_prepare_begin(uuid,text,text,text,text,text,text,uuid,timestamptz)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.ad_creative_prepare_begin(uuid,text,text,text,text,text,text,uuid,timestamptz)', 'EXECUTE')
    OR NOT has_function_privilege('service_role', 'public.ad_creative_prepare_begin(uuid,text,text,text,text,text,text,uuid,timestamptz)', 'EXECUTE')
  THEN
    RAISE EXCEPTION 'issue1184 prepare RPC privileges incorrect';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_class
    WHERE oid IN (
      'public.ad_creatives'::regclass,
      'public.ad_creative_platform_refs'::regclass,
      'public.ad_status_events'::regclass
    )
      AND NOT relrowsecurity
  ) THEN
    RAISE EXCEPTION 'issue1184 touched table lost RLS';
  END IF;

  BEGIN
    INSERT INTO public.ad_status_events(action, entity)
    VALUES ('prepare_check', 'creative_ref');
    v_good_action_accepted := true;
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'rollback_good_action_probe';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    NULL;
  END;
  IF NOT v_good_action_accepted THEN
    RAISE EXCEPTION 'issue1184 prepare_check action must be accepted';
  END IF;
  BEGIN
    INSERT INTO public.ad_status_events(action, entity)
    VALUES ('stale_attempt_reload', 'creative_ref');
  EXCEPTION WHEN check_violation THEN
    v_bad_action_rejected := true;
  END;
  IF NOT v_bad_action_rejected THEN
    RAISE EXCEPTION 'issue1184 stale_attempt_reload must not be an audit action';
  END IF;
END;
$migration$;
