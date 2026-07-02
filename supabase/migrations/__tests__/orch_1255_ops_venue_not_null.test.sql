-- META-ORCH-1255 Leg A — I-PROPOSED-1255-PER-VENUE-OPS-NO-SHARED-INVENTORY
-- enforcement (SPEC §6, enforcement (a)) + T-A4 + T-A6.
--
--   STRUCT-1  every ops table carries venue_id NOT NULL:
--             brand_place_pipeline_state, venue_claim_feedback,
--             venue_reservation_settings, venue_tables, venue_capacity_rules,
--             venue_availability_config, venue_blackouts, venue_waitlist,
--             reservations. (brand_hours stays NULLABLE by design — legacy
--             brand-keyed rows; reservation_checkout_sessions NULLABLE carrier.)
--   STRUCT-2  the pipeline UNIQUE is (venue_id); UNIQUE (brand_id) — THE F-2
--             lock / R-1 clobber — is GONE.
--   T-A4      cross-brand splice: a brand-X manager (passes X's RLS WITH
--             CHECK) INSERTing a venue_tables row that points at brand-Y's
--             venue → 'venue_brand_mismatch' (the M1 trigger).
--   T-A6      RETURNING-OWNER-GAP probe: an event_manager INSERT…RETURNING on
--             each client-writable ops table RETURNS the row (writer rank
--             implies the member-read predicate — no RLS RETURNING gap).
--
-- Run (LOCAL Supabase Postgres only — NEVER remote):
--   docker exec -i <db-container> psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/migrations/__tests__/orch_1255_ops_venue_not_null.test.sql
-- ONE transaction, ROLLS BACK — no residue.
--
-- FAILS-ON-REVERT:
--   * Restore UNIQUE (brand_id) on the pipeline (M2 revert) → STRUCT-2 fails.
--   * Drop the M1 brand-match trigger from any ops table → T-A4 fails (the
--     splice INSERT succeeds).
--   * Make any ops venue_id nullable again → STRUCT-1 fails.

\set ON_ERROR_STOP on
begin;

-- ── STRUCT-1: NOT NULL assertions ────────────────────────────────────────────
do $$
declare
  t text;
  v_nullable text;
begin
  foreach t in array array[
    'brand_place_pipeline_state','venue_claim_feedback',
    'venue_reservation_settings','venue_tables','venue_capacity_rules',
    'venue_availability_config','venue_blackouts','venue_waitlist','reservations'
  ] loop
    select is_nullable into v_nullable
    from information_schema.columns
    where table_schema = 'public' and table_name = t and column_name = 'venue_id';
    if v_nullable is null then
      raise exception 'STRUCT-1 FAIL: %.venue_id column missing', t;
    end if;
    if v_nullable <> 'NO' then
      raise exception 'STRUCT-1 FAIL: %.venue_id is nullable (shared inventory possible)', t;
    end if;
  end loop;
  raise notice 'STRUCT-1 PASS: venue_id NOT NULL on all 9 ops tables';
end $$;

-- ── STRUCT-2: pipeline unique moved brand → venue ────────────────────────────
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'brand_place_pipeline_state_brand_unique') then
    raise exception 'STRUCT-2 FAIL: UNIQUE (brand_id) is back — R-1 venue clobber re-opened';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'brand_place_pipeline_state_venue_unique') then
    raise exception 'STRUCT-2 FAIL: UNIQUE (venue_id) missing on the pipeline';
  end if;
  raise notice 'STRUCT-2 PASS: pipeline unique is per-venue; brand lock gone';
end $$;

-- ── Fixtures for T-A4 / T-A6 ─────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('a1255aaa-0000-4000-8000-000000000031', 'orch1255ops-ownerx@test.local'),
  ('a1255bbb-0000-4000-8000-000000000032', 'orch1255ops-ownery@test.local'),
  ('a1255ccc-0000-4000-8000-000000000033', 'orch1255ops-managerx@test.local')
on conflict (id) do nothing;
insert into public.creator_accounts (id) values
  ('a1255aaa-0000-4000-8000-000000000031'),
  ('a1255bbb-0000-4000-8000-000000000032')
on conflict (id) do nothing;
insert into public.brands (id, account_id, name, slug) values
  ('b1255aaa-0000-4000-8000-000000000031','a1255aaa-0000-4000-8000-000000000031','Orch1255 Ops X','orch1255opsx'),
  ('b1255bbb-0000-4000-8000-000000000032','a1255bbb-0000-4000-8000-000000000032','Orch1255 Ops Y','orch1255opsy')
