-- Issue #3980 rework 2 -- tester adversarial suite (retest 2), on the fully
-- replayed PG17 schema. The implementor's suite proves that a waiting draft
-- clears "Draft needed" and that the badge equals the lists. This suite
-- attacks the other side: things that look like a draft for the card but are
-- not, and cards that look like they wait for a person but do not, must
-- never clear "Draft needed" or inflate To review.
--   X-LINK   a waiting draft for a record linked to the card by a link kind
--            other than host or creator (an event or brand link, same id)
--            does not clear Draft needed; one for an unlinked host does not
--   X-PROOF  a proof entry that is not of kind draft but carries a waiting
--            draft's id does not clear it; a bare-string entry, a draft entry
--            with no id, an unknown id or a discarded draft's id clear nothing
--            and do not break the list
--   X-STATE  a discarded draft for the linked host does not clear it
--   X-SCOPE  archived and done send cards are never listed or counted; a
--            partner who only watches a send card sees and counts it
--   X-EQUAL  for every role, the counts equal the lists after all of this
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


do $adv$
declare v_host uuid := pg_temp.tw_rec('V3980 X Linked Lounge'); v_other uuid := pg_temp.tw_rec('V3980 X Other Lounge');
        v_lnk text; v_prf text; v_obj text; v_disc text; v_arch text; v_done text; v_watch text;
        v_d1 uuid; v_d2 uuid; v_d3 uuid; v_d4 uuid; r jsonb; m jsonb; w text; v text;
