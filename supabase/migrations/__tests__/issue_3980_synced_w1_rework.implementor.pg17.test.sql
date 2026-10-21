-- Issue #3980 synced program, Wave 1 rework -- implementor regression suite
-- for the tester's FAIL, on the fully replayed PG17 schema. Each block turns
-- one defect probe into a permanent check:
--   D4   a deploy whose result never arrives becomes a "Deploy still pending"
--        card two hours after the merge, one per target, and closes itself
--        when the result arrives
--   D5   a record older than 60 days never closes its migrations card with
--        a false "Every migration is in the production ledger"; the card
--        stays until the ledger really has every version, and an aged record
--        makes no new cards
--   D6   "Done but not Live" counts from the move to Done: a comment (which
--        moves github_updated_at) neither closes the card nor makes a second
--   D7   one failed-deploy card per pull request and target, distinct titles
--   D9   a display name another teammate already has is saved with a warning
--        that names both teammates by address
--   P3   update_work Doing -> To do ends the working mark
--   P4   a step result that is not words is refused naming "result", and
--        nothing is written
--
-- Run from the repository root as supabase_admin. Everything is rolled back.

\set ON_ERROR_STOP on
begin;
-- [TEST-MOD-APPROVED #3980] X3: follow-through counts from the switch-on time; these G5 checks run as if it was switched on long ago.
update public.ops_settings set value = to_jsonb(now() - interval '400 days') where key = 'follow_through_since';

alter table auth.users add column if not exists email_confirmed_at timestamptz;
alter table auth.users add column if not exists phone text;
alter table auth.users add column if not exists banned_until timestamptz;
alter table auth.users add column if not exists deleted_at timestamptz;
create table if not exists auth.identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  provider text not null,
  identity_data jsonb
);

create temp table t3980w_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into t3980w_people (who, id, email) values
  ('owner',   '39840000-0000-4000-a000-000000000001', 'oz.w3980@test.local'),
  ('admin',   '39840000-0000-4000-a000-000000000002', 'ivy.w3980@test.local'),
  ('growth',  '39840000-0000-4000-a000-000000000003', 'kim.w3980@test.local'),
  ('growth2', '39840000-0000-4000-a000-000000000004', 'lou.w3980@test.local'),
  ('leaver',  '39840000-0000-4000-a000-000000000006', 'max.w3980@test.local');
insert into auth.users (id, email, email_confirmed_at) select id, email, now() from t3980w_people;
insert into public.admin_users (email, role, status, accepted_at) values
  ('oz.w3980@test.local', 'owner', 'active', now() - interval '3 years'),
  ('ivy.w3980@test.local', 'admin', 'active', now());
insert into public.admin_team_members (email, role, status, accepted_at) values
  ('kim.w3980@test.local', 'growth', 'active', now()),
  ('lou.w3980@test.local', 'growth', 'active', now()),
  ('max.w3980@test.local', 'growth', 'revoked', now());

create temp table t3980w_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;
create temp table t3980w_ids (k text primary key, v text) on commit drop;

