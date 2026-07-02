-- META-ORCH-1255 Leg A — IMPLEMENTOR happy-path + create-path adversarial
-- regression (T-A1 / T-A2 / T-A3 + the client-write denial from SPEC §4.A.2).
--
--   T-A1  (happy)       two biz_create_venue_listing calls for ONE brand →
--                       2 venue_listings rows + 2 pipeline rows with distinct
--                       venue_id + 14 venue-keyed brand_hours rows + 2 derived
--                       availability-config rows; brands row count UNCHANGED
--                       by both calls (SC-1).
--   T-A2  (error)       a caller below brand_owner rank on the target brand
--                       (another brand's owner AND the brand's own
--                       event_manager) → 'forbidden'; zero rows written.
--   T-A3  (edge)        a second venue claiming the SAME place_pool row →
--                       unique_violation on venue_listings_place_uniq (23505).
--   T-A1b (adversarial) direct client writes on venue_listings are impossible:
--                       INSERT as the brand owner → 42501 (no write policy);
--                       UPDATE claim_status='verified' on their own row →
--                       0 rows affected (claim self-promotion impossible).
--   T-A1c (edge)        duplicate slug under the same brand → 23505 on
--                       venue_listings_brand_slug_uniq (SlugCollisionError seam).
--
-- Run (LOCAL Supabase Postgres only — NEVER remote):
--   docker exec -i <db-container> psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/migrations/__tests__/orch_1255_venue_listings.test.sql
-- Whole script runs in ONE transaction and ROLLS BACK — no residue.
--
-- FAILS-ON-REVERT:
--   * Restore UNIQUE (brand_id) on brand_place_pipeline_state (M2 revert) →
--     T-A1 fails (the second create's pipeline insert collides / clobbers).
--   * Re-point biz_create_venue_listing at a brands INSERT (F-1 revert) →
--     T-A1's brands-delta-0 assertion fails.
--   * Drop the rank gate from biz_create_venue_listing → T-A2 fails.
--   * Drop venue_listings_place_uniq → T-A3 fails.
--   * Add a client INSERT/UPDATE policy on venue_listings → T-A1b fails.

\set ON_ERROR_STOP on
begin;

-- ── Fixtures ────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('a1255aaa-0000-4000-8000-000000000001', 'orch1255-ownerx@test.local'),
  ('a1255bbb-0000-4000-8000-000000000002', 'orch1255-ownery@test.local'),
  ('a1255ccc-0000-4000-8000-000000000003', 'orch1255-managerx@test.local')
on conflict (id) do nothing;

insert into public.creator_accounts (id) values
  ('a1255aaa-0000-4000-8000-000000000001'),
  ('a1255bbb-0000-4000-8000-000000000002')
on conflict (id) do nothing;

insert into public.brands (id, account_id, name, slug) values
  ('b1255aaa-0000-4000-8000-000000000001','a1255aaa-0000-4000-8000-000000000001','Orch1255 Brand X','orch1255brandx'),
  ('b1255bbb-0000-4000-8000-000000000002','a1255bbb-0000-4000-8000-000000000002','Orch1255 Brand Y','orch1255brandy')
on conflict (id) do nothing;

insert into public.brand_team_members (brand_id, user_id, role, accepted_at) values
  ('b1255aaa-0000-4000-8000-000000000001','a1255ccc-0000-4000-8000-000000000003','event_manager', now())
on conflict do nothing;

insert into public.place_pool (id, name, lat, lng, google_place_id, is_active) values
  ('e1255aaa-0000-4000-8000-000000000001','Orch1255 Place One', 38.9, -77.0, 'gplace-orch1255-one', true)
on conflict (id) do nothing;

-- Canonical 7-day hours payload (weekday Mon=0..Sun=6, Ve1 convention).
create temp table t1255_hours as
select '[
  {"weekday":0,"open_time":"09:00","close_time":"17:00","is_closed":false},
  {"weekday":1,"open_time":"09:00","close_time":"17:00","is_closed":false},
  {"weekday":2,"open_time":"09:00","close_time":"17:00","is_closed":false},
  {"weekday":3,"open_time":"09:00","close_time":"17:00","is_closed":false},
  {"weekday":4,"open_time":"09:00","close_time":"22:00","is_closed":false},
  {"weekday":5,"open_time":"10:00","close_time":"22:00","is_closed":false},
  {"weekday":6,"open_time":null,"close_time":null,"is_closed":true}
]'::jsonb as hours;

