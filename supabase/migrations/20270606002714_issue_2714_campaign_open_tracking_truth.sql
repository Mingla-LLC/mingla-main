-- Issue #2714 — campaign open tracking has durable eligibility, exact-once
-- early-event reconciliation, and aggregate health without weakening #2510.

BEGIN;

ALTER TABLE public.marketing_messages
  ADD COLUMN IF NOT EXISTS delivery_tracking_eligible_at timestamptz,
  ADD COLUMN IF NOT EXISTS open_tracking_eligible_at timestamptz,
  ADD COLUMN IF NOT EXISTS tracking_sender_domain text;

ALTER TABLE public.marketing_messages
  DROP CONSTRAINT IF EXISTS marketing_messages_tracking_eligibility_truth;
ALTER TABLE public.marketing_messages
  ADD CONSTRAINT marketing_messages_tracking_eligibility_truth CHECK (
    (delivery_tracking_eligible_at IS NULL
      AND open_tracking_eligible_at IS NULL
      AND tracking_sender_domain IS NULL)
    OR
    (delivery_tracking_eligible_at IS NOT NULL
      AND tracking_sender_domain = 'campaigns.usemingla.com')
  );

ALTER TABLE public.marketing_email_events
  ADD COLUMN IF NOT EXISTS is_campaign_event boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reconcile_attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_reconcile_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS reconciled_at timestamptz;

ALTER TABLE public.marketing_email_events
  DROP CONSTRAINT IF EXISTS marketing_email_events_reconcile_attempt_nonnegative;
ALTER TABLE public.marketing_email_events
  ADD CONSTRAINT marketing_email_events_reconcile_attempt_nonnegative
  CHECK (reconcile_attempt_count >= 0);

CREATE INDEX IF NOT EXISTS issue_2714_unmatched_campaign_events_received
  ON public.marketing_email_events (received_at)
  WHERE is_campaign_event AND message_id IS NULL;

CREATE OR REPLACE FUNCTION public.mkt_reconcile_email_event(p_svix_id text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_event public.marketing_email_events%ROWTYPE;
  v_msg public.marketing_messages%ROWTYPE;
  v_rank_current integer;
  v_rank_new integer;
  v_new_status text;
  v_occurred timestamptz;
BEGIN
  SELECT * INTO v_event
    FROM public.marketing_email_events
   WHERE svix_id = p_svix_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'missing';
  END IF;
  IF v_event.message_id IS NOT NULL THEN
    RETURN 'duplicate';
  END IF;

  UPDATE public.marketing_email_events
     SET reconcile_attempt_count = reconcile_attempt_count + 1,
         last_reconcile_attempt_at = now()
   WHERE svix_id = p_svix_id;

  SELECT * INTO v_msg
    FROM public.marketing_messages
   WHERE provider_message_id = v_event.provider_message_id
   ORDER BY id
   LIMIT 1
   FOR UPDATE;
  IF NOT FOUND THEN
    IF NOT v_event.is_campaign_event THEN
      RETURN 'unmatched';
    END IF;
    IF v_event.received_at <= now() - interval '5 minutes' THEN
      RETURN 'campaign_unmatched_stale';
    END IF;
    RETURN 'campaign_unmatched';
  END IF;

  v_occurred := COALESCE(
    NULLIF(v_event.payload->>'created_at','')::timestamptz,
    v_event.received_at
  );
  v_rank_current := public.mkt_email_status_rank(v_msg.status);
  v_new_status := CASE v_event.event_type
    WHEN 'email.delivered' THEN 'delivered'
    WHEN 'email.opened' THEN 'opened'
    WHEN 'email.clicked' THEN 'clicked'
    WHEN 'email.bounced' THEN 'bounced'
    WHEN 'email.complained' THEN 'complained'
    ELSE v_msg.status
  END;
  v_rank_new := public.mkt_email_status_rank(v_new_status);
  IF v_event.event_type NOT IN ('email.bounced','email.complained')
     AND v_rank_new <= v_rank_current THEN
    v_new_status := v_msg.status;
  END IF;

  UPDATE public.marketing_messages
     SET status = v_new_status,
         delivered_at = CASE
           WHEN v_event.event_type = 'email.delivered'
             THEN COALESCE(delivered_at, v_occurred) ELSE delivered_at END,
         opened_at = CASE
           WHEN v_event.event_type = 'email.opened'
             THEN COALESCE(opened_at, v_occurred) ELSE opened_at END,
         open_count = CASE
           WHEN v_event.event_type = 'email.opened'
             THEN open_count + 1 ELSE open_count END,
         complained_at = CASE
           WHEN v_event.event_type = 'email.complained'
             THEN COALESCE(complained_at, v_occurred) ELSE complained_at END,
         bounce_kind = CASE
           WHEN v_event.event_type = 'email.bounced'
             THEN COALESCE(bounce_kind, v_event.payload->'data'->'bounce'->>'type')
           ELSE bounce_kind END,
         failure_reason = CASE
           WHEN v_event.event_type = 'email.bounced'
             THEN COALESCE(failure_reason, 'resend_bounce:' ||
               COALESCE(v_event.payload->'data'->'bounce'->>'subType','unknown'))
           ELSE failure_reason END
   WHERE id = v_msg.id;

  IF v_event.event_type = 'email.complained'
     OR (v_event.event_type = 'email.bounced'
         AND COALESCE(v_event.payload->'data'->'bounce'->>'type','') = 'Permanent')
  THEN
    INSERT INTO public.marketing_unsubscribes
      (contact_email, channel, scope, brand_id, reason, unsubscribed_at)
    SELECT v_msg.recipient_email, 'email', 'brand', c.brand_id,
           CASE WHEN v_event.event_type = 'email.complained'
                THEN 'spam_complaint' ELSE 'hard_bounce' END,
           v_occurred
      FROM public.marketing_campaigns c
     WHERE c.id = v_msg.campaign_id
       AND v_msg.recipient_email IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.marketing_unsubscribes u
          WHERE lower(u.contact_email) = lower(v_msg.recipient_email)
            AND u.channel = 'email'
            AND (u.scope = 'global'
              OR (u.scope = 'brand' AND u.brand_id = c.brand_id))
       );
  END IF;

  UPDATE public.marketing_email_events
     SET message_id = v_msg.id,
         reconciled_at = now()
   WHERE svix_id = p_svix_id;
  RETURN v_new_status;
