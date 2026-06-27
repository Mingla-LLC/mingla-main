-- META-ORCH-1236 [live-currency charge-in-wrong-currency fix]
-- brands.pricing_currency / brands.pricing_region MUST track brands.default_currency
-- ============================================================================
-- ROOT CAUSE (proven — INVESTIGATION_META-ORCH-1236_LIVE_CURRENCY_PAYMENT_INTENT.md):
--   brands.pricing_currency is the AUTHORITATIVE charge currency
--   (resolve_event_pricing_inputs() -> b.pricing_currency feeds both the web
--   Checkout Session and the native PaymentIntent). It carried a static SQL
--   DEFAULT of 'GBP' ('GB' for pricing_region) from ORCH-1006. The ORCH-1034
--   one-time backfill aligned the rows that existed THEN, but NO forward code
--   path keeps pricing_currency/pricing_region in step with default_currency for
--   brands created/onboarded afterward. A USD-settling brand (Smoke & Rhythm)
--   therefore kept pricing_currency='GBP' and was charged in GBP — a live £10
--   overcharge on web + a native PaymentIntent rejected 400
--   payment_intent_invalid_parameter.
--
-- THIS MIGRATION (operator-approved Approach 2 — DB single-owner trigger):
--   A. Data hotfix — re-align drifted rows (mirror ORCH-1034, + NGN). Idempotent.
--   B. Extend the canonical mirror trigger tg_sync_brand_stripe_cache() so
--      pricing_currency/pricing_region are DERIVED from default_currency in the
--      SAME write that already mirrors default_currency from the active Stripe
--      connected account (covers onboard + refresh-status, both via
--      stripe_connect_accounts) — they can never diverge again.
--   C. New BEFORE INSERT/UPDATE trigger on brands deriving pricing_currency/
--      pricing_region from default_currency for the brand-direct write path.
--
-- pricing_currency/pricing_region are DERIVED from default_currency by trigger.
-- The literal column DEFAULT 'GBP'/'GB' was the ORCH-1236 trap — NEVER
-- reintroduce a static *currency-bearing* default as the source of truth.
-- See I-PROPOSED-1236-PRICING-CURRENCY-TRACKS-DEFAULT.
--
-- OQ-3 DECISION (read-of-code, NOT guess — see implementation report):
--   EVERY brand-INSERT path (client createBrand via brandsService.ts/brandMapping.ts
--   + all 6 SECURITY DEFINER brand-create RPCs) inserts a brands row WITHOUT
--   default_currency — it lands NULL (default_currency's NOT NULL + DEFAULT were
--   both dropped in 20260515000011). default_currency is populated ONLY later by
--   the Stripe sync trigger. The BEFORE trigger below only derives when
--   default_currency IS NOT NULL, so it does NOT satisfy the NOT-NULL constraint
--   on pricing_currency/pricing_region for a NULL-default brand. Therefore the
--   'GBP'/'GB' column DEFAULTS are KEPT as the NOT-NULL floor for non-transacting
--   brands (no Stripe account, default_currency NULL, can never charge). This is
--   the SAME D1 decision as ORCH-1034 (the 21 NULL-default brands keep their
--   floor). Dropping the defaults would break brand creation, so they are NOT
--   dropped (SPEC §4.A.2 Option (b)).
--
-- SAFE-MIGRATION:
--   - Monotonic prefix: highest existing across anchor + all active worktrees +
--     origin/main = 20261126000002; this uses 20261127000000 (strictly greater).
--   - Idempotent DDL: CREATE OR REPLACE FUNCTION / DROP TRIGGER IF EXISTS /
--     CREATE TRIGGER. Re-runnable.
--   - The data UPDATEs are NULL-tolerant (WHERE default_currency IS NOT NULL) and
--     IS DISTINCT FROM-gated, so a re-run changes 0 rows and never aborts.
--   - Touches ONLY brands config columns (pricing_currency, pricing_region,
--     updated_at) + two trigger functions. NO money rows
--     (events.currency / ticket_types.currency / orders.currency) are rewritten.
--
-- Cites: charging in the connected account's settlement currency avoids Stripe
--   FX — https://docs.stripe.com/connect/charges ; PaymentIntent currency param —
--   https://docs.stripe.com/api/payment_intents/create .

