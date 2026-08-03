-- Issue #1447 — RSVP admission, pass recovery, and per-channel delivery truth.
-- Monotonic above linked/local max 20270202001421 and active sibling max
-- 20270203001426. This migration is additive except for the intentional
-- RETURNS TABLE widening of the host-only RSVP guest-list RPC.

BEGIN;

INSERT INTO public.notification_categories(
  key,section,is_transactional,urgency,default_channels,reach_mode
) VALUES
  ('rsvp_acknowledgement','RSVP',true,'high',ARRAY['inapp','push','email','sms'],'reach_once'),
  ('rsvp_pass','RSVP',true,'high',ARRAY['inapp','push','email','sms'],'reach_once'),
  ('rsvp_event_updated','RSVP',true,'high',ARRAY['inapp','push','email','sms'],'reach_once'),
  ('rsvp_waitlist_promoted','RSVP',true,'high',ARRAY['inapp','push','email','sms'],'reach_once'),
  ('rsvp_approved','RSVP',true,'high',ARRAY['inapp','push','email','sms'],'reach_once'),
  ('rsvp_denied','RSVP',true,'high',ARRAY['inapp','push','email','sms'],'reach_once'),
  ('rsvp_removed','RSVP',true,'high',ARRAY['inapp','push','email','sms'],'reach_once')
ON CONFLICT(key) DO UPDATE SET section=excluded.section,
  is_transactional=excluded.is_transactional,urgency=excluded.urgency,
  default_channels=excluded.default_channels,reach_mode=excluded.reach_mode,active=true;

ALTER TABLE public.event_rsvps
  ADD COLUMN IF NOT EXISTS checked_in_at timestamptz,
  ADD COLUMN IF NOT EXISTS checked_in_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS pass_recovery_token_hash text,
  ADD COLUMN IF NOT EXISTS pass_recovery_token_created_at timestamptz;

ALTER TABLE public.event_rsvp_guests
  ADD COLUMN IF NOT EXISTS checked_in_at timestamptz,
  ADD COLUMN IF NOT EXISTS checked_in_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS pass_recovery_token_hash text,
  ADD COLUMN IF NOT EXISTS pass_recovery_token_created_at timestamptz;

ALTER TABLE public.event_rsvps
  DROP CONSTRAINT IF EXISTS event_rsvps_checkin_pair,
  ADD CONSTRAINT event_rsvps_checkin_pair CHECK (
    (checked_in_at IS NULL AND checked_in_by IS NULL)
    OR (checked_in_at IS NOT NULL AND checked_in_by IS NOT NULL)
  );

-- Moving away from going+approved immediately revokes and rotates every party
-- credential. Historical check-in state and the immutable scan audit remain;
-- a later fresh approval receives a newly minted pass without erasing admission.
CREATE OR REPLACE FUNCTION public.rsvp_revoke_party_credentials()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF (NEW.rsvp_status<>'going' OR NEW.approval_status<>'approved')
     AND (OLD.rsvp_status IS DISTINCT FROM NEW.rsvp_status
       OR OLD.approval_status IS DISTINCT FROM NEW.approval_status) THEN
    NEW.qr_code := NULL; NEW.qr_token_hash := NULL;
    NEW.pass_recovery_token_hash := NULL; NEW.pass_recovery_token_created_at := NULL;
    UPDATE public.event_rsvp_guests SET qr_code=NULL,qr_token_hash=NULL,
      pass_recovery_token_hash=NULL,pass_recovery_token_created_at=NULL
      WHERE rsvp_id=OLD.id;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS rsvp_revoke_party_credentials_trigger ON public.event_rsvps;
CREATE TRIGGER rsvp_revoke_party_credentials_trigger
BEFORE UPDATE OF rsvp_status,approval_status ON public.event_rsvps
FOR EACH ROW EXECUTE FUNCTION public.rsvp_revoke_party_credentials();
REVOKE ALL ON FUNCTION public.rsvp_revoke_party_credentials() FROM PUBLIC,anon,authenticated;
ALTER TABLE public.event_rsvp_guests
  DROP CONSTRAINT IF EXISTS event_rsvp_guests_checkin_pair,
  ADD CONSTRAINT event_rsvp_guests_checkin_pair CHECK (
    (checked_in_at IS NULL AND checked_in_by IS NULL)
    OR (checked_in_at IS NOT NULL AND checked_in_by IS NOT NULL)
  );

