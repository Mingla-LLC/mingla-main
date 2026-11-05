-- issue #3281 — a private ticket link says which dates its ticket covers.
--
-- Day-limited tickets carry their dates on every public reader (`validOccurrenceIds`,
-- by event_dates id; null means All dates), but the private-link resolver did
-- not, so a guest on a listed private ticket who chose extra dates was only
-- told no by checkout (`ticket_not_valid_on_chosen_days`). The resolver's
-- ticket now carries the same field, so the cart can show the scope line and
-- keep the line to the dates the ticket covers, as it does for public tickets.
--
-- The resolver is re-emitted by transform, the way #3872 added its sale
-- fields: the edit is anchored on that line and refuses to apply to drift.

BEGIN;

CREATE FUNCTION public.issue_3281_ticket_dates_json(p_ticket_type_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT jsonb_build_object(
    'validOccurrenceIds',
    CASE WHEN tt.valid_occurrence_keys IS NULL THEN NULL ELSE to_jsonb(ARRAY(
      SELECT d.id FROM public.event_dates d
       WHERE d.event_id = tt.event_id
         AND d.occurrence_key = ANY (tt.valid_occurrence_keys)
       ORDER BY d.start_at, d.id)) END)
  FROM public.ticket_types tt
  WHERE tt.id = p_ticket_type_id;
$fn$;

REVOKE ALL ON FUNCTION public.issue_3281_ticket_dates_json(uuid) FROM PUBLIC, anon, authenticated;

DO $install$
DECLARE
  v_body text;
  v_old text := E'      ) || COALESCE(public.issue_3872_ticket_sale_json(tt.id),''{}''::jsonb) END,';
  v_new text := E'      ) || COALESCE(public.issue_3872_ticket_sale_json(tt.id),''{}''::jsonb)\n'
    '        || COALESCE(public.issue_3281_ticket_dates_json(tt.id),''{}''::jsonb) END,';
BEGIN
  SELECT p.prosrc INTO v_body
    FROM pg_proc p
   WHERE p.oid = 'public.pg_ticket_link_resolve(text)'::regprocedure;
  IF position('issue_3281_ticket_dates_json' IN v_body) > 0 THEN
    RAISE EXCEPTION 'issue_3281_link_dates_already_applied';
  END IF;
  IF (length(v_body) - length(replace(v_body, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'issue_3281_link_dates_transform_drift';
  END IF;
  EXECUTE format(
    'CREATE OR REPLACE FUNCTION public.pg_ticket_link_resolve(p_token_hash text) '
    'RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER '
    'SET search_path=public,pg_temp AS %L',
    replace(v_body, v_old, v_new)
  );
END;
$install$;

NOTIFY pgrst, 'reload schema';

COMMIT;
