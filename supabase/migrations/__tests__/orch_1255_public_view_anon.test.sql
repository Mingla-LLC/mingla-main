-- META-ORCH-1255 Leg A — T-A5 (anon harvest) + SC-2 + SC-5 +
-- I-PROPOSED-1255-PUBLIC-VENUE-PAGE-ANON-SAFE enforcement (SPEC §6,
-- enforcement (a)).
--
--   ANON-1  anon SELECT on venue_listings → permission denied (42501). The
--           ONLY anon venue read path is venue_public_view.
--   ANON-2  anon SELECT on venue_public_view → ONLY claim_status='verified'
--           rows; a pending_review venue is ABSENT (SC-2). The view exposes
--           no claim/Stripe/account columns.
--   ANON-3  SC-5: anon reads place_pool photos/hours ONLY for a place whose
--           VENUE is verified; flipping that venue to 'suspended' removes
--           anon access on the next read (R-2 policy re-key).
--   ANON-4  the engine RPC via the legacy p_brand_id shape (anon-callable)
--           returns zero rows for a 2-venue brand (venue-ambiguous fail-soft,
--           [TRANSITIONAL-1]) and rows for a 1-venue reservable brand (T-C4
--           DB half).
--   AUTH-1  an authenticated member of brand Y sees ZERO of brand X's
--           venue_listings rows (member-read predicate).
--
-- Run (LOCAL Supabase Postgres only — NEVER remote):
--   docker exec -i <db-container> psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/migrations/__tests__/orch_1255_public_view_anon.test.sql
-- ONE transaction, ROLLS BACK — no residue.
--
-- FAILS-ON-REVERT:
--   * GRANT SELECT ON venue_listings TO anon → ANON-1 fails.
--   * Drop the WHERE claim_status='verified' scope from venue_public_view →
--     ANON-2 fails (pending venue leaks).
--   * Restore the brands-based place_pool read policy (R-2 revert) → ANON-3
--     fails (no venue is 'verified' on a brand row → verified-venue place
--     unreadable; or a suspended venue's place stays readable).
--   * Drop the single-venue guard in the [TRANSITIONAL-1] engine shim →
--     ANON-4's 2-venue arm fails (slots leak from an arbitrary venue).

\set ON_ERROR_STOP on
begin;

-- ── Fixtures ────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('a1255aaa-0000-4000-8000-000000000041', 'orch1255pv-ownerx@test.local'),
  ('a1255bbb-0000-4000-8000-000000000042', 'orch1255pv-ownery@test.local')
on conflict (id) do nothing;
insert into public.creator_accounts (id) values
  ('a1255aaa-0000-4000-8000-000000000041'),
  ('a1255bbb-0000-4000-8000-000000000042')
on conflict (id) do nothing;
insert into public.brands (id, account_id, name, slug) values
  ('b1255aaa-0000-4000-8000-000000000041','a1255aaa-0000-4000-8000-000000000041','Orch1255 PV X','orch1255pvx'),
  ('b1255bbb-0000-4000-8000-000000000042','a1255bbb-0000-4000-8000-000000000042','Orch1255 PV Y','orch1255pvy')
on conflict (id) do nothing;

insert into public.place_pool (id, name, lat, lng, is_active, stored_photo_urls) values
  ('e1255aaa-0000-4000-8000-000000000041','PV Place Verified', 38.9, -77.0, true, array['https://x.test/p1.jpg']),
  ('e1255bbb-0000-4000-8000-000000000042','PV Place Pending',  38.9, -77.0, true, array['https://x.test/p2.jpg'])
on conflict (id) do nothing;

-- Brand X: verified venue V1 (place-linked) + pending venue V2 (place-linked).
-- Brand Y: two venues (for the ANON-4 ambiguity arm), one reservable.
insert into public.venue_listings (id, brand_id, slug, name, lat, lng, venue_category, claim_status, place_pool_id) values
  ('f1255aaa-0000-4000-8000-000000000041','b1255aaa-0000-4000-8000-000000000041','pvverified','PV Verified Venue', 38.9, -77.0, 'restaurant','verified', 'e1255aaa-0000-4000-8000-000000000041'),
  ('f1255bbb-0000-4000-8000-000000000042','b1255aaa-0000-4000-8000-000000000041','pvpending','PV Pending Venue', 38.9, -77.0, 'restaurant','pending_review', 'e1255bbb-0000-4000-8000-000000000042'),
  ('f1255ccc-0000-4000-8000-000000000043','b1255bbb-0000-4000-8000-000000000042','pvy1','PV Y One', 40.7, -74.0, 'restaurant','verified', null),
  ('f1255ddd-0000-4000-8000-000000000044','b1255bbb-0000-4000-8000-000000000042','pvy2','PV Y Two', 40.7, -74.0, 'restaurant','verified', null);

insert into public.brand_hours (brand_id, venue_id, weekday, open_time, close_time, is_closed)
select 'b1255aaa-0000-4000-8000-000000000041','f1255aaa-0000-4000-8000-000000000041', w, '09:00'::time, '22:00'::time, false
from generate_series(0,6) w;

-- ── ANON-1: no direct table read ─────────────────────────────────────────────
do $$
declare n int;
begin
  set local role anon;
  begin
    select count(*) into n from public.venue_listings;
    raise exception 'ANON-1 FAIL: anon read venue_listings directly (% rows)', n;
  exception when insufficient_privilege then
    null; -- expected
  end;
  reset role;
  raise notice 'ANON-1 PASS: anon SELECT on venue_listings → permission denied';
end $$;

-- ── ANON-2: view is verified-only; hours agg present; no claim columns ───────
do $$
declare n int; v_hours jsonb;
begin
  set local role anon;
  select count(*) into n from public.venue_public_view
   where brand_slug = 'orch1255pvx';
  if n <> 1 then
    raise exception 'ANON-2 FAIL: expected exactly 1 verified venue for brand X in the view, got %', n;
  end if;
  select count(*) into n from public.venue_public_view where slug = 'pvpending';
  if n <> 0 then
    raise exception 'ANON-2 FAIL: pending_review venue leaked through venue_public_view';
  end if;
  select hours into v_hours from public.venue_public_view where slug = 'pvverified';
  if jsonb_array_length(coalesce(v_hours,'[]'::jsonb)) <> 7 then
    raise exception 'ANON-2 FAIL: hours agg missing/short on the view (%)', v_hours;
  end if;
  reset role;
  -- Column-surface check (definer view must not expose lifecycle/stripe cols).
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='venue_public_view'
      and column_name in ('claim_status','claim_follow_up_at','rejection_reason',
                          'marked_called_at','marked_called_by',
                          'claim_decision_emailed_at','duplicate_of_venue_id')
  ) then
    raise exception 'ANON-2 FAIL: venue_public_view exposes claim-lifecycle columns';
  end if;
  raise notice 'ANON-2 PASS: view is verified-only, 7-day hours agg, no lifecycle columns';
