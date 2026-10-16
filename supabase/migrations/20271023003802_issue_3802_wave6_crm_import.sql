-- Issue #3802 Wave 6 — import-safe provenance for the one-time ClickUp
-- Hosts and Creators move. Private source rows never enter this repository.
BEGIN;

SET LOCAL lock_timeout = '10s';

SELECT set_config(
  'issue3802.wave6_crm_admin_fn_md5',
  (SELECT md5(p.prosrc) FROM pg_catalog.pg_proc p
   WHERE p.oid = 'public.is_admin_user()'::regprocedure),
  true
);

-- One Mingla record may carry more than one legacy identity when duplicate
-- ClickUp cards are consolidated. One legacy identity can never point to two
-- Mingla records.
CREATE TABLE public.crm_record_sources (
  source_system  text NOT NULL,
  source_id      text NOT NULL,
  source_scope   text NOT NULL,
  record_id      uuid NOT NULL REFERENCES public.crm_records(id) ON DELETE CASCADE,
  source_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  linked_by      text NOT NULL,
  linked_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_system, source_id),
  CONSTRAINT crm_record_sources_system_check CHECK (
    source_system ~ '^[a-z][a-z0-9_]{0,31}$'
  ),
  CONSTRAINT crm_record_sources_id_check CHECK (
    char_length(source_id) BETWEEN 1 AND 200
    AND source_id = btrim(source_id)
    AND source_id !~ '[[:cntrl:]]'
  ),
  CONSTRAINT crm_record_sources_scope_check CHECK (
    char_length(source_scope) BETWEEN 1 AND 200
    AND source_scope = btrim(source_scope)
    AND source_scope !~ '[[:cntrl:]]'
  ),
  CONSTRAINT crm_record_sources_context_check CHECK (
    jsonb_typeof(source_context) = 'object'
    AND pg_column_size(source_context) <= 65536
  ),
  CONSTRAINT crm_record_sources_actor_check CHECK (
    char_length(btrim(linked_by)) BETWEEN 3 AND 320
  )
);
CREATE INDEX crm_record_sources_by_record
  ON public.crm_record_sources (record_id, source_system, source_id);

ALTER TABLE public.crm_record_sources ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_record_sources FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.crm_record_sources FROM service_role;
GRANT SELECT, INSERT ON public.crm_record_sources TO service_role;

CREATE TABLE public.crm_import_receipts (
  source_system         text NOT NULL,
  source_scope          text NOT NULL,
  source_bundle_sha256  text NOT NULL,
  expected_source_count integer NOT NULL,
  imported_source_count integer NOT NULL,
  resulting_record_count integer NOT NULL,
  created_record_count  integer NOT NULL,
  linked_existing_count integer NOT NULL,
  applied_by            text NOT NULL,
  applied_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_system, source_scope),
  CONSTRAINT crm_import_receipts_system_check CHECK (
    source_system ~ '^[a-z][a-z0-9_]{0,31}$'
  ),
  CONSTRAINT crm_import_receipts_scope_check CHECK (
    char_length(source_scope) BETWEEN 1 AND 200
    AND source_scope = btrim(source_scope)
    AND source_scope !~ '[[:cntrl:]]'
  ),
  CONSTRAINT crm_import_receipts_hash_check CHECK (
    source_bundle_sha256 ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT crm_import_receipts_counts_check CHECK (
    expected_source_count > 0
    AND imported_source_count = expected_source_count
    AND resulting_record_count > 0
    AND resulting_record_count <= imported_source_count
    AND created_record_count >= 0
    AND linked_existing_count >= 0
    AND created_record_count + linked_existing_count = resulting_record_count
  ),
  CONSTRAINT crm_import_receipts_actor_check CHECK (
    char_length(btrim(applied_by)) BETWEEN 3 AND 320
  )
);

ALTER TABLE public.crm_import_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_import_receipts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.crm_import_receipts FROM service_role;
GRANT SELECT, INSERT ON public.crm_import_receipts TO service_role;

