-- Issue #3980 synced program, Wave 1 -- foundations, on the fully replayed
-- PG17 schema.
-- MINGLA-INVARIANT: I-3980-CHAT-IDENTITY | issue #3980 | Two chats on one person's agent key are told apart by a key the connector derives per connection; one chat's claim refuses the other's changes, an unnamed chat behaves as before, and a browser can never act as a chat.
-- MINGLA-INVARIANT: I-3980-WORKING-MARK | issue #3980 | Starting a card marks the agent as working on it until it closes, pushes back or releases; another agent's changes to that card are refused while the mark was updated in the last 24 hours, and a person is never refused.
-- MINGLA-INVARIANT: I-3980-SPRINT-IS-WEEK-MADE | issue #3980 | A card belongs to the sprint of the week it is made or started, never the week it is due, and open cards carry forward each Monday.
--
-- What it proves (each check is recorded and reported together):
--   X1   update_work marks a step a person does as done or failed, takes a
--        whole plan in the shape add_work takes, and a refused plan names
--        the step and the field (the live refusal of 20 October)
--   F2   chats A and B on one key: B is refused on what A claimed, naming
--        A's chat; A's own write and an old client pass; a forged header
--        from a browser is a person; the log records the chat
--   D4   start sets a working mark and no claim; another chat's update is
--        refused for 24 hours, a note never; after 24 quiet hours another
--        chat takes over; close ends the mark; a card cannot be claimed
--   D3   a card due in 17 days lands this week; a due change keeps the
--        sprint; starting a later-week card moves it here; the correction
--        moves what the old rule misfiled
--   F3   GitHub links: every accepted form, other repositories and hosts
--        refused in words, at most ten, the chip status
--   F1   the Work board and Agent log entries are Live with their evidence
--   F5   display names: owner only, shown everywhere, one GitHub username
--        per teammate
--   G3   release records: bridge only, migrations applied from the ledger,
--        complete on the live check, unknown shapes skipped
--   G5   engineering cards for no issue, no [deploy], live check pending,
--        a push without a pull request; no duplicates; closed when fixed
--   F4   25 rules, 9 routines, the routine that logs this chat's work
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

create temp table t3980s_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into t3980s_people (who, id, email) values
  ('owner',   '39810000-0000-4000-a000-000000000001', 'ed.s3980@test.local'),
  ('admin',   '39810000-0000-4000-a000-000000000002', 'di.s3980@test.local'),
  ('growth',  '39810000-0000-4000-a000-000000000003', 'ada.s3980@test.local'),
  ('growth2', '39810000-0000-4000-a000-000000000004', 'bo.s3980@test.local'),
  ('partner', '39810000-0000-4000-a000-000000000005', 'cy.s3980@test.local'),
  ('leaver',  '39810000-0000-4000-a000-000000000006', 'fay.s3980@test.local'),
  ('nobody',  '39810000-0000-4000-a000-000000000007', 'gus.s3980@test.local');
insert into auth.users (id, email, email_confirmed_at) select id, email, now() from t3980s_people;
insert into public.admin_users (email, role, status, accepted_at) values
  ('ed.s3980@test.local', 'owner', 'active', now()),
  ('di.s3980@test.local', 'admin', 'active', now());
insert into public.admin_team_members (email, role, status, accepted_at) values
  ('ada.s3980@test.local', 'growth', 'active', now()),
  ('bo.s3980@test.local', 'growth', 'active', now()),
  ('cy.s3980@test.local', 'partner', 'active', now()),
  ('fay.s3980@test.local', 'growth', 'revoked', now());

set local session_replication_role = replica;
insert into public.brands (id, account_id, name, slug, city) values
  ('39810000-0000-4000-b100-000000000001', '39810000-0000-4000-b300-000000000001', 'S3980 Palm Brand', 's3980-palm-brand', 'Lagos');
insert into public.events (id, brand_id, title, slug, visibility, status, timezone, published_at, event_type) values
  ('39810000-0000-4000-b400-000000000001', '39810000-0000-4000-b100-000000000001', 'S3980 Rooftop Night', 's3980-rooftop-night', 'discover', 'scheduled', 'UTC', now() - interval '1 day', 'event');
