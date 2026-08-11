-- Issue #1817: provider-accepted offering pushes settle as Sent on OneSignal Free.
-- A canonical Create Message id proves provider acceptance only; it never proves
-- device delivery, display, open, or read.

BEGIN;

CREATE OR REPLACE FUNCTION public.biz_record_offering_push_dispatch_result(
  p_attempt_id uuid,p_outcome text,p_provider_app_id uuid DEFAULT NULL,
  p_provider_message_id uuid DEFAULT NULL,p_safe_code text DEFAULT NULL,p_retryable boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v public.brand_offering_invite_delivery_attempts%ROWTYPE;
  v_has_received boolean := false;
  v_has_sent boolean := false;
  v_has_failed boolean := false;
  v_has_matching_event boolean := false;
BEGIN
  SELECT * INTO v FROM public.brand_offering_invite_delivery_attempts WHERE id=p_attempt_id FOR UPDATE;
  IF NOT FOUND OR v.channel<>'push' THEN RAISE EXCEPTION 'offering_push_attempt_not_found' USING ERRCODE='P0002'; END IF;
  IF v.provider_app_id IS NOT NULL AND v.provider_app_id IS DISTINCT FROM p_provider_app_id THEN
    RAISE EXCEPTION 'offering_push_result_app_mismatch' USING ERRCODE='23514';
  END IF;
  IF (p_outcome='accepted' AND (p_safe_code IS NOT NULL OR p_retryable))
    OR (p_outcome='definitive_unsent_retryable' AND (NOT p_retryable OR p_safe_code IS NULL OR p_safe_code NOT IN
      ('provider_rate_limited','inbox_unavailable','provider_config_missing','local_before_provider_io_failed')))
    OR (p_outcome='definitive_unsent_terminal' AND (p_retryable OR p_safe_code IS NULL OR p_safe_code NOT IN
      ('local_payload_invalid','inbox_idempotency_collision','claim_tuple_mismatch','provider_no_valid_subscription',
       'provider_request_invalid','provider_config_rejected','provider_request_rejected')))
    OR (p_outcome='ambiguous' AND (p_retryable OR p_safe_code IS DISTINCT FROM 'provider_outcome_unknown'))
    OR (p_outcome='suppressed' AND (p_retryable OR p_safe_code IS NULL OR p_safe_code NOT IN
      ('category_inactive','can_send_denied','claim_ineligible'))) THEN
    RAISE EXCEPTION 'offering_push_result_invalid' USING ERRCODE='23514';
  END IF;

  PERFORM set_config('mingla.issue1770_push_result_rpc','true',true);
  UPDATE public.brand_offering_invite_delivery_attempts SET
    provider_idempotency_key=COALESCE(provider_idempotency_key,format('offering:%s:push:v1',id)),
    provider_app_id=COALESCE(provider_app_id,p_provider_app_id)
  WHERE id=v.id;

  IF p_outcome='accepted' THEN
    IF v.provider_io_claimed_at IS NULL OR p_provider_app_id IS NULL OR p_provider_message_id IS NULL
      OR (v.provider_app_id IS NOT NULL AND v.provider_app_id IS DISTINCT FROM p_provider_app_id)
      OR (v.provider_message_id IS NOT NULL AND v.provider_message_id IS DISTINCT FROM p_provider_message_id::text)
    THEN
      RAISE EXCEPTION 'offering_push_result_invalid' USING ERRCODE='23514';
    END IF;

    SELECT
      COALESCE(bool_or(evidence_kind='received'),false),
      COALESCE(bool_or(evidence_kind='sent'),false),
      COALESCE(bool_or(evidence_kind='failed'),false),
      COALESCE(bool_or(
        provider_app_id=p_provider_app_id
        AND provider_message_id=p_provider_message_id
      ),false)
    INTO v_has_received,v_has_sent,v_has_failed,v_has_matching_event
    FROM public.offering_push_provider_events
    WHERE attempt_id=v.id AND disposition='applied';

    IF NOT (
      v.status='sending'
      OR (
        v.status IN ('sent','delivered')
        AND v.provider_app_id=p_provider_app_id
        AND v.provider_message_id=p_provider_message_id::text
      )
      OR (v.status='failed' AND v_has_matching_event)
    ) THEN
      RAISE EXCEPTION 'offering_push_result_invalid' USING ERRCODE='23514';
    END IF;

    UPDATE public.brand_offering_invite_delivery_attempts SET
      status=CASE WHEN v.status='delivered' OR v_has_received THEN 'delivered' ELSE 'sent' END,
      provider_app_id=COALESCE(provider_app_id,p_provider_app_id),
      provider_message_id=COALESCE(provider_message_id,p_provider_message_id::text),
      provider_accepted_at=COALESCE(provider_accepted_at,now()),
      sent_at=COALESCE(sent_at,provider_accepted_at,now()),
      safe_reason_code=CASE
        WHEN v.status='delivered' OR v_has_received THEN NULL
        WHEN v_has_failed THEN 'provider_partial_failure'
        ELSE NULL
      END,
      is_retryable=false,
      updated_at=now()
    WHERE id=v.id;
  ELSIF p_outcome IN ('definitive_unsent_retryable','definitive_unsent_terminal') THEN
    UPDATE public.brand_offering_invite_delivery_attempts SET status='failed',safe_reason_code=p_safe_code,
      is_retryable=p_retryable,failed_at=COALESCE(failed_at,now()),updated_at=now() WHERE id=v.id;
  ELSIF p_outcome='ambiguous' THEN
    IF v.status<>'sending' THEN RAISE EXCEPTION 'offering_push_result_invalid' USING ERRCODE='23514'; END IF;
    UPDATE public.brand_offering_invite_delivery_attempts SET safe_reason_code='provider_outcome_unknown',
      is_retryable=false,updated_at=now() WHERE id=v.id;
  ELSIF p_outcome='suppressed' THEN
    UPDATE public.brand_offering_invite_delivery_attempts SET status='suppressed',safe_reason_code=p_safe_code,
      is_retryable=false,updated_at=now() WHERE id=v.id;
  ELSE
    RAISE EXCEPTION 'offering_push_result_invalid' USING ERRCODE='23514';
  END IF;

  PERFORM set_config('mingla.issue1770_push_result_rpc','',true);
  PERFORM public.issue_1770_project_offering_push_delivery(v.id);
  SELECT * INTO v FROM public.brand_offering_invite_delivery_attempts WHERE id=v.id;
  RETURN jsonb_build_object(
    'attemptId',v.id,
    'status',v.status,
    'providerMessageId',v.provider_message_id,
    'safeCode',v.safe_reason_code,
    'retryable',v.is_retryable
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.biz_reconcile_offering_push_event(
  p_event_id uuid,p_event_kind text,p_occurred_at timestamptz,p_provider_app_id uuid,
  p_provider_message_id uuid,p_external_id uuid,p_attempt_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v public.brand_offering_invite_delivery_attempts%ROWTYPE;
  v_kind text;
  v_disposition text;
  v_reason text;
  v_existing public.offering_push_provider_events%ROWTYPE;
  v_has_received boolean := false;
  v_has_sent boolean := false;
  v_has_failed boolean := false;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_event_id::text,0));
  v_kind:=CASE p_event_kind
    WHEN 'message.push.sent' THEN 'sent'
    WHEN 'message.push.received' THEN 'received'
    WHEN 'message.push.failed' THEN 'failed'
    ELSE NULL
  END;
  SELECT * INTO v_existing FROM public.offering_push_provider_events WHERE event_id=p_event_id FOR UPDATE;
  IF FOUND THEN
    IF ROW(v_existing.attempt_id,v_existing.provider_app_id,v_existing.provider_message_id,v_existing.provider_occurred_at)
      IS NOT DISTINCT FROM ROW(p_attempt_id,p_provider_app_id,p_provider_message_id,p_occurred_at)
      AND v_existing.evidence_kind IS NOT DISTINCT FROM v_kind
      AND EXISTS(
        SELECT 1 FROM public.brand_offering_invite_delivery_attempts a
        WHERE a.id=p_attempt_id AND a.recipient_user_id=p_external_id
      ) THEN
      RETURN jsonb_build_object('disposition','duplicate');
    END IF;
    RETURN jsonb_build_object('disposition','event_id_collision');
  END IF;

  IF p_event_kind='message.push.unsubscribed' THEN v_disposition:='ignored_kind';
  ELSIF v_kind IS NULL THEN v_disposition:='ignored_kind';
  ELSE
    SELECT * INTO v FROM public.brand_offering_invite_delivery_attempts WHERE id=p_attempt_id FOR UPDATE;
    IF NOT FOUND OR v.channel<>'push' THEN v_disposition:='ignored_unknown_attempt';
    ELSIF v.recipient_user_id IS NULL OR v.recipient_erased_at IS NOT NULL THEN v_disposition:='ignored_erased';
    ELSIF v.provider_io_claimed_at IS NULL OR p_occurred_at < v.provider_io_claimed_at-interval '5 minutes' THEN v_disposition:='ignored_before_claim';
    ELSIF p_occurred_at>now()+interval '5 minutes' OR v.created_at>now() THEN v_disposition:='ignored_future';
    ELSIF v.recipient_user_id IS DISTINCT FROM p_external_id
      OR (v.provider_app_id IS NOT NULL AND v.provider_app_id IS DISTINCT FROM p_provider_app_id)
      OR (v.provider_message_id IS NOT NULL AND v.provider_message_id IS DISTINCT FROM p_provider_message_id::text)
      OR EXISTS(
        SELECT 1 FROM public.brand_offering_invite_delivery_attempts other
        WHERE other.id<>v.id AND other.channel='push' AND other.provider_app_id=p_provider_app_id
          AND other.provider_message_id=p_provider_message_id::text
      ) THEN
      v_disposition:='ignored_tuple_mismatch';
    ELSE
      v_disposition:='applied';
    END IF;
  END IF;

  v_reason:=CASE WHEN v_kind='failed' THEN 'provider_push_failed' ELSE NULL END;
  INSERT INTO public.offering_push_provider_events(
    event_id,attempt_id,provider_app_id,provider_message_id,evidence_kind,
    provider_occurred_at,disposition,safe_reason_code
  ) VALUES(
    p_event_id,
    CASE WHEN v_disposition IN ('ignored_kind','ignored_unknown_attempt','ignored_tuple_mismatch') THEN NULL ELSE p_attempt_id END,
    CASE WHEN v_disposition IN ('ignored_kind','ignored_unknown_attempt','ignored_tuple_mismatch') THEN NULL ELSE p_provider_app_id END,
    CASE WHEN v_disposition IN ('ignored_kind','ignored_unknown_attempt','ignored_tuple_mismatch') THEN NULL ELSE p_provider_message_id END,
    v_kind,p_occurred_at,v_disposition,v_reason
  );

  IF v_disposition='applied' THEN
    SELECT
      COALESCE(bool_or(evidence_kind='received'),false),
      COALESCE(bool_or(evidence_kind='sent'),false),
      COALESCE(bool_or(evidence_kind='failed'),false)
    INTO v_has_received,v_has_sent,v_has_failed
    FROM public.offering_push_provider_events
    WHERE attempt_id=v.id AND disposition='applied';

    UPDATE public.brand_offering_invite_delivery_attempts SET
      provider_app_id=COALESCE(provider_app_id,p_provider_app_id),
      provider_message_id=COALESCE(provider_message_id,p_provider_message_id::text),
      status=CASE
        WHEN v_has_received THEN 'delivered'
        WHEN provider_accepted_at IS NOT NULL OR v_has_sent THEN 'sent'
        WHEN v_has_failed THEN 'failed'
        ELSE status
      END,
      sent_at=CASE
        WHEN v_has_received OR provider_accepted_at IS NOT NULL OR v_has_sent
          THEN COALESCE(sent_at,provider_accepted_at,p_occurred_at)
        ELSE sent_at
      END,
      delivered_at=CASE WHEN v_has_received THEN COALESCE(delivered_at,p_occurred_at) ELSE delivered_at END,
      failed_at=CASE WHEN v_has_failed THEN COALESCE(failed_at,p_occurred_at) ELSE failed_at END,
      safe_reason_code=CASE
        WHEN v_has_received THEN NULL
        WHEN (provider_accepted_at IS NOT NULL OR v_has_sent) AND v_has_failed THEN 'provider_partial_failure'
        WHEN provider_accepted_at IS NOT NULL OR v_has_sent THEN NULL
        WHEN v_has_failed THEN 'provider_push_failed'
        ELSE safe_reason_code
      END,
      is_retryable=CASE
        WHEN v_has_received OR provider_accepted_at IS NOT NULL OR v_has_sent OR v_has_failed THEN false
        ELSE is_retryable
      END,
      updated_at=now()
    WHERE id=v.id;
    PERFORM public.issue_1770_project_offering_push_delivery(v.id);
  END IF;

  RETURN jsonb_build_object('disposition',v_disposition);
END;
$function$;

REVOKE ALL ON FUNCTION public.biz_record_offering_push_dispatch_result(uuid,text,uuid,uuid,text,boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.biz_record_offering_push_dispatch_result(uuid,text,uuid,uuid,text,boolean)
  TO service_role;
REVOKE ALL ON FUNCTION public.biz_reconcile_offering_push_event(uuid,text,timestamptz,uuid,uuid,uuid,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.biz_reconcile_offering_push_event(uuid,text,timestamptz,uuid,uuid,uuid,uuid)
  TO service_role;

COMMIT;