-- Only a deliberately small provenance summary is exposed to signed-in team
-- members. The private raw ClickUp fields stay in the closed source table.
CREATE FUNCTION public.crm_record_sources_json(p_record_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'source_system', s.source_system,
    'source_scope', s.source_scope,
    'source_id', s.source_id,
    'task_name', NULLIF(s.source_context->>'task_name', ''),
    'original_status', NULLIF(s.source_context->>'original_status', ''),
    'city', NULLIF(s.source_context->>'city', ''),
    'source_url', CASE WHEN s.source_system = 'clickup'
      THEN 'https://app.clickup.com/t/' || s.source_id ELSE NULL END
  ) ORDER BY s.source_system, s.source_scope, s.source_id), '[]'::jsonb)
  FROM public.crm_record_sources s
  WHERE s.record_id = p_record_id
$$;
REVOKE EXECUTE ON FUNCTION public.crm_record_sources_json(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_record_sources_json(uuid) TO service_role;

-- Keep the established record payload byte-for-byte stable. Provenance is a
-- detail-only top-level key, so 5,000-row board/list responses do not grow.
CREATE OR REPLACE FUNCTION public.crm_record_get(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v     record;
  v_rec public.crm_records;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  SELECT * INTO v_rec FROM public.crm_records c WHERE c.id = p_id AND c.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: That record is no longer here. It may have been deleted.' USING ERRCODE = 'P0002';
  END IF;
  RETURN jsonb_build_object(
    'record', public.crm_record_json(v_rec),
    'links', jsonb_build_object(
      'brand', (SELECT jsonb_build_object('id', b.id, 'name', b.name, 'slug', b.slug,
                                          'is_live', public.crm_brand_is_live(b.id))
                  FROM public.brands b WHERE b.id = v_rec.brand_id AND b.deleted_at IS NULL),
      'place', (SELECT jsonb_build_object('id', p.id, 'name', p.name, 'city', p.city)
                  FROM public.place_pool p WHERE p.id = v_rec.place_id AND p.deleted_at IS NULL)),
    'activity', COALESCE((
      SELECT jsonb_agg(public.crm_activity_json(a) ORDER BY a.occurred_at DESC, a.created_at DESC, a.id)
      FROM (SELECT x.* FROM public.crm_activity x
             WHERE x.record_id = v_rec.id
             ORDER BY x.occurred_at DESC, x.created_at DESC, x.id
             LIMIT 200) a), '[]'::jsonb),
    'imports', public.crm_record_sources_json(v_rec.id),
    'undoable_activity_id', public.crm_undoable_activity(v_rec.id, v.actor_email));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.crm_record_get(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_record_get(uuid) TO authenticated, service_role;

COMMENT ON TABLE public.crm_record_sources IS
  'Issue #3802. Immutable private import identities for Hosts and Creators. Team members see only a summary through crm_record_get().';
COMMENT ON TABLE public.crm_import_receipts IS
  'Issue #3802. Closed, source-bundle-hash receipts for exact one-time Hosts and Creators imports.';
COMMENT ON FUNCTION public.crm_record_sources_json(uuid) IS
  'Issue #3802. Internal safe provenance summary used only by crm_record_get().';

DO $$
DECLARE
  v_saved text := current_setting('issue3802.wave6_crm_admin_fn_md5', true);
BEGIN
  IF v_saved IS NULL OR v_saved = '' OR
     (SELECT md5(p.prosrc) FROM pg_catalog.pg_proc p
       WHERE p.oid = 'public.is_admin_user()'::regprocedure) IS DISTINCT FROM v_saved THEN
    RAISE EXCEPTION 'issue 3802 wave6 crm self-check: is_admin_user changed';
  END IF;
  IF NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class c
          WHERE c.oid = 'public.crm_record_sources'::regclass)
     OR NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class c
             WHERE c.oid = 'public.crm_import_receipts'::regclass)
     OR has_table_privilege('authenticated', 'public.crm_record_sources', 'select')
     OR has_table_privilege('anon', 'public.crm_record_sources', 'select')
     OR has_table_privilege('service_role', 'public.crm_record_sources', 'update')
     OR has_table_privilege('service_role', 'public.crm_record_sources', 'delete')
     OR has_table_privilege('service_role', 'public.crm_record_sources', 'truncate')
     OR has_table_privilege('service_role', 'public.crm_import_receipts', 'update')
     OR has_table_privilege('service_role', 'public.crm_import_receipts', 'delete')
     OR has_table_privilege('service_role', 'public.crm_import_receipts', 'truncate') THEN
    RAISE EXCEPTION 'issue 3802 wave6 crm self-check: import tables are not closed';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy p
    WHERE p.polrelid IN ('public.crm_record_sources'::regclass,
                         'public.crm_import_receipts'::regclass)
  ) THEN
    RAISE EXCEPTION 'issue 3802 wave6 crm self-check: browser policy added';
  END IF;
