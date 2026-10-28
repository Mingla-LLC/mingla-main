-- Issue #3872 — repair the three Ari certification requirements stranded
-- below production's applied migration head.
--
-- Production is in one reviewed state: 145 requirement rows, the exact
-- 148-capability finalizer, and these three rows absent. The normal repository
-- chain already contains the rows and reaches 164 requirements. This repair is
-- therefore deliberately surgical and convergent:
--   * exact production 145 -> insert only the three missing rows -> exact 148;
--   * exact repaired 148 -> no-op;
--   * exact full-chain 164 -> no-op.
-- Every other row set, evidence mode, partial application, finalizer body, or
-- trigger state is refused before a write. The table lock keeps classification
-- and insertion atomic. The finalizer is never rewritten.
--
-- The version sorts after #4148's migrations, so a fresh replay sees the
-- already-complete 164-row chain and no-ops. The reviewed production runbook
-- applies this file surgically first, then the held #3872 census, then #4148.

BEGIN;
SET LOCAL lock_timeout = '10s';

LOCK TABLE public.ari_cert_capability_requirements
  IN SHARE ROW EXCLUSIVE MODE;

DO $repair$
DECLARE
  c_production_145_digest constant text := '579a8266f7a273536cf5309ab5b021c66b2d205ea76f828fc9a9a9045850cdd2';
  c_repaired_148_digest constant text := 'a702b1ad490affbfbd9b0a2cd35d94f0dd8900b9ada00f2b57b46ce6355f84a5';
  c_chain_164_digest constant text := 'bf03b907d5442db629ebfe4d4ec021a4a0570fbe4e5fa19c83bbb247f760675f';
  c_finalizer_148_digest constant text := '19932adee95699082a78a6cc8def0bb86d1284f11a81fcc0d10a5a20c3338576';
  c_finalizer_164_digest constant text := 'ba73b45613cfd37e91449a3041f42253e479a8b47711011dedcd49e32679ec14';
  v_count integer;
  v_set_digest text;
  v_finalizer_digest text;
  v_shape text;
  v_trigger_count integer;
  v_trigger_enabled text;
  v_target_count integer;
  v_wrong text;
BEGIN
  IF to_regclass('public.ari_cert_capability_requirements') IS NULL THEN
    RAISE EXCEPTION 'issue_3872_repair_requirements_table_missing';
  END IF;
  IF to_regprocedure('public.ari_cert_finalize_run(uuid)') IS NULL THEN
    RAISE EXCEPTION 'issue_3872_repair_finalizer_missing';
  END IF;

  SELECT count(*), min(t.tgenabled::text)
    INTO v_trigger_count, v_trigger_enabled
  FROM pg_trigger t
  WHERE t.tgrelid = 'public.ari_cert_capability_requirements'::regclass
    AND t.tgname = 'ari_cert_capability_requirements_immutable_trigger'
    AND NOT t.tgisinternal;
  IF v_trigger_count <> 1 OR v_trigger_enabled <> 'O' THEN
    RAISE EXCEPTION 'issue_3872_repair_immutability_trigger_unexpected:present=% enabled=%',
      v_trigger_count, coalesce(v_trigger_enabled, '<missing>');
  END IF;

  SELECT count(*),
         encode(extensions.digest(
           coalesce(string_agg(capability_id || ':' || evidence_mode, E'\n'
                               ORDER BY capability_id), ''),
           'sha256'), 'hex')
    INTO v_count, v_set_digest
  FROM public.ari_cert_capability_requirements;
  SELECT encode(extensions.digest(
           pg_get_functiondef('public.ari_cert_finalize_run(uuid)'::regprocedure),
           'sha256'), 'hex')
    INTO v_finalizer_digest;

  IF v_count = 145
     AND v_set_digest = c_production_145_digest
     AND v_finalizer_digest = c_finalizer_148_digest THEN
    v_shape := 'production145';
  ELSIF v_count = 148
        AND v_set_digest = c_repaired_148_digest
        AND v_finalizer_digest = c_finalizer_148_digest THEN
    v_shape := 'repaired148';
  ELSIF v_count = 164
        AND v_set_digest = c_chain_164_digest
        AND v_finalizer_digest = c_finalizer_164_digest THEN
    v_shape := 'chain164';
  ELSE
    RAISE EXCEPTION 'issue_3872_repair_unexpected_start:count=% set_digest=% finalizer_digest=%',
      v_count, v_set_digest, v_finalizer_digest;
  END IF;

  SELECT count(*) INTO v_target_count
  FROM public.ari_cert_capability_requirements
  WHERE capability_id IN (
    'ari.team.revoke_invitation',
    'ari.analytics.listing_conversion',
    'ari.analytics.reservation_metrics'
  );
  IF (v_shape = 'production145' AND v_target_count <> 0)
     OR (v_shape IN ('repaired148', 'chain164') AND v_target_count <> 3) THEN
    RAISE EXCEPTION 'issue_3872_repair_target_presence_disagrees:shape=% target_count=%',
      v_shape, v_target_count;
  END IF;

  IF v_shape = 'production145' THEN
    INSERT INTO public.ari_cert_capability_requirements (capability_id, evidence_mode)
    VALUES
      ('ari.team.revoke_invitation', 'write'),
      ('ari.analytics.listing_conversion', 'read'),
      ('ari.analytics.reservation_metrics', 'read');
  END IF;

  SELECT count(*),
         encode(extensions.digest(
           coalesce(string_agg(capability_id || ':' || evidence_mode, E'\n'
                               ORDER BY capability_id), ''),
           'sha256'), 'hex')
    INTO v_count, v_set_digest
  FROM public.ari_cert_capability_requirements;
  SELECT encode(extensions.digest(
           pg_get_functiondef('public.ari_cert_finalize_run(uuid)'::regprocedure),
           'sha256'), 'hex')
    INTO v_finalizer_digest;

  IF NOT (
    (v_count = 148
      AND v_set_digest = c_repaired_148_digest
      AND v_finalizer_digest = c_finalizer_148_digest)
    OR
    (v_count = 164
      AND v_set_digest = c_chain_164_digest
      AND v_finalizer_digest = c_finalizer_164_digest)
  ) THEN
    RAISE EXCEPTION 'issue_3872_repair_postcondition:shape=% count=% set_digest=% finalizer_digest=%',
      v_shape, v_count, v_set_digest, v_finalizer_digest;
  END IF;

  SELECT string_agg(expected.capability_id || ':' || coalesce(actual.evidence_mode, '<missing>'),
                    ', ' ORDER BY expected.capability_id)
    INTO v_wrong
  FROM (VALUES
    ('ari.team.revoke_invitation', 'write'),
    ('ari.analytics.listing_conversion', 'read'),
    ('ari.analytics.reservation_metrics', 'read')
  ) AS expected(capability_id, evidence_mode)
  LEFT JOIN public.ari_cert_capability_requirements actual
    ON actual.capability_id = expected.capability_id
  WHERE actual.capability_id IS NULL
     OR actual.evidence_mode <> expected.evidence_mode;
  IF v_wrong IS NOT NULL THEN
    RAISE EXCEPTION 'issue_3872_repair_target_modes:%', v_wrong;
  END IF;
END;
$repair$;

COMMIT;
