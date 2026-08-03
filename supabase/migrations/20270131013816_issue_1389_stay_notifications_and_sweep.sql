-- Issue #1389: transactional Stay notification fanout and service-only expiry.

BEGIN;

CREATE OR REPLACE FUNCTION public.issue_1389_enqueue_stay_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_group public.stay_reservation_groups%ROWTYPE;
  v_category text;
  v_staff_event boolean := false;
  v_payload jsonb;
  v_recipient record;
BEGIN
  IF NOT public.issue_1389_flag_enabled('STAY_NOTIFICATIONS') THEN
    RETURN NEW;
  END IF;
  SELECT * INTO v_group
  FROM public.stay_reservation_groups
  WHERE id = NEW.group_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  v_category := CASE NEW.event_type
    WHEN 'stay_request_submitted' THEN 'stay_request_received'
    WHEN 'stay_request_approved' THEN 'stay_payment_required'
    WHEN 'stay_request_declined' THEN 'stay_request_declined'
    WHEN 'stay_reservation_confirmed' THEN 'stay_reservation_confirmed'
    WHEN 'stay_reservation_cancelled' THEN 'stay_reservation_cancelled'
    WHEN 'stay_refund_succeeded' THEN 'stay_refund_state'
    WHEN 'stay_refund_attention_required'
      THEN 'stay_reconciliation_attention'
    WHEN 'stay_payment_late_refund_due'
      THEN 'stay_reconciliation_attention'
    ELSE NULL
  END;
  IF v_category IS NULL THEN
    RETURN NEW;
  END IF;
  v_staff_event := NEW.event_type IN (
    'stay_request_submitted',
    'stay_refund_attention_required',
    'stay_payment_late_refund_due'
  );

  v_payload := jsonb_build_object(
    'stay_group_id', v_group.id,
    'public_reference', v_group.public_reference,
    'venue_id', v_group.venue_id,
    'amount_cents', COALESCE(
      (NEW.safe_metadata->>'amountMinor')::bigint,
      v_group.total_minor
    ),
    'currency', v_group.currency_code,
    'payment_deadline', v_group.payment_deadline,
    'request_deadline', v_group.request_deadline,
    'title', CASE
      WHEN v_staff_event THEN 'Stay reservation needs attention'
      ELSE 'Your Stay reservation'
    END,
    'body', CASE NEW.event_type
      WHEN 'stay_request_submitted'
        THEN 'A guest submitted a Stay reservation request.'
      WHEN 'stay_request_approved'
        THEN 'Your Stay request was approved. Complete payment before the deadline.'
      WHEN 'stay_request_declined'
        THEN 'The property declined your Stay reservation request.'
      WHEN 'stay_reservation_confirmed'
        THEN 'Your Rooms and Places are confirmed.'
      WHEN 'stay_reservation_cancelled'
        THEN 'Your selected Rooms and Places were cancelled.'
      WHEN 'stay_refund_succeeded'
        THEN 'Your Stay refund has been issued.'
      ELSE 'A Stay payment or refund needs review.'
    END
  ) || NEW.safe_metadata;

  IF v_staff_event THEN
    FOR v_recipient IN
      SELECT DISTINCT recipient.user_id, user_row.email, user_row.phone
      FROM (
        SELECT brand.account_id AS user_id
        FROM public.brands brand
        WHERE brand.id = v_group.brand_id
        UNION
        SELECT member.user_id
        FROM public.brand_team_members member
        WHERE member.brand_id = v_group.brand_id
          AND member.accepted_at IS NOT NULL
          AND member.removed_at IS NULL
          AND member.role IN (
            'brand_owner', 'brand_admin',
            'event_manager', 'finance_manager'
          )
      ) recipient
      JOIN auth.users user_row ON user_row.id = recipient.user_id
    LOOP
      INSERT INTO public.notification_outbox (
        category_key, user_id, contact, brand_id, payload, idempotency_key
      ) VALUES (
        v_category, v_recipient.user_id, lower(v_recipient.email),
        v_group.brand_id, v_payload,
        'stay:' || NEW.id || ':' || v_category || ':user:' ||
          v_recipient.user_id
      ) ON CONFLICT (idempotency_key) DO NOTHING;
      IF NULLIF(pg_catalog.btrim(COALESCE(v_recipient.phone, '')), '')
        IS NOT NULL THEN
        INSERT INTO public.notification_outbox (
          category_key, user_id, contact, brand_id, payload, idempotency_key
        ) VALUES (
          v_category, NULL, v_recipient.phone, v_group.brand_id,
          v_payload || jsonb_build_object('channel_hint', 'sms'),
          'stay:' || NEW.id || ':' || v_category || ':sms:' ||
            v_recipient.user_id
        ) ON CONFLICT (idempotency_key) DO NOTHING;
      END IF;
    END LOOP;
  ELSE
    SELECT
      v_group.user_id AS user_id,
      COALESCE(
        NULLIF(v_group.guest_snapshot->>'email', ''),
        user_row.email
      ) AS email,
      COALESCE(
        NULLIF(v_group.guest_snapshot->>'phone', ''),
        user_row.phone
      ) AS phone
    INTO v_recipient
    FROM auth.users user_row
    WHERE user_row.id = v_group.user_id;

    IF v_group.user_id IS NOT NULL OR v_recipient.email IS NOT NULL THEN
      INSERT INTO public.notification_outbox (
        category_key, user_id, contact, brand_id, payload, idempotency_key
      ) VALUES (
        v_category, v_group.user_id, lower(v_recipient.email),
        v_group.brand_id, v_payload,
        'stay:' || NEW.id || ':' || v_category || ':guest'
      ) ON CONFLICT (idempotency_key) DO NOTHING;
    END IF;
    IF v_recipient.phone IS NOT NULL THEN
      INSERT INTO public.notification_outbox (
        category_key, user_id, contact, brand_id, payload, idempotency_key
      ) VALUES (
        v_category, NULL, v_recipient.phone, v_group.brand_id,
        v_payload || jsonb_build_object('channel_hint', 'sms'),
        'stay:' || NEW.id || ':' || v_category || ':guest-sms'
      ) ON CONFLICT (idempotency_key) DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER stay_reservation_event_notification
  AFTER INSERT ON public.stay_reservation_events
  FOR EACH ROW EXECUTE FUNCTION public.issue_1389_enqueue_stay_event();

