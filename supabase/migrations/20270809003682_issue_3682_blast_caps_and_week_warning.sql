-- #3682 Wave 2.7 — per-brand monthly blast caps (100 SMS / 1,000 email) +
-- rolling-week blast count for the 4th-blast host warning.
-- Push is uncapped. Cap assert runs at confirm (before execution insert) so
-- exact lost-response replays that already have an execution are not blocked.

BEGIN;

CREATE OR REPLACE FUNCTION public.biz_brand_blast_usage_v1(
  p_actor_id uuid,
  p_brand_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $f$
DECLARE
  v_sms_cap integer := 100;
  v_email_cap integer := 1000;
  v_sms_used integer := 0;
  v_email_used integer := 0;
  v_blasts_week integer := 0;
  v_month_start timestamptz := date_trunc('month', timezone('utc', now()));
  v_week_start timestamptz := timezone('utc', now()) - interval '7 days';
BEGIN
  IF p_actor_id IS NULL OR p_brand_id IS NULL THEN
    RAISE EXCEPTION 'book_blast_forbidden' USING ERRCODE = '42501';
  END IF;
  IF public.biz_brand_effective_rank(p_brand_id, p_actor_id) < public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'book_blast_forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(SUM(e.reachable_count), 0)::integer
  INTO v_sms_used
  FROM public.marketing_book_send_executions e
  JOIN public.marketing_campaigns c ON c.id = e.campaign_id
  WHERE e.brand_id = p_brand_id
    AND c.channel = 'sms'
    AND e.confirmed_at >= v_month_start;

  SELECT COALESCE(SUM(e.reachable_count), 0)::integer
  INTO v_email_used
  FROM public.marketing_book_send_executions e
  JOIN public.marketing_campaigns c ON c.id = e.campaign_id
  WHERE e.brand_id = p_brand_id
    AND c.channel = 'email'
    AND e.confirmed_at >= v_month_start;

  SELECT COUNT(*)::integer
  INTO v_blasts_week
  FROM public.marketing_book_send_executions e
  WHERE e.brand_id = p_brand_id
    AND e.confirmed_at >= v_week_start;

  RETURN jsonb_build_object(
    'smsCap', v_sms_cap,
    'smsUsed', v_sms_used,
    'smsRemaining', GREATEST(v_sms_cap - v_sms_used, 0),
    'emailCap', v_email_cap,
    'emailUsed', v_email_used,
    'emailRemaining', GREATEST(v_email_cap - v_email_used, 0),
    'blastsThisWeek', v_blasts_week,
    'weekWarningAt', 3
  );
END;
$f$;

REVOKE ALL ON FUNCTION public.biz_brand_blast_usage_v1(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.biz_brand_blast_usage_v1(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.biz_assert_brand_blast_allowance_v1(
  p_brand_id uuid,
  p_channel text,
  p_additional_reachable integer
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $f$
DECLARE
  v_cap integer;
  v_used integer := 0;
  v_month_start timestamptz := date_trunc('month', timezone('utc', now()));
BEGIN
  IF p_channel = 'push' OR COALESCE(p_additional_reachable, 0) <= 0 THEN
    RETURN;
  END IF;
  IF p_channel = 'sms' THEN
    v_cap := 100;
  ELSIF p_channel = 'email' THEN
    v_cap := 1000;
  ELSE
    RETURN;
  END IF;

  -- Serialize brand×channel confirm races so two campaigns cannot both pass
  -- the pre-insert read and exceed the monthly aggregate.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('blast_cap:' || p_brand_id::text || ':' || p_channel, 3682)
  );

  SELECT COALESCE(SUM(e.reachable_count), 0)::integer
  INTO v_used
  FROM public.marketing_book_send_executions e
  JOIN public.marketing_campaigns c ON c.id = e.campaign_id
  WHERE e.brand_id = p_brand_id
    AND c.channel = p_channel
    AND e.confirmed_at >= v_month_start;

  IF v_used + p_additional_reachable > v_cap THEN
    RAISE EXCEPTION 'book_blast_monthly_cap_exceeded' USING ERRCODE = 'P0001';
  END IF;
END;
$f$;

REVOKE ALL ON FUNCTION public.biz_assert_brand_blast_allowance_v1(uuid, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.biz_assert_brand_blast_allowance_v1(uuid, text, integer)
  TO service_role;

-- Cap gate on the sealed Book/People confirm owner (before INSERT).
CREATE OR REPLACE FUNCTION public.issue_2395_confirm_marketing_book_send_legacy(
  p_actor_id uuid,
  p_campaign_id uuid,
  p_client_request_id uuid,
  p_quote_snapshot jsonb,
  p_scheduled_for timestamptz
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $f$
DECLARE
  v_campaign public.marketing_campaigns%ROWTYPE;
  v_existing public.marketing_book_send_executions%ROWTYPE;
  v_execution uuid;
  v_candidates jsonb;
  v_row jsonb;
  v_now timestamptz := now();
BEGIN
  IF jsonb_typeof(p_quote_snapshot) <> 'object'
    OR (p_quote_snapshot->>'quoteVersion')::int <> 1
    OR COALESCE(p_quote_snapshot->>'quoteHash', '') !~ '^[0-9a-f]{64}$'
    OR COALESCE(p_quote_snapshot->>'contentHash', '') !~ '^[0-9a-f]{64}$'
    OR jsonb_typeof(p_quote_snapshot->'content') <> 'object'
    OR (p_quote_snapshot->>'quotedAt')::timestamptz < v_now - interval '5 minutes'
  THEN
    RAISE EXCEPTION 'book_blast_preview_stale' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_existing
  FROM public.marketing_book_send_executions
  WHERE brand_id = (p_quote_snapshot->>'brandId')::uuid
    AND client_request_id = p_client_request_id;
  IF FOUND THEN
    IF v_existing.actor_id = p_actor_id
      AND v_existing.campaign_id = p_campaign_id
      AND v_existing.quote_hash = p_quote_snapshot->>'quoteHash'
    THEN
      RETURN jsonb_build_object(
        'executionId', v_existing.id,
        'campaignId', v_existing.campaign_id,
        'scheduledFor', v_existing.scheduled_for,
        'replay', true
      );
    END IF;
    RAISE EXCEPTION 'book_blast_idempotency_conflict' USING ERRCODE = '23505';
  END IF;

  v_candidates := public.biz_marketing_book_quote_candidates(p_actor_id, p_campaign_id);
  SELECT * INTO v_campaign FROM public.marketing_campaigns WHERE id = p_campaign_id FOR UPDATE;
  IF v_campaign.channel_payload IS DISTINCT FROM p_quote_snapshot->'content'
    OR (v_candidates->>'selectedCount')::int IS DISTINCT FROM (p_quote_snapshot->>'selectedCount')::int
    OR (
      SELECT jsonb_agg(jsonb_build_object(
        'brandPersonId', x->>'brandPersonId',
        'contactMethodId', x->>'contactMethodId',
        'normalizedContact', x->>'normalizedContact',
        'allowed', x->>'allowed',
        'safeReasonCode', x->>'safeReasonCode'
      ) ORDER BY x->>'brandPersonId')
      FROM jsonb_array_elements(v_candidates->'candidates') x
    ) IS DISTINCT FROM (
      SELECT jsonb_agg(jsonb_build_object(
        'brandPersonId', x->>'brandPersonId',
        'contactMethodId', x->>'contactMethodId',
        'normalizedContact', x->>'normalizedContact',
        'allowed', x->>'allowed',
        'safeReasonCode', x->>'safeReasonCode'
      ) ORDER BY x->>'brandPersonId')
      FROM jsonb_array_elements(p_quote_snapshot->'candidates') x
    )
  THEN
    RAISE EXCEPTION 'book_blast_preview_stale' USING ERRCODE = '23514';
  END IF;
  IF (p_quote_snapshot->>'reachableCount')::int = 0 THEN
    RAISE EXCEPTION 'book_blast_zero_recipients' USING ERRCODE = '23514';
  END IF;

  PERFORM public.biz_assert_brand_blast_allowance_v1(
    v_campaign.brand_id,
    v_campaign.channel,
    (p_quote_snapshot->>'reachableCount')::int
  );

  BEGIN
    INSERT INTO public.marketing_book_send_executions(
      brand_id, campaign_id, actor_id, client_request_id, quote_version, quote_hash, content_hash,
      selected_count, reachable_count, suppressed_count, unavailable_count, sms_segment_count,
      estimated_cost_minor, currency, cost_kind, ratebook_ids, source_references, quoted_at,
      scheduled_for, send_mode
    ) VALUES (
      v_campaign.brand_id, p_campaign_id, p_actor_id, p_client_request_id, 1,
      p_quote_snapshot->>'quoteHash', p_quote_snapshot->>'contentHash',
      (p_quote_snapshot->>'selectedCount')::int,
      (p_quote_snapshot->>'reachableCount')::int,
      (p_quote_snapshot->>'suppressedCount')::int,
      (p_quote_snapshot->>'unavailableCount')::int,
      (p_quote_snapshot->>'smsSegments')::int,
      NULLIF(p_quote_snapshot->>'estimatedCostMinor', '')::bigint,
      NULLIF(p_quote_snapshot->>'currency', ''),
      p_quote_snapshot->>'costKind',
      COALESCE(p_quote_snapshot->'rateIds', '[]'),
      COALESCE(p_quote_snapshot->'sourceReferences', '[]'),
      (p_quote_snapshot->>'quotedAt')::timestamptz,
      COALESCE(p_scheduled_for, v_now),
      CASE WHEN p_scheduled_for IS NULL THEN 'now' ELSE 'scheduled' END
    ) RETURNING id INTO v_execution;
  EXCEPTION WHEN unique_violation THEN
    SELECT * INTO v_existing
    FROM public.marketing_book_send_executions
    WHERE campaign_id = p_campaign_id
       OR (brand_id = v_campaign.brand_id AND client_request_id = p_client_request_id)
    ORDER BY (campaign_id = p_campaign_id) DESC
    LIMIT 1;
    IF FOUND
      AND v_existing.actor_id = p_actor_id
      AND v_existing.campaign_id = p_campaign_id
      AND v_existing.client_request_id = p_client_request_id
      AND v_existing.quote_hash = p_quote_snapshot->>'quoteHash'
    THEN
      RETURN jsonb_build_object(
        'executionId', v_existing.id,
        'campaignId', v_existing.campaign_id,
        'scheduledFor', v_existing.scheduled_for,
        'replay', true
      );
    END IF;
    RAISE EXCEPTION 'book_blast_idempotency_conflict' USING ERRCODE = '23505';
  END;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_quote_snapshot->'candidates') LOOP
    INSERT INTO public.marketing_book_send_targets(
      execution_id, brand_person_id, contact_method_id, contact_value_digest, channel,
      outcome, reason, segment_count, allocated_cost_minor
    ) VALUES (
      v_execution,
      (v_row->>'brandPersonId')::uuid,
      NULLIF(v_row->>'contactMethodId', '')::uuid,
      CASE
        WHEN v_row->>'normalizedContact' IS NULL THEN NULL
        ELSE encode(extensions.digest(convert_to(v_row->>'normalizedContact', 'UTF8'), 'sha256'), 'hex')
      END,
      v_campaign.channel,
      CASE
        WHEN (v_row->>'contactMethodId') IS NULL THEN 'unavailable'
        WHEN (v_row->>'allowed')::boolean THEN 'queued'
        ELSE 'suppressed'
      END,
      COALESCE(v_row->>'safeReasonCode', 'allowed'),
      COALESCE((v_row->>'segments')::int, 0),
      NULLIF(v_row->>'allocatedCostMinor', '')::bigint
    );
  END LOOP;

  UPDATE public.marketing_campaigns
  SET status = 'scheduled',
      scheduled_for = COALESCE(p_scheduled_for, v_now),
      updated_at = v_now
  WHERE id = p_campaign_id AND status = 'draft';

  RETURN jsonb_build_object(
    'executionId', v_execution,
    'campaignId', p_campaign_id,
    'scheduledFor', COALESCE(p_scheduled_for, v_now),
    'replay', false
  );
END;
$f$;

REVOKE ALL ON FUNCTION public.issue_2395_confirm_marketing_book_send_legacy(uuid, uuid, uuid, jsonb, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_2395_confirm_marketing_book_send_legacy(uuid, uuid, uuid, jsonb, timestamptz)
  TO service_role;

-- Cap gate on Friends-of-followers / Followers confirm (before INSERT).
CREATE OR REPLACE FUNCTION public.biz_confirm_marketing_circle_send_v1(
  p_actor_id uuid,
  p_campaign_id uuid,
  p_client_request_id uuid,
  p_quote_snapshot jsonb,
  p_scheduled_for timestamptz
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $function$
DECLARE
  v_campaign public.marketing_campaigns%ROWTYPE;
  v_existing public.marketing_book_send_executions%ROWTYPE;
  v_execution uuid;
  v_live jsonb;
  v_row jsonb;
  v_now timestamptz := now();
BEGIN
  IF jsonb_typeof(p_quote_snapshot) <> 'object'
    OR (p_quote_snapshot->>'quoteVersion')::int <> 1
    OR COALESCE(p_quote_snapshot->>'quoteHash', '') !~ '^[0-9a-f]{64}$'
    OR COALESCE(p_quote_snapshot->>'contentHash', '') !~ '^[0-9a-f]{64}$'
    OR jsonb_typeof(p_quote_snapshot->'content') <> 'object'
    OR (p_quote_snapshot->>'quotedAt')::timestamptz < v_now - interval '5 minutes'
  THEN
    RAISE EXCEPTION 'circle_blast_snapshot_stale' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_existing
  FROM public.marketing_book_send_executions
  WHERE brand_id = (p_quote_snapshot->>'brandId')::uuid
    AND client_request_id = p_client_request_id;
  IF FOUND THEN
    IF v_existing.actor_id = p_actor_id
      AND v_existing.campaign_id = p_campaign_id
      AND v_existing.quote_hash = p_quote_snapshot->>'quoteHash'
    THEN
      RETURN jsonb_build_object(
        'executionId', v_existing.id,
        'campaignId', v_existing.campaign_id,
        'scheduledFor', v_existing.scheduled_for,
        'replay', true
      );
    END IF;
    RAISE EXCEPTION 'book_blast_idempotency_conflict' USING ERRCODE = '23505';
  END IF;

  v_live := public.biz_marketing_circle_quote_candidates_v1(p_actor_id, p_campaign_id);
  SELECT * INTO v_campaign FROM public.marketing_campaigns WHERE id = p_campaign_id FOR UPDATE;
  IF v_campaign.channel_payload IS DISTINCT FROM p_quote_snapshot->'content'
    OR v_live->>'audienceId' IS DISTINCT FROM p_quote_snapshot->>'audienceId'
    OR v_live->>'audienceKind' IS DISTINCT FROM p_quote_snapshot->>'audienceKind'
    OR (v_live->>'audienceVersion')::bigint IS DISTINCT FROM (p_quote_snapshot->>'audienceVersion')::bigint
    OR (v_live->>'selectedCount')::integer IS DISTINCT FROM (p_quote_snapshot->>'selectedCount')::integer
    OR (
      SELECT jsonb_agg(jsonb_build_object(
        'brandPersonId', x->>'brandPersonId',
        'recipientUserId', x->>'recipientUserId',
        'ring', x->>'ring',
        'snapshotVersion', x->>'snapshotVersion',
        'normalizedContact', x->>'normalizedContact',
        'allowed', x->>'allowed',
        'safeReasonCode', x->>'safeReasonCode'
      ) ORDER BY x->>'brandPersonId')
      FROM jsonb_array_elements(v_live->'candidates') x
    ) IS DISTINCT FROM (
      SELECT jsonb_agg(jsonb_build_object(
        'brandPersonId', x->>'brandPersonId',
        'recipientUserId', x->>'recipientUserId',
        'ring', x->>'ring',
        'snapshotVersion', x->>'snapshotVersion',
        'normalizedContact', x->>'normalizedContact',
        'allowed', x->>'allowed',
        'safeReasonCode', x->>'safeReasonCode'
      ) ORDER BY x->>'brandPersonId')
      FROM jsonb_array_elements(p_quote_snapshot->'candidates') x
    )
  THEN
    RAISE EXCEPTION 'circle_blast_snapshot_stale' USING ERRCODE = '23514';
  END IF;
  IF (p_quote_snapshot->>'reachableCount')::integer = 0 THEN
    RAISE EXCEPTION 'book_blast_zero_recipients' USING ERRCODE = '23514';
  END IF;

  PERFORM public.biz_assert_brand_blast_allowance_v1(
    v_campaign.brand_id,
    v_campaign.channel,
    (p_quote_snapshot->>'reachableCount')::integer
  );

  BEGIN
    INSERT INTO public.marketing_book_send_executions(
      brand_id, campaign_id, actor_id, client_request_id, quote_version, quote_hash, content_hash,
      selected_count, reachable_count, suppressed_count, unavailable_count, sms_segment_count,
      estimated_cost_minor, currency, cost_kind, ratebook_ids, source_references, quoted_at,
      scheduled_for, send_mode
    ) VALUES (
      v_campaign.brand_id, p_campaign_id, p_actor_id, p_client_request_id, 1,
      p_quote_snapshot->>'quoteHash', p_quote_snapshot->>'contentHash',
      (p_quote_snapshot->>'selectedCount')::integer,
      (p_quote_snapshot->>'reachableCount')::integer,
      (p_quote_snapshot->>'suppressedCount')::integer,
      (p_quote_snapshot->>'unavailableCount')::integer,
      (p_quote_snapshot->>'smsSegments')::integer,
      NULLIF(p_quote_snapshot->>'estimatedCostMinor', '')::bigint,
      NULLIF(p_quote_snapshot->>'currency', ''),
      p_quote_snapshot->>'costKind',
      COALESCE(p_quote_snapshot->'rateIds', '[]'),
      COALESCE(p_quote_snapshot->'sourceReferences', '[]'),
      (p_quote_snapshot->>'quotedAt')::timestamptz,
      COALESCE(p_scheduled_for, v_now),
      CASE WHEN p_scheduled_for IS NULL THEN 'now' ELSE 'scheduled' END
    ) RETURNING id INTO v_execution;
  EXCEPTION WHEN unique_violation THEN
    SELECT * INTO v_existing
    FROM public.marketing_book_send_executions
    WHERE campaign_id = p_campaign_id
       OR (brand_id = v_campaign.brand_id AND client_request_id = p_client_request_id)
    ORDER BY (campaign_id = p_campaign_id) DESC
    LIMIT 1;
    IF FOUND
      AND v_existing.actor_id = p_actor_id
      AND v_existing.campaign_id = p_campaign_id
      AND v_existing.client_request_id = p_client_request_id
      AND v_existing.quote_hash = p_quote_snapshot->>'quoteHash'
    THEN
      RETURN jsonb_build_object(
        'executionId', v_existing.id,
        'campaignId', v_existing.campaign_id,
        'scheduledFor', v_existing.scheduled_for,
        'replay', true
      );
    END IF;
    RAISE EXCEPTION 'book_blast_idempotency_conflict' USING ERRCODE = '23505';
  END;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_quote_snapshot->'candidates') LOOP
    INSERT INTO public.marketing_book_send_targets(
      execution_id, brand_person_id, recipient_user_id, ring, circle_snapshot_version,
      contact_method_id, contact_value_digest, channel, outcome, reason, segment_count,
      allocated_cost_minor
    ) VALUES (
      v_execution,
      NULL,
      (v_row->>'recipientUserId')::uuid,
      v_row->>'ring',
      (v_row->>'snapshotVersion')::bigint,
      NULL,
      CASE
        WHEN v_row->>'normalizedContact' IS NULL THEN NULL
        ELSE encode(extensions.digest(convert_to(v_row->>'normalizedContact', 'UTF8'), 'sha256'), 'hex')
      END,
      v_campaign.channel,
      CASE
        WHEN v_row->>'normalizedContact' IS NULL THEN 'unavailable'
        WHEN (v_row->>'allowed')::boolean THEN 'queued'
        ELSE 'suppressed'
      END,
      COALESCE(v_row->>'safeReasonCode', 'allowed'),
      COALESCE((v_row->>'segments')::integer, 0),
      NULLIF(v_row->>'allocatedCostMinor', '')::bigint
    );
  END LOOP;

  UPDATE public.marketing_campaigns
  SET status = 'scheduled',
      scheduled_for = COALESCE(p_scheduled_for, v_now),
      updated_at = v_now
  WHERE id = p_campaign_id AND status = 'draft';

  RETURN jsonb_build_object(
    'executionId', v_execution,
    'campaignId', p_campaign_id,
    'scheduledFor', COALESCE(p_scheduled_for, v_now),
    'replay', false
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.biz_confirm_marketing_circle_send_v1(uuid, uuid, uuid, jsonb, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.biz_confirm_marketing_circle_send_v1(uuid, uuid, uuid, jsonb, timestamptz)
  TO service_role;

ALTER FUNCTION public.biz_confirm_marketing_circle_send_v1(uuid, uuid, uuid, jsonb, timestamptz)
  OWNER TO postgres;

COMMIT;
