\set ON_ERROR_STOP on
CREATE EXTENSION IF NOT EXISTS dblink;
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE oid = 'public.rsvp_notification_deliveries'::regclass
      AND relrowsecurity
  ) THEN
    RAISE EXCEPTION 'rsvp delivery RLS must be enabled';
  END IF;
  IF has_table_privilege('anon', 'public.rsvp_notification_deliveries', 'SELECT')
     OR has_table_privilege('authenticated', 'public.rsvp_notification_deliveries', 'SELECT') THEN
    RAISE EXCEPTION 'guest roles must not read delivery state';
  END IF;
  IF has_function_privilege(
    'authenticated',
    'public.claim_rsvp_notification_deliveries(uuid,integer)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'authenticated callers must not claim RSVP deliveries';
  END IF;
  IF position(
    'SKIP LOCKED' IN upper(pg_get_functiondef(
      'public.claim_rsvp_notification_deliveries(uuid,integer)'::regprocedure
    ))
  ) = 0 THEN
    RAISE EXCEPTION 'claims must use SKIP LOCKED';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND tablename='rsvp_scan_events'
      AND indexdef ILIKE '%UNIQUE%rsvp_id%outcome%success%'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND tablename='rsvp_scan_events'
      AND indexdef ILIKE '%UNIQUE%guest_id%outcome%success%'
  ) THEN
    RAISE EXCEPTION 'one-success-per-pass scan indexes are missing';
  END IF;
  IF position(
    '''wrong_event''' IN pg_get_functiondef(
      'public.biz_rsvp_scan(uuid,text)'::regprocedure
    )
  ) = 0 THEN
    RAISE EXCEPTION 'wrong-event scan outcome is missing';
  END IF;
  IF has_function_privilege(
    'anon', 'public.fetch_user_rsvp_party_passes(uuid)'::regprocedure, 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'anonymous callers must not read authenticated party passes';
  END IF;
END $$;

-- State-machine probes use FK-safe synthetic parent rows. Triggers/FKs are
-- bypassed only for fixture creation; the functions under test run normally.
SET LOCAL session_replication_role = replica;
INSERT INTO auth.users(id)
VALUES ('14470000-0000-4000-8000-000000000401');
INSERT INTO public.rsvp_notifications(
  id,event_id,status,template_key,payload,idempotency_key
) VALUES
  ('14470000-0000-4000-8000-000000000001','14470000-0000-4000-8000-000000000011',
   'pending','rsvp_pass','{}','issue-1447-pg17-ambiguous'),
  ('14470000-0000-4000-8000-000000000002','14470000-0000-4000-8000-000000000012',
   'pending','rsvp_pass','{}','issue-1447-pg17-retry'),
  ('14470000-0000-4000-8000-000000000003','14470000-0000-4000-8000-000000000013',
   'pending','rsvp_pass','{}','issue-1447-pg17-concurrent');
INSERT INTO public.rsvp_notification_deliveries(
  id,notification_id,channel,is_required,status,next_attempt_at
) VALUES
  ('14470000-0000-4000-8000-000000000101','14470000-0000-4000-8000-000000000001',
   'sms',true,'pending',now()-interval '1 minute'),
  ('14470000-0000-4000-8000-000000000102','14470000-0000-4000-8000-000000000002',
   'push',false,'pending',now()-interval '1 minute'),
  ('14470000-0000-4000-8000-000000000103','14470000-0000-4000-8000-000000000003',
   'sms',true,'pending',now()-interval '1 minute');

INSERT INTO public.events(
  id,brand_id,title,slug,event_type,status,visibility,timezone
) VALUES
  ('14470000-0000-4000-8000-000000000011','14470000-0000-4000-8000-000000000301',
   'Issue 1447 door A','issue-1447-door-a','rsvp','live','private','UTC'),
  ('14470000-0000-4000-8000-000000000012','14470000-0000-4000-8000-000000000301',
   'Issue 1447 door B','issue-1447-door-b','rsvp','live','private','UTC');
INSERT INTO public.event_scanners(event_id,user_id,assigned_by,permissions)
VALUES (
  '14470000-0000-4000-8000-000000000011',
  '14470000-0000-4000-8000-000000000401',
  '14470000-0000-4000-8000-000000000401',
  '{"scan":true}'::jsonb
);
INSERT INTO public.event_rsvps(
  id,event_id,user_id,guest_name,rsvp_status,approval_status,qr_code
) VALUES
  ('14470000-0000-4000-8000-000000000201','14470000-0000-4000-8000-000000000012',
   '14470000-0000-4000-8000-000000000401','Wrong event guest','going','approved',
   'mingla:v1:rsvp:14470000-0000-4000-8000-000000000201:sig:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
  ('14470000-0000-4000-8000-000000000202','14470000-0000-4000-8000-000000000011',
   '14470000-0000-4000-8000-000000000401','Door guest','going','approved',
   'mingla:v1:rsvp:14470000-0000-4000-8000-000000000202:sig:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
SET LOCAL session_replication_role = origin;

-- Execute RLS as the real API roles. Temporary SELECT grants isolate policy
-- behavior from the table-level grant denial already asserted above.
GRANT SELECT ON public.rsvp_notification_deliveries TO authenticated, anon;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.rsvp_notification_deliveries) <> 0 THEN
    RAISE EXCEPTION 'authenticated role crossed RSVP delivery RLS';
  END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.rsvp_notification_deliveries) <> 0 THEN
    RAISE EXCEPTION 'anon role crossed RSVP delivery RLS';
  END IF;
END $$;
RESET ROLE;
REVOKE SELECT ON public.rsvp_notification_deliveries FROM authenticated, anon;

-- Execute owner-only pass recovery and the scanner's wrong-event/success/
-- duplicate outcomes through the real SECURITY DEFINER RPCs.
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"14470000-0000-4000-8000-000000000401","role":"authenticated"}',
  true
);
SELECT set_config(
  'request.jwt.claim.sub','14470000-0000-4000-8000-000000000401',true
);
SET LOCAL ROLE authenticated;
DO $$
DECLARE v jsonb; v_count integer;
BEGIN
  SELECT count(*) INTO v_count
    FROM public.fetch_user_rsvp_party_passes(
      '14470000-0000-4000-8000-000000000202'
    );
  IF v_count <> 1 THEN RAISE EXCEPTION 'owner pass recovery failed'; END IF;

  v := public.biz_rsvp_scan(
    '14470000-0000-4000-8000-000000000011',
    'mingla:v1:rsvp:14470000-0000-4000-8000-000000000201:sig:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  );
  IF v->>'result' <> 'wrong_event' THEN
    RAISE EXCEPTION 'wrong-event scan returned %',v;
  END IF;
  v := public.biz_rsvp_scan(
    '14470000-0000-4000-8000-000000000011',
    'mingla:v1:rsvp:14470000-0000-4000-8000-000000000202:sig:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  );
  IF v->>'result' <> 'success' THEN RAISE EXCEPTION 'first scan returned %',v; END IF;
  v := public.biz_rsvp_scan(
    '14470000-0000-4000-8000-000000000011',
    'mingla:v1:rsvp:14470000-0000-4000-8000-000000000202:sig:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  );
  IF v->>'result' <> 'duplicate' THEN RAISE EXCEPTION 'repeat scan returned %',v; END IF;
END $$;
RESET ROLE;

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"14470000-0000-4000-8000-000000000499","role":"authenticated"}',
  true
);
SELECT set_config(
  'request.jwt.claim.sub','14470000-0000-4000-8000-000000000499',true
);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM public.fetch_user_rsvp_party_passes(
      '14470000-0000-4000-8000-000000000202'
    )
  ) THEN RAISE EXCEPTION 'cross-user pass recovery leaked'; END IF;
