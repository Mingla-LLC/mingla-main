-- #4179 — Feature Guide reconciliation after a full migration replay.
-- MINGLA-INVARIANT: I-4179-FEATURE-GUIDE-EVERY-MERGE | issue #4179 | Every first-parent merge after #3982 through #4176 is classified exactly once and every referenced capability exists after reconciliation.
-- MINGLA-INVARIANT: I-4179-FEATURE-GUIDE-REWRITES-FAIL-CLOSED | issue #4179 | Rewritten truth cannot remain Live on superseded time-dependent proof.
-- MINGLA-INVARIANT: I-4179-FEATURE-GUIDE-COVERAGE-WATERMARK | issue #4179 | Current means a contiguous, classified first-parent chain reaches the observed main head; a gap globally fails closed.
-- MINGLA-INVARIANT: I-4179-FEATURE-GUIDE-PER-KEY-RETRY | issue #4179 | Named capabilities are invalidated immediately and each key remains retryable until independently applied.
\set ON_ERROR_STOP on
BEGIN;

DO $proof$
DECLARE v_text text;
BEGIN
  IF has_function_privilege('authenticated', 'public.ops_feature_guide_coverage_reconcile()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.issue_4179_capture_release_guide_keys()', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.ops_feature_guide_coverage_reconcile()', 'EXECUTE')
     OR has_table_privilege('authenticated', 'public.ops_feature_guide_coverage', 'SELECT') THEN
    RAISE EXCEPTION 'issue4179_internal_coverage_authority_broadened';
  END IF;
  IF (SELECT count(*) FROM public.product_capabilities) <> 159 THEN
    RAISE EXCEPTION 'issue4179_catalog_count:%', (SELECT count(*) FROM public.product_capabilities);
  END IF;
  IF (SELECT count(*) FROM public.product_capabilities
       WHERE capability_key IN ('account-app-updates','brand-customer-enquiries','staff-mingla-money','web-blog')) <> 4 THEN
    RAISE EXCEPTION 'issue4179_new_entries_missing';
  END IF;
  IF (SELECT count(*) FROM public.product_truth_audit
       WHERE metadata->>'source' = 'issue_4179_feature_guide_merge_reconciliation'
         AND action = 'capability_saved') <> 32 THEN
    RAISE EXCEPTION 'issue4179_saved_audit_count';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.product_capabilities c
     WHERE c.capability_key IN (
       'account-settings','brand-files-and-guides','brand-profile','checkout-trips-experiences',
       'discover-events','discover-stays','discover-swipe-deck','discover-trips',
       'marketing-analytics','marketing-host-ads','official-brand-groups','programs-creators',
       'sites-brand-website','social-chat','social-collab-decide','staff-ads',
       'staff-community-support','staff-data-room','staff-drafts','staff-email','staff-health',
       'staff-offerings','staff-orders-money','staff-people-brands','staff-sites-ops',
       'staff-work-board','staff-mingla-money','trips-installments','web-blog','brand-customer-enquiries'
     )
       AND c.claimed_status = 'live'
       AND public.issue_3720_feature_guide_effective_status(c.id) = 'Live'
  ) THEN
    RAISE EXCEPTION 'issue4179_rewritten_entry_still_live';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.product_capabilities
     WHERE capability_key = 'events-ticket-transfers'
       AND claimed_status = 'planned'
       AND public.issue_3720_feature_guide_effective_status(id) = 'Planned'
       AND outcome_summary ILIKE '%send an eligible extra ticket%'
  ) THEN
    RAISE EXCEPTION 'issue4179_ticket_transfer_not_planned_honestly';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.product_capabilities
     WHERE capability_key = 'account-app-updates'
       AND claimed_status = 'planned'
       AND required_evidence_kinds = ARRAY['source','test','app_release','live_check']
  ) THEN
    RAISE EXCEPTION 'issue4179_app_update_release_gate_missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.product_capabilities
     WHERE capability_key = 'sites-brand-website'
       AND claimed_status = 'live'
       AND outcome_summary ILIKE '%Every active brand%'
       AND limitations ILIKE '%does not mean a site exists%'
  ) THEN
    RAISE EXCEPTION 'issue4179_sites_ga_truth_missing';
  END IF;
  IF (SELECT count(*) FROM public.product_capabilities
       WHERE capability_key IN ('discover-events','discover-stays','discover-swipe-deck','discover-trips')
         AND limitations ILIKE '%staff%test%demo%'
         AND limitations ILIKE '%excluded%') <> 4 THEN
    RAISE EXCEPTION 'issue4179_internal_brand_discovery_truth_missing';
  END IF;
  SELECT concat_ws(' ', title, outcome_summary, how_to, limitations, support_wording)
    INTO v_text FROM public.product_capabilities WHERE capability_key = 'trips-installments';
  IF v_text NOT ILIKE '%eligible Nigerian Paystack%'
     OR v_text ILIKE '%Paystack) brands cannot%'
     OR v_text ILIKE '%not available for brands paid out in Nigeria%' THEN
    RAISE EXCEPTION 'issue4179_paystack_truth_stale';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.product_capability_evidence e
    JOIN public.product_capabilities c ON c.id = e.capability_id
    WHERE c.capability_key IN ('sites-brand-website','programs-creators','trips-installments','web-blog')
      AND e.is_current
      AND e.evidence_kind IN ('release_record','feature_flag','deployment','app_release','live_check')
  ) THEN
    RAISE EXCEPTION 'issue4179_time_dependent_proof_carried_forward';
  END IF;
  IF (SELECT count(*) FROM public.product_capability_evidence e
      JOIN public.product_capabilities c ON c.id = e.capability_id
      WHERE c.capability_key IN ('account-app-updates','brand-customer-enquiries','staff-mingla-money','web-blog')
        AND e.is_current AND e.verdict = 'verified') <> 14 THEN
    RAISE EXCEPTION 'issue4179_static_evidence_count';
  END IF;
