-- Refund status notices reach the buyer and the brand.
--
-- WHAT WAS BROKEN: resolve_source_refund_notification_recipient was written for
-- one notice only — the "action needed" request that carries an expiring link.
-- It returned NULL for every other notice (queued, processing, refunded,
-- delayed), and it looked buyers up only for venue reservations, treating
-- every other source as an RSVP contribution. So when a ticket checkout
-- payment was refunded, all of its notices (buyer email and SMS; brand in-app,
-- push and email) resolved to nobody, each delivery ended
-- failed_terminal / invalid_recipient, and the refund sat in needs_review with
-- attention_delivery_unavailable. Nobody was told their money came back.
--
-- NOW:
--   * An action-needed notice keeps every existing gate: the request is still
--     open, same generation and contact revision, not expired.
--   * A status notice (queued, provider_pending, processed, failed_retryable,
--     failed_terminal) resolves whenever its refund exists. The notice state is
--     read from the outbox payload, whose fingerprint the drain has already
--     verified before it calls this function.
--   * Every source type reads the same buyer contact the refund runner used
--     when it queued the notice (a contact corrected on the refund first), so
--     the keyed recipient fingerprint taken at queue time still matches.
--   * An unknown source type resolves no buyer contact, which the drain
--     records as skipped rather than guessing a recipient.

BEGIN;

CREATE OR REPLACE FUNCTION public.resolve_source_refund_notification_recipient(
  p_delivery_id uuid,p_claim_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v public.source_refund_notification_deliveries%ROWTYPE;
DECLARE r public.source_refunds%ROWTYPE; v_email text; v_phone text;
DECLARE v_notice_state text;
BEGIN
  IF current_user NOT IN ('postgres','service_role') THEN RAISE EXCEPTION 'not_authorized'; END IF;
  SELECT * INTO v FROM public.source_refund_notification_deliveries
    WHERE id=p_delivery_id AND dispatch_claim_id=p_claim_id
      AND status='dispatching' AND claim_expires_at>now() FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO r FROM public.source_refunds WHERE id=v.refund_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT o.payload->>'state' INTO v_notice_state
    FROM public.notification_outbox o WHERE o.id=v.outbox_id;
  IF v_notice_state IS NULL OR v_notice_state NOT IN (
    'queued','provider_pending','processed','failed_retryable','failed_terminal'
  ) THEN
    -- Action-needed (or unrecognised) notice: only while that exact request
    -- is still open.
    IF r.buyer_state<>'needs_attention'
       OR r.attention_generation<>v.attention_generation
       OR r.attention_recipient_revision<>v.recipient_revision
       OR r.attention_completed_at IS NOT NULL
       OR r.attention_expires_at IS NULL
       OR r.attention_expires_at<=now() THEN RETURN NULL; END IF;
  END IF;
  IF v.audience='brand' THEN
    SELECT b.contact_email,b.contact_phone
      INTO v_email,v_phone FROM public.brands b WHERE b.id=r.brand_id;
  ELSIF r.source_type='ticket_checkout_session' THEN
    SELECT COALESCE(NULLIF(r.attention_recipient_email_override,''),s.buyer_email),
      COALESCE(NULLIF(r.attention_recipient_phone_e164_override,''),s.buyer_phone_e164)
      INTO v_email,v_phone FROM public.ticket_checkout_sessions s
      WHERE s.id=r.subject_id;
  ELSIF r.source_type='venue_reservation' THEN
    SELECT COALESCE(NULLIF(r.attention_recipient_email_override,''),s.buyer_email),
      COALESCE(NULLIF(r.attention_recipient_phone_e164_override,''),s.buyer_phone_e164)
      INTO v_email,v_phone FROM public.reservation_checkout_sessions s
      WHERE s.id=r.source_id;
  ELSIF r.source_type='venue_menu_order' THEN
    SELECT COALESCE(NULLIF(r.attention_recipient_email_override,''),o.buyer_email),
      COALESCE(NULLIF(r.attention_recipient_phone_e164_override,''),o.buyer_phone_e164)
      INTO v_email,v_phone FROM public.venue_orders o
      WHERE o.id=r.subject_id;
  ELSIF r.source_type='stay_reservation' THEN
    SELECT COALESCE(NULLIF(r.attention_recipient_email_override,''),
        CASE WHEN jsonb_typeof(g.guest_snapshot->'email')='string'
          THEN g.guest_snapshot->>'email' END),
      COALESCE(NULLIF(r.attention_recipient_phone_e164_override,''),
        CASE WHEN jsonb_typeof(g.guest_snapshot->'phone')='string'
          THEN g.guest_snapshot->>'phone' END)
      INTO v_email,v_phone FROM public.stay_reservation_groups g
      WHERE g.id=r.subject_id;
  ELSIF r.source_type='rsvp_contribution' THEN
    SELECT COALESCE(NULLIF(r.attention_recipient_email_override,''),c.guest_email),
      COALESCE(NULLIF(r.attention_recipient_phone_e164_override,''),e.guest_phone)
      INTO v_email,v_phone FROM public.event_rsvp_contributions c
      LEFT JOIN public.event_rsvps e ON e.id=c.rsvp_id WHERE c.id=r.source_id;
  END IF;
  RETURN jsonb_build_object(
    'recipient',CASE WHEN v.channel='email' THEN v_email ELSE v_phone END,
    'channel',v.channel,'refundId',r.id,'generation',r.attention_generation,
    'keyId',r.attention_token_key_id,'expiresAt',r.attention_expires_at
  );
END $$;

REVOKE ALL ON FUNCTION
  public.resolve_source_refund_notification_recipient(uuid,uuid)
FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION
  public.resolve_source_refund_notification_recipient(uuid,uuid)
TO service_role;

COMMIT;
