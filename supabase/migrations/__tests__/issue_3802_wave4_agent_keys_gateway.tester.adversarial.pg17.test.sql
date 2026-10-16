-- Issue #3802 (Wave 4, first part) — independent tester suite for personal
-- agent keys and the gateway (PostgreSQL 17).
--
-- A different angle from the implementor suite: that one walks each rule
-- once; this one tries to make the rules disagree with each other.
--
--   TA-1  a key replacement is all-or-nothing: a replacement that is undone
--         leaves the old key working and the new one unknown
--   TA-2  "via" belongs to one person in one transaction: a request row for
--         one person never marks another person's work in that same
--         transaction, and the latest request for a person wins
--   TA-3  limit arithmetic at the edges: the last allowed request, the first
--         refused one, refused requests never extending the wait, the daily
--         count ignoring yesterday and the connection's own housekeeping,
--         and one key's count never touching another key
--   TA-4  the agent reads exactly what the same person reads on screen: the
--         same records for every filter, every record exactly once across
--         pages when many share one timestamp, never a deleted record by
--         any route, and never a beta lead's phone number
--   TA-5  a key is nowhere: not in any row of any table this feature
--         writes, not in any answer of any function, to anyone; a digest is
--         never returned either
--   TA-6  nothing else can reach the two tables: no view, no publication,
--         no policy, no function outside the named ones, no client privilege
--   TA-7  removing a person ends every active key they hold and rewrites no
--         history; a role change, an invitation and a refused removal leave
--         every key row byte for byte as it was
--   TA-8  an account that can sign in another way is refused at the next
--         request, whatever its role, except the owner's own
--
-- ONE transaction, rolled back. Never run on production.
--
-- Runs as the image's admin role from the repository root, like the other
-- #3802 suites. The bare CI image ships an auth.users without
-- email_confirmed_at or phone and has no auth.identities; this suite adds
-- them inside its own rolled-back transaction.
--
-- Every request here shares one transaction id, so t3802ta_next() stands
-- for "the request ended": it gives the request rows written so far an old
-- transaction id, which is what a committed row from an earlier request
-- looks like. Checks are RECORDED and reported together.

\set ON_ERROR_STOP on

begin;

alter table auth.users add column if not exists email_confirmed_at timestamptz;
alter table auth.users add column if not exists phone text;
create table if not exists auth.identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  provider text not null,
  identity_data jsonb
);

create temp table t3802ta_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into t3802ta_people (who, id, email) values
  ('owner',   '38020000-0000-4000-f000-000000000001', 'issue3802ta-owner@test.local'),
  ('admin',   '38020000-0000-4000-f000-000000000002', 'issue3802ta-admin@test.local'),
  ('growth',  '38020000-0000-4000-f000-000000000003', 'issue3802ta-growth@test.local'),
  ('partner', '38020000-0000-4000-f000-000000000004', 'issue3802ta-partner@test.local'),
  ('leaver',  '38020000-0000-4000-f000-000000000005', 'issue3802ta-leaver@test.local'),
  ('mover',   '38020000-0000-4000-f000-000000000006', 'issue3802ta-mover@test.local');

insert into auth.users (id, email, email_confirmed_at) select id, email, now() from t3802ta_people;
insert into public.admin_users (email, role, status, accepted_at) values
  ('issue3802ta-owner@test.local', 'owner', 'active', now()),
  ('issue3802ta-admin@test.local', 'admin', 'active', now());
insert into public.admin_team_members (email, role, status, accepted_at)
select email, case who when 'partner' then 'partner' else 'growth' end, 'active', now()
from t3802ta_people where who in ('growth', 'partner', 'leaver', 'mover');

set local session_replication_role = replica;
insert into public.seeding_cities (id, google_place_id, name, country, country_code, center_lat, center_lng,
                                   bbox_sw_lat, bbox_sw_lng, bbox_ne_lat, bbox_ne_lng, is_live_for_consumers) values
  ('38020000-0000-4000-f200-000000000001', 'issue3802ta-one', 'Issue3802ta One', 'Nigeria', 'NG', 6.5, 3.4, 6.4, 3.3, 6.6, 3.5, true),
  ('38020000-0000-4000-f200-000000000002', 'issue3802ta-two', 'Issue3802ta Two', 'United States', 'US', 35.9, -78.9, 35.8, -79.0, 36.0, -78.8, false);
insert into public.beta_access_leads (id, brand_type, brand_name, contact_name, city, email, phone, consent, source) values
  ('38020000-0000-4000-f400-000000000001', array['restaurant'], 'Issue3802ta Lead', 'Lead Person', 'Nowhere',
   'issue3802ta-lead@test.local', '+15550003802', true, 'organiser_marketing');

-- Forty hosts written straight into the table, so that many share ONE
-- timestamp (paging must still return each exactly once), five are deleted,
-- and due dates sit on both sides of today.
insert into public.crm_records (id, pipeline, name, stage, icp, region_id, due_on, created_by, updated_by,
                                created_at, updated_at, deleted_at, deleted_by)
select ('38020000-0000-4000-f500-' || lpad(g::text, 12, '0'))::uuid,
       'hosts',
       'Issue3802ta Host ' || lpad(g::text, 2, '0'),
       case g % 4 when 0 then 'prospect' when 1 then 'contacted' when 2 then 'replied' else 'meeting' end,
       case g % 3 when 0 then 'restaurant_bar' when 1 then 'venue_gallery' else null end,
       case g % 3 when 0 then '38020000-0000-4000-f200-000000000001'::uuid
                  when 1 then '38020000-0000-4000-f200-000000000002'::uuid else null end,
       case g % 5 when 0 then null
                  when 1 then (now() at time zone 'UTC')::date - 2
                  when 2 then (now() at time zone 'UTC')::date
                  when 3 then (now() at time zone 'UTC')::date + 1
                  else (now() at time zone 'UTC')::date + 30 end,
       'issue3802ta-growth@test.local', 'issue3802ta-growth@test.local',
       now() - interval '1 day',
       case when g <= 30 then date_trunc('second', now()) - interval '1 hour'
            else date_trunc('second', now()) - make_interval(mins => g) end,
       case when g % 7 = 0 then now() end,
       case when g % 7 = 0 then 'issue3802ta-admin@test.local' end
from generate_series(1, 40) g;
insert into public.crm_record_owners (record_id, owner_email, added_by)
select r.id, case when right(r.name, 2)::int % 2 = 0 then 'issue3802ta-growth@test.local' else 'issue3802ta-partner@test.local' end,
       'issue3802ta-admin@test.local'
from public.crm_records r where r.name like 'Issue3802ta Host %' and right(r.name, 2)::int % 6 <> 0;
insert into public.crm_activity (record_id, kind, actor_email, body, channel, direction, occurred_at)
select r.id, 'touch', 'issue3802ta-growth@test.local', 'hello from them', 'email',
       case when right(r.name, 2)::int % 4 = 0 then 'inbound' else 'outbound' end, now() - interval '2 hours'
from public.crm_records r where r.name like 'Issue3802ta Host %' and right(r.name, 2)::int % 2 = 0;
set local session_replication_role = origin;

create temp table t3802ta_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;
create temp table t3802ta_ids (k text primary key, v text) on commit drop;

create function pg_temp.t3802ta_ok(p_test text, p_label text, p_ok boolean, p_detail text default '') returns void
language sql as $fn$
  insert into t3802ta_results (test, label, ok, detail) values (p_test, p_label, coalesce(p_ok, false), left(coalesce(p_detail, ''), 400))
$fn$;

create function pg_temp.t3802ta_id(p_k text) returns text
language sql as $fn$ select v from t3802ta_ids where k = p_k $fn$;

create function pg_temp.t3802ta_digest(p_key text) returns text
language sql as $fn$ select encode(sha256(convert_to(p_key, 'UTF8')), 'hex') $fn$;

-- "The request ended."
create function pg_temp.t3802ta_next() returns void
language sql as $fn$ update public.team_agent_calls set xact_id = '3'::xid8 where xact_id <> '3'::xid8 $fn$;