-- ── T-A1: two creates, one brand; brands delta 0 (SC-1) ─────────────────────
do $$
declare
  v_brands_before int;
  v_venue1 uuid;
  v_venue2 uuid;
  v_hours jsonb;
  n int;
begin
  select count(*) into v_brands_before from public.brands;
  select hours into v_hours from t1255_hours;

  set local role authenticated;
  perform set_config('request.jwt.claim.sub','a1255aaa-0000-4000-8000-000000000001', true);

  v_venue1 := public.biz_create_venue_listing(
    'b1255aaa-0000-4000-8000-000000000001',
    'Venue One', 'v1one', 'first venue', 'gplace-orch1255-one',
    38.9, -77.0, 'Washington', 'US', '1 First St',
    'restaurant', 'v1@test.local', '+12025550101',
    null, null, v_hours, 'e1255aaa-0000-4000-8000-000000000001');

  v_venue2 := public.biz_create_venue_listing(
    'b1255aaa-0000-4000-8000-000000000001',
    'Venue Two', 'v1two', 'second venue', null,
    40.7, -74.0, 'New York', 'US', '2 Second Ave',
    'play', null, null,
    null, null, v_hours, null);

  reset role;

  if v_venue1 is null or v_venue2 is null or v_venue1 = v_venue2 then
    raise exception 'T-A1 FAIL: expected two distinct venue ids (got %, %)', v_venue1, v_venue2;
  end if;

  select count(*) into n from public.venue_listings
   where brand_id = 'b1255aaa-0000-4000-8000-000000000001';
  if n <> 2 then raise exception 'T-A1 FAIL: expected 2 venue rows, got %', n; end if;

  select count(*) into n from public.venue_listings
   where brand_id = 'b1255aaa-0000-4000-8000-000000000001' and claim_status = 'pending_review';
  if n <> 2 then raise exception 'T-A1 FAIL: both venues must be pending_review, got %', n; end if;

  select count(distinct venue_id) into n from public.brand_place_pipeline_state
   where brand_id = 'b1255aaa-0000-4000-8000-000000000001';
  if n <> 2 then raise exception 'T-A1 FAIL: expected 2 pipeline rows w/ distinct venue_id, got %', n; end if;

  select count(*) into n from public.brand_hours
   where venue_id in (v_venue1, v_venue2);
  if n <> 14 then raise exception 'T-A1 FAIL: expected 14 venue-keyed hours rows, got %', n; end if;

  -- ORCH-1186-A bridge, venue-keyed: a derived availability config per venue.
  select count(*) into n from public.venue_availability_config
   where venue_id in (v_venue1, v_venue2)
     and service_periods @> '[{"type":"derived_from_hours"}]'::jsonb;
  if n <> 2 then raise exception 'T-A1 FAIL: expected 2 derived availability configs, got %', n; end if;

  select count(*) - v_brands_before into n from public.brands;
  if n <> 0 then raise exception 'T-A1 FAIL: brands row count changed by % (hidden brand back?)', n; end if;

  raise notice 'T-A1 PASS: 2 venues, 2 pipeline rows, 14 hours rows, 2 derived configs, brands delta 0';
end $$;

-- ── T-A2: below-owner-rank callers get forbidden; nothing written ────────────
do $$
declare
  v_before int;
  v_hours jsonb;