END;
$proof$;

-- The future-proofing contract: named keys dirty immediately, evidence
-- promotion is per-key/idempotent, and only a contiguous reasoned main chain
-- advances the audited watermark.
SELECT set_config('request.jwt.claim.role', 'service_role', true);

UPDATE public.product_capability_evidence e SET is_current = false
  FROM public.product_capabilities c
 WHERE c.id = e.capability_id AND c.capability_key = 'trips-installments';
INSERT INTO public.product_capability_evidence(
  capability_id, evidence_kind, evidence_url, verdict, details, observed_at,
  expires_at, is_current
)
SELECT c.id, kind, 'https://github.com/Mingla-LLC/mingla-main/commit/' || repeat('9', 40),
       'verified', 'Synthetic current proof for #4179 contract replay.', now() - interval '1 minute',
       CASE WHEN kind = 'live_check' THEN now() + interval '1 day' END, true
  FROM public.product_capabilities c
  CROSS JOIN LATERAL unnest(c.required_evidence_kinds) kind
 WHERE c.capability_key = 'trips-installments';
UPDATE public.product_capabilities
   SET claimed_status = 'live', verification_due_at = now() + interval '1 day',
       last_verified_at = now(), source_changed_at = NULL,
       source_changed_sha = NULL, source_changed_pr = NULL
 WHERE capability_key = 'trips-installments';

DO $before_invalidation$
BEGIN
  IF (SELECT public.issue_3720_feature_guide_effective_status(id)
        FROM public.product_capabilities WHERE capability_key = 'trips-installments') <> 'Live' THEN
    RAISE EXCEPTION 'issue4179_fixture_not_live';
  END IF;
END;
$before_invalidation$;

INSERT INTO public.ops_release_records(
  pr, title, pr_url, merged_at, merge_sha, deploy_marker, feature_guide,
  live_check, complete, completed_at, comment_urls
) VALUES (
  9904179, 'Feature Guide invalidation proof',
  'https://github.com/Mingla-LLC/mingla-main/pull/9904179', now(), repeat('a', 40), false,
  ARRAY['trips-installments'],
  jsonb_build_object('text','checked','by_login','sethogieva','url','https://github.com/Mingla-LLC/mingla-main/issues/4179#issuecomment-1','at',now()),
  true, now(), jsonb_build_object('4179','https://github.com/Mingla-LLC/mingla-main/issues/4179#issuecomment-1')
);

DO $after_invalidation$
BEGIN
  IF (SELECT source_changed_pr FROM public.product_capabilities WHERE capability_key = 'trips-installments') <> 9904179
     OR (SELECT public.issue_3720_feature_guide_effective_status(id)
           FROM public.product_capabilities WHERE capability_key = 'trips-installments') <> 'Needs review'
     OR NOT EXISTS (SELECT 1 FROM public.ops_release_guide_keys
                     WHERE pr = 9904179 AND capability_key = 'trips-installments'
                       AND result = 'pending' AND applied_at IS NULL) THEN
    RAISE EXCEPTION 'issue4179_merge_did_not_fail_closed';
  END IF;
END;
$after_invalidation$;

