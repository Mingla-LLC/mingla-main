-- ORCH-1270 — SMS quiet-hours DEFER + honest campaign status.
--
-- Forward-only, additive, idempotent. Fixes the two CONFIRMED [CODE] defects
-- from INVESTIGATION_ORCH-1270_SMS_BLAST_ALL_FAILED.md:
--
--   RC-1: quiet-hours recipients were written terminal `failed`
--         (failure_reason='quiet_hours_deferred') and never retried. This
--         migration adds the `'deferred'` message status + the retry columns
--         (next_attempt_at / attempt_count) the edge fn uses to hold + re-send
--         those recipients when their local morning window opens.
--
--   RC-2: the campaign was set status='sent' with recipient_count=0 even when
--         0 texts left the building. This migration adds mkt_finalize_campaign()
--         which computes the true outcome from marketing_messages and NEVER
--         marks a campaign 'sent' unless something actually delivered.
--
-- Double-send guarantee (SPEC §6.4): two UNIQUE indexes on
-- (campaign_id, recipient_phone) and (campaign_id, recipient_email) are the
-- structural anti-double-text backbone. Combined with the edge fn's in-loop
-- terminal-skip guard + upsert, no recipient can ever be dispatched twice under
-- cron re-invocation.
--
-- Cross-references:
--   INVESTIGATION Mingla_Artifacts/reports/INVESTIGATION_ORCH-1270_SMS_BLAST_ALL_FAILED.md
--   SPEC          Mingla_Artifacts/specs/SPEC_ORCH-1270_SMS_QUIET_HOURS_DEFER.md §6
--   Edge fn       supabase/functions/marketing-send/index.ts
--   Phase A       supabase/migrations/20260602000003_orch_0815_marketing_hub_phase_a.sql
--   Cron/claim    supabase/migrations/20260603000000_orch_0815_b_marketing_send_cron.sql (mkt_claim_campaigns — re-used UNCHANGED)

BEGIN;

-- =========================================================================
-- §6.1 marketing_messages.status — add 'deferred'
-- =========================================================================
-- The status CHECK was created anonymously in Phase A as the
-- `marketing_messages_status_check` constraint (see the Phase-A probe at
-- 20260602000003_orch_0815_marketing_hub_phase_a.sql line 574 which matches
-- on that exact name). Preserve the name AND re-add the FULL enum so the
-- Phase-A `%preview_skipped%` probe still passes.
ALTER TABLE public.marketing_messages
  DROP CONSTRAINT IF EXISTS marketing_messages_status_check;
ALTER TABLE public.marketing_messages
  ADD CONSTRAINT marketing_messages_status_check CHECK (
    status IN (
      'queued', 'sent', 'delivered', 'opened', 'clicked',
      'bounced', 'failed', 'unsubscribed', 'preview_skipped', 'deferred'
    )
  );

-- =========================================================================
-- §6.2 marketing_messages — retry columns
-- =========================================================================
ALTER TABLE public.marketing_messages
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz;
ALTER TABLE public.marketing_messages
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.marketing_messages.next_attempt_at IS
  'ORCH-1270 — for status=''deferred'' SMS rows: the earliest instant the edge fn should re-attempt this recipient (approx recipient-local window open). NULL on all non-deferred rows.';
COMMENT ON COLUMN public.marketing_messages.attempt_count IS
  'ORCH-1270 — number of dispatch attempts for this recipient. Incremented on each defer; bounded by MAX_DEFER_ATTEMPTS in the edge fn so a perpetually-out-of-window recipient becomes terminal failed rather than looping.';

-- =========================================================================
-- §6.3 mkt_finalize_campaign — the RC-2 honest-status finalizer
-- =========================================================================
-- Computes counts from marketing_messages for the campaign and applies the
-- SPEC §5.2 status rule (cumulative across cron re-picks). SECURITY INVOKER
-- (default) — only ever called by service_role from marketing-send, which
-- bypasses RLS. Mirrors the mkt_claim_campaigns grant matrix (service_role
-- only; NEVER authenticated — caller code must not flip campaign status).
CREATE OR REPLACE FUNCTION public.mkt_finalize_campaign(p_campaign_id uuid)
RETURNS text
LANGUAGE plpgsql
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_delivered integer;
  v_deferred integer;
  v_preview integer;
  v_failed integer;
  v_min_next timestamptz;
  v_new_status text;
