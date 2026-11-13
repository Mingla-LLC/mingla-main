-- #4419 tester adversarial (mingla-tester, L3). Angles the implementor suites
-- do not take:
--
--   T1  the trigger allows a full-row rewrite with identical values (an
--       upsert of the whole row), but refuses a change to render_sample alone,
--       and refuses turning an empty preheader into NULL
--   T2  a signed-in non-admin can't change a campaign (0 rows) and can't read
--       anyone's delivery rows
--   T3  event edge cases: event types outside the list never error and never
--       link; an over-long click link is cut to 2048 (the CHECK never aborts
--       ingest); a delivery INSERTED already carrying its provider id links
--       the early events (INSERT path of the late-binding trigger); two
--       deliveries sharing a provider id link the event once; a legacy
--       usemingla.com Admin event is linked and stays un-flagged
--   T4  catalogue: every #4419 SECURITY DEFINER function pins search_path and
--       none is executable by anon or authenticated
--   T5  the list read with p_admin false never returns a non-scheduled row,
--       whatever the filter, and its counts say so
--
-- Fails on f8fdac7cc3 (before #4419): the columns, trigger, table and
-- functions do not exist.
\set ON_ERROR_STOP on
BEGIN;

CREATE FUNCTION pg_temp.act(p_user uuid) RETURNS void LANGUAGE sql AS $fn$
  SELECT set_config('request.jwt.claim.sub',coalesce(p_user::text,''),true),
         set_config('request.jwt.claims',CASE WHEN p_user IS NULL THEN '' ELSE json_build_object('sub',p_user,'role','authenticated','email',(SELECT email FROM auth.users WHERE id=p_user))::text END,true);
$fn$;

SET LOCAL session_replication_role = replica;
INSERT INTO auth.users(id,email) VALUES
  ('44192000-0000-4000-8000-0000000000a1','i4419t-admin@mingla.test'),
  ('44192000-0000-4000-8000-0000000000b1','i4419t-member@mingla.test');
INSERT INTO public.admin_users(email,status) VALUES('i4419t-admin@mingla.test','active');
SET LOCAL session_replication_role = origin;

INSERT INTO public.admin_email_log(id,subject,body,recipient_type,status,recipient_count,
  rendered_subject,rendered_preheader,rendered_html,rendered_text,rendered_document,rendered_at,render_sample) VALUES
  ('44192000-0000-4000-8000-000000000e01','Copy','b','bulk','completed',2,
   'Copy','', '<p>x</p>','x','{"version":1,"blocks":[]}'::jsonb, now(), '{"first_name":"Maya"}'::jsonb),
  ('44192000-0000-4000-8000-000000000e02','Sched','b','bulk','scheduled',2,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
  ('44192000-0000-4000-8000-000000000e03','Sent','b','bulk','completed',2,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
  ('44192000-0000-4000-8000-000000000e04','Part','b','bulk','partial',2,NULL,NULL,NULL,NULL,NULL,NULL,NULL);

-- T1
DO $$ BEGIN
  -- Whole row rewritten with the same values + an unrelated change: allowed.
  UPDATE public.admin_email_log l SET
    rendered_subject=l.rendered_subject, rendered_preheader=l.rendered_preheader, rendered_html=l.rendered_html,
    rendered_text=l.rendered_text, rendered_document=l.rendered_document, rendered_at=l.rendered_at,
    render_sample=l.render_sample, sent_count=2
  WHERE id='44192000-0000-4000-8000-000000000e01';
  IF (SELECT sent_count FROM public.admin_email_log WHERE id='44192000-0000-4000-8000-000000000e01') <> 2 THEN
    RAISE EXCEPTION 'T1: an identical rewrite was refused';
  END IF;
  BEGIN
    UPDATE public.admin_email_log SET render_sample='{"first_name":"Ade"}' WHERE id='44192000-0000-4000-8000-000000000e01';
    RAISE EXCEPTION 'T1: render_sample changed after the copy was saved';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;
  END;
  BEGIN
    UPDATE public.admin_email_log SET rendered_preheader=NULL WHERE id='44192000-0000-4000-8000-000000000e01';
    RAISE EXCEPTION 'T1: an empty preheader was cleared to NULL';
  EXCEPTION WHEN SQLSTATE 'PT409' OR check_violation THEN NULL;
  END;
END $$;

-- T2
SELECT pg_temp.act('44192000-0000-4000-8000-0000000000b1');
SET LOCAL ROLE authenticated;
DO $$ DECLARE n int; BEGIN
  UPDATE public.admin_email_log SET status='cancelled' WHERE id='44192000-0000-4000-8000-000000000e02';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'T2: a non-admin changed a campaign'; END IF;
  IF (SELECT count(*) FROM public.admin_email_recipient_deliveries) <> 0 THEN
    RAISE EXCEPTION 'T2: a non-admin read delivery rows';
  END IF;
END $$;
RESET ROLE;
SELECT pg_temp.act(NULL);
DO $$ BEGIN
  IF (SELECT status FROM public.admin_email_log WHERE id='44192000-0000-4000-8000-000000000e02') <> 'scheduled' THEN
    RAISE EXCEPTION 'T2: the scheduled campaign changed';
  END IF;
END $$;

-- T3
INSERT INTO public.admin_email_recipient_deliveries(id,campaign_id,recipient_email,status,provider_message_id) VALUES
  ('44192000-0000-4000-8000-0000000000d1','44192000-0000-4000-8000-000000000e03','a@x.test','accepted','re_t_a'),
  ('44192000-0000-4000-8000-0000000000d2','44192000-0000-4000-8000-000000000e03','b@x.test','accepted','re_t_shared'),
  ('44192000-0000-4000-8000-0000000000d3','44192000-0000-4000-8000-000000000e04','c@x.test','accepted','re_t_shared');
DO $$ DECLARE r text; BEGIN
  r := public.mkt_ingest_email_event('t4419_f1','email.failed','re_t_a',
    '{"type":"email.failed","data":{"email_id":"re_t_a","from":"Mingla <hello@campaigns.usemingla.com>"}}');
  IF r = 'admin_delivery' OR EXISTS (SELECT 1 FROM public.admin_email_delivery_events WHERE svix_id='t4419_f1') THEN
    RAISE EXCEPTION 'T3: an unsupported event type was linked (%)', r;
  END IF;
  r := public.mkt_ingest_email_event('t4419_c1','email.clicked','re_t_a',
    jsonb_build_object('type','email.clicked','data',jsonb_build_object('email_id','re_t_a',
      'from','Mingla <hello@campaigns.usemingla.com>','click',jsonb_build_object('link','https://usemingla.com/'||repeat('a',5000)))));
  IF r <> 'admin_delivery' THEN RAISE EXCEPTION 'T3: a long click link broke linking (%)', r; END IF;
  IF (SELECT octet_length(link_url) FROM public.admin_email_delivery_events WHERE svix_id='t4419_c1') <> 2048 THEN
    RAISE EXCEPTION 'T3: the click link was not cut to 2048';
  END IF;
  r := public.mkt_ingest_email_event('t4419_s1','email.delivered','re_t_shared',
    '{"type":"email.delivered","data":{"email_id":"re_t_shared","from":"Mingla <hello@campaigns.usemingla.com>"}}');
  IF (SELECT count(*) FROM public.admin_email_delivery_events WHERE svix_id='t4419_s1') <> 1 THEN
    RAISE EXCEPTION 'T3: a shared provider id double-linked';
  END IF;
  r := public.mkt_ingest_email_event('t4419_legacy','email.delivered','re_t_a',
    '{"type":"email.delivered","data":{"email_id":"re_t_a","from":"Mingla <hello@usemingla.com>"}}');
  IF r <> 'admin_delivery' THEN RAISE EXCEPTION 'T3: a usemingla.com Admin event was not linked (%)', r; END IF;
  IF (SELECT is_campaign_event FROM public.marketing_email_events WHERE svix_id='t4419_legacy') THEN
    RAISE EXCEPTION 'T3: a usemingla.com event became a host-campaign event';
  END IF;
  -- Early event, then a delivery INSERTED already holding the id.
  r := public.mkt_ingest_email_event('t4419_early','email.sent','re_t_late',
    '{"type":"email.sent","data":{"email_id":"re_t_late","from":"Mingla <hello@campaigns.usemingla.com>"}}');
  IF r <> 'campaign_unmatched' THEN RAISE EXCEPTION 'T3: before the delivery exists Resend must retry (got %)', r; END IF;
  INSERT INTO public.admin_email_recipient_deliveries(id,campaign_id,recipient_email,status,provider_message_id) VALUES
    ('44192000-0000-4000-8000-0000000000d4','44192000-0000-4000-8000-000000000e03','d@x.test','accepted','re_t_late');
  IF NOT EXISTS (SELECT 1 FROM public.admin_email_delivery_events WHERE svix_id='t4419_early' AND delivery_id='44192000-0000-4000-8000-0000000000d4') THEN
    RAISE EXCEPTION 'T3: the INSERT path did not link the early event';
  END IF;
  IF (SELECT is_campaign_event FROM public.marketing_email_events WHERE svix_id='t4419_early') THEN
    RAISE EXCEPTION 'T3: the late-linked event still counts as a lost host-campaign event';
  END IF;
END $$;

-- T4
DO $$ DECLARE f record; BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig, p.prosecdef, p.proconfig
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND (p.proname LIKE 'issue\_4419\_%' OR p.proname='mkt_ingest_email_event')
  LOOP
    IF f.prosecdef AND NOT EXISTS (SELECT 1 FROM unnest(f.proconfig) c WHERE c LIKE 'search_path=%') THEN
      RAISE EXCEPTION 'T4: % is SECURITY DEFINER without search_path', f.sig;
    END IF;
    IF has_function_privilege('anon', f.sig, 'EXECUTE') OR has_function_privilege('authenticated', f.sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'T4: % is executable by anon or authenticated', f.sig;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public' AND p.proname LIKE 'issue\_4419\_%') < 9 THEN
    RAISE EXCEPTION 'T4: expected the #4419 functions to exist';
  END IF;
END $$;

-- T5
DO $$ DECLARE v jsonb; flt text; BEGIN
  FOREACH flt IN ARRAY ARRAY['all','sent','attention','sending','cancelled'] LOOP
    v := public.issue_4419_admin_email_list(flt, NULL, false, 100, 0);
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v->'rows') r WHERE r->>'status' <> 'scheduled') THEN
      RAISE EXCEPTION 'T5: a non-admin list (%) returned a non-scheduled row', flt;
    END IF;
    IF (v->'counts'->>'sent')::int <> 0 OR (v->'counts'->>'attention')::int <> 0 THEN
      RAISE EXCEPTION 'T5: non-admin counts reveal sent emails: %', v->'counts';
    END IF;
  END LOOP;
END $$;

ROLLBACK;
