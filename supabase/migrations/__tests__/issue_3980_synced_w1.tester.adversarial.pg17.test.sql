-- Issue #3980 synced program, Wave 1 -- tester adversarial suite, on the
-- fully replayed PG17 schema. Attacks the angles the implementor's happy
-- path does not:
--   X1   every step status through the step mark; every malformed step or
--        plan names the real field (n, text, tool, status, result, an
--        unknown key, a duplicate number, too many steps, not a list); a
--        refused change writes nothing; a person's own update is checked
--        the same way
--   F2   the chat key is read only from a well-formed header (missing,
--        spoofed, upper-case, oversized, undersized and unreadable headers
--        are all "no chat"); the same chat key on the person's other agent
--        is another holder; one claim row per record however the chats
--        race; a bad "chat" name is refused before anything is written
--   D4   takeover is refused one minute before 24 quiet hours and allowed
--        one minute after; the previous holder is then refused; a person
--        (owner or admin) is never refused; only the owner or an admin in
--        person clears a mark; release by another chat clears nothing
--   D3   the sprint never follows the due date; the correction moves only
--        cards the old rule misfiled (not done, archived, hand-planned or
--        current-week cards), and a second run moves nothing
--   F3   GitHub links: look-alike hosts, other paths, 8-digit and zero
--        numbers, a number given as both issue and pull request kept once
--        and only ever upgraded to pull, the ten-link cap, a refused list
--        leaves the card's links as they were
--   F5   names: owner in person only (not an admin, not the owner's own
--        agent, not the teammate themself), blank falls back, 40 unicode
--        characters fit and 41 do not, control characters refused, two
--        teammates with one name make the name ambiguous as an owner,
--        GitHub usernames with bad hyphens refused
--   G5   engineering cards made once over repeated runs, owned by whoever
--        merged (else the author, else the owner), closed by themselves
--        when fixed, never re-made within 14 days after a person closed
--        one, a direct push never closed by Mingla
--   F1   both Feature Guide entries Live with only the four evidence kinds,
--        each verified, current and pinned to the merge commit or the
--        #3980 comments
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

create temp table t3980a_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into t3980a_people (who, id, email) values
  ('owner',   '39820000-0000-4000-a000-000000000001', 'oz.a3980@test.local'),
  ('admin',   '39820000-0000-4000-a000-000000000002', 'ivy.a3980@test.local'),
  ('growth',  '39820000-0000-4000-a000-000000000003', 'kim.a3980@test.local'),
  ('growth2', '39820000-0000-4000-a000-000000000004', 'lou.a3980@test.local'),
  ('leaver',  '39820000-0000-4000-a000-000000000006', 'max.a3980@test.local');
insert into auth.users (id, email, email_confirmed_at) select id, email, now() from t3980a_people;
insert into public.admin_users (email, role, status, accepted_at) values
  ('oz.a3980@test.local', 'owner', 'active', now() - interval '3 years'),
  ('ivy.a3980@test.local', 'admin', 'active', now());
insert into public.admin_team_members (email, role, status, accepted_at) values
  ('kim.a3980@test.local', 'growth', 'active', now()),
  ('lou.a3980@test.local', 'growth', 'active', now()),
  ('max.a3980@test.local', 'growth', 'revoked', now());

create temp table t3980a_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;
create temp table t3980a_ids (k text primary key, v text) on commit drop;

