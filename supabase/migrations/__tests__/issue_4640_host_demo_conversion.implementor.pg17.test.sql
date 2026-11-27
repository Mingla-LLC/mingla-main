-- #4640 executable contract: hashed handoff, scheduler registry, reminders,
-- and the two ordinary Work cards remain one idempotent booking lifecycle.
-- MINGLA-INVARIANT: I-4640-HANDOFF-HASHED | issue #4640 | A form-to-scheduler bearer is stored only as SHA-256, expires within two hours and is resolved only by service-role RPCs.
-- MINGLA-INVARIANT: I-4640-BOOKING-ACTIONS-ONCE | issue #4640 | Each reminder and confirmation action is unique by booking and kind; Work actions create ordinary ops_work_cards linked to the booking.
BEGIN;

CREATE FUNCTION pg_temp.issue_4640_assert(p_ok boolean, p_words text) RETURNS void
LANGUAGE plpgsql AS $$ BEGIN IF NOT COALESCE(p_ok,false) THEN RAISE EXCEPTION 'issue_4640: %',p_words; END IF; END $$;

DO $test$
DECLARE
  v_actor uuid := '46400000-0000-4000-8000-000000000001';
  v_form uuid := '46400000-0000-4000-8000-000000000002';
  v_version uuid := '46400000-0000-4000-8000-000000000003';
  v_submission uuid := '46400000-0000-4000-8000-000000000004';
  v_booking uuid;
  v_def jsonb;
  v_hash text := repeat('a',64);
  v jsonb;
  v_hour uuid;
