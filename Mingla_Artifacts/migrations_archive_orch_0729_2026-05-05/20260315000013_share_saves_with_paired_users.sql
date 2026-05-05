-- ============================================================
-- Split saved_card ALL policy into operation-specific policies
-- and add paired-user SELECT access
-- ============================================================

-- Drop the existing ALL policy
DROP POLICY IF EXISTS "Users can manage their saved cards" ON saved_card;

-- Owner: SELECT
CREATE POLICY "Owner can select saved cards"
  ON saved_card FOR SELECT
  USING (auth.uid() = profile_id);

-- Owner: INSERT
CREATE POLICY "Owner can insert saved cards"
  ON saved_card FOR INSERT
  WITH CHECK (auth.uid() = profile_id);

-- Owner: UPDATE
CREATE POLICY "Owner can update saved cards"
  ON saved_card FOR UPDATE
  USING (auth.uid() = profile_id)
  WITH CHECK (auth.uid() = profile_id);

-- Owner: DELETE
CREATE POLICY "Owner can delete saved cards"
  ON saved_card FOR DELETE
  USING (auth.uid() = profile_id);

-- Paired users can view each other's saves
CREATE POLICY "Paired users can view saved cards"
  ON saved_card FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM pairings
      WHERE (user_a_id = auth.uid() AND user_b_id = saved_card.profile_id)
         OR (user_b_id = auth.uid() AND user_a_id = saved_card.profile_id)
    )
  );
