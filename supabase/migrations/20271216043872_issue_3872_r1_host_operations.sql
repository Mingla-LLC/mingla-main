-- Issue #3872 R1 Discounts — Host control plane, reports, notifications and ops.

BEGIN;
SET LOCAL lock_timeout = '10s';

-- The capability ledger and the production certification denominator move
-- together. Read-only listing needs read evidence; both Host mutations need
-- the full write matrix before Ari certification can finish.
INSERT INTO public.ari_cert_capability_requirements (capability_id, evidence_mode)
VALUES
  ('ari.discounts.list', 'read'),
  ('ari.discounts.create', 'write'),
  ('ari.discounts.pause', 'write')
ON CONFLICT (capability_id) DO NOTHING;

-- Keep the certification gate and its success receipt on the same denominator
-- as the requirement set above. This static definition is intentionally
-- inspectable by the repository DDL/RLS audits; it preserves the preceding
-- #3697 finalizer and moves only the two reviewed census literals to 148.
CREATE OR REPLACE FUNCTION public.ari_cert_finalize_run(p_run_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_run public.ari_cert_runs%ROWTYPE;
  v_capability_count integer;
  v_failed_count integer;
  v_artifact_count integer;
  v_residue_count integer;
  v_missing_matrix_count integer;
  v_unknown_count integer;
  v_invalid_digest_count integer;
  v_unverified_provenance_count integer;
  v_invalid_native_count integer;
  v_evidence_set_digest text;
  v_artifact_set_digest text;
  v_capability_set_digest text;
  v_native_artifact_set_digest text;
  v_cleanup_digest text;
  v_rollback_digest text;
  v_run_manifest_digest text;
  v_attestation_key text;
  v_attestation_key_id text;
  v_attestation_payload bytea;
  v_attestation_signature text;
BEGIN
  SELECT * INTO v_run FROM public.ari_cert_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ari_cert_run_not_found' USING ERRCODE = 'P0002'; END IF;
  SELECT count(DISTINCT capability_id), count(*) FILTER (WHERE outcome <> 'passed')
    INTO v_capability_count, v_failed_count
  FROM public.ari_cert_evidence WHERE run_id = p_run_id;
  SELECT count(DISTINCT artifact_type) INTO v_artifact_count
  FROM public.ari_cert_release_artifacts
  WHERE run_id = p_run_id AND release_sha = v_run.release_sha;
  SELECT count(*) INTO v_residue_count FROM public.ari_cert_fixtures
  WHERE run_id = p_run_id AND cleanup_state <> 'removed';

  SELECT count(*) INTO v_unknown_count
  FROM public.ari_cert_evidence e
  LEFT JOIN public.ari_cert_capability_requirements r
    ON r.capability_id = e.capability_id
  WHERE e.run_id = p_run_id AND r.capability_id IS NULL;

  WITH expected AS (
    SELECT
      r.capability_id,
      scenario,
      target.surface,
      target.artifact_type,
      role_case,
      CASE WHEN role_case = 'outsider' THEN 'outsider_tenant' ELSE 'owner_tenant' END AS tenant_case
    FROM public.ari_cert_capability_requirements r
    CROSS JOIN LATERAL unnest(public.ari_cert_required_scenarios(r.evidence_mode)) AS scenario
    CROSS JOIN (VALUES
      ('business_ios', 'business_ios_simulator'),
      ('business_ios', 'business_ios_physical'),
      ('business_android', 'business_android'),
      ('business_web', 'business_web')
    ) AS target(surface, artifact_type)
    CROSS JOIN unnest(ARRAY['owner','applicable_member','below_threshold','revoked','outsider']::text[]) AS role_case
  )
  SELECT count(*) INTO v_missing_matrix_count
  FROM expected x
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.ari_cert_evidence e
    JOIN public.ari_cert_release_artifacts a
      ON a.run_id = e.run_id
     AND a.artifact_type = e.artifact_type
     AND a.artifact_id = e.artifact_id
     AND a.release_sha = v_run.release_sha
    WHERE e.run_id = p_run_id
      AND e.capability_id = x.capability_id
      AND e.scenario = x.scenario
      AND e.surface = x.surface
      AND e.artifact_type = x.artifact_type
      AND e.role_case = x.role_case
      AND e.tenant_case = x.tenant_case
      AND e.outcome = 'passed'
      AND e.operation_id IS NOT NULL
      AND e.request_id IS NOT NULL
      AND e.client_turn_id IS NOT NULL
      AND e.execution_id IS NOT NULL
      AND NULLIF(btrim(e.canonical_readback_reference), '') IS NOT NULL
      AND jsonb_typeof(e.safe_evidence) = 'object'
      AND e.safe_evidence ?& ARRAY['receipt_id','readback_digest','telemetry_event_id']
      AND (SELECT count(*) FROM jsonb_object_keys(e.safe_evidence)) = 3
      AND (e.safe_evidence ->> 'receipt_id') ~* '^[0-9a-f-]{36}$'
      AND (e.safe_evidence ->> 'telemetry_event_id') ~* '^[0-9a-f-]{36}$'
      AND (e.safe_evidence ->> 'readback_digest') ~ '^[0-9a-f]{64}$'
  );

  SELECT count(*) INTO v_invalid_digest_count
  FROM public.ari_cert_evidence e
  WHERE e.run_id = p_run_id
    AND e.evidence_digest <> private.ari_cert_digest_v1('scenario-evidence', ARRAY[
      e.run_id::text,
      e.capability_id,
      e.scenario,
      e.surface,
      e.tenant_case,
      e.role_case,
      e.operation_id::text,
      e.request_id::text,
      e.client_turn_id::text,
      e.execution_id::text,
      e.artifact_type,
      e.artifact_id,
      e.canonical_readback_reference,
      e.outcome,
      e.safe_evidence ->> 'receipt_id',
      e.safe_evidence ->> 'readback_digest',
      e.safe_evidence ->> 'telemetry_event_id'
    ]);

  SELECT count(*) INTO v_unverified_provenance_count
  FROM public.ari_cert_evidence e
  WHERE e.run_id = p_run_id
    AND NOT EXISTS (
      SELECT 1
      FROM private.ari_cert_verified_provenance p
      WHERE p.run_id = e.run_id
        AND p.capability_id = e.capability_id
        AND p.surface = e.surface
        AND p.tenant_case = e.tenant_case
        AND p.role_case = e.role_case
        AND p.scenario = e.scenario
        AND p.operation_id = e.operation_id
        AND p.request_id = e.request_id
        AND p.client_turn_id = e.client_turn_id
        AND p.execution_id = e.execution_id
        AND p.canonical_readback_reference = e.canonical_readback_reference
        AND p.artifact_type = e.artifact_type
        AND p.artifact_id = e.artifact_id
        AND p.receipt_id = (e.safe_evidence ->> 'receipt_id')::uuid
        AND p.readback_digest = e.safe_evidence ->> 'readback_digest'
        AND p.telemetry_event_id = (e.safe_evidence ->> 'telemetry_event_id')::uuid
    );

  SELECT count(*) INTO v_invalid_native_count
  FROM jsonb_array_elements(v_run.native_artifacts) item
  LEFT JOIN public.ari_cert_release_artifacts artifact
    ON artifact.run_id = p_run_id
   AND artifact.artifact_type = item ->> 'surface'
   AND artifact.artifact_id = item ->> 'artifact_id'
   AND artifact.release_sha = v_run.release_sha
  WHERE artifact.id IS NULL;

  IF NOT private.ari_cert_native_artifacts_valid(v_run.native_artifacts)
     OR v_invalid_native_count <> 0 THEN
    RAISE EXCEPTION 'ari_cert_invalid_native_artifacts' USING ERRCODE = '22023';
  END IF;
  IF v_capability_count <> 148 THEN RAISE EXCEPTION 'ari_cert_missing_capabilities:%', v_capability_count; END IF;
  IF v_run.requirements_digest IS DISTINCT FROM private.ari_cert_requirements_set_digest_v1() THEN
    RAISE EXCEPTION 'ari_cert_requirements_digest_mismatch';
  END IF;
  IF v_unknown_count <> 0 THEN RAISE EXCEPTION 'ari_cert_unknown_capabilities:%', v_unknown_count; END IF;
  IF v_missing_matrix_count <> 0 THEN RAISE EXCEPTION 'ari_cert_missing_matrix_evidence:%', v_missing_matrix_count; END IF;
  IF v_invalid_digest_count <> 0 THEN RAISE EXCEPTION 'ari_cert_invalid_evidence_digest:%', v_invalid_digest_count; END IF;
  IF v_unverified_provenance_count <> 0 THEN RAISE EXCEPTION 'ari_cert_unverified_provenance:%', v_unverified_provenance_count; END IF;
  IF v_failed_count <> 0 THEN RAISE EXCEPTION 'ari_cert_nonpassing_evidence:%', v_failed_count; END IF;
  IF v_artifact_count <> 7 THEN RAISE EXCEPTION 'ari_cert_release_artifact_mismatch:%', v_artifact_count; END IF;
  IF v_residue_count <> 0 THEN RAISE EXCEPTION 'ari_cert_fixture_residue:%', v_residue_count; END IF;
  IF v_run.tester_verdict <> 'PASS' OR v_run.cleanup_manifest_digest IS NULL
     OR v_run.rollback_rehearsed_at IS NULL
     OR NULLIF(btrim(v_run.prior_compatible_pair), '') IS NULL
     OR v_run.stranded_operation_count IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'ari_cert_test_or_rollback_incomplete';
  END IF;

  v_attestation_key := current_setting('app.settings.ari_certification_attestation_key', true);
  v_attestation_key_id := current_setting('app.settings.ari_certification_attestation_key_id', true);
  IF length(coalesce(v_attestation_key, '')) < 32
     OR coalesce(v_attestation_key_id, '') !~ '^[a-zA-Z0-9_.:-]{1,64}$' THEN
    RAISE EXCEPTION 'ari_cert_server_attestation_not_configured';
  END IF;
  SELECT private.ari_cert_digest_v1(
    'evidence-set',
    coalesce(array_agg(
      evidence_digest ORDER BY capability_id, surface, artifact_type, scenario, role_case
    ), ARRAY[]::text[])
  )
  INTO v_evidence_set_digest
  FROM public.ari_cert_evidence WHERE run_id = p_run_id;

  SELECT private.ari_cert_digest_v1(
    'artifact-set',
    coalesce(array_agg(private.ari_cert_digest_v1('release-artifact', ARRAY[
      artifact_type, artifact_id, release_sha, sha256
    ]) ORDER BY artifact_type), ARRAY[]::text[])
  )
  INTO v_artifact_set_digest
  FROM public.ari_cert_release_artifacts WHERE run_id = p_run_id;

  WITH per_capability AS (
    SELECT e.capability_id, private.ari_cert_digest_v1(
      'capability-evidence',
      ARRAY[
        p_run_id::text,
        e.capability_id,
        CASE r.evidence_mode
          WHEN 'guided_handoff' THEN 'guided_handoff'
          WHEN 'unsupported' THEN 'unsupported'
          ELSE 'verified'
        END,
        'business_android', 'business_ios', 'business_web'
      ] || ARRAY(
        SELECT required_scenario
        FROM unnest(public.ari_cert_required_scenarios(r.evidence_mode)) required_scenario
        ORDER BY required_scenario
      ) || ARRAY[
        CASE WHEN r.evidence_mode IN ('guided_handoff','unsupported')
          THEN NULL ELSE min(e.canonical_readback_reference) END,
        'owner|applicable_member|below_threshold|revoked|outsider'
      ] || array_agg(
        e.evidence_digest ORDER BY e.surface, e.artifact_type, e.scenario, e.role_case
      )
    ) AS capability_digest
    FROM public.ari_cert_evidence e
    JOIN public.ari_cert_capability_requirements r
      ON r.capability_id = e.capability_id
    WHERE e.run_id = p_run_id
    GROUP BY e.capability_id, r.evidence_mode
  ), flattened AS (
    SELECT capability_id, value, ordinal
    FROM per_capability
    CROSS JOIN LATERAL unnest(ARRAY[capability_id, capability_digest])
      WITH ORDINALITY AS item(value, ordinal)
  )
  SELECT private.ari_cert_digest_v1(
    'capability-set',
    array_agg(value ORDER BY capability_id, ordinal)
  )
  INTO v_capability_set_digest
  FROM flattened;

  SELECT private.ari_cert_digest_v1(
    'native-artifact-set',
    array_agg(private.ari_cert_digest_v1('native-artifact', ARRAY[
      item ->> 'surface', item ->> 'artifact_id',
      item ->> 'runtime_version', item ->> 'device'
    ]) ORDER BY item ->> 'surface')
  )
  INTO v_native_artifact_set_digest
  FROM jsonb_array_elements(v_run.native_artifacts) item;

  v_cleanup_digest := private.ari_cert_digest_v1(
    'cleanup', ARRAY['true', v_run.cleanup_manifest_digest]
  );
  v_rollback_digest := private.ari_cert_digest_v1(
    'rollback', ARRAY['true', v_run.prior_compatible_pair, v_run.stranded_operation_count::text]
  );
  v_run_manifest_digest := private.ari_cert_digest_v1('run-manifest', ARRAY[
    v_run.function_versions ->> 'agent_chat',
    v_run.function_versions ->> 'agent_confirm_action',
    v_run.web_deployment_id,
    v_run.tester_verdict,
    v_native_artifact_set_digest,
    v_capability_set_digest,
    v_cleanup_digest,
    v_rollback_digest
  ]);
  v_attestation_payload := private.ari_cert_canonical_tuple_v1('attestation', ARRAY[
    v_attestation_key_id,
    p_run_id::text,
    v_run.release_sha,
    v_run.requirements_digest,
    v_evidence_set_digest,
    v_artifact_set_digest,
    v_capability_set_digest,
    v_native_artifact_set_digest,
    v_cleanup_digest,
    v_rollback_digest,
    v_run_manifest_digest
  ]);
  v_attestation_signature := encode(extensions.hmac(
    v_attestation_payload,
    convert_to(v_attestation_key, 'UTF8'),
    'sha256'
  ), 'hex');

  INSERT INTO private.ari_cert_finalize_authorizations (run_id, transaction_id)
  VALUES (p_run_id, txid_current())
  ON CONFLICT (run_id) DO UPDATE SET transaction_id = EXCLUDED.transaction_id;

  UPDATE public.ari_cert_runs
  SET status = 'passed', cleanup_verified_at = now(), finished_at = now(),
      attestation_key_id = v_attestation_key_id,
      evidence_set_digest = v_evidence_set_digest,
      artifact_set_digest = v_artifact_set_digest,
      capability_set_digest = v_capability_set_digest,
      native_artifact_set_digest = v_native_artifact_set_digest,
      cleanup_digest = v_cleanup_digest,
      rollback_digest = v_rollback_digest,
      run_manifest_digest = v_run_manifest_digest,
      attestation_signature = v_attestation_signature
  WHERE id = p_run_id;
  RETURN jsonb_build_object(
    'run_id', p_run_id,
    'status', 'passed',
    'capability_count', 148,
    'server_attestation', jsonb_build_object(
      'algorithm', 'HMAC-SHA256',
      'canonicalization', 'ARI-CERT-TUPLE-V1',
      'key_id', v_attestation_key_id,
      'evidence_set_digest', v_evidence_set_digest,
      'artifact_set_digest', v_artifact_set_digest,
      'capability_set_digest', v_capability_set_digest,
      'native_artifact_set_digest', v_native_artifact_set_digest,
      'cleanup_digest', v_cleanup_digest,
      'rollback_digest', v_rollback_digest,
      'run_manifest_digest', v_run_manifest_digest,
      'signature', v_attestation_signature
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.ari_cert_finalize_run(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ari_cert_finalize_run(uuid) TO service_role;

COMMENT ON FUNCTION public.ari_cert_begin_run(text, jsonb, text, jsonb, jsonb) IS
  'Issue #2060 Pass-5 post-#3872: stamps private.ari_cert_requirements_set_digest_v1() of the live 148-row requirement set.';
COMMENT ON FUNCTION public.ari_cert_finalize_run(uuid) IS
  'Issue #2060 Pass-5 post-#3872: finalizes the live 148-capability matrix only when the stamped requirement digest still matches.';

-- The M1 seam deliberately accepted every create field. R1's editor also needs
-- an optimistic, full-field update without moving any pricing arithmetic into
-- the client or edge function.
CREATE OR REPLACE FUNCTION public.issue_3872_upsert_discount(
  p_actor uuid,
  p_action text,
  p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $fn$
DECLARE
  v_id uuid;
  v_brand uuid;
  v_kind text;
  v_rank integer;
  v_row public.brand_discounts%ROWTYPE;
  v_t jsonb;
  v_target_brand uuid;
  v_target_count integer;
  v_target_kind text;
  v_target_id uuid;
  v_list_minor integer;
  v_brand_currency text;
BEGIN
  v_id := NULLIF(p_payload->>'id','')::uuid;
  v_brand := NULLIF(p_payload->>'brandId','')::uuid;

  IF v_id IS NOT NULL THEN
    SELECT * INTO v_row FROM public.brand_discounts WHERE id=v_id FOR UPDATE;
    IF v_row.id IS NULL THEN RAISE EXCEPTION 'discount_not_found'; END IF;
    v_brand := v_row.brand_id;
  END IF;
  IF v_brand IS NULL THEN RAISE EXCEPTION 'brand_required'; END IF;

  v_kind := COALESCE(p_payload->>'kind',v_row.kind);
  v_rank := COALESCE(public.biz_brand_effective_rank(v_brand,p_actor),0);
  IF v_rank < (CASE WHEN v_kind='code' THEN 20 ELSE 30 END) THEN
    RAISE EXCEPTION 'insufficient_permission';
  END IF;
  IF v_kind='voucher' THEN RAISE EXCEPTION 'kind_not_available'; END IF;
  SELECT upper(COALESCE(pricing_currency,default_currency))
    INTO v_brand_currency FROM public.brands WHERE id=v_brand;

  IF p_action='create' THEN
    IF v_kind IN ('automatic','sale_price') AND (
      SELECT count(*) FROM public.brand_discounts
       WHERE brand_id=v_brand AND kind IN ('automatic','sale_price')
         AND status='active' AND deleted_at IS NULL
    ) >= 20 THEN RAISE EXCEPTION 'too_many_automatics'; END IF;

    INSERT INTO public.brand_discounts(
      brand_id,kind,code,name,value_type,value_bps,value_minor,currency,
      scope_kind,combines_with,starts_at,ends_at,schedule,ends_after_count,
      max_total_uses,max_uses_per_buyer,min_subtotal_minor,status,source,
      source_ref,created_by
    ) VALUES (
      v_brand,v_kind,
      NULLIF(upper(regexp_replace(btrim(COALESCE(p_payload->>'code','')),'[\s-]','','g')),''),
      p_payload->>'name',p_payload->>'valueType',
      NULLIF(p_payload->>'valueBps','')::integer,
      NULLIF(p_payload->>'valueMinor','')::integer,
      CASE WHEN p_payload->>'valueType'='percent' THEN NULL ELSE v_brand_currency END,
      p_payload->>'scopeKind',
      COALESCE(p_payload->>'combinesWith',
        CASE WHEN v_kind IN ('automatic','sale_price') THEN 'any' ELSE 'automatic_only' END),
      COALESCE(NULLIF(p_payload->>'startsAt','')::timestamptz,now()),
      NULLIF(p_payload->>'endsAt','')::timestamptz,
      p_payload->'schedule',NULLIF(p_payload->>'endsAfterCount','')::integer,
      NULLIF(p_payload->>'maxTotalUses','')::integer,
      NULLIF(p_payload->>'maxUsesPerBuyer','')::integer,
      NULLIF(p_payload->>'minSubtotalMinor','')::integer,
      COALESCE(p_payload->>'status','active'),COALESCE(p_payload->>'source','host'),
      NULLIF(p_payload->>'sourceRef','')::uuid,p_actor
    ) RETURNING * INTO v_row;
    v_id := v_row.id;
  ELSIF p_action='update' THEN
    IF v_row.version<>COALESCE(NULLIF(p_payload->>'version','')::integer,-1) THEN
      RAISE EXCEPTION 'version_conflict';
    END IF;
    UPDATE public.brand_discounts SET
      kind = CASE WHEN p_payload?'kind' THEN p_payload->>'kind' ELSE kind END,
      code = CASE WHEN p_payload?'code' THEN NULLIF(upper(regexp_replace(btrim(COALESCE(p_payload->>'code','')),'[\s-]','','g')),'') ELSE code END,
      name = CASE WHEN p_payload?'name' THEN p_payload->>'name' ELSE name END,
      value_type = CASE WHEN p_payload?'valueType' THEN p_payload->>'valueType' ELSE value_type END,
      value_bps = CASE WHEN p_payload?'valueBps' THEN NULLIF(p_payload->>'valueBps','')::integer ELSE value_bps END,
      value_minor = CASE WHEN p_payload?'valueMinor' THEN NULLIF(p_payload->>'valueMinor','')::integer ELSE value_minor END,
      currency = CASE
        WHEN p_payload?'valueType' AND p_payload->>'valueType'='percent' THEN NULL
        WHEN p_payload?'valueType' OR p_payload?'valueMinor' THEN v_brand_currency
        ELSE currency END,
      scope_kind = CASE WHEN p_payload?'scopeKind' THEN p_payload->>'scopeKind' ELSE scope_kind END,
      combines_with = CASE WHEN p_payload?'combinesWith' THEN p_payload->>'combinesWith' ELSE combines_with END,
      starts_at = CASE WHEN p_payload?'startsAt' THEN (p_payload->>'startsAt')::timestamptz ELSE starts_at END,
      ends_at = CASE WHEN p_payload?'endsAt' THEN NULLIF(p_payload->>'endsAt','')::timestamptz ELSE ends_at END,
      schedule = CASE WHEN p_payload?'schedule' THEN p_payload->'schedule' ELSE schedule END,
      ends_after_count = CASE WHEN p_payload?'endsAfterCount' THEN NULLIF(p_payload->>'endsAfterCount','')::integer ELSE ends_after_count END,
      max_total_uses = CASE WHEN p_payload?'maxTotalUses' THEN NULLIF(p_payload->>'maxTotalUses','')::integer ELSE max_total_uses END,
      max_uses_per_buyer = CASE WHEN p_payload?'maxUsesPerBuyer' THEN NULLIF(p_payload->>'maxUsesPerBuyer','')::integer ELSE max_uses_per_buyer END,
      min_subtotal_minor = CASE WHEN p_payload?'minSubtotalMinor' THEN NULLIF(p_payload->>'minSubtotalMinor','')::integer ELSE min_subtotal_minor END,
      needs_attention = NULL
    WHERE id=v_id RETURNING * INTO v_row;
    DELETE FROM public.brand_discount_targets WHERE discount_id=v_id;
  ELSIF p_action IN ('pause','resume','end') THEN
    UPDATE public.brand_discounts
       SET status=CASE p_action WHEN 'pause' THEN 'paused' WHEN 'resume' THEN 'active' ELSE 'ended' END,
           ended_reason=CASE WHEN p_action='end' THEN 'host' ELSE NULL END
     WHERE id=v_id RETURNING * INTO v_row;
  ELSIF p_action='delete_draft' THEN
    IF v_row.status<>'draft' OR (v_row.created_by<>p_actor AND v_rank<50) THEN
      RAISE EXCEPTION 'delete_not_allowed';
    END IF;
    UPDATE public.brand_discounts SET deleted_at=now() WHERE id=v_id RETURNING * INTO v_row;
  ELSE
    RAISE EXCEPTION 'discount_action_invalid';
  END IF;

  IF p_action IN ('create','update') THEN
    FOR v_t IN SELECT value FROM jsonb_array_elements(COALESCE(p_payload->'targets','[]'::jsonb)) LOOP
      v_target_brand := NULL;
      IF v_t->>'targetKind'='event' THEN
        SELECT brand_id INTO v_target_brand FROM public.events
         WHERE id=(v_t->>'targetId')::uuid AND event_type<>'rsvp' AND deleted_at IS NULL;
      ELSIF v_t->>'targetKind'='ticket_type' THEN
        SELECT e.brand_id INTO v_target_brand FROM public.ticket_types tt
        JOIN public.events e ON e.id=tt.event_id
         WHERE tt.id=(v_t->>'targetId')::uuid AND tt.deleted_at IS NULL AND e.deleted_at IS NULL;
      ELSIF v_t->>'targetKind'='menu_item' THEN
        SELECT brand_id INTO v_target_brand FROM public.menu_items WHERE id=(v_t->>'targetId')::uuid;
      ELSIF v_t->>'targetKind' IN ('venue_menu','venue_deposit') THEN
        SELECT brand_id INTO v_target_brand FROM public.venue_listings WHERE id=(v_t->>'targetId')::uuid;
      ELSIF v_t->>'targetKind'='listing_kind' THEN
        v_target_brand := v_brand;
      END IF;
      IF v_target_brand IS NULL THEN RAISE EXCEPTION 'target_not_discountable'; END IF;
      IF v_target_brand<>v_brand THEN RAISE EXCEPTION 'target_not_in_brand'; END IF;
      INSERT INTO public.brand_discount_targets(discount_id,target_kind,listing_kind,target_id)
      VALUES(v_id,v_t->>'targetKind',NULLIF(v_t->>'listingKind',''),NULLIF(v_t->>'targetId','')::uuid);
    END LOOP;

    SELECT count(*),min(target_kind),min(target_id)
      INTO v_target_count,v_target_kind,v_target_id
      FROM public.brand_discount_targets WHERE discount_id=v_id;
    IF (v_row.value_type='set_price' OR v_row.kind='sale_price') AND v_target_count<>1 THEN
      RAISE EXCEPTION 'set_price_needs_one_item';
    END IF;
    IF v_row.value_type='set_price' OR v_row.kind='sale_price' THEN
      IF v_target_kind='ticket_type' THEN
        SELECT price_cents INTO v_list_minor FROM public.ticket_types WHERE id=v_target_id;
      ELSIF v_target_kind='menu_item' THEN
        SELECT price_cents INTO v_list_minor FROM public.menu_items WHERE id=v_target_id;
      ELSIF v_target_kind='venue_deposit' THEN
        SELECT fee_amount_cents INTO v_list_minor FROM public.venue_reservation_settings WHERE venue_id=v_target_id;
      END IF;
      IF v_list_minor IS NULL THEN RAISE EXCEPTION 'target_not_discountable'; END IF;
      IF v_row.value_minor>=v_list_minor THEN RAISE EXCEPTION 'set_price_not_lower'; END IF;
    END IF;
  END IF;

  SELECT * INTO v_row FROM public.brand_discounts WHERE id=v_id;
  RETURN to_jsonb(v_row)||jsonb_build_object('targets',COALESCE((
    SELECT jsonb_agg(to_jsonb(t) ORDER BY t.created_at,t.id)
      FROM public.brand_discount_targets t WHERE t.discount_id=v_id
  ),'[]'::jsonb));
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'code_taken';
END;
$fn$;
REVOKE ALL ON FUNCTION public.issue_3872_upsert_discount(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3872_upsert_discount(uuid,text,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.brand_discount_access(p_brand_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,auth,pg_temp
AS $fn$
  SELECT COALESCE(public.biz_brand_effective_rank(p_brand_id,auth.uid()),0)>=20
    AND public.issue_3872_discounts_on(p_brand_id)
$fn$;
REVOKE ALL ON FUNCTION public.brand_discount_access(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.brand_discount_access(uuid) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.brand_discounts_list(p_brand_id uuid,p_filter text DEFAULT 'live')
RETURNS SETOF jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,auth,pg_temp
AS $fn$
  SELECT to_jsonb(d)||jsonb_build_object(
    'targets',COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.created_at,t.id)
      FROM public.brand_discount_targets t WHERE t.discount_id=d.id),'[]'::jsonb),
    'consumedUnits',COALESCE((SELECT sum(u.units) FROM public.discount_uses u
      WHERE u.discount_id=d.id AND u.status='consumed'),0),
    'liveUses',COALESCE((SELECT count(*) FROM public.discount_uses u
      WHERE u.discount_id=d.id AND u.status IN ('reserved','consumed')),0)
  )
  FROM public.brand_discounts d
  WHERE d.brand_id=p_brand_id AND d.deleted_at IS NULL
    AND COALESCE(public.biz_brand_effective_rank(p_brand_id,auth.uid()),0)>=20
    AND CASE p_filter
      WHEN 'live' THEN d.status='active' AND d.starts_at<=now() AND (d.ends_at IS NULL OR d.ends_at>now()) AND d.needs_attention IS NULL
      WHEN 'scheduled' THEN d.status='active' AND d.starts_at>now()
      WHEN 'ended' THEN d.status='ended'
      WHEN 'needs_attention' THEN d.needs_attention IS NOT NULL
      ELSE false END
  ORDER BY d.created_at DESC,d.id;
$fn$;
REVOKE ALL ON FUNCTION public.brand_discounts_list(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.brand_discounts_list(uuid,text) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.brand_prices_overview(p_brand_id uuid)
RETURNS SETOF jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,auth,pg_temp
AS $fn$
  WITH allowed AS (
    SELECT COALESCE(public.biz_brand_effective_rank(p_brand_id,auth.uid()),0)>=20 ok
  ), rows AS (
    SELECT 'ticket_type'::text kind,tt.id,e.title listing_name,tt.name item_name,
      tt.price_cents list_unit_cents,tt.discounts_allowed AND e.discounts_allowed discounts_allowed,
      '/event/'||e.id::text owner_route
    FROM public.ticket_types tt JOIN public.events e ON e.id=tt.event_id,allowed
    WHERE allowed.ok AND e.brand_id=p_brand_id AND e.status='published'
      AND e.event_type<>'rsvp' AND e.deleted_at IS NULL AND tt.deleted_at IS NULL
      AND NOT tt.is_free
    UNION ALL
    SELECT 'menu_item',mi.id,COALESCE(m.name,'Menu'),mi.name,mi.price_cents,
      mi.discounts_allowed,'/venue/'||COALESCE(vl.id,mi.menu_id)::text||'?module=menu'
    FROM public.menu_items mi JOIN public.menus m ON m.id=mi.menu_id
    LEFT JOIN public.venue_listings vl ON vl.brand_id=mi.brand_id,allowed
    WHERE allowed.ok AND mi.brand_id=p_brand_id
    UNION ALL
    SELECT 'venue_deposit',s.venue_id,'Reservation deposit','Deposit',s.fee_amount_cents,
      s.discounts_allowed,'/venue/'||s.venue_id::text||'?module=settings'
    FROM public.venue_reservation_settings s,allowed
    WHERE allowed.ok AND s.brand_id=p_brand_id AND s.fee_enabled AND s.fee_amount_cents>0
  )
  SELECT jsonb_build_object(
    'kind',r.kind,'id',r.id,'listingName',r.listing_name,'itemName',r.item_name,
    'listUnitCents',r.list_unit_cents,'currentSaleCents',sale.value_minor,
    'saleEndsAt',sale.ends_at,'discountsAllowed',r.discounts_allowed,'ownerRoute',r.owner_route
  )
  FROM rows r
  LEFT JOIN LATERAL (
    SELECT d.value_minor,d.ends_at FROM public.brand_discount_targets t
    JOIN public.brand_discounts d ON d.id=t.discount_id
    WHERE t.target_kind=r.kind AND t.target_id=r.id AND t.orphaned_at IS NULL
      AND d.kind='sale_price' AND d.status='active' AND d.deleted_at IS NULL
      AND d.starts_at<=now() AND (d.ends_at IS NULL OR d.ends_at>now())
    ORDER BY d.starts_at DESC,d.id LIMIT 1
  ) sale ON true
  ORDER BY r.listing_name,r.item_name,r.id;
$fn$;
REVOKE ALL ON FUNCTION public.brand_prices_overview(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.brand_prices_overview(uuid) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.brand_discount_report(
  p_brand_id uuid,p_from timestamptz,p_to timestamptz
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,auth,pg_temp
AS $fn$
DECLARE v_result jsonb;
BEGIN
  IF COALESCE(public.biz_brand_effective_rank(p_brand_id,auth.uid()),0)<20
     AND COALESCE(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'insufficient_permission'; END IF;
  WITH discounted AS (
    SELECT 'ticket'::text order_kind,o.id order_id,o.buyer_total_cents::bigint revenue,
      lower(NULLIF(btrim(o.buyer_email),'')) buyer_key,o.created_at
    FROM public.orders o JOIN public.events e ON e.id=o.event_id
    WHERE e.brand_id=p_brand_id AND o.created_at>=p_from AND o.created_at<p_to
      AND o.payment_status IN ('paid','partial_refund','refunded') AND COALESCE(o.source,'online_checkout')<>'comp'
      AND EXISTS(SELECT 1 FROM public.order_discount_lines dl WHERE dl.order_kind='ticket' AND dl.order_id=o.id)
    UNION ALL
    SELECT 'venue_order',v.id,v.total_cents::bigint,lower(NULLIF(btrim(v.buyer_email),'')),v.created_at
    FROM public.venue_orders v WHERE v.brand_id=p_brand_id AND v.created_at>=p_from AND v.created_at<p_to
      AND v.payment_status IN ('paid','refunded')
      AND EXISTS(SELECT 1 FROM public.order_discount_lines dl WHERE dl.order_kind='venue_order' AND dl.order_id=v.id)
    UNION ALL
    SELECT 'reservation_deposit',s.id,s.amount_cents::bigint,lower(NULLIF(btrim(s.buyer_email),'')),s.created_at
    FROM public.reservation_checkout_sessions s WHERE s.brand_id=p_brand_id
      AND s.created_at>=p_from AND s.created_at<p_to AND s.status='completed'
      AND EXISTS(SELECT 1 FROM public.order_discount_lines dl WHERE dl.order_kind='reservation_deposit' AND dl.order_id=s.id)
  ), per_discount AS (
    SELECT dl.discount_id,max(dl.name_snapshot) name,sum(dl.amount_minor)::bigint amount_given_away,
      count(DISTINCT (dl.order_kind,dl.order_id))::integer orders
    FROM public.order_discount_lines dl JOIN discounted x
      ON x.order_kind=dl.order_kind AND x.order_id=dl.order_id
    WHERE dl.brand_id=p_brand_id GROUP BY dl.discount_id
  ), totals AS (
    SELECT count(*)::integer orders,COALESCE(sum(revenue),0)::bigint revenue,
      COALESCE((SELECT sum(amount_given_away) FROM per_discount),0)::bigint amount_given_away,
      CASE WHEN count(*)=0 THEN 0 ELSE round(100.0*count(*) FILTER (WHERE buyer_key IS NOT NULL AND NOT EXISTS(
        SELECT 1 FROM public.orders older JOIN public.events oe ON oe.id=older.event_id
        WHERE oe.brand_id=p_brand_id AND lower(NULLIF(btrim(older.buyer_email),''))=discounted.buyer_key
          AND older.payment_status='paid' AND older.created_at<discounted.created_at
      ))/count(*),1) END first_time_buyer_percent
    FROM discounted
  )
  SELECT jsonb_build_object('orders',t.orders,'revenueCents',t.revenue,
    'amountGivenAwayCents',t.amount_given_away,'firstTimeBuyerPercent',t.first_time_buyer_percent,
    'discounts',COALESCE((SELECT jsonb_agg(jsonb_build_object('discountId',p.discount_id,
      'name',p.name,'orders',p.orders,'amountGivenAwayCents',p.amount_given_away)
      ORDER BY p.amount_given_away DESC,p.discount_id) FROM per_discount p),'[]'::jsonb))
  INTO v_result FROM totals t;
  RETURN v_result;
END;
$fn$;
REVOKE ALL ON FUNCTION public.brand_discount_report(uuid,timestamptz,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.brand_discount_report(uuid,timestamptz,timestamptz) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.brand_discount_report_buyers(
  p_brand_id uuid,p_from timestamptz,p_to timestamptz
) RETURNS SETOF jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,auth,pg_temp
AS $fn$
BEGIN
  IF COALESCE(public.biz_brand_effective_rank(p_brand_id,auth.uid()),0)<40
     AND COALESCE(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'insufficient_permission'; END IF;
  RETURN QUERY
  SELECT jsonb_build_object('orderId',o.id,'buyerName',o.buyer_name,'buyerEmail',o.buyer_email,
    'buyerPhone',COALESCE(o.buyer_phone_e164,o.buyer_phone),'paidCents',o.buyer_total_cents,
    'currency',o.currency,'createdAt',o.created_at)
  FROM public.orders o JOIN public.events e ON e.id=o.event_id
  WHERE e.brand_id=p_brand_id AND o.created_at>=p_from AND o.created_at<p_to AND COALESCE(o.source,'online_checkout')<>'comp'
    AND EXISTS(SELECT 1 FROM public.order_discount_lines dl WHERE dl.order_kind='ticket' AND dl.order_id=o.id)
  ORDER BY o.created_at DESC,o.id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.brand_discount_report_buyers(uuid,timestamptz,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.brand_discount_report_buyers(uuid,timestamptz,timestamptz) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.order_discount_lines_for_order(p_order_kind text,p_order_id uuid)
RETURNS SETOF public.order_discount_lines
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,auth,pg_temp
AS $fn$
DECLARE v_brand uuid;v_buyer uuid;
BEGIN
  IF p_order_kind='ticket' THEN
    SELECT e.brand_id,o.buyer_user_id INTO v_brand,v_buyer FROM public.orders o
    JOIN public.events e ON e.id=o.event_id WHERE o.id=p_order_id;
  ELSIF p_order_kind='venue_order' THEN
    SELECT brand_id,buyer_user_id INTO v_brand,v_buyer FROM public.venue_orders WHERE id=p_order_id;
  ELSIF p_order_kind='reservation_deposit' THEN
    SELECT brand_id,consumer_user_id INTO v_brand,v_buyer FROM public.reservation_checkout_sessions WHERE id=p_order_id;
  ELSE RAISE EXCEPTION 'order_kind_invalid'; END IF;
  IF v_brand IS NULL OR (COALESCE(public.biz_brand_effective_rank(v_brand,auth.uid()),0)<30
    AND auth.uid() IS DISTINCT FROM v_buyer AND COALESCE(auth.role(),'')<>'service_role') THEN
    RAISE EXCEPTION 'insufficient_permission';
  END IF;
  RETURN QUERY SELECT * FROM public.order_discount_lines
    WHERE order_kind=p_order_kind AND order_id=p_order_id ORDER BY applied_seq,id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.order_discount_lines_for_order(text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.order_discount_lines_for_order(text,uuid) TO authenticated,service_role;

-- Admin order detail keeps its existing bundle and adds immutable discount
-- evidence. The first executable statement remains the admin guard.
CREATE OR REPLACE FUNCTION public.admin_get_order(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_order jsonb; v_event_id uuid; v_out jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  SELECT to_jsonb(o) INTO v_order FROM public.orders o WHERE o.id = p_order_id;
  IF v_order IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  v_event_id := NULLIF(v_order->>'event_id','')::uuid;
  v_out := jsonb_build_object(
    'order', v_order,
    'event', (SELECT jsonb_build_object('id', e.id, 'title', e.title, 'event_type', e.event_type,
                'city', e.city, 'status', e.status, 'visibility', e.visibility)
              FROM public.events e WHERE e.id = v_event_id),
    'brand', (SELECT jsonb_build_object('id', b.id, 'name', b.name, 'slug', b.slug)
              FROM public.events e JOIN public.brands b ON b.id = e.brand_id
              WHERE e.id = v_event_id),
    'line_items', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
                'order_line_item_id', li.id,
                'ticket_type_name', tt.name, 'quantity', li.quantity,
                'unit_price_cents', li.unit_price_cents, 'total_cents', li.total_cents,
                'list_unit_price_cents', COALESCE(li.list_unit_price_cents,li.unit_price_cents),
                'discount_cents', COALESCE(li.discount_cents,0),
                'refunded_quantity', (
                  SELECT COALESCE(SUM(rli.quantity), 0)
                  FROM public.refund_line_items rli
                  JOIN public.refunds r ON r.id = rli.refund_id
                  WHERE rli.order_line_item_id = li.id
                    AND r.status IN ('pending', 'succeeded')))
              ORDER BY li.id)
       FROM public.order_line_items li
       LEFT JOIN public.ticket_types tt ON tt.id = li.ticket_type_id
       WHERE li.order_id = p_order_id), '[]'::jsonb),
    'discount_lines', COALESCE(
      (SELECT jsonb_agg(to_jsonb(dl) ORDER BY dl.applied_seq,dl.id)
       FROM public.order_discount_lines dl
       WHERE dl.order_kind='ticket' AND dl.order_id=p_order_id), '[]'::jsonb),
    'installments', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
                'ordinal', oi.ordinal, 'amount_cents', oi.amount_cents, 'currency', oi.currency,
                'due_at', oi.due_at, 'status', oi.status, 'collected_at', oi.collected_at,
                'failed_at', oi.failed_at, 'failure_reason', oi.failure_reason)
              ORDER BY oi.ordinal)
       FROM public.order_installments oi WHERE oi.order_id = p_order_id), '[]'::jsonb),
    'refunds', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
                'id', r.id, 'amount_cents', r.amount_cents, 'currency', r.currency,
                'status', r.status, 'reason', r.reason, 'stripe_refund_id', r.stripe_refund_id,
                'created_at', r.created_at, 'processed_at', r.processed_at)
              ORDER BY r.created_at DESC)
       FROM public.refunds r WHERE r.order_id = p_order_id), '[]'::jsonb),
    'partner_split', (SELECT jsonb_build_object(
                'mingla_fee_cents', ps.mingla_fee_cents, 'partner_share_cents', ps.partner_share_cents,
                'transfer_currency', ps.transfer_currency, 'status', ps.status)
              FROM public.partner_splits ps WHERE ps.order_id = p_order_id
              ORDER BY ps.created_at DESC LIMIT 1));
  RETURN v_out;
END; $fn$;
REVOKE EXECUTE ON FUNCTION public.admin_get_order(uuid) FROM anon,PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_order(uuid) TO authenticated;

-- Notifications are generated transactionally by SQL and delivered by the
-- sweep. Notification timestamps move only after a successful fan-out.
CREATE OR REPLACE FUNCTION public.issue_3872_discount_maintenance(p_now timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp
AS $fn$
DECLARE v_notify jsonb;
BEGIN
  UPDATE public.brand_discounts d
     SET needs_attention='currency_mismatch'
   WHERE d.deleted_at IS NULL AND d.status IN ('active','paused')
     AND d.currency IS NOT NULL
     AND d.currency IS DISTINCT FROM (
       SELECT upper(COALESCE(b.pricing_currency,b.default_currency)) FROM public.brands b WHERE b.id=d.brand_id
     );

  UPDATE public.brand_discounts d
     SET status='ended',ended_reason=CASE
       WHEN d.ends_at IS NOT NULL AND d.ends_at<=p_now THEN 'window'
       WHEN d.ends_after_count IS NOT NULL AND COALESCE((
         SELECT sum(u.units) FROM public.discount_uses u
          WHERE u.discount_id=d.id AND u.status='consumed'
       ),0)>=d.ends_after_count THEN 'count'
       ELSE 'uses' END
   WHERE d.deleted_at IS NULL AND d.status='active' AND (
     (d.ends_at IS NOT NULL AND d.ends_at<=p_now)
     OR (d.ends_after_count IS NOT NULL AND COALESCE((
       SELECT sum(u.units) FROM public.discount_uses u WHERE u.discount_id=d.id AND u.status='consumed'
     ),0)>=d.ends_after_count)
     OR (d.max_total_uses IS NOT NULL AND COALESCE((
       SELECT count(*) FROM public.discount_uses u WHERE u.discount_id=d.id AND u.status='consumed'
     ),0)>=d.max_total_uses)
   );

  WITH usage AS (
    SELECT d.*,
      COALESCE((SELECT sum(u.units) FROM public.discount_uses u WHERE u.discount_id=d.id AND u.status='consumed'),0)::integer consumed_units,
      COALESCE((SELECT count(*) FROM public.discount_uses u WHERE u.discount_id=d.id AND u.status='consumed'),0)::integer consumed_uses
    FROM public.brand_discounts d WHERE d.deleted_at IS NULL
  ), notices AS (
    SELECT id,brand_id,name,'business.discount_limit_80'::text type,
      GREATEST(0,COALESCE(ends_after_count,max_total_uses)-CASE WHEN ends_after_count IS NOT NULL THEN consumed_units ELSE consumed_uses END)::integer left_count,
      NULL::text reason
    FROM usage WHERE status='active' AND notified_limit80_at IS NULL
      AND COALESCE(ends_after_count,max_total_uses) IS NOT NULL
      AND CASE WHEN ends_after_count IS NOT NULL THEN consumed_units ELSE consumed_uses END * 5
          >= COALESCE(ends_after_count,max_total_uses) * 4
    UNION ALL
    SELECT id,brand_id,name,'business.discount_ended',NULL::integer,ended_reason
    FROM usage WHERE status='ended' AND notified_ended_at IS NULL
    UNION ALL
    SELECT id,brand_id,name,'business.discount_needs_attention',NULL::integer,needs_attention
    FROM usage WHERE needs_attention IS NOT NULL AND notified_attention_at IS NULL
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'discountId',id,'brandId',brand_id,'type',type,'name',name,'left',left_count,'reason',reason
  ) ORDER BY id,type),'[]'::jsonb) INTO v_notify FROM notices;

  DELETE FROM public.discount_code_attempts WHERE failed_at<p_now-interval '1 day';
  RETURN jsonb_build_object('notify',v_notify);
END;
$fn$;
REVOKE ALL ON FUNCTION public.issue_3872_discount_maintenance(timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3872_discount_maintenance(timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.issue_3872_mark_discount_notified(p_id uuid,p_type text)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp
AS $fn$
BEGIN
  IF p_type='business.discount_limit_80' THEN
    UPDATE public.brand_discounts SET notified_limit80_at=COALESCE(notified_limit80_at,now()) WHERE id=p_id;
  ELSIF p_type='business.discount_ended' THEN
    UPDATE public.brand_discounts SET notified_ended_at=COALESCE(notified_ended_at,now()) WHERE id=p_id;
  ELSIF p_type='business.discount_needs_attention' THEN
    UPDATE public.brand_discounts SET notified_attention_at=COALESCE(notified_attention_at,now()) WHERE id=p_id;
  ELSE
    RAISE EXCEPTION 'notification_type_invalid';
  END IF;
END;
$fn$;
REVOKE ALL ON FUNCTION public.issue_3872_mark_discount_notified(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3872_mark_discount_notified(uuid,text) TO service_role;

ALTER TABLE public.business_notification_type_preferences
  DROP CONSTRAINT IF EXISTS business_notification_type_preferences_type_check;
ALTER TABLE public.business_notification_type_preferences
  ADD CONSTRAINT business_notification_type_preferences_type_check CHECK (type IN (
    'business.order_paid','business.event_sold_out','business.low_inventory',
    'business.refund_processed','business.dispute_opened','business.dispute_action_needed',
    'business.payout_paid','business.payout_failed','business.payout_waiting_for_bank',
    'business.payouts_paused','business.payouts_resumed','business.account_status_changed',
    'business.new_review','business.claim_decision','business.team_member_joined',
    'business.discount_limit_80','business.discount_ended','business.discount_needs_attention'
  ));

CREATE OR REPLACE VIEW public.issue_3872_order_margin AS
SELECT 'ticket'::text order_kind,o.id order_id,e.brand_id,lower(o.currency::text) currency,o.created_at,
  COALESCE(o.list_subtotal_cents,o.net_subtotal_cents,o.total_cents)::bigint list_subtotal_cents,
  COALESCE(o.discount_cents,0)::bigint discount_cents,COALESCE(o.buyer_total_cents,o.total_cents)::bigint buyer_total_cents,
  COALESCE(o.stripe_application_fee_amount_cents,0)::bigint application_fee_cents,
  fs.provider_fee_cents::bigint provider_fee_cents,
  (COALESCE(o.stripe_application_fee_amount_cents,0)-COALESCE(fs.provider_fee_cents,0))::bigint mingla_margin_cents,
  COALESCE(o.discount_cents,0)>0 discounted
FROM public.orders o JOIN public.events e ON e.id=o.event_id
LEFT JOIN public.payout_source_fee_snapshots fs ON fs.source_type='order' AND fs.source_id=o.id
WHERE o.payment_status IN ('paid','partial_refund','refunded') AND COALESCE(o.source,'online_checkout')<>'comp'
UNION ALL
SELECT 'venue_order',v.id,v.brand_id,lower(v.currency),v.created_at,
  COALESCE(v.list_subtotal_cents,v.subtotal_cents)::bigint,COALESCE(v.discount_cents,0)::bigint,
  v.total_cents::bigint,(COALESCE(v.mingla_fee_cents,0)+COALESCE(v.platform_service_fee_cents,0))::bigint,
  fs.provider_fee_cents::bigint,
  (COALESCE(v.mingla_fee_cents,0)+COALESCE(v.platform_service_fee_cents,0)-COALESCE(fs.provider_fee_cents,0))::bigint,
  COALESCE(v.discount_cents,0)>0
FROM public.venue_orders v
LEFT JOIN public.payout_source_fee_snapshots fs ON fs.source_type='venue_menu_order' AND fs.source_id=v.id
WHERE v.payment_status IN ('paid','refunded')
UNION ALL
SELECT 'reservation_deposit',s.id,s.brand_id,lower(s.currency::text),s.created_at,
  COALESCE(s.deposit_list_cents,s.amount_cents)::bigint,COALESCE(s.discount_cents,0)::bigint,
  s.amount_cents::bigint,COALESCE(s.application_fee_amount_cents,0)::bigint,NULL::bigint,
  COALESCE(s.application_fee_amount_cents,0)::bigint,COALESCE(s.discount_cents,0)>0
FROM public.reservation_checkout_sessions s
WHERE s.status='completed';

REVOKE ALL ON public.issue_3872_order_margin FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.issue_3872_order_margin TO service_role;

CREATE OR REPLACE FUNCTION public.admin_discount_margin_summary(p_from timestamptz,p_to timestamptz)
RETURNS SETOF jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,auth,pg_temp
AS $fn$
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  RETURN QUERY SELECT jsonb_build_object(
    'currency',m.currency,'discountedOrderCount',count(*) FILTER (WHERE m.discounted),
    'discountCents',COALESCE(sum(m.discount_cents),0),
    'marginCents',COALESCE(sum(m.mingla_margin_cents),0),
    'negativeMarginCount',count(*) FILTER (WHERE m.mingla_margin_cents<0)
  ) FROM public.issue_3872_order_margin m
  WHERE m.created_at>=p_from AND m.created_at<p_to GROUP BY m.currency ORDER BY m.currency;
END;
$fn$;
REVOKE ALL ON FUNCTION public.admin_discount_margin_summary(timestamptz,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_discount_margin_summary(timestamptz,timestamptz) TO authenticated,service_role;

-- #4070 merged first. Re-emit its Host payout read model with discount data
-- added only as informational keys; the payout formula is unchanged.
CREATE OR REPLACE FUNCTION public.brand_get_payout_screen(p_brand_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp
AS $fn$
DECLARE
  v_paused boolean;v_currency text;v_releases jsonb;
  v_sales_week bigint;v_coming bigint;v_paid_month bigint;
BEGIN
  IF auth.uid() IS NULL OR p_brand_id IS NULL
     OR NOT public.biz_can_view_payments_for_brand(p_brand_id,auth.uid()) THEN
    RAISE EXCEPTION 'insufficient_finance_permission' USING ERRCODE='42501';
  END IF;
  v_paused:=EXISTS(SELECT 1 FROM public.brand_payout_admin_holds h WHERE h.brand_id=p_brand_id);
  SELECT r.currency INTO v_currency FROM public.brand_payout_releases r
   WHERE r.brand_id=p_brand_id AND r.status NOT IN ('cancelled_event','failed')
   ORDER BY r.created_at DESC,r.id LIMIT 1;
  IF v_currency IS NULL THEN
    SELECT lower(b.default_currency) INTO v_currency FROM public.brands b WHERE b.id=p_brand_id;
  END IF;

  WITH rows AS (
    SELECT r.*,
      public.payout_screen_host_state(r.status,r.error_message,r.releasable_at,v_paused,now()) host_state,
      COALESCE(e.title,CASE r.surface WHEN 'rsvp_contribution' THEN 'Chip-ins'
        WHEN 'venue_reservation' THEN 'Bookings' ELSE 'Ticket sales' END) offering_name,
      COALESCE(items.sales_count,0) sales_count,items.last_sale_at,
      COALESCE(items.discount_cents,0) discount_cents,
      COALESCE(items.items,'[]'::jsonb) items,
      COALESCE(credits.transfer_fee_credit_cents,0) transfer_fee_credit_cents,
      COALESCE(leg_fees.transfer_fee_cents,0) transfer_fee_cents,
      COALESCE(leg_fees.stamp_duty_cents,0) stamp_duty_cents,
      CASE WHEN r.provider='paystack' THEN recipient.account_number_masked ELSE stripe_bank.bank_mask END bank_mask
    FROM public.brand_payout_releases r
    LEFT JOIN public.events e ON e.id=r.event_id
    LEFT JOIN LATERAL (
      SELECT count(*)::integer sales_count,max(i.source_finalized_at) last_sale_at,
        COALESCE(sum(CASE i.source_type
          WHEN 'order' THEN COALESCE((SELECT o.discount_cents FROM public.orders o WHERE o.id=i.source_id),0)
          WHEN 'venue_menu_order' THEN COALESCE((SELECT v.discount_cents FROM public.venue_orders v WHERE v.id=i.source_id),0)
          WHEN 'venue_reservation' THEN COALESCE((SELECT s.discount_cents FROM public.reservation_checkout_sessions s WHERE s.id=i.source_id),0)
          ELSE 0 END),0)::bigint discount_cents,
        jsonb_agg(jsonb_build_object(
          'source_type',i.source_type,'source_id',i.source_id,'gross_cents',i.gross_cents,
          'refunded_cents',i.refunded_cents,'disputed_cents',i.disputed_cents,
          'mingla_fee_cents',i.mingla_fee_cents,'net_cents',i.net_cents,
          'discount_cents',CASE i.source_type
            WHEN 'order' THEN COALESCE((SELECT o.discount_cents FROM public.orders o WHERE o.id=i.source_id),0)
            WHEN 'venue_menu_order' THEN COALESCE((SELECT v.discount_cents FROM public.venue_orders v WHERE v.id=i.source_id),0)
            WHEN 'venue_reservation' THEN COALESCE((SELECT s.discount_cents FROM public.reservation_checkout_sessions s WHERE s.id=i.source_id),0)
            ELSE 0 END,
          'paid_at',i.source_finalized_at
        ) ORDER BY i.source_finalized_at DESC,i.id) items
      FROM public.payout_release_items i WHERE i.release_id=r.id
    ) items ON true
    LEFT JOIN LATERAL (
      SELECT COALESCE(sum(a.amount_cents),0)::bigint transfer_fee_credit_cents
      FROM public.payout_ledger_adjustments a WHERE a.release_id=r.id AND a.kind='transfer_fee_credit'
    ) credits ON true
    LEFT JOIN LATERAL (
      SELECT COALESCE(sum(l.estimated_fee_cents),0)::bigint transfer_fee_cents,
        COALESCE(sum(l.stamp_duty_cents),0)::bigint stamp_duty_cents
      FROM public.payout_transfer_legs l WHERE l.release_id=r.id AND l.kind='organiser'
    ) leg_fees ON true
    LEFT JOIN LATERAL (
      SELECT pr.account_number_masked FROM public.brand_paystack_recipients pr
      WHERE pr.brand_id=r.brand_id AND pr.is_active LIMIT 1
    ) recipient ON true
    LEFT JOIN LATERAL (
      SELECT CASE WHEN ea.last4 IS NULL THEN NULL ELSE '••••'||ea.last4 END bank_mask
      FROM public.stripe_external_accounts ea WHERE ea.brand_id=r.brand_id AND ea.status<>'removed'
      ORDER BY ea.default_for_currency DESC,ea.updated_at DESC LIMIT 1
    ) stripe_bank ON true
    WHERE r.brand_id=p_brand_id AND (v_currency IS NULL OR r.currency=v_currency)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',id,'event_id',event_id,'offering_name',offering_name,'provider',provider,
    'currency',currency,'ledger_status',status,'host_state',host_state,'due_at',releasable_at,
    'released_at',released_at,'gross_cents',gross_cents,'discount_cents',discount_cents,
    'refunded_cents',refunded_cents,'disputed_cents',disputed_cents,'mingla_fee_cents',mingla_fee_cents,
    'partner_share_cents',partner_share_cents,'permanent_debt_withheld_cents',permanent_debt_withheld_cents,
    'temporary_debt_withheld_cents',temporary_debt_withheld_cents,'maturity_recredit_cents',maturity_recredit_cents,
    'net_release_cents',net_release_cents,'cash_to_bank_cents',organiser_cash_delivered_cents,
    'transfer_fee_credit_cents',transfer_fee_credit_cents,'transfer_fee_cents',transfer_fee_cents,
    'stamp_duty_cents',stamp_duty_cents,'sales_count',sales_count,'last_sale_at',last_sale_at,
    'bank_mask',bank_mask,'older_pricing',gross_cents>0 AND mingla_fee_cents::numeric/gross_cents::numeric<0.03,
    'items',items
  ) ORDER BY releasable_at DESC,id),'[]'::jsonb) INTO v_releases FROM rows;

  SELECT COALESCE(sum(i.gross_cents),0)::bigint INTO v_sales_week
  FROM public.payout_release_items i JOIN public.brand_payout_releases r ON r.id=i.release_id
  WHERE r.brand_id=p_brand_id AND (v_currency IS NULL OR r.currency=v_currency)
    AND i.source_finalized_at>=date_trunc('week',now());
  SELECT COALESCE(sum(CASE WHEN r.status NOT IN ('released','cancelled_event') THEN greatest(r.net_release_cents,0) ELSE 0 END),0)::bigint,
    COALESCE(sum(CASE WHEN r.status='released' AND r.released_at>=date_trunc('month',now()) THEN r.organiser_cash_delivered_cents ELSE 0 END),0)::bigint
    INTO v_coming,v_paid_month FROM public.brand_payout_releases r
    WHERE r.brand_id=p_brand_id AND (v_currency IS NULL OR r.currency=v_currency);
  RETURN jsonb_build_object('currency',v_currency,'payouts_paused',v_paused,
    'sales_this_week_cents',v_sales_week,'coming_to_you_cents',v_coming,
    'paid_this_month_cents',v_paid_month,'releases',v_releases);
END;
$fn$;
REVOKE ALL ON FUNCTION public.brand_get_payout_screen(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.brand_get_payout_screen(uuid) TO authenticated;

DO $foundation$
BEGIN
  IF to_regclass('public.product_capabilities') IS NULL
     OR to_regclass('public.product_truth_audit') IS NULL
     OR to_regprocedure('public.issue_3720_feature_guide_effective_status(uuid)') IS NULL THEN
    RAISE EXCEPTION 'issue3872_discount_guide_foundation_missing';
  END IF;
END;
$foundation$;

DO $guide$
DECLARE v_id uuid;v_revision integer;
BEGIN
  SELECT id,revision INTO v_id,v_revision FROM public.product_capabilities
   WHERE capability_key='events-discount-codes' FOR UPDATE;
  IF v_id IS NULL THEN RAISE EXCEPTION 'issue3872_discount_guide_capability_missing'; END IF;
  IF public.issue_3720_feature_guide_effective_status(v_id)='Live' THEN
    RAISE EXCEPTION 'issue3872_discount_guide_protected_live_entry';
  END IF;
  UPDATE public.product_capabilities SET
    outcome_summary='Hosts create discount codes, automatic discounts and sale prices for tickets, venue orders and reservation deposits.',
    how_to='In Mingla Host, open a brand, then Discounts. Create a code, automatic discount or sale price; choose what it applies to; review the server preview; and publish it. Use the Prices tab to allow or stop discounts item by item.',
    limitations='Door sales, RSVP tickets, comps, stays, tips, ad credit and subscriptions are not discounted. Available to pilot brands until general availability.',
    support_wording='Hosts control whether a discount is a code, automatic offer or sale price, what it applies to, whether it combines, its dates and its limits. Buyers are always charged the server-confirmed total.',
    revision=revision+1,updated_at=now()
  WHERE id=v_id AND (outcome_summary,how_to,limitations,support_wording) IS DISTINCT FROM (
    'Hosts create discount codes, automatic discounts and sale prices for tickets, venue orders and reservation deposits.',
    'In Mingla Host, open a brand, then Discounts. Create a code, automatic discount or sale price; choose what it applies to; review the server preview; and publish it. Use the Prices tab to allow or stop discounts item by item.',
    'Door sales, RSVP tickets, comps, stays, tips, ad credit and subscriptions are not discounted. Available to pilot brands until general availability.',
    'Hosts control whether a discount is a code, automatic offer or sale price, what it applies to, whether it combines, its dates and its limits. Buyers are always charged the server-confirmed total.'
  );
  IF FOUND THEN
    INSERT INTO public.product_truth_audit(action,capability_id,metadata)
    VALUES('capability_saved',v_id,jsonb_build_object('source','issue_3872_r1_host_operations','issue',3872,'revision',v_revision+1));
  END IF;
END;
$guide$;

DO $cron$
DECLARE v_job bigint;
BEGIN
  IF to_regnamespace('cron') IS NULL OR to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') IS NULL THEN
    RAISE NOTICE '#3872: pg_cron/pg_net unavailable; discount maintenance not scheduled'; RETURN;
  END IF;
  IF to_regclass('vault.decrypted_secrets') IS NULL
    OR NOT EXISTS(SELECT 1 FROM vault.decrypted_secrets WHERE name='supabase_url')
    OR NOT EXISTS(SELECT 1 FROM vault.decrypted_secrets WHERE name='service_role_key') THEN
    RAISE NOTICE '#3872: runtime vault rows unavailable; discount maintenance not scheduled'; RETURN;
  END IF;
  SELECT jobid INTO v_job FROM cron.job WHERE jobname='issue_3872_discount_maintenance';
  IF v_job IS NOT NULL THEN PERFORM cron.unschedule(v_job); END IF;
  PERFORM cron.schedule('issue_3872_discount_maintenance','*/15 * * * *',$job$SELECT net.http_post(
    url:=(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='supabase_url' LIMIT 1)||'/functions/v1/discount-maintenance-sweep',
    headers:=jsonb_build_object('content-type','application/json','authorization','Bearer '||(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='service_role_key' LIMIT 1)),
    body:='{}'::jsonb,timeout_milliseconds:=25000)$job$);
END;
$cron$;

NOTIFY pgrst,'reload schema';
COMMIT;
