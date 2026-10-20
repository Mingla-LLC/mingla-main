-- Issue #3980 -- independent tester, adversarial: the agent guardrails on the
-- Work board attacked from angles the happy-path suites do not take, on the
-- fully replayed PG17 schema.
--
-- What it proves (each check is recorded and reported together):
--   X-CLAIM  the same person's OTHER agent is refused like a stranger's; the
--            claim boundary is exact (29:59 still held, 30:01 ended and
--            logged); a holder's update keeps an old claim alive; the table
--            itself refuses a second live holder; a content card claim
--            refuses another agent's update_content; a person is never
--            refused and is logged once per ten minutes, not per change;
--            only the owner or an admin can force a release, and an agent
--            cannot release someone else's claim
--   X-SEND   the three-day rule at its exact edge (71:59 refused, 72:01
--            allowed); an inbound message or a message to another record
--            does not count; an override that ran out or that names another
--            record does not lift it; an agent cannot grant itself one; the
--            direct draft path refuses like the connector path while a
--            person's own draft is never refused; a discarded teammate draft
--            does not block; a draft a person marked sent blocks the next
--            agent draft for that record
--   X-AGENT  with real key resolution through the work gateway: no tool that
--            sends, spends, publishes, overrides, removes, converts or
--            undoes exists; proof that points to someone else's draft, a
--            removed record or the card itself is refused; an agent cannot
--            set done through an update, lift a go-live block, name an owner
--            who is not or no longer on the team, start or close a card its
--            person does not own, or push back a card that needs a person;
--            leaving Needs a person needs a real reason, which is logged and
--            told to watchers; the browser cannot forge an agent request row
--   X-ROLES  owner, admin, Sales and marketing, Founding partner, a removed
--            teammate and someone off the team against every owner/admin
--            and owner-only work function
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

create temp table tx_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into tx_people (who, id, email) values
  ('owner',   '39800000-0000-4000-a0aa-000000000001', 'oona.x3980@test.local'),
  ('admin',   '39800000-0000-4000-a0aa-000000000002', 'abe.x3980@test.local'),
  ('growth',  '39800000-0000-4000-a0aa-000000000003', 'gia.x3980@test.local'),
  ('growth2', '39800000-0000-4000-a0aa-000000000004', 'hal.x3980@test.local'),
  ('partner', '39800000-0000-4000-a0aa-000000000005', 'pia.x3980@test.local'),
  ('leaver',  '39800000-0000-4000-a0aa-000000000006', 'lou.x3980@test.local'),
  ('nobody',  '39800000-0000-4000-a0aa-000000000007', 'ned.x3980@test.local');
insert into auth.users (id, email, email_confirmed_at) select id, email, now() from tx_people;
insert into public.admin_users (email, role, status, accepted_at) values
  ('oona.x3980@test.local', 'owner', 'active', now()),
  ('abe.x3980@test.local', 'admin', 'active', now());
insert into public.admin_team_members (email, role, status, accepted_at) values
  ('gia.x3980@test.local', 'growth', 'active', now()),
  ('hal.x3980@test.local', 'growth', 'active', now()),
  ('pia.x3980@test.local', 'partner', 'active', now()),
  ('lou.x3980@test.local', 'growth', 'revoked', now());

-- One event 40 days out, public, for anchored cards.
set local session_replication_role = replica;
insert into public.brands (id, account_id, name, slug, city) values
  ('39800000-0000-4000-b1aa-000000000001', '39800000-0000-4000-b3aa-000000000001', 'X3980 Guard Brand', 'x3980-guard-brand', 'Lagos');
insert into public.events (id, brand_id, title, slug, visibility, status, timezone, published_at, event_type) values
  ('39800000-0000-4000-b4aa-000000000001', '39800000-0000-4000-b1aa-000000000001', 'X3980 Guard Night', 'x3980-guard-night', 'discover', 'scheduled', 'UTC', now() - interval '1 day', 'event');
