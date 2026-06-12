-- ORCH-1116 — TESTER ADVERSARIAL regression test (different angle than the
-- implementor's happy-path G-01 anon true-positive).
--
-- ANGLE: the SECURITY-BOUNDARY combined invariant. The implementor's G-01
-- attacks the happy-path (ready brand -> anon gets TRUE). This test attacks the
-- thing Seth cares most about for THIS fix: the SECURITY DEFINER change must NOT
-- have blanket-opened the gate NOR leaked any stripe_connect_accounts row data.
-- It asserts, IN ONE anon session, ALL of:
--   (A) the batched resolver pg_brands_can_charge() returns the CORRECT SUBSET
--       of a mixed [ready, charges_off, no_account] array — exactly {ready},
--       never the not-ready ids (true-NEGATIVE preserved under the batch path,
--       the over-correction angle), AND
--   (B) that same anon caller — who just received a positive boolean for the
--       ready brand — STILL sees ZERO rows when it SELECTs the base
--       stripe_connect_accounts table directly, AND cannot read ANY protected
--       column value (stripe_account_id / charges_enabled / payouts_enabled),
--       proving the DEFINER fix grants only the derived bit, not row access.
-- If the fix is reverted to SECURITY INVOKER, (A) collapses: the batched
-- resolver returns the EMPTY set under anon (RLS hides every row) -> the
-- `= ARRAY[v_ready]` assertion fails -> the test RAISEs. fails-on-revert holds
-- on a DIFFERENT assertion than G-01 (subset-equality vs scalar IS TRUE).
-- If a future change blanket-opens the gate, (A) also fails (not-ready ids leak
-- into the subset). If a future change exposes the base table, (B) fails.
--
-- WRITE-SAFE: seeds fixtures as the migration superuser inside a single
-- BEGIN…ROLLBACK; wraps ONLY the anon assertions in SET LOCAL ROLE anon. No
-- fixture survives. Seeds the FULL live-schema column set the implementor's
-- fixtures omitted (brands.account_id -> creator_accounts -> auth.users;
-- stripe_connect_accounts.country + default_currency are NOT NULL) so the test
-- actually runs against the production schema.
--
-- Covers SPEC §5 SC-2 / SC-4 / SC-5 from the adversarial security boundary.

\set ON_ERROR_STOP on

BEGIN;
DO $$
DECLARE
  v_user uuid := gen_random_uuid();
  v_acct uuid;
  v_ready uuid;
  v_charges_off uuid;
  v_no_account uuid;
  v_subset uuid[];
  v_visible_rows bigint;
  v_leaked_cols bigint;
BEGIN
  -- ── Seed the FK chain the live schema requires (the gap the implementor's
  --    fixtures missed): auth.users -> creator_accounts -> brands.account_id ──
  INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  VALUES (v_user, '00000000-0000-0000-0000-000000000000', 'authenticated',
          'authenticated', 'orch1116-adv-' || v_user || '@example.test', now(), now());
  INSERT INTO public.creator_accounts (id) VALUES (v_user) RETURNING id INTO v_acct;

  -- ready: attached, non-detached, non-null acct id, charges_enabled = true
  INSERT INTO public.brands (id, account_id, slug, name, default_currency, created_at, updated_at)
  VALUES (gen_random_uuid(), v_acct, 'orch1116-adv-ready', 'adv ready', 'USD', now(), now())
  RETURNING id INTO v_ready;
  INSERT INTO public.stripe_connect_accounts
    (brand_id, stripe_account_id, charges_enabled, detached_at, country, default_currency, created_at, updated_at)
  VALUES (v_ready, 'acct_orch1116_adv_ready', true, NULL, 'US', 'usd', now(), now());

  -- charges_off: attached but charges_enabled = false (true-negative shape)
  INSERT INTO public.brands (id, account_id, slug, name, default_currency, created_at, updated_at)
  VALUES (gen_random_uuid(), v_acct, 'orch1116-adv-off', 'adv off', 'USD', now(), now())
  RETURNING id INTO v_charges_off;
  INSERT INTO public.stripe_connect_accounts
    (brand_id, stripe_account_id, charges_enabled, detached_at, country, default_currency, created_at, updated_at)
  VALUES (v_charges_off, 'acct_orch1116_adv_off', false, NULL, 'US', 'usd', now(), now());

  -- no_account: brand with no stripe_connect_accounts row at all
  INSERT INTO public.brands (id, account_id, slug, name, default_currency, created_at, updated_at)
  VALUES (gen_random_uuid(), v_acct, 'orch1116-adv-noacct', 'adv noacct', 'USD', now(), now())
  RETURNING id INTO v_no_account;

  -- ── (A) batched correct-subset under anon (true-negative preserved on the
  --        batch path) + (B) no-row-leak in the SAME anon session ────────────
  SET LOCAL ROLE anon;

  SELECT array_agg(brand_id ORDER BY brand_id)
    INTO v_subset
    FROM public.pg_brands_can_charge(ARRAY[v_ready, v_charges_off, v_no_account]::uuid[]);

  -- The same anon caller tries to read the base table directly.
  SELECT count(*) INTO v_visible_rows
    FROM public.stripe_connect_accounts
   WHERE brand_id IN (v_ready, v_charges_off);

  -- And tries to read ANY protected column value for the ready brand.
  SELECT count(*) INTO v_leaked_cols
    FROM public.stripe_connect_accounts
   WHERE brand_id = v_ready
     AND (stripe_account_id IS NOT NULL OR charges_enabled IS NOT NULL OR payouts_enabled IS NOT NULL);

  RESET ROLE;

  -- ── Assertions ──────────────────────────────────────────────────────────
  -- (A) subset is EXACTLY {ready}: not empty (would mean the INVOKER bug is
  --     back), not containing charges_off / no_account (would mean over-open).
  IF v_subset IS DISTINCT FROM ARRAY[v_ready] THEN
    RAISE EXCEPTION 'ADV-A FAIL: anon batched resolver returned % for [ready, charges_off, no_account] (expected exactly {%}). Empty => the ORCH-1116 SECURITY-INVOKER booking-gate bug is back; extra ids => the gate was blanket-opened.', v_subset, v_ready;
  END IF;

  -- (B) zero base-table rows visible to anon despite the positive boolean.
  IF v_visible_rows <> 0 THEN
    RAISE EXCEPTION 'ADV-B FAIL: anon can directly SELECT % stripe_connect_accounts row(s) (expected 0). The DEFINER fix leaked base-table access — Stripe account data exposed to the anonymous internet.', v_visible_rows;
  END IF;
  IF v_leaked_cols <> 0 THEN
    RAISE EXCEPTION 'ADV-B FAIL: anon read % protected column value(s) (stripe_account_id/charges_enabled/payouts_enabled) for the ready brand (expected 0).', v_leaked_cols;
  END IF;

  RAISE NOTICE 'ORCH-1116 tester-adversarial PASS: anon batched subset = {ready} only (true-negative preserved on the batch path) AND anon sees 0 base-table rows / 0 leaked columns (no row leak).';
END$$;
ROLLBACK;
