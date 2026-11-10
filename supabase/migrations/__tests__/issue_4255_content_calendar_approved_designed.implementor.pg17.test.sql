-- toward #4255: content calendar stages follow Seth's model (10 Nov 2026).
-- Proves: Designed needs a Drive link; Approved records the go; Scheduled needs
-- the go; going back to Approved keeps the go, back to Designed clears it; the
-- calendar read shows only Approved, Scheduled and Published posts.
-- INVARIANT I-4255-CONTENT-CALENDAR-STAGES: content_calendar_move refuses
-- writing->design and design->review without drive_url (drive_required), records
-- design approval only on design->review, and ops_calendar.content /
-- posts_undated include only stages review, scheduled, published.
\set ON_ERROR_STOP on
begin;
alter table auth.users add column if not exists email_confirmed_at timestamptz;
insert into auth.users(id,email,email_confirmed_at) values
 ('42550000-0000-4000-c100-000000000001','issue4255-growth@test.local',now());
insert into public.admin_team_members(email,role,status,accepted_at)
 values ('issue4255-growth@test.local','growth','active',now());

create function pg_temp.as_user(p_id uuid,p_email text,p_sql text) returns text language plpgsql as $fn$
declare out_ text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub',p_id::text,true);
  perform set_config('request.jwt.claim.email',p_email,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',p_id,'email',p_email,'role','authenticated')::text,true);
  execute p_sql into out_;
  reset role;
  return out_;
exception when others then reset role; return 'ERR:'||sqlstate||':'||sqlerrm; end $fn$;
create function pg_temp.ok(p_ok boolean,p_message text) returns void language plpgsql as $fn$
begin if not coalesce(p_ok,false) then raise exception 'FAIL: %',p_message; end if; end $fn$;

do $proof$
declare uid constant uuid := '42550000-0000-4000-c100-000000000001'; email constant text := 'issue4255-growth@test.local';
  answer jsonb; card_id uuid; rev bigint; cal jsonb; titles text[]; undated_before bigint; undated_after bigint;
begin
  answer:=pg_temp.as_user(uid,email,$q$select public.content_calendar_create('I4255 Weekend carousel','i4255create01')::text$q$)::jsonb;
  card_id:=(answer#>>'{item,id}')::uuid;
  answer:=pg_temp.as_user(uid,email,format($q$select public.content_calendar_update(%L,'{"copy":"Finished words","channels":["instagram"],"publish_at":"2031-03-12T15:00:00Z"}'::jsonb,1,'i4255update01')::text$q$,card_id))::jsonb;
  answer:=pg_temp.as_user(uid,email,format($q$select public.content_calendar_move(%L,'writing',2,false,false,false,'i4255move001')::text$q$,card_id))::jsonb;
  rev:=(answer#>>'{item,revision}')::bigint;

  -- An Idea or Writing card with a date is not on the calendar.
  cal:=pg_temp.as_user(uid,email,$q$select public.ops_calendar('2031-03-01','2031-03-31','2031-03-01')::text$q$)::jsonb;
  perform pg_temp.ok(not exists(select 1 from jsonb_array_elements(cal->'content') c where c->>'id'=card_id::text),'Writing card stays off the calendar');

  -- Designed needs a Drive link to the finished design.
  perform pg_temp.ok(pg_temp.as_user(uid,email,format($q$select public.content_calendar_move(%L,'design',%s,true,false,false,'i4255nodrive1')::text$q$,card_id,rev)) like 'ERR:22023:drive_required:%','Designed without a Drive link refused');
  answer:=pg_temp.as_user(uid,email,format($q$select public.content_calendar_update(%L,'{"drive_url":"https://drive.example.test/i4255"}'::jsonb,%s,'i4255drive001')::text$q$,card_id,rev))::jsonb;
  rev:=(answer#>>'{item,revision}')::bigint;
  answer:=pg_temp.as_user(uid,email,format($q$select public.content_calendar_move(%L,'design',%s,true,false,false,'i4255move002')::text$q$,card_id,rev))::jsonb;
  perform pg_temp.ok(answer#>>'{item,stage}'='design' and answer#>>'{item,design_approved_at}' is null,'Designed with a Drive link, no go yet');
  rev:=(answer#>>'{item,revision}')::bigint;
  cal:=pg_temp.as_user(uid,email,$q$select public.ops_calendar('2031-03-01','2031-03-31','2031-03-01')::text$q$)::jsonb;
  perform pg_temp.ok(not exists(select 1 from jsonb_array_elements(cal->'content') c where c->>'id'=card_id::text),'Designed card stays off the calendar');

  -- Approved records the go; without it the move is refused.
  perform pg_temp.ok(pg_temp.as_user(uid,email,format($q$select public.content_calendar_move(%L,'review',%s,false,false,false,'i4255nogo0001')::text$q$,card_id,rev)) like 'ERR:22023:design_approval_required:%','Approved without the go refused');
  answer:=pg_temp.as_user(uid,email,format($q$select public.content_calendar_move(%L,'review',%s,false,true,false,'i4255move003')::text$q$,card_id,rev))::jsonb;
  perform pg_temp.ok(answer#>>'{item,stage}'='review' and answer#>>'{item,design_approved_by}'=email and answer#>>'{item,design_approved_at}' is not null,'Approved stores who gave the go and when');
  rev:=(answer#>>'{item,revision}')::bigint;
  cal:=pg_temp.as_user(uid,email,$q$select public.ops_calendar('2031-03-01','2031-03-31','2031-03-01')::text$q$)::jsonb;
  perform pg_temp.ok(exists(select 1 from jsonb_array_elements(cal->'content') c where c->>'id'=card_id::text and c->>'stage'='review'),'Approved card is on the calendar');

  -- Scheduled needs only the date and channels now; the go is already recorded.
  answer:=pg_temp.as_user(uid,email,format($q$select public.content_calendar_move(%L,'scheduled',%s,false,false,false,'i4255move004')::text$q$,card_id,rev))::jsonb;
  perform pg_temp.ok(answer#>>'{item,stage}'='scheduled' and answer#>>'{item,design_approved_by}'=email,'Scheduled keeps the go');
  rev:=(answer#>>'{item,revision}')::bigint;

  -- Back to Approved keeps the go; back to Designed clears it.
  answer:=pg_temp.as_user(uid,email,format($q$select public.content_calendar_move(%L,'review',%s,false,false,false,'i4255back001')::text$q$,card_id,rev))::jsonb;
  perform pg_temp.ok(answer#>>'{item,design_approved_by}'=email,'back to Approved keeps the go');
  rev:=(answer#>>'{item,revision}')::bigint;
  answer:=pg_temp.as_user(uid,email,format($q$select public.content_calendar_move(%L,'design',%s,false,false,false,'i4255back002')::text$q$,card_id,rev))::jsonb;
  perform pg_temp.ok(answer#>>'{item,stage}'='design' and answer#>>'{item,design_approved_by}' is null and answer#>>'{item,copy_approved_by}'=email,'back to Designed clears the go only');

  -- Moving forward to Approved again needs the go again.
  perform pg_temp.ok(pg_temp.as_user(uid,email,format($q$select public.content_calendar_move(%L,'review',%s,false,false,false,'i4255nogo0002')::text$q$,card_id,(answer#>>'{item,revision}')::bigint)) like 'ERR:22023:design_approval_required:%','Approved again needs the go again');

  -- Undated count covers calendar stages only.
  undated_before:=(pg_temp.as_user(uid,email,$q$select public.ops_calendar('2031-03-01','2031-03-31','2031-03-01')::text$q$)::jsonb->>'posts_undated')::bigint;
  answer:=pg_temp.as_user(uid,email,$q$select public.content_calendar_create('I4255 Undated idea','i4255create02')::text$q$)::jsonb;
  undated_after:=(pg_temp.as_user(uid,email,$q$select public.ops_calendar('2031-03-01','2031-03-31','2031-03-01')::text$q$)::jsonb->>'posts_undated')::bigint;
  perform pg_temp.ok(undated_after=undated_before,'an undated Idea is not counted as a calendar post');
end $proof$;
\echo 'ISSUE-4255 CONTENT CALENDAR APPROVED/DESIGNED PASS'
rollback;
