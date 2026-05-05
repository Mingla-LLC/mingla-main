-- TRIGGERS REPAIR MIGRATION
-- This adds missing triggers and functions without affecting existing data

-- ===========================================
-- 1. CREATE MISSING FUNCTIONS
-- ===========================================

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create function to update user preferences from interactions
CREATE OR REPLACE FUNCTION public.update_user_preferences_from_interaction()
RETURNS TRIGGER AS $$
DECLARE
  category_name TEXT;
  interaction_weight DOUBLE PRECISION;
BEGIN
  -- Extract category from interaction metadata
  category_name := NEW.metadata->>'category';
  
  -- Determine weight based on interaction type
  CASE NEW.interaction_type
    WHEN 'like' THEN interaction_weight := 0.1;
    WHEN 'dislike' THEN interaction_weight := -0.1;
    WHEN 'save' THEN interaction_weight := 0.2;
    WHEN 'view' THEN interaction_weight := 0.05;
    ELSE interaction_weight := 0.0;
  END CASE;
  
  -- Update or insert preference learning record
  IF category_name IS NOT NULL THEN
    INSERT INTO public.user_preference_learning (user_id, category, preference_score, confidence)
    VALUES (NEW.user_id, category_name, 0.5 + interaction_weight, 0.1)
    ON CONFLICT (user_id, category)
    DO UPDATE SET
      preference_score = GREATEST(0.0, LEAST(1.0, user_preference_learning.preference_score + interaction_weight)),
      confidence = LEAST(1.0, user_preference_learning.confidence + 0.05),
      last_updated = now();
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create function to handle friend request acceptance
CREATE OR REPLACE FUNCTION public.accept_friend_request()
RETURNS TRIGGER AS $$
BEGIN
  -- If status changed to 'accepted', create reciprocal friendship
  IF NEW.status = 'accepted' AND OLD.status = 'pending' THEN
    INSERT INTO public.friends (user_id, friend_id, status)
    VALUES (NEW.friend_id, NEW.user_id, 'accepted')
    ON CONFLICT (user_id, friend_id) DO NOTHING;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create function to handle message soft deletion
CREATE OR REPLACE FUNCTION public.soft_delete_message()
RETURNS TRIGGER AS $$
BEGIN
  -- Instead of deleting, mark as deleted
  UPDATE public.messages
  SET is_deleted = true, deleted_at = now()
  WHERE id = OLD.id;
  
  RETURN NULL; -- Prevent actual deletion
END;
$$ LANGUAGE plpgsql;

-- Create function to handle board card addition
CREATE OR REPLACE FUNCTION public.add_board_card()
RETURNS TRIGGER AS $$
BEGIN
  -- Log the activity
  INSERT INTO public.activity_history (board_id, card_id, user_id, action_type, action_data)
  VALUES (NEW.board_id, NEW.id, NEW.added_by, 'add_card', '{}');
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create function to handle board vote
CREATE OR REPLACE FUNCTION public.handle_board_vote()
RETURNS TRIGGER AS $$
BEGIN
  -- Log the vote activity
  INSERT INTO public.activity_history (board_id, card_id, user_id, action_type, action_data)
  VALUES (NEW.board_id, NEW.card_id, NEW.user_id, 'vote', jsonb_build_object('vote_type', NEW.vote_type));
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ===========================================
-- 2. CREATE MISSING TRIGGERS
-- ===========================================

-- Create updated_at triggers for all tables that need them
DROP TRIGGER IF EXISTS update_profiles_updated_at ON public.profiles;
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_experiences_updated_at ON public.experiences;
CREATE TRIGGER update_experiences_updated_at
  BEFORE UPDATE ON public.experiences
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_boards_updated_at ON public.boards;
CREATE TRIGGER update_boards_updated_at
  BEFORE UPDATE ON public.boards
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_saved_experiences_updated_at ON public.saved_experiences;
CREATE TRIGGER update_saved_experiences_updated_at
  BEFORE UPDATE ON public.saved_experiences
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_scheduled_activities_updated_at ON public.scheduled_activities;
CREATE TRIGGER update_scheduled_activities_updated_at
  BEFORE UPDATE ON public.scheduled_activities
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_board_votes_updated_at ON public.board_votes;
CREATE TRIGGER update_board_votes_updated_at
  BEFORE UPDATE ON public.board_votes
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_board_threads_updated_at ON public.board_threads;
CREATE TRIGGER update_board_threads_updated_at
  BEFORE UPDATE ON public.board_threads
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_friends_updated_at ON public.friends;
CREATE TRIGGER update_friends_updated_at
  BEFORE UPDATE ON public.friends
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_messages_updated_at ON public.messages;
CREATE TRIGGER update_messages_updated_at
  BEFORE UPDATE ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Create functional triggers
DROP TRIGGER IF EXISTS update_user_preferences_from_interaction_trigger ON public.user_interactions;
CREATE TRIGGER update_user_preferences_from_interaction_trigger
  AFTER INSERT ON public.user_interactions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_user_preferences_from_interaction();

DROP TRIGGER IF EXISTS accept_friend_request_trigger ON public.friends;
CREATE TRIGGER accept_friend_request_trigger
  AFTER UPDATE ON public.friends
  FOR EACH ROW
  EXECUTE FUNCTION public.accept_friend_request();

DROP TRIGGER IF EXISTS soft_delete_message_trigger ON public.messages;
CREATE TRIGGER soft_delete_message_trigger
  BEFORE DELETE ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.soft_delete_message();

DROP TRIGGER IF EXISTS add_board_card_trigger ON public.board_cards;
CREATE TRIGGER add_board_card_trigger
  AFTER INSERT ON public.board_cards
  FOR EACH ROW
  EXECUTE FUNCTION public.add_board_card();

DROP TRIGGER IF EXISTS handle_board_vote_trigger ON public.board_votes;
CREATE TRIGGER handle_board_vote_trigger
  AFTER INSERT OR UPDATE ON public.board_votes
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_board_vote();
