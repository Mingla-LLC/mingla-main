-- Issue #4276 (design pass): implementor proof for
-- 20280419024276_issue_4276_admin_spend_totals.sql.
--
-- MINGLA-INVARIANT: I-4276-SPEND-TOTALS-ADMIN-ONLY | issue #4276 | Recorded spend across every city is read by an admin-only server function, and Serper's dollars stay unknown until a rate is set
--
--   T-ADMIN    an active admin (is_admin_user) gets the totals
--   T-REFUSE   a signed-in user who is not an admin, and an anonymous caller, are
--              refused with 42501
--   T-SERPER   with no Serper rate its dollars are null and not in the known total;
--              with a rate they are requests x rate and are counted
--   T-SUMS     seeding, photos and Gemini read their own runs' recorded cost
--
-- FAILS-ON-REVERT: without the migration the function does not exist; drop the
-- is_admin_user() check and T-REFUSE fails; count Serper at $0 with no rate and
-- T-SERPER fails.
--
-- Run from the repository root as supabase_admin. Everything is rolled back.

\set ON_ERROR_STOP on
begin;

insert into public.admin_users (email, status)
values ('admin.spend4276@test.local', 'active')
on conflict (email) do update set status = 'active';

insert into auth.users (id, email, aud, role)
values ('a4276500-0000-4000-c000-000000000001', 'admin.spend4276@test.local', 'authenticated', 'authenticated'),
       ('a4276500-0000-4000-c000-000000000002', 'nobody.spend4276@test.local', 'authenticated', 'authenticated');

-- Known spend from the tables the function reads, measured before and after a known
-- addition, so rows already in the database do not matter.
create temp table spend_before as
select (select coalesce(sum(total_cost_usd), 0)::numeric from public.seeding_runs) as seeding,
       (select coalesce(sum(actual_cost_usd), 0)::numeric from public.photo_backfill_runs) as photos,
       (select coalesce(sum(cost_so_far_usd), 0)::numeric from public.place_intelligence_runs) as gemini,
       (select coalesce(sum(serper_requests), 0) from public.place_intelligence_runs) as serper;
grant select on spend_before to authenticated;

update public.city_pipeline_settings set serper_usd_per_request = null;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a4276500-0000-4000-c000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"a4276500-0000-4000-c000-000000000001","role":"authenticated"}', true);

do $$
declare
  v jsonb := public.admin_place_pipeline_spend_totals();
  b record;
begin
  select * into b from spend_before;
  if (v ->> 'seeding_usd')::numeric <> round(b.seeding, 2) or (v ->> 'photos_usd')::numeric <> round(b.photos, 2)
     or (v ->> 'gemini_usd')::numeric <> round(b.gemini, 2) or (v ->> 'serper_requests')::bigint <> b.serper then
    raise exception 'T-SUMS: % against %', v, row_to_json(b);
  end if;
  if v -> 'serper_usd' <> 'null'::jsonb or v -> 'serper_usd_per_request' <> 'null'::jsonb then
    raise exception 'T-SERPER: no rate should leave Serper unpriced: %', v;
  end if;
  if (v ->> 'known_usd')::numeric <> round(b.seeding + b.photos + b.gemini, 2) then
    raise exception 'T-SERPER: unpriced Serper must not reach the known total: %', v;
  end if;
end $$;

reset role;
update public.city_pipeline_settings set serper_usd_per_request = 0.001;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a4276500-0000-4000-c000-000000000001', true);

do $$
declare
  v jsonb := public.admin_place_pipeline_spend_totals();
  b record;
begin
  select * into b from spend_before;
  if (v ->> 'serper_usd')::numeric <> round(b.serper * 0.001, 2) then
    raise exception 'T-SERPER: priced Serper wrong: %', v;
  end if;
  if (v ->> 'known_usd')::numeric <> round(b.seeding + b.photos + b.gemini + b.serper * 0.001, 2) then
    raise exception 'T-SERPER: priced Serper missing from the known total: %', v;
  end if;
end $$;

-- T-REFUSE: a signed-in user who is not an admin.
select set_config('request.jwt.claim.sub', 'a4276500-0000-4000-c000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"a4276500-0000-4000-c000-000000000002","role":"authenticated"}', true);
do $$
begin
  perform public.admin_place_pipeline_spend_totals();
  raise exception 'T-REFUSE: a non-admin read the spend';
exception when insufficient_privilege then
  null;
end $$;

-- T-REFUSE: anonymous callers cannot even call it.
reset role;
set local role anon;
do $$
begin
  perform public.admin_place_pipeline_spend_totals();
  raise exception 'T-REFUSE: anon read the spend';
exception when insufficient_privilege then
  null;
end $$;

reset role;
select 'issue_4276_admin_spend_totals: all checks passed' as result;
rollback;
