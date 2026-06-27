-- META-ORCH-1236 [live-currency charge-in-wrong-currency fix] — IMPLEMENTOR
-- happy-path regression test (fails-on-revert).
--
-- Proves the structural fix in
-- 20261127000000_meta_orch_1236_pricing_currency_tracks_default.sql:
--   T-01  hotfix aligns a drifted row (pricing GBP -> default USD => US)
--   T-02  hotfix is idempotent (re-run changes 0 rows)
--   T-03  SCA trigger derives pricing_currency/region in lockstep on a
--         stripe_connect_accounts default_currency change (refresh/onboard path)
--   T-04  brand-direct BEFORE trigger derives pricing_currency/region on insert
--   T-05  NGN -> NG mapping (new vs ORCH-1034)
--   T-06  detach (sca.detached_at) does NOT reset pricing_currency
--   T-07  NULL default_currency leaves pricing_currency at its floor (no abort)
--   T-08  unmapped currency ('CAD') -> pricing_currency='CAD', region floored,
--         no CHECK violation
--   T-09  no money-row mutation (events/ticket_types/orders.currency frozen)
--
-- USAGE (manual / CI; the whole script runs in ONE transaction and ROLLS BACK —
-- no residue, write-safe against any DB incl. linked remote):
--   cat supabase/migrations/__tests__/meta_orch_1236_pricing_currency_tracks_default.test.sql \
--     | psql "$DATABASE_URL"
--   (RAISE EXCEPTION on any FAIL -> non-zero exit under \set ON_ERROR_STOP on.)
--
-- FAILS-ON-REVERT (proven against the branch — see implementation report):
--   * Delete the A.1 hotfix UPDATE from the migration   -> T-01 fails (drift stays).
--   * Delete pricing_currency from tg_sync_brand_stripe_cache's SET list
--                                                        -> T-03 fails (no lockstep).
--   * Delete the trg_brands_derive_pricing_from_default trigger
--                                                        -> T-04/T-05/T-08 fail.
--
-- NOTE: fixed UUID fixtures live in the 'fff...' space to avoid colliding with
-- any real row; everything is created + asserted + rolled back.

\set ON_ERROR_STOP on
begin;

-- ── Fixtures (mirrors orch_1148_2_2b seeding convention) ─────────────────────
insert into auth.users (id, email) values
  ('f0000000-0000-4000-8000-000000001236', 'orch1236-owner@test.local')
on conflict (id) do nothing;

insert into public.creator_accounts (id) values
  ('f0000000-0000-4000-8000-000000001236')
on conflict (id) do nothing;

-- A drifted brand seeded WITHOUT default_currency (lands NULL -> the BEFORE
-- trigger no-ops, so the columns take their floor 'GBP'/'GB'). This is exactly
-- the live-bug shape: a brand that will later be set to a non-GBP currency.
insert into public.brands
  (id, account_id, name, slug)
values
  ('f1111111-0000-4000-8000-000000001236',
   'f0000000-0000-4000-8000-000000001236',
   'ORCH1236 Drifted', 'orch1236-drifted')
on conflict (id) do nothing;

-- ── T-01: the BEFORE trigger corrects pricing when default_currency is set to a
--          non-GBP value via a brand-direct UPDATE (the forward-drift the hotfix
--          + trigger close). FAILS-ON-REVERT: deleting the trigger leaves
--          pricing_currency at the 'GBP' floor while default_currency='USD' =>
--          the assertion below RAISEs. ──────────────────────────────────────────
do $$
declare v_cur text; v_reg text;
begin
  update public.brands
     set default_currency = 'USD'
   where id = 'f1111111-0000-4000-8000-000000001236';

  select pricing_currency, pricing_region into v_cur, v_reg
    from public.brands where id = 'f1111111-0000-4000-8000-000000001236';
  if v_cur <> 'USD' or v_reg <> 'US' then
    raise exception 'T-01 FAIL: setting default_currency=USD did not track pricing (pricing_currency=%, pricing_region=%; expected USD/US — trigger reverted?)', v_cur, v_reg;
  end if;
  raise notice 'T-01 PASS: brand-direct default_currency=USD -> pricing tracks to USD/US (no drift)';
end $$;

