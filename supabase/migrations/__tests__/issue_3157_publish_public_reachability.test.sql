-- #3157 implementor happy-path regression: the post-pointer public
-- reachability record, and the kill switch's audit trail.
--
-- This suite EXECUTES every routine it certifies. It calls
-- brand_site_complete_publication to move the real live pointer, then calls
-- brand_site_record_public_reachability over that real publication, then reads
-- back the publication columns, the audit rows and the operation receipt. It
-- (It also drove the pilot activate/deactivate switch; #2829 removed that switch
-- in 20271225002829_issue_2829_sites_multi_brand_w1.sql, so those PART A
-- assertions are converted below. Owner offline/online, entitlement grant and
-- revoke are the replacements and are asserted, with their audit rows, in
-- issue_2829_sites_multi_brand.test.sql.)
--
-- Apply every migration first, then run with ON_ERROR_STOP=1. The transaction
-- rolls every fixture back.

\set ON_ERROR_STOP on
BEGIN;

DO $test$
DECLARE
  v_actor uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_other_brand uuid := gen_random_uuid();
  v_site uuid := gen_random_uuid();
  v_pub_one uuid := gen_random_uuid();
  v_pub_two uuid := gen_random_uuid();
  v_pub_three uuid := gen_random_uuid();
  v_op_one uuid := gen_random_uuid();
  v_op_two uuid := gen_random_uuid();
  v_op_three uuid := gen_random_uuid();
  v_host_operation uuid := gen_random_uuid();
  v_activation_operation uuid := gen_random_uuid();
  v_deactivation_operation uuid := gen_random_uuid();
  v_digest_one text := repeat('a', 64);
  v_digest_two text := repeat('b', 64);
  v_digest_three text := repeat('9', 64);
  v_probe jsonb;
  v_checked_at timestamptz;
  v_result jsonb;
  v_replayed jsonb;
  v_failed boolean;
  v_row public.brand_site_publications%ROWTYPE;
  v_audit public.brand_site_audit_log%ROWTYPE;
  v_summary jsonb;
  v_pointer uuid;
  v_last_good uuid;
  v_count bigint;
