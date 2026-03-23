-- ============================================================
-- Pass 10: Add DELETE + UPDATE RLS policies to board_saved_cards
-- Without these, all card removals from collab sessions are
-- silently blocked by RLS — the client gets no error but the
-- row persists.
-- ============================================================

-- DELETE: Session participants can remove saved cards
CREATE POLICY "Participants can remove saved cards from their sessions"
  ON public.board_saved_cards
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.session_participants sp
      WHERE sp.session_id = board_saved_cards.session_id
      AND sp.user_id = auth.uid()
    )
  );

-- UPDATE: Session participants can update saved cards (e.g., mark visited)
CREATE POLICY "Participants can update saved cards in their sessions"
  ON public.board_saved_cards
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.session_participants sp
      WHERE sp.session_id = board_saved_cards.session_id
      AND sp.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.session_participants sp
      WHERE sp.session_id = board_saved_cards.session_id
      AND sp.user_id = auth.uid()
    )
  );
