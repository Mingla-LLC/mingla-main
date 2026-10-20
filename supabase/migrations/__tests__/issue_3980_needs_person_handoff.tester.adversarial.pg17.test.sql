-- Issue #3980 -- independent tester, adversarial: handing a card to a person
-- part way through. The connector tells an agent "to hand a step to a person,
-- set status person with the reason send, spend, publish or other, and stop",
-- and the agent rules say the same. This suite asks for exactly that, through
-- the work gateway with a real key and from a person's browser session, on
-- the fully replayed PG17 schema.
--
-- What it proves (each check is recorded and reported together):
--   X-HANDOFF  an agent on a card its person owns can set it to Needs a
--              person with each reason; the card then waits in To review,
--              the agent log says it needs a person, and its owners and
--              watchers (not the actor) are told; a person can do the same
--              from the board; a reason outside the four is still refused
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

create temp table tz_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into tz_people (who, id, email) values
  ('owner',   '39800000-0000-4000-a0cc-000000000001', 'oona.z3980@test.local'),
  ('admin',   '39800000-0000-4000-a0cc-000000000002', 'abe.z3980@test.local'),
  ('growth',  '39800000-0000-4000-a0cc-000000000003', 'gia.z3980@test.local'),
  ('growth2', '39800000-0000-4000-a0cc-000000000004', 'hal.z3980@test.local'),
  ('partner', '39800000-0000-4000-a0cc-000000000005', 'pia.z3980@test.local'),
  ('leaver',  '39800000-0000-4000-a0cc-000000000006', 'lou.z3980@test.local'),
  ('nobody',  '39800000-0000-4000-a0cc-000000000007', 'ned.z3980@test.local');
insert into auth.users (id, email, email_confirmed_at) select id, email, now() from tz_people;
insert into public.admin_users (email, role, status, accepted_at) values
  ('oona.z3980@test.local', 'owner', 'active', now()),
  ('abe.z3980@test.local', 'admin', 'active', now());
insert into public.admin_team_members (email, role, status, accepted_at) values
  ('gia.z3980@test.local', 'growth', 'active', now()),
  ('hal.z3980@test.local', 'growth', 'active', now()),
  ('pia.z3980@test.local', 'partner', 'active', now()),
  ('lou.z3980@test.local', 'growth', 'revoked', now());

-- One event 40 days out, public, for anchored cards.
set local session_replication_role = replica;
insert into public.brands (id, account_id, name, slug, city) values
  ('39800000-0000-4000-b1cc-000000000001', '39800000-0000-4000-b3cc-000000000001', 'Z3980 Guard Brand', 'z3980-guard-brand', 'Lagos');
insert into public.events (id, brand_id, title, slug, visibility, status, timezone, published_at, event_type) values
  ('39800000-0000-4000-b4cc-000000000001', '39800000-0000-4000-b1cc-000000000001', 'Z3980 Guard Night', 'z3980-guard-night', 'discover', 'scheduled', 'UTC', now() - interval '1 day', 'event');
