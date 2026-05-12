-- ORCH-0793 follow-up — widen scan_events.scan_result CHECK to include the
-- new time-window discriminators emitted by biz_ticket_scan.
--
-- Why a follow-up migration instead of amending 20260528000000:
-- the previous migration is already applied on remote (immutable); the
-- correct path is a strictly-monotonic follow-up. Caught by tester live-fire
-- QA on 2026-05-12 — original migration shipped the RPC body without
-- widening this pre-existing constraint, so every out-of-window scan was
-- rolled back by check_violation (SQLSTATE 23514) before the audit row
-- could land. Buyer-burn protection accidentally held due to transaction
-- rollback, but the new overlays never reached the operator UI.
--
-- Cross-references:
--   - QA: Mingla_Artifacts/reports/QA_ORCH-0793_BIZ_TICKET_SCAN_TIME_WINDOW_REPORT.md §2 P0-1
--   - SPEC: Mingla_Artifacts/specs/SPEC_ORCH-0793_BIZ_TICKET_SCAN_TIME_WINDOW.md
--   - Invariant: I-PROPOSED-BB SCAN_TIME_WINDOW_ENFORCED

ALTER TABLE public.scan_events DROP CONSTRAINT scan_events_result_check;
ALTER TABLE public.scan_events
  ADD CONSTRAINT scan_events_result_check
  CHECK (scan_result = ANY (ARRAY[
    'success'::text,
    'duplicate'::text,
    'not_found'::text,
    'wrong_event'::text,
    'void'::text,
    'not_yet_open'::text,
    'event_ended'::text
  ]));

-- Verification probe — fail loudly if the constraint shape drifted.
DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
   WHERE n.nspname = 'public'
     AND t.relname = 'scan_events'
     AND c.conname = 'scan_events_result_check';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'ORCH-0793 widen probe failed: scan_events_result_check constraint not found post-migration';
  END IF;
  IF v_def NOT LIKE '%not_yet_open%' THEN
    RAISE EXCEPTION 'ORCH-0793 widen probe failed: scan_events_result_check missing not_yet_open. Got: %', v_def;
  END IF;
  IF v_def NOT LIKE '%event_ended%' THEN
    RAISE EXCEPTION 'ORCH-0793 widen probe failed: scan_events_result_check missing event_ended. Got: %', v_def;
  END IF;
END$$;
