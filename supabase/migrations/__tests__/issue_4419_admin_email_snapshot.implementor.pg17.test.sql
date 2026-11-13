-- #4419 Part A — the exact copy of an Admin email never changes once saved.
--
-- MINGLA-INVARIANT: I-4419-EMAIL-SNAPSHOT-IMMUTABLE | issue #4419 | Once admin_email_log.rendered_at is set, no role (service_role, an active admin through RLS, the table owner) can change or clear rendered_subject, rendered_preheader, rendered_html, rendered_text, rendered_document, rendered_at or render_sample; the trigger raises admin_email_snapshot_immutable (PT409).
--
-- Also: the copy is all-or-none and size-capped; anon and a non-admin read no
-- campaign; other columns still change after the copy; cancelled_by clears
-- when the user is deleted; the Emails list read derives state, filters,
-- counts, searches with escaping, keeps non-admins to scheduled emails and
-- never returns the stored HTML; the delivery summary groups failure reasons.
--
-- Fails on f8fdac7cc3 (before #4419): the columns, trigger and functions did not exist.
\set ON_ERROR_STOP on
BEGIN;

CREATE FUNCTION pg_temp.act(p_user uuid) RETURNS void LANGUAGE sql AS $fn$
  SELECT set_config('request.jwt.claim.sub',coalesce(p_user::text,''),true),
         set_config('request.jwt.claims',CASE WHEN p_user IS NULL THEN '' ELSE json_build_object('sub',p_user,'role','authenticated','email',(SELECT email FROM auth.users WHERE id=p_user))::text END,true),
         set_config('request.jwt.claim.email',coalesce((SELECT email FROM auth.users WHERE id=p_user),''),true);
$fn$;

SET LOCAL session_replication_role = replica;
INSERT INTO auth.users(id,email) VALUES
  ('44190000-0000-4000-8000-0000000000a1','i4419-admin@mingla.test'),
  ('44190000-0000-4000-8000-0000000000b1','i4419-member@mingla.test'),
  ('44190000-0000-4000-8000-0000000000c1','i4419-canceller@mingla.test');
INSERT INTO public.profiles(id,display_name) VALUES
  ('44190000-0000-4000-8000-0000000000a1','Abimbola Admin'),
  ('44190000-0000-4000-8000-0000000000b1','Member Person'),
  ('44190000-0000-4000-8000-0000000000c1','Cancel Person');
INSERT INTO public.admin_users(email,status) VALUES('i4419-admin@mingla.test','active');
SET LOCAL session_replication_role = origin;

-- Six campaigns, one per state, plus one unknown (draft).
INSERT INTO public.admin_email_log(id,subject,body,recipient_type,status,sent_by,scheduled_for,started_at,created_at,recipient_count,matched_count,sent_count,failed_count,body_document) VALUES
  ('44190000-0000-4000-8000-000000000e01','Lagos this weekend','Rooftops','bulk','scheduled','44190000-0000-4000-8000-0000000000a1',now()+interval '2 days',NULL,now()-interval '1 day',10,12,0,0,
     '{"version":1,"blocks":[{"type":"rich_text","html":"<p>x</p>"},{"type":"image","url":"https://cdn.test/a.png","alt":"A"}]}'),
  ('44190000-0000-4000-8000-000000000e02','100% off_promo','Promo','bulk','queued','44190000-0000-4000-8000-0000000000a1',NULL,now()-interval '1 minute',now()-interval '2 hours',5,5,2,0,NULL),
  ('44190000-0000-4000-8000-000000000e03','Sent one','Body','bulk','completed','44190000-0000-4000-8000-0000000000a1',NULL,now()-interval '3 days',now()-interval '3 days',5,5,5,0,NULL),
  ('44190000-0000-4000-8000-000000000e04','Partial one','Body','bulk','partial','44190000-0000-4000-8000-0000000000a1',NULL,now()-interval '4 days',now()-interval '4 days',5,5,3,2,NULL),
  ('44190000-0000-4000-8000-000000000e05','Failed one','Body','bulk','failed',NULL,NULL,NULL,now()-interval '30 days',1,1,0,1,NULL),
  ('44190000-0000-4000-8000-000000000e06','Cancelled one','Body','bulk','cancelled','44190000-0000-4000-8000-0000000000a1',now()+interval '9 days',NULL,now()-interval '5 hours',5,5,0,0,NULL),
  ('44190000-0000-4000-8000-000000000e07','Draft one','Body','individual','draft','44190000-0000-4000-8000-0000000000a1',NULL,NULL,now()-interval '6 hours',1,1,0,0,NULL);
UPDATE public.admin_email_log SET recipient_email='maya.okafor@example.com', audience='{"mode":"person","email":"maya.okafor@example.com"}' WHERE id='44190000-0000-4000-8000-000000000e07';

DO $$ BEGIN
  -- Happy: the copy is saved once, all columns together, and reads back equal.
  UPDATE public.admin_email_log SET
    rendered_subject='Sent one', rendered_preheader='', rendered_html='<html>A</html>', rendered_text='A',
    rendered_document='{"version":1,"blocks":[]}', rendered_at=now(), render_sample='{"first_name":"Maya"}'
  WHERE id='44190000-0000-4000-8000-000000000e03' AND rendered_at IS NULL;
  IF (SELECT rendered_html FROM public.admin_email_log WHERE id='44190000-0000-4000-8000-000000000e03') IS DISTINCT FROM '<html>A</html>' THEN
    RAISE EXCEPTION '4419.happy: copy not saved';
  END IF;
  IF (SELECT rendered_preheader FROM public.admin_email_log WHERE id='44190000-0000-4000-8000-000000000e03') IS DISTINCT FROM '' THEN
    RAISE EXCEPTION '4419.happy: an empty preheader must be kept as empty';
  END IF;
END $$;

-- Adversarial: as the table owner / service role, every copy column is frozen.
DO $$ DECLARE col text; BEGIN
  FOREACH col IN ARRAY ARRAY['rendered_subject','rendered_preheader','rendered_html','rendered_text','rendered_document','render_sample','rendered_at'] LOOP
    BEGIN
      EXECUTE format('UPDATE public.admin_email_log SET %I = %s WHERE id = %L', col,
        CASE WHEN col IN ('rendered_document','render_sample') THEN '''{"changed":true}''::jsonb'
             WHEN col = 'rendered_at' THEN 'now() + interval ''1 hour'''
             ELSE '''changed''' END,
        '44190000-0000-4000-8000-000000000e03');
      RAISE EXCEPTION '4419.immutable: % changed after the copy was saved', col;
    EXCEPTION WHEN SQLSTATE 'PT409' THEN
      IF SQLERRM <> 'admin_email_snapshot_immutable' THEN RAISE; END IF;
    END;
  END LOOP;
  -- Clearing the copy (rendered_at back to null, all columns null) is refused too.
  BEGIN
    UPDATE public.admin_email_log SET rendered_subject=NULL, rendered_preheader=NULL, rendered_html=NULL, rendered_text=NULL,
      rendered_document=NULL, rendered_at=NULL, render_sample=NULL WHERE id='44190000-0000-4000-8000-000000000e03';
    RAISE EXCEPTION '4419.immutable: the copy was cleared';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;
  END;
  -- Other columns still change after the copy.
  UPDATE public.admin_email_log SET status='completed', sent_count=6 WHERE id='44190000-0000-4000-8000-000000000e03';
  IF (SELECT sent_count FROM public.admin_email_log WHERE id='44190000-0000-4000-8000-000000000e03') <> 6 THEN
    RAISE EXCEPTION '4419.other columns: sent_count did not update';
  END IF;
END $$;

DO $$ BEGIN
  -- service_role is refused the same way.
  SET LOCAL ROLE service_role;
  BEGIN
    UPDATE public.admin_email_log SET rendered_html='<html>B</html>' WHERE id='44190000-0000-4000-8000-000000000e03';
    RAISE EXCEPTION '4419.service_role changed the copy';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;
  END;
  RESET ROLE;
END $$;

-- An active admin, through RLS (admin_all_email_log is FOR ALL), is refused.
SELECT pg_temp.act('44190000-0000-4000-8000-0000000000a1');
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.admin_email_log WHERE id::text LIKE '44190000-%') <> 7 THEN
    RAISE EXCEPTION '4419.rls: the admin should read all 7 campaigns';
  END IF;
  BEGIN
    UPDATE public.admin_email_log SET rendered_text='B' WHERE id='44190000-0000-4000-8000-000000000e03';
    RAISE EXCEPTION '4419.admin changed the copy';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;
  END;
