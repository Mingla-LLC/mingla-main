BEGIN;
SET LOCAL lock_timeout = '10s';

CREATE OR REPLACE FUNCTION public.phone_identity_owners(
  p_phone text
)
RETURNS TABLE(owner_user_id uuid, owner_sources text[])
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
BEGIN
  IF p_phone IS NULL OR p_phone !~ '^\+[1-9][0-9]{1,14}$' THEN
    RAISE EXCEPTION 'phone_invalid' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT authority.user_id,
         array_agg(authority.source ORDER BY authority.source)::text[]
    FROM (
      SELECT p.id AS user_id, 'profile'::text AS source
        FROM public.profiles p
       WHERE p.phone = p_phone
      UNION ALL
      SELECT v.user_id, 'verified_phone_identity'::text
        FROM public.verified_phone_identities v
       WHERE v.phone_e164 = p_phone
      UNION ALL
      SELECT u.id, 'auth_user'::text
        FROM auth.users u
       WHERE CASE
         WHEN btrim(coalesce(u.phone, '')) ~ '^\+[1-9][0-9]{1,14}$'
           THEN btrim(u.phone)
         WHEN btrim(coalesce(u.phone, '')) ~ '^[1-9][0-9]{1,14}$'
           THEN '+' || btrim(u.phone)
         ELSE NULL
       END = p_phone
    ) AS authority
   GROUP BY authority.user_id
   ORDER BY authority.user_id;
END;
$function$;

COMMENT ON FUNCTION public.phone_identity_owners(text) IS
  '#4063: service-role-only complete phone ownership view across profiles.phone, verified_phone_identities and auth.users.phone. Edge OTP guards fail closed if this RPC cannot answer.';