BEGIN
  SELECT
    count(*) FILTER (WHERE status IN ('sent', 'delivered', 'opened', 'clicked')),
    count(*) FILTER (WHERE status = 'deferred'),
    count(*) FILTER (WHERE status = 'preview_skipped'),
    count(*) FILTER (WHERE status IN ('failed', 'bounced')),
    min(next_attempt_at) FILTER (WHERE status = 'deferred')
  INTO v_delivered, v_deferred, v_preview, v_failed, v_min_next
  FROM public.marketing_messages
  WHERE campaign_id = p_campaign_id;

  -- Evaluated in this exact order (SPEC §5.2 table).
  IF v_deferred > 0 THEN
    -- Re-use status='scheduled' with a future scheduled_for so the EXISTING
    -- mkt_claim_campaigns cron re-picks the campaign at the next window with NO
    -- helper change. Operator sees an honest "Scheduled for ..." while the
    -- deferred cohort drains. recipient_count reflects the running delivered.
    v_new_status := 'scheduled';
    UPDATE public.marketing_campaigns
       SET status = 'scheduled',
           recipient_count = v_delivered,
           sent_at = NULL,
           scheduled_for = COALESCE(v_min_next, now() + interval '15 minutes'),
           updated_at = now()
     WHERE id = p_campaign_id;
  ELSIF v_delivered > 0 THEN
    v_new_status := 'sent';
    UPDATE public.marketing_campaigns
       SET status = 'sent',
           recipient_count = v_delivered,
           sent_at = now(),
           updated_at = now()
     WHERE id = p_campaign_id;
  ELSIF v_preview > 0 THEN
    -- Preview-gate (MARKETING_SEND_LIVE_ENABLED=false): honest 'sent' with the
    -- preview count (identical to the pre-ORCH-1270 email semantics).
    v_new_status := 'sent';
    UPDATE public.marketing_campaigns
       SET status = 'sent',
           recipient_count = v_preview,
           sent_at = now(),
           updated_at = now()
     WHERE id = p_campaign_id;
  ELSE
    -- Only failures / bounces / empty → honest 'failed', recipient_count 0.
    -- INVARIANT (I-PROPOSED-1270-NO-EMPTY-SENT): 'sent' is UNREACHABLE with
    -- recipient_count=0 because it requires v_delivered>0 OR v_preview>0.
    v_new_status := 'failed';
    UPDATE public.marketing_campaigns
       SET status = 'failed',
           recipient_count = 0,
           updated_at = now()
     WHERE id = p_campaign_id;
  END IF;

  RETURN v_new_status;
END;
$$;

REVOKE ALL ON FUNCTION public.mkt_finalize_campaign(uuid) FROM PUBLIC, anon, authenticated;
-- Only service-role (edge function) + superuser may execute. No GRANT to
-- authenticated — caller-facing code must never flip campaign status directly.
GRANT EXECUTE ON FUNCTION public.mkt_finalize_campaign(uuid) TO service_role;

-- =========================================================================
-- §6.4 Idempotency indexes — the structural double-send guarantee
-- =========================================================================
-- READ-ONLY duplicate guard (NO data mutation): a UNIQUE index build FAILS if
-- duplicate (campaign_id, recipient_phone) rows already exist. Prod was wiped
-- 2026-06-22 and holds only 2 SMS rows (distinct phones), so the risk is low —
-- but we RAISE loudly rather than let the CREATE INDEX fail cryptically. If
-- this fires, the operator dedups manually before re-running; this migration
-- does NOT authorize any DELETE.
DO $$
DECLARE
  v_dup text;
BEGIN
  SELECT string_agg(campaign_id::text || ':' || recipient_phone, ', ')
    INTO v_dup
    FROM (
      SELECT campaign_id, recipient_phone
        FROM public.marketing_messages
       WHERE recipient_phone IS NOT NULL
       GROUP BY campaign_id, recipient_phone
      HAVING count(*) > 1
    ) d;
  IF v_dup IS NOT NULL THEN
    RAISE EXCEPTION 'ORCH-1270 PRE-INDEX GUARD: duplicate (campaign_id, recipient_phone) rows exist [%] — dedup manually before re-running (no auto-DELETE authorized).', v_dup;
  END IF;
END$$;

