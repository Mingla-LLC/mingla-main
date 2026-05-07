-- B2a Path C V3 — separate stripe_external_accounts table (D-V3-6)
-- Per outputs/SPEC_B2_PATH_C_V3.md §6 + investigation Thread 20 (bank verification surface).
--
-- WHY this migration exists:
-- D-V3-6 chooses a separate table over JSONB column on stripe_connect_accounts because:
-- (a) brands can have multiple external accounts (one per currency); JSONB array is awkward
-- (b) verification status is a state machine; row-level state is cleaner than JSONB updates
-- (c) Stripe webhook events fire per external_account; UPSERT pattern matches event shape
--
-- Webhook handlers (Sub-dispatch B Phase 1) populate this table from:
--   - account.external_account.created → INSERT
--   - account.external_account.updated → UPDATE (especially status changes)
--   - account.external_account.deleted → DELETE (or soft via status='removed')
--
-- Frontend (Sub-dispatch C) reads to surface bank verification state in BrandPaymentsView.

CREATE TABLE IF NOT EXISTS "public"."stripe_external_accounts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "brand_id" uuid NOT NULL REFERENCES "public"."brands"("id") ON DELETE CASCADE,
  "stripe_account_id" text NOT NULL,
  "stripe_external_account_id" text NOT NULL UNIQUE,
  "type" text NOT NULL CHECK ("type" = ANY (ARRAY['bank_account'::text, 'card'::text])),
  "last4" text NULL,
  "currency" char(3) NOT NULL,
  "country" char(2) NOT NULL,
  "status" text NOT NULL CHECK ("status" = ANY (ARRAY[
    'verified'::text,
    'verification_pending'::text,
    'verification_failed'::text,
    'errored'::text,
    'removed'::text
  ])),
  "default_for_currency" boolean NOT NULL DEFAULT false,
  "raw_payload" jsonb NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_stripe_external_accounts_brand_id"
  ON "public"."stripe_external_accounts" ("brand_id");

CREATE INDEX IF NOT EXISTS "idx_stripe_external_accounts_stripe_account_id"
  ON "public"."stripe_external_accounts" ("stripe_account_id");

-- RLS: payments_manager-rank or above on the brand can read; service role writes.
ALTER TABLE "public"."stripe_external_accounts" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Brand admin plus can read stripe_external_accounts"
  ON "public"."stripe_external_accounts"
  FOR SELECT
  TO "authenticated"
  USING ("public"."biz_can_manage_payments_for_brand_for_caller"("brand_id"));

-- No INSERT/UPDATE/DELETE policy = service_role-only writes (webhook handlers)

GRANT SELECT ON TABLE "public"."stripe_external_accounts" TO "authenticated";

COMMENT ON TABLE "public"."stripe_external_accounts" IS
  'External accounts (bank accounts, debit cards) associated with stripe_connect_accounts. One row per Stripe external_account_id. Populated by webhook router from account.external_account.{created,updated,deleted} events. Per D-V3-6.';

COMMENT ON COLUMN "public"."stripe_external_accounts"."status" IS
  'Verification state per Stripe. verified=usable for payouts; verification_pending=Stripe verifying; verification_failed=bank rejected (UI surfaces re-verify CTA); errored=Stripe API error; removed=external_account.deleted webhook fired.';

COMMENT ON COLUMN "public"."stripe_external_accounts"."default_for_currency" IS
  'Stripe flag indicating this account is the default destination for its currency. UI displays the default for brand.default_currency.';

COMMENT ON COLUMN "public"."stripe_external_accounts"."raw_payload" IS
  'Full JSONB of the Stripe external_account object from the most recent webhook event. Cached for forensic verification + dispute investigation.';
