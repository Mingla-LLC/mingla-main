-- ORCH-0953 §3.9: Connect inventory reconciliation probe.
-- Run as service role. Read-only. No mutations.
-- Operator manually fetches the live connected-account list from Stripe Dashboard
-- (Connect -> Accounts, filter by live) and inserts into a temp table:
--   CREATE TEMP TABLE _live_stripe_accounts(stripe_account_id text PRIMARY KEY);
--   INSERT INTO _live_stripe_accounts(stripe_account_id) VALUES ('acct_...');

-- (A) Mingla rows with NO matching live Stripe account (orphan in Supabase)
SELECT
  s.stripe_account_id,
  s.brand_id,
  b.name AS brand_name,
  s.charges_enabled,
  s.payouts_enabled,
  s.detached_at
FROM public.stripe_connect_accounts s
LEFT JOIN public.brands b ON b.id = s.brand_id
LEFT JOIN _live_stripe_accounts l ON l.stripe_account_id = s.stripe_account_id
WHERE l.stripe_account_id IS NULL
  AND s.detached_at IS NULL;

-- (B) Live Stripe accounts with NO Mingla row (orphan in Stripe)
SELECT l.stripe_account_id
FROM _live_stripe_accounts l
LEFT JOIN public.stripe_connect_accounts s
  ON s.stripe_account_id = l.stripe_account_id
 AND s.detached_at IS NULL
WHERE s.stripe_account_id IS NULL;

-- (C) Multi-brand mapping: any stripe_account_id mapped to >1 active brand row
SELECT stripe_account_id, COUNT(*) AS active_rows
FROM public.stripe_connect_accounts
WHERE detached_at IS NULL
GROUP BY stripe_account_id
HAVING COUNT(*) > 1;
