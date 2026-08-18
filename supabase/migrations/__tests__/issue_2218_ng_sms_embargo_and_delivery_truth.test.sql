-- ===========================================================================
-- Issue #2218 — schema-level regression proof, run against the REAL applied
-- schema in the migrations job.
-- ===========================================================================
-- What it defends. `deferred` is the state that lets a Nigerian confirmation be
-- HELD rather than handed to a route the network is refusing. If the CHECK does
-- not admit it, the edge function's honest new outcome becomes a runtime
-- constraint violation on a money-adjacent path — and the failure mode is not a
-- deferred text, it is a THROWN dispatch. So the constraint and the code must
-- ship together, and this file is what makes "together" checkable.
--
-- Every assertion is written as a RAISE EXCEPTION on the negative, so a
-- statement that silently matches nothing cannot pass for a green check.

BEGIN;

DO $$
DECLARE
  v_def text;
BEGIN
  -- ---------------------------------------------------------------------
  -- 1. `deferred` is sayable on the buyer-facing ledger.
  -- ---------------------------------------------------------------------
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conrelid = 'public.ticket_order_notifications'::regclass
     AND conname = 'ticket_order_notifications_status_check';
  IF v_def IS NULL THEN
    RAISE EXCEPTION '#2218 A-1: ticket_order_notifications_status_check is missing entirely';
  END IF;
  IF position('''deferred''' IN v_def) = 0 THEN
    RAISE EXCEPTION '#2218 A-1: status CHECK does not admit deferred -> %', v_def;
  END IF;
  -- And NOTHING that was legal before became illegal. A widening that quietly
  -- drops a value would break every existing writer of that value.
  FOREACH v_def IN ARRAY ARRAY[
    'pending','sending','sent','delivered','failed_retryable','failed_terminal','skipped'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conrelid = 'public.ticket_order_notifications'::regclass
         AND conname = 'ticket_order_notifications_status_check'
         AND position('''' || v_def || '''' IN pg_get_constraintdef(oid)) > 0
    ) THEN
      RAISE EXCEPTION '#2218 A-2: pre-existing status % was dropped from the CHECK', v_def;
    END IF;
  END LOOP;

  -- ---------------------------------------------------------------------
  -- 2. Same, on the shared delivery ledger notifyV2 writes.
  -- ---------------------------------------------------------------------
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conrelid = 'public.notification_deliveries'::regclass
     AND conname = 'notification_deliveries_status_check';
  IF v_def IS NULL OR position('''deferred''' IN v_def) = 0 THEN
    RAISE EXCEPTION '#2218 B-1: notification_deliveries status CHECK does not admit deferred -> %', v_def;
  END IF;
  IF position('''undelivered''' IN v_def) = 0 THEN
    RAISE EXCEPTION '#2218 B-2: `undelivered` was dropped — the reconciler has no terminal word left';
  END IF;

  -- ---------------------------------------------------------------------
  -- 3. The deferral clock exists and is nullable.
  -- ---------------------------------------------------------------------
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'ticket_order_notifications'
       AND column_name = 'next_attempt_at' AND data_type = 'timestamp with time zone'
  ) THEN
    RAISE EXCEPTION '#2218 C-1: ticket_order_notifications.next_attempt_at is missing or not timestamptz';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'ticket_order_notifications'
       AND column_name = 'next_attempt_at' AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION '#2218 C-2: next_attempt_at must be NULL on every non-deferred row';
  END IF;

  -- ---------------------------------------------------------------------
  -- 4. Both sweeps have an index, and both are PARTIAL.
  -- ---------------------------------------------------------------------
  -- Partial matters: the overwhelming majority of rows are terminal and neither
  -- sweep looks at them. A full index here is a slow, quiet cost on the hottest
  -- write path in ticketing.
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND indexname = 'idx_ticket_notifications_deferred_due'
       AND indexdef ILIKE '%WHERE%deferred%'
  ) THEN
    RAISE EXCEPTION '#2218 D-1: the deferred-due index is missing or not partial';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND indexname = 'idx_ticket_notifications_sms_unconfirmed'
       AND indexdef ILIKE '%WHERE%delivered_at IS NULL%'
  ) THEN
    RAISE EXCEPTION '#2218 D-2: the unconfirmed-SMS index is missing or not partial';
  END IF;

  -- ---------------------------------------------------------------------
  -- 5. venue_sms_log admits the two statuses its own code writes.
  -- ---------------------------------------------------------------------
  -- `skipped_market_dark` has been written by send-venue-sms since #1541 and was
  -- NOT in this CHECK. PostgREST returns the violation in `{ error }` and the
  -- helper discards it, so every dark-market venue SMS silently lost its audit
  -- row. Pinned here so the pair cannot drift apart again.
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conrelid = 'public.venue_sms_log'::regclass
     AND conname = 'venue_sms_log_status_check';
  IF v_def IS NULL
     OR position('''skipped_market_dark''' IN v_def) = 0
     OR position('''deferred_operator_window''' IN v_def) = 0 THEN
    RAISE EXCEPTION '#2218 E-1: venue_sms_log CHECK does not admit the statuses logSend writes -> %', v_def;
  END IF;

  -- ---------------------------------------------------------------------
  -- 6. The reconciliation sweep is actually scheduled.
  -- ---------------------------------------------------------------------
  -- #2168 found a permission with no caller. A truth-check with no cron entry is
  -- the same shape: every assertion above would still pass while nothing ever
  -- revisited a `sent` row.
  IF NOT EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'issue_2218_sms_delivery_reconcile'
  ) THEN
    RAISE EXCEPTION '#2218 F-1: the sms-delivery-reconcile cron job was never scheduled';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM cron.job
     WHERE jobname = 'issue_2218_sms_delivery_reconcile'
       AND command ILIKE '%/functions/v1/sms-delivery-reconcile%'
       AND active
  ) THEN
    RAISE EXCEPTION '#2218 F-2: the cron entry exists but is inactive or points elsewhere';
  END IF;

  RAISE NOTICE '#2218 schema suite PASSED (A-1,A-2,B-1,B-2,C-1,C-2,D-1,D-2,E-1,F-1,F-2)';
END $$;

-- ---------------------------------------------------------------------------
-- 7. BEHAVIOURAL: the widened CHECKs actually accept and reject.
-- ---------------------------------------------------------------------------
-- A constraint definition containing a string is not proof the constraint
-- admits it — this executes the write.
DO $$
DECLARE
  v_ok boolean := false;
BEGIN
  BEGIN
    INSERT INTO public.notification_deliveries (channel, status, contact)
    VALUES ('sms', 'deferred', '+2348162646567');
    v_ok := true;
  EXCEPTION WHEN check_violation THEN
    v_ok := false;
  END;
  IF NOT v_ok THEN
    RAISE EXCEPTION '#2218 G-1: a deferred SMS delivery row is still rejected by the CHECK';
  END IF;

  -- And the vocabulary did not become open: a made-up status must still fail,
  -- or the CHECK has been widened into meaninglessness.
  v_ok := false;
  BEGIN
    INSERT INTO public.notification_deliveries (channel, status, contact)
    VALUES ('sms', 'probably_fine', '+2348162646567');
    v_ok := true;
  EXCEPTION WHEN check_violation THEN
    v_ok := false;
  END;
  IF v_ok THEN
    RAISE EXCEPTION '#2218 G-2: the status CHECK now accepts anything';
  END IF;

  RAISE NOTICE '#2218 behavioural suite PASSED (G-1,G-2)';
END $$;

ROLLBACK;