create function pg_temp.t3980w_as(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text; v_out text;
begin
  if p_who not in ('anon', 'service') then
    select id, email into strict v_id, v_email from t3980w_people where who = p_who;
  end if;
  begin
    if p_who = 'anon' then
      set local role anon;
      perform set_config('request.jwt.claim.sub', '', true);
      perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    elsif p_who = 'service' then
      set local role service_role;
      perform set_config('request.jwt.claim.sub', '', true);
      perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
    else
      set local role authenticated;
      perform set_config('request.jwt.claim.sub', v_id::text, true);
      perform set_config('request.jwt.claim.email', v_email, true);
      perform set_config('request.jwt.claims', json_build_object('sub', v_id, 'email', v_email, 'role', 'authenticated')::text, true);
    end if;
    perform set_config('request.jwt.claim.role', '', true);
    execute p_sql into v_out;
    reset role;
    return v_out;
  exception when others then
    reset role;
    return 'ERR:' || sqlstate || ':' || sqlerrm;
  end;
end;
$fn$;

create function pg_temp.t3980w_check(p_test text, p_label text, p_got text, p_want text) returns void
language plpgsql as $fn$
begin
  insert into t3980w_results (test, label, ok, detail)
  values (p_test, p_label, p_got is not distinct from p_want,
          format('got %s, want %s', coalesce(left(p_got, 600), '<null>'), coalesce(p_want, '<null>')));
end;
$fn$;

create function pg_temp.t3980w_like(p_test text, p_label text, p_got text, p_pattern text) returns void
language plpgsql as $fn$
begin
  insert into t3980w_results (test, label, ok, detail)
  values (p_test, p_label, coalesce(p_got like p_pattern, false),
          format('got %s, want like %s', coalesce(left(p_got, 600), '<null>'), p_pattern));
end;
$fn$;

create function pg_temp.t3980w_get(p text, variadic p_path text[]) returns text
language plpgsql as $fn$
begin
  return p::jsonb #>> p_path;
exception when others then
  return p;
end;
$fn$;

create function pg_temp.t3980w_j(p text) returns jsonb
language plpgsql as $fn$
begin
  return p::jsonb;
exception when others then
  return jsonb_build_object('unreadable', left(p, 300));
end;
$fn$;

create function pg_temp.t3980w_id(p_k text) returns text
language sql as $fn$ select v from t3980w_ids where k = p_k $fn$;

create function pg_temp.t3980w_keep(p_k text, p_v text) returns void
language sql as $fn$ insert into t3980w_ids (k, v) values (p_k, p_v) on conflict (k) do update set v = excluded.v $fn$;

create function pg_temp.t3980w_next_request() returns void
language sql as $fn$
  update public.team_agent_calls set xact_id = '3'::xid8, started_at = started_at - interval '5 minutes' where xact_id <> '3'::xid8
$fn$;

create function pg_temp.t3980w_person(p_who text, p_sql text) returns text
language plpgsql as $fn$
begin
  perform pg_temp.t3980w_next_request();
  return pg_temp.t3980w_as(p_who, p_sql);
end;
$fn$;

-- A person's connected agent calling a function directly, from a chat.
create function pg_temp.t3980w_agent_sql(p_who text, p_agent text, p_chat text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text; v text;
begin
  perform pg_temp.t3980w_next_request();
  select id, email into strict v_id, v_email from t3980w_people where who = p_who;
  insert into public.team_agent_calls (key_id, owner_email, actor_uid, agent, tool, xact_id, started_at)
  values (gen_random_uuid(), v_email, v_id, p_agent, 'update_work', pg_current_xact_id(), clock_timestamp());
  perform set_config('request.headers', case when p_chat = '' then '{}' else json_build_object('x-mingla-chat', p_chat)::text end, true);
  v := pg_temp.t3980w_as(p_who, p_sql);
  perform set_config('request.headers', '{}', true);
  return v;
end;
$fn$;

create function pg_temp.t3980w_digest(p text) returns text
language sql as $fn$ select encode(sha256(convert_to(p, 'UTF8')), 'hex') $fn$;

create function pg_temp.t3980w_newkey(p_who text, p_agent text, p_label text) returns text
language plpgsql as $fn$
declare v text;
begin
  v := pg_temp.t3980w_person(p_who, format('select public.team_agent_key_create(%L)::text', p_agent));
  if v like 'ERR:%' then return v; end if;
  perform pg_temp.t3980w_keep(p_label, pg_temp.t3980w_j(v) ->> 'key');
  return v;
end;
$fn$;

-- One agent request from a chat through a gateway ('' sends no header).
create function pg_temp.t3980w_chat(p_label text, p_chat text, p_tool text, p_args text default '{}', p_gateway text default 'ops_agent_call') returns text
language plpgsql as $fn$
declare v text;
begin
  perform pg_temp.t3980w_next_request();
  perform set_config('request.headers', case when p_chat = '' then '{}' else json_build_object('x-mingla-chat', p_chat)::text end, true);
  v := pg_temp.t3980w_as('service', format('select public.%s(%L, %L, %L::jsonb, %L)::text', p_gateway,
    pg_temp.t3980w_digest(pg_temp.t3980w_id(p_label)), p_tool, p_args, 'issue3980-rework/1.0'));
  perform set_config('request.headers', '{}', true);
  return v;
end;
$fn$;

create function pg_temp.t3980w_rec(p_name text) returns uuid
language plpgsql as $fn$
declare v_id uuid;
begin
  insert into public.crm_records (pipeline, name, stage, created_by, updated_by)
  values ('hosts', p_name, 'contacted', 'w3980r-fixture', 'w3980r-fixture') returning id into v_id;
  return v_id;
end;
$fn$;

-- A card added by Kim's Claude from chat A, returning its id.
create function pg_temp.t3980w_card(p_title text, p_extra text default '') returns text
language plpgsql as $fn$
declare v text;
begin
  v := pg_temp.t3980w_chat('KC', 'aaaaaaaaaaaaaaaa', 'add_work', format(
    $j${"cards":[{"title":"%s","instructions":"Adversarial fixture card; follow the steps.","done_means":"Every step is marked.","owners":["kim.w3980@test.local"],"due_on":"%s"%s}],"request_key":"%s"}$j$,
    p_title, (now() AT TIME ZONE 'UTC')::date + 3, p_extra, 'w3980r-' || md5(p_title)));
  return pg_temp.t3980w_get(v, 'result', 'results', '0', 'card', 'id');
end;
$fn$;

create function pg_temp.t3980w_rev(p_id text) returns bigint
language sql as $fn$ select revision from public.ops_work_cards where id = p_id::uuid $fn$;

-- Kim's Claude and Kim's Codex; Lou's Claude.
select pg_temp.t3980w_newkey('growth', 'claude', 'KC') is not null as kim_claude,
       pg_temp.t3980w_newkey('growth', 'codex', 'KX') is not null as kim_codex,
       pg_temp.t3980w_newkey('growth2', 'claude', 'LC') is not null as lou_claude,
       pg_temp.t3980w_newkey('owner', 'claude', 'OC') is not null as owner_claude;
select pg_temp.t3980w_keep('monday', public.ops_monday((now() AT TIME ZONE 'UTC')::date)::text),
       pg_temp.t3980w_keep('h1', pg_temp.t3980w_rec('W3980R Race Host')::text),
       pg_temp.t3980w_keep('h2', pg_temp.t3980w_rec('W3980R Old Client Host')::text);

create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (version text primary key);

create function pg_temp.t3980w_record(p_pr int, p_extra jsonb default '{}') returns jsonb
language sql as $fn$
  select jsonb_build_object('v', 1, 'repo', 'Mingla-LLC/mingla-main', 'pr', p_pr, 'title', 'W3980R record ' || p_pr,
    'pr_url', 'https://github.com/Mingla-LLC/mingla-main/pull/' || p_pr, 'merged_at', to_char((now() - interval '1 hour') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'merge_sha', md5(p_pr::text) || left(md5('x' || p_pr), 8), 'merged_by', 'lou-gh', 'author', 'kim-gh',
    'issues', '[{"number":3980,"relation":"toward"}]'::jsonb, 'migrations_added', '[]'::jsonb, 'migrations_applied_state', 'none',
    'edge_functions', '[]'::jsonb, 'web_projects', '[]'::jsonb, 'deploy_marker', true, 'deploy', '{"web":{},"edge":"none"}'::jsonb,
    'feature_guide', '[]'::jsonb, 'live_check', null, 'test_files', '[]'::jsonb, 'problems', '["live_check_missing"]'::jsonb) || p_extra
$fn$;

create function pg_temp.t3980w_ingest(p_data jsonb, p_issue int default 3980) returns text
language sql as $fn$
  select pg_temp.t3980w_as('service', format('select public.ops_release_records_ingest(%L::jsonb)::text',
    jsonb_build_array(jsonb_build_object('data', p_data, 'comment_url', 'https://github.com/Mingla-LLC/mingla-main/issues/' || p_issue || '#issuecomment-1',
      'issue_number', p_issue, 'commented_at', now()))))
$fn$;

create function pg_temp.t3980w_sync() returns text
language sql as $fn$ select pg_temp.t3980w_as('service', 'select public.ops_engineering_cards_sync()::text') $fn$;

create function pg_temp.t3980w_owner_of(p_key text) returns text
language sql as $fn$
  select string_agg(p.email || ':' || p.role, ',' order by p.role, p.email)
    from public.ops_work_people p join public.ops_work_cards w on w.id = p.card_id
   where w.auto_key = p_key and w.status <> 'done'
$fn$;


do $rework$
declare v text; v_id text; v_rev bigint; v_n integer;
begin
  update public.ops_work_cards set status = 'done', close_kind = 'system', closed_at = now(), closed_by = 'system@usemingla.com', closed_via = 'system',
         proof = '[{"kind":"text","text":"suite reset","verified":true}]'::jsonb where auto_key like 'eng\_%' and status <> 'done';
  delete from public.ops_github_items where board_status = 'Done';
  perform pg_temp.t3980w_person('owner', $q$select public.ops_profile_set('lou.w3980@test.local', null, 'lou-w3980')::text$q$);

  -- D4: a deploy that stays pending.
  perform pg_temp.t3980w_ingest(pg_temp.t3980w_record(95001, '{"merged_by":"lou-w3980","web_projects":["mingla-admin"],"edge_functions":["team-agent"],"deploy":{"web":{"mingla-admin":"pending"},"edge":"pending"},"problems":[],"live_check":{"text":"Looked","by_login":"lou-w3980","url":"https://github.com/Mingla-LLC/mingla-main/issues/3980#issuecomment-5","at":"2026-10-20T10:00:00Z"}}'));
  v := pg_temp.t3980w_sync();
  perform pg_temp.t3980w_check('D4', 'a deploy pending one hour after the merge makes no card yet',
    (select count(*)::text from public.ops_work_cards where auto_key like 'eng\_deploy\_pending:pr-95001%'), '0');
  update public.ops_release_records set merged_at = now() - interval '3 hours' where pr = 95001;
  v := pg_temp.t3980w_sync();
  perform pg_temp.t3980w_check('D4', 'after two hours each pending target is a "Deploy still pending" card for whoever merged',
    (select string_agg(auto_key || '=' || title, ' | ' order by auto_key) from public.ops_work_cards where auto_key like 'eng\_deploy\_pending:pr-95001%' and status <> 'done'),
    'eng_deploy_pending:pr-95001:edge=Deploy still pending: edge function for PR #95001 | eng_deploy_pending:pr-95001:mingla-admin=Deploy still pending: mingla-admin web for PR #95001');
  perform pg_temp.t3980w_check('D4', 'the card belongs to whoever merged, watched by the owner',
    pg_temp.t3980w_owner_of('eng_deploy_pending:pr-95001:mingla-admin'), 'lou.w3980@test.local:owner,oz.w3980@test.local:watcher');
  v := pg_temp.t3980w_sync();
  perform pg_temp.t3980w_check('D4', 'a second run makes no second card',
    (select count(*)::text from public.ops_work_cards where auto_key like 'eng\_deploy\_pending:pr-95001%'), '2');
  perform pg_temp.t3980w_ingest(pg_temp.t3980w_record(95001, '{"merged_by":"lou-w3980","web_projects":["mingla-admin"],"edge_functions":["team-agent"],"deploy":{"web":{"mingla-admin":"ready"},"edge":"pending"},"problems":[],"live_check":{"text":"Looked","by_login":"lou-w3980","url":"https://github.com/Mingla-LLC/mingla-main/issues/3980#issuecomment-5","at":"2026-10-20T10:00:00Z"}}'));
  update public.ops_release_records set merged_at = now() - interval '3 hours' where pr = 95001;
  v := pg_temp.t3980w_sync();
  perform pg_temp.t3980w_check('D4', 'the result arriving closes that target''s card with its reason; the other stays',
    (select string_agg(split_part(auto_key, ':', 3) || '=' || status || coalesce(':' || close_reason, ''), ' | ' order by auto_key) from public.ops_work_cards where auto_key like 'eng\_deploy\_pending:pr-95001%'),
    'edge=todo | mingla-admin=done:The release record shows the deploy result.');

  -- D5: migrations still missing when the record ages past 60 days.
  perform pg_temp.t3980w_ingest(pg_temp.t3980w_record(95002, '{"merged_by":"lou-w3980","migrations_added":["29990404000001"],"migrations_applied_state":"pending"}'));
  update public.ops_release_records set merged_at = now() - interval '59 days' where pr = 95002;
  v := pg_temp.t3980w_sync();
  perform pg_temp.t3980w_check('D5', 'day 59: the migrations card is open',
    (select status from public.ops_work_cards where auto_key = 'eng_migrations:pr-95002'), 'todo');
  update public.ops_release_records set merged_at = now() - interval '61 days', problems = problems || 'feature_guide_missing'::text, feature_guide = null where pr = 95002;
  for v_n in 1..2 loop v := pg_temp.t3980w_sync(); end loop;
  perform pg_temp.t3980w_check('D5', 'day 61 with the version still not in the ledger: the card stays open, never closed as applied',
    (select status || '/' || coalesce(close_reason, 'none') from public.ops_work_cards where auto_key = 'eng_migrations:pr-95002'), 'todo/none');
  perform pg_temp.t3980w_check('D5', 'an aged record makes no new card for a problem it had no card for',
    (select count(*)::text from public.ops_work_cards where auto_key = 'eng_guide_missing:pr-95002'), '0');
  insert into supabase_migrations.schema_migrations (version) values ('29990404000001');
  v := pg_temp.t3980w_sync();
  perform pg_temp.t3980w_check('D5', 'once the ledger has every version the card closes, with the true reason',
    (select status || '/' || close_reason from public.ops_work_cards where auto_key = 'eng_migrations:pr-95002'), 'done/Every migration is in the production ledger.');
  perform pg_temp.t3980w_ingest(pg_temp.t3980w_record(95003, '{"merged_by":"lou-w3980","migrations_added":["29990404000003"],"migrations_applied_state":"pending"}'));
  update public.ops_release_records set merged_at = now() - interval '61 days' where pr = 95003;
  v := pg_temp.t3980w_sync();
  perform pg_temp.t3980w_check('D5', 'a record first seen past 60 days makes no card',
    (select count(*)::text from public.ops_work_cards where auto_key like 'eng\_%:pr-95003'), '0');

  -- D6: Done but not Live counts from the move to Done.
  insert into public.ops_github_items (number, kind, title, url, state, board_status, github_updated_at, synced_at)
  values (95004, 'issue', 'Done issue', 'https://github.com/Mingla-LLC/mingla-main/issues/95004', 'CLOSED', 'Done', now() - interval '2 days', now());
  v := pg_temp.t3980w_sync();
  perform pg_temp.t3980w_check('D6', 'an issue first seen Done two days ago makes the card',
    (select count(*)::text from public.ops_work_cards where auto_key = 'eng_done_not_live:issue-95004' and status <> 'done'), '1');
  update public.ops_github_items set github_updated_at = now() where number = 95004;
  v := pg_temp.t3980w_sync();
  perform pg_temp.t3980w_check('D6', 'a comment on the issue (still Done, not Live) keeps the card open',
    (select count(*)::text from public.ops_work_cards where auto_key = 'eng_done_not_live:issue-95004' and status <> 'done'), '1');
  update public.ops_github_items set github_updated_at = now() - interval '25 hours' where number = 95004;
  v := pg_temp.t3980w_sync();
  perform pg_temp.t3980w_check('D6', 'and never makes a second card',
    (select count(*)::text from public.ops_work_cards where auto_key = 'eng_done_not_live:issue-95004'), '1');
  update public.ops_github_items set board_status = 'In Review' where number = 95004;
  v := pg_temp.t3980w_sync();
  perform pg_temp.t3980w_check('D6', 'moved off Done: the card closes and the Done time clears',
    (select string_agg(status, ',') from public.ops_work_cards where auto_key = 'eng_done_not_live:issue-95004') || '/'
      || coalesce((select done_since::text from public.ops_github_items where number = 95004), 'cleared'), 'done/cleared');
  update public.ops_github_items set board_status = 'Done', github_updated_at = now() - interval '9 days' where number = 95004;
  v := pg_temp.t3980w_sync();
  perform pg_temp.t3980w_check('D6', 'moved back to Done: the day starts again from now, whatever the issue''s last update says',
    (select count(*)::text from public.ops_work_cards where auto_key = 'eng_done_not_live:issue-95004' and status <> 'done')
      || '/' || ((select done_since from public.ops_github_items where number = 95004) > now() - interval '1 minute')::text, '0/true');

  -- D7: one card per pull request and failed deploy target.
  perform pg_temp.t3980w_ingest(pg_temp.t3980w_record(95005, '{"merged_by":"lou-w3980","web_projects":["mingla-admin","mingla-business"],"edge_functions":["team-agent"],"deploy":{"web":{"mingla-admin":"failed","mingla-business":"failed"},"edge":"failed"},"problems":["web_deploy_failed","edge_deploy_failed","live_check_missing"]}'));
  for v_n in 1..2 loop v := pg_temp.t3980w_sync(); end loop;
  perform pg_temp.t3980w_check('D7', 'three failed targets on one PR are three cards with three titles',
    (select string_agg(title, ' | ' order by title) from public.ops_work_cards where auto_key like 'eng\_deploy\_failed:pr-95005%' and status <> 'done'),
    'Fix the failed edge function deploy of PR #95005 | Fix the failed mingla-admin web deploy of PR #95005 | Fix the failed mingla-business web deploy of PR #95005');

  -- D9: a name another teammate already has.
  v := pg_temp.t3980w_person('owner', $q$select public.ops_profile_set('kim.w3980@test.local', 'Ola', null)::text$q$);
  perform pg_temp.t3980w_check('D9', 'a name nobody else has saves with no warning', pg_temp.t3980w_get(v, 'warning'), null);
  v := pg_temp.t3980w_person('owner', $q$select public.ops_profile_set('lou.w3980@test.local', 'ola', 'lou-w3980')::text$q$);
  perform pg_temp.t3980w_check('D9', 'a shared name is saved', pg_temp.t3980w_get(v, 'profile', 'display_name'), 'ola');
  perform pg_temp.t3980w_check('D9', 'and the owner is told, with both addresses',
    pg_temp.t3980w_get(v, 'warning'), 'ola shares this name with Ola <kim.w3980@test.local>. Pickers show each email, and agents must use the email to pick one of them.');

  -- P3: Doing -> To do ends the working mark.
  v_id := pg_temp.t3980w_card('W3980R card started then put back',
    $j$,"plan":[{"n":1,"text":"Call the host","tool":"person"},{"n":2,"text":"Log the reply","tool":"record_reply"}]$j$);
  v := pg_temp.t3980w_chat('KC', 'aaaaaaaaaaaaaaaa', 'start_work', format('{"id":"%s","expected_revision":%s}', v_id, pg_temp.t3980w_rev(v_id)));
  perform pg_temp.t3980w_check('P3', 'starting the card sets the working mark',
    (select (working_by is not null and working_via = 'claude')::text from public.ops_work_cards where id = v_id::uuid), 'true');
  v := pg_temp.t3980w_chat('KC', 'aaaaaaaaaaaaaaaa', 'update_work', format('{"id":"%s","expected_revision":%s,"changes":{"status":"todo"}}', v_id, pg_temp.t3980w_rev(v_id)));
  perform pg_temp.t3980w_check('P3', 'moving it back to To do ends the mark',
    (select status || ':' || coalesce(working_by, '-') || ':' || coalesce(working_via, '-') || ':' || coalesce(working_chat, '-') || ':' || coalesce(working_seen_at::text, '-')
       from public.ops_work_cards where id = v_id::uuid), 'todo:-:-:-:-');
  v := pg_temp.t3980w_chat('KX', 'bbbbbbbbbbbbbbbb', 'start_work', format('{"id":"%s","expected_revision":%s}', v_id, pg_temp.t3980w_rev(v_id)));
  perform pg_temp.t3980w_check('P3', 'another agent can start it straight away',
    (select working_via from public.ops_work_cards where id = v_id::uuid), 'codex');

  -- P4: a step result that is not words.
  v_rev := pg_temp.t3980w_rev(v_id);
  v := pg_temp.t3980w_chat('KX', 'bbbbbbbbbbbbbbbb', 'update_work', format('{"id":"%s","expected_revision":%s,"step":{"n":1,"status":"done","result":5}}', v_id, v_rev));
  perform pg_temp.t3980w_like('P4', 'a number as a step result is refused naming "result"', v, '%Plan step 1: _"result_" must be words%');
  v := pg_temp.t3980w_chat('KX', 'bbbbbbbbbbbbbbbb', 'update_work', format($j${"id":"%s","expected_revision":%s,"changes":{"plan":[{"n":1,"text":"Call the host","tool":"person","status":"done","result":{"said":"yes"}},{"n":2,"text":"Log the reply","tool":"record_reply"}]}}$j$, v_id, v_rev));
  perform pg_temp.t3980w_like('P4', 'an object as a result in a whole plan is refused naming "result"', v, '%Plan step 1: _"result_" must be words%');
  perform pg_temp.t3980w_check('P4', 'nothing was written',
    (select revision::text || ':' || (plan->0->>'status') from public.ops_work_cards where id = v_id::uuid), v_rev::text || ':todo');
  v := pg_temp.t3980w_chat('KX', 'bbbbbbbbbbbbbbbb', 'update_work', format('{"id":"%s","expected_revision":%s,"step":{"n":1,"status":"done","result":"Host said yes"}}', v_id, v_rev));
  perform pg_temp.t3980w_check('P4', 'words as a result are kept',
    (select plan->0->>'status' || ':' || (plan->0->>'result') from public.ops_work_cards where id = v_id::uuid), 'done:Host said yes');
end;
$rework$;

select count(*) as t3980w_total, count(*) filter (where not ok) as t3980w_failed,
       coalesce(string_agg(test || ' ' || label || ' [' || detail || ']', E'\n' order by seq) filter (where not ok), 'none') as t3980w_failures
  from t3980w_results \gset
rollback;

select (:t3980w_total < 25 or :t3980w_failed > 0) as t3980w_bad \gset
\if :t3980w_bad
  \echo 'ISSUE-3980 SYNCED WAVE 1 REWORK FAILED:' :t3980w_failed 'of' :t3980w_total
  \echo :t3980w_failures
  do $$ begin raise exception 'ISSUE-3980 SYNCED WAVE 1 REWORK FAIL'; end $$;
\endif
\echo 'ISSUE-3980 SYNCED WAVE 1 REWORK PASS:' :t3980w_total 'checks, 0 failed'