insert into public.event_dates (event_id, start_at, end_at, is_master) values
  ('39800000-0000-4000-b4cc-000000000001', date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' + interval '40 days 20 hours',
   date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' + interval '40 days 23 hours', true);
set local session_replication_role = origin;

create temp table tz_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;
create temp table tz_ids (k text primary key, v text) on commit drop;

create function pg_temp.tz_as(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text; v_out text;
begin
  if p_who <> 'service' then
    select id, email into strict v_id, v_email from tz_people where who = p_who;
  end if;
  begin
    if p_who = 'service' then
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

create function pg_temp.tz_check(p_test text, p_label text, p_got text, p_want text) returns void
language plpgsql as $fn$
begin
  insert into tz_results (test, label, ok, detail)
  values (p_test, p_label, p_got is not distinct from p_want,
          format('got %s, want %s', coalesce(left(p_got, 600), '<null>'), coalesce(p_want, '<null>')));
end;
$fn$;

create function pg_temp.tz_like(p_test text, p_label text, p_got text, p_pattern text) returns void
language plpgsql as $fn$
begin
  insert into tz_results (test, label, ok, detail)
  values (p_test, p_label, coalesce(p_got like p_pattern, false),
          format('got %s, want like %s', coalesce(left(p_got, 600), '<null>'), p_pattern));
end;
$fn$;

create function pg_temp.tz_get(p text, variadic p_path text[]) returns text
language plpgsql as $fn$
begin
  return p::jsonb #>> p_path;
exception when others then
  return p;
end;
$fn$;

create function pg_temp.tz_j(p text) returns jsonb
language plpgsql as $fn$
begin
  return p::jsonb;
exception when others then
  return jsonb_build_object('unreadable', left(p, 300));
end;
$fn$;

create function pg_temp.tz_id(p_k text) returns text
language sql as $fn$ select v from tz_ids where k = p_k $fn$;

create function pg_temp.tz_keep(p_k text, p_v text) returns void
language sql as $fn$ insert into tz_ids (k, v) values (p_k, p_v) on conflict (k) do update set v = excluded.v $fn$;

-- Request rows written so far belong to an earlier, finished request.
create function pg_temp.tz_next_request() returns void
language sql as $fn$
  update public.team_agent_calls set xact_id = '3'::xid8, started_at = started_at - interval '5 minutes' where xact_id <> '3'::xid8
$fn$;

create function pg_temp.tz_person(p_who text, p_sql text) returns text
language plpgsql as $fn$
begin
  perform pg_temp.tz_next_request();
  return pg_temp.tz_as(p_who, p_sql);
end;
$fn$;

-- A connected agent calling a function directly, as the gateway does: the
-- request row first, in this transaction, then the call.
create function pg_temp.tz_agent_sql(p_who text, p_agent text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text;
begin
  perform pg_temp.tz_next_request();
  select id, email into strict v_id, v_email from tz_people where who = p_who;
  insert into public.team_agent_calls (key_id, owner_email, actor_uid, agent, tool, xact_id, started_at)
  values (gen_random_uuid(), v_email, v_id, p_agent, 'save_drafts', pg_current_xact_id(), clock_timestamp());
  return pg_temp.tz_as(p_who, p_sql);
end;
$fn$;

create function pg_temp.tz_digest(p text) returns text
language sql as $fn$ select encode(sha256(convert_to(p, 'UTF8')), 'hex') $fn$;

create function pg_temp.tz_newkey(p_who text, p_agent text, p_label text) returns text
language plpgsql as $fn$
declare v text;
begin
  v := pg_temp.tz_person(p_who, format('select public.team_agent_key_create(%L)::text', p_agent));
  if v like 'ERR:%' then return v; end if;
  perform pg_temp.tz_keep(p_label, pg_temp.tz_j(v) ->> 'key');
  return v;
end;
$fn$;

create function pg_temp.tz_gw(p_label text, p_tool text, p_args text default '{}', p_gateway text default 'team_agent_call') returns text
language plpgsql as $fn$
begin
  perform pg_temp.tz_next_request();
  return pg_temp.tz_as('service', format('select public.%s(%L, %L, %L::jsonb, %L)::text', p_gateway,
    pg_temp.tz_digest(pg_temp.tz_id(p_label)), p_tool, p_args, 'issue3980-tester/1.0'));
end;
$fn$;

create function pg_temp.tz_work(p_label text, p_tool text, p_args text default '{}') returns text
language sql as $fn$ select pg_temp.tz_gw(p_label, p_tool, p_args, 'ops_agent_call') $fn$;

create function pg_temp.tz_rec(p_name text) returns uuid
language plpgsql as $fn$
declare v_id uuid;
begin
  insert into public.crm_records (pipeline, name, stage, created_by, updated_by)
  values ('hosts', p_name, 'contacted', 'z3980-fixture', 'z3980-fixture') returning id into v_id;
  return v_id;
end;
$fn$;

create function pg_temp.tz_touch(p_record uuid, p_ago interval, p_direction text default 'outbound') returns void
language sql as $fn$
  insert into public.crm_activity (record_id, kind, actor_email, channel, direction, body, occurred_at)
  values (p_record, 'touch', 'gia.z3980@test.local', 'email', p_direction, 'Fixture message', now() - p_ago)
$fn$;

-- The draft result of one save_drafts call: "saved" or the refusal token.
create function pg_temp.tz_draft(p_label text, p_record text, p_key text) returns text
language plpgsql as $fn$
declare v text;
begin
  v := pg_temp.tz_gw(p_label, 'save_drafts', format('{"drafts":[{"record_id":"%s","channel":"email","body":"Hello again about the night"}],"request_key":"%s"}', p_record, p_key));
  return coalesce(pg_temp.tz_get(v, 'result', 'results', '0', 'error', 'token'), pg_temp.tz_get(v, 'result', 'results', '0', 'status'), v);
end;
$fn$;

-- A card the given person owns, added by that person, returning its id.
create function pg_temp.tz_card(p_who text, p_title text, p_owners text, p_watchers text default '[]', p_extra text default '') returns text
language plpgsql as $fn$
declare v text;
begin
  v := pg_temp.tz_person(p_who, format('select public.ops_work_add(%L::jsonb, %L)::text',
    format('[{"title":"%s","instructions":"Do this adversarial tester task carefully.","done_means":"It is done and checked.","owners":%s,"watchers":%s,"due_on":"%s"%s}]',
      p_title, p_owners, p_watchers, (now() AT TIME ZONE 'UTC')::date + 7, p_extra),
    'z3980-' || substr(md5(p_title), 1, 16)));
  return coalesce(pg_temp.tz_get(v, 'results', '0', 'card', 'id'), v);
end;
$fn$;

create function pg_temp.tz_rev(p_card text) returns bigint
language sql as $fn$ select revision from public.ops_work_cards where id = p_card::uuid $fn$;

-- A giveaway and ads card held for go-live, owned by one person. Written
-- directly: the launch kit makes these, one per event, and this suite needs
-- several on the same event.
create function pg_temp.tz_promo(p_owner text, p_title text) returns text
language plpgsql as $fn$
declare v_id uuid;
begin
  insert into public.ops_work_cards (title, instructions, done_means, status, blocked, blocked_kind, blocked_reason, kind,
    anchor_kind, anchor_id, due_on, due_source, sprint_id, created_by, updated_by)
  values (p_title, 'Open the giveaway and get the ads plan approved.', 'The giveaway is open.', 'todo', true, 'organic_only',
    'Organic only: tester fixture.', 'promo', 'event', '39800000-0000-4000-b4cc-000000000001', (now() AT TIME ZONE 'UTC')::date + 19, 'explicit',
    public.ops_sprint_ensure((now() AT TIME ZONE 'UTC')::date + 19), p_owner, p_owner)
  returning id into v_id;
  insert into public.ops_work_people (card_id, email, role, added_by) values (v_id, p_owner, 'owner', p_owner);
  return v_id::text;
end;
$fn$;

select pg_temp.tz_newkey('growth', 'claude', 'GC') is not null as k1;

do $handoff$
declare v text; r text; v_card text;
begin
  foreach r in array array['send','spend','publish','other'] loop
    v_card := pg_temp.tz_card('growth', 'Z3980 Hand to a person ' || r, '["gia.z3980@test.local"]', '["abe.z3980@test.local"]');
    v := pg_temp.tz_work('GC', 'update_work', format('{"id":"%s","expected_revision":%s,"changes":{"status":"person","person_reason":"%s"}}', v_card, pg_temp.tz_rev(v_card), r));
    perform pg_temp.tz_check('X-HANDOFF', 'an agent hands its card to a person with the reason ' || r,
      coalesce(pg_temp.tz_get(v, 'result', 'card', 'status') || '/' || pg_temp.tz_get(v, 'result', 'card', 'person_reason'), pg_temp.tz_get(v, 'error', 'message')),
      'person/' || r);
    perform pg_temp.tz_check('X-HANDOFF', 'the agent log says card ' || r || ' needs a person',
      (select count(*) from public.ops_agent_log where card_id = v_card::uuid and action = 'needs_person')::text, '1');
    perform pg_temp.tz_check('X-HANDOFF', 'the watcher is told about card ' || r || ', the acting person is not',
      (select count(*) from public.team_mentions m join tz_people p on p.id = m.target_user_id
        where m.source_kind = 'work_card' and p.who = 'admin' and m.body_excerpt like '%needs a person%' and m.body_excerpt like '%' || r || '%')::text
      || '/' || (select count(*) from public.team_mentions m join tz_people p on p.id = m.target_user_id
        where m.source_kind = 'work_card' and p.who = 'growth' and m.body_excerpt like '%Z3980 Hand to a person ' || r || '%needs a person%')::text,
      '1/0');
  end loop;
  v := pg_temp.tz_person('admin', 'select public.ops_review_list()::text');
  perform pg_temp.tz_check('X-HANDOFF', 'the spend, publish and other cards wait in To review',
    (select string_agg(c->>'person_reason', ',' order by c->>'person_reason') from jsonb_array_elements(pg_temp.tz_j(v)->'cards') c where c->>'title' like 'Z3980 Hand to a person%'),
    'other,publish,spend');

  v_card := pg_temp.tz_card('growth2', 'Z3980 Person hands it over', '["hal.z3980@test.local"]');
  v := pg_temp.tz_person('growth2', format($q$select public.ops_work_update(%L, '{"status":"person","person_reason":"publish"}'::jsonb, %s)::text$q$, v_card, pg_temp.tz_rev(v_card)));
  perform pg_temp.tz_check('X-HANDOFF', 'a person can set Needs a person from the board',
    coalesce(pg_temp.tz_get(v, 'card', 'status') || '/' || pg_temp.tz_get(v, 'card', 'person_reason'), v), 'person/publish');

  v_card := pg_temp.tz_card('growth', 'Z3980 Bad reason', '["gia.z3980@test.local"]');
  v := pg_temp.tz_work('GC', 'update_work', format('{"id":"%s","expected_revision":%s,"changes":{"status":"person","person_reason":"approve"}}', v_card, pg_temp.tz_rev(v_card)));
  perform pg_temp.tz_check('X-HANDOFF', 'a reason outside send, spend, publish and other is refused', pg_temp.tz_get(v, 'error', 'token'), 'invalid_card');
end;
$handoff$;

select count(*) as tz_total, count(*) filter (where not ok) as tz_failed,
       coalesce(string_agg(test || ' ' || label || ' [' || detail || ']', E'\n' order by seq) filter (where not ok), 'none') as tz_failures
  from tz_results \gset
rollback;

select (:tz_total < 14 or :tz_failed > 0) as tz_bad \gset
\if :tz_bad
  \echo 'ISSUE-3980 TESTER HANDOFF FAILED:' :tz_failed 'of' :tz_total
  \echo :tz_failures
  do $$ begin raise exception 'ISSUE-3980 TESTER HANDOFF FAIL'; end $$;
\endif
\echo 'ISSUE-3980 TESTER HANDOFF PASS:' :tz_total 'checks, 0 failed'
