-- Issue #1179 (initiative #1013 sub-issue J) — cancellation refund fan-out.
--
-- When an organiser cancels an event (business_cancel_event) or an admin cancels
-- an offering (admin_cancel_offering), the RPC flips events.status='cancelled' and
-- NOTHING else. This migration adds the resumable, idempotent machinery that a new
-- service-role edge function (event-cancel-refund-fanout) drives to:
--   (1) mark every pending/blocked brand_payout_releases row for the event
--       'cancelled_event' (never releases money);
--   (2) atomically convert active temporary post-release postponement debt on the
--       event's STRIPE released occurrences to a permanent post_release_cancellation
--       liability BEFORE any refund fires, so the same cash is never withheld twice
--       (Paystack temp-debt supersession is owned by F's record_paystack_refund_outcome
--       via post_release_refund — J EXCLUDES Paystack here, invariant
--       I-PROPOSED-1179-NO-DOUBLE-WITHHOLD);
--   (3) enumerate every paid, not-fully-refunded order (tickets AND trips are orders)
--       into per-object progress rows guarded by UNIQUE(source_type, source_id) — the
--       one-refund-per-object guard (I-PROPOSED-1179-ONE-REFUND-PER-OBJECT);
--   (4) hand claimed rows to the edge fn (which reuses admin_refund_order /
--       admin_refund_order_commit + the Stripe/Paystack refund paths) and record the
--       outcome; the deterministic key cancel_refund:<event>:<order> + provider
--       idempotency + the claim lease make every re-drive a no-op.
-- A dedicated pg_cron backstop re-invokes the edge fn for incomplete runs so
-- completion is guaranteed even when the best-effort client kickoff never fires
-- (I-PROPOSED-1179-CANCEL-REFUNDS-ONLY-ON-CANCELLED enforces refunds fire ONLY when
-- events.status='cancelled' at prepare time).
--
-- Reuse ONLY (bodies untouched): admin_refund_order / admin_refund_order_commit
-- (service_role twins), record_paystack_refund_outcome, convert_postponement_debt_to_permanent.
-- Scope: orders only. RSVP chip-in contributions + venue reservations are OUT (#1221).
-- The progress table is surface-typed (source_type) for a clean fast-follow.

-- =============================================================================
-- §1. Tables
-- =============================================================================

-- Table A — bounded backstop work list (one row per cancelled event).
CREATE TABLE public.event_cancel_refund_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL UNIQUE REFERENCES public.events(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','in_progress','completed','failed_partial')),
  total_objects integer NOT NULL DEFAULT 0 CHECK (total_objects >= 0),
  refunded_objects integer NOT NULL DEFAULT 0 CHECK (refunded_objects >= 0),
  failed_objects integer NOT NULL DEFAULT 0 CHECK (failed_objects >= 0),
  opened_at timestamptz NOT NULL DEFAULT now(),
  last_attempt_at timestamptz,
  completed_at timestamptz
);
-- The cron scan key: only rows still needing work.
CREATE INDEX event_cancel_refund_runs_scan_idx
  ON public.event_cancel_refund_runs (status, last_attempt_at)
  WHERE status IN ('pending','in_progress','failed_partial');

-- Table B — per-object idempotent progress (one row per money object, ever).
CREATE TABLE public.event_cancel_refund_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE RESTRICT,
  -- surface-typed for the OQ-1 / #1221 fast-follow; J only ever enumerates 'order'.
  source_type text NOT NULL CHECK (source_type IN ('order')),
  source_id uuid NOT NULL,
  provider text NOT NULL CHECK (provider IN ('stripe','paystack')),
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  refund_id uuid,            -- local public.refunds.id once the pending refund row exists
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','refunding','refunded','failed_retryable','failed')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error text,
  leased_at timestamptz,     -- claim lease timestamp (stale-lease reclaim)
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- THE no-double-refund guard: one progress row per money object, ever.
  UNIQUE (source_type, source_id)
);
CREATE INDEX event_cancel_refund_progress_event_status_idx
  ON public.event_cancel_refund_progress (event_id, status);

