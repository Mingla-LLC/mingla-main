-- META-ORCH-1255(C) — IMPLEMENTOR happy-path regression for the M6 discovery
-- re-keys (D-A / D-B / D-D / D-F). One transaction, rolls back, no residue.
--
--   M6-1 (D-B happy)   brand with TWO venues holding DIVERGENT
--                      venue_reservation_settings overrides:
--                        • resolve_brand_pricing_inputs(p_brand_id) → exactly
--                          ONE row, overrides = brand defaults (no arbitrary
--                          multi-row winner);
--                        • (p_brand_id, p_venue_id => A) → venue A's override;
--                        • (p_brand_id, p_venue_id => B) → venue B's override.
--   M6-2 (D-A happy)   admin_tweak_venue_claim_fields(p_venue_id,…) on a
--                      pending venue updates venue_listings.address AND its
--                      place_pool.address; brands.address untouched.
--   M6-2b (D-A guard)  same tweak on a VERIFIED venue → venue_not_pending_review.
--   M6-3 (D-A happy)   admin_apply_score_override(p_venue_id,…) writes
--                      place_scores for the VENUE's place while
--                      brands.place_pool_id IS NULL (the legacy pointer is
--                      inert — pre-M6 this raised no_linked_place).
--   M6-4 (D-D happy)   venue_intelligence_overview(p_brand_id, p_venue_id)
--                      returns the VENUE place's signal_scores while
--                      brands.place_pool_id IS NULL.
--   M6-5 (D-F happy)   anon sees public_menus_view rows for a brand whose
--                      VENUE is verified; flipping the venue to pending_review
--                      hides them (brands.claim_status stays 'none' throughout
--                      — the brand column is legacy-inert).
--
-- Run (LOCAL Supabase Postgres only — NEVER remote):
--   docker exec -i <db-container> psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/migrations/__tests__/orch_1255_leg_c_rekeys.test.sql
--
-- FAILS-ON-REVERT:
--   * Restore the pre-M6 resolve_brand_pricing_inputs (settings joined by
--     brand_id) → M6-1 fails (two rows returned / wrong override).
--   * Restore the brand-keyed admin_tweak_venue_claim_fields /
--     admin_apply_score_override → M6-2 fails (function signature gone) and
--     M6-3 raises no_linked_place.
--   * Restore the brand-pointer venue_intelligence_overview → M6-4 returns
--     [] signal scores.
--   * Restore the brands.claim_status gate on public_menus_view → M6-5 fails
--     (0 rows for the verified-venue brand).

\set ON_ERROR_STOP on
begin;

-- ── Fixtures ────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('a1255ccc-1000-4000-8000-000000000001', 'orch1255c-owner@test.local'),
  ('a1255ccc-1000-4000-8000-000000000002', 'orch1255c-admin@test.local')
on conflict (id) do nothing;

insert into public.creator_accounts (id) values
  ('a1255ccc-1000-4000-8000-000000000001')
on conflict (id) do nothing;

insert into public.admin_users (email, role, status) values
  ('orch1255c-admin@test.local', 'admin', 'active')
on conflict do nothing;

-- Brand: NO place_pool_id (the legacy pointer is inert for new venues),
-- claim_status stays 'none' forever post-1255.
insert into public.brands
  (id, account_id, name, slug, default_pass_tax, default_pass_mingla_fee, default_pass_service_fee, default_currency)
values
  ('b1255ccc-1000-4000-8000-000000000001','a1255ccc-1000-4000-8000-000000000001',
   'Orch1255C Brand','orch1255cbrand', false, false, false, 'USD')
on conflict (id) do nothing;

insert into public.place_pool (id, name, lat, lng, is_active, ai_signal_scores) values
  ('e1255ccc-1000-4000-8000-000000000001','Orch1255C Place A', 38.9, -77.0, true,
   '{"date_night":{"score_0_to_100":88,"inappropriate_for":false}}'::jsonb),
  ('e1255ccc-1000-4000-8000-000000000002','Orch1255C Place B', 38.8, -77.1, true, '{}'::jsonb)
on conflict (id) do nothing;

insert into public.venue_listings
  (id, brand_id, place_pool_id, slug, name, address, lat, lng, venue_category, claim_status)
values
  ('c1255ccc-1000-4000-8000-000000000001','b1255ccc-1000-4000-8000-000000000001',
   'e1255ccc-1000-4000-8000-000000000001','venuea','Venue A','1 Old St', 38.9, -77.0,
   'restaurant','pending_review'),
  ('c1255ccc-1000-4000-8000-000000000003','b1255ccc-1000-4000-8000-000000000001',
   'e1255ccc-1000-4000-8000-000000000002','venueb','Venue B','2 New Ave', 38.8, -77.1,
   'restaurant','pending_review')
