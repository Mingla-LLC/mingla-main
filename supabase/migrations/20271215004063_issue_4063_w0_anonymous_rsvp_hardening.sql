BEGIN;
SET LOCAL lock_timeout = '10s';

-- #4063 Wave 0: tighten anonymous RSVP submissions and the RSVP link.
-- Re-emits the current submit_event_rsvp body in place and preserves its
-- signature, grants, lifecycle gates, phone authority, capacity semantics,
-- delivery wrapper, and signed-in update path.

DO $guard$
BEGIN
  IF to_regprocedure('public.account_owns_contact(uuid,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'issue_4063_w0_contact_authority_already_exists';
  END IF;
  IF md5(pg_get_functiondef(
       'public.account_owns_order_contact(uuid,uuid)'::regprocedure
     )) <> '1d208302e52e80111596b7af0c3fc61f' THEN
    RAISE EXCEPTION 'issue_4063_w0_order_contact_source_drift';
  END IF;
  IF md5(pg_get_functiondef(
       'public.account_carries_order_email(uuid,uuid)'::regprocedure
     )) <> '85c5dab10d4d1fc16b6572c73ff99f36' THEN
    RAISE EXCEPTION 'issue_4063_w0_order_email_source_drift';
  END IF;
  IF md5(pg_get_functiondef(
       'public.claim_attendance_internal_v2(uuid,text,uuid,uuid,bytea,bytea)'::regprocedure
     )) <> 'a34e9069d006cc14b2b2b4422d332214' THEN
    RAISE EXCEPTION 'issue_4063_w0_claim_source_drift';
  END IF;
  IF md5(pg_get_functiondef(
       'public.submit_event_rsvp(uuid,uuid,text,text,text,text,integer,jsonb,text,text)'::regprocedure
     )) <> '3810b4f9ee2d8faeb9f2b373959b0756' THEN
    RAISE EXCEPTION 'issue_4063_w0_submit_source_drift';
  END IF;
END
$guard$;

-- Move the raw-contact ownership authority forward from Wave 1 so the RSVP
-- link can use the same proof rule as ticket links. Wave 1 extends this one
-- function with extra contacts; it does not create a second predicate.
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

  -- PHONE ARM — EITHER OF TWO PROOFS, and both are a code received at that
  -- number. See the block comment above for why the GoTrue arm is a proof on
  -- this project and why the email equivalent is not.
  IF v_phone ~ '^\+[1-9][0-9]{1,14}$' THEN
    -- (i) OUR OWN LEDGER. Service-role only, written by `record_verified_phone`
    -- and by nothing else, after Twilio Verify returns `approved`. Present on
    -- every database, including the CI image that has no auth schema to read.
    IF EXISTS (
      SELECT 1 FROM public.verified_phone_identities v
       WHERE v.user_id = p_user_id AND v.phone_e164 = v_phone
    ) THEN
      RETURN true;
    END IF;
    -- (ii) THE GoTrue PHONE IDENTITY, normalised to E.164 exactly as
    -- `verified_account_identifiers` normalises it, so the reachability reader
    -- and this one cannot disagree about which number an identity carries.
    IF to_regclass('auth.identities') IS NOT NULL THEN
      -- `auth.users.phone` is absent from the stock CI image and added by the
      -- lanes that need it, so the column is read only where it exists — the
      -- same fail-closed idiom the email arm uses for its two timestamps.
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
  -- No GoTrue on this database: the email arm has no evidence to read, so it
  -- answers false rather than guessing.
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

  -- EMAIL ARM (b) — a code or link was read out of THIS mailbox.
  IF to_regclass('auth.mfa_amr_claims') IS NULL
     OR to_regclass('auth.sessions') IS NULL THEN
    RETURN false;
  END IF;
  -- The binding below needs two timestamps. If a database has the tables but
  -- not the columns, the proof cannot be bound to an address and this arm must
  -- not answer at all — the same fail-closed rule as a missing table.
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
              -- THE PROOF IS BOUND TO THE ADDRESS IT PROVED. See the block
              -- comment above: an amr row records the METHOD and never the
              -- ADDRESS, so without this a code read honestly at the
              -- attacker's own mailbox, followed by an address change, vouches
              -- for a mailbox it never touched. A session that predates the
              -- identity's last change cannot speak for the address that
              -- identity now carries. NULL on either side is NOT a pass.
              AND s.created_at >= i.updated_at
         )
    )
  $ev$ INTO v_proved USING p_user_id, v_email;
  RETURN coalesce(v_proved, false);
