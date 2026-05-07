-- B2a Stripe Connect onboarding — additive migration
-- See Mingla_Artifacts/specs/SPEC_BIZ_CYCLE_B2A_STRIPE_CONNECT_ONBOARDING.md §4.1
--
-- Wires the real Stripe Connect onboarding flow on top of the §B.6 schema
-- already migrated in baseline-squash 2026-05-05. Six additive changes:
--   1. detached_at column on stripe_connect_accounts (additive prep for B2b)
--   2. payouts.status_check enum extension (in_transit + canceled emitted by Stripe webhooks)
--   3. idx for payment_webhook_events.created_at (cron retry queries)
--   4. table comment on payment_webhook_events documenting RLS-without-policy intent (HF-1 fix)
--   5. SQL helper pg_derive_brand_stripe_status returning 4-state enum
--   6. trigger function tg_sync_brand_stripe_cache mirroring stripe_connect_accounts → brands.stripe_*
--
-- Triggers I-PROPOSED-K: brands.stripe_* are denormalized cache mirrored ONLY by trigger.
-- Direct app-code writes to brands.stripe_* are forbidden post-B2a CLOSE.

-- =============================================================================
-- 1. Additive column for B2b detach flow (no read/write in B2a)
-- =============================================================================

ALTER TABLE "public"."stripe_connect_accounts"
  ADD COLUMN IF NOT EXISTS "detached_at" timestamp with time zone NULL;

COMMENT ON COLUMN "public"."stripe_connect_accounts"."detached_at" IS
  'NULL while account is active; set by B2b detach flow when brand admin disconnects Stripe. B2a writes never set this column.';

-- =============================================================================
-- 2. Extend payouts.status_check enum (Stripe emits in_transit + canceled)
-- =============================================================================

ALTER TABLE "public"."payouts"
  DROP CONSTRAINT IF EXISTS "payouts_status_check";

ALTER TABLE "public"."payouts"
  ADD CONSTRAINT "payouts_status_check"
  CHECK (status = ANY (ARRAY['pending'::text, 'paid'::text, 'failed'::text, 'in_transit'::text, 'canceled'::text]));

-- =============================================================================
-- 3. Index for cron retry queries on stuck webhook rows
-- =============================================================================

CREATE INDEX IF NOT EXISTS "idx_payment_webhook_events_created_at"
  ON "public"."payment_webhook_events" USING "btree" ("created_at");

-- =============================================================================
-- 4. Document service-role-only RLS pattern on payment_webhook_events (HF-1)
-- =============================================================================

COMMENT ON TABLE "public"."payment_webhook_events" IS
  'Idempotent Stripe webhook inbox. RLS enabled with NO POLICY by design — service role only. Do NOT add RLS policies; service role bypasses RLS. Application/authenticated callers have no access by intent.';

-- =============================================================================
-- 5. SQL helper: derive brand stripe status from canonical stripe_connect_accounts
-- =============================================================================
-- Returns one of (not_connected, onboarding, active, restricted)
-- TS twin lives in mingla-business/src/utils/deriveBrandStripeStatus.ts;
-- both must stay byte-for-byte equivalent (verified by unit tests).

CREATE OR REPLACE FUNCTION "public"."pg_derive_brand_stripe_status"("p_brand_id" "uuid")
RETURNS "text"
LANGUAGE "sql" STABLE SECURITY DEFINER
SET "search_path" TO 'public', 'pg_temp'
AS $$
  SELECT COALESCE(
    (
      SELECT
        CASE
          WHEN sca.detached_at IS NOT NULL THEN 'not_connected'::text
          WHEN sca.charges_enabled = true THEN 'active'::text
          WHEN sca.requirements ? 'disabled_reason'
            AND (sca.requirements->>'disabled_reason') IS NOT NULL
            THEN 'restricted'::text
          ELSE 'onboarding'::text
        END
      FROM public.stripe_connect_accounts sca
      WHERE sca.brand_id = p_brand_id
      LIMIT 1
    ),
    'not_connected'::text
  );
$$;

ALTER FUNCTION "public"."pg_derive_brand_stripe_status"("p_brand_id" "uuid") OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."pg_derive_brand_stripe_status"("p_brand_id" "uuid") FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."pg_derive_brand_stripe_status"("p_brand_id" "uuid") TO "anon";
GRANT EXECUTE ON FUNCTION "public"."pg_derive_brand_stripe_status"("p_brand_id" "uuid") TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."pg_derive_brand_stripe_status"("p_brand_id" "uuid") TO "service_role";

COMMENT ON FUNCTION "public"."pg_derive_brand_stripe_status"("p_brand_id" "uuid") IS
  'Returns brand.stripeStatus enum (not_connected, onboarding, active, restricted). Per SPEC_BIZ_CYCLE_B2A_STRIPE_CONNECT_ONBOARDING.md §4.1.1 + DEC-15. TS twin at mingla-business/src/utils/deriveBrandStripeStatus.ts must stay byte-for-byte equivalent.';

-- =============================================================================
-- 6. Trigger function: mirror stripe_connect_accounts → brands.stripe_* cache
-- =============================================================================
-- D-B2-3 cache pattern: stripe_connect_accounts is canonical; brands.stripe_*
-- columns are denormalized cache mirrored ONLY by this trigger.
--
-- I-PROPOSED-K (DRAFT post-B2a CLOSE): direct app-code writes to brands.stripe_*
-- are FORBIDDEN. CI grep gate enforces structurally.

CREATE OR REPLACE FUNCTION "public"."tg_sync_brand_stripe_cache"()
RETURNS "trigger"
LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO 'public', 'pg_temp'
AS $$
BEGIN
  -- On INSERT or UPDATE of stripe_connect_accounts, mirror canonical state
  -- to brands.stripe_* denormalized cache. This is the ONLY code path that
  -- writes those columns post-B2a CLOSE per I-PROPOSED-K.
  UPDATE public.brands
  SET
    stripe_connect_id = NEW.stripe_account_id,
    stripe_charges_enabled = NEW.charges_enabled,
    stripe_payouts_enabled = NEW.payouts_enabled
  WHERE id = NEW.brand_id;

  RETURN NEW;
END;
$$;

ALTER FUNCTION "public"."tg_sync_brand_stripe_cache"() OWNER TO "postgres";

CREATE OR REPLACE TRIGGER "trg_sync_brand_stripe_cache"
  AFTER INSERT OR UPDATE ON "public"."stripe_connect_accounts"
  FOR EACH ROW
  EXECUTE FUNCTION "public"."tg_sync_brand_stripe_cache"();

COMMENT ON TRIGGER "trg_sync_brand_stripe_cache" ON "public"."stripe_connect_accounts" IS
  'Mirrors charges_enabled/payouts_enabled/stripe_account_id to brands.stripe_* denormalized cache per D-B2-3. App code MUST NOT write brands.stripe_* directly (I-PROPOSED-K).';
