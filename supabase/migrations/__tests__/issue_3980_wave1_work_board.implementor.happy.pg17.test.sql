-- Issue #3980 Wave 1 -- the Work board, the agent log, claims and the
-- three-day repeat-message block, on the fully replayed PG17 schema.
-- [TEST-MOD-APPROVED #3980] the synced program restates this declaration in the contract's words.
-- MINGLA-INVARIANT: I-3980-WORK-CARD-SERVER-CHECKS | issue #3980 | Every work card a person or an agent writes is checked on the server for title, instructions, a done-means line, at least one current teammate as owner, a due date, links to real records and no duplicate open card, and a failure returns plain-words fixes and writes nothing.
-- MINGLA-INVARIANT: I-3980-CLAIMS-BIND-AGENT-WRITES | issue #3980 | An agent change to a host, creator, content or work card that another agent holds an unexpired claim on is refused on the server with who holds it and since when, and a claim ends 30 minutes after its last update.
-- MINGLA-INVARIANT: I-3980-NO-REPEAT-MESSAGE-3-DAYS | issue #3980 | An agent cannot write a message for a host or creator that Mingla messaged in the last three days, or that a teammate's message is already waiting for, unless a person allowed one more for that record.
-- MINGLA-INVARIANT: I-3980-AGENT-NEVER-SENDS-SPENDS-PUBLISHES | issue #3980 | No work, log or calendar path lets an agent mark a message sent, approve spend, mark an event published, override a giveaway or ads block, remove a card or close a card without proof.
-- MINGLA-INVARIANT: I-3980-OPS-TABLES-CLOSED | issue #3980 | Every ops table has row security on, no policy and no client privilege, all access goes through role-checked ops functions, and the agent log cannot be changed or removed.
--
-- What it proves (each check is recorded and reported together):
--   W1-ADD     a valid card is added with owners, watchers, links and a
--              sprint; each missing field is refused with its exact fix and
--              nothing is written; a non-team or removed owner and a link to
--              a missing record are refused; a duplicate open title returns
--              the existing card; a repeat changes nothing; a reused key with
--              other cards is refused; due dates count back from an event
--   W1-CLAIMS  another agent's update, stage move and draft on a claimed host
--              are refused naming the holder; the holder's own write keeps
--              the claim alive; a person is never refused and the log says
--              so; after 30 minutes the claim ends; claims are all or nothing
--   W1-SEND    a draft to a host messaged 2 days ago is refused and logged;
--              4 days ago is allowed; a teammate's waiting draft refuses a
--              second; a person's override allows one more; marking a draft
--              sent twice records one touch
--   W1-CLOSE   close needs proof, refuses proof that points nowhere, closes
--              with a real draft, releases claims and tells owners; push
--              back as already done needs proof; reopen works; undo restores
--   W1-PEOPLE  an agent cannot approve spend, remove a card, close a card that
--              needs a person or a gate card; a person can
--   W1-NOTIFY  owners and watchers (never the actor) get work-card notices
--              with no country code
--   W1-CLOSED  no client can read or write an ops table; the log is append-only
--   W1-GUIDE   get_started has 25 rules and 9 routines (synced program, #3980)
--   W1-LIST    tools/list says work is open to a teammate
--
-- Run from the repository root as supabase_admin. Everything is rolled back.

\set ON_ERROR_STOP on
begin;

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

create temp table t3980_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into t3980_people (who, id, email) values
  ('owner',   '39800000-0000-4000-a000-000000000001', 'ed.w3980@test.local'),
  ('admin',   '39800000-0000-4000-a000-000000000002', 'di.w3980@test.local'),
  ('growth',  '39800000-0000-4000-a000-000000000003', 'ada.w3980@test.local'),
  ('growth2', '39800000-0000-4000-a000-000000000004', 'bo.w3980@test.local'),
  ('partner', '39800000-0000-4000-a000-000000000005', 'cy.w3980@test.local'),
  ('leaver',  '39800000-0000-4000-a000-000000000006', 'fay.w3980@test.local'),
  ('nobody',  '39800000-0000-4000-a000-000000000007', 'gus.w3980@test.local');
insert into auth.users (id, email, email_confirmed_at) select id, email, now() from t3980_people;
insert into public.admin_users (email, role, status, accepted_at) values
  ('ed.w3980@test.local', 'owner', 'active', now()),
  ('di.w3980@test.local', 'admin', 'active', now());
insert into public.admin_team_members (email, role, status, accepted_at) values
  ('ada.w3980@test.local', 'growth', 'active', now()),
  ('bo.w3980@test.local', 'growth', 'active', now()),
  ('cy.w3980@test.local', 'partner', 'active', now()),
  ('fay.w3980@test.local', 'growth', 'revoked', now());

set local session_replication_role = replica;
insert into public.brands (id, account_id, name, slug, city) values
  ('39800000-0000-4000-b100-000000000001', '39800000-0000-4000-b300-000000000001', 'W3980 Palm Brand', 'w3980-palm-brand', 'Lagos');
insert into public.events (id, brand_id, title, slug, visibility, status, timezone, published_at, event_type) values
  ('39800000-0000-4000-b400-000000000001', '39800000-0000-4000-b100-000000000001', 'W3980 Rooftop Night', 'w3980-rooftop-night', 'discover', 'scheduled', 'UTC', now() - interval '1 day', 'event');
insert into public.event_dates (event_id, start_at, end_at, is_master) values
  ('39800000-0000-4000-b400-000000000001', date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' + interval '40 days 20 hours',
   date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' + interval '40 days 23 hours', true);
set local session_replication_role = origin;

create temp table t3980_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;
create temp table t3980_ids (k text primary key, v text) on commit drop;

-- One statement as a caller: its single text result, or ERR:<sqlstate>:<message>.
create function pg_temp.t3980_as(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text; v_out text;
begin
  if p_who not in ('anon', 'service') then
    select id, email into strict v_id, v_email from t3980_people where who = p_who;
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

create function pg_temp.t3980_check(p_test text, p_label text, p_got text, p_want text) returns void
language plpgsql as $fn$
begin
  insert into t3980_results (test, label, ok, detail)
  values (p_test, p_label, p_got is not distinct from p_want,
          format('got %s, want %s', coalesce(left(p_got, 600), '<null>'), coalesce(p_want, '<null>')));
end;
$fn$;

create function pg_temp.t3980_like(p_test text, p_label text, p_got text, p_pattern text) returns void
language plpgsql as $fn$
begin
  insert into t3980_results (test, label, ok, detail)
  values (p_test, p_label, coalesce(p_got like p_pattern, false),
          format('got %s, want like %s', coalesce(left(p_got, 600), '<null>'), p_pattern));
end;
$fn$;

create function pg_temp.t3980_get(p text, variadic p_path text[]) returns text
language plpgsql as $fn$
begin
  return p::jsonb #>> p_path;
exception when others then
  return p;
end;
$fn$;

create function pg_temp.t3980_j(p text) returns jsonb
language plpgsql as $fn$
begin
  return p::jsonb;
exception when others then
  return jsonb_build_object('unreadable', left(p, 300));
end;
$fn$;

create function pg_temp.t3980_id(p_k text) returns text
language sql as $fn$ select v from t3980_ids where k = p_k $fn$;

create function pg_temp.t3980_keep(p_k text, p_v text) returns void
language sql as $fn$ insert into t3980_ids (k, v) values (p_k, p_v) on conflict (k) do update set v = excluded.v $fn$;

-- Request rows written so far belong to an earlier, finished request.
create function pg_temp.t3980_next_request() returns void
language sql as $fn$
  update public.team_agent_calls set xact_id = '3'::xid8, started_at = started_at - interval '5 minutes' where xact_id <> '3'::xid8
$fn$;

-- A person in a browser session.
create function pg_temp.t3980_person(p_who text, p_sql text) returns text
language plpgsql as $fn$
begin
  perform pg_temp.t3980_next_request();
  return pg_temp.t3980_as(p_who, p_sql);
end;
$fn$;

-- A person's connected agent calling a function directly: the request row
-- the connector writes first, in this transaction, then the call.
create function pg_temp.t3980_agent_sql(p_who text, p_agent text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text;
begin
  perform pg_temp.t3980_next_request();
  select id, email into strict v_id, v_email from t3980_people where who = p_who;
  insert into public.team_agent_calls (key_id, owner_email, actor_uid, agent, tool, xact_id, started_at)
  values (gen_random_uuid(), v_email, v_id, p_agent, 'update_work', pg_current_xact_id(), clock_timestamp());
  return pg_temp.t3980_as(p_who, p_sql);
end;
$fn$;

create function pg_temp.t3980_digest(p text) returns text
language sql as $fn$ select encode(sha256(convert_to(p, 'UTF8')), 'hex') $fn$;

create function pg_temp.t3980_newkey(p_who text, p_agent text, p_label text) returns text
language plpgsql as $fn$
declare v text;
begin
  v := pg_temp.t3980_person(p_who, format('select public.team_agent_key_create(%L)::text', p_agent));
  if v like 'ERR:%' then return v; end if;
  perform pg_temp.t3980_keep(p_label, pg_temp.t3980_j(v) ->> 'key');
  return v;
end;
$fn$;

-- One agent request through a gateway, the way the edge function makes it.
create function pg_temp.t3980_gw(p_label text, p_tool text, p_args text default '{}', p_gateway text default 'team_agent_call') returns text
language plpgsql as $fn$
begin
  perform pg_temp.t3980_next_request();
  return pg_temp.t3980_as('service', format('select public.%s(%L, %L, %L::jsonb, %L)::text', p_gateway,
    pg_temp.t3980_digest(coalesce(pg_temp.t3980_id(p_label), p_label)), p_tool, p_args, 'issue3980-client/1.0'));
end;
$fn$;

create function pg_temp.t3980_work(p_label text, p_tool text, p_args text default '{}') returns text
language sql as $fn$ select pg_temp.t3980_gw(p_label, p_tool, p_args, 'ops_agent_call') $fn$;

create function pg_temp.t3980_rec(p_name text) returns uuid
language plpgsql as $fn$
declare v_id uuid;
begin
  insert into public.crm_records (pipeline, name, stage, created_by, updated_by)
  values ('hosts', p_name, 'contacted', 'w3980-fixture', 'w3980-fixture') returning id into v_id;
  return v_id;
end;
$fn$;

create function pg_temp.t3980_touch(p_record uuid, p_ago interval) returns void
language sql as $fn$
  insert into public.crm_activity (record_id, kind, actor_email, channel, direction, body, occurred_at)
  values (p_record, 'touch', 'ada.w3980@test.local', 'whatsapp', 'outbound', 'Fixture outbound message', now() - p_ago)
$fn$;

select pg_temp.t3980_newkey('growth', 'claude', 'A') is not null as key_a,
       pg_temp.t3980_newkey('growth2', 'codex', 'B') is not null as key_b;

-- Fixture hosts and the event's start date.
select pg_temp.t3980_keep('h1', pg_temp.t3980_rec('W3980 Claimed Host')::text),
       pg_temp.t3980_keep('h2', pg_temp.t3980_rec('W3980 Second Host')::text),
       pg_temp.t3980_keep('h3', pg_temp.t3980_rec('W3980 Third Host')::text),
       pg_temp.t3980_keep('h4', pg_temp.t3980_rec('W3980 Fourth Host')::text),
       pg_temp.t3980_keep('h5', pg_temp.t3980_rec('W3980 Messaged Host')::text),
       pg_temp.t3980_keep('h6', pg_temp.t3980_rec('W3980 Quiet Host')::text),
       pg_temp.t3980_keep('h7', pg_temp.t3980_rec('W3980 Waiting Host')::text),
       pg_temp.t3980_keep('start_on', ((date_trunc('day', now() AT TIME ZONE 'UTC') + interval '40 days')::date)::text),
       pg_temp.t3980_keep('today', ((now() AT TIME ZONE 'UTC')::date)::text);

-- ---------------------------------------------------------------------------
-- W1-ADD
-- ---------------------------------------------------------------------------
do $add$
declare v text; v_cards bigint; v_due date := (now() AT TIME ZONE 'UTC')::date + 5; v_items text;
begin
  v_items := format($j$[{"title":"Collect the W3980 menu","instructions":"Ask the host for the new menu and put it on the host card.","done_means":"The menu is on the host card.","owners":["ada.w3980@test.local","cy.w3980@test.local"],"watchers":["di.w3980@test.local"],"links":[{"kind":"host","id":"%s"}],"due_on":"%s"}]$j$,
    pg_temp.t3980_id('h1'), v_due);
  v := pg_temp.t3980_person('growth', format('select public.ops_work_add(%L::jsonb, %L)::text', v_items, 'w3980-add-0001'));
  perform pg_temp.t3980_check('W1-ADD', 'a valid card is added',
    pg_temp.t3980_get(v, 'results', '0', 'status') || '/' || pg_temp.t3980_get(v, 'added'), 'added/1');
  perform pg_temp.t3980_keep('c1', pg_temp.t3980_get(v, 'results', '0', 'card', 'id'));
  -- #3980 D-3: a card is filed under this week's sprint, never its due week.
  perform pg_temp.t3980_check('W1-ADD', 'with two owners, one watcher, the host link, this week''s sprint and To do',
    jsonb_array_length(pg_temp.t3980_j(v) #> '{results,0,card,owners}') || '/' || jsonb_array_length(pg_temp.t3980_j(v) #> '{results,0,card,watchers}')
      || '/' || (pg_temp.t3980_j(v) #>> '{results,0,card,links,0,label}') || '/' || (pg_temp.t3980_j(v) #>> '{results,0,card,sprint,starts_on}')
      || '/' || (pg_temp.t3980_j(v) #>> '{results,0,card,status}'),
    '2/1/W3980 Claimed Host/' || public.ops_monday((now() AT TIME ZONE 'UTC')::date)::text || '/todo');

  select count(*) into v_cards from public.ops_work_cards;
  v := pg_temp.t3980_person('growth', $q$select public.ops_work_add('[{"links":[]}]'::jsonb, 'w3980-add-0002')::text$q$);
  perform pg_temp.t3980_check('W1-ADD', 'a card missing every required field is refused, not duplicate, and nothing is written',
    pg_temp.t3980_get(v, 'results', '0', 'status') || '/' || (select count(*) from public.ops_work_cards)::text, 'refused/' || v_cards);
  perform pg_temp.t3980_check('W1-ADD', 'missing title: the exact fix',
    (select f->>'message' from jsonb_array_elements(pg_temp.t3980_j(v) #> '{results,0,fixes}') f where f->>'field' = 'title'),
    'Title is missing. Say what the work is in 3 to 160 characters.');
  perform pg_temp.t3980_check('W1-ADD', 'missing instructions: the exact fix',
    (select f->>'message' from jsonb_array_elements(pg_temp.t3980_j(v) #> '{results,0,fixes}') f where f->>'field' = 'instructions'),
    'Instructions are missing. Say what the person or their agent should do (10 to 4,000 characters).');
  perform pg_temp.t3980_check('W1-ADD', 'missing done means: the exact fix',
    (select f->>'message' from jsonb_array_elements(pg_temp.t3980_j(v) #> '{results,0,fixes}') f where f->>'field' = 'done_means'),
    'Done means is empty. Add one line the work is checked against.');
  perform pg_temp.t3980_like('W1-ADD', 'no owner: the exact fix, naming current teammates',
    (select f->>'message' from jsonb_array_elements(pg_temp.t3980_j(v) #> '{results,0,fixes}') f where f->>'field' = 'owners'),
    'No owner. Pick at least one current teammate: %Ada%');
  perform pg_temp.t3980_check('W1-ADD', 'no due date: the exact fix',
    (select f->>'message' from jsonb_array_elements(pg_temp.t3980_j(v) #> '{results,0,fixes}') f where f->>'field' = 'due_on'),
    'No due date. Add one, or link an event and it is counted back from the start.');
  perform pg_temp.t3980_check('W1-ADD', 'the refusal is in the agent log as stopped',
    (select outcome from public.ops_agent_log where action = 'card_refused' and actor_email = 'ada.w3980@test.local' order by id desc limit 1), 'stopped');

  v := pg_temp.t3980_person('growth', format($q$select public.ops_work_add('[{"title":"W3980 owner check","instructions":"Check the owner rule here.","done_means":"Owner rule checked.","owners":["gus.w3980@test.local","fay.w3980@test.local"],"due_on":"%s","links":[{"kind":"host","id":"39800000-0000-4000-9999-000000000001"}]}]'::jsonb, 'w3980-add-0003')::text$q$, v_due));
  perform pg_temp.t3980_like('W1-ADD', 'an owner who is not on the team is refused',
    (select string_agg(f->>'message', ' | ') from jsonb_array_elements(pg_temp.t3980_j(v) #> '{results,0,fixes}') f where f->>'field' = 'owners'),
    'Owner "gus.w3980@test.local" is not on the team. Pick from %');
  perform pg_temp.t3980_like('W1-ADD', 'a removed teammate is refused as owner too',
    (select string_agg(f->>'message', ' | ') from jsonb_array_elements(pg_temp.t3980_j(v) #> '{results,0,fixes}') f where f->>'field' = 'owners'),
    '%Owner "fay.w3980@test.local" is not on the team.%');
  perform pg_temp.t3980_check('W1-ADD', 'a link to a missing record is refused',
    (select f->>'message' from jsonb_array_elements(pg_temp.t3980_j(v) #> '{results,0,fixes}') f where f->>'field' = 'links'),
    'Linked host 39800000-0000-4000-9999-000000000001 does not exist or was removed. Pick it again from live data.');

  v := pg_temp.t3980_person('growth2', format($q$select public.ops_work_add('[{"title":"collect the  W3980 MENU","instructions":"Same work again, typed differently.","done_means":"Menu collected.","owners":["bo.w3980@test.local"],"due_on":"%s"}]'::jsonb, 'w3980-add-0004')::text$q$, v_due));
  perform pg_temp.t3980_check('W1-ADD', 'a duplicate of an open card returns that card',
    pg_temp.t3980_get(v, 'results', '0', 'status') || '/' || pg_temp.t3980_get(v, 'results', '0', 'existing', 'id'),
    'duplicate/' || pg_temp.t3980_id('c1'));
  perform pg_temp.t3980_like('W1-ADD', 'in plain words',
    pg_temp.t3980_get(v, 'results', '0', 'message'), 'An open card already does this: "Collect the W3980 menu" (Card %). Update that card instead.');

  select count(*) into v_cards from public.ops_work_cards;
  v := pg_temp.t3980_person('growth', format('select public.ops_work_add(%L::jsonb, %L)::text', v_items, 'w3980-add-0001'));
  perform pg_temp.t3980_check('W1-ADD', 'the same request again changes nothing and says it was a repeat',
    pg_temp.t3980_get(v, 'replayed') || '/' || (select count(*) from public.ops_work_cards)::text, 'true/' || v_cards);
  v := pg_temp.t3980_person('growth', $q$select public.ops_work_add('[{"title":"Another thing"}]'::jsonb, 'w3980-add-0001')::text$q$);
  perform pg_temp.t3980_like('W1-ADD', 'the same key with other cards is refused', v, 'ERR:22023:request_key_reused:%');

  v := pg_temp.t3980_person('growth', format($q$select public.ops_work_add('[{"title":"W3980 counted from the event","instructions":"Share the event with the creators list.","done_means":"Creators have the event.","owners":["ada.w3980@test.local"],"links":[{"kind":"event","id":"39800000-0000-4000-b400-000000000001"}]},{"title":"W3980 content brief","instructions":"Write the content brief for the night.","done_means":"The brief is on the card.","owners":["ada.w3980@test.local"],"anchor":{"kind":"event","id":"39800000-0000-4000-b400-000000000001"},"kit_step":-26}]'::jsonb, 'w3980-add-0005')::text$q$));
  perform pg_temp.t3980_check('W1-ADD', 'with only an event linked, the due date is the day before it starts',
    pg_temp.t3980_get(v, 'results', '0', 'card', 'due_on') || '/' || pg_temp.t3980_get(v, 'results', '0', 'card', 'due_source'),
    ((pg_temp.t3980_id('start_on'))::date - 1)::text || '/event');
  perform pg_temp.t3980_check('W1-ADD', 'with a kit step, the due date is counted back from the start',
    pg_temp.t3980_get(v, 'results', '1', 'card', 'due_on') || '/' || pg_temp.t3980_get(v, 'results', '1', 'card', 'due_source'),
    ((pg_temp.t3980_id('start_on'))::date - 26)::text || '/kit');

  -- cards used further down: C2 (agent A's person owns it), C3 (needs a person to spend), C4 (go-live gate)
  v := pg_temp.t3980_person('growth', format($q$select public.ops_work_add('[{"title":"W3980 write the first message","instructions":"Write the first message to the quiet host with save_drafts.","done_means":"A draft is waiting in To review.","owners":["ada.w3980@test.local","cy.w3980@test.local"],"watchers":["di.w3980@test.local"],"due_on":"%s"},{"title":"W3980 approve the boost","instructions":"Approve a small boost for the night.","done_means":"Spend approved by a person.","owners":["ada.w3980@test.local"],"due_on":"%s","person_reason":"spend"},{"title":"W3980 gate","instructions":"The event must be public 28 days before it starts.","done_means":"The event is public on Mingla.","owners":["ada.w3980@test.local"],"kind":"gate_live","kit_step":-28,"anchor":{"kind":"event","id":"39800000-0000-4000-b400-000000000001"}}]'::jsonb, 'w3980-add-0006')::text$q$, v_due, v_due));
  perform pg_temp.t3980_check('W1-ADD', 'three more cards are added, one waiting for a person',
    pg_temp.t3980_get(v, 'added') || '/' || pg_temp.t3980_get(v, 'results', '1', 'card', 'status'), '3/person');
  perform pg_temp.t3980_keep('c2', pg_temp.t3980_get(v, 'results', '0', 'card', 'id'));
  perform pg_temp.t3980_keep('c3', pg_temp.t3980_get(v, 'results', '1', 'card', 'id'));
  perform pg_temp.t3980_keep('c4', pg_temp.t3980_get(v, 'results', '2', 'card', 'id'));

  -- through the connector: one valid card, one refused with every fix
  v := pg_temp.t3980_work('A', 'add_work', $j${"cards":[{"title":"W3980 agent card","instructions":"Agent adds this card for its person.","done_means":"The card is on the board.","owners":["Ada"],"due_on":"2099-01-01"},{"title":"x"}],"request_key":"w3980-agent-add-01"}$j$);
  perform pg_temp.t3980_check('W1-ADD', 'an agent adds through the connector: one added, one refused',
    pg_temp.t3980_get(v, 'ok') || '/' || pg_temp.t3980_get(v, 'result', 'added') || '/' || pg_temp.t3980_get(v, 'result', 'refused'), 'true/0/2');
  v := pg_temp.t3980_work('A', 'add_work', format($j${"cards":[{"title":"W3980 agent card","instructions":"Agent adds this card for its person.","done_means":"The card is on the board.","owners":["Ada"],"due_on":"%s"}],"request_key":"w3980-agent-add-02"}$j$, v_due));
  perform pg_temp.t3980_check('W1-ADD', 'the agent card is added as made by its agent',
    pg_temp.t3980_get(v, 'result', 'results', '0', 'card', 'created_via') || '/' || pg_temp.t3980_get(v, 'result', 'results', '0', 'card', 'owners', '0', 'email'),
    'claude/ada.w3980@test.local');
end;
$add$;

-- ---------------------------------------------------------------------------
-- W1-CLAIMS
-- ---------------------------------------------------------------------------
do $claims$
declare v text; v_seen timestamptz;
begin
  v := pg_temp.t3980_work('A', 'claim', format('{"card_id":"%s","targets":[{"kind":"crm_record","id":"%s"}]}', pg_temp.t3980_id('c1'), pg_temp.t3980_id('h1')));
  perform pg_temp.t3980_check('W1-CLAIMS', 'agent A claims the card and the host',
    -- [TEST-MOD-APPROVED #3980] D-4: a card is never claimed; claim(card_id) claims only the records named.
    pg_temp.t3980_get(v, 'result', 'status') || '/' || jsonb_array_length(pg_temp.t3980_j(v) #> '{result,claims}'), 'claimed/1');
  perform pg_temp.t3980_check('W1-CLAIMS', 'the claim is in the agent log',
    (select action || '/' || via from public.ops_agent_log where actor_email = 'ada.w3980@test.local' and action = 'claimed' order by id desc limit 1), 'claimed/claude');

  v := pg_temp.t3980_gw('B', 'update_records', format('{"updates":[{"id":"%s","changes":{"next_action":"Call them about the menu"}}]}', pg_temp.t3980_id('h1')));
  perform pg_temp.t3980_check('W1-CLAIMS', 'agent B''s update to the claimed host is refused as claimed',
    pg_temp.t3980_get(v, 'result', 'results', '0', 'error', 'token'), 'claimed');
  perform pg_temp.t3980_like('W1-CLAIMS', 'naming the holder and since when',
    pg_temp.t3980_get(v, 'result', 'results', '0', 'error', 'message'),
    'Ada''s Claude is working on this host since __:__ UTC. The claim ends at __:__ UTC unless they post an update. Wait, or ask Ada.');
  v := pg_temp.t3980_gw('B', 'move_stage', format('{"moves":[{"id":"%s","to":"replied","expected_from":"contacted"}]}', pg_temp.t3980_id('h1')));
  perform pg_temp.t3980_check('W1-CLAIMS', 'agent B''s stage move on the claimed host is refused',
    pg_temp.t3980_get(v, 'result', 'results', '0', 'error', 'token') || '/' || (select stage from public.crm_records where id = pg_temp.t3980_id('h1')::uuid),
    'claimed/contacted');
  v := pg_temp.t3980_gw('B', 'save_drafts', format('{"drafts":[{"record_id":"%s","channel":"email","body":"Hello from B"}],"request_key":"w3980-b-draft-01"}', pg_temp.t3980_id('h1')));
  perform pg_temp.t3980_check('W1-CLAIMS', 'agent B''s draft for the claimed host is refused and stopped in the log',
    pg_temp.t3980_get(v, 'result', 'results', '0', 'error', 'token') || '/'
      || (select count(*) from public.ops_agent_log where action = 'draft_stopped' and target_id = pg_temp.t3980_id('h1')::uuid and actor_email = 'bo.w3980@test.local')::text,
    'claimed/1');

  update public.ops_claims set last_seen_at = clock_timestamp() - interval '5 minutes' where target_id = pg_temp.t3980_id('h1')::uuid and released_at is null;
  v := pg_temp.t3980_gw('A', 'update_records', format('{"updates":[{"id":"%s","changes":{"next_action":"Send the menu link"}}]}', pg_temp.t3980_id('h1')));
  select last_seen_at into v_seen from public.ops_claims where target_id = pg_temp.t3980_id('h1')::uuid and released_at is null;
  perform pg_temp.t3980_check('W1-CLAIMS', 'the holder''s own write passes and keeps the claim alive',
    pg_temp.t3980_get(v, 'result', 'results', '0', 'status') || '/' || (v_seen > clock_timestamp() - interval '1 minute')::text, 'updated/true');

  v := pg_temp.t3980_person('growth2', format($q$select public.crm_record_update(%L, '{"next_action":"Person changes it anyway"}'::jsonb)::text$q$, pg_temp.t3980_id('h1')));
  perform pg_temp.t3980_check('W1-CLAIMS', 'a person''s change to a claimed host is never refused, and the log says so',
    (v not like 'ERR:%')::text || '/' || (select count(*) from public.ops_agent_log where action = 'person_changed_claimed' and target_id = pg_temp.t3980_id('h1')::uuid and via is null)::text,
    'true/1');

  update public.ops_claims set last_seen_at = clock_timestamp() - interval '31 minutes' where target_id = pg_temp.t3980_id('h1')::uuid and released_at is null;
  v := pg_temp.t3980_gw('B', 'update_records', format('{"updates":[{"id":"%s","changes":{"next_action":"B after the claim ended"}}]}', pg_temp.t3980_id('h1')));
  perform pg_temp.t3980_check('W1-CLAIMS', 'after 30 minutes without an update the claim ends and B''s write passes',
    pg_temp.t3980_get(v, 'result', 'results', '0', 'status') || '/'
      || (select release_reason from public.ops_claims where target_id = pg_temp.t3980_id('h1')::uuid order by claimed_at desc limit 1),
    'updated/expired');

  v := pg_temp.t3980_work('A', 'claim', format('{"card_id":"%s","targets":[{"kind":"crm_record","id":"%s"},{"kind":"crm_record","id":"%s"}]}', pg_temp.t3980_id('c2'), pg_temp.t3980_id('h2'), pg_temp.t3980_id('h3')));
  perform pg_temp.t3980_check('W1-CLAIMS', 'agent A claims a card and two more hosts', pg_temp.t3980_get(v, 'result', 'status'), 'claimed');
  v := pg_temp.t3980_work('B', 'claim', format('{"card_id":"%s","targets":[{"kind":"crm_record","id":"%s"},{"kind":"crm_record","id":"%s"}]}', pg_temp.t3980_id('c1'), pg_temp.t3980_id('h3'), pg_temp.t3980_id('h4')));
  perform pg_temp.t3980_check('W1-CLAIMS', 'claims are all or nothing: B is told what is held and claims nothing',
    pg_temp.t3980_get(v, 'result', 'status') || '/' || pg_temp.t3980_get(v, 'result', 'held', '0', 'holder_name')
      || '/' || (select count(*) from public.ops_claims where target_id = pg_temp.t3980_id('h4')::uuid and released_at is null)::text,
    'held/Ada/0');
  v := pg_temp.t3980_person('growth', format($q$select public.ops_claim(%L, '[]'::jsonb)::text$q$, pg_temp.t3980_id('c1')));
  perform pg_temp.t3980_like('W1-CLAIMS', 'a person is told claims are for agents', v, 'ERR:42501:agent_only:%');
end;
$claims$;

-- ---------------------------------------------------------------------------
-- W1-SEND
-- ---------------------------------------------------------------------------
do $send$
declare v text; v_draft text; v_touches bigint;
begin
  perform pg_temp.t3980_touch(pg_temp.t3980_id('h5')::uuid, interval '2 days');
  perform pg_temp.t3980_touch(pg_temp.t3980_id('h6')::uuid, interval '4 days');
  v := pg_temp.t3980_gw('A', 'save_drafts', format('{"drafts":[{"record_id":"%s","channel":"whatsapp","body":"Following up on the menu"}],"request_key":"w3980-a-draft-01"}', pg_temp.t3980_id('h5')));
  perform pg_temp.t3980_check('W1-SEND', 'a draft to a host messaged 2 days ago is refused',
    pg_temp.t3980_get(v, 'result', 'results', '0', 'error', 'token'), 'recently_messaged');
  perform pg_temp.t3980_like('W1-SEND', 'in plain words with the date it clears',
    pg_temp.t3980_get(v, 'result', 'results', '0', 'error', 'message'),
    'Mingla messaged W3980 Messaged Host on % by WhatsApp, less than 3 days ago. Do not write another message before %. If it really cannot wait, ask your person to allow one more message on the card in Mingla Admin.');
  perform pg_temp.t3980_check('W1-SEND', 'and a stopped entry is in the agent log',
    (select outcome || '/' || action from public.ops_agent_log where target_id = pg_temp.t3980_id('h5')::uuid order by id desc limit 1), 'stopped/draft_stopped');

  v := pg_temp.t3980_gw('A', 'save_drafts', format('{"drafts":[{"record_id":"%s","channel":"whatsapp","body":"Checking in about the night"}],"request_key":"w3980-a-draft-02"}', pg_temp.t3980_id('h6')));
  perform pg_temp.t3980_check('W1-SEND', 'a host messaged 4 days ago can get a draft', pg_temp.t3980_get(v, 'result', 'results', '0', 'status'), 'saved');
  perform pg_temp.t3980_keep('draft6', pg_temp.t3980_get(v, 'result', 'results', '0', 'draft', 'id'));

  v := pg_temp.t3980_gw('B', 'save_drafts', format('{"drafts":[{"record_id":"%s","channel":"email","body":"First message from B"}],"request_key":"w3980-b-draft-02"}', pg_temp.t3980_id('h7')));
  perform pg_temp.t3980_check('W1-SEND', 'B writes the first message to the waiting host', pg_temp.t3980_get(v, 'result', 'results', '0', 'status'), 'saved');
  v := pg_temp.t3980_gw('A', 'save_drafts', format('{"drafts":[{"record_id":"%s","channel":"email","body":"Second message from A"}],"request_key":"w3980-a-draft-03"}', pg_temp.t3980_id('h7')));
  perform pg_temp.t3980_check('W1-SEND', 'a second message while a teammate''s waits is refused',
    pg_temp.t3980_get(v, 'result', 'results', '0', 'error', 'token'), 'draft_waiting');
  perform pg_temp.t3980_like('W1-SEND', 'naming whose message waits',
    pg_temp.t3980_get(v, 'result', 'results', '0', 'error', 'message'), 'A message to W3980 Waiting Host from Bo is already waiting to be sent.%');

  v := pg_temp.t3980_person('growth', format($q$select public.ops_contact_override(%L, 'The host asked for the menu today')::text$q$, pg_temp.t3980_id('h5')));
  perform pg_temp.t3980_check('W1-SEND', 'a person allows one more message for 24 hours',
    ((pg_temp.t3980_j(v) ->> 'expires_at')::timestamptz - now() = interval '24 hours')::text, 'true');
  v := pg_temp.t3980_gw('A', 'save_drafts', format('{"drafts":[{"record_id":"%s","channel":"whatsapp","body":"Here is the menu link"}],"request_key":"w3980-a-draft-04"}', pg_temp.t3980_id('h5')));
  perform pg_temp.t3980_check('W1-SEND', 'after the override the draft saves', pg_temp.t3980_get(v, 'result', 'results', '0', 'status'), 'saved');

  select count(*) into v_touches from public.crm_activity where record_id = pg_temp.t3980_id('h6')::uuid and kind = 'touch' and direction = 'outbound';
  v := pg_temp.t3980_person('growth', format($q$select public.team_draft_mark_sent(%L, 'Checking in about the night')::text$q$, pg_temp.t3980_id('draft6')));
  perform pg_temp.t3980_check('W1-SEND', 'the person marks the draft sent', pg_temp.t3980_get(v, 'changed'), 'true');
  v := pg_temp.t3980_person('growth', format($q$select public.team_draft_mark_sent(%L, 'Checking in about the night')::text$q$, pg_temp.t3980_id('draft6')));
  perform pg_temp.t3980_check('W1-SEND', 'marking it sent again changes nothing and records one touch only',
    pg_temp.t3980_get(v, 'changed') || '/' || ((select count(*) from public.crm_activity where record_id = pg_temp.t3980_id('h6')::uuid and kind = 'touch' and direction = 'outbound') - v_touches)::text,
    'false/1');
end;
$send$;

-- ---------------------------------------------------------------------------
-- W1-CLOSE
-- ---------------------------------------------------------------------------
do $close$
declare v text; v_rev bigint; v_event text;
begin
  v_rev := (select revision from public.ops_work_cards where id = pg_temp.t3980_id('c2')::uuid);
  v := pg_temp.t3980_work('A', 'start_work', format('{"id":"%s","expected_revision":%s}', pg_temp.t3980_id('c2'), v_rev));
  perform pg_temp.t3980_check('W1-CLOSE', 'agent A starts its person''s card, which claims it',
    pg_temp.t3980_get(v, 'result', 'card', 'status') || '/' || pg_temp.t3980_get(v, 'result', 'card', 'claim', 'holder_via'), 'doing/claude');
  v_rev := (pg_temp.t3980_j(v) #>> '{result,card,revision}')::bigint;
  v := pg_temp.t3980_work('A', 'close_work', format('{"id":"%s","expected_revision":%s,"proof":[]}', pg_temp.t3980_id('c2'), v_rev));
  perform pg_temp.t3980_check('W1-CLOSE', 'an agent cannot close without proof', pg_temp.t3980_get(v, 'error', 'token'), 'proof_required');
  v := pg_temp.t3980_work('A', 'close_work', format('{"id":"%s","expected_revision":%s,"proof":[{"kind":"draft","text":"Draft saved for the quiet host","id":"39800000-0000-4000-9999-000000000002"}]}', pg_temp.t3980_id('c2'), v_rev));
  perform pg_temp.t3980_check('W1-CLOSE', 'proof that points to a missing draft is refused', pg_temp.t3980_get(v, 'error', 'token'), 'proof_not_found');
  v := pg_temp.t3980_work('A', 'close_work', format('{"id":"%s","expected_revision":%s,"proof":[{"kind":"draft","text":"Draft saved and sent for the quiet host","id":"%s"}],"result":"The first message went out."}', pg_temp.t3980_id('c2'), v_rev, pg_temp.t3980_id('draft6')));
  perform pg_temp.t3980_check('W1-CLOSE', 'with a real draft the card closes and the proof is checked by Mingla',
    pg_temp.t3980_get(v, 'result', 'card', 'status') || '/' || pg_temp.t3980_get(v, 'result', 'card', 'proof', '0', 'verified')
      || '/' || pg_temp.t3980_get(v, 'result', 'card', 'closed_via'), 'done/true/claude');
  perform pg_temp.t3980_check('W1-CLOSE', 'closing releases the card''s claims',
    (select count(*) from public.ops_claims where card_id = pg_temp.t3980_id('c2')::uuid and released_at is null)::text
      -- [TEST-MOD-APPROVED #3980] D-4: the card itself carries a working mark, not a claim, so two record claims end.
      || '/' || (select count(*) from public.ops_claims where card_id = pg_temp.t3980_id('c2')::uuid and release_reason = 'closed')::text, '0/2');
  perform pg_temp.t3980_check('W1-CLOSE', 'the other owner and the watcher are told it closed',
    (select count(*) from public.team_mentions m where m.source_kind = 'work_card' and m.body_excerpt like 'Ada''s Claude closed: W3980 write the first message%'
       and m.target_user_id in ('39800000-0000-4000-a000-000000000005', '39800000-0000-4000-a000-000000000002'))::text, '2');

  v_rev := (select revision from public.ops_work_cards where id = pg_temp.t3980_id('c1')::uuid);
  v := pg_temp.t3980_work('A', 'push_back', format('{"id":"%s","expected_revision":%s,"kind":"already_done","reason":"The host sent the menu last week already."}', pg_temp.t3980_id('c1'), v_rev));
  perform pg_temp.t3980_check('W1-CLOSE', 'pushing back as already done needs proof', pg_temp.t3980_get(v, 'error', 'token'), 'proof_required');
  v := pg_temp.t3980_work('A', 'push_back', format('{"id":"%s","expected_revision":%s,"kind":"declined","reason":"The host is closed for renovation this month."}', pg_temp.t3980_id('c1'), v_rev));
  perform pg_temp.t3980_check('W1-CLOSE', 'pushing back as not needed closes it as declined',
    pg_temp.t3980_get(v, 'result', 'card', 'status') || '/' || pg_temp.t3980_get(v, 'result', 'card', 'close_kind'), 'done/declined');
  v_rev := (pg_temp.t3980_j(v) #>> '{result,card,revision}')::bigint;
  v := pg_temp.t3980_person('growth', format($q$select public.ops_work_reopen(%L, 'The renovation was cancelled', %s)::text$q$, pg_temp.t3980_id('c1'), v_rev));
  perform pg_temp.t3980_check('W1-CLOSE', 'a person reopens it to To do',
    pg_temp.t3980_get(v, 'card', 'status') || '/' || coalesce(pg_temp.t3980_get(v, 'card', 'close_kind'), 'none'), 'todo/none');

  v_rev := (pg_temp.t3980_j(v) #>> '{card,revision}')::bigint;
  v := pg_temp.t3980_person('growth', format($q$select public.ops_work_update(%L, '{"watchers":["di.w3980@test.local","bo.w3980@test.local"]}'::jsonb, %s)::text$q$, pg_temp.t3980_id('c1'), v_rev));
  v_event := pg_temp.t3980_get(v, 'event_id');
  perform pg_temp.t3980_check('W1-CLOSE', 'adding a watcher is one people change that tells the new watcher',
    jsonb_array_length(pg_temp.t3980_j(v) #> '{card,watchers}')::text || '/'
      || (select count(*) from public.team_mentions where source_kind = 'work_card' and source_id::text = v_event and target_user_id = '39800000-0000-4000-a000-000000000004')::text, '2/1');
  v := pg_temp.t3980_person('growth', format('select public.ops_work_undo(%L)::text', v_event));
  perform pg_temp.t3980_check('W1-CLOSE', 'undo puts the watchers back', jsonb_array_length(pg_temp.t3980_j(v) #> '{card,watchers}')::text, '1');
end;
$close$;

-- ---------------------------------------------------------------------------
-- W1-PEOPLE
-- ---------------------------------------------------------------------------
do $people$
declare v text; v_rev bigint;
begin
  v_rev := (select revision from public.ops_work_cards where id = pg_temp.t3980_id('c3')::uuid);
  v := pg_temp.t3980_agent_sql('growth', 'claude', format($q$select public.ops_work_person_action(%L, 'approve_spend', 'Boost of 20 pounds approved', %s)::text$q$, pg_temp.t3980_id('c3'), v_rev));
  perform pg_temp.t3980_like('W1-PEOPLE', 'an agent cannot approve spend', v, 'ERR:42501:people_only:%');
  v := pg_temp.t3980_agent_sql('growth', 'claude', format($q$select public.ops_work_person_action(%L, 'mark_sent', NULL, %s)::text$q$, pg_temp.t3980_id('c3'), v_rev));
  perform pg_temp.t3980_like('W1-PEOPLE', 'an agent cannot mark sent', v, 'ERR:42501:people_only:%');
  v := pg_temp.t3980_agent_sql('owner', 'claude', format($q$select public.ops_work_archive(%L, 'Not needed any more')::text$q$, pg_temp.t3980_id('c3')));
  perform pg_temp.t3980_like('W1-PEOPLE', 'even the owner''s agent cannot remove a card', v, 'ERR:42501:forbidden:%');
  v := pg_temp.t3980_work('A', 'close_work', format('{"id":"%s","expected_revision":%s,"proof":[{"kind":"text","text":"Approved it myself"}]}', pg_temp.t3980_id('c3'), v_rev));
  perform pg_temp.t3980_check('W1-PEOPLE', 'an agent cannot close a card that needs a person', pg_temp.t3980_get(v, 'error', 'token'), 'people_only');
  v := pg_temp.t3980_work('A', 'close_work', format('{"id":"%s","expected_revision":%s,"proof":[{"kind":"event_public","text":"The event is public","id":"39800000-0000-4000-b400-000000000001"}]}',
    pg_temp.t3980_id('c4'), (select revision from public.ops_work_cards where id = pg_temp.t3980_id('c4')::uuid)));
  perform pg_temp.t3980_check('W1-PEOPLE', 'an agent cannot close a go-live gate card', pg_temp.t3980_get(v, 'error', 'token'), 'gate_card');
  perform pg_temp.t3980_check('W1-PEOPLE', 'and the connector has no tool to send, spend, publish or remove (unknown tool)',
    pg_temp.t3980_get(pg_temp.t3980_work('A', 'approve_spend', '{}'), 'error', 'token'), 'unknown_tool');

  v_rev := (select revision from public.ops_work_cards where id = pg_temp.t3980_id('c3')::uuid);
  v := pg_temp.t3980_person('growth', format($q$select public.ops_work_person_action(%L, 'approve_spend', 'Boost of 20 pounds approved', %s)::text$q$, pg_temp.t3980_id('c3'), v_rev));
  perform pg_temp.t3980_check('W1-PEOPLE', 'a person approves the spend and it closes with their note as proof',
    pg_temp.t3980_get(v, 'card', 'status') || '/' || pg_temp.t3980_get(v, 'card', 'proof', '0', 'text'),
    'done/Spend approved by Ada: Boost of 20 pounds approved');
  perform pg_temp.t3980_check('W1-PEOPLE', 'logged under the person',
    (select actor_email || '/' || coalesce(via, 'person') || '/' || action from public.ops_agent_log where card_id = pg_temp.t3980_id('c3')::uuid order by id desc limit 1),
    'ada.w3980@test.local/person/closed');
  v := pg_temp.t3980_person('owner', format($q$select public.ops_work_close(%L, '[{"kind":"event_public","text":"The night is public on Mingla","id":"39800000-0000-4000-b400-000000000001"}]'::jsonb, NULL, NULL)::text$q$, pg_temp.t3980_id('c4')));
  perform pg_temp.t3980_check('W1-PEOPLE', 'the owner can close the gate card once the event is public',
    pg_temp.t3980_get(v, 'card', 'status') || '/' || pg_temp.t3980_get(v, 'card', 'proof', '0', 'verified'), 'done/true');
  v := pg_temp.t3980_person('owner', format($q$select public.ops_work_archive(%L, 'Test card removed')::text$q$, pg_temp.t3980_id('c3')));
  perform pg_temp.t3980_check('W1-PEOPLE', 'the owner can remove a card', pg_temp.t3980_get(v, 'id'), pg_temp.t3980_id('c3'));
end;
$people$;

-- ---------------------------------------------------------------------------
-- W1-NOTIFY
-- ---------------------------------------------------------------------------
do $notify$
begin
  perform pg_temp.t3980_check('W1-NOTIFY', 'adding the first card told the other owner and the watcher, not the author',
    (select string_agg(p.who, ',' order by p.who) from public.team_mentions m join t3980_people p on p.id = m.target_user_id
      where m.source_kind = 'work_card' and m.deep_link = 'https://admin.usemingla.com/#/work-board?card=' || pg_temp.t3980_id('c1')
        and m.source_id = (select e.id from public.ops_work_events e where e.card_id = pg_temp.t3980_id('c1')::uuid and e.action = 'added')), 'admin,partner');
  perform pg_temp.t3980_check('W1-NOTIFY', 'each notice has an outbox row with no country code',
    ((select count(*) from public.team_mentions m join public.notification_outbox o on o.idempotency_key = 'admin.team_mention:' || m.id::text
      where m.source_kind = 'work_card' and o.category_key = 'admin.team_mention' and o.country_code is null)::text
      = (select count(*) from public.team_mentions where source_kind = 'work_card')::text)::text, 'true');
  perform pg_temp.t3980_check('W1-NOTIFY', 'the actor is never told about their own change',
    (select count(*) from public.team_mentions m where m.source_kind = 'work_card' and m.target_user_id = m.actor_user_id)::text, '0');
end;
$notify$;

-- ---------------------------------------------------------------------------
-- W1-CLOSED
-- ---------------------------------------------------------------------------
do $closed$
declare t text; v text;
begin
  foreach t in array array['ops_sprints','ops_work_cards','ops_work_people','ops_work_links','ops_work_events','ops_agent_log',
                           'ops_claims','ops_contact_overrides','ops_request_keys','ops_expected_events','ops_next_action_conversions'] loop
    perform pg_temp.t3980_like('W1-CLOSED', 'anon cannot read ' || t, pg_temp.t3980_as('anon', format('select count(*)::text from public.%I', t)), 'ERR:42501:%');
    perform pg_temp.t3980_like('W1-CLOSED', 'a teammate cannot read ' || t, pg_temp.t3980_as('growth', format('select count(*)::text from public.%I', t)), 'ERR:42501:%');
    perform pg_temp.t3980_like('W1-CLOSED', 'a teammate cannot delete from ' || t, pg_temp.t3980_as('growth', format('with d as (delete from public.%I returning 1) select count(*)::text from d', t)), 'ERR:42501:%');
    perform pg_temp.t3980_like('W1-CLOSED', 'a teammate cannot update ' || t, pg_temp.t3980_as('growth', format('with d as (update public.%I set created_at = created_at returning 1) select count(*)::text from d', t)), 'ERR:42%');
  end loop;
  perform pg_temp.t3980_like('W1-CLOSED', 'a teammate cannot write a log line', pg_temp.t3980_as('growth',
    $q$with d as (insert into public.ops_agent_log (actor_email, action, outcome, summary) values ('ada.w3980@test.local', 'claimed', 'ok', 'forged') returning 1) select count(*)::text from d$q$), 'ERR:42501:%');
  perform pg_temp.t3980_like('W1-CLOSED', 'even the service cannot change a log line',
    pg_temp.t3980_as('service', $q$with d as (update public.ops_agent_log set summary = 'changed' returning 1) select count(*)::text from d$q$), 'ERR:42501:append_only:%');
  perform pg_temp.t3980_like('W1-CLOSED', 'or remove one',
    pg_temp.t3980_as('service', $q$with d as (delete from public.ops_agent_log returning 1) select count(*)::text from d$q$), 'ERR:42501:append_only:%');
end;
$closed$;

-- ---------------------------------------------------------------------------
-- W1-GUIDE and W1-LIST
-- ---------------------------------------------------------------------------
do $guide$
declare v text;
begin
  v := pg_temp.t3980_gw('A', 'get_started');
  perform pg_temp.t3980_check('W1-GUIDE', 'get_started has 23 rules and 8 routines, one rule about today',
    jsonb_array_length(pg_temp.t3980_j(v) #> '{result,rules}') || '/' || jsonb_array_length(pg_temp.t3980_j(v) #> '{result,routines}') || '/'
      || (select count(*) from jsonb_array_elements_text(pg_temp.t3980_j(v) #> '{result,rules}') r where r like 'Today is your person''s own date.%'),
    '25/9/1');  -- [TEST-MOD-APPROVED #3980] the synced program adds two rules and the log_this_chat routine
  v := pg_temp.t3980_gw('A', 'mcp:tools/list', '{}', 'team_agent_product_truth_call');
  perform pg_temp.t3980_check('W1-LIST', 'tools/list says the Work board is open to this teammate', pg_temp.t3980_get(v, 'me', 'work'), 'true');
  v := pg_temp.t3980_work('A', 'read_log', format('{"record_id":"%s"}', pg_temp.t3980_id('h1')));
  perform pg_temp.t3980_check('W1-LIST', 'read_log returns the record''s entries and the nine work rules',
    -- [TEST-MOD-APPROVED #3980] the synced program's eleven work rules
    (jsonb_array_length(pg_temp.t3980_j(v) #> '{result,entries}') > 0)::text || '/' || jsonb_array_length(pg_temp.t3980_j(v) #> '{result,rules}'), 'true/11');
  v := pg_temp.t3980_work('A', 'my_work', '{}');
  perform pg_temp.t3980_check('W1-LIST', 'my_work lists the person''s open cards',
    (jsonb_array_length(pg_temp.t3980_j(v) #> '{result,mine}') > 0)::text, 'true');
end;
$guide$;

select count(*) as t3980_total, count(*) filter (where not ok) as t3980_failed,
       coalesce(string_agg(test || ' ' || label || ' [' || detail || ']', E'\n' order by seq) filter (where not ok), 'none') as t3980_failures
  from t3980_results \gset
rollback;

select (:t3980_total < 60 or :t3980_failed > 0) as t3980_bad \gset
\if :t3980_bad
  \echo 'ISSUE-3980 WAVE 1 FAILED:' :t3980_failed 'of' :t3980_total
  \echo :t3980_failures
  do $$ begin raise exception 'ISSUE-3980 WAVE 1 FAIL'; end $$;
\endif
\echo 'ISSUE-3980 WAVE 1 PASS:' :t3980_total 'checks, 0 failed'
