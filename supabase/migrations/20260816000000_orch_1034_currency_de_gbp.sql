-- ORCH-1034 [de-GBP-ify the currency layer — charge in seller currency]
--
-- Aligns brands.pricing_currency to the brand's real Stripe-synced settlement
-- currency (brands.default_currency) and derives brands.pricing_region from it,
-- so cart/checkout charges each seller in their own currency (zero Stripe FX)
-- with region-correct tax behaviour. Replaces ORCH-1006's GBP/GB hard-lock.
--
-- SPEC: Mingla_Artifacts/specs/SPEC_ORCH-1034_CURRENCY_DE_GBP.md §5.A.
-- Tax tie-in: Mingla_Artifacts/reports/INVESTIGATION_ORCH-1034_TAX_TIE_IN.md
--   (Stripe Tax owns the venue-based AMOUNT; region only picks the display
--    tax_behavior flag — no VAT math here).
--
-- SAFE-MIGRATION (operator-locked decisions, 2026-06-01):
--   D1: the 21 NULL-default_currency brands (verified: all have ZERO Stripe
--       Connect account, cannot transact) are LEFT NULL — every UPDATE is gated
--       `WHERE default_currency IS NOT NULL`, so the migration cannot abort on
--       them and never fabricates a currency. Their pricing_currency/region keep
--       their NOT-NULL defaults ('GBP'/'GB'); they can never charge anyway.
--   D2: DROP the GBP-only pricing_currency CHECK entirely (currency is validated
--       by Stripe at charge time); WIDEN the region CHECK to the enabled set
--       ('GB','US','EU','CH') rather than dropping it (keep a guard).
--   D3: tax_behavior is a thin per-region DISPLAY flag (engine), NOT VAT math.
--
-- Idempotent: re-running is a no-op (IS DISTINCT FROM guards; IF [NOT] EXISTS
-- constraint swaps). Touches ONLY two config columns on brands — no money rows
-- (events/orders/ticket_types.currency) are rewritten, so no order-protection
-- predicate is required.
--
-- NOTE: default_currency is a `character` (fixed-length CHAR) column, so its
-- ::text cast can carry trailing spaces — we trim() before upper() defensively.

BEGIN;

-- ─── 1. Drop the GBP-only currency CHECK (currency validated by Stripe at charge) ───
ALTER TABLE public.brands
  DROP CONSTRAINT IF EXISTS brands_pricing_currency_allowlist;

-- ─── 2. Widen the region CHECK to the enabled-region allowlist (D2/DECISION-3) ───
ALTER TABLE public.brands
  DROP CONSTRAINT IF EXISTS brands_pricing_region_allowlist;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'brands_pricing_region_allowlist'
  ) THEN
    ALTER TABLE public.brands
      ADD CONSTRAINT brands_pricing_region_allowlist
      CHECK (pricing_region IN ('GB','US','EU','CH'));  -- enabled set (DECISION-2)
  END IF;
END$$;

-- ─── 3. Align pricing_currency := default_currency for non-NULL brands ───
--    NULL-tolerant (the 21 NULL-default brands are never read for write).
--    Idempotent: re-running is a no-op once aligned.
UPDATE public.brands
   SET pricing_currency = upper(trim(default_currency::text)),
       updated_at       = now()
 WHERE default_currency IS NOT NULL
   AND upper(trim(default_currency::text)) IS DISTINCT FROM pricing_currency;

-- ─── 4. Derive pricing_region from currency for non-NULL brands (DECISION-2) ───
--    GBP→GB, USD→US, EUR→EU, CHF→CH. Unmapped currencies leave region as-is
--    (no abort). The widened CHECK in step 2 keeps region inside the enabled set.
UPDATE public.brands
   SET pricing_region = CASE upper(trim(default_currency::text))
                          WHEN 'GBP' THEN 'GB'
                          WHEN 'USD' THEN 'US'
                          WHEN 'EUR' THEN 'EU'
                          WHEN 'CHF' THEN 'CH'
                          ELSE pricing_region        -- leave unmapped as-is
                        END,
       updated_at = now()
 WHERE default_currency IS NOT NULL
   AND upper(trim(default_currency::text)) IN ('GBP','USD','EUR','CHF')
   AND pricing_region IS DISTINCT FROM (
         CASE upper(trim(default_currency::text))
           WHEN 'GBP' THEN 'GB'
           WHEN 'USD' THEN 'US'
           WHEN 'EUR' THEN 'EU'
           WHEN 'CHF' THEN 'CH'
           ELSE pricing_region
         END);

COMMIT;
