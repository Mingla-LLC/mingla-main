-- Issue #3980 synced program, Wave 4 rework -- INDEPENDENT TESTER adversarial
-- suite (retest), on the fully replayed PG17 schema.
--
-- A different angle from the implementor's rework suite:
--   W4RT-RULE   one decided rule, read four ways: for each case the owner's
--               preview, the owner's confirm and the cron (ops_brand_autolink)
--               all end the same way. Cases: a person declined a pick card; a
--               person said a Lost card stays Lost; a new exact card after the
--               decision (asked again on the same card); Claude and Codex
--               closes (never a decision); a number read in a borrowed country;
--               a near-only phone after a decision; Mingla's own close. The
--               confirm and the cron each run on the same starting state and
--               are rolled back, so neither sees the other.
--   W4RT-COUNT  the cheap count equals the preview's total, a page's total and
--               the truth, with a deleted brand, a brand whose only host card
--               is deleted and a brand with a live host card in the data.
--   W4RT-WHO    count and pages: only the owner, signed in as a person. An
--               admin, a growth teammate, a person not on the team, an invited
--               owner, the service role with no person, a signed-out caller and
--               the owner's own Claude and Codex agents are all refused. The
--               helpers stay closed to every client role.
--   W4RT-PAGE   the limit is held between 1 and 100 for zero, negative, NULL
--               and huge values, a negative offset reads as 0, an offset past
--               the end is empty with no more to come, and two brands with the
--               same created_at keep one order across reads and page edges.
--   W4RT-LABEL  ops_link_label as replaced by W4 equals W2's for every kind
--               and name, except a name whose 160th character is a space
--               (where W2's label broke the label check); its attributes and
--               grants are unchanged.
--   W4RT-INDEX  the national-number index has the shape the brand lookup
--               uses, and the planner can use it for that lookup.
--   W4RT-W3X    the pick words name both countries for two pairs the
--               implementor does not use (a Memphis card and a Lagos brand; a
--               Lagos card and a London brand); a save 21 days out is not past
--               the go-live line, 20 days out and today are.
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
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (version text primary key);

create temp table t3980w4rt_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into t3980w4rt_people (who, id, email) values
  ('owner',    '4e5b0000-0000-4000-a000-000000000001', 'kemi.w4rt3980@test.local'),
  ('admin',    '4e5b0000-0000-4000-a000-000000000002', 'femi.w4rt3980@test.local'),
  ('growth',   '4e5b0000-0000-4000-a000-000000000003', 'dayo.w4rt3980@test.local'),
  ('stranger', '4e5b0000-0000-4000-a000-000000000004', 'nobody.w4rt3980@test.local'),
  ('invited',  '4e5b0000-0000-4000-a000-000000000005', 'later.w4rt3980@test.local');
insert into auth.users (id, email, email_confirmed_at) select id, email, now() from t3980w4rt_people;
insert into public.admin_users (email, role, status, accepted_at) values
  ('kemi.w4rt3980@test.local', 'owner', 'active', now()),
  ('femi.w4rt3980@test.local', 'admin', 'active', now()),
  ('later.w4rt3980@test.local', 'owner', 'invited', null);
insert into public.admin_team_members (email, role, status, accepted_at) values
  ('dayo.w4rt3980@test.local', 'growth', 'active', now());

create temp table t3980w4rt_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;

create function pg_temp.w4rt_check(p_test text, p_label text, p_got text, p_want text) returns void
language plpgsql as $fn$
begin
  insert into t3980w4rt_results (test, label, ok, detail)
  values (p_test, p_label, p_got is not distinct from p_want,
          format('got %s, want %s', coalesce(left(p_got, 900), '<null>'), coalesce(p_want, '<null>')));
end;
$fn$;

create function pg_temp.w4rt_like(p_test text, p_label text, p_got text, p_pattern text) returns void
language plpgsql as $fn$
begin
  insert into t3980w4rt_results (test, label, ok, detail)
  values (p_test, p_label, coalesce(p_got like p_pattern, false),
          format('got %s, want like %s', coalesce(left(p_got, 900), '<null>'), p_pattern));
end;
$fn$;

create function pg_temp.w4rt_j(p text) returns jsonb
language plpgsql as $fn$
begin
  return p::jsonb;
exception when others then
  return jsonb_build_object('unreadable', left(p, 400));
end;
$fn$;

create function pg_temp.w4rt_next_request() returns void
language sql as $fn$
  update public.team_agent_calls set xact_id = '3'::xid8, started_at = started_at - interval '5 minutes' where xact_id <> '3'::xid8
$fn$;

-- Runs p_sql as p_who: a signed-in person, 'anon', or 'service' (the service
-- role with no person). Returns the text result or ERR:<state>:<msg>.
create function pg_temp.w4rt_as(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text; v_out text;
begin
  if p_who not in ('anon', 'service') then
    select id, email into strict v_id, v_email from t3980w4rt_people where who = p_who;
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

create function pg_temp.w4rt_person(p_who text, p_sql text) returns text
language plpgsql as $fn$
begin
  perform pg_temp.w4rt_next_request();
  return pg_temp.w4rt_as(p_who, p_sql);
end;
$fn$;

-- The person's own connected agent (claude or codex) in this request.
create function pg_temp.w4rt_agent(p_who text, p_agent text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text;
begin
  perform pg_temp.w4rt_next_request();
  select id, email into strict v_id, v_email from t3980w4rt_people where who = p_who;
  insert into public.team_agent_calls (key_id, owner_email, actor_uid, agent, tool, xact_id, started_at)
  values (gen_random_uuid(), v_email, v_id, p_agent, 'list_work', pg_current_xact_id(), clock_timestamp());
  return pg_temp.w4rt_as(p_who, p_sql);
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Fixtures: launch cities and helpers that make host cards and brands.
-- ---------------------------------------------------------------------------
insert into public.seeding_cities (id, google_place_id, name, country, country_code, center_lat, center_lng,
                                   bbox_sw_lat, bbox_sw_lng, bbox_ne_lat, bbox_ne_lng) values
  ('4e5b0000-0000-4000-e000-000000000001', 'w4rt3980-lagos', 'W4RT3980 Lagos', 'Nigeria', 'NG', 6.5, 3.4, 6.4, 3.3, 6.6, 3.5),
  ('4e5b0000-0000-4000-e000-000000000002', 'w4rt3980-memphis', 'W4RT3980 Memphis', 'United States', 'US', 35.1, -90.0, 35.0, -90.1, 35.2, -89.9),
  ('4e5b0000-0000-4000-e000-000000000003', 'w4rt3980-london', 'W4RT3980 London', 'United Kingdom', 'GB', 51.5, -0.1, 51.4, -0.2, 51.6, 0.0);
-- The cron looks at brands since this moment.
insert into public.ops_settings (key, value, updated_by) values ('brand_auto_since', to_jsonb(now() - interval '30 days'), 'w4rt')
  on conflict (key) do update set value = excluded.value;

create function pg_temp.w4rt_host(p_id uuid, p_name text, p_stage text, p_kind text, p_value text,
                                  p_region uuid default null, p_at timestamptz default now()) returns void
language plpgsql as $fn$
begin
  insert into public.crm_records (id, pipeline, name, stage, stage_reason, region_id, created_by, updated_by)
  values (p_id, 'hosts', p_name, p_stage, case when p_stage = 'lost' then 'Not now' end, p_region, 'w4rt', 'w4rt')
  on conflict (id) do nothing;
  insert into public.crm_record_identifiers (record_id, kind, value, value_key, created_by, created_at)
  values (p_id, p_kind, p_value, public.crm_ident_key(p_kind, p_value), 'w4rt', p_at);
end;
$fn$;

create function pg_temp.w4rt_brand(p_id uuid, p_name text, p_email text, p_phone text default null, p_cc text default null,
                                   p_created timestamptz default now() - interval '1 hour', p_deleted timestamptz default null) returns void
language plpgsql as $fn$
begin
  set local session_replication_role = replica;
  insert into public.brands (id, account_id, name, slug, contact_email, contact_phone, country_code, created_at, deleted_at)
  values (p_id, gen_random_uuid(), p_name, 'w4rt-' || substr(md5(p_id::text), 1, 12), p_email, p_phone, p_cc, p_created, p_deleted);
  set local session_replication_role = origin;
end;
$fn$;

-- A brand's pick and reopen cards are closed: by a person (p_via NULL), by
-- an agent or by Mingla.
create function pg_temp.w4rt_close(p_brand uuid, p_via text, p_at timestamptz, p_kind text default 'declined') returns void
language sql as $fn$
  update public.ops_work_cards set status = 'done', close_kind = p_kind, close_reason = 'Decided in the tester suite.',
         closed_at = p_at, closed_by = case when p_via is null then 'kemi.w4rt3980@test.local' else 'system@usemingla.com' end,
         closed_via = p_via
   where auto_key in ('brand_pick:' || p_brand, 'brand_lost:' || p_brand) and status <> 'done';
$fn$;

-- What is true for a brand: its host cards and its pick/reopen cards.
create function pg_temp.w4rt_state(p_brand uuid) returns text
language sql as $fn$
  select concat_ws(';',
    'host=' || (select count(*) from public.crm_records h where h.brand_id = p_brand and h.pipeline = 'hosts' and h.deleted_at is null),
    'cards=' || coalesce((select string_agg(split_part(k.auto_key, ':', 1) || '/' || k.status, ',' order by k.number)
                            from public.ops_work_cards k where k.auto_key in ('brand_pick:' || p_brand, 'brand_lost:' || p_brand)), 'none'))
$fn$;

-- The preview's action for one brand, then the state after the owner's
-- confirm and, separately, after the cron, each from the same start.
create function pg_temp.w4rt_three(p_brand uuid, p_key text) returns jsonb
language plpgsql as $fn$
declare v_prev jsonb; v_row jsonb; v_conf jsonb; v_c text; v_k text; v_start text;
begin
  v_start := pg_temp.w4rt_state(p_brand);
  v_prev := pg_temp.w4rt_j(pg_temp.w4rt_person('owner', 'select public.ops_brand_cards_preview_page(0, 100)::text'));
  select r into v_row from jsonb_array_elements(v_prev->'rows') r where (r->>'brand_id')::uuid = p_brand;
  begin
    v_conf := pg_temp.w4rt_j(pg_temp.w4rt_person('owner',
                format('select public.ops_brand_cards_confirm(array[%L]::uuid[], %L)::text', p_brand, p_key)));
    v_c := pg_temp.w4rt_state(p_brand);
    raise exception 'w4rt_undo';
  exception when raise_exception then
    if sqlerrm <> 'w4rt_undo' then raise; end if;
  end;
  begin
    perform public.ops_brand_autolink();
    v_k := pg_temp.w4rt_state(p_brand);
    raise exception 'w4rt_undo';
  exception when raise_exception then
    if sqlerrm <> 'w4rt_undo' then raise; end if;
  end;
  return jsonb_build_object('start', v_start, 'preview', v_row->>'action', 'decided', jsonb_typeof(v_row->'decided') = 'object',
                            'confirm', v_conf->'results'->0->>'status', 'after_confirm', v_c, 'after_cron', v_k);
end;
$fn$;

-- ---------------------------------------------------------------------------
-- W4RT-RULE
-- ---------------------------------------------------------------------------
do $rule$
declare t jsonb;
begin
  -- A: a person declined the pick card 20 days ago.
  perform pg_temp.w4rt_host('4e5b0000-0000-4000-c100-00000000000a', 'W4RT A One', 'contacted', 'email', 'a@w4rt3980.test');
  perform pg_temp.w4rt_host('4e5b0000-0000-4000-c100-00000000001a', 'W4RT A Two', 'contacted', 'email', 'a@w4rt3980.test');
  perform pg_temp.w4rt_brand('4e5b0000-0000-4000-b100-00000000000a', 'W4RT A Brand', 'a@w4rt3980.test');
  perform public.ops_brand_autolink_one('4e5b0000-0000-4000-b100-00000000000a');
  perform pg_temp.w4rt_close('4e5b0000-0000-4000-b100-00000000000a', null, now() - interval '20 days');
  t := pg_temp.w4rt_three('4e5b0000-0000-4000-b100-00000000000a', 'w4rt-rule-a1');
  perform pg_temp.w4rt_check('W4RT-RULE', 'a person declined the pick: preview, confirm and cron all leave it decided',
    concat_ws('|', t->>'preview', t->>'decided', t->>'confirm', t->>'after_confirm', t->>'after_cron'),
    'decided|true|decided|host=0;cards=brand_pick/done|host=0;cards=brand_pick/done');

  -- B: a person said the Lost card stays Lost (2 days ago).
  perform pg_temp.w4rt_host('4e5b0000-0000-4000-c100-00000000000b', 'W4RT B Lost', 'lost', 'email', 'b@w4rt3980.test');
  perform pg_temp.w4rt_brand('4e5b0000-0000-4000-b100-00000000000b', 'W4RT B Brand', 'b@w4rt3980.test');
  perform public.ops_brand_autolink_one('4e5b0000-0000-4000-b100-00000000000b');
  perform pg_temp.w4rt_close('4e5b0000-0000-4000-b100-00000000000b', null, now() - interval '2 days');
  t := pg_temp.w4rt_three('4e5b0000-0000-4000-b100-00000000000b', 'w4rt-rule-b1');
  perform pg_temp.w4rt_check('W4RT-RULE', 'a person kept the Lost card Lost: all three leave it decided, nothing reopened',
    concat_ws('|', t->>'preview', t->>'confirm', t->>'after_confirm', t->>'after_cron'),
    'decided|decided|host=0;cards=brand_lost/done|host=0;cards=brand_lost/done');

  -- C: a new exact card after the person decided: asked again on the same card.
  perform pg_temp.w4rt_host('4e5b0000-0000-4000-c100-00000000000c', 'W4RT C One', 'contacted', 'email', 'c@w4rt3980.test');
  perform pg_temp.w4rt_host('4e5b0000-0000-4000-c100-00000000001c', 'W4RT C Two', 'contacted', 'email', 'c@w4rt3980.test');
  perform pg_temp.w4rt_brand('4e5b0000-0000-4000-b100-00000000000c', 'W4RT C Brand', 'c@w4rt3980.test');
  perform public.ops_brand_autolink_one('4e5b0000-0000-4000-b100-00000000000c');
  perform pg_temp.w4rt_close('4e5b0000-0000-4000-b100-00000000000c', null, now() - interval '20 days');
  perform pg_temp.w4rt_host('4e5b0000-0000-4000-c100-00000000002c', 'W4RT C Three', 'contacted', 'email', 'c@w4rt3980.test');
  t := pg_temp.w4rt_three('4e5b0000-0000-4000-b100-00000000000c', 'w4rt-rule-c1');
  perform pg_temp.w4rt_check('W4RT-RULE', 'a new exact card: preview picks, confirm and cron open the same card again (no second card)',
    concat_ws('|', t->>'preview', t->>'decided', t->>'confirm', t->>'after_confirm', t->>'after_cron'),
    'pick|false|pick|host=0;cards=brand_pick/todo|host=0;cards=brand_pick/todo');

  -- D and I: Claude and Codex closes are never a person's decision.
  perform pg_temp.w4rt_host('4e5b0000-0000-4000-c100-00000000000d', 'W4RT D One', 'contacted', 'email', 'd@w4rt3980.test');
  perform pg_temp.w4rt_host('4e5b0000-0000-4000-c100-00000000001d', 'W4RT D Two', 'contacted', 'email', 'd@w4rt3980.test');
  perform pg_temp.w4rt_brand('4e5b0000-0000-4000-b100-00000000000d', 'W4RT D Brand', 'd@w4rt3980.test');
  perform public.ops_brand_autolink_one('4e5b0000-0000-4000-b100-00000000000d');
  perform pg_temp.w4rt_close('4e5b0000-0000-4000-b100-00000000000d', 'claude', now() - interval '20 days');
  t := pg_temp.w4rt_three('4e5b0000-0000-4000-b100-00000000000d', 'w4rt-rule-d1');
  perform pg_temp.w4rt_check('W4RT-RULE', 'Claude closed the pick: not decided; confirm and cron open the card again',
    concat_ws('|', t->>'preview', t->>'confirm', t->>'after_confirm', t->>'after_cron'),
    'pick|pick|host=0;cards=brand_pick/todo|host=0;cards=brand_pick/todo');
  perform pg_temp.w4rt_host('4e5b0000-0000-4000-c100-00000000000e', 'W4RT I One', 'contacted', 'email', 'i@w4rt3980.test');
  perform pg_temp.w4rt_host('4e5b0000-0000-4000-c100-00000000001e', 'W4RT I Two', 'contacted', 'email', 'i@w4rt3980.test');
  perform pg_temp.w4rt_brand('4e5b0000-0000-4000-b100-00000000000e', 'W4RT I Brand', 'i@w4rt3980.test');
  perform public.ops_brand_autolink_one('4e5b0000-0000-4000-b100-00000000000e');
  perform pg_temp.w4rt_close('4e5b0000-0000-4000-b100-00000000000e', 'codex', now() - interval '1 day');
  perform pg_temp.w4rt_host('4e5b0000-0000-4000-c100-00000000002e', 'W4RT I Three', 'contacted', 'email', 'i@w4rt3980.test');
  t := pg_temp.w4rt_three('4e5b0000-0000-4000-b100-00000000000e', 'w4rt-rule-i1');
  perform pg_temp.w4rt_check('W4RT-RULE', 'Codex closed the pick, then a new exact card: confirm and cron open the one card again',
    concat_ws('|', t->>'preview', t->>'confirm', t->>'after_confirm', t->>'after_cron'),
    'pick|pick|host=0;cards=brand_pick/todo|host=0;cards=brand_pick/todo');

  -- E: a Lagos brand's 0901 234 5678 next to a regionless (901) 234-5678 card:
  -- read in a borrowed country, never linked by any of the three.
  perform pg_temp.w4rt_host('4e5b0000-0000-4000-c100-00000000000f', 'W4RT E Regionless', 'contacted', 'phone', '(901) 234-5678');
  perform pg_temp.w4rt_brand('4e5b0000-0000-4000-b100-00000000000f', 'W4RT E Brand', null, '0901 234 5678', 'NG');
  t := pg_temp.w4rt_three('4e5b0000-0000-4000-b100-00000000000f', 'w4rt-rule-e1');
  perform pg_temp.w4rt_check('W4RT-RULE', 'a borrowed country: preview picks, confirm and cron add a pick card and link nothing',
    concat_ws('|', t->>'preview', t->>'confirm', t->>'after_confirm', t->>'after_cron'),
    'pick|pick|host=0;cards=brand_pick/todo|host=0;cards=brand_pick/todo');
  perform pg_temp.w4rt_check('W4RT-RULE', 'the regionless card never carries the brand',
    (select coalesce(brand_id::text, 'none') from public.crm_records where id = '4e5b0000-0000-4000-c100-00000000000f'), 'none');

  -- H: decided, then a phone that only ends the same is added: still decided.
  perform pg_temp.w4rt_host('4e5b0000-0000-4000-c100-000000000010', 'W4RT H One', 'contacted', 'phone', '+2348012345678');
  perform pg_temp.w4rt_host('4e5b0000-0000-4000-c100-000000000011', 'W4RT H Two', 'contacted', 'phone', '+2348012345678');
  perform pg_temp.w4rt_brand('4e5b0000-0000-4000-b100-000000000010', 'W4RT H Brand', null, '+2348012345678', 'NG');
  perform public.ops_brand_autolink_one('4e5b0000-0000-4000-b100-000000000010');
  perform pg_temp.w4rt_close('4e5b0000-0000-4000-b100-000000000010', null, now() - interval '20 days');
  perform pg_temp.w4rt_host('4e5b0000-0000-4000-c100-000000000012', 'W4RT H Near', 'contacted', 'phone', '+447712345678');
  t := pg_temp.w4rt_three('4e5b0000-0000-4000-b100-000000000010', 'w4rt-rule-h1');
  perform pg_temp.w4rt_check('W4RT-RULE', 'a near-only phone after the decision: all three keep it decided',
    concat_ws('|', t->>'preview', t->>'confirm', t->>'after_confirm', t->>'after_cron'),
    'decided|decided|host=0;cards=brand_pick/done|host=0;cards=brand_pick/done');

  -- G: Mingla closed the card (not a person): not decided, and the confirm and
  -- the cron do the same thing.
  perform pg_temp.w4rt_host('4e5b0000-0000-4000-c100-000000000013', 'W4RT G One', 'contacted', 'email', 'g@w4rt3980.test');
  perform pg_temp.w4rt_host('4e5b0000-0000-4000-c100-000000000014', 'W4RT G Two', 'contacted', 'email', 'g@w4rt3980.test');
  perform pg_temp.w4rt_brand('4e5b0000-0000-4000-b100-000000000013', 'W4RT G Brand', 'g@w4rt3980.test');
  perform public.ops_brand_autolink_one('4e5b0000-0000-4000-b100-000000000013');
  perform pg_temp.w4rt_close('4e5b0000-0000-4000-b100-000000000013', 'system', now() - interval '3 days', 'system');
  t := pg_temp.w4rt_three('4e5b0000-0000-4000-b100-000000000013', 'w4rt-rule-g1');
  perform pg_temp.w4rt_check('W4RT-RULE', 'Mingla''s own close is not decided, and confirm and cron end the same',
    concat_ws('|', t->>'preview', t->>'decided', ((t->>'after_confirm') = (t->>'after_cron'))::text), 'pick|false|true');
end;
$rule$;

-- ---------------------------------------------------------------------------
-- W4RT-COUNT and W4RT-WHO
-- ---------------------------------------------------------------------------
do $count$
declare v_truth text; c jsonb; p jsonb; q jsonb; v text; w text;
begin
  perform pg_temp.w4rt_brand('4e5b0000-0000-4000-b200-000000000001', 'W4RT Deleted Brand', null, null, null, now() - interval '1 hour', now());
  perform pg_temp.w4rt_brand('4e5b0000-0000-4000-b200-000000000002', 'W4RT Card Deleted Brand', null);
  perform pg_temp.w4rt_brand('4e5b0000-0000-4000-b200-000000000003', 'W4RT Has Card Brand', null);
  insert into public.crm_records (id, pipeline, name, stage, created_by, updated_by, brand_id, deleted_at, deleted_by) values
    ('4e5b0000-0000-4000-c200-000000000002', 'hosts', 'W4RT Deleted Host Card', 'contacted', 'w4rt', 'w4rt', '4e5b0000-0000-4000-b200-000000000002', now(), 'w4rt'),
    ('4e5b0000-0000-4000-c200-000000000003', 'hosts', 'W4RT Live Host Card', 'contacted', 'w4rt', 'w4rt', '4e5b0000-0000-4000-b200-000000000003', null, null);
  select count(*)::text into v_truth from public.brands br
   where br.deleted_at is null
     and not exists (select 1 from public.crm_records h where h.brand_id = br.id and h.pipeline = 'hosts' and h.deleted_at is null);
  c := pg_temp.w4rt_j(pg_temp.w4rt_person('owner', 'select public.ops_brand_cards_count()::text'));
  p := pg_temp.w4rt_j(pg_temp.w4rt_person('owner', 'select public.ops_brand_cards_preview()::text'));
  q := pg_temp.w4rt_j(pg_temp.w4rt_person('owner', 'select public.ops_brand_cards_preview_page(3, 7)::text'));
  perform pg_temp.w4rt_check('W4RT-COUNT', 'count = preview total = a page''s total = brands without a live host card',
    concat_ws('/', c->>'total', p->'totals'->>'total', q->'totals'->>'total'), concat_ws('/', v_truth, v_truth, v_truth));
  perform pg_temp.w4rt_check('W4RT-COUNT', 'the brand whose only host card is deleted is counted and listed; the deleted brand and the carded brand are not',
    concat_ws('/',
      (select count(*) from jsonb_array_elements(pg_temp.w4rt_j(pg_temp.w4rt_person('owner', 'select public.ops_brand_cards_preview_page(0, 100)::text'))->'rows') r
        where r->>'name' = 'W4RT Card Deleted Brand')::text,
      (select count(*) from jsonb_array_elements(pg_temp.w4rt_j(pg_temp.w4rt_person('owner', 'select public.ops_brand_cards_preview_page(0, 100)::text'))->'rows') r
        where r->>'name' in ('W4RT Deleted Brand', 'W4RT Has Card Brand'))::text), '1/0');

  foreach w in array array['admin', 'growth', 'stranger', 'invited', 'anon', 'service'] loop
    v := pg_temp.w4rt_person(w, 'select public.ops_brand_cards_count()::text');
    perform pg_temp.w4rt_like('W4RT-WHO', w || ' cannot read the count', v, 'ERR:42501:%');
    v := pg_temp.w4rt_person(w, 'select public.ops_brand_cards_preview_page(0, 10)::text');
    perform pg_temp.w4rt_like('W4RT-WHO', w || ' cannot read a page', v, 'ERR:42501:%');
  end loop;
  foreach w in array array['claude', 'codex'] loop
    v := pg_temp.w4rt_agent('owner', w, 'select public.ops_brand_cards_count()::text');
    perform pg_temp.w4rt_like('W4RT-WHO', 'the owner''s own ' || w || ' agent cannot read the count', v, 'ERR:42501:forbidden:%');
    v := pg_temp.w4rt_agent('owner', w, 'select public.ops_brand_cards_preview_page(0, 10)::text');
    perform pg_temp.w4rt_like('W4RT-WHO', 'the owner''s own ' || w || ' agent cannot read a page', v, 'ERR:42501:forbidden:%');
  end loop;
  perform pg_temp.w4rt_check('W4RT-WHO', 'the helpers stay closed to anon and authenticated',
    concat_ws('/',
      has_function_privilege('authenticated', 'public.ops_brand_cards_total()', 'EXECUTE')::text,
      has_function_privilege('anon', 'public.ops_brand_cards_total()', 'EXECUTE')::text,
      has_function_privilege('authenticated', 'public.ops_brand_cards_rows(integer,integer)', 'EXECUTE')::text,
      has_function_privilege('anon', 'public.ops_brand_cards_rows(integer,integer)', 'EXECUTE')::text,
      has_function_privilege('authenticated', 'public.ops_brand_decided(uuid)', 'EXECUTE')::text,
      has_function_privilege('anon', 'public.ops_brand_cards_count()', 'EXECUTE')::text,
      has_function_privilege('anon', 'public.ops_brand_cards_preview_page(integer,integer)', 'EXECUTE')::text),
    'false/false/false/false/false/false/false');
end;
$count$;

-- ---------------------------------------------------------------------------
-- W4RT-PAGE
-- ---------------------------------------------------------------------------
-- 12 brands created one minute apart; two share one created_at (a tie).
select pg_temp.w4rt_brand(('4e5b0000-0000-4000-b300-' || lpad(g::text, 12, '0'))::uuid, 'W4RT Page ' || lpad(g::text, 2, '0'), null, null, null,
                          timestamptz '2020-01-01 12:00' + (case when g = 7 then 6 else g end) * interval '1 minute')
  from generate_series(1, 12) g;

do $page$
declare j jsonb; v_total int; o text; l text; want text; a text; b text;
begin
  v_total := (pg_temp.w4rt_j(pg_temp.w4rt_person('owner', 'select public.ops_brand_cards_count()::text'))->>'total')::int;
  for o, l, want in select * from (values
      ('0', '0', '0/1/1'), ('0', '-5', '0/1/1'), ('0', 'null', '0/50/50'), ('null', 'null', '0/50/50'), ('0', '101', '0/100/100'),
      ('0', '2147483647', '0/100/100'), ('-10', '10', '0/10/10')) x(o, l, want) loop
    j := pg_temp.w4rt_j(pg_temp.w4rt_person('owner', format('select public.ops_brand_cards_preview_page(%s, %s)::text', o, l)));
    perform pg_temp.w4rt_check('W4RT-PAGE', format('offset %s, limit %s is held to offset/limit/rows', o, l),
      concat_ws('/', j->'page'->>'offset', j->'page'->>'limit', least(jsonb_array_length(j->'rows'), (j->'page'->>'limit')::int)),
      case when v_total >= 100 then want else concat_ws('/', split_part(want, '/', 1), split_part(want, '/', 2), least(split_part(want, '/', 3)::int, v_total)) end);
  end loop;
  j := pg_temp.w4rt_j(pg_temp.w4rt_person('owner', 'select public.ops_brand_cards_preview_page(2147483647, 100)::text'));
  perform pg_temp.w4rt_check('W4RT-PAGE', 'an offset past the end: no rows, no more, no error',
    concat_ws('/', jsonb_array_length(j->'rows'), j->'page'->>'more', j->'totals'->>'total'), concat_ws('/', 0, 'false', v_total));
  -- The tie: the oldest 12 brands are the last 12 of the list. Read the two
  -- pages that split the tie, several times: always the same split.
  a := (pg_temp.w4rt_j(pg_temp.w4rt_person('owner', format('select public.ops_brand_cards_preview_page(%s, 6)::text', v_total - 12)))->'rows')::text;
  b := (pg_temp.w4rt_j(pg_temp.w4rt_person('owner', format('select public.ops_brand_cards_preview_page(%s, 6)::text', v_total - 6)))->'rows')::text;
  perform pg_temp.w4rt_check('W4RT-PAGE', 'two brands with one created_at keep one order across reads and page edges',
    (select count(distinct x)::text from (
       select (pg_temp.w4rt_j(pg_temp.w4rt_person('owner', format('select public.ops_brand_cards_preview_page(%s, 6)::text', v_total - 12)))->'rows')::text
              || (pg_temp.w4rt_j(pg_temp.w4rt_person('owner', format('select public.ops_brand_cards_preview_page(%s, 6)::text', v_total - 6)))->'rows')::text x
         from generate_series(1, 4)) s), '1');
  perform pg_temp.w4rt_check('W4RT-PAGE', 'the two pages that split the tie hold all 12 oldest brands once',
    (select count(distinct r->>'brand_id')::text from (
       select jsonb_array_elements(a::jsonb) r union all select jsonb_array_elements(b::jsonb)) s where r->>'name' like 'W4RT Page %'), '12');
end;
$page$;

-- ---------------------------------------------------------------------------
-- W4RT-LABEL: W4's ops_link_label against W2's, copied verbatim below.
-- ---------------------------------------------------------------------------
create function pg_temp.w2_link_label(p_kind text, p_id uuid) returns text
language plpgsql stable as $fn$
DECLARE v text;
BEGIN
  IF p_id IS NULL THEN RETURN NULL; END IF;
  IF p_kind IN ('host', 'creator') THEN
    SELECT c.name INTO v FROM public.crm_records c WHERE c.id = p_id AND c.deleted_at IS NULL AND c.pipeline = p_kind || 's';
  ELSIF p_kind = 'brand' THEN
    SELECT b.name INTO v FROM public.brands b WHERE b.id = p_id AND b.deleted_at IS NULL;
  ELSIF p_kind = 'event' THEN
    IF public.ops_event_in_scope(p_id) THEN SELECT e.title INTO v FROM public.events e WHERE e.id = p_id; END IF;
  ELSIF p_kind = 'content' THEN
    SELECT i.title INTO v FROM public.content_calendar_items i WHERE i.id = p_id AND i.deleted_at IS NULL;
  ELSIF p_kind = 'expected' THEN
    SELECT x.title INTO v FROM public.ops_expected_events x WHERE x.id = p_id AND x.status <> 'cancelled';
  ELSIF p_kind = 'card' THEN
    SELECT w.title INTO v FROM public.ops_work_cards w WHERE w.id = p_id AND w.archived_at IS NULL;
  ELSIF p_kind = 'roadmap_card' THEN
    SELECT r.public_title INTO v FROM public.community_roadmap_cards r WHERE r.id = p_id;
  END IF;
  RETURN left(COALESCE(NULLIF(btrim(v), ''), CASE WHEN v IS NOT NULL THEN 'Untitled' END), 160);
END;
$fn$;

select pg_temp.w4rt_brand(('4e5b0000-0000-4000-b400-' || lpad(n::text, 12, '0'))::uuid, nm, null, null, null, now() - interval '1 hour',
                          case when n = 7 then now() end)
  from (values (1, 'Plain Brand'), (2, repeat('x', 160)), (3, repeat('y', 159) || ' tail of a long name'),
               (4, '   Leading and trailing   '), (5, repeat('z', 200)), (6, repeat('w', 158) || '  two spaces at 159 and 160'),
               (7, 'Café Zürich & Sons')) v(n, nm);
insert into public.community_roadmap_cards (id, public_title, public_body, lane, status, sort_order) values
  ('4e5b0000-0000-4000-d400-000000000001', 'W4RT Roadmap Label', 'x', 'now', 'published', 970);

do $label$
declare r record; v_same int := 0; v_diff text := ''; v_w2 text; v_w4 text;
begin
  for r in
    select 'brand' as kind, id from public.brands where id::text like '4e5b0000-0000-4000-b400-%'
    union all select 'host', '4e5b0000-0000-4000-c100-00000000000a'::uuid
    union all select 'creator', '4e5b0000-0000-4000-c100-00000000000a'::uuid
    union all select 'roadmap_card', '4e5b0000-0000-4000-d400-000000000001'::uuid
    union all select 'nonsense', '4e5b0000-0000-4000-d400-000000000001'::uuid
    union all select 'brand', null::uuid
    union all select 'card', gen_random_uuid()
  loop
    v_w2 := pg_temp.w2_link_label(r.kind, r.id);
    v_w4 := public.ops_link_label(r.kind, r.id);
    if v_w2 is not distinct from v_w4 then v_same := v_same + 1;
    else v_diff := v_diff || coalesce(right(r.id::text, 2), '-') || '=' || length(v_w2) || '>' || length(v_w4) || ' '; end if;
  end loop;
  perform pg_temp.w4rt_check('W4RT-LABEL', 'W4''s label equals W2''s everywhere except the two names cut on a space (now trimmed)',
    v_same || ' same; ' || btrim(v_diff), '11 same; 03=160>159 06=160>158');
  perform pg_temp.w4rt_check('W4RT-LABEL', 'every label W4 makes passes the link label check (trimmed, 1 to 160)',
    (select bool_and(l = btrim(l) and char_length(l) between 1 and 160)::text
       from (select public.ops_link_label('brand', id) l from public.brands
              where id::text like '4e5b0000-0000-4000-b400-%' and deleted_at is null) s), 'true');
  perform pg_temp.w4rt_check('W4RT-LABEL', 'attributes and grants unchanged: definer, stable, pinned path, service_role only',
    (select concat_ws('/', p.prosecdef::text, p.provolatile, array_to_string(p.proconfig, ','),
                      has_function_privilege('authenticated', p.oid, 'EXECUTE')::text, has_function_privilege('anon', p.oid, 'EXECUTE')::text,
                      has_function_privilege('service_role', p.oid, 'EXECUTE')::text)
       from pg_proc p where p.oid = 'public.ops_link_label(text,uuid)'::regprocedure),
    'true/s/search_path=pg_catalog, pg_temp/false/false/true');
end;
$label$;

-- ---------------------------------------------------------------------------
-- W4RT-INDEX
-- ---------------------------------------------------------------------------
do $idx$
declare v_plan text := ''; r record;
begin
  perform pg_temp.w4rt_check('W4RT-INDEX', 'the national-number index: last six digits, only rows with a national number',
    pg_get_indexdef('public.crm_record_identifiers_by_national6'::regclass),
    'CREATE INDEX crm_record_identifiers_by_national6 ON public.crm_record_identifiers USING btree ("right"("national", 6)) WHERE ("national" IS NOT NULL)');
  set local enable_seqscan = off;
  set local enable_bitmapscan = off;
  for r in execute $q$explain (costs off)
      select i.record_id from (select '+2348030001234'::text as value_key) w
        join public.crm_record_identifiers i on i.national is not null and right(i.national, 6) = right(public.crm_phone_national(w.value_key), 6)
       where i.kind = 'phone'$q$ loop
    v_plan := v_plan || r."QUERY PLAN" || ' ';
  end loop;
  perform pg_temp.w4rt_like('W4RT-INDEX', 'the brand lookup''s phone join can use the index', v_plan, '%crm_record_identifiers_by_national6%');
end;
$idx$;

-- ---------------------------------------------------------------------------
-- W4RT-W3X
-- ---------------------------------------------------------------------------
select pg_temp.w4rt_host('4e5b0000-0000-4000-c500-000000000001', 'W4RT Memphis Digits', 'contacted', 'phone', '803 123 4567',
                         '4e5b0000-0000-4000-e000-000000000002'::uuid);
select pg_temp.w4rt_brand('4e5b0000-0000-4000-b500-000000000001', 'W4RT Lagos Brand Digits', null, '803 123 4567', 'NG');
select pg_temp.w4rt_host('4e5b0000-0000-4000-c500-000000000002', 'W4RT Lagos Digits', 'contacted', 'phone', '07911 987654',
                         '4e5b0000-0000-4000-e000-000000000001'::uuid);
select pg_temp.w4rt_brand('4e5b0000-0000-4000-b500-000000000002', 'W4RT London Brand Digits', null, '07911 987654', 'GB');

do $w3x$
declare m jsonb; v text;
begin
  m := public.ops_brand_match('4e5b0000-0000-4000-b500-000000000001');
  perform pg_temp.w4rt_check('W4RT-W3X', 'a Memphis card and a Lagos brand with the same digits: pick, words name both countries',
    concat_ws('|', m->>'status', m->>'near_words'), 'pick|the same digits but different numbers in United States and Nigeria');
  m := public.ops_brand_match('4e5b0000-0000-4000-b500-000000000002');
  perform pg_temp.w4rt_check('W4RT-W3X', 'a Lagos card and a London brand with the same digits: pick, words name both countries',
    concat_ws('|', m->>'status', m->>'near_words'), 'pick|the same digits but different numbers in Nigeria and United Kingdom');
  perform public.ops_brand_autolink_one('4e5b0000-0000-4000-b500-000000000002');
  v := (select instructions from public.ops_work_cards where auto_key = 'brand_pick:4e5b0000-0000-4000-b500-000000000002');
  perform pg_temp.w4rt_check('W4RT-W3X', 'the London brand''s pick card names both countries and never says no country is on record',
    concat_ws('|', (v like '%the same digits but different numbers in Nigeria and United Kingdom%')::text, (v like '%no country is on record%')::text), 'true|false');
  perform pg_temp.w4rt_check('W4RT-W3X', 'neither card was linked', (select count(*)::text from public.crm_records
    where id in ('4e5b0000-0000-4000-c500-000000000001', '4e5b0000-0000-4000-c500-000000000002') and brand_id is not null), '0');
end;
$w3x$;

insert into public.crm_records (id, pipeline, name, stage, icp, created_by, updated_by) values
  ('4e5b0000-0000-4000-c600-000000000001', 'hosts', 'W4RT Steps Host', 'onboarded', 'event_organizer', 'w4rt', 'w4rt');
insert into public.crm_record_owners (record_id, owner_email, added_by) values ('4e5b0000-0000-4000-c600-000000000001', 'kemi.w4rt3980@test.local', 'w4rt');
insert into public.ops_settings (key, value, updated_by) values ('auto_steps', 'true'::jsonb, 'w4rt')
  on conflict (key) do update set value = excluded.value;

do $golive$
declare d int; p jsonb; v_got text := '';
begin
  foreach d in array array[22, 21, 20, 0] loop
    p := pg_temp.w4rt_j(pg_temp.w4rt_person('owner', format('select public.ops_expected_event_set(%L::jsonb, %L)::text',
           jsonb_build_object('record_id', '4e5b0000-0000-4000-c600-000000000001', 'title', 'W4RT Night in ' || d || ' days', 'event_type', 'event',
                              'expected_on', ((now() AT TIME ZONE 'UTC')::date + d)::text), 'w4rt-golive-' || d)));
    v_got := v_got || d || ':' || coalesce(p->'steps'->>'past_go_live', p::text) || ' ';
  end loop;
  perform pg_temp.w4rt_check('W4RT-W3X', 'past the go-live line only under 21 days out: 22 and 21 are not, 20 and today are',
    btrim(v_got), '22:false 21:false 20:true 0:true');
end;
$golive$;

select count(*) as w4rt_total, count(*) filter (where not ok) as w4rt_failed,
       coalesce(string_agg(test || ' ' || label || ' [' || detail || ']', E'\n' order by seq) filter (where not ok), 'none') as w4rt_failures
  from t3980w4rt_results \gset
rollback;

select (:w4rt_total < 45 or :w4rt_failed > 0) as w4rt_bad \gset
\if :w4rt_bad
  \echo 'ISSUE-3980 SYNCED WAVE 4 REWORK TESTER FAILED:' :w4rt_failed 'of' :w4rt_total
  \echo :w4rt_failures
  do $$ begin raise exception 'ISSUE-3980 SYNCED WAVE 4 REWORK TESTER FAIL'; end $$;
\endif
\echo 'ISSUE-3980 SYNCED WAVE 4 REWORK TESTER PASS:' :w4rt_total 'checks, 0 failed'
