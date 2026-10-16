-- Issue #3802 Wave 2 — happy-path proof for the closed content calendar.
\set ON_ERROR_STOP on
begin;
alter table auth.users add column if not exists email_confirmed_at timestamptz;
insert into auth.users(id,email,email_confirmed_at) values
 ('38020000-0000-4000-c200-000000000001','issue3802c-owner@test.local',now()),
 ('38020000-0000-4000-c200-000000000002','issue3802c-growth@test.local',now());
insert into public.admin_users(email,role,status,accepted_at) values ('issue3802c-owner@test.local','owner','active',now());
insert into public.admin_team_members(email,role,status,accepted_at) values ('issue3802c-growth@test.local','growth','active',now());

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
declare owner_id constant uuid := '38020000-0000-4000-c200-000000000001'; owner_email constant text := 'issue3802c-owner@test.local';
  growth_id constant uuid := '38020000-0000-4000-c200-000000000002'; growth_email constant text := 'issue3802c-growth@test.local';
  answer jsonb; card jsonb; card_id uuid; audit_id uuid; v_key_id uuid:=gen_random_uuid();
begin
  perform pg_temp.ok(pg_temp.as_user(owner_id,owner_email,$q$select public.content_calendar_config()::text$q$)::jsonb#>>'{me,role}'='owner','owner config');
  perform pg_temp.ok(pg_temp.as_user(growth_id,growth_email,$q$select public.content_calendar_config()::text$q$)::jsonb#>>'{me,role}'='growth','growth config');
  perform pg_temp.ok((select count(*) from jsonb_array_elements(public.content_calendar_stages()))=6,'six stages');

  answer:=pg_temp.as_user(growth_id,growth_email,$q$select public.content_calendar_create('Launch story','happycreate01')::text$q$)::jsonb;
  card:=answer->'item'; card_id:=(card->>'id')::uuid;
  perform pg_temp.ok(card->>'stage'='idea' and card->'owners'=jsonb_build_array(growth_email) and card->>'revision'='1','title-only create starts owned Idea');
  perform pg_temp.ok((pg_temp.as_user(growth_id,growth_email,$q$select public.content_calendar_create('Launch story','happycreate01')::text$q$)::jsonb)->>'replayed'='true','create replay');

  answer:=pg_temp.as_user(growth_id,growth_email,format($q$select public.content_calendar_update(%L,'{"copy":"Ready copy","channels":["instagram"],"publish_at":"2026-10-25T15:00:00Z"}'::jsonb,1,'happyupdate01')::text$q$,card_id))::jsonb;
  card:=answer->'item';
  perform pg_temp.ok(card->>'copy'='Ready copy' and card->'channels'='["instagram"]'::jsonb and card->>'revision'='2','details update');

  answer:=pg_temp.as_user(growth_id,growth_email,format($q$select public.content_calendar_move(%L,'writing',2,false,false,false,'happymove001')::text$q$,card_id))::jsonb;
  card:=answer->'item';
  answer:=pg_temp.as_user(growth_id,growth_email,format($q$select public.content_calendar_move(%L,'design',3,true,false,false,'happymove002')::text$q$,card_id))::jsonb;
  card:=answer->'item';
  answer:=pg_temp.as_user(growth_id,growth_email,format($q$select public.content_calendar_move(%L,'review',4,false,false,false,'happymove003')::text$q$,card_id))::jsonb;
  answer:=pg_temp.as_user(growth_id,growth_email,format($q$select public.content_calendar_move(%L,'scheduled',5,false,true,false,'happymove004')::text$q$,card_id))::jsonb;
  answer:=pg_temp.as_user(growth_id,growth_email,format($q$select public.content_calendar_move(%L,'published',6,false,false,true,'happymove005')::text$q$,card_id))::jsonb;
  perform pg_temp.ok(answer#>>'{item,stage}'='published' and answer#>>'{item,live_url}' is null,'explicit publish without link');

  answer:=pg_temp.as_user(growth_id,growth_email,format($q$select public.content_calendar_comment_add(%L,'Looks good','happycomment1')::text$q$,card_id))::jsonb;
  perform pg_temp.ok(answer#>>'{comment,body}'='Looks good','comment added');
  answer:=pg_temp.as_user(growth_id,growth_email,format($q$select public.content_calendar_update(%L,'{"publish_at":"2026-10-26T16:00:00Z"}'::jsonb,7,'happydate001')::text$q$,card_id))::jsonb;
  audit_id:=(answer->>'audit_id')::uuid;
  answer:=pg_temp.as_user(growth_id,growth_email,format($q$select public.content_calendar_undo(%L,8)::text$q$,audit_id))::jsonb;
  perform pg_temp.ok((answer#>>'{item,publish_at}')::timestamptz='2026-10-25T15:00:00Z'::timestamptz,'eight-second undo restores time');

  perform pg_temp.ok((pg_temp.as_user(owner_id,owner_email,$q$select public.content_calendar_list('{"limit":500}'::jsonb)::text$q$)::jsonb->>'total')::int=1,'shared calendar visible');
  perform pg_temp.ok(pg_temp.as_user(owner_id,owner_email,format($q$select public.content_calendar_delete(%L,9)::text$q$,card_id)) not like 'ERR:%','owner deletes');
  perform pg_temp.ok((select count(*) from public.content_calendar_audit where item_id=card_id and actor_email=growth_email and via is null)>=9,'person audit');

  insert into public.team_agent_keys(id,owner_email,agent,key_prefix,key_hash,time_zone)
    values(v_key_id,growth_email,'codex','mgla_x_wave2ok',repeat('b',64),'UTC');
  answer:=public.team_agent_content_call(repeat('b',64),'add_content','{"items":[{"title":"Agent idea"}],"request_key":"agentadd001"}'::jsonb,'suite');
  perform pg_temp.ok(answer->>'ok'='true' and answer#>>'{result,created}'='1','agent add');
  card_id:=(answer#>>'{result,items,0,item,id}')::uuid;
  answer:=public.team_agent_content_call(repeat('b',64),'list_content',jsonb_build_object('id',card_id),'suite');
  perform pg_temp.ok(answer#>>'{result,item,title}'='Agent idea','agent get through list');
  answer:=public.team_agent_content_call(repeat('b',64),'update_content',jsonb_build_object('id',card_id,'changes',jsonb_build_object('copy','Agent copy'),'expected_revision',1,'request_key','agentupdate1'),'suite');
  perform pg_temp.ok(answer#>>'{result,item,revision}'='2','agent update');
  answer:=public.team_agent_content_call(repeat('b',64),'assign_content',jsonb_build_object('id',card_id,'owner_emails',jsonb_build_array(owner_email,growth_email),'expected_revision',2,'request_key','agentassign1'),'suite');
  perform pg_temp.ok(answer#>>'{result,item,revision}'='3','agent assign');
  answer:=public.team_agent_content_call(repeat('b',64),'comment_content',jsonb_build_object('id',card_id,'body','Agent comment','request_key','agentcomment1'),'suite');
  perform pg_temp.ok(answer#>>'{result,comment,via}'='codex','agent comment attribution');
  answer:=public.team_agent_content_call(repeat('b',64),'move_content',jsonb_build_object('id',card_id,'to','writing','expected_revision',3,'request_key','agentmove001'),'suite');
  perform pg_temp.ok(answer#>>'{result,item,stage}'='writing','agent move');
  perform pg_temp.ok((select count(*) from public.team_agent_calls c where c.key_id=v_key_id and c.outcome='ok')=6,'six connector calls recorded');
  perform pg_temp.ok((select count(*) from public.content_calendar_audit where item_id=card_id and actor_email=growth_email and via='codex')=5,'agent writes audit person and Codex');
end $proof$;
\echo 'ISSUE-3802 WAVE2 CONTENT CALENDAR HAPPY PASS'
rollback;
