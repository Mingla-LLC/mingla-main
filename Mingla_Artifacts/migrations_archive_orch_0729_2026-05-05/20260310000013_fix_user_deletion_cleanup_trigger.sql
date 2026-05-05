-- Migration: 20260310000013_fix_user_deletion_cleanup_trigger.sql
-- Description: Updates the user deletion cleanup trigger to also remove:
--   1. friend_links rows (both directions)
--   2. saved_people entries where OTHER users had the deleted user as a linked friend
-- Previously these were missed, leaving ghost "linked friend" entries in other users' accounts.

CREATE OR REPLACE FUNCTION public.handle_user_deletion_cleanup()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  session_record RECORD;
  oldest_member_id UUID;
  participant_count INTEGER;
BEGIN
  -- Step 1: Handle each session where the deleted user was a participant
  FOR session_record IN
    SELECT DISTINCT sp.session_id, sp.is_admin
    FROM session_participants sp
    WHERE sp.user_id = OLD.id
  LOOP
    -- If user was admin, reassign to oldest remaining member
    IF session_record.is_admin THEN
      SELECT user_id INTO oldest_member_id
      FROM session_participants
      WHERE session_id = session_record.session_id
        AND user_id != OLD.id
      ORDER BY created_at ASC
      LIMIT 1;

      IF oldest_member_id IS NOT NULL THEN
        UPDATE session_participants
        SET is_admin = TRUE
        WHERE session_id = session_record.session_id
          AND user_id = oldest_member_id;
      END IF;
    END IF;

    -- Remove user from session
    DELETE FROM session_participants
    WHERE session_id = session_record.session_id
      AND user_id = OLD.id;

    -- Check remaining participant count
    SELECT COUNT(*) INTO participant_count
    FROM session_participants
    WHERE session_id = session_record.session_id;

    -- If fewer than 2 members remain, delete the session
    IF participant_count < 2 THEN
      -- Delete related data first
      DELETE FROM board_session_preferences WHERE session_id = session_record.session_id;
      DELETE FROM session_votes WHERE session_id = session_record.session_id;
      DELETE FROM collaboration_invites WHERE session_id = session_record.session_id;
      DELETE FROM session_presence WHERE session_id = session_record.session_id;
      DELETE FROM typing_indicators WHERE session_id = session_record.session_id;
      -- Delete the session itself
      DELETE FROM collaboration_sessions WHERE id = session_record.session_id;
    END IF;
  END LOOP;

  -- Step 2: Transfer creator ownership for any remaining sessions
  UPDATE collaboration_sessions cs
  SET created_by = (
    SELECT sp.user_id
    FROM session_participants sp
    WHERE sp.session_id = cs.id
      AND sp.user_id != OLD.id
    ORDER BY sp.created_at ASC
    LIMIT 1
  )
  WHERE cs.created_by = OLD.id
    AND EXISTS (
      SELECT 1 FROM session_participants sp
      WHERE sp.session_id = cs.id
        AND sp.user_id != OLD.id
    );

  -- Step 3: Anonymize messages (soft delete) instead of hard delete
  UPDATE messages
  SET deleted_at = NOW()
  WHERE sender_id = OLD.id
    AND deleted_at IS NULL;

  -- Step 4: Remove from conversation participants
  DELETE FROM conversation_participants WHERE user_id = OLD.id;

  -- Step 5: Clean up friends, friend links, and social data
  DELETE FROM friends WHERE user_id = OLD.id OR friend_user_id = OLD.id;
  DELETE FROM friend_requests WHERE sender_id = OLD.id OR receiver_id = OLD.id;
  DELETE FROM friend_links WHERE requester_id = OLD.id OR target_id = OLD.id;
  DELETE FROM blocked_users WHERE blocker_id = OLD.id OR blocked_id = OLD.id;
  DELETE FROM muted_users WHERE muter_id = OLD.id OR muted_id = OLD.id;
  DELETE FROM collaboration_invites WHERE inviter_id = OLD.id OR invitee_id = OLD.id OR invited_by = OLD.id;
  DELETE FROM user_presence WHERE user_id = OLD.id;
  DELETE FROM session_presence WHERE user_id = OLD.id;
  DELETE FROM typing_indicators WHERE user_id = OLD.id;
  DELETE FROM session_votes WHERE user_id = OLD.id;
  DELETE FROM calendar_entries WHERE user_id = OLD.id;
  DELETE FROM board_session_preferences WHERE user_id = OLD.id;
  DELETE FROM preference_history WHERE user_id = OLD.id;
  DELETE FROM user_activity WHERE user_id = OLD.id;
  DELETE FROM user_interactions WHERE user_id = OLD.id;
  DELETE FROM user_location_history WHERE user_id = OLD.id;
  DELETE FROM user_preference_learning WHERE user_id = OLD.id;
  DELETE FROM user_sessions WHERE user_id = OLD.id;

  -- Step 6: Clean up saved_people entries where OTHER users had the deleted user as a linked friend.
  -- CASCADE from saved_people automatically removes their person_experiences and person_audio_clips.
  DELETE FROM saved_people WHERE linked_user_id = OLD.id;

  RETURN OLD;
EXCEPTION
  WHEN OTHERS THEN
    -- Log the error but don't prevent profile deletion
    RAISE WARNING 'Error during user deletion cleanup for user %: %', OLD.id, SQLERRM;
    RETURN OLD;
END;
$$;
