-- Issue #3980 synced program, Wave 4 -- the opt-in backfills and the Feature
-- Guide text, on the fully replayed PG17 schema.
--
-- What it proves (each check is recorded and reported together):
--   W4-NONE     the migration ran no backfill: no confirmed backfill in the
--               agent log, and nothing in the schema runs a confirm by itself
--   W4-WHO      the four functions are the owner's, signed in as a person: an
--               admin, a growth teammate, the owner's own agent and a
--               signed-out caller are refused, and nothing is written
--   W4-RPREV    roadmap preview: ready rows (with the issue title GitHub gave),
--               already linked (this card, another card, a different issue),
--               invalid (another repository, a pull request, a missing card,
--               the same issue or card twice), more than 50 and an empty list
--               refused; the preview writes nothing
--   W4-RCONF    roadmap confirm: links exactly the ready rows, checks every
--               row again (one linked elsewhere since the preview is
--               skipped), logs once, makes no work card, needs a request key,
--               and the same key returns the first answer and links nothing
--               again (different details under that key are refused)
--   W4-BPREV    brand preview: link (exact email; a number without its
--               country code read in its country), create (Onboarded, or Live with a public
--               listing), pick (two exact matches; only a near match; a card
--               of that name), reopen (a Lost match); brands with a card are
--               left out; totals add up; the preview writes nothing
--   W4-BCONF    brand confirm: does for each chosen brand exactly what the
--               preview said (the same decision as brand auto-link), leaves
--               the others alone, never links a Lost card, needs a request
--               key and replays safely
--   W4-GUIDE    the Feature Guide text: new titles, one revision and one
--               audit row each from this change, statuses unchanged, no
--               evidence added, no old names or old state words, the new
--               planned entry Release records and the synced system
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

create temp table t3980w4_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into t3980w4_people (who, id, email) values
  ('owner',  '39840000-0000-4000-a000-000000000001', 'ed.w43980@test.local'),
  ('admin',  '39840000-0000-4000-a000-000000000002', 'di.w43980@test.local'),
  ('growth', '39840000-0000-4000-a000-000000000003', 'ada.w43980@test.local');
insert into auth.users (id, email, email_confirmed_at) select id, email, now() from t3980w4_people;
insert into public.admin_users (email, role, status, accepted_at) values
  ('ed.w43980@test.local', 'owner', 'active', now()),
  ('di.w43980@test.local', 'admin', 'active', now());
insert into public.admin_team_members (email, role, status, accepted_at) values
  ('ada.w43980@test.local', 'growth', 'active', now());

create temp table t3980w4_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;

