-- B2a Path C V3 — application_fee revenue mirror for webhook router
-- Sub-dispatch B support migration: V3 SPEC §6 requires application_fee.created
-- and application_fee.refunded to persist Mingla platform revenue rows.

CREATE TABLE IF NOT EXISTS "public"."mingla_revenue_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "stripe_application_fee_id" text NOT NULL UNIQUE,
  "stripe_account_id" text NULL,
  "brand_id" uuid NULL REFERENCES "public"."brands"("id") ON DELETE SET NULL,
  "amount_cents" integer NOT NULL DEFAULT 0,
  "currency" char(3) NOT NULL DEFAULT 'GBP',
  "refunded_amount_cents" integer NOT NULL DEFAULT 0,
  "refunded" boolean NOT NULL DEFAULT false,
  "raw_payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_mingla_revenue_log_brand_id"
  ON "public"."mingla_revenue_log" ("brand_id")
  WHERE "brand_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_mingla_revenue_log_stripe_account_id"
  ON "public"."mingla_revenue_log" ("stripe_account_id")
  WHERE "stripe_account_id" IS NOT NULL;

ALTER TABLE "public"."mingla_revenue_log" ENABLE ROW LEVEL SECURITY;

-- Service role writes via stripe-webhook. No authenticated read surface ships in
-- Sub-dispatch B; admin/reporting access is a future scoped surface.
--
-- Sub-dispatch C amendment A5 follow-up: add explicit policies. Service role
-- bypasses RLS by default (Supabase contract) but explicit denies for
-- authenticated/anon roles harden against future role escalations or
-- accidental policy permissive-by-default flips.

-- Authenticated users: no read, no write.
-- (Future admin reporting surface will add a separate role-scoped SELECT
-- policy — out of V3 scope; track as C-13 follow-up per SPEC §13 A5.)
CREATE POLICY "mingla_revenue_log_no_authenticated_read"
  ON "public"."mingla_revenue_log"
  FOR SELECT
  TO authenticated
  USING (false);

CREATE POLICY "mingla_revenue_log_no_authenticated_write"
  ON "public"."mingla_revenue_log"
  FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);

-- Anon: no access at all (no public exposure of platform revenue).
CREATE POLICY "mingla_revenue_log_no_anon"
  ON "public"."mingla_revenue_log"
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

-- service_role bypasses RLS by default (Supabase contract); the stripe-webhook
-- edge fn writes as service_role and is unaffected by these deny policies.

COMMENT ON TABLE "public"."mingla_revenue_log" IS
  'Stripe application_fee revenue mirror populated by stripe-webhook application_fee.{created,refunded} events per B2a Path C V3 §6. RLS-locked: service-role only.';
