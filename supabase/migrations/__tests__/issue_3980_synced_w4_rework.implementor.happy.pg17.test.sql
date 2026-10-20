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
--   W4R-DECIDED P1-1: a brand whose pick or reopen card a person closed is
--               "decided" in the preview (who and when), its confirm leaves it
--               as it is, and the cron makes nothing for it; an agent's close
--               is not a decision; a new exact match since then is asked
--               again on the same card. Preview, confirm and cron all read
--               ops_brand_decided, the one copy of the rule
--   W4R-BLOCK   P2-2: brand auto-link for one brand holds a lock on that
--               brand until its transaction ends, so a second caller waits
--   W4R-LONG    P3-1: a brand name over 160 characters previews "Add card"
--               and its confirm adds the card with the first 160 characters;
--               when a card already has that name both say a person picks
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

-- ---------------------------------------------------------------------------
-- W4R-DECIDED: a person's decision is kept by the preview, the confirm and
-- the cron alike
-- ---------------------------------------------------------------------------
insert into public.crm_records (id, pipeline, name, stage, stage_reason, created_by, updated_by) values
  ('39850000-0000-4000-c300-000000000001', 'hosts', 'W4R Lost Again', 'lost', 'Not now', 'w4r', 'w4r'),
  ('39850000-0000-4000-c300-000000000002', 'hosts', 'W4R Pair One', 'contacted', null, 'w4r', 'w4r'),
  ('39850000-0000-4000-c300-000000000003', 'hosts', 'W4R Pair Two', 'contacted', null, 'w4r', 'w4r'),
  ('39850000-0000-4000-c300-000000000004', 'hosts', 'W4R Agent One', 'contacted', null, 'w4r', 'w4r'),
  ('39850000-0000-4000-c300-000000000005', 'hosts', 'W4R Agent Two', 'contacted', null, 'w4r', 'w4r');
insert into public.crm_record_identifiers (record_id, kind, value, value_key, created_by) values
  ('39850000-0000-4000-c300-000000000001', 'email', 'again@w4r3980.test', public.crm_ident_key('email', 'again@w4r3980.test'), 'w4r'),
  ('39850000-0000-4000-c300-000000000002', 'email', 'pair@w4r3980.test', public.crm_ident_key('email', 'pair@w4r3980.test'), 'w4r'),
  ('39850000-0000-4000-c300-000000000003', 'email', 'pair@w4r3980.test', public.crm_ident_key('email', 'pair@w4r3980.test'), 'w4r'),
  ('39850000-0000-4000-c300-000000000004', 'email', 'agent@w4r3980.test', public.crm_ident_key('email', 'agent@w4r3980.test'), 'w4r'),
  ('39850000-0000-4000-c300-000000000005', 'email', 'agent@w4r3980.test', public.crm_ident_key('email', 'agent@w4r3980.test'), 'w4r');
set local session_replication_role = replica;
insert into public.brands (id, account_id, name, slug, contact_email, created_at) values
  ('39850000-0000-4000-b300-000000000001', gen_random_uuid(), 'W4R Lost Decided', 'w4r-lost-decided', 'again@w4r3980.test', now() - interval '1 hour'),
  ('39850000-0000-4000-b300-000000000002', gen_random_uuid(), 'W4R Pick Decided', 'w4r-pick-decided', 'pair@w4r3980.test', now() - interval '1 hour'),
  ('39850000-0000-4000-b300-000000000003', gen_random_uuid(), 'W4R Agent Closed', 'w4r-agent-closed', 'agent@w4r3980.test', now() - interval '1 hour');
set local session_replication_role = origin;

