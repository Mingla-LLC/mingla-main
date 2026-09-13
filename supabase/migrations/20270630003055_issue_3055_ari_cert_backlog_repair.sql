-- ===========================================================================
-- Issue #3055 — Ari certification backlog repair (convergent).
-- ---------------------------------------------------------------------------
-- WHY THIS FILE EXISTS
-- Five merged migrations maintain the Ari certification requirement set and
-- the two functions that check a run against it. None of them has ever run in
-- production: each sorts below the production applied head (20270628003285 on
-- 2026-09-13), and `db push` skips anything below the head. Production is therefore stuck on
-- the #2830 requirement set (132 rows, still certifying the retired
-- `ari.guests.set_approval`, missing `ari.rsvp.update` and the five #1980/#1981
-- capabilities) and on #2830's function bodies, which pin a hardcoded digest
-- and a 132 denominator. Applying the stranded files piecemeal makes it worse:
-- #1981 alone pins 137 against 134 rows and kills every run.
--
-- SUPERSEDES — as the delivery vehicle for their CERTIFICATION objects only.
-- The files are NOT edited; they stay on disk as history and keep building the
-- CI chain. This file is the one that reaches production.
--   20270529002060_issue_2060_ari_cert_requirements_set_digest.sql
--       helper + begin/finalize + grants + helper COMMENT
--   20270530001977_issue_1977_ari_rsvp_guest_contribution.sql
--       ONLY its ari_cert_capability_requirements block (retire
--       ari.guests.set_approval, insert ari.rsvp.update, promote
--       ari.rsvp.contribution_settings). Its RSVP routines are owned at
--       reachable versions by #3044 (20270615003044) and #3047
--       (20270616003047) and are out of scope here.
--   20270610002060_issue_2060_ari_cert_requirements_set_digest_post_2830.sql
--       helper + begin/finalize + grants
--   20270621001980_issue_1980_ari_cert_capability_census.sql
--       three requirement rows + helper + begin/finalize + grants
--   20270625001981_issue_1981_ari_cert_capability_census.sql
--       two requirement rows + helper + begin/finalize + grants + COMMENTs
-- Each later file supersedes the earlier function bodies, so the helper,
-- ari_cert_begin_run and ari_cert_finalize_run below are re-issued
-- BYTE-IDENTICAL to 20270625001981 (statements copied, not retyped).
--
-- CONVERGENT BY CONSTRUCTION
-- It lands the identical final state from both starting points it can meet:
--   (A) production: the #2830 set and #2830 function bodies, no helper;
--   (B) the CI chain: every file above already applied, set already correct.
-- On (A) it retires 1 row, inserts 6, promotes 1, and replaces the functions.
-- On (B) every write matches zero rows and every function is replaced with its
-- own bytes. The helper COMMENT from 20270529002060 is re-issued because a
-- freshly created helper (production) would otherwise lack the comment the
-- chain carries.
--
-- GUARDS ARE DELTA-SHAPED (binding decision on #3055) — never a count literal.
--   PRE-FLIGHT, before any write, classifies the starting state and refuses
--   anything that is neither (A) nor (B):
--     * every row this file owns must be at its production value or its chain
--       value, and all of them at the same one;
--     * the certification functions must match that shape (no helper and no
--       helper call on (A); helper present and called by both on (B));
--     * the requirement row count must equal the denominator the LIVE
--       ari_cert_finalize_run demands — read from the function, not written
--       here. A row no reviewed migration accounts for breaks that agreement,
--       and is refused rather than silently certified;
--     * the immutability trigger must be present and enabled.
--   POST-FLIGHT, before COMMIT, asserts the result:
--     * every owned row is at its chain value;
--     * the row count moved by exactly the net delta computed from the
--       pre-flight classification (+5 on (A), 0 on (B));
--     * rows this file does not own are byte-for-byte unchanged;
--     * the requirement rows agree with the re-issued finalizer's denominator;
--     * the immutability trigger was re-created with a definition identical
--       to the one captured before it was dropped, and is enabled;
--     * both functions derive the digest from the helper.
--
-- Self-wrapped transaction: the Management API /database/query endpoint does
-- NOT wrap a multi-statement body. Without BEGIN/COMMIT here a failed guard
-- could leave the delete applied, the trigger dropped, or the functions half
-- replaced.
--
-- MONOTONIC VERSION 20270630003055 — above the production applied head
-- 20270628003285 and every version on origin/main or in a sibling worktree when
-- this was written (highest in flight: 20270629003288). An earlier draft of this
-- file carried 20270628003055 and was itself shadowed when 20270628003285 was
-- applied first — the exact failure this file repairs. Do NOT apply from a
-- worktree; the orchestrator owns production apply.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. PRE-FLIGHT — classify the starting state. No write happens before this.
-- ---------------------------------------------------------------------------
DO $issue_3055_preflight$
DECLARE
  v_owned jsonb;
  v_unexpected text;
  v_owned_total integer;
  v_at_production integer;
  v_at_chain integer;
  v_shape text;
  v_helper regprocedure := to_regprocedure('private.ari_cert_requirements_set_digest_v1()');
  v_begin regprocedure := to_regprocedure('public.ari_cert_begin_run(text,jsonb,text,jsonb,jsonb)');
  v_finalize regprocedure := to_regprocedure('public.ari_cert_finalize_run(uuid)');
  v_begin_calls_helper boolean;
  v_finalize_calls_helper boolean;
  v_denominators text[];
  v_rows integer;
  v_unowned_rows integer;
  v_unowned_fingerprint text;
  v_trigger_count integer;
  v_trigger_def text;
  v_trigger_enabled text;
BEGIN
  IF to_regclass('public.ari_cert_capability_requirements') IS NULL THEN
    RAISE EXCEPTION 'issue_3055_preflight_requirements_table_missing';
  END IF;
  IF to_regprocedure('private.ari_cert_digest_v1(text,text[])') IS NULL THEN
    RAISE EXCEPTION 'issue_3055_preflight_digest_primitive_missing: private.ari_cert_digest_v1(text,text[])';
  END IF;
  IF v_begin IS NULL OR v_finalize IS NULL THEN
    RAISE EXCEPTION 'issue_3055_preflight_certification_functions_missing: begin_run=% finalize_run=%',
      (v_begin IS NOT NULL)::text, (v_finalize IS NOT NULL)::text;
  END IF;

  -- The immutability trigger this file drops and re-creates.
  SELECT count(*), min(pg_get_triggerdef(t.oid)), min(t.tgenabled::text)
    INTO v_trigger_count, v_trigger_def, v_trigger_enabled
  FROM pg_trigger t
  WHERE t.tgrelid = 'public.ari_cert_capability_requirements'::regclass
    AND t.tgname = 'ari_cert_capability_requirements_immutable_trigger'
    AND NOT t.tgisinternal;
  IF v_trigger_count <> 1 OR v_trigger_enabled <> 'O' THEN
    RAISE EXCEPTION 'issue_3055_preflight_immutability_trigger_unexpected: present=% enabled=%',
      v_trigger_count, v_trigger_enabled;
  END IF;

  -- Every requirement row this file is responsible for, with the value it holds
  -- in production (A) and the value the merged chain gives it (B). NULL = absent.
  WITH owned(capability_id, source_issue, production_mode, chain_mode) AS (
    VALUES
      ('ari.guests.set_approval',        '#1977', 'write',       NULL),
      ('ari.rsvp.update',                '#1977', NULL,          'write'),
      ('ari.rsvp.contribution_settings', '#1977', 'unsupported', 'write'),
      ('ari.marketing.update_draft',     '#1980', NULL,          'write'),
      ('ari.marketing.delete_draft',     '#1980', NULL,          'write'),
      ('ari.growth.read_report',         '#1980', NULL,          'read'),
      ('ari.order.refund_preview',       '#1981', NULL,          'read'),
      ('ari.installment.list',           '#1981', NULL,          'read')
  )
  SELECT jsonb_agg(jsonb_build_object(
           'capability_id', o.capability_id,
           'source_issue', o.source_issue,
           'production_mode', o.production_mode,
           'chain_mode', o.chain_mode,
           'starting_mode', r.evidence_mode
         ) ORDER BY o.capability_id)
    INTO v_owned
  FROM owned o
  LEFT JOIN public.ari_cert_capability_requirements r USING (capability_id);

  SELECT count(*),
         count(*) FILTER (WHERE starting_mode IS NOT DISTINCT FROM production_mode),
         count(*) FILTER (WHERE starting_mode IS NOT DISTINCT FROM chain_mode),
         string_agg(
           format('%s (%s) evidence_mode=%s, expected %s (production) or %s (chain)',
                  capability_id, source_issue, coalesce(starting_mode, 'ABSENT'),
                  coalesce(production_mode, 'ABSENT'), coalesce(chain_mode, 'ABSENT')),
           '; ' ORDER BY capability_id)
           FILTER (WHERE starting_mode IS DISTINCT FROM production_mode
                     AND starting_mode IS DISTINCT FROM chain_mode)
    INTO v_owned_total, v_at_production, v_at_chain, v_unexpected
  FROM jsonb_to_recordset(v_owned)
    AS o(capability_id text, source_issue text, production_mode text, chain_mode text, starting_mode text);

  IF v_unexpected IS NOT NULL THEN
    RAISE EXCEPTION 'issue_3055_preflight_unexpected_requirement_row: %', v_unexpected;
  END IF;
  IF v_at_production = v_owned_total THEN
    v_shape := 'production';
  ELSIF v_at_chain = v_owned_total THEN
    v_shape := 'chain';
  ELSE
    SELECT string_agg(format('%s (%s)=%s', capability_id, source_issue,
                             CASE WHEN starting_mode IS NOT DISTINCT FROM chain_mode THEN 'chain' ELSE 'production' END),
                      '; ' ORDER BY capability_id)
      INTO v_unexpected
    FROM jsonb_to_recordset(v_owned)
      AS o(capability_id text, source_issue text, production_mode text, chain_mode text, starting_mode text);
    RAISE EXCEPTION 'issue_3055_preflight_partially_applied_backlog: % — neither production-shaped nor chain-shaped; refusing to write', v_unexpected;
  END IF;

  -- The certification functions must be in the same shape as the rows.
  SELECT prosrc ~ 'private\.ari_cert_requirements_set_digest_v1\s*\(' INTO v_begin_calls_helper
  FROM pg_proc WHERE oid = v_begin;
  SELECT prosrc ~ 'private\.ari_cert_requirements_set_digest_v1\s*\(' INTO v_finalize_calls_helper
  FROM pg_proc WHERE oid = v_finalize;
  IF v_shape = 'production'
     AND (v_helper IS NOT NULL OR v_begin_calls_helper OR v_finalize_calls_helper) THEN
    RAISE EXCEPTION 'issue_3055_preflight_functions_disagree_with_rows: rows are production-shaped but helper_present=% begin_calls_helper=% finalize_calls_helper=%',
      (v_helper IS NOT NULL)::text, v_begin_calls_helper::text, v_finalize_calls_helper::text;
  END IF;
  IF v_shape = 'chain'
     AND (v_helper IS NULL OR NOT v_begin_calls_helper OR NOT v_finalize_calls_helper) THEN
    RAISE EXCEPTION 'issue_3055_preflight_functions_disagree_with_rows: rows are chain-shaped but helper_present=% begin_calls_helper=% finalize_calls_helper=%',
      (v_helper IS NOT NULL)::text, v_begin_calls_helper::text, v_finalize_calls_helper::text;
  END IF;

  -- The requirement set must agree with the denominator the LIVE finalizer
  -- demands. Read from the function; this file carries no count of its own.
  SELECT array_agg(m[1]) INTO v_denominators
  FROM pg_proc p
  CROSS JOIN LATERAL regexp_matches(p.prosrc, 'v_capability_count\s*<>\s*([0-9]+)', 'g') AS m
  WHERE p.oid = v_finalize;
  IF coalesce(cardinality(v_denominators), 0) <> 1 THEN
    RAISE EXCEPTION 'issue_3055_preflight_finalizer_denominator_unreadable: found %', coalesce(cardinality(v_denominators), 0);
  END IF;
  SELECT count(*) INTO v_rows FROM public.ari_cert_capability_requirements;
  IF v_rows <> v_denominators[1]::integer THEN
    RAISE EXCEPTION 'issue_3055_preflight_requirements_disagree_with_live_finalizer: % requirement rows but ari_cert_finalize_run demands % capabilities — the set holds a row no reviewed migration accounts for (or lacks one); refusing to write',
      v_rows, v_denominators[1];
  END IF;

  -- Fingerprint of every row this file does NOT own. It must not move.
  SELECT count(*),
         md5(coalesce(string_agg(r.capability_id || '=' || r.evidence_mode, E'\n'
                                 ORDER BY r.capability_id COLLATE "C"), ''))
    INTO v_unowned_rows, v_unowned_fingerprint
  FROM public.ari_cert_capability_requirements r
  WHERE r.capability_id NOT IN (
    SELECT o ->> 'capability_id' FROM jsonb_array_elements(v_owned) AS o
  );

  -- Hand the classification to the post-flight block. Transaction-local.
  PERFORM set_config('issue_3055.shape', v_shape, true);
  PERFORM set_config('issue_3055.owned_rows', v_owned::text, true);
  PERFORM set_config('issue_3055.baseline_rows', v_rows::text, true);
  PERFORM set_config('issue_3055.unowned_rows', v_unowned_rows::text, true);
  PERFORM set_config('issue_3055.unowned_fingerprint', v_unowned_fingerprint, true);
  PERFORM set_config('issue_3055.trigger_definition', v_trigger_def, true);

  RAISE NOTICE 'issue_3055 pre-flight: starting state is %-shaped (% requirement rows, % owned, % unowned)',
    v_shape, v_rows, v_owned_total, v_unowned_rows;
END;
$issue_3055_preflight$;

-- ---------------------------------------------------------------------------
-- 1. #1977's certification-requirement delta. The set is protected by an
--    immutability trigger (BEFORE UPDATE OR DELETE); it is dropped around the
--    two row changes and re-created from the definition in
--    20270504002060. The post-flight block proves the re-created definition
--    is identical to the one captured above.
-- ---------------------------------------------------------------------------
DROP TRIGGER ari_cert_capability_requirements_immutable_trigger
  ON public.ari_cert_capability_requirements;

DELETE FROM public.ari_cert_capability_requirements
WHERE capability_id = 'ari.guests.set_approval'
  AND evidence_mode = 'write';

UPDATE public.ari_cert_capability_requirements
SET evidence_mode = 'write'
WHERE capability_id = 'ari.rsvp.contribution_settings'
  AND evidence_mode = 'unsupported';

INSERT INTO public.ari_cert_capability_requirements (capability_id, evidence_mode)
VALUES ('ari.rsvp.update', 'write')
ON CONFLICT (capability_id) DO NOTHING;

CREATE TRIGGER ari_cert_capability_requirements_immutable_trigger
BEFORE UPDATE OR DELETE ON public.ari_cert_capability_requirements
FOR EACH ROW EXECUTE FUNCTION public.ari_cert_evidence_immutable();

-- ---------------------------------------------------------------------------
-- 2. #1980's three rows (copied from 20270621001980).
-- ---------------------------------------------------------------------------
INSERT INTO public.ari_cert_capability_requirements (capability_id, evidence_mode)
VALUES
  ('ari.marketing.update_draft', 'write'),
  ('ari.marketing.delete_draft', 'write'),
  ('ari.growth.read_report', 'read')
ON CONFLICT (capability_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. #1981's two rows (copied from 20270625001981).
-- ---------------------------------------------------------------------------
INSERT INTO public.ari_cert_capability_requirements (capability_id, evidence_mode)
VALUES
  ('ari.order.refund_preview', 'read'),
  ('ari.installment.list', 'read')
ON CONFLICT (capability_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. Helper, ari_cert_begin_run, ari_cert_finalize_run, grants and COMMENTs —
--    copied byte-for-byte from 20270625001981.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.ari_cert_requirements_set_digest_v1()
RETURNS text
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public, private, extensions, pg_temp
AS $function$
  SELECT private.ari_cert_digest_v1(
    'requirements-set',
    coalesce(
      array_agg(
        private.ari_cert_digest_v1(
          'requirement',
          ARRAY[capability_id, evidence_mode]
        )
        ORDER BY capability_id
      ),
      ARRAY[]::text[]
    )
  )
  FROM public.ari_cert_capability_requirements;
$function$;

REVOKE ALL ON FUNCTION private.ari_cert_requirements_set_digest_v1() FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ari_cert_begin_run(
  p_release_sha text,
  p_function_versions jsonb,
  p_web_deployment_id text,
  p_native_artifacts jsonb,
  p_baseline jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_run_id uuid;
  v_requirements_digest text;
BEGIN
  IF p_release_sha !~ '^[0-9a-f]{40,64}$'
     OR jsonb_typeof(p_function_versions) <> 'object'
     OR NULLIF(p_function_versions ->> 'agent_chat', '') IS NULL
     OR NULLIF(p_function_versions ->> 'agent_confirm_action', '') IS NULL
     OR NULLIF(btrim(p_web_deployment_id), '') IS NULL
     OR NOT private.ari_cert_native_artifacts_valid(p_native_artifacts)
     OR jsonb_typeof(p_baseline) <> 'object' THEN
    RAISE EXCEPTION 'ari_cert_invalid_release_manifest' USING ERRCODE = '22023';
  END IF;
  -- #2060 Pass-5: stamp the digest of the ordered requirement set, not a
  -- reviewed-but-unfalsifiable literal. Finalize recomputes the same helper.
  v_requirements_digest := private.ari_cert_requirements_set_digest_v1();
  IF v_requirements_digest !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'ari_cert_requirements_digest_uncomputable' USING ERRCODE = '55000';
  END IF;
  INSERT INTO public.ari_cert_runs (
    release_sha, requirements_digest, function_versions,
    web_deployment_id, native_artifacts, baseline, status
  ) VALUES (
    p_release_sha,
    v_requirements_digest,
    p_function_versions, p_web_deployment_id, p_native_artifacts, p_baseline, 'running'
  ) RETURNING id INTO v_run_id;
  RETURN v_run_id;
END;
$function$;

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
  IF v_capability_count <> 137 THEN RAISE EXCEPTION 'ari_cert_missing_capabilities:%', v_capability_count; END IF;
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
    'capability_count', 137,
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

REVOKE ALL ON FUNCTION public.ari_cert_begin_run(text, jsonb, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ari_cert_begin_run(text, jsonb, text, jsonb, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.ari_cert_finalize_run(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ari_cert_finalize_run(uuid) TO service_role;

COMMENT ON FUNCTION public.ari_cert_begin_run(text, jsonb, text, jsonb, jsonb) IS
  'Issue #2060 Pass-5 post-#1981: stamps private.ari_cert_requirements_set_digest_v1() of the live 137-row requirement set.';
COMMENT ON FUNCTION public.ari_cert_finalize_run(uuid) IS
  'Issue #2060 Pass-5 post-#1981: finalizes only when v_run.requirements_digest equals a fresh private.ari_cert_requirements_set_digest_v1().';

-- The helper COMMENT 20270529002060 set. Re-issued so a helper created here
-- (production) carries the same comment the chain's helper does.
COMMENT ON FUNCTION private.ari_cert_requirements_set_digest_v1() IS
  'Issue #2060 Pass-5: SHA-256 set digest of ordered (capability_id, evidence_mode) rows from ari_cert_capability_requirements via ari_cert_digest_v1.';

-- ---------------------------------------------------------------------------
-- 5. POST-FLIGHT — assert the result before COMMIT.
-- ---------------------------------------------------------------------------
DO $issue_3055_postflight$
DECLARE
  v_shape text := NULLIF(current_setting('issue_3055.shape', true), '');
  v_owned jsonb := NULLIF(current_setting('issue_3055.owned_rows', true), '')::jsonb;
  v_baseline_rows integer := NULLIF(current_setting('issue_3055.baseline_rows', true), '')::integer;
  v_baseline_unowned_rows integer := NULLIF(current_setting('issue_3055.unowned_rows', true), '')::integer;
  v_baseline_unowned_fingerprint text := NULLIF(current_setting('issue_3055.unowned_fingerprint', true), '');
  v_baseline_trigger_def text := NULLIF(current_setting('issue_3055.trigger_definition', true), '');
  v_not_at_chain text;
  v_expected_delta integer;
  v_rows integer;
  v_unowned_rows integer;
  v_unowned_fingerprint text;
  v_trigger_count integer;
  v_trigger_def text;
  v_trigger_enabled text;
  v_denominators text[];
  v_begin_src text;
  v_finalize_src text;
  v_digest text;
BEGIN
  -- A zero needs its denominator: refuse to pass vacuously.
  IF v_shape IS NULL OR v_owned IS NULL OR v_baseline_rows IS NULL
     OR v_baseline_unowned_rows IS NULL OR v_baseline_unowned_fingerprint IS NULL
     OR v_baseline_trigger_def IS NULL THEN
    RAISE EXCEPTION 'issue_3055_postflight_preflight_state_not_captured';
  END IF;

  -- Every owned row is at its chain value.
  SELECT string_agg(format('%s (%s) evidence_mode=%s, expected %s',
                           o.capability_id, o.source_issue,
                           coalesce(r.evidence_mode, 'ABSENT'), coalesce(o.chain_mode, 'ABSENT')),
                    '; ' ORDER BY o.capability_id)
    INTO v_not_at_chain
  FROM jsonb_to_recordset(v_owned)
    AS o(capability_id text, source_issue text, production_mode text, chain_mode text, starting_mode text)
  LEFT JOIN public.ari_cert_capability_requirements r USING (capability_id)
  WHERE r.evidence_mode IS DISTINCT FROM o.chain_mode;
  IF v_not_at_chain IS NOT NULL THEN
    RAISE EXCEPTION 'issue_3055_postflight_owned_row_not_repaired: %', v_not_at_chain;
  END IF;

  -- The count moved by exactly the delta this file is responsible for.
  SELECT coalesce(sum((chain_mode IS NOT NULL)::integer - (starting_mode IS NOT NULL)::integer), 0)
    INTO v_expected_delta
  FROM jsonb_to_recordset(v_owned)
    AS o(capability_id text, source_issue text, production_mode text, chain_mode text, starting_mode text);
  SELECT count(*) INTO v_rows FROM public.ari_cert_capability_requirements;
  IF v_rows - v_baseline_rows <> v_expected_delta THEN
    RAISE EXCEPTION 'issue_3055_postflight_net_delta_mismatch: baseline=% final=% moved=% expected=% (starting shape %)',
      v_baseline_rows, v_rows, v_rows - v_baseline_rows, v_expected_delta, v_shape;
  END IF;

  -- Rows this file does not own are untouched.
  SELECT count(*),
         md5(coalesce(string_agg(r.capability_id || '=' || r.evidence_mode, E'\n'
                                 ORDER BY r.capability_id COLLATE "C"), ''))
    INTO v_unowned_rows, v_unowned_fingerprint
  FROM public.ari_cert_capability_requirements r
  WHERE r.capability_id NOT IN (
    SELECT o ->> 'capability_id' FROM jsonb_array_elements(v_owned) AS o
  );
  IF v_unowned_rows <> v_baseline_unowned_rows
     OR v_unowned_fingerprint <> v_baseline_unowned_fingerprint THEN
    RAISE EXCEPTION 'issue_3055_postflight_unowned_rows_changed: rows % -> %, fingerprint % -> %',
      v_baseline_unowned_rows, v_unowned_rows, v_baseline_unowned_fingerprint, v_unowned_fingerprint;
  END IF;

  -- The immutability trigger is back, identical and enabled.
  SELECT count(*), min(pg_get_triggerdef(t.oid)), min(t.tgenabled::text)
    INTO v_trigger_count, v_trigger_def, v_trigger_enabled
  FROM pg_trigger t
  WHERE t.tgrelid = 'public.ari_cert_capability_requirements'::regclass
    AND t.tgname = 'ari_cert_capability_requirements_immutable_trigger'
    AND NOT t.tgisinternal;
  IF v_trigger_count <> 1 OR v_trigger_enabled <> 'O'
     OR v_trigger_def IS DISTINCT FROM v_baseline_trigger_def THEN
    RAISE EXCEPTION 'issue_3055_postflight_immutability_trigger_not_restored: present=% enabled=% definition_identical=%',
      v_trigger_count, v_trigger_enabled, (v_trigger_def IS NOT DISTINCT FROM v_baseline_trigger_def)::text;
  END IF;

  -- Both halves derive the digest from the helper, and the helper computes.
  SELECT prosrc INTO v_begin_src FROM pg_proc
  WHERE oid = 'public.ari_cert_begin_run(text,jsonb,text,jsonb,jsonb)'::regprocedure;
  SELECT prosrc INTO v_finalize_src FROM pg_proc
  WHERE oid = 'public.ari_cert_finalize_run(uuid)'::regprocedure;
  IF v_begin_src !~ 'v_requirements_digest\s*:=\s*private\.ari_cert_requirements_set_digest_v1\s*\('
     OR v_finalize_src !~ 'IS DISTINCT FROM private\.ari_cert_requirements_set_digest_v1\s*\(' THEN
    RAISE EXCEPTION 'issue_3055_postflight_functions_not_on_set_digest_helper';
  END IF;
  v_digest := private.ari_cert_requirements_set_digest_v1();
  IF v_digest IS NULL OR v_digest !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'issue_3055_postflight_set_digest_uncomputable: %', v_digest;
  END IF;

  -- The rows agree with the denominator the re-issued finalizer demands.
  SELECT array_agg(m[1]) INTO v_denominators
  FROM regexp_matches(v_finalize_src, 'v_capability_count\s*<>\s*([0-9]+)', 'g') AS m;
  IF coalesce(cardinality(v_denominators), 0) <> 1
     OR v_rows <> v_denominators[1]::integer THEN
    RAISE EXCEPTION 'issue_3055_postflight_requirements_disagree_with_finalizer: % rows, finalizer demands %',
      v_rows, v_denominators;
  END IF;

  RAISE NOTICE 'issue_3055 post-flight: %-shaped start repaired — % -> % requirement rows (delta %), unowned % rows unchanged, trigger restored, set digest %',
    v_shape, v_baseline_rows, v_rows, v_expected_delta, v_unowned_rows, v_digest;
END;
$issue_3055_postflight$;

COMMIT;