END $$;
RESET ROLE;

-- A non-admin teammate and anon read no campaign directly.
SELECT pg_temp.act('44190000-0000-4000-8000-0000000000b1');
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.admin_email_log) <> 0 THEN RAISE EXCEPTION '4419.rls: a non-admin read campaigns'; END IF;
END $$;
RESET ROLE;
SELECT pg_temp.act(NULL);
SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN
    IF (SELECT count(*) FROM public.admin_email_log) <> 0 THEN RAISE EXCEPTION '4419.rls: anon read campaigns'; END IF;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.issue_4419_admin_email_list('all', NULL, true, 20, 0);
    RAISE EXCEPTION '4419.grants: anon called the list';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
SELECT pg_temp.act('44190000-0000-4000-8000-0000000000b1');
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN
    PERFORM public.issue_4419_admin_email_delivery_summary('44190000-0000-4000-8000-000000000e03');
    RAISE EXCEPTION '4419.grants: a signed-in user called the summary';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

DO $$ BEGIN
  -- A partial copy (html without text) is refused.
  BEGIN
    UPDATE public.admin_email_log SET rendered_subject='x', rendered_preheader='', rendered_html='<p>x</p>',
      rendered_document='{}', rendered_at=now(), render_sample='{}' WHERE id='44190000-0000-4000-8000-000000000e04';
    RAISE EXCEPTION '4419.check: a copy without plain text was saved';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  -- 1 MB + 1 byte of HTML is refused.
  BEGIN
    UPDATE public.admin_email_log SET rendered_subject='x', rendered_preheader='', rendered_html=repeat('a', 1048577), rendered_text='x',
      rendered_document='{}', rendered_at=now(), render_sample='{}' WHERE id='44190000-0000-4000-8000-000000000e04';
    RAISE EXCEPTION '4419.check: an oversize copy was saved';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  -- Exactly 1 MB is fine.
  UPDATE public.admin_email_log SET rendered_subject='x', rendered_preheader='', rendered_html=repeat('a', 1048576), rendered_text='x',
    rendered_document='{}', rendered_at=now(), render_sample='{}' WHERE id='44190000-0000-4000-8000-000000000e04';
