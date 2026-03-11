-- =============================================================================
-- Migration: Push token auto-cleanup + conversation_participants publication
-- Purpose:   1. Delete stale push tokens (>90 days) via weekly cron job
--            2. Add conversation_participants to realtime publication for
--               filtered message subscriptions
-- =============================================================================

-- ── 1. Push token cleanup function ─────────────────────────────────────────
-- Deletes tokens that haven't been updated in 90 days.
-- Called by pg_cron weekly. Safe to call manually at any time.
CREATE OR REPLACE FUNCTION public.cleanup_stale_push_tokens()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM public.user_push_tokens
  WHERE updated_at < NOW() - INTERVAL '90 days';

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

-- Only callable by service_role and postgres (cron runs as postgres)
REVOKE ALL ON FUNCTION public.cleanup_stale_push_tokens FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_stale_push_tokens TO service_role;

-- ── 2. Schedule weekly cleanup via pg_cron (if extension is available) ──────
-- Runs every Sunday at 3 AM UTC. If pg_cron is not enabled, this block
-- silently does nothing — the function can still be called manually.
DO $$
BEGIN
  -- Check if pg_cron extension exists
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Remove existing job if present (idempotent)
    PERFORM cron.unschedule('cleanup-stale-push-tokens');

    -- Schedule: every Sunday at 03:00 UTC
    PERFORM cron.schedule(
      'cleanup-stale-push-tokens',
      '0 3 * * 0',
      $$SELECT public.cleanup_stale_push_tokens()$$
    );
  END IF;
EXCEPTION WHEN OTHERS THEN
  -- pg_cron not available — skip silently. Function can be called manually
  -- or via an edge function on a timer.
  RAISE NOTICE 'pg_cron not available — push token cleanup must be triggered manually';
END;
$$;

-- ── 3. Add conversation_participants to realtime publication ────────────────
-- Needed so the client can detect when the user joins/leaves conversations,
-- keeping the local conversation ID cache fresh for filtered message subscriptions.
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.conversation_participants;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END;
$$;
