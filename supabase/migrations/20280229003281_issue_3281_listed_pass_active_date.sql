-- issue #3281 — a listed ticket's new pass needs a date that can still be used.
--
-- The door sheet now sends a date, and a stale sheet could still name one that
-- was cancelled or has ended. Dates a pass already holds are untouched: this
-- trigger only runs when a pass gains a date.

BEGIN;

CREATE OR REPLACE FUNCTION public.issue_3281_pass_day_in_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_keys text[];
BEGIN
  SELECT tt.valid_occurrence_keys INTO v_keys
    FROM public.tickets t
    JOIN public.ticket_types tt ON tt.id = t.ticket_type_id
   WHERE t.id = NEW.ticket_id;
  IF v_keys IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.event_dates d
     WHERE d.id = NEW.event_date_id AND d.occurrence_key = ANY (v_keys)
       AND d.cancelled_at IS NULL AND d.end_at > now()
  ) THEN
    RAISE EXCEPTION 'ticket_not_valid_on_chosen_days';
  END IF;
  RETURN NEW;
END;
$fn$;

COMMIT;
