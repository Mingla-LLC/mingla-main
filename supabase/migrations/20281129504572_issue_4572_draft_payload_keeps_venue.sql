-- Issue #4572 item 5: duplicating an event, or unpublishing it back to a draft,
-- keeps the venue name and the address as two separate fields.
-- Spec: "Spec: Host events and buyer pages (items 5, 6, 7b, 7c, 7d, 7e)",
-- issue comment 7095452940, Part 5.1 (approved by Seth, D1-D13, 2026-11-23).
--
-- Before: business_event_draft_payload_from_graph(uuid) rebuilt the draft
-- 'location' of a live event as {venueName: location_text, address: null}.
-- location_text is the joined label "Venue · Address", so the copy showed the
-- address inside the venue name and the address field empty.
--
-- After: when the stored payload (business_draft for a draft, the #4420 full
-- business_event for a live event, the same source v_business is built from) carries
-- a venue name or an address, those two halves are copied as they are. Only a
-- source with neither half falls back to {venueName: location_text, address: null}.
--
-- business_duplicate_event_as_draft and business_unpublish_event_to_draft both
-- call this function, so both are fixed without being re-emitted.
--
-- Drift guard: the live body is 20280314003281 plus the #4420 text patch
-- (20280724004420). md5(prosrc) must equal the production value read on
-- 2026-11-23 or this migration raises. The change is a one-match text replace
-- (exactly one match of the old expression, or raise), so nothing else in the
-- body can move.
--
-- READ-ONLY PROBE (run right before applying; 2026-11-23 returned
-- 70d700a8a651da50233b0cf82f75519c):
--   SELECT md5(prosrc) FROM pg_proc
--    WHERE oid = 'public.business_event_draft_payload_from_graph(uuid)'::regprocedure;
--
-- ROLLBACK (manual): re-run this file's replace with the two literals swapped.

DO $drift_guard$
BEGIN
  IF (SELECT md5(p.prosrc) FROM pg_proc p
       WHERE p.oid = 'public.business_event_draft_payload_from_graph(uuid)'::regprocedure)
     IS DISTINCT FROM '70d700a8a651da50233b0cf82f75519c' THEN
    RAISE EXCEPTION 'issue_4572_drift: business_event_draft_payload_from_graph(uuid) no longer matches the reviewed production body';
  END IF;
END;
$drift_guard$;

CREATE OR REPLACE FUNCTION pg_temp.issue_4572_text_patch(
  p_signature text,
  p_old text,
  p_new text
) RETURNS void
LANGUAGE plpgsql
AS $function$
DECLARE
  v_def text;
  v_old_count integer;
BEGIN
  v_def := pg_get_functiondef(p_signature::regprocedure);
  v_old_count := (length(v_def) - length(replace(v_def, p_old, ''))) / length(p_old);
  IF v_old_count <> 1 THEN
    RAISE EXCEPTION 'issue_4572_shape_mismatch: % expected 1 match, found %',
      p_signature, v_old_count;
  END IF;
  EXECUTE replace(v_def, p_old, p_new);
END
$function$;

SELECT pg_temp.issue_4572_text_patch(
  'public.business_event_draft_payload_from_graph(uuid)',
  $o$      'location', CASE WHEN v_event.status='draft' THEN
        COALESCE(v_event.theme#>'{business_draft,location}',
          jsonb_build_object('venueName',v_event.location_text,'address',NULL))
        ELSE jsonb_build_object('venueName',v_event.location_text,'address',NULL) END,$o$,
  $n$      -- #4572 item 5: copy the stored venue name and address as two fields.
      -- v_business is still being assigned here, so the stored payload is read
      -- from the same source v_business is built from.
      'location', (SELECT CASE WHEN COALESCE(s.l->>'venueName','')<>''
                               OR COALESCE(s.l->>'address','')<>''
                          THEN s.l
                          ELSE jsonb_build_object('venueName',v_event.location_text,'address',NULL) END
        FROM (SELECT CASE WHEN jsonb_typeof(src.b->'location')='object' THEN src.b->'location' END AS l
                FROM (SELECT COALESCE(v_event.theme->'business_draft',
                        public.issue_4420_event_theme_full(v_event.id, v_event.theme)->'business_event') AS b) src) s),$n$);

DROP FUNCTION pg_temp.issue_4572_text_patch(text, text, text);