end $$;

-- ── ANON-3 (SC-5): place gate follows the VENUE claim, live ──────────────────
do $$
declare n int;
begin
  set local role anon;
  select count(*) into n from public.place_pool where id = 'e1255aaa-0000-4000-8000-000000000041';
  if n <> 1 then
    raise exception 'ANON-3 FAIL: anon cannot read the VERIFIED venue''s place';
  end if;
  select count(*) into n from public.place_pool where id = 'e1255bbb-0000-4000-8000-000000000042';
  if n <> 0 then
    raise exception 'ANON-3 FAIL: anon read the PENDING venue''s place (photo/hours leak)';
  end if;
  reset role;

  -- Suspend the verified venue (service path) → anon access must vanish.
  update public.venue_listings set claim_status = 'suspended'
   where id = 'f1255aaa-0000-4000-8000-000000000041';

  set local role anon;
  select count(*) into n from public.place_pool where id = 'e1255aaa-0000-4000-8000-000000000041';
  if n <> 0 then
    raise exception 'ANON-3 FAIL: suspended venue''s place still anon-readable';
  end if;
  select count(*) into n from public.venue_public_view where slug = 'pvverified';
  if n <> 0 then
    raise exception 'ANON-3 FAIL: suspended venue still in venue_public_view';
  end if;
  reset role;

  -- restore for later arms
  update public.venue_listings set claim_status = 'verified'
   where id = 'f1255aaa-0000-4000-8000-000000000041';
  raise notice 'ANON-3 PASS: place readable only while its venue is verified; suspend revokes on next read';
end $$;

