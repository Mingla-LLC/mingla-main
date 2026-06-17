-- ===========================================================================
-- META-ORCH-1148 sub-ORCH 2.2a — DEFECT-1 fix: idempotent fee finalize ⭐
-- ---------------------------------------------------------------------------
-- TESTER P1 (TEST_META-ORCH-1148_SUBC_2_2A.md, DEFECT-1): the fee-confirm path
-- was NOT idempotent on payment_intent_id. `pg_create_guest_reservation` has no
-- idempotency key and `venue-reservation-confirm` had a non-atomic TOCTOU on the
-- `reservation_checkout_sessions` row (read `pending` outside any lock, mint,
-- then a FIRE-AND-FORGET session flip). On a slot with `remaining >= 2`, a
-- double-fired / replayed / flip-failure-retried confirm minted TWO reservations
-- from ONE charge (proven live; tester T-A1).
--
-- THE FIX (mirrors the proven biz_ticket_checkout_finalize, ORCH-0921/1006):
--   1. A dedicated finalize RPC, pg_finalize_guest_reservation, takes
--      `SELECT ... FOR UPDATE` on the session row, and if it ALREADY has a linked
--      reservation_id, RETURNS that existing reservation (early-return) instead
--      of minting again — exactly like biz_ticket_checkout_finalize early-returns
--      when v_session.order_id IS NOT NULL. The mint + the session flip happen in
--      the SAME transaction (the RPC body), so the flip is no longer
--      fire-and-forget and there is no TOCTOU window. The session FOR-UPDATE lock
--      also serializes two concurrent confirms on the same session (the second
--      blocks, then sees the linked reservation_id and early-returns).
--   2. Belt-and-braces: a UNIQUE partial index on
--      reservations(payment_intent_id) WHERE payment_intent_id IS NOT NULL, so a
--      duplicate mint for the same PI is impossible at the DB layer even under a
--      race the lock somehow misses. A duplicate INSERT raises unique_violation
--      (23505) → the finalize maps it to a re-lookup of the existing row.
--
-- pg_create_guest_reservation is UNCHANGED in body/signature — the finalize RPC
-- calls it (preserving the advisory-lock double-book guard, slot re-validation,
-- capacity/deposit enforcement, currency-aware all-in, no buyer tax form) and
-- adds ONLY the session lock + early-return + atomic flip on top.
--
-- Additive-only; new function + new index; $function$ closed BEFORE each GRANT.
-- service_role ONLY (REVOKE PUBLIC + anon + authenticated). MONOTONIC VERSION
-- 20261012000005 (true global max before this = 20261012000004). Apply via the
-- Supabase Management API.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- (2) DB-level belt: one reservation per payment_intent_id. A duplicate mint
-- for the same PI is impossible even if the application logic + the session lock
-- both fail. Partial (only fee rows carry a PI; free rows are NULL → unindexed).
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS reservations_payment_intent_id_uniq
  ON public.reservations (payment_intent_id)
  WHERE payment_intent_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- (1) pg_finalize_guest_reservation — the IDEMPOTENT fee finalize (service-role).
