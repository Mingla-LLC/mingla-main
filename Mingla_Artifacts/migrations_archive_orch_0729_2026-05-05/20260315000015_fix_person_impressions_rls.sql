-- ============================================================
-- Add RLS policy for paired users to view shared person_card_impressions
-- ============================================================

CREATE POLICY "Paired users can view shared impressions"
  ON public.person_card_impressions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM pairings
      WHERE (user_a_id = auth.uid() AND user_b_id = person_card_impressions.user_id)
         OR (user_b_id = auth.uid() AND user_a_id = person_card_impressions.user_id)
    )
  );