BEGIN;

-- ───────────────────────────────────────────────────────────────────────────
-- A. DATA HOTFIX — re-align drifted rows (mirror ORCH-1034 exactly; +NGN; idempotent)
-- ───────────────────────────────────────────────────────────────────────────
-- A.1 — pricing_currency := upper(trim(default_currency)) for non-NULL brands.
--       NULL-default brands keep their floor (cannot transact). IS DISTINCT FROM
--       gate makes a re-run a no-op. Live impact today: exactly 1 row
--       (Smoke & Rhythm GBP->USD).
UPDATE public.brands
   SET pricing_currency = upper(trim(default_currency::text)),
       updated_at       = now()
 WHERE default_currency IS NOT NULL
   AND upper(trim(default_currency::text)) IS DISTINCT FROM pricing_currency;

-- A.2 — pricing_region derived from currency (GBP->GB, USD->US, EUR->EU,
--       CHF->CH, NGN->NG). NGN->NG is NEW vs ORCH-1034 (region allowlist already
--       includes NG since 20260915000000). Unmapped currencies leave region as-is
--       (cannot violate the ('GB','US','EU','CH','NG') CHECK). IS DISTINCT FROM-gated.
UPDATE public.brands
   SET pricing_region = CASE upper(trim(default_currency::text))
                          WHEN 'GBP' THEN 'GB'
                          WHEN 'USD' THEN 'US'
                          WHEN 'EUR' THEN 'EU'
                          WHEN 'CHF' THEN 'CH'
                          WHEN 'NGN' THEN 'NG'   -- NEW vs ORCH-1034
                          ELSE pricing_region
                        END,
       updated_at = now()
 WHERE default_currency IS NOT NULL
   AND upper(trim(default_currency::text)) IN ('GBP','USD','EUR','CHF','NGN')
   AND pricing_region IS DISTINCT FROM (
         CASE upper(trim(default_currency::text))
           WHEN 'GBP' THEN 'GB'
           WHEN 'USD' THEN 'US'
           WHEN 'EUR' THEN 'EU'
           WHEN 'CHF' THEN 'CH'
           WHEN 'NGN' THEN 'NG'
           ELSE pricing_region
         END);