END $$;
RESET ROLE;

DO $$
DECLARE v record; v_lease uuid;
BEGIN
  SELECT * INTO v FROM public.claim_rsvp_notification_deliveries(
    '14470000-0000-4000-8000-000000000001',1
  );
  IF v.delivery_id IS NULL THEN RAISE EXCEPTION 'SMS row was not claimed'; END IF;
  v_lease := v.lease_id;
  IF NOT public.mark_rsvp_notification_provider_io(v.delivery_id,v_lease) THEN
    RAISE EXCEPTION 'provider I/O marker was not written';
  END IF;
  UPDATE public.rsvp_notification_deliveries
     SET processing_started_at=now()-interval '6 minutes'
   WHERE id=v.delivery_id;
  PERFORM * FROM public.claim_rsvp_notification_deliveries(
    '14470000-0000-4000-8000-000000000001',1
  );
  IF (SELECT status FROM public.rsvp_notification_deliveries WHERE id=v.delivery_id)
       <> 'ambiguous' THEN
    RAISE EXCEPTION 'stale post-I/O SMS was not parked';
  END IF;

  SELECT * INTO v FROM public.claim_rsvp_notification_deliveries(
    '14470000-0000-4000-8000-000000000002',1
  );
  IF v.delivery_id IS NULL THEN RAISE EXCEPTION 'push row was not claimed'; END IF;
  UPDATE public.rsvp_notification_deliveries
     SET processing_started_at=now()-interval '6 minutes'
   WHERE id=v.delivery_id;
  SELECT * INTO v FROM public.claim_rsvp_notification_deliveries(
    '14470000-0000-4000-8000-000000000002',1
  );
  IF v.attempt_count <> 2 THEN
    RAISE EXCEPTION 'stale pre-I/O row was not safely reclaimed';
  END IF;
  IF NOT public.classify_rsvp_notification_failure(
    v.delivery_id,v.lease_id,'known_unsent'
  ) THEN
    RAISE EXCEPTION 'known-unsent failure was not classified';
  END IF;
  IF (SELECT status FROM public.rsvp_notification_deliveries WHERE id=v.delivery_id)
       <> 'failed_retryable' THEN
    RAISE EXCEPTION 'known-unsent failure must remain retryable';
  END IF;