END;
$$;

-- Keep the newest complete CRM self-check beside the objects that extend its
-- closed catalog. The Wave 1 suite executes this exact block against planted
-- privilege, policy, stage, and catalog faults.
DO $check$
DECLARE
  c_client text[] := ARRAY[
    'public.crm_config()',
    'public.crm_records_list(text)',
    'public.crm_record_get(uuid)',
    'public.crm_duplicate_check(text,text,uuid)',
    'public.crm_link_search(text,text)',
    'public.crm_record_create(text,jsonb,text)',
    'public.crm_records_bulk_create(text,jsonb,text)',
    'public.crm_record_update(uuid,jsonb)',
    'public.crm_record_move_stage(uuid,text,text,text)',
    'public.crm_record_undo_stage_move(uuid)',
    'public.crm_record_set_owners(uuid,text[])',
    'public.crm_record_log(uuid,jsonb,text)',
    'public.crm_record_delete(uuid)',
    'public.crm_record_restore(uuid)',
    'public.crm_home_summary(date)',
    'public.crm_team_summary(date)',
    'public.crm_target_set(uuid,text,integer)',
    'public.crm_beta_leads_list()',
    'public.crm_beta_lead_to_host(uuid)',
    'public.crm_contact_check(text,jsonb)'
  ];
  c_internal text[] := ARRAY[
    'public.admin_team_directory()',
    'public.crm_ctx()',
    'public.crm_name_key(text)',
    'public.crm_display_name(text)',
    'public.crm_pipeline_def(text)',
    'public.crm_vocab()',
    'public.crm_stage_def(text,text)',
    'public.crm_brand_is_live(uuid)',
    'public.crm_clean_owners(jsonb)',
    'public.crm_validate_fields(text,jsonb,text)',
    'public.crm_record_json(public.crm_records)',
    'public.crm_record_lite_json(public.crm_records)',
    'public.crm_activity_json(public.crm_activity)',
    'public.crm_audit(text,text,text,text,jsonb)',
    'public.crm_request_begin(text,text,text)',
    'public.crm_request_finish(text,text,text,jsonb)',
    'public.crm_undoable_activity(uuid,text)',
    'public.crm_reconcile_live(uuid)',
    'public.crm_apply_brand_link(uuid)',
    'public.crm_record_create_core(text,jsonb,text,text)',
    'public.crm_stage_counts_json()',
    'public.crm_due_json(text,date,integer)',
    'public.crm_targets_json(date)',
    'public.crm_beta_icp(text[])',
    'public.crm_city_region(text)',
    'public.admin_team_invite_address_verdict(text)',
    'public.crm_ident_key(text,text)',
    'public.crm_phone_national(text)',
    'public.crm_clean_identifiers(jsonb)',
    'public.crm_identifier_hits(text,jsonb,uuid)',
    'public.crm_identifier_matches(text,jsonb,uuid)',
    'public.crm_request_claim(text,text,jsonb)',
    'public.crm_identifiers_json(uuid)',
    'public.crm_record_sources_json(uuid)'
  ];
  c_tables text[] := ARRAY[
    'public.crm_records',
    'public.crm_record_owners',
    'public.crm_activity',
    'public.crm_request_keys',
    'public.crm_targets',
    'public.crm_record_identifiers',
    'public.crm_record_sources',
    'public.crm_import_receipts'
  ];
  v_fn    text;
  v_tbl   text;
  v_role  text;
  v_priv  text;
  v_n     integer;
  v_stage text;
