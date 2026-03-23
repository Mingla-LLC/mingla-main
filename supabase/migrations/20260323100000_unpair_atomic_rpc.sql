-- ============================================================
-- Pass 9: Atomic unpair RPC
-- Mirrors accept_pair_request_atomic pattern: SECURITY DEFINER
-- bypasses RLS to allow both sender and receiver to unpair.
-- ============================================================

CREATE OR REPLACE FUNCTION unpair_atomic(p_pairing_id UUID)
RETURNS JSON AS $$
DECLARE
    v_pairing pairings%ROWTYPE;
BEGIN
    -- Lock the pairing row and verify the caller is one of the paired users
    SELECT * INTO v_pairing
    FROM pairings
    WHERE id = p_pairing_id
      AND (user_a_id = auth.uid() OR user_b_id = auth.uid())
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pairing not found or not authorized';
    END IF;

    -- Mark the associated pair_request as 'unpaired'
    -- (must happen BEFORE deleting pairings, because pairings.pair_request_id
    -- has ON DELETE CASCADE from pair_requests — but we want to UPDATE, not delete)
    IF v_pairing.pair_request_id IS NOT NULL THEN
        UPDATE pair_requests
        SET status = 'unpaired', updated_at = now()
        WHERE id = v_pairing.pair_request_id;
    END IF;

    -- Delete the pairing row
    -- CASCADE automatically handles:
    --   custom_holidays.pairing_id → ON DELETE CASCADE
    --   archived_holidays.pairing_id → ON DELETE CASCADE
    DELETE FROM pairings WHERE id = p_pairing_id;

    RETURN json_build_object(
        'success', true,
        'pair_request_id', v_pairing.pair_request_id
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
