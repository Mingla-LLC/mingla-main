-- Issue #3980 Wave 2 -- the Calendar, the team's read of events, runway,
-- expected events on host cards, and leaving Needs a person, on the fully
-- replayed PG17 schema.
--
-- What it proves (each check is recorded and reported together):
--   W2-SCOPE     a Sales and marketing teammate reads the Calendar; events
--                public on Mingla show, a draft of a brand linked to a host
--                card shows as not public; private, hidden, deleted and
--                cancelled events and drafts of unlinked brands never show;
--                no address, theme or organiser contact is returned; a
--                window over 100 days is refused; the Offerings console stays
--                closed to the same teammate; off-team and anon are refused
--   W2-RUNWAY    28 days or more is full, 21 to 27 tight, under 21 organic,
--                at the exact edges; a draft shows its go-live date, and
--                missed once fewer than 21 days are left; deadlines and promo
--                starts land on the right days; the runway report counts and
--                lists what is at risk
--   W2-EXPECTED  a host's expected event is added, repeats safely, refuses a
--                duplicate, a creator card and bad input (all fixes at once),
--                shows dashed with its deadline, is cancelled with a reason;
--                the connector's calendar tools answer
--   W2-RECONCILE housekeeping links an expected event to the host's public
--                event within 3 days and moves its cards; not 4 days away
--   W2-BACK      an agent moving a card that needs a person back to To do
--                must say why; the reason is logged and watchers are told
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


select pg_temp.t3980_newkey('growth', 'claude', 'A') is not null as key_a;

