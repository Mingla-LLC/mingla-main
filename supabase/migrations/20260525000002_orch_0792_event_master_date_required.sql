-- ORCH-0792: enforce I-PROPOSED-AX EVENT_HAS_MASTER_DATE via constraint trigger.
--
-- A row-level CHECK can't query event_dates because CHECK constraints
-- can't reference other tables. So we use a BEFORE UPDATE trigger that
-- runs only on the specific status transitions we care about.
--
-- Order of operations vs sibling migrations:
--   (1) 20260525000000 — publish RPC INSERTs event_dates BEFORE flipping
--       events.status. The trigger here therefore PASSES on the
--       publish path (master row exists by the time UPDATE runs).
--   (2) 20260525000001 — backfill creates event_dates for legacy events.
--       Trigger doesn't fire on backfill (we're INSERTing event_dates,
--       not UPDATEing events).
--   (3) This migration — installs the trigger ONLY AFTER backfill, so
--       existing scheduled/live events that were backfilled in step (2)
--       are already compliant.
--
-- See: Mingla_Artifacts/specs/SPEC_ORCH-0792_EVENTS_WITHOUT_DATES.md §4.3

BEGIN;

CREATE OR REPLACE FUNCTION public.biz_enforce_event_has_master_date() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Only enforce on status transitions INTO scheduled or live from a non-
  -- compliant source state. Once an event is scheduled/live and has its
  -- master row, subsequent UPDATEs (e.g., cover edits) skip the check.
  IF TG_OP = 'UPDATE'
    AND NEW.status IN ('scheduled', 'live')
    AND (OLD.status IS DISTINCT FROM NEW.status)
    AND NEW.deleted_at IS NULL
  THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.event_dates ed
      WHERE ed.event_id = NEW.id AND ed.is_master = true
    ) THEN
      RAISE EXCEPTION 'event_must_have_master_date'
        USING HINT = 'Insert at least one event_dates row with is_master=true before promoting events.status to scheduled/live (ORCH-0792).';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.biz_enforce_event_has_master_date IS
  'ORCH-0792: enforces invariant I-PROPOSED-AX EVENT_HAS_MASTER_DATE. Blocks events.status transitions to scheduled/live unless a master event_dates row exists. Pairs with the partial unique index event_dates_master_unique.';

DROP TRIGGER IF EXISTS trg_events_enforce_master_date ON public.events;

CREATE TRIGGER trg_events_enforce_master_date
  BEFORE UPDATE ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.biz_enforce_event_has_master_date();

COMMENT ON TRIGGER trg_events_enforce_master_date ON public.events IS
  'ORCH-0792: enforces I-PROPOSED-AX EVENT_HAS_MASTER_DATE on status transitions.';

COMMIT;
