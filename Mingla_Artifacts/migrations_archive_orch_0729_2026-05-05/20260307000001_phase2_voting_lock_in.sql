-- Phase 2: Voting / RSVP / Lock-In / Calendar
-- Adds lock tracking to board_saved_cards, status constraint to collaboration_sessions,
-- and trigger functions for auto-lock-in and calendar entry creation.

-- 1. Add lock tracking to board_saved_cards
ALTER TABLE public.board_saved_cards
  ADD COLUMN IF NOT EXISTS is_locked BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS locked_by_consensus BOOLEAN NOT NULL DEFAULT false;

-- Index for querying locked cards per session
CREATE INDEX IF NOT EXISTS idx_board_saved_cards_locked
  ON public.board_saved_cards(session_id, is_locked)
  WHERE is_locked = true;

-- 2. Add explicit status CHECK (replace unconstrained TEXT)
-- First drop any existing constraint if present
DO $$
BEGIN
  ALTER TABLE public.collaboration_sessions
    DROP CONSTRAINT IF EXISTS collaboration_sessions_status_check;
EXCEPTION WHEN undefined_object THEN
  NULL;
END $$;

ALTER TABLE public.collaboration_sessions
  ADD CONSTRAINT collaboration_sessions_status_check
  CHECK (status IN ('pending', 'active', 'voting', 'locked', 'completed', 'archived', 'dormant'));

-- 3. Function: auto-lock card when all participants RSVP attending
CREATE OR REPLACE FUNCTION public.check_card_lock_in()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_session_id UUID;
  v_saved_card_id UUID;
  v_total_participants INTEGER;
  v_attending_count INTEGER;
  v_already_locked BOOLEAN;
BEGIN
  v_session_id := NEW.session_id;
  v_saved_card_id := NEW.saved_card_id;

  -- Skip if not an 'attending' RSVP
  IF NEW.rsvp_status != 'attending' THEN
    RETURN NEW;
  END IF;

  -- Check if card is already locked
  SELECT is_locked INTO v_already_locked
  FROM public.board_saved_cards
  WHERE id = v_saved_card_id;

  IF v_already_locked = true THEN
    RETURN NEW;
  END IF;

  -- Count active participants (has_accepted = true)
  SELECT COUNT(*) INTO v_total_participants
  FROM public.session_participants
  WHERE session_id = v_session_id
    AND has_accepted = true;

  -- Count attending RSVPs for this card
  SELECT COUNT(*) INTO v_attending_count
  FROM public.board_card_rsvps
  WHERE session_id = v_session_id
    AND saved_card_id = v_saved_card_id
    AND rsvp_status = 'attending';

  -- Lock if ALL participants attending
  IF v_attending_count >= v_total_participants AND v_total_participants > 0 THEN
    UPDATE public.board_saved_cards
    SET is_locked = true,
        locked_at = NOW(),
        locked_by_consensus = true
    WHERE id = v_saved_card_id;

    -- Transition session to 'locked' if not already
    UPDATE public.collaboration_sessions
    SET status = 'locked',
        updated_at = NOW()
    WHERE id = v_session_id
      AND status IN ('active', 'voting');
  END IF;

  RETURN NEW;
END;
$$;

-- Trigger on RSVP insert/update
DROP TRIGGER IF EXISTS trigger_check_card_lock_in ON public.board_card_rsvps;
CREATE TRIGGER trigger_check_card_lock_in
  AFTER INSERT OR UPDATE ON public.board_card_rsvps
  FOR EACH ROW
  EXECUTE FUNCTION public.check_card_lock_in();

-- 4. Function: create calendar entries for all participants when a card locks
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
    ON CONFLICT DO NOTHING;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_create_calendar_on_lock ON public.board_saved_cards;
CREATE TRIGGER trigger_create_calendar_on_lock
  AFTER UPDATE ON public.board_saved_cards
  FOR EACH ROW
  WHEN (OLD.is_locked = false AND NEW.is_locked = true)
  EXECUTE FUNCTION public.create_calendar_entries_on_lock();