create function pg_temp.w4_as(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text; v_out text;
begin
  if p_who <> 'anon' then
    select id, email into strict v_id, v_email from t3980w4_people where who = p_who;
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
create function pg_temp.w4_next_request() returns void
language sql as $fn$
  update public.team_agent_calls set xact_id = '3'::xid8, started_at = started_at - interval '5 minutes' where xact_id <> '3'::xid8
$fn$;

create function pg_temp.w4_person(p_who text, p_sql text) returns text
language plpgsql as $fn$
begin
  perform pg_temp.w4_next_request();
  return pg_temp.w4_as(p_who, p_sql);
end;
$fn$;

-- A person's connected agent calling a function directly: the request row
-- the connector writes first, in this transaction, then the call.
create function pg_temp.w4_agent(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text;
begin
  perform pg_temp.w4_next_request();
  select id, email into strict v_id, v_email from t3980w4_people where who = p_who;
  insert into public.team_agent_calls (key_id, owner_email, actor_uid, agent, tool, xact_id, started_at)
  values (gen_random_uuid(), v_email, v_id, 'claude', 'update_work', pg_current_xact_id(), clock_timestamp());
  return pg_temp.w4_as(p_who, p_sql);
end;
$fn$;

create function pg_temp.w4_check(p_test text, p_label text, p_got text, p_want text) returns void
language plpgsql as $fn$
begin
  insert into t3980w4_results (test, label, ok, detail)
  values (p_test, p_label, p_got is not distinct from p_want,
          format('got %s, want %s', coalesce(left(p_got, 700), '<null>'), coalesce(p_want, '<null>')));
end;
$fn$;

create function pg_temp.w4_like(p_test text, p_label text, p_got text, p_pattern text) returns void
language plpgsql as $fn$
begin
  insert into t3980w4_results (test, label, ok, detail)
  values (p_test, p_label, coalesce(p_got like p_pattern, false),
          format('got %s, want like %s', coalesce(left(p_got, 700), '<null>'), p_pattern));
end;
$fn$;

create function pg_temp.w4_j(p text) returns jsonb
language plpgsql as $fn$
begin
  return p::jsonb;
exception when others then
  return jsonb_build_object('unreadable', left(p, 400));
end;
$fn$;

-- One preview or confirm row as "status|words".
create function pg_temp.w4_row(p jsonb, p_i integer) returns text
language sql as $fn$ select (p->p_i->>'status') || '|' || (p->p_i->>'words') $fn$;

-- Everything a backfill could write, as one string.
create function pg_temp.w4_counts() returns text
language sql as $fn$
  select concat_ws('/', (select count(*) from public.ops_roadmap_links), (select count(*) from public.crm_records),
                   (select count(*) from public.crm_records where brand_id is not null), (select count(*) from public.ops_work_cards),
                   (select count(*) from public.ops_request_keys), (select count(*) from public.ops_agent_log where action = 'backfill_confirmed'),
                   (select count(*) from public.crm_activity))
$fn$;

-- ---------------------------------------------------------------------------
-- W4-NONE: the migration ran no backfill
-- ---------------------------------------------------------------------------
do $none$
begin
  perform pg_temp.w4_check('W4-NONE', 'no confirmed backfill is in the agent log after the migrations',
    (select count(*) from public.ops_agent_log where action = 'backfill_confirmed')::text, '0');
  perform pg_temp.w4_check('W4-NONE', 'no function other than the two confirms names a confirm or runs brand auto-link for a list',
    (select coalesce(string_agg(p.proname, ',' order by p.proname), 'none') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosrc ~ '(ops_roadmap_links_confirm|ops_brand_cards_confirm)\('), 'none');
  perform pg_temp.w4_check('W4-NONE', 'the previews only read (STABLE), the confirms write (VOLATILE)',
    (select string_agg(p.proname || ':' || p.provolatile::text, ',' order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('ops_roadmap_links_preview','ops_roadmap_links_confirm','ops_brand_cards_preview','ops_brand_cards_confirm')),
    'ops_brand_cards_confirm:v,ops_brand_cards_preview:s,ops_roadmap_links_confirm:v,ops_roadmap_links_preview:s');
end;
$none$;

-- Fixtures: roadmap cards and what GitHub said about a few numbers.
insert into public.community_roadmap_cards (id, public_title, public_body, lane, status, sort_order) values
  ('39840000-0000-4000-c100-000000000001', 'W4 Host payouts next day', 'Payouts land the next day.', 'now', 'published', 940),
  ('39840000-0000-4000-c100-000000000002', 'W4 Calendar for hosts', 'Every event in one place.', 'next', 'published', 941),
  ('39840000-0000-4000-c100-000000000003', 'W4 Ticket transfers', 'Send a ticket to a friend.', 'later', 'published', 942),
  ('39840000-0000-4000-c100-000000000004', 'W4 Group chats', 'Plan with friends.', 'later', 'published', 943),
  ('39840000-0000-4000-c100-000000000005', 'W4 Better search', 'Find it faster.', 'later', 'published', 944),
  ('39840000-0000-4000-c100-000000000006', 'W4 Dark mode', 'Easy on the eyes.', 'later', 'draft', 945),
  ('39840000-0000-4000-c100-000000000007', 'W4 Waitlists', 'Join the line.', 'later', 'published', 946);
insert into public.ops_github_items (number, kind, title, url, state, board_status, synced_at) values
  (984001, 'issue', 'Host payouts arrive the next day', 'https://github.com/Mingla-LLC/mingla-main/issues/984001', 'OPEN', 'In Progress', now()),
  (984009, 'pull', 'A pull request', 'https://github.com/Mingla-LLC/mingla-main/pull/984009', 'MERGED', null, now());
insert into public.ops_roadmap_links (card_id, issue_number, linked_by) values
  ('39840000-0000-4000-c100-000000000002', 984002, 'ed.w43980@test.local'),
  ('39840000-0000-4000-c100-000000000006', 984022, 'ed.w43980@test.local');

-- ---------------------------------------------------------------------------
-- W4-WHO: owner, signed in as a person, only
-- ---------------------------------------------------------------------------
do $who$
declare v text; v_before text := pg_temp.w4_counts();
  c_links constant text := '''[{"card_id":"39840000-0000-4000-c100-000000000001","issue":"#984001"}]''::jsonb';
  c_brands constant text := 'array[''39840000-0000-4000-b400-000000000001''::uuid]';
begin
  perform pg_temp.w4_like('W4-WHO', 'an admin cannot preview roadmap links',
    pg_temp.w4_person('admin', 'select public.ops_roadmap_links_preview(' || c_links || ')::text'), 'ERR:42501:forbidden: Only the owner%');
  perform pg_temp.w4_like('W4-WHO', 'a growth teammate cannot preview roadmap links',
    pg_temp.w4_person('growth', 'select public.ops_roadmap_links_preview(' || c_links || ')::text'), 'ERR:42501:forbidden:%');
  perform pg_temp.w4_like('W4-WHO', 'the owner''s own agent cannot preview roadmap links',
    pg_temp.w4_agent('owner', 'select public.ops_roadmap_links_preview(' || c_links || ')::text'), 'ERR:42501:forbidden:%');
  perform pg_temp.w4_like('W4-WHO', 'an admin cannot confirm roadmap links',
    pg_temp.w4_person('admin', 'select public.ops_roadmap_links_confirm(' || c_links || ', ''w4-admin-try-1'')::text'), 'ERR:42501:forbidden:%');
  perform pg_temp.w4_like('W4-WHO', 'the owner''s own agent cannot confirm roadmap links',
    pg_temp.w4_agent('owner', 'select public.ops_roadmap_links_confirm(' || c_links || ', ''w4-agent-try-1'')::text'), 'ERR:42501:forbidden:%');
  perform pg_temp.w4_like('W4-WHO', 'an admin cannot preview brands without a host card',
    pg_temp.w4_person('admin', 'select public.ops_brand_cards_preview()::text'), 'ERR:42501:forbidden: Only the owner adds host cards%');
  perform pg_temp.w4_like('W4-WHO', 'a growth teammate cannot confirm brands',
    pg_temp.w4_person('growth', 'select public.ops_brand_cards_confirm(' || c_brands || ', ''w4-growth-try-1'')::text'), 'ERR:42501:forbidden:%');
  perform pg_temp.w4_like('W4-WHO', 'the owner''s own agent cannot confirm brands',
    pg_temp.w4_agent('owner', 'select public.ops_brand_cards_confirm(' || c_brands || ', ''w4-agent-try-2'')::text'), 'ERR:42501:forbidden:%');
  perform pg_temp.w4_like('W4-WHO', 'a signed-out caller cannot run any of them',
    pg_temp.w4_as('anon', 'select public.ops_brand_cards_preview()::text'), 'ERR:42501:permission denied%');
  perform pg_temp.w4_like('W4-WHO', 'a signed-out caller cannot confirm',
    pg_temp.w4_as('anon', 'select public.ops_roadmap_links_confirm(' || c_links || ', ''w4-anon-try-1'')::text'), 'ERR:42501:permission denied%');
  perform pg_temp.w4_check('W4-WHO', 'nothing was written by any refused call', pg_temp.w4_counts(), v_before);
  perform pg_temp.w4_check('W4-WHO', 'the helpers are not open to signed-in people',
    (has_function_privilege('authenticated', 'public.ops_roadmap_links_check(jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.ops_brand_cards_rows()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.ops_brand_match(uuid)', 'EXECUTE'))::text, 'false');
end;
$who$;

-- ---------------------------------------------------------------------------
-- W4-RPREV: roadmap preview
-- ---------------------------------------------------------------------------
do $rprev$
declare v text; p jsonb; v_before text := pg_temp.w4_counts(); v_many text;
begin
  v := pg_temp.w4_person('owner', $q$select public.ops_roadmap_links_preview('[
      {"card_id":"39840000-0000-4000-c100-000000000001","issue":"#984001"},
      {"card_id":"39840000-0000-4000-c100-000000000002","issue":"984002"},
      {"card_id":"39840000-0000-4000-c100-000000000003","issue":"https://github.com/Mingla-LLC/mingla-main/issues/984022"},
      {"card_id":"39840000-0000-4000-c100-000000000004","issue":"https://github.com/someone/else/issues/12"},
      {"card_id":"39840000-0000-4000-c100-000000000005","issue":"https://github.com/Mingla-LLC/mingla-main/pull/984005"},
      {"card_id":"39840000-0000-4000-c100-000000000006","issue":"#984009"},
      {"card_id":"39840000-0000-4000-c100-000000000099","issue":"#984011"},
      {"card_id":"not-a-card","issue":"#984012"},
      {"card_id":"39840000-0000-4000-c100-000000000007","issue":"#984001"},
      {"card_id":"39840000-0000-4000-c100-000000000002","issue":"#984013"},
      {"card_id":"39840000-0000-4000-c100-000000000007","issue":"https://github.com/Mingla-LLC/mingla-main/issues/984014/"}
    ]'::jsonb)::text$q$);
  p := pg_temp.w4_j(v);
  perform pg_temp.w4_check('W4-RPREV', 'one row is ready', p->>'ready', '1');
  perform pg_temp.w4_check('W4-RPREV', 'a ready row carries the card, the number and the title GitHub gave',
    concat_ws('|', p->'rows'->0->>'title', p->'rows'->0->>'issue_number', p->'rows'->0->>'issue_title', pg_temp.w4_row(p->'rows', 0)),
    'W4 Host payouts next day|984001|Host payouts arrive the next day|ready|Ready to link.');
  perform pg_temp.w4_check('W4-RPREV', 'a card already linked to that issue', pg_temp.w4_row(p->'rows', 1), 'already_linked|Already linked to #984002.');
  perform pg_temp.w4_check('W4-RPREV', 'an issue already linked to another card', pg_temp.w4_row(p->'rows', 2),
    'already_linked|#984022 is already linked to "W4 Dark mode".');
  perform pg_temp.w4_check('W4-RPREV', 'another repository is invalid, with the words', pg_temp.w4_row(p->'rows', 3),
    'invalid|GitHub link must be an issue or pull request of Mingla-LLC/mingla-main, like #3980 or https://github.com/Mingla-LLC/mingla-main/pull/3991.');
  perform pg_temp.w4_check('W4-RPREV', 'a pull request link is invalid', pg_temp.w4_row(p->'rows', 4), 'invalid|Link the issue, not a pull request.');
  perform pg_temp.w4_check('W4-RPREV', 'a bare number GitHub knows as a pull request is invalid', pg_temp.w4_row(p->'rows', 5), 'invalid|Link the issue, not a pull request.');
  perform pg_temp.w4_check('W4-RPREV', 'a card that does not exist is invalid', pg_temp.w4_row(p->'rows', 6), 'invalid|That roadmap card does not exist.');
  perform pg_temp.w4_check('W4-RPREV', 'a card id that is not an id is invalid', pg_temp.w4_row(p->'rows', 7), 'invalid|That roadmap card does not exist.');
  perform pg_temp.w4_check('W4-RPREV', 'the same issue twice: the second is invalid', pg_temp.w4_row(p->'rows', 8), 'invalid|#984001 is in this list twice.');
  perform pg_temp.w4_check('W4-RPREV', 'the same card twice: the second is invalid', pg_temp.w4_row(p->'rows', 9),
    'invalid|This card is in this list twice.');
  perform pg_temp.w4_check('W4-RPREV', 'a card named a third time is invalid too', pg_temp.w4_row(p->'rows', 10),
    'invalid|This card is in this list twice.');
  -- The card that is linked to another issue, on its own.
  p := pg_temp.w4_j(pg_temp.w4_person('owner', $q$select public.ops_roadmap_links_preview('[{"card_id":"39840000-0000-4000-c100-000000000002","issue":"#984013"},
      {"card_id":"39840000-0000-4000-c100-000000000007","issue":"https://github.com/Mingla-LLC/mingla-main/issues/984014/"}]'::jsonb)::text$q$));
  perform pg_temp.w4_check('W4-RPREV', 'a card already linked to a different issue is already_linked, never relinked', pg_temp.w4_row(p->'rows', 0),
    'already_linked|This card is already linked to #984002. Change it on the card.');
  perform pg_temp.w4_check('W4-RPREV', 'an issue link with a trailing slash is ready, with no title until GitHub is read',
    pg_temp.w4_row(p->'rows', 1) || '|' || coalesce(p->'rows'->1->>'issue_title', 'null'), 'ready|Ready to link.|null');
  select '[' || string_agg(format('{"card_id":"39840000-0000-4000-c100-000000000001","issue":"#%s"}', 984100 + g), ',') || ']' into v_many
    from generate_series(1, 51) g;
  perform pg_temp.w4_like('W4-RPREV', 'more than 50 rows are refused',
    pg_temp.w4_person('owner', format('select public.ops_roadmap_links_preview(%L::jsonb)::text', v_many)), 'ERR:22023:invalid_links: Send at most 50 links at a time.');
  perform pg_temp.w4_like('W4-RPREV', 'an empty list is refused',
    pg_temp.w4_person('owner', 'select public.ops_roadmap_links_preview(''[]''::jsonb)::text'), 'ERR:22023:invalid_links:%');
  perform pg_temp.w4_like('W4-RPREV', 'something that is not a list is refused',
    pg_temp.w4_person('owner', 'select public.ops_roadmap_links_preview(''{"card_id":"x"}''::jsonb)::text'), 'ERR:22023:invalid_links:%');
  perform pg_temp.w4_check('W4-RPREV', 'the preview wrote nothing', pg_temp.w4_counts(), v_before);
end;
$rprev$;

-- ---------------------------------------------------------------------------
-- W4-RCONF: roadmap confirm
-- ---------------------------------------------------------------------------
do $rconf$
declare v text; p jsonb; v_cards bigint := (select count(*) from public.ops_work_cards); v_links text;
begin
  v_links := '[{"card_id":"39840000-0000-4000-c100-000000000001","issue":"#984001"},
               {"card_id":"39840000-0000-4000-c100-000000000003","issue":"#984003"},
               {"card_id":"39840000-0000-4000-c100-000000000004","issue":"#984004"},
               {"card_id":"39840000-0000-4000-c100-000000000005","issue":"#984002"}]';
  p := pg_temp.w4_j(pg_temp.w4_person('owner', format('select public.ops_roadmap_links_preview(%L::jsonb)::text', v_links)));
  perform pg_temp.w4_check('W4-RCONF', 'the preview says three are ready', p->>'ready', '3');
  -- Between the preview and the confirm, someone links #984004 to another card by hand.
  perform pg_temp.w4_person('admin', 'select public.ops_roadmap_link_set(''39840000-0000-4000-c100-000000000007'', ''#984004'')::text');
  perform pg_temp.w4_like('W4-RCONF', 'a confirm needs a request key',
    pg_temp.w4_person('owner', format('select public.ops_roadmap_links_confirm(%L::jsonb, null)::text', v_links)), 'ERR:22023:request_key_required:%');
  v := pg_temp.w4_person('owner', format('select public.ops_roadmap_links_confirm(%L::jsonb, %L)::text', v_links, 'w4-roadmap-confirm-1'));
  p := pg_temp.w4_j(v);
  perform pg_temp.w4_check('W4-RCONF', 'it links the two still ready, and skips the rest', concat_ws('/', p->>'linked', p->>'skipped', p->>'replayed'), '2/2/false');
  perform pg_temp.w4_check('W4-RCONF', 'every row is checked again: the one linked elsewhere since the preview is skipped with the words',
    pg_temp.w4_row(p->'results', 2), 'already_linked|#984004 is already linked to "W4 Waitlists".');
  perform pg_temp.w4_check('W4-RCONF', 'each linked row says so', pg_temp.w4_row(p->'results', 0) || ' / ' || pg_temp.w4_row(p->'results', 1),
    'linked|Linked to #984001. / linked|Linked to #984003.');
  perform pg_temp.w4_check('W4-RCONF', 'the links are on the cards',
    (select string_agg(right(card_id::text, 2) || '=' || issue_number, ',' order by card_id) from public.ops_roadmap_links
      where card_id::text like '39840000-0000-4000-c100-%'), '01=984001,02=984002,03=984003,06=984022,07=984004');
  perform pg_temp.w4_check('W4-RCONF', 'the linked card shows its status chip at once',
    (select l->'issue'->>'label' from jsonb_array_elements(public.ops_roadmap_links_list()->'cards') l
      where l->>'card_id' = '39840000-0000-4000-c100-000000000001'), 'In Progress');
  perform pg_temp.w4_check('W4-RCONF', 'one line in the agent log, under the owner''s name',
    (select count(*)::text || '|' || max(actor_email) || '|' || max(summary) from public.ops_agent_log where action = 'backfill_confirmed'),
    '1|ed.w43980@test.local|Ed linked 2 roadmap cards to GitHub; 2 skipped.');
  perform pg_temp.w4_check('W4-RCONF', 'linking old issues makes no work card (X3: they only show their status)',
    ((select count(*) from public.ops_work_cards) - v_cards)::text, '0');
  -- The same request again.
  p := pg_temp.w4_j(pg_temp.w4_person('owner', format('select public.ops_roadmap_links_confirm(%L::jsonb, %L)::text', v_links, 'w4-roadmap-confirm-1')));
  perform pg_temp.w4_check('W4-RCONF', 'the same request key returns the first answer, marked replayed', concat_ws('/', p->>'linked', p->>'skipped', p->>'replayed'), '2/2/true');
  perform pg_temp.w4_check('W4-RCONF', 'and links or logs nothing again',
    (select count(*) from public.ops_agent_log where action = 'backfill_confirmed')::text || '/' || (select count(*) from public.ops_roadmap_links where card_id::text like '39840000-0000-4000-c100-%'), '1/5');
  perform pg_temp.w4_like('W4-RCONF', 'the same key with different links is refused',
    pg_temp.w4_person('owner', format('select public.ops_roadmap_links_confirm(%L::jsonb, %L)::text',
      '[{"card_id":"39840000-0000-4000-c100-000000000006","issue":"#984006"}]', 'w4-roadmap-confirm-1')), 'ERR:22023:request_key_reused:%');
end;
$rconf$;

-- ---------------------------------------------------------------------------
-- Brand fixtures. Host cards hold the contact details; brands sign up with
-- them. Brand cards stay switched off: the backfill does not need the switch.
-- ---------------------------------------------------------------------------
insert into public.crm_records (id, pipeline, name, stage, created_by, updated_by) values
  ('39840000-0000-4000-c200-000000000001', 'hosts', 'W43980 Email Match Host', 'contacted', 'w4-fixture', 'w4-fixture'),
  ('39840000-0000-4000-c200-000000000002', 'hosts', 'W43980 Phone One', 'contacted', 'w4-fixture', 'w4-fixture'),
  ('39840000-0000-4000-c200-000000000003', 'hosts', 'W43980 Phone Two', 'contacted', 'w4-fixture', 'w4-fixture'),
  ('39840000-0000-4000-c200-000000000005', 'hosts', 'W43980 Near Number Bar', 'replied', 'w4-fixture', 'w4-fixture'),
  ('39840000-0000-4000-c200-000000000006', 'hosts', 'W43980 National Number Cafe', 'prospect', 'w4-fixture', 'w4-fixture'),
  ('39840000-0000-4000-c200-000000000007', 'hosts', 'W43980 Same Name Club', 'prospect', 'w4-fixture', 'w4-fixture'),
  ('39840000-0000-4000-c200-000000000008', 'hosts', 'W43980 Already Linked', 'onboarded', 'w4-fixture', 'w4-fixture');
insert into public.crm_records (id, pipeline, name, stage, stage_reason, created_by, updated_by) values
  ('39840000-0000-4000-c200-000000000004', 'hosts', 'W43980 Lost Lounge', 'lost', 'Closed for now.', 'w4-fixture', 'w4-fixture');
insert into public.crm_record_identifiers (record_id, kind, value, value_key, created_by) values
  ('39840000-0000-4000-c200-000000000001', 'email', 'hello@w43980match.test', public.crm_ident_key('email', 'hello@w43980match.test'), 'w4-fixture'),
  ('39840000-0000-4000-c200-000000000002', 'phone', '08012345678', public.crm_ident_key('phone', '08012345678'), 'w4-fixture'),
  ('39840000-0000-4000-c200-000000000003', 'phone', '+2348012345678', public.crm_ident_key('phone', '+2348012345678'), 'w4-fixture'),
  ('39840000-0000-4000-c200-000000000004', 'email', 'lost@w43980lounge.test', public.crm_ident_key('email', 'lost@w43980lounge.test'), 'w4-fixture'),
  ('39840000-0000-4000-c200-000000000005', 'phone', '055512345', public.crm_ident_key('phone', '055512345'), 'w4-fixture'),
  ('39840000-0000-4000-c200-000000000006', 'phone', '08031112222', public.crm_ident_key('phone', '08031112222'), 'w4-fixture');
set local session_replication_role = replica;
insert into public.brands (id, account_id, name, slug, city, contact_email, contact_phone) values
  ('39840000-0000-4000-b400-000000000001', '39840000-0000-4000-b300-000000000001', 'W43980 Email Brand', 'w43980-email-brand', 'Lagos', 'Hello@W43980Match.test', null),
  ('39840000-0000-4000-b400-000000000002', '39840000-0000-4000-b300-000000000002', 'W43980 New Rooftop', 'w43980-new-rooftop', 'Lagos', 'nobody@w43980fresh.test', null),
  ('39840000-0000-4000-b400-000000000003', '39840000-0000-4000-b300-000000000003', 'W43980 Phone Brand', 'w43980-phone-brand', 'Lagos', null, '+234 801 234 5678'),
  ('39840000-0000-4000-b400-000000000004', '39840000-0000-4000-b300-000000000004', 'W43980 Lounge Returns', 'w43980-lounge-returns', 'Lagos', 'lost@w43980lounge.test', null),
  ('39840000-0000-4000-b400-000000000005', '39840000-0000-4000-b300-000000000005', 'W43980 Near Brand', 'w43980-near-brand', 'London', null, '+44 770 555 12345'),
  ('39840000-0000-4000-b400-000000000006', '39840000-0000-4000-b300-000000000006', 'W43980 National Brand', 'w43980-national-brand', 'Lagos', null, '+234 803 111 2222'),
  ('39840000-0000-4000-b400-000000000007', '39840000-0000-4000-b300-000000000007', 'W43980 Same Name Club', 'w43980-same-name-club', 'Lagos', 'club@w43980same.test', null),
  ('39840000-0000-4000-b400-000000000008', '39840000-0000-4000-b300-000000000008', 'W43980 Already Linked', 'w43980-already-linked', 'Lagos', 'linked@w43980.test', null),
  ('39840000-0000-4000-b400-000000000009', '39840000-0000-4000-b300-000000000009', 'W43980 Live Venue', 'w43980-live-venue', 'Lagos', 'live@w43980venue.test', null);
update public.crm_records set brand_id = '39840000-0000-4000-b400-000000000008' where id = '39840000-0000-4000-c200-000000000008';
-- A public listing for the Live Venue brand.
insert into public.events (id, brand_id, title, slug, visibility, status, timezone, published_at, event_type, location_text)
values ('39840000-0000-4000-e000-000000000009', '39840000-0000-4000-b400-000000000009', 'W43980 Live Night', 'w43980-live-night',
        'discover', 'scheduled', 'UTC', now() - interval '3 days', 'event', 'W43980 Street 1');
insert into public.event_dates (event_id, start_at, end_at, is_master)
values ('39840000-0000-4000-e000-000000000009', now() + interval '40 days', now() + interval '40 days 3 hours', true);
set local session_replication_role = origin;

create temp table t3980w4_preview (brand_id uuid primary key, action text, words text) on commit drop;

-- ---------------------------------------------------------------------------
-- W4-BPREV: brands without a host card
-- ---------------------------------------------------------------------------
do $bprev$
declare v text; p jsonb; v_before text := pg_temp.w4_counts();
begin
  v := pg_temp.w4_person('owner', 'select public.ops_brand_cards_preview()::text');
  p := pg_temp.w4_j(v);
  insert into t3980w4_preview (brand_id, action, words)
  select (r->>'brand_id')::uuid, r->>'action', r->>'words' from jsonb_array_elements(p->'rows') r
   where r->>'brand_id' like '39840000-0000-4000-b400-%';
  perform pg_temp.w4_check('W4-BPREV', 'every fixture brand without a card is listed, the linked one is not',
    (select string_agg(right(brand_id::text, 1) || '=' || action, ',' order by brand_id) from t3980w4_preview),
    '1=link,2=create,3=pick,4=reopen,5=pick,6=link,7=pick,9=create');
  perform pg_temp.w4_check('W4-BPREV', 'an exact email links, naming the card and the match',
    (select words from t3980w4_preview where brand_id = '39840000-0000-4000-b400-000000000001'), 'Link to W43980 Email Match Host: same email.');
  perform pg_temp.w4_check('W4-BPREV', 'a number written without its country code links when it reads as the same full number in its country',
    (select words from t3980w4_preview where brand_id = '39840000-0000-4000-b400-000000000006'), 'Link to W43980 National Number Cafe: same phone.');
  perform pg_temp.w4_check('W4-BPREV', 'no match: a new card in Onboarded',
    (select words from t3980w4_preview where brand_id = '39840000-0000-4000-b400-000000000002'), 'Add a host card in Onboarded.');
  perform pg_temp.w4_check('W4-BPREV', 'no match with a public listing: a new card in Live',
    (select words from t3980w4_preview where brand_id = '39840000-0000-4000-b400-000000000009'), 'Add a host card in Live.');
  perform pg_temp.w4_check('W4-BPREV', 'two exact matches: a person picks, both named',
    (select words from t3980w4_preview where brand_id = '39840000-0000-4000-b400-000000000003'), 'Several host cards match (W43980 Phone One, W43980 Phone Two). A person picks.');
  perform pg_temp.w4_check('W4-BPREV', 'only a near match: a person picks',
    (select words from t3980w4_preview where brand_id = '39840000-0000-4000-b400-000000000005'), 'Only near matches (W43980 Near Number Bar). A person picks.');
  perform pg_temp.w4_check('W4-BPREV', 'a card of the same name: a person picks',
    (select words from t3980w4_preview where brand_id = '39840000-0000-4000-b400-000000000007'), 'A host card with this name already exists. A person picks.');
  perform pg_temp.w4_check('W4-BPREV', 'a Lost match asks to reopen, never links',
    (select words from t3980w4_preview where brand_id = '39840000-0000-4000-b400-000000000004'), 'W43980 Lost Lounge has the same email and is Lost. A person decides whether to reopen it.');
  perform pg_temp.w4_check('W4-BPREV', 'a link row carries the matched record',
    (select r->'record'->>'id' || '|' || (r->>'matched') from jsonb_array_elements(p->'rows') r where r->>'brand_id' = '39840000-0000-4000-b400-000000000001'),
    '39840000-0000-4000-c200-000000000001|email');
  perform pg_temp.w4_check('W4-BPREV', 'the totals add up to the rows',
    ((p->'totals'->>'link')::int + (p->'totals'->>'create')::int + (p->'totals'->>'pick')::int + (p->'totals'->>'reopen')::int)::text || '/' || (p->'totals'->>'shown')
      || '/' || jsonb_array_length(p->'rows'), jsonb_array_length(p->'rows')::text || '/' || jsonb_array_length(p->'rows') || '/' || jsonb_array_length(p->'rows'));
  perform pg_temp.w4_check('W4-BPREV', 'the preview wrote nothing', pg_temp.w4_counts(), v_before);
end;
$bprev$;

-- ---------------------------------------------------------------------------
-- W4-BCONF: brand confirm does what the preview said
-- ---------------------------------------------------------------------------
do $bconf$
declare v text; p jsonb; v_lost public.crm_records;
  c_ids constant text := 'array[''39840000-0000-4000-b400-000000000001'',''39840000-0000-4000-b400-000000000002'',''39840000-0000-4000-b400-000000000003'',''39840000-0000-4000-b400-000000000004'',''39840000-0000-4000-b400-000000000005'',''39840000-0000-4000-b400-000000000007'',''39840000-0000-4000-b400-000000000009'',''39840000-0000-4000-b400-000000000002'']::uuid[]';
begin
  perform pg_temp.w4_like('W4-BCONF', 'a confirm needs a request key',
    pg_temp.w4_person('owner', 'select public.ops_brand_cards_confirm(' || c_ids || ', null)::text'), 'ERR:22023:request_key_required:%');
  perform pg_temp.w4_like('W4-BCONF', 'a confirm needs at least one brand',
    pg_temp.w4_person('owner', 'select public.ops_brand_cards_confirm(array[]::uuid[], ''w4-brand-empty-1'')::text'), 'ERR:22023:invalid_brands:%');
  v := pg_temp.w4_person('owner', 'select public.ops_brand_cards_confirm(' || c_ids || ', ''w4-brand-confirm-1'')::text');
  p := pg_temp.w4_j(v);
  perform pg_temp.w4_check('W4-BCONF', 'seven brands (one named twice, done once): 1 linked, 2 added, 4 left for a person',
    concat_ws('/', p->>'linked', p->>'created', p->>'skipped', p->>'replayed', jsonb_array_length(p->'results')), '1/2/4/false/7');
  perform pg_temp.w4_check('W4-BCONF', 'each brand got exactly what the preview said (brand auto-link''s own decision)',
    (select string_agg(right(r->>'brand_id', 1) || '=' || (r->>'status') || ':' || pr.action, ',' order by r->>'brand_id')
       from jsonb_array_elements(p->'results') r join t3980w4_preview pr on pr.brand_id = (r->>'brand_id')::uuid),
    '1=linked:link,2=created:create,3=pick:pick,4=ask_reopen:reopen,5=pick:pick,7=pick:pick,9=created:create');
  perform pg_temp.w4_check('W4-BCONF', 'the matching card is linked and moves to Onboarded',
    (select brand_id::text || '/' || stage from public.crm_records where id = '39840000-0000-4000-c200-000000000001'),
    '39840000-0000-4000-b400-000000000001/onboarded');
  perform pg_temp.w4_check('W4-BCONF', 'the new cards start where the preview said',
    (select string_agg(name || '=' || stage, ',' order by name) from public.crm_records
      where brand_id in ('39840000-0000-4000-b400-000000000002', '39840000-0000-4000-b400-000000000009')),
    'W43980 Live Venue=live,W43980 New Rooftop=onboarded');
  select * into v_lost from public.crm_records where id = '39840000-0000-4000-c200-000000000004';
  perform pg_temp.w4_check('W4-BCONF', 'the Lost card is never linked or reopened by itself', coalesce(v_lost.brand_id::text, 'none') || '/' || v_lost.stage, 'none/lost');
  perform pg_temp.w4_check('W4-BCONF', 'a person is asked: one pick card for each ambiguous brand and one reopen card',
    (select string_agg(split_part(auto_key, ':', 1) || ':' || right(auto_key, 1), ',' order by auto_key) from public.ops_work_cards
      where auto_key like 'brand\_%:39840000-0000-4000-b400-%' and status <> 'done'),
    'brand_lost:4,brand_pick:3,brand_pick:5,brand_pick:7');
  perform pg_temp.w4_check('W4-BCONF', 'the brand not chosen is left alone',
    (select count(*) from public.crm_records where brand_id = '39840000-0000-4000-b400-000000000006')::text, '0');
  perform pg_temp.w4_check('W4-BCONF', 'one line in the agent log for the confirm',
    (select summary from public.ops_agent_log where action = 'backfill_confirmed' and detail->>'backfill' = 'brand_cards'),
    'Ed confirmed host cards for 7 brands: 1 linked, 2 added, 4 left for a person.');
  -- The same request again.
  p := pg_temp.w4_j(pg_temp.w4_person('owner', 'select public.ops_brand_cards_confirm(' || c_ids || ', ''w4-brand-confirm-1'')::text'));
  perform pg_temp.w4_check('W4-BCONF', 'the same request key returns the first answer, marked replayed',
    concat_ws('/', p->>'linked', p->>'created', p->>'skipped', p->>'replayed'), '1/2/4/true');
  perform pg_temp.w4_check('W4-BCONF', 'and makes no second card or log line',
    (select count(*) from public.crm_records where brand_id in ('39840000-0000-4000-b400-000000000002', '39840000-0000-4000-b400-000000000009'))::text
      || '/' || (select count(*) from public.ops_agent_log where action = 'backfill_confirmed' and detail->>'backfill' = 'brand_cards'), '2/1');
  -- A brand that now has a card is no longer listed; a new key for it changes nothing.
  p := pg_temp.w4_j(pg_temp.w4_person('owner', 'select public.ops_brand_cards_preview()::text'));
  perform pg_temp.w4_check('W4-BCONF', 'linked and added brands leave the preview; the ones waiting for a person stay',
    (select string_agg(right(r->>'brand_id', 1) || '=' || (r->>'action') || ':' || (coalesce(r->'open_card'->>'id', '') <> '')::text, ',' order by r->>'brand_id')
       from jsonb_array_elements(p->'rows') r where r->>'brand_id' like '39840000-0000-4000-b400-%'),
    '3=pick:true,4=reopen:true,5=pick:true,6=link:false,7=pick:true');
  p := pg_temp.w4_j(pg_temp.w4_person('owner', 'select public.ops_brand_cards_confirm(array[''39840000-0000-4000-b400-000000000001'']::uuid[], ''w4-brand-confirm-2'')::text'));
  perform pg_temp.w4_check('W4-BCONF', 'confirming a brand that already has its card changes nothing',
    (p->'results'->0->>'status') || '|' || (p->'results'->0->>'words'), 'has_card|It already has a host card.');
end;
$bconf$;

-- ---------------------------------------------------------------------------
-- W4-GUIDE: the Feature Guide text
-- ---------------------------------------------------------------------------
do $guide$
declare v_bad text;
begin
  perform pg_temp.w4_check('W4-GUIDE', 'the new titles',
    (select string_agg(capability_key || '=' || title, ' | ' order by capability_key) from public.product_capabilities
      where capability_key in ('staff-drafts', 'staff-work-board', 'staff-agent-log', 'staff-release-records')),
    'staff-agent-log=Agent activity: what every connected agent is doing | staff-drafts=Needs you: messages to send, spend and publish approvals | staff-release-records=Release records and the synced system | staff-work-board=Work: plan, assign and close team work with agents');
  perform pg_temp.w4_check('W4-GUIDE', 'one audit row from this change per entry, at the entry''s revision',
    (select count(*)::text from public.product_capabilities c
      where c.capability_key in ('staff-drafts','staff-work-board','staff-agent-log','staff-content-calendar','staff-crm','staff-team-roles','staff-my-agent','staff-release-records')
        and (select count(*) from public.product_truth_audit a where a.capability_id = c.id and a.metadata->>'source' = 'issue_3980_synced_guide'
               and (a.metadata->>'revision')::integer = c.revision and a.metadata->>'issue' = '3980' and a.action = 'capability_saved') = 1), '8');
  perform pg_temp.w4_check('W4-GUIDE', 'each existing entry went up exactly one revision from the previous saved one',
    (select count(*)::text from public.product_capabilities c
      where c.capability_key in ('staff-drafts','staff-work-board','staff-agent-log','staff-content-calendar','staff-crm','staff-team-roles','staff-my-agent')
        and c.revision = 1 + (select max((a.metadata->>'revision')::integer) from public.product_truth_audit a
                               where a.capability_id = c.id and coalesce(a.metadata->>'source', '') <> 'issue_3980_synced_guide' and a.metadata ? 'revision')), '7');
  perform pg_temp.w4_check('W4-GUIDE', 'statuses are unchanged: all seven Live, the new one planned at revision 1 with the evidence it will need',
    (select string_agg(capability_key || ':' || claimed_status, ',' order by capability_key) from public.product_capabilities
      where capability_key in ('staff-drafts','staff-work-board','staff-agent-log','staff-content-calendar','staff-crm','staff-team-roles','staff-my-agent','staff-release-records'))
    || '|' || (select revision || ':' || array_to_string(required_evidence_kinds, ',') || ':' || coalesce(verification_due_at::text, 'none')
                 from public.product_capabilities where capability_key = 'staff-release-records'),
    'staff-agent-log:live,staff-content-calendar:live,staff-crm:live,staff-drafts:live,staff-my-agent:live,staff-release-records:planned,staff-team-roles:live,staff-work-board:live|1:source,test,release_record,live_check:none');
  perform pg_temp.w4_check('W4-GUIDE', 'the new entry has no evidence yet',
    (select count(*)::text from public.product_capability_evidence e join public.product_capabilities c on c.id = e.capability_id
      where c.capability_key = 'staff-release-records'), '0');
  select string_agg(capability_key, ', ' order by capability_key) into v_bad from public.product_capabilities
   where capability_key in ('staff-drafts','staff-work-board','staff-agent-log','staff-content-calendar','staff-crm','staff-team-roles','staff-my-agent','staff-release-records')
     and (concat_ws(' ', title, outcome_summary, how_to, limitations, support_wording) ~ 'To review'
          or concat_ws(' ', title, outcome_summary, how_to, limitations, support_wording) ~* '(full launch|organic only|plan this launch|\mtight\M|\mmissed\M|follow the on-screen|complete this job through|verified test|brand groups)');
  perform pg_temp.w4_check('W4-GUIDE', 'no old names, old state words or template wording', coalesce(v_bad, 'none'), 'none');
  perform pg_temp.w4_like('W4-GUIDE', 'Needs you: step 1 and the owner''s tab',
    (select how_to from public.product_capabilities where capability_key = 'staff-drafts'), '1. In Mingla Admin, open Pipeline > Needs you.%What hosts are told (owner and admins)%');
  perform pg_temp.w4_like('W4-GUIDE', 'Work: auto cards may have no owner',
    (select limitations from public.product_capabilities where capability_key = 'staff-work-board'), '%Cards made by Mingla from events may have no owner until someone takes them.%');
  perform pg_temp.w4_like('W4-GUIDE', 'Work: Board, the drawer, Needs attention, Agent activity, GitHub and steps from events',
    (select how_to from public.product_capabilities where capability_key = 'staff-work-board'),
    '1. In Mingla Admin, open Pipeline > Work.%Needs you, To do, In progress and Done this week%panel on the right%Planned, In Progress, In Review, Shipped or Live%Needs attention%"from the timeline"%Agent activity%');
  perform pg_temp.w4_like('W4-GUIDE', 'Agent activity: where it lives, chat names and the 24-hour rule',
    (select how_to || ' || ' || limitations from public.product_capabilities where capability_key = 'staff-agent-log'),
    '1. In Mingla Admin, open Pipeline > Work > Agent activity.%chat''s name%last 24 hours%');
  perform pg_temp.w4_like('W4-GUIDE', 'Calendar: the four plain states, today, Events/Posts/Both and the list by state',
    (select outcome_summary || ' || ' || how_to from public.product_capabilities where capability_key = 'staff-content-calendar'),
    '%Ready to promote%Promote now%Too late for promo%Not live yet%today marked%Events, Posts or Both%List groups upcoming events by state%eight launch steps automatically%');
  perform pg_temp.w4_like('W4-GUIDE', 'Hosts: the next event, the two filters, brands linked and added, repeats and promo moments',
    (select outcome_summary || ' || ' || how_to from public.product_capabilities where capability_key = 'staff-crm'),
    '%next event%"No next event"%"Go live soon"%links the brand by itself%Promo moment%every week or every month%host card for every new brand%');
  perform pg_temp.w4_like('W4-GUIDE', 'Team and roles: names and GitHub usernames',
    (select how_to || ' || ' || limitations from public.product_capabilities where capability_key = 'staff-team-roles'),
    '%GitHub username%Every active teammate role can use Work, Needs you and Calendar.%');
  perform pg_temp.w4_like('W4-GUIDE', 'My agent: the chat name and the routine',
    (select how_to from public.product_capabilities where capability_key = 'staff-my-agent'), '%"Log this chat''s work"%chat "Hosts sweep"%');
  perform pg_temp.w4_check('W4-GUIDE', 'Release records: outcome and support wording as written',
    (select outcome_summary || ' || ' || support_wording from public.product_capabilities where capability_key = 'staff-release-records'),
    'When a pull request merges, a bot posts its release record on each linked issue: PR, merge commit, migrations added and applied, deploy, live check and the Feature Guide entries it ships. Admin follows every linked GitHub issue, so Work cards, tickets and roadmap cards show its status, and an entry turns Live by itself when its record is complete. Search words: release record, live, shipped, GitHub status, Feature Guide, merge bot. || Mingla''s team records every release and checks it in production before telling hosts it is live.');
end;
$guide$;

select count(*) as w4_total, count(*) filter (where not ok) as w4_failed,
       coalesce(string_agg(test || ' ' || label || ' [' || detail || ']', E'\n' order by seq) filter (where not ok), 'none') as w4_failures
  from t3980w4_results \gset
rollback;

select (:w4_total < 70 or :w4_failed > 0) as w4_bad \gset
\if :w4_bad
  \echo 'ISSUE-3980 SYNCED WAVE 4 FAILED:' :w4_failed 'of' :w4_total
  \echo :w4_failures
  do $$ begin raise exception 'ISSUE-3980 SYNCED WAVE 4 FAIL'; end $$;
\endif
\echo 'ISSUE-3980 SYNCED WAVE 4 PASS:' :w4_total 'checks, 0 failed'
