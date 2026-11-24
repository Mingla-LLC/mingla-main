-- Issue #4572 item 6 (D6): "Party Type" becomes "Event type", with 11 non-party
-- choices added to the canonical list (26 in all).
-- Spec: issue comment 7095452940, Part 6 (approved by Seth, D6, 2026-11-23,
-- built on current main in the one #4572 PR).
--
-- New slugs (the 15 existing ones are unchanged, so no row moves):
--   exhibition, opening, talk, workshop, screening, class, kids-family,
--   market, tour, performance, tasting
--
-- Every server copy of the list moves together:
--   1. CHECK events_party_types_canonical: an EMPTY list stays valid (refusing
--      an empty list is the gate functions' job, agreed with #4490); only a
--      non-empty list must be canonical. Added NOT VALID, then VALIDATEd
--      (every existing row already passes the narrower old list).
--   2. The four publish / patch gates (business_publish_event_draft,
--      business_publish_rsvp_draft, business_patch_event_taxonomy,
--      business_patch_event_taxonomy_with_place), Ari's event executor
--      (ari_execute_event_operation) and the Discover facet counter
--      (discover_v2_facets_exact). Each is re-emitted from its CURRENT
--      production body with a one-match text replace that only appends the
--      11 slugs to the canonical array; nothing else in any body moves.
--      ari_execute_event_operation and discover_v2_facets_exact are not named
--      in the spec table but hold the same list: without them Ari refuses the
--      new types (SC-6.5) and Discover never counts them (SC-6.3).
--
-- Drift guard: md5(prosrc) of all six bodies must equal the production values
-- read on 2026-11-23, or this migration raises before changing anything.
-- #4490 (unmerged) rebases onto this file for its own re-emits of the four gates.
--
-- READ-ONLY PROBE (run right before applying; 2026-11-23 returned the md5s
-- below and 0 rows outside the old list):
--   SELECT p.oid::regprocedure, md5(p.prosrc) FROM pg_proc p
--    WHERE p.proname IN ('business_publish_event_draft','business_publish_rsvp_draft',
--      'business_patch_event_taxonomy','business_patch_event_taxonomy_with_place',
--      'ari_execute_event_operation','discover_v2_facets_exact');
--
-- ROLLBACK (manual): re-run the text replace with the two literals swapped and
-- restore the 15-value CHECK (only once no row carries a new slug).

DO $drift_guard$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('public.business_publish_event_draft(uuid,jsonb,integer)', 'b5a2bb9f4a2dbd19d914b925d08ae4e0'),
      ('public.business_publish_rsvp_draft(uuid,jsonb,integer)', '6635f49bbebb7ba09da411b5f5a881af'),
      ('public.business_patch_event_taxonomy(uuid,text,text[],text[],text[],numeric,numeric,text,text)', '4eaa731aeab4cf795b8abc8080192535'),
      ('public.business_patch_event_taxonomy_with_place(uuid,text,text[],text[],text[],numeric,numeric,text,text,text)', 'bdd3783db3c61393050236dde3e20e1b'),
      ('public.ari_execute_event_operation(uuid,text,jsonb)', '672cbb4224667612226408656dd44f9c'),
      ('public.discover_v2_facets_exact(text[],double precision,double precision,double precision,text,text,jsonb,text)', 'd49a15ae785441c4e2ed96b29d967e01')
    ) AS v(sig, expected_md5)
  LOOP
    IF (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = r.sig::regprocedure)
       IS DISTINCT FROM r.expected_md5 THEN
      RAISE EXCEPTION 'issue_4572_drift: % no longer matches the reviewed production body', r.sig;
    END IF;
  END LOOP;
END;
$drift_guard$;

-- 1. The table CHECK (26 values; an empty list is valid).
ALTER TABLE public.events DROP CONSTRAINT IF EXISTS events_party_types_canonical;
ALTER TABLE public.events
  ADD CONSTRAINT events_party_types_canonical CHECK (
    party_types IS NULL
    OR cardinality(party_types) = 0
    OR party_types <@ ARRAY[
      'birthday-party','rooftop-party','club-night','house-party','warehouse-party',
      'beach-party','pool-party','boat-party','themed-party','corporate-event',
      'graduation-party','holiday-party','networking-event','rave','festival',
      'exhibition','opening','talk','workshop','screening','class',
      'kids-family','market','tour','performance','tasting'
    ]::text[]
  ) NOT VALID;
ALTER TABLE public.events VALIDATE CONSTRAINT events_party_types_canonical;

-- 2. The six function bodies: append the 11 slugs to the one canonical array.
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

DO $patch$
DECLARE
  v_sig text;
BEGIN
  FOREACH v_sig IN ARRAY ARRAY[
    'public.business_publish_event_draft(uuid,jsonb,integer)',
    'public.business_publish_rsvp_draft(uuid,jsonb,integer)',
    'public.business_patch_event_taxonomy(uuid,text,text[],text[],text[],numeric,numeric,text,text)',
    'public.business_patch_event_taxonomy_with_place(uuid,text,text[],text[],text[],numeric,numeric,text,text,text)',
    'public.ari_execute_event_operation(uuid,text,jsonb)',
    'public.discover_v2_facets_exact(text[],double precision,double precision,double precision,text,text,jsonb,text)'
  ] LOOP
    PERFORM pg_temp.issue_4572_text_patch(
      v_sig,
      $o$'holiday-party','networking-event','rave','festival'$o$,
      $n$'holiday-party','networking-event','rave','festival','exhibition','opening','talk','workshop','screening','class','kids-family','market','tour','performance','tasting'$n$);
  END LOOP;
END;
$patch$;

DROP FUNCTION pg_temp.issue_4572_text_patch(text, text, text);