SELECT public.ops_release_guide_apply();
DO $per_key_apply$
DECLARE v_revision integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.ops_release_guide_keys
                  WHERE pr = 9904179 AND capability_key = 'trips-installments'
                    AND result = 'live' AND applied_at IS NOT NULL) THEN
    RAISE EXCEPTION 'issue4179_per_key_apply_missing';
  END IF;
  SELECT revision INTO v_revision FROM public.product_capabilities WHERE capability_key = 'trips-installments';
  PERFORM public.ops_release_guide_apply();
  IF (SELECT revision FROM public.product_capabilities WHERE capability_key = 'trips-installments') <> v_revision THEN
    RAISE EXCEPTION 'issue4179_applied_key_replayed';
  END IF;
END;
$per_key_apply$;

DO $record_refresh_is_idempotent$
DECLARE v_revision integer;
BEGIN
  SELECT revision INTO v_revision FROM public.product_capabilities
   WHERE capability_key = 'trips-installments';
  UPDATE public.ops_release_records SET feature_guide = feature_guide WHERE pr = 9904179;
  IF NOT EXISTS (SELECT 1 FROM public.ops_release_guide_keys
                  WHERE pr = 9904179 AND capability_key = 'trips-installments'
                    AND result = 'live' AND applied_at IS NOT NULL)
     OR (SELECT revision FROM public.product_capabilities
          WHERE capability_key = 'trips-installments') <> v_revision THEN
    RAISE EXCEPTION 'issue4179_record_refresh_replayed_applied_key';
  END IF;
END;
$record_refresh_is_idempotent$;

SELECT public.ops_main_commits_ingest(jsonb_build_array(jsonb_build_object(
  'sha', repeat('a', 40), 'first_parent_sha', '896d0482f669d9e0d9f407c6b05a7bc5617010d7',
  'committed_at', now(), 'subject', 'classified capability merge', 'pr', 9904179, 'is_head', true
)));
SELECT public.ops_feature_guide_coverage_reconcile();

INSERT INTO public.ops_release_records(
  pr, title, pr_url, merged_at, merge_sha, deploy_marker, feature_guide,
  feature_guide_reason
) VALUES (
  9904180, 'Reasoned no-effect proof',
  'https://github.com/Mingla-LLC/mingla-main/pull/9904180', now() + interval '1 second', repeat('b', 40), false,
  ARRAY[]::text[], 'CI-only manifest reseal'
);
SELECT public.ops_main_commits_ingest(jsonb_build_array(jsonb_build_object(
  'sha', repeat('b', 40), 'first_parent_sha', repeat('a', 40),
  'committed_at', now() + interval '1 second', 'subject', 'reasoned no effect', 'pr', 9904180, 'is_head', true
)));
SELECT public.ops_feature_guide_coverage_reconcile();

DO $contiguous$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.ops_feature_guide_coverage
                  WHERE state = 'current' AND audited_through_sha = repeat('b', 40)
                    AND observed_head_sha = repeat('b', 40)) THEN
    RAISE EXCEPTION 'issue4179_reasoned_chain_did_not_advance';
  END IF;
END;
$contiguous$;

INSERT INTO public.ops_release_records(
  pr, title, pr_url, merged_at, merge_sha, deploy_marker, feature_guide
) VALUES (
  9904181, 'Bare no-effect proof',
  'https://github.com/Mingla-LLC/mingla-main/pull/9904181', now() + interval '2 seconds', repeat('c', 40), false,
  ARRAY[]::text[]
);
SELECT public.ops_main_commits_ingest(jsonb_build_array(jsonb_build_object(
  'sha', repeat('c', 40), 'first_parent_sha', repeat('b', 40),
  'committed_at', now() + interval '2 seconds', 'subject', 'bare none', 'pr', 9904181, 'is_head', true
)));
SELECT public.ops_feature_guide_coverage_reconcile();

DO $gap$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.ops_feature_guide_coverage
                  WHERE state = 'gap' AND audited_through_sha = repeat('b', 40)
                    AND blocked_sha = repeat('c', 40) AND blocked_pr = 9904181
                    AND blocked_reason = 'no_effect_reason_missing') THEN
    RAISE EXCEPTION 'issue4179_bare_none_did_not_stop_watermark';
  END IF;
  IF (SELECT public.issue_3720_feature_guide_effective_status(id)
        FROM public.product_capabilities WHERE capability_key = 'trips-installments') <> 'Needs review' THEN
    RAISE EXCEPTION 'issue4179_global_gap_did_not_fail_closed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ops_work_cards
                  WHERE auto_key = 'feature_guide_gap:sha-' || left(repeat('c', 40), 12)
                    AND status <> 'done' AND archived_at IS NULL) THEN
    RAISE EXCEPTION 'issue4179_gap_work_card_missing';
  END IF;
END;
$gap$;

ROLLBACK;
\echo 'ISSUE-4179 FEATURE GUIDE MERGE RECONCILIATION PASS'
