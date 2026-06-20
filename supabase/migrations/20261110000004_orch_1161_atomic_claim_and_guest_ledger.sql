-- META-ORCH-1161 Sub-A (REWORK 2026-06-20) — atomic outbox claim + guest delivery ledger.
--
-- Closes two tester-found P2 defects (TEST_META-ORCH-1161_SUBA_THIN_SLICE.md):
--   P2-1 — the drain claimed pending outbox rows with a NON-atomic
--          SELECT status='pending' … then UPDATE status='processing'. Two
--          overlapping cron runs (a run >60s) could BOTH claim the same row →
--          the guest/no-user_id path (which has no notifications UNIQUE backstop)
--          double-sends SMS/email. Fix: a single atomic claim function using
--          FOR UPDATE SKIP LOCKED so each pending row is claimed by exactly one
--          drain invocation.
--   P2-2 — guest/anon (no user_id) sends were NOT written to
--          notification_deliveries (the FK required a notifications.id, and
--          notifications.user_id is NOT NULL → no inbox row for a user-less
--          guest). Fix: make notification_deliveries.notification_id NULLABLE and
--          add contact + idempotency_key columns so a guest send writes a
--          contact-keyed delivery row reconcilable by the Twilio status webhook,
--          PLUS a partial UNIQUE(idempotency_key, channel) on the guest rows so a
--          duplicated drain tick sends each channel at most ONCE (the dispatcher
--          idempotency that the user_id path already gets via notifications
--          UNIQUE now also covers the guest path).
--
-- Additive + monotonic: prefix 20261110000004 > existing 1161 max …000003 and >
-- every sibling-worktree prefix. Touches ONLY 1161-owned objects.
--
-- Cross-refs:
--   SPEC:  Mingla_Artifacts/specs/SPEC_META-ORCH-1161 §5.1 / §5.4 / §7.2
--   Tester:Mingla_Artifacts/reports/TEST_META-ORCH-1161_SUBA_THIN_SLICE.md P2-1, P2-2

-- =============================================================
-- §1. notification_deliveries — allow guest (no-notification) rows.
-- =============================================================
-- The FK was NOT NULL, blocking a guest send (no inbox row) from being ledgered.
-- Relax to NULL and add contact + idempotency_key so a guest row is contact-keyed
-- and reconcilable by provider_message_id like the authenticated path.
ALTER TABLE public.notification_deliveries
  ALTER COLUMN notification_id DROP NOT NULL;

ALTER TABLE public.notification_deliveries
  ADD COLUMN IF NOT EXISTS contact text NULL;          -- E.164 / lowercased email for guest rows

ALTER TABLE public.notification_deliveries
  ADD COLUMN IF NOT EXISTS idempotency_key text NULL;  -- dispatch idempotency for guest dedupe

-- Integrity: a delivery row is EITHER tied to a notification (authenticated) OR
-- carries a contact (guest) — never neither (no orphan, no silent loss).
ALTER TABLE public.notification_deliveries
  DROP CONSTRAINT IF EXISTS notification_deliveries_owner_chk;
ALTER TABLE public.notification_deliveries
  ADD CONSTRAINT notification_deliveries_owner_chk
  CHECK (notification_id IS NOT NULL OR contact IS NOT NULL);

-- Guest dedupe: a duplicated drain tick that re-dispatches the SAME
-- idempotency_key must write each (idempotency_key, channel) at most ONCE. The
-- dispatcher inserts the guest row BEFORE sending; the 23505 on the second tick
-- tells it the send already happened → skip the provider HTTP. Partial so the
-- authenticated path (idempotency_key NULL on the deliveries row) is unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS notification_deliveries_guest_idem_idx
  ON public.notification_deliveries (idempotency_key, channel)
  WHERE idempotency_key IS NOT NULL AND notification_id IS NULL;

COMMENT ON COLUMN public.notification_deliveries.contact IS
  'META-ORCH-1161 §5.1 (rework) — guest/anon contact (E.164/email) for a delivery '
  'row with no notification_id. Webhook reconciles by provider_message_id either way.';
COMMENT ON COLUMN public.notification_deliveries.idempotency_key IS
  'META-ORCH-1161 §5.4 (rework) — guest dispatch idempotency. UNIQUE(idempotency_key, '
  'channel) on guest rows dedupes a double-claimed outbox tick to one send per channel.';

-- The owner RLS policy referenced notification_id; guest rows (notification_id
-- NULL, no auth.uid) are service-role-only reads — the existing policy already
-- denies them to authenticated (EXISTS over a NULL FK is false), so no policy
-- change is required. Re-affirm it explicitly so the intent is on record.
DROP POLICY IF EXISTS notification_deliveries_read_own ON public.notification_deliveries;
CREATE POLICY notification_deliveries_read_own
  ON public.notification_deliveries FOR SELECT
  TO authenticated
  USING (
    notification_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.notifications n
       WHERE n.id = notification_deliveries.notification_id
         AND n.user_id = auth.uid()
    )
  );

-- =============================================================
-- §2. claim_notification_outbox(p_limit) — ATOMIC claim (P2-1).
-- =============================================================
-- A single statement claims up to p_limit pending rows: the inner SELECT locks
-- the chosen rows with FOR UPDATE SKIP LOCKED so a concurrent drain invocation
-- can NEVER lock/claim the same row, then the outer UPDATE flips them to
-- 'processing' and RETURNs them. Replaces the drain's non-atomic
-- SELECT-then-UPDATE. SECURITY DEFINER so the service-role caller runs it under
-- the table owner (the outbox is RLS service-role-only).
CREATE OR REPLACE FUNCTION public.claim_notification_outbox(p_limit int DEFAULT 25)
RETURNS SETOF public.notification_outbox
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  RETURN QUERY
  UPDATE public.notification_outbox o
     SET status = 'processing'
   WHERE o.id IN (
     SELECT c.id
       FROM public.notification_outbox c
      WHERE c.status = 'pending'
      ORDER BY c.created_at
      FOR UPDATE SKIP LOCKED
      LIMIT GREATEST(p_limit, 0)
   )
  RETURNING o.*;
END;
$function$;

-- SECURITY DEFINER auto-grant gotcha — REVOKE PUBLIC + anon + authenticated.
-- Only the service-role (which bypasses GRANTs) may claim the outbox.
REVOKE ALL ON FUNCTION public.claim_notification_outbox(int) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_notification_outbox(int) FROM anon;
REVOKE EXECUTE ON FUNCTION public.claim_notification_outbox(int) FROM authenticated;

COMMENT ON FUNCTION public.claim_notification_outbox(int) IS
  'META-ORCH-1161 §5.4 (rework) — ATOMIC outbox claim. FOR UPDATE SKIP LOCKED so '
  'two overlapping drain runs never claim the same row (P2-1 double-send fix). '
  'Service-role only.';
