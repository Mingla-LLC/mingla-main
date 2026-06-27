-- META-ORCH-1236 [live-currency charge-in-wrong-currency fix] — TESTER
-- ADVERSARIAL regression test (different angle than the implementor's happy-path).
--
-- Attack vectors (SPEC §9, written by mingla-forensics, executed by mingla-tester):
--   AV-1  detach-then-REATTACH with a DIFFERENT currency — pricing must follow the
--         new active-SCA currency on reattach (the implementor's T-06 only proves
--         detach PRESERVES; this proves reattach CONVERGES to the new currency).
--   AV-2  rapid SCA currency flip USD -> EUR -> USD — final convergence to USD/US
--         (no stale intermediate value sticks).
--   AV-3  brand UPDATE that tries to set pricing_currency DISAGREEING with
--         default_currency, WITH default_currency in the same UPDATE — the BEFORE
--         trigger MUST override the attacker's pricing_currency.
--   AV-3b ADVERSARIAL EXTENSION: brand UPDATE that sets ONLY pricing_currency
--         (default_currency untouched) — documents whether the BEFORE trigger
--         (which is BEFORE UPDATE *OF default_currency*) fires. This is the CI
--         strict-grep guard's job in app/edge code; at the DB layer a raw
--         pricing_currency-only UPDATE is NOT caught by the column-scoped trigger.
--         Asserted as OBSERVED behaviour so a regression is visible.
--   AV-4  unmapped currency 'CAD' on the SCA path (not just brand-direct) — region
--         must stay a valid allowlist member (no CHECK violation / abort).
--   AV-5  checkout-shaped flow: insert an events money-row, run a brand re-derive,
--         assert events.currency is byte-identical (no money-row mutation).
--
-- FAILS-ON-REVERT (different angle from the implementor — proven by tester):
--   * Delete pricing_currency/region from tg_sync_brand_stripe_cache SET list ->
--     AV-1 (reattach), AV-2 (flip convergence) FAIL.
--   * Delete the trg_brands_derive_pricing_from_default trigger -> AV-3 FAILS
--     (attacker's disagreeing pricing_currency survives).
--
-- USAGE: piped to psql after the migration is applied; one transaction, ROLLBACK.
--   \set ON_ERROR_STOP on  (RAISE EXCEPTION -> non-zero exit)

\set ON_ERROR_STOP on
begin;

-- ── Fixtures (adversarial UUID space 'ad...' — no collision with impl test 'f...')
insert into auth.users (id, email) values
  ('ad000000-0000-4000-8000-000000001236', 'orch1236-adv@test.local')
on conflict (id) do nothing;
insert into public.creator_accounts (id) values
  ('ad000000-0000-4000-8000-000000001236')
on conflict (id) do nothing;

-- Brand seeded WITHOUT default_currency -> NULL -> floor GBP/GB.
insert into public.brands (id, account_id, name, slug) values
  ('ad111111-0000-4000-8000-000000001236',
   'ad000000-0000-4000-8000-000000001236', 'ORCH1236 Adversary', 'orch1236-adv')
on conflict (id) do nothing;

-- ── AV-1: detach-then-REATTACH with a DIFFERENT currency ─────────────────────
-- Attach USD -> detach (preserve USD) -> reattach EUR -> pricing must become EUR/EU.
do $$
declare v_def text; v_cur text; v_reg text;
begin
  -- attach USD
  insert into public.stripe_connect_accounts
    (brand_id, stripe_account_id, charges_enabled, payouts_enabled, default_currency)
  values ('ad111111-0000-4000-8000-000000001236','acct_adv_usd',true,true,'usd');
  select pricing_currency into v_cur from public.brands where id='ad111111-0000-4000-8000-000000001236';
  if v_cur <> 'USD' then raise exception 'AV-1 setup FAIL: attach USD -> pricing=% (expected USD)', v_cur; end if;

  -- detach (must preserve USD)
  update public.stripe_connect_accounts set detached_at = now()
   where brand_id='ad111111-0000-4000-8000-000000001236' and stripe_account_id='acct_adv_usd';
  select pricing_currency into v_cur from public.brands where id='ad111111-0000-4000-8000-000000001236';
  if v_cur <> 'USD' then raise exception 'AV-1 FAIL: detach reset pricing to % (expected USD preserved)', v_cur; end if;

  -- REATTACH with a DIFFERENT currency (EUR) via a NEW active SCA row.
  insert into public.stripe_connect_accounts
    (brand_id, stripe_account_id, charges_enabled, payouts_enabled, default_currency)
  values ('ad111111-0000-4000-8000-000000001236','acct_adv_eur',true,true,'eur');

  select default_currency, pricing_currency, pricing_region
    into v_def, v_cur, v_reg from public.brands where id='ad111111-0000-4000-8000-000000001236';
  if upper(trim(v_def)) <> 'EUR' or v_cur <> 'EUR' or v_reg <> 'EU' then
    raise exception 'AV-1 FAIL: reattach EUR did not converge pricing (default=%, pricing=%, region=%; expected EUR/EUR/EU — trigger reverted?)', v_def, v_cur, v_reg;
  end if;
  raise notice 'AV-1 PASS: detach preserved USD, reattach EUR converged pricing to EUR/EU';
end $$;

-- ── AV-2: rapid SCA flip USD -> EUR -> USD; final convergence to USD/US ───────
do $$
declare v_cur text; v_reg text;
begin
  update public.stripe_connect_accounts set default_currency='usd'
   where brand_id='ad111111-0000-4000-8000-000000001236' and stripe_account_id='acct_adv_eur';
  update public.stripe_connect_accounts set default_currency='eur'
   where brand_id='ad111111-0000-4000-8000-000000001236' and stripe_account_id='acct_adv_eur';
  update public.stripe_connect_accounts set default_currency='usd'
   where brand_id='ad111111-0000-4000-8000-000000001236' and stripe_account_id='acct_adv_eur';

  select pricing_currency, pricing_region into v_cur, v_reg
    from public.brands where id='ad111111-0000-4000-8000-000000001236';
  if v_cur <> 'USD' or v_reg <> 'US' then
    raise exception 'AV-2 FAIL: rapid flip did not converge to USD/US (got %/%; stale value stuck — trigger reverted?)', v_cur, v_reg;
  end if;
  raise notice 'AV-2 PASS: USD->EUR->USD flip converged final pricing to USD/US';
end $$;

-- ── AV-3: attacker brand UPDATE sets pricing_currency DISAGREEING with
--          default_currency, WITH default_currency in the same statement —
--          the BEFORE trigger must override the attacker's pricing_currency. ────
do $$
declare v_cur text; v_reg text;
begin
  insert into public.brands (id, account_id, name, slug, default_currency)
  values ('ad333333-0000-4000-8000-000000001236',
          'ad000000-0000-4000-8000-000000001236','ORCH1236 Attacker','orch1236-attacker','eur');

  -- Attacker tries to set USD pricing on a EUR brand in the same UPDATE.
  update public.brands
     set default_currency = 'eur',          -- triggers BEFORE UPDATE OF default_currency
         pricing_currency = 'USD',          -- attacker's disagreeing value
         pricing_region   = 'US'
   where id = 'ad333333-0000-4000-8000-000000001236';

  select pricing_currency, pricing_region into v_cur, v_reg
    from public.brands where id='ad333333-0000-4000-8000-000000001236';
  if v_cur <> 'EUR' or v_reg <> 'EU' then
    raise exception 'AV-3 FAIL: BEFORE trigger did not override attacker pricing (got %/%; expected EUR/EU — trigger reverted?)', v_cur, v_reg;
  end if;
  raise notice 'AV-3 PASS: BEFORE trigger overrode attacker pricing_currency=USD -> EUR/EU (tracks default)';
end $$;

-- ── AV-3b: OBSERVED — pure pricing_currency-only UPDATE (default_currency
--          untouched). The trigger is BEFORE UPDATE OF default_currency, so a
--          raw SQL UPDATE of ONLY pricing_currency does NOT fire it. The CI
--          strict-grep guard is what blocks this in app/edge code. We record the
--          observed DB-layer behaviour so a future change is visible; we do NOT
--          fail on it (it is by-design that the DB trigger is column-scoped and
--          the guard owns the app/edge layer). ─────────────────────────────────
do $$
declare v_cur text; v_fired boolean;
begin
  update public.brands set pricing_currency = 'CHF'
   where id = 'ad333333-0000-4000-8000-000000001236';
  select pricing_currency into v_cur from public.brands where id='ad333333-0000-4000-8000-000000001236';
  v_fired := (v_cur = 'EUR');  -- true if trigger overrode it back to default
  if v_fired then
    raise notice 'AV-3b OBSERVED: pricing_currency-only UPDATE was OVERRIDDEN to EUR (DB trigger fired on it)';
  else
    raise notice 'AV-3b OBSERVED: pricing_currency-only UPDATE PERSISTED as % — DB trigger is column-scoped (BEFORE UPDATE OF default_currency); the CI strict-grep guard blocks this in app/edge code. Documented, NOT a fail.', v_cur;
  end if;
end $$;

-- ── AV-4: unmapped currency 'CAD' on the SCA path — region stays valid ───────
do $$
declare v_cur text; v_reg text;
begin
  insert into public.brands (id, account_id, name, slug) values
   ('ad444444-0000-4000-8000-000000001236','ad000000-0000-4000-8000-000000001236','ORCH1236 CADsca','orch1236-cad-sca')
  on conflict (id) do nothing;
  -- brand floor is GB; SCA sets CAD -> region must stay 'GB' (unmapped ELSE branch),
  -- pricing_currency becomes CAD. MUST NOT violate the ('GB','US','EU','CH','NG') CHECK.
  insert into public.stripe_connect_accounts
    (brand_id, stripe_account_id, charges_enabled, payouts_enabled, default_currency)
  values ('ad444444-0000-4000-8000-000000001236','acct_adv_cad',true,true,'cad');

  select pricing_currency, pricing_region into v_cur, v_reg
    from public.brands where id='ad444444-0000-4000-8000-000000001236';
  if v_cur <> 'CAD' then
    raise exception 'AV-4 FAIL: SCA unmapped CAD not set as pricing_currency (got %)', v_cur;
  end if;
  if v_reg not in ('GB','US','EU','CH','NG') then
    raise exception 'AV-4 FAIL: unmapped-currency region escaped allowlist (got %)', v_reg;
  end if;
  raise notice 'AV-4 PASS: SCA unmapped CAD -> pricing_currency=CAD, region stayed valid (%) — no CHECK violation', v_reg;
end $$;

-- ── AV-5: checkout-shaped flow — money-row (events.currency) immutability ─────
do $$
declare v_before text; v_after text;
begin
  insert into public.events(id, currency) values
   ('ad555555-0000-4000-8000-000000001236','GBP')
  on conflict (id) do nothing;
  select md5(coalesce(string_agg(currency::text, ',' order by id),'')) into v_before from public.events;
  -- A brand re-derive (the fix's write path) must not touch events.currency.
  update public.brands set updated_at = now() where id='ad111111-0000-4000-8000-000000001236';
  insert into public.stripe_connect_accounts
    (brand_id, stripe_account_id, charges_enabled, payouts_enabled, default_currency)
  values ('ad111111-0000-4000-8000-000000001236','acct_adv_chf',true,true,'chf');
  select md5(coalesce(string_agg(currency::text, ',' order by id),'')) into v_after from public.events;
  if v_before is distinct from v_after then
    raise exception 'AV-5 FAIL: events.currency mutated by brand/SCA writes (money row not frozen)';
  end if;
  raise notice 'AV-5 PASS: events.currency byte-identical across brand+SCA writes (money rows frozen)';
end $$;

do $$ begin raise notice '[META-ORCH-1236 ADVERSARIAL] ALL ATTACK VECTORS PASSED'; end $$;

rollback;