-- One statement as a caller; its single text result, or 'ERR:<sqlstate>:<message>'.
-- A browser or anonymous statement is always a request of its own, so any
-- agent request before it has ended. The server role continues the request
-- it is in (t3802ta_gw decides when a new one starts).
create function pg_temp.t3802ta_as(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare
  v_id uuid;
  v_email text;
  v_out text;
begin
  if p_who <> 'service' then
    perform pg_temp.t3802ta_next();
  end if;
  if p_who not in ('anon', 'service') then
    select id, email into strict v_id, v_email from t3802ta_people where who = p_who;
  end if;
  begin
    if p_who = 'anon' then
      set local role anon;
      perform set_config('request.jwt.claim.sub', '', true);
      perform set_config('request.jwt.claim.email', '', true);
      perform set_config('request.jwt.claim.role', '', true);
      perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    elsif p_who = 'service' then
      set local role service_role;
      perform set_config('request.jwt.claim.sub', '', true);
      perform set_config('request.jwt.claim.email', '', true);
      perform set_config('request.jwt.claim.role', '', true);
      perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
    else
      set local role authenticated;
      perform set_config('request.jwt.claim.sub', v_id::text, true);
      perform set_config('request.jwt.claim.email', v_email, true);
      perform set_config('request.jwt.claim.role', '', true);
      perform set_config('request.jwt.claims',
        json_build_object('sub', v_id, 'email', v_email, 'role', 'authenticated')::text, true);
    end if;
    execute p_sql into v_out;
    reset role;
    return v_out;
  exception when others then
    reset role;
    return 'ERR:' || sqlstate || ':' || sqlerrm;
  end;
end;
$fn$;

-- A key made in a browser session, remembered under a label.
create function pg_temp.t3802ta_newkey(p_who text, p_agent text, p_label text) returns text
language plpgsql as $fn$
declare
  v text;
begin
  perform pg_temp.t3802ta_next();
  v := pg_temp.t3802ta_as(p_who, format('select public.team_agent_key_create(%L)::text', p_agent));
  if v like 'ERR:%' then
    return v;
  end if;
  insert into t3802ta_ids (k, v) values (p_label, v::jsonb ->> 'key'), (p_label || '.id', v::jsonb ->> 'key_id')
  on conflict (k) do update set v = excluded.v;
  return v;
end;
$fn$;

-- One agent request, the way the connector makes it. p_fresh = false keeps
-- it inside the request before it (the same transaction id).
create function pg_temp.t3802ta_gw(p_label text, p_tool text, p_args text default '{}', p_fresh boolean default true) returns text
language plpgsql as $fn$
begin
  if p_fresh then
    perform pg_temp.t3802ta_next();
  end if;
  return pg_temp.t3802ta_as('service', format('select public.team_agent_call(%L, %L, %L::jsonb, %L)::text',
    pg_temp.t3802ta_digest(pg_temp.t3802ta_id(p_label)), p_tool, p_args, 'issue3802ta-client/1.0'));
end;
$fn$;

select pg_temp.t3802ta_newkey('owner', 'claude', 'owner.claude') is not null as made;
select pg_temp.t3802ta_newkey('owner', 'codex', 'owner.codex') is not null as made;
select pg_temp.t3802ta_newkey('admin', 'claude', 'admin.claude') is not null as made;
select pg_temp.t3802ta_newkey('growth', 'claude', 'growth.claude') is not null as made;
select pg_temp.t3802ta_newkey('growth', 'codex', 'growth.codex') is not null as made;
select pg_temp.t3802ta_newkey('partner', 'claude', 'partner.claude') is not null as made;

-- ---------------------------------------------------------------------------
-- TA-1 — a replacement is all-or-nothing.
-- ---------------------------------------------------------------------------
do $ta1$
declare
  v_old text := pg_temp.t3802ta_id('partner.claude');
  v_new text;
  v_dead text;
  v_live text;
begin
  begin
    v_new := pg_temp.t3802ta_as('partner', $q$select public.team_agent_key_create('claude') ->> 'key'$q$);
    perform pg_temp.t3802ta_next();
    v_dead := pg_temp.t3802ta_as('service', format('select public.team_agent_call(%L, %L, %L::jsonb, %L)::text',
      pg_temp.t3802ta_digest(v_old), 'mcp:ping', '{}', 'x'));
    v_live := pg_temp.t3802ta_as('service', format('select public.team_agent_call(%L, %L, %L::jsonb, %L)::text',
      pg_temp.t3802ta_digest(v_new), 'mcp:ping', '{}', 'x'));
    raise exception 'undo the replacement' using errcode = 'P3835';
  exception when sqlstate 'P3835' then
    null;
  end;
  perform pg_temp.t3802ta_ok('TA-1', 'while the replacement stands the old key is refused', v_dead::jsonb ->> 'auth' = 'invalid', v_dead);
  perform pg_temp.t3802ta_ok('TA-1', 'while the replacement stands the new key works', (v_live::jsonb ->> 'ok')::boolean, v_live);
  perform pg_temp.t3802ta_ok('TA-1', 'the undone replacement left exactly the one key that was there',
    (select count(*) = 1 and bool_and(revoked_at is null and id::text = pg_temp.t3802ta_id('partner.claude.id'))
       from public.team_agent_keys where owner_email = 'issue3802ta-partner@test.local' and agent = 'claude'));
  perform pg_temp.t3802ta_ok('TA-1', 'after the undo the old key works again',
    (pg_temp.t3802ta_gw('partner.claude', 'mcp:ping')::jsonb ->> 'ok')::boolean);
  perform pg_temp.t3802ta_ok('TA-1', 'after the undo the new key is unknown',
    pg_temp.t3802ta_as('service', format('select public.team_agent_call(%L, %L, %L::jsonb, %L)::text',
      pg_temp.t3802ta_digest(v_new), 'mcp:ping', '{}', 'x'))::jsonb = '{"auth":"invalid"}'::jsonb);
  perform pg_temp.t3802ta_ok('TA-1', 'no audit row survives for the undone replacement',
    (select count(*) = 1 from public.admin_audit_log
      where admin_email = 'issue3802ta-partner@test.local' and action = 'agent.key_create'));
end;
$ta1$;

-- ---------------------------------------------------------------------------
-- TA-2 — "via" belongs to one person in one transaction.
-- ---------------------------------------------------------------------------
-- crm_ctx() is internal, so it is asked the way a function inside a request
-- asks it: as the server role, with the person's claims set.
create function pg_temp.t3802ta_via(p_who text) returns text
language plpgsql as $fn$
declare
  v_id uuid;
  v_email text;
  v_out text;
begin
  select id, email into strict v_id, v_email from t3802ta_people where who = p_who;
  begin
    set local role service_role;
    perform set_config('request.jwt.claim.sub', v_id::text, true);
    perform set_config('request.jwt.claim.email', v_email, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_id, 'email', v_email, 'role', 'authenticated')::text, true);
    select coalesce(c.via, 'none') into v_out from public.crm_ctx() c;
    reset role;
    return v_out;
  exception when others then
    reset role;
    return 'ERR:' || sqlstate || ':' || sqlerrm;
  end;
end;
$fn$;
do $ta2b$
declare
  v text;
begin
  perform pg_temp.t3802ta_ok('TA-2', 'a browser role cannot ask who is acting',
    pg_temp.t3802ta_as('growth', 'select coalesce(via, ''none'') from public.crm_ctx()') like 'ERR:42501:%');

  perform pg_temp.t3802ta_gw('growth.claude', 'get_started');
  perform pg_temp.t3802ta_ok('TA-2', 'inside the request the key''s owner is marked with the key''s agent',
    pg_temp.t3802ta_via('growth') = 'claude', pg_temp.t3802ta_via('growth'));
  perform pg_temp.t3802ta_ok('TA-2', 'in that same transaction another person is marked with nothing',
    pg_temp.t3802ta_via('owner') = 'none', pg_temp.t3802ta_via('owner'));
  perform pg_temp.t3802ta_ok('TA-2', 'and so is a third',
    pg_temp.t3802ta_via('partner') = 'none', pg_temp.t3802ta_via('partner'));

  -- A second request row in the same transaction, for the owner's Codex key.
  v := pg_temp.t3802ta_gw('owner.codex', 'get_started', '{}', false);
  perform pg_temp.t3802ta_ok('TA-2', 'a second person''s request marks only that person',
    pg_temp.t3802ta_via('owner') = 'codex' and pg_temp.t3802ta_via('growth') = 'claude' and pg_temp.t3802ta_via('admin') = 'none',
    pg_temp.t3802ta_via('owner') || '/' || pg_temp.t3802ta_via('growth') || '/' || pg_temp.t3802ta_via('admin'));

  -- The same person through their other key: the latest request wins.
  v := pg_temp.t3802ta_gw('growth.codex', 'get_started', '{}', false);
  perform pg_temp.t3802ta_ok('TA-2', 'the latest request for a person names the agent',
    pg_temp.t3802ta_via('growth') = 'codex', pg_temp.t3802ta_via('growth'));

  -- Once the request has ended nobody is marked, though every row is still there.
  perform pg_temp.t3802ta_next();
  perform pg_temp.t3802ta_ok('TA-2', 'after the request nobody is marked',
    pg_temp.t3802ta_via('growth') = 'none' and pg_temp.t3802ta_via('owner') = 'none');
  v := pg_temp.t3802ta_as('service', format('select public.team_agent_call(%L, %L, %L::jsonb, %L)::text',
    repeat('a', 64), 'get_started', '{}', 'x'));
  perform pg_temp.t3802ta_ok('TA-2', 'a key nobody holds gets the one answer', v::jsonb = '{"auth":"invalid"}'::jsonb, left(v, 120));
  perform pg_temp.t3802ta_ok('TA-2', 'and it leaves no request row and marks nobody',
    pg_temp.t3802ta_via('growth') = 'none'
    and not exists (select 1 from public.team_agent_calls where xact_id <> '3'::xid8));
  -- A browser session writes a log line while request rows for that person exist.
  v := pg_temp.t3802ta_as('growth', format(
    $q$select public.crm_record_log(%L::uuid, '{"kind":"note","body":"a person wrote this"}'::jsonb, 'issue3802ta-note-1')::text$q$,
    '38020000-0000-4000-f500-000000000001'));
  perform pg_temp.t3802ta_ok('TA-2', 'a line a person writes in the browser carries no agent',
    v not like 'ERR:%' and (select count(*) = 1 and bool_and(a.via is null) from public.crm_activity a
                             where a.body = 'a person wrote this'), left(v, 200));
end;
$ta2b$;

-- ---------------------------------------------------------------------------
-- TA-3 — limit arithmetic at the edges.
-- ---------------------------------------------------------------------------
do $ta3$
declare
  v_key uuid := pg_temp.t3802ta_id('admin.claude.id')::uuid;
  v_uid uuid := (select id from t3802ta_people where who = 'admin');
  v_day timestamptz := date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
  v text;
  v_retry integer;
