-- Issue #4572 item 5 data (D8): a guarded one-off repair of the venue names that
-- duplicate / unpublish joined with the address before 20281129504572.
-- Spec: issue comment 7095452940, Part 5.3 (approved by Seth, D8, 2026-11-23).
--
-- Classes (live data read 2026-11-23, ids only, never names):
--   A  live, business_event.location.venueName = "X · <address>", address set,
--      location_text = venueName || ' · ' || address (the address shows twice).
--      Repair: venueName := X, location_text := X || ' · ' || address.     4 rows
--   D  draft, business_draft.location.venueName has exactly one ' · ', address
--      empty, location_text = venueName.
--      Repair: split into venueName and address; location_text unchanged. 2 rows
--   B / C  any other joined-looking row: left alone, listed for the hosts.
--
-- Guest notices: the #3827 trigger issue_3827_capture_edit_notice watches
-- theme and location_text on live events, and has no bypass of its own. This
-- repair is a data correction, not a host edit, so that one trigger is disabled
-- for the length of this transaction only (the #3872 / #4216 backfill
-- protocol) and re-enabled before commit. No other trigger is touched: the
-- #4420 location-withholding, updated_at and place-stamp triggers all run.
--
-- The counts are re-checked inside the transaction: if production no longer
-- has exactly 4 class-A and 2 class-D rows, the migration raises and changes
-- nothing. 0 + 0 is the one other accepted state: a second run after the repair,
-- and every fresh CI replay (no production rows), both change nothing.
--
-- READ-ONLY PROBE (2026-11-23 returned A=4, D=2; B/C rows: 2 live, left alone):
--   Run the body of pg_temp.issue_4572_joined_venue_rows() below as a plain
--   SELECT with "SELECT cls, count(*) ... GROUP BY 1" around it.
--
-- ROLLBACK (manual): none needed for correctness; the old joined values are
-- printed by the RAISE NOTICE lines as ids and lengths only.

CREATE OR REPLACE FUNCTION pg_temp.issue_4572_joined_venue_rows()
RETURNS TABLE (event_id uuid, cls text, venue text, address text)
LANGUAGE sql
AS $function$
  SELECT x.id,
         CASE
           WHEN x.status <> 'draft'
                AND COALESCE(x.ad, '') <> ''
                AND x.vn LIKE '% · ' || x.ad
                AND x.lt = x.vn || ' · ' || x.ad
             THEN 'A'
           WHEN x.status = 'draft'
                AND COALESCE(x.ad, '') = ''
                AND (length(x.vn) - length(replace(x.vn, ' · ', ''))) / 3 = 1
                AND x.lt IS NOT DISTINCT FROM x.vn
             THEN 'D'
           ELSE 'other'
         END,
         x.vn,
         x.ad
    FROM (
      SELECT e.id, e.status, e.location_text AS lt,
             b #>> '{location,venueName}' AS vn,
             b #>> '{location,address}' AS ad
        FROM public.events e
        CROSS JOIN LATERAL (
          SELECT CASE WHEN e.status = 'draft' THEN e.theme -> 'business_draft'
                      ELSE public.issue_4420_event_theme_full(e.id, e.theme) -> 'business_event'
                 END AS b) src
       WHERE e.deleted_at IS NULL
         AND e.event_type = 'event'
    ) x
   WHERE x.vn LIKE '% · %'
$function$;

DO $repair$
DECLARE
  v_a integer;
  v_d integer;
  v_done integer;
  r record;
  v_x text;
  v_rows integer;
BEGIN
  SELECT count(*) FILTER (WHERE cls = 'A'), count(*) FILTER (WHERE cls = 'D')
    INTO v_a, v_d
    FROM pg_temp.issue_4572_joined_venue_rows();

  IF v_a = 0 AND v_d = 0 THEN
    RAISE NOTICE 'issue_4572_repair: nothing to repair (already applied)';
    RETURN;
  END IF;
  IF v_a <> 4 OR v_d <> 2 THEN
    RAISE EXCEPTION 'issue_4572_repair_count_mismatch: expected A=4 D=2, found A=% D=%', v_a, v_d;
  END IF;

  ALTER TABLE public.events DISABLE TRIGGER issue_3827_capture_edit_notice;

  v_done := 0;
  FOR r IN SELECT * FROM pg_temp.issue_4572_joined_venue_rows() WHERE cls = 'A' LOOP
    v_x := left(r.venue, length(r.venue) - length(' · ' || r.address));
    UPDATE public.events e
       SET theme = jsonb_set(e.theme, '{business_event,location,venueName}', to_jsonb(v_x), false),
           location_text = v_x || ' · ' || r.address
     WHERE e.id = r.event_id
       AND e.theme #>> '{business_event,location,venueName}' = r.venue;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_done := v_done + v_rows;
    RAISE NOTICE 'issue_4572_repair A % venue % -> % chars', r.event_id, length(r.venue), length(v_x);
  END LOOP;

  FOR r IN SELECT * FROM pg_temp.issue_4572_joined_venue_rows() WHERE cls = 'D' LOOP
    UPDATE public.events e
       SET theme = jsonb_set(
             jsonb_set(e.theme, '{business_draft,location,venueName}',
               to_jsonb(split_part(r.venue, ' · ', 1)), false),
             '{business_draft,location,address}',
             to_jsonb(split_part(r.venue, ' · ', 2)), true)
     WHERE e.id = r.event_id
       AND e.theme #>> '{business_draft,location,venueName}' = r.venue;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_done := v_done + v_rows;
    RAISE NOTICE 'issue_4572_repair D % split into venue and address', r.event_id;
  END LOOP;

  ALTER TABLE public.events ENABLE TRIGGER issue_3827_capture_edit_notice;

  IF v_done <> 6 THEN
    RAISE EXCEPTION 'issue_4572_repair_row_mismatch: expected 6 updated rows, got %', v_done;
  END IF;
END;
$repair$;

DROP FUNCTION pg_temp.issue_4572_joined_venue_rows();
