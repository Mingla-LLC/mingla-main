-- Issue #3980 -- tester adversarial suite for "people taken off a card are
-- told", from angles the implementor's happy path does not take, on the fully
-- replayed PG17 schema:
--   X-UNDONE    a removal the person undid, followed by a second removal that
--               is more than a day old, never counts as "taken off in the last
--               24 hours" (only the undone change is recent)
--   X-EDGE      the 24-hour window at its edge: 23h55m ago is told, 24h05m
--               ago is not
--   X-SCOPE     someone taken off one card is never told when a different
--               card closes
--   X-CASE      an agent re-sending the same watcher in other letter case
--               takes nobody off and tells nobody
--   X-DEMOTE    an owner an agent moves to watcher was not taken off: no
--               "took you off" notice and only the ordinary close
--   X-LEFT      someone taken off who has since left the team is told
--               nothing, and the close still succeeds
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

create temp table ti_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into ti_people (who, id, email) values
  ('owner',   '39800000-0000-4000-a0ee-000000000001', 'otto.x3980@test.local'),
  ('admin',   '39800000-0000-4000-a0ee-000000000002', 'ada.x3980@test.local'),
  ('growth',  '39800000-0000-4000-a0ee-000000000003', 'gus.x3980@test.local'),
  ('growth2', '39800000-0000-4000-a0ee-000000000004', 'hugo.x3980@test.local'),
  ('growth3', '39800000-0000-4000-a0ee-000000000005', 'ivy.x3980@test.local'),
  ('leaver',  '39800000-0000-4000-a0ee-000000000006', 'lena.x3980@test.local');
insert into auth.users (id, email, email_confirmed_at) select id, email, now() from ti_people;
insert into public.admin_users (email, role, status, accepted_at) values
  ('otto.x3980@test.local', 'owner', 'active', now()),
  ('ada.x3980@test.local', 'admin', 'active', now());
insert into public.admin_team_members (email, role, status, accepted_at) values
  ('gus.x3980@test.local', 'growth', 'active', now()),
  ('hugo.x3980@test.local', 'growth', 'active', now()),
  ('ivy.x3980@test.local', 'growth', 'active', now()),
  ('lena.x3980@test.local', 'growth', 'active', now());

create temp table ti_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;
create temp table ti_ids (k text primary key, v text) on commit drop;

