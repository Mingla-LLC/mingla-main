-- Issue #4276 wave 1, S3, S4 and U4. Implementor happy path on the fully replayed
-- PG17 schema, for 20280410014276_issue_4276_place_merge_and_review_state.sql.
--
-- MINGLA-INVARIANT: I-4276-ADMIN-EDIT-MARKED | issue #4276 | admin_edit_place stamps place_pool_admin_edits only when a value actually changes; seed and refresh do not write marked fields
--
--   R-MARK     a changed name or tier set stamps its marker
--   R-NOEDIT   saving the form unchanged stamps nothing, including the shape where
--              the form shows price_tier because price_tiers is empty
--   R-KEEP     a marker survives later edits, and stays de-duplicated
--   R-STATUS   'paused' is a run status, and a paused run doesn't hold the city
--   R-CATEGORY the computed column equals the canonical helper
--   R-RLS      an ordinary signed-in user cannot read the review fetch state
--
-- FAILS-ON-REVERT: without the migration, the column, table and function don't
-- exist and every check fails. Removing the place_pool_admin_edits insert from
-- admin_edit_place fails R-MARK.
--
-- Run from the repository root as supabase_admin. Everything is rolled back.

\set ON_ERROR_STOP on
begin;

insert into public.admin_users (email, status)
values ('admin.w4276@test.local', 'active')
on conflict (email) do update set status = 'active';

insert into public.seeding_cities (id, google_place_id, name, country, country_code, center_lat, center_lng, bbox_sw_lat, bbox_sw_lng, bbox_ne_lat, bbox_ne_lng, status)
values ('42761000-0000-4000-a000-000000000001', 'gp-city-42761', 'Test City 42761', 'Testland', 'TL', 1, 1, 0, 0, 2, 2, 'draft');

insert into public.place_pool (id, google_place_id, name, lat, lng, types, primary_type, is_active, is_servable, city_id, price_tier, price_tiers, fetched_via)
values
  ('42761000-0000-4000-b000-000000000001', 'gp-42761-a', 'Original', 1, 1, array['cafe'], 'cafe', true, true, '42761000-0000-4000-a000-000000000001', 'chill', array['chill'], 'nearby_search'),
  ('42761000-0000-4000-b000-000000000002', 'gp-42761-b', 'Tier fallback', 1, 1, array['hospital','park'], 'hospital', true, true, '42761000-0000-4000-a000-000000000001', 'comfy', array[]::text[], 'nearby_search');

select set_config('request.jwt.claims', '{"email":"admin.w4276@test.local"}', true);

do $$
declare
  a constant uuid := '42761000-0000-4000-b000-000000000001';
  b constant uuid := '42761000-0000-4000-b000-000000000002';
begin
  -- R-NOEDIT: the form sends every field back.
  perform public.admin_edit_place(a, 'Original', 'chill', true, array['chill']);
  if exists (select 1 from public.place_pool_admin_edits where google_place_id = 'gp-42761-a') then
    raise exception 'R-NOEDIT: an unchanged save stamped a marker';
  end if;
  perform public.admin_edit_place(b, 'Tier fallback', 'comfy', true, array['comfy']);
  if exists (select 1 from public.place_pool_admin_edits where google_place_id = 'gp-42761-b') then
    raise exception 'R-NOEDIT: the price_tier fallback shape stamped a marker';
  end if;

  -- R-MARK.
  perform public.admin_edit_place(a, 'Edited', 'chill', true, array['chill']);
  if (select edited_fields from public.place_pool_admin_edits where google_place_id = 'gp-42761-a') <> array['name'] then
    raise exception 'R-MARK: a name edit was not marked';
  end if;
  perform public.admin_edit_place(a, 'Edited', 'bougie', true, array['bougie', 'lavish']);
  if (select edited_fields from public.place_pool_admin_edits where google_place_id = 'gp-42761-a') <> array['name', 'price_tiers'] then
    raise exception 'R-MARK: a tier edit was not marked';
  end if;
  if (select price_tiers from public.place_pool where id = a) <> array['bougie', 'lavish'] then
    raise exception 'R-MARK: the edit itself did not save';
  end if;

  -- R-KEEP.
  perform public.admin_edit_place(a, 'Edited again', 'bougie', true, array['bougie', 'lavish']);
  if (select edited_fields from public.place_pool_admin_edits where google_place_id = 'gp-42761-a') <> array['name', 'price_tiers'] then
    raise exception 'R-KEEP: the marker changed or duplicated';
  end if;
end $$;

-- R-STATUS.
do $$
declare v_first uuid; v_second uuid;
begin
  insert into public.place_intelligence_runs (city_id, city_name, mode, total_count, estimated_cost_usd, estimated_minutes, prompt_version, model, status)
  values ('42761000-0000-4000-a000-000000000001', 'c', 'full_city', 1, 0.01, 1, 'v4', 'm', 'paused') returning id into v_first;
  insert into public.place_intelligence_runs (city_id, city_name, mode, total_count, estimated_cost_usd, estimated_minutes, prompt_version, model, status)
  values ('42761000-0000-4000-a000-000000000001', 'c', 'full_city', 1, 0.01, 1, 'v4', 'm', 'running') returning id into v_second;
  begin
    update public.place_intelligence_runs set status = 'running' where id = v_first;
    raise exception 'R-STATUS: two running runs in one city';
  exception when unique_violation then null;
  end;
end $$;

-- R-CATEGORY: primary type, then the fallback over types, then none.
do $$
declare v_row public.place_pool;
begin
  select * into v_row from public.place_pool where id = '42761000-0000-4000-b000-000000000001';
  if public.place_pool_derived_category(v_row) <> 'icebreakers' then
    raise exception 'R-CATEGORY: cafe should be icebreakers';
  end if;
  select * into v_row from public.place_pool where id = '42761000-0000-4000-b000-000000000002';
  if public.place_pool_derived_category(v_row) <> 'nature' then
    raise exception 'R-CATEGORY: the fallback over types should give nature';
  end if;
end $$;

-- R-RLS.
insert into public.place_review_fetch_state (place_id, outcome)
values ('42761000-0000-4000-b000-000000000001', 'none_on_google');
select set_config('request.jwt.claims', '{"sub":"42761000-0000-4000-c000-000000000009","email":"someone@test.local","role":"authenticated"}', true);
set local role authenticated;
do $$
begin
  if exists (select 1 from public.place_review_fetch_state) then
    raise exception 'R-RLS: a non-admin read the review fetch state';
  end if;
end $$;
reset role;

rollback;
\echo 'issue 4276 place merge and review state: all checks passed'