create function pg_temp.t3980a_as(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text; v_out text;
begin
  if p_who not in ('anon', 'service') then
    select id, email into strict v_id, v_email from t3980a_people where who = p_who;
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

create function pg_temp.t3980a_check(p_test text, p_label text, p_got text, p_want text) returns void
language plpgsql as $fn$
begin
  insert into t3980a_results (test, label, ok, detail)
  values (p_test, p_label, p_got is not distinct from p_want,
          format('got %s, want %s', coalesce(left(p_got, 600), '<null>'), coalesce(p_want, '<null>')));
end;
$fn$;

create function pg_temp.t3980a_like(p_test text, p_label text, p_got text, p_pattern text) returns void
language plpgsql as $fn$
begin
  insert into t3980a_results (test, label, ok, detail)
  values (p_test, p_label, coalesce(p_got like p_pattern, false),
          format('got %s, want like %s', coalesce(left(p_got, 600), '<null>'), p_pattern));
end;
$fn$;

create function pg_temp.t3980a_get(p text, variadic p_path text[]) returns text
language plpgsql as $fn$
begin
  return p::jsonb #>> p_path;
exception when others then
  return p;
end;
$fn$;

create function pg_temp.t3980a_j(p text) returns jsonb
language plpgsql as $fn$
begin
  return p::jsonb;
exception when others then
  return jsonb_build_object('unreadable', left(p, 300));
end;
$fn$;

create function pg_temp.t3980a_id(p_k text) returns text
language sql as $fn$ select v from t3980a_ids where k = p_k $fn$;

create function pg_temp.t3980a_keep(p_k text, p_v text) returns void
language sql as $fn$ insert into t3980a_ids (k, v) values (p_k, p_v) on conflict (k) do update set v = excluded.v $fn$;

create function pg_temp.t3980a_next_request() returns void
language sql as $fn$
  update public.team_agent_calls set xact_id = '3'::xid8, started_at = started_at - interval '5 minutes' where xact_id <> '3'::xid8
$fn$;

create function pg_temp.t3980a_person(p_who text, p_sql text) returns text
language plpgsql as $fn$
begin
  perform pg_temp.t3980a_next_request();
  return pg_temp.t3980a_as(p_who, p_sql);
end;
$fn$;

-- A person's connected agent calling a function directly, from a chat.
create function pg_temp.t3980a_agent_sql(p_who text, p_agent text, p_chat text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text; v text;
begin
  perform pg_temp.t3980a_next_request();
  select id, email into strict v_id, v_email from t3980a_people where who = p_who;
  insert into public.team_agent_calls (key_id, owner_email, actor_uid, agent, tool, xact_id, started_at)
  values (gen_random_uuid(), v_email, v_id, p_agent, 'update_work', pg_current_xact_id(), clock_timestamp());
  perform set_config('request.headers', case when p_chat = '' then '{}' else json_build_object('x-mingla-chat', p_chat)::text end, true);
  v := pg_temp.t3980a_as(p_who, p_sql);
  perform set_config('request.headers', '{}', true);
  return v;
end;
$fn$;

create function pg_temp.t3980a_digest(p text) returns text
language sql as $fn$ select encode(sha256(convert_to(p, 'UTF8')), 'hex') $fn$;

create function pg_temp.t3980a_newkey(p_who text, p_agent text, p_label text) returns text
language plpgsql as $fn$
declare v text;
begin
  v := pg_temp.t3980a_person(p_who, format('select public.team_agent_key_create(%L)::text', p_agent));
  if v like 'ERR:%' then return v; end if;
  perform pg_temp.t3980a_keep(p_label, pg_temp.t3980a_j(v) ->> 'key');
  return v;
end;
$fn$;

-- One agent request from a chat through a gateway ('' sends no header).
create function pg_temp.t3980a_chat(p_label text, p_chat text, p_tool text, p_args text default '{}', p_gateway text default 'ops_agent_call') returns text
language plpgsql as $fn$
declare v text;
begin
  perform pg_temp.t3980a_next_request();
  perform set_config('request.headers', case when p_chat = '' then '{}' else json_build_object('x-mingla-chat', p_chat)::text end, true);
  v := pg_temp.t3980a_as('service', format('select public.%s(%L, %L, %L::jsonb, %L)::text', p_gateway,
    pg_temp.t3980a_digest(pg_temp.t3980a_id(p_label)), p_tool, p_args, 'issue3980-tester/1.0'));
  perform set_config('request.headers', '{}', true);
  return v;
end;
$fn$;

create function pg_temp.t3980a_rec(p_name text) returns uuid
language plpgsql as $fn$
declare v_id uuid;
begin
  insert into public.crm_records (pipeline, name, stage, created_by, updated_by)
  values ('hosts', p_name, 'contacted', 'a3980-fixture', 'a3980-fixture') returning id into v_id;
  return v_id;
end;
$fn$;

-- A card added by Kim's Claude from chat A, returning its id.
create function pg_temp.t3980a_card(p_title text, p_extra text default '') returns text
language plpgsql as $fn$
declare v text;
begin
  v := pg_temp.t3980a_chat('KC', 'aaaaaaaaaaaaaaaa', 'add_work', format(
    $j${"cards":[{"title":"%s","instructions":"Adversarial fixture card; follow the steps.","done_means":"Every step is marked.","owners":["kim.a3980@test.local"],"due_on":"%s"%s}],"request_key":"%s"}$j$,
    p_title, (now() AT TIME ZONE 'UTC')::date + 3, p_extra, 'a3980-' || md5(p_title)));
  return pg_temp.t3980a_get(v, 'result', 'results', '0', 'card', 'id');
end;
$fn$;

create function pg_temp.t3980a_rev(p_id text) returns bigint
language sql as $fn$ select revision from public.ops_work_cards where id = p_id::uuid $fn$;

-- Kim's Claude and Kim's Codex; Lou's Claude.
select pg_temp.t3980a_newkey('growth', 'claude', 'KC') is not null as kim_claude,
       pg_temp.t3980a_newkey('growth', 'codex', 'KX') is not null as kim_codex,
       pg_temp.t3980a_newkey('growth2', 'claude', 'LC') is not null as lou_claude,
       pg_temp.t3980a_newkey('owner', 'claude', 'OC') is not null as owner_claude;
select pg_temp.t3980a_keep('monday', public.ops_monday((now() AT TIME ZONE 'UTC')::date)::text),
       pg_temp.t3980a_keep('h1', pg_temp.t3980a_rec('A3980 Race Host')::text),
       pg_temp.t3980a_keep('h2', pg_temp.t3980a_rec('A3980 Old Client Host')::text);

-- ---------------------------------------------------------------------------
-- X1: step marks and plan replaces, every refusal naming the real field.
-- ---------------------------------------------------------------------------
do $x1$
declare v text; v_id text; v_rev bigint; v_plan jsonb; r record;
begin
  v_id := pg_temp.t3980a_card('A3980 plan of person steps',
    $j$,"plan":[{"n":1,"text":"Call the host","tool":"person"},{"n":2,"text":"Collect the flyer","tool":"person"},{"n":3,"text":"Log the reply","tool":"record_reply"}]$j$);
  perform pg_temp.t3980a_check('X1', 'add_work keeps a three-step plan', (select jsonb_array_length(plan)::text from public.ops_work_cards where id = v_id::uuid), '3');
  -- Every status, through the step mark, round trip.
  for r in select * from (values ('done', 1), ('failed', 2), ('person', 3), ('todo', 1)) t(st, n) loop
    v_rev := pg_temp.t3980a_rev(v_id);
    v := pg_temp.t3980a_chat('KC', 'aaaaaaaaaaaaaaaa', 'update_work',
      format('{"id":"%s","expected_revision":%s,"step":{"n":%s,"status":"%s","result":"Marked %s"}}', v_id, v_rev, r.n, r.st, r.st));
    perform pg_temp.t3980a_check('X1', format('step %s can be marked %s through the step mark', r.n, r.st),
      coalesce(pg_temp.t3980a_get(v, 'ok'), v) || '/' || (select p->>'status' || ':' || coalesce(p->>'result', '') from public.ops_work_cards w, jsonb_array_elements(w.plan) p where w.id = v_id::uuid and (p->>'n')::int = r.n),
      'true/' || r.st || ':Marked ' || r.st);
  end loop;
  perform pg_temp.t3980a_check('X1', 'a step mark leaves the other steps as they were',
    (select string_agg(p->>'text' || '=' || (p->>'tool'), ',' order by (p->>'n')::int) from public.ops_work_cards w, jsonb_array_elements(w.plan) p where w.id = v_id::uuid),
    'Call the host=person,Collect the flyer=person,Log the reply=record_reply');

  -- Refusals through the step mark name the field.
  v_rev := pg_temp.t3980a_rev(v_id);
  v_plan := (select plan from public.ops_work_cards where id = v_id::uuid);
  v := pg_temp.t3980a_chat('KC', 'aaaaaaaaaaaaaaaa', 'update_work', format('{"id":"%s","expected_revision":%s,"step":{"n":2,"status":"finished"}}', v_id, v_rev));
  perform pg_temp.t3980a_check('X1', 'a step status that does not exist names "status"',
    pg_temp.t3980a_get(v, 'error', 'token') || '|' || pg_temp.t3980a_get(v, 'error', 'message'),
    'invalid_card|Plan step 2: "status" must be todo, done, failed or person.');
  v := pg_temp.t3980a_chat('KC', 'aaaaaaaaaaaaaaaa', 'update_work', format('{"id":"%s","expected_revision":%s,"step":{"n":1,"status":"done","result":"%s"}}', v_id, v_rev, repeat('r', 301)));
  perform pg_temp.t3980a_check('X1', 'a result over 300 characters names "result"',
    pg_temp.t3980a_get(v, 'error', 'message'), 'Plan step 1: "result" must be at most 300 characters.');
  v := pg_temp.t3980a_chat('KC', 'aaaaaaaaaaaaaaaa', 'update_work', format('{"id":"%s","expected_revision":%s,"step":{"n":1,"status":"done","result":"%s"}}', v_id, v_rev, repeat('r', 300)));
  perform pg_temp.t3980a_check('X1', 'a result of exactly 300 characters is kept', pg_temp.t3980a_get(v, 'ok'), 'true');
  v_rev := pg_temp.t3980a_rev(v_id);
  v_plan := (select plan from public.ops_work_cards where id = v_id::uuid);

  -- Refusals through a whole-plan replace name the field.
  for r in select * from (values
      ('n given as words', '[{"n":"1","text":"Call the host","tool":"person"}]', 'Plan step 1: "n" must be a whole number from 1 to 20.'),
      ('n zero', '[{"n":0,"text":"Call the host","tool":"person"}]', 'Plan step 1: "n" must be a whole number from 1 to 20.'),
      ('n 21', '[{"n":21,"text":"Call the host","tool":"person"}]', 'Plan step 1: "n" must be a whole number from 1 to 20.'),
      ('two steps with one number', '[{"n":1,"text":"Call the host","tool":"person"},{"n":1,"text":"Call again","tool":"person"}]', 'Plan step 1: two steps have the number 1.'),
      ('an unknown key', '[{"n":1,"text":"Call the host","tool":"person","owner":"kim"}]', 'Plan step 1: a step does not take "owner". It takes n, text, tool, status and result.'),
      ('no tool', '[{"n":1,"text":"Call the host"}]', 'Plan step 1: "tool" must name the connector tool that does it, or person (got nothing).'),
      ('a tool as a number', '[{"n":1,"text":"Call the host","tool":7}]', 'Plan step 1: "tool" must name the connector tool that does it, or person (got nothing).'),
      ('text of two characters', '[{"n":2,"text":"ok","tool":"person"}]', 'Plan step 2: "text" must say the step in 3 to 200 characters.'),
      ('text of 201 characters', format('[{"n":2,"text":"%s","tool":"person"}]', repeat('t', 201)), 'Plan step 2: "text" must say the step in 3 to 200 characters.'),
      ('a status that does not exist', '[{"n":3,"text":"Call the host","tool":"person","status":"skipped"}]', 'Plan step 3: "status" must be todo, done, failed or person.'),
      ('a step that is a string', '["Call the host"]', 'Plan step 1: each step must be an object with n, text and tool.'),
      ('checked_at as a number', '[{"n":1,"text":"Call the host","tool":"person","checked_at":5}]', 'Plan step 1: "checked_at" must be a date and time.'),
      ('not a list', '{"n":1}', 'The plan must be a list of steps.'),
      ('21 steps', (select jsonb_agg(jsonb_build_object('n', least(g, 20), 'text', 'Step ' || g, 'tool', 'person'))::text from generate_series(1, 21) g), 'A plan has at most 20 steps.')
    ) t(label, plan, want) loop
    v := pg_temp.t3980a_chat('KC', 'aaaaaaaaaaaaaaaa', 'update_work', format('{"id":"%s","expected_revision":%s,"changes":{"plan":%s}}', v_id, v_rev, r.plan));
    perform pg_temp.t3980a_check('X1', 'a whole plan with ' || r.label || ' is refused naming the field',
      pg_temp.t3980a_get(v, 'error', 'token') || '|' || pg_temp.t3980a_get(v, 'error', 'message'), 'invalid_card|' || r.want);
  end loop;
  perform pg_temp.t3980a_check('X1', 'every refused change wrote nothing',
    (select (revision = v_rev and plan = v_plan)::text from public.ops_work_cards where id = v_id::uuid), 'true');
  perform pg_temp.t3980a_check('X1', 'the old catch-all words never come back for a plan the server can name',
    (select count(*)::text from public.ops_agent_log l where l.summary like '%Plan steps need a number%'), '0');

  -- A whole plan in the add_work shape, with every status and spaces around the tool.
  v := pg_temp.t3980a_chat('KC', 'aaaaaaaaaaaaaaaa', 'update_work', format($j${"id":"%s","expected_revision":%s,"changes":{"plan":[
      {"n":3,"text":"Log the reply","tool":"record_reply","status":"failed","result":"No reply yet"},
      {"n":1,"text":"Call the host","tool":" person ","status":"done","result":"Called"},
      {"n":2,"text":"Collect the flyer","tool":"person","status":"person"},
      {"n":4,"text":"Chase next week","tool":"person"}]}}$j$, v_id, v_rev));
  perform pg_temp.t3980a_check('X1', 'a whole plan replace is kept in step order, the tool trimmed and a missing status as todo',
    coalesce(pg_temp.t3980a_get(v, 'ok'), v) || '/' || (select string_agg((p->>'n') || ':' || (p->>'tool') || ':' || (p->>'status'), ',' order by (p->>'n')::int) from public.ops_work_cards w, jsonb_array_elements(w.plan) p where w.id = v_id::uuid),
    'true/1:person:done,2:person:person,3:record_reply:failed,4:person:todo');
  v_rev := pg_temp.t3980a_rev(v_id);
  v := pg_temp.t3980a_chat('KC', 'aaaaaaaaaaaaaaaa', 'update_work', format('{"id":"%s","expected_revision":%s,"step":{"n":7,"status":"done"}}', v_id, v_rev));
  perform pg_temp.t3980a_check('X1', 'a step number the card does not have names the number',
    pg_temp.t3980a_get(v, 'error', 'message'), 'There is no step 7 on this card. Read the plan with list_work.');

  -- The same rule for a person in the browser.
  v := pg_temp.t3980a_person('growth', format($q$select public.ops_work_update(%L, '{"plan":[{"n":1,"text":"Call the host","tool":"telepathy"}]}'::jsonb, %s)::text$q$, v_id, v_rev));
  perform pg_temp.t3980a_check('X1', 'a person''s bad plan names the step and the field too',
    v, 'ERR:22023:invalid_card: Plan step 1: "tool" must name the connector tool that does it, or person (got "telepathy").');
end;
$x1$;

-- ---------------------------------------------------------------------------
-- F2: the chat key, spoofing and races.
-- ---------------------------------------------------------------------------
do $f2$
declare v text; r record; v_id text;
begin
  for r in select * from (values
      ('{"x-mingla-chat":"0123456789abcdef"}', '0123456789abcdef', 'a well-formed key'),
      ('{}', 'default', 'no header'),
      ('{"x-mingla-chat":""}', 'default', 'an empty header'),
      ('{"x-mingla-chat":"0123456789ABCDEF"}', 'default', 'an upper-case key'),
      ('{"x-mingla-chat":"0123456789abcdef0"}', 'default', 'a key one character too long'),
      ('{"x-mingla-chat":"0123456789abcde"}', 'default', 'a key one character too short'),
      ('{"x-mingla-chat":"0123456789abcdeg"}', 'default', 'a key that is not hex'),
      ('{"x-mingla-chat":" 0123456789abcdef"}', 'default', 'a key with a leading space'),
      ('{"x-mingla-chat":"0123456789abcdef\n"}', 'default', 'a key with a trailing newline'),
      ('{"x-mingla-chat":"default"}', 'default', 'the word default'),
      ('{"x-mingla-chat":["0123456789abcdef"]}', 'default', 'a key in a list'),
      ('{"x-mingla-chat":12345678901234}', 'default', 'a number'),
      ('not json at all', 'default', 'unreadable headers'),
      ('', 'default', 'empty headers')
    ) t(headers, want, label) loop
    perform set_config('request.headers', r.headers, true);
    perform pg_temp.t3980a_check('F2', 'the chat key from ' || r.label, public.ops_ctx_chat(), r.want);
  end loop;
  perform set_config('request.headers', '{}', true);

  -- Chat A claims the host; chat B, Kim's Codex with the same chat key, and
  -- chat B again all race for it: exactly one open claim, held by A.
  v := pg_temp.t3980a_chat('KC', 'aaaaaaaaaaaaaaaa', 'claim', format('{"targets":[{"kind":"crm_record","id":"%s"}]}', pg_temp.t3980a_id('h1')));
  perform pg_temp.t3980a_check('F2', 'chat A wins the record', pg_temp.t3980a_get(v, 'result', 'status'), 'claimed');
  v := pg_temp.t3980a_chat('KC', 'bbbbbbbbbbbbbbbb', 'claim', format('{"targets":[{"kind":"crm_record","id":"%s"}]}', pg_temp.t3980a_id('h1')));
  perform pg_temp.t3980a_check('F2', 'chat B on the same key is told it is held, by chat A''s short name',
    pg_temp.t3980a_get(v, 'result', 'status') || '/' || pg_temp.t3980a_get(v, 'result', 'held', '0', 'holder_chat_label'), 'held/chat aaaa');
  v := pg_temp.t3980a_chat('KX', 'aaaaaaaaaaaaaaaa', 'claim', format('{"targets":[{"kind":"crm_record","id":"%s"}]}', pg_temp.t3980a_id('h1')));
  perform pg_temp.t3980a_check('F2', 'the same chat key on the person''s Codex is another holder',
    pg_temp.t3980a_get(v, 'result', 'status'), 'held');
  v := pg_temp.t3980a_chat('KX', 'aaaaaaaaaaaaaaaa', 'update_records', format('{"updates":[{"id":"%s","changes":{"next_action":"Codex tries"}}]}', pg_temp.t3980a_id('h1')), 'team_agent_call');
  perform pg_temp.t3980a_check('F2', 'and its write is refused', pg_temp.t3980a_get(v, 'result', 'results', '0', 'error', 'token'), 'claimed');
  v := pg_temp.t3980a_chat('KC', 'bbbbbbbbbbbbbbbb', 'claim', format('{"targets":[{"kind":"crm_record","id":"%s"}]}', pg_temp.t3980a_id('h1')));
  perform pg_temp.t3980a_check('F2', 'however the chats race, one open claim row for the record, chat A''s',
    (select count(*)::text || ':' || min(holder_chat) from public.ops_claims where target_id = pg_temp.t3980a_id('h1')::uuid and released_at is null), '1:aaaaaaaaaaaaaaaa');
  v := pg_temp.t3980a_chat('KC', '0123456789ABCDEF', 'claim', format('{"targets":[{"kind":"crm_record","id":"%s"}]}', pg_temp.t3980a_id('h1')));
  perform pg_temp.t3980a_check('F2', 'a spoofed upper-case key is no chat: it counts as the old client and creates no second claim',
    (select count(*)::text from public.ops_claims where target_id = pg_temp.t3980a_id('h1')::uuid and released_at is null), '1');
  v := pg_temp.t3980a_chat('KC', 'bbbbbbbbbbbbbbbb', 'release', format('{"card_id":null,"claim_ids":["%s"]}',
    (select id from public.ops_claims where target_id = pg_temp.t3980a_id('h1')::uuid and released_at is null)));
  perform pg_temp.t3980a_check('F2', 'chat B cannot release chat A''s claim by its id',
    (select count(*)::text from public.ops_claims where target_id = pg_temp.t3980a_id('h1')::uuid and released_at is null), '1');

  -- An old client holds a record: identified chats on the key are the same holder (backward compatible).
  v := pg_temp.t3980a_chat('KC', '', 'claim', format('{"targets":[{"kind":"crm_record","id":"%s"}]}', pg_temp.t3980a_id('h2')));
  perform pg_temp.t3980a_check('F2', 'an old client (no session id) claims as before',
    pg_temp.t3980a_get(v, 'result', 'status') || '/' || (select holder_chat from public.ops_claims where target_id = pg_temp.t3980a_id('h2')::uuid and released_at is null), 'claimed/default');
  v := pg_temp.t3980a_chat('KC', 'bbbbbbbbbbbbbbbb', 'update_records', format('{"updates":[{"id":"%s","changes":{"next_action":"Same agent, newer client"}}]}', pg_temp.t3980a_id('h2')), 'team_agent_call');
  perform pg_temp.t3980a_check('F2', 'the old client''s claim does not refuse its own agent''s identified chat',
    pg_temp.t3980a_get(v, 'result', 'results', '0', 'status'), 'updated');
  v := pg_temp.t3980a_chat('LC', '', 'update_records', format('{"updates":[{"id":"%s","changes":{"next_action":"Another person''s old client"}}]}', pg_temp.t3980a_id('h2')), 'team_agent_call');
  perform pg_temp.t3980a_check('F2', 'another person''s old client is still refused', pg_temp.t3980a_get(v, 'result', 'results', '0', 'error', 'token'), 'claimed');

  -- The chat argument.
  for r in select * from (values
      ('"   "', 'only spaces'), ('""', 'empty'), ('42', 'a number'), ('{"name":"x"}', 'an object'),
      (to_json(repeat('é', 41))::text, '41 characters'), ('"Hosts\u0007sweep"', 'a control character'), ('"Hosts\nsweep"', 'a new line')
    ) t(chat, label) loop
    v := pg_temp.t3980a_chat('KC', 'cccccccccccccccc', 'read_log', format('{"chat":%s}', r.chat));
    perform pg_temp.t3980a_check('F2', 'a chat name that is ' || r.label || ' is refused in plain words',
      pg_temp.t3980a_get(v, 'error', 'token') || '|' || pg_temp.t3980a_get(v, 'error', 'message'),
      'invalid_arguments|"chat" is a short name for this chat, 1 to 40 characters.');
  end loop;
  perform pg_temp.t3980a_check('F2', 'nothing was stored for the refused names',
    (select count(*)::text from public.ops_agent_chats where chat_key = 'cccccccccccccccc'), '0');
  v := pg_temp.t3980a_chat('KC', 'cccccccccccccccc', 'read_log', format('{"chat":%s}', to_json(repeat('é', 39) || '😀')));
  perform pg_temp.t3980a_check('F2', 'a 40-character unicode name is kept as written',
    coalesce(pg_temp.t3980a_get(v, 'ok'), v) || '/' || (select char_length(label)::text from public.ops_agent_chats where chat_key = 'cccccccccccccccc'), 'true/40');
  v := pg_temp.t3980a_chat('KC', '', 'read_log', '{"chat":"Unkeyed chat"}');
  perform pg_temp.t3980a_check('F2', 'a name sent without a chat key is accepted and stores nothing',
    coalesce(pg_temp.t3980a_get(v, 'ok'), v) || '/' || (select count(*)::text from public.ops_agent_chats where label = 'Unkeyed chat'), 'true/0');
  v := pg_temp.t3980a_chat('KC', 'dddddddddddddddd', 'read_log', '{"chat":"First name"}');
  v := pg_temp.t3980a_chat('KC', 'dddddddddddddddd', 'read_log', '{"chat":"Second name"}');
  perform pg_temp.t3980a_check('F2', 'renaming a chat keeps one row with the newest name, and logs each new name',
    (select count(*)::text || ':' || max(label) from public.ops_agent_chats where chat_key = 'dddddddddddddddd')
      || '/' || (select count(*)::text from public.ops_agent_log where action = 'chat_named' and detail->>'chat_key' = 'dddd'), '1:Second name/2');
  -- A person in the browser is never a chat, whatever header they send.
  perform set_config('request.headers', '{"x-mingla-chat":"aaaaaaaaaaaaaaaa"}', true);
  v := pg_temp.t3980a_person('growth2', format($q$select public.crm_record_update(%L, '{"next_action":"A person with chat A''s header"}'::jsonb)::text$q$, pg_temp.t3980a_id('h1')));
  perform set_config('request.headers', '{}', true);
  perform pg_temp.t3980a_check('F2', 'a person sending chat A''s header is a person: never refused',
    (v not like 'ERR:%')::text, 'true');
end;
$f2$;

-- ---------------------------------------------------------------------------
-- D-4: the working mark across the 24-hour boundary.
-- ---------------------------------------------------------------------------
do $d4$
declare v text; v_id text; v_rev bigint;
begin
  v_id := pg_temp.t3980a_card('A3980 multi-day build');
  perform pg_temp.t3980a_keep('d4', v_id);
  v := pg_temp.t3980a_chat('KC', 'aaaaaaaaaaaaaaaa', 'start_work', format('{"id":"%s","expected_revision":%s}', v_id, pg_temp.t3980a_rev(v_id)));
  perform pg_temp.t3980a_check('D4', 'chat A starts the card', pg_temp.t3980a_get(v, 'result', 'card', 'status'), 'doing');
  update public.ops_work_cards set working_seen_at = clock_timestamp() - interval '23 hours 59 minutes',
         started_at = clock_timestamp() - interval '2 days' where id = v_id::uuid;
  v := pg_temp.t3980a_chat('KC', 'bbbbbbbbbbbbbbbb', 'start_work', format('{"id":"%s","expected_revision":%s}', v_id, pg_temp.t3980a_rev(v_id)));
  perform pg_temp.t3980a_check('D4', 'one minute before 24 quiet hours another chat cannot take it',
    pg_temp.t3980a_get(v, 'error', 'token') || '/' || (select working_chat from public.ops_work_cards where id = v_id::uuid), 'card_taken/aaaaaaaaaaaaaaaa');
  v := pg_temp.t3980a_chat('KC', 'bbbbbbbbbbbbbbbb', 'update_work', format('{"id":"%s","expected_revision":%s,"changes":{"due_on":"%s"}}', v_id, pg_temp.t3980a_rev(v_id), (now() AT TIME ZONE 'UTC')::date + 5));
  perform pg_temp.t3980a_check('D4', 'nor change its due date', pg_temp.t3980a_get(v, 'error', 'token'), 'card_taken');
  v := pg_temp.t3980a_chat('KC', 'bbbbbbbbbbbbbbbb', 'push_back', format('{"id":"%s","expected_revision":%s,"kind":"declined","reason":"Chat B thinks it should not be done"}', v_id, pg_temp.t3980a_rev(v_id)));
  perform pg_temp.t3980a_check('D4', 'nor push it back', pg_temp.t3980a_get(v, 'error', 'token'), 'card_taken');
  v := pg_temp.t3980a_chat('KC', 'bbbbbbbbbbbbbbbb', 'close_work', format('{"id":"%s","expected_revision":%s,"proof":[{"kind":"text","text":"Chat B says it is done"}]}', v_id, pg_temp.t3980a_rev(v_id)));
  perform pg_temp.t3980a_check('D4', 'nor close it', pg_temp.t3980a_get(v, 'error', 'token'), 'card_taken');
  v := pg_temp.t3980a_chat('KC', 'bbbbbbbbbbbbbbbb', 'release', format('{"card_id":"%s"}', v_id));
  perform pg_temp.t3980a_check('D4', 'chat B releasing the card clears nothing',
    pg_temp.t3980a_get(v, 'result', 'working_cleared') || '/' || (select working_chat from public.ops_work_cards where id = v_id::uuid), 'false/aaaaaaaaaaaaaaaa');
  update public.ops_work_cards set working_seen_at = clock_timestamp() - interval '24 hours 1 minute' where id = v_id::uuid;
  v := pg_temp.t3980a_chat('KC', 'bbbbbbbbbbbbbbbb', 'start_work', format('{"id":"%s","expected_revision":%s}', v_id, pg_temp.t3980a_rev(v_id)));
  perform pg_temp.t3980a_check('D4', 'one minute after 24 quiet hours another chat takes it over',
    pg_temp.t3980a_get(v, 'result', 'changed') || '/' || (select working_chat from public.ops_work_cards where id = v_id::uuid), 'true/bbbbbbbbbbbbbbbb');
  perform pg_temp.t3980a_like('D4', 'the takeover is in the card history naming who it was taken from',
    (select body from public.ops_work_events where card_id = v_id::uuid and action = 'took_over'), 'Took over from Kim''s Claude (chat aaaa) after 24 hours without an update.');
  v := pg_temp.t3980a_chat('KC', 'aaaaaaaaaaaaaaaa', 'update_work', format('{"id":"%s","expected_revision":%s,"changes":{"result":"Chat A comes back"}}', v_id, pg_temp.t3980a_rev(v_id)));
  perform pg_temp.t3980a_check('D4', 'the chat it was taken from is now refused', pg_temp.t3980a_get(v, 'error', 'token'), 'card_taken');
  v := pg_temp.t3980a_chat('KC', 'aaaaaaaaaaaaaaaa', 'update_work', format('{"id":"%s","expected_revision":%s,"note":"Chat A leaves a note","request_key":"a3980-d4-note-1"}', v_id, pg_temp.t3980a_rev(v_id)));
  perform pg_temp.t3980a_check('D4', 'but its note goes through', pg_temp.t3980a_get(v, 'ok'), 'true');
  -- People are never refused.
  v := pg_temp.t3980a_person('growth', format($q$select public.ops_work_update(%L, '{"result":"Kim herself"}'::jsonb, %s)::text$q$, v_id, pg_temp.t3980a_rev(v_id)));
  perform pg_temp.t3980a_check('D4', 'the owner in person is never refused', (v not like 'ERR:%')::text, 'true');
  v := pg_temp.t3980a_person('admin', format($q$select public.ops_work_update(%L, '{"result":"Ivy the admin"}'::jsonb, %s)::text$q$, v_id, pg_temp.t3980a_rev(v_id)));
  perform pg_temp.t3980a_check('D4', 'an admin in person is never refused by the mark', (v not like '%card_taken%')::text, 'true');
  -- Clearing the mark.
  v := pg_temp.t3980a_person('growth', format($q$select public.ops_working_clear(%L, 'Kim clears it herself')::text$q$, v_id));
  perform pg_temp.t3980a_like('D4', 'a teammate who is not owner or admin cannot clear a mark', v, 'ERR:42501:forbidden:%');
  v := pg_temp.t3980a_agent_sql('owner', 'claude', 'eeeeeeeeeeeeeeee', format($q$select public.ops_working_clear(%L, 'The owner''s agent tries')::text$q$, v_id));
  perform pg_temp.t3980a_like('D4', 'the owner''s own agent cannot clear a mark', v, 'ERR:42501:forbidden:%');
  v := pg_temp.t3980a_person('admin', format($q$select public.ops_working_clear(%L, 'ok')::text$q$, v_id));
  perform pg_temp.t3980a_like('D4', 'clearing needs a reason of 5 characters or more', v, 'ERR:22023:reason_required:%');
  v := pg_temp.t3980a_person('admin', format($q$select public.ops_working_clear(%L, 'Chat B stopped answering')::text$q$, v_id));
  perform pg_temp.t3980a_check('D4', 'an admin clears it with a reason',
    (v not like 'ERR:%')::text || '/' || (select coalesce(working_via, '<none>') from public.ops_work_cards where id = v_id::uuid), 'true/<none>');
  v := pg_temp.t3980a_person('admin', format($q$select public.ops_working_clear(%L, 'Clear it twice')::text$q$, v_id));
  perform pg_temp.t3980a_like('D4', 'clearing a card nobody marks says so', v, 'ERR:22023:not_working:%');
end;
$d4$;

-- ---------------------------------------------------------------------------
-- D-3: the sprint is the week a card is made; the correction is narrow.
-- ---------------------------------------------------------------------------
do $d3$
declare v text; v_mon date := (pg_temp.t3980a_id('monday'))::date; v_future uuid; v_past uuid; v_cur uuid;
        v_a uuid; v_b uuid; v_c uuid; v_d uuid; v_e uuid; v_f uuid; v_id text;
begin
  perform pg_temp.t3980a_check('D3', 'the sprint for a due date 60 days out is this week''s',
    (select starts_on::text from public.ops_sprints where id = public.ops_sprint_for(v_mon + 60, (now() AT TIME ZONE 'UTC')::date)), v_mon::text);
  perform pg_temp.t3980a_check('D3', 'the sprint for a due date already past is this week''s',
    (select starts_on::text from public.ops_sprints where id = public.ops_sprint_for(v_mon - 30, (now() AT TIME ZONE 'UTC')::date)), v_mon::text);
  v_id := pg_temp.t3980a_card('A3980 due far ahead');
  v := pg_temp.t3980a_chat('KC', 'aaaaaaaaaaaaaaaa', 'update_work', format('{"id":"%s","expected_revision":%s,"changes":{"due_on":"%s"}}', v_id, pg_temp.t3980a_rev(v_id), v_mon + 200));
  perform pg_temp.t3980a_check('D3', 'an agent moving the due date 200 days out keeps the card in this week',
    pg_temp.t3980a_get(v, 'result', 'card', 'sprint', 'starts_on'), v_mon::text);

  v_cur := public.ops_sprint_ensure((now() AT TIME ZONE 'UTC')::date);
  v_future := public.ops_sprint_ensure(v_mon + 14);
  v_past := public.ops_sprint_ensure(v_mon - 7);
  insert into public.ops_work_cards (title, instructions, done_means, due_on, due_source, sprint_id, created_by, updated_by)
  values ('A3980 misfiled open card', 'The old rule put it in its due week.', 'It shows this week.', v_mon + 15, 'explicit', v_future, 'kim.a3980@test.local', 'kim.a3980@test.local')
  returning id into v_a;
  insert into public.ops_work_cards (title, instructions, done_means, due_on, due_source, sprint_id, created_by, updated_by, status, closed_at, closed_by, close_kind, proof)
  values ('A3980 misfiled but done', 'Done already; history stays.', 'Nothing moves.', v_mon + 15, 'explicit', v_future, 'kim.a3980@test.local', 'kim.a3980@test.local',
          'done', now(), 'kim.a3980@test.local', 'done', '[{"kind":"text","text":"Done","verified":true}]'::jsonb)
  returning id into v_b;
  insert into public.ops_work_cards (title, instructions, done_means, due_on, due_source, sprint_id, created_by, updated_by, archived_at, archived_by, archive_reason)
  values ('A3980 misfiled but archived', 'Archived cards stay put.', 'Nothing moves.', v_mon + 15, 'explicit', v_future, 'kim.a3980@test.local', 'kim.a3980@test.local', now(), 'ivy.a3980@test.local', 'Not needed')
  returning id into v_c;
  insert into public.ops_work_cards (title, instructions, done_means, due_on, due_source, sprint_id, created_by, updated_by)
  values ('A3980 already this week', 'Already in the right week.', 'Nothing moves.', v_mon + 15, 'explicit', v_cur, 'kim.a3980@test.local', 'kim.a3980@test.local')
  returning id into v_d;
  insert into public.ops_work_cards (title, instructions, done_means, due_on, due_source, sprint_id, created_by, updated_by)
  values ('A3980 carried from last week', 'An older sprint is not a later week.', 'Nothing moves.', v_mon + 2, 'explicit', v_past, 'kim.a3980@test.local', 'kim.a3980@test.local')
  returning id into v_e;
  -- A card a person planned for a later week by hand (sprint changed, due date not).
  v := pg_temp.t3980a_person('growth', format('select public.ops_work_add(%L::jsonb, %L)::text',
    format('[{"title":"A3980 planned ahead by hand","instructions":"Kim chose the week herself.","done_means":"It stays in that week.","owners":["kim.a3980@test.local"],"due_on":"%s"}]', v_mon + 16), 'a3980-d3-hand-1'));
  v_f := (pg_temp.t3980a_get(v, 'results', '0', 'card', 'id'))::uuid;
  v := pg_temp.t3980a_person('growth', format($q$select public.ops_work_update(%L, '{"week":"%s"}'::jsonb, 1)::text$q$, v_f, v_mon + 14));
  perform pg_temp.t3980a_check('D3', 'the hand-planned card is in the later week before the correction',
    (select s.starts_on::text from public.ops_work_cards w join public.ops_sprints s on s.id = w.sprint_id where w.id = v_f), (v_mon + 14)::text);

  perform pg_temp.t3980a_check('D3', 'the correction moves the misfiled open card only (it returns how many)',
    (public.ops_sprint_correct() >= 1)::text, 'true');
  perform pg_temp.t3980a_check('D3', 'each card ends in the week it should',
    (select string_agg(w.title || '=' || (s.starts_on - v_mon)::text, ',' order by w.title)
       from public.ops_work_cards w join public.ops_sprints s on s.id = w.sprint_id where w.id in (v_a, v_b, v_c, v_d, v_e, v_f)),
    'A3980 already this week=0,A3980 carried from last week=-7,A3980 misfiled but archived=14,A3980 misfiled but done=14,A3980 misfiled open card=0,A3980 planned ahead by hand=14');
  perform pg_temp.t3980a_check('D3', 'only the moved card has a sprint_moved history line',
    (select string_agg(w.title, ',' order by w.title) from public.ops_work_cards w
      where w.id in (v_a, v_b, v_c, v_d, v_e, v_f) and exists (select 1 from public.ops_work_events e where e.card_id = w.id and e.action = 'sprint_moved')),
    'A3980 misfiled open card');
  perform pg_temp.t3980a_check('D3', 'a second run of the correction moves nothing', public.ops_sprint_correct()::text, '0');
end;
$d3$;

-- ---------------------------------------------------------------------------
-- F3: GitHub links.
-- ---------------------------------------------------------------------------
do $f3$
declare v text; v_id text; r record; v_words text := 'GitHub link must be an issue or pull request of Mingla-LLC/mingla-main, like #3980 or https://github.com/Mingla-LLC/mingla-main/pull/3991.';
begin
  for r in select * from (values
      ('#9999999', 'issue:9999999'), ('#10000000', 'error'), ('#00012', 'issue:12'), ('##12', 'error'), ('# 12', 'error'), ('12abc', 'error'),
      ('https://github.com/Mingla-LLC/mingla-main/issues/0', 'error'),
      ('https://github.com/Mingla-LLC/mingla-main/pull/3991/files', 'error'),
      ('https://github.com/Mingla-LLC/mingla-main/issues/12?x=1#y', 'issue:12'),
      ('https://github.com.evil.example/Mingla-LLC/mingla-main/issues/1', 'error'),
      ('https://evil.example/https://github.com/Mingla-LLC/mingla-main/issues/1', 'error'),
      ('https://github.com/Mingla-LLC/mingla-main/issues/1@evil.example', 'error'),
      ('https://github.com/Mingla-LLC/mingla-main/issues/12/../../../other/repo/issues/1', 'error'),
      ('https://github.com/Mingla-LLC/mingla-main-fork/issues/1', 'error'),
      ('https://github.com/Mingla-LLC/mingla-main/discussions/1', 'error'),
      ('javascript:alert(1)', 'error'), ('Mingla-LLC/mingla-main#12', 'error'), (null, 'error')
    ) t(input, want) loop
    perform pg_temp.t3980a_check('F3', 'GitHub link ' || coalesce('"' || r.input || '"', 'null'),
      coalesce((public.ops_github_parse(r.input)->>'kind') || ':' || (public.ops_github_parse(r.input)->>'number'),
               case when public.ops_github_parse(r.input)->>'error' = v_words then 'error' end), r.want);
  end loop;

  -- One number given as an issue and as a pull request is one link, kept as issue until a pull request link upgrades it.
  v_id := pg_temp.t3980a_card('A3980 card with GitHub links', $j$,"github":["#77","https://github.com/Mingla-LLC/mingla-main/pull/77","77"]$j$);
  perform pg_temp.t3980a_check('F3', 'the same number three ways is one link, an issue, added by the agent',
    (select string_agg(kind || ':' || number || ':' || coalesce(added_via, '-'), ',') from public.ops_work_github where card_id = v_id::uuid), 'issue:77:claude');
  v := pg_temp.t3980a_chat('KC', 'aaaaaaaaaaaaaaaa', 'update_work', format('{"id":"%s","expected_revision":%s,"changes":{"github":["https://github.com/Mingla-LLC/mingla-main/pull/77"]}}', v_id, pg_temp.t3980a_rev(v_id)));
  perform pg_temp.t3980a_check('F3', 'a pull request link upgrades it to a pull request',
    (select string_agg(kind || ':' || number, ',') from public.ops_work_github where card_id = v_id::uuid), 'pull:77');
  v := pg_temp.t3980a_chat('KC', 'aaaaaaaaaaaaaaaa', 'update_work', format('{"id":"%s","expected_revision":%s,"changes":{"github":["#77","#78"]}}', v_id, pg_temp.t3980a_rev(v_id)));
  perform pg_temp.t3980a_check('F3', 'a bare number never downgrades a known pull request',
    (select string_agg(kind || ':' || number, ',' order by number) from public.ops_work_github where card_id = v_id::uuid), 'pull:77,issue:78');
  -- The cap and a refused list.
  v := pg_temp.t3980a_chat('KC', 'aaaaaaaaaaaaaaaa', 'update_work', format('{"id":"%s","expected_revision":%s,"changes":{"github":["#1","#2","#3","#4","#5","#6","#7","#8","#9","#10"]}}', v_id, pg_temp.t3980a_rev(v_id)));
  perform pg_temp.t3980a_check('F3', 'ten links fit',
    coalesce(pg_temp.t3980a_get(v, 'ok'), v) || '/' || (select count(*)::text from public.ops_work_github where card_id = v_id::uuid), 'true/10');
  v := pg_temp.t3980a_chat('KC', 'aaaaaaaaaaaaaaaa', 'update_work', format('{"id":"%s","expected_revision":%s,"changes":{"github":["#1","#1","#1","#1","#1","#1","#1","#1","#1","#1","#1"]}}', v_id, pg_temp.t3980a_rev(v_id)));
  perform pg_temp.t3980a_check('F3', 'eleven entries are refused even when they repeat one number, and the ten stay',
    pg_temp.t3980a_get(v, 'error', 'message') || '/' || (select count(*)::text from public.ops_work_github where card_id = v_id::uuid),
    'A card can link at most 10 GitHub issues or pull requests./10');
  v := pg_temp.t3980a_chat('KC', 'aaaaaaaaaaaaaaaa', 'update_work', format('{"id":"%s","expected_revision":%s,"changes":{"github":["#5","https://github.com/someone/mingla-main/issues/5"]}}', v_id, pg_temp.t3980a_rev(v_id)));
  perform pg_temp.t3980a_check('F3', 'one bad link refuses the whole list, naming it, and the card keeps its links',
    pg_temp.t3980a_get(v, 'error', 'message') || '/' || (select count(*)::text from public.ops_work_github where card_id = v_id::uuid),
    'GitHub link "https://github.com/someone/mingla-main/issues/5": ' || v_words || '/10');
  v := pg_temp.t3980a_chat('KC', 'aaaaaaaaaaaaaaaa', 'update_work', format('{"id":"%s","expected_revision":%s,"changes":{"github":"#5"}}', v_id, pg_temp.t3980a_rev(v_id)));
  perform pg_temp.t3980a_check('F3', 'links that are not a list are refused in words',
    pg_temp.t3980a_get(v, 'error', 'message'), 'GitHub links must be a list, like ["#3980"].');
  v := pg_temp.t3980a_chat('KC', 'aaaaaaaaaaaaaaaa', 'add_work', format(
    $j${"cards":[{"title":"A3980 refused card with a fork link","instructions":"This card must not be written.","done_means":"Nothing is written.","owners":["kim.a3980@test.local"],"due_on":"%s","github":["https://github.com/Mingla-LLC/mingla-main-fork/pull/1"]}],"request_key":"a3980-f3-refused-1"}$j$,
    (now() AT TIME ZONE 'UTC')::date + 3));
  perform pg_temp.t3980a_check('F3', 'a card refused for its link writes no card and no link',
    pg_temp.t3980a_get(v, 'result', 'refused') || '/' || (select count(*)::text from public.ops_work_cards where title = 'A3980 refused card with a fork link'), '1/0');
  -- The chip words.
  insert into public.ops_github_items (number, kind, not_found, synced_at) values (9000001, 'issue', true, now());
  perform pg_temp.t3980a_check('F3', 'a number GitHub does not have says so', public.ops_github_status(9000001)->>'label', 'Not on GitHub');
  perform pg_temp.t3980a_check('F3', 'a number the bridge has not read says it is checking',
    (public.ops_github_status(9000002)->>'label') || '/' || (public.ops_github_status(9000002)->>'url'), 'Checking GitHub/https://github.com/Mingla-LLC/mingla-main/issues/9000002');
end;
$f3$;

-- ---------------------------------------------------------------------------
-- F5: display names.
-- ---------------------------------------------------------------------------
do $f5$
declare v text; v_name40 text := 'Dëbràh Ñyakúndi 😀' || repeat('a', 23);
begin
  v := pg_temp.t3980a_person('admin', $q$select public.ops_profile_set('kim.a3980@test.local', 'Kimberly', null)::text$q$);
  perform pg_temp.t3980a_like('F5', 'an admin cannot set another teammate''s name', v, 'ERR:42501:forbidden: Only the owner can change names.%');
  v := pg_temp.t3980a_person('growth', $q$select public.ops_profile_set('kim.a3980@test.local', 'Kimberly', null)::text$q$);
  perform pg_temp.t3980a_like('F5', 'a teammate cannot set even their own name', v, 'ERR:42501:forbidden:%');
  v := pg_temp.t3980a_person('growth', $q$select public.ops_profile_set('lou.a3980@test.local', 'Louis', 'lou-gh')::text$q$);
  perform pg_temp.t3980a_like('F5', 'a teammate cannot set someone else''s name', v, 'ERR:42501:forbidden:%');
  v := pg_temp.t3980a_agent_sql('owner', 'claude', 'eeeeeeeeeeeeeeee', $q$select public.ops_profile_set('kim.a3980@test.local', 'Kimberly', null)::text$q$);
  perform pg_temp.t3980a_like('F5', 'the owner''s own agent cannot set names', v, 'ERR:42501:forbidden:%');
  v := pg_temp.t3980a_person('admin', $q$select public.ops_profiles_list()::text$q$);
  perform pg_temp.t3980a_like('F5', 'an admin cannot read the names list', v, 'ERR:42501:forbidden:%');
  v := pg_temp.t3980a_as('anon', $q$select public.ops_profile_set('kim.a3980@test.local', 'Kimberly', null)::text$q$);
  perform pg_temp.t3980a_like('F5', 'anonymous callers cannot reach it', v, 'ERR:42501:%');
  perform pg_temp.t3980a_check('F5', 'nothing was written by the refused calls', (select count(*)::text from public.ops_team_profiles where email like '%.a3980@test.local'), '0');

  v := pg_temp.t3980a_person('owner', format($q$select public.ops_profile_set('kim.a3980@test.local', %L, null)::text$q$, v_name40));
  perform pg_temp.t3980a_check('F5', 'a 40-character unicode name is kept exactly', pg_temp.t3980a_get(v, 'profile', 'name'), v_name40);
  perform pg_temp.t3980a_check('F5', 'and shows in agent labels with the chat', public.ops_actor_label('kim.a3980@test.local', 'claude', 'aaaaaaaaaaaaaaaa'), v_name40 || '''s Claude (chat aaaa)');
  v := pg_temp.t3980a_person('owner', format($q$select public.ops_profile_set('kim.a3980@test.local', %L, null)::text$q$, v_name40 || 'b'));
  perform pg_temp.t3980a_like('F5', 'a 41-character name is refused', v, 'ERR:22023:invalid_name: A name is 1 to 40 characters, one line.%');
  v := pg_temp.t3980a_person('owner', $q$select public.ops_profile_set('kim.a3980@test.local', E'Kim\nberly', null)::text$q$);
  perform pg_temp.t3980a_like('F5', 'a name over two lines is refused', v, 'ERR:22023:invalid_name:%');
  v := pg_temp.t3980a_person('owner', $q$select public.ops_profile_set('kim.a3980@test.local', E'Kim\tberly', null)::text$q$);
  perform pg_temp.t3980a_like('F5', 'a name with a tab is refused', v, 'ERR:22023:invalid_name:%');
  perform pg_temp.t3980a_check('F5', 'the refused names left the kept one', public.crm_display_name('kim.a3980@test.local'), v_name40);
  v := pg_temp.t3980a_person('owner', $q$select public.ops_profile_set('kim.a3980@test.local', '   ', null)::text$q$);
  perform pg_temp.t3980a_check('F5', 'a blank name falls back to the email name', pg_temp.t3980a_get(v, 'profile', 'name') || '/' || public.crm_display_name('kim.a3980@test.local'), 'Kim/Kim');
  v := pg_temp.t3980a_person('owner', $q$select public.ops_profile_set('max.a3980@test.local', 'Max', null)::text$q$);
  perform pg_temp.t3980a_like('F5', 'a teammate who left cannot be named', v, 'ERR:P0002:not_found: That person is not on the team.%');
  v := pg_temp.t3980a_person('owner', $q$select public.ops_profile_set('stranger@test.local', 'Stranger', null)::text$q$);
  perform pg_temp.t3980a_like('F5', 'someone who is not on the team cannot be named', v, 'ERR:P0002:not_found:%');

  -- Two teammates with one name.
  perform pg_temp.t3980a_person('owner', $q$select public.ops_profile_set('kim.a3980@test.local', 'Debrah', null)::text$q$);
  v := pg_temp.t3980a_person('owner', $q$select public.ops_profile_set('lou.a3980@test.local', 'debrah', null)::text$q$);
  perform pg_temp.t3980a_check('F5', 'two teammates may share a name', (v not like 'ERR:%')::text, 'true');
  perform pg_temp.t3980a_check('F5', 'a shared name is ambiguous as an owner, while each address still works',
    coalesce(public.ops_team_email('Debrah'), '<ambiguous>') || '/' || public.ops_team_email('lou.a3980@test.local'), '<ambiguous>/lou.a3980@test.local');
  v := pg_temp.t3980a_chat('KC', 'aaaaaaaaaaaaaaaa', 'add_work', format(
    $j${"cards":[{"title":"A3980 card for Debrah","instructions":"Assign it by the shared name.","done_means":"Debrah has it.","owners":["Debrah"],"due_on":"%s"}],"request_key":"a3980-f5-debrah-1"}$j$,
    (now() AT TIME ZONE 'UTC')::date + 3));
  perform pg_temp.t3980a_check('F5', 'a card owned by a shared name is refused, never given to the wrong Debrah',
    pg_temp.t3980a_get(v, 'result', 'refused') || '/' || pg_temp.t3980a_get(v, 'result', 'results', '0', 'fixes', '0', 'field'), '1/owners');
  perform pg_temp.t3980a_like('F5', 'and the fix tells the two apart by address',
    pg_temp.t3980a_get(v, 'result', 'results', '0', 'fixes', '0', 'message'), '%Debrah <kim.a3980@test.local>%debrah <lou.a3980@test.local>%');

  -- GitHub usernames.
  for v in select unnest(array['-kim', 'kim-', 'k--m', 'k_m', 'k.m', repeat('k', 40), 'kím']) loop
    perform pg_temp.t3980a_like('F5', 'GitHub username "' || v || '" is refused',
      pg_temp.t3980a_person('owner', format($q$select public.ops_profile_set('kim.a3980@test.local', 'Debrah', %L)::text$q$, v)),
      'ERR:22023:invalid_github_login:%');
  end loop;
  v := pg_temp.t3980a_person('owner', format($q$select public.ops_profile_set('kim.a3980@test.local', 'Debrah', %L)::text$q$, repeat('k', 38) || '9'));
  perform pg_temp.t3980a_check('F5', 'a 39-character GitHub username fits', (v not like 'ERR:%')::text, 'true');
  v := pg_temp.t3980a_person('owner', format($q$select public.ops_profile_set('lou.a3980@test.local', 'debrah', %L)::text$q$, upper(repeat('k', 38) || '9')));
  perform pg_temp.t3980a_like('F5', 'the same username in other letters belongs to the first teammate', v, 'ERR:22023:github_login_taken: Debrah already has that GitHub username.%');
end;
$f5$;

-- ---------------------------------------------------------------------------
-- G5: engineering follow-through cards.
-- ---------------------------------------------------------------------------
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (version text primary key);

create function pg_temp.t3980a_record(p_pr int, p_extra jsonb default '{}') returns jsonb
language sql as $fn$
  select jsonb_build_object('v', 1, 'repo', 'Mingla-LLC/mingla-main', 'pr', p_pr, 'title', 'A3980 record ' || p_pr,
    'pr_url', 'https://github.com/Mingla-LLC/mingla-main/pull/' || p_pr, 'merged_at', to_char((now() - interval '1 hour') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'merge_sha', md5(p_pr::text) || left(md5('x' || p_pr), 8), 'merged_by', 'lou-gh', 'author', 'kim-gh',
    'issues', '[{"number":3980,"relation":"toward"}]'::jsonb, 'migrations_added', '[]'::jsonb, 'migrations_applied_state', 'none',
    'edge_functions', '[]'::jsonb, 'web_projects', '[]'::jsonb, 'deploy_marker', true, 'deploy', '{"web":{},"edge":"none"}'::jsonb,
    'feature_guide', '[]'::jsonb, 'live_check', null, 'test_files', '[]'::jsonb, 'problems', '["live_check_missing"]'::jsonb) || p_extra
$fn$;

create function pg_temp.t3980a_ingest(p_data jsonb, p_issue int default 3980) returns text
language sql as $fn$
  select pg_temp.t3980a_as('service', format('select public.ops_release_records_ingest(%L::jsonb)::text',
    jsonb_build_array(jsonb_build_object('data', p_data, 'comment_url', 'https://github.com/Mingla-LLC/mingla-main/issues/' || p_issue || '#issuecomment-1',
      'issue_number', p_issue, 'commented_at', now()))))
$fn$;

create function pg_temp.t3980a_sync() returns text
language sql as $fn$ select pg_temp.t3980a_as('service', 'select public.ops_engineering_cards_sync()::text') $fn$;

create function pg_temp.t3980a_owner_of(p_key text) returns text
language sql as $fn$
  select string_agg(p.email || ':' || p.role, ',' order by p.role, p.email)
    from public.ops_work_people p join public.ops_work_cards w on w.id = p.card_id
   where w.auto_key = p_key and w.status <> 'done'
$fn$;

do $g5$
declare v text; v_card uuid; r record;
begin
  -- Close any engineering card the replayed data or earlier suites left open, so counts are this suite's.
  update public.ops_work_cards set status = 'done', close_kind = 'system', closed_at = now(), closed_by = 'system@usemingla.com', closed_via = 'system',
         proof = '[{"kind":"text","text":"suite reset","verified":true}]'::jsonb
   where auto_key like 'eng\_%' and status <> 'done';
  perform pg_temp.t3980a_person('owner', $q$select public.ops_profile_set('kim.a3980@test.local', null, 'kim-gh')::text$q$);
  perform pg_temp.t3980a_person('owner', $q$select public.ops_profile_set('lou.a3980@test.local', null, 'lou-gh')::text$q$);
  v := pg_temp.t3980a_as('growth', $q$select public.ops_engineering_cards_sync()::text$q$);
  perform pg_temp.t3980a_like('G5', 'a person cannot run the engineering sync', v, 'ERR:42501:%');
  v := pg_temp.t3980a_as('growth', format('select public.ops_main_commits_ingest(%L::jsonb)::text', '[]'));
  perform pg_temp.t3980a_like('G5', 'a person cannot write main commits', v, 'ERR:42501:%');

  -- Who owns what: whoever merged, else the author, else the owner.
  perform pg_temp.t3980a_ingest(pg_temp.t3980a_record(93001, '{"web_projects":["mingla-admin"],"deploy":{"web":{"mingla-admin":"failed"},"edge":"none"},"problems":["web_deploy_failed","live_check_missing"]}'));
  perform pg_temp.t3980a_ingest(pg_temp.t3980a_record(93002, '{"merged_by":"stranger-gh","edge_functions":["team-agent"],"deploy":{"web":{},"edge":"failed"},"problems":["edge_deploy_failed","live_check_missing"]}'));
  perform pg_temp.t3980a_ingest(pg_temp.t3980a_record(93003, '{"merged_by":"stranger-gh","author":"another-gh","feature_guide":null,"problems":["feature_guide_missing","live_check_missing"]}'));
  for r in 1..3 loop v := pg_temp.t3980a_sync(); end loop;
  perform pg_temp.t3980a_check('G5', 'three runs make each card once',
    (select string_agg(auto_key || '=' || n, ',' order by auto_key) from (select auto_key, count(*) n from public.ops_work_cards where auto_key like 'eng\_%' group by auto_key) x
      where auto_key like '%9300%'),
    'eng_deploy_failed:pr-93001:mingla-admin=1,eng_deploy_failed:pr-93002:edge=1,eng_guide_missing:pr-93003=1');
  perform pg_temp.t3980a_check('G5', 'the card goes to whoever merged, watched by the owner', pg_temp.t3980a_owner_of('eng_deploy_failed:pr-93001:mingla-admin'),
    'lou.a3980@test.local:owner,oz.a3980@test.local:watcher');
  perform pg_temp.t3980a_check('G5', 'a merger who is not a teammate hands it to the author', pg_temp.t3980a_owner_of('eng_deploy_failed:pr-93002:edge'),
    'kim.a3980@test.local:owner,oz.a3980@test.local:watcher');
  perform pg_temp.t3980a_check('G5', 'neither a teammate: the owner owns it, with no watcher', pg_temp.t3980a_owner_of('eng_guide_missing:pr-93003'), 'oz.a3980@test.local:owner');
  perform pg_temp.t3980a_check('G5', 'the failed edge deploy card says edge function',
    (select instructions from public.ops_work_cards where auto_key = 'eng_deploy_failed:pr-93002:edge' and status <> 'done'),
    'The edge function deploy for PR #93002 failed. Read the run, fix it and redeploy through the reviewed path.');

  -- Fixed: the failed web deploy is now ready; the card closes itself and says why.
  perform pg_temp.t3980a_ingest(pg_temp.t3980a_record(93001, '{"web_projects":["mingla-admin"],"deploy":{"web":{"mingla-admin":"ready"},"edge":"none"},"problems":["live_check_missing"]}'));
  v := pg_temp.t3980a_sync();
  select id into v_card from public.ops_work_cards where auto_key = 'eng_deploy_failed:pr-93001:mingla-admin';
  perform pg_temp.t3980a_check('G5', 'a fixed deploy closes its card by itself, with its reason',
    (select status || ':' || close_kind || ':' || close_reason from public.ops_work_cards where id = v_card), 'done:system:The deploy no longer shows as failed.');
  perform pg_temp.t3980a_check('G5', 'the other two stay open',
    (select count(*)::text from public.ops_work_cards where auto_key in ('eng_deploy_failed:pr-93002:edge', 'eng_guide_missing:pr-93003') and status <> 'done'), '2');

  -- A person closes one; Mingla does not make it again within 14 days.
  select id into v_card from public.ops_work_cards where auto_key = 'eng_guide_missing:pr-93003' and status <> 'done';
  update public.ops_work_cards set status = 'done', close_kind = 'declined', close_reason = 'Not needed for this PR', closed_at = now(),
         closed_by = 'oz.a3980@test.local', proof = '[]'::jsonb where id = v_card;
  v := pg_temp.t3980a_sync();
  perform pg_temp.t3980a_check('G5', 'a card a person closed is not made again',
    (select count(*)::text from public.ops_work_cards where auto_key = 'eng_guide_missing:pr-93003'), '1');

  -- Migrations pending past a day; then applied.
  perform pg_temp.t3980a_ingest(pg_temp.t3980a_record(93004, '{"migrations_added":["29990202000001","29990202000002"],"migrations_applied_state":"pending"}'));
  update public.ops_release_records set merged_at = now() - interval '25 hours' where pr = 93004;
  v := pg_temp.t3980a_sync();
  perform pg_temp.t3980a_check('G5', 'migrations still missing a day after the merge make a card naming them',
    (select instructions from public.ops_work_cards where auto_key = 'eng_migrations:pr-93004' and status <> 'done'),
    'PR #93004 merged with migrations 29990202000001, 29990202000002 that the production ledger does not show yet. Apply them through the reviewed path with Seth''s go.');
  insert into supabase_migrations.schema_migrations (version) values ('29990202000001');
  perform pg_temp.t3980a_as('service', 'select public.ops_release_status_due()::text');
  v := pg_temp.t3980a_sync();
  perform pg_temp.t3980a_check('G5', 'one of two applied keeps the card open', (select status from public.ops_work_cards where auto_key = 'eng_migrations:pr-93004'), 'todo');
  insert into supabase_migrations.schema_migrations (version) values ('29990202000002');
  perform pg_temp.t3980a_as('service', 'select public.ops_release_status_due()::text');
  v := pg_temp.t3980a_sync();
  perform pg_temp.t3980a_check('G5', 'both applied closes it', (select status || ':' || close_kind from public.ops_work_cards where auto_key = 'eng_migrations:pr-93004'), 'done:system');

  -- A merged PR seen on main with no record after 30 minutes; a direct push.
  perform pg_temp.t3980a_as('service', format('select public.ops_main_commits_ingest(%L::jsonb)::text', jsonb_build_array(
    jsonb_build_object('sha', md5('93005') || left(md5('y93005'), 8), 'committed_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'subject', 'Merged without a record (#93005)', 'author_login', 'lou-gh', 'pr', 93005),
    jsonb_build_object('sha', md5('push') || left(md5('ypush'), 8), 'committed_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'subject', 'hotfix pushed straight to main', 'author_login', 'kim-gh', 'pr', null))));
  update public.ops_main_commits set seen_at = now() - interval '31 minutes' where pr = 93005;
  v := pg_temp.t3980a_sync();
  perform pg_temp.t3980a_check('G5', 'a merged PR with no record after 30 minutes makes a card; a direct push makes one for its author',
    (select string_agg(auto_key || '>' || coalesce(pg_temp.t3980a_owner_of(auto_key), '-'), ' ' order by auto_key) from public.ops_work_cards
      where status <> 'done' and (auto_key = 'eng_bot_missing:pr-93005' or auto_key = 'eng_no_pr_push:' || left(md5('push'), 7))),
    'eng_bot_missing:pr-93005>lou.a3980@test.local:owner,oz.a3980@test.local:watcher eng_no_pr_push:' || left(md5('push'), 7) || '>kim.a3980@test.local:owner,oz.a3980@test.local:watcher');
  perform pg_temp.t3980a_ingest(pg_temp.t3980a_record(93005));
  for r in 1..2 loop v := pg_temp.t3980a_sync(); end loop;
  perform pg_temp.t3980a_check('G5', 'the record arriving closes the missing-record card; the direct push stays for a person',
    (select status from public.ops_work_cards where auto_key = 'eng_bot_missing:pr-93005') || '/' ||
    (select status from public.ops_work_cards where auto_key = 'eng_no_pr_push:' || left(md5('push'), 7)), 'done/todo');
  perform pg_temp.t3980a_check('G5', 'a re-ingested main commit is not counted twice',
    pg_temp.t3980a_get(pg_temp.t3980a_as('service', format('select public.ops_main_commits_ingest(%L::jsonb)::text', jsonb_build_array(
      jsonb_build_object('sha', md5('push') || left(md5('ypush'), 8), 'committed_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'subject', 'changed subject', 'pr', 1)))), 'inserted')
      || '/' || (select subject || ':' || coalesce(pr::text, 'none') from public.ops_main_commits where sha = md5('push') || left(md5('ypush'), 8)),
    '0/hotfix pushed straight to main:none');
  -- Only the live check missing, under 48 hours: no card yet.
  perform pg_temp.t3980a_ingest(pg_temp.t3980a_record(93006));
  update public.ops_release_records set merged_at = now() - interval '47 hours' where pr = 93006;
  v := pg_temp.t3980a_sync();
  perform pg_temp.t3980a_check('G5', 'a live check pending under 48 hours makes no card',
    (select count(*)::text from public.ops_work_cards where auto_key like 'eng\_%pr-93006%'), '0');
  -- Records from outside the repository or with a mismatched address are never read.
  v := pg_temp.t3980a_ingest(pg_temp.t3980a_record(93007, '{"repo":"someone/mingla-main"}'));
  perform pg_temp.t3980a_check('G5', 'a record naming another repository is skipped', pg_temp.t3980a_get(v, 'invalid'), '1');
  v := pg_temp.t3980a_ingest(pg_temp.t3980a_record(93008, '{"pr_url":"https://github.com/Mingla-LLC/mingla-main/pull/1"}'));
  perform pg_temp.t3980a_check('G5', 'a record whose address names another PR is skipped', pg_temp.t3980a_get(v, 'invalid'), '1');
  v := pg_temp.t3980a_ingest(pg_temp.t3980a_record(93009, '{"issues":[{"number":"3980","relation":"toward"}]}'));
  perform pg_temp.t3980a_check('G5', 'a record whose issue number is text is skipped', pg_temp.t3980a_get(v, 'invalid'), '1');
  v := pg_temp.t3980a_as('service', format('select public.ops_release_records_ingest(%L::jsonb)::text', jsonb_build_array(jsonb_build_object(
    'data', pg_temp.t3980a_record(93010), 'comment_url', 'https://github.com/someone/else/issues/1#issuecomment-9', 'issue_number', 3980, 'commented_at', now()))));
  perform pg_temp.t3980a_check('G5', 'a comment address outside the repository is not kept',
    pg_temp.t3980a_get(v, 'ingested') || '/' || (select comment_urls::text from public.ops_release_records where pr = 93010), '1/{}');
end;
$g5$;

-- ---------------------------------------------------------------------------
-- F1: the two Feature Guide entries are Live with only proven evidence.
-- ---------------------------------------------------------------------------
do $f1$
declare c_sha constant text := '2f1ef910d01119ba5248901ad6dbfa3e2ba63ee1';
begin
  perform pg_temp.t3980a_check('F1', 'both entries are live at revision 2',
    (select string_agg(capability_key || ':' || claimed_status || ':' || revision, ',' order by capability_key) from public.product_capabilities
      where capability_key in ('staff-work-board', 'staff-agent-log')), 'staff-agent-log:live:2,staff-work-board:live:2');
  perform pg_temp.t3980a_check('F1', 'every current evidence row is verified and one of the four kinds the release proves',
    (select count(*)::text from public.product_capability_evidence e join public.product_capabilities c on c.id = e.capability_id
      where c.capability_key in ('staff-work-board', 'staff-agent-log') and e.is_current
        and (e.verdict <> 'verified' or e.evidence_kind not in ('source', 'test', 'release_record', 'live_check'))), '0');
  perform pg_temp.t3980a_check('F1', 'source and test evidence point at files at the full merge commit',
    (select count(*)::text from public.product_capability_evidence e join public.product_capabilities c on c.id = e.capability_id
      where c.capability_key in ('staff-work-board', 'staff-agent-log') and e.is_current and e.evidence_kind in ('source', 'test')
        and e.evidence_url like 'https://github.com/Mingla-LLC/mingla-main/blob/' || c_sha || '/%'), '4');
  perform pg_temp.t3980a_check('F1', 'the release record and live check point at the two #3980 comments, nowhere else',
    (select string_agg(distinct e.evidence_kind || '=' || e.evidence_url, ' ' order by e.evidence_kind || '=' || e.evidence_url) from public.product_capability_evidence e join public.product_capabilities c on c.id = e.capability_id
      where c.capability_key in ('staff-work-board', 'staff-agent-log') and e.is_current and e.evidence_kind in ('release_record', 'live_check')),
    'live_check=https://github.com/Mingla-LLC/mingla-main/issues/3980#issuecomment-6282123939 release_record=https://github.com/Mingla-LLC/mingla-main/issues/3980#issuecomment-6281962213');
  perform pg_temp.t3980a_check('F1', 'the source evidence names each entry''s own page',
    (select string_agg(c.capability_key || '=' || split_part(e.evidence_url, '/', 11), ',' order by c.capability_key) from public.product_capability_evidence e join public.product_capabilities c on c.id = e.capability_id
      where c.capability_key in ('staff-work-board', 'staff-agent-log') and e.is_current and e.evidence_kind = 'source'),
    'staff-agent-log=AgentLogPage.jsx,staff-work-board=WorkBoardPage.jsx');
  perform pg_temp.t3980a_check('F1', 'the live check is the only evidence that expires, on 18 January',
    (select string_agg(distinct e.evidence_kind || '=' || coalesce(e.expires_at::text, 'never'), ',' order by e.evidence_kind || '=' || coalesce(e.expires_at::text, 'never')) from public.product_capability_evidence e join public.product_capabilities c on c.id = e.capability_id
      where c.capability_key in ('staff-work-board', 'staff-agent-log') and e.is_current),
    'live_check=2027-01-18 02:44:56+00,release_record=never,source=never,test=never');
  perform pg_temp.t3980a_check('F1', 'no other entry was turned Live by this change',
    (select count(*)::text from public.product_truth_audit a where a.metadata->>'source' = 'issue_3980_synced_f1'
      and a.capability_id not in (select id from public.product_capabilities where capability_key in ('staff-work-board', 'staff-agent-log'))), '0');
end;
$f1$;

select count(*) as t3980a_total, count(*) filter (where not ok) as t3980a_failed,
       coalesce(string_agg(test || ' ' || label || ' [' || detail || ']', E'\n' order by seq) filter (where not ok), 'none') as t3980a_failures
  from t3980a_results \gset
rollback;

select (:t3980a_total < 120 or :t3980a_failed > 0) as t3980a_bad \gset
\if :t3980a_bad
  \echo 'ISSUE-3980 SYNCED WAVE 1 TESTER FAILED:' :t3980a_failed 'of' :t3980a_total
  \echo :t3980a_failures
  do $$ begin raise exception 'ISSUE-3980 SYNCED WAVE 1 TESTER FAIL'; end $$;
\endif
\echo 'ISSUE-3980 SYNCED WAVE 1 TESTER PASS:' :t3980a_total 'checks, 0 failed'
