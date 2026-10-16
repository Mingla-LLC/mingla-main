-- Issue #3802 Wave 2 rework — durable approval, duplicate and payload-free audit proof.
\set ON_ERROR_STOP on
begin;
alter table auth.users add column if not exists email_confirmed_at timestamptz;
insert into auth.users(id,email,email_confirmed_at) values
 ('38020000-0000-4000-c500-000000000001','issue3802cr-growth@test.local',now());
insert into public.admin_team_members(email,role,status,accepted_at)
 values ('issue3802cr-growth@test.local','growth','active',now());

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
create function pg_temp.fails(p_sql text,p_token text) returns boolean language plpgsql as $fn$
begin execute p_sql; return false; exception when others then return position(p_token in sqlerrm)>0; end $fn$;

do $proof$
declare uid constant uuid := '38020000-0000-4000-c500-000000000001'; email constant text := 'issue3802cr-growth@test.local';
  answer jsonb; card_id uuid; direct_card_id uuid; rev bigint; direct_card public.content_calendar_items;
begin
  answer:=pg_temp.as_user(uid,email,$q$select public.content_calendar_create('Launch Plan','reworkcreate01')::text$q$)::jsonb;
  card_id:=(answer#>>'{item,id}')::uuid;
  perform pg_temp.ok(pg_temp.as_user(uid,email,$q$select public.content_calendar_create(' launch   plan ','reworkcreate02')::text$q$) like 'ERR:23505:duplicate_title:%','normalized exact duplicate refused');
  answer:=pg_temp.as_user(uid,email,$q$select public.content_calendar_duplicate_check('Launch')::text$q$)::jsonb;
  perform pg_temp.ok(jsonb_array_length(answer->'similar')=1 and answer#>>'{similar,0,id}'=card_id::text,'likely duplicate returned as a warning candidate');

  answer:=pg_temp.as_user(uid,email,format($q$select public.content_calendar_update(%L,'{"copy":"Approved words","channels":["instagram"],"publish_at":"2026-10-28T14:00:00Z","drive_url":"http://example.test/design"}'::jsonb,1,'reworkupdate01')::text$q$,card_id))::jsonb;
  answer:=pg_temp.as_user(uid,email,format($q$select public.content_calendar_move(%L,'writing',2,false,false,false,'reworkmove001')::text$q$,card_id))::jsonb;
  answer:=pg_temp.as_user(uid,email,format($q$select public.content_calendar_move(%L,'design',3,true,false,false,'reworkmove002')::text$q$,card_id))::jsonb;
  perform pg_temp.ok(answer#>>'{item,copy_approved_by}'=email and answer#>>'{item,copy_approved_at}' is not null,'copy approval actor and time stored');
  rev:=(answer#>>'{item,revision}')::bigint;

  perform pg_temp.ok(pg_temp.as_user(uid,email,format($q$select public.content_calendar_update(%L,'{"copy":"changed later"}'::jsonb,%s,'reworkcopylock')::text$q$,card_id,rev)) like 'ERR:22023:copy_locked:%','RPC cannot change copy after Writing');
  perform pg_temp.ok(pg_temp.fails(format('update public.content_calendar_items set copy_text=%L where id=%L','direct mutation',card_id),'copy_locked:'),'direct write cannot change copy after Writing');
  perform pg_temp.ok(pg_temp.fails(format('insert into public.content_calendar_items(title,stage,owner_emails,created_by,updated_by) values(%L,%L,array[%L],%L,%L)','Blank design','design',email,email,email),'copy_approval_required:'),'direct design insert cannot bypass copy approval');

  answer:=pg_temp.as_user(uid,email,format($q$select public.content_calendar_move(%L,'review',%s,false,false,false,'reworkmove003')::text$q$,card_id,rev))::jsonb;
  rev:=(answer#>>'{item,revision}')::bigint;
  answer:=pg_temp.as_user(uid,email,format($q$select public.content_calendar_move(%L,'scheduled',%s,false,true,false,'reworkmove004')::text$q$,card_id,rev))::jsonb;
  perform pg_temp.ok(answer#>>'{item,design_approved_by}'=email and answer#>>'{item,design_approved_at}' is not null,'design approval actor and time stored');
  rev:=(answer#>>'{item,revision}')::bigint;
  perform pg_temp.ok(pg_temp.fails(format('update public.content_calendar_items set channels=array[]::text[] where id=%L',card_id),'schedule_required:'),'direct scheduled update cannot clear channels');

  answer:=pg_temp.as_user(uid,email,format($q$select public.content_calendar_move(%L,'review',%s,false,false,false,'reworkback001')::text$q$,card_id,rev))::jsonb;
  perform pg_temp.ok(answer#>>'{item,design_approved_by}' is null and answer#>>'{item,copy_approved_by}'=email,'back to Review resets design approval only');
  rev:=(answer#>>'{item,revision}')::bigint;
  answer:=pg_temp.as_user(uid,email,format($q$select public.content_calendar_move(%L,'writing',%s,false,false,false,'reworkback002')::text$q$,card_id,rev))::jsonb;
  perform pg_temp.ok(answer#>>'{item,design_approved_by}' is null and answer#>>'{item,copy_approved_by}' is null,'back to Writing resets both approvals');

  insert into public.content_calendar_items(title,stage,owner_emails,copy_text,copy_approved_by,copy_approved_at,design_approved_by,design_approved_at,publish_at,channels,created_by,updated_by)
    values('Direct guard reset','scheduled',array[email],'Approved direct words',email,now(),email,now(),now(),array['instagram'],email,email)
    returning id into direct_card_id;
  update public.content_calendar_items set stage='writing' where id=direct_card_id returning * into direct_card;
  perform pg_temp.ok(direct_card.copy_approved_by is null and direct_card.copy_approved_at is null and direct_card.design_approved_by is null and direct_card.design_approved_at is null,
    'database trigger clears stale approvals on a direct backward move');

  perform pg_temp.ok(not exists(
    select 1 from public.content_calendar_audit a, lateral jsonb_object_keys(a.metadata) k
    where k in ('title','copy','copy_text','notes','body','comment','drive_url','live_url','before','after')),'audit keys are payload-free');
  perform pg_temp.ok(not exists(select 1 from public.content_calendar_audit where metadata::text like '%Approved words%' or metadata::text like '%Launch Plan%' or metadata::text like '%example.test%'),'audit values contain no content payload');
  perform pg_temp.ok(pg_temp.fails(format('select public.content_calendar_audit_write(%L,%L,null,%L,%L::jsonb)',card_id,email,'bad.audit','{"title":"payload"}'),'content_calendar_audit_metadata_check'),'audit writer cannot store forbidden payload keys');
end $proof$;
\echo 'ISSUE-3802 WAVE2 CONTENT CALENDAR REWORK ADVERSARIAL PASS'
rollback;
