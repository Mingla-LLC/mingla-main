-- #3720 Phase 0 / Slice B — quiet-hours push deferral via notification_outbox.
-- Seed a category for deferred legacy (type/title/body) re-drives, and teach
-- claim_notification_outbox to reclaim retry_wait rows when next_attempt_at is due
-- (mirrors claim_source_refund_notification_outbox).

INSERT INTO public.notification_categories (
  key, section, is_transactional, urgency, default_channels, reach_mode, active
) VALUES (
  'legacy_quiet_hours_push',
  'system',
  true,
  'normal',
  ARRAY['push', 'inapp']::text[],
  'reach_once',
  true
)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.claim_notification_outbox(p_limit int DEFAULT 25)
RETURNS SETOF public.notification_outbox
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user NOT IN ('postgres', 'service_role') THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  RETURN QUERY
  UPDATE public.notification_outbox o
     SET status = 'processing'
   WHERE o.id IN (
     SELECT c.id
       FROM public.notification_outbox c
      WHERE c.category_key NOT LIKE 'source_refund_%'
        AND (
          c.status = 'pending'
          OR (c.status = 'retry_wait' AND c.next_attempt_at IS NOT NULL
              AND c.next_attempt_at <= now())
        )
      ORDER BY COALESCE(c.next_attempt_at, c.created_at), c.created_at, c.id
      FOR UPDATE SKIP LOCKED
      LIMIT GREATEST(LEAST(p_limit, 25), 0)
   )
  RETURNING o.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_notification_outbox(int) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_notification_outbox(int) FROM anon;
REVOKE EXECUTE ON FUNCTION public.claim_notification_outbox(int) FROM authenticated;

COMMENT ON FUNCTION public.claim_notification_outbox(int) IS
  'META-ORCH-1161 claim + #3720 quiet-hours: claims pending OR due retry_wait '
  '(next_attempt_at <= now()) non-source-refund rows. Service-role only.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.notification_categories
    WHERE key = 'legacy_quiet_hours_push'
  ) THEN
    RAISE EXCEPTION '#3720 self-check: legacy_quiet_hours_push category missing';
  END IF;
END $$;
