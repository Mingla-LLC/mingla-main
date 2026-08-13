\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE issue_1775_batch_shape_probe
  (LIKE public.brand_contact_import_batches INCLUDING DEFAULTS INCLUDING CONSTRAINTS);

-- Preview deliberately renders the legal attestation before the user accepts it.
-- That state must permit legal text/name while actor and timestamp remain NULL.
INSERT INTO issue_1775_batch_shape_probe(
  id, brand_id, actor_user_id, state, file_sha256, file_name,
  file_size_bytes, row_count, original_headers, detected_provider, dialect,
  inspection_token_hash, inspection_expires_at, mapping_version,
  normalized_mapping, mapping_digest, preview_token_hash, preview_expires_at,
  attestation_version, attestation_text, attested_brand_name,
  invalid_count
) VALUES (
  '17750000-0000-4000-8000-000000000001',
  '17750000-0000-4000-8000-000000000002',
  '17750000-0000-4000-8000-000000000003',
  'previewed', repeat('a', 64), 'contacts.csv', 10, 1, '["Email"]'::jsonb,
  'generic', 'comma', repeat('b', 64), now() + interval '10 minutes',
  'contact-import-mapping-v1', '{"Email":"email"}'::jsonb, repeat('c', 64),
  repeat('d', 64), now() + interval '10 minutes',
  'contact-import-attestation-v1', 'rendered legal attestation', 'Mingla Test',
  1
);

DO $test$
DECLARE
  v_trigger_enabled "char";
BEGIN
  IF has_table_privilege('service_role', 'public.brand_contact_import_audit', 'UPDATE')
     OR has_table_privilege('service_role', 'public.brand_contact_import_audit', 'DELETE')
     OR has_table_privilege('service_role', 'public.brand_contact_import_audit', 'TRUNCATE') THEN
    RAISE EXCEPTION 'issue_1775_audit_service_role_can_mutate_history';
  END IF;

  SELECT t.tgenabled INTO v_trigger_enabled
  FROM pg_trigger t
  WHERE t.tgrelid = 'public.brand_contact_import_audit'::regclass
    AND t.tgname = 'issue_1775_audit_append_only'
    AND NOT t.tgisinternal;

  IF v_trigger_enabled IS DISTINCT FROM 'O'::"char" THEN
    RAISE EXCEPTION 'issue_1775_audit_append_only_trigger_missing_or_disabled';
  END IF;
END $test$;

ROLLBACK;
