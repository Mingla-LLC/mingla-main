-- ============================================================
-- Fix pairing constraints found during testing
-- ============================================================

-- CRIT-002: Add unique index for paired_user_id on person_card_impressions
-- The get-person-hero-cards edge function upserts impressions with
-- onConflict: "user_id,paired_user_id,card_pool_id" but no such index existed.
CREATE UNIQUE INDEX IF NOT EXISTS idx_person_card_impressions_paired_user
    ON person_card_impressions (user_id, paired_user_id, card_pool_id)
    WHERE paired_user_id IS NOT NULL;

-- HIGH-003: Replace unconditional UNIQUE on pair_requests(sender_id, receiver_id)
-- with a partial unique index that only constrains active rows (pending/accepted).
-- Without this, unpairing and re-pairing is impossible because the old 'unpaired'
-- row still holds the unique constraint.
ALTER TABLE pair_requests DROP CONSTRAINT IF EXISTS pair_requests_unique_pending;

-- Partial unique index: only one pending or accepted pair request per sender-receiver pair
CREATE UNIQUE INDEX IF NOT EXISTS idx_pair_requests_unique_active
    ON pair_requests (sender_id, receiver_id)
    WHERE status IN ('pending', 'accepted');