begin
  perform pg_temp.t3802ta_next();
  delete from public.team_agent_calls where key_id = v_key;
  insert into public.team_agent_calls (key_id, owner_email, actor_uid, agent, tool, xact_id, started_at, duration_ms, outcome)
  select v_key, 'issue3802ta-admin@test.local', v_uid, 'claude', 'mcp:ping', '3'::xid8,
         clock_timestamp() - interval '30 seconds', 1, 'ok'
  from generate_series(1, 119);

  v := pg_temp.t3802ta_gw('admin.claude', 'mcp:ping');
  perform pg_temp.t3802ta_ok('TA-3', 'the last request inside the minute''s allowance is served', (v::jsonb ->> 'ok')::boolean, left(v, 200));
  v := pg_temp.t3802ta_gw('admin.claude', 'mcp:ping');
  v_retry := (v::jsonb #>> '{limited,retry_after_s}')::integer;
  perform pg_temp.t3802ta_ok('TA-3', 'the next one is refused with a wait of 1 to 60 seconds',
    v::jsonb #>> '{limited,token}' = 'rate_limited' and v_retry between 1 and 60, left(v, 200));
  perform pg_temp.t3802ta_ok('TA-3', 'the refusal says what to do and names no internal thing',
    v::jsonb #>> '{limited,message}' ~ '^Your agent has made a lot of requests' and v !~ 'team_agent|crm_|key_id', left(v, 200));

  -- Five hundred more refused requests must not push the wait out.
  perform pg_temp.t3802ta_gw('admin.claude', 'my_day') from generate_series(1, 500);
  perform pg_temp.t3802ta_ok('TA-3', 'every refused request is recorded as refused',
    (select count(*) = 501 from public.team_agent_calls where key_id = v_key and outcome = 'limited'));
  perform pg_temp.t3802ta_ok('TA-3', 'a refused request does not touch "last used"',
    (select last_used_at is not null from public.team_agent_keys where id = v_key));
  update public.team_agent_calls set started_at = started_at - interval '61 seconds' where key_id = v_key and outcome <> 'limited';
  v := pg_temp.t3802ta_gw('admin.claude', 'mcp:ping');
  perform pg_temp.t3802ta_ok('TA-3', 'refused requests never count: once the minute has passed the key is served again',
    (v::jsonb ->> 'ok')::boolean, left(v, 200));

  perform pg_temp.t3802ta_ok('TA-3', 'one key''s count never touches another person''s key',
    (pg_temp.t3802ta_gw('growth.claude', 'mcp:ping')::jsonb ->> 'ok')::boolean);

  -- The daily count: only today's tool calls, never the connection's own
  -- housekeeping, never yesterday. (Skipped in the first two minutes of a
  -- UTC day, when "today" and "the last minute" are the same rows.)
  if clock_timestamp() - v_day > interval '2 minutes' then
    perform pg_temp.t3802ta_next();
    delete from public.team_agent_calls where key_id = v_key;
    insert into public.team_agent_calls (key_id, owner_email, actor_uid, agent, tool, xact_id, started_at, duration_ms, outcome)
    select v_key, 'issue3802ta-admin@test.local', v_uid, 'claude', 'my_day', '3'::xid8, v_day + interval '1 millisecond', 1, 'ok'
    from generate_series(1, 5999);
    insert into public.team_agent_calls (key_id, owner_email, actor_uid, agent, tool, xact_id, started_at, duration_ms, outcome)
    select v_key, 'issue3802ta-admin@test.local', v_uid, 'claude', t.tool, '3'::xid8, t.at, 1, t.outcome
    from (values ('mcp:tools/list', v_day + interval '1 millisecond', 'ok'),
                 ('my_day', v_day - interval '1 millisecond', 'ok'),
                 ('my_day', v_day + interval '1 millisecond', 'limited')) as t(tool, at, outcome),
         generate_series(1, 300);
    v := pg_temp.t3802ta_gw('admin.claude', 'my_day');
    perform pg_temp.t3802ta_ok('TA-3', 'the last tool call inside the day''s allowance is served', (v::jsonb ->> 'ok')::boolean, left(v, 200));
    v := pg_temp.t3802ta_gw('admin.claude', 'my_day');
    perform pg_temp.t3802ta_ok('TA-3', 'the next one is refused until midnight UTC',
      v::jsonb #>> '{limited,token}' = 'daily_limit'
      and (v::jsonb #>> '{limited,retry_after_s}')::integer between 1 and 86400, left(v, 200));
    v := pg_temp.t3802ta_gw('admin.claude', 'mcp:tools/list');
    perform pg_temp.t3802ta_ok('TA-3', 'the connection''s own housekeeping is still served on a spent day', (v::jsonb ->> 'ok')::boolean, left(v, 200));
    update public.team_agent_calls set started_at = v_day - interval '1 second'
     where key_id = v_key and tool = 'my_day' and outcome = 'ok';
    v := pg_temp.t3802ta_gw('admin.claude', 'my_day');
    perform pg_temp.t3802ta_ok('TA-3', 'yesterday''s calls do not count today', (v::jsonb ->> 'ok')::boolean, left(v, 200));
  else
    perform pg_temp.t3802ta_ok('TA-3', 'daily checks skipped in the first two minutes of a UTC day', true);
  end if;
  perform pg_temp.t3802ta_next();
  delete from public.team_agent_calls where key_id = v_key;
end;
$ta3$;

-- ---------------------------------------------------------------------------
-- TA-4 — the agent reads exactly what the same person reads on screen.
-- ---------------------------------------------------------------------------
-- Give every role a distinct private waiting count. The connector summary may
-- expose only that number for its own person, never a draft's text or another
-- person's number.
insert into public.team_drafts (
  owner_email, record_id, channel, subject, body, original_body, created_via, request_key
)
select p.email,
       ('38020000-0000-4000-f500-' || lpad(g::text, 12, '0'))::uuid,
       'email',
       'Issue3802ta private draft ' || p.who || ' ' || g,
       'Issue3802ta private draft body ' || p.who || ' ' || g,
       'Issue3802ta private draft body ' || p.who || ' ' || g,
       'claude',
       't3802ta-draft-' || p.who || '-' || g
from (values
  ('growth',  'issue3802ta-growth@test.local',  1),
  ('partner', 'issue3802ta-partner@test.local', 2),
  ('admin',   'issue3802ta-admin@test.local',   3),
  ('owner',   'issue3802ta-owner@test.local',   4)
) p(who, email, waiting),
lateral generate_series(1, p.waiting) g;

do $ta4$
declare
  v text;
  v_screen jsonb;
  v_agent jsonb;
  v_drafts integer;
  v_other_drafts integer;
  v_other text;
  v_ids text[];
  v_seen text[] := array[]::text[];
  v_cursor text;
  v_pages integer := 0;
  v_today date := (now() at time zone 'UTC')::date;
  v_monday date := date_trunc('week', (now() at time zone 'UTC'))::date;
  w text;
  f record;
  v_expect text[];
  v_got text[];
begin
  foreach w in array array['growth', 'partner', 'admin', 'owner'] loop
    v_screen := pg_temp.t3802ta_as(w, $q$select public.crm_records_list('hosts')::text$q$)::jsonb;
    v_agent := pg_temp.t3802ta_gw(w || '.claude', 'find_records', '{"pipeline":"hosts","limit":100}')::jsonb;
    select array_agg(r ->> 'id' order by r ->> 'id') into v_ids
      from jsonb_array_elements(v_screen -> 'records') r where r ->> 'name' like 'Issue3802ta Host %';
    perform pg_temp.t3802ta_ok('TA-4', w || ': the agent finds the records the screen lists',
      (select array_agg(r ->> 'id' order by r ->> 'id') from jsonb_array_elements(v_agent #> '{result,records}') r
        where r ->> 'name' like 'Issue3802ta Host %') = v_ids
      and cardinality(v_ids) = 35, coalesce(cardinality(v_ids)::text, 'null'));
    perform pg_temp.t3802ta_ok('TA-4', w || ': every field of every record is the one on screen',
      not exists (
        select 1 from jsonb_array_elements(v_agent #> '{result,records}') a
        join jsonb_array_elements(v_screen -> 'records') s on s ->> 'id' = a ->> 'id'
        where (a - 'last_touch' - 'last_reply') is distinct from s));
    perform pg_temp.t3802ta_ok('TA-4', w || ': no deleted record is found',
      not exists (select 1 from jsonb_array_elements(v_agent #> '{result,records}') a
                   join public.crm_records c on c.id = (a ->> 'id')::uuid where c.deleted_at is not null));
    v_drafts := pg_temp.t3802ta_as(w, $q$select public.team_draft_counts() ->> 'waiting'$q$)::integer;
    v_other := case w when 'growth' then 'partner' when 'partner' then 'admin' when 'admin' then 'owner' else 'growth' end;
    v_other_drafts := pg_temp.t3802ta_as(v_other, $q$select public.team_draft_counts() ->> 'waiting'$q$)::integer;
    v_screen := pg_temp.t3802ta_as(w, $q$select public.crm_home_summary(null)::text$q$)::jsonb
      || jsonb_build_object('drafts_waiting', v_drafts);
    v_agent := pg_temp.t3802ta_gw(w || '.claude', 'my_day')::jsonb;
    perform pg_temp.t3802ta_ok('TA-4', w || ': "my day" is the screen plus only this person''s draft count and no draft text',
      v_agent -> 'result' = v_screen
      and (v_agent #>> '{result,drafts_waiting}')::integer = v_drafts
      and v_drafts <> v_other_drafts
      and v_agent::text not like '%Issue3802ta private draft%',
      left(coalesce((v_agent -> 'error')::text, v_agent::text), 200));
  end loop;

  -- Each filter against the same rule applied to what the screen lists.
  v_screen := pg_temp.t3802ta_as('growth', $q$select public.crm_records_list('hosts')::text$q$)::jsonb;
  for f in
    select * from (values
      ('{"due":"overdue"}',   format($p$(r ->> 'due_on')::date < %L$p$, v_today)),
      ('{"due":"today"}',     format($p$(r ->> 'due_on')::date = %L$p$, v_today)),
      ('{"due":"this_week"}', format($p$(r ->> 'due_on')::date between %L and %L$p$, v_monday, v_monday + 6)),
      ('{"due":"none"}',      $p$r ->> 'due_on' is null$p$),
      ('{"owner":"me"}',      $p$r -> 'owners' ? 'issue3802ta-growth@test.local'$p$),
      ('{"owner":"issue3802ta-partner@test.local"}', $p$r -> 'owners' ? 'issue3802ta-partner@test.local'$p$),
      ('{"owner":"none"}',    $p$jsonb_array_length(r -> 'owners') = 0$p$),
      ('{"stage":["replied","meeting"]}', $p$r ->> 'stage' in ('replied', 'meeting')$p$),
      ('{"icp":["venue_gallery"]}', $p$r ->> 'icp' = 'venue_gallery'$p$),
      ('{"region_id":["38020000-0000-4000-f200-000000000002"]}', $p$r ->> 'region_id' = '38020000-0000-4000-f200-000000000002'$p$),
      ('{"q":"host 1"}',      $p$r ->> 'name' ilike '%host 1%'$p$),
      ('{"q":"%"}',           $p$false$p$),
      ('{"q":"_"}',           $p$false$p$),
      ('{"due":"overdue","owner":"me","stage":["contacted"]}',
        format($p$(r ->> 'due_on')::date < %L and r -> 'owners' ? 'issue3802ta-growth@test.local' and r ->> 'stage' = 'contacted'$p$, v_today))
    ) as t(args, rule)
  loop
    execute format($q$select coalesce(array_agg(r ->> 'id' order by r ->> 'id'), array[]::text[])
                        from jsonb_array_elements($1 -> 'records') r
                       where r ->> 'name' like 'Issue3802ta Host %%' and (%s)$q$, f.rule)
      into v_expect using v_screen;
    v_agent := pg_temp.t3802ta_gw('growth.claude', 'find_records', (f.args::jsonb || '{"pipeline":"hosts","limit":100}')::text)::jsonb;
    select coalesce(array_agg(r ->> 'id' order by r ->> 'id'), array[]::text[]) into v_got
      from jsonb_array_elements(v_agent #> '{result,records}') r where r ->> 'name' like 'Issue3802ta Host %';
    perform pg_temp.t3802ta_ok('TA-4', 'filter ' || f.args || ' matches the screen''s rows',
      v_got = v_expect, format('agent %s, screen %s', cardinality(v_got), cardinality(v_expect)));
  end loop;

  -- Needs a reply: the latest touch is theirs.
  v_agent := pg_temp.t3802ta_gw('growth.claude', 'find_records', '{"pipeline":"hosts","needs_reply":true,"limit":100}')::jsonb;
  perform pg_temp.t3802ta_ok('TA-4', 'needs_reply is exactly the records whose latest touch is inbound',
    (select coalesce(array_agg(r ->> 'id' order by r ->> 'id'), array[]::text[]) from jsonb_array_elements(v_agent #> '{result,records}') r
      where r ->> 'name' like 'Issue3802ta Host %')
    = (select array_agg(c.id::text order by c.id::text) from public.crm_records c
        where c.name like 'Issue3802ta Host %' and c.deleted_at is null and right(c.name, 2)::int % 4 = 0));

  -- Pages of seven: thirty of these records share one timestamp.
  loop
    v_agent := pg_temp.t3802ta_gw('growth.claude', 'find_records',
      (jsonb_build_object('pipeline', 'hosts', 'limit', 7, 'q', 'Issue3802ta Host')
       || case when v_cursor is null then '{}'::jsonb else jsonb_build_object('cursor', v_cursor) end)::text)::jsonb;
    v_pages := v_pages + 1;
    v_seen := v_seen || array(select r ->> 'id' from jsonb_array_elements(v_agent #> '{result,records}') r);
    v_cursor := v_agent #>> '{result,next_cursor}';
    exit when v_cursor is null or v_pages > 20;
  end loop;
  perform pg_temp.t3802ta_ok('TA-4', 'paging returns every record exactly once when many share a timestamp',
    cardinality(v_seen) = 35 and (select count(distinct x) from unnest(v_seen) x) = 35 and v_pages = 5,
    format('%s rows, %s pages', cardinality(v_seen), v_pages));
  perform pg_temp.t3802ta_ok('TA-4', 'the total is the number of records, not of pages',
    (v_agent #>> '{result,total}')::integer = 35);

  -- Counts add up to the records counted.
  v_agent := pg_temp.t3802ta_gw('growth.claude', 'find_records', '{"pipeline":"hosts","q":"Issue3802ta Host","count_by":["stage"]}')::jsonb;
  perform pg_temp.t3802ta_ok('TA-4', 'counts by stage add up to the total',
    (select sum((c ->> 'count')::integer) from jsonb_array_elements(v_agent #> '{result,counts}') c) = 35
    and (v_agent #>> '{result,total}')::integer = 35);

  -- A deleted record by every other route.
  v := pg_temp.t3802ta_gw('growth.claude', 'get_record', '{"id":"38020000-0000-4000-f500-000000000007"}');
  perform pg_temp.t3802ta_ok('TA-4', 'a deleted record cannot be opened', v::jsonb #>> '{error,token}' = 'not_found', left(v, 200));
  v := pg_temp.t3802ta_gw('growth.claude', 'check_names', '{"pipeline":"hosts","names":["Issue3802ta Host 07","Issue3802ta Host 08"]}');
  perform pg_temp.t3802ta_ok('TA-4', 'a deleted name is free again; a live one is taken',
    jsonb_typeof(v::jsonb #> '{result,names,0,exact}') = 'null' and jsonb_typeof(v::jsonb #> '{result,names,1,exact}') = 'object', left(v, 300));
  v := pg_temp.t3802ta_gw('growth.claude', 'my_day');
  perform pg_temp.t3802ta_ok('TA-4', 'a deleted record is not in "my day"', v not like '%Issue3802ta Host 14%', '');

  -- A beta lead's phone number, by any role.
  foreach w in array array['growth', 'partner', 'admin', 'owner'] loop
    v := pg_temp.t3802ta_gw(w || '.claude', 'list_beta_leads', '{"only_new":false,"limit":100}');
    perform pg_temp.t3802ta_ok('TA-4', w || ': beta leads carry the lead and never a phone number',
      v like '%Issue3802ta Lead%' and v not like '%5550003802%' and v !~* '"phone"', left(v, 120));
  end loop;
end;
$ta4$;

-- ---------------------------------------------------------------------------
-- TA-5 — a key is nowhere, for anyone.
-- ---------------------------------------------------------------------------
do $ta5$
declare
  k record;
  v text;
  v_all text := '';
  w text;
  v_made text;
  v_bodies text[];
begin
  v_made := pg_temp.t3802ta_newkey('mover', 'claude', 'mover.claude');
  perform pg_temp.t3802ta_ok('TA-5', 'the answer that makes a key holds it once and holds no digest',
    (length(v_made) - length(replace(v_made, pg_temp.t3802ta_id('mover.claude'), ''))) = length(pg_temp.t3802ta_id('mover.claude'))
    and v_made !~ '[0-9a-f]{64}', '');
  perform pg_temp.t3802ta_ok('TA-5', 'what is stored for it is its SHA-256 digest and its first 14 characters',
    (select key_hash = pg_temp.t3802ta_digest(pg_temp.t3802ta_id('mover.claude')) and key_prefix = left(pg_temp.t3802ta_id('mover.claude'), 14)
       from public.team_agent_keys where id = pg_temp.t3802ta_id('mover.claude.id')::uuid));
  perform pg_temp.t3802ta_gw('mover.claude', 'get_started');
  v := pg_temp.t3802ta_as('mover', format('select public.team_agent_key_revoke(%L::uuid)::text', pg_temp.t3802ta_id('mover.claude.id')));
  v_all := v_all || v;
  perform pg_temp.t3802ta_newkey('mover', 'claude', 'mover.claude2');

  -- Every key this run made, as the part after its public prefix.
  select array_agg(substr(i.v, 8)) into v_bodies from t3802ta_ids i where i.k not like '%.id';

  for k in select unnest(v_bodies) as body loop
    perform pg_temp.t3802ta_ok('TA-5', 'no row of the keys, requests, audit, activity or request-key tables holds a key',
      not exists (select 1 from public.team_agent_keys t where to_jsonb(t)::text like '%' || k.body || '%')
      and not exists (select 1 from public.team_agent_calls t where to_jsonb(t)::text like '%' || k.body || '%')
      and not exists (select 1 from public.admin_audit_log t where to_jsonb(t)::text like '%' || k.body || '%')
      and not exists (select 1 from public.crm_activity t where to_jsonb(t)::text like '%' || k.body || '%')
      and not exists (select 1 from public.crm_request_keys t where to_jsonb(t)::text like '%' || k.body || '%'));
  end loop;
  delete from t3802ta_results r where r.test = 'TA-5' and r.label like 'no row of the keys%' and r.ok
    and r.seq <> (select min(seq) from t3802ta_results x where x.test = 'TA-5' and x.label like 'no row of the keys%');

  -- Every answer of every function, to every kind of caller.
  foreach w in array array['owner', 'admin', 'growth', 'partner', 'mover'] loop
    v_all := v_all || pg_temp.t3802ta_as(w, 'select public.team_agent_keys_mine()::text')
                   || pg_temp.t3802ta_as(w, 'select public.team_agent_keys_overview()::text')
                   || pg_temp.t3802ta_as(w, 'select public.team_agent_my_activity(100, null)::text')
                   || pg_temp.t3802ta_as(w, 'select public.team_agent_guide()::text');
  end loop;
  foreach w in array array['get_started', 'my_day', 'team_summary', 'list_beta_leads', 'mcp:initialize', 'mcp:resources/read', 'mcp:prompts/list'] loop
    v_all := v_all || pg_temp.t3802ta_gw('owner.claude', w) || pg_temp.t3802ta_gw('growth.codex', w);
  end loop;
  v_all := v_all || pg_temp.t3802ta_gw('owner.claude', 'find_records', '{"pipeline":"hosts"}');
  perform pg_temp.t3802ta_ok('TA-5', 'the answers were really collected', length(v_all) > 5000 and v_all like '%key_prefix%', length(v_all)::text);
  perform pg_temp.t3802ta_ok('TA-5', 'no answer to anyone holds a key',
    not exists (select 1 from unnest(v_bodies) b where v_all like '%' || b || '%') and v_all !~ 'mgla_[cx]_[A-Za-z0-9_-]{43}');
  perform pg_temp.t3802ta_ok('TA-5', 'no answer to anyone holds a digest or names the digest column',
    v_all !~ '[0-9a-f]{64}' and v_all not like '%key_hash%');
  perform pg_temp.t3802ta_ok('TA-5', 'the owner sees who is connected, with the public prefix only',
    (select count(*) from jsonb_array_elements(pg_temp.t3802ta_as('owner', 'select public.team_agent_keys_overview()::text')::jsonb -> 'people') p
      where p ->> 'email' like 'issue3802ta-%' and (p ->> 'connected')::boolean and length(p ->> 'key_prefix') = 14) >= 7);
  perform pg_temp.t3802ta_ok('TA-5', 'an audit row for a key names its prefix, never more',
    (select bool_and(m.metadata ->> 'key_prefix' ~ '^mgla_[cx]_[A-Za-z0-9_-]{7}$' and length(m.metadata::text) < 200)
       from public.admin_audit_log m where m.admin_email like 'issue3802ta-%' and m.action like 'agent.key_%'));
end;
$ta5$;

-- ---------------------------------------------------------------------------
-- TA-6 — nothing else can reach the two tables.
-- ---------------------------------------------------------------------------
do $ta6$
declare
  v_list text;
  t text;
  r text;
  p text;
begin
  perform pg_temp.t3802ta_ok('TA-6', 'no view or materialised view reads either table',
    not exists (select 1 from pg_catalog.pg_depend d
                 join pg_catalog.pg_rewrite w on w.oid = d.objid
                 join pg_catalog.pg_class v on v.oid = w.ev_class
                where d.refobjid in ('public.team_agent_keys'::regclass, 'public.team_agent_calls'::regclass)
                  and v.oid not in ('public.team_agent_keys'::regclass, 'public.team_agent_calls'::regclass)));
  perform pg_temp.t3802ta_ok('TA-6', 'neither table is in any publication',
    not exists (select 1 from pg_catalog.pg_publication_tables pt
                 where pt.schemaname = 'public' and pt.tablename in ('team_agent_keys', 'team_agent_calls'))
    and not exists (select 1 from pg_catalog.pg_publication pb where pb.puballtables));

  select coalesce(string_agg(p2.proname, ',' order by p2.proname), '') into v_list
    from pg_catalog.pg_proc p2 join pg_catalog.pg_namespace n on n.oid = p2.pronamespace
   where n.nspname not in ('pg_catalog', 'information_schema', 'pg_temp') and n.nspname not like 'pg_temp%'
     and p2.prokind = 'f' and p2.prosrc ~* '\mteam_agent_keys\M';
  -- [TEST-MOD-APPROVED #3802] Wave 2's separately guarded content gateway
  -- updates the key's last-used marker, so the legacy authority list advances.
  perform pg_temp.t3802ta_ok('TA-6', 'only the named functions mention the keys table',
    v_list = 'admin_team_set_member,team_agent_call,team_agent_content_call,team_agent_key_issue,team_agent_key_revoke,team_agent_keys_mine,team_agent_keys_overview,team_agent_person,team_agent_resolve,team_agent_setup_create,team_agent_setup_redeem', v_list);
  select coalesce(string_agg(p2.proname, ',' order by p2.proname), '') into v_list
    from pg_catalog.pg_proc p2 join pg_catalog.pg_namespace n on n.oid = p2.pronamespace
   where n.nspname not like 'pg_%' and n.nspname <> 'information_schema'
     and p2.prokind = 'f' and p2.prosrc ~* '\mkey_hash\M';
  perform pg_temp.t3802ta_ok('TA-6', 'only the function that makes a key and the one that resolves it read a digest',
    v_list = 'team_agent_key_issue,team_agent_person,team_agent_resolve', v_list);
  select coalesce(string_agg(p2.proname, ',' order by p2.proname), '') into v_list
    from pg_catalog.pg_proc p2 join pg_catalog.pg_namespace n on n.oid = p2.pronamespace
   where n.nspname not like 'pg_%' and n.nspname <> 'information_schema'
     and p2.prokind = 'f' and p2.prosrc ~* '\mteam_agent_calls\M';
  perform pg_temp.t3802ta_ok('TA-6', 'only the named functions mention the request table',
    v_list = 'content_calendar_ctx,crm_ctx,team_agent_call,team_agent_content_call,team_agent_housekeeping,team_agent_keys_mine,team_agent_keys_overview,team_agent_my_activity', v_list);
  perform pg_temp.t3802ta_ok('TA-6', 'no function takes a person or an agent from its caller',
    not exists (select 1 from pg_catalog.pg_proc p2 join pg_catalog.pg_namespace n on n.oid = p2.pronamespace
                 where n.nspname = 'public' and p2.proname like 'team\_agent\_%'
                   and exists (select 1 from unnest(coalesce(p2.proargnames, array[]::text[])) a
                                where a ~* '(actor|email|uid|user|owner|via|role)')));

  foreach t in array array['public.team_agent_keys', 'public.team_agent_calls'] loop
    foreach r in array array['anon', 'authenticated', 'authenticator'] loop
      foreach p in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'] loop
        if has_table_privilege(r, t, p) then
          perform pg_temp.t3802ta_ok('TA-6', format('%s holds no %s on %s', r, p, t), false);
        end if;
      end loop;
      perform pg_temp.t3802ta_ok('TA-6', format('%s holds no column of %s', r, t),
        not exists (select 1 from pg_catalog.pg_attribute a
                     where a.attrelid = t::regclass and a.attnum > 0 and not a.attisdropped
                       and (has_column_privilege(r, t, a.attname, 'SELECT') or has_column_privilege(r, t, a.attname, 'UPDATE')
                            or has_column_privilege(r, t, a.attname, 'INSERT'))));
    end loop;
    perform pg_temp.t3802ta_ok('TA-6', t || ': row security on, forced off for nobody, and no policy',
      (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = t::regclass)
      and not exists (select 1 from pg_catalog.pg_policy pl where pl.polrelid = t::regclass));
  end loop;

  -- What a client role really gets, statement by statement.
  perform pg_temp.t3802ta_ok('TA-6', 'a signed-in person cannot read, add, change or remove a key row',
    pg_temp.t3802ta_as('growth', 'select count(*)::text from public.team_agent_keys') like 'ERR:42501:%'
    and pg_temp.t3802ta_as('growth', $q$with x as (insert into public.team_agent_keys (owner_email, agent, key_prefix, key_hash)
          values ('issue3802ta-growth@test.local', 'claude', 'mgla_c_AAAAAAA', repeat('b', 64)) returning 1) select count(*)::text from x$q$) like 'ERR:42501:%'
    and pg_temp.t3802ta_as('growth', $q$with x as (update public.team_agent_keys set revoked_at = null, revoked_by = null, revoke_reason = null returning 1) select count(*)::text from x$q$) like 'ERR:42501:%'
    and pg_temp.t3802ta_as('growth', $q$with x as (delete from public.team_agent_keys returning 1) select count(*)::text from x$q$) like 'ERR:42501:%');
  perform pg_temp.t3802ta_ok('TA-6', 'a signed-in person cannot write a request row, so cannot mark anything as agent-made',
    pg_temp.t3802ta_as('growth', format($q$with x as (insert into public.team_agent_calls (key_id, owner_email, actor_uid, agent, tool, xact_id)
          values (%L::uuid, 'issue3802ta-growth@test.local', %L::uuid, 'claude', 'my_day', pg_current_xact_id()) returning 1) select count(*)::text from x$q$,
          pg_temp.t3802ta_id('growth.claude.id'), '38020000-0000-4000-f000-000000000003')) like 'ERR:42501:%'
    and pg_temp.t3802ta_as('anon', 'select count(*)::text from public.team_agent_calls') like 'ERR:42501:%');
  perform pg_temp.t3802ta_ok('TA-6', 'neither a signed-in person nor an anonymous caller can run the gateway or what it is built from',
    not exists (
      select 1 from unnest(array['growth', 'owner', 'anon']) who,
                    unnest(array[
                      format('select public.team_agent_call(%L, %L, %L::jsonb, %L)::text', pg_temp.t3802ta_digest(pg_temp.t3802ta_id('owner.claude')), 'team_summary', '{}', 'x'),
                      format('select public.team_agent_resolve(%L)::text', pg_temp.t3802ta_digest(pg_temp.t3802ta_id('owner.claude'))),
                      $q$select public.team_agent_records_find('{"pipeline":"hosts"}'::jsonb)::text$q$,
                      'select public.team_agent_guide_def()::text',
                      'select public.team_agent_limits()::text',
                      'select public.team_agent_housekeeping()::text',
                      'select via from public.crm_ctx()']) stmt
       where pg_temp.t3802ta_as(who, stmt) not like 'ERR:42501:%'));
  perform pg_temp.t3802ta_ok('TA-6', 'the server role with no key is nobody: every key function refuses it',
    pg_temp.t3802ta_as('service', $q$select public.team_agent_key_create('claude')::text$q$) like 'ERR:42501:forbidden:%'
    and pg_temp.t3802ta_as('service', 'select public.team_agent_keys_mine()::text') like 'ERR:42501:forbidden:%'
    and pg_temp.t3802ta_as('service', 'select public.team_agent_keys_overview()::text') like 'ERR:42501:forbidden:%');
end;
$ta6$;

-- ---------------------------------------------------------------------------
-- TA-7 — the team writer ends keys on removal and changes nothing else.
-- ---------------------------------------------------------------------------
do $ta7$
declare
  v text;
  v_before jsonb;
  v_after jsonb;
  v_old jsonb;
begin
  perform pg_temp.t3802ta_newkey('leaver', 'claude', 'leaver.old');
  perform pg_temp.t3802ta_as('leaver', format('select public.team_agent_key_revoke(%L::uuid)::text', pg_temp.t3802ta_id('leaver.old.id')));
  perform pg_temp.t3802ta_newkey('leaver', 'claude', 'leaver.claude');
  perform pg_temp.t3802ta_newkey('leaver', 'codex', 'leaver.codex');
  select to_jsonb(t) into v_old from public.team_agent_keys t where t.id = pg_temp.t3802ta_id('leaver.old.id')::uuid;
  select jsonb_agg(to_jsonb(t) order by t.id) into v_before from public.team_agent_keys t;

  -- Things that must leave every key row as it was.
  perform pg_temp.t3802ta_next();
  v := pg_temp.t3802ta_as('admin', $q$select public.admin_team_set_member('issue3802ta-leaver@test.local', 'growth', 'revoked')::text$q$);
  perform pg_temp.t3802ta_ok('TA-7', 'a full admin who is not the owner cannot remove anyone', v like 'ERR:42501:%', left(v, 120));
  v := pg_temp.t3802ta_as('growth', $q$select public.admin_team_set_member('issue3802ta-leaver@test.local', 'growth', 'revoked')::text$q$);
  perform pg_temp.t3802ta_ok('TA-7', 'a teammate cannot remove anyone', v like 'ERR:42501:%', left(v, 120));
  v := pg_temp.t3802ta_as('owner', $q$select public.admin_team_set_member('issue3802ta-newcomer@test.local', 'growth', 'invited')::text$q$);
  perform pg_temp.t3802ta_ok('TA-7', 'an invitation still answers in the same shape as before',
    v not like 'ERR:%' and (select array_agg(k order by k) from jsonb_object_keys(v::jsonb) k) = array['changed', 'email', 'previous', 'role', 'status'], left(v, 200));
  v := pg_temp.t3802ta_as('owner', $q$select public.admin_team_set_member('issue3802ta-mover@test.local', 'partner', 'active')::text$q$);
  perform pg_temp.t3802ta_ok('TA-7', 'a role change goes through', v::jsonb ->> 'role' = 'partner' and (v::jsonb ->> 'changed')::boolean, left(v, 200));
  select jsonb_agg(to_jsonb(t) order by t.id) into v_after from public.team_agent_keys t;
  perform pg_temp.t3802ta_ok('TA-7', 'two refused removals, an invitation and a role change left every key row byte for byte', v_after = v_before);
  perform pg_temp.t3802ta_ok('TA-7', 'the person whose role changed keeps a working key, now with the new role',
    pg_temp.t3802ta_gw('mover.claude2', 'mcp:ping')::jsonb #>> '{me,role}' = 'partner');
  perform pg_temp.t3802ta_ok('TA-7', 'both of the leaver''s keys work before the removal',
    (pg_temp.t3802ta_gw('leaver.claude', 'mcp:ping')::jsonb ->> 'ok')::boolean and (pg_temp.t3802ta_gw('leaver.codex', 'mcp:ping')::jsonb ->> 'ok')::boolean);

  -- The removal.
  perform pg_temp.t3802ta_next();
  select jsonb_agg(to_jsonb(t) order by t.id) into v_before from public.team_agent_keys t where t.owner_email <> 'issue3802ta-leaver@test.local';
  v := pg_temp.t3802ta_as('owner', $q$select public.admin_team_set_member('issue3802ta-leaver@test.local', 'growth', 'revoked')::text$q$);
  perform pg_temp.t3802ta_ok('TA-7', 'the owner removes the person; the answer keeps its shape',
    v::jsonb ->> 'status' = 'revoked' and (select array_agg(k order by k) from jsonb_object_keys(v::jsonb) k) = array['changed', 'email', 'previous', 'role', 'status'], left(v, 200));
  perform pg_temp.t3802ta_ok('TA-7', 'every active key the person held is ended, by the owner, for that reason',
    (select count(*) = 2 and bool_and(revoked_at is not null and revoked_by = 'issue3802ta-owner@test.local' and revoke_reason = 'access_removed')
       from public.team_agent_keys where id in (pg_temp.t3802ta_id('leaver.claude.id')::uuid, pg_temp.t3802ta_id('leaver.codex.id')::uuid)));
  perform pg_temp.t3802ta_ok('TA-7', 'a key the person had already turned off keeps its own history',
    (select to_jsonb(t) = v_old from public.team_agent_keys t where t.id = pg_temp.t3802ta_id('leaver.old.id')::uuid));
  select jsonb_agg(to_jsonb(t) order by t.id) into v_after from public.team_agent_keys t where t.owner_email <> 'issue3802ta-leaver@test.local';
  perform pg_temp.t3802ta_ok('TA-7', 'nobody else''s key row moved', v_after = v_before);
  perform pg_temp.t3802ta_ok('TA-7', 'both keys are refused at the very next request, with the one answer',
    pg_temp.t3802ta_gw('leaver.claude', 'mcp:ping')::jsonb = '{"auth":"invalid"}'::jsonb
    and pg_temp.t3802ta_gw('leaver.codex', 'get_started')::jsonb = '{"auth":"invalid"}'::jsonb);
  perform pg_temp.t3802ta_ok('TA-7', 'the removal is one audit row, as before',
    (select count(*) = 1 from public.admin_audit_log where action = 'team.remove' and target_id = 'issue3802ta-leaver@test.local'));

  -- Access given back does not bring a key back, and the person can make a new one.
  v := pg_temp.t3802ta_as('owner', $q$select public.admin_team_set_member('issue3802ta-leaver@test.local', 'growth', 'active')::text$q$);
  perform pg_temp.t3802ta_ok('TA-7', 'access given back does not bring a key back',
    v::jsonb ->> 'status' = 'active' and pg_temp.t3802ta_gw('leaver.claude', 'mcp:ping')::jsonb = '{"auth":"invalid"}'::jsonb
    and not exists (select 1 from public.team_agent_keys where owner_email = 'issue3802ta-leaver@test.local' and revoked_at is null), left(v, 200));
  perform pg_temp.t3802ta_newkey('leaver', 'claude', 'leaver.again');
  perform pg_temp.t3802ta_ok('TA-7', 'a new key made after coming back works',
    (pg_temp.t3802ta_gw('leaver.again', 'mcp:ping')::jsonb ->> 'ok')::boolean);
end;
$ta7$;

-- ---------------------------------------------------------------------------
-- TA-8 — an account that can sign in another way: the rule is applied at
-- every request, to everyone but the owner, and to the owner's own key only.
-- ---------------------------------------------------------------------------
do $ta8$
declare
  v text;
  v_rows bigint;
begin
  -- The owner's account gains a phone sign-in: the owner's own keys go on.
  update auth.users set phone = '15550003801' where id = '38020000-0000-4000-f000-000000000001';
  perform pg_temp.t3802ta_ok('TA-8', 'the rule does see the owner''s account as one that can sign in another way',
    public.admin_team_invite_address_verdict('issue3802ta-owner@test.local') = 'conflict');
  perform pg_temp.t3802ta_ok('TA-8', 'the owner''s own keys keep working',
    (pg_temp.t3802ta_gw('owner.claude', 'mcp:ping')::jsonb ->> 'ok')::boolean and (pg_temp.t3802ta_gw('owner.codex', 'mcp:ping')::jsonb ->> 'ok')::boolean);
  -- That says nothing about anyone else: each other role is refused on its own account.
  perform pg_temp.t3802ta_ok('TA-8', 'while the owner is exempt, a teammate''s key is still judged on the teammate''s own account',
    (pg_temp.t3802ta_gw('growth.claude', 'mcp:ping')::jsonb ->> 'ok')::boolean);
  update auth.users set phone = '15550003802' where id = '38020000-0000-4000-f000-000000000002';
  select count(*) into v_rows from public.team_agent_calls;
  v := pg_temp.t3802ta_gw('admin.claude', 'mcp:ping');
  perform pg_temp.t3802ta_ok('TA-8', 'a full admin who is not the owner is refused, with the one answer',
    v::jsonb = '{"auth":"invalid"}'::jsonb, left(v, 120));
  perform pg_temp.t3802ta_ok('TA-8', 'and that key is ended for that reason, by nobody in particular',
    (select revoke_reason = 'address_rule' and revoked_by = 'system' from public.team_agent_keys where id = pg_temp.t3802ta_id('admin.claude.id')::uuid));
  insert into auth.identities (user_id, provider) values ('38020000-0000-4000-f000-000000000003', 'google');
  v := pg_temp.t3802ta_gw('growth.codex', 'my_day');
  perform pg_temp.t3802ta_ok('TA-8', 'a teammate whose account gained a social sign-in is refused on the very next request',
    v::jsonb = '{"auth":"invalid"}'::jsonb, left(v, 120));
  perform pg_temp.t3802ta_ok('TA-8', 'only the key that was used is ended',
    (select count(*) filter (where revoked_at is null) = 1 from public.team_agent_keys where owner_email = 'issue3802ta-growth@test.local'));
  v := pg_temp.t3802ta_gw('growth.claude', 'mcp:ping');
  perform pg_temp.t3802ta_ok('TA-8', 'the person''s other key is ended when it is next used',
    v::jsonb = '{"auth":"invalid"}'::jsonb
    and (select count(*) filter (where revoked_at is null) = 0 from public.team_agent_keys where owner_email = 'issue3802ta-growth@test.local'), left(v, 120));
  -- Putting the account right does not bring an ended key back.
  delete from auth.identities where user_id = '38020000-0000-4000-f000-000000000003';
  update auth.users set phone = null where id = '38020000-0000-4000-f000-000000000002';
  perform pg_temp.t3802ta_ok('TA-8', 'putting the account right does not bring an ended key back',
    pg_temp.t3802ta_gw('admin.claude', 'mcp:ping')::jsonb = '{"auth":"invalid"}'::jsonb
    and pg_temp.t3802ta_gw('growth.codex', 'mcp:ping')::jsonb = '{"auth":"invalid"}'::jsonb);
  perform pg_temp.t3802ta_ok('TA-8', 'the refused requests left no request row',
    (select count(*) from public.team_agent_calls) = v_rows, v_rows::text);
  update auth.users set phone = null where id = '38020000-0000-4000-f000-000000000001';
end;
$ta8$;

-- ---------------------------------------------------------------------------
-- Retest additions (after the rework). The bare CI image has no banned_until
-- or deleted_at on auth.users; they are added here, inside this rolled-back
-- transaction, in the shape the sign-in service gives them.
--
--   TA-9   requests on one key are taken one at a time, and only on that key
--   TA-10  an agent's "today" is its person's own date: two keys whose zones
--          are always on different dates never share a "today"; the answer
--          says which date and zone it used; the same person on screen gets
--          the same answer for that date; a request can name its own date or
--          zone, within reason; a zone nobody has heard of is never stored
--   TA-11  an account that can no longer sign in cannot act through a key,
--          and that never touches anyone else's key
-- ---------------------------------------------------------------------------
alter table auth.users add column if not exists banned_until timestamptz;
alter table auth.users add column if not exists deleted_at timestamptz;

do $ta9$
declare
  v text;
  v_mine bigint;
  v_other bigint;
begin
  perform pg_temp.t3802ta_newkey('owner', 'claude', 'r.owner');
  perform pg_temp.t3802ta_newkey('partner', 'claude', 'r.partner');
  v := pg_temp.t3802ta_gw('r.owner', 'mcp:ping');
  -- hashtextextended gives one 64-bit number; an advisory lock stores it as
  -- two 32-bit halves.
  select count(*) into v_mine from pg_catalog.pg_locks l
   where l.locktype = 'advisory' and l.pid = pg_backend_pid() and l.granted
     and ((l.classid::bigint << 32) | l.objid::bigint)
         = pg_catalog.hashtextextended('team_agent_limit:' || pg_temp.t3802ta_id('r.owner.id'), 0);
  select count(*) into v_other from pg_catalog.pg_locks l
   where l.locktype = 'advisory' and l.pid = pg_backend_pid() and l.granted
     and ((l.classid::bigint << 32) | l.objid::bigint)
         = pg_catalog.hashtextextended('team_agent_limit:' || pg_temp.t3802ta_id('r.partner.id'), 0);
  perform pg_temp.t3802ta_ok('TA-9', 'a served request holds its own key''s turn until its transaction ends',
    (v::jsonb ->> 'ok')::boolean and v_mine = 1, v_mine::text);
  perform pg_temp.t3802ta_ok('TA-9', 'and holds nobody else''s', v_other = 0, v_other::text);
  select count(*) into v_other from pg_catalog.pg_locks l where l.locktype = 'advisory' and l.pid = pg_backend_pid();
  v := pg_temp.t3802ta_as('service', format('select public.team_agent_call(%L, %L, %L::jsonb, %L)::text',
    repeat('c', 64), 'mcp:ping', '{}', 'x'));
  perform pg_temp.t3802ta_ok('TA-9', 'a key nobody holds takes no turn at all',
    v::jsonb = '{"auth":"invalid"}'::jsonb
    and (select count(*) from pg_catalog.pg_locks l where l.locktype = 'advisory' and l.pid = pg_backend_pid()) = v_other);
end;
$ta9$;

do $ta10$
declare
  v text;
  v_east jsonb;
  v_west jsonb;
  v_none jsonb;
  d_east date := (clock_timestamp() at time zone 'Pacific/Kiritimati')::date;   -- 14 hours ahead of UTC
  d_west date := (clock_timestamp() at time zone 'Etc/GMT+12')::date;           -- 12 hours behind UTC
  d_utc  date := (clock_timestamp() at time zone 'UTC')::date;
  v_screen jsonb;
  v_drafts integer;
  v_other_drafts integer;
  z text;
begin
  -- A record due on each of the three dates that can be "today" somewhere.
  insert into public.crm_records (pipeline, name, stage, due_on, created_by, updated_by)
  select 'hosts', 'Issue3802ta Day ' || (array['before', 'same', 'after'])[g + 2], 'prospect', d_utc + g, 'issue3802ta-growth@test.local', 'issue3802ta-growth@test.local'
  from generate_series(-1, 1) g;
  insert into public.crm_record_owners (record_id, owner_email, added_by)
  select r.id, 'issue3802ta-partner@test.local', 'issue3802ta-admin@test.local' from public.crm_records r where r.name like 'Issue3802ta Day %';

  v := pg_temp.t3802ta_as('partner', $q$select public.team_agent_key_create('claude', 'Pacific/Kiritimati')::text$q$);
  insert into t3802ta_ids (k, v) values ('z.east', v::jsonb ->> 'key'), ('z.east.id', v::jsonb ->> 'key_id');
  perform pg_temp.t3802ta_ok('TA-10', 'a key remembers the zone it was made in, and says so once', v::jsonb ->> 'time_zone' = 'Pacific/Kiritimati', left(v, 80));
  v := pg_temp.t3802ta_as('partner', $q$select public.team_agent_key_create('codex', 'Etc/GMT+12')::text$q$);
  insert into t3802ta_ids (k, v) values ('z.west', v::jsonb ->> 'key'), ('z.west.id', v::jsonb ->> 'key_id');
  perform pg_temp.t3802ta_ok('TA-10', 'the two zones are on different dates right now, whenever this runs', d_east > d_west and d_east - d_west in (1, 2));

  v_east := pg_temp.t3802ta_gw('z.east', 'my_day')::jsonb;
  v_west := pg_temp.t3802ta_gw('z.west', 'my_day')::jsonb;
  perform pg_temp.t3802ta_ok('TA-10', 'each key''s "today" is the date in its own zone',
    v_east #>> '{dates,today}' = d_east::text and v_west #>> '{dates,today}' = d_west::text
    and v_east #>> '{result,today}' = d_east::text and v_west #>> '{result,today}' = d_west::text,
    (v_east -> 'dates')::text || ' / ' || (v_west -> 'dates')::text);
  perform pg_temp.t3802ta_ok('TA-10', 'the answer says the date, the zone, and where each came from',
    v_east -> 'dates' = jsonb_build_object('today', d_east, 'time_zone', 'Pacific/Kiritimati', 'zone_from', 'your key', 'date_from', 'the clock'),
    (v_east -> 'dates')::text);
  -- The same person, on screen, at this instant, in each of those places.
  v_drafts := pg_temp.t3802ta_as('partner', $q$select public.team_draft_counts() ->> 'waiting'$q$)::integer;
  v_other_drafts := pg_temp.t3802ta_as('owner', $q$select public.team_draft_counts() ->> 'waiting'$q$)::integer;
  v_screen := pg_temp.t3802ta_as('partner', format('select public.crm_home_summary(%L)::text', d_east))::jsonb
    || jsonb_build_object('drafts_waiting', v_drafts);
  perform pg_temp.t3802ta_ok('TA-10', 'east of the date line the agent matches its person''s screen and private count only',
    v_east -> 'result' = v_screen
    and (v_east #>> '{result,drafts_waiting}')::integer = v_drafts
    and v_drafts <> v_other_drafts
    and v_east::text not like '%Issue3802ta private draft%');
  v_screen := pg_temp.t3802ta_as('partner', format('select public.crm_home_summary(%L)::text', d_west))::jsonb
    || jsonb_build_object('drafts_waiting', v_drafts);
  perform pg_temp.t3802ta_ok('TA-10', 'west of it too, with no other person''s count or any draft text',
    v_west -> 'result' = v_screen
    and (v_west #>> '{result,drafts_waiting}')::integer = v_drafts
    and v_drafts <> v_other_drafts
    and v_west::text not like '%Issue3802ta private draft%');
  perform pg_temp.t3802ta_ok('TA-10', 'and the two answers differ, because the day differs', v_east -> 'result' <> v_west -> 'result');

  -- find_records measures "due" from the same date.
  v_east := pg_temp.t3802ta_gw('z.east', 'find_records', '{"pipeline":"hosts","q":"Issue3802ta Day","due":"today"}')::jsonb;
  v_west := pg_temp.t3802ta_gw('z.west', 'find_records', '{"pipeline":"hosts","q":"Issue3802ta Day","due":"today"}')::jsonb;
  perform pg_temp.t3802ta_ok('TA-10', 'due today is due on the key''s own date',
    (select count(*) = 1 and bool_and(r ->> 'due_on' = d_east::text) from jsonb_array_elements(v_east #> '{result,records}') r)
    and (select count(*) = 1 and bool_and(r ->> 'due_on' = d_west::text) from jsonb_array_elements(v_west #> '{result,records}') r)
    and v_east #>> '{dates,today}' = d_east::text and v_west #>> '{dates,today}' = d_west::text);
  v_west := pg_temp.t3802ta_gw('z.west', 'find_records', '{"pipeline":"hosts","q":"Issue3802ta Day","due":"overdue"}')::jsonb;
  perform pg_temp.t3802ta_ok('TA-10', 'overdue is before the key''s own date, not before the date in UTC',
    (select coalesce(bool_and((r ->> 'due_on')::date < d_west), true) and count(*) = (d_west - (d_utc - 1))
       from jsonb_array_elements(v_west #> '{result,records}') r));
  perform pg_temp.t3802ta_ok('TA-10', 'a count carries the date it was counted for',
    pg_temp.t3802ta_gw('z.east', 'find_records', '{"pipeline":"hosts","count_by":["stage"]}')::jsonb #>> '{dates,time_zone}' = 'Pacific/Kiritimati');
  perform pg_temp.t3802ta_ok('TA-10', 'a tool that does not depend on the day carries no date',
    not (pg_temp.t3802ta_gw('z.east', 'get_started')::jsonb ? 'dates')
    and not (pg_temp.t3802ta_gw('z.east', 'list_beta_leads')::jsonb ? 'dates')
    and not (pg_temp.t3802ta_gw('z.east', 'mcp:ping')::jsonb ? 'dates'));

  -- A key with no zone: UTC, and it says so.
  v_none := pg_temp.t3802ta_gw('r.owner', 'my_day')::jsonb;
  perform pg_temp.t3802ta_ok('TA-10', 'a key with no zone uses the date in UTC and says that is why',
    v_none -> 'dates' = jsonb_build_object('today', d_utc, 'time_zone', 'UTC', 'zone_from', 'no zone is recorded for your key, so UTC', 'date_from', 'the clock'),
    (v_none -> 'dates')::text);

  -- One request can name its own zone or date.
  v_none := pg_temp.t3802ta_gw('r.owner', 'my_day', '{"time_zone":"Pacific/Kiritimati"}')::jsonb;
  perform pg_temp.t3802ta_ok('TA-10', 'a request may name a zone', v_none #>> '{dates,today}' = d_east::text and v_none #>> '{dates,zone_from}' = 'this request');
  v_none := pg_temp.t3802ta_gw('z.east', 'my_day', format('{"today":"%s"}', d_utc - 1))::jsonb;
  perform pg_temp.t3802ta_ok('TA-10', 'a request may name its person''s date, a day either side of UTC',
    v_none #>> '{dates,today}' = (d_utc - 1)::text and v_none #>> '{dates,date_from}' = 'this request' and v_none #>> '{result,today}' = (d_utc - 1)::text);
  perform pg_temp.t3802ta_ok('TA-10', 'the other side too',
    pg_temp.t3802ta_gw('z.west', 'find_records', format('{"pipeline":"hosts","today":"%s"}', d_utc + 1))::jsonb #>> '{dates,today}' = (d_utc + 1)::text);
  perform pg_temp.t3802ta_ok('TA-10', 'no further: a date two days off is refused in plain words, and is not used',
    not exists (
      select 1 from unnest(array[d_utc + 2, d_utc - 2, d_utc + 400]) d, unnest(array['my_day', 'team_summary']) t
       where pg_temp.t3802ta_gw('r.owner', t, format('{"today":"%s"}', d))::jsonb #>> '{error,token}' is distinct from 'invalid_arguments')
    and pg_temp.t3802ta_gw('z.east', 'find_records', format('{"pipeline":"hosts","today":"%s"}', d_utc + 2))::jsonb #>> '{error,message}' ~ '^"today" is missing or the wrong kind\. Send your person''s own date');
  foreach z in array array['Mars/Olympus', 'america/new_york', 'UTC+25', ' UTC', '', 'UTC''; select pg_sleep(9);--', repeat('A', 65), '../../etc/passwd'] loop
    v := pg_temp.t3802ta_gw('z.east', 'my_day', jsonb_build_object('time_zone', z)::text);
    perform pg_temp.t3802ta_ok('TA-10', 'a zone nobody has heard of is refused: ' || left(z, 20),
      v::jsonb #>> '{error,token}' = 'invalid_arguments' and v::jsonb #>> '{error,message}' = '"time_zone" is missing or the wrong kind. Send a zone name such as America/New_York.', left(v, 160));
    v := pg_temp.t3802ta_as('mover', format('select public.team_agent_key_create(%L, %L) ->> %L', 'codex', z, 'time_zone'));
    perform pg_temp.t3802ta_ok('TA-10', 'and is never stored on a key: ' || left(z, 20), v is null, coalesce(v, '<null>'));
  end loop;
  perform pg_temp.t3802ta_ok('TA-10', 'a zone value that is not text is refused too',
    pg_temp.t3802ta_gw('z.east', 'my_day', '{"time_zone":{"a":1}}')::jsonb #>> '{error,token}' = 'invalid_arguments'
    and pg_temp.t3802ta_gw('z.east', 'my_day', '{"today":["2026-10-13"]}')::jsonb #>> '{error,token}' = 'invalid_arguments');
  perform pg_temp.t3802ta_ok('TA-10', 'every stored zone is one the server knows, or none',
    not exists (select 1 from public.team_agent_keys k where k.time_zone is not null
                 and not exists (select 1 from pg_catalog.pg_timezone_names n where n.name = k.time_zone)));
  perform pg_temp.t3802ta_ok('TA-10', 'the person''s list of keys shows the zone, so the card can say it',
    (select bool_or(k ->> 'time_zone' = 'Pacific/Kiritimati') from jsonb_array_elements(pg_temp.t3802ta_as('partner', 'select public.team_agent_keys_mine()::text')::jsonb -> 'keys') k));
end;
$ta10$;

do $ta11$
declare
  v text;
  v_before jsonb;
  v_after jsonb;
begin
  perform pg_temp.t3802ta_newkey('mover', 'claude', 'b.mover');
  perform pg_temp.t3802ta_newkey('admin', 'claude', 'b.admin');
  perform pg_temp.t3802ta_newkey('admin', 'codex', 'b.admin2');
  select jsonb_agg(to_jsonb(t) order by t.id) into v_before from public.team_agent_keys t where t.owner_email <> 'issue3802ta-mover@test.local';

  update auth.users set banned_until = now() - interval '1 minute' where email = 'issue3802ta-mover@test.local';
  perform pg_temp.t3802ta_ok('TA-11', 'a ban that has ended changes nothing', (pg_temp.t3802ta_gw('b.mover', 'mcp:ping')::jsonb ->> 'ok')::boolean);
  update auth.users set banned_until = now() + interval '1 hour' where email = 'issue3802ta-mover@test.local';
  v := pg_temp.t3802ta_gw('b.mover', 'my_day');
  perform pg_temp.t3802ta_ok('TA-11', 'a banned account gets the one answer every unusable key gets', v::jsonb = '{"auth":"invalid"}'::jsonb, left(v, 120));
  perform pg_temp.t3802ta_ok('TA-11', 'and its key is ended, by nobody in particular',
    (select revoked_at is not null and revoked_by = 'system' and revoke_reason = 'access_removed'
       from public.team_agent_keys where id = pg_temp.t3802ta_id('b.mover.id')::uuid));
  update auth.users set banned_until = null where email = 'issue3802ta-mover@test.local';
  perform pg_temp.t3802ta_ok('TA-11', 'lifting the ban does not bring the key back',
    pg_temp.t3802ta_gw('b.mover', 'mcp:ping')::jsonb = '{"auth":"invalid"}'::jsonb);
  perform pg_temp.t3802ta_newkey('mover', 'claude', 'b.mover2');
  perform pg_temp.t3802ta_ok('TA-11', 'the person can make a new one once they can sign in again',
    (pg_temp.t3802ta_gw('b.mover2', 'mcp:ping')::jsonb ->> 'ok')::boolean);
  update auth.users set deleted_at = now() where email = 'issue3802ta-mover@test.local';
  v := pg_temp.t3802ta_gw('b.mover2', 'mcp:ping');
  perform pg_temp.t3802ta_ok('TA-11', 'a deleted account gets the same answer, and its key is ended',
    v::jsonb = '{"auth":"invalid"}'::jsonb
    and (select revoke_reason = 'access_removed' from public.team_agent_keys where id = pg_temp.t3802ta_id('b.mover2.id')::uuid), left(v, 120));
  update auth.users set deleted_at = null where email = 'issue3802ta-mover@test.local';

  select jsonb_agg(to_jsonb(t) - 'last_used_at' - 'last_used_client' order by t.id) into v_after
    from public.team_agent_keys t where t.owner_email <> 'issue3802ta-mover@test.local';
  perform pg_temp.t3802ta_ok('TA-11', 'none of that touched anyone else''s key',
    v_after = (select jsonb_agg(e - 'last_used_at' - 'last_used_client' order by e ->> 'id') from jsonb_array_elements(v_before) e));
  perform pg_temp.t3802ta_ok('TA-11', 'and everyone else''s key still works',
    (pg_temp.t3802ta_gw('b.admin', 'mcp:ping')::jsonb ->> 'ok')::boolean and (pg_temp.t3802ta_gw('b.admin2', 'mcp:ping')::jsonb ->> 'ok')::boolean);
  -- Only the account the key belongs to counts: another account being
  -- banned, even one with a look-alike address, ends nothing.
  insert into auth.users (id, email, email_confirmed_at, banned_until)
  values ('38020000-0000-4000-f000-0000000000ee', 'issue3802ta-admin+other@test.local', now(), now() + interval '1 hour');
  perform pg_temp.t3802ta_ok('TA-11', 'someone else''s banned account ends nobody''s key',
    (pg_temp.t3802ta_gw('b.admin', 'mcp:ping')::jsonb ->> 'ok')::boolean);
end;
$ta11$;

-- ---------------------------------------------------------------------------
-- Report.
-- ---------------------------------------------------------------------------
do $report$
declare
  r record;
  v_n integer;
  v_f integer;
begin
  select count(*), count(*) filter (where not ok) into v_n, v_f from t3802ta_results;
  for r in select * from t3802ta_results where not ok order by seq loop
    raise notice 'FAILED % — % (%)', r.test, r.label, r.detail;
  end loop;
  if v_f > 0 then
    raise exception 'ISSUE-3802 AGENT KEYS TESTER FAIL: % of % checks failed', v_f, v_n;
  end if;
  if v_n < 100 then
    raise exception 'ISSUE-3802 AGENT KEYS TESTER FAIL: only % checks ran', v_n;
  end if;
  raise notice 'ISSUE-3802 AGENT KEYS TESTER PASS: % checks, 0 failed', v_n;
end;
$report$;

rollback;