-- ---------------------------------------------------------------------------
-- Fixtures. Day 0 is today at 00:00 UTC; each event starts at 20:00 UTC on
-- day N and went public L days and one hour before that (lead = L days).
-- ---------------------------------------------------------------------------
create function pg_temp.t3980_day(p_n integer) returns timestamptz
language sql as $fn$ select (date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') + make_interval(days => p_n, hours => 20) $fn$;

create function pg_temp.t3980_event(p_key text, p_brand text, p_title text, p_vis text, p_status text, p_day integer, p_lead integer,
                                    p_deleted boolean default false) returns void
language plpgsql as $fn$
declare v_id uuid := gen_random_uuid();
begin
  set local session_replication_role = replica;
  insert into public.events (id, brand_id, title, slug, visibility, status, timezone, published_at, event_type, location_text, deleted_at)
  values (v_id, p_brand::uuid, p_title, 'w3980-' || lower(regexp_replace(p_title, '[^A-Za-z0-9]+', '-', 'g')) || '-' || left(v_id::text, 8),
          p_vis, p_status, 'UTC',
          case when p_lead is null then null else pg_temp.t3980_day(p_day) - make_interval(days => p_lead, hours => 1) end,
          'event', 'W3980 Secret Street 9', case when p_deleted then now() else null end);
  insert into public.event_dates (event_id, start_at, end_at, is_master)
  values (v_id, pg_temp.t3980_day(p_day), pg_temp.t3980_day(p_day) + interval '3 hours', true);
  set local session_replication_role = origin;
  perform pg_temp.t3980_keep(p_key, v_id::text);
end;
$fn$;

set local session_replication_role = replica;
insert into public.brands (id, account_id, name, slug, city) values
  ('39800000-0000-4000-b200-000000000001', '39800000-0000-4000-b300-000000000002', 'W3980 Linked Brand', 'w3980-linked-brand', 'Lagos'),
  ('39800000-0000-4000-b200-000000000002', '39800000-0000-4000-b300-000000000003', 'W3980 Other Brand', 'w3980-other-brand', 'London');
set local session_replication_role = origin;

insert into public.crm_records (id, pipeline, name, stage, brand_id, created_by, updated_by) values
  ('39800000-0000-4000-c100-000000000001', 'hosts', 'W3980 Palm Host', 'onboarded', '39800000-0000-4000-b200-000000000001', 'w3980-fixture', 'w3980-fixture');
insert into public.crm_records (id, pipeline, name, stage, created_by, updated_by) values
  ('39800000-0000-4000-c100-000000000002', 'creators', 'W3980 Some Creator', 'identified', 'w3980-fixture', 'w3980-fixture');
insert into public.crm_record_owners (record_id, owner_email, added_by) values
  ('39800000-0000-4000-c100-000000000001', 'ada.w3980@test.local', 'w3980-fixture');

select pg_temp.t3980_keep('today', ((now() AT TIME ZONE 'UTC')::date)::text);
select pg_temp.t3980_keep('host', '39800000-0000-4000-c100-000000000001');
select pg_temp.t3980_keep('creator', '39800000-0000-4000-c100-000000000002');

-- Linked brand: public 30, 28, 27, 24, 21, 20 and 10 days ahead; a draft
-- 40 days out (not public, in view); a draft 15 days out (missed); a private
-- and a hidden draft (never shown); a deleted public event (never shown); a
-- cancelled one (never shown); one listed public through the public view.
select pg_temp.t3980_event('e_full',    '39800000-0000-4000-b200-000000000001', 'W3980 Full Night',    'discover', 'scheduled', 29, 30),
       pg_temp.t3980_event('e_28',      '39800000-0000-4000-b200-000000000001', 'W3980 Edge 28',       'discover', 'scheduled', 27, 28),
       pg_temp.t3980_event('e_27',      '39800000-0000-4000-b200-000000000001', 'W3980 Edge 27',       'discover', 'scheduled', 26, 27),
       pg_temp.t3980_event('e_tight',   '39800000-0000-4000-b200-000000000001', 'W3980 Tight Night',   'discover', 'scheduled', 23, 24),
       pg_temp.t3980_event('e_21',      '39800000-0000-4000-b200-000000000001', 'W3980 Edge 21',       'discover', 'scheduled', 20, 21),
       pg_temp.t3980_event('e_20',      '39800000-0000-4000-b200-000000000001', 'W3980 Edge 20',       'discover', 'scheduled', 19, 20),
       pg_temp.t3980_event('e_organic', '39800000-0000-4000-b200-000000000001', 'W3980 Organic Night', 'discover', 'scheduled', 9, 10),
       pg_temp.t3980_event('e_draft',   '39800000-0000-4000-b200-000000000001', 'W3980 Draft Night',   'draft',    'draft',     40, null),
       pg_temp.t3980_event('e_missed',  '39800000-0000-4000-b200-000000000001', 'W3980 Late Draft',    'draft',    'draft',     15, null),
       pg_temp.t3980_event('e_private', '39800000-0000-4000-b200-000000000001', 'W3980 Private Draft', 'private',  'draft',     33, null),
       pg_temp.t3980_event('e_hidden',  '39800000-0000-4000-b200-000000000001', 'W3980 Hidden Draft',  'hidden',   'draft',     34, null),
       pg_temp.t3980_event('e_deleted', '39800000-0000-4000-b200-000000000001', 'W3980 Deleted Night', 'discover', 'scheduled', 31, 35, true),
       pg_temp.t3980_event('e_cancel',  '39800000-0000-4000-b200-000000000001', 'W3980 Cancelled',     'discover', 'cancelled', 32, 35),
       pg_temp.t3980_event('e_pubview', '39800000-0000-4000-b200-000000000001', 'W3980 Public View',   'public',   'scheduled', 36, 37),
-- Other brand (no host card): public is shown, a draft is not.
       pg_temp.t3980_event('e_other',   '39800000-0000-4000-b200-000000000002', 'W3980 Other Public',  'discover', 'scheduled', 37, 40),
       pg_temp.t3980_event('e_odraft',  '39800000-0000-4000-b200-000000000002', 'W3980 Other Draft',   'draft',    'draft',     38, null);

create function pg_temp.t3980_ev(p_cal text, p_key text) returns jsonb
language sql as $fn$
  select e from jsonb_array_elements(coalesce(pg_temp.t3980_j(p_cal)->'events', '[]'::jsonb)) e where e->>'id' = pg_temp.t3980_id(p_key)
$fn$;

-- ---------------------------------------------------------------------------
-- W2-SCOPE and W2-RUNWAY: what the team sees, and the bands
-- ---------------------------------------------------------------------------
do $scope$
declare v text; v_today date := pg_temp.t3980_id('today')::date; k text;
begin
  v := pg_temp.t3980_person('growth', format('select public.ops_calendar(%L, %L, %L)::text', v_today - 30, v_today + 60, v_today));
  perform pg_temp.t3980_check('W2-SCOPE', 'a Sales and marketing teammate can read the Calendar', (pg_temp.t3980_j(v) ? 'events')::text, 'true');
  foreach k in array array['e_full','e_28','e_27','e_tight','e_21','e_20','e_organic','e_pubview','e_other'] loop
    perform pg_temp.t3980_check('W2-SCOPE', k || ' is public on Mingla and shown as public',
      pg_temp.t3980_ev(v, k)->>'is_public', 'true');
  end loop;
  perform pg_temp.t3980_check('W2-SCOPE', 'a draft of a brand linked to a host card is shown, not public',
    pg_temp.t3980_ev(v, 'e_draft')->>'is_public', 'false');
  foreach k in array array['e_private','e_hidden','e_deleted','e_cancel','e_odraft'] loop
    perform pg_temp.t3980_check('W2-SCOPE', k || ' never shows on the Calendar', (pg_temp.t3980_ev(v, k) is null)::text, 'true');
  end loop;
  perform pg_temp.t3980_check('W2-SCOPE', 'no address, theme or organiser contact is ever returned',
    (v not like '%Secret Street%' and v !~ '"(location_text|location_geo|theme|organiser_contact)"')::text, 'true');
  perform pg_temp.t3980_check('W2-SCOPE', 'the event carries its host card and owners',
    (pg_temp.t3980_ev(v, 'e_full')->'host'->>'name') || '/' || (pg_temp.t3980_ev(v, 'e_full')->'host'->'owners'->>0), 'W3980 Palm Host/Ada');

  -- the bands, at their exact edges
  perform pg_temp.t3980_check('W2-RUNWAY', 'public 30 days ahead is a full launch',
    (pg_temp.t3980_ev(v, 'e_full')->'runway'->>'band') || '/' || (pg_temp.t3980_ev(v, 'e_full')->'runway'->>'lead_days'), 'full/30');
  perform pg_temp.t3980_check('W2-RUNWAY', 'exactly 28 days is still a full launch',
    (pg_temp.t3980_ev(v, 'e_28')->'runway'->>'band') || '/' || (pg_temp.t3980_ev(v, 'e_28')->'runway'->>'lead_days'), 'full/28');
  perform pg_temp.t3980_check('W2-RUNWAY', '27 days is tight',
    (pg_temp.t3980_ev(v, 'e_27')->'runway'->>'band') || '/' || (pg_temp.t3980_ev(v, 'e_27')->'runway'->>'lead_days'), 'tight/27');
  perform pg_temp.t3980_check('W2-RUNWAY', '24 days is tight',
    (pg_temp.t3980_ev(v, 'e_tight')->'runway'->>'band'), 'tight');
  perform pg_temp.t3980_check('W2-RUNWAY', 'exactly 21 days is still tight',
    (pg_temp.t3980_ev(v, 'e_21')->'runway'->>'band') || '/' || (pg_temp.t3980_ev(v, 'e_21')->'runway'->>'lead_days'), 'tight/21');
  perform pg_temp.t3980_check('W2-RUNWAY', '20 days is organic only',
    (pg_temp.t3980_ev(v, 'e_20')->'runway'->>'band') || '/' || (pg_temp.t3980_ev(v, 'e_20')->'runway'->>'lead_days'), 'organic/20');
  perform pg_temp.t3980_check('W2-RUNWAY', '10 days is organic only',
    (pg_temp.t3980_ev(v, 'e_organic')->'runway'->>'band'), 'organic');
  perform pg_temp.t3980_check('W2-RUNWAY', 'a draft 40 days out is not live yet and must go live 28 days before it starts',
    (pg_temp.t3980_ev(v, 'e_draft')->'runway'->>'band') || '/' || (pg_temp.t3980_ev(v, 'e_draft')->'runway'->>'go_live_by')
      || '/' || (pg_temp.t3980_ev(v, 'e_draft')->'runway'->>'promo_from'),
    'not_live/' || (v_today + 12)::text || '/' || (v_today + 19)::text);
  perform pg_temp.t3980_check('W2-RUNWAY', 'a draft 15 days out has missed go-live',
    (pg_temp.t3980_ev(v, 'e_missed')->'runway'->>'band'), 'missed');
  perform pg_temp.t3980_check('W2-RUNWAY', 'the draft''s go-live deadline is on the Calendar under the host''s name',
    (select d->>'label' || '/' || (d->>'date') from jsonb_array_elements(pg_temp.t3980_j(v)->'deadlines') d where d->>'anchor_id' = pg_temp.t3980_id('e_draft')),
    'Go live: W3980 Palm Host/' || (v_today + 12)::text);
  perform pg_temp.t3980_check('W2-RUNWAY', 'a full launch has its promo start marker 21 days before',
    (select p->>'date' from jsonb_array_elements(pg_temp.t3980_j(v)->'promotions') p
      where p->>'anchor_id' = pg_temp.t3980_id('e_full') and p->>'source' = 'promo_start'), (v_today + 8)::text);
  perform pg_temp.t3980_check('W2-RUNWAY', 'an organic-only event gets no promo start marker',
    (select count(*) from jsonb_array_elements(pg_temp.t3980_j(v)->'promotions') p where p->>'anchor_id' = pg_temp.t3980_id('e_20'))::text, '0');

  v := pg_temp.t3980_person('growth', format('select public.ops_calendar(%L, %L, %L)::text', v_today, v_today + 100, v_today));
  perform pg_temp.t3980_like('W2-SCOPE', 'a window over 100 days is refused', v, 'ERR:22023:invalid_window: Ask for at most 100 days at a time.%');
  v := pg_temp.t3980_person('growth', format('select public.ops_calendar(%L, %L, %L)::text', v_today, v_today + 99, v_today));
  perform pg_temp.t3980_check('W2-SCOPE', 'a window of exactly 100 days is answered', (pg_temp.t3980_j(v) ? 'events')::text, 'true');
  v := pg_temp.t3980_person('growth', $q$select public.admin_list_offerings(null, null, null, null, null, null, null, null, null, null, null, 10, 0)::text$q$);
  perform pg_temp.t3980_like('W2-SCOPE', 'the Offerings console stays closed to Sales and marketing', v, 'ERR:%');
  v := pg_temp.t3980_person('nobody', format('select public.ops_calendar(%L, %L)::text', v_today, v_today + 30));
  perform pg_temp.t3980_like('W2-SCOPE', 'someone off the team cannot read the Calendar', v, 'ERR:42501:%');
  v := pg_temp.t3980_as('anon', format('select public.ops_calendar(%L, %L)::text', v_today, v_today + 30));
  perform pg_temp.t3980_like('W2-SCOPE', 'anon cannot read the Calendar', v, 'ERR:42501:%');
  v := pg_temp.t3980_person('growth', format('select public.ops_promotions(%L, %L)::text', v_today, v_today + 30));
  perform pg_temp.t3980_like('W2-SCOPE', 'a teammate cannot call the internal promotions function directly', v, 'ERR:42501:%');

  v := pg_temp.t3980_person('partner', format('select public.ops_runway_report(%L, %L, %L)::text', v_today, v_today + 60, v_today));
  perform pg_temp.t3980_check('W2-RUNWAY', 'the runway report counts each band',
    pg_temp.t3980_get(v, 'counts', 'full') || '/' || pg_temp.t3980_get(v, 'counts', 'tight') || '/' || pg_temp.t3980_get(v, 'counts', 'organic')
      || '/' || pg_temp.t3980_get(v, 'counts', 'not_live') || '/' || pg_temp.t3980_get(v, 'counts', 'missed'),
    '4/3/2/1/1');
  perform pg_temp.t3980_check('W2-RUNWAY', 'at risk: the draft due to go live within 14 days and the missed one',
    (select string_agg(r->>'title', ',' order by r->>'title') from jsonb_array_elements(pg_temp.t3980_j(v)->'at_risk') r),
    'W3980 Draft Night,W3980 Late Draft');
end;
$scope$;

-- ---------------------------------------------------------------------------
-- W2-EXPECTED: the next event a host promised
-- ---------------------------------------------------------------------------
do $expected$
declare v text; v_today date := pg_temp.t3980_id('today')::date; v_item text;
begin
  v_item := format('{"record_id":"%s","title":"W3980 Supper Club","event_type":"event","expected_on":"%s","city":"Lagos"}', pg_temp.t3980_id('host'), v_today + 45);
  v := pg_temp.t3980_person('growth', format('select public.ops_expected_event_set(%L::jsonb, %L)::text', v_item, 'w3980-exp-0001'));
  perform pg_temp.t3980_check('W2-EXPECTED', 'a teammate adds the host''s expected event',
    pg_temp.t3980_get(v, 'status') || '/' || pg_temp.t3980_get(v, 'expected', 'runway', 'band') || '/' || pg_temp.t3980_get(v, 'expected', 'runway', 'go_live_by'),
    'created/not_live/' || (v_today + 17)::text);
  perform pg_temp.t3980_keep('x1', pg_temp.t3980_get(v, 'expected', 'id'));
  v := pg_temp.t3980_person('growth', format('select public.ops_expected_event_set(%L::jsonb, %L)::text', v_item, 'w3980-exp-0001'));
  perform pg_temp.t3980_check('W2-EXPECTED', 'the same request again changes nothing', pg_temp.t3980_get(v, 'replayed'), 'true');
  v := pg_temp.t3980_person('growth2', format('select public.ops_expected_event_set(%L::jsonb, %L)::text', v_item, 'w3980-exp-0002'));
  perform pg_temp.t3980_like('W2-EXPECTED', 'a second open one with the same title and date is refused, naming the first',
    v, 'ERR:22023:duplicate_expected: An open expected event already matches: "W3980 Supper Club"%' || pg_temp.t3980_id('x1') || '%');
  v := pg_temp.t3980_person('growth', format('select public.ops_expected_event_set(%L::jsonb, NULL)::text', v_item));
  perform pg_temp.t3980_like('W2-EXPECTED', 'a request key is required', v, 'ERR:22023:request_key_required:%');
  v := pg_temp.t3980_person('growth', format('select public.ops_expected_event_set(%L::jsonb, %L)::text',
    format('{"record_id":"%s","title":"W3980 Creator Night","event_type":"event","expected_on":"%s"}', pg_temp.t3980_id('creator'), v_today + 20), 'w3980-exp-0003'));
  perform pg_temp.t3980_like('W2-EXPECTED', 'expected events are for hosts only', v, 'ERR:22023:not_a_host: Expected events are for hosts.%');
  v := pg_temp.t3980_person('growth', format('select public.ops_expected_event_set(%L::jsonb, %L)::text',
    format('{"record_id":"%s","title":"x","event_type":"gala","expected_on":"%s"}', pg_temp.t3980_id('host'), v_today - 1), 'w3980-exp-0004'));
  perform pg_temp.t3980_like('W2-EXPECTED', 'every problem comes back at once, in plain words', v,
    -- [TEST-MOD-APPROVED #3980] Wave 3 adds the promo_moment type (R5); the type words list it.
    'ERR:22023:invalid_expected: Title is missing. Say what the event is in 3 to 160 characters. Type must be event, experience, trip, rsvp or promo_moment. Date must be a real date from today up to 18 months ahead.%');

  v := pg_temp.t3980_person('growth', format('select public.ops_calendar(%L, %L, %L)::text', v_today, v_today + 60, v_today));
  perform pg_temp.t3980_check('W2-EXPECTED', 'it shows on the Calendar as expected, with its host',
    (select e->>'host_name' || '/' || (e->>'expected_on') from jsonb_array_elements(pg_temp.t3980_j(v)->'expected') e where e->>'id' = pg_temp.t3980_id('x1')),
    'W3980 Palm Host/' || (v_today + 45)::text);
  perform pg_temp.t3980_check('W2-EXPECTED', 'with a Go live deadline 28 days before',
    (select d->>'label' || '/' || (d->>'date') from jsonb_array_elements(pg_temp.t3980_j(v)->'deadlines') d where d->>'anchor_id' = pg_temp.t3980_id('x1')),
    'Go live: W3980 Palm Host/' || (v_today + 17)::text);
  perform pg_temp.t3980_check('W2-EXPECTED', 'and a promo start 21 days before',
    (select p->>'date' from jsonb_array_elements(pg_temp.t3980_j(v)->'promotions') p where p->>'anchor_id' = pg_temp.t3980_id('x1')),
    (v_today + 24)::text);

  v := pg_temp.t3980_person('growth', format('select public.ops_host_on_mingla(%L, %L)::text', pg_temp.t3980_id('host'), v_today));
  perform pg_temp.t3980_check('W2-EXPECTED', 'the host card lists its brand, its events in view and its expected event',
    pg_temp.t3980_get(v, 'brand', 'name') || '/' || jsonb_array_length(pg_temp.t3980_j(v)->'events') || '/' || jsonb_array_length(pg_temp.t3980_j(v)->'expected'),
    'W3980 Linked Brand/10/1');
  perform pg_temp.t3980_check('W2-EXPECTED', 'never its private, hidden or deleted events',
    (v not like '%W3980 Private Draft%' and v not like '%W3980 Hidden Draft%' and v not like '%W3980 Deleted Night%')::text, 'true');
  v := pg_temp.t3980_person('growth', format('select public.ops_host_on_mingla(%L, %L)::text', pg_temp.t3980_id('creator'), v_today));
  perform pg_temp.t3980_like('W2-EXPECTED', 'a creator card has no On Mingla section', v, 'ERR:P0002:not_found:%');

  v := pg_temp.t3980_person('growth', format('select public.ops_expected_event_set(%L::jsonb, %L)::text',
    format('{"record_id":"%s","id":"%s","status":"cancelled"}', pg_temp.t3980_id('host'), pg_temp.t3980_id('x1')), 'w3980-exp-0005'));
  perform pg_temp.t3980_like('W2-EXPECTED', 'cancelling needs a reason', v, 'ERR:22023:invalid_expected: Say why it was cancelled%');

  -- through the connector
  v := pg_temp.t3980_work('A', 'set_expected_event', format('{"record_id":"%s","title":"W3980 Agent Brunch","event_type":"experience","expected_on":"%s","request_key":"w3980-agent-exp-01"}',
    pg_temp.t3980_id('host'), v_today + 60));
  perform pg_temp.t3980_check('W2-EXPECTED', 'an agent sets an expected event through the connector',
    pg_temp.t3980_get(v, 'ok') || '/' || pg_temp.t3980_get(v, 'result', 'status'), 'true/created');
  perform pg_temp.t3980_check('W2-EXPECTED', 'and the agent log says so',
    (select l.via || '/' || l.outcome from public.ops_agent_log l where l.action = 'expected_set' and l.target_id = (pg_temp.t3980_get(v, 'result', 'expected', 'id'))::uuid), 'claude/ok');
  v := pg_temp.t3980_person('growth', format('select public.ops_expected_event_set(%L::jsonb, %L)::text',
    format('{"record_id":"%s","id":"%s","status":"cancelled","cancel_reason":"The host moved it to spring."}', pg_temp.t3980_id('host'), pg_temp.t3980_get(v, 'result', 'expected', 'id')), 'w3980-exp-0006'));
  perform pg_temp.t3980_check('W2-EXPECTED', 'a person cancels it with a reason', pg_temp.t3980_get(v, 'status') || '/' || pg_temp.t3980_get(v, 'expected', 'status'), 'cancelled/cancelled');

  v := pg_temp.t3980_work('A', 'list_calendar', format('{"from":"%s","to":"%s","layers":["live"]}', v_today, v_today + 60));
  perform pg_temp.t3980_check('W2-EXPECTED', 'list_calendar answers with only the layers asked for',
    pg_temp.t3980_get(v, 'ok') || '/' || ((pg_temp.t3980_j(v)->'result') ? 'events')::text || '/' || ((pg_temp.t3980_j(v)->'result') ? 'expected')::text, 'true/true/false');
  v := pg_temp.t3980_work('A', 'list_calendar', format('{"from":"%s","to":"%s"}', v_today, v_today + 150));
  perform pg_temp.t3980_check('W2-EXPECTED', 'list_calendar refuses a window over 100 days in plain words',
    pg_temp.t3980_get(v, 'error', 'token'), 'invalid_window');
  v := pg_temp.t3980_work('A', 'runway_report', '{}');
  perform pg_temp.t3980_check('W2-EXPECTED', 'runway_report answers for the next 90 days',
    pg_temp.t3980_get(v, 'ok') || '/' || (pg_temp.t3980_get(v, 'result', 'to')::date - pg_temp.t3980_get(v, 'result', 'from')::date)::text, 'true/90');
  v := pg_temp.t3980_work('A', 'plan_work', format('{"event_id":"%s"}', pg_temp.t3980_id('e_draft')));
  -- [TEST-MOD-APPROVED #3980] Wave 3 opens plan_work; it now answers instead of saying not ready.
  perform pg_temp.t3980_check('W2-EXPECTED', 'plan_work answers now that the launch kit is here', pg_temp.t3980_get(v, 'ok'), 'true');
end;
$expected$;

-- ---------------------------------------------------------------------------
-- W2-RECONCILE: an expected event becomes the real one and its cards follow
-- ---------------------------------------------------------------------------
do $reconcile$
declare v text; v_today date := pg_temp.t3980_id('today')::date; v_ev text; v_far text; v_out jsonb;
begin
  v := pg_temp.t3980_person('growth', format('select public.ops_expected_event_set(%L::jsonb, %L)::text',
    format('{"record_id":"%s","title":"W3980 Harvest Party","event_type":"event","expected_on":"%s"}', pg_temp.t3980_id('host'), v_today + 50), 'w3980-exp-0010'));
  perform pg_temp.t3980_keep('x2', pg_temp.t3980_get(v, 'expected', 'id'));
  v := pg_temp.t3980_person('growth', format('select public.ops_expected_event_set(%L::jsonb, %L)::text',
    format('{"record_id":"%s","title":"W3980 Far Party","event_type":"event","expected_on":"%s"}', pg_temp.t3980_id('host'), v_today + 70), 'w3980-exp-0011'));
  perform pg_temp.t3980_keep('x3', pg_temp.t3980_get(v, 'expected', 'id'));
  v := pg_temp.t3980_person('growth', format($q$select public.ops_work_add('[{"title":"W3980 harvest brief","instructions":"Write the content brief for the harvest party.","done_means":"The brief is on the card.","owners":["ada.w3980@test.local"],"anchor":{"kind":"expected","id":"%s"},"kit_step":-26}]'::jsonb, 'w3980-w2-add-01')::text$q$, pg_temp.t3980_id('x2')));
  perform pg_temp.t3980_check('W2-RECONCILE', 'a kit card counts from the expected date',
    pg_temp.t3980_get(v, 'results', '0', 'card', 'due_on'), (v_today + 24)::text);
  perform pg_temp.t3980_keep('ck', pg_temp.t3980_get(v, 'results', '0', 'card', 'id'));

  -- the host lists the real event 2 days after the promised date; another 4 days after
  perform pg_temp.t3980_event('e_real', '39800000-0000-4000-b200-000000000001', 'W3980 Harvest Party Live', 'discover', 'scheduled', 52, 1);
  perform pg_temp.t3980_event('e_far',  '39800000-0000-4000-b200-000000000001', 'W3980 Far Party Live', 'discover', 'scheduled', 74, 1);
  insert into public.ops_claims (holder_email, holder_via, target_kind, target_id, target_label, claimed_at, last_seen_at)
  values ('ada.w3980@test.local', 'claude', 'crm_record', pg_temp.t3980_id('creator')::uuid, 'W3980 Some Creator',
          clock_timestamp() - interval '40 minutes', clock_timestamp() - interval '31 minutes');
  v_out := public.ops_reconcile();
  perform pg_temp.t3980_check('W2-RECONCILE', 'housekeeping still ends claims left 30 minutes without an update',
    (v_out->>'claims_expired') || '/' || (select release_reason from public.ops_claims where target_id = pg_temp.t3980_id('creator')::uuid), '1/expired');
  perform pg_temp.t3980_check('W2-RECONCILE', 'housekeeping links the expected event within 3 days of its date',
    (select status || '/' || event_id::text from public.ops_expected_events where id = pg_temp.t3980_id('x2')::uuid), 'fulfilled/' || pg_temp.t3980_id('e_real'));
  perform pg_temp.t3980_check('W2-RECONCILE', 'but not one 4 days away',
    (select status from public.ops_expected_events where id = pg_temp.t3980_id('x3')::uuid), 'open');
  perform pg_temp.t3980_check('W2-RECONCILE', 'the card now counts from the real event, its due date moved and the event linked',
    (select anchor_kind || '/' || anchor_id::text || '/' || due_on::text from public.ops_work_cards where id = pg_temp.t3980_id('ck')::uuid)
      || '/' || (select count(*) from public.ops_work_links where card_id = pg_temp.t3980_id('ck')::uuid and kind = 'event' and target_id = pg_temp.t3980_id('e_real')::uuid)::text,
    'event/' || pg_temp.t3980_id('e_real') || '/' || (v_today + 52 - 26)::text || '/1');
  perform pg_temp.t3980_check('W2-RECONCILE', 'the card''s history says it moved',
    (select count(*) from public.ops_work_events where card_id = pg_temp.t3980_id('ck')::uuid and action = 're_anchored')::text, '1');
  perform pg_temp.t3980_check('W2-RECONCILE', 'the run reports what it did',
    (v_out->>'expected_fulfilled') || '/' || (v_out->>'cards_re_anchored'), '1/1');
  perform pg_temp.t3980_check('W2-RECONCILE', 'the agent log records it as Mingla',
    (select via || '/' || outcome from public.ops_agent_log where action = 'expected_set' and target_id = pg_temp.t3980_id('x2')::uuid and via = 'system'), 'system/info');
  v_out := public.ops_reconcile();
  perform pg_temp.t3980_check('W2-RECONCILE', 'a second run changes nothing', (v_out->>'expected_fulfilled') || '/' || (v_out->>'cards_re_anchored'), '0/0');
end;
$reconcile$;

-- ---------------------------------------------------------------------------
-- W2-BACK: leaving Needs a person takes a reason from an agent
-- ---------------------------------------------------------------------------
do $back$
declare v text; v_rev bigint; v_today date := pg_temp.t3980_id('today')::date;
begin
  v := pg_temp.t3980_person('growth', format($q$select public.ops_work_add('[{"title":"W3980 approve the poster boost","instructions":"Approve a small poster boost for the night.","done_means":"Spend approved by a person.","owners":["ada.w3980@test.local"],"watchers":["di.w3980@test.local"],"due_on":"%s","person_reason":"spend"}]'::jsonb, 'w3980-w2-add-02')::text$q$, v_today + 3));
  perform pg_temp.t3980_keep('cp', pg_temp.t3980_get(v, 'results', '0', 'card', 'id'));
  v_rev := pg_temp.t3980_get(v, 'results', '0', 'card', 'revision')::bigint;
  perform pg_temp.t3980_check('W2-BACK', 'the card needs a person', pg_temp.t3980_get(v, 'results', '0', 'card', 'status'), 'person');

  v := pg_temp.t3980_work('A', 'update_work', format('{"id":"%s","expected_revision":%s,"changes":{"status":"todo"}}', pg_temp.t3980_id('cp'), v_rev));
  perform pg_temp.t3980_check('W2-BACK', 'an agent moving it back to To do without a reason is refused',
    pg_temp.t3980_get(v, 'error', 'token'), 'reason_required');
  v := pg_temp.t3980_work('A', 'update_work', format('{"id":"%s","expected_revision":%s,"changes":{"status":"todo","reason":"   "}}', pg_temp.t3980_id('cp'), v_rev));
  perform pg_temp.t3980_check('W2-BACK', 'a blank reason is no reason', pg_temp.t3980_get(v, 'error', 'token'), 'reason_required');
  perform pg_temp.t3980_check('W2-BACK', 'and the card still needs a person',
    (select status from public.ops_work_cards where id = pg_temp.t3980_id('cp')::uuid), 'person');

  v := pg_temp.t3980_work('A', 'update_work', format('{"id":"%s","expected_revision":%s,"changes":{"status":"todo","reason":"The host paid for the boost themselves."}}', pg_temp.t3980_id('cp'), v_rev));
  perform pg_temp.t3980_check('W2-BACK', 'with a reason it moves back to To do',
    pg_temp.t3980_get(v, 'ok') || '/' || pg_temp.t3980_get(v, 'result', 'card', 'status'), 'true/todo');
  perform pg_temp.t3980_like('W2-BACK', 'the reason is in the agent log',
    (select summary from public.ops_agent_log where card_id = pg_temp.t3980_id('cp')::uuid and action = 'updated' and via = 'claude' order by id desc limit 1),
    'Card % no longer needs a person: The host paid for the boost themselves.');
  perform pg_temp.t3980_check('W2-BACK', 'the watcher is told, with the reason',
    (select count(*) from public.team_mentions m join t3980_people p on p.id = m.target_user_id
      where m.source_kind = 'work_card' and p.who = 'admin' and m.deep_link like '%' || pg_temp.t3980_id('cp')
        and m.body_excerpt like '%moved W3980 approve the poster boost back to To do from Needs a person: The host paid for the boost themselves.')::text, '1');
  perform pg_temp.t3980_check('W2-BACK', 'the history keeps the reason',
    (select body from public.ops_work_events where card_id = pg_temp.t3980_id('cp')::uuid and action = 'status' order by at desc limit 1),
    'The host paid for the boost themselves.');
end;
$back$;

select count(*) as t3980_total, count(*) filter (where not ok) as t3980_failed,
       coalesce(string_agg(test || ' ' || label || ' [' || detail || ']', E'\n' order by seq) filter (where not ok), 'none') as t3980_failures
  from t3980_results \gset
rollback;

select (:t3980_total < 70 or :t3980_failed > 0) as t3980_bad \gset
\if :t3980_bad
  \echo 'ISSUE-3980 WAVE 2 FAILED:' :t3980_failed 'of' :t3980_total
  \echo :t3980_failures
  do $$ begin raise exception 'ISSUE-3980 WAVE 2 FAIL'; end $$;
\endif
\echo 'ISSUE-3980 WAVE 2 PASS:' :t3980_total 'checks, 0 failed'
