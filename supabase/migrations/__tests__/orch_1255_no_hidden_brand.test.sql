-- META-ORCH-1255 Leg A — T-A9 + I-PROPOSED-1255-NO-HIDDEN-BRAND-ON-VENUE-CREATE
-- enforcement (SPEC §6, enforcement (a)).
--
--   T-A9   the DECOMMISSIONED biz_create_venue_brand_authoring stub raises
--          'venue_creation_moved:update_app' and writes ZERO rows (brands,
--          venue_listings, brand_hours, pipeline all unchanged).
--   INV-1  pg_get_functiondef(biz_create_venue_listing) contains NO brands-
--          table INSERT (the F-1 hidden-brand path can never silently return).
--   INV-2  biz_create_venue_brand_pending_review no longer exists (dead RPC
--          dropped, investigation D-4 discovery).
--   INV-3  a real biz_create_venue_listing call leaves the brands row count
--          UNCHANGED (behavioral complement of INV-1).
--
-- Run (LOCAL Supabase Postgres only — NEVER remote):
--   docker exec -i <db-container> psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/migrations/__tests__/orch_1255_no_hidden_brand.test.sql
-- ONE transaction, ROLLS BACK — no residue.
--
-- FAILS-ON-REVERT:
--   * Restore the functional 1186-A body of biz_create_venue_brand_authoring →
--     T-A9 fails (no raise; a brands row appears).
--   * Add a brands INSERT back into biz_create_venue_listing → INV-1 + INV-3 fail.
--   * Re-create biz_create_venue_brand_pending_review → INV-2 fails.

\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
  ('a1255aaa-0000-4000-8000-000000000021', 'orch1255nb-owner@test.local')
on conflict (id) do nothing;
insert into public.creator_accounts (id) values
  ('a1255aaa-0000-4000-8000-000000000021')
on conflict (id) do nothing;
insert into public.brands (id, account_id, name, slug) values
  ('b1255aaa-0000-4000-8000-000000000021','a1255aaa-0000-4000-8000-000000000021','Orch1255 NB Brand','orch1255nbbrand')
on conflict (id) do nothing;

-- ── T-A9: the stub fail-softs with the exact moved code; zero rows ───────────
do $$
declare
  v_brands int; v_venues int; v_hours int; v_pipe int;
  v_hours_payload jsonb := '[
    {"weekday":0,"open_time":"09:00","close_time":"17:00","is_closed":false},
    {"weekday":1,"open_time":"09:00","close_time":"17:00","is_closed":false},
    {"weekday":2,"open_time":"09:00","close_time":"17:00","is_closed":false},
    {"weekday":3,"open_time":"09:00","close_time":"17:00","is_closed":false},
    {"weekday":4,"open_time":"09:00","close_time":"17:00","is_closed":false},
    {"weekday":5,"open_time":"09:00","close_time":"17:00","is_closed":false},
    {"weekday":6,"open_time":null,"close_time":null,"is_closed":true}
  ]'::jsonb;
begin
  select count(*) into v_brands from public.brands;
  select count(*) into v_venues from public.venue_listings;
  select count(*) into v_hours  from public.brand_hours;
  select count(*) into v_pipe   from public.brand_place_pipeline_state;

  set local role authenticated;
  perform set_config('request.jwt.claim.sub','a1255aaa-0000-4000-8000-000000000021', true);
  begin
    perform public.biz_create_venue_brand_authoring(
      'Old Binary Venue', 'oldbinary', null, null, 38.9, -77.0,
      'Washington', 'US', 'Old St', 'restaurant', null, null,
      null, null, v_hours_payload, null);
    raise exception 'T-A9 FAIL: decommissioned RPC executed a functional body';
  exception when others then
    if sqlerrm not like '%venue_creation_moved:update_app%' then
      raise exception 'T-A9 FAIL: expected venue_creation_moved:update_app, got %', sqlerrm;
    end if;
  end;
  reset role;

  if (select count(*) from public.brands) <> v_brands
     or (select count(*) from public.venue_listings) <> v_venues
     or (select count(*) from public.brand_hours) <> v_hours
     or (select count(*) from public.brand_place_pipeline_state) <> v_pipe then
    raise exception 'T-A9 FAIL: the stub wrote rows';
  end if;
  raise notice 'T-A9 PASS: stub raises venue_creation_moved:update_app; zero rows written';
end $$;

-- ── INV-1: the create RPC's body carries no brands-table INSERT ──────────────
do $$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.biz_create_venue_listing'::regproc);
  if v_def ~* 'insert\s+into\s+(public\.)?brands\b' then
    raise exception 'INV-1 FAIL: biz_create_venue_listing inserts into brands (hidden-brand path is back)';
  end if;
  raise notice 'INV-1 PASS: biz_create_venue_listing has no brands INSERT';
end $$;

-- ── INV-2: the dead pending_review creator is gone ────────────────────────────
do $$
declare n int;
begin
  select count(*) into n
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public' and p.proname = 'biz_create_venue_brand_pending_review';
  if n <> 0 then
    raise exception 'INV-2 FAIL: biz_create_venue_brand_pending_review still exists (% overloads)', n;
  end if;
  raise notice 'INV-2 PASS: biz_create_venue_brand_pending_review dropped';
end $$;

-- ── INV-3: a REAL create leaves brands count unchanged ───────────────────────
do $$
declare
  v_brands int; v_venue uuid;
  v_hours jsonb := '[
    {"weekday":0,"open_time":"09:00","close_time":"17:00","is_closed":false},
    {"weekday":1,"open_time":"09:00","close_time":"17:00","is_closed":false},
    {"weekday":2,"open_time":"09:00","close_time":"17:00","is_closed":false},
    {"weekday":3,"open_time":"09:00","close_time":"17:00","is_closed":false},
    {"weekday":4,"open_time":"09:00","close_time":"17:00","is_closed":false},
    {"weekday":5,"open_time":"09:00","close_time":"17:00","is_closed":false},
    {"weekday":6,"open_time":null,"close_time":null,"is_closed":true}
  ]'::jsonb;
begin
  select count(*) into v_brands from public.brands;
  set local role authenticated;
  perform set_config('request.jwt.claim.sub','a1255aaa-0000-4000-8000-000000000021', true);
  v_venue := public.biz_create_venue_listing(
    'b1255aaa-0000-4000-8000-000000000021',
    'NB Venue', 'nbvenue', null, null, 38.9, -77.0,
    'Washington', 'US', 'NB St', 'restaurant', null, null,
    null, null, v_hours, null);
  reset role;
  if v_venue is null then raise exception 'INV-3 FAIL: create returned null'; end if;
  if (select count(*) from public.brands) <> v_brands then
    raise exception 'INV-3 FAIL: brands row count changed on venue create';
  end if;
  raise notice 'INV-3 PASS: venue create leaves brands count unchanged';
end $$;

rollback;