insert into public.event_dates (event_id, start_at, end_at, is_master) values
  ('39800000-0000-4000-b4aa-000000000001', date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' + interval '40 days 20 hours',
   date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' + interval '40 days 23 hours', true);
set local session_replication_role = origin;

create temp table tx_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;
create temp table tx_ids (k text primary key, v text) on commit drop;

create function pg_temp.tx_as(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text; v_out text;
begin
  if p_who <> 'service' then
    select id, email into strict v_id, v_email from tx_people where who = p_who;
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

create function pg_temp.tx_check(p_test text, p_label text, p_got text, p_want text) returns void
language plpgsql as $fn$
begin
  insert into tx_results (test, label, ok, detail)
  values (p_test, p_label, p_got is not distinct from p_want,
          format('got %s, want %s', coalesce(left(p_got, 600), '<null>'), coalesce(p_want, '<null>')));
end;
$fn$;

create function pg_temp.tx_like(p_test text, p_label text, p_got text, p_pattern text) returns void
language plpgsql as $fn$
begin
  insert into tx_results (test, label, ok, detail)
  values (p_test, p_label, coalesce(p_got like p_pattern, false),
          format('got %s, want like %s', coalesce(left(p_got, 600), '<null>'), p_pattern));
end;
$fn$;

create function pg_temp.tx_get(p text, variadic p_path text[]) returns text
language plpgsql as $fn$
begin
  return p::jsonb #>> p_path;
exception when others then
  return p;
end;
$fn$;

create function pg_temp.tx_j(p text) returns jsonb
language plpgsql as $fn$
begin
  return p::jsonb;
exception when others then
  return jsonb_build_object('unreadable', left(p, 300));
end;
$fn$;

create function pg_temp.tx_id(p_k text) returns text
language sql as $fn$ select v from tx_ids where k = p_k $fn$;

create function pg_temp.tx_keep(p_k text, p_v text) returns void
language sql as $fn$ insert into tx_ids (k, v) values (p_k, p_v) on conflict (k) do update set v = excluded.v $fn$;

-- Request rows written so far belong to an earlier, finished request.
create function pg_temp.tx_next_request() returns void
language sql as $fn$
  update public.team_agent_calls set xact_id = '3'::xid8, started_at = started_at - interval '5 minutes' where xact_id <> '3'::xid8
$fn$;

create function pg_temp.tx_person(p_who text, p_sql text) returns text
language plpgsql as $fn$
begin
  perform pg_temp.tx_next_request();
  return pg_temp.tx_as(p_who, p_sql);
end;
$fn$;

-- A connected agent calling a function directly, as the gateway does: the
-- request row first, in this transaction, then the call.
create function pg_temp.tx_agent_sql(p_who text, p_agent text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text;
begin
  perform pg_temp.tx_next_request();
  select id, email into strict v_id, v_email from tx_people where who = p_who;
  insert into public.team_agent_calls (key_id, owner_email, actor_uid, agent, tool, xact_id, started_at)
  values (gen_random_uuid(), v_email, v_id, p_agent, 'save_drafts', pg_current_xact_id(), clock_timestamp());
  return pg_temp.tx_as(p_who, p_sql);
end;
$fn$;

create function pg_temp.tx_digest(p text) returns text
language sql as $fn$ select encode(sha256(convert_to(p, 'UTF8')), 'hex') $fn$;

create function pg_temp.tx_newkey(p_who text, p_agent text, p_label text) returns text
language plpgsql as $fn$
declare v text;
begin
  v := pg_temp.tx_person(p_who, format('select public.team_agent_key_create(%L)::text', p_agent));
  if v like 'ERR:%' then return v; end if;
  perform pg_temp.tx_keep(p_label, pg_temp.tx_j(v) ->> 'key');
  return v;
end;
$fn$;

create function pg_temp.tx_gw(p_label text, p_tool text, p_args text default '{}', p_gateway text default 'team_agent_call') returns text
language plpgsql as $fn$
begin
  perform pg_temp.tx_next_request();
  return pg_temp.tx_as('service', format('select public.%s(%L, %L, %L::jsonb, %L)::text', p_gateway,
    pg_temp.tx_digest(pg_temp.tx_id(p_label)), p_tool, p_args, 'issue3980-tester/1.0'));
end;
$fn$;

create function pg_temp.tx_work(p_label text, p_tool text, p_args text default '{}') returns text
language sql as $fn$ select pg_temp.tx_gw(p_label, p_tool, p_args, 'ops_agent_call') $fn$;

create function pg_temp.tx_rec(p_name text) returns uuid
language plpgsql as $fn$
declare v_id uuid;
begin
  insert into public.crm_records (pipeline, name, stage, created_by, updated_by)
  values ('hosts', p_name, 'contacted', 'x3980-fixture', 'x3980-fixture') returning id into v_id;
  return v_id;
end;
$fn$;

create function pg_temp.tx_touch(p_record uuid, p_ago interval, p_direction text default 'outbound') returns void
language sql as $fn$
  insert into public.crm_activity (record_id, kind, actor_email, channel, direction, body, occurred_at)
  values (p_record, 'touch', 'gia.x3980@test.local', 'email', p_direction, 'Fixture message', now() - p_ago)
$fn$;

-- The draft result of one save_drafts call: "saved" or the refusal token.
create function pg_temp.tx_draft(p_label text, p_record text, p_key text) returns text
language plpgsql as $fn$
declare v text;
begin
  v := pg_temp.tx_gw(p_label, 'save_drafts', format('{"drafts":[{"record_id":"%s","channel":"email","body":"Hello again about the night"}],"request_key":"%s"}', p_record, p_key));
  return coalesce(pg_temp.tx_get(v, 'result', 'results', '0', 'error', 'token'), pg_temp.tx_get(v, 'result', 'results', '0', 'status'), v);
end;
$fn$;

-- A card the given person owns, added by that person, returning its id.
create function pg_temp.tx_card(p_who text, p_title text, p_owners text, p_watchers text default '[]', p_extra text default '') returns text
language plpgsql as $fn$
declare v text;
begin
  v := pg_temp.tx_person(p_who, format('select public.ops_work_add(%L::jsonb, %L)::text',
    format('[{"title":"%s","instructions":"Do this adversarial tester task carefully.","done_means":"It is done and checked.","owners":%s,"watchers":%s,"due_on":"%s"%s}]',
      p_title, p_owners, p_watchers, (now() AT TIME ZONE 'UTC')::date + 7, p_extra),
    'x3980-' || substr(md5(p_title), 1, 16)));
  return coalesce(pg_temp.tx_get(v, 'results', '0', 'card', 'id'), v);
end;
$fn$;

create function pg_temp.tx_rev(p_card text) returns bigint
language sql as $fn$ select revision from public.ops_work_cards where id = p_card::uuid $fn$;

-- A giveaway and ads card held for go-live, owned by one person. Written
-- directly: the launch kit makes these, one per event, and this suite needs
-- several on the same event.
create function pg_temp.tx_promo(p_owner text, p_title text) returns text
language plpgsql as $fn$
declare v_id uuid;
begin
  insert into public.ops_work_cards (title, instructions, done_means, status, blocked, blocked_kind, blocked_reason, kind,
    anchor_kind, anchor_id, due_on, due_source, sprint_id, created_by, updated_by)
  values (p_title, 'Open the giveaway and get the ads plan approved.', 'The giveaway is open.', 'todo', true, 'organic_only',
    'Organic only: tester fixture.', 'promo', 'event', '39800000-0000-4000-b4aa-000000000001', (now() AT TIME ZONE 'UTC')::date + 19, 'explicit',
    public.ops_sprint_ensure((now() AT TIME ZONE 'UTC')::date + 19), p_owner, p_owner)
  returning id into v_id;
  insert into public.ops_work_people (card_id, email, role, added_by) values (v_id, p_owner, 'owner', p_owner);
  return v_id::text;
end;
$fn$;

select pg_temp.tx_newkey('growth', 'claude', 'GC') is not null as k1,
       pg_temp.tx_newkey('growth', 'codex', 'GX') is not null as k2,
       pg_temp.tx_newkey('growth2', 'claude', 'HC') is not null as k3;

select pg_temp.tx_keep('r1', pg_temp.tx_rec('X3980 Claim Host')::text),
       pg_temp.tx_keep('r2', pg_temp.tx_rec('X3980 Boundary Host')::text),
       pg_temp.tx_keep('r3', pg_temp.tx_rec('X3980 Alive Host')::text),
       pg_temp.tx_keep('today', ((now() AT TIME ZONE 'UTC')::date)::text);

-- ---------------------------------------------------------------------------
-- X-CLAIM
-- ---------------------------------------------------------------------------
do $claim$
declare v text; v_content uuid; v_n bigint;
begin
  -- the same person's other agent is a different holder
  v := pg_temp.tx_work('GC', 'claim', format('{"targets":[{"kind":"crm_record","id":"%s"}]}', pg_temp.tx_id('r1')));
  perform pg_temp.tx_check('X-CLAIM', 'Gia''s Claude claims a host', pg_temp.tx_get(v, 'result', 'status'), 'claimed');
  v := pg_temp.tx_gw('GX', 'update_records', format('{"updates":[{"id":"%s","changes":{"next_action":"Codex tries the same host"}}]}', pg_temp.tx_id('r1')));
  perform pg_temp.tx_check('X-CLAIM', 'Gia''s own Codex is refused like any other agent',
    pg_temp.tx_get(v, 'result', 'results', '0', 'error', 'token'), 'claimed');
  perform pg_temp.tx_like('X-CLAIM', 'naming the holding agent',
    pg_temp.tx_get(v, 'result', 'results', '0', 'error', 'message'), 'Gia''s Claude is working on this host since % UTC.%');
  v := pg_temp.tx_work('GX', 'claim', format('{"targets":[{"kind":"crm_record","id":"%s"}]}', pg_temp.tx_id('r1')));
  perform pg_temp.tx_check('X-CLAIM', 'and its own claim on that host is held, not granted', pg_temp.tx_get(v, 'result', 'status'), 'held');

  -- the 30-minute boundary, both sides
  v := pg_temp.tx_work('GC', 'claim', format('{"targets":[{"kind":"crm_record","id":"%s"}]}', pg_temp.tx_id('r2')));
  update public.ops_claims set claimed_at = clock_timestamp() - interval '40 minutes', last_seen_at = clock_timestamp() - interval '29 minutes 59 seconds'
   where target_id = pg_temp.tx_id('r2')::uuid and released_at is null;
  v := pg_temp.tx_gw('HC', 'update_records', format('{"updates":[{"id":"%s","changes":{"next_action":"Hal at 29:59"}}]}', pg_temp.tx_id('r2')));
  perform pg_temp.tx_check('X-CLAIM', 'at 29:59 since the last update the claim still holds',
    pg_temp.tx_get(v, 'result', 'results', '0', 'error', 'token'), 'claimed');
  update public.ops_claims set last_seen_at = clock_timestamp() - interval '30 minutes 1 second'
   where target_id = pg_temp.tx_id('r2')::uuid and released_at is null;
  v := pg_temp.tx_gw('HC', 'update_records', format('{"updates":[{"id":"%s","changes":{"next_action":"Hal at 30:01"}}]}', pg_temp.tx_id('r2')));
  perform pg_temp.tx_check('X-CLAIM', 'at 30:01 the claim has ended and the other agent''s change goes through',
    pg_temp.tx_get(v, 'result', 'results', '0', 'status'), 'updated');
  perform pg_temp.tx_check('X-CLAIM', 'the claim is marked expired and the end is in the agent log',
    (select release_reason from public.ops_claims where target_id = pg_temp.tx_id('r2')::uuid order by claimed_at desc limit 1) || '/'
      || (select count(*) from public.ops_agent_log where action = 'claim_expired' and target_id = pg_temp.tx_id('r2')::uuid)::text,
    'expired/1');

  -- the holder's own update keeps an old claim alive
  v := pg_temp.tx_work('GC', 'claim', format('{"targets":[{"kind":"crm_record","id":"%s"}]}', pg_temp.tx_id('r3')));
  update public.ops_claims set claimed_at = clock_timestamp() - interval '50 minutes', last_seen_at = clock_timestamp() - interval '29 minutes'
   where target_id = pg_temp.tx_id('r3')::uuid and released_at is null;
  v := pg_temp.tx_gw('GC', 'update_records', format('{"updates":[{"id":"%s","changes":{"next_action":"Holder posts a step"}}]}', pg_temp.tx_id('r3')));
  perform pg_temp.tx_check('X-CLAIM', 'the holder''s write goes through', pg_temp.tx_get(v, 'result', 'results', '0', 'status'), 'updated');
  update public.ops_claims set last_seen_at = last_seen_at - interval '2 minutes' where target_id = pg_temp.tx_id('r3')::uuid and released_at is null;
  v := pg_temp.tx_gw('HC', 'update_records', format('{"updates":[{"id":"%s","changes":{"next_action":"Hal two minutes later"}}]}', pg_temp.tx_id('r3')));
  perform pg_temp.tx_check('X-CLAIM', 'a claim 52 minutes old that its holder just used still refuses others',
    pg_temp.tx_get(v, 'result', 'results', '0', 'error', 'token'), 'claimed');

  -- the table itself allows one live holder per target
  perform pg_temp.tx_like('X-CLAIM', 'a second live claim on the same target cannot exist, even written directly',
    pg_temp.tx_as('service', format($q$insert into public.ops_claims (holder_email, holder_via, target_kind, target_id, target_label)
      values ('hal.x3980@test.local', 'claude', 'crm_record', %L, 'race') returning id::text$q$, pg_temp.tx_id('r3'))), 'ERR:23505:%');

  -- a content card
  insert into public.content_calendar_items (title, stage, created_by, updated_by) values ('X3980 Claimed Post', 'idea', 'x3980-fixture', 'x3980-fixture')
  returning id into v_content;
  perform pg_temp.tx_keep('content', v_content::text);
  v := pg_temp.tx_work('GC', 'claim', format('{"targets":[{"kind":"content","id":"%s"}]}', v_content));
  perform pg_temp.tx_check('X-CLAIM', 'an agent claims a content card', pg_temp.tx_get(v, 'result', 'status'), 'claimed');
  v := pg_temp.tx_gw('HC', 'update_content', format('{"id":"%s","expected_revision":1,"changes":{"notes":"Hal edits the post"},"request_key":"x3980-hal-content-1"}', v_content), 'team_agent_content_call');
  perform pg_temp.tx_like('X-CLAIM', 'another agent''s update_content on it is refused naming the holder', coalesce(pg_temp.tx_get(v, 'error', 'message'), v),
    'Gia''s Claude is working on this content card since %');
  v := pg_temp.tx_person('growth2', format($q$select public.content_calendar_update(%L, '{"notes":"Hal edits by hand"}'::jsonb, 1, 'x3980-hal-hand-1')::text$q$, v_content));
  perform pg_temp.tx_check('X-CLAIM', 'a person''s own edit of the claimed content card goes through', (v not like 'ERR:%')::text, 'true');
  v := pg_temp.tx_person('growth2', format($q$select public.content_calendar_update(%L, '{"notes":"Hal edits again"}'::jsonb, 2, 'x3980-hal-hand-2')::text$q$, v_content));
  perform pg_temp.tx_check('X-CLAIM', 'and again', (v not like 'ERR:%')::text, 'true');
  perform pg_temp.tx_check('X-CLAIM', 'the log notes the person once for the ten minutes, not once per change',
    (select count(*) from public.ops_agent_log where action = 'person_changed_claimed' and target_id = v_content)::text, '1');
  perform pg_temp.tx_check('X-CLAIM', 'and the agent keeps its claim',
    (select count(*) from public.ops_claims where target_id = v_content and released_at is null)::text, '1');

  -- forced release
  v := pg_temp.tx_person('growth2', format('select public.ops_release(null, array[%L]::uuid[])::text',
         (select id from public.ops_claims where target_id = v_content and released_at is null)));
  perform pg_temp.tx_like('X-CLAIM', 'a Sales and marketing person cannot force a release', v, 'ERR:42501:forbidden:%');
  v := pg_temp.tx_work('HC', 'release', format('{"claim_ids":["%s"]}', (select id from public.ops_claims where target_id = v_content and released_at is null)));
  perform pg_temp.tx_check('X-CLAIM', 'another agent releasing it frees nothing', pg_temp.tx_get(v, 'result', 'released'), '0');
  v := pg_temp.tx_person('admin', format('select public.ops_release(null, array[%L]::uuid[])::text',
         (select id from public.ops_claims where target_id = v_content and released_at is null)));
  perform pg_temp.tx_check('X-CLAIM', 'an admin can free a claim an agent left behind, recorded as forced',
    pg_temp.tx_get(v, 'released') || '/' || (select release_reason from public.ops_claims where target_id = v_content order by claimed_at desc limit 1), '1/forced');
  select count(*) into v_n from public.ops_agent_log where action = 'released' and target_id = v_content and outcome = 'info';
  perform pg_temp.tx_check('X-CLAIM', 'and the forced release is in the agent log', v_n::text, '1');
end;
$claim$;

-- ---------------------------------------------------------------------------
-- X-SEND
-- ---------------------------------------------------------------------------
select pg_temp.tx_keep('s1', pg_temp.tx_rec('X3980 Edge Refused Host')::text),
       pg_temp.tx_keep('s2', pg_temp.tx_rec('X3980 Edge Allowed Host')::text),
       pg_temp.tx_keep('s3', pg_temp.tx_rec('X3980 Inbound Host')::text),
       pg_temp.tx_keep('s4', pg_temp.tx_rec('X3980 Neighbour Host')::text),
       pg_temp.tx_keep('s5', pg_temp.tx_rec('X3980 Stale Override Host')::text),
       pg_temp.tx_keep('s6', pg_temp.tx_rec('X3980 Direct Path Host')::text),
       pg_temp.tx_keep('s7', pg_temp.tx_rec('X3980 Discarded Host')::text),
       pg_temp.tx_keep('s8', pg_temp.tx_rec('X3980 Marked Sent Host')::text);

do $send$
declare v text; v_draft text;
begin
  perform pg_temp.tx_touch(pg_temp.tx_id('s1')::uuid, interval '71 hours 59 minutes');
  perform pg_temp.tx_touch(pg_temp.tx_id('s2')::uuid, interval '72 hours 1 minute');
  perform pg_temp.tx_check('X-SEND', 'messaged 71 hours 59 minutes ago: refused', pg_temp.tx_draft('GC', pg_temp.tx_id('s1'), 'x3980-send-0001'), 'recently_messaged');
  perform pg_temp.tx_check('X-SEND', 'messaged 72 hours 1 minute ago: allowed', pg_temp.tx_draft('GC', pg_temp.tx_id('s2'), 'x3980-send-0002'), 'saved');

  perform pg_temp.tx_touch(pg_temp.tx_id('s3')::uuid, interval '1 hour', 'inbound');
  perform pg_temp.tx_check('X-SEND', 'a reply from the host an hour ago does not count as Mingla messaging them',
    pg_temp.tx_draft('GC', pg_temp.tx_id('s3'), 'x3980-send-0003'), 'saved');

  perform pg_temp.tx_touch(pg_temp.tx_id('s1')::uuid, interval '1 hour');
  insert into public.ops_contact_overrides (record_id, reason, granted_by, granted_at, expires_at)
  values (pg_temp.tx_id('s1')::uuid, 'Allowed for the neighbour test', 'oona.x3980@test.local', now(), now() + interval '24 hours');
  perform pg_temp.tx_touch(pg_temp.tx_id('s4')::uuid, interval '1 hour');
  perform pg_temp.tx_check('X-SEND', 'an override for another record does not lift the block on this one',
    pg_temp.tx_draft('GC', pg_temp.tx_id('s4'), 'x3980-send-0004'), 'recently_messaged');

  perform pg_temp.tx_touch(pg_temp.tx_id('s5')::uuid, interval '2 hours');
  insert into public.ops_contact_overrides (record_id, reason, granted_by, granted_at, expires_at)
  values (pg_temp.tx_id('s5')::uuid, 'Allowed yesterday morning', 'oona.x3980@test.local', now() - interval '25 hours', now() - interval '1 hour');
  perform pg_temp.tx_check('X-SEND', 'an override that ran out an hour ago no longer lifts it',
    pg_temp.tx_draft('GC', pg_temp.tx_id('s5'), 'x3980-send-0005'), 'recently_messaged');
  v := pg_temp.tx_agent_sql('growth', 'claude', format($q$select public.ops_contact_override(%L, 'My agent thinks it is urgent')::text$q$, pg_temp.tx_id('s5')));
  perform pg_temp.tx_like('X-SEND', 'an agent cannot allow itself one more message', v, 'ERR:42501:people_only:%');
  v := pg_temp.tx_person('partner', format($q$select public.ops_contact_override(%L, 'The host asked us to resend')::text$q$, pg_temp.tx_id('s5')));
  perform pg_temp.tx_check('X-SEND', 'a Founding partner (a person) can', (pg_temp.tx_j(v) ? 'expires_at')::text, 'true');
  perform pg_temp.tx_check('X-SEND', 'and then the agent''s draft saves', pg_temp.tx_draft('GC', pg_temp.tx_id('s5'), 'x3980-send-0006'), 'saved');

  -- the second draft path: changing a draft that is already waiting
  v := pg_temp.tx_gw('GC', 'save_drafts', format('{"drafts":[{"record_id":"%s","channel":"email","body":"A draft written before the claim"}],"request_key":"x3980-send-0013"}', pg_temp.tx_id('s6')));
  v_draft := pg_temp.tx_get(v, 'result', 'results', '0', 'draft', 'id');
  v := pg_temp.tx_work('HC', 'claim', format('{"targets":[{"kind":"crm_record","id":"%s"}]}', pg_temp.tx_id('s6')));
  v := pg_temp.tx_gw('GC', 'update_draft', format('{"id":"%s","changes":{"body":"Rewritten after Hal claimed the host"}}', v_draft));
  perform pg_temp.tx_like('X-SEND', 'rewriting a waiting draft for a host another agent now holds is refused',
    coalesce(pg_temp.tx_get(v, 'error', 'token'), pg_temp.tx_get(v, 'result', 'error', 'token'), v), '%claimed%');
  perform pg_temp.tx_check('X-SEND', 'and the draft text is unchanged',
    (select body from public.team_drafts where id = v_draft::uuid), 'A draft written before the claim');
  v := pg_temp.tx_agent_sql('growth', 'claude', format($q$select public.team_draft_save('[{"record_id":"%s","channel":"email","body":"Direct"}]'::jsonb, 'x3980-direct-01')::text$q$, pg_temp.tx_id('s6')));
  perform pg_temp.tx_like('X-SEND', 'a signed-in session cannot reach the draft writer around the connector', v, 'ERR:42501:%');

  -- a discarded teammate draft does not block
  v := pg_temp.tx_gw('HC', 'save_drafts', format('{"drafts":[{"record_id":"%s","channel":"email","body":"Hal drafts first"}],"request_key":"x3980-send-0007"}', pg_temp.tx_id('s7')));
  v_draft := pg_temp.tx_get(v, 'result', 'results', '0', 'draft', 'id');
  perform pg_temp.tx_check('X-SEND', 'while Hal''s draft waits, Gia''s agent is refused', pg_temp.tx_draft('GC', pg_temp.tx_id('s7'), 'x3980-send-0008'), 'draft_waiting');
  v := pg_temp.tx_person('growth2', format('select public.team_draft_discard(array[%L]::uuid[])::text', v_draft));
  perform pg_temp.tx_check('X-SEND', 'once Hal discards it, Gia''s agent may write', pg_temp.tx_draft('GC', pg_temp.tx_id('s7'), 'x3980-send-0009'), 'saved');
  perform pg_temp.tx_check('X-SEND', 'and its own waiting draft does not block a second one of its own', pg_temp.tx_draft('GC', pg_temp.tx_id('s7'), 'x3980-send-0010'), 'saved');

  -- a draft marked sent blocks the next one
  v := pg_temp.tx_gw('GC', 'save_drafts', format('{"drafts":[{"record_id":"%s","channel":"email","body":"The first message"}],"request_key":"x3980-send-0011"}', pg_temp.tx_id('s8')));
  v_draft := pg_temp.tx_get(v, 'result', 'results', '0', 'draft', 'id');
  v := pg_temp.tx_agent_sql('growth', 'claude', format($q$select public.team_draft_mark_sent(%L, 'The first message')::text$q$, v_draft));
  perform pg_temp.tx_like('X-SEND', 'the agent cannot mark its own draft sent', v, 'ERR:42501:%');
  v := pg_temp.tx_person('growth', format($q$select public.team_draft_mark_sent(%L, 'The first message')::text$q$, v_draft));
  perform pg_temp.tx_check('X-SEND', 'the person marks it sent', pg_temp.tx_get(v, 'changed'), 'true');
  perform pg_temp.tx_check('X-SEND', 'and the agent''s next draft to that host is refused', pg_temp.tx_draft('GC', pg_temp.tx_id('s8'), 'x3980-send-0012'), 'recently_messaged');
end;
$send$;

-- ---------------------------------------------------------------------------
-- X-AGENT
-- ---------------------------------------------------------------------------
do $agent$
declare v text; t text; v_card text; v_other text; v_rec uuid; v_gone uuid; v_hal_draft text; v_promo text; v_person text; v_before bigint;
begin
  select count(*) into v_before from public.ops_work_cards;
  foreach t in array array['mark_sent','approve_spend','mark_published','publish_event','send_message','archive_work','delete_work',
                           'remove_card','gate_override','override','person_action','convert_next_steps','undo_work','set_sprint_goal'] loop
    perform pg_temp.tx_check('X-AGENT', t || ' is not a work tool', pg_temp.tx_get(pg_temp.tx_work('GC', t, '{}'), 'error', 'token'), 'unknown_tool');
  end loop;
  perform pg_temp.tx_check('X-AGENT', 'and none of those calls changed a card', ((select count(*) from public.ops_work_cards) - v_before)::text, '0');

  v_card := pg_temp.tx_card('growth', 'X3980 Gia owns this', '["gia.x3980@test.local"]', '["abe.x3980@test.local"]');
  v_other := pg_temp.tx_card('growth2', 'X3980 Hal owns this', '["hal.x3980@test.local"]');
  perform pg_temp.tx_keep('gia_card', v_card);

  v := pg_temp.tx_work('GC', 'start_work', format('{"id":"%s","expected_revision":%s}', v_other, pg_temp.tx_rev(v_other)));
  perform pg_temp.tx_check('X-AGENT', 'an agent cannot start a card its person does not own', pg_temp.tx_get(v, 'error', 'token'), 'not_your_card');
  v := pg_temp.tx_work('GC', 'close_work', format('{"id":"%s","expected_revision":%s,"proof":[{"kind":"text","text":"Hal''s work is done"}]}', v_other, pg_temp.tx_rev(v_other)));
  perform pg_temp.tx_check('X-AGENT', 'or close it', pg_temp.tx_get(v, 'error', 'token'), 'not_your_card');

  -- proof that points somewhere it should not
  v := pg_temp.tx_gw('HC', 'save_drafts', format('{"drafts":[{"record_id":"%s","channel":"email","body":"Hal''s draft"}],"request_key":"x3980-agent-0001"}', pg_temp.tx_rec('X3980 Hal Draft Host')));
  v_hal_draft := pg_temp.tx_get(v, 'result', 'results', '0', 'draft', 'id');
  v := pg_temp.tx_work('GC', 'close_work', format('{"id":"%s","expected_revision":%s,"proof":[{"kind":"draft","text":"The draft is written","id":"%s"}]}', v_card, pg_temp.tx_rev(v_card), v_hal_draft));
  perform pg_temp.tx_check('X-AGENT', 'proof pointing to another person''s draft is refused', pg_temp.tx_get(v, 'error', 'token'), 'proof_not_found');
  v_gone := pg_temp.tx_rec('X3980 Removed Host');
  update public.crm_records set deleted_at = now(), deleted_by = 'x3980-fixture' where id = v_gone;
  v := pg_temp.tx_work('GC', 'close_work', format('{"id":"%s","expected_revision":%s,"proof":[{"kind":"record","text":"The host is updated","id":"%s"}]}', v_card, pg_temp.tx_rev(v_card), v_gone));
  perform pg_temp.tx_check('X-AGENT', 'proof pointing to a removed record is refused', pg_temp.tx_get(v, 'error', 'token'), 'proof_not_found');
  v := pg_temp.tx_work('GC', 'close_work', format('{"id":"%s","expected_revision":%s,"proof":[{"kind":"card","text":"See this card","id":"%s"}]}', v_card, pg_temp.tx_rev(v_card), v_card));
  perform pg_temp.tx_check('X-AGENT', 'proof pointing to the card itself is refused', pg_temp.tx_get(v, 'error', 'token'), 'proof_not_found');
  v := pg_temp.tx_work('GC', 'close_work', format('{"id":"%s","expected_revision":%s,"proof":[{"kind":"event_public","text":"Public already","id":"%s"}]}', v_card, pg_temp.tx_rev(v_card), gen_random_uuid()));
  perform pg_temp.tx_check('X-AGENT', 'proof naming an event that does not exist is refused', pg_temp.tx_get(v, 'error', 'token'), 'proof_not_found');
  perform pg_temp.tx_check('X-AGENT', 'after all of that the card is still open', (select status from public.ops_work_cards where id = v_card::uuid), 'todo');

  -- updates an agent may not make
  v := pg_temp.tx_work('GC', 'update_work', format('{"id":"%s","expected_revision":%s,"changes":{"status":"done"}}', v_card, pg_temp.tx_rev(v_card)));
  perform pg_temp.tx_like('X-AGENT', 'an agent cannot set done through an update', pg_temp.tx_get(v, 'error', 'message'), '%Close a card with proof, or push it back.%');
  v := pg_temp.tx_work('GC', 'update_work', format('{"id":"%s","expected_revision":%s,"changes":{"owners":["gia.x3980@test.local","stranger@example.com"]}}', v_card, pg_temp.tx_rev(v_card)));
  perform pg_temp.tx_check('X-AGENT', 'an agent cannot name an owner who is not on the team', pg_temp.tx_get(v, 'error', 'token'), 'invalid_card');
  v := pg_temp.tx_work('GC', 'update_work', format('{"id":"%s","expected_revision":%s,"changes":{"watchers":["lou.x3980@test.local"]}}', v_card, pg_temp.tx_rev(v_card)));
  perform pg_temp.tx_check('X-AGENT', 'or a watcher who has left the team', pg_temp.tx_get(v, 'error', 'token'), 'invalid_card');
  v := pg_temp.tx_work('GC', 'update_work', format('{"id":"%s","expected_revision":%s,"changes":{"kind":"task","kit_step":-28}}', v_card, pg_temp.tx_rev(v_card)));
  perform pg_temp.tx_check('X-AGENT', 'or change what kind of card it is', pg_temp.tx_get(v, 'error', 'token'), 'unknown_field');
  perform pg_temp.tx_check('X-AGENT', 'the card''s owners and watchers are as they were',
    (select string_agg(email || ':' || role, ',' order by email) from public.ops_work_people where card_id = v_card::uuid),
    'abe.x3980@test.local:watcher,gia.x3980@test.local:owner');

  -- a giveaway and ads card held for go-live
  v_promo := pg_temp.tx_promo('gia.x3980@test.local', 'X3980 Promo held');
  v := pg_temp.tx_work('GC', 'update_work', format('{"id":"%s","expected_revision":%s,"changes":{"blocked":false}}', v_promo, pg_temp.tx_rev(v_promo)));
  perform pg_temp.tx_check('X-AGENT', 'an agent cannot lift a go-live block', pg_temp.tx_get(v, 'error', 'token'), 'gate_blocked');
  v := pg_temp.tx_work('GC', 'close_work', format('{"id":"%s","expected_revision":%s,"proof":[{"kind":"text","text":"Giveaway is open"}]}', v_promo, pg_temp.tx_rev(v_promo)));
  perform pg_temp.tx_check('X-AGENT', 'or close the held card', pg_temp.tx_get(v, 'error', 'token'), 'blocked');
  v := pg_temp.tx_work('GC', 'push_back', format('{"id":"%s","expected_revision":%s,"kind":"already_done","reason":"The giveaway was opened last week already.","proof":[{"kind":"text","text":"Giveaway was open"}]}', v_promo, pg_temp.tx_rev(v_promo)));
  perform pg_temp.tx_check('X-AGENT', 'or push it back as already done', pg_temp.tx_get(v, 'error', 'token'), 'blocked');

  -- Needs a person, and leaving it
  v_person := pg_temp.tx_card('growth', 'X3980 Spend waits', '["gia.x3980@test.local"]', '["abe.x3980@test.local"]', ',"person_reason":"spend"');
  perform pg_temp.tx_check('X-AGENT', 'a spend card waits for a person', (select status from public.ops_work_cards where id = v_person::uuid), 'person');
  v := pg_temp.tx_work('GC', 'close_work', format('{"id":"%s","expected_revision":%s,"proof":[{"kind":"text","text":"Spend approved by me"}]}', v_person, pg_temp.tx_rev(v_person)));
  perform pg_temp.tx_check('X-AGENT', 'an agent cannot close it', pg_temp.tx_get(v, 'error', 'token'), 'people_only');
  v := pg_temp.tx_work('GC', 'push_back', format('{"id":"%s","expected_revision":%s,"kind":"declined","reason":"We decided the spend is not needed."}', v_person, pg_temp.tx_rev(v_person)));
  perform pg_temp.tx_check('X-AGENT', 'it cannot push that card back', pg_temp.tx_get(v, 'error', 'token'), 'people_only');
  v := pg_temp.tx_work('GC', 'update_work', format('{"id":"%s","expected_revision":%s,"changes":{"status":"todo"}}', v_person, pg_temp.tx_rev(v_person)));
  perform pg_temp.tx_check('X-AGENT', 'moving it back to To do without a reason is refused', pg_temp.tx_get(v, 'error', 'token'), 'reason_required');
  v := pg_temp.tx_work('GC', 'update_work', format('{"id":"%s","expected_revision":%s,"changes":{"status":"doing","reason":"   "}}', v_person, pg_temp.tx_rev(v_person)));
  perform pg_temp.tx_check('X-AGENT', 'a reason of only spaces is no reason', pg_temp.tx_get(v, 'error', 'token'), 'reason_required');
  perform pg_temp.tx_check('X-AGENT', 'the card still needs a person', (select status || '/' || person_reason from public.ops_work_cards where id = v_person::uuid), 'person/spend');
  v := pg_temp.tx_work('GC', 'update_work', format('{"id":"%s","expected_revision":%s,"changes":{"status":"todo","reason":"The host is paying for the ads herself."}}', v_person, pg_temp.tx_rev(v_person)));
  perform pg_temp.tx_check('X-AGENT', 'with a reason it moves back', pg_temp.tx_get(v, 'result', 'card', 'status'), 'todo');
  perform pg_temp.tx_like('X-AGENT', 'the reason is in the agent log',
    (select summary from public.ops_agent_log where card_id = v_person::uuid order by id desc limit 1), '%The host is paying for the ads herself.%');
  perform pg_temp.tx_check('X-AGENT', 'and the watcher is told',
    (select count(*) from public.team_mentions m join tx_people p on p.id = m.target_user_id
      where m.source_kind = 'work_card' and p.who = 'admin' and m.body_excerpt like '%back to To do from Needs a person%')::text, '1');

  -- the browser cannot pretend to be an agent
  perform pg_temp.tx_like('X-AGENT', 'a signed-in person cannot write an agent request row',
    pg_temp.tx_as('growth', format($q$insert into public.team_agent_calls (key_id, owner_email, actor_uid, agent, tool, xact_id, started_at)
      values (gen_random_uuid(), 'gia.x3980@test.local', %L, 'claude', 'close_work', pg_current_xact_id(), clock_timestamp()) returning id::text$q$,
      (select id from tx_people where who = 'growth'))), 'ERR:42501:%');
  perform pg_temp.tx_like('X-AGENT', 'nor read or write a work table directly',
    pg_temp.tx_as('growth', format($q$update public.ops_work_cards set status = 'done' where id = %L returning id::text$q$, v_card)), 'ERR:42501:%');
end;
$agent$;

-- ---------------------------------------------------------------------------
-- X-ROLES
-- ---------------------------------------------------------------------------
do $roles$
declare v text; w text; v_out text := ''; v_card text; v_promo text; v_claim uuid; v_week date := public.ops_monday((now() AT TIME ZONE 'UTC')::date);
begin
  foreach w in array array['owner','admin','growth','partner','leaver','nobody'] loop
    -- a card and a held promo card for this round, made by the owner
    v_card := pg_temp.tx_card('owner', 'X3980 Role card for ' || w, '["oona.x3980@test.local"]');
    v_promo := pg_temp.tx_promo('oona.x3980@test.local', 'X3980 Role promo for ' || w);
    insert into public.ops_claims (holder_email, holder_via, target_kind, target_id, target_label)
    values ('gia.x3980@test.local', 'claude', 'work_card', v_card::uuid, 'role claim') returning id into v_claim;

    v_out := v_out || w || ':'
      || CASE WHEN pg_temp.tx_person(w, 'select public.ops_config()::text') like 'ERR:%' THEN 'n' ELSE 'y' END
      || CASE WHEN pg_temp.tx_person(w, format('select public.ops_calendar(%L, %L)::text', current_date, current_date + 30)) like 'ERR:%' THEN 'n' ELSE 'y' END
      || CASE WHEN pg_temp.tx_person(w, format($q$select public.ops_work_archive(%L, 'Removed by the role test')::text$q$, v_card)) like 'ERR:%' THEN 'n' ELSE 'y' END
      || CASE WHEN pg_temp.tx_person(w, format($q$select public.ops_sprint_set_goal(%L, 'Role test goal')::text$q$, v_week)) like 'ERR:%' THEN 'n' ELSE 'y' END
      || CASE WHEN pg_temp.tx_person(w, format($q$select public.ops_gate_override(%L, 'The host is a founding partner of Mingla')::text$q$, v_promo)) like 'ERR:%' THEN 'n' ELSE 'y' END
      || CASE WHEN pg_temp.tx_person(w, 'select public.ops_team_overview()::text') like 'ERR:%' THEN 'n' ELSE 'y' END
      || CASE WHEN pg_temp.tx_person(w, 'select public.ops_next_action_preview()::text') like 'ERR:%' THEN 'n' ELSE 'y' END
      || CASE WHEN pg_temp.tx_person(w, format('select public.ops_release(null, array[%L]::uuid[])::text', v_claim)) like 'ERR:%' THEN 'n' ELSE 'y' END
      || ' ';
  end loop;
  -- columns: config, calendar, archive, sprint goal, gate override, team overview, conversion preview, forced release
  perform pg_temp.tx_check('X-ROLES', 'who may do what, by role',
    btrim(v_out), 'owner:yyyyyyyy admin:yyyyyyny growth:yynnnnnn partner:yynnnnnn leaver:nnnnnnnn nobody:nnnnnnnn');
  perform pg_temp.tx_like('X-ROLES', 'an admin is told the conversion is the owner''s',
    pg_temp.tx_person('admin', 'select public.ops_next_action_preview()::text'), 'ERR:42501:owner_only:%');
  perform pg_temp.tx_like('X-ROLES', 'and so is the owner''s own agent',
    pg_temp.tx_agent_sql('owner', 'claude', 'select public.ops_next_action_preview()::text'), 'ERR:42501:owner_only:%');
  perform pg_temp.tx_like('X-ROLES', 'an override reason under 10 characters is refused even for the owner',
    pg_temp.tx_person('owner', format($q$select public.ops_gate_override(%L, 'ok')::text$q$,
      pg_temp.tx_promo('oona.x3980@test.local', 'X3980 Short reason promo')))
    , 'ERR:%');
end;
$roles$;

select count(*) as tx_total, count(*) filter (where not ok) as tx_failed,
       coalesce(string_agg(test || ' ' || label || ' [' || detail || ']', E'\n' order by seq) filter (where not ok), 'none') as tx_failures
  from tx_results \gset
rollback;

select (:tx_total < 60 or :tx_failed > 0) as tx_bad \gset
\if :tx_bad
  \echo 'ISSUE-3980 TESTER GUARDRAILS FAILED:' :tx_failed 'of' :tx_total
  \echo :tx_failures
  do $$ begin raise exception 'ISSUE-3980 TESTER GUARDRAILS FAIL'; end $$;
\endif
\echo 'ISSUE-3980 TESTER GUARDRAILS PASS:' :tx_total 'checks, 0 failed'
