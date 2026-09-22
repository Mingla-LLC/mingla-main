-- Issue #3524 — a guest's ticket reaches THEIR account, and their group chat.
--
-- Three defects, one migration.
--
-- (1) THE TOKEN RAIL CHECKED NO EMAIL AT ALL. `claim_attendance_internal_v2`
--     took `p_user_id` and a digest and compared nothing else, so a forwarded
--     confirmation email handed the ticket to whoever happened to be signed in.
--     Seth's decision 1 on #3524: "a ticket only ever lands on an account that
--     has PROVED it owns the purchase email." The identity rail
--     (`claim_attendance_by_verified_identity`, #2217) already enforced exactly
--     that. This migration gives the token rail the SAME predicate — extracted
--     into `public.account_owns_order_contact` so there is exactly ONE
--     expression of it and no second writer can drift from it.
--
-- (2) THE LINK NEVER EXPIRED. Nothing tested
--     `attendance_claim_token_created_at` against a window, so a 256-bit bearer
--     credential in an email stayed live forever. It now ages out at 30 days
--     (`public.attendance_claim_token_ttl`).
--
-- (3) THE TOKEN RAIL LINKED THE TICKET AND LEFT THE GUEST OUTSIDE THE CHAT.
--     The identity rail calls `add_buyer_to_event_chat`; the token rail never
--     did. Same helper, same arguments, same order — never a second writer.
--
-- Plus the desktop→phone handoff table and its two RPCs: a desktop recipient of
-- the email gets a scannable SHORT-LIVED exchange code instead of a mobile
-- store listing, and that code is NOT the claim token.
--
-- A REFUSED CLAIM CONSUMES NOTHING. `identity_mismatch` and `expired` return
-- before any write, so the token, its generation and its digests survive and
-- the rightful account can still use the same link.
--
-- No production row is created, modified or deleted by this file. Every change
-- is a schema addition or a function replacement.

BEGIN;

-- ===========================================================================
-- (0) The claim-token lifetime, as a NAMED CONSTANT.
--
--     WHY 30 DAYS, and why the number is safe to change in one line:
--       * tickets are commonly bought weeks ahead, so the link must outlive the
--         purchase;
--       * the identity rail has NO expiry and is the durable fallback, so an
--         expired link costs the guest one sign-in and never the ticket;
--       * 30 days bounds the forwarded-email window.
--
--     GRANDFATHERING IS EXPLICIT: tokens minted before this migration are
--     governed by the same `created_at + 30 days` rule. This migration
--     invalidates no token by itself — an order whose token was minted inside
--     the window stays claimable.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.attendance_claim_token_ttl()
RETURNS interval
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $function$ SELECT interval '30 days' $function$;

COMMENT ON FUNCTION public.attendance_claim_token_ttl() IS
  '#3524: how long an emailed attendance-claim token stays live. A named constant so the number has one owner and a test can pin it. The identity rail has no expiry and is the durable fallback, so an expired link costs a guest one sign-in, never the ticket.';

REVOKE ALL ON FUNCTION public.attendance_claim_token_ttl()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attendance_claim_token_ttl() TO service_role;

-- ===========================================================================
-- (1) mask_contact_for_claim — the ONE masking rule, in SQL.
--
--     A mismatch response tells the guest WHICH mailbox to use without
--     revealing it. The TypeScript twin in
--     `supabase/functions/_shared/attendanceClaim.ts` formats an order the edge
--     function has already read; the two are pinned to the same cases by tests.
--     Neither ever emits an unmasked purchase contact.
--
--     email  alice@example.com  ->  a•••@e•••.com
--       first character of the local part, '•••', '@', the first character of
--       the FIRST domain label, '•••', then the remainder of the domain AS-IS
--       including its leading dot. A part of length 1 renders as that character
--       followed by '•••' (a@b.com -> a•••@b•••.com). A domain with no dot
--       renders with no remainder (a@localhost -> a•••@l•••).
--
--     phone  +2348012345678    ->  +234•••5678
--       '+', the first 3 digits, '•••', the last 4 digits. Fewer than 8 digits
--       renders as '+•••' and nothing else — there is not enough number left to
--       show any of it without showing most of it.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.mask_contact_for_claim(
  p_value text,
  p_channel text
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $function$
DECLARE
  v_value text := btrim(coalesce(p_value, ''));
  v_local text;
  v_domain text;
  v_label text;
  v_rest text;
  v_digits text;
  v_at integer;
  v_dot integer;
BEGIN
  IF v_value = '' THEN RETURN NULL; END IF;

  IF p_channel = 'phone' THEN
    v_digits := regexp_replace(v_value, '[^0-9]', '', 'g');
    IF length(v_digits) < 8 THEN RETURN '+•••'; END IF;
    RETURN '+' || left(v_digits, 3) || '•••' || right(v_digits, 4);
  END IF;

  IF p_channel <> 'email' THEN RETURN NULL; END IF;

  v_value := lower(v_value);
  v_at := position('@' in v_value);
  IF v_at < 2 OR v_at = length(v_value) THEN RETURN NULL; END IF;
  v_local := left(v_value, v_at - 1);
  v_domain := substr(v_value, v_at + 1);

  v_dot := position('.' in v_domain);
  IF v_dot = 0 THEN
    v_label := v_domain;
    v_rest := '';
  ELSE
    v_label := left(v_domain, v_dot - 1);
    v_rest := substr(v_domain, v_dot);
  END IF;
  IF v_label = '' THEN RETURN NULL; END IF;

  RETURN left(v_local, 1) || '•••@' || left(v_label, 1) || '•••' || v_rest;
END;
$function$;

COMMENT ON FUNCTION public.mask_contact_for_claim(text, text) IS
  '#3524: masks a purchase email or phone for an identity_mismatch response. A forwarded-email recipient learns at most a hint of an address they already received a ticket for — strictly less than the unexpiring bearer token they hold today. Twinned with maskContactForClaim in supabase/functions/_shared/attendanceClaim.ts; the two are pinned to the same cases by tests.';

REVOKE ALL ON FUNCTION public.mask_contact_for_claim(text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mask_contact_for_claim(text, text) TO service_role;

-- ===========================================================================
-- (2) account_owns_order_contact — THE identity predicate. One expression.
--
--     Both claim rails evaluate ownership through THIS function and nothing
--     else. The normalisation is the identity rail's own, unchanged:
--       email — lower(btrim(...)), non-empty;
--       phone — matched only when it satisfies '^\+[1-9][0-9]{1,14}$'.
--
--     `verified_account_identifiers` derives its answers only from
--     `auth.identities` (GoTrue-owned, never client-writable) and the
--     service-role-only `verified_phone_identities` ledger. Knowing that a
--     stranger bought with alice@example.com buys nothing: to present that
--     identifier you must first receive a code at that mailbox or number.
--
--     NEVER a second predicate. If a future reader needs this rule, they call
--     this function.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.account_owns_order_contact(
  p_user_id uuid,
  p_order_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM public.orders o
      CROSS JOIN LATERAL public.verified_account_identifiers(p_user_id) v
     WHERE o.id = p_order_id
       AND (
         (v.kind = 'email'
           AND btrim(coalesce(o.buyer_email, '')) <> ''
           AND lower(btrim(o.buyer_email)) = v.value)
         OR (v.kind = 'phone'
           AND coalesce(o.buyer_phone_e164, '') ~ '^\+[1-9][0-9]{1,14}$'
           AND o.buyer_phone_e164 = v.value)
       )
  );
$function$;

COMMENT ON FUNCTION public.account_owns_order_contact(uuid, uuid) IS
  '#3524: THE single identity predicate both claim rails use. True only when the accounts GoTrue-proved identifiers include the orders buyer_email or buyer_phone_e164, using the identity rails own normalisation. Possession of a claim link or a handoff code is necessary and never sufficient. No other function may re-express this rule.';

REVOKE ALL ON FUNCTION public.account_owns_order_contact(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.account_owns_order_contact(uuid, uuid) TO service_role;

-- ===========================================================================
-- (3) The attempt ledger learns the two new terminal outcomes.
-- ===========================================================================
ALTER TABLE public.attendance_claim_attempts
  DROP CONSTRAINT IF EXISTS attendance_claim_attempts_outcome_check;
ALTER TABLE public.attendance_claim_attempts
  ADD CONSTRAINT attendance_claim_attempts_outcome_check CHECK (
    outcome IS NULL OR outcome IN (
      'success', 'idempotent_success', 'invalid', 'ineligible',
      'conflict', 'rate_limited', 'internal_error',
      -- #3524: a claim refused because the account has not proved it owns the
      -- purchase contact, and one refused because the emailed link aged out.
      -- Both are recorded so the rate limiter still sees the attempt.
      'identity_mismatch', 'expired'
    )
  );

-- ===========================================================================
-- (4) attendance_claim_handoffs — the desktop -> phone exchange code.
--
--     WHAT THIS IS FOR. A desktop recipient of the confirmation email cannot
--     open the app. Seth's decision 5: give them a sheet with a scannable code.
--     Decision 5 point 4 forbids rendering the CLAIM TOKEN as a QR — that is a
--     ticket that can be photographed off a screen. So the QR carries a
--     separate credential that is worth ten minutes and one use.
--
--     WHAT AN ATTACKER GETS FROM A PHOTOGRAPH OF THE SCREEN: ten minutes, one
--     use, and only if they ALSO own the purchase mailbox — redemption runs the
--     same identity predicate as every other claim. After the countdown,
--     nothing.
--
--     Plaintext never reaches this table: only the HMAC digest under the same
--     governed pepper ring the claim token uses.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.attendance_claim_handoffs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind            text NOT NULL CHECK (kind IN ('order', 'rsvp')),
  event_id        uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  source_id       uuid NOT NULL,
  code_digest     bytea NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  consumed_at     timestamptz NULL,
  created_ip_hash text NULL,
  CONSTRAINT attendance_claim_handoff_digest_len CHECK (
    octet_length(code_digest) = 32),
  CONSTRAINT attendance_claim_handoff_window CHECK (expires_at > created_at),
  CONSTRAINT attendance_claim_handoff_consumed_shape CHECK (
    consumed_at IS NULL OR consumed_at >= created_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS attendance_claim_handoffs_digest_uniq
  ON public.attendance_claim_handoffs (code_digest);
CREATE INDEX IF NOT EXISTS attendance_claim_handoffs_source_idx
  ON public.attendance_claim_handoffs (source_id, created_at DESC);

COMMENT ON TABLE public.attendance_claim_handoffs IS
  '#3524: short-lived desktop->phone exchange codes for the attendance claim. Service-role only, like notification_outbox. The code is stored ONLY as an HMAC digest under the governed attendance-claim pepper ring; plaintext is returned once, in the minting response, and never logged. 10 minutes, single use, at most one live code per source.';

-- A new public table inherits anon grants and must be explicitly stripped
-- (reference_new_public_tables_inherit_anon_grants). Reads and writes are
-- service-role only and NO policy is created for anon or authenticated.
ALTER TABLE public.attendance_claim_handoffs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.attendance_claim_handoffs
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.attendance_claim_handoffs TO service_role;

-- ===========================================================================
-- (5) take_attendance_claim_handoff_attempt — 6 mints per rolling hour, per
--     source. Mirrors take_attendance_claim_link_attempt's shape: an advisory
--     lock so concurrent requests cannot all pass the count.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.take_attendance_claim_handoff_attempt(
  p_source_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_count integer;
BEGIN
  IF p_source_id IS NULL THEN RETURN false; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_source_id::text, 3524));
  SELECT count(*) INTO v_count
    FROM public.attendance_claim_handoffs
   WHERE source_id = p_source_id
     AND created_at >= now() - interval '1 hour';
  RETURN v_count < 6;
END;
$function$;

REVOKE ALL ON FUNCTION public.take_attendance_claim_handoff_attempt(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.take_attendance_claim_handoff_attempt(uuid)
  TO service_role;

-- ===========================================================================
-- (6) claim_attendance_internal_v2 — THE claim body. Replaced, not forked.
--
--     Three additions, ALL confined to the `order` arm:
--       * the 30-day expiry, after the digest comparison succeeds and before
--         the eligibility check;
--       * the identity predicate, after eligibility and before ANY write;
--       * the group-chat join, after the deliveries update, using the SAME
--         helper the identity rail and the paid finalize path use.
--
--     The `rsvp` arm is UNCHANGED. RSVP pass recovery keeps its possession
--     semantics — that is #871/#3440's product and #3524 does not touch it.
--
--     `identity_mismatch` and `expired` return BEFORE any write. The token, its
--     generation and its digests survive, so the rightful account can still use
--     the same link. Single-use consumption stays bound to the 'claimed' path.
-- ===========================================================================
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
           r.rsvp_status = 'going' AND r.approval_status = 'approved'
      INTO v_owner, v_current, v_eligible
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

  -- #3524 — THE IDENTITY PREDICATE. Order arm only, evaluated after
  -- eligibility and before any write. ONE expression, shared with the identity
  -- rail: `public.account_owns_order_contact`. Returning here consumes nothing.
  IF p_kind = 'order'
     AND NOT public.account_owns_order_contact(p_user_id, p_source_id) THEN
    IF btrim(coalesce(v_buyer_email, '')) <> '' THEN
      v_channel := 'email';
      v_masked := public.mask_contact_for_claim(v_buyer_email, 'email');
    ELSIF coalesce(v_buyer_phone, '') ~ '^\+[1-9][0-9]{1,14}$' THEN
      v_channel := 'phone';
      v_masked := public.mask_contact_for_claim(v_buyer_phone, 'phone');
    END IF;
    RETURN jsonb_build_object(
      'result', 'identity_mismatch',
      'contactMasked', v_masked,
      'contactChannel', v_channel);
  END IF;

  IF p_kind = 'rsvp' THEN
    IF EXISTS (
      SELECT 1 FROM public.event_rsvps other
       WHERE other.event_id = p_event_id AND other.user_id = p_user_id
         AND other.id <> p_source_id
    ) THEN RETURN jsonb_build_object('result', 'conflict'); END IF;
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
  -- promised. Reuse the SAME helper the paid finalize path and the identity
  -- rail use, never a second writer. It returns silently when the event type
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
  '#3524: THE claim body. Order arm additionally requires the 30-day token window and public.account_owns_order_contact, joins the event chat through add_buyer_to_event_chat, and returns chatJoined + conversationId read back after the join. identity_mismatch and expired consume nothing. The rsvp arm keeps its possession semantics unchanged.';

REVOKE ALL ON FUNCTION public.claim_attendance_internal_v2(
  uuid, text, uuid, uuid, bytea, bytea) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_attendance_internal_v2(
  uuid, text, uuid, uuid, bytea, bytea) TO service_role;

-- ===========================================================================
-- (7) mint_attendance_claim_handoff — VERIFIES, never claims.
--
--     It re-verifies the claim token against the order WITHOUT consuming it,
--     applies the same event/ticket eligibility and the same 30-day expiry, and
--     inserts the handoff row.
--
--     It does NOT apply the identity predicate. The desktop caller is by
--     definition not signed in; identity is enforced at claim time on the
--     phone, which is the only place it can be.
--
--     This is a VERIFIER, not a second copy of the claim body — it writes
--     nothing to `orders` and performs no claim. The claim body exists once, in
--     `claim_attendance_internal_v2`, and `redeem_attendance_claim_handoff`
--     calls THAT.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.mint_attendance_claim_handoff(
  p_kind text,
  p_event_id uuid,
  p_source_id uuid,
  p_current_proof_digest bytea,
  p_legacy_proof_digest bytea,
  p_code_digest bytea,
  p_ip_hash text DEFAULT NULL
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
   WHERE e.id = p_event_id
     AND e.visibility = 'public' AND e.deleted_at IS NULL
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

COMMENT ON FUNCTION public.mint_attendance_claim_handoff(
  text, uuid, uuid, bytea, bytea, bytea, text) IS
  '#3524: mints a 10-minute single-use desktop->phone handoff code. Re-verifies the claim token WITHOUT consuming it, applies the same eligibility and 30-day window, expires every prior unconsumed code for the source, and rate-limits to 6 per rolling hour. It deliberately does NOT apply the identity predicate: the desktop caller is not signed in, and identity is enforced at claim time on the phone.';

REVOKE ALL ON FUNCTION public.mint_attendance_claim_handoff(
  text, uuid, uuid, bytea, bytea, bytea, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mint_attendance_claim_handoff(
  text, uuid, uuid, bytea, bytea, bytea, text) TO service_role;

-- ===========================================================================
-- (8) redeem_attendance_claim_handoff — consumes the code, then calls THE
--     claim body. One transaction.
--
--     The claim body is NOT copied here. This function consumes the handoff and
--     then calls `claim_attendance_internal_v2` with the order's own stored
--     digests as the proof, so the expiry, the identity predicate, the write,
--     the chat join and the readback all execute in the single place they
--     exist. A second body would be a second set of rules to drift.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.redeem_attendance_claim_handoff(
  p_user_id uuid,
  p_kind text,
  p_event_id uuid,
  p_source_id uuid,
  p_code_digest bytea
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_handoff_id uuid;
  v_current bytea;
  v_legacy bytea;
BEGIN
  IF p_user_id IS NULL OR p_event_id IS NULL OR p_source_id IS NULL
     OR p_code_digest IS NULL OR octet_length(p_code_digest) <> 32
     OR p_kind NOT IN ('rsvp', 'order') THEN
    RAISE EXCEPTION 'invalid_claim';
  END IF;

  SELECT h.id INTO v_handoff_id
    FROM public.attendance_claim_handoffs h
   WHERE h.kind = p_kind
     AND h.event_id = p_event_id
     AND h.source_id = p_source_id
     AND h.consumed_at IS NULL
     AND h.expires_at > now()
     AND public.fixed_digest_equal(h.code_digest, p_code_digest)
   FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('result', 'invalid'); END IF;

  UPDATE public.attendance_claim_handoffs
     SET consumed_at = now() WHERE id = v_handoff_id;

  SELECT o.attendance_claim_token_digest,
         o.attendance_claim_legacy_token_digest
    INTO v_current, v_legacy
    FROM public.orders o
   WHERE o.id = p_source_id AND o.event_id = p_event_id;
  IF v_current IS NULL THEN
    -- The order's token is already consumed, so there is nothing left to claim.
    RETURN jsonb_build_object('result', 'invalid');
  END IF;

  RETURN public.claim_attendance_internal_v2(
    p_user_id, p_kind, p_event_id, p_source_id,
    v_current, coalesce(v_legacy, v_current));
END;
$function$;

COMMENT ON FUNCTION public.redeem_attendance_claim_handoff(
  uuid, text, uuid, uuid, bytea) IS
  '#3524: consumes a handoff code single-use and then calls claim_attendance_internal_v2 — THE claim body — so the identity predicate, the expiry, the chat join and the readback run in the one place they exist. A consumed or expired code is refused before anything else happens.';

REVOKE ALL ON FUNCTION public.redeem_attendance_claim_handoff(
  uuid, text, uuid, uuid, bytea) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_attendance_claim_handoff(
  uuid, text, uuid, uuid, bytea) TO service_role;

-- ===========================================================================
-- (9) claim_attendance_by_verified_identity — observability parity only.
--
--     Its identifier predicate is UNCHANGED and already correct. The only
--     change is that each claimed entry now carries `chatJoined`, read back
--     after the same helper call, so the silent sweep is no longer silent about
--     the half it can fail. Nothing renders it yet.
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
  v_conv uuid;
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
       AND ((btrim(coalesce(o.buyer_email, '')) <> ''
          AND lower(btrim(o.buyer_email)) = ANY (v_emails))
        OR (coalesce(o.buyer_phone_e164, '') ~ '^\+[1-9][0-9]{1,14}$'
          AND o.buyer_phone_e164 = ANY (v_phones)))
       AND o.payment_status IN ('paid', 'partial_refund')
       AND e.event_type IN ('event', 'trip', 'experience')
       AND e.visibility = 'public' AND e.deleted_at IS NULL
       AND b.deleted_at IS NULL AND e.status IN ('scheduled', 'live')
       AND EXISTS (
         SELECT 1 FROM public.tickets t
          WHERE t.order_id = o.id
            AND t.approval_status IN ('auto', 'approved')
            AND ((e.status = 'scheduled' AND t.status = 'valid')
              OR (e.status = 'live' AND t.status IN ('valid', 'used')))
       )
     ORDER BY o.created_at, o.id LIMIT 25
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
     WHERE o.id = v_order.id AND o.buyer_user_id IS NULL;
    IF NOT FOUND THEN CONTINUE; END IF;
    UPDATE public.attendance_claim_recovery_items
       SET state = 'claimed', resolved_via = 'verified_identity',
           reconciled_at = now(), updated_at = now()
     WHERE order_id = v_order.id;
    UPDATE public.attendance_claim_deliveries
       SET status = 'failed_terminal', next_attempt_at = NULL,
           lease_id = NULL, lease_expires_at = NULL,
           provider_attempt_started_at = NULL,
           last_error_code = 'claim_resolved', updated_at = now()
     WHERE source_id = v_order.id
       AND kind IN ('order_recovery_email', 'order_recovery_sms')
       AND status IN ('pending', 'processing', 'failed_retryable');
    PERFORM public.add_buyer_to_event_chat(
      v_order.event_id, p_user_id, v_order.id, NULL);
    UPDATE public.pending_trip_chat_claims
       SET claimed_at = now(), claimed_by_user_id = p_user_id
     WHERE order_id = v_order.id AND claimed_at IS NULL;
    -- #3524 R-53: read the membership back so the sweep reports the half it can
    -- fail. `add_buyer_to_event_chat` returns silently for an event type with no
    -- chat, and an `experience` legitimately has none.
    v_conv := NULL;
    SELECT c.id INTO v_conv
      FROM public.conversations c
      JOIN public.conversation_participants cp
        ON cp.conversation_id = c.id AND cp.user_id = p_user_id
     WHERE c.event_id = v_order.event_id
       AND c.linked_entity_type IN ('trip', 'event')
     LIMIT 1;
    v_claimed := v_claimed || jsonb_build_array(jsonb_build_object(
      'orderId', v_order.id, 'eventId', v_order.event_id,
      'chatJoined', v_conv IS NOT NULL, 'conversationId', v_conv));
  END LOOP;
  RETURN jsonb_build_object(
    'claimed', v_claimed, 'count', jsonb_array_length(v_claimed));
END;
$function$;

COMMENT ON FUNCTION public.claim_attendance_by_verified_identity(uuid) IS
  '#2217 + #3524: the identity rail. Its identifier predicate is unchanged and takes NO identifier from the caller. #3524 adds chatJoined + conversationId to each claimed entry, read back after add_buyer_to_event_chat, so the sweep is no longer silent about the half it can fail.';

COMMIT;
