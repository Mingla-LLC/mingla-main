-- Issue #3980 rework -- implementor happy path for two fixes after the
-- tester's FAIL, on the fully replayed PG17 schema:
--   R-HANDOFF  an agent (and a person) can hand a card to a person part way
--              through: ops_work_update carries person_reason into the item
--              it validates, so the reason is kept and the card waits in
--              To review
--   R-REMOVED  when an agent takes an owner or watcher off a card, that
--              person is told who did it, through which agent, with the
--              card's link; a person doing the same is not announced; when
--              the card closes (or is pushed back), anyone taken off it in
--              the last 24 hours is told it closed, and someone taken off
--              longer ago, put back, or whose removal was undone is not
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
  ('owner',   '39800000-0000-4000-a0dd-000000000001', 'oona.y3980@test.local'),
  ('admin',   '39800000-0000-4000-a0dd-000000000002', 'abe.y3980@test.local'),
  ('growth',  '39800000-0000-4000-a0dd-000000000003', 'gia.y3980@test.local'),
  ('growth2', '39800000-0000-4000-a0dd-000000000004', 'hal.y3980@test.local'),
  ('partner', '39800000-0000-4000-a0dd-000000000005', 'pia.y3980@test.local'),
  ('leaver',  '39800000-0000-4000-a0dd-000000000006', 'lou.y3980@test.local'),
  ('nobody',  '39800000-0000-4000-a0dd-000000000007', 'ned.y3980@test.local');
insert into auth.users (id, email, email_confirmed_at) select id, email, now() from ti_people;
insert into public.admin_users (email, role, status, accepted_at) values
  ('oona.y3980@test.local', 'owner', 'active', now()),
  ('abe.y3980@test.local', 'admin', 'active', now());
insert into public.admin_team_members (email, role, status, accepted_at) values
  ('gia.y3980@test.local', 'growth', 'active', now()),
  ('hal.y3980@test.local', 'growth', 'active', now()),
  ('pia.y3980@test.local', 'partner', 'active', now()),
  ('lou.y3980@test.local', 'growth', 'revoked', now());

-- One event 40 days out, public, for anchored cards.
set local session_replication_role = replica;
insert into public.brands (id, account_id, name, slug, city) values
  ('39800000-0000-4000-b1dd-000000000001', '39800000-0000-4000-b3dd-000000000001', 'Y3980 Guard Brand', 'y3980-guard-brand', 'Lagos');
insert into public.events (id, brand_id, title, slug, visibility, status, timezone, published_at, event_type) values
  ('39800000-0000-4000-b4dd-000000000001', '39800000-0000-4000-b1dd-000000000001', 'Y3980 Guard Night', 'y3980-guard-night', 'discover', 'scheduled', 'UTC', now() - interval '1 day', 'event');
