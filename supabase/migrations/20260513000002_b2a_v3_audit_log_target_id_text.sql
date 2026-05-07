-- B2a Path C V3 hotfix — audit_log.target_id widened from uuid to text.
--
-- Discovered Phase 16: brand-stripe-onboard's writeAudit call passes the Stripe
-- account ID (text like "acct_1TUL...") into target_id. Pre-V3 the audit_log
-- target_id was uuid-only because all audit targets were Mingla-internal UUIDs.
-- V3's Stripe Connect surface introduces external (Stripe-side) target IDs.
--
-- Two paths considered:
--   (a) Patch writeAudit to nullify non-UUID target_ids and stash external IDs
--       in `after` jsonb. Rejected: lossy, breaks the existing target_id-keyed
--       lookup pattern, makes audit search by stripe_account_id awkward.
--   (b) Widen target_id to text. Selected: target_id has no FK to any uuid
--       table (verified pre-migration); the column is documentary, not
--       referential. Backwards compat preserved — all existing UUID values
--       cast cleanly to text.
--
-- Idempotent via DO block: only alters if column is still uuid.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'audit_log'
      AND column_name = 'target_id'
      AND data_type = 'uuid'
  ) THEN
    ALTER TABLE public.audit_log
      ALTER COLUMN target_id TYPE text USING target_id::text;
  END IF;
END $$;

COMMENT ON COLUMN public.audit_log.target_id IS
  'External-or-internal identifier of the audited target. UUID for Mingla-internal targets (brand_id, user_id, event_id, etc.); text for external IDs (Stripe account IDs, Stripe event IDs, etc.). Widened from uuid to text on 2026-05-07 per V3 Stripe Connect integration.';