CREATE OR REPLACE FUNCTION public.issue_1389_run_stay_sweep(
  p_limit integer DEFAULT 100,
  p_request_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_expired jsonb;
  v_ambiguous integer;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_limit NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'stay_invalid_payload' USING ERRCODE = '22023';
  END IF;

  -- Never release inventory while provider outcome remains unknowable.
  UPDATE public.stay_inventory_holds hold_row
  SET state = 'reconciliation_required',
      reason = 'payment_ambiguous',
      version = hold_row.version + 1,
      updated_at = now()
  FROM public.stay_reservation_groups group_row
  WHERE group_row.id = hold_row.group_id
    AND hold_row.state = 'active'
    AND hold_row.expires_at <= now()
    AND EXISTS (
      SELECT 1
      FROM public.stay_payment_attempts attempt
      WHERE attempt.group_id = group_row.id
        AND attempt.state IN ('pending', 'ambiguous', 'refund_due')
    );
  GET DIAGNOSTICS v_ambiguous = ROW_COUNT;

  UPDATE public.stay_reservation_groups group_row
  SET state = 'reconciliation_required',
      version = group_row.version + 1,
      updated_at = now()
  WHERE group_row.state IN (
      'instant_payment_pending', 'approved_payment_required'
    )
    AND EXISTS (
      SELECT 1
      FROM public.stay_inventory_holds hold_row
      WHERE hold_row.group_id = group_row.id
        AND hold_row.state = 'reconciliation_required'
    );

  v_expired := public.issue_1388_expire_groups(p_limit, p_request_id);
  RETURN jsonb_build_object(
    'expiredCount', COALESCE((v_expired->>'expiredCount')::integer, 0),
    'reconciliationProtectedCount', v_ambiguous
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_1389_enqueue_stay_event()
  FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_1389_run_stay_sweep(integer, uuid)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1389_run_stay_sweep(integer, uuid)
  TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
