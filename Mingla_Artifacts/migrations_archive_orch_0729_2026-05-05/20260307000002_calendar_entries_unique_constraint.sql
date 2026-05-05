-- Add unique constraint on calendar_entries(user_id, board_card_id) for collaboration entries.
-- This ensures the ON CONFLICT clause in create_calendar_entries_on_lock() trigger works correctly
-- and prevents duplicate calendar entries on trigger replay.

CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_entries_user_board_card
  ON public.calendar_entries(user_id, board_card_id)
  WHERE board_card_id IS NOT NULL;

-- Update the trigger function to specify the conflict target explicitly
CREATE OR REPLACE FUNCTION public.create_calendar_entries_on_lock()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_participant RECORD;
  v_session RECORD;
  v_card_data JSONB;
BEGIN
  -- Only fire when is_locked transitions from false to true
  IF OLD.is_locked = true OR NEW.is_locked = false THEN
    RETURN NEW;
  END IF;

  -- Get session datetime_pref for scheduled_at
  SELECT s.id, bsp.datetime_pref
  INTO v_session
  FROM public.collaboration_sessions s
  LEFT JOIN public.board_session_preferences bsp
    ON bsp.session_id = s.id
  WHERE s.id = NEW.session_id
  ORDER BY bsp.datetime_pref ASC NULLS LAST
  LIMIT 1;

  v_card_data := NEW.card_data;

  -- Create calendar entry for EVERY active participant
  FOR v_participant IN
    SELECT user_id
    FROM public.session_participants
    WHERE session_id = NEW.session_id
      AND has_accepted = true
  LOOP
    INSERT INTO public.calendar_entries (
      user_id,
      board_card_id,
      source,
      card_data,
      status,
      scheduled_at,
      duration_minutes
    ) VALUES (
      v_participant.user_id,
      NEW.id,
      'collaboration',
      v_card_data,
      'confirmed',
      COALESCE(v_session.datetime_pref, NOW() + INTERVAL '1 day'),
      60
    )
    ON CONFLICT (user_id, board_card_id) WHERE board_card_id IS NOT NULL DO NOTHING;
  END LOOP;

  RETURN NEW;
END;
$$;