insert into public.event_dates (event_id, start_at, end_at, is_master) values
  ('39810000-0000-4000-b400-000000000001', date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' + interval '40 days 20 hours',
   date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' + interval '40 days 23 hours', true);
set local session_replication_role = origin;

create temp table t3980s_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;
create temp table t3980s_ids (k text primary key, v text) on commit drop;

-- One statement as a caller: its single text result, or ERR:<sqlstate>:<message>.
create function pg_temp.t3980s_as(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text; v_out text;
begin
  if p_who not in ('anon', 'service') then
    select id, email into strict v_id, v_email from t3980s_people where who = p_who;
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

create function pg_temp.t3980s_check(p_test text, p_label text, p_got text, p_want text) returns void
language plpgsql as $fn$
begin
  insert into t3980s_results (test, label, ok, detail)
  values (p_test, p_label, p_got is not distinct from p_want,
          format('got %s, want %s', coalesce(left(p_got, 600), '<null>'), coalesce(p_want, '<null>')));
end;
$fn$;

create function pg_temp.t3980s_like(p_test text, p_label text, p_got text, p_pattern text) returns void
language plpgsql as $fn$
begin
  insert into t3980s_results (test, label, ok, detail)
  values (p_test, p_label, coalesce(p_got like p_pattern, false),
          format('got %s, want like %s', coalesce(left(p_got, 600), '<null>'), p_pattern));
end;
$fn$;

create function pg_temp.t3980s_get(p text, variadic p_path text[]) returns text
language plpgsql as $fn$
begin
  return p::jsonb #>> p_path;
exception when others then
  return p;
end;
$fn$;

create function pg_temp.t3980s_j(p text) returns jsonb
language plpgsql as $fn$
begin
  return p::jsonb;
exception when others then
  return jsonb_build_object('unreadable', left(p, 300));
end;
$fn$;

create function pg_temp.t3980s_id(p_k text) returns text
language sql as $fn$ select v from t3980s_ids where k = p_k $fn$;

create function pg_temp.t3980s_keep(p_k text, p_v text) returns void
language sql as $fn$ insert into t3980s_ids (k, v) values (p_k, p_v) on conflict (k) do update set v = excluded.v $fn$;

-- Request rows written so far belong to an earlier, finished request.
create function pg_temp.t3980s_next_request() returns void
language sql as $fn$
  update public.team_agent_calls set xact_id = '3'::xid8, started_at = started_at - interval '5 minutes' where xact_id <> '3'::xid8
$fn$;

-- A person in a browser session.
create function pg_temp.t3980s_person(p_who text, p_sql text) returns text
language plpgsql as $fn$
begin
  perform pg_temp.t3980s_next_request();
  return pg_temp.t3980s_as(p_who, p_sql);
end;
$fn$;

-- A person's connected agent calling a function directly: the request row
-- the connector writes first, in this transaction, then the call.
create function pg_temp.t3980s_agent_sql(p_who text, p_agent text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text;
begin
  perform pg_temp.t3980s_next_request();
  select id, email into strict v_id, v_email from t3980s_people where who = p_who;
  insert into public.team_agent_calls (key_id, owner_email, actor_uid, agent, tool, xact_id, started_at)
  values (gen_random_uuid(), v_email, v_id, p_agent, 'update_work', pg_current_xact_id(), clock_timestamp());
  return pg_temp.t3980s_as(p_who, p_sql);
end;
$fn$;

create function pg_temp.t3980s_digest(p text) returns text
language sql as $fn$ select encode(sha256(convert_to(p, 'UTF8')), 'hex') $fn$;

create function pg_temp.t3980s_newkey(p_who text, p_agent text, p_label text) returns text
language plpgsql as $fn$
declare v text;
begin
  v := pg_temp.t3980s_person(p_who, format('select public.team_agent_key_create(%L)::text', p_agent));
  if v like 'ERR:%' then return v; end if;
  perform pg_temp.t3980s_keep(p_label, pg_temp.t3980s_j(v) ->> 'key');
  return v;
end;
$fn$;

-- One agent request through a gateway, the way the edge function makes it.
create function pg_temp.t3980s_gw(p_label text, p_tool text, p_args text default '{}', p_gateway text default 'team_agent_call') returns text
language plpgsql as $fn$
begin
  perform pg_temp.t3980s_next_request();
  return pg_temp.t3980s_as('service', format('select public.%s(%L, %L, %L::jsonb, %L)::text', p_gateway,
    pg_temp.t3980s_digest(coalesce(pg_temp.t3980s_id(p_label), p_label)), p_tool, p_args, 'issue3980-client/1.0'));
end;
$fn$;

create function pg_temp.t3980s_work(p_label text, p_tool text, p_args text default '{}') returns text
language sql as $fn$ select pg_temp.t3980s_gw(p_label, p_tool, p_args, 'ops_agent_call') $fn$;

create function pg_temp.t3980s_rec(p_name text) returns uuid
language plpgsql as $fn$
declare v_id uuid;
begin
  insert into public.crm_records (pipeline, name, stage, created_by, updated_by)
  values ('hosts', p_name, 'contacted', 's3980-fixture', 's3980-fixture') returning id into v_id;
  return v_id;
end;
$fn$;

create function pg_temp.t3980s_touch(p_record uuid, p_ago interval) returns void
language sql as $fn$
  insert into public.crm_activity (record_id, kind, actor_email, channel, direction, body, occurred_at)
  values (p_record, 'touch', 'ada.s3980@test.local', 'whatsapp', 'outbound', 'Fixture outbound message', now() - p_ago)
$fn$;

-- One agent request from a given chat: the chat key the connector passes as
-- the x-mingla-chat request header ('' sends none, as an old client).
create function pg_temp.t3980s_chat(p_label text, p_chat text, p_tool text, p_args text default '{}', p_gateway text default 'team_agent_call') returns text
language plpgsql as $fn$
declare v text;
begin
  perform set_config('request.headers', case when p_chat = '' then '{}' else json_build_object('x-mingla-chat', p_chat)::text end, true);
  v := pg_temp.t3980s_gw(p_label, p_tool, p_args, p_gateway);
  perform set_config('request.headers', '{}', true);
  return v;
end;
$fn$;

create function pg_temp.t3980s_work(p_label text, p_chat text, p_tool text, p_args text default '{}') returns text
language sql as $fn$ select pg_temp.t3980s_chat(p_label, p_chat, p_tool, p_args, 'ops_agent_call') $fn$;

-- Ada's Claude key, used by two chats; Bo's Codex key for a second person.
select pg_temp.t3980s_newkey('growth', 'claude', 'A') is not null as key_a,
       pg_temp.t3980s_newkey('growth2', 'codex', 'B') is not null as key_b;

select pg_temp.t3980s_keep('h1', pg_temp.t3980s_rec('S3980 Chat Host')::text),
       pg_temp.t3980s_keep('h2', pg_temp.t3980s_rec('S3980 Second Host')::text),
       pg_temp.t3980s_keep('chat_a', 'aaaaaaaaaaaaaaaa'),
       pg_temp.t3980s_keep('chat_b', 'bbbbbbbbbbbbbbbb'),
       pg_temp.t3980s_keep('today', ((now() AT TIME ZONE 'UTC')::date)::text),
       pg_temp.t3980s_keep('monday', public.ops_monday((now() AT TIME ZONE 'UTC')::date)::text);

-- ---------------------------------------------------------------------------
-- X1: plan steps a person does can be marked done; a refused plan says which
-- step and which field.
-- ---------------------------------------------------------------------------
do $x1$
declare v text; v_items text; v_rev bigint; v_id text;
begin
  v_items := format($j$[{"title":"S3980 plan with person steps","instructions":"Walk through the steps with the host and mark each one.","done_means":"Every step is marked.","owners":["ada.s3980@test.local"],"due_on":"%s",
    "plan":[{"n":1,"text":"Call the host","tool":"person"},{"n":2,"text":"Write the recap","tool":"person"},{"n":3,"text":"Log the reply","tool":"record_reply"}]}]$j$,
    (now() AT TIME ZONE 'UTC')::date + 3);
  v := pg_temp.t3980s_work('A', 'aaaaaaaaaaaaaaaa', 'add_work', format('{"cards":%s,"request_key":"s3980-x1-add-01"}', v_items));
  perform pg_temp.t3980s_check('X1', 'add_work takes a plan whose steps a person does',
    pg_temp.t3980s_get(v, 'result', 'results', '0', 'status'), 'added');
  v_id := pg_temp.t3980s_get(v, 'result', 'results', '0', 'card', 'id');
  perform pg_temp.t3980s_keep('x1', v_id);
  v_rev := (pg_temp.t3980s_get(v, 'result', 'results', '0', 'card', 'revision'))::bigint;
  v := pg_temp.t3980s_work('A', 'aaaaaaaaaaaaaaaa', 'update_work',
    format('{"id":"%s","expected_revision":%s,"step":{"n":1,"status":"done","result":"Host called, read back the date"}}', v_id, v_rev));
  perform pg_temp.t3980s_check('X1', 'a step a person does is marked done, with its result',
    pg_temp.t3980s_get(v, 'ok') || '/' || (select p->>'status' || ':' || (p->>'result') from public.ops_work_cards w, jsonb_array_elements(w.plan) p where w.id = v_id::uuid and p->>'n' = '1'),
    'true/done:Host called, read back the date');
  select revision into v_rev from public.ops_work_cards where id = v_id::uuid;
  v := pg_temp.t3980s_work('A', 'aaaaaaaaaaaaaaaa', 'update_work',
    format('{"id":"%s","expected_revision":%s,"step":{"n":2,"status":"failed","result":"The host did not answer"}}', v_id, v_rev));
  perform pg_temp.t3980s_check('X1', 'a step a person does can be marked failed',
    pg_temp.t3980s_get(v, 'ok') || '/' || (select p->>'status' from public.ops_work_cards w, jsonb_array_elements(w.plan) p where w.id = v_id::uuid and p->>'n' = '2'),
    'true/failed');
  select revision into v_rev from public.ops_work_cards where id = v_id::uuid;
  v := pg_temp.t3980s_work('A', 'aaaaaaaaaaaaaaaa', 'update_work', format($j${"id":"%s","expected_revision":%s,"changes":{"plan":[
      {"n":1,"text":"Call the host","tool":"person","status":"done","result":"Called"},
      {"n":2,"text":"Write the recap","tool":"person","status":"person","result":"Needs Seth"},
      {"n":3,"text":"Log the reply","tool":"record_reply","status":"todo"}]}}$j$, v_id, v_rev));
  perform pg_temp.t3980s_check('X1', 'the whole plan sent back in the shape add_work takes is saved',
    pg_temp.t3980s_get(v, 'ok') || '/' || (select string_agg(p->>'status', ',' order by (p->>'n')::int) from public.ops_work_cards w, jsonb_array_elements(w.plan) p where w.id = v_id::uuid),
    'true/done,person,todo');
  select revision into v_rev from public.ops_work_cards where id = v_id::uuid;
  v := pg_temp.t3980s_work('A', 'aaaaaaaaaaaaaaaa', 'update_work', format($j${"id":"%s","expected_revision":%s,"changes":{"plan":[
      {"n":1,"text":"Call the host","tool":"person","status":"done"},
      {"n":2,"text":"Ask a robot","tool":"telepathy"}]}}$j$, v_id, v_rev));
  perform pg_temp.t3980s_check('X1', 'a refused plan names the step and the field',
    pg_temp.t3980s_get(v, 'error', 'message'),
    'Plan step 2: "tool" must name the connector tool that does it, or person (got "telepathy").');
  v := pg_temp.t3980s_work('A', 'aaaaaaaaaaaaaaaa', 'update_work', format($j${"id":"%s","expected_revision":%s,"changes":{"plan":[
      {"n":1,"text":"Hi","tool":"person"}]}}$j$, v_id, v_rev));
  perform pg_temp.t3980s_check('X1', 'too short a step names the text field',
    pg_temp.t3980s_get(v, 'error', 'message'), 'Plan step 1: "text" must say the step in 3 to 200 characters.');
  v := pg_temp.t3980s_work('A', 'aaaaaaaaaaaaaaaa', 'update_work', format('{"id":"%s","expected_revision":%s,"step":{"n":9,"status":"done"}}', v_id, v_rev));
  perform pg_temp.t3980s_check('X1', 'a step that is not on the card is refused as before',
    pg_temp.t3980s_get(v, 'error', 'token'), 'invalid_arguments');
end;
$x1$;

-- ---------------------------------------------------------------------------
-- F2: two chats on one key are told apart.
-- ---------------------------------------------------------------------------
do $f2$
declare v text; v_id text;
begin
  v := pg_temp.t3980s_work('A', 'aaaaaaaaaaaaaaaa', 'read_log', '{"chat":"Hosts sweep"}');
  perform pg_temp.t3980s_check('F2', 'a chat names itself with the chat argument, and the name is stored by its key',
    pg_temp.t3980s_get(v, 'ok') || '/' || (select label from public.ops_agent_chats where owner_email = 'ada.s3980@test.local' and chat_key = 'aaaaaaaaaaaaaaaa'),
    'true/Hosts sweep');
  perform pg_temp.t3980s_check('F2', 'naming the chat is in the agent log once',
    (select count(*)::text from public.ops_agent_log where action = 'chat_named' and actor_email = 'ada.s3980@test.local'), '1');
  v := pg_temp.t3980s_work('A', 'aaaaaaaaaaaaaaaa', 'read_log', '{"chat":"Hosts sweep"}');
  perform pg_temp.t3980s_check('F2', 'the same name again logs nothing new',
    (select count(*)::text from public.ops_agent_log where action = 'chat_named' and actor_email = 'ada.s3980@test.local'), '1');
  v := pg_temp.t3980s_work('A', 'aaaaaaaaaaaaaaaa', 'read_log', format('{"chat":"%s"}', repeat('x', 41)));
  perform pg_temp.t3980s_check('F2', 'a chat name that is too long is refused in plain words',
    pg_temp.t3980s_get(v, 'error', 'message'), '"chat" is a short name for this chat, 1 to 40 characters.');

  v := pg_temp.t3980s_work('A', 'aaaaaaaaaaaaaaaa', 'claim', format('{"targets":[{"kind":"crm_record","id":"%s"}]}', pg_temp.t3980s_id('h1')));
  perform pg_temp.t3980s_check('F2', 'chat A claims the host, and the claim keeps its chat',
    pg_temp.t3980s_get(v, 'result', 'status') || '/' || (select holder_chat from public.ops_claims where target_id = pg_temp.t3980s_id('h1')::uuid and released_at is null),
    'claimed/aaaaaaaaaaaaaaaa');
  v := pg_temp.t3980s_chat('A', 'bbbbbbbbbbbbbbbb', 'update_records', format('{"updates":[{"id":"%s","changes":{"next_action":"Chat B tries to change it"}}]}', pg_temp.t3980s_id('h1')));
  perform pg_temp.t3980s_check('F2', 'chat B on the same key is refused on the host chat A claimed',
    pg_temp.t3980s_get(v, 'result', 'results', '0', 'error', 'token'), 'claimed');
  perform pg_temp.t3980s_like('F2', 'naming chat A by its name',
    pg_temp.t3980s_get(v, 'result', 'results', '0', 'error', 'message'), 'Ada''s Claude (Hosts sweep) is working on this host since %');
  v := pg_temp.t3980s_chat('A', 'bbbbbbbbbbbbbbbb', 'move_stage', format('{"moves":[{"id":"%s","to":"replied","expected_from":"contacted"}]}', pg_temp.t3980s_id('h1')));
  perform pg_temp.t3980s_check('F2', 'chat B''s stage move is refused',
    pg_temp.t3980s_get(v, 'result', 'results', '0', 'error', 'token') || '/' || (select stage from public.crm_records where id = pg_temp.t3980s_id('h1')::uuid),
    'claimed/contacted');
  v := pg_temp.t3980s_chat('A', 'bbbbbbbbbbbbbbbb', 'save_drafts', format('{"drafts":[{"record_id":"%s","channel":"email","body":"Hello from chat B"}],"request_key":"s3980-b-draft-01"}', pg_temp.t3980s_id('h1')));
  perform pg_temp.t3980s_check('F2', 'chat B''s draft is refused',
    pg_temp.t3980s_get(v, 'result', 'results', '0', 'error', 'token'), 'claimed');
  v := pg_temp.t3980s_chat('A', 'aaaaaaaaaaaaaaaa', 'update_records', format('{"updates":[{"id":"%s","changes":{"next_action":"Chat A changes its own"}}]}', pg_temp.t3980s_id('h1')));
  perform pg_temp.t3980s_check('F2', 'chat A''s own write passes',
    pg_temp.t3980s_get(v, 'result', 'results', '0', 'status'), 'updated');
  v := pg_temp.t3980s_chat('A', '', 'update_records', format('{"updates":[{"id":"%s","changes":{"next_action":"An old client on the same key"}}]}', pg_temp.t3980s_id('h1')));
  perform pg_temp.t3980s_check('F2', 'an old client (no chat key) on the same key is never refused by its own agent''s claim',
    pg_temp.t3980s_get(v, 'result', 'results', '0', 'status'), 'updated');
  v := pg_temp.t3980s_chat('A', 'not-a-hex-key!!!', 'update_records', format('{"updates":[{"id":"%s","changes":{"next_action":"A malformed key is no chat"}}]}', pg_temp.t3980s_id('h1')));
  perform pg_temp.t3980s_check('F2', 'a malformed chat key counts as no key',
    pg_temp.t3980s_get(v, 'result', 'results', '0', 'status'), 'updated');
  v := pg_temp.t3980s_chat('B', 'aaaaaaaaaaaaaaaa', 'update_records', format('{"updates":[{"id":"%s","changes":{"next_action":"Another person with the same chat key"}}]}', pg_temp.t3980s_id('h1')));
  perform pg_temp.t3980s_check('F2', 'the same chat key on another person''s key is still another agent',
    pg_temp.t3980s_get(v, 'result', 'results', '0', 'error', 'token'), 'claimed');
  -- A browser that sends the header is a person: never refused, no chat.
  perform set_config('request.headers', '{"x-mingla-chat":"bbbbbbbbbbbbbbbb"}', true);
  v := pg_temp.t3980s_person('growth2', format($q$select public.crm_record_update(%L, '{"next_action":"A person with a forged chat header"}'::jsonb)::text$q$, pg_temp.t3980s_id('h1')));
  perform set_config('request.headers', '{}', true);
  perform pg_temp.t3980s_check('F2', 'a browser call with a chat header is a person: never refused, logged without a chat',
    (v not like 'ERR:%')::text || '/' || coalesce((select coalesce(chat, '<none>') from public.ops_agent_log where action = 'person_changed_claimed' and actor_email = 'bo.s3980@test.local' order by id desc limit 1), '<no row>'),
    'true/<none>');
  perform pg_temp.t3980s_check('F2', 'the agent log records which chat did what',
    (select chat from public.ops_agent_log where action = 'claimed' and actor_email = 'ada.s3980@test.local' order by id desc limit 1), 'aaaaaaaaaaaaaaaa');
  v := pg_temp.t3980s_work('A', 'aaaaaaaaaaaaaaaa', 'read_log', format('{"record_id":"%s"}', pg_temp.t3980s_id('h1')));
  perform pg_temp.t3980s_check('F2', 'read_log shows the claim with the chat''s name',
    (select c->>'holder_chat_label' from jsonb_array_elements(pg_temp.t3980s_j(v) #> '{result,claims}') c limit 1), 'Hosts sweep');
  v := pg_temp.t3980s_work('A', 'bbbbbbbbbbbbbbbb', 'release', format('{"claim_ids":["%s"]}', (select id from public.ops_claims where target_id = pg_temp.t3980s_id('h1')::uuid and released_at is null)));
  perform pg_temp.t3980s_check('F2', 'chat B cannot release chat A''s claim',
    pg_temp.t3980s_get(v, 'result', 'released') || '/' || (select count(*) from public.ops_claims where target_id = pg_temp.t3980s_id('h1')::uuid and released_at is null)::text, '0/1');
  perform pg_temp.t3980s_check('F2', 'an unnamed chat is shown by the start of its key',
    public.ops_actor_label('ada.s3980@test.local', 'claude', 'bbbbbbbbbbbbbbbb'), 'Ada''s Claude (chat bbbb)');
  perform pg_temp.t3980s_check('F2', 'a chat that sent no key is shown exactly as before',
    public.ops_actor_label('ada.s3980@test.local', 'claude', 'default'), 'Ada''s Claude');
end;
$f2$;

-- ---------------------------------------------------------------------------
-- D-4: a started card carries a working mark, not a claim.
-- ---------------------------------------------------------------------------
do $d4$
declare v text; v_id text; v_rev bigint; v_items text;
begin
  v_items := format($j$[{"title":"S3980 long build card","instructions":"A build that takes several days; post each step.","done_means":"The build is merged.","owners":["ada.s3980@test.local"],"due_on":"%s"}]$j$,
    (now() AT TIME ZONE 'UTC')::date + 4);
  v := pg_temp.t3980s_work('A', 'aaaaaaaaaaaaaaaa', 'add_work', format('{"cards":%s,"request_key":"s3980-d4-add-01"}', v_items));
  v_id := pg_temp.t3980s_get(v, 'result', 'results', '0', 'card', 'id');
  perform pg_temp.t3980s_keep('d4', v_id);
  v := pg_temp.t3980s_work('A', 'aaaaaaaaaaaaaaaa', 'start_work', format('{"id":"%s","expected_revision":1}', v_id));
  perform pg_temp.t3980s_check('D4', 'starting sets the working mark with the chat, and makes no claim',
    pg_temp.t3980s_get(v, 'result', 'card', 'status') || '/' || (select working_by || ':' || working_chat from public.ops_work_cards where id = v_id::uuid)
      || '/' || (select count(*) from public.ops_claims where target_kind = 'work_card' and target_id = v_id::uuid)::text,
    'doing/ada.s3980@test.local:aaaaaaaaaaaaaaaa/0');
  perform pg_temp.t3980s_check('D4', 'the card says who is on it, with the chat''s name, and older screens still see a holder',
    pg_temp.t3980s_get(v, 'result', 'card', 'working', 'name') || '/' || pg_temp.t3980s_get(v, 'result', 'card', 'claim', 'holder_via'),
    'Ada''s Claude (Hosts sweep)/claude');
  select revision into v_rev from public.ops_work_cards where id = v_id::uuid;
  v := pg_temp.t3980s_work('A', 'bbbbbbbbbbbbbbbb', 'update_work', format('{"id":"%s","expected_revision":%s,"changes":{"result":"Chat B writes over it"}}', v_id, v_rev));
  perform pg_temp.t3980s_check('D4', 'another chat''s change is refused while the mark is fresh',
    pg_temp.t3980s_get(v, 'error', 'token'), 'card_taken');
  perform pg_temp.t3980s_like('D4', 'naming who is working on it and the 24 hours',
    pg_temp.t3980s_get(v, 'error', 'message'), 'Ada''s Claude (Hosts sweep) is working on this card since % UTC, last update % UTC. Ask Ada, or wait until it has had no update for 24 hours.');
  v := pg_temp.t3980s_work('A', 'bbbbbbbbbbbbbbbb', 'update_work', format('{"id":"%s","expected_revision":%s,"note":"Chat B leaves a note","request_key":"s3980-d4-note-01"}', v_id, v_rev));
  perform pg_temp.t3980s_check('D4', 'a note is never refused', pg_temp.t3980s_get(v, 'ok'), 'true');
  update public.ops_work_cards set working_seen_at = clock_timestamp() - interval '2 hours' where id = v_id::uuid;
  v := pg_temp.t3980s_work('A', 'aaaaaaaaaaaaaaaa', 'update_work', format('{"id":"%s","expected_revision":%s,"changes":{"result":"Day two: tests written"}}', v_id, v_rev));
  perform pg_temp.t3980s_check('D4', 'the holder''s own update refreshes the mark',
    pg_temp.t3980s_get(v, 'ok') || '/' || (select (working_seen_at > clock_timestamp() - interval '1 minute')::text from public.ops_work_cards where id = v_id::uuid), 'true/true');
  v := pg_temp.t3980s_person('growth', format($q$select public.ops_work_update(%L, '{"result":"Ada herself changes it"}'::jsonb, %s)::text$q$, v_id, v_rev + 1));
  perform pg_temp.t3980s_check('D4', 'a person is never refused', (v not like 'ERR:%')::text, 'true');
  update public.ops_work_cards set working_seen_at = clock_timestamp() - interval '25 hours', started_at = clock_timestamp() - interval '3 days' where id = v_id::uuid;
  select revision into v_rev from public.ops_work_cards where id = v_id::uuid;
  v := pg_temp.t3980s_work('A', 'bbbbbbbbbbbbbbbb', 'start_work', format('{"id":"%s","expected_revision":%s}', v_id, v_rev));
  perform pg_temp.t3980s_check('D4', 'after 24 hours without an update another chat takes the card over',
    pg_temp.t3980s_get(v, 'result', 'changed') || '/' || (select working_chat from public.ops_work_cards where id = v_id::uuid)
      || '/' || (select count(*) from public.ops_work_events where card_id = v_id::uuid and action = 'took_over')::text
      || '/' || (select count(*) from public.ops_agent_log where card_id = v_id::uuid and action = 'took_over')::text,
    'true/bbbbbbbbbbbbbbbb/1/1');
  select revision into v_rev from public.ops_work_cards where id = v_id::uuid;
  v := pg_temp.t3980s_work('A', 'bbbbbbbbbbbbbbbb', 'close_work', format('{"id":"%s","expected_revision":%s,"proof":[{"kind":"text","text":"Merged the build and read it back"}]}', v_id, v_rev));
  perform pg_temp.t3980s_check('D4', 'closing ends the working mark',
    pg_temp.t3980s_get(v, 'ok') || '/' || (select coalesce(working_by, '<none>') || ':' || coalesce(working_chat, '<none>') from public.ops_work_cards where id = v_id::uuid),
    'true/<none>:<none>');
  v := pg_temp.t3980s_work('A', 'aaaaaaaaaaaaaaaa', 'claim', format('{"targets":[{"kind":"work_card","id":"%s"}]}', v_id));
  perform pg_temp.t3980s_check('D4', 'a card cannot be claimed',
    pg_temp.t3980s_get(v, 'error', 'message'), 'Cards are not claimed. start_work marks you as working on a card for as long as it takes.');
end;
$d4$;

-- ---------------------------------------------------------------------------
-- D-3: a card belongs to the week it is made or started.
-- ---------------------------------------------------------------------------
do $d3$
declare v text; v_id text; v_rev bigint; v_items text; v_far date := (now() AT TIME ZONE 'UTC')::date + 17; v_next uuid; v_card uuid;
begin
  v_items := format($j$[{"title":"S3980 due in two and a half weeks","instructions":"Prepare the launch pack well ahead.","done_means":"The launch pack is ready.","owners":["ada.s3980@test.local"],"due_on":"%s"}]$j$, v_far);
  v := pg_temp.t3980s_person('growth', format('select public.ops_work_add(%L::jsonb, %L)::text', v_items, 's3980-d3-add-01'));
  v_id := pg_temp.t3980s_get(v, 'results', '0', 'card', 'id');
  perform pg_temp.t3980s_check('D3', 'a card due in 17 days lands in this week''s sprint',
    pg_temp.t3980s_get(v, 'results', '0', 'card', 'sprint', 'starts_on'), pg_temp.t3980s_id('monday'));
  v := pg_temp.t3980s_person('growth', format($q$select public.ops_work_update(%L, '{"due_on":"%s"}'::jsonb, 1)::text$q$, v_id, v_far + 14));
  perform pg_temp.t3980s_check('D3', 'changing the due date never moves the sprint',
    pg_temp.t3980s_get(v, 'card', 'sprint', 'starts_on'), pg_temp.t3980s_id('monday'));
  -- A card planned for a later week by hand starts this week.
  v := pg_temp.t3980s_person('growth', format($q$select public.ops_work_update(%L, '{"week":"%s"}'::jsonb, 2)::text$q$, v_id, (pg_temp.t3980s_id('monday'))::date + 14));
  perform pg_temp.t3980s_check('D3', 'an explicit week still plans ahead',
    pg_temp.t3980s_get(v, 'card', 'sprint', 'starts_on'), ((pg_temp.t3980s_id('monday'))::date + 14)::text);
  v := pg_temp.t3980s_person('growth', format('select public.ops_work_start(%L, 3)::text', v_id));
  perform pg_temp.t3980s_check('D3', 'starting a card from a later week moves it into this week, with a history line',
    pg_temp.t3980s_get(v, 'card', 'sprint', 'starts_on') || '/' || (select count(*) from public.ops_work_events where card_id = v_id::uuid and action = 'sprint_moved')::text,
    pg_temp.t3980s_id('monday') || '/1');
  -- The correction of the old rule's output: a card the old rule put in its due week.
  v_next := public.ops_sprint_ensure((pg_temp.t3980s_id('monday'))::date + 21);
  insert into public.ops_work_cards (title, instructions, done_means, due_on, due_source, sprint_id, created_by, updated_by)
  values ('S3980 put in its due week by the old rule', 'A card the old rule filed under a later week.', 'It shows this week.',
          (pg_temp.t3980s_id('monday'))::date + 22, 'explicit', v_next, 'ada.s3980@test.local', 'ada.s3980@test.local') returning id into v_card;
  perform public.ops_sprint_correct();
  perform pg_temp.t3980s_check('D3', 'the correction moves a card the old rule put in a later week, with a history line',
    (select s.starts_on::text from public.ops_work_cards w join public.ops_sprints s on s.id = w.sprint_id where w.id = v_card)
      || '/' || (select body from public.ops_work_events where card_id = v_card and action = 'sprint_moved'),
    pg_temp.t3980s_id('monday') || '/Moved to this week: a card belongs to the week it is made, not the week it is due.');
end;
$d3$;

-- ---------------------------------------------------------------------------
-- F3: GitHub links on cards.
-- ---------------------------------------------------------------------------
do $f3$
declare v text; v_id text; r record; v_items text; v_words text := 'GitHub link must be an issue or pull request of Mingla-LLC/mingla-main, like #3980 or https://github.com/Mingla-LLC/mingla-main/pull/3991.';
begin
  for r in select * from (values
      ('#3980', 'issue:3980'), ('3980', 'issue:3980'), (' #12 ', 'issue:12'),
      ('https://github.com/Mingla-LLC/mingla-main/issues/123', 'issue:123'),
      ('https://github.com/Mingla-LLC/mingla-main/pull/3991', 'pull:3991'),
      ('https://github.com/Mingla-LLC/mingla-main/pull/3991/', 'pull:3991'),
      ('https://github.com/Mingla-LLC/mingla-main/pull/3991#issuecomment-1', 'pull:3991'),
      ('https://github.com/Mingla-LLC/mingla-main/issues/5?x=1', 'issue:5'),
      ('https://github.com/other/repo/pull/1', 'error'), ('https://github.com/Mingla-LLC/other/issues/1', 'error'),
      ('http://github.com/Mingla-LLC/mingla-main/issues/1', 'error'), ('https://gitlab.com/Mingla-LLC/mingla-main/issues/1', 'error'),
      ('https://github.com/Mingla-LLC/mingla-main/commit/abc', 'error'), ('#0', 'error'), ('#12345678', 'error'), ('abc', 'error'), ('', 'error')
    ) t(input, want) loop
    perform pg_temp.t3980s_check('F3', 'GitHub link "' || r.input || '"',
      coalesce((public.ops_github_parse(r.input)->>'kind') || ':' || (public.ops_github_parse(r.input)->>'number'),
               case when public.ops_github_parse(r.input)->>'error' = v_words then 'error' end), r.want);
  end loop;
  v_items := format($j$[{"title":"S3980 card with GitHub links","instructions":"Track the engineering issue and its pull request.","done_means":"Both are Live.","owners":["ada.s3980@test.local"],"due_on":"%s","github":["#3980","https://github.com/Mingla-LLC/mingla-main/pull/3991"]}]$j$,
    (now() AT TIME ZONE 'UTC')::date + 2);
  v := pg_temp.t3980s_person('growth', format('select public.ops_work_add(%L::jsonb, %L)::text', v_items, 's3980-f3-add-01'));
  v_id := pg_temp.t3980s_get(v, 'results', '0', 'card', 'id');
  perform pg_temp.t3980s_check('F3', 'a card keeps its GitHub links with their kind, checking GitHub until the bridge reads them',
    (select string_agg(g->>'kind' || ':' || (g->>'number') || ':' || (g->>'label'), ',') from jsonb_array_elements(pg_temp.t3980s_j(v) #> '{results,0,card,github}') g),
    'issue:3980:Checking GitHub,pull:3991:Checking GitHub');
  v := pg_temp.t3980s_person('growth', format($q$select public.ops_work_update(%L, '{"github":["https://github.com/other/repo/pull/1"]}'::jsonb, 1)::text$q$, v_id));
  perform pg_temp.t3980s_like('F3', 'a link to another repository is refused with the words',
    v, '%GitHub link "https://github.com/other/repo/pull/1": ' || v_words || '%');
  v := pg_temp.t3980s_person('growth', format($q$select public.ops_work_update(%L, '{"github":["#1","#2","#3","#4","#5","#6","#7","#8","#9","#10","#11"]}'::jsonb, 1)::text$q$, v_id));
  perform pg_temp.t3980s_like('F3', 'eleven links are refused', v, '%A card can link at most 10 GitHub issues or pull requests.%');
  v := pg_temp.t3980s_person('growth', format($q$select public.ops_work_update(%L, '{"github":["#3980"]}'::jsonb, 1)::text$q$, v_id));
  perform pg_temp.t3980s_check('F3', 'update sets exactly the list sent, with a history line',
    (select string_agg(number::text, ',') from public.ops_work_github where card_id = v_id::uuid)
      || '/' || (select count(*) from public.ops_work_events where card_id = v_id::uuid and action = 'github')::text, '3980/2');
  insert into public.ops_github_items (number, kind, title, url, state, board_status, synced_at)
  values (3980, 'issue', 'Synced program', 'https://github.com/Mingla-LLC/mingla-main/issues/3980', 'OPEN', 'In Progress', now());
  perform pg_temp.t3980s_check('F3', 'once the bridge has read it the chip shows the board status',
    public.ops_github_status(3980)->>'label', 'In Progress');
end;
$f3$;

-- ---------------------------------------------------------------------------
-- F1: the Work board and Agent log entries are Live with their evidence.
-- ---------------------------------------------------------------------------
do $f1$
begin
  -- [TEST-MOD-APPROVED #4179] #4179 revises the Work entry and invalidates
  -- its superseded proof. The unchanged Agent log stays effectively Live;
  -- both historical F1 promotions and evidence rows remain auditable.
  perform pg_temp.t3980s_check('F1', 'both entries stay claimed Live; the revised Work entry fails closed',
    (select string_agg(capability_key || ':' || claimed_status || ':' || public.issue_3720_feature_guide_effective_status(id), ',' order by capability_key)
       from public.product_capabilities where capability_key in ('staff-work-board', 'staff-agent-log')),
    case when now() < '2027-01-18T02:44:56Z'::timestamptz then 'staff-agent-log:live:Live,staff-work-board:live:Needs review'
         else 'staff-agent-log:live:Needs review,staff-work-board:live:Needs review' end);
  perform pg_temp.t3980s_check('F1', 'each retains the four F1 evidence audits',
    (select string_agg(c.capability_key || ':' || evidence_rows, ',' order by c.capability_key)
       from public.product_capabilities c
       cross join lateral (select count(*)::text evidence_rows from public.product_truth_audit a
         where a.capability_id = c.id and a.action = 'evidence_recorded'
           and a.metadata->>'source' = 'issue_3980_synced_f1') proof
      where c.capability_key in ('staff-work-board', 'staff-agent-log')),
    'staff-agent-log:4,staff-work-board:4');
  perform pg_temp.t3980s_check('F1', 'the historical Work live check expires on 18 January',
    (select max(e.expires_at)::text from public.product_capability_evidence e join public.product_capabilities c on c.id = e.capability_id
      where c.capability_key = 'staff-work-board' and e.evidence_kind = 'live_check'), '2027-01-18 02:44:56+00');
  perform pg_temp.t3980s_check('F1', 'audit rows for the evidence and the save, from this change',
    (select count(*)::text from public.product_truth_audit a join public.product_capabilities c on c.id = a.capability_id
      where c.capability_key in ('staff-work-board', 'staff-agent-log') and a.metadata->>'source' = 'issue_3980_synced_f1'), '10');
end;
$f1$;

-- ---------------------------------------------------------------------------
-- F5: display names.
-- ---------------------------------------------------------------------------
do $f5$
declare v text;
begin
  v := pg_temp.t3980s_person('growth', $q$select public.ops_profile_set('ada.s3980@test.local', 'Ada Lovelace', null)::text$q$);
  perform pg_temp.t3980s_like('F5', 'only the owner sets names', v, 'ERR:42501:forbidden: Only the owner can change names.%');
  v := pg_temp.t3980s_person('owner', $q$select public.ops_profile_set('ada.s3980@test.local', 'Debrah', 'ada-gh')::text$q$);
  perform pg_temp.t3980s_check('F5', 'the owner sets a name and a GitHub username', pg_temp.t3980s_get(v, 'profile', 'name'), 'Debrah');
  perform pg_temp.t3980s_check('F5', 'the name shows in the Work board team, the pipelines team and agent labels',
    (select t->>'name' from jsonb_array_elements((pg_temp.t3980s_j(pg_temp.t3980s_person('owner', 'select public.ops_config(null)::text'))) -> 'team') t where t->>'email' = 'ada.s3980@test.local')
      || '/' || public.ops_actor_label('ada.s3980@test.local', 'claude', 'aaaaaaaaaaaaaaaa'),
    'Debrah/Debrah''s Claude (Hosts sweep)');
  perform pg_temp.t3980s_check('F5', 'the name works as an owner in a card',
    public.ops_team_email('debrah') || '/' || public.ops_team_email('ada'), 'ada.s3980@test.local/ada.s3980@test.local');
  v := pg_temp.t3980s_person('owner', $q$select public.ops_profile_set('bo.s3980@test.local', null, 'ADA-GH')::text$q$);
  perform pg_temp.t3980s_like('F5', 'a GitHub username belongs to one teammate', v, 'ERR:22023:github_login_taken: Debrah already has that GitHub username.%');
  v := pg_temp.t3980s_person('owner', $q$select public.ops_profile_set('bo.s3980@test.local', repeat('n', 41), null)::text$q$);
  perform pg_temp.t3980s_like('F5', 'a name is 1 to 40 characters', v, 'ERR:22023:invalid_name:%');
  v := pg_temp.t3980s_person('owner', $q$select public.ops_profiles_list()::text$q$);
  perform pg_temp.t3980s_check('F5', 'the owner''s list carries the email name as the fallback',
    (select p->>'fallback_name' from jsonb_array_elements(pg_temp.t3980s_j(v) -> 'profiles') p where p->>'email' = 'bo.s3980@test.local'), 'Bo');
end;
$f5$;

-- ---------------------------------------------------------------------------
-- G3, G5, G6: release records and engineering follow-through cards.
-- ---------------------------------------------------------------------------
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (version text primary key);

create function pg_temp.t3980s_record(p_pr int, p_extra jsonb default '{}') returns jsonb
language sql as $fn$
  select jsonb_build_object('v', 1, 'repo', 'Mingla-LLC/mingla-main', 'pr', p_pr, 'title', 'S3980 record ' || p_pr,
    'pr_url', 'https://github.com/Mingla-LLC/mingla-main/pull/' || p_pr, 'merged_at', to_char((now() - interval '1 hour') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'merge_sha', repeat(to_hex(p_pr % 16), 40), 'merged_by', 'ada-gh', 'author', 'someone',
    'issues', '[{"number":3980,"relation":"toward"}]'::jsonb, 'migrations_added', '[]'::jsonb, 'migrations_applied_state', 'none',
    'edge_functions', '[]'::jsonb, 'web_projects', '[]'::jsonb, 'deploy_marker', true, 'deploy', '{"web":{},"edge":"none"}'::jsonb,
    'feature_guide', '[]'::jsonb, 'live_check', null, 'test_files', '[]'::jsonb, 'problems', '["live_check_missing"]'::jsonb) || p_extra
$fn$;

create function pg_temp.t3980s_ingest(p_data jsonb, p_issue int default 3980) returns text
language sql as $fn$
  select pg_temp.t3980s_as('service', format('select public.ops_release_records_ingest(%L::jsonb)::text',
    jsonb_build_array(jsonb_build_object('data', p_data, 'comment_url', 'https://github.com/Mingla-LLC/mingla-main/issues/' || p_issue || '#issuecomment-1',
      'issue_number', p_issue, 'commented_at', now()))))
$fn$;

do $g3$
declare v text;
begin
  v := pg_temp.t3980s_person('owner', format('select public.ops_release_records_ingest(%L::jsonb)::text', '[]'));
  perform pg_temp.t3980s_like('G3', 'a person cannot ingest records', v, 'ERR:42501:%');
  v := pg_temp.t3980s_as('service', 'select public.ops_bridge_cursor(''issue_comments'')::text');
  perform pg_temp.t3980s_check('G3', 'the bridge reads its cursor', v, '2026-10-20 00:00:00+00');
  v := pg_temp.t3980s_ingest(pg_temp.t3980s_record(91001, '{"migrations_added":["29990101000001"],"migrations_applied_state":"pending"}'));
  perform pg_temp.t3980s_check('G3', 'an incomplete record is read with what it misses',
    pg_temp.t3980s_get(v, 'ingested') || '/' || (select array_to_string(problems, ',') || '/' || complete::text from public.ops_release_records where pr = 91001),
    '1/live_check_missing,migrations_pending/false');
  insert into supabase_migrations.schema_migrations (version) values ('29990101000001');
  v := pg_temp.t3980s_as('service', 'select public.ops_release_status_due()::text');
  perform pg_temp.t3980s_check('G3', 'once the ledger shows the migration it is applied and its status is due as success',
    (select array_to_string(migrations_applied, ',') || '/' || array_to_string(problems, ',') from public.ops_release_records where pr = 91001)
      || '/' || (select e->>'state' || ':' || (e->>'description') from jsonb_array_elements(pg_temp.t3980s_j(v)) e where (e->>'pr')::int = 91001),
    '29990101000001/live_check_missing/success:All applied: 29990101000001');
  v := pg_temp.t3980s_ingest(pg_temp.t3980s_record(91001, '{"migrations_added":["29990101000001"],"migrations_applied_state":"applied","problems":[],"live_check":{"text":"Checked the board","by_login":"ada-gh","url":"https://github.com/Mingla-LLC/mingla-main/issues/3980#issuecomment-2","at":"2026-10-20T10:00:00Z"}}'));
  perform pg_temp.t3980s_check('G3', 'a person''s live check completes it, once',
    pg_temp.t3980s_get(v, 'completed') || '/' || (select complete::text from public.ops_release_records where pr = 91001)
      || '/' || (select count(*) from public.ops_agent_log where action = 'release_record' and detail->>'pr' = '91001' and outcome = 'ok')::text,
    '[91001]/true/1');
  v := pg_temp.t3980s_ingest(pg_temp.t3980s_record(91002, '{"v":2}'));
  perform pg_temp.t3980s_check('G3', 'a record in an unknown shape is skipped and counted',
    pg_temp.t3980s_get(v, 'invalid') || '/' || (select count(*) from public.ops_release_records where pr = 91002)::text, '1/0');
  v := pg_temp.t3980s_ingest(pg_temp.t3980s_record(91003, '{"feature_guide":["no-such-entry"]}'));
  perform pg_temp.t3980s_check('G3', 'a Feature Guide key that does not exist is a problem',
    (select array_to_string(problems, ',') from public.ops_release_records where pr = 91003), 'live_check_missing,unknown_feature_guide_key:no-such-entry');
  v := pg_temp.t3980s_as('service', format('select public.ops_main_commits_ingest(%L::jsonb)::text',
    jsonb_build_array(jsonb_build_object('sha', repeat('c', 40), 'committed_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'subject', 'Direct push to main', 'author_login', 'ada-gh', 'pr', null))));
  perform pg_temp.t3980s_check('G6', 'main commits are recorded once', pg_temp.t3980s_get(v, 'inserted'), '1');
end;
$g3$;

do $g5$
declare v text; v_card uuid;
begin
  perform pg_temp.t3980s_ingest(pg_temp.t3980s_record(92001, '{"issues":[],"problems":["no_issue","live_check_missing"]}'), 92001);
  perform pg_temp.t3980s_ingest(pg_temp.t3980s_record(92002, '{"web_projects":["mingla-admin"],"deploy":{"web":{"mingla-admin":"not_deployed"},"edge":"none"},"deploy_marker":false,"problems":["web_not_deployed","live_check_missing"]}'));
  perform pg_temp.t3980s_ingest(pg_temp.t3980s_record(92003));
  update public.ops_release_records set merged_at = now() - interval '3 days' where pr = 92003;
  v := pg_temp.t3980s_as('service', 'select public.ops_engineering_cards_sync()::text');
  perform pg_temp.t3980s_check('G5', 'engineering cards are made for a PR with no issue, a web change without [deploy] and a live check pending 48 hours',
    (select string_agg(auto_key, ',' order by auto_key) from public.ops_work_cards where auto_key like 'eng\_%' and status <> 'done'),
    'eng_live_check:pr-92003,eng_no_issue:pr-92001,eng_no_pr_push:cccccc' || 'c,eng_not_deployed:pr-92002:mingla-admin');
  perform pg_temp.t3980s_check('G5', 'owned by whoever merged (by GitHub username), watched by the owner, made by Mingla',
    (select string_agg(p.email || ':' || p.role, ',' order by p.role, p.email) from public.ops_work_people p join public.ops_work_cards w on w.id = p.card_id where w.auto_key = 'eng_no_issue:pr-92001')
      || '/' || (select created_via || ':' || created_by from public.ops_work_cards where auto_key = 'eng_no_issue:pr-92001'),
    'ada.s3980@test.local:owner,ed.s3980@test.local:watcher/system:system@usemingla.com');
  perform pg_temp.t3980s_check('G5', 'the card names the pull request in words and links it',
    (select title || ' | ' || (select string_agg(kind || ':' || number, ',' order by number) from public.ops_work_github g where g.card_id = w.id) from public.ops_work_cards w where auto_key = 'eng_not_deployed:pr-92002:mingla-admin'),
    'Deploy mingla-admin: PR #92002 merged without [deploy] | issue:3980,pull:92002');
  v := pg_temp.t3980s_as('service', 'select public.ops_engineering_cards_sync()::text');
  perform pg_temp.t3980s_check('G5', 'a second run makes no duplicate', pg_temp.t3980s_get(v, 'added'), '0');
  perform pg_temp.t3980s_ingest(pg_temp.t3980s_record(92003, '{"problems":[],"live_check":{"text":"Looked at it live","by_login":"ada-gh","url":"https://github.com/Mingla-LLC/mingla-main/issues/3980#issuecomment-3","at":"2026-10-20T11:00:00Z"}}'));
  v := pg_temp.t3980s_as('service', 'select public.ops_engineering_cards_sync()::text');
  select id into v_card from public.ops_work_cards where auto_key = 'eng_live_check:pr-92003';
  perform pg_temp.t3980s_check('G5', 'the card closes itself once the live check is there',
    (select status || ':' || close_kind || ':' || closed_via from public.ops_work_cards where id = v_card)
      || '/' || (select count(*) from public.ops_work_events where card_id = v_card and action = 'auto_closed')::text, 'done:system:system/1');
  perform pg_temp.t3980s_check('G5', 'a commit pushed without a pull request stays until a person closes it',
    (select status from public.ops_work_cards where auto_key = 'eng_no_pr_push:ccccccc'), 'todo');
  v := pg_temp.t3980s_as('service', 'select public.ops_reconcile()::text');
  perform pg_temp.t3980s_check('G5', 'housekeeping runs the engineering cards too',
    (pg_temp.t3980s_j(v) ? 'engineering_cards')::text, 'true');
end;
$g5$;

-- ---------------------------------------------------------------------------
-- F4: the guide.
-- ---------------------------------------------------------------------------
do $guide$
declare v text;
begin
  v := pg_temp.t3980s_gw('A', 'get_started');
  perform pg_temp.t3980s_check('F4', 'get_started has 25 rules, 9 routines and one rule about today',
    jsonb_array_length(pg_temp.t3980s_j(v) #> '{result,rules}') || '/' || jsonb_array_length(pg_temp.t3980s_j(v) #> '{result,routines}') || '/'
      || (select count(*) from jsonb_array_elements_text(pg_temp.t3980s_j(v) #> '{result,rules}') r where r like 'Today is your person''s own date.%'),
    '25/9/1');
  perform pg_temp.t3980s_check('F4', 'the routine that logs this chat''s work is listed',
    (select r->>'title' from jsonb_array_elements(pg_temp.t3980s_j(v) #> '{result,routines}') r where r->>'name' = 'log_this_chat'), 'Log this chat''s work');
  v := pg_temp.t3980s_work('A', 'aaaaaaaaaaaaaaaa', 'read_log', '{}');
  perform pg_temp.t3980s_check('F4', 'read_log carries the eleven work rules',
    jsonb_array_length(pg_temp.t3980s_j(v) #> '{result,rules}')::text, '11');
end;
$guide$;

select count(*) as t3980s_total, count(*) filter (where not ok) as t3980s_failed,
       coalesce(string_agg(test || ' ' || label || ' [' || detail || ']', E'\n' order by seq) filter (where not ok), 'none') as t3980s_failures
  from t3980s_results \gset
rollback;

select (:t3980s_total < 60 or :t3980s_failed > 0) as t3980s_bad \gset
\if :t3980s_bad
  \echo 'ISSUE-3980 SYNCED WAVE 1 FAILED:' :t3980s_failed 'of' :t3980s_total
  \echo :t3980s_failures
  do $$ begin raise exception 'ISSUE-3980 SYNCED WAVE 1 FAIL'; end $$;
\endif
\echo 'ISSUE-3980 SYNCED WAVE 1 PASS:' :t3980s_total 'checks, 0 failed'