create function pg_temp.ti_as(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text; v_out text;
begin
  if p_who <> 'service' then
    select id, email into strict v_id, v_email from ti_people where who = p_who;
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

create function pg_temp.ti_check(p_test text, p_label text, p_got text, p_want text) returns void
language plpgsql as $fn$
begin
  insert into ti_results (test, label, ok, detail)
  values (p_test, p_label, p_got is not distinct from p_want,
          format('got %s, want %s', coalesce(left(p_got, 600), '<null>'), coalesce(p_want, '<null>')));
end;
$fn$;

create function pg_temp.ti_get(p text, variadic p_path text[]) returns text
language plpgsql as $fn$
begin
  return p::jsonb #>> p_path;
exception when others then
  return p;
end;
$fn$;

create function pg_temp.ti_j(p text) returns jsonb
language plpgsql as $fn$
begin
  return p::jsonb;
exception when others then
  return jsonb_build_object('unreadable', left(p, 300));
end;
$fn$;

create function pg_temp.ti_id(p_k text) returns text
language sql as $fn$ select v from ti_ids where k = p_k $fn$;

create function pg_temp.ti_keep(p_k text, p_v text) returns void
language sql as $fn$ insert into ti_ids (k, v) values (p_k, p_v) on conflict (k) do update set v = excluded.v $fn$;

-- Request rows written so far belong to an earlier, finished request.
create function pg_temp.ti_next_request() returns void
language sql as $fn$
  update public.team_agent_calls set xact_id = '3'::xid8, started_at = started_at - interval '5 minutes' where xact_id <> '3'::xid8
$fn$;

create function pg_temp.ti_person(p_who text, p_sql text) returns text
language plpgsql as $fn$
begin
  perform pg_temp.ti_next_request();
  return pg_temp.ti_as(p_who, p_sql);
end;
$fn$;

create function pg_temp.ti_digest(p text) returns text
language sql as $fn$ select encode(sha256(convert_to(p, 'UTF8')), 'hex') $fn$;

create function pg_temp.ti_newkey(p_who text, p_agent text, p_label text) returns text
language plpgsql as $fn$
declare v text;
begin
  v := pg_temp.ti_person(p_who, format('select public.team_agent_key_create(%L)::text', p_agent));
  if v like 'ERR:%' then return v; end if;
  perform pg_temp.ti_keep(p_label, pg_temp.ti_j(v) ->> 'key');
  return v;
end;
$fn$;

-- One connector call through the work gateway, as team-agent makes it.
create function pg_temp.ti_work(p_label text, p_tool text, p_args text default '{}') returns text
language plpgsql as $fn$
begin
  perform pg_temp.ti_next_request();
  return pg_temp.ti_as('service', format('select public.ops_agent_call(%L, %L, %L::jsonb, %L)::text',
    pg_temp.ti_digest(pg_temp.ti_id(p_label)), p_tool, p_args, 'issue3980-tester/1.0'));
end;
$fn$;

-- A card Gus owns, added by Gus, returning its id.
create function pg_temp.ti_card(p_title text, p_owners text, p_watchers text) returns text
language plpgsql as $fn$
declare v text;
begin
  v := pg_temp.ti_person('growth', format('select public.ops_work_add(%L::jsonb, %L)::text',
    format('[{"title":"%s","instructions":"Do this removal tester task carefully.","done_means":"It is done and checked.","owners":%s,"watchers":%s,"due_on":"%s"}]',
      p_title, p_owners, p_watchers, (now() AT TIME ZONE 'UTC')::date + 7),
    'x3980-' || substr(md5(p_title), 1, 16)));
  return coalesce(pg_temp.ti_get(v, 'results', '0', 'card', 'id'), v);
end;
$fn$;

create function pg_temp.ti_rev(p_card text) returns bigint
language sql as $fn$ select revision from public.ops_work_cards where id = p_card::uuid $fn$;

-- How many work-card notices this person got whose text matches.
create function pg_temp.ti_told(p_who text, p_like text) returns text
language sql as $fn$
  select count(*)::text from public.team_mentions m join ti_people p on p.id = m.target_user_id
   where m.source_kind = 'work_card' and p.who = p_who and m.body_excerpt like p_like
$fn$;

-- Gus closes a card with a line of text proof; returns the status.
create function pg_temp.ti_close(p_card text) returns text
language plpgsql as $fn$
declare v text;
begin
  v := pg_temp.ti_person('growth', format($q$select public.ops_work_close(%L, '[{"kind":"text","text":"Finished and checked by Gus"}]'::jsonb, NULL, %s)::text$q$,
    p_card, pg_temp.ti_rev(p_card)));
  return coalesce(pg_temp.ti_get(v, 'card', 'status'), v);
end;
$fn$;

select pg_temp.ti_newkey('growth', 'claude', 'GC') is not null as k1;

-- X-UNDONE: Gus takes Ada off and undoes it at once (the only recent change
-- that removed her is undone); later Ada is taken off again, but that
-- removal is more than a day old. She is not told the card closed.
do $undone$
declare v text; v_card text; v_event text;
begin
  v_card := pg_temp.ti_card('X3980 Undone removal', '["gus.x3980@test.local"]', '["ada.x3980@test.local","hugo.x3980@test.local"]');
  v := pg_temp.ti_person('growth', format($q$select public.ops_work_update(%L, '{"watchers":["hugo.x3980@test.local"]}'::jsonb, %s)::text$q$, v_card, pg_temp.ti_rev(v_card)));
  v_event := pg_temp.ti_get(v, 'event_id');
  v := pg_temp.ti_person('growth', format('select public.ops_work_undo(%L)::text', v_event));
  perform pg_temp.ti_check('X-UNDONE', 'the removal is undone and Ada is back',
    (select count(*)::text from public.ops_work_people where card_id = v_card::uuid and email = 'ada.x3980@test.local'), '1');
  perform pg_temp.ti_check('X-UNDONE', 'the undone change is marked undone',
    (select (undone_at is not null)::text from public.ops_work_events where id = v_event::uuid), 'true');
  v := pg_temp.ti_person('growth', format($q$select public.ops_work_update(%L, '{"watchers":["hugo.x3980@test.local"]}'::jsonb, %s)::text$q$, v_card, pg_temp.ti_rev(v_card)));
  update public.ops_work_events set at = at - interval '25 hours' where id = (pg_temp.ti_get(v, 'event_id'))::uuid;
  perform pg_temp.ti_check('X-UNDONE', 'Ada is off the card now',
    (select count(*)::text from public.ops_work_people where card_id = v_card::uuid and email = 'ada.x3980@test.local'), '0');
  perform pg_temp.ti_check('X-UNDONE', 'Gus closes the card', pg_temp.ti_close(v_card), 'done');
  perform pg_temp.ti_check('X-UNDONE', 'an undone removal plus an old one tells Ada nothing at close',
    pg_temp.ti_told('admin', '%closed%X3980 Undone removal%') || '/' || pg_temp.ti_told('admin', '%taken off in the last 24 hours: X3980 Undone removal%'), '0/0');
  perform pg_temp.ti_check('X-UNDONE', 'Hugo, still on, hears the ordinary close',
    pg_temp.ti_told('growth2', '%closed: X3980 Undone removal%'), '1');
end;
$undone$;

-- X-EDGE: one person taken off 23h55m ago, another 24h05m ago.
do $edge$
declare v text; v_card text;
begin
  v_card := pg_temp.ti_card('X3980 Window edge', '["gus.x3980@test.local"]', '["ada.x3980@test.local","hugo.x3980@test.local","ivy.x3980@test.local"]');
  v := pg_temp.ti_person('growth', format($q$select public.ops_work_update(%L, '{"watchers":["hugo.x3980@test.local","ivy.x3980@test.local"]}'::jsonb, %s)::text$q$, v_card, pg_temp.ti_rev(v_card)));
  update public.ops_work_events set at = clock_timestamp() - interval '23 hours 55 minutes' where id = (pg_temp.ti_get(v, 'event_id'))::uuid;
  v := pg_temp.ti_person('growth', format($q$select public.ops_work_update(%L, '{"watchers":["ivy.x3980@test.local"]}'::jsonb, %s)::text$q$, v_card, pg_temp.ti_rev(v_card)));
  update public.ops_work_events set at = clock_timestamp() - interval '24 hours 5 minutes' where id = (pg_temp.ti_get(v, 'event_id'))::uuid;
  perform pg_temp.ti_check('X-EDGE', 'Gus closes the card', pg_temp.ti_close(v_card), 'done');
  perform pg_temp.ti_check('X-EDGE', 'taken off 23h55m ago: told it closed',
    pg_temp.ti_told('admin', '%taken off in the last 24 hours: X3980 Window edge%'), '1');
  perform pg_temp.ti_check('X-EDGE', 'taken off 24h05m ago: not told',
    pg_temp.ti_told('growth2', '%closed%X3980 Window edge%') || '/' || pg_temp.ti_told('growth2', '%taken off in the last 24 hours: X3980 Window edge%'), '0/0');
end;
$edge$;

-- X-SCOPE: Hugo is taken off card A today. Card B, where Hugo never was,
-- closes: Hugo hears nothing about B. Card A closes: he hears about A once.
do $scope$
declare v text; v_a text; v_b text;
begin
  v_a := pg_temp.ti_card('X3980 Scope card A', '["gus.x3980@test.local"]', '["hugo.x3980@test.local"]');
  v_b := pg_temp.ti_card('X3980 Scope card B', '["gus.x3980@test.local"]', '["ivy.x3980@test.local"]');
  v := pg_temp.ti_work('GC', 'update_work', format('{"id":"%s","expected_revision":%s,"changes":{"watchers":[]}}', v_a, pg_temp.ti_rev(v_a)));
  perform pg_temp.ti_check('X-SCOPE', 'the agent takes Hugo off card A and tells him',
    pg_temp.ti_told('growth2', '%took you off this card: X3980 Scope card A%'), '1');
  perform pg_temp.ti_check('X-SCOPE', 'Gus closes card B', pg_temp.ti_close(v_b), 'done');
  perform pg_temp.ti_check('X-SCOPE', 'Hugo is told nothing about card B',
    pg_temp.ti_told('growth2', '%X3980 Scope card B%'), '0');
  perform pg_temp.ti_check('X-SCOPE', 'Gus closes card A', pg_temp.ti_close(v_a), 'done');
  perform pg_temp.ti_check('X-SCOPE', 'Hugo is told card A closed, once',
    pg_temp.ti_told('growth2', '%taken off in the last 24 hours: X3980 Scope card A%'), '1');
end;
$scope$;

-- X-CASE and X-DEMOTE: the agent re-sends Ada in capitals, then moves Hugo
-- from owner to watcher. Nobody was taken off.
do $case$
declare v text; v_card text;
begin
  v_card := pg_temp.ti_card('X3980 Same people', '["gus.x3980@test.local","hugo.x3980@test.local"]', '["ada.x3980@test.local"]');
  v := pg_temp.ti_work('GC', 'update_work', format('{"id":"%s","expected_revision":%s,"changes":{"watchers":["ADA.X3980@TEST.LOCAL"]}}', v_card, pg_temp.ti_rev(v_card)));
  perform pg_temp.ti_check('X-CASE', 'Ada is still a watcher, stored once in lower case',
    (select string_agg(email || ':' || role, ',' order by email) from public.ops_work_people where card_id = v_card::uuid and lower(email) like 'ada.%'),
    'ada.x3980@test.local:watcher');
  perform pg_temp.ti_check('X-CASE', 'Ada is not told she was taken off',
    pg_temp.ti_told('admin', '%took you off this card: X3980 Same people%'), '0');
  v := pg_temp.ti_work('GC', 'update_work', format('{"id":"%s","expected_revision":%s,"changes":{"owners":["gus.x3980@test.local"],"watchers":["ada.x3980@test.local","hugo.x3980@test.local"]}}', v_card, pg_temp.ti_rev(v_card)));
  perform pg_temp.ti_check('X-DEMOTE', 'Hugo is now a watcher',
    (select role from public.ops_work_people where card_id = v_card::uuid and email = 'hugo.x3980@test.local'), 'watcher');
  perform pg_temp.ti_check('X-DEMOTE', 'Hugo is not told he was taken off',
    pg_temp.ti_told('growth2', '%took you off this card: X3980 Same people%'), '0');
  perform pg_temp.ti_check('X-DEMOTE', 'Gus closes the card', pg_temp.ti_close(v_card), 'done');
  perform pg_temp.ti_check('X-DEMOTE', 'Ada and Hugo hear the ordinary close only',
    pg_temp.ti_told('admin', '%closed: X3980 Same people%') || '/' || pg_temp.ti_told('growth2', '%closed: X3980 Same people%') || '/' ||
    (select count(*)::text from public.team_mentions m join ti_people p on p.id = m.target_user_id
      where p.who in ('admin', 'growth2') and m.body_excerpt like '%taken off in the last 24 hours: X3980 Same people%'), '1/1/0');
end;
$case$;

-- X-LEFT: Lena is taken off by the agent, then leaves the team. The close
-- succeeds and Lena is told nothing about it.
do $left$
declare v text; v_card text;
begin
  v_card := pg_temp.ti_card('X3980 Leaver taken off', '["gus.x3980@test.local"]', '["lena.x3980@test.local"]');
  v := pg_temp.ti_work('GC', 'update_work', format('{"id":"%s","expected_revision":%s,"changes":{"watchers":[]}}', v_card, pg_temp.ti_rev(v_card)));
  perform pg_temp.ti_check('X-LEFT', 'Lena is told she was taken off while still on the team',
    pg_temp.ti_told('leaver', '%took you off this card: X3980 Leaver taken off%'), '1');
  update public.admin_team_members set status = 'revoked' where email = 'lena.x3980@test.local';
  perform pg_temp.ti_check('X-LEFT', 'Gus closes the card', pg_temp.ti_close(v_card), 'done');
  perform pg_temp.ti_check('X-LEFT', 'Lena, gone from the team, is told nothing at close',
    pg_temp.ti_told('leaver', '%closed%X3980 Leaver taken off%') || '/' || pg_temp.ti_told('leaver', '%taken off in the last 24 hours: X3980 Leaver taken off%'), '0/0');
end;
$left$;

select count(*) as ti_total, count(*) filter (where not ok) as ti_failed,
       coalesce(string_agg(test || ' ' || label || ' [' || detail || ']', E'\n' order by seq) filter (where not ok), 'none') as ti_failures
  from ti_results \gset
rollback;

select (:ti_total < 23 or :ti_failed > 0) as ti_bad \gset
\if :ti_bad
  \echo 'ISSUE-3980 TESTER REMOVED PEOPLE FAILED:' :ti_failed 'of' :ti_total
  \echo :ti_failures
  do $$ begin raise exception 'ISSUE-3980 TESTER REMOVED PEOPLE FAIL'; end $$;
\endif
\echo 'ISSUE-3980 TESTER REMOVED PEOPLE PASS:' :ti_total 'checks, 0 failed'
