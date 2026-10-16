-- Issue #3802 Wave 2 — adversarial proof for authority, locks and approvals.
\set ON_ERROR_STOP on
begin;
alter table auth.users add column if not exists email_confirmed_at timestamptz;
insert into auth.users(id,email,email_confirmed_at) values
 ('38020000-0000-4000-c300-000000000001','issue3802ca-owner@test.local',now()),
 ('38020000-0000-4000-c300-000000000002','issue3802ca-growth@test.local',now());
insert into public.admin_users(email,role,status,accepted_at) values ('issue3802ca-owner@test.local','owner','active',now());
insert into public.admin_team_members(email,role,status,accepted_at) values ('issue3802ca-growth@test.local','growth','active',now());
create function pg_temp.as_user(p_id uuid,p_email text,p_sql text) returns text language plpgsql as $fn$
declare out_ text; begin set local role authenticated; perform set_config('request.jwt.claim.sub',p_id::text,true); perform set_config('request.jwt.claim.email',p_email,true); perform set_config('request.jwt.claims',jsonb_build_object('sub',p_id,'email',p_email,'role','authenticated')::text,true); execute p_sql into out_; reset role; return out_; exception when others then reset role; return 'ERR:'||sqlstate||':'||sqlerrm; end $fn$;
create function pg_temp.ok(p_ok boolean,p_message text) returns void language plpgsql as $fn$ begin if not coalesce(p_ok,false) then raise exception 'FAIL: %',p_message; end if; end $fn$;
do $proof$
declare owner_id constant uuid := '38020000-0000-4000-c300-000000000001'; owner_email constant text := 'issue3802ca-owner@test.local'; growth_id constant uuid := '38020000-0000-4000-c300-000000000002'; growth_email constant text := 'issue3802ca-growth@test.local'; answer jsonb; card_id uuid; key_id uuid:=gen_random_uuid();
begin
  answer:=pg_temp.as_user(growth_id,growth_email,$q$select public.content_calendar_create('Guarded card','guardcreate1')::text$q$)::jsonb; card_id:=(answer#>>'{item,id}')::uuid;
  perform pg_temp.ok(pg_temp.as_user(growth_id,growth_email,format($q$select public.content_calendar_update(%L,'{"notes":"wrong"}'::jsonb,99,'guardstale01')::text$q$,card_id)) like 'ERR:40001:stale_write:%','stale update refused');
  perform pg_temp.ok(pg_temp.as_user(growth_id,growth_email,$q$select public.content_calendar_create('Changed','guardcreate1')::text$q$) like 'ERR:22023:request_key_reused:%','request key bound to full args');
  perform pg_temp.ok(pg_temp.as_user(growth_id,growth_email,format($q$select public.content_calendar_move(%L,'design',1,true,false,false,'guardskip001')::text$q$,card_id)) like 'ERR:22023:stage_order:%','forward skip refused');
  perform pg_temp.ok(pg_temp.as_user(growth_id,growth_email,format($q$select public.content_calendar_move(%L,'writing',1,false,false,false,'guardmove001')::text$q$,card_id)) not like 'ERR:%','move to writing');
  perform pg_temp.ok(pg_temp.as_user(growth_id,growth_email,format($q$select public.content_calendar_move(%L,'design',2,false,false,false,'guardcopy001')::text$q$,card_id)) like 'ERR:22023:copy_required:%','blank copy refused');
  perform pg_temp.ok(pg_temp.as_user(growth_id,growth_email,format($q$select public.content_calendar_delete(%L,2)::text$q$,card_id)) like 'ERR:42501:forbidden:%','growth cannot delete');
  perform pg_temp.ok(pg_temp.as_user(growth_id,growth_email,format($q$select public.content_calendar_assign(%L,array['outsider@test.local'],2,'guardowner01')::text$q$,card_id)) like 'ERR:22023:invalid_owners:%','outsider cannot own');
  perform pg_temp.ok(pg_temp.as_user(growth_id,growth_email,$q$select public.content_calendar_list('{"undated":"yes"}'::jsonb)::text$q$) like 'ERR:22023:invalid_query:%','hostile boolean refused');
  perform pg_temp.ok(has_table_privilege('authenticated','public.content_calendar_items','select')=false and not exists(select 1 from pg_policy where polrelid='public.content_calendar_items'::regclass),'closed table');
  perform pg_temp.ok(has_function_privilege('authenticated','public.team_agent_content_call(text,text,jsonb,text)','execute')=false,'gateway service-only');
  perform pg_temp.ok((select md5(prosrc) from pg_proc where oid='public.is_admin_user()'::regprocedure)='dc5465a20a4246c6921be0469e261a8b','is_admin_user unchanged');
  perform pg_temp.ok((select prosrc from pg_proc where oid='public.team_agent_content_call(text,text,jsonb,text)'::regprocedure) !~ '''delete_content''','agent has no delete');

  insert into public.team_agent_keys(id,owner_email,agent,key_prefix,key_hash,time_zone) values(key_id,growth_email,'codex','mgla_x_abcdefg',repeat('a',64),'UTC');
  insert into public.team_agent_calls(key_id,owner_email,actor_uid,agent,tool,xact_id) values(key_id,growth_email,growth_id,'codex','comment_content',pg_current_xact_id());
  answer:=pg_temp.as_user(growth_id,growth_email,format($q$select public.content_calendar_comment_add(%L,'Agent note','guardagent01')::text$q$,card_id))::jsonb;
  perform pg_temp.ok(answer#>>'{comment,via}'='codex' and exists(select 1 from public.content_calendar_audit where id=(answer->>'audit_id')::uuid and actor_email=growth_email and via='codex'),'person and agent audit');
end $proof$;
\echo 'ISSUE-3802 WAVE2 CONTENT CALENDAR ADVERSARIAL PASS'
rollback;