-- ── ANON-4: [TRANSITIONAL-1] legacy engine shim — fail-soft, no cross-venue leak ─
do $$
declare n int;
begin
  -- Make Y-1 fully reservable so a leak WOULD produce slots.
  insert into public.venue_reservation_settings (brand_id, venue_id, reservations_enabled)
  values ('b1255bbb-0000-4000-8000-000000000042','f1255ccc-0000-4000-8000-000000000043', true);
  insert into public.venue_availability_config (brand_id, venue_id, iana_timezone, service_periods, turn_times)
  values ('b1255bbb-0000-4000-8000-000000000042','f1255ccc-0000-4000-8000-000000000043','UTC',
          '[{"name":"Open","days":[0,1,2,3,4,5,6],"start":"09:00","end":"22:00","type":"derived_from_hours"}]'::jsonb,
          '{"p2":90}'::jsonb);
  insert into public.venue_tables (brand_id, venue_id, name, capacity)
  values ('b1255bbb-0000-4000-8000-000000000042','f1255ccc-0000-4000-8000-000000000043','Y1-T1', 4);

  set local role anon;
  -- 2-venue brand via legacy p_brand_id → ZERO rows (ambiguous, fail-soft).
  select count(*) into n from public.pg_venue_available_slots(
    p_date => (current_date + 3), p_party_size => 2,
    p_brand_id => 'b1255bbb-0000-4000-8000-000000000042');
  if n <> 0 then
    raise exception 'ANON-4 FAIL: legacy brand call on a 2-venue brand leaked % slots', n;
  end if;
  -- Direct venue call → slots present (the engine itself works).
  select count(*) into n from public.pg_venue_available_slots(
    p_date => (current_date + 3), p_party_size => 2,
    p_venue_id => 'f1255ccc-0000-4000-8000-000000000043');
  if n = 0 then
    raise exception 'ANON-4 FAIL: venue-keyed engine returned no slots for a reservable venue';
  end if;
  reset role;

  -- Single-venue brand: drop Y-2 → the legacy shape now resolves.
  delete from public.venue_listings where id = 'f1255ddd-0000-4000-8000-000000000044';
  set local role anon;
  select count(*) into n from public.pg_venue_available_slots(
    p_date => (current_date + 3), p_party_size => 2,
    p_brand_id => 'b1255bbb-0000-4000-8000-000000000042');
  if n = 0 then
    raise exception 'ANON-4 FAIL: legacy brand call on a 1-venue brand returned no slots';
  end if;
  reset role;
  raise notice 'ANON-4 PASS: legacy shim fail-softs on 2 venues, resolves on 1 venue';
end $$;

-- ── AUTH-1: cross-brand member sees zero rows ────────────────────────────────
do $$
declare n int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub','a1255bbb-0000-4000-8000-000000000042', true);
  select count(*) into n from public.venue_listings
   where brand_id = 'b1255aaa-0000-4000-8000-000000000041';
  reset role;
  if n <> 0 then
    raise exception 'AUTH-1 FAIL: brand-Y owner read % of brand X''s venue rows', n;
  end if;
  raise notice 'AUTH-1 PASS: cross-brand member reads zero venue rows';
end $$;

-- ── ORCH-1290 M1: venue_public_view exposes the owner-authored pitch ─────────
-- META-ORCH-1290 D-6/D-2: the pitch (place_pool.generative_summary) surfaces on
-- the anon public page, verified-only. Reverting M1 (dropping
-- `pp.generative_summary AS pitch`) → PITCH-1 fails (column absent). Reverting
-- the verified-only WHERE → PITCH-2 fails (pending pitch leaks).
do $$
declare v_pitch text; n int;
begin
  -- Give the verified venue's place an owner-authored pitch, and the pending
  -- venue's place a pitch too (to prove the pending one never surfaces).
  update public.place_pool set generative_summary = 'A candlelit wine bar with a 200-label list and a courtyard.'
   where id = 'e1255aaa-0000-4000-8000-000000000041';
  update public.place_pool set generative_summary = 'This pending venue pitch must never reach anon.'
   where id = 'e1255bbb-0000-4000-8000-000000000042';

  set local role anon;
  -- PITCH-1: the verified venue's pitch is present + equals generative_summary.
  select pitch into v_pitch from public.venue_public_view where slug = 'pvverified';
  if v_pitch is distinct from 'A candlelit wine bar with a 200-label list and a courtyard.' then
    raise exception 'PITCH-1 FAIL: verified venue pitch = %, expected the generative_summary', coalesce(v_pitch, '<null>');
  end if;
  -- PITCH-2: the pending venue (with a pitch set) is still absent from the view.
  select count(*) into n from public.venue_public_view where slug = 'pvpending';
  if n <> 0 then
    raise exception 'PITCH-2 FAIL: pending venue (pitch set) leaked into the anon view (% rows)', n;
  end if;
  reset role;
  raise notice 'PITCH-1/2 PASS: verified pitch surfaces; pending pitch never leaks (anon-safe)';
end $$;

rollback;
