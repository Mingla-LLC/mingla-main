-- ===========================================================================
-- Issue #2592 — realign `ari_cert_begin_run` with the requirement-set digest
-- that `ari_cert_finalize_run` actually demands.
-- ---------------------------------------------------------------------------
-- `requirements_digest` pins a certification run to a REVIEWED requirement set.
-- It is written ONCE, by `ari_cert_begin_run`, and checked at the end by
-- `ari_cert_finalize_run`. The two literals are one contract with two halves,
-- and they MUST move together. They stopped moving together:
--
--   20270504002060 (#2060)  29b71dbe5ed7…  set in BOTH begin_run and finalize
--   20270505001973 (#1973)  5e06801c4afe…  replaced ONLY the finalizer's check
--   20270521001978 (#1978)  be0add47c599…  replaces ONLY the finalizer's check
--
-- So since #1973 applied to production on 2026-08-20, `begin_run` has stamped
-- `29b71dbe…` onto every run while the live finalizer demanded `5e06801c…`.
-- EVERY run created through the canonical entry point has been rejected with
-- `ari_cert_requirements_digest_mismatch`. Certification has been a dead path
-- for five days, and it is dead for a reason unrelated to the evidence a run
-- actually collected.
--
-- Applying #1978 does NOT repair this: it moves the finalizer to a THIRD value
-- and leaves `begin_run` on the first. This migration is therefore ordered
-- AFTER 20270521001978 and stamps the post-#1978 literal, so the pair agrees
-- the moment both are applied.
--
-- The literal stays HARDCODED on purpose. Computing it from
-- `public.ari_cert_capability_requirements` on both sides would let anyone who
-- mutates that table satisfy the check by construction — the digest exists
-- precisely to pin the requirement set to a value a human reviewed, so a
-- self-satisfying check would delete the property rather than protect it.
-- Drift is prevented instead by a static gate that reads both migration
-- sources and fails when the two literals disagree:
--   `.github/scripts/strict-grep/issue-2592-ari-cert-requirements-digest-parity.mjs`
--
-- ONLY the digest literal changes. Signature, argument validation, INSERT
-- column list, status, RETURNS, SECURITY DEFINER, search_path and ACLs are
-- byte-identical to 20270504002060. MONOTONIC VERSION 20270527002592.
-- Apply via the Supabase Management API after REVIEW, AFTER 20270521001978.
-- ===========================================================================

BEGIN;

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
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_run_id uuid;
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
  INSERT INTO public.ari_cert_runs (
    release_sha, requirements_digest, function_versions,
    web_deployment_id, native_artifacts, baseline, status
  ) VALUES (
    p_release_sha,
    -- #2592: MUST equal the literal `ari_cert_finalize_run` checks. The gate
    -- named in this file's header fails closed when these two diverge.
    'be0add47c599687bada05a16a2cf1bcc3cf4c8a8212e30e5ffeff6ca362a960f',
    p_function_versions, p_web_deployment_id, p_native_artifacts, p_baseline, 'running'
  ) RETURNING id INTO v_run_id;
  RETURN v_run_id;
END;
$function$;

-- ACLs re-stated verbatim from 20270504002060 (CREATE OR REPLACE preserves the
-- existing grants, but re-stating them keeps this file independently correct).
REVOKE ALL ON FUNCTION public.ari_cert_begin_run(text, jsonb, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ari_cert_begin_run(text, jsonb, text, jsonb, jsonb) TO service_role;

COMMENT ON FUNCTION public.ari_cert_begin_run(text, jsonb, text, jsonb, jsonb) IS
  'Issue #2592: opens a certification run stamped with the SAME reviewed requirement-set digest ari_cert_finalize_run checks. The two literals are one contract; a static CI gate fails closed if they ever diverge again.';

COMMIT;
