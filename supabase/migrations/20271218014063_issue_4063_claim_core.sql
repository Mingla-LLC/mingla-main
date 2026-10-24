BEGIN;
SET LOCAL lock_timeout = '10s';

-- #4063 Wave 1: one contact authority, server-owned attachment and claim arming.
CREATE TABLE IF NOT EXISTS public.account_claim_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('email','phone')),
  value text NOT NULL,
  verified_at timestamptz NOT NULL DEFAULT now(),
  verified_via text NOT NULL CHECK (verified_via IN ('email_code','twilio_verify')),
  revoked_at timestamptz NULL,
  CONSTRAINT account_claim_contacts_value_shape CHECK (
    (channel = 'email' AND value = lower(btrim(value))
      AND value ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
    OR (channel = 'phone' AND value ~ '^\+[1-9][0-9]{1,14}$')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS account_claim_contacts_one_live_owner
  ON public.account_claim_contacts (channel, value)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS account_claim_contacts_user_live
  ON public.account_claim_contacts (user_id)
  WHERE revoked_at IS NULL;

ALTER TABLE public.account_claim_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_claim_contacts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.account_claim_contacts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.account_claim_contacts
  TO service_role;

COMMENT ON TABLE public.account_claim_contacts IS
  '#4063 decision 2: extra emails/phones proved by a code, used ONLY to claim tickets. Never read by verified_account_identifiers. Inserted/revoked by issue_4063_record_claim_contact; revoked (phone) by record_verified_phone.';

CREATE OR REPLACE FUNCTION public.account_owns_contact(
  p_user_id uuid,
  p_email text,
  p_phone_e164 text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_email text;
  v_phone text;
  v_proved boolean := false;
  v_number_expr text;
BEGIN
  IF p_user_id IS NULL THEN RETURN false; END IF;

  v_email := lower(btrim(coalesce(p_email, '')));
  v_phone := btrim(coalesce(p_phone_e164, ''));
  IF v_email = '' AND v_phone = '' THEN RETURN false; END IF;

  -- Extra contacts are possession proofs created only after the matching
  -- email-code or Twilio challenge has settled successfully.
  IF EXISTS (
    SELECT 1
      FROM public.account_claim_contacts c
     WHERE c.user_id = p_user_id
       AND c.revoked_at IS NULL
       AND ((c.channel = 'email' AND c.value = v_email)
         OR (c.channel = 'phone' AND c.value = v_phone))
  ) THEN
    RETURN true;
  END IF;

  -- PHONE ARM — EITHER OF TWO PROOFS, and both are a code received at that
  -- number. See #3524/#4063 for why the GoTrue arm is a proof on this project.
  IF v_phone ~ '^\+[1-9][0-9]{1,14}$' THEN
    IF EXISTS (
      SELECT 1 FROM public.verified_phone_identities v
       WHERE v.user_id = p_user_id AND v.phone_e164 = v_phone
    ) THEN
      RETURN true;
    END IF;
    IF to_regclass('auth.identities') IS NOT NULL THEN
      v_number_expr := CASE
        WHEN EXISTS (
          SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'auth' AND table_name = 'users'
             AND column_name = 'phone'
        ) THEN 'coalesce(i.identity_data->>''phone'', u.phone)'
        ELSE 'i.identity_data->>''phone'''
      END;
      EXECUTE format($ev$
        SELECT EXISTS (
          SELECT 1
            FROM auth.identities i
            JOIN auth.users u ON u.id = i.user_id
           WHERE i.user_id = $1
             AND i.provider = 'phone'
             AND %1$s ~ '^[+]?[1-9][0-9]{1,14}$'
             AND '+' || regexp_replace(%1$s, '[^0-9]', '', 'g') = $2
        )
      $ev$, v_number_expr) INTO v_proved USING p_user_id, v_phone;
      IF v_proved THEN RETURN true; END IF;
      v_proved := false;
    END IF;
  END IF;

  IF v_email = '' THEN RETURN false; END IF;
  IF to_regclass('auth.identities') IS NULL THEN RETURN false; END IF;

  -- EMAIL ARM (a) — a provider asserted the address.
  EXECUTE $ev$
    SELECT EXISTS (
      SELECT 1 FROM auth.identities i
       WHERE i.user_id = $1
         AND lower(btrim(coalesce(i.identity_data->>'email', ''))) = $2
         AND lower(coalesce(i.identity_data->>'email_verified', '')) IN ('true', 't')
    )
  $ev$ INTO v_proved USING p_user_id, v_email;
  IF v_proved THEN RETURN true; END IF;

  -- EMAIL ARM (b) — a code or link was read out of this mailbox.
  IF to_regclass('auth.mfa_amr_claims') IS NULL
     OR to_regclass('auth.sessions') IS NULL THEN
    RETURN false;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'auth' AND table_name = 'sessions'
       AND column_name = 'created_at'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'auth' AND table_name = 'identities'
       AND column_name = 'updated_at'
  ) THEN
    RETURN false;
  END IF;
  EXECUTE $ev$
    SELECT EXISTS (
      SELECT 1
        FROM auth.identities i
        JOIN auth.users u ON u.id = i.user_id
       WHERE i.user_id = $1
         AND i.provider = 'email'
         AND lower(btrim(coalesce(i.identity_data->>'email', ''))) = $2
         AND lower(btrim(coalesce(u.email, ''))) = $2
         AND EXISTS (
           SELECT 1
             FROM auth.mfa_amr_claims a
             JOIN auth.sessions s ON s.id = a.session_id
            WHERE s.user_id = $1
              AND a.authentication_method IN ('otp', 'magiclink', 'recovery')
              AND s.created_at >= i.updated_at
         )
    )
  $ev$ INTO v_proved USING p_user_id, v_email;
  RETURN coalesce(v_proved, false);
END;
$function$;

COMMENT ON FUNCTION public.account_owns_contact(uuid, text, text) IS
  '#4063: THE single ownership predicate for orders, RSVPs, plus-ones, reservations and stays. account_owns_order_contact delegates here. No other function may re-express this rule.';
REVOKE ALL ON FUNCTION public.account_owns_contact(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.account_owns_contact(uuid, text, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.record_verified_phone(
  p_user_id uuid,
  p_phone text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_phone text;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('result', 'invalid');
  END IF;

  v_phone := '+' || regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  IF v_phone !~ '^\+[1-9][0-9]{1,14}$' THEN
    RETURN jsonb_build_object('result', 'invalid');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p_user_id) THEN
    RETURN jsonb_build_object('result', 'unknown_user');
  END IF;

  DELETE FROM public.verified_phone_identities
   WHERE phone_e164 = v_phone AND user_id <> p_user_id;

  UPDATE public.account_claim_contacts
     SET revoked_at = now()
   WHERE channel = 'phone'
     AND value = v_phone
     AND user_id <> p_user_id
     AND revoked_at IS NULL;

  INSERT INTO public.verified_phone_identities AS v (
    user_id, phone_e164, verified_at
  ) VALUES (
    p_user_id, v_phone, now()
  )
  ON CONFLICT (user_id) DO UPDATE
    SET phone_e164 = EXCLUDED.phone_e164,
        verified_at = EXCLUDED.verified_at;

  RETURN jsonb_build_object('result', 'recorded', 'phone', v_phone);
END;
$function$;

COMMENT ON FUNCTION public.record_verified_phone(uuid, text) IS
  '#2269 + #4063: records a Twilio-approved number as an account possession proof and revokes another account''s extra-contact proof for that number. Service role only.';
REVOKE ALL ON FUNCTION public.record_verified_phone(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_verified_phone(uuid, text)
  TO service_role;

CREATE INDEX IF NOT EXISTS orders_4063_unowned_email_idx
  ON public.orders (lower(btrim(buyer_email))) WHERE buyer_user_id IS NULL;
CREATE INDEX IF NOT EXISTS orders_4063_unowned_phone_idx
  ON public.orders (buyer_phone_e164) WHERE buyer_user_id IS NULL;
CREATE INDEX IF NOT EXISTS event_rsvps_4063_unowned_email_idx
  ON public.event_rsvps (lower(btrim(guest_email))) WHERE user_id IS NULL;
CREATE INDEX IF NOT EXISTS event_rsvps_4063_unowned_phone_idx
  ON public.event_rsvps (guest_phone) WHERE user_id IS NULL;
CREATE INDEX IF NOT EXISTS event_rsvp_guests_4063_unmatched_email
  ON public.event_rsvp_guests (lower(btrim(email))) WHERE matched_user_id IS NULL;
CREATE INDEX IF NOT EXISTS event_rsvp_guests_4063_unmatched_phone
  ON public.event_rsvp_guests (phone) WHERE matched_user_id IS NULL;
CREATE INDEX IF NOT EXISTS reservations_4063_unowned_email_idx
  ON public.reservations (lower(btrim(guest_email))) WHERE consumer_user_id IS NULL;
CREATE INDEX IF NOT EXISTS reservations_4063_unowned_phone_idx
  ON public.reservations (guest_phone_e164) WHERE consumer_user_id IS NULL;
CREATE INDEX IF NOT EXISTS venue_orders_4063_unowned_email_idx
  ON public.venue_orders (lower(btrim(buyer_email))) WHERE buyer_user_id IS NULL;
CREATE INDEX IF NOT EXISTS venue_orders_4063_unowned_phone_idx
  ON public.venue_orders (buyer_phone_e164) WHERE buyer_user_id IS NULL;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS purchased_by_user_id uuid NULL
    REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS booked_by_user_id uuid NULL
    REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.stay_reservation_groups
  ADD COLUMN IF NOT EXISTS booked_by_user_id uuid NULL
    REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.orders.purchased_by_user_id IS
  '#4063: the signed-in account that paid when that account did not own the purchase contact.';
COMMENT ON COLUMN public.reservations.booked_by_user_id IS
  '#4063: the signed-in account that booked when that account did not own the guest contact.';
COMMENT ON COLUMN public.stay_reservation_groups.booked_by_user_id IS
  '#4063: the signed-in account that booked when that account did not own the guest contact.';

CREATE OR REPLACE FUNCTION public.tg_orders_4063_owner_and_arm()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.buyer_user_id IS NOT NULL
     AND NOT public.account_owns_contact(
       NEW.buyer_user_id, NEW.buyer_email, NEW.buyer_phone_e164
     ) THEN
    NEW.purchased_by_user_id := NEW.buyer_user_id;
    NEW.buyer_user_id := NULL;
  ELSIF TG_OP = 'UPDATE'
     AND NEW.buyer_user_id IS NOT NULL
     AND NEW.buyer_user_id IS DISTINCT FROM OLD.buyer_user_id
     AND NOT public.account_owns_contact(
       NEW.buyer_user_id, NEW.buyer_email, NEW.buyer_phone_e164
     ) THEN
    RAISE EXCEPTION 'order_owner_must_own_contact' USING ERRCODE = '42501';
  END IF;

  IF NEW.buyer_user_id IS NULL
     AND NEW.attendance_identity_claim_armed_at IS NULL
     AND NEW.payment_status IN ('paid', 'partial_refund')
     AND (btrim(coalesce(NEW.buyer_email, '')) <> ''
       OR coalesce(NEW.buyer_phone_e164, '') ~ '^\+[1-9][0-9]{1,14}$') THEN
    NEW.attendance_identity_claim_armed_at := now();
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.tg_orders_4063_owner_and_arm()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tg_orders_4063_owner_and_arm()
  TO service_role;
DROP TRIGGER IF EXISTS trg_orders_a4063_owner_and_arm ON public.orders;
CREATE TRIGGER trg_orders_a4063_owner_and_arm
BEFORE INSERT OR UPDATE OF buyer_user_id, payment_status, buyer_email, buyer_phone_e164
ON public.orders FOR EACH ROW
EXECUTE FUNCTION public.tg_orders_4063_owner_and_arm();

COMMENT ON COLUMN public.orders.attendance_identity_claim_armed_at IS
  '#4063: set by the server (trg_orders_a4063_owner_and_arm) when a guest order is paid and carries an email or phone. The claim itself requires account_owns_contact. arm_order_identity_attendance_claim remains as an idempotent no-op path for the confirm screen.';

CREATE OR REPLACE FUNCTION public.add_buyer_to_event_chat(
  p_event_id uuid,
  p_buyer_user_id uuid,
  p_order_id uuid,
  p_buyer_email text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_conv_id uuid;
  v_claim_token text;
  v_user uuid;
BEGIN
  SELECT id INTO v_conv_id
    FROM public.conversations
   WHERE event_id = p_event_id
     AND linked_entity_type IN ('trip', 'event')
   LIMIT 1;

  IF v_conv_id IS NULL THEN
    INSERT INTO public.conversations (
      type, linked_entity_type, event_id, name, is_enabled, is_broadcast_only
    )
    SELECT
      'group',
      CASE e.event_type WHEN 'trip' THEN 'trip' ELSE 'event' END,
      e.id,
      COALESCE(NULLIF(trim(e.title), ''), 'Trip chat'),
      true,
      false
    FROM public.events e
    WHERE e.id = p_event_id
      AND e.event_type IN ('event', 'trip')
    ON CONFLICT (event_id) WHERE event_id IS NOT NULL DO NOTHING
    RETURNING id INTO v_conv_id;

    IF v_conv_id IS NULL THEN
      SELECT id INTO v_conv_id
        FROM public.conversations
       WHERE event_id = p_event_id
         AND linked_entity_type IN ('trip', 'event')
       LIMIT 1;
    END IF;
  END IF;

  IF v_conv_id IS NULL THEN RETURN; END IF;

  IF p_order_id IS NOT NULL THEN
    SELECT buyer_user_id INTO v_user
      FROM public.orders
     WHERE id = p_order_id;
    IF NOT FOUND THEN v_user := p_buyer_user_id; END IF;
  ELSE
    v_user := p_buyer_user_id;
  END IF;

  IF v_user IS NOT NULL THEN
    INSERT INTO public.conversation_participants (conversation_id, user_id)
    VALUES (v_conv_id, v_user)
    ON CONFLICT (conversation_id, user_id) DO NOTHING;
    RETURN;
  END IF;

  IF p_buyer_email IS NOT NULL AND length(trim(p_buyer_email)) > 0 THEN
    v_claim_token := translate(
      encode(extensions.gen_random_bytes(24), 'base64'), '+/', '-_'
    );
    INSERT INTO public.pending_trip_chat_claims (
      order_id, event_id, buyer_email, claim_token
    ) VALUES (
      p_order_id, p_event_id, lower(trim(p_buyer_email)), v_claim_token
    )
    ON CONFLICT (order_id) WHERE claimed_at IS NULL DO NOTHING;
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.add_buyer_to_event_chat(uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_buyer_to_event_chat(uuid, uuid, uuid, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.arm_order_identity_attendance_claim(
  p_order_id uuid,
  p_event_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_order public.orders%ROWTYPE;
  v_event public.events%ROWTYPE;
BEGIN
  IF p_order_id IS NULL OR p_event_id IS NULL THEN
    RETURN jsonb_build_object('result', 'invalid');
  END IF;

  SELECT o.* INTO v_order FROM public.orders o
   WHERE o.id = p_order_id AND o.event_id = p_event_id FOR UPDATE;
  IF NOT FOUND OR v_order.buyer_user_id IS NOT NULL THEN
    RETURN jsonb_build_object('result', 'ineligible');
  END IF;

  SELECT e.* INTO v_event FROM public.events e
    JOIN public.brands b ON b.id = e.brand_id
   WHERE e.id = p_event_id
     AND e.event_type IN ('event', 'trip', 'experience')
     AND e.deleted_at IS NULL
     AND b.deleted_at IS NULL
     AND e.status IN ('scheduled', 'live');
  IF NOT FOUND
     OR v_order.payment_status NOT IN ('paid', 'partial_refund')
     OR NOT EXISTS (
       SELECT 1 FROM public.tickets t
        WHERE t.order_id = v_order.id
          AND t.approval_status IN ('auto', 'approved')
          AND t.status IN ('valid', 'used')
     ) THEN
    RETURN jsonb_build_object('result', 'ineligible');
  END IF;

  IF btrim(coalesce(v_order.buyer_email, '')) = ''
     AND coalesce(v_order.buyer_phone_e164, '') !~ '^\+[1-9][0-9]{1,14}$' THEN
    RETURN jsonb_build_object('result', 'ineligible');
  END IF;

  IF v_order.attendance_identity_claim_armed_at IS NOT NULL THEN
    RETURN jsonb_build_object('result', 'already_armed');
  END IF;

  UPDATE public.orders
     SET attendance_identity_claim_armed_at = now()
   WHERE id = v_order.id;
  RETURN jsonb_build_object('result', 'armed');
END;
$function$;

REVOKE ALL ON FUNCTION public.arm_order_identity_attendance_claim(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.arm_order_identity_attendance_claim(uuid, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.tg_reservations_4063_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.created_via = 'consumer'
     AND NEW.consumer_user_id IS NOT NULL
     AND NOT public.account_owns_contact(
       NEW.consumer_user_id, NEW.guest_email, NEW.guest_phone_e164
     ) THEN
    NEW.booked_by_user_id := NEW.consumer_user_id;
    NEW.consumer_user_id := NULL;
  ELSIF TG_OP = 'UPDATE'
     AND NEW.consumer_user_id IS NOT NULL
     AND NEW.consumer_user_id IS DISTINCT FROM OLD.consumer_user_id
     AND NOT public.account_owns_contact(
       NEW.consumer_user_id, NEW.guest_email, NEW.guest_phone_e164
     ) THEN
    RAISE EXCEPTION 'reservation_owner_must_own_contact' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.tg_reservations_4063_owner()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tg_reservations_4063_owner() TO service_role;
DROP TRIGGER IF EXISTS trg_reservations_a4063_owner ON public.reservations;
CREATE TRIGGER trg_reservations_a4063_owner
BEFORE INSERT OR UPDATE OF consumer_user_id ON public.reservations
FOR EACH ROW EXECUTE FUNCTION public.tg_reservations_4063_owner();

CREATE OR REPLACE FUNCTION public.tg_stay_groups_4063_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.user_id IS NOT NULL
     AND NOT public.account_owns_contact(
       NEW.user_id, NEW.guest_snapshot->>'email', NEW.guest_snapshot->>'phone'
     ) THEN
    NEW.booked_by_user_id := NEW.user_id;
    NEW.user_id := NULL;
  ELSIF TG_OP = 'UPDATE'
     AND NEW.user_id IS NOT NULL
     AND NEW.user_id IS DISTINCT FROM OLD.user_id
     AND NOT public.account_owns_contact(
       NEW.user_id, NEW.guest_snapshot->>'email', NEW.guest_snapshot->>'phone'
     ) THEN
    RAISE EXCEPTION 'stay_owner_must_own_contact' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.tg_stay_groups_4063_owner()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tg_stay_groups_4063_owner() TO service_role;
DROP TRIGGER IF EXISTS trg_stay_groups_a4063_owner
  ON public.stay_reservation_groups;
CREATE TRIGGER trg_stay_groups_a4063_owner
BEFORE INSERT OR UPDATE OF user_id ON public.stay_reservation_groups
FOR EACH ROW EXECUTE FUNCTION public.tg_stay_groups_4063_owner();

CREATE OR REPLACE FUNCTION public.claim_attendance_by_verified_identity(
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_emails text[];
  v_phones text[];
  v_row record;
  v_claimed jsonb := '[]'::jsonb;
  v_conv uuid;
  v_more boolean := false;
  v_pass_count integer;
BEGIN
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'invalid_claim'; END IF;

  SELECT
    coalesce(array_agg(DISTINCT value) FILTER (WHERE kind = 'email'), '{}'::text[]),
    coalesce(array_agg(DISTINCT value) FILTER (WHERE kind = 'phone'), '{}'::text[])
    INTO v_emails, v_phones
    FROM (
      SELECT kind, value
        FROM public.verified_account_identifiers(p_user_id)
      UNION
      SELECT 'phone'::text, phone_e164
        FROM public.verified_phone_identities
       WHERE user_id = p_user_id
      UNION
      SELECT channel, value
        FROM public.account_claim_contacts
       WHERE user_id = p_user_id AND revoked_at IS NULL
    ) identifiers;

  IF coalesce(array_length(v_emails, 1), 0) = 0
     AND coalesce(array_length(v_phones, 1), 0) = 0 THEN
    RETURN jsonb_build_object(
      'claimed', v_claimed, 'count', 0, 'more', false
    );
  END IF;

  -- Orders, including used door receipts on recently ended events.
  v_pass_count := 0;
  FOR v_row IN
    SELECT o.id, o.event_id, o.source, e.event_type, e.title,
           coalesce(o.booked_start_at, chosen.start_at, master.start_at) AS starts_at,
           coalesce(chosen.timezone, master.timezone, e.timezone) AS timezone,
           (SELECT count(*)::integer FROM public.tickets t
             WHERE t.order_id = o.id AND t.status IN ('valid', 'used')) AS quantity
      FROM public.orders o
      JOIN public.events e ON e.id = o.event_id
      JOIN public.brands b ON b.id = e.brand_id
      LEFT JOIN public.event_dates chosen ON chosen.id = o.event_date_id
      LEFT JOIN LATERAL (
        SELECT d.start_at, d.timezone
          FROM public.event_dates d
         WHERE d.event_id = e.id AND d.is_master IS TRUE
         ORDER BY d.start_at, d.id LIMIT 1
      ) master ON true
     WHERE o.buyer_user_id IS NULL
       AND o.attendance_identity_claim_armed_at IS NOT NULL
       AND (lower(btrim(o.buyer_email)) = ANY(v_emails)
         OR o.buyer_phone_e164 = ANY(v_phones))
       AND public.account_owns_contact(
         p_user_id, o.buyer_email, o.buyer_phone_e164
       )
       AND o.payment_status IN ('paid', 'partial_refund')
       AND e.event_type IN ('event', 'trip', 'experience')
       AND e.deleted_at IS NULL AND b.deleted_at IS NULL
       AND (
         (o.source = 'door_sale'
           AND e.status IN ('scheduled', 'live', 'ended')
           AND o.created_at >= now() - interval '30 days')
         OR
         (o.source IS DISTINCT FROM 'door_sale'
           AND e.status IN ('scheduled', 'live')
           AND EXISTS (
             SELECT 1 FROM public.tickets t
              WHERE t.order_id = o.id
                AND t.approval_status IN ('auto', 'approved')
                AND ((e.status = 'scheduled' AND t.status = 'valid')
                  OR (e.status = 'live' AND t.status IN ('valid', 'used')))
           ))
       )
     ORDER BY o.created_at, o.id
     LIMIT 25
     FOR UPDATE OF o SKIP LOCKED
  LOOP
    UPDATE public.orders o
       SET buyer_user_id = p_user_id,
           attendance_claim_token_digest = NULL,
           attendance_claim_token_generation = NULL,
           attendance_claim_legacy_token_digest = NULL,
           attendance_claim_legacy_token_created_at = NULL,
           attendance_claim_token_consumed_at = CASE
             WHEN o.attendance_claim_token_created_at IS NOT NULL
               THEN coalesce(o.attendance_claim_token_consumed_at, now())
             ELSE o.attendance_claim_token_consumed_at END
     WHERE o.id = v_row.id AND o.buyer_user_id IS NULL;
    IF NOT FOUND THEN CONTINUE; END IF;
    v_pass_count := v_pass_count + 1;

    UPDATE public.attendance_claim_recovery_items
       SET state = 'claimed', resolved_via = 'verified_identity',
           reconciled_at = now(), updated_at = now()
     WHERE order_id = v_row.id;
    UPDATE public.attendance_claim_deliveries
       SET status = 'failed_terminal', next_attempt_at = NULL,
           lease_id = NULL, lease_expires_at = NULL,
           provider_attempt_started_at = NULL,
           last_error_code = 'claim_resolved', updated_at = now()
     WHERE source_id = v_row.id
       AND kind IN ('order_recovery_email', 'order_recovery_sms')
       AND status IN ('pending', 'processing', 'failed_retryable');
    PERFORM public.add_buyer_to_event_chat(
      v_row.event_id, p_user_id, v_row.id, NULL
    );
    UPDATE public.pending_trip_chat_claims
       SET claimed_at = now(), claimed_by_user_id = p_user_id
     WHERE order_id = v_row.id AND claimed_at IS NULL;

    v_conv := NULL;
    SELECT c.id INTO v_conv
      FROM public.conversations c
      JOIN public.conversation_participants cp
        ON cp.conversation_id = c.id AND cp.user_id = p_user_id
     WHERE c.event_id = v_row.event_id
       AND c.linked_entity_type IN ('trip', 'event')
     LIMIT 1;

    v_claimed := v_claimed || jsonb_build_array(jsonb_build_object(
      'kind', 'order', 'id', v_row.id,
      'orderId', v_row.id, 'eventId', v_row.event_id,
      'routeKind', 'order', 'routeId', v_row.id,
      'offeringType', v_row.event_type,
      'noun', CASE
        WHEN v_row.source = 'door_sale' THEN 'receipt'
        WHEN v_row.event_type = 'event' THEN 'ticket'
        ELSE 'booking' END,
      'title', v_row.title, 'orderLabel', NULL,
      'startsAt', v_row.starts_at, 'timezone', v_row.timezone,
      'venueLine', NULL, 'quantity', v_row.quantity,
      'source', CASE
        WHEN v_row.source IN ('comp', 'door_sale') THEN 'door'
        ELSE 'purchase' END,
      'sentByFirstName', NULL,
      'chatJoined', v_conv IS NOT NULL, 'conversationId', v_conv
    ));
  END LOOP;
  v_more := v_more OR v_pass_count = 25;

  -- Anonymous RSVP primaries.
  v_pass_count := 0;
  FOR v_row IN
    SELECT r.id, r.event_id, e.title, 1 + coalesce(r.plus_count, 0) AS quantity,
           master.start_at, coalesce(master.timezone, e.timezone) AS timezone
      FROM public.event_rsvps r
      JOIN public.events e ON e.id = r.event_id
      JOIN public.brands b ON b.id = e.brand_id
      LEFT JOIN LATERAL (
        SELECT d.start_at, d.timezone
          FROM public.event_dates d
         WHERE d.event_id = e.id AND d.is_master IS TRUE
         ORDER BY d.start_at, d.id LIMIT 1
      ) master ON true
     WHERE r.user_id IS NULL
       AND (lower(btrim(r.guest_email)) = ANY(v_emails)
         OR r.guest_phone = ANY(v_phones))
       AND public.account_owns_contact(
         p_user_id, r.guest_email, r.guest_phone
       )
       AND e.event_type = 'rsvp' AND e.deleted_at IS NULL
       AND b.deleted_at IS NULL AND e.status IN ('scheduled', 'live')
       AND r.rsvp_status <> 'not_going'
       AND r.approval_status <> 'denied'
       AND NOT EXISTS (
         SELECT 1 FROM public.event_rsvps x
          WHERE x.event_id = r.event_id AND x.user_id = p_user_id
       )
     ORDER BY r.created_at, r.id
     LIMIT 25
     FOR UPDATE OF r SKIP LOCKED
  LOOP
    UPDATE public.event_rsvps
       SET user_id = p_user_id
     WHERE id = v_row.id AND user_id IS NULL;
    IF NOT FOUND THEN CONTINUE; END IF;
    v_pass_count := v_pass_count + 1;
    v_claimed := v_claimed || jsonb_build_array(jsonb_build_object(
      'kind', 'rsvp', 'id', v_row.id,
      'routeKind', 'rsvp', 'routeId', v_row.id,
      'offeringType', 'rsvp', 'noun', 'pass',
      'title', v_row.title, 'orderLabel', NULL,
      'startsAt', v_row.start_at, 'timezone', v_row.timezone,
      'venueLine', NULL, 'quantity', v_row.quantity,
      'source', 'rsvp', 'sentByFirstName', NULL,
      'chatJoined', NULL, 'conversationId', NULL
    ));
  END LOOP;
  v_more := v_more OR v_pass_count = 25;

  -- RSVP plus-ones that did not have an account at RSVP time.
  v_pass_count := 0;
  FOR v_row IN
    SELECT g.id, g.rsvp_id, r.event_id, e.title, master.start_at,
           coalesce(master.timezone, e.timezone) AS timezone
      FROM public.event_rsvp_guests g
      JOIN public.event_rsvps r ON r.id = g.rsvp_id
      JOIN public.events e ON e.id = r.event_id
      JOIN public.brands b ON b.id = e.brand_id
      LEFT JOIN LATERAL (
        SELECT d.start_at, d.timezone
          FROM public.event_dates d
         WHERE d.event_id = e.id AND d.is_master IS TRUE
         ORDER BY d.start_at, d.id LIMIT 1
      ) master ON true
     WHERE g.matched_user_id IS NULL
       AND (lower(btrim(g.email)) = ANY(v_emails) OR g.phone = ANY(v_phones))
       AND public.account_owns_contact(p_user_id, g.email, g.phone)
       AND e.event_type = 'rsvp' AND e.deleted_at IS NULL
       AND b.deleted_at IS NULL AND e.status IN ('scheduled', 'live')
       AND r.rsvp_status <> 'not_going' AND r.approval_status <> 'denied'
       AND r.user_id IS DISTINCT FROM p_user_id
       AND NOT EXISTS (
         SELECT 1 FROM public.event_rsvps owned
          WHERE owned.event_id = r.event_id AND owned.user_id = p_user_id
       )
       AND NOT EXISTS (
         SELECT 1
           FROM public.event_rsvp_guests other
           JOIN public.event_rsvps other_rsvp ON other_rsvp.id = other.rsvp_id
          WHERE other_rsvp.event_id = r.event_id
            AND other.matched_user_id = p_user_id
       )
     ORDER BY g.created_at, g.id
     LIMIT 25
     FOR UPDATE OF g SKIP LOCKED
  LOOP
    UPDATE public.event_rsvp_guests
       SET matched_user_id = p_user_id
     WHERE id = v_row.id AND matched_user_id IS NULL;
    IF NOT FOUND THEN CONTINUE; END IF;
    v_pass_count := v_pass_count + 1;
    v_claimed := v_claimed || jsonb_build_array(jsonb_build_object(
      'kind', 'rsvp_guest', 'id', v_row.id,
      'routeKind', 'rsvp', 'routeId', v_row.rsvp_id,
      'offeringType', 'rsvp', 'noun', 'pass',
      'title', v_row.title, 'orderLabel', NULL,
      'startsAt', v_row.start_at, 'timezone', v_row.timezone,
      'venueLine', NULL, 'quantity', 1,
      'source', 'rsvp', 'sentByFirstName', NULL,
      'chatJoined', NULL, 'conversationId', NULL
    ));
  END LOOP;
  v_more := v_more OR v_pass_count = 25;

  -- Venue reservations.
  v_pass_count := 0;
  FOR v_row IN
    SELECT r.id, r.venue_id, r.reserved_for, r.party_size,
           vl.name AS title,
           CASE WHEN vac.iana_timezone_source = 'default' THEN NULL
             ELSE vac.iana_timezone END AS timezone
      FROM public.reservations r
      LEFT JOIN public.venue_listings vl ON vl.id = r.venue_id
      LEFT JOIN public.venue_availability_config vac ON vac.venue_id = r.venue_id
     WHERE r.consumer_user_id IS NULL
       AND (lower(btrim(r.guest_email)) = ANY(v_emails)
         OR r.guest_phone_e164 = ANY(v_phones))
       AND public.account_owns_contact(
         p_user_id, r.guest_email, r.guest_phone_e164
       )
       AND r.reserved_for >= now() - interval '30 days'
     ORDER BY r.reserved_for, r.id
     LIMIT 25
     FOR UPDATE OF r SKIP LOCKED
  LOOP
    UPDATE public.reservations
       SET consumer_user_id = p_user_id
     WHERE id = v_row.id AND consumer_user_id IS NULL;
    IF NOT FOUND THEN CONTINUE; END IF;
    v_pass_count := v_pass_count + 1;
    v_claimed := v_claimed || jsonb_build_array(jsonb_build_object(
      'kind', 'reservation', 'id', v_row.id,
      'routeKind', 'reservation', 'routeId', v_row.id,
      'offeringType', 'venue', 'noun', 'booking',
      'title', coalesce(v_row.title, 'Reservation'), 'orderLabel', NULL,
      'startsAt', v_row.reserved_for, 'timezone', v_row.timezone,
      'venueLine', v_row.title, 'quantity', v_row.party_size,
      'source', 'booking', 'sentByFirstName', NULL,
      'chatJoined', NULL, 'conversationId', NULL
    ));
  END LOOP;
  v_more := v_more OR v_pass_count = 25;

  -- Stay groups. These tables are intentionally small; the contact prefilter
  -- is still present so a future volume increase cannot turn this into a scan.
  v_pass_count := 0;
  FOR v_row IN
    SELECT g.id, g.venue_id, vl.name AS title
      FROM public.stay_reservation_groups g
      LEFT JOIN public.venue_listings vl ON vl.id = g.venue_id
     WHERE g.user_id IS NULL
       AND (lower(btrim(g.guest_snapshot->>'email')) = ANY(v_emails)
         OR g.guest_snapshot->>'phone' = ANY(v_phones))
       AND public.account_owns_contact(
         p_user_id, g.guest_snapshot->>'email', g.guest_snapshot->>'phone'
       )
     ORDER BY g.created_at, g.id
     LIMIT 25
     FOR UPDATE OF g SKIP LOCKED
  LOOP
    UPDATE public.stay_reservation_groups
       SET user_id = p_user_id, updated_at = now()
     WHERE id = v_row.id AND user_id IS NULL;
    IF NOT FOUND THEN CONTINUE; END IF;
    v_pass_count := v_pass_count + 1;
    v_claimed := v_claimed || jsonb_build_array(jsonb_build_object(
      'kind', 'stay_group', 'id', v_row.id,
      'routeKind', 'stay', 'routeId', v_row.id,
      'offeringType', 'stay', 'noun', 'booking',
      'title', coalesce(v_row.title, 'Stay'), 'orderLabel', NULL,
      'startsAt', NULL, 'timezone', NULL,
      'venueLine', v_row.title, 'quantity', NULL,
      'source', 'booking', 'sentByFirstName', NULL,
      'chatJoined', NULL, 'conversationId', NULL
    ));
  END LOOP;
  v_more := v_more OR v_pass_count = 25;

  -- Paid Mingla food and drink orders.
  v_pass_count := 0;
  FOR v_row IN
    SELECT vo.id, vo.venue_id, vo.created_at, vo.pickup_code,
           vl.name AS title,
           coalesce((SELECT sum(i.quantity)::integer
             FROM public.venue_order_items i
            WHERE i.venue_order_id = vo.id), 0) AS quantity
      FROM public.venue_orders vo
      JOIN public.venue_listings vl ON vl.id = vo.venue_id
     WHERE vo.buyer_user_id IS NULL
       AND vo.money_path = 'mingla'
       AND vo.payment_status IN ('paid', 'partial_refund', 'refunded')
       AND vo.created_at >= now() - interval '90 days'
       AND (lower(btrim(vo.buyer_email)) = ANY(v_emails)
         OR vo.buyer_phone_e164 = ANY(v_phones))
       AND public.account_owns_contact(
         p_user_id, vo.buyer_email, vo.buyer_phone_e164
       )
     ORDER BY vo.created_at, vo.id
     LIMIT 25
     FOR UPDATE OF vo SKIP LOCKED
  LOOP
    UPDATE public.venue_orders
       SET buyer_user_id = p_user_id
     WHERE id = v_row.id AND buyer_user_id IS NULL;
    IF NOT FOUND THEN CONTINUE; END IF;
    v_pass_count := v_pass_count + 1;
    v_claimed := v_claimed || jsonb_build_array(jsonb_build_object(
      'kind', 'venue_order', 'id', v_row.id,
      'routeKind', 'venue_order', 'routeId', v_row.id,
      'offeringType', 'food', 'noun', 'receipt',
      'title', v_row.title,
      'orderLabel', CASE WHEN btrim(coalesce(v_row.pickup_code, '')) <> ''
        THEN 'Order #' || v_row.pickup_code
        ELSE 'Order ' || upper(substr(replace(v_row.id::text, '-', ''), 1, 8))
        END,
      'startsAt', v_row.created_at, 'timezone', NULL,
      'venueLine', v_row.title, 'quantity', v_row.quantity,
      'source', 'food', 'sentByFirstName', NULL,
      'chatJoined', NULL, 'conversationId', NULL
    ));
  END LOOP;
  v_more := v_more OR v_pass_count = 25;

  RETURN jsonb_build_object(
    'claimed', v_claimed,
    'count', jsonb_array_length(v_claimed),
    'more', v_more
  );
END;
$function$;

COMMENT ON FUNCTION public.claim_attendance_by_verified_identity(uuid) IS
  '#2217 + #3524 + #4063: the identity rail for orders, RSVPs, plus-ones, reservations, stays and food orders. Takes NO identifier from the caller; every row is gated by account_owns_contact; any event visibility; safe to call repeatedly (SKIP LOCKED, unowned-guarded writes); returns only rows claimed by this call.';
REVOKE ALL ON FUNCTION public.claim_attendance_by_verified_identity(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_attendance_by_verified_identity(uuid)
  TO service_role;

-- Visibility is a discovery rule, never an ownership rule. Re-emit the three
-- proof functions as explicit reviewed definitions with the legacy public-only
-- predicate removed. Keeping the DDL static lets the migration/RLS gate inspect
-- the entire statement and prevents schema drift from being hidden behind
-- opaque EXECUTE variables.
CREATE OR REPLACE FUNCTION public.issue_order_attendance_claim_proof_v2(p_order_id uuid, p_event_id uuid, p_digest bytea, p_generation text, p_allow_retry_rotation boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_order public.orders%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_secondary boolean;
  -- #3524 — read off the pre-update snapshot taken FOR UPDATE below, so it
  -- describes the proof this call is about to replace rather than the one it is
  -- installing.
  v_rotating boolean := false;
BEGIN
  IF p_order_id IS NULL OR p_event_id IS NULL
     OR p_digest IS NULL OR octet_length(p_digest) <> 32
     OR p_generation NOT IN ('legacy_v1', 'governed_v2') THEN
    RETURN jsonb_build_object('result', 'invalid');
  END IF;

  SELECT o.* INTO v_order FROM public.orders o
   WHERE o.id = p_order_id AND o.event_id = p_event_id FOR UPDATE;
  IF NOT FOUND OR v_order.buyer_user_id IS NOT NULL THEN
    RETURN jsonb_build_object('result', 'ineligible');
  END IF;

  SELECT e.* INTO v_event FROM public.events e
    JOIN public.brands b ON b.id = e.brand_id
   WHERE e.id = p_event_id
     AND e.event_type IN ('event', 'trip', 'experience')
     AND e.deleted_at IS NULL
     AND b.deleted_at IS NULL
     AND e.status IN ('scheduled', 'live');
  IF NOT FOUND OR v_order.payment_status NOT IN ('paid', 'partial_refund')
     OR NOT EXISTS (
       SELECT 1 FROM public.tickets t
        WHERE t.order_id = v_order.id
          AND t.approval_status IN ('auto', 'approved')
          AND ((v_event.status = 'scheduled' AND t.status = 'valid')
            OR (v_event.status = 'live' AND t.status IN ('valid', 'used')))
     ) THEN
    RETURN jsonb_build_object('result', 'ineligible');
  END IF;

  IF v_order.attendance_claim_token_digest IS NOT NULL
     AND v_order.attendance_claim_token_consumed_at IS NULL
     AND NOT p_allow_retry_rotation THEN
    RETURN jsonb_build_object(
      'result', 'already_issued',
      'generation', v_order.attendance_claim_token_generation
    );
  END IF;

  -- #3524 — THE ROTATION THIS CALL IS ABOUT TO PERFORM. Reaching here with a
  -- live proof in the row means the caller allowed rotation, so the outgoing
  -- digest is a link somebody already has.
  v_rotating := v_order.attendance_claim_token_digest IS NOT NULL
    AND v_order.attendance_claim_token_consumed_at IS NULL;

  UPDATE public.orders
     SET attendance_claim_token_digest = p_digest,
         attendance_claim_token_generation = p_generation,
         attendance_claim_token_created_at = now(),
         attendance_claim_token_consumed_at = NULL,
         -- #3524 — the `legacy_v1` arm is FIRST and unchanged: on that
         -- generation the active proof IS the legacy proof, so the slot holds
         -- the new digest. Otherwise, a rotation carries the OUTGOING digest
         -- across so the link already in the guest's hands keeps verifying;
         -- with nothing outgoing the slot is left exactly as it was.
         attendance_claim_legacy_token_digest = CASE
           WHEN p_generation = 'legacy_v1' THEN p_digest
           WHEN v_rotating THEN v_order.attendance_claim_token_digest
           ELSE attendance_claim_legacy_token_digest END,
         attendance_claim_legacy_token_created_at = CASE
           WHEN p_generation = 'legacy_v1' THEN now()
           WHEN v_rotating THEN coalesce(
             v_order.attendance_claim_token_created_at, now())
           ELSE attendance_claim_legacy_token_created_at END
   WHERE id = v_order.id;

  IF p_generation = 'legacy_v1'
     AND EXISTS (
       SELECT 1 FROM public.ticket_checkout_sessions s
        WHERE s.order_id = v_order.id
          AND s.status IN ('paid_completed', 'free_completed')
     )
     AND (btrim(coalesce(v_order.buyer_email, '')) <> ''
       OR coalesce(v_order.buyer_phone_e164, '') ~ '^\+[1-9][0-9]{1,14}$') THEN
    v_secondary := btrim(coalesce(v_order.buyer_email, '')) = '' OR EXISTS (
      SELECT 1 FROM public.ticket_order_notifications n
       WHERE n.order_id = v_order.id
         AND n.channel = 'email'
         AND n.status = 'failed_terminal'
    );
    INSERT INTO public.attendance_claim_recovery_items(
      order_id, selected_token_created_at, requires_secondary_delivery
    ) VALUES (v_order.id, now(), v_secondary)
    ON CONFLICT (order_id) DO UPDATE SET
      selected_token_created_at = excluded.selected_token_created_at,
      requires_secondary_delivery =
        public.attendance_claim_recovery_items.requires_secondary_delivery
          OR excluded.requires_secondary_delivery,
      updated_at = now();
    INSERT INTO public.attendance_claim_deliveries(
      kind, source_id, event_id, status, next_attempt_at, last_error_code
    ) VALUES (
      'order_recovery_email', v_order.id, v_order.event_id,
      CASE WHEN v_secondary THEN 'failed_terminal' ELSE 'pending' END,
      CASE WHEN v_secondary THEN NULL ELSE now() END,
      CASE WHEN v_secondary THEN 'historical_or_unavailable_email' ELSE NULL END
    ) ON CONFLICT (kind, source_id) DO NOTHING;
    UPDATE public.attendance_claim_recovery_items r
       SET primary_delivery_id = d.id, updated_at = now()
      FROM public.attendance_claim_deliveries d
     WHERE r.order_id = v_order.id
       AND d.kind = 'order_recovery_email' AND d.source_id = v_order.id;
    IF v_secondary THEN
      INSERT INTO public.attendance_claim_deliveries(
        kind, source_id, event_id, status, next_attempt_at
      ) VALUES (
        'order_recovery_sms', v_order.id, v_order.event_id, 'pending', now()
      ) ON CONFLICT (kind, source_id) DO NOTHING;
      UPDATE public.attendance_claim_recovery_items r
         SET secondary_delivery_id = d.id, updated_at = now()
        FROM public.attendance_claim_deliveries d
       WHERE r.order_id = v_order.id
         AND d.kind = 'order_recovery_sms' AND d.source_id = v_order.id;
    END IF;
  ELSIF p_generation = 'governed_v2' THEN
    UPDATE public.attendance_claim_recovery_items
       SET state = 'replacement_issued',
           replacement_issued_at = now(),
           updated_at = now()
     WHERE order_id = v_order.id
       AND state IN ('selected', 'replacement_issued');
  END IF;

  RETURN jsonb_build_object('result', 'issued', 'generation', p_generation);
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_attendance_internal_v2(p_user_id uuid, p_kind text, p_event_id uuid, p_source_id uuid, p_current_proof_digest bytea, p_legacy_proof_digest bytea DEFAULT NULL::bytea)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_event public.events%ROWTYPE;
  v_owner uuid;
  v_current bytea;
  v_legacy bytea;
  v_generation text;
  v_eligible boolean := false;
  v_current_match boolean := false;
  v_legacy_match boolean := false;
  v_resolved text;
  v_minted_at timestamptz;
  v_buyer_email text;
  v_buyer_phone text;
  v_channel text;
  v_masked text;
  v_conv uuid;
BEGIN
  IF p_user_id IS NULL OR p_event_id IS NULL OR p_source_id IS NULL
     OR p_current_proof_digest IS NULL
     OR octet_length(p_current_proof_digest) <> 32
     OR (p_legacy_proof_digest IS NOT NULL
       AND octet_length(p_legacy_proof_digest) <> 32)
     OR p_kind NOT IN ('rsvp', 'order') THEN
    RAISE EXCEPTION 'invalid_claim';
  END IF;

  SELECT e.* INTO v_event
    FROM public.events e JOIN public.brands b ON b.id = e.brand_id
   WHERE e.id = p_event_id AND e.deleted_at IS NULL
     AND b.deleted_at IS NULL AND e.status IN ('scheduled', 'live');
  IF NOT FOUND THEN RETURN jsonb_build_object('result', 'ineligible'); END IF;
  IF (p_kind = 'rsvp' AND v_event.event_type <> 'rsvp')
     OR (p_kind = 'order'
       AND v_event.event_type NOT IN ('event', 'trip', 'experience')) THEN
    RETURN jsonb_build_object('result', 'invalid');
  END IF;

  IF p_kind = 'rsvp' THEN
    SELECT r.user_id,
           CASE WHEN r.pass_recovery_token_hash ~ '^[0-9a-fA-F]{64}$'
             THEN decode(r.pass_recovery_token_hash, 'hex') END,
           r.rsvp_status = 'going' AND r.approval_status = 'approved',
           r.guest_email, r.guest_phone
      INTO v_owner, v_current, v_eligible, v_buyer_email, v_buyer_phone
      FROM public.event_rsvps r
     WHERE r.id = p_source_id AND r.event_id = p_event_id FOR UPDATE;
  ELSE
    SELECT o.buyer_user_id, o.attendance_claim_token_digest,
           o.attendance_claim_legacy_token_digest,
           o.attendance_claim_token_generation,
           o.payment_status IN ('paid', 'partial_refund') AND EXISTS (
             SELECT 1 FROM public.tickets t
              WHERE t.order_id = o.id
                AND t.approval_status IN ('auto', 'approved')
                AND ((v_event.status = 'scheduled' AND t.status = 'valid')
                  OR (v_event.status = 'live'
                    AND t.status IN ('valid', 'used')))
           ),
           coalesce(o.attendance_claim_token_created_at,
                    o.attendance_claim_legacy_token_created_at),
           o.buyer_email, o.buyer_phone_e164
      INTO v_owner, v_current, v_legacy, v_generation, v_eligible,
           v_minted_at, v_buyer_email, v_buyer_phone
      FROM public.orders o
     WHERE o.id = p_source_id AND o.event_id = p_event_id FOR UPDATE;
  END IF;

  IF NOT FOUND THEN RETURN jsonb_build_object('result', 'invalid'); END IF;
  IF v_owner = p_user_id THEN
    RETURN jsonb_build_object('result', 'invalid');
  END IF;
  IF v_owner IS NOT NULL THEN RETURN jsonb_build_object('result', 'conflict'); END IF;
  IF p_kind = 'order' AND v_legacy IS NOT NULL
     AND p_legacy_proof_digest IS NULL THEN
    RETURN jsonb_build_object('result', 'secret_unavailable');
  END IF;

  v_current_match := v_current IS NOT NULL
    AND CASE
      -- Pre-governance orders keep their legacy proof in the active slot. Once
      -- the governed reader is live, the Edge function supplies that proof in
      -- the legacy argument rather than the governed/current argument.
      WHEN p_kind = 'order' AND v_generation = 'legacy_v1' THEN
        p_legacy_proof_digest IS NOT NULL
          AND public.fixed_digest_equal(v_current, p_legacy_proof_digest)
      ELSE public.fixed_digest_equal(v_current, p_current_proof_digest)
    END;
  v_legacy_match := v_legacy IS NOT NULL
    AND p_legacy_proof_digest IS NOT NULL
    AND public.fixed_digest_equal(v_legacy, p_legacy_proof_digest);
  IF NOT v_current_match AND NOT v_legacy_match THEN
    RETURN jsonb_build_object('result', 'invalid');
  END IF;

  -- #3524 — THE EXPIRY. Order arm only. A token with no recorded mint time
  -- cannot be aged and is not expired; every token minted by
  -- `issue_order_attendance_claim_proof_v2` records one.
  IF p_kind = 'order' AND v_minted_at IS NOT NULL
     AND v_minted_at < now() - public.attendance_claim_token_ttl() THEN
    RETURN jsonb_build_object('result', 'expired');
  END IF;

  IF NOT v_eligible THEN RETURN jsonb_build_object('result', 'ineligible'); END IF;

  -- Preserve the established RSVP duplicate-owner contract before asking
  -- whether this account owns the guest contact. A claimant who already owns
  -- another RSVP for this event can never take this row; returning conflict
  -- here keeps the refusal deterministic while still validating the proof,
  -- event, source, and eligibility first.
  IF p_kind = 'rsvp' AND EXISTS (
    SELECT 1 FROM public.event_rsvps other
     WHERE other.event_id = p_event_id AND other.user_id = p_user_id
       AND other.id <> p_source_id
  ) THEN RETURN jsonb_build_object('result', 'conflict'); END IF;

  -- #4063: both order and RSVP links use the single raw-contact predicate.
  -- A refusal returns before any owner, token, delivery, or chat write.
  IF NOT public.account_owns_contact(
       p_user_id, v_buyer_email, v_buyer_phone
     ) THEN
    IF btrim(coalesce(v_buyer_email, '')) <> '' THEN
      v_channel := 'email';
      v_masked := public.mask_contact_for_claim(v_buyer_email, 'email');
    ELSIF coalesce(v_buyer_phone, '') ~ '^\+[1-9][0-9]{1,14}$' THEN
      v_channel := 'phone';
      v_masked := public.mask_contact_for_claim(v_buyer_phone, 'phone');
    END IF;
    -- Email only: a matching account address gets the actionable
    -- contact_unproved result. Phone contacts keep identity_mismatch because a
    -- genuine owner already passes one of the two received-code proof arms.
    IF v_channel = 'email'
       AND public.account_carries_email(p_user_id, v_buyer_email) THEN
      RETURN jsonb_build_object(
        'result', 'contact_unproved',
        'contactMasked', v_masked,
        'contactChannel', v_channel);
    END IF;
    RETURN jsonb_build_object(
      'result', 'identity_mismatch',
      'contactMasked', v_masked,
      'contactChannel', v_channel);
  END IF;

  IF p_kind = 'rsvp' THEN
    UPDATE public.event_rsvps SET user_id = p_user_id WHERE id = p_source_id;
    RETURN jsonb_build_object('result', 'claimed', 'eventId', p_event_id);
  END IF;

  v_resolved := CASE
    WHEN v_current_match AND v_generation = 'governed_v2'
      THEN 'governed_token'
    WHEN v_legacy_match THEN 'legacy_token'
    ELSE 'legacy_token' END;
  UPDATE public.orders
     SET buyer_user_id = p_user_id,
         attendance_claim_token_digest = NULL,
         attendance_claim_token_generation = NULL,
         attendance_claim_legacy_token_digest = NULL,
         attendance_claim_legacy_token_created_at = NULL,
         attendance_claim_token_consumed_at = now()
   WHERE id = p_source_id;
  UPDATE public.attendance_claim_recovery_items
     SET state = 'claimed', resolved_via = v_resolved,
         reconciled_at = now(), updated_at = now()
   WHERE order_id = p_source_id;
  UPDATE public.attendance_claim_deliveries
     SET status = 'failed_terminal', next_attempt_at = NULL,
         lease_id = NULL, lease_expires_at = NULL,
         provider_attempt_started_at = NULL,
         last_error_code = 'claim_resolved', updated_at = now()
   WHERE source_id = p_source_id
     AND kind IN ('order_recovery_email', 'order_recovery_sms')
     AND status IN ('pending', 'processing', 'failed_retryable');

  -- #3524 F-7 — the group chat is the second half of what the buyer was
  -- promised. Reuse the SAME helper the identity rail and the paid finalize
  -- path use, never a second writer. It returns silently when the event type
  -- has no chat (an `experience` legitimately has none), which is why the
  -- caller reads the membership back below instead of assuming it.
  PERFORM public.add_buyer_to_event_chat(p_event_id, p_user_id, p_source_id, NULL);
  UPDATE public.pending_trip_chat_claims
     SET claimed_at = now(), claimed_by_user_id = p_user_id
   WHERE order_id = p_source_id AND claimed_at IS NULL;

  SELECT c.id INTO v_conv
    FROM public.conversations c
    JOIN public.conversation_participants cp
      ON cp.conversation_id = c.id AND cp.user_id = p_user_id
   WHERE c.event_id = p_event_id
     AND c.linked_entity_type IN ('trip', 'event')
   LIMIT 1;

  RETURN jsonb_build_object(
    'result', 'claimed',
    'eventId', p_event_id,
    'chatJoined', v_conv IS NOT NULL,
    'conversationId', v_conv);
END;
$function$;

CREATE OR REPLACE FUNCTION public.mint_attendance_claim_handoff(p_kind text, p_event_id uuid, p_source_id uuid, p_current_proof_digest bytea, p_legacy_proof_digest bytea, p_code_digest bytea, p_ip_hash text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_event public.events%ROWTYPE;
  v_owner uuid;
  v_current bytea;
  v_legacy bytea;
  v_generation text;
  v_eligible boolean := false;
  v_current_match boolean := false;
  v_legacy_match boolean := false;
  v_minted_at timestamptz;
  v_expires timestamptz;
BEGIN
  IF p_event_id IS NULL OR p_source_id IS NULL
     OR p_current_proof_digest IS NULL
     OR octet_length(p_current_proof_digest) <> 32
     OR (p_legacy_proof_digest IS NOT NULL
       AND octet_length(p_legacy_proof_digest) <> 32)
     OR p_code_digest IS NULL OR octet_length(p_code_digest) <> 32
     OR p_kind NOT IN ('rsvp', 'order') THEN
    RAISE EXCEPTION 'invalid_claim';
  END IF;

  -- The desktop sheet is an order-purchase surface. The rsvp arm has its own
  -- pass-recovery product (#871/#3440) and is deliberately not minted here.
  IF p_kind <> 'order' THEN RETURN jsonb_build_object('result', 'invalid'); END IF;

  SELECT e.* INTO v_event
    FROM public.events e JOIN public.brands b ON b.id = e.brand_id
   WHERE e.id = p_event_id AND e.deleted_at IS NULL
     AND b.deleted_at IS NULL AND e.status IN ('scheduled', 'live');
  IF NOT FOUND THEN RETURN jsonb_build_object('result', 'ineligible'); END IF;
  IF v_event.event_type NOT IN ('event', 'trip', 'experience') THEN
    RETURN jsonb_build_object('result', 'invalid');
  END IF;

  SELECT o.buyer_user_id, o.attendance_claim_token_digest,
         o.attendance_claim_legacy_token_digest,
         o.attendance_claim_token_generation,
         o.payment_status IN ('paid', 'partial_refund') AND EXISTS (
           SELECT 1 FROM public.tickets t
            WHERE t.order_id = o.id
              AND t.approval_status IN ('auto', 'approved')
              AND ((v_event.status = 'scheduled' AND t.status = 'valid')
                OR (v_event.status = 'live'
                  AND t.status IN ('valid', 'used')))
         ),
         coalesce(o.attendance_claim_token_created_at,
                  o.attendance_claim_legacy_token_created_at)
    INTO v_owner, v_current, v_legacy, v_generation, v_eligible, v_minted_at
    FROM public.orders o
   WHERE o.id = p_source_id AND o.event_id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('result', 'invalid'); END IF;
  IF v_owner IS NOT NULL THEN RETURN jsonb_build_object('result', 'conflict'); END IF;

  v_current_match := v_current IS NOT NULL
    AND CASE
      WHEN v_generation = 'legacy_v1' THEN
        p_legacy_proof_digest IS NOT NULL
          AND public.fixed_digest_equal(v_current, p_legacy_proof_digest)
      ELSE public.fixed_digest_equal(v_current, p_current_proof_digest)
    END;
  v_legacy_match := v_legacy IS NOT NULL
    AND p_legacy_proof_digest IS NOT NULL
    AND public.fixed_digest_equal(v_legacy, p_legacy_proof_digest);
  IF NOT v_current_match AND NOT v_legacy_match THEN
    RETURN jsonb_build_object('result', 'invalid');
  END IF;
  IF v_minted_at IS NOT NULL
     AND v_minted_at < now() - public.attendance_claim_token_ttl() THEN
    RETURN jsonb_build_object('result', 'expired');
  END IF;
  IF NOT v_eligible THEN RETURN jsonb_build_object('result', 'ineligible'); END IF;

  IF NOT public.take_attendance_claim_handoff_attempt(p_source_id) THEN
    RETURN jsonb_build_object('result', 'rate_limited');
  END IF;

  -- Opportunistic prune, bounded, mirroring begin_attendance_claim_attempt.
  DELETE FROM public.attendance_claim_handoffs h
   USING (
     SELECT id FROM public.attendance_claim_handoffs
      WHERE consumed_at < now() - interval '7 days'
      ORDER BY consumed_at, id LIMIT 100
   ) d
   WHERE h.id = d.id;
  DELETE FROM public.attendance_claim_handoffs h
   USING (
     SELECT id FROM public.attendance_claim_handoffs
      WHERE expires_at < now() - interval '7 days'
      ORDER BY expires_at, id LIMIT 100
   ) d
   WHERE h.id = d.id;

  -- At most ONE live code per source: a guest who taps "Get a new code"
  -- invalidates the one on the previous screen.
  UPDATE public.attendance_claim_handoffs
     SET consumed_at = now()
   WHERE source_id = p_source_id AND consumed_at IS NULL;

  v_expires := now() + interval '10 minutes';
  INSERT INTO public.attendance_claim_handoffs(
    kind, event_id, source_id, code_digest, expires_at, created_ip_hash)
  VALUES (p_kind, p_event_id, p_source_id, p_code_digest, v_expires, p_ip_hash);

  RETURN jsonb_build_object('result', 'minted', 'expiresAt', v_expires);
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('result', 'conflict');
END;
$function$;

COMMENT ON FUNCTION public.issue_order_attendance_claim_proof_v2(
  uuid, uuid, bytea, text, boolean) IS
  '#2979 + #3524 + #4063: arms one order attendance proof for any event visibility; rotation preserves the outgoing proof and successful claims still retire both proof slots.';
COMMENT ON FUNCTION public.claim_attendance_internal_v2(
  uuid, text, uuid, uuid, bytea, bytea) IS
  '#3524 + #4063: order and RSVP links require public.account_owns_contact before any ownership write. Visibility is not ownership. Refusals consume nothing; successful orders retain recovery retirement and chat behavior.';
COMMENT ON FUNCTION public.mint_attendance_claim_handoff(
  text, uuid, uuid, bytea, bytea, bytea, text) IS
  '#3524 + #4063: mints a 10-minute single-use order handoff for any event visibility after re-verifying the unconsumed proof and eligibility. Identity remains enforced only at redemption.';

ALTER TABLE public.attendance_claim_attempts
  DROP CONSTRAINT IF EXISTS attendance_claim_attempts_kind_check;
ALTER TABLE public.attendance_claim_attempts
  ADD CONSTRAINT attendance_claim_attempts_kind_check
  CHECK (kind IN ('rsvp', 'order', 'identity'));

CREATE OR REPLACE FUNCTION public.begin_attendance_claim_attempt(
  p_user_id uuid,
  p_kind text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_attempt_id uuid;
  v_started_count integer;
  v_limit integer;
  v_pruned_completed integer := 0;
  v_pruned_abandoned integer := 0;
BEGIN
  IF p_user_id IS NULL OR p_kind NOT IN ('rsvp', 'order', 'identity') THEN
    RAISE EXCEPTION 'invalid_attempt';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 871));

  WITH doomed AS (
    SELECT id FROM public.attendance_claim_attempts
     WHERE completed_at < now() - interval '30 days'
     ORDER BY completed_at, id LIMIT 100
  ), deleted AS (
    DELETE FROM public.attendance_claim_attempts a USING doomed d
     WHERE a.id = d.id RETURNING 1
  ) SELECT count(*) INTO v_pruned_completed FROM deleted;

  WITH doomed AS (
    SELECT id FROM public.attendance_claim_attempts
     WHERE completed_at IS NULL AND started_at < now() - interval '24 hours'
     ORDER BY started_at, id LIMIT 100
  ), deleted AS (
    DELETE FROM public.attendance_claim_attempts a USING doomed d
     WHERE a.id = d.id RETURNING 1
  ) SELECT count(*) INTO v_pruned_abandoned FROM deleted;

  INSERT INTO public.attendance_claim_attempts(user_id, kind)
  VALUES (p_user_id, p_kind)
  RETURNING id INTO v_attempt_id;

  SELECT count(*) INTO v_started_count
    FROM public.attendance_claim_attempts
   WHERE user_id = p_user_id
     AND started_at >= now() - interval '10 minutes'
     AND CASE WHEN p_kind = 'identity'
       THEN kind = 'identity'
       ELSE kind IN ('rsvp', 'order')
     END;

  v_limit := CASE WHEN p_kind = 'identity' THEN 30 ELSE 10 END;
  IF v_started_count > v_limit THEN
    UPDATE public.attendance_claim_attempts
       SET completed_at = now(), outcome = 'rate_limited'
     WHERE id = v_attempt_id;
  END IF;

  RETURN jsonb_build_object(
    'allowed', v_started_count <= v_limit,
    'attemptId', v_attempt_id,
    'retryAfterSeconds', 600,
    'prunedCompleted', v_pruned_completed,
    'prunedAbandoned', v_pruned_abandoned
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.begin_attendance_claim_attempt(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_attendance_claim_attempt(uuid, text)
  TO service_role;

DO $repair$
DECLARE
  v_expected constant integer := 22;
  v_count integer;
  v_done integer;
BEGIN
  SELECT count(*) INTO v_count
    FROM public.orders
   WHERE buyer_user_id IS NULL
     AND attendance_identity_claim_armed_at IS NULL
     AND payment_status IN ('paid', 'partial_refund')
     AND (btrim(coalesce(buyer_email, '')) <> ''
       OR coalesce(buyer_phone_e164, '') ~ '^\+[1-9][0-9]{1,14}$');
  IF v_count = 0 THEN
    RAISE NOTICE 'issue_4063_armed_repair=0 (already repaired)';
    RETURN;
  END IF;
  IF v_count <> v_expected THEN
    RAISE EXCEPTION 'issue_4063_repair_bound: found %, expected %',
      v_count, v_expected;
  END IF;
  UPDATE public.orders
     SET attendance_identity_claim_armed_at = now()
   WHERE buyer_user_id IS NULL
     AND attendance_identity_claim_armed_at IS NULL
     AND payment_status IN ('paid', 'partial_refund')
     AND (btrim(coalesce(buyer_email, '')) <> ''
       OR coalesce(buyer_phone_e164, '') ~ '^\+[1-9][0-9]{1,14}$');
  GET DIAGNOSTICS v_done = ROW_COUNT;
  IF v_done <> v_expected THEN
    RAISE EXCEPTION 'issue_4063_repair_bound: updated %, expected %',
      v_done, v_expected;
  END IF;
  RAISE NOTICE 'issue_4063_armed_repair=%', v_done;
END;
$repair$;

-- MINGLA-INVARIANT: I-4063-OWNER-PROOF | issue #4063 | Owner columns may attach only to an account that proved the purchase contact; signed-in non-owners remain the purchaser/booker, not the owner.

COMMIT;
NOTIFY pgrst, 'reload schema';
