-- ORCH-0558 Step 1 — Historical anomaly cleanup.
--
-- Pre-0558 the collab right-swipe flow had a direct-save bypass path
-- (BoardCardService.saveCardToBoard) that inserted board_saved_cards rows
-- with experience_id=NULL, storing the Google Place ID only in card_data
-- JSONB. Those rows ("ghosts") are now actively preventing new matches
-- because the ORCH-0556 trigger's existing-card shortcut finds them via
-- card_data->>'id' and attaches votes instead of promoting.
--
-- This migration (per SPEC_ORCH-0558 §4.1.1 + orchestrator decision D1
-- "Automated backfill + delete"):
--   (1) Backfill experience_id = card_data->>'id' where recoverable
--   (2) DELETE rows where experience_id is NULL AND no id in card_data
--   (3) Dedupe any rows that become (session_id, experience_id) duplicates
--       post-backfill, keeping highest-vote survivor (saved_at tiebreak)
--
-- MUST run BEFORE 20260421000002_orch_0558_schema_hardening (NOT NULL +
-- unique constraint would fail otherwise).
--
-- Pre-flight MCP probe on dev (2026-04-20) showed:
--   - 5 total saved_cards, all 5 NULL-exp-id (all backfillable)
--   - 0 unrecoverable
--   - 0 post-backfill duplicate candidates
-- Production (qcuvymtvywggpdymoyzj) numbers are not verifiable from here;
-- the NOTICE blocks inside this migration will log the actual counts.
--
-- Rollback: no programmatic rollback. If backfill or DELETE is wrong,
-- the dropped rows are unrecoverable. This migration is irreversible by
-- design — ghosts are a historical data-quality debt, not live data.

BEGIN;

-- ==========================================================================
-- Step 1a — Audit counts (NOTICE for deploy log)
-- ==========================================================================

DO $$
DECLARE
  backfillable_count INTEGER;
  unrecoverable_count INTEGER;
  total_count INTEGER;
BEGIN
  SELECT
    count(*) FILTER (WHERE experience_id IS NULL AND card_data ? 'id' AND (card_data->>'id') IS NOT NULL AND (card_data->>'id') <> ''),
    count(*) FILTER (WHERE experience_id IS NULL AND NOT (card_data ? 'id' AND (card_data->>'id') IS NOT NULL AND (card_data->>'id') <> '')),
    count(*)
  INTO backfillable_count, unrecoverable_count, total_count
  FROM public.board_saved_cards;

  RAISE NOTICE 'ORCH-0558 cleanup pre-state: total=% backfillable=% unrecoverable=%',
    total_count, backfillable_count, unrecoverable_count;
END $$;

-- ==========================================================================
-- Step 1b — Backfill experience_id from card_data->>'id'
-- ==========================================================================

UPDATE public.board_saved_cards
SET experience_id = card_data->>'id'
WHERE experience_id IS NULL
  AND card_data ? 'id'
  AND (card_data->>'id') IS NOT NULL
  AND (card_data->>'id') <> '';

-- ==========================================================================
-- Step 1c — Delete rows we can't recover (NULL exp_id AND no id in JSONB)
-- ==========================================================================

DELETE FROM public.board_saved_cards
WHERE experience_id IS NULL;

-- ==========================================================================
-- Step 1d — Verify zero NULL experience_id remain
-- ==========================================================================

DO $$
DECLARE
  remaining INTEGER;
BEGIN
  SELECT count(*) INTO remaining FROM public.board_saved_cards WHERE experience_id IS NULL;
  IF remaining > 0 THEN
    RAISE EXCEPTION 'ORCH-0558 cleanup FAILED: % rows still have NULL experience_id', remaining;
  END IF;
  RAISE NOTICE 'ORCH-0558 cleanup: all NULL experience_id rows resolved';
END $$;

-- ==========================================================================
-- Step 1e — Dedupe (session_id, experience_id) duplicates post-backfill
-- Survivor: highest vote_count, tiebreak by newest saved_at
-- ==========================================================================

WITH ranked AS (
  SELECT
    bsc.id,
    row_number() OVER (
      PARTITION BY bsc.session_id, bsc.experience_id
      ORDER BY
        (SELECT count(*) FROM public.board_votes bv WHERE bv.saved_card_id = bsc.id) DESC,
        bsc.saved_at DESC,
        bsc.id  -- final stable tiebreak
    ) AS rn
  FROM public.board_saved_cards bsc
)
DELETE FROM public.board_saved_cards
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- ==========================================================================
-- Step 1f — Verify zero (session_id, experience_id) duplicates remain
-- ==========================================================================

DO $$
DECLARE
  dup_count INTEGER;
BEGIN
  SELECT count(*) INTO dup_count FROM (
    SELECT session_id, experience_id, count(*) AS c
    FROM public.board_saved_cards
    GROUP BY session_id, experience_id
    HAVING count(*) > 1
  ) t;
  IF dup_count > 0 THEN
    RAISE EXCEPTION 'ORCH-0558 cleanup FAILED: % duplicate (session_id, experience_id) pairs remain', dup_count;
  END IF;
  RAISE NOTICE 'ORCH-0558 cleanup: zero duplicates, ready for schema hardening';
END $$;

COMMIT;
