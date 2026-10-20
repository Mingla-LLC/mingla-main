-- Issue #3980 synced program, Wave 4 rework -- the fixes for the first
-- Wave 4 test, on the fully replayed PG17 schema.
--
-- What it proves (each check is recorded and reported together):
--   W4R-RLOCK   P2-1: a roadmap confirm locks the cards it lists (FOR UPDATE)
--               before it checks them again, and only those; a card linked
--               by an earlier confirm reads "already linked" to a later one
--               with another key and keeps its issue
--   W4R-PAGE    P2-4: the Team dashboard count is the owner's, runs no
--               matching and equals the preview total; the preview comes 50
--               brands a page (at most 100), newest first, pages never
--               overlap, together they hold every brand without a card, and
--               "more" says whether a next page exists
--   W4R-WORDS   P1-1: the confirm says "A card asks a person" only when a
--               card was added just now; a card that already waits, or one
--               closed in the last 14 days, is said plainly
--   W4R-GUIDE   P3-3: no "agent log" left in the Feature Guide entries this
--               program writes; Agent activity is named; the Calendar says
--               the launch steps are made automatically once the owner
--               switches automatic steps on
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
-- Reads which rows this transaction holds locked, and how (rolled back).
create extension if not exists pgrowlocks;

create temp table t3980w4r_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into t3980w4r_people (who, id, email) values
  ('owner', '39850000-0000-4000-a000-000000000001', 'ed.w4r3980@test.local'),
  ('admin', '39850000-0000-4000-a000-000000000002', 'di.w4r3980@test.local');
insert into auth.users (id, email, email_confirmed_at) select id, email, now() from t3980w4r_people;
insert into public.admin_users (email, role, status, accepted_at) values
  ('ed.w4r3980@test.local', 'owner', 'active', now()),
  ('di.w4r3980@test.local', 'admin', 'active', now());

create temp table t3980w4r_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;

