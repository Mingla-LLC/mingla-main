-- ===========================================
-- COLLABORATION FEATURE MIGRATION - PART 7
-- Create helper functions for vote counts, RSVP counts, and unread messages
-- ===========================================

-- Function to get vote counts for a saved card (using board_saved_cards)
CREATE OR REPLACE FUNCTION public.get_saved_card_vote_counts(p_saved_card_id UUID)
RETURNS TABLE (
  up_votes BIGINT,
  down_votes BIGINT,
  total_votes BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COUNT(*) FILTER (WHERE bv.vote_type = 'up')::BIGINT as up_votes,
    COUNT(*) FILTER (WHERE bv.vote_type = 'down')::BIGINT as down_votes,
    COUNT(*)::BIGINT as total_votes
  FROM public.board_votes bv
  WHERE bv.saved_card_id = p_saved_card_id;
END;
$$ LANGUAGE plpgsql;

-- Function to get RSVP counts for a saved card
CREATE OR REPLACE FUNCTION public.get_card_rsvp_counts(p_saved_card_id UUID)
RETURNS TABLE (
  attending_count BIGINT,
  not_attending_count BIGINT,
  total_rsvps BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COUNT(*) FILTER (WHERE bcr.rsvp_status = 'attending')::BIGINT as attending_count,
    COUNT(*) FILTER (WHERE bcr.rsvp_status = 'not_attending')::BIGINT as not_attending_count,
    COUNT(*)::BIGINT as total_rsvps
  FROM public.board_card_rsvps bcr
  WHERE bcr.saved_card_id = p_saved_card_id;
END;
$$ LANGUAGE plpgsql;

-- Function to get unread message count for a user in a session
CREATE OR REPLACE FUNCTION public.get_unread_message_count(
  p_session_id UUID,
  p_user_id UUID
)
RETURNS BIGINT AS $$
BEGIN
  RETURN (
    SELECT COUNT(*)
    FROM public.board_messages bm
    WHERE bm.session_id = p_session_id
    AND bm.deleted_at IS NULL
    AND bm.user_id != p_user_id
    AND NOT EXISTS (
      SELECT 1 FROM public.board_message_reads bmr
      WHERE bmr.message_id = bm.id
      AND bmr.user_id = p_user_id
    )
  );
END;
$$ LANGUAGE plpgsql;

-- Function to get unread card message count for a user in a session for a specific card
CREATE OR REPLACE FUNCTION public.get_unread_card_message_count(
  p_session_id UUID,
  p_saved_card_id UUID,
  p_user_id UUID
)
RETURNS BIGINT AS $$
BEGIN
  RETURN (
    SELECT COUNT(*)
    FROM public.board_card_messages bcm
    WHERE bcm.session_id = p_session_id
    AND bcm.saved_card_id = p_saved_card_id
    AND bcm.deleted_at IS NULL
    AND bcm.user_id != p_user_id
    AND NOT EXISTS (
      SELECT 1 FROM public.board_card_message_reads bcmr
      WHERE bcmr.message_id = bcm.id
      AND bcmr.user_id = p_user_id
    )
  );
END;
$$ LANGUAGE plpgsql;

-- Function to get total unread card messages count for a user in a session (across all cards)
CREATE OR REPLACE FUNCTION public.get_total_unread_card_messages_count(
  p_session_id UUID,
  p_user_id UUID
)
RETURNS BIGINT AS $$
BEGIN
  RETURN (
    SELECT COUNT(*)
    FROM public.board_card_messages bcm
    WHERE bcm.session_id = p_session_id
    AND bcm.deleted_at IS NULL
    AND bcm.user_id != p_user_id
    AND NOT EXISTS (
      SELECT 1 FROM public.board_card_message_reads bcmr
      WHERE bcmr.message_id = bcm.id
      AND bcmr.user_id = p_user_id
    )
  );
END;
$$ LANGUAGE plpgsql;

