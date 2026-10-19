-- Issue #3980 rework 2 -- implementor happy path, on the fully replayed PG17
-- schema:
--   R2-REVIEW  To review counts exactly what its tabs list. Spend or publish
--              lists cards waiting for a person to spend, publish or other;
--              a card waiting to send a message is listed on Messages as
--              "Draft needed" until a waiting draft exists for it (for a host
--              or creator linked to the card, or named in its proof), and is
--              then not counted a second time. ops_my_counts reads the same
--              list, for owners, watchers and admins alike.
--   R2-NAMES   an agent naming an owner who is not on the team is told each
--              teammate as "Name <email>", so two people with one name differ
--   R2-LOG     an agent taking someone off a card is logged as
--              "Took <name> off Card N", not "Updated Card N"
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

create temp table tw_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into tw_people (who, id, email) values
  ('owner',   '39800000-0000-4000-a0ee-000000000001', 'oona.v3980@test.local'),
  ('admin',   '39800000-0000-4000-a0ee-000000000002', 'abe.v3980@test.local'),
  ('growth',  '39800000-0000-4000-a0ee-000000000003', 'gia.v3980@test.local'),
  ('growth2', '39800000-0000-4000-a0ee-000000000004', 'hal.v3980@test.local'),
  ('partner', '39800000-0000-4000-a0ee-000000000005', 'pia.v3980@test.local'),
  ('leaver',  '39800000-0000-4000-a0ee-000000000006', 'lou.v3980@test.local'),
  ('nobody',  '39800000-0000-4000-a0ee-000000000007', 'ned.v3980@test.local');
insert into auth.users (id, email, email_confirmed_at) select id, email, now() from tw_people;
insert into public.admin_users (email, role, status, accepted_at) values
  ('oona.v3980@test.local', 'owner', 'active', now()),
  ('abe.v3980@test.local', 'admin', 'active', now());
insert into public.admin_team_members (email, role, status, accepted_at) values
  ('gia.v3980@test.local', 'growth', 'active', now()),
  ('hal.v3980@test.local', 'growth', 'active', now()),
  ('pia.v3980@test.local', 'partner', 'active', now()),
  ('lou.v3980@test.local', 'growth', 'revoked', now());

-- One event 40 days out, public, for anchored cards.
set local session_replication_role = replica;
insert into public.brands (id, account_id, name, slug, city) values
  ('39800000-0000-4000-b1ee-000000000001', '39800000-0000-4000-b3ee-000000000001', 'V3980 Guard Brand', 'v3980-guard-brand', 'Lagos');
insert into public.events (id, brand_id, title, slug, visibility, status, timezone, published_at, event_type) values
  ('39800000-0000-4000-b4ee-000000000001', '39800000-0000-4000-b1ee-000000000001', 'V3980 Guard Night', 'v3980-guard-night', 'discover', 'scheduled', 'UTC', now() - interval '1 day', 'event');
