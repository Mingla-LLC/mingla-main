-- ============================================================
-- Share custom holidays between paired users (read-only)
-- When User A creates a custom special day for a pairing,
-- User B (the other person in the pair) can see it too.
-- ============================================================

-- Paired users can view each other's custom holidays (read-only)
CREATE POLICY "Paired users can view custom holidays"
  ON public.custom_holidays FOR SELECT
  USING (
    pairing_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.pairings
      WHERE pairings.id = custom_holidays.pairing_id
        AND (pairings.user_a_id = auth.uid() OR pairings.user_b_id = auth.uid())
    )
  );

-- Paired users can view each other's archived holidays (read-only)
CREATE POLICY "Paired users can view archived holidays"
  ON public.archived_holidays FOR SELECT
  USING (
    pairing_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.pairings
      WHERE pairings.id = archived_holidays.pairing_id
        AND (pairings.user_a_id = auth.uid() OR pairings.user_b_id = auth.uid())
    )
  );