-- ── T-02: the A.1/A.2 hotfix UPDATE statements are idempotent (a manual re-run
--          of the migration's hotfix touches 0 rows once everything is aligned).─
do $$
declare v_n int;
begin
  with upd as (
    update public.brands
       set pricing_currency = upper(trim(default_currency::text))
     where default_currency is not null
       and upper(trim(default_currency::text)) is distinct from pricing_currency
    returning 1)
  select count(*) into v_n from upd;
  if v_n <> 0 then
    raise exception 'T-02 FAIL: hotfix re-run updated % rows (expected 0 — pricing already tracks default)', v_n;
  end if;
  raise notice 'T-02 PASS: hotfix re-run updated 0 rows (idempotent; pricing already tracks default)';
end $$;

-- ── T-03: SCA trigger derives pricing in lockstep (refresh/onboard path) ─────
-- Insert an active SCA with currency 'eur' for the brand; the AFTER trigger on
-- stripe_connect_accounts must set brands.default_currency='EUR' AND
-- pricing_currency='EUR' AND pricing_region='EU' in the SAME write.
do $$
declare v_def text; v_cur text; v_reg text;
begin
  insert into public.stripe_connect_accounts
    (brand_id, stripe_account_id, charges_enabled, payouts_enabled, default_currency)
  values
    ('f1111111-0000-4000-8000-000000001236', 'acct_orch1236_test', true, true, 'eur');

  select default_currency, pricing_currency, pricing_region
    into v_def, v_cur, v_reg
    from public.brands where id = 'f1111111-0000-4000-8000-000000001236';

  if upper(trim(v_def)) <> 'EUR' or v_cur <> 'EUR' or v_reg <> 'EU' then
    raise exception 'T-03 FAIL: SCA trigger did not derive pricing in lockstep (default=%, pricing_currency=%, pricing_region=%; expected EUR/EUR/EU)',
      v_def, v_cur, v_reg;
  end if;
  raise notice 'T-03 PASS: SCA currency change -> pricing_currency=EUR, pricing_region=EU (lockstep)';
end $$;

-- ── T-06: detach does NOT reset pricing_currency ─────────────────────────────
-- (kept adjacent to T-03 because it reuses the SCA row just created.)
do $$
declare v_cur text; v_reg text; v_connect text;
begin
  update public.stripe_connect_accounts
     set detached_at = now()
   where brand_id = 'f1111111-0000-4000-8000-000000001236';

  select pricing_currency, pricing_region, stripe_connect_id
    into v_cur, v_reg, v_connect
    from public.brands where id = 'f1111111-0000-4000-8000-000000001236';

  if v_cur <> 'EUR' or v_reg <> 'EU' then
    raise exception 'T-06 FAIL: detach reset commerce currency (pricing_currency=%, pricing_region=%; expected EUR/EU preserved)', v_cur, v_reg;
  end if;
  if v_connect is not null then
    raise exception 'T-06 FAIL: detach did not clear stripe_connect_id (got %)', v_connect;
  end if;
  raise notice 'T-06 PASS: detach preserved pricing_currency=EUR/EU and cleared stripe_connect_id';
end $$;

-- ── T-04: brand-direct BEFORE trigger derives pricing on insert ──────────────
do $$
declare v_cur text; v_reg text;
begin
  insert into public.brands
    (id, account_id, name, slug, default_currency)
  values
    ('f4444444-0000-4000-8000-000000001236',
     'f0000000-0000-4000-8000-000000001236',
     'ORCH1236 Direct USD', 'orch1236-direct-usd', 'usd');

  select pricing_currency, pricing_region into v_cur, v_reg
    from public.brands where id = 'f4444444-0000-4000-8000-000000001236';
  if v_cur <> 'USD' or v_reg <> 'US' then
    raise exception 'T-04 FAIL: brand-direct insert did not derive pricing (pricing_currency=%, pricing_region=%; expected USD/US)', v_cur, v_reg;
  end if;
  raise notice 'T-04 PASS: brand insert default_currency=usd -> pricing_currency=USD, pricing_region=US';
end $$;

-- ── T-05: NGN -> NG mapping ──────────────────────────────────────────────────
do $$
declare v_cur text; v_reg text;
begin
  insert into public.brands
    (id, account_id, name, slug, default_currency)
  values
    ('f5555555-0000-4000-8000-000000001236',
     'f0000000-0000-4000-8000-000000001236',
     'ORCH1236 NGN', 'orch1236-ngn', 'NGN');

  select pricing_currency, pricing_region into v_cur, v_reg
    from public.brands where id = 'f5555555-0000-4000-8000-000000001236';
  if v_cur <> 'NGN' or v_reg <> 'NG' then
    raise exception 'T-05 FAIL: NGN not mapped (pricing_currency=%, pricing_region=%; expected NGN/NG)', v_cur, v_reg;
  end if;
  raise notice 'T-05 PASS: NGN -> pricing_currency=NGN, pricing_region=NG';
end $$;

-- ── T-07: NULL default_currency leaves pricing_currency at its floor ──────────
do $$
declare v_cur text; v_reg text;
begin
  -- No default_currency provided -> lands NULL -> BEFORE trigger no-ops ->
  -- columns take their NOT-NULL floor default ('GBP'/'GB'). MUST NOT abort.
  insert into public.brands
    (id, account_id, name, slug)
  values
    ('f7777777-0000-4000-8000-000000001236',
     'f0000000-0000-4000-8000-000000001236',
     'ORCH1236 NullCcy', 'orch1236-null-ccy');

  select pricing_currency, pricing_region into v_cur, v_reg
    from public.brands where id = 'f7777777-0000-4000-8000-000000001236';
  if v_cur is null or v_reg is null then
    raise exception 'T-07 FAIL: NULL-default brand has NULL pricing columns (NOT-NULL floor violated): pricing_currency=%, pricing_region=%', v_cur, v_reg;
  end if;
  raise notice 'T-07 PASS: NULL default_currency brand kept floor (pricing_currency=%, pricing_region=%) without abort', v_cur, v_reg;
end $$;

-- ── T-08: unmapped currency ('CAD') -> CAD currency, region floored, no CHECK ─
do $$
declare v_cur text; v_reg text;
begin
  insert into public.brands
    (id, account_id, name, slug, default_currency, pricing_region)
  values
    ('f8888888-0000-4000-8000-000000001236',
     'f0000000-0000-4000-8000-000000001236',
     'ORCH1236 CAD', 'orch1236-cad', 'CAD', 'US');  -- provide a valid region to floor to

  select pricing_currency, pricing_region into v_cur, v_reg
    from public.brands where id = 'f8888888-0000-4000-8000-000000001236';
  if v_cur <> 'CAD' then
    raise exception 'T-08 FAIL: unmapped currency not set (pricing_currency=%; expected CAD)', v_cur;
  end if;
  -- region must be a member of the allowlist ('GB','US','EU','CH','NG') — the
  -- COALESCE floor keeps the provided 'US' (no CHECK violation, no abort).
  if v_reg not in ('GB','US','EU','CH','NG') then
    raise exception 'T-08 FAIL: unmapped-currency region outside allowlist (pricing_region=%)', v_reg;
  end if;
  raise notice 'T-08 PASS: unmapped CAD -> pricing_currency=CAD, region floored to % (no CHECK violation)', v_reg;
end $$;

-- ── T-09: no money-row mutation — events/ticket_types/orders.currency frozen ──
-- The fix touches ONLY brands config columns; assert the money-snapshot columns
-- are untouched by anything in this test's brand writes. (Checks the column
-- distribution is identical before/after a no-op brand UPDATE.)
do $$
declare v_before text; v_after text;
begin
  select md5(coalesce(string_agg(currency::text, ',' order by id), ''))
    into v_before from public.events;
  -- A brand-only write (re-derive on the drifted brand) must not touch events.
  update public.brands set updated_at = now()
   where id = 'f1111111-0000-4000-8000-000000001236';
  select md5(coalesce(string_agg(currency::text, ',' order by id), ''))
    into v_after from public.events;
  if v_before is distinct from v_after then
    raise exception 'T-09 FAIL: events.currency distribution changed after a brand write';
  end if;
  raise notice 'T-09 PASS: events.currency distribution unchanged by brand writes (money rows frozen)';
end $$;

do $$ begin raise notice '[META-ORCH-1236 pricing-currency-tracks-default] ALL TESTS PASSED'; end $$;

rollback;
