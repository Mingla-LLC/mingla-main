-- ===========================================================================
-- META-ORCH-1148 sub-ORCH 2.1b — SMS consent (opt-out) + send log
-- ---------------------------------------------------------------------------
-- The "table's ready" Twilio SMS path (send-venue-sms edge fn) needs two
-- additive primitives the 2.0 schema did not ship:
--
--   1. public.venue_sms_opt_out — the STOP-honoring opt-out ledger, keyed by
--      E.164 phone (+ optional brand_id for per-venue opt-out; a NULL brand_id
--      row is a GLOBAL opt-out). The edge fn MUST NOT send to a phone that has a
--      matching opt-out row. Written by the Twilio inbound-STOP webhook
--      (twilio-message-status already exists for status callbacks; the STOP keyword
--      lands a global opt-out row) and, defensively, by the edge fn when Twilio
--      returns a 21610 (blacklisted) error.
--
--   2. public.venue_sms_log — append-only send attempts (to_phone, brand_id,
--      waitlist_id, template, twilio_sid/status, error). Mirrors the audit_log
--      posture (service-role INSERT only; no UPDATE/DELETE for non-service-role).
--      The operator surfaces "Notified" / "SMS failed" off the latest log row.
--
-- Both are service-role-write (the edge fn runs service role); brand members can
-- READ their own brand's log (RLS) so the Waitlist UI can show send state.
-- Consent rows are service-role-only (PII + cross-brand global rows).
--
-- Additive-only; idempotent (IF NOT EXISTS). MONOTONIC VERSION 20261010000000
-- (above the 2.1a max 20261008000003 + all sibling worktrees). Apply via the
-- Supabase Management API after REVIEW. NOT applied to prod by the implementor.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. venue_sms_opt_out — STOP ledger.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.venue_sms_opt_out (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- E.164 (+ country code, digits only after the +). NOT brand-FK-scoped on its
  -- own; a NULL brand_id = a GLOBAL opt-out (the carrier-level STOP), a non-NULL
  -- brand_id = opted out of one venue only.
  phone_e164 text NOT NULL,
  brand_id uuid NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  -- 'stop_keyword' (inbound STOP), 'manual' (operator), 'twilio_blacklist' (21610).
  reason text NOT NULL DEFAULT 'stop_keyword'
    CHECK (reason IN ('stop_keyword','manual','twilio_blacklist')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- One opt-out row per (phone, brand) pair — a NULL brand_id is a distinct global
-- row. The partial unique indexes make the upsert idempotent across re-deliveries.
CREATE UNIQUE INDEX IF NOT EXISTS venue_sms_opt_out_phone_global_uniq
  ON public.venue_sms_opt_out (phone_e164)
  WHERE brand_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS venue_sms_opt_out_phone_brand_uniq
  ON public.venue_sms_opt_out (phone_e164, brand_id)
  WHERE brand_id IS NOT NULL;

ALTER TABLE public.venue_sms_opt_out ENABLE ROW LEVEL SECURITY;
-- No SELECT/WRITE policy for authenticated → only service_role (which bypasses
-- RLS) can read/write. Consent rows carry PII + cross-brand global rows; the
-- edge fn (service role) is the sole reader/writer.

GRANT SELECT, INSERT ON public.venue_sms_opt_out TO service_role;

-- ---------------------------------------------------------------------------
-- 2. venue_sms_log — append-only send attempts.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.venue_sms_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  waitlist_id uuid NULL REFERENCES public.venue_waitlist(id) ON DELETE SET NULL,
  to_phone_e164 text NOT NULL,
  template text NOT NULL DEFAULT 'table_ready'
    CHECK (template IN ('table_ready')),
  -- 'sent' | 'failed' | 'skipped_opt_out' | 'skipped_invalid_phone'.
  status text NOT NULL
    CHECK (status IN ('sent','failed','skipped_opt_out','skipped_invalid_phone')),
  twilio_message_sid text NULL,
  error text NULL,
  -- who triggered it (operator user id resolved from JWT in the edge fn).
  triggered_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS venue_sms_log_brand_created_idx
  ON public.venue_sms_log (brand_id, created_at DESC);
CREATE INDEX IF NOT EXISTS venue_sms_log_waitlist_idx
  ON public.venue_sms_log (waitlist_id) WHERE waitlist_id IS NOT NULL;

ALTER TABLE public.venue_sms_log ENABLE ROW LEVEL SECURITY;

-- Brand members can READ their own brand's send log (drives the Waitlist
-- "Notified ✓" / "SMS failed" surface). No write policy → service_role only.
DROP POLICY IF EXISTS "venue_sms_log brand member can read" ON public.venue_sms_log;
CREATE POLICY "venue_sms_log brand member can read" ON public.venue_sms_log
  FOR SELECT TO authenticated
  USING (public.biz_is_brand_member_for_read_for_caller(brand_id));

GRANT SELECT ON public.venue_sms_log TO authenticated;
GRANT SELECT, INSERT ON public.venue_sms_log TO service_role;

COMMIT;
