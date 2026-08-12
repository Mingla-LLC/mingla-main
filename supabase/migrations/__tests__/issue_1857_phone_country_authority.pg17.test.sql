-- #1857 PostgreSQL 17 migration contract. Executed after the complete migration chain in CI.
BEGIN;

DO $test$
DECLARE v_definition text;
BEGIN
  IF to_regprocedure('public.submit_event_rsvp(uuid,uuid,text,text,text,text,integer,jsonb,text,text)') IS NULL
     OR to_regprocedure('public.submit_event_rsvp_with_delivery(uuid,uuid,text,text,text,text,integer,jsonb,text,text)') IS NULL
     OR to_regprocedure('public.pg_create_guest_reservation(uuid,timestamptz,integer,text,text,uuid,text,text,text,integer,character,text,text,text,text,text,text,text)') IS NULL
     OR to_regprocedure('public.pg_finalize_guest_reservation(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'issue_1857_expected_signature_missing';
  END IF;

  IF EXISTS (
    SELECT 1 FROM (VALUES
      ('event_rsvps','guest_phone_country_iso'),
      ('event_rsvp_guests','phone_country_iso'),
      ('reservations','guest_phone_country_iso'),
      ('reservation_checkout_sessions','buyer_phone_country_iso'),
      ('brand_person_contact_method_sources','phone_country_iso')
    ) AS expected(table_name,column_name)
    WHERE NOT EXISTS (
      SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema='public' AND c.table_name=expected.table_name AND c.column_name=expected.column_name
    )
  ) THEN RAISE EXCEPTION 'issue_1857_evidence_column_missing'; END IF;

  v_definition := pg_get_functiondef('public.pg_finalize_guest_reservation(uuid,text)'::regprocedure);
  IF position('v_session.buyer_phone_country_iso' in v_definition)=0
     OR position('EXCEPTION WHEN unique_violation' in v_definition)=0 THEN
    RAISE EXCEPTION 'issue_1857_finalizer_durability_missing';
  END IF;

  IF position('phoneCountryIso' in pg_get_functiondef('public.issue_1770_enqueue_source()'::regprocedure))=0 THEN
    RAISE EXCEPTION 'issue_1857_iso_revision_missing';
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE tgname IN ('issue_1770_event_rsvp_ingest','issue_1770_rsvp_plus_one_ingest','issue_1770_order_ingest','issue_1770_ticket_ingest') AND NOT tgisinternal) <> 4 THEN
    RAISE EXCEPTION 'issue_1857_trigger_count_changed';
  END IF;
END $test$;

ROLLBACK;
