-- ORCH-0826 — Mingla Business 1.2 M0: Hub Foundation.
-- Adds events.event_type discriminator column for the unified offering model.
--
-- I-1.2-UNIFIED-EVENT-TYPE: every sellable thing is a row in public.events
-- with event_type discriminator (`event` / `experience` / `trip`). No
-- parallel offering tables. Future Tr2+ writes 'trip' rows; Ve5+ writes
-- 'experience' rows; existing flows continue to write 'event' rows.
--
-- Safety analysis (from INVESTIGATION_ORCH-0826):
--   - Zero existing CHECK constraints conflict on the events table
--   - Zero name-collision risk for `event_type` (existing references in user-
--     timeline + Stripe webhook + brand_stripe_orphaned_refunds; none on events)
--   - Cross-domain blast radius narrow: 0 reads from app-mobile/, 0 from
--     mingla-admin/, 4 files in mingla-business/, 6 edge functions
--   - business-publish-event-draft RPC: only UPDATEs events (does not INSERT)
--   - eventDrafts.ts:189-191 INSERT uses named-object payload — column DEFAULT
--     applies safely to event_type for unmentioned columns
--
-- Filename monotonicity:
--   Existing migration head is 20260604000004 (future-dated). This migration
--   uses 20260605000000 to be safely monotonic past the head, even though
--   wall-clock is 2026-05-14. Per implementor working-branch rule 5.
--
-- See: Mingla_Artifacts/specs/SPEC_ORCH-0826_M0_HUB_FOUNDATION.md §2
--      Mingla_Artifacts/reports/INVESTIGATION_ORCH-0826_M0_HUB_FOUNDATION.md
--      Mingla_Artifacts/PROJECT_SPEC_MINGLA_BUSINESS_1_2.md §3.3

BEGIN;

-- (1) Add the discriminator column with default + CHECK -------------------

ALTER TABLE public.events
  ADD COLUMN event_type text NOT NULL DEFAULT 'event'
    CHECK (event_type IN ('event', 'experience', 'trip'));

COMMENT ON COLUMN public.events.event_type IS
  'Mingla Business 1.2 (ORCH-0826) — unified offering discriminator. '
  '`event` = today''s ticketed event (popup organizers); '
  '`experience` = single-intent venue-derived offering (Ve5+); '
  '`trip` = multi-day curated package (Tr2+). '
  'I-1.2-UNIFIED-EVENT-TYPE: no parallel offering tables.';

-- (2) Defensive explicit backfill -----------------------------------------
--
-- Postgres ADD COLUMN ... NOT NULL DEFAULT already handles this automatically,
-- but an explicit UPDATE ensures audit-log clarity and protects against any
-- edge case where rows might briefly exist without the column populated.

UPDATE public.events
  SET event_type = 'event'
  WHERE event_type IS NULL;

-- (3) Index for filter queries --------------------------------------------
--
-- Partial-style not needed yet (only 3 enum values, low cardinality). Full
-- index helps future Hub > Experiences and Hub > Trips filter queries that
-- will be added in Ve5+/Tr2+.

CREATE INDEX idx_events_event_type ON public.events(event_type);

-- (4) Self-verification ---------------------------------------------------
--
-- Post-migration sanity check: every row must have a valid event_type value.
-- Raises an exception if backfill missed anything (defensive guard).

DO $$
DECLARE
  v_null_count bigint;
  v_invalid_count bigint;
BEGIN
  SELECT count(*) INTO v_null_count
    FROM public.events
    WHERE event_type IS NULL;

  SELECT count(*) INTO v_invalid_count
    FROM public.events
    WHERE event_type NOT IN ('event', 'experience', 'trip');

  IF v_null_count > 0 THEN
    RAISE EXCEPTION 'ORCH-0826 migration: % rows have NULL event_type after backfill',
      v_null_count;
  END IF;

  IF v_invalid_count > 0 THEN
    RAISE EXCEPTION 'ORCH-0826 migration: % rows have invalid event_type after backfill',
      v_invalid_count;
  END IF;

  RAISE NOTICE 'ORCH-0826 migration complete: events.event_type discriminator added (all rows defaulted to event)';
END $$;

COMMIT;
