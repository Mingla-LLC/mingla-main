-- Issue #3980 -- independent tester, adversarial: the team's read of events,
-- the go-live gate, the giveaway and ads rule, the launch kit through the
-- connector and the owner's one-time next-step conversion, attacked from
-- angles the happy-path suites do not take, on the fully replayed PG17
-- schema.
--
-- What it proves (each check is recorded and reported together):
--   X-SCOPE    private, hidden, cancelled, ended and deleted events, a draft
--              of a brand no host card links and a private draft of a linked
--              brand never reach any team read: the Calendar, the connector's
--              list_calendar, the runway report, a host card's On Mingla,
--              the event panel, link search or a card link; no address,
--              theme or organiser contact key or value is ever returned
--   X-GATE     a go-live gate card does not close while its event is
--              private, hidden, a draft or deleted, even with a public time
--              set, and closes with the system's proof once it is public; a
--              person cannot close it by hand; a giveaway and ads card on an
--              event that went public 15 days ahead stays held through every
--              housekeeping run; a person cannot lift the hold; Sales and
--              marketing cannot override; the owner cannot override without
--              a real reason; an override with a reason holds through
--              housekeeping
--   X-PLAN     plan_work through the connector gives the eight steps on the
--              right days; adding them twice with the same key changes
--              nothing; adding them again with a new key adds nothing; a
--              second plan proposes nothing and says why
--   X-CONVERT  the preview writes nothing; titles are "<next step> · <name>";
--              an 80-plus character name and a long next step still make a
--              card within 160 characters; converting only the second of
--              two records with the same name and next step, then the first,
--              makes one card, never two; the records are not changed
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

create temp table ty_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into ty_people (who, id, email) values
  ('owner',   '39800000-0000-4000-a0bb-000000000001', 'oona.y3980@test.local'),
  ('admin',   '39800000-0000-4000-a0bb-000000000002', 'abe.y3980@test.local'),
  ('growth',  '39800000-0000-4000-a0bb-000000000003', 'gia.y3980@test.local'),
  ('partner', '39800000-0000-4000-a0bb-000000000005', 'pia.y3980@test.local');
insert into auth.users (id, email, email_confirmed_at) select id, email, now() from ty_people;
insert into public.admin_users (email, role, status, accepted_at) values
  ('oona.y3980@test.local', 'owner', 'active', now()),
  ('abe.y3980@test.local', 'admin', 'active', now());
insert into public.admin_team_members (email, role, status, accepted_at) values
  ('gia.y3980@test.local', 'growth', 'active', now()),
  ('pia.y3980@test.local', 'partner', 'active', now());

create temp table ty_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;
create temp table ty_ids (k text primary key, v text) on commit drop;

