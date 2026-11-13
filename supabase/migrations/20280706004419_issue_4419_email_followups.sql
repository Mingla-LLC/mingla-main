-- #4419 follow-ups: an unreadable saved copy is retried a bounded number of
-- times, and "Send test to me" holds its hourly limit under parallel clicks.
-- Invariant I-4419-TEST-SEND-LIMIT-ATOMIC is declared in its test,
-- __tests__/issue_4419_email_followups.implementor.pg17.test.sql.
BEGIN;

ALTER TABLE public.admin_email_log
  ADD COLUMN IF NOT EXISTS snapshot_attempts integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.admin_email_log.snapshot_attempts IS
  '#4419: how many times the saved copy could not be read. admin-send-email ends the campaign (partial or failed) at 5.';

-- Check the hourly limit and record the test send as ONE step. The advisory
-- lock is per person, so parallel clicks from one person queue up and each
-- counts the rows the one before it wrote; nobody can pass the limit. The row
-- is written before the email is sent: if it cannot be written, nothing is
-- sent. Returns the audit row id, or NULL when the limit is reached.
CREATE OR REPLACE FUNCTION public.issue_4419_admin_email_test_send_reserve(
  p_actor uuid,
  p_actor_email text,
  p_campaign uuid,
  p_limit integer,
  p_from_snapshot boolean
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_used integer;
  v_id uuid;
BEGIN
  IF p_actor IS NULL OR p_limit IS NULL OR p_limit < 1 THEN
    RAISE EXCEPTION 'test_send_reserve_invalid';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('issue_4419_test_send:' || p_actor::text, 0));
  SELECT count(*) INTO v_used
    FROM public.admin_audit_log
   WHERE action = 'email_campaign_test_sent'
     AND metadata->>'actor_user_id' = p_actor::text
     AND created_at >= now() - interval '1 hour';
  IF v_used >= p_limit THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.admin_audit_log(admin_email, action, target_type, target_id, metadata)
  VALUES (
    COALESCE(p_actor_email, p_actor::text),
    'email_campaign_test_sent',
    'admin_email_log',
    p_campaign::text,
    jsonb_build_object('from_snapshot', COALESCE(p_from_snapshot, false), 'actor_user_id', p_actor)
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_4419_admin_email_test_send_reserve(uuid, text, uuid, integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4419_admin_email_test_send_reserve(uuid, text, uuid, integer, boolean) TO service_role;

COMMIT;