BEGIN
  PERFORM pg_temp.issue_4640_assert((SELECT count(*)=3 FROM public.booking_scheduler_profiles WHERE enabled),'three route aliases have registry profiles');

  v_def:=public.forms_default_definition('host',NULL);
  PERFORM pg_temp.issue_4640_assert(public.forms_validate_definition(v_def)->>'ok'='true','the default Host form has its mandatory phone');
  PERFORM pg_temp.issue_4640_assert((public.forms_validate_definition(v_def #- '{fields,2}')->'errors') @> '[{"code":"host_phone_required"}]','a Host form cannot lose its required phone');
  PERFORM pg_temp.issue_4640_assert((public.forms_validate_definition(v_def||'{"after_submit":{"action":"book_call","scheduler_key":"host-demo"}}')->>'ok')::boolean,'a registered scheduler is valid form data');
  PERFORM pg_temp.issue_4640_assert((public.forms_validate_definition(v_def||'{"after_submit":{"action":"link","url":"javascript:bad"}}')->'errors') @> '[{"code":"bad_after_submit"}]','unsafe after-send links are refused');

  INSERT INTO public.forms(id,key,name,audience,status,draft,created_by,updated_by)
  VALUES(v_form,'issue-4640-host','Issue 4640 Host','host','draft',v_def,v_actor,v_actor);
  INSERT INTO public.form_versions(id,form_id,version,definition,definition_sha256,published_by)
  VALUES(v_version,v_form,1,v_def||'{"after_submit":{"action":"book_call","scheduler_key":"host-demo"}}',repeat('b',64),v_actor);
  INSERT INTO public.form_submissions(id,form_id,form_version_id,lead_label,idempotency_key,email,name,phone_e164,answers,page_path,placement,ads_allowed,created_at)
  VALUES(v_submission,v_form,v_version,'host','46400000-0000-4000-8000-000000000005','ada@example.com','Ada Host','+2348012345678','{}','/apply/host','form_page',true,now());
  INSERT INTO public.booking_form_handoffs(token_sha256,form_submission_id,scheduler_key,payload,expires_at)
  VALUES(v_hash,v_submission,'host-demo','{"name":"Ada Host","email":"ada@example.com","phone":"+2348012345678"}',now()+interval '90 minutes');
  v:=public.booking_handoff_resolve(v_hash,'host-demo');
  PERFORM pg_temp.issue_4640_assert(v->>'submission_id'=v_submission::text AND v->'payload'->>'phone'='+2348012345678','the hash resolves the saved answers server-side');
  PERFORM pg_temp.issue_4640_assert(public.booking_handoff_resolve(v_hash,'creator-call') IS NULL,'a handoff cannot cross schedulers');
  PERFORM pg_temp.issue_4640_assert(public.booking_handoff_mark_used(v_hash),'a successful booking consumes the bearer');
  PERFORM pg_temp.issue_4640_assert(public.booking_handoff_resolve(v_hash,'host-demo') IS NULL,'a consumed bearer cannot hydrate again');
  PERFORM pg_temp.issue_4640_assert(NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='booking_form_handoffs' AND column_name IN ('token','bearer')),'the raw bearer has no database column');

  DELETE FROM public.booking_calendar_sync_profiles;
  DELETE FROM public.book_call_calendar_sync;
  v:=public.book_call_calendar_sync_begin('lagos-calendar@example.com',240);
  PERFORM pg_temp.issue_4640_assert(NOT (v->>'busy')::boolean,'the Lagos calendar takes its own lease');
  v:=public.book_call_calendar_sync_begin('abuja-calendar@example.com',240);
  PERFORM pg_temp.issue_4640_assert(NOT (v->>'busy')::boolean,'a second calendar is not blocked by Lagos');
  PERFORM public.book_call_calendar_sync_finish('lagos-calendar@example.com','lagos-token',NULL,true,NULL,'{}');
  PERFORM public.book_call_calendar_sync_finish('abuja-calendar@example.com','abuja-token',NULL,true,NULL,'{}');
  v:=public.book_call_calendar_sync_begin('lagos-calendar@example.com',240);
  PERFORM pg_temp.issue_4640_assert(v->>'sync_token'='lagos-token','each calendar resumes from its own Google cursor');
  PERFORM public.book_call_calendar_sync_finish('lagos-calendar@example.com','lagos-token',NULL,false,NULL,'{}');
  PERFORM pg_temp.issue_4640_assert(NOT has_table_privilege('anon','public.booking_calendar_sync_profiles','SELECT'),'calendar cursors stay server-only');

  INSERT INTO public.book_call_leads(booking_key,audience,name,email,venue,icp,social_platform,social_handle,social_url,call_at,booker_time_zone,meet_url,phone_e164,scheduler_key)
  VALUES('gcal:issue-4640','host','Ada Host','ada@example.com','Ada Hall','events','instagram','@adahall','https://instagram.com/adahall',now()+interval '30 hours','Africa/Lagos','https://meet.google.com/abc-defg-hij','+2348012345678','host-demo') RETURNING id INTO v_booking;
  v:=public.booking_lifecycle_start('gcal:issue-4640');
  PERFORM pg_temp.issue_4640_assert((v->>'started')::boolean,'the booking starts its lifecycle');
  PERFORM pg_temp.issue_4640_assert((SELECT count(*)=3 FROM public.booking_reminder_jobs WHERE booking_id=v_booking),'24h, 2h and 15m reminders are unique');
  PERFORM pg_temp.issue_4640_assert((SELECT count(*)=2 FROM public.booking_work_actions WHERE booking_id=v_booking),'the two confirmation actions are unique');
  PERFORM pg_temp.issue_4640_assert((SELECT count(*)=1 FROM public.ops_work_cards WHERE auto_key='demo_booked:'||v_booking),'booking creates one ordinary Work card');
  PERFORM pg_temp.issue_4640_assert((SELECT count(*)=2 FROM public.ops_work_people p JOIN public.ops_work_cards c ON c.id=p.card_id WHERE c.auto_key='demo_booked:'||v_booking AND ((p.email='kunle@usemingla.com' AND p.role='owner') OR (p.email='seth@usemingla.com' AND p.role='watcher'))),'Kunle owns and Seth watches the card');
  PERFORM pg_temp.issue_4640_assert(EXISTS(SELECT 1 FROM public.ops_work_links l JOIN public.ops_work_cards c ON c.id=l.card_id WHERE c.auto_key='demo_booked:'||v_booking AND l.kind='booking' AND l.target_id=v_booking),'the standard panel links to the booking');
  PERFORM public.booking_lifecycle_start('gcal:issue-4640');
  PERFORM pg_temp.issue_4640_assert((SELECT count(*)=3 FROM public.booking_reminder_jobs WHERE booking_id=v_booking) AND (SELECT count(*)=2 FROM public.booking_work_actions WHERE booking_id=v_booking),'replay makes no duplicate lifecycle rows');

  UPDATE public.booking_reminder_jobs SET state='sent',sent_at=now() WHERE booking_id=v_booking AND kind='24h';
  UPDATE public.book_call_leads SET call_at=call_at+interval '1 day',status='moved' WHERE id=v_booking;
  PERFORM pg_temp.issue_4640_assert((SELECT state='pending' AND sent_at IS NULL FROM public.booking_reminder_jobs WHERE booking_id=v_booking AND kind='24h'),'moving the call re-arms even a reminder already sent for the old time');
  PERFORM pg_temp.issue_4640_assert((SELECT title LIKE '%Ada Hall%' FROM public.ops_work_cards WHERE auto_key='demo_booked:'||v_booking),'the familiar Work card is refreshed, not replaced');

  SELECT id INTO v_hour FROM public.booking_work_actions WHERE booking_id=v_booking AND automation_kind='one_hour_confirmation';
  UPDATE public.booking_work_actions SET due_at=now()-interval '1 minute' WHERE id=v_hour;
  PERFORM public.booking_work_claim(30);
  PERFORM public.booking_work_finish(v_hour);
  PERFORM pg_temp.issue_4640_assert((SELECT count(*)=1 FROM public.ops_work_cards WHERE auto_key='demo_hour:'||v_booking),'the one-hour action creates the second ordinary Work card');

  UPDATE public.book_call_leads SET call_at=call_at+interval '2 days',status='moved' WHERE id=v_booking;
  PERFORM pg_temp.issue_4640_assert((SELECT a.call_at=b.call_at AND a.due_at=b.call_at-interval '1 hour'
    FROM public.booking_work_actions a JOIN public.book_call_leads b ON b.id=a.booking_id
    WHERE a.id=v_hour),'a reschedule moves an already-created one-hour action');
  PERFORM pg_temp.issue_4640_assert((SELECT c.due_on=(a.due_at AT TIME ZONE p.time_zone)::date
    FROM public.booking_work_actions a JOIN public.ops_work_cards c ON c.id=a.card_id
    JOIN public.book_call_leads b ON b.id=a.booking_id JOIN public.booking_scheduler_profiles p ON p.key=b.scheduler_key
    WHERE a.id=v_hour),'the visible one-hour Work card follows the new call window');

  UPDATE public.book_call_leads SET status='cancelled' WHERE id=v_booking;
  PERFORM pg_temp.issue_4640_assert((SELECT bool_and(state='cancelled') FROM public.booking_reminder_jobs WHERE booking_id=v_booking),'cancelled calls cancel pending reminders');
  PERFORM pg_temp.issue_4640_assert((SELECT count(*)=2 FROM public.ops_work_cards WHERE auto_key IN ('demo_booked:'||v_booking,'demo_hour:'||v_booking) AND status='done' AND close_kind='system'),'cancellation closes both visible cards with history');
END
$test$;

ROLLBACK;