END;
$function$;

CREATE OR REPLACE FUNCTION public.mkt_ingest_email_event(
  p_svix_id text,
  p_event_type text,
  p_provider_message_id text,
  p_payload jsonb
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_from text := lower(COALESCE(p_payload->'data'->>'from',''));
BEGIN
  INSERT INTO public.marketing_email_events
    (svix_id, event_type, provider_message_id, payload, is_campaign_event)
  VALUES (
    p_svix_id,
    p_event_type,
    p_provider_message_id,
    p_payload,
    v_from ~ '(^|<)[^<>@[:space:]]+@campaigns[.]usemingla[.]com>?[[:space:]]*$'
  )
  ON CONFLICT (svix_id) DO NOTHING;

  RETURN public.mkt_reconcile_email_event(p_svix_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_2714_reconcile_provider_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_event record;
BEGIN
  IF NEW.provider_message_id IS NULL THEN
    RETURN NEW;
  END IF;
  FOR v_event IN
    SELECT svix_id
      FROM public.marketing_email_events
     WHERE provider_message_id = NEW.provider_message_id
       AND message_id IS NULL
     ORDER BY received_at, svix_id
  LOOP
    PERFORM public.mkt_reconcile_email_event(v_event.svix_id);
  END LOOP;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS issue_2714_reconcile_provider_events
  ON public.marketing_messages;
CREATE TRIGGER issue_2714_reconcile_provider_events
AFTER INSERT OR UPDATE OF provider_message_id ON public.marketing_messages
FOR EACH ROW
WHEN (NEW.provider_message_id IS NOT NULL)
EXECUTE FUNCTION public.issue_2714_reconcile_provider_events();

CREATE OR REPLACE FUNCTION public.mkt_campaign_email_event_health()
RETURNS TABLE (
  delivery_healthy boolean,
  open_healthy boolean,
  delivery_unmatched_count bigint,
  delivery_stale_unmatched_count bigint,
  open_unmatched_count bigint,
  open_stale_unmatched_count bigint,
  oldest_delivery_unmatched_at timestamptz,
  oldest_open_unmatched_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
  SELECT
    count(*) FILTER (
      WHERE event_type = 'email.delivered'
        AND received_at <= now() - interval '5 minutes'
    ) = 0 AS delivery_healthy,
    count(*) FILTER (
      WHERE event_type IN ('email.delivered','email.opened')
        AND received_at <= now() - interval '5 minutes'
    ) = 0 AS open_healthy,
    count(*) FILTER (WHERE event_type = 'email.delivered'),
    count(*) FILTER (
      WHERE event_type = 'email.delivered'
        AND received_at <= now() - interval '5 minutes'
    ),
    count(*) FILTER (WHERE event_type = 'email.opened'),
    count(*) FILTER (
      WHERE event_type = 'email.opened'
        AND received_at <= now() - interval '5 minutes'
    ),
    min(received_at) FILTER (WHERE event_type = 'email.delivered'),
    min(received_at) FILTER (WHERE event_type = 'email.opened')
  FROM public.marketing_email_events
  WHERE is_campaign_event AND message_id IS NULL;
$function$;

REVOKE ALL ON FUNCTION public.mkt_reconcile_email_event(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mkt_reconcile_email_event(text)
  TO service_role;
REVOKE ALL ON FUNCTION public.mkt_ingest_email_event(text,text,text,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mkt_ingest_email_event(text,text,text,jsonb)
  TO service_role;
REVOKE ALL ON FUNCTION public.mkt_campaign_email_event_health()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mkt_campaign_email_event_health()
  TO authenticated, service_role;

COMMIT;
