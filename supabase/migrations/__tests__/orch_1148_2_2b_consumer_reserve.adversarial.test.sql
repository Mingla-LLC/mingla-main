-- META-ORCH-1148 sub-ORCH 2.2b — TESTER ADVERSARIAL regression (a DIFFERENT
-- angle than the implementor's 33-assertion STRUCTURAL .mjs check).
--
-- The implementor's gate (app-mobile/scripts/ci/orch-1148-2-2b-consumer-reserve-
-- check.mjs) only greps SOURCE TEXT for the right substrings. It NEVER executes
-- the resolve RPC, the consumer-own RLS, or the consumer cancel RPC against a
-- live Postgres, so it cannot prove that:
--   - the resolver actually GATES on the verified claim (a migration can contain
--     `claim_status = 'verified'` and still leak if the predicate is wrong), and
--   - one consumer cannot READ or CANCEL another consumer's reservation.
--
-- THIS test executes the real DDL + RLS + RPCs against a live Postgres with TWO
-- distinct authenticated consumers + the anon role and asserts the security
-- invariants BY BEHAVIOR. It is the runtime complement to the structural gate.
--
--   ADV-1  Resolver verified-gate — a brand whose claim is UNVERIFIED
--          (pending_review) with reservations_enabled=true must return ZERO rows
--          (no brand_id / currency leak). I-PROPOSED-1148-RESERVABLE-RESOLVER-
--          EXPOSES-ONLY-DISPLAY-GATE.
--   ADV-2  Resolver no-leak-when-off — a VERIFIED brand with reservations
--          disabled returns reservable=f, brand_id=NULL, currency=NULL.
--   ADV-3  Resolver deleted-gate — a verified+enabled but soft-deleted brand
--          returns ZERO rows.
--   ADV-4  Resolver happy path — a verified+enabled brand returns
--          {reservable=t, brand_id, currency}.
--   ADV-5  Consumer-own RLS — consumer B CANNOT read consumer A's reservation
--          row (the cross-user reservation leak). consumer_user_id = auth.uid().
--   ADV-6  Cross-user cancel — consumer B calling pg_cancel_my_reservation on
--          consumer A's reservation raises reservation_not_found AND leaves A's
--          row UNMUTATED (still 'confirmed'). A user cannot cancel another's.
--   ADV-7  Owner cancel — consumer A cancels A's own reservation → status
--          transitions to 'cancelled_by_guest'.
--   ADV-8  anon (no JWT) sees ZERO reservation rows + ZERO settings rows (no
--          policy match) — the only anon path to reservable data is the
--          SECURITY DEFINER resolver.
--
-- Run (local Supabase Postgres only — NEVER remote):
--   docker exec -i <container> psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < this_file
-- The whole script runs in ONE transaction and ROLLS BACK — no residue.
--
-- FAILS-ON-REVERT (cited against implementation HEAD b5635f6d2):
--   * Drop the `claim_status = 'verified'` predicate from
--     pg_venue_reservable_for_place → ADV-1 fails (an unverified brand leaks
--     brand_id; proven live by the tester: the reverted fn returned
--     {t, b4, USD} where the shipped fn returns 0 rows).
--   * Drop the `AND consumer_user_id = v_uid` ownership predicate from
--     pg_cancel_my_reservation → ADV-6 fails (attacker cancels A's row).
--   * Drop the "reservations consumer can read own" policy or widen it → ADV-5
--     fails (cross-user read leak).
--   * Revert the whole 2.2b migration (resolver absent) → ADV-1..4 error
--     immediately (function does not exist).

\set ON_ERROR_STOP on
begin;

-- ── Fixtures ────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('a1111111-0000-4000-8000-000000000001', 'owner@test.local'),
  ('c1111111-0000-4000-8000-000000000001', 'consumerA@test.local'),
  ('c2222222-0000-4000-8000-000000000002', 'consumerB@test.local')
on conflict (id) do nothing;

insert into public.creator_accounts (id) values
  ('a1111111-0000-4000-8000-000000000001')
on conflict (id) do nothing;

insert into public.place_pool (id, name, lat, lng) values
  ('e1111111-0000-4000-8000-000000000001', 'P-reservable', 38.9, -77.0),
  ('e2222222-0000-4000-8000-000000000002', 'P-disabled',   38.9, -77.0),
  ('e4444444-0000-4000-8000-000000000004', 'P-unverified', 38.9, -77.0),
  ('e5555555-0000-4000-8000-000000000005', 'P-deleted',    38.9, -77.0)
on conflict (id) do nothing;

insert into public.brands
  (id, account_id, name, slug, place_pool_id, claim_status, pricing_currency, default_currency, deleted_at)
values
  ('b1111111-0000-4000-8000-000000000001','a1111111-0000-4000-8000-000000000001','Reservable Bistro','adv-reservable','e1111111-0000-4000-8000-000000000001','verified','USD','USD', null),
  ('b2222222-0000-4000-8000-000000000002','a1111111-0000-4000-8000-000000000001','Disabled Diner',   'adv-disabled',  'e2222222-0000-4000-8000-000000000002','verified','EUR','EUR', null),
  ('b4444444-0000-4000-8000-000000000004','a1111111-0000-4000-8000-000000000001','Pending Pub',      'adv-pending',   'e4444444-0000-4000-8000-000000000004','pending_review','USD','USD', null),
  ('b5555555-0000-4000-8000-000000000005','a1111111-0000-4000-8000-000000000001','Deleted Deli',     'adv-deleted',   'e5555555-0000-4000-8000-000000000005','verified','USD','USD', now())
on conflict (id) do nothing;

insert into public.venue_reservation_settings (brand_id, reservations_enabled, fee_currency) values
  ('b1111111-0000-4000-8000-000000000001', true,  'USD'),   -- reservable
  ('b2222222-0000-4000-8000-000000000002', false, 'EUR'),   -- disabled
  ('b4444444-0000-4000-8000-000000000004', true,  'USD'),   -- enabled but unverified claim
  ('b5555555-0000-4000-8000-000000000005', true,  'USD')    -- enabled but soft-deleted
on conflict (brand_id) do nothing;

-- A confirmed reservation owned by consumer A at the reservable brand.
insert into public.reservations
  (id, brand_id, reserved_for, party_size, status, consumer_user_id, created_via, payment_status)
values
  ('00000000-0000-4000-8000-0000000000a1','b1111111-0000-4000-8000-000000000001',
   now() + interval '3 days', 2, 'confirmed','c1111111-0000-4000-8000-000000000001','consumer','none')
on conflict (id) do nothing;

-- ── ADV-1: resolver verified-gate — unverified claim → 0 rows (no leak) ──────
do $$
declare n int;
begin
  set local role anon;
  select count(*) into n from public.pg_venue_reservable_for_place('e4444444-0000-4000-8000-000000000004');
  reset role;
  if n <> 0 then
    raise exception 'ADV-1 FAIL: resolver leaked an UNVERIFIED-claim brand (% rows; expected 0)', n;
  end if;
  raise notice 'ADV-1 PASS: unverified-claim brand → 0 rows (verified gate bites)';
end $$;

-- ── ADV-2: resolver no-leak-when-off — disabled → reservable=f, brand_id NULL ─
do $$
declare r record;
begin
  set local role anon;
  select * into r from public.pg_venue_reservable_for_place('e2222222-0000-4000-8000-000000000002');
  reset role;
  if r.reservable is distinct from false or r.brand_id is not null or r.currency is not null then
    raise exception 'ADV-2 FAIL: disabled venue leaked (reservable=%, brand_id=%, currency=%)', r.reservable, r.brand_id, r.currency;
  end if;
  raise notice 'ADV-2 PASS: disabled venue → reservable=f, brand_id NULL, currency NULL';
end $$;

-- ── ADV-3: resolver deleted-gate — verified+enabled but soft-deleted → 0 rows ─
do $$
declare n int;
begin
  set local role anon;
  select count(*) into n from public.pg_venue_reservable_for_place('e5555555-0000-4000-8000-000000000005');
  reset role;
  if n <> 0 then
    raise exception 'ADV-3 FAIL: resolver returned a soft-deleted brand (% rows; expected 0)', n;
  end if;
  raise notice 'ADV-3 PASS: soft-deleted brand → 0 rows (deleted_at gate bites)';
end $$;

-- ── ADV-4: resolver happy path — verified+enabled → {t, brand_id, USD} ───────
do $$
declare r record;
begin
  set local role anon;
  select * into r from public.pg_venue_reservable_for_place('e1111111-0000-4000-8000-000000000001');
  reset role;
  if r.reservable is not true
     or r.brand_id <> 'b1111111-0000-4000-8000-000000000001'
     or r.currency <> 'USD' then
    raise exception 'ADV-4 FAIL: happy path wrong (reservable=%, brand_id=%, currency=%)', r.reservable, r.brand_id, r.currency;
  end if;
  raise notice 'ADV-4 PASS: reservable venue → {t, brand_id, USD}';
end $$;

-- ── ADV-5: consumer-own RLS — consumer B cannot read A's reservation ─────────
do $$
declare n_a int; n_b int;
begin
  -- consumer A reads own → 1
  set local role authenticated;
  perform set_config('request.jwt.claim.sub','c1111111-0000-4000-8000-000000000001', true);
  select count(*) into n_a from public.reservations where id='00000000-0000-4000-8000-0000000000a1';
  reset role;
  if n_a <> 1 then raise exception 'ADV-5 SETUP FAIL: owner A could not read own reservation (% rows)', n_a; end if;

  -- consumer B reads A's row → 0 (RLS bites)
  set local role authenticated;
  perform set_config('request.jwt.claim.sub','c2222222-0000-4000-8000-000000000002', true);
  select count(*) into n_b from public.reservations where id='00000000-0000-4000-8000-0000000000a1';
  reset role;
  if n_b <> 0 then
    raise exception 'ADV-5 FAIL: consumer B READ consumer A''s reservation (% rows; expected 0)', n_b;
  end if;
  raise notice 'ADV-5 PASS: cross-user read blocked (A reads own=1, B reads A=0)';
end $$;

-- ── ADV-6: cross-user cancel — B cancels A's row → blocked + row unmutated ───
do $$
declare blocked boolean := false; st text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub','c2222222-0000-4000-8000-000000000002', true);
  begin
    perform public.pg_cancel_my_reservation('00000000-0000-4000-8000-0000000000a1');
  exception when others then
    blocked := true;  -- reservation_not_found (the consumer_user_id = v_uid gate)
  end;
  reset role;
  if not blocked then
    raise exception 'ADV-6 FAIL: consumer B CANCELLED consumer A''s reservation (no ownership gate!)';
  end if;
  -- prove A's row is untouched
  select status into st from public.reservations where id='00000000-0000-4000-8000-0000000000a1';
  if st <> 'confirmed' then
    raise exception 'ADV-6 FAIL: A''s reservation was mutated by the attacker (status=%)', st;
  end if;
  raise notice 'ADV-6 PASS: cross-user cancel blocked + A''s row still confirmed';
end $$;

-- ── ADV-7: owner cancel — A cancels own → cancelled_by_guest ─────────────────
do $$
declare st text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub','c1111111-0000-4000-8000-000000000001', true);
  select (r.reservation).status into st
  from public.pg_cancel_my_reservation('00000000-0000-4000-8000-0000000000a1') r;
  reset role;
  if st <> 'cancelled_by_guest' then
    raise exception 'ADV-7 FAIL: owner cancel did not transition (status=%)', st;
  end if;
  raise notice 'ADV-7 PASS: owner cancel → cancelled_by_guest';
end $$;

-- ── ADV-8: anon sees ZERO reservation + settings rows directly ───────────────
do $$
declare n_res int; n_set int;
begin
  set local role anon;
  select count(*) into n_res from public.reservations;
  select count(*) into n_set from public.venue_reservation_settings;
  reset role;
  if n_res <> 0 or n_set <> 0 then
    raise exception 'ADV-8 FAIL: anon read underlying tables directly (reservations=%, settings=%)', n_res, n_set;
  end if;
  raise notice 'ADV-8 PASS: anon sees 0 reservation + 0 settings rows (RLS default-deny)';
end $$;

rollback;
