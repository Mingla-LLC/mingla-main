-- ORCH-0558 Step 2 — Schema hardening.
--
-- Enforces two new invariants (per SPEC §4.7):
--   I-BOARD-SAVED-CARDS-EXPERIENCE-ID-NOT-NULL
--   I-MATCH-PROMOTION-DETERMINISTIC (partial — via unique constraint)
--
-- MUST run after 20260421000001_orch_0558_historical_cleanup.sql
-- (NOT NULL and unique index would fail otherwise).
--
-- Note on the CONCURRENTLY split: CREATE INDEX CONCURRENTLY cannot run
-- inside an explicit transaction block. Supabase `db push` applies each
-- migration file as a single transaction, so we split the unique index
-- into its own CREATE INDEX (non-concurrent) which is fine for this
-- scale (dev has 5 rows, prod's board_saved_cards is small). If this
-- ever needs to run against a larger table, split this migration into
-- two files: one for NOT NULL, one with CONCURRENTLY run outside Tx.
--
-- Rollback (if needed — not recommended):
--   ALTER TABLE public.board_saved_cards ALTER COLUMN experience_id DROP NOT NULL;
--   DROP INDEX IF EXISTS public.board_saved_cards_session_experience_unique;
--
-- Note: the 3-column unique index
--   board_saved_cards_session_id_experience_id_saved_experience_key
-- (session_id, experience_id, saved_experience_id) pre-dates this migration.
-- It is LEFT IN PLACE (it's additive, and some code may still reference
-- `saved_experience_id`). The new 2-column index is the authoritative
-- uniqueness constraint; the 3-column is redundant but harmless.

BEGIN;

-- ==========================================================================
-- Step 2a — NOT NULL constraint on experience_id
-- ==========================================================================

ALTER TABLE public.board_saved_cards
  ALTER COLUMN experience_id SET NOT NULL;

COMMENT ON COLUMN public.board_saved_cards.experience_id IS
  'ORCH-0558: Google Place ID / experience identifier. MUST be non-NULL. '
  'Match detection in check_mutual_like trigger and rpc_record_swipe_and_check_match '
  'both rely on this column. Historical NULLs cleaned up in migration '
  '20260421000001. Never write NULL — service-role included.';

-- ==========================================================================
-- Step 2b — Unique index on (session_id, experience_id)
-- ==========================================================================

CREATE UNIQUE INDEX IF NOT EXISTS
  board_saved_cards_session_experience_unique
  ON public.board_saved_cards(session_id, experience_id);

COMMENT ON INDEX public.board_saved_cards_session_experience_unique IS
  'ORCH-0558: Enforces one saved_card row per (session_id, experience_id). '
  'Used by check_mutual_like ON CONFLICT clause to gracefully handle the '
  'concurrency race (two simultaneous quorum-reaching swipes). Must remain '
  'in place even if the older 3-column index is retained.';

COMMIT;