-- ───────────────────────────────────────────────────────────────────────────
-- B. EXTEND the canonical mirror trigger tg_sync_brand_stripe_cache()
--    (the structural single-owner fix — fires AFTER INSERT OR UPDATE ON
--    stripe_connect_accounts; covers onboard + refresh-status).
--
--    Preserves EVERY existing clause/COMMENT/SECURITY DEFINER/search_path from
--    20260515000009_orch_0769_app_wide_currency.sql L96-119; ADDS the two derived
--    columns keyed off the SAME resolved default_currency, in the SAME UPDATE, so
--    pricing_currency/pricing_region are written atomically with default_currency
--    and can never drift. Detach branch mirrors the existing default_currency
--    rule: on detach, DO NOT reset commerce currency (ORCH-0769 detach semantics).
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION "public"."tg_sync_brand_stripe_cache"()
RETURNS "trigger"
LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO 'public', 'pg_temp'
AS $$
BEGIN
  UPDATE public.brands
  SET
    stripe_connect_id =
      CASE WHEN NEW.detached_at IS NOT NULL THEN NULL ELSE NEW.stripe_account_id END,
    stripe_charges_enabled =
      CASE WHEN NEW.detached_at IS NOT NULL THEN false ELSE NEW.charges_enabled END,
    stripe_payouts_enabled =
      CASE WHEN NEW.detached_at IS NOT NULL THEN false ELSE NEW.payouts_enabled END,
    default_currency =
      CASE
        WHEN NEW.detached_at IS NOT NULL THEN brands.default_currency
        ELSE upper(NEW.default_currency::text)::char(3)
      END,
    -- META-ORCH-1236: derive the authoritative charge currency from the SAME
    -- active-SCA currency, in the SAME write. Detach leaves commerce currency
    -- intact (mirrors the default_currency rule above). When the active SCA has
    -- no currency yet, leave the prior value (the floor/last-known).
    pricing_currency =
      CASE
        WHEN NEW.detached_at IS NOT NULL THEN brands.pricing_currency
        WHEN NEW.default_currency IS NOT NULL
          THEN upper(trim(NEW.default_currency::text))
        ELSE brands.pricing_currency
      END,
    pricing_region =
      CASE
        WHEN NEW.detached_at IS NOT NULL THEN brands.pricing_region
        WHEN NEW.default_currency IS NOT NULL THEN (
          CASE upper(trim(NEW.default_currency::text))
            WHEN 'GBP' THEN 'GB'
            WHEN 'USD' THEN 'US'
            WHEN 'EUR' THEN 'EU'
            WHEN 'CHF' THEN 'CH'
            WHEN 'NGN' THEN 'NG'
            ELSE brands.pricing_region   -- unmapped: leave as-is (no CHECK violation)
          END)
        ELSE brands.pricing_region
      END
  WHERE id = NEW.brand_id;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION "public"."tg_sync_brand_stripe_cache"() IS
  'ORCH-0769 + META-ORCH-1236: mirrors stripe_connect_accounts to brands Stripe cache and syncs active SCA default_currency into brands.default_currency; ALSO derives brands.pricing_currency (= upper(default_currency)) and brands.pricing_region (GBP->GB, USD->US, EUR->EU, CHF->CH, NGN->NG) from the SAME active-SCA currency in the same write so the charge currency can never drift; detach clears Stripe cache without resetting brand commerce/pricing currency.';

-- ───────────────────────────────────────────────────────────────────────────
-- C. NEW BEFORE INSERT/UPDATE trigger on brands — closes the brand-direct write
--    hole (a brand created/updated with default_currency set directly, e.g. a
--    future create path, admin, or RPC). Derives pricing_currency/pricing_region
--    from NEW.default_currency whenever it is present. Idempotent + convergent
--    with the SCA mirror (both derive the same value; a BEFORE trigger does not
--    re-enter on the same statement, so no loop with the SCA-driven brands UPDATE).
--
--    NULL default_currency: leave the columns alone (keep their NOT-NULL floor
--    default / prior value). This is why the 'GBP'/'GB' column DEFAULTS are KEPT
--    (OQ-3 — every brand-INSERT path inserts default_currency NULL).
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_brands_derive_pricing_from_default()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.default_currency IS NOT NULL THEN
    NEW.pricing_currency := upper(trim(NEW.default_currency::text));
    NEW.pricing_region := CASE upper(trim(NEW.default_currency::text))
        WHEN 'GBP' THEN 'GB'
        WHEN 'USD' THEN 'US'
        WHEN 'EUR' THEN 'EU'
        WHEN 'CHF' THEN 'CH'
        WHEN 'NGN' THEN 'NG'
        ELSE COALESCE(NEW.pricing_region, 'GB')  -- unmapped: keep provided / floor
      END;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.tg_brands_derive_pricing_from_default() IS
  'META-ORCH-1236: BEFORE INSERT/UPDATE OF default_currency on brands — derives pricing_currency/pricing_region from default_currency so the brand-direct write path can never set a charge currency that disagrees with the commerce default. Convergent with tg_sync_brand_stripe_cache (the SCA mirror). NULL default_currency leaves the columns at their floor.';

DROP TRIGGER IF EXISTS trg_brands_derive_pricing_from_default ON public.brands;
CREATE TRIGGER trg_brands_derive_pricing_from_default
  BEFORE INSERT OR UPDATE OF default_currency ON public.brands
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_brands_derive_pricing_from_default();

COMMIT;