on conflict (id) do nothing;
insert into public.brand_team_members (brand_id, user_id, role, accepted_at) values
  ('b1255aaa-0000-4000-8000-000000000031','a1255ccc-0000-4000-8000-000000000033','event_manager', now())
on conflict do nothing;

-- Venue rows written directly as postgres (service-role path) — the create RPC
-- is exercised in orch_1255_venue_listings.test.sql.
insert into public.venue_listings (id, brand_id, slug, name, lat, lng, venue_category, claim_status) values
  ('f1255aaa-0000-4000-8000-000000000031','b1255aaa-0000-4000-8000-000000000031','opsvx','Ops Venue X', 38.9, -77.0, 'restaurant','pending_review'),
  ('f1255bbb-0000-4000-8000-000000000032','b1255bbb-0000-4000-8000-000000000032','opsvy','Ops Venue Y', 40.7, -74.0, 'restaurant','pending_review');

-- ── T-A4: cross-brand splice → venue_brand_mismatch ──────────────────────────
do $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub','a1255ccc-0000-4000-8000-000000000033', true);
  begin
    insert into public.venue_tables (brand_id, venue_id, name, capacity)
    values ('b1255aaa-0000-4000-8000-000000000031',   -- own brand (RLS passes)
            'f1255bbb-0000-4000-8000-000000000032',   -- brand Y's venue (splice!)
            'Spliced Table', 4);
    raise exception 'T-A4 FAIL: cross-brand venue splice INSERT succeeded';
  exception when others then
    if sqlerrm not like '%venue_brand_mismatch%' then
      raise exception 'T-A4 FAIL: expected venue_brand_mismatch, got %', sqlerrm;
    end if;
  end;
  reset role;
  raise notice 'T-A4 PASS: cross-brand splice → venue_brand_mismatch';
end $$;

-- ── T-A6: INSERT…RETURNING returns the row on every client-writable ops table ─
do $$
declare
  v_id uuid;
  v_table uuid;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub','a1255ccc-0000-4000-8000-000000000033', true);

  insert into public.venue_tables (brand_id, venue_id, name, capacity)
  values ('b1255aaa-0000-4000-8000-000000000031','f1255aaa-0000-4000-8000-000000000031','T1', 4)
  returning id into v_table;
  if v_table is null then raise exception 'T-A6 FAIL: venue_tables RETURNING gap'; end if;

  insert into public.venue_reservation_settings (brand_id, venue_id, reservations_enabled)
  values ('b1255aaa-0000-4000-8000-000000000031','f1255aaa-0000-4000-8000-000000000031', true)
  returning venue_id into v_id;
  if v_id is null then raise exception 'T-A6 FAIL: venue_reservation_settings RETURNING gap'; end if;

  insert into public.venue_capacity_rules (brand_id, venue_id, kind, params)
  values ('b1255aaa-0000-4000-8000-000000000031','f1255aaa-0000-4000-8000-000000000031','party_fit','{}'::jsonb)
  returning id into v_id;
  if v_id is null then raise exception 'T-A6 FAIL: venue_capacity_rules RETURNING gap'; end if;

  insert into public.venue_availability_config (brand_id, venue_id)
  values ('b1255aaa-0000-4000-8000-000000000031','f1255aaa-0000-4000-8000-000000000031')
  returning id into v_id;
  if v_id is null then raise exception 'T-A6 FAIL: venue_availability_config RETURNING gap'; end if;

  insert into public.venue_blackouts (brand_id, venue_id, date_start, date_end)
  values ('b1255aaa-0000-4000-8000-000000000031','f1255aaa-0000-4000-8000-000000000031', current_date, current_date)
  returning id into v_id;
  if v_id is null then raise exception 'T-A6 FAIL: venue_blackouts RETURNING gap'; end if;

  insert into public.venue_waitlist (brand_id, venue_id, party_size, guest_name)
  values ('b1255aaa-0000-4000-8000-000000000031','f1255aaa-0000-4000-8000-000000000031', 2, 'Walk In')
  returning id into v_id;
  if v_id is null then raise exception 'T-A6 FAIL: venue_waitlist RETURNING gap'; end if;

  insert into public.reservations (brand_id, venue_id, table_id, reserved_for, party_size)
  values ('b1255aaa-0000-4000-8000-000000000031','f1255aaa-0000-4000-8000-000000000031', v_table, now() + interval '2 days', 2)
  returning id into v_id;
  if v_id is null then raise exception 'T-A6 FAIL: reservations RETURNING gap'; end if;

  reset role;
  raise notice 'T-A6 PASS: event_manager INSERT…RETURNING returns the row on all 7 client-writable ops tables';
end $$;

rollback;
