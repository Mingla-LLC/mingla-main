-- #4402 — Seth (2026-11-13): the NGN minimum creator fee is ₦100, not ₦5,000,
-- so a real end-to-end TEST hire can always run at the smallest price.
-- USD / EUR / GBP minimums are unchanged; other currencies still have none.
-- Only the NGN constant changes; every caller of issue_4402_gig_min_fee_minor
-- (gig_save, offers, counters, interest prices, gig_host_home) follows it.
-- Proof: __tests__/issue_4402_polish_min_fee_and_interest_edit.implementor.pg17.test.sql
BEGIN;
SET LOCAL lock_timeout = '10s';

CREATE OR REPLACE FUNCTION public.issue_4402_gig_min_fee_minor(p_currency text) RETURNS bigint
LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $fn$
  -- Invariant (declared in its test): I-4402-FEE-1 | issue #4402 | no gig budget, offer, counter or interest price below the currency minimum
  SELECT CASE upper(btrim(coalesce(p_currency,'')))
    WHEN 'NGN' THEN 10000::bigint
    WHEN 'USD' THEN 1000::bigint
    WHEN 'EUR' THEN 1000::bigint
    WHEN 'GBP' THEN 1000::bigint
    ELSE NULL END
$fn$;
REVOKE ALL ON FUNCTION public.issue_4402_gig_min_fee_minor(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4402_gig_min_fee_minor(text) TO service_role;

COMMIT;
