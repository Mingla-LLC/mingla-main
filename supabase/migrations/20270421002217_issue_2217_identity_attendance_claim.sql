-- Issue #2217 — connect a guest's paid ticket to the account they sign in with.
--
-- THE GAP THIS CLOSES. A guest buys as a stranger. #871 already mints a
-- single-use possession token on the confirmation screen and hands it to the
-- app through a deep link — but that token lives only in a URL fragment. A
-- buyer WITHOUT the app installed taps the link, the scheme does not resolve,
-- they land on the store, install, sign in — and the fragment is gone. They
-- arrive at an empty account holding a paid ticket that Mingla cannot see.
--
-- WHY THIS IS POSSESSION AND NOT KNOWLEDGE (#2150's rule, which #2217 restates).
-- Two independent factors must BOTH hold before a ticket moves:
--
--   1. ARMING. `attendance_identity_claim_armed_at` is written only by
--      `arm_order_identity_attendance_claim`, reachable only from the
--      `attendance-claim-link` edge function, which already refuses to act
--      without the checkout session's `buyer_status_token` — the same secret
--      #2150 chose as THE possession proof for an anonymous free reservation.
--      A stranger cannot arm somebody else's order.
--
--   2. THE CLAIMANT'S OWN VERIFIED IDENTIFIER. `claim_attendance_by_verified_identity`
--      takes NO identifier from the caller. It reads the identifiers off
--      `auth.identities` for the JWT's user id and matches those. Knowing that
--      a stranger bought with alice@example.com buys you nothing: to present
--      that identifier you must first receive a code at that mailbox or number.
--      A guessed identifier matches nothing, because the guess never reaches
--      the predicate — only the account's own provider-issued identity does.
--
-- WHY NOT `email_confirmed_at` / `phone_confirmed_at`. Measured against
-- production on 2026-08-18: `email_confirmed_at` is set on 125 of 125 users and
-- `phone_confirmed_at` on 125 of 125 — including 64 users who have NO phone at
-- all. Those two columns carry no information on this project, and a predicate
-- built on them would have turned "knows the address" into "owns the ticket".
-- `auth.identities` is used instead because only GoTrue writes it, and only
-- after a code was actually delivered (or an IdP asserted the mailbox).
--
-- WHAT DOES NOT CHANGE. A guest who never installs the app is untouched: this
-- adds a path and gates nothing. The existing token claim
-- (`claim_attendance_internal`) is not modified.
BEGIN;

-- ===========================================================================
-- (1) The arming flag.
-- ===========================================================================
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS attendance_identity_claim_armed_at timestamptz;

COMMENT ON COLUMN public.orders.attendance_identity_claim_armed_at IS
  '#2217: set ONLY by arm_order_identity_attendance_claim, reachable ONLY from the attendance-claim-link edge function, which refuses to act without the checkout session buyer_status_token. Its presence means the person who completed this checkout, on the device that completed it, asked for the ticket to follow them into the app. NULL ⇒ claim_attendance_by_verified_identity does not consider the order at all.';

-- ===========================================================================
-- (2) verified_account_identifiers — the ONE owner of "which email/phone has
--     this account actually proven it can receive mail at".
--
--     email : provider='email' identity ⇒ Supabase email OTP mailed a code and
--             the holder returned it. google/apple ⇒ the IdP asserts the
--             mailbox via identity_data.email_verified.
--     phone : provider='phone' identity only. GoTrue writes it either from its
--             own phone OTP or from verify-otp's auth.admin.updateUserById call,
--             which runs ONLY after Twilio Verify approved the code.
--
--     auth.users.phone and identity_data.phone are stored WITHOUT the leading
--     '+' (61 of 61 production rows; documented in #1529). orders.buyer_phone_e164
--     is E.164 WITH it. The '+' is restored here, once, so no caller re-derives
--     the normalization and drifts.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.verified_account_identifiers(p_user_id uuid)
RETURNS TABLE (kind text, value text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  -- FAIL CLOSED, not loudly. `auth.identities` is a GoTrue table and does NOT
  -- exist in the supabase/postgres CI image, whose auth schema is a stub — the
  -- repository-wide migration lane applies this file to exactly that image. A
  -- LANGUAGE sql body would be resolved at CREATE time and abort the whole
  -- chain there. Returning no identifiers is the safe answer in any case: no
  -- identifiers means no claim.
  IF to_regclass('auth.identities') IS NULL THEN RETURN; END IF;

  RETURN QUERY EXECUTE $sql$
    SELECT 'email'::text, lower(btrim(i.identity_data->>'email'))
      FROM auth.identities i
     WHERE i.user_id = $1
       AND btrim(coalesce(i.identity_data->>'email', '')) <> ''
       AND (
         i.provider = 'email'
         OR lower(coalesce(i.identity_data->>'email_verified', '')) IN ('true', 't')
       )
    UNION
    SELECT 'phone'::text,
           '+' || regexp_replace(
             coalesce(i.identity_data->>'phone', u.phone), '[^0-9]', '', 'g')
      FROM auth.identities i
      JOIN auth.users u ON u.id = i.user_id
     WHERE i.user_id = $1
       AND i.provider = 'phone'
       AND coalesce(i.identity_data->>'phone', u.phone) ~ '^[+]?[1-9][0-9]{1,14}$'
  $sql$ USING p_user_id;
END;
$function$;

COMMENT ON FUNCTION public.verified_account_identifiers(uuid) IS
  '#2217: the identifiers an account has PROVEN it can receive at, derived only from auth.identities (GoTrue-owned, never client-writable). Deliberately does NOT read auth.users.email_confirmed_at / phone_confirmed_at: on this project those are set for every user including 64 with no phone, so they carry no information.';

REVOKE ALL ON FUNCTION public.verified_account_identifiers(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verified_account_identifiers(uuid) TO service_role;

-- ===========================================================================
-- (3) arm_order_identity_attendance_claim — factor 1.
--     Idempotent; never re-arms a claimed order; never arms an order that is
--     not currently entitling (same eligibility predicate as #871's
--     issue_order_attendance_claim_proof).
-- ===========================================================================
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
     AND e.visibility = 'public'
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

  -- An order carrying no reachable identifier can never be claimed this way;
  -- say so rather than arming a flag that means nothing.
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

-- ===========================================================================
-- (4) claim_attendance_by_verified_identity — factor 2, and the claim itself.
--
--     TAKES NO IDENTIFIER FROM THE CALLER. That is the whole security property:
--     a guessed email cannot be presented, because there is no parameter to
--     present it in.
-- ===========================================================================
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
  v_order record;
  v_claimed jsonb := '[]'::jsonb;
BEGIN
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'invalid_claim'; END IF;

  SELECT coalesce(array_agg(value) FILTER (WHERE kind = 'email'), '{}'::text[]),
         coalesce(array_agg(value) FILTER (WHERE kind = 'phone'), '{}'::text[])
    INTO v_emails, v_phones
    FROM public.verified_account_identifiers(p_user_id);

  IF coalesce(array_length(v_emails, 1), 0) = 0
     AND coalesce(array_length(v_phones, 1), 0) = 0 THEN
    RETURN jsonb_build_object('claimed', v_claimed, 'count', 0);
  END IF;

  FOR v_order IN
    SELECT o.id, o.event_id
      FROM public.orders o
      JOIN public.events e ON e.id = o.event_id
      JOIN public.brands b ON b.id = e.brand_id
     WHERE o.buyer_user_id IS NULL
       AND o.attendance_identity_claim_armed_at IS NOT NULL
       AND (
         (btrim(coalesce(o.buyer_email, '')) <> ''
           AND lower(btrim(o.buyer_email)) = ANY (v_emails))
         OR (coalesce(o.buyer_phone_e164, '') ~ '^\+[1-9][0-9]{1,14}$'
           AND o.buyer_phone_e164 = ANY (v_phones))
       )
       AND o.payment_status IN ('paid', 'partial_refund')
       AND e.event_type IN ('event', 'trip', 'experience')
       AND e.visibility = 'public'
       AND e.deleted_at IS NULL
       AND b.deleted_at IS NULL
       AND e.status IN ('scheduled', 'live')
       AND EXISTS (
         SELECT 1 FROM public.tickets t
          WHERE t.order_id = o.id
            AND t.approval_status IN ('auto', 'approved')
            AND (
              (e.status = 'scheduled' AND t.status = 'valid') OR
              (e.status = 'live' AND t.status IN ('valid', 'used'))
            )
       )
     ORDER BY o.created_at, o.id
     LIMIT 25
  LOOP
    -- Re-decide under the row lock. Another claim (token or identity) may have
    -- taken this order between the scan and here; the buyer_user_id IS NULL
    -- predicate is the arbiter, never the scan.
    UPDATE public.orders o
       SET buyer_user_id = p_user_id,
           attendance_claim_token_digest = NULL,
           -- orders_attendance_claim_proof_state_check admits exactly three
           -- shapes. An order that never had a proof must stay all-NULL; one
           -- that has a live proof must move to consumed. This CASE is the only
           -- way to satisfy both from one statement.
           attendance_claim_token_consumed_at = CASE
             WHEN o.attendance_claim_token_created_at IS NOT NULL
               THEN coalesce(o.attendance_claim_token_consumed_at, now())
             ELSE o.attendance_claim_token_consumed_at
           END
     WHERE o.id = v_order.id AND o.buyer_user_id IS NULL;
    IF NOT FOUND THEN CONTINUE; END IF;

    -- The group chat is the second half of what the buyer was promised. Reuse
    -- the SAME helper the paid finalize path uses — never a second writer.
    PERFORM public.add_buyer_to_event_chat(
      v_order.event_id, p_user_id, v_order.id, NULL);

    -- Retire the older email-keyed pending row for this order so the two chat
    -- claim mechanisms cannot both fire for one ticket.
    UPDATE public.pending_trip_chat_claims
       SET claimed_at = now(), claimed_by_user_id = p_user_id
     WHERE order_id = v_order.id AND claimed_at IS NULL;

    v_claimed := v_claimed || jsonb_build_array(jsonb_build_object(
      'orderId', v_order.id, 'eventId', v_order.event_id));
  END LOOP;

  RETURN jsonb_build_object(
    'claimed', v_claimed,
    'count', jsonb_array_length(v_claimed));
END;
$function$;

COMMENT ON FUNCTION public.claim_attendance_by_verified_identity(uuid) IS
  '#2217: hands an ARMED, unclaimed, currently-entitling order to the account whose OWN provider-verified email/phone matches the order. Takes no identifier argument — a guessed identifier has nowhere to enter.';

REVOKE ALL ON FUNCTION public.claim_attendance_by_verified_identity(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_attendance_by_verified_identity(uuid)
  TO service_role;

-- ===========================================================================
-- (5) The other half of the acceptance line: the chat DISAPPEARS when the
--     ticket is revoked or refunded.
--
--     Before #2217 nothing ever removed a buyer from an event conversation.
--     Chat visibility is a plain participant row ("Users can view conversations
--     they participate in"), so a refunded buyer kept the chat forever. That
--     was true for every buyer, not only claimed ones; this fixes the class.
--
--     NEVER removes someone who is in the room for another reason — the
--     conversation's creator, or an active member of the event's brand team.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.drop_unentitled_buyer_from_event_chat(
  p_event_id uuid,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_conv_id uuid;
BEGIN
  IF p_event_id IS NULL OR p_user_id IS NULL THEN RETURN false; END IF;

  -- Still holds a ticket? Nothing to do. Status-agnostic on the EVENT (a
  -- ticket already scanned 'used' still entitles) but strict on the ticket.
  IF EXISTS (
    SELECT 1
      FROM public.orders o
      JOIN public.tickets t ON t.order_id = o.id
     WHERE o.event_id = p_event_id
       AND o.buyer_user_id = p_user_id
       AND o.payment_status IN ('paid', 'partial_refund')
       AND t.approval_status IN ('auto', 'approved')
       AND t.status IN ('valid', 'used')
  ) THEN RETURN false; END IF;

  SELECT c.id INTO v_conv_id
    FROM public.conversations c
   WHERE c.event_id = p_event_id
     AND c.linked_entity_type IN ('trip', 'event')
     AND c.created_by IS DISTINCT FROM p_user_id
   LIMIT 1;
  IF v_conv_id IS NULL THEN RETURN false; END IF;

  IF EXISTS (
    SELECT 1
      FROM public.events e
      JOIN public.brand_team_members btm ON btm.brand_id = e.brand_id
     WHERE e.id = p_event_id
       AND btm.user_id = p_user_id
       AND btm.accepted_at IS NOT NULL
       AND btm.removed_at IS NULL
  ) THEN RETURN false; END IF;

  DELETE FROM public.conversation_participants
   WHERE conversation_id = v_conv_id AND user_id = p_user_id;
  RETURN FOUND;
END;
$function$;

REVOKE ALL ON FUNCTION public.drop_unentitled_buyer_from_event_chat(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.drop_unentitled_buyer_from_event_chat(uuid, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.tg_drop_buyer_chat_on_order_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NEW.buyer_user_id IS NOT NULL THEN
    PERFORM public.drop_unentitled_buyer_from_event_chat(
      NEW.event_id, NEW.buyer_user_id);
  END IF;
  -- A transfer of ownership also has to re-decide the PREVIOUS owner.
  IF OLD.buyer_user_id IS NOT NULL
     AND OLD.buyer_user_id IS DISTINCT FROM NEW.buyer_user_id THEN
    PERFORM public.drop_unentitled_buyer_from_event_chat(
      OLD.event_id, OLD.buyer_user_id);
  END IF;
  RETURN NULL;
END;
$function$;

-- The WHEN clause fires ONLY in the LOSING direction. Firing on the gaining
-- direction ('pending' -> 'paid') would race the ticket rows: an order whose
-- payment_status is already 'paid' while its tickets are still being inserted
-- reads as unentitled, and the trigger would delete a participant row the
-- finalize path is about to rely on. There is no symmetric hazard here because
-- nothing about losing entitlement is written before the loss is real.
DROP TRIGGER IF EXISTS drop_buyer_chat_on_order_change ON public.orders;
CREATE TRIGGER drop_buyer_chat_on_order_change
AFTER UPDATE OF payment_status, buyer_user_id ON public.orders
FOR EACH ROW
WHEN (
  (OLD.payment_status IS DISTINCT FROM NEW.payment_status
     AND NEW.payment_status NOT IN ('paid', 'partial_refund'))
  OR (OLD.buyer_user_id IS DISTINCT FROM NEW.buyer_user_id
     AND OLD.buyer_user_id IS NOT NULL)
)
EXECUTE FUNCTION public.tg_drop_buyer_chat_on_order_change();

CREATE OR REPLACE FUNCTION public.tg_drop_buyer_chat_on_ticket_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_event_id uuid;
  v_buyer uuid;
BEGIN
  SELECT o.event_id, o.buyer_user_id INTO v_event_id, v_buyer
    FROM public.orders o WHERE o.id = NEW.order_id;
  IF v_buyer IS NOT NULL THEN
    PERFORM public.drop_unentitled_buyer_from_event_chat(v_event_id, v_buyer);
  END IF;
  RETURN NULL;
END;
$function$;

-- Losing direction only, for the same reason as the orders trigger. A scan
-- ('valid' -> 'used') is NOT a loss and must never reach the sweep.
DROP TRIGGER IF EXISTS drop_buyer_chat_on_ticket_change ON public.tickets;
CREATE TRIGGER drop_buyer_chat_on_ticket_change
AFTER UPDATE OF status, approval_status ON public.tickets
FOR EACH ROW
WHEN (
  (OLD.status IS DISTINCT FROM NEW.status
     AND NEW.status NOT IN ('valid', 'used'))
  OR (OLD.approval_status IS DISTINCT FROM NEW.approval_status
     AND NEW.approval_status NOT IN ('auto', 'approved'))
)
EXECUTE FUNCTION public.tg_drop_buyer_chat_on_ticket_change();

COMMIT;
NOTIFY pgrst, 'reload schema';
