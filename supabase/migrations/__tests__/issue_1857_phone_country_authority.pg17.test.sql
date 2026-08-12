-- #1857 PostgreSQL 17 migration contract. Executed after the complete migration chain in CI.
BEGIN;

DO $test$
DECLARE
  v_definition text;
  v_expected record;
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

  -- Each exact definition fingerprint is read back from PG17. Deliberately
  -- mutate search_path inside a subtransaction, prove the guard fails, then
  -- let the exception handler roll the mutation back before the next case.
  FOR v_expected IN SELECT * FROM (VALUES
    ('public.submit_event_rsvp(uuid,uuid,text,text,text,text,integer,jsonb,text,text)', '3810b4f9ee2d8faeb9f2b373959b0756'),
    ('public.submit_event_rsvp_with_delivery(uuid,uuid,text,text,text,text,integer,jsonb,text,text)', '9fe5e36dee2bd3bdc8ed26e2081716fb'),
    ('public.issue_1388_create_stay_group(uuid,text,jsonb,bigint,uuid)', 'eec5f6a9750eb113d3c75c027455a704'),
    ('public.biz_reservation_create(uuid,timestamp with time zone,integer,text,text,text,text,uuid,text,text,text[],text)', '49ffd0c7006d839ca41fbcf0a082d643'),
    ('public.pg_create_guest_reservation(uuid,timestamp with time zone,integer,text,text,uuid,text,text,text,integer,character,text,text,text,text,text,text,text)', '97adc49789e7e254744ff9b60efbe9ba'),
    ('public.pg_finalize_guest_reservation(uuid,text)', '51b79bcbec509bfd5f3a115f87af472d'),
    ('public.biz_resolve_brand_person_source(uuid,uuid,text,uuid,uuid,uuid,text,text,timestamp with time zone)', 'eaa44b5386a7a6a668e69ce769cdd6d8'),
    ('public.issue_1770_enqueue_source()', '82f95d2c7440945e43df55948c164f1f')
  ) AS expected(signature,definition_md5) LOOP
    IF md5(pg_get_functiondef(to_regprocedure(v_expected.signature)))<>v_expected.definition_md5 THEN
      RAISE EXCEPTION 'issue_1857_pg17_fingerprint_baseline_failed:%',v_expected.signature;
    END IF;
    BEGIN
      EXECUTE 'ALTER FUNCTION '||v_expected.signature||' SET search_path TO issue_1857_deliberate_drift';
      IF md5(pg_get_functiondef(to_regprocedure(v_expected.signature)))<>v_expected.definition_md5 THEN
        RAISE EXCEPTION USING ERRCODE='P1857',MESSAGE='issue_1857_post_definition_drift';
      END IF;
      RAISE EXCEPTION 'issue_1857_function_mutation_survived:%',v_expected.signature;
    EXCEPTION WHEN SQLSTATE 'P1857' THEN NULL;
    END;
    IF md5(pg_get_functiondef(to_regprocedure(v_expected.signature)))<>v_expected.definition_md5 THEN
      RAISE EXCEPTION 'issue_1857_function_mutation_not_rolled_back:%',v_expected.signature;
    END IF;
  END LOOP;

  IF md5(pg_get_functiondef('public.biz_resolve_brand_person_source_derived(text,uuid)'::regprocedure))<>'498565615bd834f1d3efa95fb3d4552c' THEN
    RAISE EXCEPTION 'issue_1857_derived_fingerprint_baseline_failed';
  END IF;
  BEGIN
    ALTER FUNCTION public.biz_resolve_brand_person_source_derived(text,uuid) SET search_path TO issue_1857_deliberate_drift;
    IF md5(pg_get_functiondef('public.biz_resolve_brand_person_source_derived(text,uuid)'::regprocedure))<>'498565615bd834f1d3efa95fb3d4552c' THEN
      RAISE EXCEPTION USING ERRCODE='P1857',MESSAGE='issue_1857_derived_definition_changed';
    END IF;
    RAISE EXCEPTION 'issue_1857_derived_mutation_survived';
  EXCEPTION WHEN SQLSTATE 'P1857' THEN NULL;
  END;

  BEGIN
    ALTER TRIGGER issue_1770_event_rsvp_ingest ON public.event_rsvps RENAME TO issue_1857_deliberate_drift;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='issue_1770_event_rsvp_ingest' AND NOT tgisinternal) THEN
      RAISE EXCEPTION USING ERRCODE='P1857',MESSAGE='issue_1857_trigger_definition_changed';
    END IF;
    RAISE EXCEPTION 'issue_1857_trigger_mutation_survived';
  EXCEPTION WHEN SQLSTATE 'P1857' THEN NULL;
  END;

  BEGIN
    ALTER TABLE public.event_rsvps DROP CONSTRAINT event_rsvps_guest_phone_country_iso_check;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='event_rsvps_guest_phone_country_iso_check') THEN
      RAISE EXCEPTION USING ERRCODE='P1857',MESSAGE='issue_1857_schema_postcondition_failed';
    END IF;
    RAISE EXCEPTION 'issue_1857_schema_mutation_survived';
  EXCEPTION WHEN SQLSTATE 'P1857' THEN NULL;
  END;

  BEGIN
    REVOKE EXECUTE ON FUNCTION public.submit_event_rsvp(uuid,uuid,text,text,text,text,integer,jsonb,text,text) FROM service_role;
    IF NOT has_function_privilege('service_role','public.submit_event_rsvp(uuid,uuid,text,text,text,text,integer,jsonb,text,text)','EXECUTE') THEN
      RAISE EXCEPTION USING ERRCODE='P1857',MESSAGE='issue_1857_acl_postcondition_failed';
    END IF;
    RAISE EXCEPTION 'issue_1857_acl_mutation_survived';
  EXCEPTION WHEN SQLSTATE 'P1857' THEN NULL;
  END;
END $test$;

ROLLBACK;