END $$;

DO $$
BEGIN
  BEGIN
    INSERT INTO public.rsvp_notification_deliveries(notification_id,channel)
    VALUES ('14470000-0000-4000-8000-000000000001','sms');
    RAISE EXCEPTION 'duplicate delivery unexpectedly inserted';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
END $$;

COMMIT;

-- Two real database connections contend for the same due delivery. The first
-- holds its transaction open; the second must SKIP LOCKED and claim nothing.
SET ROLE postgres;
SELECT dblink_connect_u('issue1447_claim','dbname=postgres');
SELECT dblink_exec('issue1447_claim','BEGIN');
CREATE TEMP TABLE issue1447_remote_claim AS
SELECT * FROM dblink(
  'issue1447_claim',
  $$SELECT delivery_id::text
      FROM public.claim_rsvp_notification_deliveries(
        '14470000-0000-4000-8000-000000000003',1
      )$$
) AS claimed(delivery_id text);
DO $$ BEGIN
  IF (SELECT count(*) FROM issue1447_remote_claim) <> 1 THEN
    RAISE EXCEPTION 'first concurrent claimant did not acquire the row';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.claim_rsvp_notification_deliveries(
      '14470000-0000-4000-8000-000000000003',1
    )
  ) THEN RAISE EXCEPTION 'SKIP LOCKED allowed a duplicate concurrent claim'; END IF;
END $$;
SELECT dblink_exec('issue1447_claim','ROLLBACK');
SELECT dblink_disconnect('issue1447_claim');
RESET ROLE;

-- Disposable-CI cleanup also keeps the proof replayable by hand.
BEGIN;
SET LOCAL session_replication_role = replica;
DELETE FROM public.rsvp_scan_events
 WHERE requested_event_id IN (
  '14470000-0000-4000-8000-000000000011',
  '14470000-0000-4000-8000-000000000012'
 );
DELETE FROM public.event_rsvps
 WHERE id IN (
  '14470000-0000-4000-8000-000000000201',
  '14470000-0000-4000-8000-000000000202'
 );
DELETE FROM public.event_scanners
 WHERE event_id='14470000-0000-4000-8000-000000000011';
DELETE FROM public.events
 WHERE id IN (
  '14470000-0000-4000-8000-000000000011',
  '14470000-0000-4000-8000-000000000012'
 );
DELETE FROM public.rsvp_notification_deliveries
 WHERE notification_id IN (
  '14470000-0000-4000-8000-000000000001',
  '14470000-0000-4000-8000-000000000002',
  '14470000-0000-4000-8000-000000000003'
 );
DELETE FROM public.rsvp_notifications
 WHERE id IN (
  '14470000-0000-4000-8000-000000000001',
  '14470000-0000-4000-8000-000000000002',
  '14470000-0000-4000-8000-000000000003'
 );
DELETE FROM auth.users
 WHERE id='14470000-0000-4000-8000-000000000401';
COMMIT;
