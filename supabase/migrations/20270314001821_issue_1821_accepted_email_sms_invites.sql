-- Issue #1821: documented provider acceptance settles offering email/SMS
-- attempts as Sent and serializes the all-channel send-group rollup.

BEGIN;

CREATE OR REPLACE FUNCTION public.issue_1821_project_offering_send_group(
  p_send_group_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_queued integer;
  v_sent integer;
  v_delivered integer;
  v_failed integer;
  v_suppressed integer;
  v_total integer;
  v_status text;
BEGIN
  PERFORM 1
  FROM public.marketing_send_groups
  WHERE id=p_send_group_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'offering_send_group_not_found' USING ERRCODE='P0002';
  END IF;

  SELECT
    count(*) FILTER(WHERE status IN ('queued','sending')),
    count(*) FILTER(WHERE status IN ('sent','delivered')),
    count(*) FILTER(WHERE status='delivered'),
    count(*) FILTER(WHERE status='failed'),
    count(*) FILTER(WHERE status='suppressed'),
    count(*)
  INTO v_queued,v_sent,v_delivered,v_failed,v_suppressed,v_total
  FROM public.brand_offering_invite_delivery_attempts
  WHERE send_group_id=p_send_group_id;

  v_status:=CASE
    WHEN v_queued>0 THEN 'running'
    WHEN v_failed=0 THEN 'completed'
    WHEN v_failed=(v_total-v_suppressed) THEN 'failed'
    ELSE 'partial'
  END;

  UPDATE public.marketing_send_groups SET
    queued_count=v_queued,
    sent_count=v_sent,
    delivered_count=v_delivered,
    failed_count=v_failed,
    suppressed_count=v_suppressed,
    status=v_status,
    started_at=COALESCE(started_at,now()),
    completed_at=CASE
      WHEN v_queued=0 THEN COALESCE(completed_at,now())
      ELSE completed_at
    END,
    updated_at=now()
  WHERE id=p_send_group_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_1770_project_offering_push_delivery(
  p_attempt_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_attempt public.brand_offering_invite_delivery_attempts%ROWTYPE;
  v_notification uuid;
BEGIN
  SELECT * INTO v_attempt
  FROM public.brand_offering_invite_delivery_attempts
  WHERE id=p_attempt_id
  FOR UPDATE;
  IF NOT FOUND OR v_attempt.channel<>'push' THEN
    RAISE EXCEPTION 'offering_push_attempt_not_found' USING ERRCODE='P0002';
  END IF;

  SELECT n.id INTO v_notification
  FROM public.notifications n
  WHERE n.idempotency_key=v_attempt.provider_idempotency_key
    AND n.user_id=v_attempt.recipient_user_id
    AND n.type='offering_invitation'
    AND v_attempt.safe_reason_code IS DISTINCT FROM 'inbox_unavailable';

  IF v_notification IS NOT NULL THEN
    INSERT INTO public.notification_deliveries(
      notification_id,channel,status,provider,provider_app_id,
      provider_message_id,attempt_at,delivered_at,failed_reason
    ) VALUES(
      v_notification,'push',v_attempt.status,'onesignal',
      v_attempt.provider_app_id,v_attempt.provider_message_id,
      COALESCE(
        v_attempt.provider_accepted_at,
        v_attempt.provider_io_claimed_at,
        v_attempt.created_at
      ),
      v_attempt.delivered_at,v_attempt.safe_reason_code
    ) ON CONFLICT(notification_id,channel)
      WHERE notification_id IS NOT NULL
    DO UPDATE SET
      status=EXCLUDED.status,
      provider_app_id=COALESCE(
        public.notification_deliveries.provider_app_id,
        EXCLUDED.provider_app_id
      ),
      provider_message_id=COALESCE(
        public.notification_deliveries.provider_message_id,
        EXCLUDED.provider_message_id
      ),
      delivered_at=COALESCE(
        public.notification_deliveries.delivered_at,
        EXCLUDED.delivered_at
      ),
      failed_reason=EXCLUDED.failed_reason;
  END IF;

  PERFORM public.issue_1821_project_offering_send_group(
    v_attempt.send_group_id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_1770_reconcile_marketing_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_attempt public.brand_offering_invite_delivery_attempts%ROWTYPE;
  v_attempt_ids uuid[];
  v_destination text;
  v_match_count integer;
BEGIN
  IF NEW.channel NOT IN ('email','sms')
    OR NEW.status NOT IN ('sent','delivered','failed','bounced','preview_skipped')
  THEN
    RETURN NEW;
  END IF;

  v_destination:=CASE NEW.channel
    WHEN 'email' THEN public.issue_1770_normalize_email(NEW.recipient_email)
    WHEN 'sms' THEN public.issue_1770_normalize_phone(NEW.recipient_phone)
  END;

  SELECT array_agg(locked.id ORDER BY locked.id),count(*)
  INTO v_attempt_ids,v_match_count
  FROM (
    SELECT a.id
    FROM public.brand_offering_invite_delivery_attempts a
    JOIN public.brand_person_contact_methods c ON c.id=a.contact_method_id
    WHERE a.campaign_id=NEW.campaign_id
      AND a.channel=NEW.channel
      AND c.normalized_value=v_destination
    FOR UPDATE OF a
  ) locked;

  IF v_match_count=0 THEN
    RETURN NEW;
  END IF;
  IF v_match_count>1 THEN
    RAISE EXCEPTION 'offering_marketing_message_attempt_ambiguous'
      USING ERRCODE='23514';
  END IF;

  SELECT * INTO STRICT v_attempt
  FROM public.brand_offering_invite_delivery_attempts
  WHERE id=v_attempt_ids[1];

  IF v_attempt.marketing_message_id IS NOT NULL
    AND v_attempt.marketing_message_id IS DISTINCT FROM NEW.id
  THEN
    RAISE EXCEPTION 'offering_marketing_message_tuple_mismatch'
      USING ERRCODE='23514';
  END IF;

  IF NEW.status IN ('sent','delivered') THEN
    IF NEW.provider_message_id IS NULL
      OR btrim(NEW.provider_message_id)=''
    THEN
      RAISE EXCEPTION 'offering_marketing_message_provider_missing'
        USING ERRCODE='23514';
    END IF;
    IF v_attempt.provider_message_id IS NOT NULL
      AND v_attempt.provider_message_id IS DISTINCT FROM NEW.provider_message_id
    THEN
      RAISE EXCEPTION 'offering_marketing_message_provider_mismatch'
        USING ERRCODE='23514';
    END IF;

    UPDATE public.brand_offering_invite_delivery_attempts SET
      marketing_message_id=COALESCE(marketing_message_id,NEW.id),
      provider_message_id=COALESCE(provider_message_id,NEW.provider_message_id),
      status=CASE
        WHEN status='delivered' OR NEW.status='delivered' THEN 'delivered'
        ELSE 'sent'
      END,
      provider_accepted_at=COALESCE(
        provider_accepted_at,NEW.sent_at,NEW.delivered_at,now()
      ),
      sent_at=COALESCE(
        sent_at,NEW.sent_at,provider_accepted_at,NEW.delivered_at,now()
      ),
      delivered_at=CASE
        WHEN status='delivered' OR NEW.status='delivered'
          THEN COALESCE(delivered_at,NEW.delivered_at,now())
        ELSE delivered_at
      END,
      safe_reason_code=NULL,
      is_retryable=false,
      updated_at=now()
    WHERE id=v_attempt.id;
  ELSIF NEW.status IN ('failed','bounced') THEN
    UPDATE public.brand_offering_invite_delivery_attempts SET
      marketing_message_id=COALESCE(marketing_message_id,NEW.id),
      status=CASE
        WHEN status IN ('sent','delivered','failed','suppressed') THEN status
        WHEN status='queued'
          AND provider_io_claimed_at IS NULL
          AND provider_message_id IS NULL
          AND provider_accepted_at IS NULL
          THEN 'failed'
        ELSE 'sending'
      END,
      failed_at=COALESCE(failed_at,now()),
      safe_reason_code=CASE
        WHEN status='delivered' THEN NULL
        WHEN status='sent' OR provider_accepted_at IS NOT NULL
          THEN 'provider_partial_failure'
        WHEN status='queued'
          AND provider_io_claimed_at IS NULL
          AND provider_message_id IS NULL
          AND provider_accepted_at IS NULL
          THEN 'campaign_delivery_failed'
        WHEN status IN ('sending','queued')
          THEN 'provider_outcome_unknown'
        ELSE safe_reason_code
      END,
      is_retryable=CASE
        WHEN status IN ('failed','suppressed') THEN is_retryable
        ELSE false
      END,
      updated_at=now()
    WHERE id=v_attempt.id;
  ELSE
    UPDATE public.brand_offering_invite_delivery_attempts SET
      marketing_message_id=COALESCE(marketing_message_id,NEW.id),
      status=CASE WHEN status='queued' THEN 'suppressed' ELSE status END,
      safe_reason_code=CASE
        WHEN status='queued' THEN 'provider_io_disabled'
        ELSE safe_reason_code
      END,
      is_retryable=CASE WHEN status='queued' THEN false ELSE is_retryable END,
      updated_at=now()
    WHERE id=v_attempt.id;
  END IF;

  PERFORM public.issue_1821_project_offering_send_group(
    v_attempt.send_group_id
  );
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_1821_project_offering_send_group(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1821_project_offering_send_group(uuid)
  TO service_role;
REVOKE ALL ON FUNCTION public.issue_1770_project_offering_push_delivery(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1770_project_offering_push_delivery(uuid)
  TO service_role;
REVOKE ALL ON FUNCTION public.issue_1770_reconcile_marketing_message()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1770_reconcile_marketing_message()
  TO service_role;

COMMIT;
