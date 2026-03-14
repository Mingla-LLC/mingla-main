-- ============================================================
-- Pairing Feature: Core Tables
-- ============================================================

-- pair_requests: tracks pair request lifecycle across 3 tiers
CREATE TABLE pair_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    receiver_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled', 'unpaired')),
    visibility TEXT NOT NULL DEFAULT 'visible'
        CHECK (visibility IN ('visible', 'hidden_until_friend')),
    gated_by_friend_request_id UUID REFERENCES friend_requests(id) ON DELETE SET NULL,
    pending_display_name TEXT,
    pending_phone_e164 TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pair_requests_no_self_pair CHECK (sender_id != receiver_id),
    CONSTRAINT pair_requests_unique_pending UNIQUE (sender_id, receiver_id)
);

CREATE INDEX idx_pair_requests_receiver ON pair_requests(receiver_id) WHERE status = 'pending';
CREATE INDEX idx_pair_requests_sender ON pair_requests(sender_id);
CREATE INDEX idx_pair_requests_gated ON pair_requests(gated_by_friend_request_id)
    WHERE visibility = 'hidden_until_friend';

ALTER TABLE pair_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own pair requests"
    ON pair_requests FOR SELECT
    USING (auth.uid() = sender_id OR auth.uid() = receiver_id);

CREATE POLICY "Users can create pair requests"
    ON pair_requests FOR INSERT
    WITH CHECK (auth.uid() = sender_id AND status = 'pending');

CREATE POLICY "Sender can cancel their pair requests"
    ON pair_requests FOR UPDATE
    USING (auth.uid() = sender_id)
    WITH CHECK (status IN ('cancelled'));

CREATE POLICY "Receiver can accept or decline visible pair requests"
    ON pair_requests FOR UPDATE
    USING (auth.uid() = receiver_id AND visibility = 'visible')
    WITH CHECK (status IN ('accepted', 'declined'));

-- Use existing update_updated_at_column() function instead of moddatetime
DROP TRIGGER IF EXISTS pair_requests_updated_at ON pair_requests;
CREATE TRIGGER pair_requests_updated_at
    BEFORE UPDATE ON pair_requests
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Trigger: When a friend request is accepted, reveal hidden pair requests
CREATE OR REPLACE FUNCTION reveal_pair_requests_on_friend_accept()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'accepted' AND OLD.status = 'pending' THEN
        UPDATE pair_requests
        SET visibility = 'visible', updated_at = now()
        WHERE gated_by_friend_request_id = NEW.id
          AND visibility = 'hidden_until_friend'
          AND status = 'pending';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_friend_accept_reveal_pair_requests
    AFTER UPDATE OF status ON friend_requests
    FOR EACH ROW EXECUTE FUNCTION reveal_pair_requests_on_friend_accept();

-- pairings: active bidirectional pairings
CREATE TABLE pairings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_a_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    user_b_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    pair_request_id UUID NOT NULL REFERENCES pair_requests(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pairings_no_self CHECK (user_a_id != user_b_id),
    CONSTRAINT pairings_unique UNIQUE (user_a_id, user_b_id),
    CONSTRAINT pairings_ordered CHECK (user_a_id < user_b_id)
);

CREATE INDEX idx_pairings_user_a ON pairings(user_a_id);
CREATE INDEX idx_pairings_user_b ON pairings(user_b_id);

ALTER TABLE pairings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own pairings"
    ON pairings FOR SELECT
    USING (auth.uid() = user_a_id OR auth.uid() = user_b_id);

CREATE POLICY "Users can delete their own pairings (unpair)"
    ON pairings FOR DELETE
    USING (auth.uid() = user_a_id OR auth.uid() = user_b_id);