insert into public.event_dates (event_id, start_at, end_at, is_master) values
  ('39800000-0000-4000-b4ee-000000000001', date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' + interval '40 days 20 hours',
   date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' + interval '40 days 23 hours', true);
set local session_replication_role = origin;

create temp table tw_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;
create temp table tw_ids (k text primary key, v text) on commit drop;

create function pg_temp.tw_as(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text; v_out text;
begin
  if p_who <> 'service' then
    select id, email into strict v_id, v_email from tw_people where who = p_who;
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

create function pg_temp.tw_check(p_test text, p_label text, p_got text, p_want text) returns void
language plpgsql as $fn$
begin
  insert into tw_results (test, label, ok, detail)
  values (p_test, p_label, p_got is not distinct from p_want,
          format('got %s, want %s', coalesce(left(p_got, 600), '<null>'), coalesce(p_want, '<null>')));
end;
$fn$;

create function pg_temp.tw_like(p_test text, p_label text, p_got text, p_pattern text) returns void
language plpgsql as $fn$
begin
  insert into tw_results (test, label, ok, detail)
  values (p_test, p_label, coalesce(p_got like p_pattern, false),
          format('got %s, want like %s', coalesce(left(p_got, 600), '<null>'), p_pattern));
end;
$fn$;

create function pg_temp.tw_get(p text, variadic p_path text[]) returns text
language plpgsql as $fn$
begin
  return p::jsonb #>> p_path;
exception when others then
  return p;
end;
$fn$;

create function pg_temp.tw_j(p text) returns jsonb
language plpgsql as $fn$
begin
  return p::jsonb;
exception when others then
  return jsonb_build_object('unreadable', left(p, 300));
end;
$fn$;

create function pg_temp.tw_id(p_k text) returns text
language sql as $fn$ select v from tw_ids where k = p_k $fn$;

create function pg_temp.tw_keep(p_k text, p_v text) returns void
language sql as $fn$ insert into tw_ids (k, v) values (p_k, p_v) on conflict (k) do update set v = excluded.v $fn$;

-- Request rows written so far belong to an earlier, finished request.
create function pg_temp.tw_next_request() returns void
language sql as $fn$
  update public.team_agent_calls set xact_id = '3'::xid8, started_at = started_at - interval '5 minutes' where xact_id <> '3'::xid8
$fn$;

create function pg_temp.tw_person(p_who text, p_sql text) returns text
language plpgsql as $fn$
begin
  perform pg_temp.tw_next_request();
  return pg_temp.tw_as(p_who, p_sql);
end;
$fn$;

-- A connected agent calling a function directly, as the gateway does: the
-- request row first, in this transaction, then the call.
create function pg_temp.tw_agent_sql(p_who text, p_agent text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text;
begin
  perform pg_temp.tw_next_request();
  select id, email into strict v_id, v_email from tw_people where who = p_who;
  insert into public.team_agent_calls (key_id, owner_email, actor_uid, agent, tool, xact_id, started_at)
  values (gen_random_uuid(), v_email, v_id, p_agent, 'save_drafts', pg_current_xact_id(), clock_timestamp());
  return pg_temp.tw_as(p_who, p_sql);
end;
$fn$;

create function pg_temp.tw_digest(p text) returns text
language sql as $fn$ select encode(sha256(convert_to(p, 'UTF8')), 'hex') $fn$;

create function pg_temp.tw_newkey(p_who text, p_agent text, p_label text) returns text
language plpgsql as $fn$
declare v text;
begin
  v := pg_temp.tw_person(p_who, format('select public.team_agent_key_create(%L)::text', p_agent));
  if v like 'ERR:%' then return v; end if;
  perform pg_temp.tw_keep(p_label, pg_temp.tw_j(v) ->> 'key');
  return v;
end;
$fn$;

create function pg_temp.tw_gw(p_label text, p_tool text, p_args text default '{}', p_gateway text default 'team_agent_call') returns text
language plpgsql as $fn$
begin
  perform pg_temp.tw_next_request();
  return pg_temp.tw_as('service', format('select public.%s(%L, %L, %L::jsonb, %L)::text', p_gateway,
    pg_temp.tw_digest(pg_temp.tw_id(p_label)), p_tool, p_args, 'issue3980-implementor/1.0'));
end;
$fn$;

create function pg_temp.tw_work(p_label text, p_tool text, p_args text default '{}') returns text
language sql as $fn$ select pg_temp.tw_gw(p_label, p_tool, p_args, 'ops_agent_call') $fn$;

create function pg_temp.tw_rec(p_name text) returns uuid
language plpgsql as $fn$
declare v_id uuid;
begin
  insert into public.crm_records (pipeline, name, stage, created_by, updated_by)
  values ('hosts', p_name, 'contacted', 'v3980-fixture', 'v3980-fixture') returning id into v_id;
  return v_id;
end;
$fn$;

create function pg_temp.tw_touch(p_record uuid, p_ago interval, p_direction text default 'outbound') returns void
language sql as $fn$
  insert into public.crm_activity (record_id, kind, actor_email, channel, direction, body, occurred_at)
  values (p_record, 'touch', 'gia.v3980@test.local', 'email', p_direction, 'Fixture message', now() - p_ago)
$fn$;

-- The draft result of one save_drafts call: "saved" or the refusal token.
create function pg_temp.tw_draft(p_label text, p_record text, p_key text) returns text
language plpgsql as $fn$
declare v text;
begin
  v := pg_temp.tw_gw(p_label, 'save_drafts', format('{"drafts":[{"record_id":"%s","channel":"email","body":"Hello again about the night"}],"request_key":"%s"}', p_record, p_key));
  return coalesce(pg_temp.tw_get(v, 'result', 'results', '0', 'error', 'token'), pg_temp.tw_get(v, 'result', 'results', '0', 'status'), v);
end;
$fn$;

-- A card the given person owns, added by that person, returning its id.
create function pg_temp.tw_card(p_who text, p_title text, p_owners text, p_watchers text default '[]', p_extra text default '') returns text
language plpgsql as $fn$
declare v text;
begin
  v := pg_temp.tw_person(p_who, format('select public.ops_work_add(%L::jsonb, %L)::text',
    format('[{"title":"%s","instructions":"Do this adversarial tester task carefully.","done_means":"It is done and checked.","owners":%s,"watchers":%s,"due_on":"%s"%s}]',
      p_title, p_owners, p_watchers, (now() AT TIME ZONE 'UTC')::date + 7, p_extra),
    'v3980-' || substr(md5(p_title), 1, 16)));
  return coalesce(pg_temp.tw_get(v, 'results', '0', 'card', 'id'), v);
end;
$fn$;

create function pg_temp.tw_rev(p_card text) returns bigint
language sql as $fn$ select revision from public.ops_work_cards where id = p_card::uuid $fn$;

-- A giveaway and ads card held for go-live, owned by one person. Written
-- directly: the launch kit makes these, one per event, and this suite needs
-- several on the same event.
create function pg_temp.tw_promo(p_owner text, p_title text) returns text
language plpgsql as $fn$
declare v_id uuid;
begin
  insert into public.ops_work_cards (title, instructions, done_means, status, blocked, blocked_kind, blocked_reason, kind,
    anchor_kind, anchor_id, due_on, due_source, sprint_id, created_by, updated_by)
  values (p_title, 'Open the giveaway and get the ads plan approved.', 'The giveaway is open.', 'todo', true, 'organic_only',
    'Organic only: tester fixture.', 'promo', 'event', '39800000-0000-4000-b4ee-000000000001', (now() AT TIME ZONE 'UTC')::date + 19, 'explicit',
    public.ops_sprint_ensure((now() AT TIME ZONE 'UTC')::date + 19), p_owner, p_owner)
  returning id into v_id;
  insert into public.ops_work_people (card_id, email, role, added_by) values (v_id, p_owner, 'owner', p_owner);
  return v_id::text;
end;
$fn$;


-- Two teammates whose addresses give the same first name.
insert into tw_people (who, id, email) values ('gia2', '39800000-0000-4000-a0ee-000000000008', 'gia.other.v3980@test.local');
insert into auth.users (id, email, email_confirmed_at) values ('39800000-0000-4000-a0ee-000000000008', 'gia.other.v3980@test.local', now());
insert into public.admin_team_members (email, role, status, accepted_at) values ('gia.other.v3980@test.local', 'growth', 'active', now());

create function pg_temp.tw_waiting_draft(p_owner text, p_record uuid, p_key text) returns uuid
language sql as $fn$
  insert into public.team_drafts (owner_email, record_id, channel, body, original_body, created_via, request_key)
  values (p_owner, p_record, 'email', 'Hello about the night', 'Hello about the night', 'claude', p_key)
  returning id
$fn$;

create function pg_temp.tw_counts(p_who text) returns jsonb
language sql as $fn$ select pg_temp.tw_j(pg_temp.tw_person(p_who, 'select public.ops_my_counts()::text')) $fn$;

create function pg_temp.tw_review(p_who text) returns jsonb
language sql as $fn$ select pg_temp.tw_j(pg_temp.tw_person(p_who, 'select public.ops_review_list()::text')) $fn$;

create function pg_temp.tw_titles(p jsonb, p_key text) returns text
language sql as $fn$
  select coalesce(string_agg(c->>'title', ',' order by c->>'title'), '') from jsonb_array_elements(coalesce(p->p_key, '[]'::jsonb)) c
   where c->>'title' like 'V3980%'
$fn$;

select pg_temp.tw_newkey('growth', 'claude', 'GC') is not null as k1;

do $review$
declare v text; v_host uuid := pg_temp.tw_rec('V3980 Jazz Lounge'); v_host2 uuid := pg_temp.tw_rec('V3980 Book Cafe');
        v_a text; v_b text; v_c text; v_d text; v_e text; v_draft uuid; r jsonb; m jsonb; w text;
begin
  -- A: send, linked to a host. B: spend. C: send, no link. D: publish, Gia
  -- only watches. E: send, Gia is not on it at all.
  v_a := pg_temp.tw_card('growth', 'V3980 A send to the lounge', '["gia.v3980@test.local"]', '[]', format(',"links":[{"kind":"host","id":"%s"}]', v_host));
  v_b := pg_temp.tw_card('growth', 'V3980 B spend on ads', '["gia.v3980@test.local"]');
  v_c := pg_temp.tw_card('growth', 'V3980 C send a reminder', '["gia.v3980@test.local"]');
  v_d := pg_temp.tw_card('growth2', 'V3980 D publish the night', '["hal.v3980@test.local"]', '["gia.v3980@test.local"]');
  v_e := pg_temp.tw_card('growth2', 'V3980 E send for Hal', '["hal.v3980@test.local"]');
  perform pg_temp.tw_person('growth', format($q$select public.ops_work_update(%L, '{"status":"person","person_reason":"send"}'::jsonb, %s)::text$q$, v_a, pg_temp.tw_rev(v_a)));
  perform pg_temp.tw_person('growth', format($q$select public.ops_work_update(%L, '{"status":"person","person_reason":"spend"}'::jsonb, %s)::text$q$, v_b, pg_temp.tw_rev(v_b)));
  perform pg_temp.tw_person('growth', format($q$select public.ops_work_update(%L, '{"status":"person","person_reason":"send"}'::jsonb, %s)::text$q$, v_c, pg_temp.tw_rev(v_c)));
  perform pg_temp.tw_person('growth2', format($q$select public.ops_work_update(%L, '{"status":"person","person_reason":"publish"}'::jsonb, %s)::text$q$, v_d, pg_temp.tw_rev(v_d)));
  perform pg_temp.tw_person('growth2', format($q$select public.ops_work_update(%L, '{"status":"person","person_reason":"send"}'::jsonb, %s)::text$q$, v_e, pg_temp.tw_rev(v_e)));
  perform pg_temp.tw_check('R2-REVIEW', 'every card waits for a person',
    (select string_agg(person_reason, ',' order by title) from public.ops_work_cards where title like 'V3980 %' and status = 'person'), 'send,spend,send,publish,send');

  r := pg_temp.tw_review('growth');
  perform pg_temp.tw_check('R2-REVIEW', 'Spend or publish lists the spend card and the publish card Gia watches',
    pg_temp.tw_titles(r, 'cards'), 'V3980 B spend on ads,V3980 D publish the night');
  perform pg_temp.tw_check('R2-REVIEW', 'Messages lists both send cards as Draft needed, not Hal''s',
    pg_temp.tw_titles(r, 'draft_needed'), 'V3980 A send to the lounge,V3980 C send a reminder');
  perform pg_temp.tw_check('R2-REVIEW', 'the list says how many need a draft', r->'counts'->>'draft_needed', '2');
  m := pg_temp.tw_counts('growth');
  perform pg_temp.tw_check('R2-REVIEW', 'Spend or publish counts only spend, publish and other, watched cards included',
    m->>'needs_person_mine', '2');
  perform pg_temp.tw_check('R2-REVIEW', 'the badge counts what each tab lists',
    (m->>'needs_person_mine') || '/' || (m->>'draft_needed_mine'), '2/2');

  -- The agent writes the message for A: the draft now waits, A is not counted again.
  v_draft := pg_temp.tw_waiting_draft('gia.v3980@test.local', v_host, 'v3980-draft-a1');
  r := pg_temp.tw_review('growth');
  perform pg_temp.tw_check('R2-REVIEW', 'once its draft waits, A leaves Draft needed',
    pg_temp.tw_titles(r, 'draft_needed'), 'V3980 C send a reminder');
  m := pg_temp.tw_counts('growth');
  perform pg_temp.tw_check('R2-REVIEW', 'the draft and the remaining cards are each counted once',
    (pg_temp.tw_j(pg_temp.tw_person('growth', 'select public.team_draft_counts()::text'))->>'waiting') || '+' || (m->>'draft_needed_mine') || '+' || (m->>'needs_person_mine'), '1+1+2');

  -- A draft named in C's proof also counts as its draft.
  v_draft := pg_temp.tw_waiting_draft('hal.v3980@test.local', v_host2, 'v3980-draft-c1');
  update public.ops_work_cards set proof = jsonb_build_array(jsonb_build_object('kind', 'draft', 'id', v_draft, 'text', 'The reminder draft')) where id = v_c::uuid;
  perform pg_temp.tw_check('R2-REVIEW', 'a draft named in the proof clears Draft needed',
    pg_temp.tw_titles(pg_temp.tw_review('growth'), 'draft_needed'), '');
  -- A sent or discarded draft is not a waiting draft.
  update public.team_drafts set state = 'discarded', discarded_at = now(), discarded_by = 'hal.v3980@test.local' where id = v_draft;
  perform pg_temp.tw_check('R2-REVIEW', 'a discarded draft puts the card back under Draft needed',
    pg_temp.tw_titles(pg_temp.tw_review('growth'), 'draft_needed'), 'V3980 C send a reminder');

  -- Hal (owner of D and E) and the admin see their own lists; the count is
  -- always the list.
  perform pg_temp.tw_check('R2-REVIEW', 'Hal: D to publish, E needs a draft',
    pg_temp.tw_titles(pg_temp.tw_review('growth2'), 'cards') || '|' || pg_temp.tw_titles(pg_temp.tw_review('growth2'), 'draft_needed'),
    'V3980 D publish the night|V3980 E send for Hal');
  foreach w in array array['owner', 'admin', 'growth', 'growth2', 'partner'] loop
    r := pg_temp.tw_review(w); m := pg_temp.tw_counts(w);
    perform pg_temp.tw_check('R2-REVIEW', 'for ' || w || ' the counts equal the lists',
      (m->>'needs_person_mine') || '/' || (m->>'draft_needed_mine'),
      jsonb_array_length(r->'cards')::text || '/' || jsonb_array_length(r->'draft_needed')::text);
  end loop;
  perform pg_temp.tw_check('R2-REVIEW', 'the admin sees every waiting card in this suite',
    pg_temp.tw_titles(pg_temp.tw_review('admin'), 'cards') || '|' || pg_temp.tw_titles(pg_temp.tw_review('admin'), 'draft_needed'),
    'V3980 B spend on ads,V3980 D publish the night|V3980 C send a reminder,V3980 E send for Hal');
end;
$review$;

do $names$
declare v text;
begin
  v := pg_temp.tw_work('GC', 'add_work', '{"cards":[{"title":"V3980 Owner nobody knows","instructions":"Do the task for a stranger carefully.","done_means":"It is done and checked.","owners":["Stranger"],"due_on":"' || ((now() AT TIME ZONE 'UTC')::date + 5)::text || '"}],"request_key":"v3980-names-0001"}');
  perform pg_temp.tw_like('R2-NAMES', 'the refusal names each teammate with the address', v, '%Gia <gia.v3980@test.local>%');
  perform pg_temp.tw_like('R2-NAMES', 'the other Gia is told apart by the address', v, '%Gia <gia.other.v3980@test.local>%');
  perform pg_temp.tw_check('R2-NAMES', 'the shared helper lists Name <email>',
    (select public.ops_team_names() like '%Hal <hal.v3980@test.local>%')::text, 'true');
end;
$names$;

do $log$
declare v text; v_card text; v_number text; v_summary text;
begin
  v_card := pg_temp.tw_card('growth', 'V3980 Reviewer leaves', '["gia.v3980@test.local"]', '["abe.v3980@test.local"]');
  v_number := (select number::text from public.ops_work_cards where id = v_card::uuid);
  v := pg_temp.tw_work('GC', 'update_work', format('{"id":"%s","expected_revision":%s,"changes":{"watchers":[]}}', v_card, pg_temp.tw_rev(v_card)));
  select summary into v_summary from public.ops_agent_log where card_id = v_card::uuid order by at desc limit 1;
  perform pg_temp.tw_check('R2-LOG', 'the agent log says who was taken off which card',
    v_summary, format('Took Abe off Card %s: V3980 Reviewer leaves', v_number));
  perform pg_temp.tw_check('R2-LOG', 'it does not say Updated Card', (v_summary like 'Updated Card%')::text, 'false');
  -- Taken off together with another change: both are said.
  v := pg_temp.tw_work('GC', 'update_work', format('{"id":"%s","expected_revision":%s,"changes":{"title":"V3980 Reviewer leaves, renamed","owners":["gia.v3980@test.local","hal.v3980@test.local"]}}', v_card, pg_temp.tw_rev(v_card)));
  v := pg_temp.tw_work('GC', 'update_work', format('{"id":"%s","expected_revision":%s,"changes":{"title":"V3980 Reviewer leaves again","owners":["gia.v3980@test.local"]}}', v_card, pg_temp.tw_rev(v_card)));
  select summary into v_summary from public.ops_agent_log where card_id = v_card::uuid order by at desc limit 1;
  perform pg_temp.tw_check('R2-LOG', 'a removal with another change names the person too',
    v_summary, format('Updated Card %s: V3980 Reviewer leaves again. Took Hal off it.', v_number));
end;
$log$;

select count(*) as tw_total, count(*) filter (where not ok) as tw_failed,
       coalesce(string_agg(test || ' ' || label || ' [' || detail || ']', E'\n' order by seq) filter (where not ok), 'none') as tw_failures
  from tw_results \gset
rollback;

select (:tw_total < 23 or :tw_failed > 0) as tw_bad \gset
\if :tw_bad
  \echo 'ISSUE-3980 REWORK2 REVIEW/NAMES/LOG FAILED:' :tw_failed 'of' :tw_total
  \echo :tw_failures
  do $$ begin raise exception 'ISSUE-3980 REWORK2 REVIEW/NAMES/LOG FAIL'; end $$;
\endif
\echo 'ISSUE-3980 REWORK2 REVIEW/NAMES/LOG PASS:' :tw_total 'checks, 0 failed'