END;
$function$;

COMMENT ON FUNCTION public.account_owns_contact(uuid, text, text) IS
  '#4063: THE single ownership predicate for orders, RSVPs, plus-ones, reservations and stays. Requires positive evidence that the contact was reached and fails closed when proof tables are absent. account_owns_order_contact delegates here. No other function may re-express this rule.';

REVOKE ALL ON FUNCTION public.account_owns_contact(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.account_owns_contact(uuid, text, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.account_owns_order_contact(
  p_user_id uuid,
  p_order_id uuid
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
BEGIN
  IF p_user_id IS NULL OR p_order_id IS NULL THEN RETURN false; END IF;
  SELECT o.buyer_email, o.buyer_phone_e164
    INTO v_email, v_phone
    FROM public.orders o
   WHERE o.id = p_order_id;
  IF NOT FOUND THEN RETURN false; END IF;
  RETURN public.account_owns_contact(p_user_id, v_email, v_phone);
END;
$function$;

COMMENT ON FUNCTION public.account_owns_order_contact(uuid, uuid) IS
  '#3524 + #4063: order-contact compatibility wrapper. Delegates every ownership decision to public.account_owns_contact; it contains no second proof rule.';

REVOKE ALL ON FUNCTION public.account_owns_order_contact(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.account_owns_order_contact(uuid, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.account_carries_email(
  p_user_id uuid,
  p_email text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_email text;
  v_same boolean := false;
BEGIN
  IF p_user_id IS NULL THEN RETURN false; END IF;
  v_email := lower(btrim(coalesce(p_email, '')));
  IF v_email = '' THEN RETURN false; END IF;
  EXECUTE $ev$
    SELECT EXISTS (
      SELECT 1 FROM auth.users u
       WHERE u.id = $1 AND lower(btrim(coalesce(u.email, ''))) = $2
    )
  $ev$ INTO v_same USING p_user_id, v_email;
  RETURN coalesce(v_same, false);
END;
$function$;

COMMENT ON FUNCTION public.account_carries_email(uuid, text) IS
  '#4063: whether an email contact is this account''s own email address. Chooses a truthful refusal after account_owns_contact already refused. It is not ownership proof and grants no claim.';

REVOKE ALL ON FUNCTION public.account_carries_email(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.account_carries_email(uuid, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.account_carries_order_email(
  p_user_id uuid,
  p_order_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_email text;
BEGIN
  IF p_user_id IS NULL OR p_order_id IS NULL THEN RETURN false; END IF;
  SELECT o.buyer_email INTO v_email
    FROM public.orders o
   WHERE o.id = p_order_id;
  IF NOT FOUND THEN RETURN false; END IF;
  RETURN public.account_carries_email(p_user_id, v_email);
END;
$function$;

COMMENT ON FUNCTION public.account_carries_order_email(uuid, uuid) IS
  '#3524 + #4063: order-email compatibility wrapper. Delegates the refusal-only comparison to public.account_carries_email; it grants no claim.';

REVOKE ALL ON FUNCTION public.account_carries_order_email(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.account_carries_order_email(uuid, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.claim_attendance_internal_v2(
  p_user_id uuid,
  p_kind text,
  p_event_id uuid,
  p_source_id uuid,
  p_current_proof_digest bytea,
  p_legacy_proof_digest bytea DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
   WHERE e.id = p_event_id
     AND e.visibility = 'public' AND e.deleted_at IS NULL
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

COMMENT ON FUNCTION public.claim_attendance_internal_v2(
  uuid, text, uuid, uuid, bytea, bytea) IS
  '#3524 + #4063: order and RSVP links require public.account_owns_contact before any ownership write. Refusals consume nothing. Successful orders keep expiry, recovery retirement, and chat behavior; successful RSVPs keep their conflict guard.';

REVOKE ALL ON FUNCTION public.claim_attendance_internal_v2(
  uuid, text, uuid, uuid, bytea, bytea) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_attendance_internal_v2(
  uuid, text, uuid, uuid, bytea, bytea) TO service_role;

CREATE OR REPLACE FUNCTION public.submit_event_rsvp(
  p_event_id   uuid,
  p_user_id    uuid,
  p_guest_name text,
  p_guest_email text,
  p_guest_phone text,
  p_rsvp_status text,
  p_plus_count  integer DEFAULT 0,
  p_guests      jsonb   DEFAULT '[]'::jsonb,
  p_qr_token_pepper text DEFAULT NULL,
  p_guest_phone_country_iso text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_event       public.events%ROWTYPE;
  v_master_count integer;
  v_master_end_at timestamptz;
  v_plus        integer;
  v_confirmed   integer;
  v_status      text;
  v_approval    text;
  v_name        text;
  v_existing_id uuid;
  v_guest       jsonb;
  v_guest_id    uuid;
  v_gname       text;
  v_gemail      text;
  v_gphone      text;
  v_gphone_country_iso text;
  v_token_hash  text;
  v_qr          text;
  v_primary_qr  text;
BEGIN
  -- 1. Load + gate the event (FOR UPDATE serializes concurrent submits).
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND
     OR v_event.event_type <> 'rsvp'
     OR v_event.status NOT IN ('scheduled', 'live')
     OR v_event.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'rsvp_not_open';
  END IF;

  -- #1902: preserve the deployed authoritative acquisition boundary. This
  -- precedes every validation, capacity, identity, guest, pass, and delivery write.
  SELECT count(*)::integer, max(ed.end_at)
    INTO v_master_count, v_master_end_at
    FROM public.event_dates ed
   WHERE ed.event_id = p_event_id
     AND ed.is_master IS TRUE;

  IF v_master_count <> 1 OR v_master_end_at IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P1902',
      MESSAGE = 'rsvp_date_unavailable';
  END IF;

  IF v_master_end_at <= clock_timestamp() THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P1901',
      MESSAGE = 'rsvp_event_ended';
  END IF;

  IF p_rsvp_status NOT IN ('going', 'not_going', 'maybe') THEN
    RAISE EXCEPTION 'rsvp_status_invalid';
  END IF;

  -- 2. Contact gate for link guests (anon — no user_id).
  v_name := NULLIF(btrim(COALESCE(p_guest_name, '')), '');
  IF p_user_id IS NULL THEN
    IF v_name IS NULL
       OR NULLIF(btrim(COALESCE(p_guest_email, '')), '') IS NULL
       OR NULLIF(btrim(COALESCE(p_guest_phone, '')), '') IS NULL THEN
      RAISE EXCEPTION 'rsvp_contact_required';
    END IF;
  END IF;
  IF v_name IS NULL THEN
    v_name := COALESCE(NULLIF(btrim(p_guest_email), ''), 'Guest');
  END IF;

  -- #1857: changed writers accept only strict E.164 and explicit ISO provenance.
  IF NULLIF(btrim(COALESCE(p_guest_phone, '')), '') IS NOT NULL
     AND btrim(p_guest_phone) !~ '^\+[1-9][0-9]{7,14}$' THEN
    RAISE EXCEPTION 'rsvp_phone_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_guest_phone_country_iso IS NOT NULL
     AND p_guest_phone_country_iso !~ '^[A-Z]{2}$' THEN
    RAISE EXCEPTION 'rsvp_phone_country_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_guest_phone_country_iso IS NOT NULL
     AND NULLIF(btrim(COALESCE(p_guest_phone, '')), '') IS NULL THEN
    RAISE EXCEPTION 'rsvp_phone_country_without_phone' USING ERRCODE = '22023';
  END IF;

  -- #4063 W0: an anonymous submission never changes an RSVP that already exists for that email.
  IF p_user_id IS NULL AND EXISTS (
    SELECT 1
      FROM public.event_rsvps r
     WHERE r.event_id = p_event_id
       AND lower(btrim(r.guest_email)) = lower(btrim(p_guest_email))
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P4063',
      MESSAGE = 'rsvp_already_exists';
  END IF;

  -- 3. Clamp plus_count.
  v_plus := GREATEST(COALESCE(p_plus_count, 0), 0);
  IF v_event.rsvp_allow_plus_ones THEN
    v_plus := LEAST(v_plus, v_event.rsvp_plus_ones_max);
  ELSE
    v_plus := 0;
  END IF;

  -- 3b. Per-guest validation (§H.4 / §H.6). For not_going force no plus-ones; for
  --     going/maybe the guest array length must equal the clamped plus_count and
  --     every element must carry a non-empty name/email/phone.
  IF p_rsvp_status = 'not_going' THEN
    p_guests := '[]'::jsonb;
    v_plus := 0;
  ELSE
    IF jsonb_typeof(COALESCE(p_guests, '[]'::jsonb)) <> 'array' THEN
      p_guests := '[]'::jsonb;
    END IF;
    IF jsonb_array_length(COALESCE(p_guests, '[]'::jsonb)) <> v_plus THEN
      RAISE EXCEPTION 'rsvp_guest_count_mismatch';
    END IF;
    FOR v_guest IN SELECT * FROM jsonb_array_elements(COALESCE(p_guests, '[]'::jsonb)) LOOP
      IF v_guest - ARRAY['name','email','phone','phoneCountryIso'] <> '{}'::jsonb THEN
        RAISE EXCEPTION 'rsvp_guest_keys_invalid' USING ERRCODE = '22023';
      END IF;
      IF NULLIF(btrim(COALESCE(v_guest->>'name', '')), '') IS NULL
         OR NULLIF(btrim(COALESCE(v_guest->>'email', '')), '') IS NULL
         OR NULLIF(btrim(COALESCE(v_guest->>'phone', '')), '') IS NULL THEN
        RAISE EXCEPTION 'rsvp_guest_contact_required';
      END IF;
      IF btrim(v_guest->>'phone') !~ '^\+[1-9][0-9]{7,14}$' THEN
        RAISE EXCEPTION 'rsvp_guest_phone_invalid' USING ERRCODE = '22023';
      END IF;
      IF v_guest ? 'phoneCountryIso'
         AND jsonb_typeof(v_guest->'phoneCountryIso') <> 'null'
         AND (jsonb_typeof(v_guest->'phoneCountryIso') <> 'string'
           OR (v_guest->>'phoneCountryIso') !~ '^[A-Z]{2}$') THEN
        RAISE EXCEPTION 'rsvp_guest_phone_country_invalid' USING ERRCODE = '22023';
      END IF;
    END LOOP;
  END IF;

  -- 4. Resolve approval + attendance (UNCHANGED from ORCH-1150 maybe version).
  v_approval := CASE WHEN v_event.rsvp_approval_mode = 'manual' THEN 'pending' ELSE 'approved' END;

  IF p_rsvp_status = 'not_going' THEN
    v_status := 'not_going';
  ELSIF p_rsvp_status = 'maybe' THEN
    v_status := 'maybe';
    v_approval := 'approved';
  ELSIF v_event.rsvp_capacity IS NULL THEN
    v_status := 'going';
  ELSE
    SELECT COALESCE(SUM(1 + r.plus_count), 0) INTO v_confirmed
      FROM public.event_rsvps r
     WHERE r.event_id = p_event_id
       AND r.rsvp_status = 'going' AND r.approval_status = 'approved'
       AND (p_user_id IS NULL OR r.user_id IS DISTINCT FROM p_user_id);
    IF (v_confirmed + 1 + v_plus) > v_event.rsvp_capacity THEN
      IF v_event.rsvp_approval_mode = 'manual' THEN
        v_status := 'going';
      ELSIF v_event.rsvp_waitlist_enabled THEN
        v_status := 'waitlisted';
        v_approval := 'approved';
      ELSE
        RAISE EXCEPTION 'rsvp_full';
      END IF;
    ELSE
      v_status := 'going';
    END IF;
  END IF;

  -- 5. UPSERT the parent row.
  IF p_user_id IS NOT NULL THEN
    SELECT id INTO v_existing_id FROM public.event_rsvps
     WHERE event_id = p_event_id AND user_id = p_user_id;
  ELSIF NULLIF(btrim(COALESCE(p_guest_email, '')), '') IS NOT NULL THEN
    SELECT id INTO v_existing_id FROM public.event_rsvps
     WHERE event_id = p_event_id AND lower(guest_email) = lower(btrim(p_guest_email));
  END IF;

  IF v_existing_id IS NOT NULL THEN
    UPDATE public.event_rsvps
       SET rsvp_status = v_status,
           approval_status = v_approval,
           plus_count = v_plus,
           guest_name = v_name,
           guest_email = COALESCE(NULLIF(btrim(p_guest_email), ''), guest_email),
           guest_phone = COALESCE(NULLIF(btrim(p_guest_phone), ''), guest_phone),
           guest_phone_country_iso = CASE WHEN NULLIF(btrim(COALESCE(p_guest_phone, '')), '') IS NULL THEN guest_phone_country_iso ELSE p_guest_phone_country_iso END,
           waitlisted_at = CASE WHEN v_status = 'waitlisted' THEN COALESCE(waitlisted_at, now()) ELSE NULL END
     WHERE id = v_existing_id;
  ELSE
    INSERT INTO public.event_rsvps
      (event_id, user_id, guest_name, guest_email, guest_phone, guest_phone_country_iso,
       rsvp_status, approval_status, plus_count, waitlisted_at)
    VALUES
      (p_event_id, p_user_id, v_name,
       NULLIF(btrim(p_guest_email), ''), NULLIF(btrim(p_guest_phone), ''), p_guest_phone_country_iso,
       v_status, v_approval, v_plus,
       CASE WHEN v_status = 'waitlisted' THEN now() ELSE NULL END)
    RETURNING id INTO v_existing_id;
  END IF;

  -- 6. Per-guest child set: delete-then-insert (idempotent, consistent with
  --    plus_count). Resolve a verified account match per guest (going OR maybe).
  DELETE FROM public.event_rsvp_guests WHERE rsvp_id = v_existing_id;
  IF jsonb_array_length(COALESCE(p_guests, '[]'::jsonb)) > 0 THEN
    FOR v_guest IN SELECT * FROM jsonb_array_elements(p_guests) LOOP
      v_gname  := btrim(v_guest->>'name');
      v_gemail := btrim(v_guest->>'email');
      v_gphone := btrim(v_guest->>'phone');
      v_gphone_country_iso := NULLIF(v_guest->>'phoneCountryIso','');
      INSERT INTO public.event_rsvp_guests (rsvp_id, name, email, phone, phone_country_iso, matched_user_id)
      VALUES (
        v_existing_id, v_gname, v_gemail, v_gphone, v_gphone_country_iso,
        public.biz_resolve_verified_user(v_gemail, v_gphone)
      )
      RETURNING id INTO v_guest_id;

      -- Mint the per-guest signed pass ONLY on a going resolution.
      IF v_status = 'going' AND p_qr_token_pepper IS NOT NULL THEN
        SELECT m.token_hash, m.qr_code INTO v_token_hash, v_qr
          FROM public.biz_rsvp_mint_qr(v_guest_id, p_qr_token_pepper) m;
        UPDATE public.event_rsvp_guests
           SET qr_token_hash = v_token_hash, qr_code = v_qr
         WHERE id = v_guest_id;
      END IF;
    END LOOP;
  END IF;

  -- 7. Mint the PRIMARY's signed pass ONLY for going, idempotent on qr_token_hash.
  v_primary_qr := NULL;
  IF v_status = 'going' AND p_qr_token_pepper IS NOT NULL THEN
    SELECT qr_code INTO v_primary_qr FROM public.event_rsvps
     WHERE id = v_existing_id AND qr_token_hash IS NOT NULL;
    IF v_primary_qr IS NULL THEN
      SELECT m.token_hash, m.qr_code INTO v_token_hash, v_primary_qr
        FROM public.biz_rsvp_mint_qr(v_existing_id, p_qr_token_pepper) m;
      UPDATE public.event_rsvps
         SET qr_token_hash = v_token_hash, qr_code = v_primary_qr
       WHERE id = v_existing_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'rsvpId', v_existing_id,
    'status', v_status,
    'approvalStatus', v_approval,
    'capacityFull', (v_status = 'waitlisted'),
    'confirmationToken', v_primary_qr
  );
END;
$$;

COMMENT ON FUNCTION public.submit_event_rsvp(
  uuid, uuid, text, text, text, text, integer, jsonb, text, text
) IS '#4063: an anonymous submission never changes an RSVP that already exists for that email. I-4063-RSVP-SUBMIT-GUARD.';

REVOKE ALL ON FUNCTION public.submit_event_rsvp(
  uuid, uuid, text, text, text, text, integer, jsonb, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_event_rsvp(
  uuid, uuid, text, text, text, text, integer, jsonb, text, text
) TO service_role;

COMMIT;
