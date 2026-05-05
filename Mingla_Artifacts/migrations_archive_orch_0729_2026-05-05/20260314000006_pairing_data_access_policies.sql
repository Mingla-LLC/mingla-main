-- ============================================================
-- Pairing Feature: RLS for paired user data access
-- ============================================================

-- Drop the existing SELECT-only policy on user_preference_learning
-- and replace with one that also allows paired users to read partner preferences.
DROP POLICY IF EXISTS "Users can view their own preferences" ON user_preference_learning;

CREATE POLICY "Users and paired users can view preferences"
    ON user_preference_learning FOR SELECT
    USING (
        auth.uid() = user_id
        OR EXISTS (
            SELECT 1 FROM pairings
            WHERE (user_a_id = auth.uid() AND user_b_id = user_preference_learning.user_id)
               OR (user_b_id = auth.uid() AND user_a_id = user_preference_learning.user_id)
        )
    );