CREATE TABLE IF NOT EXISTS public.rsvp_scan_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE RESTRICT,
  matched_event_id uuid REFERENCES public.events(id) ON DELETE SET NULL,
  rsvp_id uuid REFERENCES public.event_rsvps(id) ON DELETE SET NULL,
  guest_id uuid REFERENCES public.event_rsvp_guests(id) ON DELETE SET NULL,
  scanner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  outcome text NOT NULL CHECK (outcome IN (
    'success','duplicate','not_found','wrong_event','not_eligible','revoked',
    'not_yet_open','event_ended'
  )),
  scanned_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT rsvp_scan_events_one_entity CHECK (num_nonnulls(rsvp_id, guest_id) <= 1)
);
CREATE INDEX IF NOT EXISTS rsvp_scan_events_requested_event_at_idx
  ON public.rsvp_scan_events(requested_event_id, scanned_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS rsvp_scan_events_primary_success_once
  ON public.rsvp_scan_events(rsvp_id) WHERE outcome = 'success' AND rsvp_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS rsvp_scan_events_guest_success_once
  ON public.rsvp_scan_events(guest_id) WHERE outcome = 'success' AND guest_id IS NOT NULL;
ALTER TABLE public.rsvp_scan_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rsvp_scan_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.rsvp_scan_events TO service_role;

CREATE TABLE IF NOT EXISTS public.rsvp_notification_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid NOT NULL REFERENCES public.rsvp_notifications(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('email','sms','in_app','push')),
  is_required boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending','processing','sent','failed_retryable','failed_terminal','ambiguous'
  )),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  processing_started_at timestamptz,
  provider_io_started_at timestamptz,
  ambiguous_at timestamptz,
  lease_id uuid,
  provider_message_id text,
  safe_error_code text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(notification_id, channel)
);
CREATE INDEX IF NOT EXISTS rsvp_notification_deliveries_due_idx
  ON public.rsvp_notification_deliveries(next_attempt_at, created_at)
  WHERE status IN ('pending','failed_retryable','processing');
ALTER TABLE public.rsvp_notification_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rsvp_notification_deliveries FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.rsvp_notification_deliveries TO service_role;

-- Enrich legacy/new RSVP outbox rows from canonical RSVP snapshots. No raw
-- recovery token is persisted; entityId + recoveryCreatedAt are safe inputs to
-- the edge-only, peppered token derivation.
CREATE OR REPLACE FUNCTION public.rsvp_prepare_notification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_guest public.event_rsvp_guests%ROWTYPE;
  v_primary public.event_rsvps%ROWTYPE;
BEGIN
  SELECT * INTO v_primary FROM public.event_rsvps WHERE id = NEW.rsvp_id;
  SELECT * INTO v_guest
    FROM public.event_rsvp_guests
   WHERE rsvp_id = NEW.rsvp_id
     AND (
       id::text = NULLIF(NEW.payload->>'guestId','')
       OR qr_code = NULLIF(NEW.payload->>'qrCode','')
       OR lower(email) = lower(COALESCE(NEW.recipient, ''))
     )
   ORDER BY CASE WHEN id::text = NULLIF(NEW.payload->>'guestId','') THEN 0 ELSE 1 END
   LIMIT 1;

  IF (NEW.payload->>'role') = 'guest' THEN
    NEW.payload := NEW.payload || jsonb_strip_nulls(jsonb_build_object(
      'entityId', v_guest.id,
      'guestId', v_guest.id,
      'recipientName', v_guest.name,
      'recipientEmail', v_guest.email,
      'recipientPhone', v_guest.phone,
      'matchedUserId', v_guest.matched_user_id,
      'recoveryCreatedAt', v_guest.pass_recovery_token_created_at
    ));
  ELSE
    NEW.payload := NEW.payload || jsonb_strip_nulls(jsonb_build_object(
      'entityId', v_primary.id,
      'recipientName', v_primary.guest_name,
      'recipientEmail', v_primary.guest_email,
      'recipientPhone', v_primary.guest_phone,
      'primaryUserId', v_primary.user_id,
      'recoveryCreatedAt', v_primary.pass_recovery_token_created_at
    ));
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS rsvp_prepare_notification_trigger ON public.rsvp_notifications;
CREATE TRIGGER rsvp_prepare_notification_trigger
BEFORE INSERT OR UPDATE OF payload ON public.rsvp_notifications
FOR EACH ROW EXECUTE FUNCTION public.rsvp_prepare_notification();

CREATE OR REPLACE FUNCTION public.rsvp_seed_delivery_rows()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id uuid;
BEGIN
  v_user_id := COALESCE(
    NULLIF(NEW.payload->>'matchedUserId','')::uuid,
    NULLIF(NEW.payload->>'primaryUserId','')::uuid
  );
  IF NULLIF(btrim(NEW.payload->>'recipientEmail'), '') IS NOT NULL THEN
    INSERT INTO public.rsvp_notification_deliveries(notification_id, channel, is_required)
      VALUES (NEW.id, 'email', true) ON CONFLICT DO NOTHING;
  END IF;
  IF NULLIF(btrim(NEW.payload->>'recipientPhone'), '') IS NOT NULL THEN
    INSERT INTO public.rsvp_notification_deliveries(notification_id, channel, is_required)
      VALUES (NEW.id, 'sms', true) ON CONFLICT DO NOTHING;
  END IF;
  IF v_user_id IS NOT NULL THEN
    INSERT INTO public.rsvp_notification_deliveries(notification_id, channel, is_required)
      VALUES (NEW.id, 'in_app', true), (NEW.id, 'push', false)
      ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS rsvp_seed_delivery_rows_trigger ON public.rsvp_notifications;
