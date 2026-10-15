-- Issue #3802 PR-D — implementation proof for crm_team_summary's counts-only
-- person/Claude/Codex attribution. Runs after the complete PG17 replay.
\set ON_ERROR_STOP on
begin;

alter table auth.users add column if not exists email_confirmed_at timestamptz;
create temp table t3802d_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into t3802d_people values
  ('owner',   '38020000-0000-4000-f000-000000000001', 'issue3802d-owner@test.local'),
  ('admin',   '38020000-0000-4000-f000-000000000002', 'issue3802d-admin@test.local'),
  ('growth',  '38020000-0000-4000-f000-000000000003', 'issue3802d-growth@test.local'),
  ('partner', '38020000-0000-4000-f000-000000000004', 'issue3802d-partner@test.local'),
  ('removed', '38020000-0000-4000-f000-000000000005', 'issue3802d-removed@test.local');
insert into auth.users (id, email, email_confirmed_at) select id, email, now() from t3802d_people;
insert into public.admin_users (email, role, status, accepted_at) values
  ('issue3802d-owner@test.local', 'owner', 'active', now()),
  ('issue3802d-admin@test.local', 'admin', 'active', now());
insert into public.admin_team_members (email, role, status, accepted_at) values
  ('issue3802d-growth@test.local', 'growth', 'active', now()),
  ('issue3802d-partner@test.local', 'partner', 'active', now()),
  ('issue3802d-removed@test.local', 'growth', 'revoked', now());

insert into public.crm_records (id, pipeline, name, stage, created_by, updated_by)
values ('38020000-0000-4000-f100-000000000001', 'hosts', 'Issue3802d Host', 'prospect',
        'issue3802d-owner@test.local', 'issue3802d-owner@test.local');

insert into public.crm_activity
  (record_id, kind, actor_email, via, body, from_stage, to_stage, channel, direction, created_at)
values
  ('38020000-0000-4000-f100-000000000001', 'touch', 'issue3802d-owner@test.local', null, 'person touch', null, null, 'email', 'outbound', now()),
  ('38020000-0000-4000-f100-000000000001', 'touch', 'issue3802d-owner@test.local', null, 'person-marked sent draft', null, null, 'instagram_dm', 'outbound', now()),
  ('38020000-0000-4000-f100-000000000001', 'touch', 'issue3802d-owner@test.local', 'claude', 'agent touch', null, null, 'email', 'outbound', now()),
  ('38020000-0000-4000-f100-000000000001', 'touch', 'issue3802d-owner@test.local', 'codex', 'agent touch', null, null, 'email', 'outbound', now()),
  ('38020000-0000-4000-f100-000000000001', 'touch', 'issue3802d-owner@test.local', 'system', 'system touch', null, null, 'email', 'outbound', now()),
  ('38020000-0000-4000-f100-000000000001', 'touch', 'issue3802d-owner@test.local', 'unknown', 'unknown touch', null, null, 'email', 'outbound', now()),
  ('38020000-0000-4000-f100-000000000001', 'stage_move', 'issue3802d-owner@test.local', null, null, 'prospect', 'contacted', null, null, now()),
  ('38020000-0000-4000-f100-000000000001', 'stage_move', 'issue3802d-owner@test.local', 'claude', null, 'contacted', 'replied', null, null, now()),
  ('38020000-0000-4000-f100-000000000001', 'stage_move', 'issue3802d-owner@test.local', 'unknown', null, 'replied', 'meeting', null, null, now()),
  ('38020000-0000-4000-f100-000000000001', 'created', 'issue3802d-owner@test.local', null, null, null, null, null, null, now()),
  ('38020000-0000-4000-f100-000000000001', 'created', 'issue3802d-owner@test.local', 'claude', null, null, null, null, null, now()),
  ('38020000-0000-4000-f100-000000000001', 'created', 'issue3802d-owner@test.local', 'codex', null, null, null, null, null, now()),
  ('38020000-0000-4000-f100-000000000001', 'created', 'issue3802d-owner@test.local', 'system', null, null, null, null, null, now()),
  ('38020000-0000-4000-f100-000000000001', 'touch', 'issue3802d-former@test.local', 'codex', 'former actor', null, null, 'email', 'outbound', now());

create temp table t3802d_results (label text, ok boolean, detail text) on commit drop;
create function pg_temp.t3802d_call(p_who text, p_today date default null) returns text language plpgsql as $fn$
declare v_id uuid; v_email text; v text;
begin
  if p_who <> 'anon' then select id, email into strict v_id, v_email from t3802d_people where who = p_who; end if;
  begin
    if p_who = 'anon' then
      set local role anon;
      perform set_config('request.jwt.claims', '{"role":"anon"}', true);
      perform set_config('request.jwt.claim.sub', '', true);
    else
      set local role authenticated;
      perform set_config('request.jwt.claim.sub', v_id::text, true);
      perform set_config('request.jwt.claim.email', v_email, true);
      perform set_config('request.jwt.claims', json_build_object('sub', v_id, 'email', v_email, 'role', 'authenticated')::text, true);
    end if;
    select public.crm_team_summary(p_today)::text into v;
    reset role;
    return v;
  exception when others then reset role; return 'ERR:' || sqlstate || ':' || sqlerrm; end;