-- Replaces the confirm fn's bare-writer-call + fire-and-forget session flip with
-- a single atomic, idempotent, session-locked transaction.
--
--   p_session_id            — the reservation_checkout_sessions row to finalize.
--   p_payment_intent_id     — the VERIFIED-succeeded PI (the edge fn verified it
--                             on the connected account before calling us). It is
--                             stamped onto the reservation as the charge link +
--                             the idempotency key.
--
-- Returns: reservation row + the session id. On ANY repeat call for an already-
-- finalized session, returns the SAME reservation (never a second mint).
-- Raises: 'slot_unavailable' (P0001) when the slot was taken between create and
-- confirm (the edge fn marks the session for refund) — propagated from the
-- writer. 'session_not_found' (P0002) for an unknown session.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pg_finalize_guest_reservation(
  p_session_id uuid,
  p_payment_intent_id text
) RETURNS TABLE (reservation public.reservations, session_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_session public.reservation_checkout_sessions;
  v_row public.reservations;
BEGIN
  IF p_session_id IS NULL OR p_payment_intent_id IS NULL
     OR btrim(p_payment_intent_id) = '' THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;

  -- Lock the session row for the duration of the txn. A concurrent confirm on
  -- the same session BLOCKS here until we commit, then re-reads the linked
  -- reservation_id below and early-returns (mirror: biz_ticket_checkout_finalize
  -- SELECT * ... FOR UPDATE).
  SELECT * INTO v_session
  FROM public.reservation_checkout_sessions
  WHERE id = p_session_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'session_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- IDEMPOTENT EARLY-RETURN: the session already minted a reservation (a prior
  -- confirm, a webhook, or a flip-failure retry that actually succeeded). Return
  -- the existing row — NEVER mint a second one for the same charge.
  IF v_session.reservation_id IS NOT NULL THEN
    SELECT * INTO v_row FROM public.reservations WHERE id = v_session.reservation_id;
    IF FOUND THEN
      reservation := v_row;
      session_id := v_session.id;
      RETURN NEXT;
      RETURN;
    END IF;
    -- Linked id points at a vanished row (should never happen) → fall through to
    -- the PI-keyed recovery below.
  END IF;

  -- IDEMPOTENT EARLY-RETURN via the PI key: a reservation already exists for this
  -- charge but the session was not yet linked (e.g. the mint committed but the
  -- prior link write lost its connection). Adopt + link it; do NOT mint again.
  -- The unique partial index guarantees at most ONE such row.
  SELECT * INTO v_row FROM public.reservations
  WHERE payment_intent_id = p_payment_intent_id
  LIMIT 1;
  IF FOUND THEN
    UPDATE public.reservation_checkout_sessions
       SET status = 'completed', reservation_id = v_row.id, updated_at = now()
     WHERE id = p_session_id;
    reservation := v_row;
    session_id := v_session.id;
    RETURN NEXT;
    RETURN;
  END IF;

  -- No existing reservation → MINT via the same atomic writer (advisory-lock
  -- double-book guard + slot re-validation + capacity/deposit enforcement all
  -- preserved). The unique partial index is the final backstop: a racing mint
  -- for the same PI raises unique_violation → we re-lookup + adopt the winner.
  BEGIN
    v_row := public.pg_create_guest_reservation(
      v_session.brand_id,
      v_session.reserved_for,
      v_session.party_size,
      CASE WHEN v_session.created_via = 'web' THEN 'website' ELSE 'mingla' END,
      CASE WHEN v_session.created_via = 'web' THEN 'guest' ELSE 'consumer' END,
      v_session.consumer_user_id,
      v_session.buyer_name,
      v_session.buyer_phone_e164,
      v_session.buyer_email,
      v_session.amount_cents,
      substr(v_session.currency, 1, 3)::char(3),
      p_payment_intent_id,
      'paid',
      v_session.guest_cancel_token,
      v_session.occasion,
      v_session.guest_notes,
      'confirmed'
    );
  EXCEPTION WHEN unique_violation THEN
    -- A concurrent mint for the same PI won the unique index. Adopt the winner.
    SELECT * INTO v_row FROM public.reservations
    WHERE payment_intent_id = p_payment_intent_id
    LIMIT 1;
    IF NOT FOUND THEN
      RAISE; -- not the PI index → re-raise.
    END IF;
  END;

  -- Link the session to the freshly-minted reservation in the SAME txn (no
  -- longer fire-and-forget — flip + mint commit together).
  UPDATE public.reservation_checkout_sessions
     SET status = 'completed', reservation_id = v_row.id, updated_at = now()
   WHERE id = p_session_id;

  reservation := v_row;
  session_id := v_session.id;
  RETURN NEXT;
END;
$function$;

-- service_role ONLY (the venue-reservation-confirm edge fn). REVOKE PUBLIC +
-- anon + authenticated (Supabase auto-grants EXECUTE to PUBLIC+anon on new fns).
REVOKE ALL ON FUNCTION public.pg_finalize_guest_reservation(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pg_finalize_guest_reservation(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.pg_finalize_guest_reservation(uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.pg_finalize_guest_reservation(uuid, text) TO service_role;

COMMENT ON FUNCTION public.pg_finalize_guest_reservation(uuid, text) IS
  'META-ORCH-1148 2.2a DEFECT-1 fix: idempotent fee finalize. Locks the reservation_checkout_sessions row FOR UPDATE, early-returns the existing reservation if already linked (or already minted for this payment_intent_id), else mints via pg_create_guest_reservation + links the session in ONE txn. Exactly one reservation per charge. Mirrors biz_ticket_checkout_finalize. service_role only.';

COMMIT;