on conflict (id) do nothing;

-- Divergent per-venue reservation settings (D-B fixture).
insert into public.venue_reservation_settings
  (brand_id, venue_id, reservations_enabled, pass_tax_override, pass_fee_override)
values
  ('b1255ccc-1000-4000-8000-000000000001','c1255ccc-1000-4000-8000-000000000001', true,  true,  true),
  ('b1255ccc-1000-4000-8000-000000000001','c1255ccc-1000-4000-8000-000000000003', true,  false, false)
on conflict (venue_id) do nothing;

-- Signal fixture (D-A score override target).
insert into public.signal_definitions (id, label, kind, is_active) values
  ('orch1255c_signal', 'Orch1255C Signal', 'quality-grounded', true)
on conflict (id) do nothing;

-- Menu fixture (D-F).
insert into public.menus (id, brand_id, name, is_active) values
  ('d1255ccc-1000-4000-8000-000000000001','b1255ccc-1000-4000-8000-000000000001','Dinner', true)
on conflict (id) do nothing;
insert into public.menu_items (id, menu_id, brand_id, name, price_cents, currency, is_available) values
  ('d1255ccc-1000-4000-8000-000000000002','d1255ccc-1000-4000-8000-000000000001',
   'b1255ccc-1000-4000-8000-000000000001','Tagliatelle', 1850, 'USD', true)
on conflict (id) do nothing;

-- ── M6-1 (D-B): deterministic venue-scoped pricing resolution ───────────────
do $$
declare
  v_rows int;
  v_pass_tax boolean;
begin
  -- No venue given + TWO settings rows → exactly one row, brand defaults win.
  select count(*) into v_rows
    from public.resolve_brand_pricing_inputs('b1255ccc-1000-4000-8000-000000000001');
  if v_rows <> 1 then
    raise exception 'M6-1 FAIL: expected exactly 1 resolver row without p_venue_id, got %', v_rows;
  end if;
  select pass_tax into v_pass_tax
    from public.resolve_brand_pricing_inputs('b1255ccc-1000-4000-8000-000000000001');
  if v_pass_tax is distinct from false then
    raise exception 'M6-1 FAIL: multi-venue brand without p_venue_id must fall back to brand default pass_tax=false, got %', v_pass_tax;
  end if;

  -- Venue A explicit → its TRUE override.
  select pass_tax into v_pass_tax
    from public.resolve_brand_pricing_inputs(
      'b1255ccc-1000-4000-8000-000000000001',
      'c1255ccc-1000-4000-8000-000000000001');
  if v_pass_tax is distinct from true then
    raise exception 'M6-1 FAIL: venue A pass_tax override expected true, got %', v_pass_tax;
  end if;

  -- Venue B explicit → its FALSE override.
  select pass_tax into v_pass_tax
    from public.resolve_brand_pricing_inputs(
      'b1255ccc-1000-4000-8000-000000000001',
      'c1255ccc-1000-4000-8000-000000000003');
  if v_pass_tax is distinct from false then
    raise exception 'M6-1 FAIL: venue B pass_tax override expected false, got %', v_pass_tax;
  end if;

  raise notice 'M6-1 PASS: resolve_brand_pricing_inputs is deterministic and venue-scoped';
end $$;

-- ── M6-2 (D-A): venue-keyed field tweak ─────────────────────────────────────
do $$
declare
  v_res jsonb;
  v_addr text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub','a1255ccc-1000-4000-8000-000000000002', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub','a1255ccc-1000-4000-8000-000000000002',
                      'email','orch1255c-admin@test.local')::text, true);

  v_res := public.admin_tweak_venue_claim_fields(
    'c1255ccc-1000-4000-8000-000000000001',
    '{"address":"99 Fixed Row"}'::jsonb);
  if coalesce(v_res->>'ok','false') <> 'true' then
    raise exception 'M6-2 FAIL: tweak did not return ok, got %', v_res;
  end if;

  reset role;
  select address into v_addr from public.venue_listings
   where id = 'c1255ccc-1000-4000-8000-000000000001';
  if v_addr <> '99 Fixed Row' then
    raise exception 'M6-2 FAIL: venue_listings.address not updated, got %', v_addr;
  end if;
  select address into v_addr from public.place_pool
   where id = 'e1255ccc-1000-4000-8000-000000000001';
  if v_addr <> '99 Fixed Row' then
    raise exception 'M6-2 FAIL: place_pool.address not updated, got %', v_addr;
  end if;
  select address into v_addr from public.brands
   where id = 'b1255ccc-1000-4000-8000-000000000001';
  if v_addr is not null then
    raise exception 'M6-2 FAIL: brands.address must stay untouched, got %', v_addr;
  end if;
  raise notice 'M6-2 PASS: tweak writes the venue row + its place, never the brand';
