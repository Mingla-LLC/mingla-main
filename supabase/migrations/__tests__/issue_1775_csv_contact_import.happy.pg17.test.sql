\set ON_ERROR_STOP on
BEGIN;
DO $test$ BEGIN
 IF to_regclass('public.brand_contact_import_batches') IS NULL OR to_regclass('public.brand_contact_import_rows') IS NULL OR to_regclass('public.brand_contact_import_audit') IS NULL THEN RAISE EXCEPTION 'issue_1775_tables_missing'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.brand_contact_import_batches'::regclass AND relrowsecurity) THEN RAISE EXCEPTION 'issue_1775_rls_missing'; END IF;
 IF has_table_privilege('authenticated','public.brand_contact_import_batches','INSERT') THEN RAISE EXCEPTION 'issue_1775_client_write_open'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND tablename='brand_contact_import_rows' AND indexdef LIKE 'CREATE UNIQUE INDEX%' AND indexdef LIKE '%(batch_id, row_number)%') THEN RAISE EXCEPTION 'issue_1775_row_number_unique_missing'; END IF;
 IF EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND tablename='brand_contact_import_rows' AND indexdef LIKE 'CREATE UNIQUE INDEX%' AND indexdef LIKE '%row_fingerprint%') THEN RAISE EXCEPTION 'issue_1775_duplicate_rows_not_auditable'; END IF;
 IF NOT pg_get_functiondef('public.issue_1775_execute_import(uuid,uuid,uuid,text,text,text,text,text,uuid,text)'::regprocedure) LIKE '%email_suppressed OR sms_suppressed%' THEN RAISE EXCEPTION 'issue_1775_suppression_not_orthogonal'; END IF;
 IF pg_get_functiondef('public.issue_1775_execute_import(uuid,uuid,uuid,text,text,text,text,text,uuid,text)'::regprocedure) LIKE '%brand_person_ingest_outbox%' THEN RAISE EXCEPTION 'issue_1775_general_ingest_widened'; END IF;
END $test$;
ROLLBACK;
