-- ORCH-1239 — Mingla Plus gating: close the pairing-ACCEPT leak.
--
-- PROVEN LEAK: a free account could exceed max_pairings because the SEND path
-- (send-pair-request edge fn → check_pairing_allowed) was gated, but the ACCEPT
-- path (accept_pair_request_atomic) inserted into `pairings` with NO limit check.
--
-- This migration re-creates accept_pair_request_atomic, preserving ALL existing
-- behavior (request lock, status/visibility validation, status update, canonical
-- ordering, ON CONFLICT DO NOTHING idempotency, identical JSON return shape) and
-- ADDS a tier limit check BEFORE the INSERT:
--   * If a pairing between the canonical (v_user_a, v_user_b) ALREADY exists, the
--     limit check is SKIPPED entirely — an idempotent re-accept must never be
--     blocked (the row already counts toward the limit; re-blocking it is wrong).
--   * Otherwise, check_pairing_allowed() is evaluated for BOTH the sender and the
--     receiver. If EITHER is over its tier limit, the accept is rejected with the
--     SAME 'pairing_limit_reached' token the send path uses, so the client handles
--     both paths uniformly (ERRCODE P0001).
--
-- The limit NUMBERS are unchanged (max_pairings=1 for free, -1 for mingla_plus).
-- This ORCH does NOT add new product rules — it fixes the enforcement leak.
--
-- Idempotent / re-runnable: CREATE OR REPLACE only. No data mutation.

CREATE OR REPLACE FUNCTION public.accept_pair_request_atomic(p_request_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_request pair_requests%ROWTYPE;
    v_pairing_id UUID;
    v_user_a UUID;
    v_user_b UUID;
    v_pairing_exists BOOLEAN;
    v_sender_allowed BOOLEAN;
    v_receiver_allowed BOOLEAN;
BEGIN
    -- Lock the request row
    SELECT * INTO v_request
    FROM pair_requests
    WHERE id = p_request_id AND receiver_id = auth.uid()
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pair request not found or not authorized';
    END IF;

    IF v_request.status != 'pending' THEN
        RAISE EXCEPTION 'Pair request is no longer pending (status: %)', v_request.status;
    END IF;

    IF v_request.visibility != 'visible' THEN
        RAISE EXCEPTION 'Pair request is not yet visible';
    END IF;

    -- Canonical ordering for pairings table
    IF v_request.sender_id < v_request.receiver_id THEN
        v_user_a := v_request.sender_id;
        v_user_b := v_request.receiver_id;
    ELSE
        v_user_a := v_request.receiver_id;
        v_user_b := v_request.sender_id;
    END IF;

    -- ── ORCH-1239 TIER GATING: close the accept-path pairing leak ────────────
    -- Short-circuit FIRST on an already-existing pairing so an idempotent
    -- re-accept is NEVER blocked by the limit (the row already counts).
    SELECT EXISTS (
        SELECT 1 FROM pairings
        WHERE user_a_id = v_user_a AND user_b_id = v_user_b
    ) INTO v_pairing_exists;

    IF NOT v_pairing_exists THEN
        -- New pairing — BOTH participants must be under their tier limit.
        SELECT allowed INTO v_sender_allowed
        FROM check_pairing_allowed(v_request.sender_id);

        SELECT allowed INTO v_receiver_allowed
        FROM check_pairing_allowed(v_request.receiver_id);

        IF NOT v_sender_allowed THEN
            RAISE EXCEPTION 'pairing_limit_reached: % has reached the pairing limit', v_request.sender_id
              USING ERRCODE = 'P0001';
        END IF;

        IF NOT v_receiver_allowed THEN
            RAISE EXCEPTION 'pairing_limit_reached: % has reached the pairing limit', v_request.receiver_id
              USING ERRCODE = 'P0001';
        END IF;
    END IF;

    -- Update request status
    UPDATE pair_requests SET status = 'accepted', updated_at = now()
    WHERE id = p_request_id;

    -- Create pairing (ignore if already exists — idempotent)
    INSERT INTO pairings (user_a_id, user_b_id, pair_request_id)
    VALUES (v_user_a, v_user_b, v_request.id)
    ON CONFLICT (user_a_id, user_b_id) DO NOTHING
    RETURNING id INTO v_pairing_id;

    RETURN json_build_object(
        'pairing_id', v_pairing_id,
        'paired_with_user_id', v_request.sender_id
    );
END;
$function$;
