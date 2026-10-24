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

CREATE OR REPLACE FUNCTION public.pg_notify_reminders_enqueue(
  p_lead_hours int,
  p_lead_bucket text,
  p_window_minutes int DEFAULT 30
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_low timestamptz;
  v_high timestamptz;
  -- Kept as a declaration for the #1210 compatibility probe. The caller's
  -- p_window_minutes value is deprecated and intentionally ignored.
  v_half_mins integer := NULL;
  v_inserted integer := 0;
  v_n integer;
BEGIN
  IF p_lead_bucket NOT IN ('24h', '2h') THEN
    RAISE EXCEPTION 'pg_notify_reminders_enqueue: invalid lead bucket %', p_lead_bucket;
  END IF;
  IF p_lead_hours IS NULL OR p_lead_hours <= 0 THEN
    RAISE EXCEPTION 'pg_notify_reminders_enqueue: lead hours must be positive (got %)', p_lead_hours;
  END IF;

  v_low := now() + make_interval(hours => p_lead_hours) - interval '7 minutes';
  v_high := now() + make_interval(hours => p_lead_hours) + interval '3 minutes';

  WITH upcoming AS (
    SELECT
      o.id AS order_id,
      o.event_id,
      o.buyer_user_id,
      COALESCE(o.buyer_phone_e164, o.buyer_email) AS contact,
      e.brand_id,
      e.event_type AS kind,
      e.title AS event_title,
      o.booked_start_at AS start_at,
      NULL::uuid AS event_date_id,
      e.timezone,
      e.location_text,
      NULL::text AS override_title,
      NULL::text AS override_location
    FROM public.orders AS o
    JOIN public.events AS e ON e.id = o.event_id
    WHERE e.event_type = 'experience'
      AND o.booked_start_at IS NOT NULL
      AND o.booked_start_at >= v_low
      AND o.booked_start_at < v_high
      AND e.deleted_at IS NULL
      AND e.status IN ('scheduled', 'live')
      AND o.payment_status IN ('paid', 'partial_refund')
      AND EXISTS (
        SELECT 1
          FROM public.tickets AS valid_ticket
         WHERE valid_ticket.order_id = o.id
           AND valid_ticket.status = 'valid'
      )
      AND (
        o.buyer_user_id IS NOT NULL
        OR o.buyer_email IS NOT NULL
        OR o.buyer_phone_e164 IS NOT NULL
      )

    UNION ALL

    SELECT
      o.id AS order_id,
      o.event_id,
      o.buyer_user_id,
      COALESCE(o.buyer_phone_e164, o.buyer_email) AS contact,
      e.brand_id,
      e.event_type AS kind,
      e.title AS event_title,
      bought_date.start_at,
      bought_date.event_date_id,
      COALESCE(bought_date.timezone, e.timezone) AS timezone,
      e.location_text,
      bought_date.override_title,
      bought_date.override_location
    FROM public.orders AS o
    JOIN public.events AS e ON e.id = o.event_id
    JOIN LATERAL (
      WITH candidates AS (
        SELECT DISTINCT
          date.id AS event_date_id,
          date.start_at,
          date.timezone,
          date.override_title,
          date.override_location,
          1 AS precedence
        FROM public.tickets AS ticket
        JOIN public.ticket_event_dates AS admitted
          ON admitted.ticket_id = ticket.id
        JOIN public.event_dates AS date
          ON date.id = admitted.event_date_id
         AND date.event_id = o.event_id
        WHERE ticket.order_id = o.id
          AND ticket.status = 'valid'

        UNION ALL

        SELECT
          date.id,
          date.start_at,
          date.timezone,
          date.override_title,
          date.override_location,
          2 AS precedence
        FROM public.event_dates AS date
        WHERE date.id = o.event_date_id
          AND date.event_id = o.event_id

        UNION ALL

        SELECT
          date.id,
          date.start_at,
          date.timezone,
          date.override_title,
          date.override_location,
          3 AS precedence
        FROM public.event_dates AS date
        WHERE date.event_id = o.event_id
          AND date.is_master
      )
      SELECT DISTINCT ON (candidate.event_date_id)
        candidate.event_date_id,
        candidate.start_at,
        candidate.timezone,
        candidate.override_title,
        candidate.override_location
      FROM candidates AS candidate
      WHERE candidate.precedence = (
        SELECT min(other_candidate.precedence) FROM candidates AS other_candidate
      )
      ORDER BY candidate.event_date_id, candidate.start_at
    ) AS bought_date ON true
    WHERE e.event_type <> 'experience'
      AND bought_date.start_at >= v_low
      AND bought_date.start_at < v_high
      AND e.deleted_at IS NULL
      AND e.status IN ('scheduled', 'live')
      AND o.payment_status IN ('paid', 'partial_refund')
      AND EXISTS (
        SELECT 1
          FROM public.tickets AS valid_ticket
         WHERE valid_ticket.order_id = o.id
           AND valid_ticket.status = 'valid'
      )
      AND (
        o.buyer_user_id IS NOT NULL
        OR o.buyer_email IS NOT NULL
        OR o.buyer_phone_e164 IS NOT NULL
      )
  ), inserted AS (
    INSERT INTO public.notification_outbox (
      category_key, user_id, contact, brand_id, payload,
      idempotency_key, country_code
    )
    SELECT
      'buyer_event_reminder',
      u.buyer_user_id,
      u.contact,
      u.brand_id,
      jsonb_strip_nulls(jsonb_build_object(
        'order_id', u.order_id,
        'event_id', u.event_id,
        'event_date_id', u.event_date_id,
        'kind', u.kind,
        'event_title', u.event_title,
        'reserved_for', u.start_at,
        'timezone', u.timezone,
        'location_text', u.location_text,
        'claimed', u.buyer_user_id IS NOT NULL,
        'lead_bucket', p_lead_bucket,
        -- Preserve the #3281 per-date override payload while adding the v2 shape.
        'date_title', u.override_title,
        'date_location', u.override_location
      )),
      'buyer_event_reminder:' || u.order_id::text || ':'
        || COALESCE(u.event_date_id::text, 'booked') || ':'
        || p_lead_bucket,
      public.mingla_e164_country(u.contact)
    FROM upcoming AS u
    WHERE NOT EXISTS (
      SELECT 1
        FROM public.notification_outbox AS prior
       WHERE prior.idempotency_key =
         'buyer_event_reminder:' || u.order_id::text || ':' || p_lead_bucket
         AND prior.created_at >= now() - interval '26 hours'
    )
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM inserted;
  v_inserted := v_inserted + COALESCE(v_n, 0);

  WITH upcoming AS (
    SELECT
      reservation.id AS reservation_id,
      reservation.consumer_user_id AS buyer_user_id,
      COALESCE(reservation.guest_phone_e164, reservation.guest_email) AS contact,
      reservation.brand_id,
      reservation.venue_id,
      reservation.reserved_for,
      reservation.party_size,
      reservation.guest_name,
      venue.name AS venue_name,
      CASE
        WHEN availability.iana_timezone_source IN ('derived', 'operator')
          THEN availability.iana_timezone
        ELSE NULL
      END AS timezone
    FROM public.reservations AS reservation
    LEFT JOIN public.venue_listings AS venue
      ON venue.id = reservation.venue_id
    LEFT JOIN public.venue_availability_config AS availability
      ON availability.venue_id = reservation.venue_id
    WHERE reservation.reserved_for >= v_low
      AND reservation.reserved_for < v_high
      AND reservation.status = 'confirmed'
      AND (
        reservation.consumer_user_id IS NOT NULL
        OR reservation.guest_email IS NOT NULL
        OR reservation.guest_phone_e164 IS NOT NULL
      )
  ), inserted AS (
    INSERT INTO public.notification_outbox (
      category_key, user_id, contact, brand_id, payload,
      idempotency_key, country_code
    )
    SELECT
      'buyer_reservation_reminder',
      u.buyer_user_id,
      u.contact,
      u.brand_id,
      jsonb_strip_nulls(jsonb_build_object(
        'reservation_id', u.reservation_id,
        'reserved_for', u.reserved_for,
        'party_size', u.party_size,
        'guest_name', u.guest_name,
        'lead_bucket', p_lead_bucket,
        'venue_id', u.venue_id,
        'venue_name', u.venue_name,
        'timezone', u.timezone,
        'claimed', u.buyer_user_id IS NOT NULL
      )),
      'buyer_reservation_reminder:' || u.reservation_id::text || ':'
        || p_lead_bucket,
      public.mingla_e164_country(u.contact)
    FROM upcoming AS u
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM inserted;
  v_inserted := v_inserted + COALESCE(v_n, 0);

  RETURN v_inserted;
END;
$function$;

REVOKE ALL ON FUNCTION public.pg_notify_reminders_enqueue(int, text, int)
  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pg_notify_reminders_enqueue(int, text, int)
  FROM anon;
GRANT EXECUTE ON FUNCTION public.pg_notify_reminders_enqueue(int, text, int)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.pg_notify_reminders_enqueue(int, text, int) IS
  '#4063: five-minute reminder enqueue window. p_window_minutes is deprecated and ignored; retained for caller compatibility.';

CREATE OR REPLACE FUNCTION public.issue_2947_waitlist_drain_for_ticket_type(
  p_ticket_type_id uuid,
  p_freed integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_running integer := 0;
  v_entry record;
  v_notification_id uuid;
  v_email_notification_id uuid;
  v_sms_notification_id uuid;
  v_channel text;
  v_recipient text;
  v_phone text;
  v_event_date_id uuid;
  v_start_at timestamptz;
  v_timezone text;
  v_payload jsonb;
  v_v2 boolean := public.issue_4063_switch_on('messages_v2');
BEGIN
  IF p_ticket_type_id IS NULL OR p_freed IS NULL OR p_freed < 1 THEN
    RETURN 0;
  END IF;

  FOR v_entry IN
    SELECT id, event_id, ticket_type_id, email, phone, qty_requested
      FROM public.waitlist_entries
     WHERE ticket_type_id = p_ticket_type_id
       AND status = 'waiting'
       AND notified_at IS NULL
     ORDER BY created_at ASC, id ASC
  LOOP
    EXIT WHEN v_running >= p_freed;

    IF NOT v_v2 THEN
      -- Preserve the exact pre-#4063 one-row producer while the switch is off.
      IF v_entry.email IS NOT NULL AND length(btrim(v_entry.email)) > 0 THEN
        v_channel := 'email';
        v_recipient := v_entry.email;
      ELSIF v_entry.phone IS NOT NULL AND length(btrim(v_entry.phone)) > 0 THEN
        v_channel := 'sms';
        v_recipient := v_entry.phone;
      ELSE
        CONTINUE;
      END IF;

      v_notification_id := NULL;
      INSERT INTO public.ticket_order_notifications
        (order_id, event_id, channel, recipient, status, payload,
         idempotency_key, attempt_count)
      VALUES
        (NULL, v_entry.event_id, v_channel, v_recipient, 'pending',
         jsonb_build_object(
           'template_key', 'waitlist_spot_open',
           'waitlist_entry_id', v_entry.id,
           'event_id', v_entry.event_id,
           'ticket_type_id', v_entry.ticket_type_id,
           'qty_requested', v_entry.qty_requested,
           'invite_expires_at', (now() + interval '24 hours')
         ),
         'waitlist_invite:' || v_entry.id::text,
         0)
      ON CONFLICT (idempotency_key) DO NOTHING
      RETURNING id INTO v_notification_id;
    ELSE
      SELECT date.id, date.start_at, COALESCE(date.timezone, event.timezone)
        INTO v_event_date_id, v_start_at, v_timezone
        FROM public.events AS event
        LEFT JOIN LATERAL (
          SELECT event_date.id, event_date.start_at, event_date.timezone
            FROM public.event_dates AS event_date
           WHERE event_date.event_id = event.id
           ORDER BY event_date.is_master DESC, event_date.start_at, event_date.id
           LIMIT 1
        ) AS date ON true
       WHERE event.id = v_entry.event_id;

      v_payload := jsonb_strip_nulls(jsonb_build_object(
        'template_key', 'waitlist_spot_open',
        'waitlist_entry_id', v_entry.id,
        'event_id', v_entry.event_id,
        'ticket_type_id', v_entry.ticket_type_id,
        'qty_requested', v_entry.qty_requested,
        'invite_expires_at', (now() + interval '24 hours'),
        'event_date_id', v_event_date_id,
        'timezone', v_timezone,
        'start_at', v_start_at
      ));

      v_email_notification_id := NULL;
      v_sms_notification_id := NULL;
      v_phone := public.mingla_e164_normalize(v_entry.phone);

      IF nullif(btrim(coalesce(v_entry.email, '')), '') IS NOT NULL THEN
        INSERT INTO public.ticket_order_notifications
          (order_id, event_id, channel, recipient, status, payload,
           idempotency_key, attempt_count)
        VALUES
          (NULL, v_entry.event_id, 'email', lower(btrim(v_entry.email)), 'pending',
           v_payload,
           'waitlist_invite:' || v_entry.id::text || ':email',
           0)
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING id INTO v_email_notification_id;

        IF v_email_notification_id IS NULL THEN
          SELECT notification.id INTO v_email_notification_id
            FROM public.ticket_order_notifications AS notification
           WHERE notification.idempotency_key =
             'waitlist_invite:' || v_entry.id::text || ':email';
        END IF;
      END IF;

      IF v_phone IS NOT NULL THEN
        INSERT INTO public.ticket_order_notifications
          (order_id, event_id, channel, recipient, status, payload,
           idempotency_key, attempt_count)
        VALUES
          (NULL, v_entry.event_id, 'sms', v_phone, 'pending',
           v_payload || jsonb_build_object('channel_hint', 'sms'),
           'waitlist_invite:' || v_entry.id::text || ':sms',
           0)
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING id INTO v_sms_notification_id;

        IF v_sms_notification_id IS NULL THEN
          SELECT notification.id INTO v_sms_notification_id
            FROM public.ticket_order_notifications AS notification
           WHERE notification.idempotency_key =
             'waitlist_invite:' || v_entry.id::text || ':sms';
        END IF;
      END IF;

      v_notification_id := COALESCE(v_email_notification_id, v_sms_notification_id);
    END IF;

    IF v_notification_id IS NOT NULL THEN
      UPDATE public.waitlist_entries
         SET status = 'invited',
             invited_at = now(),
             notified_at = now(),
             notification_id = v_notification_id
       WHERE id = v_entry.id;
      v_running := v_running + v_entry.qty_requested;
    END IF;
  END LOOP;

  RETURN v_running;
END;
$function$;

COMMENT ON FUNCTION public.issue_2947_waitlist_drain_for_ticket_type(uuid, integer) IS
  '#2947/#4063: FIFO waitlist drain. messages_v2 emits independent email and normalized SMS rows with canonical occurrence facts; switch-off preserves the original one-row producer.';

REVOKE ALL ON FUNCTION public.issue_2947_waitlist_drain_for_ticket_type(uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_2947_waitlist_drain_for_ticket_type(uuid, integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.fn_rsvp_drain_on_capacity_freed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_event_id uuid;
  v_capacity integer;
  v_approval_mode text;
  v_event_type text;
  v_confirmed integer;
  v_free integer;
  v_entry record;
  v_has_queue boolean;
  v_v2 boolean := public.issue_4063_switch_on('messages_v2');
BEGIN
  IF TG_TABLE_NAME = 'events' THEN
    v_event_id := NEW.id;
  ELSE
    v_event_id := NEW.event_id;
  END IF;

  SELECT event.event_type, event.rsvp_capacity, event.rsvp_approval_mode
    INTO v_event_type, v_capacity, v_approval_mode
    FROM public.events AS event
   WHERE event.id = v_event_id;

  IF v_event_type IS DISTINCT FROM 'rsvp' THEN RETURN NEW; END IF;
  IF v_capacity IS NULL THEN RETURN NEW; END IF;

  SELECT coalesce(sum(1 + rsvp.plus_count), 0)
    INTO v_confirmed
    FROM public.event_rsvps AS rsvp
   WHERE rsvp.event_id = v_event_id
     AND rsvp.rsvp_status = 'going'
     AND rsvp.approval_status = 'approved';

  v_free := v_capacity - v_confirmed;
  IF v_free <= 0 THEN RETURN NEW; END IF;

  SELECT EXISTS (
    SELECT 1
      FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name = 'rsvp_notifications'
  ) INTO v_has_queue;

  FOR v_entry IN
    SELECT rsvp.id, rsvp.plus_count, rsvp.user_id
      FROM public.event_rsvps AS rsvp
     WHERE rsvp.event_id = v_event_id
       AND rsvp.rsvp_status = 'waitlisted'
     ORDER BY rsvp.waitlisted_at ASC NULLS FIRST, rsvp.created_at ASC
  LOOP
    EXIT WHEN v_free <= 0;

    IF v_approval_mode = 'manual' THEN
      UPDATE public.event_rsvps
         SET rsvp_status = 'going',
             approval_status = 'pending',
             promoted_at = now()
       WHERE id = v_entry.id;
    ELSE
      IF (1 + v_entry.plus_count) > v_free THEN
        EXIT;
      END IF;
      UPDATE public.event_rsvps
         SET rsvp_status = 'going',
             approval_status = 'approved',
             promoted_at = now()
       WHERE id = v_entry.id;
      v_free := v_free - (1 + v_entry.plus_count);
    END IF;

    IF v_v2 THEN
      IF v_approval_mode <> 'manual' THEN
        -- The shared routine is fail-safe when no pepper is available: it
        -- sends an existing pass or leaves QR-less recipients to the backfill.
        PERFORM public.enqueue_rsvp_pass(v_entry.id, NULL);
      END IF;
    ELSIF v_has_queue THEN
      -- Preserve the exact legacy template, payload and key while switched off.
      INSERT INTO public.rsvp_notifications
        (event_id, rsvp_id, channel, recipient, status, template_key, payload,
         idempotency_key, attempt_count)
      VALUES
        (v_event_id, v_entry.id, NULL, NULL, 'pending', 'rsvp_waitlist_promoted',
         jsonb_build_object('template_key', 'rsvp_waitlist_promoted',
                            'rsvp_id', v_entry.id, 'event_id', v_event_id),
         'rsvp_promote:' || v_entry.id::text || ':' || extract(epoch FROM now())::bigint::text,
         0)
      ON CONFLICT (idempotency_key) DO NOTHING;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.fn_rsvp_drain_on_capacity_freed() IS
  '#1150/#4063: deterministic RSVP capacity drain. messages_v2 sends the canonical pass only after auto approval and keeps manual promotions silent until host approval; switch-off preserves the legacy promotion notice.';

REVOKE ALL ON FUNCTION public.fn_rsvp_drain_on_capacity_freed()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_rsvp_drain_on_capacity_freed()
  TO service_role;

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

DO $reschedule$
BEGIN
  PERFORM cron.unschedule(job.jobid)
    FROM cron.job AS job
   WHERE job.jobname = 'orch_1161_notify_reminders';
END;
$reschedule$;

SELECT cron.schedule(
  'orch_1161_notify_reminders',
  '*/5 * * * *',
  $cron$
    SELECT net.http_post(
      url := (
        SELECT decrypted_secret
          FROM vault.decrypted_secrets
         WHERE name = 'supabase_url'
         LIMIT 1
      ) || '/functions/v1/notify-reminders',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || (
          SELECT decrypted_secret
            FROM vault.decrypted_secrets
           WHERE name = 'service_role_key'
           LIMIT 1
        )
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 30000
    );
  $cron$
);

-- MINGLA-INVARIANT: I-4063-OLD-SENDERS-NEVER-SEE-NEW-ROWS | issue #4063 | New message rows are emitted only after the service-role messages_v2 switch is enabled.
-- MINGLA-INVARIANT: I-4063-RECEIPT-NEVER-BLOCKS-PAYMENT | issue #4063 | Food-receipt enqueue failures are warning-only and cannot roll back a venue payment write.
-- MINGLA-INVARIANT: I-4063-REMINDERS-ONE-PER-BOUGHT-DATE | issue #4063 | Reminder windows run every five minutes, select only still-valid purchased dates, and remain idempotent per order, occurrence and lead bucket.
-- MINGLA-INVARIANT: I-4063-WAITLIST-ONE-ROW-PER-CONTACT | issue #4063 | With messages_v2 enabled, waitlist invitations enqueue independent email and normalized SMS rows while invalid phones remain silent.
-- MINGLA-INVARIANT: I-4063-RSVP-PROMOTION-AFTER-APPROVAL | issue #4063 | With messages_v2 enabled, auto promotions enqueue the canonical pass and manual promotions remain silent until host approval.

DO $exit_check$
DECLARE
  v_definition text;
  v_schedule text;
BEGIN
  SELECT pg_get_functiondef(
    'public.pg_notify_reminders_enqueue(int, text, int)'::regprocedure
  ) INTO v_definition;

  IF v_definition NOT LIKE '%interval ''7 minutes''%'
     OR v_definition NOT LIKE '%interval ''3 minutes''%'
     OR v_definition NOT LIKE '%ticket_event_dates%'
     OR v_definition NOT LIKE '%o.booked_start_at%'
     OR v_definition NOT LIKE '%partial_refund%'
     OR v_definition NOT LIKE '%buyer_event_reminder:%booked%'
     OR v_definition NOT LIKE '%mingla_e164_country(u.contact)%' THEN
    RAISE EXCEPTION 'issue_4063_exit_check_reminder_definition_incomplete';
  END IF;

  SELECT pg_get_functiondef(
    'public.issue_2947_waitlist_drain_for_ticket_type(uuid, integer)'::regprocedure
  ) INTO v_definition;
  IF v_definition NOT LIKE '%issue_4063_switch_on%'
     OR v_definition NOT LIKE '%mingla_e164_normalize%'
     OR v_definition NOT LIKE '%:email%'
     OR v_definition NOT LIKE '%:sms%'
     OR v_definition NOT LIKE '%event_date_id%'
     OR v_definition NOT LIKE '%start_at%' THEN
    RAISE EXCEPTION 'issue_4063_exit_check_waitlist_definition_incomplete';
  END IF;

  SELECT pg_get_functiondef(
    'public.fn_rsvp_drain_on_capacity_freed()'::regprocedure
  ) INTO v_definition;
  IF v_definition NOT LIKE '%issue_4063_switch_on%'
     OR v_definition NOT LIKE '%enqueue_rsvp_pass(v_entry.id, NULL)%'
     OR v_definition NOT LIKE '%v_approval_mode <> ''manual''%'
     OR v_definition NOT LIKE '%rsvp_waitlist_promoted%' THEN
    RAISE EXCEPTION 'issue_4063_exit_check_rsvp_promotion_definition_incomplete';
  END IF;

  SELECT schedule INTO v_schedule
    FROM cron.job
   WHERE jobname = 'orch_1161_notify_reminders'
   LIMIT 1;
  IF v_schedule IS DISTINCT FROM '*/5 * * * *' THEN
    RAISE EXCEPTION 'issue_4063_exit_check_reminder_cron_%', v_schedule;
  END IF;
END;
$exit_check$;

COMMIT;
NOTIFY pgrst, 'reload schema';