do $decided$
declare p jsonb; v_cron jsonb; v_rows jsonb := '[]'::jsonb; v_off integer := 0; v_page jsonb;
begin
  -- Brand auto-link asked a person about each brand.
  perform public.ops_brand_autolink_one('39850000-0000-4000-b300-000000000001');
  perform public.ops_brand_autolink_one('39850000-0000-4000-b300-000000000002');
  perform public.ops_brand_autolink_one('39850000-0000-4000-b300-000000000003');
  perform pg_temp.w4r_check('W4R-DECIDED', 'auto-link made one reopen and two pick cards',
    (select string_agg(split_part(auto_key, ':', 1), ',' order by auto_key) from public.ops_work_cards
      where auto_key like 'brand_%:39850000-0000-4000-b300-%' and status <> 'done'), 'brand_lost,brand_pick,brand_pick');
  -- The owner, in person, decided about the first two 20 days ago; an agent
  -- closed the third.
  update public.ops_work_cards set status = 'done', close_kind = 'declined', close_reason = 'Decided by a person.',
         closed_at = now() - interval '20 days', closed_by = 'ed.w4r3980@test.local', closed_via = null
   where auto_key in ('brand_lost:39850000-0000-4000-b300-000000000001', 'brand_pick:39850000-0000-4000-b300-000000000002');
  update public.ops_work_cards set status = 'done', close_kind = 'done', close_reason = 'Closed by an agent.',
         closed_at = now() - interval '20 days', closed_by = 'ed.w4r3980@test.local', closed_via = 'claude'
   where auto_key = 'brand_pick:39850000-0000-4000-b300-000000000003';

  -- The preview: every page, until the brands are found.
  loop
    v_page := pg_temp.w4r_j(pg_temp.w4r_person('owner', format('select public.ops_brand_cards_preview_page(%s, 100)::text', v_off)));
    v_rows := v_rows || coalesce(v_page->'rows', '[]'::jsonb);
    exit when not coalesce((v_page->'page'->>'more')::boolean, false) or v_off > 2000;
    v_off := v_off + 100;
  end loop;
  perform pg_temp.w4r_check('W4R-DECIDED', 'the preview shows the two decided brands as decided, the agent-closed one as a pick',
    (select string_agg(r->>'name' || '=' || (r->>'action'), ',' order by r->>'name') from jsonb_array_elements(v_rows) r
      where r->>'name' in ('W4R Lost Decided', 'W4R Pick Decided', 'W4R Agent Closed')),
    'W4R Agent Closed=pick,W4R Lost Decided=decided,W4R Pick Decided=decided');
  perform pg_temp.w4r_like('W4R-DECIDED', 'a decided row says who decided and when, and names that person''s card',
    (select concat_ws('|', r->'decided'->>'by', ((r->'decided'->>'card_id') is not null)::text, r->>'words') from jsonb_array_elements(v_rows) r
      where r->>'name' = 'W4R Pick Decided'),
    'ed.w4r3980@test.local|true|Decided by % on %. Mingla leaves this brand as it is.');

  -- The confirm leaves both as they are and asks nobody.
  p := pg_temp.w4r_j(pg_temp.w4r_person('owner', $q$select public.ops_brand_cards_confirm(array['39850000-0000-4000-b300-000000000001','39850000-0000-4000-b300-000000000002']::uuid[], 'w4r-decided-1')::text$q$));
  perform pg_temp.w4r_like('W4R-DECIDED', 'the confirm says each is decided and left as it is',
    (select string_agg(r->>'status' || ':' || (r->>'words'), ' ; ' order by r->>'name') from jsonb_array_elements(p->'results') r),
    'decided:Decided by % on %; left as it is. ; decided:Decided by % on %; left as it is.');
  -- The cron, switched on, makes nothing for them either.
  insert into public.ops_settings (key, value, updated_by) values ('brand_auto_since', to_jsonb(now() - interval '1 day'), 'w4r')
    on conflict (key) do update set value = excluded.value;
  v_cron := public.ops_brand_autolink();
  perform pg_temp.w4r_check('W4R-DECIDED', 'neither the confirm nor the cron opened a card again for the decided brands',
    (select count(*)::text from public.ops_work_cards
      where auto_key in ('brand_lost:39850000-0000-4000-b300-000000000001', 'brand_pick:39850000-0000-4000-b300-000000000002') and status <> 'done'), '0');
  perform pg_temp.w4r_check('W4R-DECIDED', 'the agent-closed pick is asked again (an agent''s close is not a decision)',
    (select count(*)::text from public.ops_work_cards where auto_key = 'brand_pick:39850000-0000-4000-b300-000000000003' and status <> 'done'), '1');

  -- A new host card with the same email appears after the decision: the
  -- preview asks again, and the confirm opens that same card again.
  insert into public.crm_records (id, pipeline, name, stage, created_by, updated_by) values
    ('39850000-0000-4000-c300-000000000006', 'hosts', 'W4R Pair Three', 'contacted', 'w4r', 'w4r');
  insert into public.crm_record_identifiers (record_id, kind, value, value_key, created_by) values
    ('39850000-0000-4000-c300-000000000006', 'email', 'pair@w4r3980.test', public.crm_ident_key('email', 'pair@w4r3980.test'), 'w4r');
  perform pg_temp.w4r_check('W4R-DECIDED', 'with a new exact match the brand''s decision reads pick (ask again)',
    concat_ws('|', public.ops_brand_match('39850000-0000-4000-b300-000000000002')->>'status',
              public.ops_brand_match('39850000-0000-4000-b300-000000000002')->>'reask'), 'pick|true');
  p := pg_temp.w4r_j(pg_temp.w4r_person('owner', $q$select public.ops_brand_cards_confirm(array['39850000-0000-4000-b300-000000000002']::uuid[], 'w4r-decided-2')::text$q$));
  perform pg_temp.w4r_check('W4R-DECIDED', 'the confirm opens the person''s card again, not a second card',
    concat_ws('|', p->'results'->0->>'status',
              (select count(*) from public.ops_work_cards where auto_key = 'brand_pick:39850000-0000-4000-b300-000000000002'),
              (select count(*) from public.ops_work_cards where auto_key = 'brand_pick:39850000-0000-4000-b300-000000000002' and status <> 'done')),
    'pick|1|1');

  -- One copy of the rule: the cron and the decision both call
  -- ops_brand_decided; no backfill function restates it.
  perform pg_temp.w4r_check('W4R-DECIDED', 'ops_brand_autolink and ops_brand_match call ops_brand_decided',
    (select string_agg(p.proname, ',' order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosrc ~ 'ops_brand_decided\(' and p.proname in ('ops_brand_autolink', 'ops_brand_match')),
    'ops_brand_autolink,ops_brand_match');
  perform pg_temp.w4r_check('W4R-DECIDED', 'no other function restates who decided (closed_via IS NULL on a brand card)',
    (select coalesce(string_agg(p.proname, ',' order by p.proname), 'none') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosrc ~* 'brand_pick:' and p.prosrc ~* 'closed_via\s+IS\s+NULL' and p.proname <> 'ops_brand_decided'),
    'none');
end;
$decided$;

-- ---------------------------------------------------------------------------
-- W4R-BLOCK: one brand at a time
-- ---------------------------------------------------------------------------
set local session_replication_role = replica;
insert into public.brands (id, account_id, name, slug, contact_email) values
  ('39850000-0000-4000-b400-000000000001', gen_random_uuid(), 'W4R Lock Brand', 'w4r-lock-brand', 'lock@w4r3980.test'),
  ('39850000-0000-4000-b400-000000000002', gen_random_uuid(), 'W4R Lock Other', 'w4r-lock-other', 'lockother@w4r3980.test');
set local session_replication_role = origin;

create function pg_temp.w4r_brand_lock_held(p_brand uuid) returns boolean
language sql as $fn$
  select exists (
    select 1 from pg_locks l
     where l.locktype = 'advisory' and l.pid = pg_backend_pid() and l.granted and l.mode = 'ExclusiveLock' and l.objsubid = 1
       and l.classid::text::bigint = ((hashtextextended('ops_brand_autolink:' || p_brand, 0) >> 32) & 4294967295)
       and l.objid::text::bigint = (hashtextextended('ops_brand_autolink:' || p_brand, 0) & 4294967295))
$fn$;

do $block$
declare p jsonb;
begin
  perform pg_temp.w4r_check('W4R-BLOCK', 'before: no lock on either brand',
    concat_ws('/', pg_temp.w4r_brand_lock_held('39850000-0000-4000-b400-000000000001')::text, pg_temp.w4r_brand_lock_held('39850000-0000-4000-b400-000000000002')::text),
    'false/false');
  p := pg_temp.w4r_j(pg_temp.w4r_person('owner', $q$select public.ops_brand_cards_confirm(array['39850000-0000-4000-b400-000000000001']::uuid[], 'w4r-block-1')::text$q$));
  perform pg_temp.w4r_check('W4R-BLOCK', 'the confirm added the card and holds that brand''s lock to the end of the transaction, not the other''s',
    concat_ws('/', p->'results'->0->>'status', pg_temp.w4r_brand_lock_held('39850000-0000-4000-b400-000000000001')::text,
              pg_temp.w4r_brand_lock_held('39850000-0000-4000-b400-000000000002')::text),
    'created/true/false');
  -- The second caller then reads the brand again: it has its card.
  perform pg_temp.w4r_check('W4R-BLOCK', 'a second auto-link of the same brand sees the card and makes no pick card',
    concat_ws('/', public.ops_brand_autolink_one('39850000-0000-4000-b400-000000000001')->>'status',
              (select count(*) from public.ops_work_cards where auto_key like 'brand_%:39850000-0000-4000-b400-000000000001')),
    'has_card/0');
end;
$block$;

-- ---------------------------------------------------------------------------
-- W4R-LONG: a brand name over 160 characters
-- ---------------------------------------------------------------------------
set local session_replication_role = replica;
insert into public.brands (id, account_id, name, slug, contact_email) values
  ('39850000-0000-4000-b500-000000000001', gen_random_uuid(), 'W4R Long ' || repeat('Rooftop Garden ', 12) || 'Bar', 'w4r-long-1', 'long1@w4r3980.test'),
  ('39850000-0000-4000-b500-000000000002', gen_random_uuid(), 'W4R Taken ' || repeat('Rooftop Garden ', 12), 'w4r-long-2', 'long2@w4r3980.test');
set local session_replication_role = origin;
insert into public.crm_records (id, pipeline, name, stage, created_by, updated_by) values
  ('39850000-0000-4000-c500-000000000002', 'hosts', btrim(left(btrim('W4R Taken ' || repeat('Rooftop Garden ', 12)), 160)), 'prospect', 'w4r', 'w4r');

do $long$
declare p jsonb;
begin
  perform pg_temp.w4r_check('W4R-LONG', 'the fixture names are over 160 characters',
    (select string_agg((char_length(name) > 160)::text, ',' order by id) from public.brands where id::text like '39850000-0000-4000-b500-%'), 'true,true');
  perform pg_temp.w4r_check('W4R-LONG', 'the long name previews Add card with the name a card would get (160 characters)',
    concat_ws('|', public.ops_brand_match('39850000-0000-4000-b500-000000000001')->>'status',
              char_length(public.ops_brand_match('39850000-0000-4000-b500-000000000001')->>'card_name')), 'create|160');
  perform pg_temp.w4r_check('W4R-LONG', 'a card already holds the first 160 characters: a person picks',
    concat_ws('|', public.ops_brand_match('39850000-0000-4000-b500-000000000002')->>'status',
              public.ops_brand_match('39850000-0000-4000-b500-000000000002')->>'how'), 'pick|name');
  p := pg_temp.w4r_j(pg_temp.w4r_person('owner', $q$select public.ops_brand_cards_confirm(array['39850000-0000-4000-b500-000000000001','39850000-0000-4000-b500-000000000002']::uuid[], 'w4r-long-1')::text$q$));
  perform pg_temp.w4r_check('W4R-LONG', 'the confirm does what the preview said: the card is added with 160 characters, the taken name goes to a person',
    (select string_agg(r->>'status', ',' order by r->>'brand_id') from jsonb_array_elements(p->'results') r) || '|' ||
    (select char_length(name)::text from public.crm_records where brand_id = '39850000-0000-4000-b500-000000000001'),
    'created,pick|160');
end;
$long$;

select count(*) as w4r_total, count(*) filter (where not ok) as w4r_failed,
       coalesce(string_agg(test || ' ' || label || ' [' || detail || ']', E'\n' order by seq) filter (where not ok), 'none') as w4r_failures
  from t3980w4r_results \gset
rollback;

select (:w4r_total < 35 or :w4r_failed > 0) as w4r_bad \gset
\if :w4r_bad
  \echo 'ISSUE-3980 SYNCED WAVE 4 REWORK FAILED:' :w4r_failed 'of' :w4r_total
  \echo :w4r_failures
  do $$ begin raise exception 'ISSUE-3980 SYNCED WAVE 4 REWORK FAIL'; end $$;
\endif
\echo 'ISSUE-3980 SYNCED WAVE 4 REWORK PASS:' :w4r_total 'checks, 0 failed'