END $$;

DO $$ BEGIN
  -- cancelled_by clears when its user is deleted.
  UPDATE public.admin_email_log SET cancelled_by='44190000-0000-4000-8000-0000000000c1' WHERE id='44190000-0000-4000-8000-000000000e06';
  DELETE FROM auth.users WHERE id='44190000-0000-4000-8000-0000000000c1';
  IF (SELECT cancelled_by FROM public.admin_email_log WHERE id='44190000-0000-4000-8000-000000000e06') IS NOT NULL THEN
    RAISE EXCEPTION '4419.fk: cancelled_by kept a deleted user';
  END IF;
END $$;

-- The Emails list read (service role, after the edge function's team check).
DO $$ DECLARE v jsonb; r jsonb; BEGIN
  DELETE FROM public.admin_email_log WHERE id::text NOT LIKE '44190000-%';
  v := public.issue_4419_admin_email_list('all', NULL, true, 20, 0);
  IF v->'counts' <> '{"all":7,"scheduled":1,"sending":1,"sent":1,"attention":2,"cancelled":1}'::jsonb THEN
    RAISE EXCEPTION '4419.list counts: %', v->'counts';
  END IF;
  -- Scheduled pinned first, then newest start/creation first; the draft is "unknown".
  IF (SELECT array_agg(x->>'id' ORDER BY n) FROM jsonb_array_elements(v->'rows') WITH ORDINALITY t(x,n)) <> ARRAY[
      '44190000-0000-4000-8000-000000000e01','44190000-0000-4000-8000-000000000e02','44190000-0000-4000-8000-000000000e06',
      '44190000-0000-4000-8000-000000000e07','44190000-0000-4000-8000-000000000e03','44190000-0000-4000-8000-000000000e04',
      '44190000-0000-4000-8000-000000000e05'] THEN
    RAISE EXCEPTION '4419.list order: %', (SELECT array_agg(x->>'subject' ORDER BY n) FROM jsonb_array_elements(v->'rows') WITH ORDINALITY t(x,n));
  END IF;
  IF (SELECT x->>'state' FROM jsonb_array_elements(v->'rows') x WHERE x->>'id' = '44190000-0000-4000-8000-000000000e07') <> 'unknown' THEN
    RAISE EXCEPTION '4419.list: a draft must be unknown, never guessed';
  END IF;
  IF (SELECT x->>'state' FROM jsonb_array_elements(v->'rows') x WHERE x->>'id' = '44190000-0000-4000-8000-000000000e02') <> 'sending' THEN
    RAISE EXCEPTION '4419.list: queued between batches must read as sending';
  END IF;
  IF (SELECT x->>'thumb_url' FROM jsonb_array_elements(v->'rows') x WHERE x->>'id' = '44190000-0000-4000-8000-000000000e01') <> 'https://cdn.test/a.png' THEN
    RAISE EXCEPTION '4419.list: the thumbnail is the first image';
  END IF;
  -- The stored HTML, text and documents never leave in a list.
  IF v::text ~ '(rendered_html|rendered_text|rendered_document|body_document|<html>)' THEN
    RAISE EXCEPTION '4419.list leaked the stored copy';
  END IF;
  -- A bulk send never carries an address.
  FOR r IN SELECT * FROM jsonb_array_elements(v->'rows') LOOP
    IF r->>'recipient_type' = 'bulk' AND r->>'recipient_email' IS NOT NULL THEN RAISE EXCEPTION '4419.list: bulk address'; END IF;
    IF r->'audience' ? 'email' THEN RAISE EXCEPTION '4419.list: audience email leaked'; END IF;
  END LOOP;
  -- Filters.
  IF public.issue_4419_admin_email_list('attention', NULL, true, 20, 0)->>'total' <> '2' THEN RAISE EXCEPTION '4419.list attention'; END IF;
  IF public.issue_4419_admin_email_list('sending', NULL, true, 20, 0)->>'total' <> '1' THEN RAISE EXCEPTION '4419.list sending'; END IF;
  IF public.issue_4419_admin_email_list('cancelled', NULL, true, 20, 0)->>'total' <> '1' THEN RAISE EXCEPTION '4419.list cancelled'; END IF;
  -- Paging.
  v := public.issue_4419_admin_email_list('all', NULL, true, 2, 2);
  IF jsonb_array_length(v->'rows') <> 2 OR v->'rows'->0->>'id' <> '44190000-0000-4000-8000-000000000e06' OR v->>'total' <> '7' THEN
    RAISE EXCEPTION '4419.list paging: %', v;
  END IF;
  -- Search with an escaped pattern: % and _ are literal.
  v := public.issue_4419_admin_email_list('all', '%100\% off\_%', true, 20, 0);
  IF v->>'total' <> '1' OR v->'rows'->0->>'subject' <> '100% off_promo' THEN RAISE EXCEPTION '4419.list escaped search: %', v; END IF;
  v := public.issue_4419_admin_email_list('all', '%\_%', true, 20, 0);
  IF v->>'total' <> '1' THEN RAISE EXCEPTION '4419.list: an escaped underscore matched more than one subject'; END IF;
  -- Non-admins see scheduled emails only (Seth, 13 Nov: only admins see sent emails).
  v := public.issue_4419_admin_email_list('all', NULL, false, 20, 0);
  IF v->>'total' <> '1' OR v->'rows'->0->>'state' <> 'scheduled' OR (v->'counts'->>'sent')::int <> 0 THEN
    RAISE EXCEPTION '4419.list non-admin: %', v;
  END IF;
END $$;

-- The delivery summary groups failure reasons, counts statuses, keeps one raw line.
INSERT INTO public.admin_email_recipient_deliveries(campaign_id,recipient_email,status,last_error,created_at) VALUES
  ('44190000-0000-4000-8000-000000000e04','a@x.test','accepted',NULL,now()-interval '5 minutes'),
  ('44190000-0000-4000-8000-000000000e04','b@x.test','failed','Resend 429: {"message":"Too many requests"}',now()-interval '4 minutes'),
  ('44190000-0000-4000-8000-000000000e04','c@x.test','failed','Resend 429: {"message":"Too many requests"}',now()-interval '3 minutes'),
  ('44190000-0000-4000-8000-000000000e04','d@x.test','retrying','Resend 401: API key is invalid',now()-interval '2 minutes'),
  ('44190000-0000-4000-8000-000000000e04','e@x.test','failed','Resend 422: invalid to',now()-interval '1 minute'),
  ('44190000-0000-4000-8000-000000000e04','f@x.test','failed','Resend 503: unavailable',now()),
  ('44190000-0000-4000-8000-000000000e04','g@x.test','failed','boom',now()),
  ('44190000-0000-4000-8000-000000000e04','h@x.test','skipped_opt_out',NULL,now());
DO $$ DECLARE v jsonb; BEGIN
  v := public.issue_4419_admin_email_delivery_summary('44190000-0000-4000-8000-000000000e04');
  IF (v->>'total')::int <> 8 OR (v->>'accepted')::int <> 1 OR (v->>'failed')::int <> 5 OR (v->>'pending')::int <> 1 OR (v->>'skipped_late')::int <> 1 THEN
    RAISE EXCEPTION '4419.summary counts: %', v;
  END IF;
  IF v->'by_reason' <> '[{"code":"rate_limited","count":2},{"code":"invalid_address","count":1},{"code":"other","count":1},{"code":"provider_down","count":1},{"code":"provider_key","count":1}]'::jsonb THEN
    RAISE EXCEPTION '4419.summary reasons: %', v->'by_reason';
  END IF;
  IF v->>'raw' <> 'Resend 429: {"message":"Too many requests"}' THEN RAISE EXCEPTION '4419.summary raw: %', v->>'raw'; END IF;
  v := public.issue_4419_admin_email_delivery_summary('44190000-0000-4000-8000-000000000e01');
  IF v->'by_reason' <> '[]'::jsonb OR v->'raw' <> 'null'::jsonb OR (v->>'total')::int <> 0 THEN RAISE EXCEPTION '4419.summary empty: %', v; END IF;
END $$;

ROLLBACK;
