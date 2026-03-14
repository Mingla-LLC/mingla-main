-- ============================================================
-- Pairing Feature: Atomic accept pair request RPC
-- ============================================================

CREATE OR REPLACE FUNCTION accept_pair_request_atomic(p_request_id UUID)
RETURNS JSON AS $$
DECLARE
    v_request pair_requests%ROWTYPE;
    v_pairing_id UUID;
    v_user_a UUID;
    v_user_b UUID;
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

    -- Update request status
    UPDATE pair_requests SET status = 'accepted', updated_at = now()
    WHERE id = p_request_id;

    -- Canonical ordering for pairings table
    IF v_request.sender_id < v_request.receiver_id THEN
        v_user_a := v_request.sender_id;
        v_user_b := v_request.receiver_id;
    ELSE
        v_user_a := v_request.receiver_id;
        v_user_b := v_request.sender_id;
    END IF;

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
$$ LANGUAGE plpgsql SECURITY DEFINER;
