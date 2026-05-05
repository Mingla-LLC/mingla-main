-- ============================================================
-- Pairing Feature: Pending Pair Invites (Tier 3 — non-Mingla users)
-- ============================================================

CREATE TABLE pending_pair_invites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inviter_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    phone_e164 TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'converted', 'cancelled')),
    converted_user_id UUID REFERENCES auth.users(id),
    converted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pending_pair_invites_unique UNIQUE (inviter_id, phone_e164)
);

ALTER TABLE pending_pair_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own pending pair invites"
    ON pending_pair_invites FOR SELECT
    USING (auth.uid() = inviter_id);

CREATE POLICY "Users can create pending pair invites"
    ON pending_pair_invites FOR INSERT
    WITH CHECK (auth.uid() = inviter_id AND status = 'pending');

CREATE POLICY "Users can cancel their own pending pair invites"
    ON pending_pair_invites FOR UPDATE
    USING (auth.uid() = inviter_id)
    WITH CHECK (status = 'cancelled');

-- Auto-conversion trigger: when a user verifies their phone,
-- convert matching pending_pair_invites into BOTH a friend_request AND a pair_request
CREATE OR REPLACE FUNCTION convert_pending_pair_invites_on_phone_verified()
RETURNS TRIGGER AS $$
DECLARE
    v_invite RECORD;
    v_friend_request_id UUID;
BEGIN
    IF NEW.phone IS NOT NULL AND (OLD.phone IS NULL OR OLD.phone != NEW.phone) THEN
        FOR v_invite IN
            SELECT * FROM pending_pair_invites
            WHERE phone_e164 = NEW.phone AND status = 'pending'
        LOOP
            -- Step 1: Create friend request (if not already exists)
            INSERT INTO friend_requests (sender_id, receiver_id, status)
            VALUES (v_invite.inviter_id, NEW.id, 'pending')
            ON CONFLICT (sender_id, receiver_id) DO NOTHING
            RETURNING id INTO v_friend_request_id;

            -- If friend request already existed, look it up
            IF v_friend_request_id IS NULL THEN
                SELECT id INTO v_friend_request_id
                FROM friend_requests
                WHERE sender_id = v_invite.inviter_id AND receiver_id = NEW.id;
            END IF;

            -- Step 2: Create pair request, hidden until friend request is accepted
            INSERT INTO pair_requests (
                sender_id, receiver_id, status, visibility,
                gated_by_friend_request_id, pending_display_name, pending_phone_e164
            )
            VALUES (
                v_invite.inviter_id, NEW.id, 'pending', 'hidden_until_friend',
                v_friend_request_id, NULL, v_invite.phone_e164
            )
            ON CONFLICT (sender_id, receiver_id) DO NOTHING;

            -- Step 3: Mark invite as converted
            UPDATE pending_pair_invites
            SET status = 'converted', converted_user_id = NEW.id, converted_at = now()
            WHERE id = v_invite.id;
        END LOOP;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_phone_verified_convert_pair_invites
    AFTER UPDATE OF phone ON profiles
    FOR EACH ROW EXECUTE FUNCTION convert_pending_pair_invites_on_phone_verified();