create function pg_temp.w4r_as(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text; v_out text;
begin
  if p_who <> 'anon' then
    select id, email into strict v_id, v_email from t3980w4r_people where who = p_who;
  end if;
  begin
    if p_who = 'anon' then
      set local role anon;
      perform set_config('request.jwt.claim.sub', '', true);
      perform set_config('request.jwt.claims', '{"role":"anon"}', true);
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

-- Request rows written so far belong to an earlier, finished request.
create function pg_temp.w4r_person(p_who text, p_sql text) returns text
language plpgsql as $fn$
begin
  update public.team_agent_calls set xact_id = '3'::xid8, started_at = started_at - interval '5 minutes' where xact_id <> '3'::xid8;
  return pg_temp.w4r_as(p_who, p_sql);
end;
$fn$;

create function pg_temp.w4r_check(p_test text, p_label text, p_got text, p_want text) returns void
language plpgsql as $fn$
begin
  insert into t3980w4r_results (test, label, ok, detail)
  values (p_test, p_label, p_got is not distinct from p_want,
          format('got %s, want %s', coalesce(left(p_got, 700), '<null>'), coalesce(p_want, '<null>')));
end;
$fn$;

create function pg_temp.w4r_like(p_test text, p_label text, p_got text, p_pattern text) returns void
language plpgsql as $fn$
begin
  insert into t3980w4r_results (test, label, ok, detail)
  values (p_test, p_label, coalesce(p_got like p_pattern, false),
          format('got %s, want like %s', coalesce(left(p_got, 700), '<null>'), p_pattern));
end;
$fn$;

create function pg_temp.w4r_j(p text) returns jsonb
language plpgsql as $fn$
begin
  return p::jsonb;
exception when others then
  return jsonb_build_object('unreadable', left(p, 400));
end;
$fn$;

-- ---------------------------------------------------------------------------
-- W4R-RLOCK: a roadmap confirm locks the cards it lists before it re-checks
-- ---------------------------------------------------------------------------
insert into public.community_roadmap_cards (id, public_title, public_body, lane, status, sort_order) values
  ('39850000-0000-4000-d100-000000000001', 'W4R Card X', 'x', 'now', 'published', 960),
  ('39850000-0000-4000-d100-000000000002', 'W4R Card Y', 'y', 'now', 'published', 961),
  ('39850000-0000-4000-d100-000000000003', 'W4R Card Not Listed', 'z', 'now', 'published', 962);

do $rlock$
declare v text; p jsonb;
begin
  p := pg_temp.w4r_j(pg_temp.w4r_person('owner', $q$select public.ops_roadmap_links_confirm('[
      {"card_id":"39850000-0000-4000-d100-000000000002","issue":"#985101"},
      {"card_id":"39850000-0000-4000-d100-000000000001","issue":"#985101"}]'::jsonb, 'w4r-rlock-a1')::text$q$));
  perform pg_temp.w4r_check('W4R-RLOCK', 'confirm A links the first card and refuses the same issue twice',
    concat_ws('/', p->>'linked', p->>'skipped'), '1/1');
  -- Both listed cards, even the refused one, are held FOR UPDATE by this
  -- transaction; the card that was not listed is not locked at all.
  perform pg_temp.w4r_check('W4R-RLOCK', 'the listed cards are locked FOR UPDATE, the card not listed is not',
    (select string_agg(c.public_title || '=' || coalesce((select array_to_string(l.modes, '+')
                                                           from pgrowlocks('public.community_roadmap_cards') l where l.locked_row = c.ctid), 'none'),
                       ',' order by c.public_title)
       from public.community_roadmap_cards c where c.id::text like '39850000-0000-4000-d100-%'),
    'W4R Card Not Listed=none,W4R Card X=For Update,W4R Card Y=For Update');
  -- Confirm B, with another key, lists card Y for another issue: Y keeps A's issue.
  p := pg_temp.w4r_j(pg_temp.w4r_person('owner', $q$select public.ops_roadmap_links_confirm('[
      {"card_id":"39850000-0000-4000-d100-000000000002","issue":"#985102"}]'::jsonb, 'w4r-rlock-b1')::text$q$));
  perform pg_temp.w4r_check('W4R-RLOCK', 'confirm B reads the card as already linked and links nothing',
    concat_ws('|', p->>'linked', p->'results'->0->>'status', p->'results'->0->>'words'),
    '0|already_linked|This card is already linked to #985101. Change it on the card.');
  perform pg_temp.w4r_check('W4R-RLOCK', 'the card keeps the issue confirm A gave it',
    (select issue_number::text from public.ops_roadmap_links where card_id = '39850000-0000-4000-d100-000000000002'), '985101');
end;
$rlock$;

-- ---------------------------------------------------------------------------
-- W4R-PAGE: a cheap count, and the preview a page at a time
-- ---------------------------------------------------------------------------
-- 120 brands with no host card, newer than anything else in the database.
set local session_replication_role = replica;
insert into public.brands (id, account_id, name, slug, contact_email, created_at)
select ('39850000-0000-4000-b100-' || lpad(g::text, 12, '0'))::uuid, gen_random_uuid(), 'W4R Page Brand ' || lpad(g::text, 3, '0'),
       'w4r-page-brand-' || g, 'page' || g || '@w4r3980.test', now() + interval '1 day' + g * interval '1 second'
  from generate_series(1, 120) g;
set local session_replication_role = origin;

do $page$
declare v text; p1 jsonb; p2 jsonb; p3 jsonb; pbig jsonb; v_total integer;
begin
  v_total := (select count(*) from public.brands br where br.deleted_at is null
               and not exists (select 1 from public.crm_records h where h.brand_id = br.id and h.pipeline = 'hosts' and h.deleted_at is null));
  perform pg_temp.w4r_check('W4R-PAGE', 'the owner''s count is every brand without a host card',
    pg_temp.w4r_j(pg_temp.w4r_person('owner', 'select public.ops_brand_cards_count()::text'))->>'total', v_total::text);
  perform pg_temp.w4r_like('W4R-PAGE', 'an admin cannot read the count',
    pg_temp.w4r_person('admin', 'select public.ops_brand_cards_count()::text'), 'ERR:42501:forbidden: Only the owner adds host cards%');
  perform pg_temp.w4r_like('W4R-PAGE', 'a signed-out caller cannot read the count or a page',
    pg_temp.w4r_as('anon', 'select public.ops_brand_cards_count()::text') || pg_temp.w4r_as('anon', 'select public.ops_brand_cards_preview_page(0, 50)::text'),
    'ERR:42501:permission denied%ERR:42501:permission denied%');
  perform pg_temp.w4r_check('W4R-PAGE', 'the count runs no matching: it never calls ops_brand_match',
    (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('ops_brand_cards_count', 'ops_brand_cards_total') and p.prosrc ~ 'ops_brand_match'), '0');

  p1 := pg_temp.w4r_j(pg_temp.w4r_person('owner', 'select public.ops_brand_cards_preview()::text'));
  p2 := pg_temp.w4r_j(pg_temp.w4r_person('owner', 'select public.ops_brand_cards_preview_page(50, 50)::text'));
  p3 := pg_temp.w4r_j(pg_temp.w4r_person('owner', 'select public.ops_brand_cards_preview_page(100, 50)::text'));
  pbig := pg_temp.w4r_j(pg_temp.w4r_person('owner', 'select public.ops_brand_cards_preview_page(0, 500)::text'));
  perform pg_temp.w4r_check('W4R-PAGE', 'the first preview is one page of 50, with more to come and the full total',
    concat_ws('/', jsonb_array_length(p1->'rows'), p1->'page'->>'more', p1->'totals'->>'total', p1->'totals'->>'shown'), concat_ws('/', 50, 'true', v_total, 50));
  perform pg_temp.w4r_check('W4R-PAGE', 'a page never holds more than 100 brands',
    concat_ws('/', jsonb_array_length(pbig->'rows'), pbig->'page'->>'limit'), '100/100');
  perform pg_temp.w4r_check('W4R-PAGE', 'the newest brands come first: page one is brands 120 to 71, page two 70 to 21',
    (select concat_ws('/', min(r->>'name'), max(r->>'name')) from jsonb_array_elements(p1->'rows') r) || ' ' ||
    (select concat_ws('/', min(r->>'name'), max(r->>'name')) from jsonb_array_elements(p2->'rows') r),
    'W4R Page Brand 071/W4R Page Brand 120 W4R Page Brand 021/W4R Page Brand 070');
  perform pg_temp.w4r_check('W4R-PAGE', 'the pages never overlap and together hold every brand without a card',
    (select concat_ws('/', count(*), count(distinct r->>'brand_id'))
       from (select jsonb_array_elements(p1->'rows') r union all select jsonb_array_elements(p2->'rows')
             union all select jsonb_array_elements(p3->'rows')) x) || '/' ||
    (select count(*) from (select jsonb_array_elements(p1->'rows') r union all select jsonb_array_elements(p2->'rows')
                           union all select jsonb_array_elements(p3->'rows')) x where x.r->>'name' like 'W4R Page Brand %')::text,
    concat_ws('/', v_total, v_total, 120));
  perform pg_temp.w4r_check('W4R-PAGE', 'the last page says there is no more',
    concat_ws('/', p2->'page'->>'more', p3->'page'->>'more', p3->'page'->>'offset'), 'true/false/100');
end;
$page$;

-- ---------------------------------------------------------------------------
-- W4R-WORDS: "A card asks a person" only when a card was added just now
-- ---------------------------------------------------------------------------
insert into public.crm_records (id, pipeline, name, stage, created_by, updated_by) values
  ('39850000-0000-4000-c100-000000000001', 'hosts', 'W4R Twin One', 'contacted', 'w4r', 'w4r'),
  ('39850000-0000-4000-c100-000000000002', 'hosts', 'W4R Twin Two', 'contacted', 'w4r', 'w4r');
insert into public.crm_record_identifiers (record_id, kind, value, value_key, created_by) values
  ('39850000-0000-4000-c100-000000000001', 'email', 'twin@w4r3980.test', public.crm_ident_key('email', 'twin@w4r3980.test'), 'w4r'),
  ('39850000-0000-4000-c100-000000000002', 'email', 'twin@w4r3980.test', public.crm_ident_key('email', 'twin@w4r3980.test'), 'w4r');
set local session_replication_role = replica;
insert into public.brands (id, account_id, name, slug, contact_email) values
  ('39850000-0000-4000-b200-000000000001', gen_random_uuid(), 'W4R Twin Brand', 'w4r-twin-brand', 'twin@w4r3980.test');
set local session_replication_role = origin;

do $words$
declare p jsonb;
begin
  p := pg_temp.w4r_j(pg_temp.w4r_person('owner', $q$select public.ops_brand_cards_confirm(array['39850000-0000-4000-b200-000000000001']::uuid[], 'w4r-words-1')::text$q$));
  perform pg_temp.w4r_check('W4R-WORDS', 'a new pick card: the result says a card asks a person',
    concat_ws('|', p->'results'->0->>'status', p->'results'->0->>'words', ((p->'results'->0->>'card_id') is not null)::text),
    'pick|A card asks a person to pick the right host card.|true');
  p := pg_temp.w4r_j(pg_temp.w4r_person('owner', $q$select public.ops_brand_cards_confirm(array['39850000-0000-4000-b200-000000000001']::uuid[], 'w4r-words-2')::text$q$));
  perform pg_temp.w4r_check('W4R-WORDS', 'the card already waits: the result says so and no second card is made',
    concat_ws('|', p->'results'->0->>'words',
              (select count(*) from public.ops_work_cards where auto_key = 'brand_pick:39850000-0000-4000-b200-000000000001')),
    'A card already waits for a person; no second card was made.|1');
  -- Mingla itself closed the card two days ago (not a person's decision): no
  -- card can be added for 14 days, and the result does not pretend one was.
  update public.ops_work_cards set status = 'done', close_kind = 'done', close_reason = 'Closed by Mingla.',
         closed_at = now() - interval '2 days', closed_by = 'system@usemingla.com', closed_via = 'system'
   where auto_key = 'brand_pick:39850000-0000-4000-b200-000000000001';
  p := pg_temp.w4r_j(pg_temp.w4r_person('owner', $q$select public.ops_brand_cards_confirm(array['39850000-0000-4000-b200-000000000001']::uuid[], 'w4r-words-3')::text$q$));
  perform pg_temp.w4r_check('W4R-WORDS', 'a card closed in the last 14 days: no card, and the result never says a card asks',
    concat_ws('|', p->'results'->0->>'words', coalesce(p->'results'->0->>'card_id', 'no card'),
              (select count(*) from public.ops_work_cards where auto_key = 'brand_pick:39850000-0000-4000-b200-000000000001' and status <> 'done')),
    'Its card for a person was closed in the last 14 days; nothing new was asked.|no card|0');
end;
$words$;

-- ---------------------------------------------------------------------------
-- W4R-GUIDE: the old name is gone and the Calendar is exact about steps
-- ---------------------------------------------------------------------------
do $guide$
begin
  perform pg_temp.w4r_check('W4R-GUIDE', 'no entry this program writes says "agent log" anywhere',
    (select coalesce(string_agg(c.capability_key, ',' order by c.capability_key), 'none') from public.product_capabilities c
      where c.capability_key in ('staff-drafts', 'staff-work-board', 'staff-agent-log', 'staff-content-calendar', 'staff-crm',
                                 'staff-team-roles', 'staff-my-agent', 'staff-release-records')
        and concat_ws(' ', c.title, c.outcome_summary, c.how_to, c.limitations, c.support_wording) ilike '%agent log%'), 'none');
  perform pg_temp.w4r_like('W4R-GUIDE', 'Agent activity: the support wording names it',
    (select support_wording from public.product_capabilities where capability_key = 'staff-agent-log'), 'Agent activity is an internal Mingla Admin record%');
  perform pg_temp.w4r_like('W4R-GUIDE', 'Team and roles: names show in Agent activity',
    (select how_to from public.product_capabilities where capability_key = 'staff-team-roles'), '%in agent messages and in Agent activity;%');
  perform pg_temp.w4r_like('W4R-GUIDE', 'Calendar: the launch steps are made automatically once automatic steps are on',
    (select how_to from public.product_capabilities where capability_key = 'staff-content-calendar'),
    '%Once the owner switches on automatic steps, Mingla makes the eight launch steps automatically%');
  perform pg_temp.w4r_check('W4R-GUIDE', 'Calendar: it no longer says the steps are made by themselves',
    (select (how_to ilike '%launch steps by itself%')::text from public.product_capabilities where capability_key = 'staff-content-calendar'), 'false');
end;
$guide$;

select count(*) as w4r_total, count(*) filter (where not ok) as w4r_failed,
       coalesce(string_agg(test || ' ' || label || ' [' || detail || ']', E'\n' order by seq) filter (where not ok), 'none') as w4r_failures
  from t3980w4r_results \gset
rollback;

select (:w4r_total < 18 or :w4r_failed > 0) as w4r_bad \gset
\if :w4r_bad
  \echo 'ISSUE-3980 SYNCED WAVE 4 REWORK FAILED:' :w4r_failed 'of' :w4r_total
  \echo :w4r_failures
  do $$ begin raise exception 'ISSUE-3980 SYNCED WAVE 4 REWORK FAIL'; end $$;
\endif
\echo 'ISSUE-3980 SYNCED WAVE 4 REWORK PASS:' :w4r_total 'checks, 0 failed'
