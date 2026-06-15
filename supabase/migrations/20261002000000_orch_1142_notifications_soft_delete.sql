-- ORCH-1142 — Business notifications: soft-delete (full-read + delete feature).
--
-- Adds an additive, nullable `deleted_at` column to `public.notifications` so
-- the business operator inbox can HIDE read/handled notifications (per-row
-- swipe-to-delete + "Clear read" header bulk action) WITHOUT physically
-- removing the row. Financial-record reference value is preserved server-side:
-- the row persists with `deleted_at` set; it is only excluded from the operator
-- inbox fetch + realtime patch.
--
-- This supersedes META-ORCH-1074 SUB-C_DESIGN §4.4 ("NO swipe-to-dismiss —
-- financial records have reference value") for the operator inbox VIEW ONLY.
-- The reference value is preserved via this soft-delete (the row is never
-- hard-deleted). Do NOT convert this to a hard delete and do NOT remove the
-- `deleted_at IS NULL` exclusion filter in the client fetch.
--
-- RLS: NO new policy. The existing column-agnostic UPDATE policy
-- ("Users can update own notifications (mark read)", USING auth.uid()=user_id
-- + WITH CHECK auth.uid()=user_id) already lets a user set `deleted_at` on
-- their OWN rows, exactly as it lets them set `read_at` today. The DELETE
-- policy is intentionally NOT used (soft-delete only).
--
-- GRANT: none. `authenticated` already has UPDATE on the table (precedent:
-- the existing mark-read writes).

ALTER TABLE "public"."notifications"
  ADD COLUMN IF NOT EXISTS "deleted_at" timestamptz;

COMMENT ON COLUMN "public"."notifications"."deleted_at" IS
  'ORCH-1142 soft-delete timestamp. NULL = active (visible in inbox); non-NULL = hidden from the operator inbox but PRESERVED server-side for financial-record reference value. Set by the owner via the existing column-agnostic UPDATE RLS policy (same path as read_at). Never hard-delete to satisfy an inbox-hide; GDPR erasure has its own path (b2a_v3_gdpr_erasure).';

-- Partial index for the hot path: "this user''s active (non-deleted) rows,
-- newest first". Most rows stay NULL, so the partial index stays lean.
CREATE INDEX IF NOT EXISTS "idx_notifications_user_active"
  ON "public"."notifications" ("user_id", "created_at" DESC)
  WHERE "deleted_at" IS NULL;
