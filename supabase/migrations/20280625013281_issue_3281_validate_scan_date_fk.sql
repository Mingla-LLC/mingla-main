-- Issue #3281 bundle 6 — validate scan_events.event_date_id (ON DELETE
-- RESTRICT), added NOT VALID by 20280625003281 so that migration never scanned
-- scan_events while holding its locks. VALIDATE takes SHARE UPDATE EXCLUSIVE on
-- scan_events and ROW SHARE on event_dates: reads and writes carry on.

BEGIN;

SET LOCAL lock_timeout = '3s';
ALTER TABLE public.scan_events VALIDATE CONSTRAINT scan_events_event_date_id_fkey;

DO $$
BEGIN
  IF NOT (SELECT convalidated FROM pg_constraint
           WHERE conname = 'scan_events_event_date_id_fkey'
             AND conrelid = 'public.scan_events'::regclass) THEN
    RAISE EXCEPTION '#3281 bundle 6 self-assert: scan date foreign key not validated';
  END IF;
END $$;

COMMIT;
