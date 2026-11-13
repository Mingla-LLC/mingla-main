-- #4419 follow-ups: "Send test to me" holds its hourly limit, and an
-- unreadable saved copy has a try counter.
--
-- MINGLA-INVARIANT: I-4419-TEST-SEND-LIMIT-ATOMIC | issue #4419 | issue_4419_admin_email_test_send_reserve checks the hourly limit and writes the audit row in one step under a per-person advisory lock, returns NULL at the limit and counts only that person's rows from the last hour, and is callable by service_role only.
--
-- Also: admin_email_log.snapshot_attempts exists, is NOT NULL and starts at 0.
--
-- Fails before the follow-up: neither the column nor the function existed.
\set ON_ERROR_STOP on
BEGIN;

DO $$
DECLARE
  a uuid := '44190000-0000-4000-8000-0000000000a9';
  b uuid := '44190000-0000-4000-8000-0000000000b9';
  c uuid := '44190000-0000-4000-8000-0000000000e9';
  r uuid;
  n integer;
BEGIN
  -- The column.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='admin_email_log'
       AND column_name='snapshot_attempts' AND is_nullable='NO' AND column_default='0'
  ) THEN RAISE EXCEPTION '4419f: snapshot_attempts missing or wrong'; END IF;

  -- Five reserve, the sixth is refused, and the refusal writes nothing.
  FOR i IN 1..5 LOOP
    r := public.issue_4419_admin_email_test_send_reserve(a, 'a@mingla.test', c, 5, true);
    IF r IS NULL THEN RAISE EXCEPTION '4419f: reserve % refused too early', i; END IF;
  END LOOP;
  IF public.issue_4419_admin_email_test_send_reserve(a, 'a@mingla.test', c, 5, true) IS NOT NULL THEN
    RAISE EXCEPTION '4419f: the sixth test send in an hour was allowed';
  END IF;
  SELECT count(*) INTO n FROM public.admin_audit_log
   WHERE action='email_campaign_test_sent' AND metadata->>'actor_user_id'=a::text;
  IF n <> 5 THEN RAISE EXCEPTION '4419f: expected 5 audit rows, got %', n; END IF;

  -- Another person has their own five.
  IF public.issue_4419_admin_email_test_send_reserve(b, 'b@mingla.test', c, 5, false) IS NULL THEN
    RAISE EXCEPTION '4419f: the limit leaked across people';
  END IF;

  -- Rows older than an hour no longer count.
  UPDATE public.admin_audit_log SET created_at = now() - interval '2 hours'
   WHERE action='email_campaign_test_sent' AND metadata->>'actor_user_id'=a::text
     AND id IN (SELECT id FROM public.admin_audit_log
                 WHERE action='email_campaign_test_sent' AND metadata->>'actor_user_id'=a::text LIMIT 2);
  IF public.issue_4419_admin_email_test_send_reserve(a, 'a@mingla.test', c, 5, true) IS NULL THEN
    RAISE EXCEPTION '4419f: an old row was still counted';
  END IF;

  -- The row says what the old code wrote.
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_audit_log
     WHERE id = r OR (action='email_campaign_test_sent' AND target_type='admin_email_log'
                      AND target_id = c::text AND metadata ? 'from_snapshot')
  ) THEN RAISE EXCEPTION '4419f: audit row shape changed'; END IF;

  -- A nonsense limit is an error, never "unlimited".
  BEGIN
    PERFORM public.issue_4419_admin_email_test_send_reserve(a, NULL, c, 0, false);
    RAISE EXCEPTION '4419f: limit 0 was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'test_send_reserve_invalid' THEN RAISE; END IF;
  END;

  -- One step under a lock; service_role only.
  IF position('pg_advisory_xact_lock' IN pg_get_functiondef('public.issue_4419_admin_email_test_send_reserve(uuid,text,uuid,integer,boolean)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '4419f: no per-person lock';
  END IF;
  IF has_function_privilege('anon','public.issue_4419_admin_email_test_send_reserve(uuid,text,uuid,integer,boolean)','EXECUTE')
     OR has_function_privilege('authenticated','public.issue_4419_admin_email_test_send_reserve(uuid,text,uuid,integer,boolean)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.issue_4419_admin_email_test_send_reserve(uuid,text,uuid,integer,boolean)','EXECUTE') THEN
    RAISE EXCEPTION '4419f: wrong EXECUTE grants';
  END IF;
END $$;

ROLLBACK;