BEGIN
  v_probe := jsonb_build_object(
    'http_ok', true, 'digest_ok', true, 'renderer_ok', true,
    'schema_ok', true, 'canonical_ok', true, 'assets_ok', true,
    'accessibility_ok', true, 'consent_ok', true, 'cta_ok', true,
    'leak_check_ok', true, 'status_code', 200
  );

  INSERT INTO auth.users(id) VALUES (v_actor);
  INSERT INTO public.creator_accounts(id, created_at, updated_at)
  VALUES (v_actor, now(), now());
  INSERT INTO public.brands(id, account_id, name, slug)
  VALUES
    (v_brand, v_actor, '#3157 Gogi pilot', 'issue-3157-gogi-pilot'),
    (v_other_brand, v_actor, '#3157 non-pilot', 'issue-3157-non-pilot');
  INSERT INTO public.brand_sites(
    id, brand_id, status, payload_tenant_id, created_by
  ) VALUES (v_site, v_brand, 'draft', gen_random_uuid()::text, v_actor);
  DELETE FROM public.brand_site_service_config;
  INSERT INTO public.brand_site_service_config(
    config_key, cms_origin, public_runtime_origin, public_host_suffix,
    configured_by, configured_at, updated_by, updated_at
  ) VALUES ('sites_v1', 'https://studio.sites.usemingla.com',
    'https://www.sites.usemingla.com', 'sites.usemingla.com',
    v_actor, now(), v_actor, now());
  INSERT INTO public.brand_site_hosts(site_id, hostname, label)
  VALUES (v_site, 'issue-3157-pilot.sites.usemingla.com', 'issue-3157-pilot');

  -- ---------------------------------------------------------------------
  -- Least privilege on the new routine, before anything else runs.
  -- ---------------------------------------------------------------------
  IF NOT has_function_privilege('service_role',
      'public.brand_site_record_public_reachability(uuid, uuid, uuid, timestamptz, integer, text, boolean)',
      'EXECUTE')
    OR has_function_privilege('authenticated',
      'public.brand_site_record_public_reachability(uuid, uuid, uuid, timestamptz, integer, text, boolean)',
      'EXECUTE')
    OR has_function_privilege('anon',
      'public.brand_site_record_public_reachability(uuid, uuid, uuid, timestamptz, integer, text, boolean)',
      'EXECUTE') THEN
    RAISE EXCEPTION 'public reachability grants are not least privilege';
  END IF;

  -- ---------------------------------------------------------------------
  -- A real publish: the pointer actually moves through the real routine.
  -- ---------------------------------------------------------------------
  INSERT INTO public.brand_site_publications(
    id, site_id, operation_id, source_revision_id, source_digest,
    status, requested_by
  ) VALUES (
    v_pub_one, v_site, v_op_one, 'gogi-r1', repeat('c', 64),
    'probing', v_actor
  );
  INSERT INTO public.brand_site_operation_receipts(
    operation_id, site_id, brand_id, user_id, kind, arguments_digest, status
  ) VALUES (
    v_op_one, v_site, v_brand, v_actor, 'publish', repeat('d', 64), 'executing'
  );

  PERFORM public.brand_site_complete_publication(
    v_site, v_op_one, v_pub_one, 'gogi-r1', repeat('c', 64),
    'publications/' || v_site || '/' || v_pub_one || '/' || v_digest_one || '.json',
    v_digest_one,
    v_probe || jsonb_build_object('observed_digest', v_digest_one)
  );
  SELECT active_publication_id, last_successful_publication_id
  INTO v_pointer, v_last_good FROM public.brand_sites WHERE id = v_site;
  IF v_pointer <> v_pub_one OR v_last_good <> v_pub_one THEN
    RAISE EXCEPTION 'fixture publish did not move the live pointer';
  END IF;

  SELECT * INTO v_row FROM public.brand_site_publications WHERE id = v_pub_one;
  IF v_row.public_checked_at IS NOT NULL
    OR v_row.public_status_code IS NOT NULL
    OR v_row.public_reachable IS NOT NULL THEN
    RAISE EXCEPTION 'a fresh publication already claims a public check';
  END IF;

  -- ---------------------------------------------------------------------
  -- The 2026-09-09 shape: the internal probe was green, the public host was
  -- 404. The record must land, and must change nothing that is live.
  -- ---------------------------------------------------------------------
  v_checked_at := clock_timestamp();
  v_result := public.brand_site_record_public_reachability(
    v_site, v_op_one, v_pub_one, v_checked_at, 404, NULL, false
  );
  IF (v_result->>'reachable')::boolean IS NOT FALSE
    OR (v_result->>'status_code')::integer <> 404
    OR (v_result->>'digest_ok')::boolean IS NOT FALSE
    OR (v_result->>'operation_annotated')::boolean IS NOT TRUE
    OR (v_result->>'live_pointer_changed')::boolean IS NOT FALSE
    OR v_result->>'hostname' <> 'issue-3157-pilot.sites.usemingla.com' THEN
    RAISE EXCEPTION 'public reachability summary did not report the 404: %', v_result;
  END IF;

  SELECT * INTO v_row FROM public.brand_site_publications WHERE id = v_pub_one;
  IF v_row.public_checked_at IS DISTINCT FROM v_checked_at
    OR v_row.public_status_code <> 404
    OR v_row.public_reachable IS NOT FALSE THEN
    RAISE EXCEPTION 'publication columns did not record the public 404: % % %',
      v_row.public_checked_at, v_row.public_status_code, v_row.public_reachable;
  END IF;

  SELECT * INTO v_audit FROM public.brand_site_audit_log
  WHERE site_id = v_site AND action = 'publication.public_check';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'public check wrote no audit row';
  END IF;
  IF v_audit.operation_id <> v_op_one
    OR v_audit.resource_kind <> 'publication'
    OR v_audit.resource_id <> v_pub_one::text
    OR v_audit.after_digest <> v_digest_one
    OR v_audit.metadata->>'hostname' <> 'issue-3157-pilot.sites.usemingla.com'
    OR v_audit.metadata->>'publication_id' <> v_pub_one::text
    OR (v_audit.metadata->>'status_code')::integer <> 404
    OR (v_audit.metadata->>'reachable')::boolean IS NOT FALSE
    OR (v_audit.metadata->>'digest_ok')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'public check audit row is not attributable: %', to_jsonb(v_audit);
  END IF;

  SELECT result_summary INTO v_summary
  FROM public.brand_site_operation_receipts WHERE operation_id = v_op_one;
  IF (v_summary->>'public_reachable')::boolean IS NOT FALSE
    OR (v_summary->>'public_status_code')::integer <> 404
    OR v_summary->>'public_checked_at' IS NULL
    OR v_summary->>'artifact_digest' <> v_digest_one
    OR v_summary->>'status' <> 'succeeded' THEN
    RAISE EXCEPTION 'operation receipt did not carry the public check: %', v_summary;
  END IF;

  -- Surface, do not act.
  IF (SELECT active_publication_id FROM public.brand_sites WHERE id = v_site) <> v_pub_one
    OR (SELECT last_successful_publication_id FROM public.brand_sites WHERE id = v_site) <> v_pub_one
    OR (SELECT status FROM public.brand_sites WHERE id = v_site) <> 'published'
    OR (SELECT status FROM public.brand_site_publications WHERE id = v_pub_one) <> 'published'
    OR NOT EXISTS (
      SELECT 1 FROM public.brand_site_hosts
      WHERE site_id = v_site AND status = 'pending') THEN
    RAISE EXCEPTION 'an unreachable public host rolled back live state';
  END IF;

  -- ---------------------------------------------------------------------
  -- Idempotency: exact replay is free, a different observation is a conflict.
  -- ---------------------------------------------------------------------
  v_replayed := public.brand_site_record_public_reachability(
    v_site, v_op_one, v_pub_one, v_checked_at, 404, NULL, false
  );
  IF v_replayed <> v_result THEN
    RAISE EXCEPTION 'public check did not replay exactly';
  END IF;
  SELECT count(*) INTO v_count FROM public.brand_site_audit_log
  WHERE site_id = v_site AND action = 'publication.public_check';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'public check replay duplicated the audit row (% rows)', v_count;
  END IF;

  v_failed := false;
  BEGIN
    PERFORM public.brand_site_record_public_reachability(
      v_site, v_op_one, v_pub_one, v_checked_at, 200, v_digest_one, true
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM LIKE '%sites_idempotency_conflict%';
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'public check accepted a different observation on one operation';
  END IF;

  -- ---------------------------------------------------------------------
  -- Validation refuses nonsense rather than storing it.
  -- ---------------------------------------------------------------------
  FOREACH v_summary IN ARRAY ARRAY[
    jsonb_build_object('status_code', 99, 'digest', NULL, 'reachable', true),
    jsonb_build_object('status_code', 600, 'digest', NULL, 'reachable', true),
    jsonb_build_object('status_code', 200, 'digest', 'nothex', 'reachable', true),
    jsonb_build_object('status_code', 200, 'digest', NULL, 'reachable', NULL)
  ] LOOP
    v_failed := false;
    BEGIN
      PERFORM public.brand_site_record_public_reachability(
        v_site, gen_random_uuid(), v_pub_one, clock_timestamp(),
        (v_summary->>'status_code')::integer, v_summary->>'digest',
        (v_summary->>'reachable')::boolean
      );
    EXCEPTION WHEN OTHERS THEN
      v_failed := SQLERRM LIKE '%sites_validation_failed%';
    END;
    IF NOT v_failed THEN
      RAISE EXCEPTION 'public check accepted invalid input: %', v_summary;
    END IF;
  END LOOP;

  -- ---------------------------------------------------------------------
  -- The terminal guards still hold for everything except the one write-once
  -- annotation.
  -- ---------------------------------------------------------------------
  v_failed := false;
  BEGIN
    UPDATE public.brand_site_publications
    SET source_revision_id = 'tampered' WHERE id = v_pub_one;
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM LIKE '%brand_site_publication_terminal%';
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'a published publication became editable';
  END IF;

  v_failed := false;
  BEGIN
    UPDATE public.brand_site_publications
    SET public_status_code = 200, public_reachable = true WHERE id = v_pub_one;
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM LIKE '%brand_site_publication_terminal%';
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'the public check annotation was rewritable';
  END IF;

  v_failed := false;
  BEGIN
    UPDATE public.brand_site_operation_receipts
    SET result_summary = result_summary || jsonb_build_object('retryable', true)
    WHERE operation_id = v_op_one;
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM LIKE '%brand_site_receipt_terminal%';
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'a succeeded receipt accepted an unrelated rewrite';
  END IF;

  v_failed := false;
  BEGIN
    UPDATE public.brand_site_operation_receipts
    SET status = 'failed' WHERE operation_id = v_op_one;
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM LIKE '%brand_site_receipt_terminal%';
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'a succeeded receipt changed status';
  END IF;

  -- ---------------------------------------------------------------------
  -- A healthy publish records the healthy shape, digest agreement included.
  -- ---------------------------------------------------------------------
  INSERT INTO public.brand_site_publications(
    id, site_id, operation_id, source_revision_id, source_digest,
    status, requested_by, previous_publication_id
  ) VALUES (
    v_pub_two, v_site, v_op_two, 'gogi-r2', repeat('e', 64),
    'probing', v_actor, v_pub_one
  );
  INSERT INTO public.brand_site_operation_receipts(
    operation_id, site_id, brand_id, user_id, kind, arguments_digest, status
  ) VALUES (
    v_op_two, v_site, v_brand, v_actor, 'publish', repeat('f', 64), 'executing'
  );
  PERFORM public.brand_site_complete_publication(
    v_site, v_op_two, v_pub_two, 'gogi-r2', repeat('e', 64),
    'publications/' || v_site || '/' || v_pub_two || '/' || v_digest_two || '.json',
    v_digest_two,
    v_probe || jsonb_build_object('observed_digest', v_digest_two)
  );
  v_result := public.brand_site_record_public_reachability(
    v_site, v_op_two, v_pub_two, clock_timestamp(), 200, v_digest_two, true
  );
  IF (v_result->>'reachable')::boolean IS NOT TRUE
    OR (v_result->>'digest_ok')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'a healthy public host was not recorded healthy: %', v_result;
  END IF;
  SELECT * INTO v_row FROM public.brand_site_publications WHERE id = v_pub_two;
  IF v_row.public_status_code <> 200 OR v_row.public_reachable IS NOT TRUE THEN
    RAISE EXCEPTION 'healthy publication columns were not written';
  END IF;
  -- ---------------------------------------------------------------------
  -- Reachable, but serving the WRONG artifact: 200 is not agreement.
  -- ---------------------------------------------------------------------
  INSERT INTO public.brand_site_publications(
    id, site_id, operation_id, source_revision_id, source_digest,
    status, requested_by, previous_publication_id
  ) VALUES (
    v_pub_three, v_site, v_op_three, 'gogi-r3', repeat('8', 64),
    'probing', v_actor, v_pub_two
  );
  INSERT INTO public.brand_site_operation_receipts(
    operation_id, site_id, brand_id, user_id, kind, arguments_digest, status
  ) VALUES (
    v_op_three, v_site, v_brand, v_actor, 'publish', repeat('7', 64), 'executing'
  );
  PERFORM public.brand_site_complete_publication(
    v_site, v_op_three, v_pub_three, 'gogi-r3', repeat('8', 64),
    'publications/' || v_site || '/' || v_pub_three || '/' || v_digest_three || '.json',
    v_digest_three,
    v_probe || jsonb_build_object('observed_digest', v_digest_three)
  );
  v_result := public.brand_site_record_public_reachability(
    v_site, v_op_three, v_pub_three, clock_timestamp(), 200, v_digest_two, true
  );
  IF (v_result->>'reachable')::boolean IS NOT TRUE
    OR (v_result->>'digest_ok')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'a stale served digest was reported as agreeing: %', v_result;
  END IF;

  -- (#2829: PART A — the pilot activation/deactivation audit chain — was
  -- removed with the switch itself. Nothing here can take a site dark any
  -- more except an explicit owner/admin action, which is audited; see
  -- issue_2829_sites_multi_brand.test.sql.)

  -- The public check is still attributable through the customer projection.
  PERFORM set_config('request.jwt.claim.sub', v_actor::text, true);
  IF (SELECT count(*) FROM public.brand_site_customer_audit(v_site)
      WHERE action = 'publication.public_check') < 3 THEN
    RAISE EXCEPTION 'the customer-facing audit projection cannot see the public checks';
  END IF;

  RAISE NOTICE '#3157 publish public reachability PASS';
END;
$test$;

ROLLBACK;