insert into public.event_dates (event_id, start_at, end_at, is_master) values
  ('39800000-0000-4000-b4dd-000000000001', date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' + interval '40 days 20 hours',
   date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' + interval '40 days 23 hours', true);
set local session_replication_role = origin;

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

create function pg_temp.ti_like(p_test text, p_label text, p_got text, p_pattern text) returns void
language plpgsql as $fn$
begin
  insert into ti_results (test, label, ok, detail)
  values (p_test, p_label, coalesce(p_got like p_pattern, false),
          format('got %s, want like %s', coalesce(left(p_got, 600), '<null>'), p_pattern));
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

-- A connected agent calling a function directly, as the gateway does: the
-- request row first, in this transaction, then the call.
create function pg_temp.ti_agent_sql(p_who text, p_agent text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text;
begin
  perform pg_temp.ti_next_request();
  select id, email into strict v_id, v_email from ti_people where who = p_who;
  insert into public.team_agent_calls (key_id, owner_email, actor_uid, agent, tool, xact_id, started_at)
  values (gen_random_uuid(), v_email, v_id, p_agent, 'save_drafts', pg_current_xact_id(), clock_timestamp());
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

create function pg_temp.ti_gw(p_label text, p_tool text, p_args text default '{}', p_gateway text default 'team_agent_call') returns text
language plpgsql as $fn$
begin
  perform pg_temp.ti_next_request();
  return pg_temp.ti_as('service', format('select public.%s(%L, %L, %L::jsonb, %L)::text', p_gateway,
    pg_temp.ti_digest(pg_temp.ti_id(p_label)), p_tool, p_args, 'issue3980-implementor/1.0'));
end;
$fn$;

create function pg_temp.ti_work(p_label text, p_tool text, p_args text default '{}') returns text
language sql as $fn$ select pg_temp.ti_gw(p_label, p_tool, p_args, 'ops_agent_call') $fn$;

create function pg_temp.ti_rec(p_name text) returns uuid
language plpgsql as $fn$
declare v_id uuid;
begin
  insert into public.crm_records (pipeline, name, stage, created_by, updated_by)
  values ('hosts', p_name, 'contacted', 'y3980-fixture', 'y3980-fixture') returning id into v_id;
  return v_id;
end;
$fn$;

create function pg_temp.ti_touch(p_record uuid, p_ago interval, p_direction text default 'outbound') returns void
language sql as $fn$
  insert into public.crm_activity (record_id, kind, actor_email, channel, direction, body, occurred_at)
  values (p_record, 'touch', 'gia.y3980@test.local', 'email', p_direction, 'Fixture message', now() - p_ago)
$fn$;

-- The draft result of one save_drafts call: "saved" or the refusal token.
create function pg_temp.ti_draft(p_label text, p_record text, p_key text) returns text
language plpgsql as $fn$
declare v text;
begin
  v := pg_temp.ti_gw(p_label, 'save_drafts', format('{"drafts":[{"record_id":"%s","channel":"email","body":"Hello again about the night"}],"request_key":"%s"}', p_record, p_key));
  return coalesce(pg_temp.ti_get(v, 'result', 'results', '0', 'error', 'token'), pg_temp.ti_get(v, 'result', 'results', '0', 'status'), v);
end;
$fn$;

-- A card the given person owns, added by that person, returning its id.
create function pg_temp.ti_card(p_who text, p_title text, p_owners text, p_watchers text default '[]', p_extra text default '') returns text
language plpgsql as $fn$
declare v text;
begin
  v := pg_temp.ti_person(p_who, format('select public.ops_work_add(%L::jsonb, %L)::text',
    format('[{"title":"%s","instructions":"Do this adversarial tester task carefully.","done_means":"It is done and checked.","owners":%s,"watchers":%s,"due_on":"%s"%s}]',
      p_title, p_owners, p_watchers, (now() AT TIME ZONE 'UTC')::date + 7, p_extra),
    'y3980-' || substr(md5(p_title), 1, 16)));
  return coalesce(pg_temp.ti_get(v, 'results', '0', 'card', 'id'), v);
end;
$fn$;

create function pg_temp.ti_rev(p_card text) returns bigint
language sql as $fn$ select revision from public.ops_work_cards where id = p_card::uuid $fn$;

-- A giveaway and ads card held for go-live, owned by one person. Written
-- directly: the launch kit makes these, one per event, and this suite needs
-- several on the same event.
create function pg_temp.ti_promo(p_owner text, p_title text) returns text
language plpgsql as $fn$
declare v_id uuid;
begin
  insert into public.ops_work_cards (title, instructions, done_means, status, blocked, blocked_kind, blocked_reason, kind,
    anchor_kind, anchor_id, due_on, due_source, sprint_id, created_by, updated_by)
  values (p_title, 'Open the giveaway and get the ads plan approved.', 'The giveaway is open.', 'todo', true, 'organic_only',
    'Organic only: tester fixture.', 'promo', 'event', '39800000-0000-4000-b4dd-000000000001', (now() AT TIME ZONE 'UTC')::date + 19, 'explicit',
    public.ops_sprint_ensure((now() AT TIME ZONE 'UTC')::date + 19), p_owner, p_owner)
  returning id into v_id;
  insert into public.ops_work_people (card_id, email, role, added_by) values (v_id, p_owner, 'owner', p_owner);
  return v_id::text;
end;
$fn$;

select pg_temp.ti_newkey('growth', 'claude', 'GC') is not null as k1;

do $handoff$
declare v text; v_card text;
begin
  v_card := pg_temp.ti_card('growth', 'Y3980 Agent hands to a person', '["gia.y3980@test.local"]', '["abe.y3980@test.local"]');
  v := pg_temp.ti_work('GC', 'update_work', format('{"id":"%s","expected_revision":%s,"changes":{"status":"person","person_reason":"spend"}}', v_card, pg_temp.ti_rev(v_card)));
  perform pg_temp.ti_check('R-HANDOFF', 'an agent sets Needs a person with the reason spend',
    coalesce(pg_temp.ti_get(v, 'result', 'card', 'status') || '/' || pg_temp.ti_get(v, 'result', 'card', 'person_reason'), v), 'person/spend');
  perform pg_temp.ti_check('R-HANDOFF', 'the stored card keeps the reason',
    (select status || '/' || person_reason from public.ops_work_cards where id = v_card::uuid), 'person/spend');
  v := pg_temp.ti_person('admin', 'select public.ops_review_list()::text');
  perform pg_temp.ti_check('R-HANDOFF', 'the card waits in To review',
    (select count(*) from jsonb_array_elements(pg_temp.ti_j(v)->'cards') c where c->>'id' = v_card)::text, '1');

  v_card := pg_temp.ti_card('growth2', 'Y3980 Person hands to a person', '["hal.y3980@test.local"]');
  v := pg_temp.ti_person('growth2', format($q$select public.ops_work_update(%L, '{"status":"person","person_reason":"send"}'::jsonb, %s)::text$q$, v_card, pg_temp.ti_rev(v_card)));
  perform pg_temp.ti_check('R-HANDOFF', 'a person sets Needs a person with the reason send',
    coalesce(pg_temp.ti_get(v, 'card', 'status') || '/' || pg_temp.ti_get(v, 'card', 'person_reason'), v), 'person/send');
  v := pg_temp.ti_person('growth2', format($q$select public.ops_work_update(%L, '{"person_reason":"publish"}'::jsonb, %s)::text$q$, v_card, pg_temp.ti_rev(v_card)));
  perform pg_temp.ti_check('R-HANDOFF', 'the reason alone can be changed while it waits',
    coalesce(pg_temp.ti_get(v, 'card', 'status') || '/' || pg_temp.ti_get(v, 'card', 'person_reason'), v), 'person/publish');
  v := pg_temp.ti_person('growth2', format($q$select public.ops_work_update(%L, '{"title":"Y3980 Person hands to a person, renamed"}'::jsonb, %s)::text$q$, v_card, pg_temp.ti_rev(v_card)));
  perform pg_temp.ti_check('R-HANDOFF', 'another change keeps the stored reason',
    coalesce(pg_temp.ti_get(v, 'card', 'status') || '/' || pg_temp.ti_get(v, 'card', 'person_reason'), v), 'person/publish');
end;
$handoff$;

create function pg_temp.ti_told(p_who text, p_like text) returns text
language sql as $fn$
  select count(*)::text from public.team_mentions m join ti_people p on p.id = m.target_user_id
   where m.source_kind = 'work_card' and p.who = p_who and m.body_excerpt like p_like
$fn$;

do $removed$
declare v text; v_card text; v_link text;
begin
  -- An agent takes a watcher and a co-owner off its person's card.
  v_card := pg_temp.ti_card('growth', 'Y3980 Reviewer taken off', '["gia.y3980@test.local","hal.y3980@test.local"]', '["abe.y3980@test.local","oona.y3980@test.local"]');
  v := pg_temp.ti_work('GC', 'update_work', format('{"id":"%s","expected_revision":%s,"changes":{"owners":["gia.y3980@test.local"],"watchers":["oona.y3980@test.local"]}}', v_card, pg_temp.ti_rev(v_card)));
  perform pg_temp.ti_check('R-REMOVED', 'the agent''s change is saved',
    (select string_agg(email || ':' || role, ',' order by email) from public.ops_work_people where card_id = v_card::uuid),
    'gia.y3980@test.local:owner,oona.y3980@test.local:watcher');
  perform pg_temp.ti_check('R-REMOVED', 'the watcher taken off is told who and which agent',
    pg_temp.ti_told('admin', '%Claude took you off this card: Y3980 Reviewer taken off%'), '1');
  perform pg_temp.ti_check('R-REMOVED', 'the owner taken off is told too',
    pg_temp.ti_told('growth2', '%Claude took you off this card: Y3980 Reviewer taken off%'), '1');
  perform pg_temp.ti_check('R-REMOVED', 'the notice names the person behind the agent',
    (select m.body_excerpt from public.team_mentions m join ti_people p on p.id = m.target_user_id
      where p.who = 'admin' and m.body_excerpt like '%took you off%' limit 1),
    (select public.ops_actor_label('gia.y3980@test.local', 'claude')) || ' took you off this card: Y3980 Reviewer taken off');
  select m.deep_link into v_link from public.team_mentions m join ti_people p on p.id = m.target_user_id
   where p.who = 'admin' and m.body_excerpt like '%took you off%' limit 1;
  perform pg_temp.ti_like('R-REMOVED', 'the notice links to the card', v_link, '%work-board?card=' || v_card);
  perform pg_temp.ti_check('R-REMOVED', 'whoever stayed on is not told they were taken off',
    pg_temp.ti_told('owner', '%took you off%'), '0');

  -- The agent closes the card with text proof: both people taken off hear.
  v := pg_temp.ti_work('GC', 'close_work', format('{"id":"%s","expected_revision":%s,"proof":[{"kind":"text","text":"Reviewed and done by Gia"}]}', v_card, pg_temp.ti_rev(v_card)));
  perform pg_temp.ti_check('R-REMOVED', 'the agent closes the card with text proof',
    coalesce(pg_temp.ti_get(v, 'result', 'card', 'status'), v), 'done');
  perform pg_temp.ti_check('R-REMOVED', 'the watcher taken off is told it closed',
    pg_temp.ti_told('admin', '%closed a card you were taken off in the last 24 hours: Y3980 Reviewer taken off%'), '1');
  perform pg_temp.ti_check('R-REMOVED', 'the owner taken off is told it closed',
    pg_temp.ti_told('growth2', '%closed a card you were taken off in the last 24 hours: Y3980 Reviewer taken off%'), '1');
  perform pg_temp.ti_check('R-REMOVED', 'the watcher still on hears the ordinary close',
    pg_temp.ti_told('owner', '%closed: Y3980 Reviewer taken off%') || '/' || pg_temp.ti_told('owner', '%taken off in the last 24 hours%'), '1/0');

  -- A person taking a watcher off is not announced (the agent guardrail only).
  v_card := pg_temp.ti_card('growth', 'Y3980 Person tidies watchers', '["gia.y3980@test.local"]', '["abe.y3980@test.local"]');
  v := pg_temp.ti_person('growth', format($q$select public.ops_work_update(%L, '{"watchers":[]}'::jsonb, %s)::text$q$, v_card, pg_temp.ti_rev(v_card)));
  perform pg_temp.ti_check('R-REMOVED', 'a person taking a watcher off sends no notice',
    pg_temp.ti_told('admin', '%took you off this card: Y3980 Person tidies watchers%'), '0');
  -- ... but the close still reaches them within the day.
  v := pg_temp.ti_person('growth', format($q$select public.ops_work_push_back(%L, 'declined', 'Not needed after the call today', '[]'::jsonb, %s)::text$q$, v_card, pg_temp.ti_rev(v_card)));
  perform pg_temp.ti_check('R-REMOVED', 'a push back reaches the watcher taken off today',
    pg_temp.ti_told('admin', '%closed a card you were taken off in the last 24 hours: Y3980 Person tidies watchers%'), '1');

  -- Taken off more than a day ago: not told at close.
  v_card := pg_temp.ti_card('growth', 'Y3980 Old removal', '["gia.y3980@test.local"]', '["abe.y3980@test.local"]');
  v := pg_temp.ti_work('GC', 'update_work', format('{"id":"%s","expected_revision":%s,"changes":{"watchers":[]}}', v_card, pg_temp.ti_rev(v_card)));
  update public.ops_work_events set at = at - interval '25 hours' where card_id = v_card::uuid;
  v := pg_temp.ti_person('growth', format($q$select public.ops_work_close(%L, '[{"kind":"text","text":"Finished it last week"}]'::jsonb, NULL, %s)::text$q$, v_card, pg_temp.ti_rev(v_card)));
  perform pg_temp.ti_check('R-REMOVED', 'a person closes the card', coalesce(pg_temp.ti_get(v, 'card', 'status'), v), 'done');
  perform pg_temp.ti_check('R-REMOVED', 'someone taken off more than 24 hours ago is not told at close',
    pg_temp.ti_told('admin', '%taken off in the last 24 hours: Y3980 Old removal%'), '0');

  -- Taken off and put back: told only the ordinary close.
  v_card := pg_temp.ti_card('growth', 'Y3980 Put back', '["gia.y3980@test.local"]', '["abe.y3980@test.local"]');
  v := pg_temp.ti_work('GC', 'update_work', format('{"id":"%s","expected_revision":%s,"changes":{"watchers":[]}}', v_card, pg_temp.ti_rev(v_card)));
  v := pg_temp.ti_work('GC', 'update_work', format('{"id":"%s","expected_revision":%s,"changes":{"watchers":["abe.y3980@test.local"]}}', v_card, pg_temp.ti_rev(v_card)));
  v := pg_temp.ti_person('growth', format($q$select public.ops_work_close(%L, '[{"kind":"text","text":"Done with Abe watching"}]'::jsonb, NULL, %s)::text$q$, v_card, pg_temp.ti_rev(v_card)));
  perform pg_temp.ti_check('R-REMOVED', 'someone put back on is told the ordinary close, not the removed one',
    pg_temp.ti_told('admin', '%closed: Y3980 Put back%') || '/' || pg_temp.ti_told('admin', '%taken off in the last 24 hours: Y3980 Put back%'), '1/0');
end;
$removed$;

do $words$
declare v text; v_summary text;
begin
  v := pg_temp.ti_work('GC', 'add_work', '{"cards":[{"title":"Y3980 Half a card","instructions":"Do the half card task carefully.","owners":["gia.y3980@test.local"]}],"request_key":"y3980-half-card"}');
  select summary into v_summary from public.ops_agent_log where action = 'card_refused' and summary like '%Y3980 Half a card%' order by at desc limit 1;
  perform pg_temp.ti_like('R-WORDS', 'the agent log names what to fix in plain words', v_summary, '%done means%due date%to fix.');
  perform pg_temp.ti_check('R-WORDS', 'the agent log carries no internal field name',
    (v_summary ~ '(done_means|due_on|person_reason|kit_step)')::text, 'false');
end;
$words$;

select count(*) as ti_total, count(*) filter (where not ok) as ti_failed,
       coalesce(string_agg(test || ' ' || label || ' [' || detail || ']', E'\n' order by seq) filter (where not ok), 'none') as ti_failures
  from ti_results \gset
rollback;

select (:ti_total < 23 or :ti_failed > 0) as ti_bad \gset
\if :ti_bad
  \echo 'ISSUE-3980 REWORK HANDOFF/REMOVAL FAILED:' :ti_failed 'of' :ti_total
  \echo :ti_failures
  do $$ begin raise exception 'ISSUE-3980 REWORK HANDOFF/REMOVAL FAIL'; end $$;
\endif
\echo 'ISSUE-3980 REWORK HANDOFF/REMOVAL PASS:' :ti_total 'checks, 0 failed'
