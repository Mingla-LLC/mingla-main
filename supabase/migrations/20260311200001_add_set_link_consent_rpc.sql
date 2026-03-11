-- =============================================================================
-- Migration: Add set_link_consent_and_return RPC + Realtime publication
-- Purpose:   1. Atomically set one consent flag and return the full row
--            2. Ensure required tables are in supabase_realtime publication
-- =============================================================================

-- ── 1. Atomic link consent RPC ─────────────────────────────────────────────
-- Uses SELECT ... FOR UPDATE to lock the row, preventing the race condition
-- where two concurrent updates each see the other's flag as false.
CREATE OR REPLACE FUNCTION public.set_link_consent_and_return(
  p_link_id UUID,
  p_column TEXT
)
RETURNS TABLE (
  requester_link_consent BOOLEAN,
  target_link_consent BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Lock the row first — prevents concurrent read-before-write race
  PERFORM 1 FROM public.friend_links WHERE id = p_link_id FOR UPDATE;

  -- Update the specified column
  IF p_column = 'requester_link_consent' THEN
    UPDATE public.friend_links
    SET requester_link_consent = TRUE, updated_at = NOW()
    WHERE id = p_link_id;
  ELSIF p_column = 'target_link_consent' THEN
    UPDATE public.friend_links
    SET target_link_consent = TRUE, updated_at = NOW()
    WHERE id = p_link_id;
  ELSE
    RAISE EXCEPTION 'Invalid column: %', p_column;
  END IF;

  -- Return the fresh state (our own write is visible here)
  RETURN QUERY
    SELECT fl.requester_link_consent, fl.target_link_consent
    FROM public.friend_links fl
    WHERE fl.id = p_link_id;
END;
$$;

-- Only callable by service_role (edge functions use service_role key)
REVOKE ALL ON FUNCTION public.set_link_consent_and_return FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_link_consent_and_return TO service_role;

-- ── 2. Realtime publication — add tables if not already present ─────────────
-- These are idempotent: if the table is already in the publication, the
-- DO NOTHING block swallows the duplicate_object error.
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.friends;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.calendar_entries;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END;
$$;
