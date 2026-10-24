BEGIN;
SET LOCAL lock_timeout = '10s';

-- #4063 Wave 2 is switched on only after the reviewed edge bundle is live.
-- Until then, gated producers retain their pre-#4063 behavior exactly.
CREATE TABLE IF NOT EXISTS public.issue_4063_switches (
  name text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  changed_at timestamptz NULL
);

ALTER TABLE public.issue_4063_switches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.issue_4063_switches FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.issue_4063_switches FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.issue_4063_switches
  TO service_role;

INSERT INTO public.issue_4063_switches(name, enabled, changed_at)
VALUES ('messages_v2', false, NULL)
ON CONFLICT (name) DO NOTHING;

CREATE OR REPLACE FUNCTION public.issue_4063_switch_on(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT coalesce((
    SELECT switch.enabled
      FROM public.issue_4063_switches AS switch
     WHERE switch.name = p_name
  ), false)
$function$;

REVOKE ALL ON FUNCTION public.issue_4063_switch_on(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4063_switch_on(text)
  TO service_role;

COMMENT ON TABLE public.issue_4063_switches IS
  '#4063: service-role-only release switches. messages_v2 stays false until the reviewed edge bundle is verified live.';
COMMENT ON FUNCTION public.issue_4063_switch_on(text) IS
  '#4063: fail-closed switch reader used by SECURITY DEFINER notification producers.';

CREATE OR REPLACE FUNCTION public.rsvp_prepare_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_guest public.event_rsvp_guests%ROWTYPE;
  v_primary public.event_rsvps%ROWTYPE;
  v_enrich jsonb := '{}'::jsonb;
BEGIN
  SELECT * INTO v_primary
    FROM public.event_rsvps
   WHERE id = NEW.rsvp_id;
  SELECT * INTO v_guest
    FROM public.event_rsvp_guests
   WHERE rsvp_id = NEW.rsvp_id
     AND (
       id::text = nullif(NEW.payload->>'guestId','')
       OR qr_code = nullif(NEW.payload->>'qrCode','')
       OR lower(email) = lower(coalesce(NEW.recipient, ''))
     )
   ORDER BY CASE
     WHEN id::text = nullif(NEW.payload->>'guestId','') THEN 0
     ELSE 1
   END
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

  SELECT jsonb_strip_nulls(jsonb_build_object(
    'eventId', event.id,
    'eventName', event.title,
    'brandName', brand.name,
    'eventStartAt', master_date.start_at,
    'eventEndAt', master_date.end_at,
    'eventTimezone', coalesce(master_date.timezone, event.timezone),
    'venueLine', event.location_text,
    'leadName', CASE
      WHEN (NEW.payload->>'role') = 'guest' THEN v_guest.name
      ELSE NULL
    END,
    'claimed', CASE
      WHEN (NEW.payload->>'role') = 'guest'
        THEN v_guest.matched_user_id IS NOT NULL
      ELSE v_primary.user_id IS NOT NULL
    END
  ))
    INTO v_enrich
    FROM public.events AS event
    JOIN public.brands AS brand ON brand.id = event.brand_id
    LEFT JOIN LATERAL (
      SELECT date.start_at, date.end_at, date.timezone
        FROM public.event_dates AS date
       WHERE date.event_id = event.id
         AND date.is_master
       ORDER BY date.start_at, date.id
       LIMIT 1
    ) AS master_date ON true
   WHERE event.id = v_primary.event_id;

  -- Existing payload keys are caller-owned and win over canonical enrichment.
  NEW.payload := coalesce(v_enrich, '{}'::jsonb) || NEW.payload;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.submit_event_rsvp_with_delivery(
  p_event_id uuid,
  p_user_id uuid,
  p_guest_name text,
  p_guest_email text,
  p_guest_phone text,
  p_rsvp_status text,
  p_plus_count integer DEFAULT 0,
  p_guests jsonb DEFAULT '[]'::jsonb,
  p_qr_token_pepper text DEFAULT NULL,
  p_guest_phone_country_iso text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_result jsonb;
  v_rsvp_id uuid;
BEGIN
  v_result := public.submit_event_rsvp(
    p_event_id,
    p_user_id,
    p_guest_name,
    p_guest_email,
    p_guest_phone,
    p_rsvp_status,
    p_plus_count,
    p_guests,
    p_qr_token_pepper,
    p_guest_phone_country_iso
  );
  v_rsvp_id := nullif(v_result->>'rsvpId','')::uuid;
  IF v_rsvp_id IS NOT NULL THEN
    IF v_result->>'status' = 'going'
       AND v_result->>'approvalStatus' = 'approved' THEN
      -- An approved attendee gets the pass, not a duplicate acknowledgement.
      PERFORM public.enqueue_rsvp_pass(v_rsvp_id, p_qr_token_pepper);
    ELSE
      PERFORM public.enqueue_rsvp_acknowledgement(v_rsvp_id);
    END IF;
  END IF;
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.submit_event_rsvp_with_delivery(
  uuid,uuid,text,text,text,text,integer,jsonb,text,text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_event_rsvp_with_delivery(
  uuid,uuid,text,text,text,text,integer,jsonb,text,text
) TO service_role;

CREATE OR REPLACE FUNCTION public.orch_1161_reservation_notify_outbox()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_category text;
  v_contact text;
  v_base_key text;
  v_refund_cents integer;
  v_refund_currency text;
  v_v2 boolean := public.issue_4063_switch_on('messages_v2');
  v_payload jsonb;
  v_venue_name text;
  v_venue_address text;
  v_venue_city text;
  v_timezone text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'confirmed' THEN
      RETURN NEW;
    END IF;
    v_category := 'buyer_reservation_confirmed';
    v_base_key := 'buyer_reservation_confirmed:' || NEW.id::text;
  ELSE
    IF NOT v_v2 THEN
      -- Preserve the exact pre-#4063 trigger guard while the switch is off.
      IF NEW.status IS NOT DISTINCT FROM OLD.status
         AND NEW.table_id IS NOT DISTINCT FROM OLD.table_id
         AND NEW.reserved_for IS NOT DISTINCT FROM OLD.reserved_for THEN
        RETURN NEW;
      END IF;
    ELSIF NEW.status IS NOT DISTINCT FROM OLD.status
       AND NEW.table_id IS NOT DISTINCT FROM OLD.table_id
       AND NEW.reserved_for IS NOT DISTINCT FROM OLD.reserved_for
       AND NEW.party_size IS NOT DISTINCT FROM OLD.party_size THEN
      RETURN NEW;
    END IF;

    IF NEW.status IN ('cancelled_by_guest','cancelled_by_venue')
       AND NEW.status IS DISTINCT FROM OLD.status THEN
      v_category := 'buyer_reservation_cancelled';
    ELSIF NEW.status = 'confirmed' AND OLD.status = 'requested' THEN
      v_category := 'buyer_reservation_confirmed';
    ELSIF NOT v_v2 THEN
      v_category := 'buyer_reservation_changed';
    ELSIF NEW.status NOT IN ('cancelled_by_guest','cancelled_by_venue')
       AND (
         NEW.reserved_for IS DISTINCT FROM OLD.reserved_for
         OR NEW.party_size IS DISTINCT FROM OLD.party_size
       ) THEN
      v_category := 'buyer_reservation_changed';
    ELSE
      -- #4063: seated/completed/no-show and table-only transitions are quiet.
      RETURN NEW;
    END IF;

    IF v_category = 'buyer_reservation_confirmed' THEN
      v_base_key := 'buyer_reservation_confirmed:' || NEW.id::text;
    ELSE
      v_base_key := v_category || ':' || NEW.id::text || ':'
        || to_char(now(), 'YYYYMMDD"T"HH24MISSMS');
    END IF;
  END IF;

  IF v_category = 'buyer_reservation_cancelled'
     AND NEW.status = 'cancelled_by_venue' THEN
    SELECT refund.buyer_refund_requested_cents, refund.currency
      INTO v_refund_cents, v_refund_currency
      FROM public.source_refunds AS refund
     WHERE refund.source_type = 'venue_reservation'
       AND refund.subject_id = NEW.id
       AND refund.refund_kind = 'venue_staff_cancel'
     ORDER BY refund.requested_at DESC
     LIMIT 1;
  END IF;

  v_payload := jsonb_build_object(
    'reservation_id', NEW.id,
    'status', NEW.status,
    'reserved_for', NEW.reserved_for,
    'party_size', NEW.party_size,
    'guest_name', NEW.guest_name,
    'guest_phone_e164', NEW.guest_phone_e164,
    'guest_email', NEW.guest_email
  ) || CASE
    WHEN v_refund_cents IS NULL THEN '{}'::jsonb
    ELSE jsonb_build_object(
      'cancelled_by', 'venue',
      'refund_amount_cents', v_refund_cents,
      'refund_currency', v_refund_currency
    )
  END;

  IF v_v2 THEN
    SELECT
      venue.name,
      venue.address,
      venue.city,
      CASE
        WHEN availability.iana_timezone_source IN ('derived','operator')
          THEN availability.iana_timezone
        ELSE NULL
      END
      INTO v_venue_name, v_venue_address, v_venue_city, v_timezone
      FROM public.venue_listings AS venue
      LEFT JOIN public.venue_availability_config AS availability
        ON availability.venue_id = venue.id
     WHERE venue.id = NEW.venue_id;

    v_payload := v_payload || jsonb_strip_nulls(jsonb_build_object(
      'venue_id', NEW.venue_id,
      'venue_name', v_venue_name,
      'venue_address', v_venue_address,
      'venue_city', v_venue_city,
      'timezone', v_timezone,
      'created_via', NEW.created_via,
      'claimed', NEW.consumer_user_id IS NOT NULL,
      'previous_reserved_for', CASE WHEN TG_OP = 'UPDATE'
        THEN OLD.reserved_for ELSE NULL END,
      'previous_party_size', CASE WHEN TG_OP = 'UPDATE'
        THEN OLD.party_size ELSE NULL END
    ));

    IF nullif(btrim(coalesce(NEW.guest_email, '')), '') IS NOT NULL THEN
      INSERT INTO public.notification_outbox (
        category_key, user_id, contact, brand_id, payload,
        idempotency_key, country_code
      ) VALUES (
        v_category,
        NEW.consumer_user_id,
        lower(btrim(NEW.guest_email)),
        NEW.brand_id,
        v_payload,
        v_base_key || ':email',
        public.mingla_e164_country(NEW.guest_phone_e164)
      ) ON CONFLICT (idempotency_key) DO NOTHING;
    END IF;

    IF NEW.guest_phone_e164 ~ '^\+[1-9][0-9]{1,14}$' THEN
      INSERT INTO public.notification_outbox (
        category_key, user_id, contact, brand_id, payload,
        idempotency_key, country_code
      ) VALUES (
        v_category,
        CASE
          WHEN nullif(btrim(coalesce(NEW.guest_email, '')), '') IS NULL
            THEN NEW.consumer_user_id
          ELSE NULL
        END,
        NEW.guest_phone_e164,
        NEW.brand_id,
        v_payload || jsonb_build_object('channel_hint', 'sms'),
        v_base_key || ':sms',
        public.mingla_e164_country(NEW.guest_phone_e164)
      ) ON CONFLICT (idempotency_key) DO NOTHING;
    END IF;
  ELSE
    -- This branch is the pre-#4063 producer byte-for-byte in data shape.
    v_contact := coalesce(NEW.guest_phone_e164, NEW.guest_email);
    INSERT INTO public.notification_outbox (
      category_key, user_id, contact, brand_id, payload,
      idempotency_key, country_code
    ) VALUES (
      v_category,
      NEW.consumer_user_id,
      v_contact,
      NEW.brand_id,
      v_payload,
      v_base_key,
      public.mingla_e164_country(NEW.guest_phone_e164)
    ) ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.orch_1161_reservation_notify_outbox()
  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.orch_1161_reservation_notify_outbox()
  FROM anon;

CREATE OR REPLACE FUNCTION public.tg_venue_orders_a4063_receipt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_venue_name text;
BEGIN
  IF NEW.money_path <> 'mingla'
     OR NEW.payment_status <> 'paid'
     OR NEW.confirmed_at IS NULL
     OR NEW.buyer_phone_e164 !~ '^\+[1-9][0-9]{1,14}$'
     OR NOT public.issue_4063_switch_on('messages_v2')
     OR (
       TG_OP = 'UPDATE'
       AND OLD.payment_status = 'paid'
       AND OLD.confirmed_at IS NOT NULL
     ) THEN
    RETURN NEW;
  END IF;

  BEGIN
    SELECT venue.name
      INTO v_venue_name
      FROM public.venue_listings AS venue
     WHERE venue.id = NEW.venue_id;

    INSERT INTO public.notification_outbox (
      category_key,
      user_id,
      contact,
      brand_id,
      payload,
      idempotency_key,
      country_code,
      status
    ) VALUES (
      'buyer_venue_order_receipt',
      NEW.buyer_user_id,
      NEW.buyer_phone_e164,
      NEW.brand_id,
      jsonb_build_object(
        'venue_order_id', NEW.id,
        'venue_id', NEW.venue_id,
        'venue_name', coalesce(nullif(btrim(v_venue_name), ''), 'the venue'),
        'pickup_code', NEW.pickup_code,
        'claimed', NEW.buyer_user_id IS NOT NULL,
        'channel_hint', 'sms'
      ),
      'buyer_venue_order_receipt:' || NEW.id::text || ':sms',
      public.mingla_e164_country(NEW.buyer_phone_e164),
      'pending'
    )
    ON CONFLICT (idempotency_key) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    -- A notification failure must never roll back a successful payment write.
    RAISE WARNING 'issue_4063_receipt_enqueue_failed %', SQLSTATE;
  END;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.tg_venue_orders_a4063_receipt()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tg_venue_orders_a4063_receipt()
  TO service_role;

DROP TRIGGER IF EXISTS trg_venue_orders_a4063_receipt
  ON public.venue_orders;
CREATE TRIGGER trg_venue_orders_a4063_receipt
AFTER INSERT OR UPDATE OF payment_status, confirmed_at
ON public.venue_orders
FOR EACH ROW
EXECUTE FUNCTION public.tg_venue_orders_a4063_receipt();

-- MINGLA-INVARIANT: I-4063-OLD-SENDERS-NEVER-SEE-NEW-ROWS | issue #4063 | New message rows are emitted only after the service-role messages_v2 switch is enabled.
-- MINGLA-INVARIANT: I-4063-RECEIPT-NEVER-BLOCKS-PAYMENT | issue #4063 | Food-receipt enqueue failures are warning-only and cannot roll back a venue payment write.

COMMIT;
NOTIFY pgrst, 'reload schema';