BEGIN
  FOREACH v_fn IN ARRAY c_client || c_internal LOOP
    IF has_function_privilege('anon', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'issue 3802 pr3 self-check: anon can execute %', v_fn;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p, pg_catalog.aclexplode(p.proacl) a
               WHERE p.oid = v_fn::regprocedure AND a.grantee = 0 AND a.privilege_type = 'EXECUTE')
       OR (SELECT p.proacl IS NULL FROM pg_catalog.pg_proc p WHERE p.oid = v_fn::regprocedure) THEN
      RAISE EXCEPTION 'issue 3802 pr3 self-check: PUBLIC can execute %', v_fn;
    END IF;
    IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'issue 3802 pr3 self-check: service_role cannot execute %', v_fn;
    END IF;
  END LOOP;
  FOREACH v_fn IN ARRAY c_client LOOP
    IF NOT has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'issue 3802 pr3 self-check: authenticated cannot execute %', v_fn;
    END IF;
  END LOOP;
  FOREACH v_fn IN ARRAY c_internal LOOP
    IF has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'issue 3802 pr3 self-check: authenticated can execute the internal %', v_fn;
    END IF;
  END LOOP;

  SELECT count(*) INTO v_n
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname LIKE 'crm\_%'
    AND NOT (p.oid = ANY (SELECT x::regprocedure::oid FROM unnest(c_client || c_internal) AS x));
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'issue 3802 pr3 self-check: % crm_ function(s) are not in the checked list', v_n;
  END IF;
  SELECT count(*) INTO v_n
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'crm_record_move_stage';
  IF v_n <> 1 OR (SELECT p.pronargs FROM pg_catalog.pg_proc p
                   WHERE p.oid = 'public.crm_record_move_stage(uuid,text,text,text)'::regprocedure) <> 4 THEN
    RAISE EXCEPTION 'issue 3802 pr3 self-check: expected exactly one crm_record_move_stage, with four arguments';
  END IF;

  FOREACH v_tbl IN ARRAY c_tables LOOP
    FOREACH v_role IN ARRAY ARRAY['anon','authenticated'] LOOP
      FOREACH v_priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] LOOP
        IF has_table_privilege(v_role, v_tbl, v_priv) THEN
          RAISE EXCEPTION 'issue 3802 pr3 self-check: % holds % on %', v_role, v_priv, v_tbl;
        END IF;
      END LOOP;
      IF EXISTS (SELECT 1 FROM information_schema.column_privileges cp
                 WHERE cp.table_schema = 'public' AND 'public.' || cp.table_name = v_tbl
                   AND cp.grantee = v_role) THEN
        RAISE EXCEPTION 'issue 3802 pr3 self-check: % holds a column privilege on %', v_role, v_tbl;
      END IF;
    END LOOP;
    IF NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class c WHERE c.oid = v_tbl::regclass) THEN
      RAISE EXCEPTION 'issue 3802 pr3 self-check: row security is off on %', v_tbl;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_policy p WHERE p.polrelid = v_tbl::regclass) THEN
      RAISE EXCEPTION 'issue 3802 pr3 self-check: a policy exists on %', v_tbl;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
             WHERE t.tgrelid IN ('public.crm_targets'::regclass,
                                 'public.crm_record_sources'::regclass,
                                 'public.crm_import_receipts'::regclass)
               AND NOT t.tgisinternal) THEN
    RAISE EXCEPTION 'issue 3802 pr3 self-check: a trigger exists on a closed CRM evidence table';
  END IF;

  IF 'admin_console' = ANY (public.admin_team_role_areas('growth'))
     OR 'admin_console' = ANY (public.admin_team_role_areas('partner'))
     OR 'team_manage' = ANY (public.admin_team_role_areas('growth'))
     OR 'team_manage' = ANY (public.admin_team_role_areas('partner')) THEN
    RAISE EXCEPTION 'issue 3802 pr3 self-check: a non-admin role was given an admin area';
  END IF;

  SELECT count(*) INTO v_n
  FROM pg_catalog.pg_index i
  JOIN pg_catalog.pg_class c ON c.oid = i.indexrelid
  WHERE i.indrelid = 'public.crm_records'::regclass
    AND c.relname IN ('crm_records_live_name_key', 'crm_records_live_beta_lead')
    AND i.indisunique AND i.indisvalid AND i.indpred IS NOT NULL;
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'issue 3802 pr3 self-check: expected 2 valid unique partial indexes on crm_records, found %', v_n;
  END IF;

  BEGIN
    FOR v_tbl, v_stage IN
      SELECT p.pipe, s->>'id'
      FROM unnest(ARRAY['hosts','creators']) AS p(pipe),
           jsonb_array_elements(public.crm_pipeline_def(p.pipe)->'stages') s
    LOOP
      INSERT INTO public.crm_records (pipeline, name, stage, stage_reason, created_by, updated_by)
      VALUES (v_tbl, 'self-check ' || v_tbl || ' ' || v_stage, v_stage,
              CASE WHEN COALESCE((public.crm_stage_def(v_tbl, v_stage)->>'terminal')::boolean, false) THEN 'self-check' END,
              'system', 'system');
    END LOOP;
    FOR v_tbl, v_stage IN
      SELECT p.pipe, s->>'id'
      FROM unnest(ARRAY['hosts','creators']) AS p(pipe),
           jsonb_array_elements(public.crm_pipeline_def(p.pipe)->'icps') s
    LOOP
      INSERT INTO public.crm_records (pipeline, name, stage, icp, created_by, updated_by)
      VALUES (v_tbl, 'self-check icp ' || v_tbl || ' ' || v_stage,
              public.crm_pipeline_def(v_tbl)->'stages'->0->>'id', v_stage, 'system', 'system');
    END LOOP;
    FOR v_stage IN SELECT s->>'id' FROM jsonb_array_elements(public.crm_pipeline_def('hosts')->'icps') s LOOP
      INSERT INTO public.crm_targets (region_id, icp, monthly_target, created_by, updated_by)
      VALUES (gen_random_uuid(), v_stage, 1, 'system', 'system');
    END LOOP;
    RAISE EXCEPTION 'issue_3802_self_check_rollback' USING ERRCODE = 'P3802';
  EXCEPTION
    WHEN SQLSTATE 'P3802' THEN NULL;
    WHEN check_violation THEN
      RAISE EXCEPTION 'issue 3802 pr3 self-check: crm_pipeline_def and the crm_records CHECK constraints disagree (%)', SQLERRM;
  END;

  IF has_function_privilege('anon', 'public.admin_beta_leads_list()', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue 3802 pr3 self-check: anon can execute admin_beta_leads_list()';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.admin_beta_leads_list()', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue 3802 pr3 self-check: authenticated lost admin_beta_leads_list()';
  END IF;
  IF (SELECT p.prosrc !~ 'is_admin_user\(\)' FROM pg_catalog.pg_proc p
      WHERE p.oid = 'public.admin_beta_leads_list()'::regprocedure) THEN
    RAISE EXCEPTION 'issue 3802 pr3 self-check: admin_beta_leads_list() does not check for a full admin';
  END IF;

  IF has_function_privilege('anon', 'public.admin_team_role_areas(text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.admin_team_role_areas(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue 3802 pr3 self-check: admin_team_role_areas(text) grants changed';
  END IF;
  IF has_function_privilege('anon', 'public.admin_team_issue_invite(text,text,text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.admin_team_issue_invite(text,text,text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.admin_team_issue_invite(text,text,text)', 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p, pg_catalog.aclexplode(p.proacl) a
                 WHERE p.oid = 'public.admin_team_issue_invite(text,text,text)'::regprocedure AND a.grantee = 0) THEN
    RAISE EXCEPTION 'issue 3802 pr3 self-check: admin_team_issue_invite(text,text,text) grants changed';
  END IF;

  IF EXISTS (SELECT 1 FROM public.crm_records r WHERE r.name_key IS DISTINCT FROM public.crm_name_key(r.name)) THEN
    RAISE EXCEPTION 'issue 3802 pr3 self-check: a stored name key differs from crm_name_key(name)';
  END IF;
  IF EXISTS (SELECT 1 FROM public.crm_records r WHERE r.deleted_at IS NULL
              GROUP BY r.pipeline, r.name_key HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'issue 3802 pr3 self-check: two records share a name key';
  END IF;
  IF EXISTS (SELECT 1 FROM public.crm_records r WHERE r.name IS DISTINCT FROM normalize(r.name, NFC)) THEN
    RAISE EXCEPTION 'issue 3802 pr3 self-check: a stored name is not in NFC form';
  END IF;
  IF public.crm_name_key(U&'\FF30\FF41\FF4C\FF4D \FF23\FF4F\FF55\FF52\FF54') IS DISTINCT FROM public.crm_name_key('Palm Court')
     OR public.crm_name_key('Palm Court') IS DISTINCT FROM 'palmcourt' THEN
    RAISE EXCEPTION 'issue 3802 pr3 self-check: full-width and plain letters do not give the same name key';
  END IF;
  IF public.crm_name_key(U&'\2800') <> '' OR public.crm_name_key(U&'\+0E0041') <> ''
     OR public.crm_name_key(U&'\+01D173') <> '' OR public.crm_name_key(U&'\0301') <> ''
     OR public.crm_name_key(U&'\093F\0E34\05B4') <> '' OR public.crm_name_key(U&'\+016FE4\+01D159\+01DA9B') <> ''
     OR public.crm_name_key(U&'\E000\+0F0000') <> '' THEN
    RAISE EXCEPTION 'issue 3802 pr3 self-check: a name with nothing visible in it has a name key';
  END IF;
  IF public.crm_name_key(U&'\+01F355') = '' THEN
    RAISE EXCEPTION 'issue 3802 pr3 self-check: an emoji-only name has no name key';
  END IF;
  IF public.crm_name_key(U&'\0915\093F') = '' OR public.crm_name_key(U&'\0E01\0E34\0E19') = ''
     OR public.crm_name_key(U&'\05E9\05B4') = '' OR public.crm_name_key(U&'\65E5\672C') = '' THEN
    RAISE EXCEPTION 'issue 3802 pr3 self-check: a name whose marks are attached to letters has no name key';
  END IF;

  IF to_regclass('auth.identities') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns c
                  WHERE c.table_schema = 'auth' AND c.table_name = 'users' AND c.column_name = 'phone') THEN
    IF public.admin_team_invite_address_verdict('nobody-' || gen_random_uuid()::text || '@invalid.example') IS DISTINCT FROM 'ok' THEN
      RAISE EXCEPTION 'issue 3802 pr3 self-check: the invite address check did not run against the sign-in tables';
    END IF;
  END IF;

  IF NULLIF(current_setting('issue3802.wave6_crm_admin_fn_md5', true), '') IS NOT NULL
     AND (SELECT md5(p.prosrc) FROM pg_catalog.pg_proc p
          WHERE p.oid = 'public.is_admin_user()'::regprocedure)
         IS DISTINCT FROM current_setting('issue3802.wave6_crm_admin_fn_md5', true) THEN
    RAISE EXCEPTION 'issue 3802 pr3 self-check: is_admin_user() changed during this migration';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_catalog.pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      SELECT count(*) INTO v_n FROM cron.job j
       WHERE j.jobname = 'crm_reconcile_live' AND btrim(j.command) = 'SELECT public.crm_reconcile_live()';
    EXCEPTION WHEN undefined_table THEN
      v_n := 1;
    END;
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'issue 3802 pr3 self-check: expected one crm_reconcile_live job with its command, found %', v_n;
    END IF;
  END IF;
END;
$check$;

COMMIT;
