-- #3720 — executable weekly Feature Guide drift ownership and idempotency proof.
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO public.product_capabilities(
  capability_key,title,outcome_summary,who_can_use,surfaces,how_to,limitations,
  support_wording,claimed_status,required_evidence_kinds,verification_due_at
) VALUES (
  'issue-3720-drift-proof','Feature Guide drift proof',
  'Support can see when a Feature Guide entry needs current evidence.',
  ARRAY['Support'],ARRAY['Mingla Admin'],
  'Open Community and Support, then choose Feature Guide and review the drift result.',
  'This row exists only inside the rolled-back migration proof.',
  'This capability needs review until its required current source evidence exists.',
  'live',ARRAY['source'],now()+interval '7 days'
);

DO $proof$
DECLARE
  v_count integer;
  v_denied boolean := false;
BEGIN
  SET LOCAL ROLE service_role;
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  SELECT count(*) INTO v_count
    FROM public.issue_3720_feature_guide_drift_snapshot()
   WHERE capability_key = 'issue-3720-drift-proof'
     AND effective_status = 'Needs review'
     AND cardinality(pinned_source_urls) = 0;
  IF v_count <> 1 THEN RAISE EXCEPTION 'drift_snapshot_missing_truth_row'; END IF;
  IF NOT public.issue_3720_claim_feature_guide_drift('2026-10-19'::date) THEN
    RAISE EXCEPTION 'first_weekly_claim_failed';
  END IF;
  IF public.issue_3720_claim_feature_guide_drift('2026-10-19'::date) THEN
    RAISE EXCEPTION 'duplicate_weekly_claim_allowed';
  END IF;
  PERFORM public.issue_3720_complete_feature_guide_drift(
    '2026-10-19'::date,'6260472169',jsonb_build_object('catalog_count',153)
  );
  IF public.issue_3720_claim_feature_guide_drift('2026-10-19'::date) THEN
    RAISE EXCEPTION 'posted_weekly_claim_reopened';
  END IF;
  RESET ROLE;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  BEGIN
    PERFORM public.issue_3720_feature_guide_drift_snapshot();
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied := true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'authenticated_drift_snapshot_allowed'; END IF;
  RESET ROLE;
END;
$proof$;

ROLLBACK;