begin
  select count(*) into v_before from public.venue_listings;
  select hours into v_hours from t1255_hours;

  -- (a) another brand's owner
  set local role authenticated;
  perform set_config('request.jwt.claim.sub','a1255bbb-0000-4000-8000-000000000002', true);
  begin
    perform public.biz_create_venue_listing(
      'b1255aaa-0000-4000-8000-000000000001',
      'Evil Venue', 'evilv', null, null, 1, 1, null, null, null,
      'restaurant', null, null, null, null, v_hours, null);
    raise exception 'T-A2 FAIL: cross-brand owner was allowed to create';
  exception when others then
    if sqlerrm not like '%forbidden%' then
      raise exception 'T-A2 FAIL: expected forbidden, got %', sqlerrm;
    end if;
  end;

  -- (b) the brand's own event_manager (rank 40 < brand_owner 60)
  perform set_config('request.jwt.claim.sub','a1255ccc-0000-4000-8000-000000000003', true);
  begin
    perform public.biz_create_venue_listing(
      'b1255aaa-0000-4000-8000-000000000001',
      'Manager Venue', 'mgrvenue', null, null, 1, 1, null, null, null,
      'restaurant', null, null, null, null, v_hours, null);
    raise exception 'T-A2 FAIL: event_manager was allowed to create';
  exception when others then
    if sqlerrm not like '%forbidden%' then
      raise exception 'T-A2 FAIL: expected forbidden for manager, got %', sqlerrm;
    end if;
  end;
  reset role;

  if (select count(*) from public.venue_listings) <> v_before then
    raise exception 'T-A2 FAIL: forbidden call still wrote venue rows';
  end if;
  raise notice 'T-A2 PASS: below-owner-rank creates rejected with forbidden; zero rows';
end $$;

-- ── T-A3: duplicate place claim blocked globally (venue_listings_place_uniq) ─
do $$
declare
  v_hours jsonb;
begin
  select hours into v_hours from t1255_hours;
  set local role authenticated;
  perform set_config('request.jwt.claim.sub','a1255bbb-0000-4000-8000-000000000002', true);
  begin
    perform public.biz_create_venue_listing(
      'b1255bbb-0000-4000-8000-000000000002',
      'Copycat', 'copycat', null, 'gplace-orch1255-one',
      38.9, -77.0, null, null, null,
      'restaurant', null, null, null, null, v_hours,
      'e1255aaa-0000-4000-8000-000000000001');
    raise exception 'T-A3 FAIL: second claim of the same place was allowed';
  exception when unique_violation then
    raise notice 'T-A3 PASS: duplicate place claim → unique_violation (venue_listings_place_uniq)';
  end;
  reset role;
end $$;

-- ── T-A1b: NO client write path on venue_listings ────────────────────────────
do $$
declare
  v_venue uuid;
  n int;
begin
  select id into v_venue from public.venue_listings
   where brand_id = 'b1255aaa-0000-4000-8000-000000000001' and slug = 'v1one';

  set local role authenticated;
  perform set_config('request.jwt.claim.sub','a1255aaa-0000-4000-8000-000000000001', true);

  begin
    insert into public.venue_listings (brand_id, slug, name, lat, lng, venue_category)
    values ('b1255aaa-0000-4000-8000-000000000001','sneak','Sneak', 1, 1, 'restaurant');
    raise exception 'T-A1b FAIL: direct client INSERT on venue_listings succeeded';
  exception when insufficient_privilege then
    null; -- expected: no INSERT grant/policy for authenticated
  end;

  -- Claim self-promotion: UPDATE must match 0 rows (no UPDATE policy/grant).
  begin
    update public.venue_listings set claim_status = 'verified' where id = v_venue;
    -- if the grant is missing this raises 42501; if a policy is missing it
    -- affects 0 rows — both are a pass as long as the row is unchanged.
  exception when insufficient_privilege then
    null;
  end;
  reset role;

  select count(*) into n from public.venue_listings
   where id = v_venue and claim_status = 'verified';
  if n <> 0 then
    raise exception 'T-A1b FAIL: owner flipped their own claim_status to verified';
  end if;
  raise notice 'T-A1b PASS: no client INSERT; claim self-promotion impossible';
end $$;

-- ── T-A1c: duplicate slug under the same brand → 23505 ──────────────────────
do $$
declare
  v_hours jsonb;
begin
  select hours into v_hours from t1255_hours;
  set local role authenticated;
  perform set_config('request.jwt.claim.sub','a1255aaa-0000-4000-8000-000000000001', true);
  begin
    perform public.biz_create_venue_listing(
      'b1255aaa-0000-4000-8000-000000000001',
      'Venue One Again', 'v1one', null, null, 1, 1, null, null, null,
      'restaurant', null, null, null, null, v_hours, null);
    raise exception 'T-A1c FAIL: duplicate slug under the same brand was allowed';
  exception when unique_violation then
    raise notice 'T-A1c PASS: duplicate (brand_id, slug) → unique_violation';
  end;
  reset role;
end $$;

rollback;