REVOKE ALL ON FUNCTION public.phone_identity_owners(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phone_identity_owners(text) TO service_role;

-- #4063 Wave 5: a ticket can leave the buyer only after the recipient proves
-- possession of the offered email address or phone number. Both contacts are
-- collected for delivery; either proved contact may establish ownership. The old QR is
-- rotated in the same transaction that attaches the ticket to the recipient.
ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS holder_user_id uuid NULL
    REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS holder_name text NULL,
  ADD COLUMN IF NOT EXISTS holder_email text NULL,
  ADD COLUMN IF NOT EXISTS holder_phone_e164 text NULL,
  ADD COLUMN IF NOT EXISTS holder_sender_first_name text NULL,
  ADD COLUMN IF NOT EXISTS transfer_state text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS transfer_offered_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS transfer_claimed_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS transfer_revoked_at timestamptz NULL;

ALTER TABLE public.tickets
  DROP CONSTRAINT IF EXISTS tickets_holder_phone_e164_check,
  ADD CONSTRAINT tickets_holder_phone_e164_check CHECK (
    holder_phone_e164 IS NULL
    OR holder_phone_e164 ~ '^\+[1-9][0-9]{1,14}$'
  ),
  DROP CONSTRAINT IF EXISTS tickets_holder_email_normalized_check,
  ADD CONSTRAINT tickets_holder_email_normalized_check CHECK (
    holder_email IS NULL OR holder_email = lower(btrim(holder_email))
  ),
  DROP CONSTRAINT IF EXISTS tickets_transfer_state_check,
  ADD CONSTRAINT tickets_transfer_state_check CHECK (
    transfer_state IN ('none','offered','claimed')
  ),
  DROP CONSTRAINT IF EXISTS tickets_transfer_offered_contact_check,
  ADD CONSTRAINT tickets_transfer_offered_contact_check CHECK (
    transfer_state <> 'offered'
    OR (holder_email IS NOT NULL AND holder_phone_e164 IS NOT NULL)
  ),
  DROP CONSTRAINT IF EXISTS tickets_transfer_claimed_owner_check,
  ADD CONSTRAINT tickets_transfer_claimed_owner_check CHECK (
    transfer_state <> 'claimed' OR holder_user_id IS NOT NULL
  );

CREATE INDEX IF NOT EXISTS tickets_holder_user_id_idx
  ON public.tickets(holder_user_id) WHERE holder_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS tickets_holder_phone_offered_idx
  ON public.tickets(holder_phone_e164) WHERE transfer_state = 'offered';
CREATE INDEX IF NOT EXISTS tickets_holder_email_offered_idx
  ON public.tickets(lower(holder_email)) WHERE transfer_state = 'offered';

-- The existing update trigger is the final column-integrity guard behind the
-- finance/scanner RLS policies. Admit a buyer only when the row diff consists
-- exclusively of the transfer columns; direct table UPDATE is still denied by
-- RLS, so this arm is reachable through the two bounded RPCs below.
CREATE OR REPLACE FUNCTION public.biz_tickets_enforce_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_brand uuid;
  v_is_team boolean;
  v_is_scanner boolean;
  v_transfer_columns constant text[] := ARRAY[
    'holder_user_id','holder_name','holder_email','holder_phone_e164',
    'holder_sender_first_name','transfer_state','transfer_offered_at',
    'transfer_claimed_at','transfer_revoked_at'
  ];
BEGIN
  IF TG_OP <> 'UPDATE' OR auth.uid() IS NULL THEN RETURN NEW; END IF;

  IF EXISTS (
    SELECT 1 FROM public.orders o
     WHERE o.id = OLD.order_id AND o.buyer_user_id = auth.uid()
  ) AND (to_jsonb(NEW) - v_transfer_columns) =
        (to_jsonb(OLD) - v_transfer_columns) THEN
    RETURN NEW;
  END IF;

  v_brand := public.biz_event_brand_id(OLD.event_id);
  v_is_team :=
    public.biz_is_brand_member_for_read_for_caller(v_brand)
    AND public.biz_brand_effective_rank_for_caller(v_brand)
      >= public.biz_role_rank('finance_manager');
  v_is_scanner := EXISTS (
    SELECT 1 FROM public.event_scanners es
     WHERE es.event_id = OLD.event_id AND es.user_id = auth.uid()
       AND es.removed_at IS NULL
       AND coalesce((es.permissions ->> 'scan')::boolean, true)
  );
  IF v_is_team THEN RETURN NEW; END IF;
  IF v_is_scanner THEN
    IF NEW.id IS DISTINCT FROM OLD.id
      OR NEW.order_id IS DISTINCT FROM OLD.order_id
      OR NEW.ticket_type_id IS DISTINCT FROM OLD.ticket_type_id
      OR NEW.event_id IS DISTINCT FROM OLD.event_id
      OR NEW.attendee_name IS DISTINCT FROM OLD.attendee_name
      OR NEW.attendee_email IS DISTINCT FROM OLD.attendee_email
      OR NEW.attendee_phone IS DISTINCT FROM OLD.attendee_phone
      OR NEW.qr_code IS DISTINCT FROM OLD.qr_code
      OR NEW.transferred_to_email IS DISTINCT FROM OLD.transferred_to_email
      OR NEW.transferred_at IS DISTINCT FROM OLD.transferred_at
      OR NEW.approval_status IS DISTINCT FROM OLD.approval_status
      OR NEW.approval_decided_by IS DISTINCT FROM OLD.approval_decided_by
      OR NEW.approval_decided_at IS DISTINCT FROM OLD.approval_decided_at
      OR (
        (
          NEW.holder_user_id IS DISTINCT FROM OLD.holder_user_id
          OR NEW.holder_name IS DISTINCT FROM OLD.holder_name
          OR NEW.holder_email IS DISTINCT FROM OLD.holder_email
          OR NEW.holder_phone_e164 IS DISTINCT FROM OLD.holder_phone_e164
          OR NEW.holder_sender_first_name IS DISTINCT FROM OLD.holder_sender_first_name
          OR NEW.transfer_state IS DISTINCT FROM OLD.transfer_state
          OR NEW.transfer_offered_at IS DISTINCT FROM OLD.transfer_offered_at
          OR NEW.transfer_claimed_at IS DISTINCT FROM OLD.transfer_claimed_at
          OR NEW.transfer_revoked_at IS DISTINCT FROM OLD.transfer_revoked_at
        )
        AND NOT (
          OLD.status = 'valid'
          AND NEW.status = 'used'
          AND OLD.transfer_state = 'offered'
          AND NEW.transfer_state = 'none'
          AND NEW.holder_user_id IS NULL
          AND NEW.holder_name IS NULL
          AND NEW.holder_email IS NULL
          AND NEW.holder_phone_e164 IS NULL
          AND NEW.holder_sender_first_name IS NULL
          AND NEW.transfer_offered_at IS NULL
          AND NEW.transfer_claimed_at IS NULL
          AND NEW.transfer_revoked_at IS NOT NULL
        )
      )
      OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Scanners may only update check-in fields on tickets';
    END IF;
    IF OLD.status = 'valid' AND NEW.status = 'used' THEN
      IF NEW.used_by_scanner_id IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'used_by_scanner_id must equal the scanning user';
      END IF;
      IF NEW.used_at IS NULL THEN NEW.used_at := now();
      ELSIF NEW.used_at > now() + interval '2 minutes' THEN
        RAISE EXCEPTION 'used_at cannot be more than 2 minutes in the future';
      END IF;
      RETURN NEW;
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status
      OR NEW.used_at IS DISTINCT FROM OLD.used_at
      OR NEW.used_by_scanner_id IS DISTINCT FROM OLD.used_by_scanner_id THEN
      RAISE EXCEPTION 'Invalid ticket update for scanner role';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Not authorized to update ticket';
END;
$function$;

INSERT INTO public.notification_categories
  (key, section, is_transactional, urgency, default_channels, reach_mode, active)
VALUES (
  'buyer_ticket_sent', 'Purchases', true, 'high',
  ARRAY['email','sms'], 'reach_once', true
)
ON CONFLICT (key) DO UPDATE SET
  section = EXCLUDED.section,
  is_transactional = EXCLUDED.is_transactional,
  urgency = EXCLUDED.urgency,
  default_channels = EXCLUDED.default_channels,
  reach_mode = EXCLUDED.reach_mode,
  active = true;

CREATE OR REPLACE FUNCTION public.issue_4063_ticket_claim_subject(
  p_ticket_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT jsonb_build_object(
    'email', lower(btrim(coalesce(t.holder_email, ''))),
    'phone', nullif(btrim(coalesce(t.holder_phone_e164, '')), ''),
    'name', nullif(btrim(coalesce(t.holder_name, '')), ''),
    'title', e.title,
    'brandName', b.name,
    'startsAt', coalesce(
      (SELECT min(ed.start_at)
         FROM public.ticket_event_dates ted
         JOIN public.event_dates ed ON ed.id = ted.event_date_id
        WHERE ted.ticket_id = t.id),
      (SELECT min(ed.start_at) FROM public.event_dates ed
        WHERE ed.event_id = t.event_id AND ed.is_master),
      t.created_at
    ),
    'anchor', coalesce(
      (SELECT max(ed.end_at)
         FROM public.ticket_event_dates ted
         JOIN public.event_dates ed ON ed.id = ted.event_date_id
        WHERE ted.ticket_id = t.id),
      (SELECT max(ed.end_at) FROM public.event_dates ed
        WHERE ed.event_id = t.event_id),
      t.created_at
    ),
    'timezone', e.timezone,
    'quantity', 1,
    'noun', 'ticket',
    'orderLabel', NULL,
    'preferredProof', CASE
      WHEN t.holder_phone_e164 IS NOT NULL THEN 'phone' ELSE 'email' END,
    'claimed', t.transfer_state = 'claimed' AND t.holder_user_id IS NOT NULL
  )
  FROM public.tickets t
  JOIN public.events e ON e.id = t.event_id
  LEFT JOIN public.brands b ON b.id = e.brand_id
  WHERE t.id = p_ticket_id
    AND t.transfer_state IN ('offered','claimed')
$function$;

REVOKE ALL ON FUNCTION public.issue_4063_ticket_claim_subject(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4063_ticket_claim_subject(uuid)
  TO service_role;

-- Ticket is the one claim kind that has a holder separate from the order buyer.
-- Other claim kinds continue through the Wave 1 subject authority unchanged.
CREATE OR REPLACE FUNCTION public.mint_claim_link(
  p_subject_kind text,
  p_subject_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $function$
DECLARE
  v_subject jsonb;
  v_expiry timestamptz;
  v_existing_expiry timestamptz;
  v_code text;
  v_try integer;
BEGIN
  IF p_subject_kind NOT IN (
    'order','rsvp','rsvp_guest','reservation','stay_group','venue_order','ticket'
  ) OR p_subject_id IS NULL THEN
    RAISE EXCEPTION 'claim_kind_invalid' USING ERRCODE = '22023';
  END IF;

  v_subject := CASE WHEN p_subject_kind = 'ticket'
    THEN public.issue_4063_ticket_claim_subject(p_subject_id)
    ELSE public.issue_4063_claim_subject(p_subject_kind, p_subject_id) END;
  IF v_subject IS NULL THEN
    RAISE EXCEPTION 'claim_subject_not_found' USING ERRCODE = 'P0002';
  END IF;
  v_expiry := greatest(
    now() + interval '30 days',
    coalesce((v_subject->>'anchor')::timestamptz, now()) + interval '7 days'
  );

  UPDATE public.claim_links
     SET expires_at = greatest(expires_at, v_expiry)
   WHERE purpose = 'claim' AND subject_kind = p_subject_kind
     AND subject_id = p_subject_id AND revoked_at IS NULL
  RETURNING code, expires_at INTO v_code, v_existing_expiry;
  IF v_code IS NOT NULL THEN
    RETURN jsonb_build_object(
      'code', v_code, 'expiresAt', v_existing_expiry,
      'claimed', coalesce((v_subject->>'claimed')::boolean, false)
    );
  END IF;

  FOR v_try IN 1..5 LOOP
    v_code := public.issue_4063_claim_code();
    BEGIN
      INSERT INTO public.claim_links(
        code, purpose, subject_kind, subject_id, expires_at
      ) VALUES (v_code, 'claim', p_subject_kind, p_subject_id, v_expiry);
      RETURN jsonb_build_object(
        'code', v_code, 'expiresAt', v_expiry,
        'claimed', coalesce((v_subject->>'claimed')::boolean, false)
      );
    EXCEPTION WHEN unique_violation THEN
      UPDATE public.claim_links
         SET expires_at = greatest(expires_at, v_expiry)
       WHERE purpose = 'claim' AND subject_kind = p_subject_kind
         AND subject_id = p_subject_id AND revoked_at IS NULL
      RETURNING code, expires_at INTO v_code, v_existing_expiry;
      IF v_code IS NOT NULL THEN
        RETURN jsonb_build_object(
          'code', v_code, 'expiresAt', v_existing_expiry,
          'claimed', coalesce((v_subject->>'claimed')::boolean, false)
        );
      END IF;
    END;
  END LOOP;
  RAISE EXCEPTION 'claim_code_unavailable' USING ERRCODE = 'P0001';
END;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_claim_link(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_link public.claim_links%ROWTYPE;
  v_parent public.claim_links%ROWTYPE;
  v_subject jsonb;
  v_status text;
  v_redirect_code text;
  v_email text;
  v_phone text;
BEGIN
  IF v_code !~ '^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{10}$' THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;
  SELECT * INTO v_link FROM public.claim_links WHERE code = v_code;
  IF NOT FOUND OR v_link.revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;
  IF v_link.purpose = 'redirect' THEN
    IF v_link.expires_at < now() THEN
      RETURN jsonb_build_object('status', 'not_found');
    END IF;
    RETURN jsonb_build_object('status', 'redirect', 'url', v_link.target_url);
  END IF;
  IF v_link.purpose = 'handoff' THEN
    UPDATE public.claim_links SET consumed_at = now()
     WHERE code = v_link.code AND consumed_at IS NULL
       AND revoked_at IS NULL AND expires_at >= now()
    RETURNING * INTO v_link;
    IF NOT FOUND THEN RETURN jsonb_build_object('status', 'not_found'); END IF;
    v_redirect_code := v_link.parent_code;
    SELECT * INTO v_parent FROM public.claim_links
     WHERE code = v_link.parent_code AND purpose = 'claim'
       AND revoked_at IS NULL;
    IF NOT FOUND THEN RETURN jsonb_build_object('status', 'not_found'); END IF;
    v_link := v_parent;
  END IF;

  v_subject := CASE WHEN v_link.subject_kind = 'ticket'
    THEN public.issue_4063_ticket_claim_subject(v_link.subject_id)
    ELSE public.issue_4063_claim_subject(v_link.subject_kind, v_link.subject_id)
    END;
  IF v_subject IS NULL THEN RETURN jsonb_build_object('status', 'not_found'); END IF;
  v_status := CASE WHEN v_link.expires_at < now() THEN 'expired' ELSE 'active' END;
  v_email := nullif(v_subject->>'email', '');
  v_phone := nullif(v_subject->>'phone', '');

  RETURN jsonb_build_object(
    'status', v_status, 'code', v_link.code, 'redirectCode', v_redirect_code,
    'kind', v_link.subject_kind, 'noun', v_subject->>'noun',
    'title', v_subject->>'title', 'brandName', v_subject->>'brandName',
    'orderLabel', v_subject->>'orderLabel', 'startsAt', v_subject->>'startsAt',
    'timezone', v_subject->>'timezone',
    'quantity', coalesce((v_subject->>'quantity')::integer, 1),
    'emailMasked', public.mask_contact_for_claim(v_email, 'email'),
    'phoneLast4', CASE WHEN v_phone ~ '^\+[1-9][0-9]{4,14}$'
      THEN right(v_phone, 4) ELSE NULL END,
    'preferredProof', coalesce(v_subject->>'preferredProof', 'any')
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.pg_ticket_offer_to_friend(
  p_ticket_id uuid,
  p_name text,
  p_email text,
  p_phone_e164 text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_ticket public.tickets%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_event record;
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_phone text := nullif(btrim(coalesce(p_phone_e164, '')), '');
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_sender text;
  v_start timestamptz;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'ticket_offer_denied' USING ERRCODE = '42501';
  END IF;
  IF v_name IS NULL OR char_length(v_name) > 60
     OR v_email IS NULL OR v_phone IS NULL
     OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
     OR v_phone !~ '^\+[1-9][0-9]{1,14}$' THEN
    RAISE EXCEPTION 'ticket_offer_invalid' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_ticket FROM public.tickets
   WHERE id = p_ticket_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ticket_not_found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = v_ticket.order_id;
  IF v_order.buyer_user_id IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'ticket_offer_denied' USING ERRCODE = '42501';
  END IF;
  IF v_ticket.status <> 'valid' OR v_ticket.transfer_state <> 'none' THEN
    RAISE EXCEPTION 'ticket_offer_unavailable' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM public.tickets t
       WHERE t.order_id = v_ticket.order_id AND t.status = 'valid') < 2
     OR v_ticket.id = (
       SELECT t.id FROM public.tickets t WHERE t.order_id = v_ticket.order_id
       ORDER BY t.created_at, t.id LIMIT 1
     ) THEN
    RAISE EXCEPTION 'ticket_offer_primary_refused' USING ERRCODE = '22023';
  END IF;
  SELECT e.id, e.title, e.brand_id, e.timezone, e.event_type, e.status,
         coalesce(
           (SELECT min(ed.start_at) FROM public.ticket_event_dates ted
             JOIN public.event_dates ed ON ed.id = ted.event_date_id
            WHERE ted.ticket_id = v_ticket.id),
           (SELECT min(ed.start_at) FROM public.event_dates ed
             WHERE ed.event_id = e.id AND ed.is_master)
         ) AS starts_at,
         coalesce(
           (SELECT max(ed.end_at) FROM public.ticket_event_dates ted
             JOIN public.event_dates ed ON ed.id = ted.event_date_id
            WHERE ted.ticket_id = v_ticket.id),
           (SELECT max(ed.end_at) FROM public.event_dates ed WHERE ed.event_id = e.id)
         ) AS ends_at
    INTO v_event FROM public.events e WHERE e.id = v_ticket.event_id;
  IF v_event.status IN ('ended','cancelled')
     OR (v_event.ends_at IS NOT NULL AND v_event.ends_at <= now()) THEN
    RAISE EXCEPTION 'ticket_offer_event_ended' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.verified_account_identifiers(v_actor) i
     WHERE (i.kind = 'email' AND v_email IS NOT NULL AND i.value = v_email)
        OR (i.kind = 'phone' AND v_phone IS NOT NULL AND i.value = v_phone)
  ) THEN
    RAISE EXCEPTION 'ticket_offer_self' USING ERRCODE = '22023';
  END IF;
  IF (
    SELECT count(*) FROM public.claim_links l
    JOIN public.tickets t ON t.id = l.subject_id
     WHERE l.subject_kind = 'ticket' AND t.order_id = v_ticket.order_id
       AND l.created_at >= date_trunc('day', now())
  ) >= 20 THEN
    RAISE EXCEPTION 'ticket_offer_rate_limited' USING ERRCODE = 'P0001';
  END IF;

  v_sender := nullif(split_part(btrim(coalesce(v_order.buyer_name, '')), ' ', 1), '');
  v_sender := coalesce(v_sender, 'A friend');
  UPDATE public.tickets SET
    holder_name = v_name, holder_email = v_email, holder_phone_e164 = v_phone,
    holder_sender_first_name = v_sender, holder_user_id = NULL,
    transfer_state = 'offered', transfer_offered_at = now(),
    transfer_claimed_at = NULL, transfer_revoked_at = NULL
  WHERE id = v_ticket.id;

  PERFORM public.mint_claim_link('ticket', v_ticket.id);
  v_start := v_event.starts_at;
  -- Email and Twilio-backed SMS are one durable delivery contract. If either
  -- outbox row cannot be written, the offer rolls back instead of telling the
  -- buyer a ticket was sent with a missing notification.
  INSERT INTO public.notification_outbox(
    category_key, user_id, contact, brand_id, payload, idempotency_key,
    channel, country_code
  ) VALUES
  (
    'buyer_ticket_sent', NULL, v_email, v_event.brand_id,
    jsonb_build_object(
      'ticket_id', v_ticket.id, 'event_id', v_ticket.event_id,
      'event_title', v_event.title, 'event_start_at', v_start,
      'timezone', v_event.timezone, 'event_type', v_event.event_type,
      'sender', v_sender, 'recipient_name', v_name
    ),
    'buyer_ticket_sent:' || v_ticket.id::text || ':email:' ||
      gen_random_uuid()::text,
    'email', NULL
  ),
  (
    'buyer_ticket_sent', NULL, v_phone, v_event.brand_id,
    jsonb_build_object(
      'ticket_id', v_ticket.id, 'event_id', v_ticket.event_id,
      'event_title', v_event.title, 'event_start_at', v_start,
      'timezone', v_event.timezone, 'event_type', v_event.event_type,
      'sender', v_sender, 'recipient_name', v_name
    ),
    'buyer_ticket_sent:' || v_ticket.id::text || ':sms:' ||
      gen_random_uuid()::text,
    'sms', public.mingla_e164_country(v_phone)
  );
  RETURN jsonb_build_object('ok', true, 'state', 'offered');
END;
$function$;

CREATE OR REPLACE FUNCTION public.pg_ticket_take_back(p_ticket_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_ticket public.tickets%ROWTYPE;
BEGIN
  SELECT t.* INTO v_ticket FROM public.tickets t
  JOIN public.orders o ON o.id = t.order_id
  WHERE t.id = p_ticket_id AND o.buyer_user_id = v_actor
  FOR UPDATE OF t;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ticket_take_back_denied' USING ERRCODE = '42501';
  END IF;
  IF v_ticket.transfer_state = 'claimed' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'too_late');
  END IF;
  IF v_ticket.transfer_state <> 'offered' THEN
    RETURN jsonb_build_object('ok', true, 'state', v_ticket.transfer_state);
  END IF;
  UPDATE public.tickets SET
    holder_user_id = NULL, holder_name = NULL, holder_email = NULL,
    holder_phone_e164 = NULL, holder_sender_first_name = NULL,
    transfer_state = 'none', transfer_offered_at = NULL,
    transfer_claimed_at = NULL, transfer_revoked_at = now()
  WHERE id = p_ticket_id;
  PERFORM public.issue_4063_revoke_claim_links('ticket', p_ticket_id);
  RETURN jsonb_build_object('ok', true, 'state', 'none');
END;
$function$;

-- I-4063-TICKET-TRANSFER-CLAIM: only a service-role edge may supply the QR
-- pepper. Contact ownership is checked by the same authority as every other
-- #4063 identity claim.
CREATE OR REPLACE FUNCTION public.issue_4063_claim_offered_tickets(
  p_user_id uuid,
  p_qr_token_pepper text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $function$
DECLARE
  v_row record;
  v_token text;
  v_hash text;
  v_qr text;
  v_claimed jsonb := '[]'::jsonb;
  v_more boolean := false;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('claimed', v_claimed, 'count', 0, 'more', false);
  END IF;
  PERFORM public.biz_ticket_checkout_assert_qr_pepper(p_qr_token_pepper);
  FOR v_row IN
    SELECT t.id, t.event_id, t.holder_sender_first_name,
           e.title, e.event_type, e.timezone, e.location_text,
           coalesce(
             (SELECT min(ed.start_at) FROM public.ticket_event_dates ted
               JOIN public.event_dates ed ON ed.id = ted.event_date_id
              WHERE ted.ticket_id = t.id),
             (SELECT min(ed.start_at) FROM public.event_dates ed
               WHERE ed.event_id = t.event_id AND ed.is_master),
             t.created_at
           ) AS starts_at
      FROM public.tickets t
      JOIN public.events e ON e.id = t.event_id
     WHERE t.transfer_state = 'offered' AND t.holder_user_id IS NULL
       AND t.status = 'valid'
       AND public.account_owns_contact(
         p_user_id, t.holder_email, t.holder_phone_e164
       )
     ORDER BY t.transfer_offered_at, t.id
     FOR UPDATE OF t SKIP LOCKED
     LIMIT 25
  LOOP
    v_token := encode(extensions.gen_random_bytes(32), 'hex');
    v_hash := public.biz_ticket_checkout_token_hash(v_token, p_qr_token_pepper);
    v_qr := public.biz_ticket_checkout_qr_payload(v_row.id, v_hash, p_qr_token_pepper);
    UPDATE public.tickets SET
      holder_user_id = p_user_id, transfer_state = 'claimed',
      transfer_claimed_at = now(), qr_token_hash = v_hash, qr_code = v_qr
    WHERE id = v_row.id AND transfer_state = 'offered';
    IF FOUND THEN
      PERFORM public.issue_4063_revoke_claim_links('ticket', v_row.id);
      v_claimed := v_claimed || jsonb_build_array(jsonb_build_object(
        'kind', 'ticket', 'id', v_row.id, 'routeKind', 'held_ticket',
        'routeId', v_row.id,
        'offeringType', CASE WHEN v_row.event_type IN ('trip','experience')
          THEN v_row.event_type ELSE 'event' END,
        'noun', 'ticket', 'title', v_row.title, 'orderLabel', NULL,
        'startsAt', v_row.starts_at, 'timezone', coalesce(v_row.timezone, 'UTC'),
        'venueLine', v_row.location_text, 'quantity', 1,
        'source', 'transfer',
        'sentByFirstName', v_row.holder_sender_first_name,
        'chatJoined', NULL, 'conversationId', NULL
      ));
    END IF;
  END LOOP;
  SELECT EXISTS (
    SELECT 1 FROM public.tickets t
     WHERE t.transfer_state = 'offered' AND t.holder_user_id IS NULL
       AND t.status = 'valid'
       AND public.account_owns_contact(
         p_user_id, t.holder_email, t.holder_phone_e164
       )
  ) INTO v_more;
  RETURN jsonb_build_object(
    'claimed', v_claimed, 'count', jsonb_array_length(v_claimed), 'more', v_more
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.pg_my_order_ticket_states(p_order_id uuid)
RETURNS TABLE(
  ticket_id uuid,
  ticket_index integer,
  transfer_state text,
  holder_first_name text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
  SELECT t.id,
         row_number() OVER (ORDER BY t.created_at, t.id)::integer,
         t.transfer_state,
         nullif(split_part(btrim(coalesce(t.holder_name, '')), ' ', 1), '')
    FROM public.tickets t
    JOIN public.orders o ON o.id = t.order_id
   WHERE t.order_id = p_order_id AND o.buyer_user_id = auth.uid()
   ORDER BY t.created_at, t.id
$function$;

CREATE OR REPLACE FUNCTION public.issue_4063_revoke_offer_on_ticket_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF OLD.status = 'valid' AND NEW.status <> 'valid'
     AND OLD.transfer_state = 'offered' THEN
    NEW.holder_user_id := NULL;
    NEW.holder_name := NULL;
    NEW.holder_email := NULL;
    NEW.holder_phone_e164 := NULL;
    NEW.holder_sender_first_name := NULL;
    NEW.transfer_state := 'none';
    NEW.transfer_offered_at := NULL;
    NEW.transfer_claimed_at := NULL;
    NEW.transfer_revoked_at := now();
    PERFORM public.issue_4063_revoke_claim_links('ticket', OLD.id);
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS issue_4063_revoke_offer_on_status ON public.tickets;
CREATE TRIGGER issue_4063_revoke_offer_on_status
BEFORE UPDATE OF status ON public.tickets
FOR EACH ROW EXECUTE FUNCTION public.issue_4063_revoke_offer_on_ticket_status();

DROP POLICY IF EXISTS "Buyer or brand team can select tickets" ON public.tickets;
CREATE POLICY "Buyer or brand team can select tickets"
ON public.tickets FOR SELECT TO authenticated USING (
  public.biz_is_brand_member_for_read(
    public.biz_event_brand_id(event_id), auth.uid()
  )
  OR holder_user_id = auth.uid()
  OR (
    EXISTS (
      SELECT 1 FROM public.orders o
       WHERE o.id = tickets.order_id AND o.buyer_user_id = auth.uid()
    )
    AND (holder_user_id IS NULL OR holder_user_id = auth.uid())
  )
);

REVOKE ALL ON FUNCTION public.pg_ticket_offer_to_friend(uuid,text,text,text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pg_ticket_offer_to_friend(uuid,text,text,text)
  TO authenticated;
REVOKE ALL ON FUNCTION public.pg_ticket_take_back(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pg_ticket_take_back(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.issue_4063_claim_offered_tickets(uuid,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4063_claim_offered_tickets(uuid,text)
  TO service_role;
REVOKE ALL ON FUNCTION public.pg_my_order_ticket_states(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pg_my_order_ticket_states(uuid) TO authenticated;

COMMIT;
