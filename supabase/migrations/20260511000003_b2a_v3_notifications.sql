-- B2a Path C V3 — extend existing notifications table for V3 + create notification_preferences (D-V3-2)
-- Per outputs/SPEC_B2_PATH_C_V3.md §6 + investigation Thread 28.
--
-- WHY THIS MIGRATION CHANGED FROM ORIGINAL DRAFT:
-- The original draft of this migration tried `CREATE TABLE IF NOT EXISTS notifications` —
-- but Mingla already has a `notifications` table (defined in baseline migration
-- 20260505000000 line 8481) used by the consumer app + admin notify-dispatch + push-utils.
-- The original CREATE silently no-op'd because IF NOT EXISTS, then the brand_id index
-- creation failed because the existing schema has no brand_id column.
--
-- CORRECTED APPROACH (per operator approval 2026-05-06):
-- The Mingla architecture is one Supabase backend serving all frontends. The notifications
-- table is keyed by auth.users.id and is INTENDED to be shared. A user who is both a
-- consumer + brand admin = same auth.users row = one notification inbox. Each app filters
-- by type prefix on the UI side (consumer app excludes `stripe.*` and `business.*`; Mingla
-- Business app reads only those prefixes — enforced by NEW invariant I-PROPOSED-W).
--
-- This migration:
-- 1. ALTERs existing notifications table to ADD missing V3 columns (brand_id, deep_link)
-- 2. Adds partial index on brand_id (efficient since most rows have NULL)
-- 3. Adds index on type for prefix-filtered queries (LIKE 'stripe.%' / 'business.%')
-- 4. Creates new notification_preferences table (didn't exist; CREATE TABLE is correct here)
--
-- V3 SPEC §6 columns NOT added (replaced by existing equivalents):
--   - V3 'metadata' → existing `data` JSONB
--   - V3 'channel' → not needed; notify-dispatch fans out to email + push + in-app implicitly
--   - V3 'delivered_at' → existing `push_sent_at` covers push delivery confirmation
--
-- 9 V3 Stripe notification types, all prefixed `stripe.`:
--   stripe.deadline_warning_7d, stripe.deadline_warning_3d, stripe.deadline_warning_1d
--   stripe.bank_verification_failed, stripe.payout_failed
--   stripe.account_deauthorized, stripe.kyc_stall_reminder
--   stripe.account_restricted, stripe.reactivation_complete

-- =============================================================================
-- 1. ALTER existing notifications table to add V3 columns
-- =============================================================================

ALTER TABLE "public"."notifications"
  ADD COLUMN IF NOT EXISTS "brand_id" uuid REFERENCES "public"."brands"("id") ON DELETE CASCADE;

ALTER TABLE "public"."notifications"
  ADD COLUMN IF NOT EXISTS "deep_link" text;

COMMENT ON COLUMN "public"."notifications"."brand_id" IS
  'For business-app notifications scoped to a specific brand (Stripe-related, marketing, etc.). NULL for consumer-app notifications. Per V3 D-V3-2.';

COMMENT ON COLUMN "public"."notifications"."deep_link" IS
  'Deep-link URL for tap-through (e.g., mingla-business://brand/[id]/payments/onboard?reactivate=1). NULL for notifications without an actionable target.';

-- =============================================================================
-- 2. Indexes for V3 query patterns
-- =============================================================================

CREATE INDEX IF NOT EXISTS "idx_notifications_brand_id"
  ON "public"."notifications" ("brand_id")
  WHERE "brand_id" IS NOT NULL;

-- Type-prefix index for efficient `type LIKE 'stripe.%'` filtering per I-PROPOSED-W
CREATE INDEX IF NOT EXISTS "idx_notifications_type_btree"
  ON "public"."notifications" ("type" text_pattern_ops);

COMMENT ON INDEX "public"."idx_notifications_type_btree" IS
  'Supports type-prefix filtering per I-PROPOSED-W (consumer vs business app scoping). Uses text_pattern_ops for LIKE prefix queries.';

-- =============================================================================
-- 3. CREATE notification_preferences table (does NOT exist; new for V3)
-- =============================================================================

CREATE TABLE IF NOT EXISTS "public"."notification_preferences" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "auth"."users"("id") ON DELETE CASCADE,
  "channel" text NOT NULL CHECK ("channel" = ANY (ARRAY[
    'email'::text,
    'push'::text,
    'in_app'::text
  ])),
  "type" text NOT NULL,
  "opt_in" boolean NOT NULL DEFAULT true,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "notification_preferences_user_channel_type_unique"
    UNIQUE ("user_id", "channel", "type")
);

-- RLS: user reads + writes own preferences only.
ALTER TABLE "public"."notification_preferences" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "User manages own notification preferences"
  ON "public"."notification_preferences"
  FOR ALL
  TO "authenticated"
  USING ("user_id" = "auth"."uid"())
  WITH CHECK ("user_id" = "auth"."uid"());

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."notification_preferences" TO "authenticated";

COMMENT ON TABLE "public"."notification_preferences" IS
  'Per-user × per-channel × per-type notification opt-in/out. Default opt_in=true (no row = opted in). User manages via mingla-business settings UI. notify-dispatch checks before delivery. Per V3 D-V3-2.';