begin
  -- LNK: send card linked to v_host as a host. PRF: send card, no link.
  -- OBJ: send card whose proof holds odd entries. DISC: send card linked to
  -- v_other. ARCH / DONE: send cards that leave Needs a person by other doors.
  -- WATCH: Hal's send card that the partner only watches.
  v_lnk  := pg_temp.tw_card('growth', 'V3980 X1 send linked', '["gia.v3980@test.local"]', '[]', format(',"links":[{"kind":"host","id":"%s"}]', v_host));
  v_prf  := pg_temp.tw_card('growth', 'V3980 X2 send proof', '["gia.v3980@test.local"]');
  v_obj  := pg_temp.tw_card('growth', 'V3980 X3 send odd proof', '["gia.v3980@test.local"]');
  v_disc := pg_temp.tw_card('growth', 'V3980 X4 send discarded', '["gia.v3980@test.local"]', '[]', format(',"links":[{"kind":"host","id":"%s"}]', v_other));
  v_arch := pg_temp.tw_card('growth', 'V3980 X5 send archived', '["gia.v3980@test.local"]');
  v_done := pg_temp.tw_card('growth', 'V3980 X6 send done', '["gia.v3980@test.local"]');
  v_watch := pg_temp.tw_card('growth2', 'V3980 X7 send watched by partner', '["hal.v3980@test.local"]', '["pia.v3980@test.local"]');
  foreach v in array array[v_lnk, v_prf, v_obj, v_disc, v_arch, v_done] loop
    perform pg_temp.tw_person('growth', format($q$select public.ops_work_update(%L, '{"status":"person","person_reason":"send"}'::jsonb, %s)::text$q$, v, pg_temp.tw_rev(v)));
  end loop;
  perform pg_temp.tw_person('growth2', format($q$select public.ops_work_update(%L, '{"status":"person","person_reason":"send"}'::jsonb, %s)::text$q$, v_watch, pg_temp.tw_rev(v_watch)));
  perform pg_temp.tw_check('X-SETUP', 'seven send cards wait for a person',
    (select count(*)::text from public.ops_work_cards where title like 'V3980 X%' and status = 'person' and person_reason = 'send'), '7');

  -- X-LINK: a waiting draft for a record the card reaches only through a
  -- non-host link (same uuid, kind event and brand), and one for an unlinked host.
  v_d1 := pg_temp.tw_waiting_draft('gia.v3980@test.local', v_other, 'v3980-xdraft-other');
  update public.team_drafts set state = 'discarded', discarded_at = now(), discarded_by = 'gia.v3980@test.local' where id = v_d1;
  v_d2 := pg_temp.tw_waiting_draft('hal.v3980@test.local', pg_temp.tw_rec('V3980 X Event Shadow'), 'v3980-xdraft-shadow');
  insert into public.ops_work_links (card_id, kind, target_id, label, added_by)
  select v_prf::uuid, k, d.record_id, 'V3980 shadow ' || k, 'gia.v3980@test.local' from public.team_drafts d, unnest(array['event', 'brand', 'content', 'card']) k where d.id = v_d2;
  v_d3 := pg_temp.tw_waiting_draft('gia.v3980@test.local', pg_temp.tw_rec('V3980 X Unlinked Host'), 'v3980-xdraft-unlinked');
  r := pg_temp.tw_review('growth');
  perform pg_temp.tw_check('X-LINK', 'drafts for an unlinked host, for event/brand/content/card links, and a discarded draft clear nothing',
    pg_temp.tw_titles(r, 'draft_needed'),
    'V3980 X1 send linked,V3980 X2 send proof,V3980 X3 send odd proof,V3980 X4 send discarded,V3980 X5 send archived,V3980 X6 send done');

  -- X-PROOF: proof entries that name a waiting draft's id under another kind.
  update public.ops_work_cards set proof = jsonb_build_array(
      jsonb_build_object('kind', 'text', 'id', v_d3, 'text', 'Draft written'),
      jsonb_build_object('kind', 'link', 'id', v_d3, 'url', 'https://example.test/d'),
      jsonb_build_object('kind', 'Draft', 'id', v_d3),
      jsonb_build_object('kind', 'draft', 'id', upper(v_d3::text) || ' '))
   where id = v_prf::uuid;
  update public.ops_work_cards set proof = jsonb_build_array(to_jsonb(v_d3::text), jsonb_build_object('kind', 'draft'),
      jsonb_build_object('kind', 'draft', 'id', gen_random_uuid()), jsonb_build_object('kind', 'draft', 'id', v_d1))
   where id = v_obj::uuid;
  r := pg_temp.tw_review('growth');
  perform pg_temp.tw_check('X-PROOF', 'the list still answers with a bare-string proof entry on a card', (r ? 'draft_needed')::text, 'true');
  perform pg_temp.tw_check('X-PROOF', 'text, link, wrong-case kind, padded id, bare id, missing, unknown and discarded draft proofs clear nothing',
    pg_temp.tw_titles(r, 'draft_needed'),
    'V3980 X1 send linked,V3980 X2 send proof,V3980 X3 send odd proof,V3980 X4 send discarded,V3980 X5 send archived,V3980 X6 send done');

  -- X-SCOPE: archived and done cards leave both the list and the count.
  update public.ops_work_cards set archived_at = now(), archived_by = 'gia.v3980@test.local', archive_reason = 'Tester archive' where id = v_arch::uuid;
  update public.ops_work_cards set status = 'done', person_reason = null, closed_at = now(), closed_by = 'gia.v3980@test.local', close_kind = 'done' where id = v_done::uuid;
  r := pg_temp.tw_review('growth'); m := pg_temp.tw_counts('growth');
  perform pg_temp.tw_check('X-SCOPE', 'archived and done send cards are gone from Draft needed',
    pg_temp.tw_titles(r, 'draft_needed'), 'V3980 X1 send linked,V3980 X2 send proof,V3980 X3 send odd proof,V3980 X4 send discarded');
  perform pg_temp.tw_check('X-SCOPE', 'and from the badge count', m->>'draft_needed_mine', '4');
  perform pg_temp.tw_check('X-SCOPE', 'the list''s own count agrees', r->'counts'->>'draft_needed', '4');
  perform pg_temp.tw_check('X-SCOPE', 'the partner who only watches Hal''s send card sees it',
    pg_temp.tw_titles(pg_temp.tw_review('partner'), 'draft_needed'), 'V3980 X7 send watched by partner');
  perform pg_temp.tw_check('X-SCOPE', 'and counts it', pg_temp.tw_counts('partner')->>'draft_needed_mine', '1');

  -- The real thing still works: a waiting draft for the host linked as a host.
  v_d4 := pg_temp.tw_waiting_draft('hal.v3980@test.local', v_host, 'v3980-xdraft-real');
  perform pg_temp.tw_check('X-LINK', 'a waiting draft for the host linked as a host clears only that card',
    pg_temp.tw_titles(pg_temp.tw_review('growth'), 'draft_needed'), 'V3980 X2 send proof,V3980 X3 send odd proof,V3980 X4 send discarded');

  -- X-EQUAL: for every role the counts are the lists.
  foreach w in array array['owner', 'admin', 'growth', 'growth2', 'partner'] loop
    r := pg_temp.tw_review(w); m := pg_temp.tw_counts(w);
    perform pg_temp.tw_check('X-EQUAL', 'for ' || w || ' the counts equal the lists',
      (m->>'needs_person_mine') || '/' || (m->>'draft_needed_mine'),
      jsonb_array_length(r->'cards')::text || '/' || jsonb_array_length(r->'draft_needed')::text);
  end loop;
  perform pg_temp.tw_check('X-EQUAL', 'the admin sees the four live send cards of this suite and nothing archived or done',
    pg_temp.tw_titles(pg_temp.tw_review('admin'), 'draft_needed'), 'V3980 X2 send proof,V3980 X3 send odd proof,V3980 X4 send discarded,V3980 X7 send watched by partner');
end;
$adv$;

select count(*) as tw_total, count(*) filter (where not ok) as tw_failed,
       coalesce(string_agg(test || ' ' || label || ' [' || detail || ']', E'\n' order by seq) filter (where not ok), 'none') as tw_failures
  from tw_results \gset
rollback;

select (:tw_total < 16 or :tw_failed > 0) as tw_bad \gset
\if :tw_bad
  \echo 'ISSUE-3980 TESTER REVIEW COUNTS FAILED:' :tw_failed 'of' :tw_total
  \echo :tw_failures
  do $$ begin raise exception 'ISSUE-3980 TESTER REVIEW COUNTS FAIL'; end $$;
\endif
\echo 'ISSUE-3980 TESTER REVIEW COUNTS PASS:' :tw_total 'checks, 0 failed'
