-- Issue #3645 — remember the payout country a host picked.
--
-- WHAT WAS MISSING. A host picks a payout country (brand creation, the inline
-- "choose your payout country" prompt, bank setup). Only the CURRENCY of that
-- pick was saved (`brands.default_currency`). On the next visit the country
-- was guessed back from the currency: a host who picked Ireland was shown
-- "Choose a country · prices in EUR", or the country of the brand's address.
--
-- WHAT THIS ADDS. One nullable column, `brands.payout_country`, holding the
-- ISO 3166-1 alpha-2 code of the country the host picked.
--
-- IT IS DISPLAY-ONLY. It answers one question: "which country row does the
-- payout-country picker show for this brand". Nothing may read it to decide
-- tax, a payment rail, a currency or an address:
--   * `country_code` stays the brand's ADDRESS country;
--   * `payment_country` stays the input to VAT (and is not touched here);
--   * `payment_provider` / `default_currency` stay the rail and the currency.
-- No function, trigger, view or policy reads the new column.
--
-- NO BACKFILL. Existing rows stay NULL and keep today's derivation from the
-- currency. Guessing a country for them is exactly the fault being fixed.
--
-- WHO WRITES IT. The signed-in host's app, with the same direct brand update
-- that already writes `default_currency` (RLS: account owner or brand admin).
-- Table privileges on `public.brands` are table-wide, so the new column needs
-- no grant of its own.

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.brands
  ADD COLUMN IF NOT EXISTS payout_country text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.brands'::regclass
      AND conname = 'brands_payout_country_iso2'
  ) THEN
    ALTER TABLE public.brands
      ADD CONSTRAINT brands_payout_country_iso2
      CHECK (payout_country IS NULL OR payout_country ~ '^[A-Z]{2}$');
  END IF;
END;
$$;

COMMENT ON COLUMN public.brands.payout_country IS
  'Issue #3645: ISO 3166-1 alpha-2 code of the payout country the host PICKED. Display-only: it tells the payout-country picker which row to show. Never an input to tax, payment rail, currency or address (see country_code, payment_country, payment_provider, default_currency). NULL = no recorded pick; the app derives the row from the currency as before.';

-- Verify.
DO $$
DECLARE v_type text; v_nullable text;
BEGIN
  SELECT data_type, is_nullable INTO v_type, v_nullable
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'brands'
     AND column_name = 'payout_country';
  IF v_type IS DISTINCT FROM 'text' OR v_nullable IS DISTINCT FROM 'YES' THEN
    RAISE EXCEPTION 'issue_3645_verify: brands.payout_country is not a nullable text column';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.brands'::regclass
      AND conname = 'brands_payout_country_iso2'
  ) THEN
    RAISE EXCEPTION 'issue_3645_verify: brands_payout_country_iso2 is missing';
  END IF;
  -- Nothing in the database may depend on the column.
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('public', 'private') AND p.prokind = 'f'
      AND p.prosrc ~ '\mpayout_country\M'
  ) THEN
    RAISE EXCEPTION 'issue_3645_verify: a function reads brands.payout_country; it is display-only';
  END IF;
END;
$$;

COMMIT;