CREATE TRIGGER rsvp_seed_delivery_rows_trigger
AFTER INSERT ON public.rsvp_notifications
FOR EACH ROW EXECUTE FUNCTION public.rsvp_seed_delivery_rows();
REVOKE ALL ON FUNCTION public.rsvp_prepare_notification() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rsvp_seed_delivery_rows() FROM PUBLIC, anon, authenticated;

-- Adopt due pre-cutover RSVP rows without re-sending rows already proven sent.
UPDATE public.rsvp_notifications
   SET payload = payload
 WHERE template_key IN ('rsvp_pass','rsvp_acknowledgement','rsvp_event_updated',
   'rsvp_waitlist_promoted','rsvp_approved','rsvp_denied','rsvp_removed')
   AND status IN ('pending','failed_retryable');
INSERT INTO public.rsvp_notification_deliveries(notification_id,channel,is_required)
SELECT n.id,c.channel,c.is_required
FROM public.rsvp_notifications n
CROSS JOIN LATERAL (
  VALUES
    ('email',true,NULLIF(btrim(n.payload->>'recipientEmail'),'') IS NOT NULL),
    ('sms',true,NULLIF(btrim(n.payload->>'recipientPhone'),'') IS NOT NULL),
    ('in_app',true,COALESCE(NULLIF(n.payload->>'matchedUserId',''),NULLIF(n.payload->>'primaryUserId','')) IS NOT NULL),
    ('push',false,COALESCE(NULLIF(n.payload->>'matchedUserId',''),NULLIF(n.payload->>'primaryUserId','')) IS NOT NULL)
) AS c(channel,is_required,applicable)
WHERE n.template_key IN ('rsvp_pass','rsvp_acknowledgement','rsvp_event_updated',
    'rsvp_waitlist_promoted','rsvp_approved','rsvp_denied','rsvp_removed')
  AND n.status IN ('pending','failed_retryable') AND c.applicable
ON CONFLICT DO NOTHING;