-- =============================================================================
-- §2. RLS + grants. service_role bypasses RLS and owns every write. authenticated
--     brand finance-managers may READ their own event's rows (mirrors the
--     organiser_payout_debts brand-read pattern, 20270110000001:265). anon: none.
-- =============================================================================
ALTER TABLE public.event_cancel_refund_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_cancel_refund_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY event_cancel_refund_runs_brand_read ON public.event_cancel_refund_runs
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_cancel_refund_runs.event_id
        AND public.biz_brand_effective_rank(e.brand_id, auth.uid())
          >= public.biz_role_rank('finance_manager')
    )
  );
CREATE POLICY event_cancel_refund_progress_brand_read ON public.event_cancel_refund_progress
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_cancel_refund_progress.event_id
        AND public.biz_brand_effective_rank(e.brand_id, auth.uid())
          >= public.biz_role_rank('finance_manager')
    )
  );

REVOKE ALL ON public.event_cancel_refund_runs FROM PUBLIC, anon;
REVOKE ALL ON public.event_cancel_refund_progress FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON public.event_cancel_refund_runs TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.event_cancel_refund_progress TO service_role;
GRANT SELECT ON public.event_cancel_refund_runs TO authenticated;
GRANT SELECT ON public.event_cancel_refund_progress TO authenticated;

