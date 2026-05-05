-- =====================================================================
-- 20260503100000_b1_5_pr_59_hardening.sql
-- =====================================================================
-- ORCH-0706 — PR #59 B1.5 backend hardening.
--
-- Five must-fix items from independent reviewer report:
--
--   SF-1: brands.slug immutability trigger (I-17 — Cycle 7 share URLs
--         depend on permanence; consumer code at currentBrandStore.ts:271–283
--         documents this as FROZEN).
--
--   SF-2: events.slug immutability trigger (Cycle 7 public-event URLs
--         at app/e/[brandSlug]/[eventSlug] resolve by tuple).
--
--   SF-3: events.created_by immutability trigger (audit-trail integrity;
--         even event_manager+ cannot rewrite who created an event).
--
--   SF-4: audit_log + scan_events COMMENT ON TABLE honesty fix.
--         OPTION B per DEC-088 — keep service-role short-circuit (real
--         operational need: reconciliation jobs for partial scanner sync
--         + double-charged refund repair) but document the carve-out so
--         future readers don't mistake the tables for strictly
--         tamper-proof. Trigger functions UNTOUCHED.
--
--   SF-5: refunds.status + door_sales_ledger.payment_method CHECK
--         constraints. Pre-flight grep confirmed: client RefundRecord
--         has no status field, no door_sales references in
--         mingla-business — SPEC defaults are authoritative.
--
-- Source: SPEC at Mingla_Artifacts/specs/SPEC_ORCH-0706_PR_59_B1_5_BACKEND_HARDENING.md
-- Reviewer report: Mingla_Artifacts/reports/INVESTIGATION_PR_59_CYCLE_B1_BACKEND_REVIEW.md
-- Author green-light: PR #59 issuecomment-4364474041
--
-- Sequencing: this migration MUST run AFTER PR #59 (20260502100000) is
-- applied. Tables it modifies (brands, events, audit_log, scan_events,
-- refunds, door_sales_ledger) are created by PR #59.
--
-- Idempotent on re-apply: CREATE OR REPLACE FUNCTION + DROP TRIGGER IF
-- EXISTS … CREATE TRIGGER + DO $$ EXCEPTION WHEN duplicate_object blocks
-- around ADD CONSTRAINT.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- SF-1: brands.slug immutability
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.biz_prevent_brand_slug_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.slug IS DISTINCT FROM OLD.slug THEN
    RAISE EXCEPTION 'brands.slug is immutable (I-17 — Cycle 7 share URLs depend on permanence; create a new brand instead of renaming)';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_brands_immutable_slug ON public.brands;
CREATE TRIGGER trg_brands_immutable_slug
  BEFORE UPDATE ON public.brands
  FOR EACH ROW
  EXECUTE FUNCTION public.biz_prevent_brand_slug_change();

COMMENT ON TRIGGER trg_brands_immutable_slug ON public.brands IS
  'I-17 — brand slug FROZEN at creation. Cycle 7 /b/{brandSlug} share URLs and IG-bio links depend on permanence. Mirrors biz_prevent_brand_account_id_change.';

-- ---------------------------------------------------------------------
-- SF-2: events.slug immutability
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.biz_prevent_event_slug_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.slug IS DISTINCT FROM OLD.slug THEN
    RAISE EXCEPTION 'events.slug is immutable (Cycle 7 share URLs depend on permanence; create a new event instead of renaming)';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_events_immutable_slug ON public.events;
CREATE TRIGGER trg_events_immutable_slug
  BEFORE UPDATE ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.biz_prevent_event_slug_change();

COMMENT ON TRIGGER trg_events_immutable_slug ON public.events IS
  'Event slug FROZEN at creation. Cycle 7 /e/{brandSlug}/{eventSlug} share URLs depend on permanence. Mirrors biz_prevent_brand_account_id_change.';

-- ---------------------------------------------------------------------
-- SF-3: events.created_by immutability
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.biz_prevent_event_created_by_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'events.created_by is immutable (audit-trail integrity)';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_events_immutable_created_by ON public.events;
CREATE TRIGGER trg_events_immutable_created_by
  BEFORE UPDATE ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.biz_prevent_event_created_by_change();

COMMENT ON TRIGGER trg_events_immutable_created_by ON public.events IS
  'events.created_by FROZEN — audit-trail integrity. Even event_manager+ cannot rewrite who created an event.';

-- ---------------------------------------------------------------------
-- SF-4: audit_log + scan_events COMMENT ON TABLE honesty fix
-- (OPTION B — DEC-088 — keep service-role carve-out; document it)
-- Trigger functions left UNTOUCHED — PR #59 already correct under
-- Option B semantics. Only the table comments change.
-- ---------------------------------------------------------------------

COMMENT ON TABLE public.audit_log IS
  'Append-only for non-service-role callers. Service role (auth.uid() IS NULL) may UPDATE/DELETE for reconciliation jobs and migration scripts. Application code MUST NOT mutate; new entries via INSERT only. (B1.5 — ORCH-0706 SF-4)';

COMMENT ON TABLE public.scan_events IS
  'Append-only for non-service-role callers. Service role (auth.uid() IS NULL) may UPDATE/DELETE for reconciliation jobs (e.g., partial scanner sync repair) and migration scripts. Application code MUST NOT mutate; new scan rows via INSERT only. (B1.5 — ORCH-0706 SF-4)';

-- ---------------------------------------------------------------------
-- SF-5: missing CHECK constraints
-- ---------------------------------------------------------------------

-- refunds.status — mirrors Stripe Refund Object status enum.
-- Idempotency: DO block catches duplicate_object on re-apply.
DO $$
BEGIN
  ALTER TABLE public.refunds
    ADD CONSTRAINT refunds_status_check
      CHECK (status IN ('pending', 'succeeded', 'failed', 'cancelled'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- door_sales_ledger.payment_method — strict subset of orders.payment_method
-- excluding 'online_card' (door sales are physical-presence only).
DO $$
BEGIN
  ALTER TABLE public.door_sales_ledger
    ADD CONSTRAINT door_sales_ledger_payment_method_check
      CHECK (payment_method IN ('cash', 'card_reader', 'nfc', 'manual'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------
-- GRANT/REVOKE for the 3 new trigger functions
-- (mirrors PR #59 pattern at lines 2088-2142 of 20260502100000_b1_business_schema_rls.sql)
-- ---------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.biz_prevent_brand_slug_change() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.biz_prevent_event_slug_change() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.biz_prevent_event_created_by_change() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.biz_prevent_brand_slug_change() TO authenticated;
GRANT EXECUTE ON FUNCTION public.biz_prevent_event_slug_change() TO authenticated;
GRANT EXECUTE ON FUNCTION public.biz_prevent_event_created_by_change() TO authenticated;

GRANT EXECUTE ON FUNCTION public.biz_prevent_brand_slug_change() TO service_role;
GRANT EXECUTE ON FUNCTION public.biz_prevent_event_slug_change() TO service_role;
GRANT EXECUTE ON FUNCTION public.biz_prevent_event_created_by_change() TO service_role;

COMMIT;