-- Atomic SKIP LOCKED claims. A stale processing lease is recoverable after five
-- minutes; attempt_count is incremented exactly once by the claim owner.
CREATE OR REPLACE FUNCTION public.claim_rsvp_notification_deliveries(
  p_notification_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 25
) RETURNS TABLE (
  delivery_id uuid, notification_id uuid, channel text, attempt_count integer,
  lease_id uuid, template_key text, payload jsonb, idempotency_key text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- A stale SMS/push lease whose provider call already started has an unknown
  -- acceptance outcome. Park it permanently instead of risking a duplicate.
  UPDATE public.rsvp_notification_deliveries d
     SET status = 'ambiguous', ambiguous_at = now(),
         safe_error_code = 'provider_acceptance_unknown',
         processing_started_at = NULL, lease_id = NULL, updated_at = now()
   WHERE (p_notification_id IS NULL OR d.notification_id = p_notification_id)
     AND d.status = 'processing'
     AND d.processing_started_at < now() - interval '5 minutes'
     AND d.provider_io_started_at IS NOT NULL;

  UPDATE public.rsvp_notifications n
     SET status = 'failed_terminal', last_error = 'provider_acceptance_unknown'
   WHERE (p_notification_id IS NULL OR n.id = p_notification_id)
     AND EXISTS (
       SELECT 1 FROM public.rsvp_notification_deliveries d
        WHERE d.notification_id = n.id AND d.is_required AND d.status = 'ambiguous'
     );

  RETURN QUERY
  WITH due AS (
    SELECT d.id
      FROM public.rsvp_notification_deliveries d
     WHERE (p_notification_id IS NULL OR d.notification_id = p_notification_id)
       AND (
         (d.status IN ('pending','failed_retryable') AND d.next_attempt_at <= now())
         OR (d.status = 'processing' AND d.processing_started_at < now() - interval '5 minutes'
             AND d.provider_io_started_at IS NULL)
       )
     ORDER BY d.next_attempt_at, d.created_at
     FOR UPDATE SKIP LOCKED
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100)
  ), claimed AS (
    UPDATE public.rsvp_notification_deliveries d
       SET status = 'processing', processing_started_at = now(),
           lease_id = gen_random_uuid(), attempt_count = d.attempt_count + 1,
           updated_at = now()
      FROM due
     WHERE d.id = due.id
    RETURNING d.*
  )
  SELECT c.id, c.notification_id, c.channel, c.attempt_count, c.lease_id,
         n.template_key, n.payload, n.idempotency_key
    FROM claimed c JOIN public.rsvp_notifications n ON n.id = c.notification_id;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_rsvp_notification_deliveries(uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_rsvp_notification_deliveries(uuid, integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.mark_rsvp_notification_provider_io(
  p_delivery_id uuid, p_lease_id uuid
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF current_user NOT IN ('postgres','service_role') THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  UPDATE public.rsvp_notification_deliveries
     SET provider_io_started_at = COALESCE(provider_io_started_at, now()),
         updated_at = now()
   WHERE id = p_delivery_id AND lease_id = p_lease_id AND status = 'processing';
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.mark_rsvp_notification_provider_io(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_rsvp_notification_provider_io(uuid, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.finish_rsvp_notification_delivery(
  p_delivery_id uuid, p_lease_id uuid, p_status text,
  p_provider_message_id text DEFAULT NULL, p_safe_error_code text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_notification_id uuid; v_attempt integer;
BEGIN
  IF p_status NOT IN ('sent','failed_retryable','failed_terminal','ambiguous') THEN
    RAISE EXCEPTION 'invalid_delivery_status';
  END IF;
  UPDATE public.rsvp_notification_deliveries
     SET status = CASE WHEN p_status='failed_retryable' AND attempt_count>=8
           THEN 'failed_terminal' ELSE p_status END,
         provider_message_id = LEFT(p_provider_message_id, 255),
         safe_error_code = LEFT(p_safe_error_code, 80),
         sent_at = CASE WHEN p_status = 'sent' THEN now() ELSE sent_at END,
         ambiguous_at = CASE WHEN p_status = 'ambiguous' THEN now() ELSE ambiguous_at END,
         next_attempt_at = CASE WHEN p_status = 'failed_retryable' AND attempt_count<8
           THEN now() + make_interval(secs =>
             LEAST(3600, 15 * (2 ^ LEAST(attempt_count, 8))) + floor(random()*11)::integer)
           ELSE next_attempt_at END,
         provider_io_started_at = CASE WHEN p_status = 'ambiguous'
           THEN provider_io_started_at ELSE NULL END,
         processing_started_at = NULL, lease_id = NULL, updated_at = now()
   WHERE id = p_delivery_id AND lease_id = p_lease_id AND status = 'processing'
   RETURNING notification_id, attempt_count INTO v_notification_id, v_attempt;
  IF NOT FOUND THEN RETURN false; END IF;

  UPDATE public.rsvp_notifications n
     SET status = CASE
       WHEN NOT EXISTS (
         SELECT 1 FROM public.rsvp_notification_deliveries d
          WHERE d.notification_id = v_notification_id AND d.is_required
            AND d.status <> 'sent'
       ) THEN 'sent'
       WHEN EXISTS (
         SELECT 1 FROM public.rsvp_notification_deliveries d
          WHERE d.notification_id = v_notification_id AND d.is_required
            AND d.status = 'failed_retryable'
       ) THEN 'failed_retryable'
       WHEN EXISTS (
         SELECT 1 FROM public.rsvp_notification_deliveries d
          WHERE d.notification_id = v_notification_id AND d.is_required
            AND d.status IN ('failed_terminal','ambiguous')
       ) THEN 'failed_terminal'
       ELSE 'sending' END,
         sent_at = CASE WHEN NOT EXISTS (
           SELECT 1 FROM public.rsvp_notification_deliveries d
            WHERE d.notification_id = v_notification_id AND d.is_required
              AND d.status <> 'sent'
         ) THEN now() ELSE n.sent_at END,
         last_error = CASE WHEN p_status = 'sent' THEN n.last_error ELSE p_safe_error_code END,
         attempt_count = GREATEST(n.attempt_count, v_attempt)
   WHERE n.id = v_notification_id;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.finish_rsvp_notification_delivery(uuid, uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_rsvp_notification_delivery(uuid, uuid, text, text, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.classify_rsvp_notification_failure(
  p_delivery_id uuid, p_lease_id uuid, p_safe_error_code text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_provider_io_started_at timestamptz;
BEGIN
  IF current_user NOT IN ('postgres','service_role') THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  SELECT provider_io_started_at INTO v_provider_io_started_at
    FROM public.rsvp_notification_deliveries
   WHERE id = p_delivery_id AND lease_id = p_lease_id AND status = 'processing'
   FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  RETURN public.finish_rsvp_notification_delivery(
    p_delivery_id, p_lease_id,
    CASE WHEN v_provider_io_started_at IS NULL THEN 'failed_retryable' ELSE 'ambiguous' END,
    NULL,
    CASE WHEN v_provider_io_started_at IS NULL
      THEN p_safe_error_code ELSE 'provider_acceptance_unknown' END
  );
END;
$$;
REVOKE ALL ON FUNCTION public.classify_rsvp_notification_failure(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.classify_rsvp_notification_failure(uuid, uuid, text)
  TO service_role;

-- Acknowledgements are separate from credential delivery and are issued for all
-- RSVP outcomes. The trigger above fans each recipient out to the applicable
-- email/SMS/in-app/push channel rows.
CREATE OR REPLACE FUNCTION public.enqueue_rsvp_acknowledgement(p_rsvp_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rsvp public.event_rsvps%ROWTYPE; v_event public.events%ROWTYPE;
  v_brand record; v_guest record; v_count integer := 0;
BEGIN
  SELECT * INTO v_rsvp FROM public.event_rsvps WHERE id = p_rsvp_id;
  IF NOT FOUND THEN RETURN 0; END IF;
  SELECT * INTO v_event FROM public.events WHERE id = v_rsvp.event_id;
  SELECT name, slug INTO v_brand FROM public.brands WHERE id = v_event.brand_id;
  INSERT INTO public.rsvp_notifications(
    event_id,rsvp_id,recipient,status,template_key,payload,idempotency_key,attempt_count
  ) VALUES (
    v_event.id,v_rsvp.id,v_rsvp.guest_email,'pending','rsvp_acknowledgement',
    jsonb_build_object('template_key','rsvp_acknowledgement','role','primary',
      'entityId',v_rsvp.id,'primaryUserId',v_rsvp.user_id,
      'recipientName',v_rsvp.guest_name,'recipientEmail',v_rsvp.guest_email,
      'recipientPhone',v_rsvp.guest_phone,'eventName',COALESCE(v_event.title,'your event'),
      'brandName',COALESCE(v_brand.name,'Mingla'),'eventId',v_event.id,
      'rsvpId',v_rsvp.id,'status',v_rsvp.rsvp_status,
      'approvalStatus',v_rsvp.approval_status),
    'rsvp_ack:'||v_rsvp.id::text||':primary:'||v_rsvp.updated_at::text,0
  ) ON CONFLICT(idempotency_key) DO NOTHING;
  IF FOUND THEN v_count := v_count + 1; END IF;
  FOR v_guest IN SELECT * FROM public.event_rsvp_guests WHERE rsvp_id = p_rsvp_id LOOP
    INSERT INTO public.rsvp_notifications(
      event_id,rsvp_id,recipient,status,template_key,payload,idempotency_key,attempt_count
    ) VALUES (
      v_event.id,v_rsvp.id,v_guest.email,'pending','rsvp_acknowledgement',
      jsonb_build_object('template_key','rsvp_acknowledgement','role','guest',
        'entityId',v_guest.id,'guestId',v_guest.id,'matchedUserId',v_guest.matched_user_id,
        'recipientName',v_guest.name,'recipientEmail',v_guest.email,
        'recipientPhone',v_guest.phone,'eventName',COALESCE(v_event.title,'your event'),
        'brandName',COALESCE(v_brand.name,'Mingla'),'eventId',v_event.id,
        'rsvpId',v_rsvp.id,'status',v_rsvp.rsvp_status,
        'approvalStatus',v_rsvp.approval_status),
      'rsvp_ack:'||v_rsvp.id::text||':'||v_guest.id::text||':'||v_rsvp.updated_at::text,0
    ) ON CONFLICT(idempotency_key) DO NOTHING;
    IF FOUND THEN v_count := v_count + 1; END IF;
  END LOOP;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.enqueue_rsvp_acknowledgement(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_rsvp_acknowledgement(uuid) TO service_role;

-- Submission + both notification intents share one database transaction. The
-- Edge boundary performs provider I/O only after this wrapper commits.
CREATE OR REPLACE FUNCTION public.submit_event_rsvp_with_delivery(
  p_event_id uuid,
  p_user_id uuid,
  p_guest_name text,
  p_guest_email text,
  p_guest_phone text,
  p_rsvp_status text,
  p_plus_count integer DEFAULT 0,
  p_guests jsonb DEFAULT '[]'::jsonb,
  p_qr_token_pepper text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_result jsonb; v_rsvp_id uuid;
BEGIN
  v_result := public.submit_event_rsvp(
    p_event_id,p_user_id,p_guest_name,p_guest_email,p_guest_phone,
    p_rsvp_status,p_plus_count,p_guests,p_qr_token_pepper
  );
  v_rsvp_id := NULLIF(v_result->>'rsvpId','')::uuid;
  IF v_rsvp_id IS NOT NULL THEN
    PERFORM public.enqueue_rsvp_acknowledgement(v_rsvp_id);
    IF v_result->>'status'='going' AND v_result->>'approvalStatus'='approved' THEN
      PERFORM public.enqueue_rsvp_pass(v_rsvp_id,p_qr_token_pepper);
    END IF;
  END IF;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.submit_event_rsvp_with_delivery(
  uuid,uuid,text,text,text,text,integer,jsonb,text
) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.submit_event_rsvp_with_delivery(
  uuid,uuid,text,text,text,text,integer,jsonb,text
) TO service_role;

-- Canonical Explorer party-pass read. The primary owner may see their exact
-- primary + guest credential rows; a matched plus-one sees only their own row.
-- No contact fields or recovery material cross this boundary.
CREATE OR REPLACE FUNCTION public.fetch_user_rsvp_party_passes(p_rsvp_id uuid)
RETURNS TABLE (
  entity_type text,
  entity_id uuid,
  display_name text,
  qr_code text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $function$
  SELECT 'primary'::text, r.id,
         COALESCE(NULLIF(btrim(p.display_name),''),NULLIF(r.guest_name,'Guest'),r.guest_name),
         r.qr_code
    FROM public.event_rsvps r
    JOIN public.events e ON e.id=r.event_id
    LEFT JOIN public.profiles p ON p.id=r.user_id
   WHERE r.id=p_rsvp_id
     AND r.user_id=auth.uid()
     AND r.rsvp_status='going'
     AND r.approval_status='approved'
     AND r.qr_code IS NOT NULL
     AND e.deleted_at IS NULL
     AND e.status<>'cancelled'
  UNION ALL
  SELECT 'guest'::text, g.id,
         COALESCE(NULLIF(btrim(pg.display_name),''),g.name),
         g.qr_code
    FROM public.event_rsvp_guests g
    JOIN public.event_rsvps r ON r.id=g.rsvp_id
    JOIN public.events e ON e.id=r.event_id
    LEFT JOIN public.profiles pg ON pg.id=g.matched_user_id
   WHERE r.id=p_rsvp_id
     AND (r.user_id=auth.uid() OR g.matched_user_id=auth.uid())
     AND r.rsvp_status='going'
     AND r.approval_status='approved'
     AND g.qr_code IS NOT NULL
     AND e.deleted_at IS NULL
     AND e.status<>'cancelled'
   ORDER BY 1 DESC, 2;
$function$;
REVOKE ALL ON FUNCTION public.fetch_user_rsvp_party_passes(uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.fetch_user_rsvp_party_passes(uuid)
  TO authenticated;

-- Authenticated scanner RPC. Authorization is the first executable operation;
-- exact equality with the server-minted qr_code validates the signed payload
-- without exposing the token hash or pepper to scanner clients.
CREATE OR REPLACE FUNCTION public.biz_rsvp_scan(p_event_id uuid, p_qr_payload text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
  c_before constant interval := interval '120 minutes';
  c_after constant interval := interval '360 minutes';
  v_actor uuid := auth.uid(); v_match text[]; v_entity_id uuid;
  v_rsvp public.event_rsvps%ROWTYPE; v_guest public.event_rsvp_guests%ROWTYPE;
  v_event_id uuid; v_outcome text := 'not_found'; v_now timestamptz := now();
  v_next_start timestamptz; v_last_end timestamptz; v_scan_id uuid;
BEGIN
  IF v_actor IS NULL OR NOT (
    EXISTS (SELECT 1 FROM public.events e WHERE e.id=p_event_id
      AND public.biz_brand_effective_rank(e.brand_id,v_actor)
        >= public.biz_role_rank('event_manager'))
    OR EXISTS (SELECT 1 FROM public.event_scanners es WHERE es.event_id=p_event_id
      AND es.user_id=v_actor AND es.removed_at IS NULL
      AND COALESCE((es.permissions->>'scan')::boolean,true))
    OR EXISTS (SELECT 1 FROM public.events e JOIN public.brand_team_members m ON m.brand_id=e.brand_id
      WHERE e.id=p_event_id AND m.user_id=v_actor AND m.role='scanner'
        AND m.removed_at IS NULL AND m.accepted_at IS NOT NULL)
  ) THEN RAISE EXCEPTION 'scanner_not_authorized'; END IF;

  v_match := regexp_match(COALESCE(p_qr_payload,''),
    '^mingla:v1:rsvp:([0-9a-fA-F-]{36}):sig:([a-f0-9]{64})$');
  IF v_match IS NOT NULL THEN
    v_entity_id := v_match[1]::uuid;
    SELECT * INTO v_rsvp FROM public.event_rsvps
      WHERE id=v_entity_id AND qr_code=p_qr_payload FOR UPDATE;
    IF NOT FOUND THEN
      SELECT * INTO v_guest FROM public.event_rsvp_guests
        WHERE id=v_entity_id AND qr_code=p_qr_payload FOR UPDATE;
      IF FOUND THEN SELECT * INTO v_rsvp FROM public.event_rsvps WHERE id=v_guest.rsvp_id; END IF;
    END IF;
    IF v_rsvp.id IS NOT NULL THEN
      v_event_id := v_rsvp.event_id;
      IF v_event_id <> p_event_id THEN v_outcome := 'wrong_event';
      ELSIF v_rsvp.rsvp_status <> 'going' OR v_rsvp.approval_status <> 'approved' THEN
        v_outcome := CASE WHEN v_rsvp.approval_status='denied' THEN 'revoked' ELSE 'not_eligible' END;
      ELSIF EXISTS (SELECT 1 FROM public.events e WHERE e.id=p_event_id
        AND (e.deleted_at IS NOT NULL OR e.status='cancelled')) THEN v_outcome := 'revoked';
      ELSIF (CASE WHEN v_guest.id IS NOT NULL THEN v_guest.checked_in_at ELSE v_rsvp.checked_in_at END) IS NOT NULL
        THEN v_outcome := 'duplicate';
      ELSIF NOT EXISTS (SELECT 1 FROM public.event_dates WHERE event_id=p_event_id) THEN v_outcome := 'success';
      ELSIF EXISTS (SELECT 1 FROM public.event_dates WHERE event_id=p_event_id
        AND v_now BETWEEN start_at-c_before AND end_at+c_after) THEN v_outcome := 'success';
      ELSE
        SELECT min(start_at) INTO v_next_start FROM public.event_dates
          WHERE event_id=p_event_id AND start_at-c_before > v_now;
        IF v_next_start IS NOT NULL THEN v_outcome := 'not_yet_open';
        ELSE v_outcome := 'event_ended';
          SELECT max(end_at) INTO v_last_end FROM public.event_dates WHERE event_id=p_event_id;
        END IF;
      END IF;
      IF v_outcome='success' THEN
        IF v_guest.id IS NOT NULL THEN UPDATE public.event_rsvp_guests
          SET checked_in_at=v_now, checked_in_by=v_actor WHERE id=v_guest.id;
        ELSE UPDATE public.event_rsvps SET checked_in_at=v_now, checked_in_by=v_actor WHERE id=v_rsvp.id;
        END IF;
      END IF;
    END IF;
  END IF;
  INSERT INTO public.rsvp_scan_events(requested_event_id,matched_event_id,rsvp_id,guest_id,
    scanner_user_id,outcome,metadata)
  VALUES(p_event_id,v_event_id,
    CASE WHEN v_guest.id IS NULL THEN v_rsvp.id ELSE NULL END,v_guest.id,v_actor,v_outcome,
    jsonb_strip_nulls(jsonb_build_object('source','scan-rsvp','nextStartAt',v_next_start,'lastEndAt',v_last_end)))
  RETURNING id INTO v_scan_id;
  RETURN jsonb_strip_nulls(jsonb_build_object(
    'result',v_outcome,'scanId',v_scan_id,
    'entityType',CASE WHEN v_outcome IN ('success','duplicate') THEN
      CASE WHEN v_guest.id IS NULL THEN 'primary' ELSE 'guest' END END,
    'entityId',CASE WHEN v_outcome IN ('success','duplicate') THEN
      COALESCE(v_guest.id,v_rsvp.id) END,
    'attendeeDisplayName',CASE WHEN v_outcome IN ('success','duplicate') THEN
      COALESCE(v_guest.name,v_rsvp.guest_name) END,
    'nextStartAt',v_next_start,'lastEndAt',v_last_end,'checkedInAt',
    CASE WHEN v_outcome IN ('success','duplicate') THEN
      COALESCE(CASE WHEN v_guest.id IS NOT NULL THEN v_guest.checked_in_at ELSE v_rsvp.checked_in_at END,v_now) END));
END;
$$;
REVOKE ALL ON FUNCTION public.biz_rsvp_scan(uuid,text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.biz_rsvp_scan(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.rsvp_event_checkin_summary(p_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_capacity integer; v_going bigint; v_checked bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.events e WHERE e.id=p_event_id AND
    (public.biz_brand_effective_rank(e.brand_id,auth.uid())>=public.biz_role_rank('event_manager')
     OR EXISTS (SELECT 1 FROM public.event_scanners es WHERE es.event_id=e.id
       AND es.user_id=auth.uid() AND es.removed_at IS NULL)))
  THEN RAISE EXCEPTION 'insufficient_event_permission'; END IF;
  SELECT rsvp_capacity INTO v_capacity FROM public.events WHERE id=p_event_id;
  SELECT count(*) INTO v_going FROM (
    SELECT r.id FROM public.event_rsvps r
      WHERE r.event_id=p_event_id AND r.rsvp_status='going' AND r.approval_status='approved'
    UNION ALL
    SELECT g.id FROM public.event_rsvp_guests g
      JOIN public.event_rsvps r ON r.id=g.rsvp_id
      WHERE r.event_id=p_event_id AND r.rsvp_status='going' AND r.approval_status='approved'
  ) eligible_party;
  SELECT count(*) INTO v_checked FROM (
    SELECT r.id FROM public.event_rsvps r
      WHERE r.event_id=p_event_id AND r.rsvp_status='going'
        AND r.approval_status='approved' AND r.checked_in_at IS NOT NULL
    UNION ALL
    SELECT g.id FROM public.event_rsvp_guests g
      JOIN public.event_rsvps r ON r.id=g.rsvp_id
      WHERE r.event_id=p_event_id AND r.rsvp_status='going'
        AND r.approval_status='approved' AND g.checked_in_at IS NOT NULL
  ) checked_party;
  RETURN jsonb_build_object('going',COALESCE(v_going,0),'capacity',v_capacity,'checkedIn',COALESCE(v_checked,0));
END;
$$;
REVOKE ALL ON FUNCTION public.rsvp_event_checkin_summary(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rsvp_event_checkin_summary(uuid) TO authenticated;

-- Host console: preserve existing 18-column contract and append check-in truth.
DROP FUNCTION IF EXISTS public.host_list_rsvp_guests(uuid);
CREATE FUNCTION public.host_list_rsvp_guests(p_event_id uuid)
RETURNS TABLE (
  id uuid,event_id uuid,user_id uuid,guest_name text,guest_email text,guest_phone text,
  rsvp_status text,approval_status text,plus_count integer,waitlisted_at timestamptz,
  promoted_at timestamptz,created_at timestamptz,display_name text,username text,
  avatar_url text,email text,phone text,source text,checked_in_at timestamptz,
  checked_in_by uuid,plus_checked_in_count integer,plus_checkins jsonb
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.events e WHERE e.id=p_event_id AND
    public.biz_brand_effective_rank(e.brand_id,auth.uid())>=public.biz_role_rank('event_manager'))
  THEN RAISE EXCEPTION 'insufficient_event_permission'; END IF;
  RETURN QUERY SELECT r.id,r.event_id,r.user_id,r.guest_name,r.guest_email,r.guest_phone,
    r.rsvp_status,r.approval_status,r.plus_count,r.waitlisted_at,r.promoted_at,r.created_at,
    COALESCE(NULLIF(btrim(p.display_name),''),NULLIF(r.guest_name,'Guest'),r.guest_name),
    p.username,p.avatar_url,COALESCE(NULLIF(btrim(p.email),''),NULLIF(btrim(r.guest_email),'')),
    COALESCE(NULLIF(btrim(p.phone),''),NULLIF(btrim(r.guest_phone),'')),
    CASE WHEN r.user_id IS NOT NULL THEN 'app' ELSE 'web' END,r.checked_in_at,r.checked_in_by,
    (SELECT count(*)::integer FROM public.event_rsvp_guests g WHERE g.rsvp_id=r.id AND g.checked_in_at IS NOT NULL),
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id',g.id,'name',g.name,
      'checkedInAt',g.checked_in_at,'checkedInBy',g.checked_in_by) ORDER BY g.created_at)
      FROM public.event_rsvp_guests g WHERE g.rsvp_id=r.id),'[]'::jsonb)
  FROM public.event_rsvps r LEFT JOIN public.profiles p ON p.id=r.user_id
  WHERE r.event_id=p_event_id ORDER BY
    CASE WHEN r.approval_status='pending' THEN 0 WHEN r.rsvp_status='going' AND r.approval_status='approved' THEN 1
      WHEN r.rsvp_status='waitlisted' THEN 2 WHEN r.rsvp_status='maybe' THEN 3 ELSE 4 END,r.created_at;
END;
$$;
REVOKE ALL ON FUNCTION public.host_list_rsvp_guests(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.host_list_rsvp_guests(uuid) TO authenticated;

-- Required RSVP delivery handoff/retry cadence: one minute or faster. The QR
-- repair cron remains independent; this sweep owns every due child channel.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='issue_1447_rsvp_delivery_sweep') THEN
    PERFORM cron.unschedule('issue_1447_rsvp_delivery_sweep');
  END IF;
END$$;
SELECT cron.schedule(
  'issue_1447_rsvp_delivery_sweep',
  '* * * * *',
  $cron$
    SELECT net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets
              WHERE name='supabase_url' LIMIT 1) || '/functions/v1/rsvp-notify',
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets
          WHERE name='service_role_key' LIMIT 1)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 30000
    );
  $cron$
);

COMMIT;