-- =============================================================================
-- §3. RPC 1 — cancel_event_refund_prepare. ONE atomic transaction:
--     status-first guard + stop releases + atomic Stripe temp-debt conversion +
--     open the run + enumerate order progress rows. service_role only.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.cancel_event_refund_prepare(
  p_event_id uuid,
  p_now timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_status text;
  v_brand_id uuid;
  v_provider text;
  v_release record;
  v_temp public.organiser_payout_debts;
  v_total integer;
  v_run_status text;
  v_pending_ids uuid[];
BEGIN
  -- 1. Status-first guard (binding race guard + the SOLE authorization). A live or
  --    racing-not-yet-cancelled event yields zero refunds and writes NOTHING.
  SELECT status, brand_id INTO v_status, v_brand_id
  FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'event_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_status IS DISTINCT FROM 'cancelled' THEN
    RAISE EXCEPTION 'event_not_cancelled' USING ERRCODE = 'P0002';
  END IF;

  -- Provider is brand-wide (an event belongs to exactly one brand).
  SELECT CASE WHEN b.payment_provider = 'paystack' THEN 'paystack' ELSE 'stripe' END
  INTO v_provider FROM public.brands b WHERE b.id = v_brand_id;
  v_provider := COALESCE(v_provider, 'stripe');

  -- 2. Stop releases (event-scoped; NEVER releases). SKIP LOCKED so a release the
  --    sweep is currently holding is left for the cron re-drive — the sweep's own
  --    pre-execute status re-check (I-1013-CANCELLED-NEVER-RELEASES) prevents it
  --    executing for a cancelled event. Idempotent (already-cancelled rows excluded).
  WITH locked AS (
    SELECT id FROM public.brand_payout_releases
    WHERE event_id = p_event_id
      AND status IN (
        'pending','blocked_kyc','blocked_balance','blocked_otp','blocked_over_cap',
        'fee_unreconciled','blocked_anchor','reanchored'
      )
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.brand_payout_releases r
  SET status = 'cancelled_event', updated_at = p_now
  FROM locked WHERE r.id = locked.id;

  -- 3. Atomic debt conversion BEFORE any refund (dispatch item 4). ONLY Stripe
  --    released occurrences WITH an OPEN temporary postponement debt. Amount = the
  --    temp debt's principal_cents (== organiser_cash_delivered_cents at open time)
  --    so the permanent liability equals the debt it replaces — no growth, no
  --    stacking, no double withhold. Paystack is EXCLUDED (F owns its supersession).
  --    convert_postponement_debt_to_permanent is idempotent per (release, kind).
  FOR v_release IN
    SELECT r.id AS release_id
    FROM public.brand_payout_releases r
    WHERE r.event_id = p_event_id
      AND r.status = 'released'
      AND r.provider = 'stripe'
    FOR UPDATE OF r SKIP LOCKED
  LOOP
    SELECT * INTO v_temp FROM public.organiser_payout_debts
    WHERE origin_release_id = v_release.release_id
      AND kind = 'post_release_postponement'
      AND status = 'open'
    FOR UPDATE;
    IF FOUND AND v_temp.principal_cents > 0 THEN
      PERFORM public.convert_postponement_debt_to_permanent(
        v_release.release_id, 'post_release_cancellation', v_temp.principal_cents, p_now
      );
    END IF;
  END LOOP;

  -- 4. Open / refresh the backstop run.
  INSERT INTO public.event_cancel_refund_runs (event_id, status, last_attempt_at, opened_at)
  VALUES (p_event_id, 'in_progress', p_now, p_now)
  ON CONFLICT (event_id) DO UPDATE SET
    last_attempt_at = p_now,
    status = CASE
      WHEN public.event_cancel_refund_runs.status = 'completed'
        THEN public.event_cancel_refund_runs.status
      ELSE 'in_progress'
    END;

  -- 5. Enumerate + persist per-object progress rows (orders only — tickets AND
  --    trips). Re-runs insert only newly-eligible/missing rows (ON CONFLICT DO
  --    NOTHING on the UNIQUE(source_type, source_id) guard).
  INSERT INTO public.event_cancel_refund_progress (
    event_id, source_type, source_id, provider, amount_cents, status
  )
  SELECT p_event_id, 'order', o.id, v_provider,
         (o.total_cents - COALESCE(o.refunded_amount_cents, 0)), 'pending'
  FROM public.orders o
  WHERE o.event_id = p_event_id
    AND o.payment_status IN ('paid','partial_refund')
    AND (o.total_cents - COALESCE(o.refunded_amount_cents, 0)) > 0
  ON CONFLICT (source_type, source_id) DO NOTHING;

  SELECT count(*)::integer INTO v_total
  FROM public.event_cancel_refund_progress WHERE event_id = p_event_id;

  UPDATE public.event_cancel_refund_runs
  SET total_objects = v_total,
      -- an enumeration that found zero objects to refund is already complete.
      status = CASE
        WHEN v_total = 0 AND status <> 'completed' THEN 'completed'
        ELSE status
      END,
      completed_at = CASE
        WHEN v_total = 0 AND completed_at IS NULL THEN p_now
        ELSE completed_at
      END
  WHERE event_id = p_event_id
  RETURNING status INTO v_run_status;

  SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) INTO v_pending_ids
  FROM public.event_cancel_refund_progress
  WHERE event_id = p_event_id AND status IN ('pending','failed_retryable');

  RETURN jsonb_build_object(
    'run_status', v_run_status,
    'total_objects', v_total,
    'pending_object_ids', to_jsonb(v_pending_ids)
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.cancel_event_refund_prepare(uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_event_refund_prepare(uuid, timestamptz)
  TO service_role;
COMMENT ON FUNCTION public.cancel_event_refund_prepare(uuid, timestamptz) IS
  'Issue #1179 (J): status-first guarded, atomic — stops pending releases, converts Stripe temp postponement debt to permanent post_release_cancellation (no double withhold), and enumerates order refund progress rows. service_role only.';

-- =============================================================================
-- §4. RPC 2 — cancel_event_refund_claim. Lease a bounded batch of not-yet-done
--     objects for exactly one runner. FOR UPDATE SKIP LOCKED + stale-lease reclaim
--     make concurrent runners (client kickoff racing the cron) safe. A just-marked
--     failed_retryable row carries a fresh lease, so it is NOT re-claimed within the
--     same invocation (no same-invocation retry storm) — the cron re-drives it 10m
--     later. attempt_count < 8 caps runaway retryables. service_role only.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.cancel_event_refund_claim(
  p_event_id uuid,
  p_limit integer DEFAULT 25,
  p_now timestamptz DEFAULT now()
) RETURNS SETOF public.event_cancel_refund_progress
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
BEGIN
  RETURN QUERY
  WITH claimed AS (
    SELECT id FROM public.event_cancel_refund_progress
    WHERE event_id = p_event_id
      AND (
        status = 'pending'
        OR (status = 'failed_retryable'
            AND attempt_count < 8
            AND (leased_at IS NULL OR leased_at < p_now - interval '10 minutes'))
        OR (status = 'refunding' AND leased_at < p_now - interval '10 minutes')
      )
    ORDER BY created_at, id
    LIMIT GREATEST(p_limit, 1)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.event_cancel_refund_progress p
  SET status = 'refunding',
      leased_at = p_now,
      attempt_count = p.attempt_count + 1,
      updated_at = p_now
  FROM claimed
  WHERE p.id = claimed.id
  RETURNING p.*;
END;
$fn$;

REVOKE ALL ON FUNCTION public.cancel_event_refund_claim(uuid, integer, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_event_refund_claim(uuid, integer, timestamptz)
  TO service_role;
COMMENT ON FUNCTION public.cancel_event_refund_claim(uuid, integer, timestamptz) IS
  'Issue #1179 (J): leases a bounded batch of pending/retryable/stale cancellation-refund objects for exactly one runner (FOR UPDATE SKIP LOCKED + stale-lease reclaim). service_role only.';

-- =============================================================================
-- §5. RPC 3 — cancel_event_refund_mark. Record a per-object outcome and recompute
--     the parent run counters + status. service_role only.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.cancel_event_refund_mark(
  p_progress_id uuid,
  p_status text,
  p_refund_id uuid DEFAULT NULL,
  p_error text DEFAULT NULL,
  p_now timestamptz DEFAULT now()
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_event_id uuid;
  v_remaining integer;
  v_failed integer;
  v_refunded integer;
  v_new_run_status text;
BEGIN
  IF p_status NOT IN ('refunded','failed_retryable','failed') THEN
    RAISE EXCEPTION 'invalid_mark_status' USING ERRCODE = '22023';
  END IF;

  UPDATE public.event_cancel_refund_progress
  SET status = p_status,
      refund_id = COALESCE(p_refund_id, refund_id),
      last_error = p_error,
      updated_at = p_now
  WHERE id = p_progress_id
  RETURNING event_id INTO v_event_id;
  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'progress_row_not_found' USING ERRCODE = 'P0001';
  END IF;

  SELECT
    count(*) FILTER (WHERE status IN ('pending','refunding','failed_retryable')),
    count(*) FILTER (WHERE status = 'failed'),
    count(*) FILTER (WHERE status = 'refunded')
  INTO v_remaining, v_failed, v_refunded
  FROM public.event_cancel_refund_progress
  WHERE event_id = v_event_id;

  v_new_run_status := CASE
    WHEN v_remaining = 0 AND v_failed = 0 THEN 'completed'
    WHEN v_remaining = 0 AND v_failed > 0 THEN 'failed_partial'
    ELSE 'in_progress'
  END;

  UPDATE public.event_cancel_refund_runs
  SET refunded_objects = v_refunded,
      failed_objects = v_failed,
      status = v_new_run_status,
      completed_at = CASE
        WHEN v_new_run_status = 'completed' THEN p_now ELSE completed_at
      END,
      last_attempt_at = p_now
  WHERE event_id = v_event_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.cancel_event_refund_mark(uuid, text, uuid, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_event_refund_mark(uuid, text, uuid, text, timestamptz)
  TO service_role;
COMMENT ON FUNCTION public.cancel_event_refund_mark(uuid, text, uuid, text, timestamptz) IS
  'Issue #1179 (J): records a per-object cancellation-refund outcome and recomputes the run counters/status (completed / failed_partial / in_progress). service_role only.';

-- =============================================================================
-- §6. Backstop cron (J's OWN re-drive — do NOT modify payout-release-sweep).
--     Every 10 minutes, POST the edge fn once per incomplete run so completion is
--     guaranteed even when the client kickoff never fired or died mid-list. Vault
--     pattern verbatim from 20261116000000_orch_1187_reconcile_stuck_checkouts_cron.
-- =============================================================================

-- §6.1 Extension + Vault pre-flight (advisory NOTICEs only — CI-safe on a fresh
--      Postgres with no Vault; a missing secret surfaces at the next cron run).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'vault') THEN
    RAISE NOTICE 'issue-1179 advisory: vault schema not present. The cancel-refund backstop cron will register but its http_post calls will fail at runtime until Supabase Vault is configured.';
  ELSIF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'supabase_url') THEN
    RAISE NOTICE 'issue-1179 advisory: vault.decrypted_secrets row "supabase_url" missing. The cancel-refund backstop cron will register but http_post calls will fail until the operator creates it.';
  ELSIF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'service_role_key') THEN
    RAISE NOTICE 'issue-1179 advisory: vault.decrypted_secrets row "service_role_key" missing. The cancel-refund backstop cron will register but http_post calls will fail until the operator creates it.';
  END IF;
END$$;

-- §6.2 Idempotent re-schedule (unschedule if present, then schedule).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'issue_1179_cancel_refund_fanout_backstop') THEN
    PERFORM cron.unschedule('issue_1179_cancel_refund_fanout_backstop');
  END IF;
END$$;

-- §6.3 Schedule: one http_post per incomplete run whose last attempt is >10m ago
--      (or never attempted). The edge fn re-prepares (idempotent) and re-claims
--      only pending/retryable/stale objects, so re-drive never double-refunds.
SELECT cron.schedule(
  'issue_1179_cancel_refund_fanout_backstop',
  '*/10 * * * *',
  $cron$
    SELECT net.http_post(
      url := (
        SELECT decrypted_secret FROM vault.decrypted_secrets
         WHERE name = 'supabase_url' LIMIT 1
      ) || '/functions/v1/event-cancel-refund-fanout',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          SELECT decrypted_secret FROM vault.decrypted_secrets
           WHERE name = 'service_role_key' LIMIT 1
        )
      ),
      body := jsonb_build_object('event_id', r.event_id),
      timeout_milliseconds := 30000
    )
    FROM public.event_cancel_refund_runs r
    WHERE r.status IN ('pending','in_progress','failed_partial')
      AND (r.last_attempt_at IS NULL OR r.last_attempt_at < now() - interval '10 minutes');
  $cron$
);

-- §6.4 Verification probe (the cron job registration is this migration's own
--      output → hard EXCEPTION; the Vault secrets are an operator dependency →
--      NOTICE only, see §6.1).
DO $$
DECLARE
  v_schedule text;
BEGIN
  SELECT schedule INTO v_schedule FROM cron.job
   WHERE jobname = 'issue_1179_cancel_refund_fanout_backstop' LIMIT 1;
  IF v_schedule IS NULL THEN
    RAISE EXCEPTION 'issue-1179 probe failed: cancel-refund backstop cron not registered after schedule call';
  END IF;
  IF v_schedule IS DISTINCT FROM '*/10 * * * *' THEN
    RAISE EXCEPTION 'issue-1179 probe failed: cancel-refund backstop cron schedule is % but expected */10 * * * *', v_schedule;
  END IF;
END$$;