end $$;

-- ── M6-2b (D-A guard): tweak on a verified venue hard-rejects ───────────────
do $$
begin
  update public.venue_listings set claim_status = 'verified'
   where id = 'c1255ccc-1000-4000-8000-000000000003';

  set local role authenticated;
  perform set_config('request.jwt.claim.sub','a1255ccc-1000-4000-8000-000000000002', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub','a1255ccc-1000-4000-8000-000000000002',
                      'email','orch1255c-admin@test.local')::text, true);
  begin
    perform public.admin_tweak_venue_claim_fields(
      'c1255ccc-1000-4000-8000-000000000003',
      '{"address":"nope"}'::jsonb);
    raise exception 'M6-2b FAIL: tweak on a verified venue must raise';
  exception
    when others then
      if sqlerrm not like '%venue_not_pending_review%' then
        raise exception 'M6-2b FAIL: expected venue_not_pending_review, got %', sqlerrm;
      end if;
  end;
  reset role;
  update public.venue_listings set claim_status = 'pending_review'
   where id = 'c1255ccc-1000-4000-8000-000000000003';
  raise notice 'M6-2b PASS: verified venue tweak rejected';
end $$;

-- ── M6-3 (D-A): score override resolves the place via the VENUE row ─────────
do $$
declare
  v_res jsonb;
  v_score numeric;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub','a1255ccc-1000-4000-8000-000000000002', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub','a1255ccc-1000-4000-8000-000000000002',
                      'email','orch1255c-admin@test.local')::text, true);

  v_res := public.admin_apply_score_override(
    'c1255ccc-1000-4000-8000-000000000001', 'orch1255c_signal', 142, 'leg C test');
  if coalesce(v_res->>'ok','false') <> 'true' then
    raise exception 'M6-3 FAIL: override did not return ok, got %', v_res;
  end if;

  reset role;
  select score into v_score from public.place_scores
   where place_id = 'e1255ccc-1000-4000-8000-000000000001'
     and signal_id = 'orch1255c_signal';
  if v_score is distinct from 142 then
    raise exception 'M6-3 FAIL: place_scores not written for the venue''s place, got %', v_score;
  end if;
  raise notice 'M6-3 PASS: score override keyed off venue_listings.place_pool_id (brand pointer inert)';
end $$;

-- ── M6-4 (D-D): intelligence overview resolves the venue''s place ────────────
do $$
declare
  v_res jsonb;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub','a1255ccc-1000-4000-8000-000000000001', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub','a1255ccc-1000-4000-8000-000000000001')::text, true);

  v_res := public.venue_intelligence_overview(
    'b1255ccc-1000-4000-8000-000000000001',
    'c1255ccc-1000-4000-8000-000000000001');
  reset role;

  if jsonb_array_length(coalesce(v_res->'signal_scores','[]'::jsonb)) < 1 then
    raise exception 'M6-4 FAIL: expected the venue place''s ai_signal_scores, got %', v_res->'signal_scores';
  end if;
  if (v_res->'signal_scores'->0->>'id') <> 'date_night' then
    raise exception 'M6-4 FAIL: wrong signal id, got %', v_res->'signal_scores';
  end if;
  raise notice 'M6-4 PASS: venue_intelligence_overview reads the venue place (brand pointer inert)';
end $$;

-- ── M6-5 (D-F): public menus gate follows the VENUE claim machine ───────────
do $$
declare
  v_rows int;
begin
  -- No venue verified yet → anon sees nothing.
  set local role anon;
  select count(*) into v_rows from public.public_menus_view
   where brand_slug = 'orch1255cbrand';
  reset role;
  if v_rows <> 0 then
    raise exception 'M6-5 FAIL: menus visible with zero verified venues (%)', v_rows;
  end if;

  -- Verify venue A → anon sees the item. brands.claim_status stays 'none'.
  update public.venue_listings set claim_status = 'verified'
   where id = 'c1255ccc-1000-4000-8000-000000000001';

  set local role anon;
  select count(*) into v_rows from public.public_menus_view
   where brand_slug = 'orch1255cbrand';
  reset role;
  if v_rows <> 1 then
    raise exception 'M6-5 FAIL: expected 1 menu row for the verified-venue brand, got %', v_rows;
  end if;

  if (select claim_status from public.brands
       where id = 'b1255ccc-1000-4000-8000-000000000001') <> 'none' then
    raise exception 'M6-5 FAIL: brands.claim_status must stay legacy-inert';
  end if;
  raise notice 'M6-5 PASS: public_menus_view gate is venue-keyed';
end $$;

rollback;
