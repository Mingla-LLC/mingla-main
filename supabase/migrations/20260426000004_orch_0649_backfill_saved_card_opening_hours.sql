-- Migration: 20260426000004_orch_0649_backfill_saved_card_opening_hours.sql
-- ORCH-0649: Backfill saved_card.card_data->openingHours from place_pool.opening_hours
-- for rows where the deckService.ts:184-187 transform corrupted them into
-- four garbage strings (entries starting with OpenNow:/Periods:/NextOpenTime:/
-- NextCloseTime:/WeekdayDescriptions:).
--
-- Idempotency: WHERE clause matches only the broken pattern; already-correct
-- rows are untouched. Running twice produces the same final state.
--
-- ORDERING INVARIANT — CRITICAL:
--   This migration MUST be applied AFTER the OTA that ships the deckService
--   pass-through fix is fully rolled out (24-hour wait recommended). Otherwise
--   old clients will continue producing broken saves and re-corrupt rows
--   post-migration. See SPEC_ORCH-0649_EXPANDED_CARD_QUARTET.md §12 step 13.
--
-- experience_id mapping:
--   saved_card.experience_id is either
--     - place_pool.id::text (UUID, newer saves post-2026-04-22), OR
--     - place_pool.google_place_id (ChIJ... format, older saves), OR
--     - 'curated_<intent>_<ts>_<rand>' (curated cards — these have no single
--       place_pool row; openingHours for curated cards lives under
--       card_data->'stops'[*]->'openingHours' and is out of scope here).
--   Rows whose experience_id matches no place_pool row will have
--   openingHours set to JSON null (graceful degradation — section hides).
--
-- Rollback:
--   This migration is roll-forward only. To revert the data change, restore
--   from a pre-migration backup. The BEGIN/COMMIT envelope ensures
--   all-or-nothing.

BEGIN;

-- Step A: For broken rows whose experience_id matches a place_pool row,
-- replace openingHours with the fresh place_pool.opening_hours.
UPDATE saved_card sc
SET card_data = jsonb_set(
  sc.card_data,
  '{openingHours}',
  COALESCE(
    (
      SELECT pp.opening_hours
      FROM place_pool pp
      WHERE pp.id::text = sc.experience_id
         OR pp.google_place_id = sc.experience_id
      LIMIT 1
    ),
    'null'::jsonb
  )
)
WHERE EXISTS (
  SELECT 1
  FROM jsonb_array_elements_text(sc.card_data->'openingHours'->'weekday_text') wt
  WHERE wt LIKE 'OpenNow:%'
     OR wt LIKE 'Periods:%'
     OR wt LIKE 'NextOpenTime:%'
     OR wt LIKE 'NextCloseTime:%'
     OR wt LIKE 'WeekdayDescriptions:%'
);

-- Step B: Post-check assertion. Must return 0.
-- Implementor + deployer: run this verification after applying.
-- SELECT count(*) FROM saved_card
-- WHERE EXISTS (
--   SELECT 1 FROM jsonb_array_elements_text(card_data->'openingHours'->'weekday_text') wt
--   WHERE wt LIKE 'OpenNow:%' OR wt LIKE 'Periods:%'
--      OR wt LIKE 'NextOpenTime:%' OR wt LIKE 'NextCloseTime:%'
--      OR wt LIKE 'WeekdayDescriptions:%'
-- );

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────
-- PRE-FLIGHT (run BEFORE applying — do NOT commit these into the migration;
-- kept here as deployment-runbook documentation):
--
--   -- Pre-flight 1: Confirm broken row count (expect non-zero on prod).
--   SELECT count(*) FROM saved_card
--   WHERE EXISTS (
--     SELECT 1 FROM jsonb_array_elements_text(card_data->'openingHours'->'weekday_text') wt
--     WHERE wt LIKE 'OpenNow:%' OR wt LIKE 'Periods:%'
--        OR wt LIKE 'NextOpenTime:%' OR wt LIKE 'NextCloseTime:%'
--        OR wt LIKE 'WeekdayDescriptions:%'
--   );
--
--   -- Pre-flight 2: Confirm experience_id matching coverage (expect ≥ 95%).
--   SELECT
--     count(*) FILTER (WHERE pp.id IS NOT NULL) AS would_be_backfilled,
--     count(*) FILTER (WHERE pp.id IS NULL) AS would_be_nulled,
--     count(*) AS total_broken
--   FROM saved_card sc
--   LEFT JOIN place_pool pp
--     ON pp.id::text = sc.experience_id OR pp.google_place_id = sc.experience_id
--   WHERE EXISTS (
--     SELECT 1 FROM jsonb_array_elements_text(sc.card_data->'openingHours'->'weekday_text') wt
--     WHERE wt LIKE 'OpenNow:%' OR wt LIKE 'Periods:%'
--        OR wt LIKE 'NextOpenTime:%' OR wt LIKE 'NextCloseTime:%'
--        OR wt LIKE 'WeekdayDescriptions:%'
--   );
--
-- POST-FLIGHT (run AFTER applying):
--
--   -- Post-flight 1: Must return 0.
--   [Step B assertion above]
--
--   -- Post-flight 2: Spot-check that backfilled rows now have v1 shape.
--   SELECT id, title, card_data->'openingHours'->'weekdayDescriptions'->>0 AS first_day
--   FROM saved_card
--   WHERE card_data->'openingHours' IS NOT NULL
--     AND card_data->'openingHours'->'weekday_text' IS NULL
--   ORDER BY created_at DESC
--   LIMIT 5;
--   -- Expected: first_day starts with "Monday:" (or day[0] of weekdayDescriptions).
-- ─────────────────────────────────────────────────────────────────────────
