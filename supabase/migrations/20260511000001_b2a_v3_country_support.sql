-- B2a Path C V3 — multi-country support foundation
-- Per outputs/SPEC_B2_PATH_C_V3.md §3 + D-V3-1 (34 self-serve countries).
-- Per investigation Thread 17 (Stripe self-serve constraint: US/UK/EEA/CA/CH only).
--
-- WHY this migration exists:
-- B2a SPEC v1/v2 hardcoded UK-only (D-B2-13). Operator directive 2026-05-06: expand to all
-- self-serve Stripe Connect countries. Stripe's documented self-serve cross-border payout
-- regions are limited to US, UK, EEA (27 EU + 3 EEA-non-EU), Canada, and Switzerland — total
-- 34 countries. AU + LatAm + Asia require separate Stripe platform entities (B2c/B2d/B2e
-- future cycles).
--
-- This migration:
-- 1. Adds stripe_connect_accounts.country (ISO 3166-1 alpha-2) + default_currency (ISO 4217)
-- 2. Adds CHECK constraint enforcing country allowlist (I-PROPOSED-T enforcement at DB level)
-- 3. Backfills existing rows with country='GB', default_currency='GBP' (UK-only legacy)
-- 4. Creates stripe_country_specs reference table for per-country metadata (currency, bank
--    format, business types, KYC form). Seeded by operator-side script post-migration via
--    `GET /v1/country_specs/{country}` for each of the 34 supported codes.
-- 5. RLS on stripe_country_specs: read by all authenticated users (it's reference data,
--    not PII); write by service_role only.

-- =============================================================================
-- 1. Add country + default_currency columns to stripe_connect_accounts
-- =============================================================================

ALTER TABLE "public"."stripe_connect_accounts"
  ADD COLUMN IF NOT EXISTS "country" char(2) NULL;

ALTER TABLE "public"."stripe_connect_accounts"
  ADD COLUMN IF NOT EXISTS "default_currency" char(3) NULL;

-- Backfill existing rows (UK-only legacy per D-B2-13)
UPDATE "public"."stripe_connect_accounts"
  SET "country" = 'GB', "default_currency" = 'GBP'
  WHERE "country" IS NULL OR "default_currency" IS NULL;

-- Now make NOT NULL (after backfill)
ALTER TABLE "public"."stripe_connect_accounts"
  ALTER COLUMN "country" SET NOT NULL;

ALTER TABLE "public"."stripe_connect_accounts"
  ALTER COLUMN "default_currency" SET NOT NULL;

-- =============================================================================
-- 2. CHECK constraint enforcing 34-country allowlist (I-PROPOSED-T at DB level)
-- =============================================================================

ALTER TABLE "public"."stripe_connect_accounts"
  ADD CONSTRAINT "stripe_connect_accounts_country_allowlist_check"
  CHECK (country = ANY (ARRAY[
    'US'::char(2),  -- United States
    'GB'::char(2),  -- United Kingdom
    'CA'::char(2),  -- Canada
    'CH'::char(2),  -- Switzerland
    -- 30 EEA (27 EU + 3 EEA non-EU: IS, LI, NO):
    'AT'::char(2),  -- Austria
    'BE'::char(2),  -- Belgium
    'BG'::char(2),  -- Bulgaria
    'CY'::char(2),  -- Cyprus
    'CZ'::char(2),  -- Czech Republic
    'DE'::char(2),  -- Germany
    'DK'::char(2),  -- Denmark
    'EE'::char(2),  -- Estonia
    'ES'::char(2),  -- Spain
    'FI'::char(2),  -- Finland
    'FR'::char(2),  -- France
    'GR'::char(2),  -- Greece
    'HR'::char(2),  -- Croatia
    'HU'::char(2),  -- Hungary
    'IE'::char(2),  -- Ireland
    'IS'::char(2),  -- Iceland (EEA non-EU)
    'IT'::char(2),  -- Italy
    'LI'::char(2),  -- Liechtenstein (EEA non-EU)
    'LT'::char(2),  -- Lithuania
    'LU'::char(2),  -- Luxembourg
    'LV'::char(2),  -- Latvia
    'MT'::char(2),  -- Malta
    'NL'::char(2),  -- Netherlands
    'NO'::char(2),  -- Norway (EEA non-EU)
    'PL'::char(2),  -- Poland
    'PT'::char(2),  -- Portugal
    'RO'::char(2),  -- Romania
    'SE'::char(2),  -- Sweden
    'SI'::char(2),  -- Slovenia
    'SK'::char(2)   -- Slovakia
  ]));

COMMENT ON COLUMN "public"."stripe_connect_accounts"."country" IS
  'ISO 3166-1 alpha-2 country code. Constrained to 34-country allowlist per I-PROPOSED-T (US/UK/CA/CH + 30 EEA). Stripe self-serve cross-border payouts limited to these regions per https://docs.stripe.com/connect/cross-border-payouts.';

COMMENT ON COLUMN "public"."stripe_connect_accounts"."default_currency" IS
  'ISO 4217 currency code (3 chars uppercase). Drives KPI tile formatting in BrandPaymentsView per D-V3-18. Multi-currency response from balance.retrieve filtered to this value server-side.';

-- =============================================================================
-- 3. Reference table: stripe_country_specs (seeded post-migration via API probe)
-- =============================================================================

CREATE TABLE IF NOT EXISTS "public"."stripe_country_specs" (
  "country_code" char(2) PRIMARY KEY,
  "default_currency" char(3) NOT NULL,
  "supported_currencies" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "bank_format" text NOT NULL,
  "business_types" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "kyc_form_type" text NULL,
  "raw_country_specs" jsonb NULL,
  "fetched_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

COMMENT ON TABLE "public"."stripe_country_specs" IS
  'Reference table: per-country Stripe Connect metadata. Seeded once via operator-side probe of GET /v1/country_specs/{country} for each of the 34 supported countries. Refresh on Stripe API change via maintenance migration.';

-- RLS: read by all authenticated users (reference data, not PII)
ALTER TABLE "public"."stripe_country_specs" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users read stripe_country_specs"
  ON "public"."stripe_country_specs"
  FOR SELECT
  TO "authenticated"
  USING (true);

-- Service role bypasses RLS by default; no INSERT/UPDATE policy = service_role-only writes.

GRANT SELECT ON TABLE "public"."stripe_country_specs" TO "authenticated";
GRANT SELECT ON TABLE "public"."stripe_country_specs" TO "anon";

-- Index on country_code is implicit (PK).

COMMENT ON COLUMN "public"."stripe_country_specs"."bank_format" IS
  'Human-readable bank account format expected by Stripe for this country. Examples: "sort_code_account_number" (UK), "iban" (EEA), "routing_number_account_number" (US), "transit_institution_account" (CA), "iban" (CH). UI uses for input field hints.';

COMMENT ON COLUMN "public"."stripe_country_specs"."raw_country_specs" IS
  'Full JSONB of GET /v1/country_specs/{country} response from Stripe. Cached for forensic verification + future field extraction.';