-- NOTE (ORCH-1270 implementor deviation, empirically required — see IMPL report):
-- the SPEC §6.4 wrote these as PARTIAL indexes (WHERE recipient_phone/email IS
-- NOT NULL). PostgREST's `.upsert(row, { onConflict: 'campaign_id,recipient_phone' })`
-- emits `ON CONFLICT (campaign_id, recipient_phone)` with NO predicate, and
-- Postgres 17 CANNOT infer a PARTIAL unique index without its predicate — it
-- errors 42P10 "no unique or exclusion constraint matching the ON CONFLICT
-- specification" (verified against postgres:17 in a docker harness). A
-- NON-partial unique index IS inferable, and because Postgres treats NULLs as
-- DISTINCT by default, it still permits unlimited NULL-phone (email) rows per
-- campaign — functionally identical to the partial index for the double-send
-- guarantee. Same reasoning for the email index vs NULL-email (SMS) rows.
CREATE UNIQUE INDEX IF NOT EXISTS uq_mkt_msg_campaign_phone
  ON public.marketing_messages (campaign_id, recipient_phone);

DO $$
DECLARE
  v_dup text;
BEGIN
  SELECT string_agg(campaign_id::text || ':' || recipient_email, ', ')
    INTO v_dup
    FROM (
      SELECT campaign_id, recipient_email
        FROM public.marketing_messages
       WHERE recipient_email IS NOT NULL
       GROUP BY campaign_id, recipient_email
      HAVING count(*) > 1
    ) d;
  IF v_dup IS NOT NULL THEN
    RAISE EXCEPTION 'ORCH-1270 PRE-INDEX GUARD: duplicate (campaign_id, recipient_email) rows exist [%] — dedup manually before re-running (no auto-DELETE authorized).', v_dup;
  END IF;
END$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_mkt_msg_campaign_email
  ON public.marketing_messages (campaign_id, recipient_email);

-- Re-selection helper for the deferred cohort due-check.
CREATE INDEX IF NOT EXISTS idx_mkt_msg_deferred_due
  ON public.marketing_messages (campaign_id, next_attempt_at)
  WHERE status = 'deferred';

-- =========================================================================
-- Apply-time verification probes (RAISE EXCEPTION on partial apply)
-- =========================================================================
DO $$
DECLARE
  v_count integer;
BEGIN
  -- 'deferred' is an allowed message status now (RC-1).
  PERFORM 1 FROM pg_constraint
    WHERE conname = 'marketing_messages_status_check'
      AND pg_get_constraintdef(oid) LIKE '%deferred%';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORCH-1270 PROBE FAILED: marketing_messages.status CHECK missing ''deferred''';
  END IF;

  -- Retry columns exist.
  SELECT count(*) INTO v_count FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'marketing_messages'
      AND column_name IN ('next_attempt_at', 'attempt_count');
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'ORCH-1270 PROBE FAILED: expected next_attempt_at + attempt_count columns, found %', v_count;
  END IF;

  -- Finalizer exists (RC-2).
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
     WHERE proname = 'mkt_finalize_campaign'
       AND pronamespace = 'public'::regnamespace
  ) THEN
    RAISE EXCEPTION 'ORCH-1270 PROBE FAILED: mkt_finalize_campaign(uuid) missing';
  END IF;

  -- Finalizer grant matrix: service_role EXECUTE, authenticated NONE.
  IF NOT has_function_privilege('service_role', 'public.mkt_finalize_campaign(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ORCH-1270 PROBE FAILED: service_role must EXECUTE mkt_finalize_campaign';
  END IF;
  IF has_function_privilege('authenticated', 'public.mkt_finalize_campaign(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ORCH-1270 PROBE FAILED: authenticated must NOT EXECUTE mkt_finalize_campaign';
  END IF;

  -- Double-send indexes exist (RC-3 idempotency).
  SELECT count(*) INTO v_count FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname IN (
        'uq_mkt_msg_campaign_phone',
        'uq_mkt_msg_campaign_email',
        'idx_mkt_msg_deferred_due'
      );
  IF v_count <> 3 THEN
    RAISE EXCEPTION 'ORCH-1270 PROBE FAILED: expected 3 ORCH-1270 indexes, found %', v_count;
  END IF;

  RAISE NOTICE 'ORCH-1270 migration applied: deferred status + retry columns + mkt_finalize_campaign + 3 indexes';
END$$;

COMMIT;