end $fn$;
create function pg_temp.t3802d_check(p_label text, p_ok boolean, p_detail text default '') returns void language sql as $fn$
  insert into t3802d_results values (p_label, coalesce(p_ok, false), p_detail)
$fn$;

do $proof$
declare owner_answer text; admin_answer text; answer jsonb; owner_row jsonb; former_row jsonb;
begin
  owner_answer := pg_temp.t3802d_call('owner');
  admin_answer := pg_temp.t3802d_call('admin');
  perform pg_temp.t3802d_check('owner succeeds', owner_answer not like 'ERR:%', left(owner_answer, 240));
  perform pg_temp.t3802d_check('admin succeeds', admin_answer not like 'ERR:%', left(admin_answer, 240));
  foreach owner_answer in array array[pg_temp.t3802d_call('growth'), pg_temp.t3802d_call('partner'), pg_temp.t3802d_call('removed'), pg_temp.t3802d_call('anon')] loop
    perform pg_temp.t3802d_check('unauthorised caller is refused', owner_answer like 'ERR:%', owner_answer);
  end loop;

  answer := pg_temp.t3802d_call('owner')::jsonb;
  select value into owner_row from jsonb_array_elements(answer->'by_person') where value->>'email' = 'issue3802d-owner@test.local';
  select value into former_row from jsonb_array_elements(answer->'by_person') where value->>'email' = 'issue3802d-former@test.local';
  perform pg_temp.t3802d_check('top-level shape stays exact',
    (select array_agg(key order by key) from jsonb_object_keys(answer) key) =
    array['beta_leads_new','by_person','due','me','month_start','stages','targets','today','week_start'], answer::text);
  perform pg_temp.t3802d_check('aggregate totals stay unchanged',
    owner_row->>'touches' = '6' and owner_row->>'stage_moves' = '3' and owner_row->>'added' = '4', owner_row::text);
  perform pg_temp.t3802d_check('touch buckets count only approved via values', owner_row->'touches_by' = '{"person":2,"claude":1,"codex":1}'::jsonb, owner_row::text);
  perform pg_temp.t3802d_check('stage buckets count only approved via values', owner_row->'stage_moves_by' = '{"person":1,"claude":1,"codex":0}'::jsonb, owner_row::text);
  perform pg_temp.t3802d_check('added buckets count only approved via values', owner_row->'added_by' = '{"person":1,"claude":1,"codex":1}'::jsonb, owner_row::text);
  perform pg_temp.t3802d_check('a person-marked draft remains person work', (owner_row#>>'{touches_by,person}')::int = 2, owner_row::text);
  perform pg_temp.t3802d_check('approved buckets never exceed totals',
    (select sum(value::int) from jsonb_each_text(owner_row->'touches_by')) <= (owner_row->>'touches')::int and
    (select sum(value::int) from jsonb_each_text(owner_row->'stage_moves_by')) <= (owner_row->>'stage_moves')::int and
    (select sum(value::int) from jsonb_each_text(owner_row->'added_by')) <= (owner_row->>'added')::int, owner_row::text);
  perform pg_temp.t3802d_check('former actors remain after team members in the answer', former_row->>'status' = 'former', coalesce(former_row::text, '<missing>'));
  perform pg_temp.t3802d_check('the answer carries no draft, call, argument, result or key material', answer::text !~* 'person-marked|agent touch|former actor|draft_text|request_args|result_json|key_digest', answer::text);
  perform pg_temp.t3802d_check('far-away requested dates still clamp to UTC today',
    pg_temp.t3802d_call('owner', date '2099-01-01')::jsonb->>'today' = (now() at time zone 'UTC')::date::text);
end $proof$;

select count(*) as total, count(*) filter (where not ok) as failed,
       count(*) filter (where not ok) > 0 as has_failures,
       coalesce(string_agg(label || ': ' || detail, E'\n' order by label) filter (where not ok), 'none') as failures
from t3802d_results \gset
\if :has_failures
  \echo 'ISSUE-3802 PR-D OUTCOME COUNTS FAILED:' :failures
  do $$ begin raise exception 'issue3802_pr_d_outcome_counts_failed'; end $$;
\endif
\echo 'ISSUE-3802 PR-D OUTCOME COUNTS PASS:' :total 'checks'
rollback;