create function pg_temp.ty_as(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text; v_out text;
begin
  if p_who <> 'service' then
    select id, email into strict v_id, v_email from ty_people where who = p_who;
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

create function pg_temp.ty_check(p_test text, p_label text, p_got text, p_want text) returns void
language plpgsql as $fn$
begin
  insert into ty_results (test, label, ok, detail)
  values (p_test, p_label, p_got is not distinct from p_want,
          format('got %s, want %s', coalesce(left(p_got, 600), '<null>'), coalesce(p_want, '<null>')));
end;
$fn$;

create function pg_temp.ty_like(p_test text, p_label text, p_got text, p_pattern text) returns void
language plpgsql as $fn$
begin
  insert into ty_results (test, label, ok, detail)
  values (p_test, p_label, coalesce(p_got like p_pattern, false),
          format('got %s, want like %s', coalesce(left(p_got, 600), '<null>'), p_pattern));
end;
$fn$;

create function pg_temp.ty_get(p text, variadic p_path text[]) returns text
language plpgsql as $fn$
begin
  return p::jsonb #>> p_path;
exception when others then
  return p;
end;
$fn$;

create function pg_temp.ty_j(p text) returns jsonb
language plpgsql as $fn$
begin
  return p::jsonb;
exception when others then
  return jsonb_build_object('unreadable', left(p, 300));
end;
$fn$;

create function pg_temp.ty_id(p_k text) returns text
language sql as $fn$ select v from ty_ids where k = p_k $fn$;

create function pg_temp.ty_keep(p_k text, p_v text) returns void
language sql as $fn$ insert into ty_ids (k, v) values (p_k, p_v) on conflict (k) do update set v = excluded.v $fn$;

create function pg_temp.ty_next_request() returns void
language sql as $fn$
  update public.team_agent_calls set xact_id = '3'::xid8, started_at = started_at - interval '5 minutes' where xact_id <> '3'::xid8
$fn$;

create function pg_temp.ty_person(p_who text, p_sql text) returns text
language plpgsql as $fn$
begin
  perform pg_temp.ty_next_request();
  return pg_temp.ty_as(p_who, p_sql);
end;
$fn$;

create function pg_temp.ty_digest(p text) returns text
language sql as $fn$ select encode(sha256(convert_to(p, 'UTF8')), 'hex') $fn$;

create function pg_temp.ty_newkey(p_who text, p_agent text, p_label text) returns text
language plpgsql as $fn$
declare v text;
begin
  v := pg_temp.ty_person(p_who, format('select public.team_agent_key_create(%L)::text', p_agent));
  if v like 'ERR:%' then return v; end if;
  perform pg_temp.ty_keep(p_label, pg_temp.ty_j(v) ->> 'key');
  return v;
end;
$fn$;

create function pg_temp.ty_work(p_label text, p_tool text, p_args text default '{}') returns text
language plpgsql as $fn$
begin
  perform pg_temp.ty_next_request();
  return pg_temp.ty_as('service', format('select public.ops_agent_call(%L, %L, %L::jsonb, %L)::text',
    pg_temp.ty_digest(pg_temp.ty_id(p_label)), p_tool, p_args, 'issue3980-tester/1.0'));
end;
$fn$;

create function pg_temp.ty_day(p_n integer) returns timestamptz
language sql as $fn$ select (date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') + make_interval(days => p_n, hours => 20) $fn$;

-- An event on day p_day with the given brand, visibility and status; public
-- time p_lead days (and an hour) before it starts, or none.
create function pg_temp.ty_event(p_key text, p_brand uuid, p_title text, p_day integer, p_vis text, p_status text, p_lead integer) returns void
language plpgsql as $fn$
declare v_id uuid := gen_random_uuid();
begin
  set local session_replication_role = replica;
  insert into public.events (id, brand_id, title, slug, visibility, status, timezone, published_at, event_type, location_text)
  values (v_id, p_brand, p_title, 'y3980-' || left(v_id::text, 8), p_vis, p_status, 'UTC',
          CASE WHEN p_lead IS NULL THEN NULL ELSE pg_temp.ty_day(p_day) - make_interval(days => p_lead, hours => 1) END,
          'event', 'Y3980 Secret Street 9');
  insert into public.event_dates (event_id, start_at, end_at, is_master)
  values (v_id, pg_temp.ty_day(p_day), pg_temp.ty_day(p_day) + interval '3 hours', true);
  set local session_replication_role = origin;
  perform pg_temp.ty_keep(p_key, v_id::text);
end;
$fn$;

create function pg_temp.ty_set_event(p_key text, p_vis text, p_status text, p_lead integer, p_day integer, p_deleted boolean default false) returns void
language plpgsql as $fn$
begin
  set local session_replication_role = replica;
  update public.events set visibility = p_vis, status = p_status,
         published_at = CASE WHEN p_lead IS NULL THEN NULL ELSE pg_temp.ty_day(p_day) - make_interval(days => p_lead, hours => 1) END,
         deleted_at = CASE WHEN p_deleted THEN now() END
   where id = pg_temp.ty_id(p_key)::uuid;
  set local session_replication_role = origin;
end;
$fn$;

create function pg_temp.ty_reconcile() returns text
language sql as $fn$ select pg_temp.ty_as('service', 'select public.ops_reconcile()::text') $fn$;

-- Every key anywhere in a JSON value.
create function pg_temp.ty_keys(p jsonb) returns setof text
language sql as $fn$
  with recursive t(v) as (select p union all
    select coalesce(e.value, a.value) from t
      left join lateral jsonb_each(case when jsonb_typeof(t.v) = 'object' then t.v end) e on true
      left join lateral jsonb_array_elements(case when jsonb_typeof(t.v) = 'array' then t.v end) a on true
     where e.value is not null or a.value is not null)
  select k from t, lateral jsonb_object_keys(case when jsonb_typeof(t.v) = 'object' then t.v else '{}'::jsonb end) k
$fn$;

set local session_replication_role = replica;
insert into public.brands (id, account_id, name, slug, city) values
  ('39800000-0000-4000-b2bb-000000000001', '39800000-0000-4000-b3bb-000000000001', 'Y3980 Linked Brand', 'y3980-linked-brand', 'Lagos'),
  ('39800000-0000-4000-b2bb-000000000002', '39800000-0000-4000-b3bb-000000000002', 'Y3980 Unlinked Brand', 'y3980-unlinked-brand', 'Lagos');
set local session_replication_role = origin;
insert into public.crm_records (id, pipeline, name, stage, brand_id, created_by, updated_by) values
  ('39800000-0000-4000-c1bb-000000000001', 'hosts', 'Y3980 Linked Host', 'onboarded', '39800000-0000-4000-b2bb-000000000001', 'y3980-fixture', 'y3980-fixture');
insert into public.crm_record_owners (record_id, owner_email, added_by) values
  ('39800000-0000-4000-c1bb-000000000001', 'gia.y3980@test.local', 'y3980-fixture');

select pg_temp.ty_newkey('growth', 'claude', 'GC') is not null as k1;

select pg_temp.ty_event('e_disc',    '39800000-0000-4000-b2bb-000000000001', 'Y3980 Shown Discover', 20, 'discover', 'scheduled', 30),
       pg_temp.ty_event('e_public',  '39800000-0000-4000-b2bb-000000000001', 'Y3980 Shown Public',   22, 'public',   'scheduled', 30),
       pg_temp.ty_event('e_ldraft',  '39800000-0000-4000-b2bb-000000000001', 'Y3980 Shown Draft',    24, 'draft',    'draft',     NULL),
       pg_temp.ty_event('e_private', '39800000-0000-4000-b2bb-000000000001', 'Y3980 Never Private',  26, 'private',  'scheduled', 30),
       pg_temp.ty_event('e_hidden',  '39800000-0000-4000-b2bb-000000000001', 'Y3980 Never Hidden',   27, 'hidden',   'scheduled', 30),
       pg_temp.ty_event('e_cancel',  '39800000-0000-4000-b2bb-000000000001', 'Y3980 Never Cancelled', 28, 'discover', 'cancelled', 30),
       pg_temp.ty_event('e_ended',   '39800000-0000-4000-b2bb-000000000001', 'Y3980 Never Ended',    -3, 'discover', 'ended',     30),
       pg_temp.ty_event('e_deleted', '39800000-0000-4000-b2bb-000000000001', 'Y3980 Never Deleted',  29, 'discover', 'scheduled', 30),
       pg_temp.ty_event('e_udraft',  '39800000-0000-4000-b2bb-000000000002', 'Y3980 Never Unlinked Draft', 30, 'draft', 'draft', NULL),
       pg_temp.ty_event('e_pdraft',  '39800000-0000-4000-b2bb-000000000001', 'Y3980 Never Private Draft', 31, 'private', 'draft', NULL);
select pg_temp.ty_set_event('e_deleted', 'discover', 'scheduled', 30, 29, true);

-- ---------------------------------------------------------------------------
-- X-SCOPE
-- ---------------------------------------------------------------------------
do $scope$
declare v text; v_all text := ''; v_titles text; k text; v_bad text; v_today date := (now() AT TIME ZONE 'UTC')::date;
begin
  v := pg_temp.ty_person('growth', format('select public.ops_calendar(%L, %L)::text', v_today - 30, v_today + 60));
  v_titles := (select string_agg(e->>'title', ',' order by e->>'title') from jsonb_array_elements(pg_temp.ty_j(v)->'events') e where e->>'title' like 'Y3980%');
  perform pg_temp.ty_check('X-SCOPE', 'the Calendar shows exactly the two public events and the linked brand''s draft', v_titles,
    'Y3980 Shown Discover,Y3980 Shown Draft,Y3980 Shown Public');
  v_all := v_all || v;
  v := pg_temp.ty_work('GC', 'list_calendar', format('{"from":"%s","to":"%s"}', v_today - 30, v_today + 60));
  perform pg_temp.ty_check('X-SCOPE', 'the connector''s list_calendar shows the same three',
    (select string_agg(e->>'title', ',' order by e->>'title') from jsonb_array_elements(pg_temp.ty_j(v)->'result'->'events') e where e->>'title' like 'Y3980%'),
    'Y3980 Shown Discover,Y3980 Shown Draft,Y3980 Shown Public');
  v_all := v_all || v;
  v := pg_temp.ty_person('partner', format('select public.ops_runway_report(%L, %L)::text', v_today - 30, v_today + 60));
  perform pg_temp.ty_check('X-SCOPE', 'the runway report lists none of the hidden ones',
    (select count(*) from jsonb_array_elements(pg_temp.ty_j(v)->'rows') r where r->>'title' like 'Y3980 Never%')::text, '0');
  v_all := v_all || v;
  v := pg_temp.ty_person('growth', format('select public.ops_host_on_mingla(%L)::text', '39800000-0000-4000-c1bb-000000000001'));
  perform pg_temp.ty_check('X-SCOPE', 'the host card''s On Mingla lists only its brand''s public events and its draft',
    (select string_agg(e->>'title', ',' order by e->>'title') from jsonb_array_elements(pg_temp.ty_j(v)->'events') e),
    'Y3980 Shown Discover,Y3980 Shown Draft,Y3980 Shown Public');
  v_all := v_all || v;
  foreach k in array array['e_private','e_hidden','e_cancel','e_ended','e_deleted','e_udraft','e_pdraft'] loop
    v := pg_temp.ty_person('growth', format('select public.ops_anchor_detail(%L, %L)::text', 'event', pg_temp.ty_id(k)));
    perform pg_temp.ty_like('X-SCOPE', k || ' cannot be opened in the event panel', v, 'ERR:P0002:%');
    v := pg_temp.ty_person('growth', format('select public.ops_work_add(%L::jsonb, %L)::text',
      format('[{"title":"Y3980 link %s","instructions":"Try to link an event out of view.","done_means":"It is linked.","owners":["gia.y3980@test.local"],"due_on":"%s","links":[{"kind":"event","id":"%s"}]}]', k, v_today + 3, pg_temp.ty_id(k)),
      'y3980-link-' || k));
    perform pg_temp.ty_check('X-SCOPE', k || ' cannot be linked to a card', pg_temp.ty_get(v, 'results', '0', 'status'), 'refused');
  end loop;
  v := pg_temp.ty_person('growth', $q$select public.ops_link_search('event', 'Y3980')::text$q$);
  perform pg_temp.ty_check('X-SCOPE', 'link search finds only the three in view',
    (select string_agg(r->>'label', ',' order by r->>'label') from jsonb_array_elements(pg_temp.ty_j(v)->'results') r),
    'Y3980 Shown Discover,Y3980 Shown Draft,Y3980 Shown Public');
  v_all := v_all || v;
  v := pg_temp.ty_person('growth', $q$select public.ops_link_search('event', 'Never')::text$q$);
  perform pg_temp.ty_check('X-SCOPE', 'and nothing by the hidden ones'' own words', jsonb_array_length(pg_temp.ty_j(v)->'results')::text, '0');
  perform pg_temp.ty_check('X-SCOPE', 'no hidden event''s title appears in any of these answers', (v_all like '%Y3980 Never%')::text, 'false');
  perform pg_temp.ty_check('X-SCOPE', 'no address appears in any of these answers', (v_all like '%Secret Street%')::text, 'false');
  select string_agg(distinct k2, ',') into v_bad
    from (select pg_temp.ty_keys(pg_temp.ty_j(v_all_part)) k2
            from unnest(array[
              pg_temp.ty_person('growth', format('select public.ops_calendar(%L, %L)::text', v_today - 30, v_today + 60)),
              pg_temp.ty_person('growth', format('select public.ops_host_on_mingla(%L)::text', '39800000-0000-4000-c1bb-000000000001')),
              pg_temp.ty_person('growth', format('select public.ops_anchor_detail(%L, %L)::text', 'event', pg_temp.ty_id('e_disc')))]) v_all_part) z
   where k2 ~* '(location|address|theme|organiser|organizer|contact|phone|email|geo|price|order|buyer)';
  perform pg_temp.ty_check('X-SCOPE', 'no address, theme, organiser contact, price or buyer key in the Calendar, On Mingla or the event panel', v_bad, null);
end;
$scope$;

-- ---------------------------------------------------------------------------
-- X-GATE
-- ---------------------------------------------------------------------------
select pg_temp.ty_event('e_gate', '39800000-0000-4000-b2bb-000000000001', 'Y3980 Gate Night', 40, 'draft', 'draft', NULL),
       pg_temp.ty_event('e_promo', '39800000-0000-4000-b2bb-000000000001', 'Y3980 Promo Night', 40, 'draft', 'draft', NULL);

do $gate$
declare v text; v_gate text; v_promo text; v_rev bigint;
begin
  v := pg_temp.ty_person('growth', format('select public.ops_work_add(%L::jsonb, %L)::text',
    format('[{"title":"Y3980 gate card","instructions":"The event must be public 28 days before it starts.","done_means":"The event is public on Mingla.","owners":["gia.y3980@test.local"],"kind":"gate_live","kit_step":-28,"anchor":{"kind":"event","id":"%s"}}]', pg_temp.ty_id('e_gate')),
    'y3980-gate-0001'));
  v_gate := pg_temp.ty_get(v, 'results', '0', 'card', 'id');
  perform pg_temp.ty_check('X-GATE', 'a gate card is added on a draft event', pg_temp.ty_get(v, 'results', '0', 'status'), 'added');

  perform pg_temp.ty_set_event('e_gate', 'private', 'scheduled', 35, 40);
  perform pg_temp.ty_reconcile();
  perform pg_temp.ty_check('X-GATE', 'private with a public time set: the gate stays open', (select status from public.ops_work_cards where id = v_gate::uuid), 'todo');
  perform pg_temp.ty_set_event('e_gate', 'hidden', 'scheduled', 35, 40);
  perform pg_temp.ty_reconcile();
  perform pg_temp.ty_check('X-GATE', 'hidden: still open', (select status from public.ops_work_cards where id = v_gate::uuid), 'todo');
  perform pg_temp.ty_set_event('e_gate', 'discover', 'draft', 35, 40);
  perform pg_temp.ty_reconcile();
  perform pg_temp.ty_check('X-GATE', 'discover but still a draft: still open', (select status from public.ops_work_cards where id = v_gate::uuid), 'todo');
  perform pg_temp.ty_set_event('e_gate', 'discover', 'scheduled', 35, 40, true);
  perform pg_temp.ty_reconcile();
  perform pg_temp.ty_check('X-GATE', 'deleted: still open', (select status from public.ops_work_cards where id = v_gate::uuid), 'todo');

  v_rev := (select revision from public.ops_work_cards where id = v_gate::uuid);
  v := pg_temp.ty_person('growth', format($q$select public.ops_work_close(%L, '[{"kind":"text","text":"I checked it is live"}]'::jsonb, null, %s)::text$q$, v_gate, v_rev));
  perform pg_temp.ty_like('X-GATE', 'a person cannot close the gate card by hand', v, 'ERR:42501:gate_card:%');
  v := pg_temp.ty_person('admin', format($q$select public.ops_work_close(%L, '[{"kind":"text","text":"I checked it is live"}]'::jsonb, null, %s)::text$q$, v_gate, v_rev));
  perform pg_temp.ty_like('X-GATE', 'nor can an admin while the event is not public', v, 'ERR:42501:gate_card:%');

  perform pg_temp.ty_set_event('e_gate', 'discover', 'scheduled', 35, 40);
  perform pg_temp.ty_reconcile();
  perform pg_temp.ty_check('X-GATE', 'public: it closed itself, by the system, with verified proof',
    (select status || '/' || close_kind || '/' || closed_via || '/' || (proof->0->>'kind') || '/' || (proof->0->>'verified') from public.ops_work_cards where id = v_gate::uuid),
    'done/system/system/event_public/true');

  -- the giveaway and ads card on an event that goes public 15 days ahead
  v := pg_temp.ty_work('GC', 'plan_work', format('{"event_id":"%s"}', pg_temp.ty_id('e_promo')));
  v := pg_temp.ty_work('GC', 'add_work', format('{"cards":%s,"request_key":"y3980-promo-plan-1"}',
    (select jsonb_agg(c) from jsonb_array_elements(pg_temp.ty_j(v)->'result'->'cards') c where (c->>'kit_step')::integer = -21)));
  v_promo := (select id::text from public.ops_work_cards where anchor_id = pg_temp.ty_id('e_promo')::uuid and kit_step = -21);
  perform pg_temp.ty_check('X-GATE', 'the giveaway and ads card is added held, waiting for go-live',
    (select kind || '/' || blocked::text || '/' || blocked_kind from public.ops_work_cards where id = v_promo::uuid), 'promo/true/waiting_go_live');
  perform pg_temp.ty_set_event('e_promo', 'discover', 'scheduled', 15, 40);
  perform pg_temp.ty_reconcile();
  perform pg_temp.ty_reconcile();
  perform pg_temp.ty_check('X-GATE', 'public only 15 days ahead: held as organic only, after two housekeeping runs',
    (select blocked::text || '/' || blocked_kind from public.ops_work_cards where id = v_promo::uuid), 'true/organic_only');
  v := pg_temp.ty_person('growth', format($q$select public.ops_work_update(%L, '{"blocked":false}'::jsonb, %s)::text$q$, v_promo,
    (select revision from public.ops_work_cards where id = v_promo::uuid)));
  perform pg_temp.ty_like('X-GATE', 'a person cannot lift the hold by unblocking', v, 'ERR:42501:gate_blocked:%');
  v := pg_temp.ty_person('growth', format($q$select public.ops_gate_override(%L, 'The host is paying for these ads herself')::text$q$, v_promo));
  perform pg_temp.ty_like('X-GATE', 'Sales and marketing cannot override', v, 'ERR:42501:%');
  v := pg_temp.ty_person('owner', format($q$select public.ops_gate_override(%L, 'because')::text$q$, v_promo));
  perform pg_temp.ty_like('X-GATE', 'the owner cannot override without a real reason', v, 'ERR:22023:%');
  perform pg_temp.ty_check('X-GATE', 'still held', (select blocked::text from public.ops_work_cards where id = v_promo::uuid), 'true');
  v := pg_temp.ty_person('owner', format($q$select public.ops_gate_override(%L, 'The host is paying for these ads herself')::text$q$, v_promo));
  perform pg_temp.ty_check('X-GATE', 'with a reason the owner frees it', (select blocked::text || '/' || (override_reason is not null)::text from public.ops_work_cards where id = v_promo::uuid), 'false/true');
  perform pg_temp.ty_reconcile();
  perform pg_temp.ty_check('X-GATE', 'and housekeeping does not hold it again', (select blocked::text from public.ops_work_cards where id = v_promo::uuid), 'false');
  perform pg_temp.ty_like('X-GATE', 'the override and its reason are in the agent log',
    (select summary from public.ops_agent_log where card_id = v_promo::uuid and action = 'gate_override' order by id desc limit 1), '%The host is paying for these ads herself%');
end;
$gate$;

-- ---------------------------------------------------------------------------
-- X-PLAN
-- ---------------------------------------------------------------------------
select pg_temp.ty_event('e_plan', '39800000-0000-4000-b2bb-000000000001', 'Y3980 Plan Night', 40, 'draft', 'draft', NULL);

do $plan$
declare v text; v_cards jsonb; v_today date := (now() AT TIME ZONE 'UTC')::date;
begin
  v := pg_temp.ty_work('GC', 'plan_work', format('{"event_id":"%s"}', pg_temp.ty_id('e_plan')));
  v_cards := pg_temp.ty_j(v)->'result'->'cards';
  perform pg_temp.ty_check('X-PLAN', 'plan_work proposes eight cards, each due on its step''s day',
    (select string_agg((c->>'kit_step') || '@' || ((c->>'due_on')::date - v_today)::text, ',' order by (c->>'kit_step')::integer) from jsonb_array_elements(v_cards) c),
    '-35@5,-31@9,-28@12,-26@14,-21@19,-14@26,-7@33,2@42');
  perform pg_temp.ty_check('X-PLAN', 'and writes nothing', (select count(*) from public.ops_work_cards where anchor_id = pg_temp.ty_id('e_plan')::uuid)::text, '0');
  v := pg_temp.ty_work('GC', 'add_work', format('{"cards":%s,"request_key":"y3980-plan-add-01"}', v_cards));
  perform pg_temp.ty_check('X-PLAN', 'adding them adds eight', pg_temp.ty_get(v, 'result', 'added'), '8');
  v := pg_temp.ty_work('GC', 'add_work', format('{"cards":%s,"request_key":"y3980-plan-add-01"}', v_cards));
  perform pg_temp.ty_check('X-PLAN', 'the same request again is a replay that adds nothing',
    pg_temp.ty_get(v, 'result', 'replayed') || '/' || (select count(*) from public.ops_work_cards where anchor_id = pg_temp.ty_id('e_plan')::uuid)::text, 'true/8');
  v := pg_temp.ty_work('GC', 'add_work', format('{"cards":%s,"request_key":"y3980-plan-add-02"}', v_cards));
  perform pg_temp.ty_check('X-PLAN', 'the same cards with a new key are all duplicates',
    pg_temp.ty_get(v, 'result', 'added') || '/' || pg_temp.ty_get(v, 'result', 'duplicate') || '/'
      || (select count(*) from public.ops_work_cards where anchor_id = pg_temp.ty_id('e_plan')::uuid)::text, '0/8/8');
  v := pg_temp.ty_work('GC', 'add_work', format('{"cards":%s,"request_key":"y3980-plan-add-01"}', (select jsonb_agg(c) from jsonb_array_elements(v_cards) c where (c->>'kit_step')::integer <> 2)));
  perform pg_temp.ty_check('X-PLAN', 'the first key with other cards is refused, not replayed', pg_temp.ty_get(v, 'error', 'token'), 'request_key_reused');
  v := pg_temp.ty_work('GC', 'plan_work', format('{"event_id":"%s"}', pg_temp.ty_id('e_plan')));
  perform pg_temp.ty_check('X-PLAN', 'a second plan proposes nothing and says each step already has a card',
    jsonb_array_length(pg_temp.ty_j(v)->'result'->'cards') || '/' ||
      (select count(*) from jsonb_array_elements(pg_temp.ty_j(v)->'result'->'skipped') s where s->>'reason' = 'card_exists')::text, '0/8');
  v := pg_temp.ty_work('GC', 'plan_work', format('{"event_id":"%s","expected_event_id":"%s"}', pg_temp.ty_id('e_plan'), gen_random_uuid()));
  perform pg_temp.ty_check('X-PLAN', 'naming both an event and an expected event is refused', pg_temp.ty_get(v, 'error', 'token'), 'invalid_arguments');
  v := pg_temp.ty_work('GC', 'plan_work', format('{"event_id":"%s"}', pg_temp.ty_id('e_private')));
  perform pg_temp.ty_check('X-PLAN', 'a private event cannot be planned', pg_temp.ty_get(v, 'error', 'token'), 'not_found');
end;
$plan$;

-- ---------------------------------------------------------------------------
-- X-CONVERT
-- ---------------------------------------------------------------------------
insert into public.crm_records (id, pipeline, name, stage, next_action, due_on, created_by, updated_by) values
  ('39800000-0000-4000-c2bb-000000000001', 'hosts', 'Y3980 Twin Host', 'contacted', 'Call about the summer menu', (now() AT TIME ZONE 'UTC')::date + 3, 'y3980-fixture', 'y3980-fixture'),
  ('39800000-0000-4000-c2bb-000000000002', 'creators', 'Y3980 Twin Host', 'contacted', 'Call about the summer menu', (now() AT TIME ZONE 'UTC')::date + 5, 'y3980-fixture', 'y3980-fixture'),
  ('39800000-0000-4000-c2bb-000000000003', 'creators', 'Y3980 ' || rtrim(repeat('Very Long Creator Name ', 4)), 'contacted',
   'Send the brief for the three summer posts and confirm the dates, the rates, the usage rights and the hashtags we agreed on the call last Tuesday afternoon', null, 'y3980-fixture', 'y3980-fixture');
insert into public.crm_record_owners (record_id, owner_email, added_by) values
  ('39800000-0000-4000-c2bb-000000000001', 'gia.y3980@test.local', 'y3980-fixture'),
  ('39800000-0000-4000-c2bb-000000000002', 'gia.y3980@test.local', 'y3980-fixture'),
  ('39800000-0000-4000-c2bb-000000000003', 'pia.y3980@test.local', 'y3980-fixture');
select pg_temp.ty_keep('rec_hash', (select md5(string_agg(to_jsonb(c)::text, '|' order by c.id)) from public.crm_records c where c.id::text like '39800000-0000-4000-c2bb-%'));

do $convert$
declare v text; v_cards bigint; v_conv bigint; v_title text; v_long text;
begin
  select count(*) into v_cards from public.ops_work_cards;
  select count(*) into v_conv from public.ops_next_action_conversions;
  v := pg_temp.ty_person('owner', 'select public.ops_next_action_preview()::text');
  perform pg_temp.ty_check('X-CONVERT', 'the preview writes nothing',
    ((select count(*) from public.ops_work_cards) - v_cards)::text || '/' || ((select count(*) from public.ops_next_action_conversions) - v_conv)::text, '0/0');
  v_long := (select r->'proposed'->>'title' from jsonb_array_elements(pg_temp.ty_j(v)->'rows') r where r->>'record_id' = '39800000-0000-4000-c2bb-000000000003');
  perform pg_temp.ty_check('X-CONVERT', 'a long next step and an 80-plus character name still fit 160 characters, cut with an ellipsis',
    (char_length(v_long) <= 160)::text || '/' || (v_long like 'Send the brief%… · Y3980 Very Long Creator Name%…')::text, 'true/true');
  perform pg_temp.ty_check('X-CONVERT', 'the preview lists the second twin as repeating the first',
    (select r->>'issue' from jsonb_array_elements(pg_temp.ty_j(v)->'rows') r where r->>'record_id' = '39800000-0000-4000-c2bb-000000000002'), 'duplicate_record');

  -- convert the long one, then only the SECOND twin, then the first
  v := pg_temp.ty_person('owner', $q$select public.ops_next_action_convert(array['39800000-0000-4000-c2bb-000000000003']::uuid[], null, 'y3980-convert-01')::text$q$);
  perform pg_temp.ty_check('X-CONVERT', 'the long one becomes a card', pg_temp.ty_get(v, 'results', '0', 'status'), 'added');
  v := pg_temp.ty_person('owner', $q$select public.ops_next_action_convert(array['39800000-0000-4000-c2bb-000000000002']::uuid[], null, 'y3980-convert-02')::text$q$);
  v_title := (select title from public.ops_work_cards where id = (pg_temp.ty_get(v, 'results', '0', 'card_id'))::uuid);
  perform pg_temp.ty_check('X-CONVERT', 'the second twin alone becomes a card titled "<next step> · <name>"', v_title, 'Call about the summer menu · Y3980 Twin Host');
  v := pg_temp.ty_person('owner', $q$select public.ops_next_action_convert(array['39800000-0000-4000-c2bb-000000000001']::uuid[], null, 'y3980-convert-03')::text$q$);
  perform pg_temp.ty_check('X-CONVERT', 'converting the first twin afterwards does not make a second card',
    (pg_temp.ty_get(v, 'results', '0', 'status') <> 'added')::text || '/'
      || (select count(*) from public.ops_work_cards where title = 'Call about the summer menu · Y3980 Twin Host' and archived_at is null)::text, 'true/1');
  v := pg_temp.ty_person('owner', $q$select public.ops_next_action_convert(array['39800000-0000-4000-c2bb-000000000002','39800000-0000-4000-c2bb-000000000003']::uuid[], null, 'y3980-convert-04')::text$q$);
  perform pg_temp.ty_check('X-CONVERT', 'converting the done ones again adds nothing', pg_temp.ty_get(v, 'added'), '0');
  perform pg_temp.ty_check('X-CONVERT', 'the records themselves are unchanged',
    (select md5(string_agg(to_jsonb(c)::text, '|' order by c.id)) from public.crm_records c where c.id::text like '39800000-0000-4000-c2bb-%'), pg_temp.ty_id('rec_hash'));
  perform pg_temp.ty_like('X-CONVERT', 'a Founding partner cannot convert',
    pg_temp.ty_person('partner', $q$select public.ops_next_action_convert(array['39800000-0000-4000-c2bb-000000000001']::uuid[], null, 'y3980-convert-05')::text$q$), 'ERR:42501:owner_only:%');
end;
$convert$;

select count(*) as ty_total, count(*) filter (where not ok) as ty_failed,
       coalesce(string_agg(test || ' ' || label || ' [' || detail || ']', E'\n' order by seq) filter (where not ok), 'none') as ty_failures
  from ty_results \gset
rollback;

select (:ty_total < 50 or :ty_failed > 0) as ty_bad \gset
\if :ty_bad
  \echo 'ISSUE-3980 TESTER CALENDAR AND GATE FAILED:' :ty_failed 'of' :ty_total
  \echo :ty_failures
  do $$ begin raise exception 'ISSUE-3980 TESTER CALENDAR AND GATE FAIL'; end $$;
\endif
\echo 'ISSUE-3980 TESTER CALENDAR AND GATE PASS:' :ty_total 'checks, 0 failed'
